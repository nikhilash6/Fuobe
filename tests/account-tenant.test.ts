import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFakeComfy, TINY_PNG, type FakeComfy } from "./helpers/fake-comfy-runner";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-account-tenant-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ALLOW_PRIVATE_URLS;

// Every plain fetch is recorded: nothing an account does may reach the install's ComfyUI.
const realFetch = globalThis.fetch;
const fetched: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  fetched.push(String(input instanceof Request ? input.url : input));
  return new Response("not stubbed", { status: 599 });
}) as typeof fetch;

const auth = await import("@/server/auth");
const { runAsTenant } = await import("@/server/tenant");
const { readRef, localHead, saveFile, RefError } = await import("@/server/storage");
const { accountRun, createGenerations, mentionElements } = await import("@/server/generations");
const { llmTextBackend } = await import("@/server/enhance");
const { ensureLorasOnComfy, withoutUnreachableCivitai } = await import("@/server/loras");
const { createElement } = await import("@/server/elements");
const { db } = await import("@/server/db");

let fake: FakeComfy;
let a = "";
let b = "";
beforeAll(async () => {
  fake = await startFakeComfy({ loras: [], delayMs: 60_000 });
  globalThis.__fuobeTestGpuPort = fake.port;
  auth.setPassword("install password");
  a = auth.createAccount("tenant-a@example.com", "long enough").id;
  b = auth.createAccount("tenant-b@example.com", "long enough").id;
  auth.setAccountGpu(a, { url: fake.url });
  auth.setAccountGpu(b, { url: fake.url });
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  globalThis.__fuobeTestGpuPort = undefined;
  await fake.close();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

const asA = <T,>(fn: () => T) => runAsTenant({ kind: "account", id: a }, fn);

describe("inside an account's work, only its own files", () => {
  it("reads its own upload and data: URIs; refuses the owner's files, asset ids and links", async () => {
    const mine = saveFile({ data: TINY_PNG, contentType: "image/png", source: "upload", accountId: a });
    const owners = saveFile({ data: TINY_PNG, contentType: "image/png", source: "upload" });
    expect(mine.accountId).toBe(a);
    expect(owners.accountId).toBeUndefined();
    await asA(async () => {
      expect((await readRef(mine.url)).data.equals(TINY_PNG)).toBe(true);
      expect((await readRef(`data:text/plain;base64,${Buffer.from("hi").toString("base64")}`)).data.toString()).toBe("hi");
      await expect(readRef(owners.url)).rejects.toThrow(/isn't yours/);
      await expect(readRef(owners.id)).rejects.toBeInstanceOf(RefError);
      await expect(readRef("https://example.com/a.png")).rejects.toThrow(/can't fetch links/);
      await expect(readRef("/api/files/uploads/2020-01-01/nothing.png")).rejects.toThrow(/expired/);
    });
    // Another account can't read it either; the owner reads everything.
    await runAsTenant({ kind: "account", id: b }, async () => expect(readRef(mine.url)).rejects.toThrow(/isn't yours/));
    expect((await readRef(owners.url)).data.length).toBe(TINY_PNG.length);
  });

  it("can't even tell whether another's file exists (localHead)", () => {
    const mine = saveFile({ data: TINY_PNG, contentType: "image/png", source: "upload", accountId: a });
    const owners = saveFile({ data: TINY_PNG, contentType: "image/png", source: "upload" });
    asA(() => {
      expect(localHead(mine.url)).not.toBeNull();
      expect(localHead(owners.url)).toBeNull();
      expect(localHead(owners.id)).toBeNull();
    });
    expect(localHead(owners.url)).not.toBeNull();
    runAsTenant({ kind: "guest" }, () => expect(localHead(owners.url)).toBeNull());
  });

  it("never uses the owner's elements, AI helper or LoRA folder", async () => {
    const photo = saveFile({ data: TINY_PNG, contentType: "image/png", source: "upload" });
    createElement({ name: "Maya", kind: "character", references: [photo.url] });
    expect(mentionElements().map((e) => e.name)).toContain("Maya");
    asA(() => expect(mentionElements()).toEqual([]));
    asA(() => expect(llmTextBackend()).toBeNull());
    const civitai = [{ file: "look.safetensors", url: "https://civitai.com/api/download/models/1" }];
    expect(withoutUnreachableCivitai(civitai, "fal").loras).toEqual([]);
    // On the account's own fal.ai key a civitai file is left out (copying it needs the studio's civitai key); its GPU checks its own.
    asA(() => expect(withoutUnreachableCivitai(civitai, "fal")).toEqual({ loras: [], notes: [expect.stringMatching(/civitai, so runs on your key leave it out/)] }));
    asA(() => expect(withoutUnreachableCivitai(civitai, "comfyui").loras).toEqual(civitai));
    await asA(async () => expect(ensureLorasOnComfy(civitai, [])).rejects.toThrow(/never downloaded/));
  });
});

describe("every step an account's run starts is its own", () => {
  const rowsSince = (t: number) =>
    (db().prepare("SELECT id, request_json, depends_on FROM generations WHERE created_at >= ? ORDER BY created_at").all(t) as { id: string; request_json: string; depends_on: string | null }[]).map((r) => ({
      id: r.id,
      account: (JSON.parse(r.request_json) as { account?: string }).account,
      waits: !!r.depends_on,
    }));
  const run = (fn: () => unknown) => {
    const own = accountRun(a, "comfyui");
    if (!("run" in own)) throw new Error(own.error);
    return own.run(fn);
  };

  it("stamps a multi-shot film's shots and its join", () => {
    const t = Date.now();
    run(() => createGenerations({ feature: "video", modelId: "oss-wan22-14b", prompt: "a film", params: { shots: [{ prompt: "a woman walks" }, { prompt: "she turns" }] } } as never));
    const rows = rowsSince(t);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.some((r) => r.waits)).toBe(true);
    for (const r of rows) expect(r.account, r.id).toBe(a);
  });

  it("stamps a relight effect's first step and its clip", () => {
    const mine = saveFile({ data: TINY_PNG, contentType: "image/png", source: "upload", accountId: a });
    const t = Date.now() + 1;
    while (Date.now() < t);
    run(() => createGenerations({ feature: "video", modelId: "fuobe-dop", presetId: "effect-acid", prompt: "", inputs: { images: [mine.url] } } as never));
    const rows = rowsSince(t);
    expect(rows.length).toBe(2);
    for (const r of rows) expect(r.account, r.id).toBe(a);
  });

  it("refuses a request stamped for another account, and a step that waits for someone else's run", () => {
    expect(() => run(() => createGenerations({ feature: "video", modelId: "oss-wan22-14b", prompt: "x", account: b } as never))).toThrow(/another account/);
    db()
      .prepare(
        "INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES ('owner-dep', 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'succeeded', '{}', '[]', 1, 1)",
      )
      .run();
    expect(() => run(() => createGenerations({ feature: "video", modelId: "oss-wan22-14b", prompt: "x" } as never, { dependsOn: "owner-dep" }))).toThrow(/isn't yours/);
    // A visitor's price check never starts a run.
    expect(() => runAsTenant({ kind: "guest" }, () => createGenerations({ feature: "video", modelId: "oss-wan22-14b", prompt: "x" } as never))).toThrow(/free account/);
  });

  it("starts the runner outside the run that first needed it, so the owner's polls stay the owner's", async () => {
    const { outsideRuns } = await import("@/server/generations");
    const { ownGpu } = await import("@/server/providers/comfyui");
    const { getSetting } = await import("@/server/settings");
    const { tenant } = await import("@/server/tenant");
    const saved = getSetting("demoMode");
    await run(() => {
      expect(getSetting("demoMode")).toBe("off");
      expect(tenant()).toEqual({ kind: "account", id: a });
      expect(ownGpu()).toMatchObject({ url: fake.url });
      outsideRuns(() => {
        expect(tenant()).toBeUndefined();
        expect(ownGpu()).toBeUndefined();
        expect(getSetting("demoMode")).toBe(saved);
      });
      // A timer started outside the run sees no run.
      return new Promise<void>((resolve) =>
        outsideRuns(() =>
          setTimeout(() => {
            expect(tenant()).toBeUndefined();
            expect(ownGpu()).toBeUndefined();
            resolve();
          }, 1),
        ),
      );
    });
  });

  it("never reached the install's ComfyUI", () => {
    // (The runner's own reachability check of the install's ComfyUI, /system_stats, is the owner's background work.)
    expect(fetched.filter((u) => u.includes("owner-comfy.test") && !u.endsWith("/system_stats"))).toEqual([]);
  });
});
