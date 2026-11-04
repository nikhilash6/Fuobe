import { describe, expect, it } from "vitest";
import type { ModelDef, ModelRoute } from "@/lib/catalog/types";
import { tempDir } from "./helpers/temp-dir";

// Provider adapters read their keys from the settings table: give them a throwaway database.
const dir = tempDir("fuobe-providers-");
process.env.FUOBE_DATA_DIR = dir;

const { falProvider } = await import("@/server/providers/fal");
const { replicateProvider } = await import("@/server/providers/replicate");


/** Answer fetches from a table of URL → JSON body, in order of registration. */
async function withFetch<T>(answers: Record<string, unknown>, fn: () => Promise<T>): Promise<{ result: T; urls: string[] }> {
  const real = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    urls.push(u);
    const hit = Object.keys(answers).find((k) => u.startsWith(k));
    if (!hit) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(answers[hit]), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    return { result: await fn(), urls };
  } finally {
    globalThis.fetch = real;
  }
}

const model = { id: "m", routes: [] } as unknown as ModelDef;
const ctx = (route: Partial<ModelRoute>, meta: Record<string, unknown> = {}) => ({
  externalId: "req-1",
  meta,
  route: { op: "t2i", provider: "fal", endpoint: "x", ...route } as ModelRoute,
  model,
  createdAt: 0,
});

describe("fal poll: structured results", () => {
  const meta = { statusUrl: "https://queue.fal.run/fal-ai/x/requests/r1/status", responseUrl: "https://queue.fal.run/fal-ai/x/requests/r1" };

  it("returns a transcript as a text output instead of failing with 'No media in response'", async () => {
    const result = { text: "Hello world.", language_code: "en", words: [{ text: "Hello", start: 0, end: 0.4, type: "word" }, { text: "world.", start: 0.5, end: 0.9, type: "word" }] };
    const { result: r } = await withFetch({ [meta.statusUrl]: { status: "COMPLETED" }, [meta.responseUrl]: result }, () =>
      falProvider.poll(ctx({ op: "transcribe", endpoint: "fal-ai/elevenlabs/speech-to-text/scribe-v2" }, meta)),
    );
    expect(r).toMatchObject({
      state: "succeeded",
      outputs: [{ kind: "text", contentType: "text/plain", text: "Hello world.", meta: { language: "en", cues: [{ start: 0, end: 0.9, text: "Hello world." }] } }],
    });
    if (r.state === "succeeded") expect(r.outputs[0].url).toMatch(/^data:text\/plain;base64,/);
  });

  it("keeps Seedream layer names, z order and boxes", async () => {
    const result = {
      layers: [
        { image: { url: "https://v3.fal.media/files/base.png", content_type: "image/png" }, z_index: 0 },
        { image: { url: "https://v3.fal.media/files/cat.png", content_type: "image/png" }, z_index: 1, name: "Cat", bounding_box: { absolute: [10, 20, 110, 220] } },
      ],
      images: [{ url: "https://v3.fal.media/files/base.png" }, { url: "https://v3.fal.media/files/cat.png" }],
    };
    const { result: r } = await withFetch({ [meta.statusUrl]: { status: "COMPLETED" }, [meta.responseUrl]: result }, () =>
      falProvider.poll(ctx({ op: "layers", endpoint: "bytedance/seedream/v5/pro/layerize" }, meta)),
    );
    expect(r).toMatchObject({ state: "succeeded", outputs: [{ meta: { name: "Background", z: 0 } }, { meta: { name: "Cat", z: 1, bbox: [10, 20, 100, 200] } }] });
  });

  it("still fails when the response holds neither media nor text", async () => {
    const { result: r } = await withFetch({ [meta.statusUrl]: { status: "COMPLETED" }, [meta.responseUrl]: { seed: 1 } }, () => falProvider.poll(ctx({ op: "t2i" }, meta)));
    expect(r).toMatchObject({ state: "failed", error: expect.stringMatching(/No media in response/) });
  });
});

describe("Replicate poll: structured results", () => {
  it("reads an object output (Scribe) as the result and URL lists in order (Qwen layers)", async () => {
    const url = "https://api.replicate.com/v1/predictions/req-1";
    const scribe = { status: "succeeded", output: { text: "Hi.", language_code: "en", language_probability: 1, words: [{ text: "Hi.", start: 0, end: 0.3, type: "word" }] } };
    const { result: a } = await withFetch({ [url]: scribe }, () => replicateProvider.poll(ctx({ op: "transcribe", provider: "replicate", endpoint: "elevenlabs/scribe-v2" })));
    expect(a).toMatchObject({ state: "succeeded", outputs: [{ kind: "text", text: "Hi." }] });
    const layered = { status: "succeeded", output: ["https://replicate.delivery/a/0.webp", "https://replicate.delivery/a/1.webp"] };
    const { result: b } = await withFetch({ [url]: layered }, () => replicateProvider.poll(ctx({ op: "layers", provider: "replicate", endpoint: "qwen/qwen-image-layered" })));
    expect(b).toMatchObject({ state: "succeeded", outputs: [{ meta: { z: 0 } }, { meta: { z: 1 } }] });
  });
});
