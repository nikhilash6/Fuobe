import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { onEngine } from "@/lib/catalog/engines";
import {
  denoiseFor,
  directionFramePrompt,
  directionPrompt,
  directionRequest,
  EVOLUTION,
  evolutionProblem,
  evolutionTitle,
  INTENSITIES,
  nearestShape,
  offlineDirection,
  planEvolution,
  tidyDirection,
  videoStrengthFor,
  type EvolutionPlanInput,
} from "@/lib/catalog/evolution";
import { buildPayload } from "@/lib/catalog/payload";
import { estimateCost, planGeneration } from "@/lib/catalog/plan";

const clip = { url: "/api/files/clip.mp4", duration: 12, fps: 30, width: 1280, height: 720, hasAudio: true };
const refs = Array.from({ length: 5 }, (_, i) => `/api/files/ref${i}.png`);
const plan = (o: Partial<EvolutionPlanInput> = {}) =>
  planEvolution({ engine: "cloud", title: "Evolution", source: clip, range: { start: 0, end: 12 }, intensity: "medium", direction: "A neon-lit night market in the rain.", references: refs, ...o });
const step = (p: ReturnType<typeof planEvolution>, key: string) => {
  const s = p.steps.find((x) => x.key === key);
  if (!s) throw new Error(`no step ${key}: ${p.steps.map((x) => x.key).join(", ")}`);
  return s;
};

describe("Fuobe Evolution: intensities", () => {
  it("low / medium / high are denoise 0.45 / 0.65 / 0.85, and LTX-2.3's video_strength is 1 − denoise", () => {
    expect(INTENSITIES.map((i) => [i.id, denoiseFor(i.id), videoStrengthFor(i.id)])).toEqual([
      ["low", 0.45, 0.55],
      ["medium", 0.65, 0.35],
      ["high", 0.85, 0.15],
    ]);
  });

  it("match the research record the generator reads", () => {
    const research = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/research/fuobe-originals-recipes-5.json"), "utf8"));
    const evo = research.studios.find((s: { id: string }) => s.id === "evolution").original;
    expect(evo.model).toBe(EVOLUTION.model);
    expect(evo.intensity).toEqual(Object.fromEntries(INTENSITIES.map((i) => [i.id, i.denoise])));
    expect(evo.limits).toEqual({ minSeconds: EVOLUTION.minSeconds, maxSeconds: EVOLUTION.maxSeconds, maxReferences: EVOLUTION.maxReferences, maxDirectionChars: EVOLUTION.maxDirectionChars });
    expect(evo.cloud.strengthField).toBe("video_strength");
  });
});

describe("Fuobe Evolution: the model on both engines", () => {
  const m = getModel(EVOLUTION.model)!;

  it("is an Original: the GPU graph and LTX-2.3 video to video on fal, no Higgsfield", () => {
    expect(m).toBeTruthy();
    expect(m.engines).toEqual(["open", "cloud"]);
    expect(m.routes.map((r) => `${r.provider}:${r.endpoint}`)).toEqual(["comfyui:video-evolution-wan22-fun-vace", "fal:fal-ai/ltx-2.3-22b/video-to-video"]);
    expect(m.routes[1].loraEndpoint).toBe("fal-ai/ltx-2.3-22b/video-to-video/lora");
    expect(m.licence?.licence).toMatch(/LTX-2/);
  });

  it("the change control is each engine's own field", () => {
    const open = onEngine(m, "open");
    const cloud = onEngine(m, "cloud");
    expect(open.options.controls?.[0]).toMatchObject({ param: "denoise", values: [0.45, 0.65, 0.85], default: 0.65, labels: { "0.45": "Low", "0.65": "Medium", "0.85": "High" } });
    expect(cloud.options.controls?.[0]).toMatchObject({ param: "video_strength", values: [0.55, 0.35, 0.15], default: 0.35 });
    expect(open.options.resolutions).toEqual(["480p", "720p"]);
    expect(cloud.options.resolutions).toEqual(["480p", "720p", "1080p"]);
    expect(open.defaults?.resolution).toBe("480p");
  });

  it("the fal payload: silent, 24 fps, frames from the piece's length, the tier's size, video_strength from the step", () => {
    const cloud = onEngine(m, "cloud");
    const p = planGeneration(
      { feature: "evolution", modelId: m.id, op: "v2v", prompt: "a night market", inputs: { video: "https://x/clip.mp4" }, params: { aspectRatio: "9:16", resolution: "720p", duration: 10, extra: { video_strength: 0.15 } } },
      (id) => (id === m.id ? cloud : getModel(id)),
      getPreset,
    );
    const route = cloud.routes.find((r) => r.op === "v2v")!;
    const body = buildPayload(route.map!, { ...p.params, prompt: p.prompt, video: "https://x/clip.mp4" });
    expect(body).toMatchObject({
      prompt: "a night market",
      video_url: "https://x/clip.mp4",
      video_size: { width: 704, height: 1280 },
      num_frames: 241,
      fps: 24,
      generate_audio: false,
      match_video_length: false,
      match_input_fps: false,
      enable_prompt_expansion: false,
      video_strength: 0.15,
    });
    // $0.001605 per megapixel of video: 704 × 1280 × 241 frames ≈ 217.2 MP, rounded up.
    expect(estimateCost(cloud, { aspectRatio: "9:16", resolution: "720p", duration: 10 }, 1, "v2v")).toBeCloseTo(218 * 0.001605, 3);
    expect(estimateCost(onEngine(m, "open"), { resolution: "480p", duration: 5 }, 1, "v2v")).toBe(0);
  });
});

