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
  EVOLUTION_CLOUD_NOTE,
  evolutionProblem,
  evolutionTitle,
  INTENSITIES,
  offlineDirection,
  planEvolution,
  tidyDirection,
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
  it("low / medium / high are denoise 0.45 / 0.65 / 0.85 on the GPU", () => {
    expect(INTENSITIES.map((i) => [i.id, denoiseFor(i.id)])).toEqual([
      ["low", 0.45],
      ["medium", 0.65],
      ["high", 0.85],
    ]);
  });

  it("match the research record the generator reads", () => {
    const research = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/research/fuobe-originals-recipes-5.json"), "utf8"));
    const evo = research.studios.find((s: { id: string }) => s.id === "evolution").original;
    expect(evo.model).toBe(EVOLUTION.model);
    expect(evo.intensity).toEqual(Object.fromEntries(INTENSITIES.map((i) => [i.id, i.denoise])));
    expect(evo.limits).toEqual({ minSeconds: EVOLUTION.minSeconds, maxSeconds: EVOLUTION.maxSeconds, maxReferences: EVOLUTION.maxReferences, maxDirectionChars: EVOLUTION.maxDirectionChars });
    // The cloud runs the GPU's model hosted on fal (since 2026-10-30), with the GPU's direction frame.
    expect(evo.cloud.endpoint).toBe("fal-ai/wan-22-vace-fun-a14b/depth");
    expect(evo.cloud.frame).toBe("fal-ai/qwen-image-edit-2511");
    expect(evo.cloud.resolutions).toEqual(["480p", "580p", "720p"]);
    expect(getModel(EVOLUTION.cloudFrameModel)?.routes[0].endpoint).toBe(evo.cloud.frame);
    // The endpoint the generator reads has no strength field: the change level can't reach it (said in the cloud).
    const schema = research.hostedBaseEndpoints.find((e: { endpoint: string }) => e.endpoint === evo.cloud.endpoint);
    expect(Object.keys(schema.inputs).filter((k) => /strength|denoise/.test(k))).toEqual([]);
    expect(Object.keys(schema.inputs)).toEqual(expect.arrayContaining(["video_url", "ref_image_urls", "preprocess", "match_input_num_frames"]));
    // The direction frame's role is the GPU graph's (WanVaceToVideo's reference_image), recorded with the choice.
    expect(evo.cloud.video).toMatch(/ref_image_urls = \[the direction frame\].*no first_frame_url/);
    expect(evo.cloud.frameRole).toMatch(/reference_image/);
  });
});

