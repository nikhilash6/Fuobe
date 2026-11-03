import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import {
  CLOUD_SOUND_NOTE,
  defaultSound,
  originalSoundProblem,
  sameSound,
  separates,
  soundBack,
  soundSummary,
  type SoundChoice,
} from "@/lib/av/original-sound";
import { SPLIT_MODEL } from "@/lib/av/split";
import { buildEpisodeGraph, defaultSettings, estimateGraph, genreInfo, secondsFor, type EpisodeSettings, type ScriptBlock } from "@/lib/catalog/faceless";
import { getMaker, ORIGINALS, planGenjutsu, type GenjutsuPlanInput, type Maker } from "@/lib/catalog/genjutsu";
import { planMixed, MIXED_PRESETS, defaultValues, type MixedPlanInput } from "@/lib/catalog/mixed-media";
import { getEraser, planRemoval, type RemovalPlanInput } from "@/lib/catalog/remove-object";
import { lookFromPreset, planShorts, planStitch, SHORTS_ORIGINAL, SHORTS_PRESETS, type PlanStep, type ShortsPlanInput } from "@/lib/catalog/shorts";
import { planAssembly } from "@/lib/catalog/swap-studio-plan";
import type { SwapClip } from "@/lib/catalog/swap-studio";
import type { Engine } from "@/lib/catalog/types";

/** DBS D7: the "Original sound" choice in the studios that put a clip's sound back, and Faceless's clip bed. */

const NO_DIALOGUE: SoundChoice = { sound: "no-dialogue" };
const DIALOGUE: SoundChoice = { sound: "dialogue-only" };
const LOWER: SoundChoice = { sound: "lower-music", musicDb: -18 };

const step = (steps: PlanStep[], key: string) => {
  const s = steps.find((x) => x.key === key);
  if (!s) throw new Error(`no step ${key} in ${steps.map((x) => x.key).join(", ")}`);
  return s;
};
const splits = (steps: PlanStep[]) => steps.filter((s) => s.request.op === "separate-audio");
/** Strip what this package adds, to compare an Everything plan with one made without a choice. */
const shape = (steps: PlanStep[]) => JSON.stringify(steps);

