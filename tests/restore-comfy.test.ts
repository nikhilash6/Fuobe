import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { onEngine } from "@/lib/catalog/engines";
import { loraEntry, loraRef } from "@/lib/catalog/loras";
import { buildPayload } from "@/lib/catalog/payload";
import { planGeneration } from "@/lib/catalog/plan";
import { planRestore, RESTORE, restoreNegative } from "@/lib/catalog/restore";
import type { GenInput } from "@/lib/catalog/types";
import type { MediaInfo } from "@/lib/media-probe";

// Restore & colourise through the ComfyUI provider (the library graph video-restore-ltx25-tiled, bound for real) and
// through fal's payload builder (the cloud half's FieldMap from the research).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-restore-comfy-"));
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow } = await import("@/server/providers/comfyui");
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const scan: MediaInfo = { container: "mp4", hasVideo: true, hasAudio: true, duration: 545 / 24, videoDuration: 545 / 24, width: 640, height: 480, fps: 24, frames: 545 };
const at = (wf: Record<string, { inputs: Record<string, unknown> }>, node: string, input: string) => wf[node]?.inputs[input];
const ctx = (media: Record<string, MediaInfo>) => ({ generationId: "g1", op: "restore-video" as const, upload: async (_d: Buffer, _t: string, name: string) => `up_${name}`, media: (n: string) => media[n] });
const plan = planRestore({ engine: "open", title: "Restored", source: { url: "/api/files/scan.mp4", duration: scan.duration, fps: 24, width: 640, height: 480, frames: 545, hasAudio: true }, prompt: "a station in 1896, natural colour", negative: restoreNegative(), seed: 5 });

describe("Restore & colourise on the GPU, through the provider", () => {
  it("the first window: its frames from the scan, the canvas, the Restore LoRA, 960x544 tiles; no prefix, no reference, no field", async () => {
    const req = plan.steps.find((s) => s.key === "restore0")!.request;
    const { workflow: wf } = await prepareWorkflow(RESTORE.workflow, { prompt: req.prompt, negativePrompt: req.negativePrompt, video: "scan.mp4", ...req.params } as GenInput, ctx({ "scan.mp4": scan }));
    expect(at(wf, "source", "video")).toBe("scan.mp4");
    expect(at(wf, "source", "skip_first_frames")).toBe(0);
    expect(at(wf, "source", "frame_load_cap")).toBe(97);
    expect(at(wf, "empty", "length")).toBe(97);
    expect([at(wf, "canvas", "width"), at(wf, "canvas", "height"), at(wf, "empty", "width"), at(wf, "empty", "height")]).toEqual([1440, 1088, 1440, 1088]);
    expect(at(wf, "canvas", "image")).toEqual(["source", 0]);
    expect(at(wf, "canvas", "upscale_method")).toBe("lanczos");
    expect(at(wf, "lora", "lora_name")).toBe(RESTORE.loras.restore.file);
    expect(at(wf, "lora", "strength_model")).toBe(1);
    expect(at(wf, "sample", "tile_width")).toBe(960);
    expect(at(wf, "sample", "tile_height")).toBe(544);
    expect(at(wf, "sample", "overlap_frac")).toBe(0.5);
    expect(at(wf, "sample", "cfg")).toBe(1);
    expect(at(wf, "sample", "seed")).toBe(5);
    expect(at(wf, "sample", "tile_frames")).toBe(0);
    expect(at(wf, "guide", "use_streaming")).toBe(false);
    expect(at(wf, "sigmas", "sigmas")).toBe(RESTORE.sigmas.map(String).join(", ").replace(/^1, /, "1.0, ").replace(/, 0$/, ", 0.0"));
    expect(at(wf, "positive", "text")).toBe("a station in 1896, natural colour");
    expect(at(wf, "negative", "text")).toBe(restoreNegative());
    expect([at(wf, "conditioning", "frame_rate"), at(wf, "video", "fps")]).toEqual([24, 24]);
    expect(at(wf, "keep", "batch_index")).toBe(0);
    for (const gone of ["prefix", "prefix_source", "reference", "reference_fit", "reference_guide", "field"]) expect(wf[gone], gone).toBeUndefined();
    expect(at(wf, "sample", "positive")).toEqual(["guide", 0]);
    // Silent: the pipeline puts the scan's own sound back after the join.
    expect(at(wf, "video", "audio")).toBeUndefined();
  });

  it("a later window: the window before's output as the prefix (its last 17 frames), dropped again from this window's output", async () => {
    const step = plan.steps.find((s) => s.key === "restore2")!;
    const prev: MediaInfo = { container: "mp4", hasVideo: true, hasAudio: false, duration: 80 / 24, videoDuration: 80 / 24, width: 1440, height: 1088, fps: 24, frames: 80 };
    const { workflow: wf } = await prepareWorkflow(
      RESTORE.workflow,
      { prompt: step.request.prompt, video: "scan.mp4", videos: ["prev.mp4"], ...step.request.params } as GenInput,
      ctx({ "scan.mp4": scan, "prev.mp4": prev }),
    );
    expect(at(wf, "source", "skip_first_frames")).toBe(160);
    expect(at(wf, "prefix_source", "video")).toBe("prev.mp4");
    expect(at(wf, "prefix_source", "skip_first_frames")).toBe(63);
    expect(at(wf, "prefix_source", "frame_load_cap")).toBe(17);
    expect(at(wf, "prefix", "frame_idx")).toBe(0);
    expect(at(wf, "keep", "batch_index")).toBe(17);
    expect(at(wf, "sample", "positive")).toEqual(["prefix", 0]);
    expect(at(wf, "sample", "latents")).toEqual(["prefix", 2]);
  });

  it("a reference picture and deinterlacing keep their branches; a whole clip past 97 frames streams in the sampler's own windows", async () => {
    const short: MediaInfo = { ...scan, frames: 49, duration: 49 / 24, videoDuration: 49 / 24 };
    const { workflow: wf } = await prepareWorkflow(
      RESTORE.workflow,
      { video: "short.mp4", images: ["ref.png"], extra: { deinterlace: true } } as GenInput,
      ctx({ "short.mp4": short }),
    );
    expect(at(wf, "reference", "image")).toBe("ref.png");
    expect(at(wf, "reference_guide", "frame_idx")).toBe(-1);
    expect(at(wf, "sample", "positive")).toEqual(["reference_guide", 0]);
    expect(at(wf, "field", "image")).toEqual(["source", 0]);
    expect([at(wf, "field", "width"), at(wf, "field", "height"), at(wf, "field", "upscale_method")]).toEqual([640, 240, "nearest-exact"]);
    expect(at(wf, "canvas", "image")).toEqual(["field", 0]);
    expect(at(wf, "source", "frame_load_cap")).toBe(49);
    const long: MediaInfo = { ...scan, frames: 300, duration: 12.5, videoDuration: 12.5 };
    const { workflow: s } = await prepareWorkflow(RESTORE.workflow, { video: "long.mp4" } as GenInput, ctx({ "long.mp4": long }));
    expect([at(s, "guide", "use_streaming"), at(s, "sample", "tile_frames"), at(s, "source", "frame_load_cap")]).toEqual([true, 97, 297]);
    await expect(prepareWorkflow(RESTORE.workflow, { video: "scan.mp4" } as GenInput, ctx({ "scan.mp4": scan }))).rejects.toThrow(/Video tools → Restore & colourise/);
  });

  it("stage 2: the Detail Refine LoRA with 1024x576 tiles on twice the canvas", async () => {
    const restored: MediaInfo = { container: "mp4", hasVideo: true, hasAudio: false, duration: 545 / 24, videoDuration: 545 / 24, width: 1440, height: 1088, fps: 24, frames: 545 };
    const { workflow: wf } = await prepareWorkflow(
      RESTORE.workflow,
      { video: "restored.mp4", extra: { stage: "refine", windowStart: 97, windowFrames: 89, prefixFrames: 0, canvasWidth: 2880, canvasHeight: 2176 } } as GenInput,
      ctx({ "restored.mp4": restored }),
    );
    expect(at(wf, "lora", "lora_name")).toBe(RESTORE.loras.refine.file);
    expect([at(wf, "sample", "tile_width"), at(wf, "sample", "tile_height")]).toEqual([1024, 576]);
    expect([at(wf, "canvas", "width"), at(wf, "canvas", "height")]).toEqual([2880, 2176]);
    expect([at(wf, "source", "skip_first_frames"), at(wf, "source", "frame_load_cap")]).toEqual([97, 89]);
  });
});

