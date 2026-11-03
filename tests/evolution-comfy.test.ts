import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INTENSITIES, planEvolution } from "@/lib/catalog/evolution";
import type { GenInput } from "@/lib/catalog/types";
import type { MediaInfo } from "@/lib/media-probe";
import { tempDir } from "./helpers/temp-dir";

// The comfyui provider driving Fuobe Evolution's GPU graph (video-evolution-wan22-fun-vace), bound for real on the
// library graph, with a planned segment going through it.
const tmp = tempDir("fuobe-evolution-comfy-");
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow } = await import("@/server/providers/comfyui");

const seg: MediaInfo = { container: "mp4", hasVideo: true, hasAudio: false, duration: 61 / 16, videoDuration: 61 / 16, width: 848, height: 480, fps: 16, frames: 61 };
const at = (wf: Record<string, { inputs: Record<string, unknown> }>, node: string, input: string) => wf[node]?.inputs[input];

describe("Fuobe Evolution's GPU graph through the provider", () => {
  it("a planned segment: the direction, the direction frame, its frame count, the intensity's denoise", async () => {
    const plan = planEvolution({
      engine: "open",
      title: "Evolution",
      source: { url: "/api/files/clip.mp4", duration: 12, fps: 30, width: 1280, height: 720, hasAudio: false },
      range: { start: 0, end: 12 },
      intensity: "low",
      direction: "A lantern-lit night market in the rain.",
      references: [],
      seed: 9,
    });
    const req = plan.steps.find((s) => s.key === "evolve2")!.request;
    const { workflow: wf } = await prepareWorkflow(
      "video-evolution-wan22-fun-vace",
      { prompt: req.prompt, video: "seg.mp4", images: ["frame.png"], ...req.params } as GenInput,
      { generationId: "g1", op: "v2v", upload: async (_d, _t, name) => `up_${name}`, media: (n) => (n === "seg.mp4" ? seg : undefined) },
    );
    expect(at(wf, "12", "text")).toBe("A lantern-lit night market in the rain.");
    expect(at(wf, "1", "video")).toBe("seg.mp4");
    expect(at(wf, "1", "force_rate")).toBe(16);
    expect(at(wf, "4", "image")).toBe("frame.png");
    expect(at(wf, "45", "value")).toBe(0.45);
    expect(at(wf, "22", "noise_seed")).toBe(9);
    // The segment's own frame count (4n + 1), so the source latent lines up with VACE's.
    expect(at(wf, "30", "value")).toBe(Math.round(req.params!.duration! * 16));
    expect((at(wf, "30", "value") as number) % 4).toBe(1);
    // The schedule is computed in the graph: 4 steps run, the first sampler's expert picked by the switch point.
    expect(at(wf, "46", "value")).toBe(4);
    expect(at(wf, "22", "start_at_step")).toEqual(["48", 1]);
    expect(at(wf, "23", "start_at_step")).toEqual(["49", 1]);
    expect(at(wf, "22", "model")).toEqual(["52", 0]);
  });

  it("a whole clip from Edit video (24 fps, shorter than asked): loaded at 16 fps, every length is the loaded count", async () => {
    // 2 s at 24 fps with duration 5 asked for: 81 frames at most, the loader keeps what the clip has (29 at 16 fps).
    const clip: MediaInfo = { container: "mp4", hasVideo: true, hasAudio: true, duration: 2, videoDuration: 2, width: 1280, height: 720, fps: 24, frames: 48 };
    const { workflow: wf } = await prepareWorkflow(
      "video-evolution-wan22-fun-vace",
      { prompt: "A night market", video: "clip.mp4", images: ["frame.png"], aspectRatio: "auto", resolution: "480p", duration: 5, extra: { denoise: 0.85 } } as GenInput,
      { generationId: "g2", op: "v2v", upload: async (_d, _t, name) => `up_${name}`, media: (n) => (n === "clip.mp4" ? clip : undefined) },
    );
    expect(at(wf, "1", "video")).toBe("clip.mp4");
    expect(wf["1"].class_type).toBe("VHS_LoadVideo");
    expect(at(wf, "1", "force_rate")).toBe(16);
    expect(at(wf, "1", "format")).toBe("Wan");
    expect(at(wf, "30", "value")).toBe(81);
    expect(at(wf, "1", "frame_load_cap")).toEqual(["30", 0]);
    // VACE's length, the depth control and the source latent all come from the frames loaded, never from `frames`.
    expect(at(wf, "15", "length")).toEqual(["1", 1]);
    expect(at(wf, "15", "control_video")).toEqual(["9", 0]);
    expect(at(wf, "42", "pixels")).toEqual(["3", 0]);
    expect(at(wf, "3", "image")).toEqual(["1", 0]);
    expect(at(wf, "26", "fps")).toBe(16);
    expect(at(wf, "26", "audio")).toEqual(["1", 2]);
    const linksTo30 = Object.entries(wf).flatMap(([id, n]) => Object.entries(n.inputs).filter(([, v]) => Array.isArray(v) && v[0] === "30").map(([k]) => `${id}.${k}`));
    expect(linksTo30).toEqual(["1.frame_load_cap"]);
    expect(at(wf, "45", "value")).toBe(0.85);
  });
});

