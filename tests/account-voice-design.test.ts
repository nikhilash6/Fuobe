import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeComfy, type FakeComfy } from "./helpers/fake-comfy-runner";

// Design a voice under public sign-up: an account designs and clones voices on its own GPU with its own samples. The
// owner's saved voices (their take, its line, the kept fal embedding) never reach an account's run, and nothing is
// fetched or stored on the owner's elements for it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-account-voice-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://owner-comfy.test:8188";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ALLOW_PRIVATE_URLS;
globalThis.__fuobeTestDiskFree = 1e13;

const realFetch = globalThis.fetch;
const fetched: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("http://127.0.0.1:")) return realFetch(input, init);
  fetched.push(url);
  return new Response("not stubbed", { status: 599 });
}) as typeof fetch;

const auth = await import("@/server/auth");
const { POST } = await import("@/app/api/generations/route");
const { saveFile } = await import("@/server/storage");
const { createElement, getElement } = await import("@/server/elements");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");

const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.from([36, 0, 0, 0]), Buffer.from("WAVEfmt "), Buffer.alloc(32)]);
let fake: FakeComfy;
let a = "";
let cookie = "";
let ownerClip = "";
let ownerVoiceId = "";
beforeAll(async () => {
  fake = await startFakeComfy({ loras: [], delayMs: 60_000 });
  globalThis.__fuobeTestGpuPort = fake.port;
  auth.setPassword("install password");
  a = auth.createAccount("voices@example.com", "long enough").id;
  auth.setAccountGpu(a, { url: fake.url });
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(a).value}`;
  ownerClip = saveFile({ data: WAV, contentType: "audio/wav", name: "take.wav", source: "upload" }).url;
  ownerVoiceId = createElement({ name: "Owner's narrator", kind: "voice", references: [ownerClip], voice: { modelId: "qwen-3-tts", engine: "cloud", description: "A warm narrator.", transcript: "The owner's line." } }).id;
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

function run(body: unknown) {
  const text = JSON.stringify(body);
  return POST(new Request("http://localhost:3000/api/generations", { method: "POST", headers: { cookie, host: "localhost:3000", "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }, body: text }));
}
const clone = (voiceAudio: string) => ({ feature: "audio", modelId: "oss-qwen3-tts", engine: "open", op: "tts", prompt: "A new line.", inputs: { voiceAudio } });
const sentGraphs = () => fake.log.filter((l) => l.path === "/prompt" && l.prompt).map((l) => l.prompt as Record<string, { class_type: string; inputs: Record<string, unknown> }>);
const waitForGraph = async (n: number) => {
  for (let i = 0; i < 200 && sentGraphs().length < n; i++) await new Promise((r) => setTimeout(r, 25));
  return sentGraphs();
};

describe("Design a voice for an account", () => {
  it("can't clone the owner's saved voice: the take is the owner's file", async () => {
    const r = await run(clone(ownerClip));
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ code: "input-not-yours" });
  });

  it("designs a voice on its own GPU", async () => {
    const r = await run({ feature: "audio", modelId: "oss-qwen3-tts", engine: "open", op: "voice-design", prompt: "Hello there.", params: { voiceDescription: "A bright young voice." } });
    expect(r.status).toBe(201);
    const graphs = await waitForGraph(1);
    const node = Object.values(graphs.at(-1)!).find((n) => n.class_type === "AILab_Qwen3TTSVoiceDesign_Advanced")!;
    expect(node.inputs).toMatchObject({ text: "Hello there.", instruct: "A bright young voice." });
  });

  it("clones its own sample with no owner's line or embedding; with no transcript, from the timbre alone", async () => {
    const mine = saveFile({ data: WAV, contentType: "audio/wav", name: "me.wav", source: "upload", accountId: a }).url;
    const before = sentGraphs().length;
    const r = await run(clone(mine));
    expect(r.status).toBe(201);
    const { items } = await r.json();
    expect(items[0].request.account).toBe(a);
    const graphs = await waitForGraph(before + 1);
    const node = Object.values(graphs.at(-1)!).find((n) => n.class_type === "AILab_Qwen3TTSVoiceClone_Advanced")!;
    expect(node.inputs).toMatchObject({ target_text: "A new line.", reference_text: "", x_vector_only: true });
    // The owner's saved voice is as it was, and nothing went out to fetch an embedding.
    expect(getElement(ownerVoiceId)!.voice).toEqual({ modelId: "qwen-3-tts", engine: "cloud", description: "A warm narrator.", transcript: "The owner's line." });
    expect(fetched.filter((u) => !u.endsWith("/system_stats"))).toEqual([]);
  });
});
