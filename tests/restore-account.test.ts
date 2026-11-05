import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeComfy, type FakeComfy } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

/**
 * Restore & colourise for a signed-in account (public sign-up): its run goes to the account's own ComfyUI (a stand-in
 * here) as one batch of its own steps, with only its own clip; the prompt is its own words or Fuobe's offline template,
 * and the studio's ComfyUI and AI helper are never reached. A guest signs up first; an account with no GPU is asked to
 * connect one before anything is made; the cloud engine says to switch to the open engine.
 */
const dir = tempDir("fuobe-restore-account-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
process.env.OLLAMA_URL = "http://owner-llm.test:11434";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ALLOW_PRIVATE_URLS;
delete process.env.FUOBE_HOSTED_RUNS;
globalThis.__fuobeTestDiskFree = 1e13;

// Plain fetch is the install's own ComfyUI, its LLM or anything else: recorded, so a test sees that nothing reached them.
const realFetch = globalThis.fetch;
const fetched: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  if (url.hostname === "127.0.0.1") return realFetch(input, init);
  fetched.push(url.toString());
  if (url.host !== "owner-comfy.test:8188") return new Response("not stubbed", { status: 599 });
  if (url.pathname === "/system_stats") return Response.json({ system: { comfyui_version: "owner", ram_total: 1 }, devices: [] });
  return Response.json({});
}) as typeof fetch;

const auth = await import("@/server/auth");
const restoreRoute = await import("@/app/api/restore/route");
const estimateRoute = await import("@/app/api/restore/estimate/route");
const uploadsRoute = await import("@/app/api/uploads/route");
const gpuRoute = await import("@/app/api/account/gpu/route");
const access = await import("@/lib/guest-access");
const { getGeneration } = await import("@/server/generations");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { clearAccountLoras } = await import("@/server/account-loras");
const { setSetting } = await import("@/server/settings");
const { saveFile } = await import("@/server/storage");
const { runAsTenant } = await import("@/server/tenant");
const { RESTORE_ON_OWN_GPU } = await import("@/server/restore");
const { offlineRestorePrompt, RESTORE } = await import("@/lib/catalog/restore");

const CLIP = fs.readFileSync(path.join(__dirname, "fixtures/shorts-12s.mp4"));

let fake: FakeComfy;
let a = "";
let c = "";
const cookies: Record<string, string> = {};
beforeAll(async () => {
  fake = await startFakeComfy({ loras: [], delayMs: 0, output: "video" });
  globalThis.__fuobeTestGpuPort = fake.port;
  auth.setPassword("install password");
  // The owner's AI helper is set up: an account's run must still never use it.
  setSetting("enhanceProvider", "ollama");
  for (const [k, email] of [
    ["a", "restore-a@example.com"],
    ["c", "restore-c@example.com"],
  ] as const) {
    const id = auth.createAccount(email, "long enough").id;
    cookies[k] = `${auth.SESSION_COOKIE}=${auth.createSession(id).value}`;
    if (k === "a") a = id;
    else c = id;
  }
  // A links its own ComfyUI; C has neither a GPU nor a key.
  expect((await gpuRoute.PUT(json("/api/account/gpu", "PUT", { url: fake.url }, "a"))).status).toBe(200);
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  globalThis.__fuobeTestGpuPort = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  await fake.close();
});
beforeEach(() => {
  resetRates();
  clearAccountLoras(a);
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running') AND json_extract(request_json, '$.account') IS NOT NULL").run();
});

function json(url: string, method: string, body: unknown, who?: string): Request {
  const text = JSON.stringify(body);
  return new Request(`http://localhost:3000${url}`, {
    method,
    headers: { host: "localhost:3000", "content-type": "application/json", "content-length": String(Buffer.byteLength(text)), ...(who && { cookie: cookies[who] }) },
    body: text,
  });
}

async function upload(who: string, data: Buffer, type: string, name: string): Promise<string> {
  const r = await uploadsRoute.POST(new Request("http://localhost:3000/api/uploads", { method: "POST", headers: { host: "localhost:3000", cookie: cookies[who], "content-type": type, "x-file-name": name, "content-length": String(data.length) }, body: new Uint8Array(data) }));
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as { url: string }).url;
}

/** Send a run; a LoRA its ComfyUI lacks is put there (the 409 names it), then it is sent again. */
async function start(send: () => Promise<Response>): Promise<Response> {
  let r = await send();
  if (r.status === 409) {
    const j = (await r.clone().json()) as { code: string; fix?: { items: { file: string }[] } };
    if (j.code === "comfy_missing_model" && j.fix) {
      fake.opts.loras = [...(fake.opts.loras ?? []), ...j.fix.items.map((i) => i.file)];
      clearAccountLoras(a);
      r = await send();
    }
  }
  return r;
}

