import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Generation } from "@/lib/catalog/types";
import { detectCuts, finalKey, KEYFRAME_OFFSET, katanaStage, katanaSteps, nearestAspect, OPEN_KEYFRAME_PHOTOS, planSegments, refineCut, refineTimes, stepsToRedo } from "@/lib/av/katana";
import { frameParams, frameRequest } from "@/lib/av/frames";
import { tempDir } from "./helpers/temp-dir";

vi.setConfig({ testTimeout: 150_000 });

const dir = tempDir("fuobe-av-katana-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const katana = await import("@/server/katana");
const { getTool } = await import("@/server/assist/tools");
const { saveFile } = await import("@/server/storage");

beforeAll(() => setSetting("demoMode", "auto"));

async function settle(id: string, ms = 140_000): Promise<Generation> {
  const end = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const file = (name: string, type: string) => saveFile({ data: fs.readFileSync(path.join(process.cwd(), "public/samples", name)), contentType: type, source: "upload" }).url;

describe("katana segment planning", () => {
  it("finds scene cuts as spikes over the clip's usual change", () => {
    const times = Array.from({ length: 21 }, (_, i) => i * 0.5);
    const diffs = times.slice(1).map((_, i) => (i === 5 || i === 13 ? 0.6 : i === 14 ? 0.5 : 0.02));
    // Spikes between 2.5–3.0 s and 6.5–7.0 s; the one right after (7.0–7.5) is within the minimum gap.
    // Each cut is the first sample of the new shot, never the midpoint (which lies in the old shot).
    expect(detectCuts(diffs, times)).toEqual([3, 7]);
    expect(detectCuts(diffs.map(() => 0.03), times)).toEqual([]);
  });

  it("places a cut that falls between samples at or after the real cut, so the segment opens on the new shot", () => {
    // Hard cuts at 4.0 s and 7.0 s, sampled every 1/6 s from 0.08 s (as the studio does, off the frame grid).
    const shotAt = (t: number) => (t < 4 ? 0 : t < 7 ? 1 : 2);
    const times = Array.from({ length: 60 }, (_, i) => 0.08 + i / 6);
    const diffs = times.slice(1).map((t, i) => (shotAt(t) !== shotAt(times[i]) ? 0.7 : 0.02));
    const cuts = detectCuts(diffs, times);
    expect(cuts).toHaveLength(2);
    cuts.forEach((c, i) => {
      expect(c).toBeGreaterThanOrEqual([4, 7][i]);
      expect(shotAt(c)).toBe(i + 1);
      expect(c - [4, 7][i]).toBeLessThan(1 / 6 + 0.01);
    });
    // Refined with finer samples between the two around the jump: within a 30 fps frame of the cut.
    const fine = refineTimes(times[23], times[24]);
    const at = refineCut(fine.slice(1).map((t, k) => (shotAt(t) !== shotAt(fine[k]) ? 0.7 : 0.02)), fine);
    expect(at).toBeGreaterThanOrEqual(4);
    expect(at - 4).toBeLessThan(1 / 30 + 0.01);
    // The planned segments start at the cuts: every segment's keyframe is in its own shot.
    const segs = planSegments({ duration: 10, mode: "scenes", cuts, min: 1, max: 5 });
    expect(segs.map((s) => shotAt(s.start))).toEqual([0, 1, 2]);
    expect(segs.map((s) => shotAt(s.start + KEYFRAME_OFFSET))).toEqual([0, 1, 2]);
  });

  it("never plans past the end of the file (the end rounds down)", () => {
    expect(planSegments({ duration: 10.008, mode: "fixed", length: 5, min: 1, max: 5 }).at(-1)!.end).toBe(10);
    expect(planSegments({ duration: 10.008, mode: "scenes", cuts: [3.001], min: 1, max: 5 }).at(-1)!.end).toBe(10);
  });

  it("cuts every N seconds, evenly, within the model's limits", () => {
    expect(planSegments({ duration: 12, mode: "fixed", length: 5, min: 3, max: 5 })).toEqual([
      { start: 0, end: 4 },
      { start: 4, end: 8 },
      { start: 8, end: 12 },
    ]);
    expect(planSegments({ duration: 4, mode: "fixed", length: 10, min: 3, max: 10 })).toEqual([{ start: 0, end: 4 }]);
    // References over 30 s are cut to the first 30 s.
    expect(planSegments({ duration: 45, mode: "fixed", length: 10, min: 3, max: 10 }).at(-1)!.end).toBe(30);
  });

  it("follows the scene cuts: short scenes join a neighbour, long ones are split", () => {
    expect(planSegments({ duration: 12, mode: "scenes", cuts: [0.5, 4, 4.8, 9], min: 1, max: 5 })).toEqual([
      { start: 0, end: 4.8 },
      { start: 4.8, end: 9 },
      { start: 9, end: 12 },
    ]);
    expect(planSegments({ duration: 14, mode: "scenes", cuts: [], min: 1, max: 5 })).toEqual([
      { start: 0, end: 4.67 },
      { start: 4.67, end: 9.33 },
      { start: 9.33, end: 14 },
    ]);
    expect(() => planSegments({ duration: 30, mode: "fixed", length: 1, min: 1, max: 1 })).toThrow(/up to 12/);
  });

  it("picks the nearest render shape", () => {
    expect(nearestAspect(1920, 1080)).toBe("16:9");
    expect(nearestAspect(1080, 1920)).toBe("9:16");
    expect(nearestAspect(1000, 1100)).toBe("1:1");
  });
});

describe("frame requests", () => {
  it("cloud: first/last frame; open: a decoded window", () => {
    expect(frameParams("cloud", "last")).toEqual({ extra: { frame_type: "last" } });
    expect(() => frameParams("cloud", { at: 2 })).toThrow(/trim the clip first/);
    expect(frameParams("open", "last")).toBeUndefined();
    expect(frameParams("open", { at: 2.5 })).toEqual({ startTime: 2.5, endTime: 3, extra: { frameIndex: 0 } });
    expect(frameRequest({ feature: "x", engine: "open", video: "/v.mp4", pick: "first" })).toMatchObject({ modelId: "oss-extract-frame", op: "frame", inputs: { video: "/v.mp4" }, params: { startTime: 0 } });
  });
});

describe("katana steps", () => {
  const segments = [
    { start: 0, end: 4 },
    { start: 4, end: 8 },
  ];
  const photos = ["/a.png", "/b.png", "/c.png"];

  it("open: cut → first frame → your subject → Wan Animate per segment, joined, original sound", () => {
    const steps = katanaSteps({ engine: "open", reference: "/ref.mp4", photos, segments, aspectRatio: "9:16", title: "My edit" });
    expect(steps.map((s) => [s.key, s.request.modelId, s.request.op])).toEqual([
      ["cut0", "oss-segment", "trim"],
      ["frame0", "oss-extract-frame", "frame"],
      ["key0", "oss-qwen-image-21-turbo", "edit"],
      ["move0", "fuobe-genjutsu-motion", "motion-transfer"],
      ["cut1", "oss-segment", "trim"],
      ["frame1", "oss-extract-frame", "frame"],
      ["key1", "oss-qwen-image-21-turbo", "edit"],
      ["move1", "fuobe-genjutsu-motion", "motion-transfer"],
      ["join", "oss-join-clips", "concat"],
      ["final", "oss-mux", "mux"],
    ]);
    expect(steps[0].request.params).toMatchObject({ startTime: 0, endTime: 4, aspectRatio: "9:16" });
    // The keyframe is taken a few frames in, clear of a cut's edge.
    expect(steps[1].request.params).toEqual({ startTime: KEYFRAME_OFFSET, endTime: KEYFRAME_OFFSET + 0.5, extra: { frameIndex: 0 } });
    // The open motion model is told the segment's length (Fun Control would render its 81-frame default).
    expect(steps[3].request.params).toMatchObject({ duration: 4, resolution: "480p" });
    // Qwen-Image 2.1 Turbo gets the frame first, then three photos (its four images).
    expect(OPEN_KEYFRAME_PHOTOS).toBe(3);
    expect(steps[2]).toMatchObject({ after: "frame0", chain: [{ slot: "images", position: "first" }], request: { inputs: { images: ["/a.png", "/b.png", "/c.png"] } } });
    expect(steps[2].request.prompt).toMatch(/^Replace the main subject of image 1 with the subject shown in images 2 to 4, /);
    expect(katanaSteps({ engine: "open", reference: "/ref.mp4", photos: [...photos, "/d.png"], segments })[2].request.inputs?.images).toEqual(photos);
    expect(steps[3]).toMatchObject({ after: ["key0", "cut0"], chain: [{ slot: "images", position: "first" }, { slot: "video" }] });
    expect(steps[8]).toMatchObject({ after: ["move0", "move1"], chain: [{ slot: "videos" }, { slot: "videos" }] });
    expect(steps[9]).toMatchObject({ after: "join", chain: [{ slot: "video" }], request: { inputs: { audio: "/ref.mp4" } } });
    expect(finalKey(steps)).toBe("final");
  });

  it("open Wan Fun Control renders each segment as long as it is", async () => {
    const segs = [
      { start: 0, end: 3 },
      { start: 3, end: 7.5 },
    ];
    const steps = katanaSteps({ engine: "open", reference: "/r.mp4", photos, segments: segs, motionModel: "oss-wan22-fun-control" });
    const moves = steps.filter((s) => s.key.startsWith("move"));
    expect(moves.map((s) => s.request.params?.duration)).toEqual([3, 4.5]);
    // …which the ComfyUI provider turns into the 4n+1 frame count for that span at 16 fps (3 s → 49, not 81).
    const { prepareWorkflow } = await import("@/server/providers/comfyui");
    const { workflow, manifest } = await prepareWorkflow("wan22-fun-control-14b", { prompt: "p", images: ["k.png"], video: "cut.mp4", duration: 3, aspectRatio: "16:9", resolution: "480p" }, { generationId: "g", op: "motion-transfer", upload: async () => "x" });
    const frames = manifest.bindings.frames!.map((t) => workflow[t.node].inputs[t.input]);
    expect(frames.every((f) => f === 49)).toBe(true);
  });

  it("a retry redoes the failed steps and everything after them, nothing before", () => {
    const steps = katanaSteps({ engine: "open", reference: "/r.mp4", photos, segments });
    expect(stepsToRedo(steps, ["move1"])).toEqual(["move1", "join", "final"]);
    expect(stepsToRedo(steps, ["frame0"])).toEqual(["frame0", "key0", "move0", "join", "final"]);
  });

  it("open joins fold 4 clips at a time", () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ start: i * 4, end: i * 4 + 4 }));
    const steps = katanaSteps({ engine: "open", reference: "/r.mp4", photos, segments: six, keepAudio: false });
    const joins = steps.filter((s) => s.request.op === "concat");
    expect(joins.map((s) => [s.key, s.after])).toEqual([
      ["join0", ["move0", "move1", "move2", "move3"]],
      ["join", ["join0", "move4", "move5"]],
    ]);
    expect(finalKey(steps)).toBe("join");
  });

  it("cloud: trim → first frame → Nano Banana Pro → Kling O3 edit with the new keyframe first", () => {
    const steps = katanaSteps({ engine: "cloud", reference: "/ref.mp4", photos, segments });
    expect(steps.slice(0, 4).map((s) => [s.key, s.request.modelId])).toEqual([
      ["cut0", "trim-video"],
      ["frame0", "extract-frame"],
      ["key0", "nano-banana-pro"],
      ["move0", "kling-o3"],
    ]);
    expect(steps[1].request.params).toEqual({ extra: { frame_type: "first" } });
    expect(steps[3]).toMatchObject({ after: ["cut0", "key0"], chain: [{ slot: "video" }, { slot: "images", position: "first" }], request: { op: "v2v", inputs: { images: ["/a.png", "/b.png", "/c.png"] } } });
    expect(steps.at(-1)!.request.modelId).toBe("merge-audio-video");
  });

  it("refuses segments the motion model can't take", () => {
    expect(() => katanaSteps({ engine: "open", reference: "/r", photos, segments: [{ start: 0, end: 8 }] })).toThrow(/up to 5 s/);
    expect(() => katanaSteps({ engine: "cloud", reference: "/r", photos, segments: [{ start: 0, end: 2 }] })).toThrow(/at least 3 s/);
    expect(() => katanaSteps({ engine: "cloud", reference: "/r", photos: [], segments })).toThrow(/at least one photo/);
  });
});

