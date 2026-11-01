import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeComfy, TINY_PNG, type FakeComfy } from "./helpers/fake-comfy-runner";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-account-inputs-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ALLOW_PRIVATE_URLS;
globalThis.__fuobeTestDiskFree = 1e13;

const realFetch = globalThis.fetch;
const fetched: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  fetched.push(String(input instanceof Request ? input.url : input));
  return new Response("not stubbed", { status: 599 });
}) as typeof fetch;

const auth = await import("@/server/auth");
const { POST } = await import("@/app/api/generations/route");
const { saveFile, deleteAsset } = await import("@/server/storage");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");

let fake: FakeComfy;
let a = "";
let cookie = "";
beforeAll(async () => {
  fake = await startFakeComfy({ loras: [], delayMs: 60_000 });
  globalThis.__fuobeTestGpuPort = fake.port;
  auth.setPassword("install password");
  a = auth.createAccount("inputs@example.com", "long enough").id;
  auth.setAccountGpu(a, { url: fake.url });
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(a).value}`;
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  globalThis.__fuobeTestGpuPort = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  await fake.close();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});
beforeEach(() => {
  resetRates();
  // Each test starts with no runs going.
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
});

const motion = (images: string[], extra: Record<string, unknown> = {}) => ({ feature: "video", modelId: "fuobe-dop", presetId: "motion-zoom-in", prompt: "a slow push", inputs: { images }, ...extra });

function run(body: unknown, raw?: string) {
  const text = raw ?? JSON.stringify(body);
  return POST(new Request("http://localhost:3000/api/generations", { method: "POST", headers: { cookie, host: "localhost:3000", "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }, body: text }));
}

const own = () => saveFile({ data: TINY_PNG, contentType: "image/png", source: "upload", accountId: a });

describe("an account's run names only files it uploaded here", () => {
  it("refuses the owner's file, in inputs or in params.extra", async () => {
    const owners = saveFile({ data: TINY_PNG, contentType: "image/png", source: "upload" });
    const r = await run(motion([owners.url]));
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ code: "input-not-yours", error: "That file isn't yours. Upload your own." });
    const extra = await run(motion([own().url], { params: { extra: { audio2: owners.url } } }));
    expect(extra.status).toBe(403);
    expect(extra.headers.get("x-fuobe-gpu-setup")).toBeNull();
  });

  it("refuses data: URIs, links and asset ids", async () => {
    for (const ref of [`data:image/png;base64,${TINY_PNG.toString("base64")}`, "https://example.com/a.png", own().id]) {
      const r = await run(motion([ref]));
      expect(r.status, ref.slice(0, 30)).toBe(400);
      expect((await r.json()).code).toBe("input-not-allowed");
    }
  });

  it("says when an upload has expired", async () => {
    const gone = own();
    deleteAsset(gone.id);
    const r = await run(motion([gone.url]));
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({ code: "input-gone", error: "That file has expired. Upload it again." });
  });

  it("runs with its own upload", async () => {
    const r = await run(motion([own().url]));
    expect(r.status).toBe(201);
    const { items } = await r.json();
    expect(items[0].request.account).toBe(a);
  });
});

describe("an account's fair share", () => {
  it("has at most 4 runs going", async () => {
    for (let i = 0; i < 4; i++) expect((await run(motion([own().url]))).status).toBe(201);
    const fifth = await run(motion([own().url]));
    expect(fifth.status).toBe(429);
    expect((await fifth.json()).error).toBe("You have 4 runs going. Start the next one when one finishes.");
  });

  it("sends a small request", async () => {
    const r = await run(null, JSON.stringify(motion([own().url], { prompt: "x".repeat(1_100_000) })));
    expect(r.status).toBe(413);
  });

  it("makes up to 4 results a run, and says so", async () => {
    const r = await run(motion([own().url], { params: { numOutputs: 8 } }));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body.items.length).toBe(4);
    expect(body.notes).toContain("Account runs make up to 4 at a time.");
  });

  it("never reached the install's ComfyUI", () => {
    // (The runner's own reachability check of the install's ComfyUI, /system_stats, is the owner's background work.)
    expect(fetched.filter((u) => u.includes("owner-comfy.test") && !u.endsWith("/system_stats"))).toEqual([]);
  });
});
