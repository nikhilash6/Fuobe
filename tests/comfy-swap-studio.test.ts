import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ComfyWorkflow, Manifest } from "@/lib/comfy";
import { getModel } from "@/lib/catalog";
import { graphLoras, H3_WORKFLOWS, SWAP_LORAS, TURBO_LORA } from "@/lib/catalog/character-swap";
import { STUDIO_MODELS, STUDIO_WORKFLOWS } from "@/lib/catalog/swap-studio-plan";
import type { GenInput, Operation } from "@/lib/catalog/types";
import type { MediaInfo } from "@/lib/media-probe";

// Character Swap Studio's two ComfyUI graphs (H3 Relay 2.0), bound for real by the provider on the library files.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-swap-studio-comfy-"));
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow } = await import("@/server/providers/comfyui");
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const dir = path.join(process.cwd(), "workflows/comfyui");
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
const subset = JSON.parse(fs.readFileSync(path.join(dir, "object_info.subset.json"), "utf8")) as Record<string, unknown>;
const entry = (id: string) => manifest.workflows.find((w) => w.id === id)!;
const file = (id: string) => JSON.parse(fs.readFileSync(path.join(dir, `${id}.json`), "utf8")) as ComfyWorkflow;

const clip: MediaInfo = { container: "mp4", hasVideo: true, hasAudio: true, duration: 20, videoDuration: 20, width: 1920, height: 1080, fps: 24, frames: 480 };
const GB = 2 ** 30;
const prepare = (id: string, input: Partial<GenInput>, op: Operation, ram = 64 * GB) =>
  prepareWorkflow(id, { video: "clip.mp4", ...input } as GenInput, { generationId: "g1", op, upload: async (_d, _t, name) => `up_${name}`, media: (n) => (n === "clip.mp4" ? clip : undefined), serverRam: async () => ram });
const at = (wf: ComfyWorkflow, node: string, input: string) => wf[node]?.inputs[input];
const SEG = STUDIO_WORKFLOWS.segment;
const MASK = STUDIO_WORKFLOWS.mask;
const SAM_CHAIN = ["sam", "subject", "first_frame", "detect", "select", "track", "mask", "recover"];