describe("the choice itself", () => {
  it("splits only on the open engine and only for a choice other than Everything", () => {
    expect(separates("open", undefined)).toBe(false);
    expect(separates("open", { sound: "everything" })).toBe(false);
    expect(separates("open", NO_DIALOGUE)).toBe(true);
    expect(separates("cloud", NO_DIALOGUE)).toBe(false);
    expect(separates("open", { sound: "bogus" as never })).toBe(false);
  });

  it("says the cloud puts back everything (no hosted DBS, SAM Audio not the owner's choice)", () => {
    expect(originalSoundProblem("cloud", { sound: "everything" })).toBeNull();
    expect(originalSoundProblem("cloud", undefined)).toBeNull();
    expect(originalSoundProblem("cloud", DIALOGUE)).toMatch(/Dialogue only runs on your GPU \(open source\)/);
    expect(originalSoundProblem("open", LOWER)).toBeNull();
    expect(CLOUD_SOUND_NOTE).toMatch(/run on your GPU/);
    expect(CLOUD_SOUND_NOTE).not.toMatch(/DBS|SAM|graph/);
  });

  it("suggests Music & effects only where a person is replaced, on your GPU", () => {
    expect(defaultSound("open")).toBe("everything");
    expect(defaultSound("open", { personReplaced: true })).toBe("no-dialogue");
    expect(defaultSound("cloud", { personReplaced: true })).toBe("everything");
  });

  it("summarises and compares choices", () => {
    expect(soundSummary(undefined)).toBe("Everything");
    expect(soundSummary(NO_DIALOGUE)).toBe("Music & effects only");
    expect(soundSummary({ sound: "lower-music", musicDb: -45 })).toBe("Dialogue, with the music and effects 30 dB lower");
    expect(sameSound(undefined, { sound: "everything" })).toBe(true);
    expect(sameSound(LOWER, { sound: "lower-music", musicDb: -12 })).toBe(false);
    expect(sameSound(NO_DIALOGUE, DIALOGUE)).toBe(false);
  });

  it("makes the mux's sound: the clip as it is, or the chosen stems of a split", () => {
    const steps: PlanStep[] = [];
    const helper = { feature: "x-step", batchTitle: "x" };
    expect(soundBack(steps, { engine: "open", from: { url: "/api/files/a.mp4" }, helper })).toEqual({ after: [], chain: [], inputs: { audio: "/api/files/a.mp4" } });
    expect(soundBack(steps, { engine: "cloud", from: { key: "cut" }, helper })).toEqual({ after: ["cut"], chain: [{ slot: "audio" }] });
    expect(steps).toEqual([]);
    expect(() => soundBack(steps, { engine: "cloud", choice: NO_DIALOGUE, from: { key: "cut" }, helper })).toThrow(/runs on your GPU/);

    const b = soundBack(steps, { engine: "open", choice: NO_DIALOGUE, from: { key: "cut" }, helper, channels: 6 });
    expect(b).toEqual({ after: ["split"], chain: [{ slot: "audio", stem: "background" }] });
    expect(steps[0]).toMatchObject({ key: "split", after: ["cut"], chain: [{ slot: "video" }], request: { modelId: SPLIT_MODEL, op: "separate-audio", feature: "x-step", params: { extra: { channels: "mono", sourceChannels: 6 } } } });

    const d = soundBack([], { engine: "open", choice: DIALOGUE, from: { url: "/api/files/a.mp4" }, helper });
    expect(d.chain).toEqual([{ slot: "audio", stem: "voice" }]);
    const l = soundBack([], { engine: "open", choice: LOWER, from: { url: "/api/files/a.mp4" }, helper, key: "split-x" });
    expect(l).toEqual({ after: ["split-x", "split-x"], chain: [{ slot: "audio", stem: "voice" }, { slot: "audio2", stem: "background" }], extra: { backgroundVolumeDb: -18 } });
  });
});

// ---------------------------------------------------------------------------
// Shorts

const claymation = SHORTS_PRESETS.find((p) => p.id === "claymation") ?? SHORTS_PRESETS[0];
const shorts = (over: Partial<ShortsPlanInput> = {}): ShortsPlanInput => ({
  engine: "open",
  title: "Claymation · beach",
  source: { url: "/api/files/uploads/beach.mp4", duration: 30, hasAudio: true },
  range: { start: 0, end: 12 },
  look: lookFromPreset(claymation),
  aspectRatio: "9:16",
  language: "auto",
  modelId: SHORTS_ORIGINAL,
  maxRefs: 0,
  ...over,
});

