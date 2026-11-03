import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeComfy, type FakeComfy } from "./helpers/fake-comfy-runner";

// "Clean the voice first" under public sign-up: an account's transcript or lip sync with the switch on runs every step
// (the clean voice, the run on it, a re-sync's music put back) as its own, on its own GPU, from its own files only; an
// owner's file is refused before anything is queued, as without the switch.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-account-voice-first-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ALLOW_PRIVATE_URLS;
globalThis.__fuobeTestDiskFree = 1e13;

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("http://127.0.0.1:")) return realFetch(input, init);
  return new Response("not stubbed", { status: 599 });
}) as typeof fetch;

const auth = await import("@/server/auth");
const { POST } = await import("@/app/api/generations/route");
const { saveFile } = await import("@/server/storage");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");

const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.from([36, 0, 0, 0]), Buffer.from("WAVEfmt "), Buffer.alloc(32)]);
let fake: FakeComfy;
let a = "";
let cookie = "";
let ownerClip = "";
beforeAll(async () => {
  fake = await startFakeComfy({ loras: [], delayMs: 60_000 });
  globalThis.__fuobeTestGpuPort = fake.port;
  auth.setPassword("install password");
  a = auth.createAccount("voice-first@example.com", "long enough").id;
  auth.setAccountGpu(a, { url: fake.url });
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(a).value}`;
  ownerClip = saveFile({ data: WAV, contentType: "audio/wav", name: "owner.wav", source: "upload" }).url;
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
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
});

function run(body: unknown, preview = false) {
  const text = JSON.stringify(body);
  return POST(
    new Request(`http://localhost:3000/api/generations${preview ? "?preview=1" : ""}`, {
      method: "POST",
      headers: { cookie, host: "localhost:3000", "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) },
      body: text,
    }),
  );
}
const words = (audio: string) => ({ feature: "transcribe", modelId: "oss-qwen3-asr", engine: "open", op: "transcribe", inputs: { audio }, voiceFirst: true });

describe("Clean the voice first for an account", () => {
  it("refuses the owner's recording before anything is queued", async () => {
    const before = (db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n;
    const r = await run(words(ownerClip));
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ code: "input-not-yours" });
    expect((db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n).toBe(before);
  });

  it("runs the clean voice and the transcript as its own, on the open engine, from its own recording", async () => {
    const mine = saveFile({ data: WAV, contentType: "audio/wav", name: "me.wav", source: "upload", accountId: a }).url;
    const priced = await run(words(mine), true);
    expect(priced.status).toBe(200);
    expect(await priced.json()).toMatchObject({ costUsd: 0 });
    const r = await run(words(mine));
    expect(r.status).toBe(201);
    const { items } = await r.json();
    expect(items.map((g: { modelId: string }) => g.modelId)).toEqual(["oss-qwen3-asr", "oss-dbs-separate"]);
    for (const g of items) expect(g.request).toMatchObject({ account: a, engine: "open" });
    expect(items[1].request.inputs).toEqual({ audio: mine });
  });
});
