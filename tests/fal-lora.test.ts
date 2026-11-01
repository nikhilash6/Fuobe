import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import { loraEntry, loraRef, fitLoras, loraFields, cloudPath, lorasFit } from "@/lib/catalog/loras";
import { buildPayload, numFramesValue } from "@/lib/catalog/payload";
import { estimateCost } from "@/lib/catalog/plan";
import type { GenInput, LoraRef, ModelRoute } from "@/lib/catalog/types";

// The fal adapter reads its key from the settings table: a throwaway database.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-fal-lora-"));
process.env.FUOBE_DATA_DIR = dir;
const { falProvider } = await import("@/server/providers/fal");
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Submit through the fal adapter and return the URL and JSON body it posted. */
async function submit(route: ModelRoute, input: GenInput): Promise<{ url: string; body: Record<string, unknown> }> {
  const real = globalThis.fetch;
  let seen: { url: string; body: Record<string, unknown> } | undefined;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen = { url: String(url), body: JSON.parse(String(init?.body ?? "{}")) };
    return new Response(JSON.stringify({ request_id: "r1", status_url: "s", response_url: "r", cancel_url: "c" }), { status: 200 });
  }) as typeof fetch;
  try {
    await falProvider.submit({ generationId: "g", model: getModel("wan-2-2-a14b-cloud")!, route, input });
  } finally {
    globalThis.fetch = real;
  }
  return seen!;
}

const route = (modelId: string, op: string, provider = "fal") => {
  const r = getModel(modelId)?.routes.find((x) => x.op === op && x.provider === provider);
  if (!r) throw new Error(`${modelId} has no ${provider} ${op} route`);
  return r;
};

const hf = (file: string, extra: Partial<LoraRef> = {}): LoraRef => ({ file, url: `https://huggingface.co/a/b/resolve/main/${file}`, strength: 1, ...extra });