describe("Restore & colourise in the cloud: fal's payload", () => {
  it("the scan as the reference video, the Restore LoRA by its mirror, fal's own IC-LoRA and preprocessor off, the tier's size", () => {
    const m = getModel("fuobe-restore")!;
    const cloud = onEngine(m, "cloud");
    const p = planGeneration(
      { feature: "restore", modelId: m.id, op: "restore-video", prompt: "a station in 1896, natural colour", inputs: { video: "https://x/piece.mp4", images: ["https://x/last.png"] }, params: { aspectRatio: "4:3", resolution: "1080p", fps: 24, duration: 97 / 24 } },
      (id) => (id === m.id ? cloud : getModel(id)),
      getPreset,
    );
    expect(p.loras.map((l) => l.file)).toEqual([RESTORE.loras.restore.file]);
    const route = cloud.routes.find((r) => r.op === "restore-video")!;
    const lora = { ...loraRef(loraEntry(RESTORE.loras.restore.key)!), hostedUrl: "https://v3.fal.media/files/restore.safetensors" };
    const body = buildPayload(route.map!, { ...p.params, prompt: p.prompt, video: "https://x/piece.mp4", images: ["https://x/last.png"], loras: [lora] });
    expect(body).toMatchObject({
      prompt: "a station in 1896, natural colour",
      video_url: "https://x/piece.mp4",
      image_url: "https://x/last.png",
      video_size: { width: 1440, height: 1088 },
      ic_lora_type: "none",
      preprocessor: "none",
      generate_audio: false,
      enable_prompt_expansion: false,
      match_video_length: true,
      match_input_fps: true,
      loras: [{ path: "https://v3.fal.media/files/restore.safetensors", scale: 1 }],
    });
    expect(String(body.negative_prompt)).toContain("modern cars");
    // The gated file is never sent as its Hugging Face URL.
    expect(JSON.stringify(body)).not.toContain("huggingface.co");
  });
});