// ComfyUI's simple scheduler on a flow model with shift s: step k of n is at t = (1000 - floor(k * 1000 / n)) / 1000.
const sigmaAt = (k: number, n: number, s: number) => {
  const t = (1000 - Math.floor((k * 1000) / n)) / 1000;
  return (s * t) / (1 + (s - 1) * t);
};

describe("Fuobe Evolution's schedule (the graph's own expressions)", () => {
  const graph = JSON.parse(fs.readFileSync(path.join(process.cwd(), "workflows/comfyui/video-evolution-wan22-fun-vace.json"), "utf8")) as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  // simpleeval's functions, as ComfyMathExpression offers them.
  const evalNode = (id: string, values: Record<string, number>) => {
    const expr = String(graph[id].inputs.expression);
    const names = Object.keys(values);
    return Math.trunc(new Function("min", "max", "round", "floor", ...names, `return (${expr});`)(Math.min, Math.max, Math.round, Math.floor, ...names.map((n) => values[n])));
  };
  const schedule = (denoise: number) => {
    const steps = Number(graph["46"].inputs.value);
    const shift = Number(graph["50"].inputs.value);
    const sw = Number(graph["51"].inputs.value);
    const n = evalNode("47", { a: steps, b: denoise, c: shift });
    const start = evalNode("48", { a: steps, b: n });
    const high = evalNode("53", { a: steps, b: n, c: shift, d: sw });
    const handover = evalNode("49", { a: steps, b: n, c: high });
    return { n, start, high, handover, sigma: sigmaAt(start, n, shift), shift, sw, steps };
  };

  it("each intensity starts within a few hundredths of its denoise, and they differ (high is not full noise)", () => {
    const sigmas = INTENSITIES.map((i) => {
      const s = schedule(i.denoise);
      expect(s.n - s.start).toBe(s.steps);
      expect(Math.abs(s.sigma - i.denoise)).toBeLessThan(0.03);
      return s.sigma;
    });
    expect(new Set(sigmas.map((x) => x.toFixed(3))).size).toBe(3);
    expect(sigmas[2]).toBeLessThan(0.9);
    // Full denoise is the restyle graph's schedule: 4 steps, 2 on each expert.
    expect(schedule(1)).toMatchObject({ n: 4, start: 0, high: 2, handover: 2 });
  });

  it("tunable between 0.8 and 1: 0.9 and 0.95 start where they say", () => {
    for (const d of [0.9, 0.95]) expect(Math.abs(schedule(d).sigma - d)).toBeLessThan(0.03);
  });

  it("the high-noise expert only takes steps at or above Wan 2.2's switch point", () => {
    for (const d of [0.3, 0.45, 0.65, 0.85, 0.9, 0.95, 1]) {
      const s = schedule(d);
      for (let k = s.start; k < s.n; k++) {
        const onHigh = s.high > 0 && k < s.handover;
        expect(onHigh, `denoise ${d}, step ${k}`).toBe(sigmaAt(k, s.n, s.shift) >= s.sw);
      }
      // The switch hands the first sampler the low-noise expert when no step is the high one's.
      expect(s.high > 0).toBe(s.sigma >= s.sw);
      expect(s.handover).toBeGreaterThan(s.start);
    }
    expect(graph["52"]).toMatchObject({ class_type: "ComfySwitchNode", inputs: { switch: ["53", 2], on_true: ["20", 0], on_false: ["21", 0] } });
  });
});
