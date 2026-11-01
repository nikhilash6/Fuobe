import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Generation, GenInput, OutputFile } from "@/lib/catalog/types";
import type { MediaInfo } from "@/lib/media-probe";

// Open-H3 Regenerate 2K (package n7-3-regenerate-2k): the library graph, the model, the provider's strings and frames,
// the 15 s parts, the draft preset by source, the result actions per source and engine, the cloud re-render at 2K,
// the Canvas choice, the board row, the licences and the install pins.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-regenerate-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
delete process.env.FUOBE_PASSWORD;

const R = await import("@/lib/catalog/regenerate");
const { getModel, getPreset, MODELS } = await import("@/lib/catalog");
const { planGeneration: planWith, estimateCost } = await import("@/lib/catalog/plan");
const planGeneration = (r: Parameters<typeof planWith>[0]) => planWith(r, getModel, getPreset);
const { outputActions, nextSteps } = await import("@/lib/output-actions");
const { showsPrompt, HANDOFF_PARAMS } = await import("@/lib/composer");
const canvas = await import("@/lib/catalog/canvas");
const { UPSCALE_FIRST_STEPS } = await import("@/lib/catalog/upscale-first");
const { VIDEO_UPSCALE_STUDIO } = await import("@/lib/studios");
const { NODE_PACKS } = await import("@/lib/licences");
const { prepareWorkflow, getWorkflow, promptRefusal, onOwnGpu } = await import("@/server/providers/comfyui");
const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { clipMaker, regenSwitchedOff } = await import("@/server/regenerate");
const { saveFile } = await import("@/server/storage");
const { runAsTenant } = await import("@/server/tenant");
const { db } = await import("@/server/db");
const { STUDIO_ROWS, studioTool, modelTool } = await import("@/server/gpu/tools");
const { buildPayload } = await import("@/lib/catalog/payload");
const { readAccess, saveAccess } = await import("@/server/model-access");

/** A tiny MP4 header `seconds` long (ftyp + moov with one `width`×`height` video trak), enough for the server's header read. */
function mp4(seconds: number, width = 1280, height = 720): Buffer {
  const box = (type: string, ...body: Buffer[]) => {
    const data = Buffer.concat(body);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + data.length);
    head.write(type, 4, "latin1");
    return Buffer.concat([head, data]);
  };
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(seconds * 1000, 16);
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(0x10000, 40);
  tkhd.writeUInt32BE(0x10000, 56);
  tkhd.writeUInt32BE(width << 16, 76);
  tkhd.writeUInt32BE(height << 16, 80);
  const mdhd = Buffer.alloc(24);
  mdhd.writeUInt32BE(1000, 12);
  mdhd.writeUInt32BE(seconds * 1000, 16);
  const hdlr = Buffer.alloc(24);
  hdlr.write("vide", 8, "latin1");
  const trak = box("trak", box("tkhd", tkhd), box("mdia", box("mdhd", mdhd), box("hdlr", hdlr)));
  return Buffer.concat([box("ftyp", Buffer.from("isom\0\0\0\0isomiso2mp41", "latin1")), box("moov", box("mvhd", mvhd), trak)]);
}
const stored = (seconds: number, width?: number, height?: number) =>
  saveFile({ data: mp4(seconds, width, height), contentType: "video/mp4", name: `regen-${seconds}-${width ?? 1280}x${height ?? 720}.mp4`, source: "upload" }).url;

