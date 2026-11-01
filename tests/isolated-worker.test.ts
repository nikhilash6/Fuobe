import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Generation, ModelDef } from "@/lib/catalog/types";

vi.setConfig({ testTimeout: 30_000 });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-isolated-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://comfy.test:8188";

const { setSetting } = await import("@/server/settings");
const { comfyProvider, workerFor } = await import("@/server/providers/comfyui");
const gens = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");
const { getModel } = await import("@/lib/catalog");
const { studioCatalog } = await import("@/lib/studio-catalog");
const { LIPSYNC_STUDIO, SFX_STUDIO, FOLEY_STUDIO } = await import("@/lib/studios");
const { toModelRow } = await import("@/lib/model-rows");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

// fetch + WebSocket stubs, as in comfy-provider.test.ts
type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const realFetch = globalThis.fetch;
const realWs = globalThis.WebSocket;
let handler: Handler = () => new Response("not stubbed", { status: 599 });
const calls: string[] = [];
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 1;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  close() {
    this.readyState = 3;
  }
}
beforeEach(() => {
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    return handler(url, init);
  }) as typeof fetch;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  setSetting("comfyUrl", "http://comfy.test:8188");
  setSetting("comfyIsolatedUrl", "");
});
afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.WebSocket = realWs;
});

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const latent = getModel("oss-latentsync")! as ModelDef;
const route = latent.routes[0];
let uploads = 0;
/** A ComfyUI that takes uploads, accepts prompts and reports one finished video. */
const comfy: Handler = (url) => {
  if (url.endsWith("/upload/image")) return json({ name: `fuobe_up${++uploads}.bin`, subfolder: "" });
  if (url.endsWith("/prompt")) return json({ prompt_id: "iso-1" });
  if (url.includes("/history/iso-1")) return json({ "iso-1": { status: { status_str: "success", completed: true }, outputs: { "5": { gifs: [{ filename: "fuobe_00001.mp4", subfolder: "fuobe", type: "output" }] } } } });
  if (url.endsWith("/system_stats")) return json({ system: { comfyui_version: "0.41.0", ram_total: 2 ** 34 }, devices: [{ name: "cuda:0", vram_total: 24 * 2 ** 30 }] });
  return json({ queue_running: [], queue_pending: [] });
};