describe("katana runs (demo mode)", () => {
  it("runs every step and finishes with the edit", async () => {
    const reference = file("demo-portrait.mp4", "video/mp4");
    const photo = file("grade-sample.jpg", "image/jpeg");
    const preview = katana.previewKatana({ engine: "open", reference, photos: [photo], duration: 8, length: 4 });
    expect(preview.segments).toHaveLength(2);
    expect(preview.steps).toBe(10);
    const job = katana.createKatana({ engine: "open", reference, photos: [photo], duration: 8, length: 4, instructions: "keep the red jacket", title: "Dance" });
    expect(Object.keys(job.steps)).toHaveLength(10);
    expect(job.generations[job.steps.key0].request.prompt).toContain("keep the red jacket");
    const final = await settle(job.steps[job.final]);
    expect(final.status).toBe("succeeded");
    expect(katanaStage(katana.getKatana(job.id)!)).toBe("done");
    expect(katana.listKatana().map((j) => j.id)).toContain(job.id);
  });

  it("a failed step can be retried without redoing what finished; removing a run stops it", async () => {
    const reference = file("demo-portrait.mp4", "video/mp4");
    const photo = file("grade-sample.jpg", "image/jpeg");
    const job = katana.createKatana({ engine: "open", reference, photos: [photo], duration: 8, length: 4, title: "Retry me" });
    expect((await settle(job.steps[job.final])).status).toBe("succeeded");
    // Pretend the second segment's motion step failed.
    const { db } = await import("@/server/db");
    db().prepare("UPDATE generations SET status = 'failed', error = 'GPU out of memory' WHERE id = ?").run(job.steps.move1);
    expect(katanaStage(katana.getKatana(job.id)!)).toBe("failed");
    const retried = katana.retryKatana(job.id);
    for (const k of ["cut0", "frame0", "key0", "move0", "cut1", "frame1", "key1"]) expect(retried.steps[k]).toBe(job.steps[k]);
    for (const k of ["move1", "join", "final"]) expect(retried.steps[k]).not.toBe(job.steps[k]);
    expect(retried.replaced?.move1).toEqual([job.steps.move1]);
    expect(gens.getGeneration(retried.steps.move1)!.batchId).toBe(job.batchId);
    expect((await settle(retried.steps[retried.final])).status).toBe("succeeded");
    expect(katanaStage(katana.getKatana(job.id)!)).toBe("done");
    expect(() => katana.retryKatana(job.id)).toThrow(/No step failed/);
    // Run again: a new run with the same settings.
    const again = katana.rerunKatana(job.id);
    expect(again.id).not.toBe(job.id);
    expect(again.segments).toEqual(job.segments);
    expect(katana.deleteKatana(again.id)).toBe(true);
    for (const id of Object.values(again.steps)) expect(["canceled", "succeeded"]).toContain((await settle(id)).status);
    expect(Object.values(again.steps).some((id) => gens.getGeneration(id)!.status === "canceled")).toBe(true);
  });

  it("is an Assist tool with a priced plan", () => {
    const reference = file("demo-landscape.mp4", "video/mp4");
    const photo = file("grade-sample.jpg", "image/jpeg");
    const tool = getTool("katana")!;
    expect(tool.gated).toBe(true);
    const [job] = tool.plan!({ reference, photos: [photo], segment_seconds: 4 }, { engine: "open" });
    expect(job).toMatchObject({ tool: "katana", kind: "video", modelId: "fuobe-genjutsu-motion" });
    expect(job.error).toBeUndefined();
    expect(tool.plan!({ reference: "nope", photos: [] }, { engine: "cloud" })[0].error).toBeTruthy();
  });
});
