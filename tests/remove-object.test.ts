import { describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { buildPayload } from "@/lib/catalog/payload";
import { planGeneration, promptOptional, routesFor } from "@/lib/catalog/plan";
import {
  chooseEraser,
  CLICK_OPEN_PROBLEM,
  ERASERS,
  erasersFor,
  frameWindows,
  getEraser,
  HAND_OFF,
  klingPrompt,
  MASK_TRACKER,
  paintedPoints,
  pieceSeconds,
  planCloudPieces,
  planFrameCuts,
  planMaskPreview,
  planRemoval,
  planWindows,
  previewIsEraserMask,
  REMOVE,
  REMOVE_EXAMPLES,
  REMOVE_SCENE,
  REMOVE_TOOLS,
  removalProblem,
  removalTitle,
  scalePoints,
  targetPhrase,
  tierFor,
  type RemovalPlanInput,
} from "@/lib/catalog/remove-object";
import type { PlanStep } from "@/lib/catalog/shorts";
import type { GenerationRequest, GenInput } from "@/lib/catalog/types";

const src = { url: "/api/files/uploads/clip.mp4", duration: 12, fps: 30, width: 1280, height: 720, hasAudio: true };
const input = (over: Partial<RemovalPlanInput> & { eraserId?: string } = {}): RemovalPlanInput => {
  const { eraserId, ...rest } = over;
  return {
    engine: "cloud",
    mode: "type",
    eraser: getEraser(eraserId ?? "kling-o3")!,
    title: "Remove · the cup",
    source: src,
    range: { start: 0, end: 12 },
    prompt: "the coffee cup",
    ...rest,
  };
};
const keys = (steps: PlanStep[]) => steps.map((s) => s.key);
const step = (steps: PlanStep[], key: string) => steps.find((s) => s.key === key)!;
/**
 * What a step sends to its API, as the server does: planned (model defaults, checks), then mapped by the route's
 * FieldMap. Chained inputs (a cut piece, a tracked mask) get stand-ins.
 */
const payloadOf = (s: PlanStep) => {
  const chained = Object.fromEntries((s.chain ?? []).map((c) => [c.slot, `/api/files/${c.slot}-from-before.mp4`]));
  const req = { ...s.request, inputs: { ...chained, ...s.request.inputs } } as GenerationRequest;
  const p = planGeneration(req, getModel, getPreset);
  const input = { ...p.params, prompt: p.prompt, video: req.inputs?.video, mask: req.inputs?.mask } as GenInput;
  return buildPayload(routesFor(p.model, p.op)[0].map!, input);
};

describe("Remove object: erasers", () => {
  it("points at real catalog models, with the routes and inputs each way of pointing needs", () => {
    for (const e of ERASERS) {
      const m = getModel(e.id);
      expect(m, e.id).toBeDefined();
      expect(m!.engine).toBe(e.engine);
      expect(routesFor(m!, "remove-object").length, e.id).toBeGreaterThan(0);
    }
    expect(getModel(MASK_TRACKER)!.routes[0].map?.points).toEqual({ key: "point_prompts", format: "sam" });
    for (const t of Object.values(REMOVE_TOOLS)) for (const id of [t.cut, t.join, t.mux, t.preview]) expect(getModel(id), id).toBeDefined();
    // The open erasers drive the three round-4 graphs; the painted one needs a mask, the others words.
    expect(getModel("oss-vace-remove")!.routes[0].endpoint).toBe("video-inpaint-wan-vace");
    expect(getModel("oss-vace-remove-painted")!.routes[0].endpoint).toBe("video-inpaint-wan-vace-painted");
    expect(getModel("oss-void-remove")!.routes[0].endpoint).toBe("video-erase-void");
    expect(getModel("oss-vace-remove-painted")!.options.requires).toMatchObject({ mask: true });
    expect(promptOptional(getModel("oss-vace-remove")!, "remove-object")).toBe(false);
    // VRAM and licences are said where the model is picked.
    expect(getEraser("oss-void-remove")!.note).toMatch(/CogVideoX License/);
    expect(getEraser("oss-void-remove")!.note).toContain("· 24–40 GB GPU ·");
    expect(getModel("oss-void-remove")!.tagline).toContain("· 24–40 GB GPU ·");
    expect(getEraser("oss-vace-remove")!.note).toMatch(/24 GB/);
  });

  it("defaults per engine and way of pointing, and says why when there is none", () => {
    const id = (o: Parameters<typeof chooseEraser>[0]) => {
      const r = chooseEraser(o);
      return "eraser" in r ? r.eraser.id : r.problem;
    };
    expect(id({ engine: "cloud", mode: "type" })).toBe("kling-o3");
    expect(id({ engine: "cloud", mode: "type", effects: true })).toBe("void-video-inpainting");
    expect(id({ engine: "cloud", mode: "click" })).toBe("bria-video-erase-points");
    expect(id({ engine: "cloud", mode: "paint" })).toBe("bria-video-erase-mask");
    expect(id({ engine: "open", mode: "type" })).toBe("oss-vace-remove");
    expect(id({ engine: "open", mode: "type", effects: true })).toBe("oss-void-remove");
    expect(id({ engine: "open", mode: "paint" })).toBe("oss-vace-remove-painted");
    expect(id({ engine: "open", mode: "click" })).toBe(CLICK_OPEN_PROBLEM);
    expect(id({ engine: "cloud", mode: "paint", effects: true })).toMatch(/type what to remove/);
    // A picked eraser is kept when it fits; one from the other engine or mode falls back to the default.
    expect(id({ engine: "cloud", mode: "type", modelId: "bria-video-erase" })).toBe("bria-video-erase");
    expect(id({ engine: "cloud", mode: "type", modelId: "oss-vace-remove" })).toBe("kling-o3");
    expect(id({ engine: "cloud", mode: "type", modelId: "kling-o3", effects: true })).toBe("void-video-inpainting");
    expect(erasersFor("cloud", "type").map((e) => e.id)).toEqual(["kling-o3", "kling-o3-4k-edit", "bria-video-erase", "void-video-inpainting", "ltx-2-3-clean-plate"]);
    expect(erasersFor("open", "click")).toEqual([]);
  });
});

describe("Remove object: words", () => {
  it("cuts the object out of an instruction for SAM 3.1, Bria and VOID", () => {
    expect(targetPhrase(REMOVE_EXAMPLES[0].prompt)).toBe("the coffee cup");
    // Higgsfield's pogo example names four things to remove; the instruction after the dash isn't one.
    expect(targetPhrase(REMOVE_EXAMPLES[1].prompt)).toBe("the pogo stick the guy is bouncing on, the black handle grips in his hands, the platform under his feet, its shadow on the ground");
    expect(targetPhrase("the people walking in the background")).toBe("the people walking in the background");
    expect(targetPhrase("Erase the logo from the video.")).toBe("the logo");
    expect(targetPhrase("get rid of the red car and keep the trees")).toBe("the red car");
  });

  it("names every object a prompt lists, comma-separated (SAM 3.1 and ComfyUI's SAM 3 track each)", () => {
    expect(targetPhrase("the logo and the watermark")).toBe("the logo, the watermark");
    expect(targetPhrase("wires and cables")).toBe("wires, cables");
    expect(targetPhrase("the cup, the spoon and the plate")).toBe("the cup, the spoon, the plate");
    expect(targetPhrase("Remove the cup, the spoon, and the plate.")).toBe("the cup, the spoon, the plate");
    expect(targetPhrase("Remove the cup and remove the plate")).toBe("the cup, the plate");
    expect(targetPhrase("Remove the dog in @Video1 and the cat")).toBe("the dog, the cat");
    expect(targetPhrase("the watermark plus the timestamp")).toBe("the watermark, the timestamp");
    // One object described with "and", or a detail after a comma, stays one.
    expect(targetPhrase("the black and white dog")).toBe("the black and white dog");
    expect(targetPhrase("the man in the red jacket, on the left")).toBe("the man in the red jacket on the left");
    // An instruction after the objects ends the list.
    expect(targetPhrase("the logo and the watermark, and fill the corner with the sky")).toBe("the logo, the watermark");
    // Whole objects up to 160 characters.
    const long = targetPhrase(Array.from({ length: 30 }, (_, i) => `the sticker number ${i + 1}`).join(", "));
    expect(long.length).toBeLessThanOrEqual(160);
    expect(long.endsWith("the sticker number 7")).toBe(true);
    // The provider applies it again to what the planner sent: nothing changes.
    for (const t of [...REMOVE_EXAMPLES.map((x) => x.prompt), "the logo and the watermark", "the black and white dog", "the man in the red jacket, on the left"]) {
      expect(targetPhrase(targetPhrase(t))).toBe(targetPhrase(t));
    }
    expect(removalTitle({ mode: "type", prompt: "the logo and the watermark" })).toBe("Remove · the logo, the watermark");
  });

  it("writes Kling's edit prompt the way Higgsfield does", () => {
    expect(klingPrompt("the coffee cup")).toBe("Remove the coffee cup from @Video1, keep everything else the same.");
    expect(klingPrompt(REMOVE_EXAMPLES[0].prompt)).toBe(`In @Video1: ${REMOVE_EXAMPLES[0].prompt}`);
    expect(klingPrompt("Remove the dog")).toBe("In @Video1: Remove the dog, keep everything else the same.");
    expect(removalTitle({ mode: "type", prompt: REMOVE_EXAMPLES[0].prompt })).toBe("Remove · the coffee cup");
    expect(removalTitle({ mode: "paint" })).toBe("Remove · the painted object");
    expect(removalTitle({ mode: "type", everyone: true })).toBe("Remove · every person");
  });
});

describe("Remove object: windows and pieces", () => {
  it("splits frames into even 4n+1 / 8n+5 windows that fit the graphs", () => {
    const vace = { cap: 81, step: 4, base: 1 };
    const vo = { cap: 197, step: 8, base: 5 };
    expect(frameWindows(81, vace)).toEqual([81]);
    expect(frameWindows(162, vace)).toEqual([81, 81]);
    expect(frameWindows(240, vace)).toEqual([81, 81, 77]);
    expect(frameWindows(1800, vace).every((n) => n <= 81 && (n - 1) % 4 === 0)).toBe(true);
    expect(frameWindows(3, { cap: 197, step: 8, base: 5 })).toEqual([]);
    expect(frameWindows(240, vo)).toEqual([117, 117]);
    for (const [total, w] of [[1799, vace], [987, vo], [100, vace], [5, vo]] as const) {
      const got = frameWindows(total, w);
      const sum = got.reduce((a, b) => a + b, 0);
      expect(sum).toBeLessThanOrEqual(total);
      expect(total - sum).toBeLessThan(w.step);
      expect(got.every((n) => n <= w.cap && (n - w.base) % w.step === 0)).toBe(true);
      expect(Math.max(...got) - Math.min(...got)).toBeLessThanOrEqual(w.step);
    }
  });

  it("reads each open window from a quarter frame early for exactly its frames (checked on the live ComfyUI)", () => {
    const w = planWindows({ start: 0, end: 8 }, 30, { cap: 81, step: 4, base: 1 });
    expect(w.map((p) => p.frames)).toEqual([81, 81, 77]);
    expect(w[0]).toMatchObject({ start: 0, end: 2.7, startTime: 0, endTime: 2.7 });
    expect(w[1]).toMatchObject({ start: 2.7, end: 5.4, startTime: 2.691667, endTime: 5.391667 });
    // Back to back: each window starts where the last one ended.
    for (let i = 1; i < w.length; i++) expect(w[i].start).toBe(w[i - 1].end);
    // A range that starts later starts on its own frame.
    const late = planWindows({ start: 1, end: 3 }, 24, { cap: 81, step: 4, base: 1 });
    // 2 s at 24 fps is 48 frames: the largest 4n+1 is 45 (the last 3 frames are left out).
    expect(late).toEqual([{ index: 0, start: 1, end: 2.875, frames: 45, startTime: 0.989583, endTime: 2.864583 }]);
  });

  it("overlapping windows (the painted eraser): each starts on the last frame of the one before, which is cut off again", () => {
    const painted = { cap: 81, step: 4, base: 1, overlap: 1 };
    expect(frameWindows(240, painted)).toEqual([81, 81, 77]);
    expect(frameWindows(81, painted)).toEqual([81]);
    // 82 frames: two windows, 41 + 41 read, 81 new.
    expect(frameWindows(82, painted)).toEqual([41, 41]);
    for (const total of [82, 161, 240, 1799]) {
      const got = frameWindows(total, painted);
      const fresh = got.reduce((a, b) => a + b, 0) - (got.length - 1);
      expect(fresh).toBeLessThanOrEqual(total);
      expect(total - fresh).toBeLessThan(4);
      expect(got.every((n) => n <= 81 && (n - 1) % 4 === 0)).toBe(true);
    }
    const w = planWindows({ start: 0, end: 8 }, 30, painted);
    expect(w).toEqual([
      { index: 0, start: 0, end: 2.7, frames: 81, startTime: 0, endTime: 2.7 },
      { index: 1, start: 2.7, end: 5.367, frames: 81, startTime: 2.658333, endTime: 5.358333, skip: 1 },
      { index: 2, start: 5.367, end: 7.9, frames: 77, startTime: 5.325, endTime: 7.891667, skip: 1 },
    ]);
    // The new frames are still back to back.
    for (let i = 1; i < w.length; i++) expect(w[i].start).toBe(w[i - 1].end);
  });

  it("cuts cloud clips into equal pieces under each eraser's limit, on whole frames", () => {
    expect(planCloudPieces({ start: 0, end: 12 }, 4.8, 30).map((p) => [p.start, p.end])).toEqual([
      [0, 4],
      [4, 8],
      [8, 12],
    ]);
    expect(planCloudPieces({ start: 0, end: 14 }, 4.8).map((p) => p.end - p.start).every((s) => s < 5)).toBe(true);
    expect(planCloudPieces({ start: 2, end: 9 }, 15)).toEqual([{ index: 0, start: 2, end: 9 }]);
    expect(pieceSeconds(getEraser("bria-video-erase")!)).toBe(4.8);
    expect(pieceSeconds(getEraser("void-video-inpainting")!, 30)).toBeCloseTo(6.567, 3);
    expect(pieceSeconds(getEraser("void-video-inpainting")!)).toBeCloseTo(8.208, 3);
    expect(pieceSeconds(getEraser("kling-o3")!)).toBe(15);
  });

  it("cuts frame-count routes (VOID, LTX) on whole frames into counts the route takes as they are", () => {
    const voidCloud = getEraser("void-video-inpainting")!.window!;
    // fal's VOID snaps num_frames to 69, 77 … 197 (8n+5 from 69): every piece is one of those.
    for (const total of [69, 70, 150, 197, 198, 300, 600, 1799]) {
      const got = frameWindows(total, voidCloud);
      expect(got.every((n) => n >= 69 && n <= 197 && (n - 5) % 8 === 0), `${total}: ${got}`).toBe(true);
      expect(total - got.reduce((a, b) => a + b, 0)).toBeLessThan(8);
    }
    expect(frameWindows(68, voidCloud)).toEqual([]);
    // 10 s at 30 fps: two 149-frame pieces, back to back on frame boundaries (the last 2 frames are left out).
    const p = planFrameCuts({ start: 0, end: 10 }, 30, voidCloud);
    expect(p).toEqual([
      { index: 0, start: 0, end: 4.966667, frames: 149 },
      { index: 1, start: 4.966667, end: 9.933333, frames: 149 },
    ]);
    // LTX renders 8n+1 frames and stays under its 720p budget (about 144 frames).
    const ltx = getEraser("ltx-2-3-clean-plate")!.window!;
    for (const total of [9, 120, 145, 360, 1800]) expect(frameWindows(total, ltx).every((n) => n >= 9 && n <= 137 && (n - 1) % 8 === 0)).toBe(true);
    expect(planFrameCuts({ start: 1, end: 13 }, 30, ltx).map((x) => x.frames)).toEqual([121, 121, 113]);
  });

  it("says why an eraser can't take a clip", () => {
    const kling = getEraser("kling-o3")!;
    expect(removalProblem(kling, src, { start: 0, end: 2 })).toMatch(/at least 3 s — Bria/);
    expect(removalProblem(kling, { ...src, width: 640, height: 360 }, { start: 0, end: 5 })).toMatch(/720 px on each side/);
    expect(removalProblem(kling, src, { start: 0, end: 12 })).toBeNull();
    expect(removalProblem(getEraser("bria-video-erase")!, { ...src, width: 640, height: 360 }, { start: 0, end: 12 })).toBeNull();
    expect(removalProblem(getEraser("oss-vace-remove")!, { ...src, fps: undefined }, { start: 0, end: 5 })).toMatch(/frame rate/);
    expect(removalProblem(kling, src, { start: 0, end: 13 })).toMatch(/past the end/);
    expect(removalProblem(kling, { ...src, duration: 90 }, { start: 0, end: 90 })).toMatch(/up to 60 s/);
    // VOID on the cloud takes at least 69 frames; LTX renders at most 60 fps; both need the clip's rate.
    expect(removalProblem(getEraser("void-video-inpainting")!, src, { start: 0, end: 2 })).toMatch(/at least 69 frames \(2\.3 s of this clip\).*Shadows and reflections/);
    expect(removalProblem(getEraser("void-video-inpainting")!, src, { start: 0, end: 2.3 })).toBeNull();
    expect(removalProblem(getEraser("void-video-inpainting")!, { ...src, fps: undefined }, { start: 0, end: 5 })).toMatch(/frame rate/);
    expect(removalProblem(getEraser("ltx-2-3-clean-plate")!, { ...src, fps: 120 }, { start: 0, end: 5 })).toMatch(/up to 60 fps/);
    expect(tierFor({ width: 1920, height: 1080 })).toBe("1080p");
    expect(tierFor({ width: 720, height: 1280 })).toBe("720p");
    expect(tierFor({ width: 640, height: 360 })).toBe("480p");
  });
});

describe("Remove object: painted masks", () => {
  const blank = (w: number, h: number) => new Uint8Array(w * h);
  const fill = (m: Uint8Array, w: number, x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * w + x] = 1;
    return m;
  };

  it("finds the deepest point of a painted blob, and one per blob", () => {
    const m = fill(blank(400, 300), 400, 100, 100, 200, 200);
    const [p, ...rest] = paintedPoints(m, 400, 300);
    expect(Math.abs(p.x - 150)).toBeLessThanOrEqual(6);
    expect(Math.abs(p.y - 150)).toBeLessThanOrEqual(6);
    expect(p.label).toBe("positive");
    // Points stay inside the paint.
    for (const q of rest) expect(m[q.y * 400 + q.x]).toBe(1);
    const two = fill(fill(blank(400, 300), 400, 10, 10, 60, 60), 400, 300, 200, 380, 280);
    const pts = paintedPoints(two, 400, 300);
    expect(pts.some((q) => q.x < 60 && q.y < 60)).toBe(true);
    expect(pts.some((q) => q.x > 300 && q.y > 200)).toBe(true);
    expect(paintedPoints(blank(64, 64), 64, 64)).toEqual([]);
  });

  it("scales points to the clip's own pixels", () => {
    expect(scalePoints([{ x: 768, y: 432, label: "negative" }], { width: 1536, height: 864 }, { width: 1920, height: 1080 })).toEqual([{ x: 960, y: 540, label: "negative" }]);
    expect(scalePoints([{ x: 2000, y: -5 }], { width: 1000, height: 500 }, { width: 1000, height: 500 })).toEqual([{ x: 999, y: 0 }]);
  });
});