/** What the studio reads of its own ComfyUI and AI helper to say whether they answer: never a job or a call to them. */
const notStatus = (u: string) => !/\/(system_stats|api\/tags)$/.test(u);
const count = () => (db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n;
const source = (url: string) => ({ url, name: "old.mp4", duration: 12, fps: 16, width: 72, height: 128, hasAudio: true });

describe("Restore & colourise for an account", () => {
  it("runs on its own ComfyUI as one batch of its own steps, with Fuobe's offline prompt; nothing of the studio's is reached", async () => {
    const clip = await upload("a", CLIP, "video/mp4", "old.mp4");
    fetched.length = 0;
    const hint = "a market in 1923";
    const r = await start(() => restoreRoute.POST(json("/api/restore", "POST", { engine: "open", source: source(clip), hint, requestId: "restore-run-1" }, "a")));
    expect(r.status, await r.clone().text()).toBe(201);
    const body = (await r.json()) as { final: { id: string }; items: { id: string; batchId: string | null }[]; prompt: string; by: string };
    expect(body.by).toBe("offline");
    expect(body.prompt).toBe(offlineRestorePrompt(hint).prompt);
    expect(new Set(body.items.map((g) => g.batchId)).size).toBe(1);
    for (const { id } of body.items) {
      const g = getGeneration(id)!;
      expect(g.request.account, id).toBe(a);
      expect(g.provider, id).toBe("comfyui");
    }
    expect(body.items.some(({ id }) => getGeneration(id)!.modelId === RESTORE.model)).toBe(true);
    expect(getGeneration(body.final.id)!.request.feature).toBe(RESTORE.feature);
    expect(fetched.filter(notStatus)).toEqual([]);
    // A repeat of the same request id gets the first run.
    const n = count();
    const again = await restoreRoute.POST(json("/api/restore", "POST", { engine: "open", source: source(clip), hint, requestId: "restore-run-1" }, "a"));
    expect(((await again.json()) as { final: { id: string } }).final.id).toBe(body.final.id);
    expect(count()).toBe(n);
  });

  it("keeps the account's own words when it wrote the prompt", async () => {
    const clip = await upload("a", CLIP, "video/mp4", "old2.mp4");
    const r = await start(() => restoreRoute.POST(json("/api/restore", "POST", { engine: "open", source: source(clip), prompt: "a harbour at dawn, natural colour" }, "a")));
    expect(r.status, await r.clone().text()).toBe(201);
    const body = (await r.json()) as { prompt: string; by: string };
    expect(body).toMatchObject({ prompt: "a harbour at dawn, natural colour", by: "you" });
  });

  it("says to switch to the open engine for a cloud run, before anything is made", async () => {
    const clip = await upload("a", CLIP, "video/mp4", "old3.mp4");
    const n = count();
    const r = await restoreRoute.POST(json("/api/restore", "POST", { engine: "cloud", source: source(clip) }, "a"));
    expect(r.status).toBe(422);
    expect((await r.json()).error).toBe(RESTORE_ON_OWN_GPU);
    expect(count()).toBe(n);
  });

  it("takes only its own clip", async () => {
    const n = count();
    const r = await restoreRoute.POST(json("/api/restore", "POST", { engine: "open", source: source("/api/files/uploads/someone-else.mp4") }, "a"));
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(count()).toBe(n);
  });

  it("asks an account with neither a GPU nor a key to connect one, before anything is made", async () => {
    const clip = runAsTenant({ kind: "account", id: c }, () => saveFile({ data: CLIP, contentType: "video/mp4", source: "upload", name: "c.mp4" }).url);
    const n = count();
    const r = await restoreRoute.POST(json("/api/restore", "POST", { engine: "open", source: source(clip) }, "c"));
    expect(r.status, await r.clone().text()).toBe(403);
    expect(r.headers.get(access.CONNECT_GPU_HEADER)).toBe("1");
    expect((await r.json()).code).toBe("connect-gpu");
    expect(count()).toBe(n);
  });

  it("gives a guest the sign-up card", async () => {
    const r = await restoreRoute.POST(json("/api/restore", "POST", { engine: "open", source: source("/api/files/uploads/x.mp4") }));
    expect(r.status).toBe(401);
    expect(r.headers.get(access.GUEST_HEADER)).toBe("1");
  });

  it("prices an account's run on its own GPU, with the hosted runs off as today", async () => {
    const r = await estimateRoute.POST(json("/api/restore/estimate", "POST", { engine: "open", source: source("/api/files/uploads/x.mp4") }, "a"));
    expect(r.status, await r.clone().text()).toBe(200);
    const e = await r.json();
    expect(e).toMatchObject({ engine: "open", demo: false, costUsd: 0 });
    expect(e).not.toHaveProperty("place");
    expect(e).not.toHaveProperty("loraReady");
  });
});