describe("Shorts", () => {
  const clips = [{ url: "/api/files/a.mp4" }, { url: "/api/files/b.mp4" }];

  it("Everything is today's plan on both engines", () => {
    for (const engine of ["open", "cloud"] as Engine[]) {
      const modelId = engine === "open" ? SHORTS_ORIGINAL : "gemini-omni-flash";
      const before = planStitch(shorts({ engine, modelId }), clips);
      expect(shape(planStitch(shorts({ engine, modelId, sound: { sound: "everything" } }), clips).steps)).toBe(shape(before.steps));
      expect(splits(before.steps)).toEqual([]);
      expect(step(before.steps, "final").chain).toEqual([{ slot: "video" }, { slot: "audio" }]);
      expect(step(before.steps, "final").request.step?.label).toBe("Final video");
    }
  });

  it("splits the cut selection (not the result) and muxes the chosen stem on your GPU", () => {
    const p = planStitch(shorts({ sound: NO_DIALOGUE }), clips);
    expect(p.final).toBe("final");
    expect(step(p.steps, "split")).toMatchObject({ after: ["sound"], chain: [{ slot: "video" }], request: { modelId: SPLIT_MODEL, op: "separate-audio", feature: "shorts-step" } });
    expect(step(p.steps, "sound").request).toMatchObject({ op: "trim", inputs: { video: "/api/files/uploads/beach.mp4" }, params: { startTime: 0, endTime: 12 } });
    const mux = step(p.steps, "final");
    expect(mux.after).toEqual(["join", "split"]);
    expect(mux.chain).toEqual([{ slot: "video" }, { slot: "audio", stem: "background" }]);
    expect(mux.request).toMatchObject({ modelId: "oss-mux", op: "mux", feature: "shorts" });
  });

  it("the whole clip is split from the upload itself; Lower the music takes both stems at the asked level", () => {
    const p = planStitch(shorts({ range: { start: 0, end: 30 }, sound: LOWER }), clips, "-s1");
    expect(step(p.steps, "split-s1").request.inputs).toEqual({ video: "/api/files/uploads/beach.mp4" });
    const mux = step(p.steps, "final-s1");
    expect(mux.after).toEqual(["join-s1", "split-s1", "split-s1"]);
    expect(mux.chain).toEqual([{ slot: "video" }, { slot: "audio", stem: "voice" }, { slot: "audio2", stem: "background" }]);
    expect(mux.request.params?.extra).toEqual({ backgroundVolumeDb: -18 });
    expect(mux.request.inputs).toBeUndefined();
  });

  it("a silent clip has nothing to split; the cloud refuses another choice in words", () => {
    expect(splits(planStitch(shorts({ source: { url: "/api/files/x.mp4", duration: 30, hasAudio: false }, sound: DIALOGUE }), clips).steps)).toEqual([]);
    expect(() => planShorts(shorts({ engine: "cloud", modelId: "gemini-omni-flash", sound: DIALOGUE }))).toThrow(/runs on your GPU/);
  });

  it("the split is free on your GPU", () => {
    const def = getModel(SPLIT_MODEL)!;
    expect(def.engine).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// Mixed Media

const sketch = MIXED_PRESETS.find((p) => p.id === "sketch") ?? MIXED_PRESETS[0];
const mixed = (over: Partial<MixedPlanInput> = {}): MixedPlanInput => ({
  engine: "open",
  title: "Sketch · skate",
  preset: sketch,
  values: defaultValues(sketch),
  source: { url: "/api/files/uploads/skate.mp4", duration: 12, hasAudio: true },
  range: { start: 2, end: 7 },
  fps: 8,
  resolution: "1K",
  modelId: "oss-mixed-media",
  ...over,
});

describe("Mixed Media", () => {
  it("Everything: one per-frame job that keeps the clip's sound (unchanged)", () => {
    const p = planMixed(mixed({ sound: { sound: "everything" } }));
    expect(p.final).toBe("render");
    expect(p.steps.map((s) => s.key)).toEqual(["render"]);
    expect(shape(p.steps)).toBe(shape(planMixed(mixed()).steps));
  });

  it("your GPU, per frame: the render becomes a step, the selection is cut, split, and the stem laid over it", () => {
    const p = planMixed(mixed({ sound: DIALOGUE }));
    expect(p.final).toBe("final");
    expect(p.steps.map((s) => s.key)).toEqual(["render", "cut", "split", "final"]);
    expect(step(p.steps, "render").request).toMatchObject({ feature: "mixed-media-step" });
    expect(step(p.steps, "render").request.title).toBeUndefined();
    expect(step(p.steps, "cut").request).toMatchObject({ modelId: "oss-trim", op: "trim", params: { startTime: 2, endTime: 7 } });
    expect(step(p.steps, "final")).toMatchObject({ after: ["render", "split"], chain: [{ slot: "video" }, { slot: "audio", stem: "voice" }], request: { modelId: "oss-mux", feature: "mixed-media", title: "Sketch · skate" } });
  });

  it("Smooth goes through the Shorts chain with the choice; the cloud refuses it in words", () => {
    const smooth = planMixed(mixed({ mode: "smooth", modelId: "fuobe-mixed-media", sourceSize: { width: 1280, height: 720 }, sourceFps: 24, sound: NO_DIALOGUE }));
    expect(splits(smooth.steps)).toHaveLength(1);
    expect(step(smooth.steps, smooth.final).chain).toContainEqual({ slot: "audio", stem: "background" });
    expect(() => planMixed(mixed({ engine: "cloud", mode: "fast", modelId: "lucy-edit-pro", sound: NO_DIALOGUE }))).toThrow(/runs on your GPU/);
    expect(splits(planMixed(mixed({ engine: "cloud", mode: "fast", modelId: "lucy-edit-pro" })).steps)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Genjutsu

const clip = { url: "/api/files/clip.mp4", duration: 20, fps: 30, width: 1280, height: 720, hasAudio: true };
const maker = (id: string, engine: Engine) => getMaker(id, engine)!;
const genjutsu = (o: Partial<GenjutsuPlanInput> & { maker: Maker }) =>
  planGenjutsu({ engine: o.maker.engine, mode: "motion", title: "Genjutsu", source: clip, range: { start: 0, end: 20 }, quality: "720p", references: ["/api/files/hero.png"], ...o });

describe("Genjutsu", () => {
  it("a maker that keeps the sound: Everything adds nothing; another choice puts the stems back over its result", () => {
    const m = maker(ORIGINALS.motionLite, "open");
    const everything = genjutsu({ maker: m });
    expect(shape(genjutsu({ maker: m, sound: { sound: "everything" } }).steps)).toBe(shape(everything.steps));
    const p = genjutsu({ maker: m, sound: NO_DIALOGUE });
    expect(p.sound).toBe(true);
    expect(splits(p.steps)).toHaveLength(1);
    expect(step(p.steps, p.final).request).toMatchObject({ op: "mux", modelId: "oss-mux" });
    expect(step(p.steps, p.final).chain).toContainEqual({ slot: "audio", stem: "background" });
  });

  it("Character swap on your GPU: the swap becomes a step and Music & effects only goes back under it", () => {
    const m = maker(ORIGINALS.character, "open");
    const p = genjutsu({ maker: m, mode: "character", range: { start: 2, end: 12 }, character: { anchor: false }, sound: NO_DIALOGUE });
    expect(step(p.steps, "swap").request.feature).toBe("genjutsu-step");
    expect(step(p.steps, "split")).toMatchObject({ after: ["sound"] });
    expect(step(p.steps, "sound").request.params).toMatchObject({ startTime: 2, endTime: 12 });
    expect(step(p.steps, p.final)).toMatchObject({ after: ["swap", "split"], request: { feature: "genjutsu", op: "mux" } });
    const kept = genjutsu({ maker: m, mode: "character", range: { start: 2, end: 12 }, character: { anchor: false } });
    expect(kept.final).toBe("swap");
  });

  it("the cloud refuses another choice in words", () => {
    expect(() => genjutsu({ maker: maker(ORIGINALS.motionLite, "cloud"), sound: DIALOGUE })).toThrow(/runs on your GPU/);
  });
});

// ---------------------------------------------------------------------------
// Remove object

const src = { url: "/api/files/uploads/clip.mp4", duration: 12, fps: 30, width: 1280, height: 720, hasAudio: true };
const removal = (over: Partial<RemovalPlanInput> & { eraserId: string }): RemovalPlanInput => {
  const { eraserId, ...rest } = over;
  return { engine: getEraser(eraserId)!.engine, mode: "type", eraser: getEraser(eraserId)!, title: "Remove · the cup", source: src, range: { start: 0, end: 12 }, prompt: "the coffee cup", ...rest };
};

describe("Remove object", () => {
  it("Everything is today's plan; a choice splits the clip and muxes over the joined result", () => {
    const base = planRemoval(removal({ eraserId: "oss-vace-remove" }));
    expect(shape(planRemoval(removal({ eraserId: "oss-vace-remove", sound: { sound: "everything" } })).steps)).toBe(shape(base.steps));
    const p = planRemoval(removal({ eraserId: "oss-vace-remove", sound: LOWER }));
    expect(splits(p.steps)).toHaveLength(1);
    expect(step(p.steps, "split").request.inputs).toEqual({ video: src.url });
    expect(step(p.steps, "final").chain).toEqual([{ slot: "video" }, { slot: "audio", stem: "voice" }, { slot: "audio2", stem: "background" }]);
    expect(step(p.steps, "final").request.params?.extra).toEqual({ backgroundVolumeDb: -18 });
  });

  it("person removal on your GPU takes Music & effects only from the selection's cut", () => {
    const p = planRemoval(removal({ eraserId: "oss-h3-person-remove", range: { start: 1, end: 9 }, prompt: "the man", sound: NO_DIALOGUE }));
    expect(step(p.steps, "split").after).toEqual(["sound"]);
    expect(step(p.steps, "final").chain).toEqual([{ slot: "video" }, { slot: "audio", stem: "background" }]);
    expect(step(p.steps, "final").request.step?.label).toBe("Music and effects back");
  });

  it("the cloud refuses another choice in words", () => {
    expect(() => planRemoval(removal({ eraserId: "kling-o3", sound: NO_DIALOGUE }))).toThrow(/runs on your GPU/);
  });
});

// ---------------------------------------------------------------------------
// Character Swap Studio

const swapClip = (hasAudio = true): SwapClip =>
  ({
    id: "clip-1",
    name: "walk",
    source: { url: "/api/files/uploads/x/walk.mp4", name: "walk.mp4", duration: 20, fps: 30, width: 1920, height: 1080, hasAudio },
    normalized: { url: "/api/files/outputs/x/walk24.mp4", genId: "g-norm" },
    frames: 480,
    cuts: [],
    detected: null,
    cutsReviewed: true,
    shots: [],
    transcript: null,
    review: "pending",
    reviewNotes: "",
    assembly: null,
  }) as SwapClip;

describe("Character Swap Studio", () => {
  const pieces = [{ kind: "source" as const, start: 0, end: 10 }];
  it("Everything puts the 24 fps copy's sound back as before", () => {
    const a = planAssembly({ engine: "open", clip: swapClip(), pieces, videoOf: () => "" });
    expect(step(a.steps, "final")).toMatchObject({ after: ["piece0"], chain: [{ slot: "video" }], request: { inputs: { audio: "/api/files/outputs/x/walk24.mp4" } } });
    expect(shape(planAssembly({ engine: "open", clip: swapClip(), pieces, videoOf: () => "", sound: { sound: "everything" } }).steps)).toBe(shape(a.steps));
  });

  it("Music & effects only splits the working clip (the 24 fps copy) on your GPU", () => {
    const a = planAssembly({ engine: "open", clip: swapClip(), pieces, videoOf: () => "", sound: NO_DIALOGUE });
    expect(step(a.steps, "split").request.inputs).toEqual({ video: "/api/files/outputs/x/walk24.mp4" });
    expect(step(a.steps, "final")).toMatchObject({ after: ["piece0", "split"], chain: [{ slot: "video" }, { slot: "audio", stem: "background" }] });
    expect(step(a.steps, "final").request.inputs).toBeUndefined();
  });

  it("the cloud keeps the clip's sound or its silence, and refuses another choice in words", () => {
    const silent = planAssembly({ engine: "cloud", clip: swapClip(false), pieces, videoOf: () => "" });
    expect(step(silent.steps, "final").request.inputs?.audio).toMatch(/silence/);
    expect(() => planAssembly({ engine: "cloud", clip: swapClip(), pieces, videoOf: () => "", sound: DIALOGUE })).toThrow(/runs on your GPU/);
  });
});

// ---------------------------------------------------------------------------
// Faceless: a clip's soundtrack as the bed

const block = (i: number, words = 20): ScriptBlock => {
  const narration = Array.from({ length: words }, (_, w) => `w${i}x${w}`).join(" ");
  return { id: `b${i}`, narration, visual: `Scene ${i}`, motion: "slow push-in", seconds: secondsFor(narration) };
};
const graphFor = (s: Partial<EpisodeSettings>, blocks: ScriptBlock[]) => {
  const settings = { ...defaultSettings(s.engine ?? "open", genreInfo("education")), ...s };
  return buildEpisodeGraph({ feature: "faceless", title: "How tides work", genre: genreInfo("education"), settings, blocks, fallbackVoice: "/api/files/uploads/demo-voice.wav" }, getModel);
};

describe("Faceless clip bed", () => {
  const blocks = [block(1), block(2), block(3)];
  const musicClip = { url: "/api/files/uploads/beach.mp4", name: "beach", duration: 10 };

  it("your GPU: DBS's background stem, looped with crossfades, mixed at the usual level", () => {
    const g = graphFor({ engine: "open", music: true, musicClip }, blocks);
    const music = g.find((s) => s.key === "music")!;
    expect(music.request).toMatchObject({ modelId: SPLIT_MODEL, op: "separate-audio", inputs: { video: musicClip.url }, params: { sourceDuration: 10 } });
    const loop = g.find((s) => s.key === "music-loop")!;
    expect(loop).toMatchObject({ after: ["music"], chain: [{ slot: "audio", stem: "background" }], request: { modelId: "oss-audio-loop", op: "audio-loop", params: { sourceDuration: 10, crossfade: 3 } } });
    const mix = g.find((s) => s.key === "mix")!;
    expect(mix.after?.[2]).toBe("music-loop");
    expect(mix.chain?.[2]).toEqual({ slot: "audio2" });
    expect(mix.request.params?.extra).toEqual({ backgroundVolumeDb: -14 });
    expect(g.some((s) => s.request.op === "music")).toBe(false);
    expect(g.some((s) => s.key === "music-cut")).toBe(false);
    expect(estimateGraph(g, getModel, ["music", "music-loop"]).parts.music ?? 0).toBe(0);
  });

  it("a clip longer than the film needs no loop and is cut to the film before its split: the mix takes the stem itself", () => {
    const g = graphFor({ engine: "open", music: true, musicClip: { ...musicClip, duration: 900 } }, blocks);
    expect(g.some((s) => s.key === "music-loop")).toBe(false);
    const film = Math.ceil(blocks.reduce((n, b) => n + b.seconds, 0));
    const cut = g.find((s) => s.key === "music-cut")!;
    expect(cut.request).toMatchObject({ modelId: "oss-trim", op: "trim", inputs: { video: musicClip.url }, params: { startTime: 0 } });
    const end = cut.request.params!.endTime!;
    expect(end).toBeGreaterThanOrEqual(film);
    expect(end).toBeLessThan(film + 3);
    const music = g.find((s) => s.key === "music")!;
    expect(music).toMatchObject({ after: ["music-cut"], chain: [{ slot: "video" }], seconds: end, request: { modelId: SPLIT_MODEL, params: { sourceDuration: end } } });
    expect(music.request.inputs).toBeUndefined();
    expect(estimateGraph(g, getModel, ["music-cut", "music"]).parts.music ?? 0).toBe(0);
    const mix = g.find((s) => s.key === "mix")!;
    expect(mix.after?.[2]).toBe("music");
    expect(mix.chain?.[2]).toEqual({ slot: "audio2", stem: "background" });
  });

  it("the cloud and music off ignore the clip (the cloud makes its own bed)", () => {
    const cloud = graphFor({ engine: "cloud", music: true, musicClip }, blocks);
    expect(cloud.find((s) => s.key === "music")!.request.op).toBe("music");
    expect(graphFor({ engine: "cloud", music: true }, blocks).map((s) => s.key)).toEqual(cloud.map((s) => s.key));
    expect(graphFor({ engine: "open", music: false, musicClip }, blocks).some((s) => s.part === "music")).toBe(false);
  });
});