describe("fal LoRA payloads (generated FieldMap.loras)", () => {
  it("sends transformer per file on Wan 2.2: the high/low pair on its experts, Wan 2.1 and single-file LoRAs on both", async () => {
    // The Overhead motion: a civitai high/low-noise pair, mirrored for the cloud.
    const overhead = ["civitai-2126493-camera-tilt-up-overhead", "civitai-2126538-camera-tilt-up-overhead"].map((k) => {
      const e = loraEntry(k)!;
      return { ...loraRef(e), hostedUrl: `https://v3.fal.media/files/${e.version}.safetensors` };
    });
    const wan21 = hf("squish_18.safetensors", { target: "both", strength: 0.8 });
    const trained = { file: "", url: "https://v3.fal.media/files/me.safetensors", strength: 6, weightName: "me.safetensors" };
    const r = route("wan-2-2-a14b-cloud", "i2v");
    const { url, body } = await submit(r, { prompt: "a cat", images: ["https://x/cat.png"], duration: 5, loras: [...overhead, wan21, trained] });
    expect(url).toBe("https://queue.fal.run/fal-ai/wan/v2.2-a14b/image-to-video/lora");
    expect(body.loras).toEqual([
      { path: overhead[0].hostedUrl, scale: 1, transformer: "high" },
      { path: overhead[1].hostedUrl, scale: 1, transformer: "low" },
      { path: wan21.url, scale: 0.8, transformer: "both" },
      // Scales stay inside the API's 0–4; weight_name goes with the item.
      { path: trained.url, scale: 4, transformer: "both", weight_name: "me.safetensors" },
    ]);
    // 16 fps, no doubled frames (fal interpolates to 32 fps by default), and 5 s = 81 frames (4n+1).
    expect(body.interpolator_model).toBe("none");
    expect(body.num_frames).toBe(81);
  });

  it("keeps the base endpoint and sends no loras when the run has none", async () => {
    const { url, body } = await submit(route("wan-2-2-a14b-cloud", "t2v"), { prompt: "a cat", duration: 10 });
    expect(url).toBe("https://queue.fal.run/fal-ai/wan/v2.2-a14b/text-to-video");
    expect(body.loras).toBeUndefined();
    expect(body.num_frames).toBe(161);
  });

  it("cuts to the API's maximum (3 on Z-Image) and says which LoRA it left out", async () => {
    const r = route("z-image-turbo-cloud", "t2i");
    expect(r.map?.loras).toMatchObject({ shape: "items", key: "loras", max: 3 });
    const four = ["awportrait", "lenovo", "grainscape", "realism"].map((k) => loraRef(loraEntry(k)!));
    const fitted = fitLoras(four, r);
    expect(fitted.loras.map((l) => l.file)).toEqual(four.slice(0, 3).map((l) => l.file));
    expect(fitted.notes).toEqual(["This API takes up to 3 LoRAs, so suayptalha Z-Image-Turbo Realism is left out"]);
    const { url, body } = await submit(r, { prompt: "portrait", loras: fitted.loras });
    expect(url).toBe("https://queue.fal.run/fal-ai/z-image/turbo/lora");
    expect(body.loras).toEqual(four.slice(0, 3).map((l) => ({ path: l.url, scale: l.strength })));
    // Even unfitted, the payload never carries more than the API takes.
    expect((loraFields(r.map!.loras!, four).loras as unknown[]).length).toBe(3);
  });

  it("sends a LoRA licensed for the GPU only and says so; one kept on the GPU (the admin's switch) is dropped", () => {
    const r = route("wan-2-2-a14b-cloud", "i2v");
    const wiggle = loraRef(loraEntry("civitai-2490836-wiggle-redmond")!);
    expect(wiggle.licence?.hostedOk).toBe(false);
    const keep = hf("squish_18.safetensors", { target: "both" });
    const sent = fitLoras([wiggle, keep], r);
    expect(sent.loras).toEqual([wiggle, keep]);
    expect(sent.notes[0]).toMatch(/^Wiggle Redmond: its licence allows your GPU only/);
    expect(loraFields(r.map!.loras!, [{ ...wiggle, hostedUrl: "https://v3.fal.media/x" }])).toMatchObject({ loras: [{ path: "https://v3.fal.media/x" }] });
    // Settings → Models & licences keeps GPU-only LoRAs on the GPU: the run's LoRAs come marked.
    const kept = fitLoras([{ ...wiggle, keepOnGpu: true }, keep], r);
    expect(kept.loras).toEqual([keep]);
    expect(kept.notes[0]).toMatch(/^Wiggle Redmond is licensed for your GPU only and Settings → Models & licences keeps such LoRAs off the cloud/);
    // Defensively, the payload drops it too.
    expect(loraFields(r.map!.loras!, [{ ...wiggle, keepOnGpu: true, hostedUrl: "https://v3.fal.media/x" }])).toEqual({});
    // The open engine carries every LoRA.
    expect(fitLoras([{ ...wiggle, keepOnGpu: true }, keep], { provider: "comfyui" }).loras).toHaveLength(2);
    // A route that takes no LoRAs says only that: the licence note is for LoRAs a run really sends.
    const none = fitLoras([wiggle], { provider: "fal", map: {} });
    expect(none).toEqual({ loras: [], notes: ["This model takes no LoRAs in the cloud, so Wiggle Redmond is left out"] });
  });

  it("never sends a civitai URL (the user's key stays home): only its mirror", () => {
    const y2k = loraRef(loraEntry("y2k")!);
    expect(cloudPath(y2k)).toBeUndefined();
    expect(cloudPath({ ...y2k, hostedUrl: "https://v3.fal.media/files/y2k.safetensors" })).toBe("https://v3.fal.media/files/y2k.safetensors");
    const map = route("z-image-turbo-cloud", "t2i").map!;
    expect(buildPayload(map, { prompt: "p", loras: [y2k] }).loras).toBeUndefined();
    // A gated Hugging Face file can't be fetched by fal either: it goes as Fuobe's mirror (src/server/loras.ts).
    expect(cloudPath(loraRef(loraEntry("ltx-2-3-22b-ic-lora-relight-1-0")!))).toBeUndefined();
  });

  it("always sends at least one LoRA to LTX-2.3's /lora endpoints, which require the list", async () => {
    const r = route("ltx-2-3-22b-cloud", "i2v");
    expect(r.map?.loras).toMatchObject({ shape: "items", required: true });
    const fpv = loraRef(loraEntry("ltx2-3-fpv-motion")!);
    expect(fpv.url).toMatch(/^https:\/\/huggingface\.co\//);
    const withOne = await submit(r, { prompt: "fly", images: ["https://x/a.png"], duration: 5, loras: [{ ...fpv, hostedUrl: fpv.url }] });
    expect(withOne.url).toBe("https://queue.fal.run/fal-ai/ltx-2.3-22b/image-to-video/lora");
    expect((withOne.body.loras as unknown[]).length).toBeGreaterThanOrEqual(1);
    // Prompt expansion would rewrite the prompt; 5 s at 24 fps = 121 frames (8n+1).
    expect(withOne.body.enable_prompt_expansion).toBe(false);
    expect(withOne.body.num_frames).toBe(121);
    // No LoRA left (all kept on the GPU by the admin's switch): the plain endpoint, never an empty required list.
    const none = await submit(r, { prompt: "fly", images: ["https://x/a.png"], loras: [{ ...fpv, keepOnGpu: true, licence: { ...fpv.licence!, hostedOk: false } }] });
    expect(none.url).toBe("https://queue.fal.run/fal-ai/ltx-2.3-22b/image-to-video");
    expect(none.body.loras).toBeUndefined();
    // A route that is only the /lora endpoint refuses to run without one.
    const bare = { ...r, endpoint: "fal-ai/ltx-2.3-22b/image-to-video/lora", loraEndpoint: undefined };
    await expect(submit(bare, { prompt: "fly", images: ["https://x/a.png"] })).rejects.toThrow(/needs at least one LoRA/);
  });

  it("prices a run with LoRAs at the LoRA endpoint's rate", () => {
    const z = getModel("z-image-turbo-cloud")!;
    expect(z.pricing).toMatchObject({ unit: "megapixel", usd: 0.005, withLoras: 0.0085 });
    expect(estimateCost(z, {}, 1, "t2i")).toBe(0.005);
    expect(estimateCost(z, {}, 1, "t2i", true)).toBe(0.009);
    const wan = getModel("wan-2-2-a14b-cloud")!;
    expect(estimateCost(wan, { duration: 5, resolution: "480p" }, 1, "i2v")).toBe(0.2);
    expect(estimateCost(wan, { duration: 5, resolution: "480p" }, 1, "i2v", true)).toBe(0.5);
  });

  it("keeps frame counts in the 4n+1 / 8n+1 form inside the API's limits", () => {
    const f = { key: "num_frames", fps: 16, min: 17, max: 161, step: 4 };
    expect(numFramesValue(f, { duration: 5 })).toBe(81);
    expect(numFramesValue(f, { duration: 0.5 })).toBe(17);
    expect(numFramesValue(f, { duration: 30 })).toBe(161);
    expect(numFramesValue({ key: "num_frames", fps: 24, min: 9, max: 481, step: 8 }, { duration: 3 })).toBe(73);
  });

  it("fits a Mix on fal's Wan 2.2 but not on Replicate's one LoRA per expert", () => {
    const two = [hf("a.safetensors", { target: "high" }), hf("b.safetensors", { target: "high" })];
    expect(lorasFit(route("wan-2-2-a14b-cloud", "i2v"), two)).toBe(true);
    expect(lorasFit(route("wan-2-2-a14b-cloud", "i2v", "replicate"), two)).toBe(false);
    expect(lorasFit(route("wan-2-2-a14b-cloud", "i2v", "replicate"), [two[0], hf("c.safetensors", { target: "low" })])).toBe(true);
  });

  it("LTX-2.3 extend adds the length picked (at the clip's frame rate); video-to-video follows the clip", async () => {
    const extend = route("ltx-2-3-22b-cloud", "extend");
    // 10 s added to a 4 s, 30 fps clip: 300 frames, kept at 8n+1. The clip keeps its own size (no video_size).
    const a = await submit(extend, { prompt: "go on", video: "https://x/clip.mp4", duration: 10, sourceDuration: 4, sourceFps: 30 });
    expect(a.url).toBe("https://queue.fal.run/fal-ai/ltx-2.3-22b/extend-video");
    expect(a.body).toMatchObject({ num_frames: 297, video_url: "https://x/clip.mp4", enable_prompt_expansion: false });
    expect(a.body.video_size).toBeUndefined();
    // No frame rate known: fal's 24 fps.
    expect((await submit(extend, { prompt: "go on", video: "https://x/clip.mp4", duration: 5 })).body.num_frames).toBe(121);
    const v2v = await submit(route("ltx-2-3-22b-cloud", "v2v"), { prompt: "restyle", video: "https://x/clip.mp4", duration: 10, sourceDuration: 4 });
    expect(v2v.body.num_frames).toBe(97);
  });

  it("uploads a mirrored LoRA to fal storage under its own name, so its URL ends in .safetensors", async () => {
    const { setSetting } = await import("@/server/settings");
    setSetting("falKey", "id:secret");
    const real = globalThis.fetch;
    const calls: { url: string; method: string; body?: unknown }[] = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      if (u.includes("/storage/upload/initiate")) {
        const name = (calls.at(-1)!.body as { file_name: string }).file_name;
        return Response.json({ upload_url: `https://upload.example/${name}?sig=1`, file_url: `https://v3b.fal.media/files/b/x/${name}` });
      }
      return new Response("", { status: 200 });
    }) as typeof fetch;
    try {
      const url = await falProvider.prepareFile(Buffer.from("weights"), "application/octet-stream", "civitai-3422541-y2k.safetensors");
      expect(url).toBe("https://v3b.fal.media/files/b/x/civitai-3422541-y2k.safetensors");
      expect(calls[0].body).toMatchObject({ file_name: "civitai-3422541-y2k.safetensors", content_type: "application/octet-stream" });
      // A name that isn't a plain file name falls back to fal's own (time + type).
      await falProvider.prepareFile(Buffer.from("png"), "image/png", "../../etc/passwd");
      expect((calls.at(-2)!.body as { file_name: string }).file_name).toMatch(/^\d+\.png$/);
    } finally {
      globalThis.fetch = real;
    }
  });
});
