import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  collectingShare,
  floored,
  isPoolRunWords,
  PROGRESS_BANDS,
  poolRunWords,
  progressPlan,
  progressView,
  runWords,
  trackReport,
  type LiveProgress,
  type ProgressPlan,
} from "@/lib/run-progress";
import { POOL_WORDS } from "@/lib/relay";

const graph = (name: string) => JSON.parse(fs.readFileSync(path.join(process.cwd(), "workflows", "comfyui", name), "utf8")) as Record<string, unknown>;

const SEC = 1000;

/**
 * A job's reports as a worker sends them, each followed by a poll (as the server reads them): the shares and stages
 * shown, the share floored by the highest shown before (as the server keeps it).
 */
function follow(plan: ProgressPlan | null, reports: { at: number; r: Record<string, unknown> }[], cold = false) {
  let p: LiveProgress | undefined = cold ? { cold: true } : undefined;
  const seen: { at: number; share: number; stage: string; words: string; r: Record<string, unknown> }[] = [];
  for (const { at, r } of reports) {
    p = trackReport(p, r, at);
    if (r.value !== undefined) delete p.cold;
    const v = progressView(p, plan, at);
    const share = floored(v.share, p.shown);
    p.shown = share;
    seen.push({ at, share, stage: v.stage, words: poolRunWords(v), r });
  }
  return seen;
}

/**
 * MiniMax H3 reference to video, taken cold: its loaders and encoders run first (16 nodes, five minutes of model load),
 * then its sampler's six steps (about a minute and a half each), then the decode, the sound and the file.
 */
function coldH3() {
  const out: { at: number; r: Record<string, unknown> }[] = [];
  let t = 0;
  // The model loads: nodes start one by one over five minutes, with a beat every 10 s.
  for (let n = 1; n <= 15; n++) {
    out.push({ at: t, r: { nodesDone: n, node: String(100 + n) } });
    t += 20 * SEC;
  }
  out.push({ at: t, r: { nodesDone: 16, node: "125" } });
  t += 10 * SEC;
  // The sampler's steps, with beats between them.
  for (let v = 0; v <= 6; v++) {
    out.push({ at: t, r: { nodesDone: 16, node: "125", value: v, max: 6 } });
    for (let b = 1; b <= 8; b++) out.push({ at: t + b * 10 * SEC, r: { nodesDone: 16, value: v, max: 6 } });
    t += 90 * SEC;
  }
  // After the sampler: the decode (a minute), the sound, the clip, its file.
  for (const [n, node, ms] of [[17, "122", 60], [18, "121", 10], [19, "130", 10], [20, "174", 10]] as const) {
    out.push({ at: t, r: { nodesDone: n, node } });
    t += ms * SEC;
  }
  return out;
}

describe("a graph's plan", () => {
  it("names the sampler of H3's reference to video and the nodes that read its result", () => {
    const plan = progressPlan(graph("minimax-h3-flex-ref2va.json"));
    expect(plan.samplers).toEqual(["125"]);
    // The video decode, the sound decode, the clip and its file.
    expect(plan.after).toBe(4);
    expect(plan.nodes).toBe(16);
  });

  it("never counts a sampler's settings node (KSamplerSelect, a pack's sampler choice) as a pass", () => {
    const plan = progressPlan(graph("minimax-h3-i2v.json"));
    expect(plan.samplers).toEqual(["125"]);
  });

  it("counts every sampler of a graph with several", () => {
    const plan = progressPlan({
      "1": { class_type: "CheckpointLoaderSimple", inputs: {} },
      "2": { class_type: "KSampler", inputs: { model: ["1", 0] } },
      "3": { class_type: "KSamplerAdvanced", inputs: { model: ["1", 0], latent_image: ["2", 0] } },
      "4": { class_type: "VAEDecode", inputs: { samples: ["3", 0] } },
      "5": { class_type: "SaveImage", inputs: { images: ["4", 0] } },
    });
    expect(plan.samplers).toEqual(["2", "3"]);
    expect(plan.after).toBe(2);
  });
});

describe("a cold H3 run's progress", () => {
  const plan = progressPlan(graph("minimax-h3-flex-ref2va.json"));
  const seen = follow(plan, coldH3(), true);

  it("while the model loads: a small share that grows slowly, with no jump, under its words", () => {
    const loading = seen.filter((s) => s.r.value === undefined && Number(s.r.nodesDone) <= 16);
    expect(loading.length).toBeGreaterThan(10);
    for (const s of loading) {
      expect(s.share).toBeLessThanOrEqual(PROGRESS_BANDS.ready);
      expect(s.stage).toBe("loading");
      expect(s.words).toBe(POOL_WORDS.gettingReady);
    }
    for (let i = 1; i < loading.length; i++) expect(loading[i].share - loading[i - 1].share).toBeLessThan(0.025);
    // 16 of 16 nodes started is not "nearly done".
    expect(loading.at(-1)!.share).toBeLessThan(0.11);
  });

  it("while it samples: the share follows the steps (step 3 of 6 is about half), never stalls high", () => {
    const at = (v: number) => seen.find((s) => s.r.value === v && s.r.node === "125")!;
    expect(at(3).share).toBeGreaterThan(0.45);
    expect(at(3).share).toBeLessThan(0.6);
    expect(at(3).words).toBe("Working · Step 3 of 6");
    for (let v = 1; v <= 6; v++) expect(at(v).share).toBeGreaterThan(at(v - 1).share + 0.1);
    // Between two steps it moves on by the time a step takes, never past the next step's share.
    const between = seen.filter((s) => s.r.value === 2 && s.r.node === undefined);
    for (let i = 1; i < between.length; i++) expect(between[i].share).toBeGreaterThan(between[i - 1].share);
    expect(between.at(-1)!.share).toBeLessThan(at(3).share);
    expect(at(6).share).toBeCloseTo(PROGRESS_BANDS.sampled);
  });

  it("after the sampler: the last few percent, never 100% before it is done", () => {
    const after = seen.filter((s) => Number(s.r.nodesDone) > 16);
    for (const s of after) {
      expect(s.stage).toBe("finishing");
      expect(s.words).toBe(POOL_WORDS.finishing);
      expect(s.share).toBeGreaterThanOrEqual(PROGRESS_BANDS.sampled);
      expect(s.share).toBeLessThanOrEqual(PROGRESS_BANDS.finished);
    }
    expect(collectingShare(0)).toBeGreaterThanOrEqual(after.at(-1)!.share);
    expect(collectingShare(1)).toBe(0.99);
  });

  it("never goes backwards and never reaches 1", () => {
    for (let i = 1; i < seen.length; i++) expect(seen[i].share).toBeGreaterThanOrEqual(seen[i - 1].share);
    for (const s of seen) expect(s.share).toBeLessThan(1);
  });
});