describe("Remove object: cloud pipelines", () => {
  it("Type it, one piece: Kling O3 edit on the upload, sound kept by the model", () => {
    const plan = planRemoval(input({ range: { start: 0, end: 12 } }));
    expect(keys(plan.steps)).toEqual(["erase0"]);
    const r = step(plan.steps, "erase0").request;
    expect(r).toMatchObject({ feature: REMOVE.feature, modelId: "kling-o3", op: "remove-object", inputs: { video: src.url }, title: "Remove · the cup" });
    expect(r.prompt).toBe("Remove the coffee cup from @Video1, keep everything else the same.");
    expect(r.params?.duration).toBe(12);
    expect(plan).toMatchObject({ final: "erase0", sound: false });
  });

  it("Type it, long clip on Bria: cut → erase per piece → join → the clip's sound put back", () => {
    const plan = planRemoval(input({ eraser: getEraser("bria-video-erase")! }));
    expect(keys(plan.steps)).toEqual(["cut0", "erase0", "cut1", "erase1", "cut2", "erase2", "join", "final"]);
    expect(step(plan.steps, "cut1").request).toMatchObject({ feature: REMOVE.stepFeature, modelId: "trim-video", op: "trim", params: { startTime: 4, endTime: 8 } });
    expect(step(plan.steps, "erase1")).toMatchObject({ after: ["cut1"], chain: [{ slot: "video" }], request: { modelId: "bria-video-erase", prompt: "the coffee cup", params: { duration: 4 } } });
    expect(step(plan.steps, "join")).toMatchObject({ after: ["erase0", "erase1", "erase2"], request: { modelId: "join-clips", op: "concat" } });
    // Whole clip: the upload itself carries the sound.
    expect(step(plan.steps, "final")).toMatchObject({ after: ["join"], chain: [{ slot: "video" }], request: { feature: REMOVE.feature, modelId: "merge-audio-video", op: "mux", inputs: { audio: src.url } } });
  });

  it("puts the selection's own sound back when only part of the clip is used", () => {
    const plan = planRemoval(input({ eraser: getEraser("bria-video-erase")!, range: { start: 2, end: 9 } }));
    expect(keys(plan.steps)).toEqual(["cut0", "erase0", "cut1", "erase1", "join", "sound", "final"]);
    expect(step(plan.steps, "sound").request.params).toEqual({ startTime: 2, endTime: 9 });
    expect(step(plan.steps, "final")).toMatchObject({ after: ["join", "sound"], chain: [{ slot: "video" }, { slot: "audio" }] });
  });

  it("VOID (shadows too): told the piece's exact frame count, the sound cut to the picture and put back", () => {
    const six = { ...src, duration: 6 };
    const plan = planRemoval(input({ eraser: getEraser("void-video-inpainting")!, source: six, range: { start: 0, end: 6 } }));
    // 180 frames: one 173-frame piece, cut to exactly those frames; the last 7 are left out, and the sound is cut to match.
    expect(keys(plan.steps)).toEqual(["cut0", "erase0", "sound", "final"]);
    expect(plan.pieces).toEqual([{ index: 0, start: 0, end: 5.766667, frames: 173 }]);
    expect(step(plan.steps, "cut0").request.params).toEqual({ startTime: 0, endTime: 5.766667 });
    expect(step(plan.steps, "erase0")).toMatchObject({ after: ["cut0"], request: { prompt: "the coffee cup", params: { sourceDuration: 5.766667, fps: 30 } } });
    expect(payloadOf(step(plan.steps, "erase0"))).toMatchObject({ video_url: "/api/files/video-from-before.mp4", mask_prompt: "the coffee cup", prompt: REMOVE_SCENE, num_frames: 173 });
    expect(step(plan.steps, "sound").request.params).toEqual({ startTime: 0, endTime: 5.766667 });
    // No sound in the clip: nothing to put back.
    expect(keys(planRemoval(input({ eraser: getEraser("void-video-inpainting")!, range: { start: 0, end: 6 }, source: { ...six, hasAudio: false } })).steps)).toEqual(["cut0", "erase0"]);
    // A clip of exactly 197 frames is read as it is.
    const exact = planRemoval(input({ eraser: getEraser("void-video-inpainting")!, range: { start: 0, end: 197 / 30 }, source: { ...src, duration: 197 / 30, hasAudio: false } }));
    expect(keys(exact.steps)).toEqual(["erase0"]);
    expect(step(exact.steps, "erase0").request.inputs).toEqual({ video: src.url });
    // 10 s: two cuts of 149 frames, each told 149 (nothing for fal to snap), joined.
    const ten = planRemoval(input({ eraser: getEraser("void-video-inpainting")!, prompt: "the logo and the watermark", source: { ...src, duration: 10 }, range: { start: 0, end: 10 } }));
    expect(keys(ten.steps)).toEqual(["cut0", "erase0", "cut1", "erase1", "join", "sound", "final"]);
    expect(step(ten.steps, "cut1").request.params).toEqual({ startTime: 4.966667, endTime: 9.933333 });
    for (const k of ["erase0", "erase1"]) expect(payloadOf(step(ten.steps, k))).toMatchObject({ mask_prompt: "the logo, the watermark", num_frames: 149 });
  });

  it("LTX Clean Plate removes every person without words or its own soundtrack, in 8n+1-frame pieces at 720p", () => {
    const plan = planRemoval(input({ eraser: getEraser("ltx-2-3-clean-plate")!, prompt: undefined, range: { start: 0, end: 5 }, source: { ...src, duration: 5 } }));
    expect(step(plan.steps, "erase0").request).toMatchObject({ params: { generateAudio: false, resolution: "720p" } });
    expect(step(plan.steps, "erase0").request.prompt).toBeUndefined();
    // 150 frames: two pieces of 73 (the budget is about 144 frames at 720p).
    expect(plan.pieces.map((p) => p.frames)).toEqual([73, 73]);
    expect(payloadOf(step(plan.steps, "erase1"))).toMatchObject({ video_url: "/api/files/video-from-before.mp4", num_frames: 73, frames_per_second: 30, resolution: "720p", generate_audio: false });
  });

  it("each cloud eraser's API gets the words, the clip, the clicks or the mask in its own fields", () => {
    const kling = planRemoval(input({ range: { start: 0, end: 12 } }));
    expect(payloadOf(step(kling.steps, "erase0"))).toMatchObject({ video_url: src.url, prompt: "Remove the coffee cup from @Video1, keep everything else the same." });
    const bria = planRemoval(input({ eraser: getEraser("bria-video-erase")!, prompt: "Remove the logo and the watermark" }));
    expect(payloadOf(step(bria.steps, "erase1"))).toMatchObject({ video_url: "/api/files/video-from-before.mp4", prompt: "the logo, the watermark" });
    const points = [{ x: 400, y: 300, label: "positive" as const }, { x: 10, y: 20, label: "negative" as const }];
    const short = planRemoval(input({ mode: "click", eraser: getEraser("bria-video-erase-points")!, points, source: { ...src, duration: 4 }, range: { start: 0, end: 4 } }));
    expect(payloadOf(step(short.steps, "erase0"))).toMatchObject({ video_url: src.url, keypoints: ["{'x':400, 'y':300, 'type':'positive'}", "{'x':10, 'y':20, 'type':'negative'}"] });
    const long = planRemoval(input({ mode: "click", eraser: getEraser("bria-video-erase-points")!, points }));
    expect(payloadOf(step(long.steps, "track"))).toMatchObject({ video_url: src.url, apply_mask: false, point_prompts: [{ x: 400, y: 300, label: 1 }, { x: 10, y: 20, label: 0 }] });
    expect(payloadOf(step(long.steps, "erase0"))).toMatchObject({ video_url: "/api/files/video-from-before.mp4", mask_video_url: "/api/files/mask-from-before.mp4" });
  });

  it("Click it, short clip: Bria's clicked eraser reads the points itself", () => {
    const points = [{ x: 400, y: 300, label: "positive" as const }];
    const plan = planRemoval(input({ mode: "click", eraser: getEraser("bria-video-erase-points")!, points, source: { ...src, duration: 4 }, range: { start: 0, end: 4 } }));
    expect(keys(plan.steps)).toEqual(["erase0"]);
    expect(step(plan.steps, "erase0").request).toMatchObject({ modelId: "bria-video-erase-points", params: { points }, inputs: { video: src.url } });
    expect(plan.tracked).toBe(false);
  });

  it("Click it, long clip: SAM 3.1 follows the clicks, its track is cut like the clip, Bria erases each piece's mask", () => {
    const points = [{ x: 400, y: 300 }];
    const plan = planRemoval(input({ mode: "click", eraser: getEraser("bria-video-erase-points")!, points }));
    expect(plan.tracked).toBe(true);
    expect(step(plan.steps, "track").request).toMatchObject({ modelId: MASK_TRACKER, op: "bg-remove-video", inputs: { video: src.url }, params: { points } });
    expect(step(plan.steps, "mcut1")).toMatchObject({ after: ["track"], chain: [{ slot: "video" }], request: { params: { startTime: 4, endTime: 8 } } });
    const erase = step(plan.steps, "erase1");
    expect(erase).toMatchObject({ after: ["cut1", "mcut1"], chain: [{ slot: "video" }, { slot: "mask" }], request: { modelId: "bria-video-erase-mask" } });
    expect(erase.request.params?.points).toBeUndefined();
  });

  it("Paint it: SAM 3.1 tracks the painted object over the selection, which it sees from its first frame", () => {
    const points = [{ x: 10, y: 10, label: "positive" as const }];
    const whole = planRemoval(input({ mode: "paint", eraser: getEraser("bria-video-erase-mask")!, points, source: { ...src, duration: 4 }, range: { start: 0, end: 4 } }));
    expect(keys(whole.steps)).toEqual(["track", "erase0"]);
    expect(step(whole.steps, "erase0")).toMatchObject({ after: ["track"], chain: [{ slot: "mask" }], request: { inputs: { video: src.url } } });
    const part = planRemoval(input({ mode: "paint", eraser: getEraser("bria-video-erase-mask")!, points, range: { start: 3, end: 6 } }));
    expect(keys(part.steps)).toEqual(["range", "track", "erase0"]);
    expect(step(part.steps, "track")).toMatchObject({ after: ["range"], chain: [{ slot: "video" }] });
    expect(step(part.steps, "erase0")).toMatchObject({ after: ["range", "track"], chain: [{ slot: "video" }, { slot: "mask" }] });
  });
});

