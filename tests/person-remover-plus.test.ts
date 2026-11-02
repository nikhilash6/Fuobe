import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { h3Canvas, H3_REMOVAL_WORKFLOW } from "@/lib/catalog/character-swap";
import { planGeneration } from "@/lib/catalog/plan";
import {
  getEraser,
  maskGrowOf,
  PERSON_REMOVAL_FPS,
  PERSON_REMOVAL_TOOLS,
  planMaskPreview,
  planRemoval,
  previewIsGreen,
  REMOVE,
  rerollControls,
  rerollProblem,
  reuseOf,
  REVIEW_EXTRA,
  reviewOfOutput,
  reviewOfRun,
  windowArtifact,
  type RemovalPlanInput,
  type RemovalReview,
} from "@/lib/catalog/remove-object";
import type { GenInput } from "@/lib/catalog/types";
import type { ManifestWorkflow } from "@/lib/comfy";

// H3 Person Remover, everywhere (o/person-remover-plus): mask first, window review and "Redo from here".
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-person-remover-plus-"));
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { runAsTenant } = await import("@/server/tenant");
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "../workflows/comfyui/manifest.json"), "utf8")) as { workflows: ManifestWorkflow[] };
const src = { url: "/api/files/uploads/clip.mp4", duration: 12, fps: 30, width: 1280, height: 720, hasAudio: true };
const eraser = getEraser("oss-h3-person-remove")!;
const input = (over: Partial<RemovalPlanInput> = {}): RemovalPlanInput => ({
  engine: "open",
  mode: "type",
  eraser,
  title: "Remove · the man in the grey shirt",
  source: src,
  range: { start: 2, end: 9 },
  prompt: "Remove the man in the grey shirt",
  ...over,
});

describe("mask first: the green mask preview", () => {
  it("fits the first seconds like the removal and runs the removal's own SAM 3.1 chain, filled green", () => {
    expect(previewIsGreen(eraser)).toBe(true);
    expect(previewIsGreen(getEraser("oss-vace-remove"))).toBe(false);
    const steps = planMaskPreview(input({ maskGrow: 12 }))!;
    expect(steps.map((s) => s.key)).toEqual(["cut", "preview"]);
    expect(steps[0].request).toMatchObject({
      modelId: PERSON_REMOVAL_TOOLS.fit,
      op: "trim",
      inputs: { video: src.url },
      params: { startTime: 2, endTime: 2 + REMOVE.previewSeconds, fps: PERSON_REMOVAL_FPS, extra: h3Canvas(1280, 720, "768p") },
    });
    expect(steps[1].request).toMatchObject({
      feature: REMOVE.previewFeature,
      modelId: "oss-h3-removal-mask",
      op: "bg-remove-video",
      prompt: "the man in the grey shirt",
      params: { extra: { maskPrompt: "the man in the grey shirt", maskGrow: 12 } },
    });
    expect(steps[1].chain).toEqual([{ slot: "video" }]);
    for (const s of steps) {
      const chained = s.chain?.length ? { video: "/api/files/x.mp4" } : {};
      expect(() => planGeneration({ ...s.request, inputs: { ...s.request.inputs, ...chained } }, getModel, getPreset), s.key).not.toThrow();
    }
  });

  it("the expansion is whole pixels within its range and reaches the removal", () => {
    expect([maskGrowOf(undefined), maskGrowOf(-3), maskGrowOf(7.4), maskGrowOf(500)]).toEqual([undefined, 0, 7, REMOVE.maskGrow.max]);
    const erase = planRemoval(input({ maskGrow: 9, seed: 3 })).steps.find((s) => s.key === "erase0")!;
    expect(erase.request.params).toEqual({ seed: 3, extra: { maskGrow: 9 } });
    expect(planRemoval(input()).steps.find((s) => s.key === "erase0")!.request.params).toBeUndefined();
  });

  it("the preview graph is the removal graph's SAM chain, node for node, and validated on core nodes", async () => {
    const mask = manifest.workflows.find((w) => w.id === "video-person-remove-h3-mask")!;
    expect(mask).toMatchObject({ capability: "person-mask", validated: true });
    expect(mask.customNodes ?? []).toEqual([]);
    const read = (id: string) => JSON.parse(fs.readFileSync(path.join(__dirname, `../workflows/comfyui/${id}.json`), "utf8"));
    const a = read("video-person-remove-h3-mask");
    const b = read(H3_REMOVAL_WORKFLOW);
    for (const n of ["sam", "detect", "track", "mask", "binary_mask", "grow_mask", "green", "green_guide"]) expect(a[n], n).toEqual(b[n]);
    const wf = (await prepareWorkflow("video-person-remove-h3-mask", { video: "fit.mp4", prompt: "the man", extra: { maskPrompt: "the man", maskGrow: 12 } } as GenInput, { generationId: "p1", op: "bg-remove-video", upload: async (_d, _t, n) => n })).workflow as Record<string, { inputs: Record<string, unknown> }>;
    expect([wf.source.inputs.file, wf.subject.inputs.text, wf.grow_mask.inputs.expand, wf.save.inputs.filename_prefix]).toEqual(["fit.mp4", "the man", 12, "fuobe/p1"]);
  });
});