describe("following a job's reports", () => {
  it("clears a finished sampler's last step once the next node starts", () => {
    let p = trackReport(undefined, { nodesDone: 5, node: "9", value: 6, max: 6 }, 0);
    p = trackReport(p, { nodesDone: 6, node: "10" }, 1);
    expect(p.value).toBeUndefined();
    expect(p.max).toBeUndefined();
    expect(p.passes).toHaveLength(1);
  });

  it("a sampler that runs again from its first steps is a new pass", () => {
    let p = trackReport(undefined, { nodesDone: 5, node: "9", value: 6, max: 6 }, 0);
    p = trackReport(p, { nodesDone: 5, node: "9", value: 1, max: 6 }, 1);
    expect(p.passes).toHaveLength(2);
    // A late beat with a step before the last one is not.
    p = trackReport(p, { nodesDone: 5, value: 3, max: 6 }, 2);
    p = trackReport(p, { nodesDone: 5, value: 2, max: 6 }, 3);
    expect(p.passes).toHaveLength(2);
    expect(p.passes!.at(-1)!.value).toBe(3);
  });

  it("a graph with two sampler passes: each takes half of the sampling band, in order", () => {
    const plan: ProgressPlan = { nodes: 8, samplers: ["3", "5"], after: 2 };
    let p = trackReport(undefined, { nodesDone: 3, node: "3", value: 10, max: 10 }, 0);
    const first = progressView(p, plan, 0);
    expect(first.share).toBeCloseTo(PROGRESS_BANDS.ready + (PROGRESS_BANDS.sampled - PROGRESS_BANDS.ready) / 2);
    p = trackReport(p, { nodesDone: 4, node: "4" }, 1);
    expect(progressView(p, plan, 1)).toMatchObject({ stage: "sampling" });
    p = trackReport(p, { nodesDone: 5, node: "5", value: 5, max: 10 }, 2);
    expect(progressView(p, plan, 2).share).toBeCloseTo(PROGRESS_BANDS.ready + (PROGRESS_BANDS.sampled - PROGRESS_BANDS.ready) * 0.75);
  });

  it("a run sent before plans were kept: its steps lead", () => {
    // An older run's kept progress, with no passes: its step now.
    expect(progressView({ nodesDone: 16, node: "125", value: 3, max: 6 }, null, 0).share).toBeCloseTo(0.5);
    // A pass beyond the graph's own never takes the bar backwards or to 100%.
    const plan: ProgressPlan = { nodes: 4, samplers: ["2"], after: 1 };
    let p = trackReport(undefined, { nodesDone: 2, node: "2", value: 6, max: 6 }, 0);
    const one = progressView(p, plan, 0).share;
    p = trackReport(p, { nodesDone: 2, node: "2", value: 1, max: 6 }, 1);
    const two = progressView(p, plan, 1).share;
    expect(two).toBeGreaterThanOrEqual(one);
    expect(two).toBeLessThanOrEqual(PROGRESS_BANDS.extra);
  });

  it("its ComfyUI running the job again from the start starts its passes again", () => {
    let p = trackReport(undefined, { nodesDone: 9, node: "9", value: 4, max: 6 }, 0);
    p = trackReport(p, { nodesDone: 1, node: "1" }, 1);
    expect(p.passes).toBeUndefined();
  });
});

describe("its words", () => {
  it("a person's: the stage, with the step while it samples", () => {
    expect(poolRunWords({ stage: "loading" })).toBe("Loading the model");
    expect(poolRunWords({ stage: "preparing" })).toBe("Working");
    expect(poolRunWords({ stage: "sampling", step: { value: 3, max: 6 } })).toBe("Working · Step 3 of 6");
    expect(poolRunWords({ stage: "finishing" })).toBe("Finishing");
    for (const w of ["Loading the model", "Working", "Working · Step 3 of 6", "Finishing"]) expect(isPoolRunWords(w)).toBe(true);
    expect(isPoolRunWords("Making your clip · step 3 of 6")).toBe(false);
  });

  it("the owner's: the same stages, naming what it makes", () => {
    expect(runWords("video", { stage: "sampling", step: { value: 3, max: 6 } })).toBe("Making your clip · step 3 of 6");
    expect(runWords("video", { stage: "finishing" })).toBe("Finishing your clip");
    expect(runWords("video", { stage: "loading" })).toBe("Loading the model");
  });
});