describe("Remove object: open pipelines", () => {
  const open = (over: Partial<RemovalPlanInput> & { eraserId?: string } = {}) => input({ engine: "open", eraser: getEraser("oss-vace-remove")!, ...over });

  it("Type it: one window per job straight from the upload, joined at the clip's size, sound put back", () => {
    const plan = planRemoval(open({ source: { ...src, duration: 8 }, range: { start: 0, end: 8 } }));
    expect(keys(plan.steps)).toEqual(["erase0", "erase1", "erase2", "join", "final"]);
    expect(step(plan.steps, "erase1").request).toMatchObject({ modelId: "oss-vace-remove", prompt: "the coffee cup", inputs: { video: src.url }, params: { startTime: 2.691667, endTime: 5.391667 } });
    expect(step(plan.steps, "erase1").after).toBeUndefined();
    expect(step(plan.steps, "join").request).toMatchObject({ modelId: "oss-join-clips", params: { aspectRatio: "auto", resolution: "720p" } });
    expect(step(plan.steps, "final").request).toMatchObject({ modelId: "oss-mux", inputs: { audio: src.url } });
  });

  it("folds joins four clips at a time on the open engine", () => {
    const plan = planRemoval(open({ source: { ...src, duration: 20 }, range: { start: 0, end: 20 } }));
    expect(plan.pieces).toHaveLength(8);
    const joins = plan.steps.filter((s) => s.request.op === "concat");
    expect(joins.map((s) => s.key)).toEqual(["join-0-0", "join-0-1", "join"]);
    expect(joins.every((s) => (s.after?.length ?? 0) <= 4)).toBe(true);
  });

  it("one window keeps its own sound: the eraser is the result", () => {
    const plan = planRemoval(open({ range: { start: 0, end: 2 } }));
    expect(keys(plan.steps)).toEqual(["erase0"]);
    expect(step(plan.steps, "erase0").request).toMatchObject({ feature: REMOVE.feature, title: "Remove · the cup" });
  });

  it("Paint it: each window starts from the mask the last one ended on", () => {
    const plan = planRemoval(open({ mode: "paint", eraser: getEraser("oss-vace-remove-painted")!, prompt: undefined, mask: "/api/files/uploads/mask.png", range: { start: 0, end: 8 } }));
    expect(step(plan.steps, "erase0").request).toMatchObject({ inputs: { video: src.url, mask: "/api/files/uploads/mask.png" } });
    expect(step(plan.steps, "erase0").request.prompt).toBeUndefined();
    expect(step(plan.steps, "erase1")).toMatchObject({ after: ["erase0"], chain: [{ slot: "mask" }], request: { inputs: { video: src.url } } });
    expect(step(plan.steps, "erase2")).toMatchObject({ after: ["erase1"], chain: [{ slot: "mask" }] });
    // Each later window starts on the frame its mask was tracked on, and loses that frame before the join.
    expect(step(plan.steps, "erase1").request.params).toMatchObject({ startTime: 2.658333, endTime: 5.358333 });
    // Only the windows a later one waits on save their last tracked mask.
    expect(step(plan.steps, "erase0").request.params?.extra).toEqual({ [HAND_OFF]: true });
    expect(step(plan.steps, "erase1").request.params?.extra).toEqual({ [HAND_OFF]: true });
    expect(step(plan.steps, "erase2").request.params?.extra).toBeUndefined();
    const one = planRemoval(open({ mode: "paint", eraser: getEraser("oss-vace-remove-painted")!, prompt: undefined, mask: "/api/files/uploads/mask.png", range: { start: 0, end: 2 } }));
    expect(keys(one.steps)).toEqual(["erase0"]);
    expect(step(one.steps, "erase0").request.params?.extra).toBeUndefined();
    expect(step(plan.steps, "keep1")).toMatchObject({ after: ["erase1"], chain: [{ slot: "video" }], request: { modelId: "oss-trim", op: "trim", params: { startTime: 0.025 } } });
    expect(step(plan.steps, "keep0")).toBeUndefined();
    expect(step(plan.steps, "join").after).toEqual(["erase0", "keep1", "keep2"]);
  });

  it("VOID windows are up to 197 frames", () => {
    const plan = planRemoval(open({ eraser: getEraser("oss-void-remove")!, range: { start: 0, end: 12 } }));
    expect(plan.pieces.map((p) => p.frames)).toEqual([181, 173]);
  });
});