const run = {
  run_id: "a".repeat(32),
  config_key: "c".repeat(64),
  seed: "904234",
  total: 3,
  status: "complete",
  segments: [
    { index: 1, start: 22, frames: 22, record_id: "2".repeat(32), seed: "904235", reused: false, video: { filename: "window-002.mp4", subfolder: `__h3_removal_cache/previews/${"a".repeat(32)}`, type: "output" } },
    { index: 0, start: 0, frames: 22, record_id: "1".repeat(32), seed: "904234", reused: true, poster: { filename: "window-001.jpg", subfolder: `__h3_removal_cache/previews/${"a".repeat(32)}`, type: "output" } },
    { index: 2, start: 44, frames: 20, record_id: "3".repeat(32), seed: "904236", video: { filename: "../../etc/passwd", subfolder: "x", type: "output" } },
  ],
};
const reuse = { video: "fuobe_abcdefgh.mp4", image: "fuobe_ijklmnop.png", prefix: "fuobe/g1" };

describe("window review: what the Relay reports", () => {
  it("keeps each window's checkpoint, seed and preview, and only ComfyUI output files of the run", () => {
    const read = reviewOfRun(run, reuse, (f) => `http://comfy/view?${new URLSearchParams(f)}`)!;
    expect(read.review).toMatchObject({ runId: run.run_id, configKey: run.config_key, seed: "904234", total: 3, reuse });
    expect(read.review.windows.map((w) => [w.index, w.recordId, w.seed, !!w.reused])).toEqual([
      [0, "1".repeat(32), "904234", true],
      [1, "2".repeat(32), "904235", false],
      [2, "3".repeat(32), "904236", false],
    ]);
    expect(read.review.windows[0].poster).toBe(windowArtifact(0, "poster"));
    expect(read.review.windows[1].video).toBe(windowArtifact(1, "video"));
    expect(read.review.windows[2].video).toBeUndefined();
    expect(Object.keys(read.artifacts).sort()).toEqual(["window-001-poster", "window-002"]);
    expect(read.artifacts["window-002"]).toContain("subfolder=__h3_removal_cache");
    expect(reviewOfRun({ nope: 1 }, reuse, () => "")).toBeNull();
    expect(reviewOfOutput({ review: read.review, artifacts: { "window-002": "/api/files/w2.mp4" } })?.links).toEqual({ "window-002": "/api/files/w2.mp4" });
  });

  it("only plain ComfyUI names are sent again", () => {
    expect(reuseOf(reuse)).toEqual(reuse);
    expect(reuseOf({ ...reuse, video: "../secret.mp4" })).toBeNull();
    expect(reuseOf({ ...reuse, prefix: "elsewhere/g1" })).toBeNull();
    expect(reuseOf("x")).toBeNull();
  });
});

describe("Redo from here", () => {
  const review: RemovalReview = reviewOfRun(run, reuse, () => "x")!.review;

  it("locks every window before it to its checkpoint and draws it with the new seed", () => {
    expect(JSON.parse(rerollControls(review, 2, 42)!)).toEqual({
      config_key: run.config_key,
      windows: { "0": { seed: "904234", locked: true, record_id: "1".repeat(32) }, "1": { seed: "904235", locked: true, record_id: "2".repeat(32) }, "2": { seed: "42", locked: false } },
    });
    expect(JSON.parse(rerollControls(review, 0, 7)!).windows).toEqual({ "0": { seed: "7", locked: false } });
    expect(rerollProblem(review, 1)).toBeNull();
    expect(rerollProblem(review, 3)).toMatch(/Pick one/);
    expect(rerollProblem(null, 0)).toMatch(/no window previews/);
    const gap = { ...review, windows: review.windows.map((w) => (w.index === 0 ? { ...w, recordId: undefined } : w)) };
    expect(rerollProblem(gap, 2)).toMatch(/redo from window 1/);
    expect(rerollControls(gap, 2, 1)).toBeNull();
  });

  it("the graph gets the controls, and the original run's inputs and prefix so the Relay keeps its checkpoints", async () => {
    const controls = rerollControls(review, 1, 42)!;
    const prep = (extra: Record<string, unknown>) =>
      prepareWorkflow(H3_REMOVAL_WORKFLOW, { video: "new_fit.mp4", images: ["new_clean.png"], prompt: "the man", seed: 904234, extra } as GenInput, { generationId: "g2", op: "remove-object", upload: async (_d, _t, n) => n });
    const r = await prep({ [REVIEW_EXTRA.controls]: controls, [REVIEW_EXTRA.reuse]: reuse });
    const wf = r.workflow as Record<string, { inputs: Record<string, unknown> }>;
    expect(wf.review.inputs.window_controls).toBe(controls);
    expect([wf.source.inputs.file, wf.anchor.inputs.image, wf.save.inputs.filename_prefix, wf.plan.inputs.seed]).toEqual([reuse.video, reuse.image, reuse.prefix, 904234]);
    expect(r.meta.reviewInputs).toEqual(reuse);
    // A first run: its own inputs and prefix are what a later reroll sends again.
    const first = await prep({});
    expect((first.workflow as Record<string, { inputs: Record<string, unknown> }>).review.inputs.window_controls).toBe("{}");
    expect(first.meta.reviewInputs).toEqual({ video: "new_fit.mp4", image: "new_clean.png", prefix: "fuobe/g2" });
    // Never another run's files for an account's run.
    const account = await runAsTenant({ kind: "account", id: "acc1" }, () => prep({ [REVIEW_EXTRA.reuse]: reuse }));
    expect((account.workflow as Record<string, { inputs: Record<string, unknown> }>).source.inputs.file).toBe("new_fit.mp4");
  });
});