describe("isolated ComfyUI worker", () => {
  it("knows which workflows run there", () => {
    expect(workerFor("lipsync-latentsync16")).toBe("isolated");
    expect(workerFor("sfx-thinksound")).toBe("isolated");
    expect(workerFor("lipsync-v2v-infinitetalk")).toBe("main");
    expect(workerFor("video-concat-{n}")).toBe("main");
    expect(workerFor(undefined)).toBe("main");
  });

  it("sends an isolated workflow's uploads, prompt, progress socket and polls to the isolated worker", async () => {
    setSetting("comfyIsolatedUrl", "http://iso.test:8189/");
    handler = comfy;
    const video = await comfyProvider.prepareFile(Buffer.from("video"), "video/mp4", "clip.mp4", route);
    const audio = await comfyProvider.prepareFile(Buffer.from("voice"), "audio/wav", "voice.wav", route);
    const res = await comfyProvider.submit({ generationId: "g1", model: latent, route, input: { video, audio, extra: { lipsExpression: 2 } } });
    expect(res.meta).toMatchObject({ workflowId: "lipsync-latentsync16", worker: "isolated" });
    expect(calls).toEqual(["http://iso.test:8189/upload/image", "http://iso.test:8189/upload/image", "http://iso.test:8189/prompt"]);
    expect(FakeSocket.all.at(-1)!.url).toMatch(/^ws:\/\/iso\.test:8189\/ws\?clientId=/);
    // The sliders reach the graph.
    expect((res.payload as Record<string, { inputs: Record<string, unknown> }>)["4"].inputs.lips_expression).toBe(2);
    calls.length = 0;
    const polled = await comfyProvider.poll({ externalId: "iso-1", meta: res.meta!, route, model: latent, createdAt: Date.now() });
    expect(polled.state).toBe("succeeded");
    expect(polled.state === "succeeded" && polled.outputs[0].url).toMatch(/^http:\/\/iso\.test:8189\/view\?filename=fuobe_00001\.mp4/);
    expect(calls.every((u) => u.startsWith("http://iso.test:8189/"))).toBe(true);
    // Cancel goes there too.
    calls.length = 0;
    await comfyProvider.cancel!({ externalId: "iso-1", meta: res.meta!, route, model: latent, createdAt: Date.now() });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((u) => u.startsWith("http://iso.test:8189/"))).toBe(true);
    // Everything else stays on the main server.
    calls.length = 0;
    await comfyProvider.prepareFile(Buffer.from("png"), "image/png", "a.png", { op: "edit", provider: "comfyui", endpoint: "selftest-image" });
    await comfyProvider.prepareFile(Buffer.from("png"), "image/png", "b.png");
    expect(calls).toEqual(["http://comfy.test:8188/upload/image", "http://comfy.test:8188/upload/image"]);
  });

  it("names the setting when the isolated worker isn't set up or doesn't answer", async () => {
    handler = comfy;
    await expect(comfyProvider.prepareFile(Buffer.from("video"), "video/mp4", "clip.mp4", route)).rejects.toThrow(/isolated ComfyUI worker, which isn't set up yet: add its address in Settings → Open-source engine · ComfyUI → Isolated worker URL \(or COMFYUI_ISOLATED_URL\)/);
    expect(calls).toEqual([]);
    setSetting("comfyIsolatedUrl", "http://iso.test:8189");
    handler = (url) => {
      if (url.startsWith("http://iso.test")) throw new TypeError("fetch failed");
      return comfy(url);
    };
    await expect(comfyProvider.prepareFile(Buffer.from("video"), "video/mp4", "clip.mp4", route)).rejects.toThrow(/The isolated ComfyUI worker at http:\/\/iso\.test:8189 doesn't answer \(fetch failed\)\. Start it \(scripts\/comfy\/README\.md\) or check Settings → Open-source engine · ComfyUI → Isolated worker URL/);
    // A proxy in front of a stopped worker answers 502: the message still says which server and where it's set.
    handler = (url) => {
      if (url.startsWith("http://iso.test")) return new Response("<html><body><h1>502 Bad Gateway</h1></body></html>", { status: 502, headers: { "Content-Type": "text/html" } });
      return comfy(url);
    };
    const said = /The isolated ComfyUI worker at http:\/\/iso\.test:8189 answered HTTP 502 to (an upload|the prompt|\/history\/iso-1) — check that it's running \(scripts\/comfy\/README\.md\) and its address in Settings → Open-source engine · ComfyUI → Isolated worker URL$/;
    await expect(comfyProvider.prepareFile(Buffer.from("video"), "video/mp4", "clip.mp4", route)).rejects.toThrow(said);
    await expect(comfyProvider.submit({ generationId: "g2", model: latent, route, input: { video: "v.mp4", audio: "a.wav" } })).rejects.toThrow(said);
    await expect(comfyProvider.poll({ externalId: "iso-1", meta: { workflowId: "lipsync-latentsync16", worker: "isolated" }, route, model: latent, createdAt: Date.now() })).rejects.toThrow(said);
    handler = (url) => (url.startsWith("http://iso.test") ? new Response("upload folder is read-only", { status: 500 }) : comfy(url));
    await expect(comfyProvider.prepareFile(Buffer.from("video"), "video/mp4", "clip.mp4", route)).rejects.toThrow(/answered HTTP 500 to an upload \(upload folder is read-only\) — check/);
    // The main server's messages are unchanged.
    handler = (url) => (url.endsWith("/upload/image") ? new Response("nope", { status: 500 }) : comfy(url));
    await expect(comfyProvider.prepareFile(Buffer.from("png"), "image/png", "a.png")).rejects.toThrow(/^ComfyUI upload failed: 500 nope$/);
    handler = (url) => {
      if (url.startsWith("http://iso.test")) throw new TypeError("fetch failed");
      return comfy(url);
    };
    // The connection test reports it next to the main server, which still passes.
    expect(await comfyProvider.test!()).toEqual({ ok: true, detail: "ComfyUI 0.41.0 · cuda:0 · 24 GB · the isolated worker at http://iso.test:8189 doesn't answer" });
    handler = comfy;
    expect((await comfyProvider.test!()).detail).toBe("ComfyUI 0.41.0 · cuda:0 · 24 GB · isolated worker: ComfyUI 0.41.0 · cuda:0 · 24 GB");
    setSetting("comfyIsolatedUrl", "");
    expect((await comfyProvider.test!()).detail).toBe("ComfyUI 0.41.0 · cuda:0 · 24 GB");
  });

  it("a generation on an isolated model fails with that message, instead of running on the main server", async () => {
    setSetting("demoMode", "auto");
    handler = comfy;
    // The main ComfyUI answers (routing picks the open route), the isolated worker isn't set up.
    globalThis.__fuobeComfyReach = { ok: true, at: Date.now(), url: "http://comfy.test:8188" };
    const video = saveFile({ data: Buffer.from("video"), contentType: "video/mp4", name: "clip.mp4", source: "upload" }).url;
    const audio = saveFile({ data: Buffer.from("voice"), contentType: "audio/wav", name: "voice.wav", source: "upload" }).url;
    const [g] = gens.createGenerations({ feature: "lipsync", modelId: "oss-latentsync", op: "lipsync", inputs: { video, audio } });
    expect(g.provider).toBe("comfyui");
    expect(g.costUsd).toBe(0);
    const end = Date.now() + 10_000;
    let done: Generation = g;
    while (Date.now() < end && !["failed", "succeeded"].includes(done.status)) {
      await new Promise((r) => setTimeout(r, 50));
      done = gens.getGeneration(g.id)!;
    }
    expect(done.status).toBe("failed");
    expect(done.error).toMatch(/isolated ComfyUI worker.*Isolated worker URL/);
    expect(calls.some((u) => u.startsWith("http://comfy.test:8188/upload"))).toBe(false);
  });
});

describe("isolated-worker models in the studios", () => {
  const ids = (c: { models: ModelDef[] }) => c.models.map((m) => m.id);
  it("LatentSync is in the Lipsync studio and ThinkSound in Sound effects, both marked", () => {
    const lips = studioCatalog(LIPSYNC_STUDIO);
    expect(ids(lips)).toContain("oss-latentsync");
    expect(lips.models.find((m) => m.id === "oss-latentsync")).toMatchObject({ worker: "isolated", engine: "open" });
    expect(ids(studioCatalog(SFX_STUDIO))).toContain("oss-thinksound");
    // ThinkSound's workflow makes sound from words only, so it isn't offered for a video.
    expect(ids(studioCatalog(FOLEY_STUDIO))).not.toContain("oss-thinksound");
    // Neither is a default: they need a second ComfyUI.
    expect([LIPSYNC_STUDIO.defaultModels.open, SFX_STUDIO.defaultModels.open]).toEqual(["oss-infinitetalk", "oss-stable-audio-3"]);
    expect(toModelRow(getModel("oss-latentsync")!).note).toBe("Runs on a second ComfyUI");
    expect(toModelRow(getModel("oss-infinitetalk")!).note).toBeUndefined();
  });
});