beforeAll(() => setSetting("demoMode", "auto"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const ROOT = path.resolve(__dirname, "..");
const graph = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows/comfyui/video-regenerate-h3.json"), "utf8")) as Record<
  string,
  { class_type: string; inputs: Record<string, unknown> }
>;
const at = (wf: Record<string, { inputs: Record<string, unknown> }>, node: string, input: string) => wf[node]?.inputs[input];
const clip = (w: number, h: number, seconds: number): MediaInfo => ({
  container: "mp4",
  hasVideo: true,
  hasAudio: true,
  duration: seconds,
  videoDuration: seconds,
  width: w,
  height: h,
  fps: 24,
  frames: Math.round(seconds * 24),
});
const prepare = (input: Partial<GenInput>, media: Record<string, MediaInfo> = {}) =>
  prepareWorkflow(
    R.REGEN_WORKFLOW,
    {
      prompt: "a fox in the snow, slow push-in",
      video: "draft.mp4",
      resolution: "1440p",
      seed: 3,
      ...input,
    } as GenInput,
    {
      generationId: "g1",
      op: "upscale-video",
      upload: async (_d, _t, name) => `up_${name}`,
      media: (n) => media[n],
    },
  );

describe("the library graph video-regenerate-h3", () => {
  const { manifest } = getWorkflow(R.REGEN_WORKFLOW);

  it("is rdh's Draft Video graph without the prompt server, the previews and the note, curve branches off, the saved latent kept", () => {
    const classes = Object.values(graph).map((n) => n.class_type);
    for (const gone of ["OpenH3VideoToPrompt", "PreviewAny", "MarkdownNote", "Note"]) expect(classes, gone).not.toContain(gone);
    expect(at(graph, "3", "curve_name")).toBe("none");
    expect(at(graph, "3", "lora_name")).toBe("open_h3_regenerate_2k_lora.safetensors");
    expect(at(graph, "2", "unet_name")).toBe("minimax_h3_fl2va_pruned_int8_convrot.safetensors");
    expect(graph["24"].class_type).toBe("OpenH3SaveRefinedLatent");
    expect(at(graph, "25", "samples")).toEqual(["24", 0]);
    // The prompt is the node's own text: no server call inside the graph.
    expect(typeof at(graph, "16", "text")).toBe("string");
    // Save Refined Latent and Finish read Prepare Draft's frame count; the frames are bound on node 11 only.
    expect(at(graph, "24", "frame_count")).toEqual(["11", 1]);
    expect(at(graph, "26", "frame_count")).toEqual(["11", 1]);
    expect(at(graph, "27", "audio")).toEqual(["26", 1]);
  });

  it("binds the clip, words, size, draft, frames, start noise, steps, seed and the window to the pack's own inputs", () => {
    const b = manifest.bindings;
    expect(b.video).toEqual([{ node: "9", input: "file" }]);
    expect(b.prompt).toEqual([{ node: "16", input: "text" }]);
    expect(b.resolution).toEqual([{ node: "17", input: "resolution" }]);
    expect(b.draftSize).toEqual([{ node: "11", input: "size" }]);
    expect(b.frames).toEqual([{ node: "11", input: "max_frames" }]);
    expect(b.startSigma).toEqual([{ node: "19", input: "start_sigma" }]);
    expect(b.steps).toEqual([{ node: "19", input: "steps" }]);
    expect(b.seed).toEqual([{ node: "20", input: "noise_seed" }]);
    expect(b.startTime).toEqual([{ node: "29", input: "start_time" }]);
    expect(b.duration).toEqual([{ node: "29", input: "duration" }]);
    expect(manifest).toMatchObject({
      capability: "upscale-video",
      vramGb: 48,
      validated: false,
      limits: { maxFrames: 360 },
    });
    expect(manifest.customNodes).toEqual([
      {
        name: "ComfyUI-Open-H3-Regenerate",
        repo: "https://github.com/rdh9616/ComfyUI-Open-H3-Regenerate/tree/9b686c5ffd380e9d1351f9b8beef6d20d703ca3e",
      },
      {
        name: "Comfyui_Minimax_h3_latent_Upscaler",
        repo: "https://github.com/LBH-123-AI/Comfyui_Minimax_h3_latent_Upscaler/tree/40316cf008b2fd8663263270669eb4da23f89d2c",
      },
    ]);
    const files = manifest.models.map((m) => `${m.folder}/${m.file}`);
    expect(files).toEqual(
      expect.arrayContaining([
        "loras/open_h3_regenerate_2k_lora.safetensors",
        "vae/fast_h3_vae_noncausal_24l.safetensors",
        "latent_upscale_models/minimax_h3_latent_upscaler_3d_conv_v1_bf16.safetensors",
        "diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors",
      ]),
    );
    // No curve file, and the curve table is never read (no 21 GB ref2va file needed).
    expect(files.some((f) => /sharp_curve|ref2va/.test(f))).toBe(false);
    for (const m of manifest.models.filter((x) => /open_h3|fast_h3|latent_upscaler/.test(x.file)))
      expect(m.url, m.file).toContain("/resolve/5809c33730c18b6b1c827b40974855a4288641b3/");
    expect(manifest.license).toMatch(/MiniMax H3 Community License[^·]*EXCLUDES the US, the EU, the UK and South Korea/);
    expect(manifest.notes).toMatch(/about 3 min per 5 s at 2K on a 72 GB RTX PRO 5000.*22 s on a B200.*1080p on 32 GB with a lossy LoRA/);
  });

  it("pins the new files with their SHA-256 for the GPU pre-flight, and both packs", () => {
    const pins = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows/comfyui/model-pins.json"), "utf8")) as Record<string, { sizeBytes: number; sha256: string }>;
    const pin = (f: string) => Object.entries(pins).find(([u]) => u.endsWith(f))?.[1];
    expect(pin("open_h3_regenerate_2k_lora.safetensors")).toMatchObject({
      sizeBytes: 12452449080,
      sha256: "8e36a0912ab72f7f3b00f41e3c7c97c7dfdec21e66c88ab22f08b9b0c681bb04",
    });
    expect(pin("fast_h3_vae_noncausal_24l.safetensors")).toMatchObject({
      sizeBytes: 6471256328,
      sha256: "8658f1e85b5997c4ba716406a2f148bfa36cf97d4d5fcd402c7bd341f54e77a1",
    });
    expect(pin("minimax_h3_latent_upscaler_3d_conv_v1_bf16.safetensors")).toMatchObject({
      sizeBytes: 690592992,
      sha256: "4f57821f5837f32f7142b67d815606dbd7550f194e5c769f7d6c3f83b146a5e6",
    });
    const packs = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows/comfyui/packs.json"), "utf8")) as Record<string, { commit: string }>;
    expect(packs["ComfyUI-Open-H3-Regenerate"].commit).toBe("9b686c5ffd380e9d1351f9b8beef6d20d703ca3e");
    expect(packs.Comfyui_Minimax_h3_latent_Upscaler.commit).toBe("40316cf008b2fd8663263270669eb4da23f89d2c");
    const req = JSON.parse(fs.readFileSync(path.join(ROOT, "workflows/comfyui/requirements.json"), "utf8")) as {
      workflows: Record<string, { packs: Record<string, string[]>; vramGb: number }>;
    };
    expect(Object.keys(req.workflows[R.REGEN_WORKFLOW].packs).sort()).toEqual(["ComfyUI-Open-H3-Regenerate", "Comfyui_Minimax_h3_latent_Upscaler"]);
  });

  it("install-comfyui.sh clones both packs at their commits, opt-in with OPEN_H3_REGEN=1, and adds nothing to the union line", () => {
    const sh = fs.readFileSync(path.join(ROOT, "scripts/comfy/install-comfyui.sh"), "utf8");
    expect(sh).toContain('OPEN_H3_REGEN_REF="${OPEN_H3_REGEN_REF:-9b686c5ffd380e9d1351f9b8beef6d20d703ca3e}"');
    expect(sh).toContain('H3_LATENT_UPSCALER_REF="${H3_LATENT_UPSCALER_REF:-40316cf008b2fd8663263270669eb4da23f89d2c}"');
    expect(sh).toMatch(/if \[ "\$\{OPEN_H3_REGEN:-0\}" = "1" \]; then/);
    expect(sh).toContain("https://github.com/rdh9616/ComfyUI-Open-H3-Regenerate");
    expect(sh).toContain("https://github.com/LBH-123-AI/Comfyui_Minimax_h3_latent_Upscaler");
    const union = sh.slice(sh.indexOf("# Union of the packs' requirements"), sh.indexOf("resampy s3tokenizer"));
    expect(union).not.toMatch(/\bav\b|safetensors/);
  });
});

describe("tiers, frames, windows and the draft preset", () => {
  it("maps Upscale's tiers onto the pack's strings, 2K by default", () => {
    expect(R.REGEN_RESOLUTION).toEqual({
      "1080p": "1080p (1920x1080)",
      "1440p": "2k (2560x1440)",
      "2160p": "4k (3840x2160)",
    });
    expect(R.regenResolution(undefined)).toBe("2k (2560x1440)");
    expect(R.regenResolution("720p")).toBe("2k (2560x1440)");
    // The pack's own combo values (copied from its INPUT_TYPES): the graph's defaults are among them.
    expect(Object.values(R.REGEN_RESOLUTION)).toContain(at(graph, "17", "resolution"));
    expect(Object.values(R.REGEN_DRAFT)).toEqual(["768p (1344x768)", "576p (1024x576)", "keep (snap to 32)"]);
  });

  it("reads the clip's seconds at 24 fps, at most 360 frames a pass", () => {
    expect(R.regenFrames(5)).toBe(120);
    expect(R.regenFrames(5.05)).toBe(121);
    expect(R.regenFrames(15)).toBe(360);
    expect(R.regenFrames(20)).toBe(360);
    expect(R.regenFrames(undefined)).toBe(360);
  });

  it("splits a clip over 15 s into equal parts of at most 15 s", () => {
    expect(R.regenWindows(5)).toEqual([{ start: 0, duration: 5 }]);
    expect(R.regenWindows(15)).toEqual([{ start: 0, duration: 15 }]);
    expect(R.regenWindows(20)).toEqual([
      { start: 0, duration: 10 },
      { start: 10, duration: 10 },
    ]);
    const forty = R.regenWindows(40);
    expect(forty).toHaveLength(3);
    for (const w of forty) expect(w.duration).toBeLessThanOrEqual(15);
    expect(forty[2].start + forty[2].duration).toBeCloseTo(40, 2);
  });

  it("takes 768p for H3 clips and 576p for other models, whatever the shape: results are 16:9 or 9:16, never stretched", () => {
    for (const id of ["oss-minimax-h3", "minimax-h3", "minimax-h3-max", "fuobe-character-swap", "oss-h3-swap-segment", "oss-h3-character-swap-relay", "h3-max-recast"])
      expect(R.isH3Source(id), id).toBe(true);
    for (const id of ["oss-ltx25", "oss-wan22-14b", "kling-3", "seedance-2-5", undefined]) expect(R.isH3Source(id), String(id)).toBe(false);
    expect(R.draftSizeFor({ fromH3: true })).toBe("768p (1344x768)");
    expect(R.draftSizeFor({ fromH3: false })).toBe("576p (1024x576)");
    // The pack's upscale always targets 16:9 (9:16 when taller than wide), so Prepare Draft's cover-crop decides the shape.
    expect([R.regenShape(1344, 768), R.regenShape(720, 1280), R.regenShape(768, 768), R.regenShape(640, 480), R.regenShape()]).toEqual(["16:9", "9:16", "16:9", "16:9", "16:9"]);
    expect([R.regenCrops(1280, 720), R.regenCrops(720, 1280), R.regenCrops(768, 768), R.regenCrops(640, 480), R.regenCrops(2560, 1080)]).toEqual([false, false, true, true, true]);
    expect(R.regenCropNote(1024, 1024)).toBe("Regenerate makes 16:9 video, so this 1024×1024 clip is cropped to 16:9 at the centre");
    expect(R.REGEN_COPY.shape).toMatch(/16:9.*9:16/);
  });
});

describe("the model oss-h3-regenerate", () => {
  const m = getModel(R.REGEN_MODEL)!;

  it("runs the graph on your GPU at 1080p, 2K or 4K (2K by default) and needs words", () => {
    expect(m).toMatchObject({
      engine: "open",
      name: "Open-H3 Regenerate",
      tagline: "Redraws a soft clip at 1080p, 2K or 4K. Details may change; motion and layout stay.",
      defaults: { resolution: "1440p" },
    });
    expect(m.routes).toEqual([
      expect.objectContaining({
        op: "upscale-video",
        provider: "comfyui",
        endpoint: R.REGEN_WORKFLOW,
      }),
    ]);
    expect(m.options.resolutions).toEqual(["1080p", "1440p", "2160p"]);
    expect(m.options.requires).toMatchObject({ prompt: true });
    expect(() =>
      planGeneration({
        feature: "upscale",
        modelId: m.id,
        inputs: { video: "/api/files/a.mp4" },
      }),
    ).toThrow(/describe what is in it/);
    // Nobody hosts it: no cloud route, so the cloud engine never runs it.
    expect(m.routes.every((r) => r.provider === "comfyui")).toBe(true);
    expect(MODELS.some((x) => x.engine === "cloud" && /regenerat/i.test(`${x.id} ${x.name}`))).toBe(false);
  });

  it("has Creativity (Close 0.7, Balanced 0.8 by default, More detail = the release 0.909) and Speed (3 or 2 steps)", () => {
    const [creativity, speed] = m.options.controls!;
    expect(creativity).toMatchObject({
      param: "creativity",
      default: "balanced",
      sets: {
        close: { startSigma: 0.7 },
        balanced: { startSigma: 0.8 },
        detail: { startSigma: 0 },
      },
    });
    expect(speed).toMatchObject({
      param: "speed",
      default: "standard",
      sets: { standard: { steps: 3 }, faster: { steps: 2 } },
    });
    const plan = planGeneration({
      feature: "upscale",
      modelId: m.id,
      prompt: "a fox",
      inputs: { video: "/api/files/a.mp4" },
      params: { extra: { creativity: "close", speed: "faster" } },
    });
    expect(plan.params.extra).toMatchObject({ startSigma: 0.7, steps: 2 });
    expect(estimateCost(m, plan.params, 1, "upscale-video")).toBe(0);
  });

  it("sits beside SeedVR2 in Upscale → Video, which shows the prompt box for it", () => {
    expect(VIDEO_UPSCALE_STUDIO.finishChoices!.map((c) => [c.modelId, c.label])).toEqual([
      ["oss-seedvr2", "Restore · faithful"],
      ["oss-h3-regenerate", "Regenerate · creative"],
    ]);
    expect(VIDEO_UPSCALE_STUDIO.hidePrompt).toBe(true);
    expect(
      showsPrompt(VIDEO_UPSCALE_STUDIO, {
        promptless: false,
        promptOptional: false,
        needsPrompt: true,
      }),
    ).toBe(true);
    expect(
      showsPrompt(VIDEO_UPSCALE_STUDIO, {
        promptless: false,
        promptOptional: false,
      }),
    ).toBe(false);
    expect(HANDOFF_PARAMS).toContain("resolution");
    const row = UPSCALE_FIRST_STEPS.find((f) => f.id === "regenerate")!;
    expect(row).toMatchObject({
      openOnly: true,
      href: "/upscale/video?model=oss-h3-regenerate&resolution=1440p",
    });
  });
});

describe("the provider fills the pack's strings and the frames", () => {
  it("2K from a 16:9 H3 clip at 768p, its frames, the words, the seed and Creativity's start noise", async () => {
    const { workflow: wf } = await prepare({ extra: { draftFrom: "h3", startSigma: 0.7, steps: 2 } }, { "draft.mp4": clip(1344, 768, 5) });
    expect(at(wf, "17", "resolution")).toBe("2k (2560x1440)");
    expect(at(wf, "11", "size")).toBe("768p (1344x768)");
    expect(at(wf, "11", "max_frames")).toBe(120);
    expect(at(wf, "16", "text")).toBe("a fox in the snow, slow push-in");
    expect(at(wf, "20", "noise_seed")).toBe(3);
    expect([at(wf, "19", "start_sigma"), at(wf, "19", "steps")]).toEqual([0.7, 2]);
    expect(at(wf, "9", "file")).toBe("draft.mp4");
    // The whole clip: no window.
    expect([at(wf, "29", "start_time"), at(wf, "29", "duration")]).toEqual([0, 0]);
    // draftFrom is the plan's, not a binding.
    expect(JSON.stringify(wf)).not.toContain("draftFrom");
  });

  it("4K from another model's clip at 576p; a square clip takes the preset (cropped, not stretched); one 15 s window of a longer clip", async () => {
    const other = await prepare({ resolution: "2160p", extra: { draftFrom: "other" } }, { "draft.mp4": clip(1280, 720, 8) });
    expect([at(other.workflow, "17", "resolution"), at(other.workflow, "11", "size"), at(other.workflow, "11", "max_frames")]).toEqual(["4k (3840x2160)", "576p (1024x576)", 192]);
    const square = await prepare({ resolution: "1080p", extra: { draftFrom: "h3" } }, { "draft.mp4": clip(768, 768, 5) });
    expect([at(square.workflow, "17", "resolution"), at(square.workflow, "11", "size")]).toEqual(["1080p (1920x1080)", "768p (1344x768)"]);
    const odd = await prepare({ extra: { draftFrom: "other" } }, { "draft.mp4": clip(1440, 1080, 5) });
    expect(JSON.stringify(odd.workflow)).not.toContain("keep (snap to 32)");
    const part = await prepare({ startTime: 13.333, endTime: 26.667, extra: { draftFrom: "other" } }, { "draft.mp4": clip(1280, 720, 40) });
    expect(at(part.workflow, "29", "start_time")).toBe(13.333);
    expect(at(part.workflow, "29", "duration")).toBeCloseTo(13.334, 3);
    expect(at(part.workflow, "11", "max_frames")).toBe(320);
  });

  it("refuses a single pass over 15 s (a clip from an earlier step) rather than cutting it short", async () => {
    await expect(prepare({ extra: { draftFrom: "h3" } }, { "draft.mp4": clip(1344, 768, 24) })).rejects.toThrow(/up to 15 s in one pass, and this clip runs 24 s/);
    await expect(prepare({ startTime: 2, extra: { draftFrom: "h3" } }, { "draft.mp4": clip(1344, 768, 17) })).resolves.toBeTruthy();
    await expect(prepare({ extra: { draftFrom: "h3" } }, { "draft.mp4": clip(1344, 768, 15.04) })).resolves.toBeTruthy();
  });

  it("refuses a run without words, and names OPEN_H3_REGEN=1 when the nodes are missing (plain words on an account's own ComfyUI)", async () => {
    await expect(prepare({ prompt: "  " })).rejects.toThrow(/describe what is in it/);
    const { manifest } = getWorkflow(R.REGEN_WORKFLOW);
    const r = promptRefusal(
      {
        error: { type: "missing_node_type", message: "Node 'x' not found" },
        node_errors: {},
      } as never,
      400,
      manifest,
      [],
    );
    expect(r.message).toBe(R.REGEN_COPY.missing);
    const own = onOwnGpu({ url: "https://gpu.example.com" }, () =>
      promptRefusal({ error: { type: "missing_node_type", message: "Node 'x' not found" }, node_errors: {} } as never, 400, manifest, []),
    );
    expect(own.message).toBe(R.REGEN_COPY.missingVisitor);
    expect(own.message).not.toMatch(/OPEN_H3_REGEN|install-comfyui|\.sh|LoRA/);
  });
});

describe("a run: the draft preset from the clip's maker, and 15 s parts joined", () => {
  const insertGeneration = (id: string, modelId: string, account?: string) => {
    const now = Date.now();
    db()
      .prepare(
        "INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'video', ?, 'open', 'comfyui', 't2v', 'video', 'succeeded', ?, '[]', ?, ?)",
      )
      .run(
        id,
        modelId,
        JSON.stringify({
          feature: "video",
          modelId,
          ...(account && { account }),
        }),
        now,
        now,
      );
  };
  const extraOf = (g: Generation) => g.request.params?.extra ?? {};

  it("knows an H3 clip by the run that made it, and an upload as another model's", () => {
    insertGeneration("h3run000001", "oss-minimax-h3");
    const h3 = saveFile({
      data: Buffer.from("not really a video"),
      contentType: "video/mp4",
      source: "generation",
      generationId: "h3run000001",
    });
    const upload = saveFile({
      data: Buffer.from("an upload"),
      contentType: "video/mp4",
      source: "upload",
    });
    expect(clipMaker(h3.url)).toBe("oss-minimax-h3");
    expect(clipMaker(upload.url)).toBeUndefined();
    expect(clipMaker("https://example.com/a.mp4")).toBeUndefined();
    const [g] = gens.createGenerations({
      feature: "upscale",
      modelId: R.REGEN_MODEL,
      prompt: "a fox",
      inputs: { video: h3.url },
      params: { sourceDuration: 5 },
    });
    expect(extraOf(g)).toMatchObject({ draftFrom: "h3" });
    const [u] = gens.createGenerations({
      feature: "upscale",
      modelId: R.REGEN_MODEL,
      prompt: "a fox",
      inputs: { video: upload.url },
      params: { sourceDuration: 5 },
    });
    expect(extraOf(u)).toMatchObject({ draftFrom: "other" });
  });

  it("an account never learns who made the owner's clip, and reads its own", () => {
    insertGeneration("ownerh30001", "oss-minimax-h3");
    insertGeneration("accth30001x", "oss-minimax-h3", "acct-a");
    const owners = saveFile({
      data: Buffer.from("owner"),
      contentType: "video/mp4",
      source: "generation",
      generationId: "ownerh30001",
    });
    const mine = saveFile({
      data: Buffer.from("mine"),
      contentType: "video/mp4",
      source: "generation",
      generationId: "accth30001x",
      accountId: "acct-a",
    });
    runAsTenant({ kind: "account", id: "acct-a" }, () => {
      expect(clipMaker(owners.url)).toBeUndefined();
      expect(clipMaker(mine.url)).toBe("oss-minimax-h3");
    });
    runAsTenant({ kind: "account", id: "acct-b" }, () => expect(clipMaker(mine.url)).toBeUndefined());
    runAsTenant({ kind: "guest" }, () => expect(clipMaker(owners.url)).toBeUndefined());
  });

  it("runs a 40 s clip in three parts of at most 15 s, joined packet by packet, with a seam note", () => {
    const made = gens.createGenerations({
      feature: "upscale",
      modelId: R.REGEN_MODEL,
      prompt: "a fox",
      inputs: { video: "/api/files/uploads/long.mp4" },
      params: { sourceDuration: 40, resolution: "1440p" },
    });
    const [film, ...parts] = made;
    expect(film.modelId).toBe(R.REGEN_JOIN);
    expect(film.op).toBe("concat");
    expect(film.notes).toContain(R.REGEN_SEAM_NOTE);
    expect(parts).toHaveLength(3);
    for (const p of parts) {
      expect(p.modelId).toBe(R.REGEN_MODEL);
      const { startTime, endTime } = p.request.params!;
      expect(endTime! - startTime!).toBeLessThanOrEqual(15);
      expect(extraOf(p)).toMatchObject({ draftFrom: "other" });
    }
    expect(parts.map((p) => p.request.params!.startTime)).toEqual([0, 13.333, 26.667]);
    // A clip up to 15 s is one run.
    expect(
      gens.createGenerations({
        feature: "upscale",
        modelId: R.REGEN_MODEL,
        prompt: "a fox",
        inputs: { video: "/api/files/uploads/short.mp4" },
        params: { sourceDuration: 15 },
      }),
    ).toHaveLength(1);
  });
});

describe("a run's length: the stored file's header first, capped, and never cut short", () => {
  const run = (video: string, params: Record<string, unknown> = {}, opts?: { dependsOn?: string }) =>
    gens.createGenerations({ feature: "upscale", modelId: R.REGEN_MODEL, prompt: "a fox", inputs: { video }, params: params as never }, opts);

  it("splits by the file's own header, whatever sourceDuration the client sends", () => {
    const twenty = stored(20);
    const [film, ...parts] = run(twenty, { sourceDuration: 5 });
    expect(film.modelId).toBe(R.REGEN_JOIN);
    expect(parts.map((p) => [p.request.params!.startTime, p.request.params!.endTime])).toEqual([
      [0, 10],
      [10, 20],
    ]);
    // A huge sourceDuration on an 8 s file: one run, not thousands.
    expect(run(stored(8), { sourceDuration: 36000 })).toHaveLength(1);
  });

  it("refuses more than 40 parts (10 minutes) in one run, and takes 10 minutes", () => {
    expect(R.REGEN_MAX_PARTS).toBe(40);
    expect(R.REGEN_MAX_SECONDS).toBe(600);
    const before = (db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n;
    expect(() => run("https://example.com/long.mp4", { sourceDuration: 36000 })).toThrow("Regenerate takes up to 10 minutes of video in one run, and this clip runs 600:00. Trim it, or regenerate it in shorter pieces");
    expect(() => run(stored(601), {})).toThrow(/up to 10 minutes .* runs 10:01/);
    // Nothing was created by a refused run.
    expect((db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n).toBe(before);
    const [, ...parts] = run(stored(600), {});
    expect(parts).toHaveLength(40);
    expect(Math.max(...parts.map((p) => p.request.params!.endTime! - p.request.params!.startTime!))).toBeLessThanOrEqual(15);
  });

  it("a span over 15 s is split inside the span, not cut to its first 15 s", () => {
    const [film, ...parts] = run(stored(40), { startTime: 5, endTime: 35 });
    expect(film.notes).toContain(R.REGEN_SEAM_NOTE);
    expect(parts.map((p) => [p.request.params!.startTime, p.request.params!.endTime])).toEqual([
      [5, 20],
      [20, 35],
    ]);
    // A span up to 15 s is one pass of that span.
    const [one] = run(stored(40), { startTime: 5, endTime: 12 });
    expect(one.request.params).toMatchObject({ startTime: 5, endTime: 12 });
  });

  it("a run that waits for an earlier step says it redraws up to 15 s in one pass; a clip that isn't 16:9 says it is cropped", () => {
    const [waits] = gens.createGenerations({ feature: "upscale", modelId: R.REGEN_MODEL, prompt: "a fox", chain: [{ slot: "video" }] } as never, { dependsOn: "h3run000001" });
    expect(waits.notes).toContain(R.REGEN_ONE_PASS_NOTE);
    const [square] = run(stored(5, 1024, 1024));
    expect(square.notes).toContain("Regenerate makes 16:9 video, so this 1024×1024 clip is cropped to 16:9 at the centre");
    const [wide] = run(stored(5, 1280, 720));
    expect(wide.notes ?? []).toEqual([]);
  });

  it("won't run with the refiner LoRA switched off in Settings → Models & licences (the owner is told where; a visitor gets plain words)", () => {
    const was = readAccess();
    saveAccess({ ...was, loras: [...was.loras, R.REGEN_LORA.file] });
    try {
      expect(() => run(stored(5))).toThrow(/switched off in Settings → Models & licences/);
      runAsTenant({ kind: "account", id: "acct-a" }, () => expect(regenSwitchedOff()).toBe(R.REGEN_COPY.off));
      expect(R.REGEN_COPY.off).not.toMatch(/LoRA|Settings/);
    } finally {
      saveAccess(was);
    }
    expect(regenSwitchedOff()).toBeUndefined();
  });
});

describe("words for an upload: Fuobe's reading model on your GPU describes the clip", () => {
  it("asks oss-reference-brief for one paragraph about the clip's first 15 s", async () => {
    const r = R.regenDescribeRequest("/api/files/uploads/a.mp4", 40);
    expect(r).toMatchObject({
      modelId: "oss-reference-brief",
      op: "write",
      feature: R.REGEN_DESCRIBE_FEATURE,
      inputs: { video: "/api/files/uploads/a.mp4" },
      params: { duration: 15, numOutputs: 1, extra: { instruction: R.REGEN_DESCRIBE_INSTRUCTION } },
    });
    expect(R.regenDescribeRequest("/a.mp4", 6.5).params?.duration).toBe(6.5);
    expect(getModel(R.REGEN_DESCRIBE_MODEL)).toMatchObject({ engine: "open", kind: "text" });
    // The instruction reaches Gemma's prompt input, and the frames cover the 15 s.
    const { workflow: wf } = await prepareWorkflow(
      "reference-brief-gemma4",
      { video: "a.mp4", duration: 15, extra: { instruction: R.REGEN_DESCRIBE_INSTRUCTION } } as GenInput,
      { generationId: "g2", op: "write", upload: async (_d, _t, name) => `up_${name}`, media: () => clip(1280, 720, 40) },
    );
    expect(at(wf, "3", "prompt")).toBe(R.REGEN_DESCRIBE_INSTRUCTION);
    expect(at(wf, "1", "frame_load_cap")).toBeGreaterThanOrEqual(360);
  });

  it("cleans the answer into one editable line", () => {
    expect(R.regenDescription('  "A red fox trots through deep snow.\n\nThe camera pushes in slowly."  ')).toBe("A red fox trots through deep snow. The camera pushes in slowly.");
    expect(R.regenDescription("```\nDescription: A city at night.\n```")).toBe("A city at night.");
    expect(R.regenDescription(undefined)).toBe("");
    expect(R.regenDescription("x".repeat(3000))).toHaveLength(1500);
  });
});

describe("result actions per source and engine", () => {
  const out = (url = "/api/files/a.mp4", meta?: OutputFile["meta"]): OutputFile => ({ url, kind: "video", ...(meta && { meta }) }) as OutputFile;
  const gen = (p: Partial<Generation>): Generation =>
    ({
      id: "g1",
      batchId: null,
      feature: "video",
      presetId: null,
      modelId: "oss-minimax-h3",
      engine: "open",
      provider: "comfyui",
      op: "t2v",
      kind: "video",
      status: "succeeded",
      progress: null,
      message: null,
      prompt: "wrapped layout prompt",
      request: {
        feature: "video",
        modelId: "oss-minimax-h3",
        prompt: "a fox runs through snow",
      },
      outputs: [out()],
      error: null,
      costUsd: 0,
      favorite: false,
      createdAt: 1,
      updatedAt: 1,
      completedAt: 1,
      ...p,
    }) as Generation;
  const ids = (g: Generation, ctx = {}) => outputActions(g, 0, ctx).map((a) => a.id);

  it("a clip made on your GPU: Regenerate in 2K, opening Upscale → Video with the clip, its words and 2K", () => {
    const g = gen({});
    const a = outputActions(g, 0).find((x) => x.id === "regenerate")!;
    expect(a).toMatchObject({ label: "Regenerate in 2K", placement: "menu" });
    const u = new URL(a.href!, "http://x");
    expect(u.pathname).toBe("/upscale/video");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      video: "/api/files/a.mp4",
      model: "oss-h3-regenerate",
      resolution: "1440p",
      prompt: "a fox runs through snow",
    });
    // Right after "Render this draft in 1080p" when the clip is a draft.
    const draft = gen({ outputs: [{ ...out(), draftId: "d1" } as OutputFile] });
    const list = ids(draft);
    expect(list.indexOf("regenerate")).toBe(list.indexOf("finalize") + 1);
    // Paid APIs only: hidden.
    expect(ids(g, { engineMode: "cloud" })).not.toContain("regenerate");
  });

  it("an upload: Regenerate in 2K with no words of its own", () => {
    const g = gen({
      feature: "upload",
      modelId: "upload",
      provider: "mock" as Generation["provider"],
      prompt: null,
      request: { feature: "upload", modelId: "upload" },
    });
    const a = outputActions(g, 0).find((x) => x.id === "regenerate")!;
    expect(new URL(a.href!, "http://x").searchParams.get("prompt")).toBeNull();
    expect(ids(g, { engineMode: "cloud" })).not.toContain("regenerate");
  });

  it("a fal H3 result: Re-render at 2K · a new render, with its price; other cloud results get neither", () => {
    const h3 = gen({
      modelId: "minimax-h3",
      engine: "cloud",
      provider: "fal",
      request: {
        feature: "video",
        modelId: "minimax-h3",
        op: "i2v",
        prompt: "a fox",
        inputs: { images: ["/api/files/s.png"] },
        params: {
          resolution: "768P",
          duration: 5,
          seed: 42,
          aspectRatio: "16:9",
        },
      },
    });
    const list = outputActions(h3, 0);
    expect(list.find((a) => a.id === "rerender-2k")).toMatchObject({
      label: "Re-render at 2K · a new render · $0.13/s",
      placement: "menu",
    });
    expect(list.some((a) => a.id === "regenerate")).toBe(false);
    expect(R.rerenderLabel("fuobe-character-swap")).toBe("Re-render at 2K · a new render · $0.1625/s");
    expect(R.rerenderLabel("minimax-h3", "4K")).toBe("Re-render at 4K · a new render · $0.16/s");
    expect(R.rerenderLabel("fuobe-character-swap", "4K")).toBe("Re-render at 4K · a new render · $0.20/s");
    for (const other of ["kling-3", "topaz-video", "seedance-2-5"]) {
      const g = gen({
        modelId: other,
        engine: "cloud",
        provider: "fal",
        request: { feature: "video", modelId: other },
      });
      expect(ids(g), other).not.toContain("regenerate");
      expect(ids(g), other).not.toContain("rerender-2k");
    }
    // Already at 2K or 4K: a re-render would be a paid duplicate. Engine mode "Open source only": the paid run is refused, so not offered.
    for (const size of ["2K", "4K", "2k"]) expect(ids({ ...h3, request: { ...h3.request, params: { ...h3.request.params, resolution: size } } }), size).not.toContain("rerender-2k");
    expect(ids(h3, { engineMode: "open" })).not.toContain("rerender-2k");
    expect(ids(h3, { engineMode: "both" })).toContain("rerender-2k");
    // A step whose inputs came from earlier steps can't be re-sent as it is.
    expect(ids({ ...h3, request: { ...h3.request, chain: [{ slot: "images" }] } })).not.toContain("rerender-2k");
  });

  it("the re-render: the same endpoint, inputs, words and seed at resolution 2K, priced $0.13/s", async () => {
    const h3 = gen({
      modelId: "minimax-h3",
      engine: "cloud",
      provider: "fal",
      outputs: [out("/api/files/h3.mp4", { seed: 777 })],
      request: {
        feature: "video",
        modelId: "minimax-h3",
        op: "i2v",
        prompt: "a fox",
        inputs: { images: ["/api/files/s.png"] },
        params: { resolution: "768P", duration: 5, aspectRatio: "16:9" },
      },
    });
    const r = R.rerenderRequest(h3);
    expect(r).toMatchObject({
      modelId: "minimax-h3",
      op: "i2v",
      engine: "cloud",
      prompt: "a fox",
      inputs: { images: ["/api/files/s.png"] },
      params: {
        resolution: "2K",
        duration: 5,
        seed: 777,
        aspectRatio: "16:9",
        numOutputs: 1,
      },
    });
    const plan = planGeneration(r);
    expect(plan.model.id).toBe("minimax-h3");
    expect(estimateCost(plan.model, plan.params, 1, plan.op)).toBeCloseTo(0.65, 5);
    const payload = buildPayload(plan.model.routes.find((x) => x.op === "i2v")!.map!, {
      ...plan.params,
      prompt: "a fox",
      images: ["https://cdn/s.png"],
    } as never) as Record<string, unknown>;
    expect(payload).toMatchObject({
      resolution: "2K",
      seed: 777,
      image_url: "https://cdn/s.png",
      prompt: "a fox",
    });
    // The request's own seed when the provider reported none.
    expect(
      R.rerenderRequest(
        gen({
          ...h3,
          outputs: [out()],
          request: { ...h3.request, params: { seed: 9 } },
        }),
      ).params?.seed,
    ).toBe(9);
    // The cloud Character swap's 2K and 4K on its LoRA route, priced as the label says.
    const { ORIGINAL_CLOUD } = await import("@/lib/catalog/cloud-models.generated");
    const swap = ORIGINAL_CLOUD.find((m) => m.id === "fuobe-character-swap")!;
    expect(swap.pricing?.byResolution).toMatchObject({
      "2K": R.RERENDER["fuobe-character-swap"].perSecond["2K"],
      "4K": R.RERENDER["fuobe-character-swap"].perSecond["4K"],
    });
    expect(getModel("minimax-h3")!.pricing?.byResolution).toMatchObject(R.RERENDER["minimax-h3"].perSecond);
  });

  it("offers Regenerate in 2K among the next steps of H3, LTX, Wan and SANA clips, after Upscale", () => {
    for (const id of ["oss-minimax-h3", "oss-ltx25", "oss-wan22-14b"]) {
      const steps = nextSteps(gen({ modelId: id }), 0).map((a) => a.id);
      expect(steps, id).toEqual(["extend", "upscale", "regenerate"]);
    }
    expect(R.regenerateFamily("sana-video")).toBe("sana");
    expect(nextSteps(gen({ modelId: "oss-seedvr2", op: "upscale-video" }), 0).map((a) => a.id)).not.toContain("regenerate");
    expect(
      nextSteps(gen({ modelId: "oss-minimax-h3" }), 0, 3, {
        engineMode: "cloud",
      }).map((a) => a.id),
    ).not.toContain("regenerate");
  });
});

describe("Canvas: the Upscale node's Regenerate (creative) choice", () => {
  it("adds an Upscale node on Open-H3 Regenerate, disabled on the cloud with the GPU-only reason", () => {
    const item = canvas.paletteItems("both", "open").find((p) => p.id === "upscale-regenerate")!;
    expect(item).toMatchObject({
      type: "upscale",
      label: "Regenerate (creative)",
      data: { mediaKind: "video", modelId: R.REGEN_MODEL },
    });
    expect(item.disabled).toBeUndefined();
    expect(canvas.paletteItems("both", "cloud").find((p) => p.id === "upscale-regenerate")!.disabled).toBe(canvas.GPU_ONLY_ENTRY);
    expect(canvas.paletteItems("cloud").find((p) => p.id === "upscale-regenerate")!.disabled).toBe("Runs on your GPU (open source): this install uses paid APIs only");
    expect(canvas.GPU_ONLY_ENTRY).toBe("Runs on your GPU (open source): switch the board to Open source");
    // The plain Upscale entry is untouched.
    expect(canvas.paletteItems("both", "cloud").find((p) => p.id === "upscale")!.disabled).toBeUndefined();
    const node = {
      id: "n",
      type: "upscale" as const,
      position: { x: 0, y: 0 },
      data: { ...item.data },
    };
    expect(canvas.defaultModelForNode(node, "open")?.id).toBe(R.REGEN_MODEL);
    // Its words come in through a prompt port (the Upscale node otherwise takes only the clip).
    const withModel = {
      ...node,
      data: { ...node.data, modelId: R.REGEN_MODEL },
    };
    expect(canvas.inputPorts(withModel).map((p) => p.id)).toEqual(["prompt", "video"]);
    expect(
      canvas
        .inputPorts({
          ...node,
          data: { mediaKind: "video" as const, modelId: "oss-seedvr2" },
        })
        .map((p) => p.id),
    ).toEqual(["video"]);
    // A board switched to the cloud has no stand-in for it.
    const { missing } = canvas.convertEngine({ nodes: [withModel], edges: [] } as never, "cloud");
    expect(missing).toEqual(["n"]);
  });
});

describe("the library's validation state", () => {
  it("lists video-regenerate-h3 as unvalidated until it runs on a GPU ComfyUI with its packs (they are not on the validation server)", () => {
    const { manifest } = getWorkflow(R.REGEN_WORKFLOW);
    expect(manifest.validated).toBe(false);
    expect(manifest.customNodes.map((c) => c.name)).toEqual(expect.arrayContaining(["ComfyUI-Open-H3-Regenerate", "Comfyui_Minimax_h3_latent_Upscaler"]));
  });
});

describe("the GPU pre-flight, Settings → Models & licences", () => {
  it("gives the board a Regenerate in 2K row on the graph, the join and the refiner LoRA", () => {
    const row = STUDIO_ROWS.find((r) => r.label === "Regenerate in 2K")!;
    expect(row).toMatchObject({
      group: "Video tools",
      href: "/upscale/video?model=oss-h3-regenerate&resolution=1440p",
    });
    const t = studioTool(row)!;
    expect(t.workflows).toEqual(expect.arrayContaining([R.REGEN_WORKFLOW, "video-concat-encoded"]));
    expect(t.loras.map((l) => l.file)).toContain("open_h3_regenerate_2k_lora.safetensors");
    expect(modelTool(R.REGEN_MODEL, "upscale-video")!.loras.map((l) => l.file)).toEqual(["open_h3_regenerate_2k_lora.safetensors"]);
  });

  it("records both node packs and the files' licences as information", () => {
    expect(NODE_PACKS.find((p) => p.name === "ComfyUI-Open-H3-Regenerate")!.licence).toMatchObject({ name: "Apache-2.0", class: "commercial" });
    expect(NODE_PACKS.find((p) => p.name === "Comfyui_Minimax_h3_latent_Upscaler")!.licence).toMatchObject({ name: "MIT", class: "commercial" });
    const files = Object.fromEntries(R.REGEN_FILES.map((f) => [f.file, f]));
    expect(files["open_h3_regenerate_2k_lora.safetensors"].note).toMatch(/Turbo v1\.2 part is Apache-2\.0.*LMS Sharp part has no stated licence/);
    expect(files["open_h3_regenerate_2k_lora.safetensors"].note).toMatch(/outside the US, the EU, the UK and the Republic of Korea.*US\$20M.*"MiniMax H3".*Comfy's docs/);
    expect(files["fast_h3_vae_noncausal_24l.safetensors"].licence).toBe("MiniMax H3 Community License");
    expect(files["minimax_h3_fl2va_pruned_int8_convrot.safetensors"].licence).toBe("MiniMax H3 Community License");
    expect(files["minimax_h3_latent_upscaler_3d_conv_v1_bf16.safetensors"]).toMatchObject({
      licence: "Apache-2.0",
      note: expect.stringMatching(/MIT/),
    });
    expect(R.regenerateGraphLoras(R.REGEN_WORKFLOW)).toEqual([R.REGEN_LORA]);
    expect(R.regenerateGraphLoras("upscale-video-seedvr2-chunked")).toEqual([]);
  });

  it("adds Topaz Astra 2 under its own name, never as Regenerate", () => {
    const astra = getModel("topaz-astra")!;
    expect(astra).toMatchObject({
      engine: "cloud",
      name: "Topaz Astra 2",
      pricing: { byResolution: { "1080p": 0.3, "4K": 0.5 } },
    });
    expect(astra.routes[0]).toMatchObject({
      op: "upscale-video",
      provider: "fal",
      endpoint: "topaz/upscale/video/creative",
    });
    expect(`${astra.name} ${astra.tagline}`).not.toMatch(/regenerat/i);
  });
});