describe("the studio's graphs in the library", () => {
  it("are what the studio's models run, on H3 Relay", () => {
    expect(getModel(STUDIO_MODELS.open.swap)!.routes[0]).toMatchObject({ provider: "comfyui", endpoint: SEG, op: "video-swap" });
    expect(getModel(STUDIO_MODELS.open.mask)!.routes[0]).toMatchObject({ provider: "comfyui", endpoint: MASK, op: "bg-remove-video" });
    expect(getModel(STUDIO_MODELS.open.swap)!.hidden).toBe(true);
    expect(entry(SEG).customNodes.map((c) => c.name)).toEqual(expect.arrayContaining(["h3-relay", "ComfyUI-VideoHelperSuite"]));
    expect(entry(MASK).customNodes.map((c) => c.name)).toEqual(["h3-relay"]);
    expect(entry(SEG).outputs).toEqual([{ node: "save", kind: "video" }, { node: "save_master", kind: "video", role: "master" }]);
    expect(entry(MASK).outputs).toEqual([{ node: "save", kind: "video", role: "matte" }]);
    // The swap's weights, pinned, with their sizes.
    for (const m of entry(SEG).models) {
      expect(m.url, m.file).toMatch(/^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\//);
      expect(m.sizeGb, m.file).toBeGreaterThan(0);
    }
    expect(entry(SEG).license).toMatch(/territory EXCLUDES the US, the EU, the UK and South Korea/);
    expect(entry(MASK).license).toMatch(/SAM License/);
  });

  it("use core nodes and H3 Relay nodes this server has", () => {
    for (const id of [SEG, MASK]) {
      for (const c of new Set(Object.values(file(id)).map((n) => n.class_type))) {
        expect(Object.hasOwn(subset, c), c).toBe(true);
        // The subset was read from a server with H3 Relay (the person removal validates there).
        expect(subset[c], c).not.toBeNull();
      }
      expect(entry(id).validated).toBe(false);
      expect((entry(id) as { validationError?: string }).validationError).toMatch(/missing_node_type: Node 'H3Relay/);
    }
  });

  it("downloads the swap and Turbo LoRAs before a segment runs", () => {
    expect(H3_WORKFLOWS).toContain(SEG);
    expect(graphLoras(SEG, {}).map((l) => l.file)).toEqual([TURBO_LORA.file, SWAP_LORAS["v1.5"].file]);
    expect(graphLoras(SEG, { lora: "none" }).map((l) => l.file)).toEqual([TURBO_LORA.file]);
    expect(graphLoras(MASK, {})).toEqual([]);
  });
});

describe("a segment through the provider", () => {
  const base = { prompt: "Replace only the selected person in <Video 1>.", images: ["hero.png"], startTime: 0, endTime: 120.25 / 24, resolution: "768p", seed: 9 };

  it("starts fresh without an anchor: no history, no Picture 2, no first-frame guide; SAM picks who", async () => {
    const { workflow: wf } = await prepare(SEG, { ...base, extra: { selection: "rightmost", subjectIndex: 0, maskPrompt: "person", maskGrow: 32 } }, "video-swap");
    expect(at(wf, "plan", "schedule")).toBe("segment");
    for (const id of ["plan", "window", "append"]) expect(at(wf, id, "initial_history")).toBeUndefined();
    for (const id of ["history_source", "history_components", "history_tail", "history_fit", "anchor_image"]) expect(wf[id], id).toBeUndefined();
    expect(at(wf, "reference_conditioning", "ref_images.ref_image_1")).toBeUndefined();
    expect(at(wf, "history", "first_frame_guide")).toBe(false);
    expect(at(wf, "select", "selection")).toBe("rightmost");
    expect(at(wf, "expand_mask", "expansion_px")).toBe(32);
    expect(at(wf, "prepare", "resolution")).toBe("768");
    expect(at(wf, "trim", "duration")).toBeCloseTo(120.25 / 24, 9);
    expect(at(wf, "prepare", "duration_seconds")).toBeCloseTo(120.25 / 24, 9);
    expect(at(wf, "save_master", "format")).toBe("video/ffv1-mkv");
    expect(at(wf, "save_master", "filename_prefix")).toBe("fuobe/g1");
    for (const id of SAM_CHAIN) expect(wf[id], id).toBeDefined();
  });

  it("an anchor is Picture 2 through the window and guides the first frame", async () => {
    const { workflow: wf } = await prepare(SEG, { ...base, images: ["hero.png", "anchor.png"] }, "video-swap");
    expect(at(wf, "anchor_image", "image")).toBe("anchor.png");
    expect(at(wf, "window", "anchor")).toEqual(["anchor_image", 0]);
    expect(at(wf, "reference_conditioning", "ref_images.ref_image_1")).toEqual(["window", 11]);
    expect(at(wf, "history", "first_frame_guide")).toBe(true);
  });

  it("continues from the previous take's master, the anchor after the boundary as Picture 3", async () => {
    // (The studio sends the master's /api/files URL; the provider uploads it and binds the name it gets.)
    const { workflow: wf } = await prepare(SEG, { ...base, images: ["hero.png", "anchor.png"], extra: { historyVideo: "up_master.mkv", historyStart: 106, historyLength: 18, anchorAfterHistory: true } }, "video-swap");
    for (const id of ["plan", "window", "append"]) expect(at(wf, id, "initial_history")).toEqual(["history_fit", 0]);
    expect(at(wf, "history_tail", "batch_index")).toBe(106);
    expect(at(wf, "history_tail", "length")).toBe(18);
    expect(at(wf, "reference_conditioning", "ref_images.ref_image_1")).toEqual(["window", 11]);
    expect(at(wf, "reference_conditioning", "ref_images.ref_image_2")).toEqual(["anchor_fit", 0]);
    expect(at(wf, "anchor_fit", "image")).toEqual(["anchor_image", 0]);
    expect(at(wf, "window", "anchor")).toBeUndefined();
    expect(at(wf, "history", "first_frame_guide")).toBe(true);
    await expect(prepare(SEG, { ...base, extra: { historyVideo: "up_master.mkv", historyStart: -1, historyLength: 18 } }, "video-swap")).rejects.toThrow(/frame count/);
  });

  it("saves only the take's last frames as its lossless master (what the next segment reads)", async () => {
    const { workflow: wf } = await prepare(SEG, { ...base, extra: { masterKeep: 18, segmentFrames: 120 } }, "video-swap");
    expect(wf.master_tail).toMatchObject({ class_type: "ImageFromBatch", inputs: { image: ["finish", 0], batch_index: 102, length: 18 } });
    expect(at(wf, "save_master", "images")).toEqual(["master_tail", 0]);
    expect(at(wf, "save_master", "format")).toBe("video/ffv1-mkv");
    // The take itself is the whole segment.
    expect(at(wf, "video", "images")).toEqual(["finish", 0]);
    for (const k of ["masterKeep", "segmentFrames"]) expect(JSON.stringify(wf)).not.toContain(k);
    // Keeping every frame (or not saying): the master is the whole segment, as before.
    const all = await prepare(SEG, { ...base, extra: { masterKeep: 120, segmentFrames: 120 } }, "video-swap");
    expect(all.workflow.master_tail).toBeUndefined();
    expect(at(all.workflow, "save_master", "images")).toEqual(["finish", 0]);
  });

  it("the approved mask replaces SAM's chain, trimmed like the segment", async () => {
    const { workflow: wf } = await prepare(SEG, { ...base, startTime: 105.5 / 24, endTime: (105.5 + 141.25) / 24, extra: { maskVideo: "up_mask.mp4", maskStart: 105.5 / 24 } }, "video-swap");
    expect(at(wf, "mask_source", "file")).toBe("up_mask.mp4");
    expect(at(wf, "mask_trim", "start_time")).toBeCloseTo(105.5 / 24, 9);
    expect(at(wf, "mask_trim", "duration")).toBeCloseTo(141.25 / 24, 9);
    expect(at(wf, "mask_fit", "width")).toEqual(["dimensions", 0]);
    expect(at(wf, "expand_mask", "masks")).toEqual(["mask_channel", 0]);
    for (const id of SAM_CHAIN) expect(wf[id], id).toBeUndefined();
  });

  it("masked generation off regenerates the whole frame: no edit mask, no SAM", async () => {
    const { workflow: wf } = await prepare(SEG, { ...base, extra: { useMask: false } }, "video-swap");
    expect(wf.edit_mask).toBeUndefined();
    expect(at(wf, "guide", "latent")).toEqual(["history", 1]);
    expect(at(wf, "sample", "latent_image")).toEqual(["history", 1]);
    expect(at(wf, "window", "mask")).toBeUndefined();
    for (const id of [...SAM_CHAIN, "expand_mask"]) expect(wf[id], id).toBeUndefined();
  });

  it("the swap LoRA's release, or none", async () => {
    const v1 = await prepare(SEG, { ...base, extra: { lora: "v1" } }, "video-swap");
    expect(at(v1.workflow, "adapter", "lora_name")).toBe(SWAP_LORAS.v1.file);
    const none = await prepare(SEG, { ...base, extra: { lora: "none" } }, "video-swap");
    expect(none.workflow.adapter).toBeUndefined();
    expect(at(none.workflow, "sampling_memory", "model")).toEqual(["turbo", 0]);
  });
});

describe("a mask through the provider", () => {
  const base = { startTime: 119.5 / 24, endTime: (119.5 + 240.25) / 24, resolution: "768p" };

  it("tracks the whole shot from its first frame: the new part alone", async () => {
    const { workflow: wf } = await prepare(MASK, { ...base, prompt: "person", extra: { keyFrame: 0, spanFrames: 240, shotFrames: 240, selection: "largest", subjectIndex: 0 } }, "bg-remove-video");
    expect(at(wf, "video", "images")).toEqual(["new_images", 0]);
    for (const id of ["prev_source", "prev_frames", "prev_fit", "head", "tail", "join_head", "join_tail", "head_blank"]) expect(wf[id], id).toBeUndefined();
    expect(at(wf, "key_frame", "batch_index")).toBe(0);
    expect(at(wf, "span", "length")).toBe(240);
    expect(at(wf, "recover", "source_frames")).toBe(240);
    expect(at(wf, "subject", "text")).toBe("person");
    expect(at(wf, "prepare", "resolution")).toBe("768");
  });

  it("redoes one clicked frame inside the version it corrects", async () => {
    const { workflow: wf } = await prepare(
      MASK,
      { ...base, points: [{ x: 960, y: 540, label: "positive" }, { x: 100, y: 100, label: "negative" }], extra: { keyFrame: 30, spanFrames: 1, shotFrames: 240, prevMask: "up_prev.mp4", maskPrompt: "the man in the hat" } },
      "bg-remove-video",
    );
    expect(at(wf, "prev_source", "file")).toBe("up_prev.mp4");
    expect(at(wf, "head", "length")).toBe(30);
    expect(at(wf, "tail", "batch_index")).toBe(31);
    expect(at(wf, "tail", "length")).toBe(209);
    expect(at(wf, "join_head", "image1")).toEqual(["head", 0]);
    expect(at(wf, "join_tail", "image1")).toEqual(["join_head", 0]);
    expect(at(wf, "video", "images")).toEqual(["join_tail", 0]);
    // The click is the person: SAM's first detection; the points are in H3's 1 MP canvas.
    expect(at(wf, "select", "selection")).toBe("index");
    expect(at(wf, "select", "index")).toBe(0);
    expect(JSON.parse(String(at(wf, "detect", "positive_coords")))).toHaveLength(1);
    expect(JSON.parse(String(at(wf, "detect", "negative_coords")))).toHaveLength(1);
    expect(at(wf, "subject", "text")).toBe("the man in the hat");
  });

  it("tracks from a later frame: the corrected version before it, or blank frames when there is none", async () => {
    const after = await prepare(MASK, { ...base, extra: { keyFrame: 100, spanFrames: 140, shotFrames: 240, prevMask: "up_prev.mp4" } }, "bg-remove-video");
    expect(at(after.workflow, "video", "images")).toEqual(["join_head", 0]);
    expect(after.workflow.tail).toBeUndefined();
    const blank = await prepare(MASK, { ...base, extra: { keyFrame: 100, spanFrames: 140, shotFrames: 240 } }, "bg-remove-video");
    expect(at(blank.workflow, "head_blank", "batch_size")).toBe(100);
    expect(at(blank.workflow, "join_head", "image1")).toEqual(["head_blank", 0]);
    expect(at(blank.workflow, "video", "images")).toEqual(["join_head", 0]);
    expect(blank.workflow.prev_source).toBeUndefined();
    await expect(prepare(MASK, { ...base, extra: { keyFrame: 200, spanFrames: 100, shotFrames: 240 } }, "bg-remove-video")).rejects.toThrow(/don't fit in the shot/);
  });

  it("refuses a shot the server can't hold in memory, before it runs", async () => {
    // Correcting a 10 s 1080p shot at 768p holds about 18 GB of frames: a 16 GB server spares 8.
    await expect(prepare(MASK, { ...base, points: [{ x: 9, y: 9 }], extra: { keyFrame: 30, spanFrames: 1, shotFrames: 240, prevMask: "up_prev.mp4" } }, "bg-remove-video", 16 * GB)).rejects.toThrow(/holds the whole shot in memory.*can spare 8 GB/);
    // At 0.5 MP it fits.
    const small = await prepare(MASK, { ...base, resolution: "480p", points: [{ x: 9, y: 9 }], extra: { keyFrame: 30, spanFrames: 1, shotFrames: 240, prevMask: "up_prev.mp4" } }, "bg-remove-video", 16 * GB);
    expect(at(small.workflow, "prepare", "resolution")).toBe("480");
  });
});