describe("Fuobe Evolution: the model on both engines", () => {
  const m = getModel(EVOLUTION.model)!;

  it("is an Original: the GPU graph and the same Wan 2.2 Fun VACE hosted on fal, no Higgsfield, no LTX-2.3", () => {
    expect(m).toBeTruthy();
    expect(m.engines).toEqual(["open", "cloud"]);
    expect(m.routes.map((r) => `${r.provider}:${r.endpoint}`)).toEqual(["comfyui:video-evolution-wan22-fun-vace", "fal:fal-ai/wan-22-vace-fun-a14b/depth"]);
    expect(m.routes.some((r) => /ltx/i.test(r.endpoint))).toBe(false);
    expect(m.licence).toMatchObject({ licence: "Apache-2.0", commercial: true });
    expect(m.tagline).toMatch(/Wan 2\.2 Fun VACE free on your GPU .*hosted on fal \(there the change level shapes the direction frame only\)/);
  });

  it("the change control is the GPU's own field; the cloud has none and says so", () => {
    const open = onEngine(m, "open");
    const cloud = onEngine(m, "cloud");
    expect(open.options.controls?.[0]).toMatchObject({ param: "denoise", values: [0.45, 0.65, 0.85], default: 0.65, labels: { "0.45": "Low", "0.65": "Medium", "0.85": "High" } });
    expect(cloud.options.controls).toBeUndefined();
    expect(EVOLUTION_CLOUD_NOTE).toMatch(/^In the cloud the change level shapes each piece's direction frame; .* set on your GPU only$/);
    expect(open.options.resolutions).toEqual(["480p", "720p"]);
    expect(cloud.options.resolutions).toEqual(["480p", "580p", "720p"]);
    expect(open.defaults?.resolution).toBe("480p");
    expect(cloud.defaults?.resolution).toBe("720p");
    // The GPU keeps its full recipe: the direction frame is required there, optional in the composer's cloud.
    expect(open.options.requires?.images).toBe(1);
    expect(cloud.options.requires).toBeUndefined();
    expect(cloud.options.maxImages).toBe(1);
  });

  it("the fal payload: the piece by its depth, the direction frame as the VACE reference (as on the GPU), frames and rate kept; billed on frames ÷ 16", () => {
    const cloud = onEngine(m, "cloud");
    const p = planGeneration(
      { feature: "evolution", modelId: m.id, op: "v2v", prompt: "a night market", inputs: { video: "https://x/clip.mp4", images: ["https://x/frame.png"] }, params: { resolution: "720p", duration: 15 } },
      (id) => (id === m.id ? cloud : getModel(id)),
      getPreset,
    );
    const route = cloud.routes.find((r) => r.op === "v2v")!;
    const body = buildPayload(route.map!, { ...p.params, prompt: p.prompt, video: "https://x/clip.mp4", images: ["https://x/frame.png"] });
    expect(body).toMatchObject({
      prompt: "a night market",
      video_url: "https://x/clip.mp4",
      ref_image_urls: ["https://x/frame.png"],
      resolution: "720p",
      preprocess: true,
      match_input_num_frames: true,
      match_input_frames_per_second: true,
    });
    // The GPU graph pins no first frame: the frame is VACE's reference there (video-evolution-wan22-fun-vace node 15).
    expect(body).not.toHaveProperty("first_frame_url");
    expect(body).not.toHaveProperty("aspect_ratio");
    expect(body).not.toHaveProperty("video_strength");
    // $0.10 a video second at 720p, $0.075 at 580p, $0.05 at 480p.
    expect(estimateCost(cloud, { resolution: "720p", duration: 15 }, 1, "v2v")).toBeCloseTo(1.5, 5);
    expect(estimateCost(cloud, { resolution: "480p", duration: 15 }, 1, "v2v")).toBeCloseTo(0.75, 5);
    expect(estimateCost(onEngine(m, "open"), { resolution: "480p", duration: 5 }, 1, "v2v")).toBe(0);
  });

  it("mirrors the GPU graph: there the direction frame is WanVaceToVideo's reference image, with no first frame pinned", () => {
    const graph = JSON.parse(fs.readFileSync(path.join(__dirname, "../workflows/comfyui/video-evolution-wan22-fun-vace.json"), "utf8"));
    const vace = Object.values(graph as Record<string, { class_type: string; inputs: Record<string, unknown> }>).find((n) => n.class_type === "WanVaceToVideo")!;
    const [scaled] = vace.inputs.reference_image as [string, number];
    const [loaded] = graph[scaled].inputs.image as [string, number];
    expect(graph[loaded]).toMatchObject({ class_type: "LoadImage", inputs: { image: "restyled_first_frame.png" } });
    expect(vace.inputs).not.toHaveProperty("start_image");
    const map = onEngine(m, "cloud").routes.find((r) => r.op === "v2v")!.map!;
    expect(map.images).toBe("ref_image_urls");
    expect(map.image).toBeUndefined();
  });

  it("a direct cloud run (Edit video, the API) asks no length: the clip's own frames are made and priced; the GPU keeps its 5 s default", () => {
    const req = { feature: "video-edit", modelId: m.id, op: "v2v" as const, prompt: "a night market", inputs: { video: "https://x/clip.mp4" } };
    const cloud = onEngine(m, "cloud");
    const open = onEngine(m, "open");
    expect(planGeneration(req, (id) => (id === m.id ? cloud : getModel(id)), getPreset).params.duration).toBeUndefined();
    const withFrame = { ...req, inputs: { ...req.inputs, images: ["https://x/frame.png"] } };
    expect(planGeneration(withFrame, (id) => (id === m.id ? open : getModel(id)), getPreset).params.duration).toBe(5);
    expect(open.options.durations).toEqual([3, 4, 5]);
    // frames ÷ 16 × $0.10 at 720p: 4 s at 30 fps = 7.5 video seconds; 8 s at 16 fps = 8; an unknown rate counts as 30 fps.
    expect(estimateCost(cloud, { resolution: "720p", sourceDuration: 4, sourceFps: 30 }, 1, "v2v")).toBeCloseTo(0.75, 5);
    expect(estimateCost(cloud, { resolution: "720p", sourceDuration: 8, sourceFps: 16 }, 1, "v2v")).toBeCloseTo(0.8, 5);
    expect(estimateCost(cloud, { resolution: "480p", sourceDuration: 4 }, 1, "v2v")).toBeCloseTo(0.375, 5);
    // The price follows the clip (it was a flat $0.50 whatever the clip).
    expect(estimateCost(cloud, { resolution: "720p", sourceDuration: 2, sourceFps: 30 }, 1, "v2v")).not.toBe(estimateCost(cloud, { resolution: "720p", sourceDuration: 6, sourceFps: 30 }, 1, "v2v"));
  });
});

describe("Fuobe Evolution: the plan", () => {
  it("cloud, the whole clip in one piece: its first frame toward the direction on Qwen-Image-Edit 2511, VACE from the upload, then the sound", () => {
    const short = { ...clip, duration: 8 };
    const p = plan({ source: short, range: { start: 0, end: 8 } });
    expect(p.pieces).toBe(1);
    expect(p.steps.map((s) => `${s.key}:${s.request.modelId}`)).toEqual([
      "still0:extract-frame",
      "frame0:qwen-image-edit-2511-cloud",
      "evolve0:fuobe-evolution",
      "final:merge-audio-video",
    ]);
    expect(step(p, "still0").request).toMatchObject({ op: "frame", inputs: { video: clip.url }, params: { extra: { frame_type: "first" } } });
    const frame = step(p, "frame0");
    // The GPU's frame instruction for the intensity, the first three references as images 2–4.
    expect(EVOLUTION.cloudReferences).toBe(3);
    expect(frame.request).toMatchObject({ op: "edit", feature: "evolution-step", inputs: { images: refs.slice(0, 3) } });
    expect(frame.request.prompt).toBe(directionFramePrompt("A neon-lit night market in the rain.", "medium", 3));
    expect(frame).toMatchObject({ after: ["still0"], chain: [{ slot: "images", position: "first" }] });
    const e = step(p, "evolve0");
    // 8 s at 30 fps = 240 frames, billed as 240 ÷ 16 = 15 video seconds.
    expect(e.request).toMatchObject({ engine: "cloud", op: "v2v", feature: "evolution-step", inputs: { video: clip.url }, params: { resolution: "720p", duration: 15, sourceDuration: 8 } });
    expect(e.request.params?.aspectRatio).toBeUndefined();
    expect(e.request.params?.extra).toBeUndefined();
    expect(e).toMatchObject({ after: ["frame0"], chain: [{ slot: "images", position: "first" }] });
    expect(p.final).toBe("final");
    expect(step(p, "final").request).toMatchObject({ feature: "evolution", title: "Evolution", inputs: { audio: clip.url } });
    expect(p.referencesUsed).toBe(3);
  });

  it("cloud, 30 s at 30 fps: four ≤8 s pieces, each cut, its own direction frame, evolved, joined, the sound back", () => {
    const long = { ...clip, duration: 30 };
    const p = plan({ source: long, range: { start: 0, end: 30 }, intensity: "high", resolution: "480p" });
    expect(p.pieces).toBe(4);
    expect(p.steps.filter((s) => s.request.modelId === "qwen-image-edit-2511-cloud")).toHaveLength(4);
    expect(p.steps.slice(0, 4).map((s) => s.key)).toEqual(["cut0", "still0", "frame0", "evolve0"]);
    expect(step(p, "frame1").request.prompt).toMatch(/^Reimagine image 1 boldly in this direction/);
    expect(step(p, "evolve1").request.params).toMatchObject({ resolution: "480p", sourceDuration: 7.5, duration: 14.0625 });
    expect(step(p, "evolve1")).toMatchObject({ after: ["cut1", "frame1"], chain: [{ slot: "video" }, { slot: "images", position: "first" }] });
    expect(step(p, "still1")).toMatchObject({ after: ["cut1"], chain: [{ slot: "video" }] });
    expect(p.steps.at(-1)!.key).toBe("final");
    const silent = plan({ source: { ...long, hasAudio: false }, range: { start: 0, end: 30 } });
    expect(silent.final).toBe("join");
    expect(step(silent, "join").request).toMatchObject({ feature: "evolution", title: "Evolution" });
  });

  it("cloud: a clip above 30 fps is worked at a fraction of its rate, as fal's VACE takes it", () => {
    const p = plan({ source: { ...clip, fps: 60, duration: 8 }, range: { start: 0, end: 8 } });
    expect(step(p, "evolve0").request.params?.extra).toEqual({ temporal_downsample_factor: 1 });
    expect(evolutionProblem({ engine: "cloud", source: { duration: 12, fps: 4 }, range: { start: 0, end: 12 }, references: 0 })).toMatch(/at least 5 fps/);
    expect(evolutionProblem({ engine: "open", source: { duration: 12, fps: 4 }, range: { start: 0, end: 12 }, references: 0 })).toBeNull();
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
    expect(p.steps.map((s) => s.key)).toEqual(["cut0", "still0", "frame0", "evolve0", "sound", "final"]);
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
    expect(evolutionProblem({ ...ok, resolution: "1080p" })).toBe("1080p isn't offered in the cloud — pick 480p, 580p or 720p");
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

  it("the frame prompt (both engines) follows the intensity", () => {
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