describe("Remove object: mask previews", () => {
  it("cloud: SAM 3.1 on the first seconds, from words or points", () => {
    const steps = planMaskPreview({ engine: "cloud", mode: "type", title: "t", source: src, range: { start: 1, end: 12 }, prompt: REMOVE_EXAMPLES[0].prompt })!;
    expect(keys(steps)).toEqual(["cut", "preview"]);
    expect(step(steps, "cut").request.params).toEqual({ startTime: 1, endTime: 3 });
    expect(step(steps, "preview").request).toMatchObject({ feature: REMOVE.previewFeature, modelId: MASK_TRACKER, prompt: "the coffee cup", params: { duration: 2 } });
    const clicks = planMaskPreview({ engine: "cloud", mode: "click", title: "t", source: src, range: { start: 0, end: 1 }, points: [{ x: 1, y: 2 }] })!;
    expect(step(clicks, "preview").request).toMatchObject({ params: { points: [{ x: 1, y: 2 }], duration: 1 } });
  });

  it("says when the preview is the eraser's own mask, and when only SAM 3.1's reading of the words or clicks", () => {
    expect(previewIsEraserMask(getEraser("kling-o3")!, false)).toBe(false);
    expect(previewIsEraserMask(getEraser("bria-video-erase")!, false)).toBe(false);
    expect(previewIsEraserMask(getEraser("bria-video-erase-points")!, false)).toBe(false);
    // SAM 3.1's track is what Bria erases; fal builds VOID's mask with SAM 3; the open graphs track with SAM 3.1.
    expect(previewIsEraserMask(getEraser("bria-video-erase-points")!, true)).toBe(true);
    expect(previewIsEraserMask(getEraser("void-video-inpainting")!, false)).toBe(true);
    expect(previewIsEraserMask(getEraser("oss-vace-remove")!, false)).toBe(true);
  });

  it("open: the SAM 3 cut-out of what you typed; no preview for paint or clicks", () => {
    const steps = planMaskPreview({ engine: "open", mode: "type", title: "t", source: src, range: { start: 0, end: 12 }, prompt: "the dog" })!;
    expect(step(steps, "preview").request).toMatchObject({ modelId: "oss-video-matte-sam3", prompt: "the dog" });
    expect(step(steps, "cut").request.modelId).toBe("oss-trim");
    expect(planMaskPreview({ engine: "open", mode: "paint", title: "t", source: src, range: { start: 0, end: 12 } })).toBeNull();
    expect(planMaskPreview({ engine: "cloud", mode: "type", title: "t", source: src, range: { start: 0, end: 12 }, prompt: " " })).toBeNull();
  });
});