describe("Fuobe Evolution: the plan", () => {
  it("cloud, the whole clip in one piece: evolved straight from the upload, then the clip's sound put back", () => {
    const p = plan();
    expect(p.pieces).toBe(1);
    expect(p.steps.map((s) => `${s.key}:${s.request.modelId}`)).toEqual(["evolve0:fuobe-evolution", "final:merge-audio-video"]);
    const e = step(p, "evolve0").request;
    expect(e).toMatchObject({ engine: "cloud", op: "v2v", feature: "evolution-step", inputs: { video: clip.url }, params: { aspectRatio: "16:9", resolution: "720p", duration: 12, extra: { video_strength: 0.35 } } });
    expect(e.inputs?.images).toBeUndefined();
    expect(p.final).toBe("final");
    expect(step(p, "final").request).toMatchObject({ feature: "evolution", title: "Evolution", inputs: { audio: clip.url } });
    expect(p.referencesUsed).toBe(0);
  });

  it("cloud, 30 s: two 15 s pieces cut, evolved, joined, the sound back; a silent clip needs no mux", () => {
    const long = { ...clip, duration: 30 };
    const p = plan({ source: long, range: { start: 0, end: 30 }, intensity: "high", resolution: "1080p" });
    expect(p.pieces).toBe(2);
    expect(p.steps.map((s) => s.key)).toEqual(["cut0", "evolve0", "cut1", "evolve1", "join", "final"]);
    expect(step(p, "evolve1").request.params).toMatchObject({ duration: 15, resolution: "1080p", extra: { video_strength: 0.15 } });
    expect(step(p, "evolve1")).toMatchObject({ after: ["cut1"], chain: [{ slot: "video" }] });
    const silent = plan({ source: { ...long, hasAudio: false }, range: { start: 0, end: 30 } });
    expect(silent.final).toBe("join");
    expect(step(silent, "join").request).toMatchObject({ feature: "evolution", title: "Evolution" });
  });

  it("cloud: the clip's shape picks the nearest LTX-2.3 shape", () => {
    expect(nearestShape(1080, 1920)).toBe("9:16");
    expect(nearestShape(2560, 1080)).toBe("21:9");
    expect(nearestShape(1000, 1000)).toBe("1:1");
    expect(nearestShape(1440, 1080)).toBe("4:3");
    expect(nearestShape()).toBe("16:9");
    expect(step(plan({ source: { ...clip, width: 1080, height: 1920 } }), "evolve0").request.params?.aspectRatio).toBe("9:16");
  });

  it("GPU: per ≤81-frame segment, cut at 16 fps, the direction frame with three references, the graph at the intensity's denoise", () => {
    const p = plan({ engine: "open", intensity: "low" });
    // 12 s at 16 fps = 192 frames → 3 segments of 4n+1 frames.
    expect(p.pieces).toBe(3);
    // Qwen-Image 2.1 Turbo takes four images: the frame and three references.
    expect(EVOLUTION.openReferences).toBe(3);
    expect(p.referencesUsed).toBe(3);
    expect(step(p, "cut0").request).toMatchObject({ modelId: "oss-segment", op: "trim", params: { fps: 16, aspectRatio: "auto", resolution: "480p" } });
    const frame = step(p, "frame0");
    expect(frame.request).toMatchObject({ modelId: "oss-qwen-image-21-turbo", op: "edit", inputs: { images: refs.slice(0, 3) } });
    expect(frame.request.prompt).toMatch(/^Refine image 1 gently toward this direction: A neon-lit night market in the rain\. Keep the composition, the people/);
    expect(frame.request.prompt).toMatch(/Use the characters, objects and style of images 2, 3 and 4 where they fit\.$/);
    expect(directionFramePrompt("x", "medium", 1)).toMatch(/of image 2 where they fit\.$/);
    expect(directionFramePrompt("x", "medium", 2)).toMatch(/of images 2 and 3 where they fit\.$/);
    expect(directionFramePrompt("x", "medium", 0)).not.toMatch(/image 2/);
    expect(frame).toMatchObject({ after: ["cut0"], chain: [{ slot: "images", position: "first" }] });
    const e = step(p, "evolve0");
    expect(e.request).toMatchObject({ modelId: "fuobe-evolution", engine: "open", op: "v2v", prompt: "A neon-lit night market in the rain.", params: { aspectRatio: "auto", resolution: "480p", extra: { denoise: 0.45 } } });
    expect(e).toMatchObject({ after: ["cut0", "frame0"], chain: [{ slot: "video" }, { slot: "images" }] });
    // Joined at the segments' size, then the selection's sound.
    expect(p.steps.filter((s) => s.request.op === "concat").every((s) => s.request.params?.resolution === "480p")).toBe(true);
    expect(p.steps.at(-1)!.request).toMatchObject({ modelId: "oss-mux", feature: "evolution" });
    const hd = plan({ engine: "open", resolution: "720p" });
    expect(hd.steps.filter((s) => s.request.op === "concat").every((s) => s.request.params?.resolution === "720p")).toBe(true);
  });

  it("a part of the clip: only that part, and its own sound", () => {
    const p = plan({ range: { start: 2, end: 8 } });
    expect(p.steps.map((s) => s.key)).toEqual(["cut0", "evolve0", "sound", "final"]);
    expect(step(p, "cut0").request.params).toMatchObject({ startTime: 2, endTime: 8 });
  });

  it("checks: 4–30 s, 40 references, 10,000 characters, the engine's resolutions", () => {
    const ok = { engine: "cloud" as const, source: { duration: 12 }, range: { start: 0, end: 12 }, references: 3 };
    expect(evolutionProblem(ok)).toBeNull();
    expect(evolutionProblem({ ...ok, range: { start: 0, end: 3 } })).toBe("Select at least 4 seconds");
    expect(evolutionProblem({ ...ok, source: { duration: 40 }, range: { start: 0, end: 40 } })).toBe("Select up to 30 seconds");
    expect(evolutionProblem({ ...ok, references: 41 })).toBe("Use up to 40 references");
    expect(evolutionProblem({ ...ok, direction: "x".repeat(10_001) })).toMatch(/under 10,000 characters/);
    expect(evolutionProblem({ ...ok, engine: "open", resolution: "1080p" })).toMatch(/isn't offered on your GPU/);
  });
});

describe("Fuobe Evolution: the direction", () => {
  it("a long direction reaches the models cut after a sentence", () => {
    const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} describes the scene in some detail.`).join(" ");
    const d = directionPrompt(long);
    expect(d.cut).toBe(true);
    expect(d.text.length).toBeLessThanOrEqual(EVOLUTION.promptChars);
    expect(d.text.endsWith(".")).toBe(true);
    expect(plan({ direction: long }).cut).toBe(true);
    expect(directionPrompt("  short   one ").text).toBe("short one");
  });

  it("the GPU frame prompt follows the intensity", () => {
    expect(directionFramePrompt("a snowy village", "high", 0)).toBe("Reimagine image 1 boldly in this direction: a snowy village. Keep the composition and the poses of image 1.");
    expect(directionFramePrompt("a snowy village", "medium", 1)).toMatch(/^Change image 1 toward this direction: a snowy village\. .* image 2 where they fit\.$/);
  });

  it("the offline writer: the intensity's lead, your words or its own idea, the references", () => {
    expect(offlineDirection({ intensity: "medium", idea: "a sunken temple", references: 3 })).toBe(
      "The same action and the same camera move, now in a new world: a sunken temple. It takes the characters, objects, colours and style of the 3 reference images. Smooth, natural motion, consistent from the first frame to the last.",
    );
    expect(offlineDirection({ intensity: "low", idea: "Warm candlelight", references: 0 })).toMatch(/^The same scene, the same people and the same camera, now warm candlelight\. Smooth/);
    expect(offlineDirection({ intensity: "high", references: 1 })).toMatch(/reimagined from the ground up: a bold stylised world.* the reference image\./);
  });

  it("what the LLM is told, and what comes back", () => {
    const q = directionRequest({ intensity: "high", idea: "make it a western", references: 12, sent: 7, frame: true, seconds: 9.6 });
    expect(q).toBe("Change intensity: high.\nThe user's idea: make it a western\nThe clip is 10 s long.\nAttached: the first image is a frame of the clip; the others are 7 of the 12 references.");
    expect(directionRequest({ intensity: "low", references: 2, sent: 0, frame: false })).toMatch(/gave no idea.*\nAttached: the user has 2 reference images you can't see\./);
    expect(tidyDirection('Creative direction: "A dusty frontier town at noon, tumbleweeds rolling past."')).toBe("A dusty frontier town at noon, tumbleweeds rolling past.");
    expect(tidyDirection("- one\n- two lines of words here")).toBe("one two lines of words here");
    expect(tidyDirection("ok")).toBeNull();
    expect(tidyDirection(null)).toBeNull();
  });

  it("names the run after the direction", () => {
    expect(evolutionTitle("The same action and the same camera move, now in a new world: a sunken temple at dawn.", "beach.mp4")).toBe("Evolution · A sunken temple at dawn · beach");
    expect(evolutionTitle(offlineDirection({ intensity: "low", idea: "warm candlelight", references: 0 }))).toBe("Evolution · Warm candlelight");
    expect(evolutionTitle("A neon-lit night market in the rain.")).toBe("Evolution · A neon-lit night market in the");
  });
});
