import { beforeAll, describe, expect, it } from "vitest";
import { CLOUD_ORIGINAL_SOUND, ORIGINAL_SOUNDS, originalSoundDefault, originalSoundOn, withOriginalSound } from "@/lib/av/original-sound";
import { getMaker, ORIGINALS, planGenjutsu, type GenjutsuPlanInput } from "@/lib/catalog/genjutsu";
import { defaultValues, getMixedPreset, planMixed, type MixedPlanInput } from "@/lib/catalog/mixed-media";
import { getEraser, planRemoval, type RemovalPlanInput } from "@/lib/catalog/remove-object";
import { lookFromPreset, planShorts, SHORTS_MODELS, SHORTS_PRESETS, type PlanStep, type ShortsPlanInput } from "@/lib/catalog/shorts";
import type { GenerationRequest } from "@/lib/catalog/types";
import { tempDir } from "./helpers/temp-dir";

// "Original sound" (DBS D7): what of a clip's sound goes back under its new picture in Shorts, Mixed Media, Genjutsu,
// Remove object and Character Swap Studio. Everything stays as before; on your GPU the other choices split the sound with
// DBS and put the chosen stem(s) back with the studio's own mux; the cloud has Everything only.
const dir = tempDir("fuobe-original-sound-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
const { setSetting } = await import("@/server/settings");
const { createPipeline } = await import("@/server/chains");
beforeAll(() => setSetting("demoMode", "auto"));

const mux = (over: Partial<PlanStep> = {}): PlanStep => ({ key: "final", request: { feature: "x", batchTitle: "T", title: "T", modelId: "oss-mux", op: "mux", step: { label: "Final", index: 1200, of: 1000 } }, ...over });
const muxOf = (steps: PlanStep[], key: string) => steps.find((s) => s.key === key)!;

describe("withOriginalSound", () => {
  it("Everything, the cloud, a silent bed or no mux: the plan as it was", () => {
    const steps = [mux({ after: ["join"], chain: [{ slot: "video" }], request: { ...mux().request, inputs: { audio: "/api/files/a.mp4" } } })];
    expect(withOriginalSound(steps, "final", "everything", "open")).toBe(steps);
    expect(withOriginalSound(steps, "final", undefined, "open")).toBe(steps);
    expect(withOriginalSound(steps, "final", "music-effects", "cloud")).toBe(steps);
    expect(withOriginalSound(steps, "nope", "music-effects", "open")).toBe(steps);
    const silent = [mux({ request: { ...mux().request, inputs: { audio: "/api/files/silence-12.wav" } } })];
    expect(withOriginalSound(silent, "final", "dialogue", "open")).toBe(silent);
  });

  it("a file going in: DBS on it, then the mux on its music & effects", () => {
    const steps = [mux({ after: ["join"], chain: [{ slot: "video" }], request: { ...mux().request, inputs: { audio: "/api/files/clip.mp4" } } })];
    const out = withOriginalSound(steps, "final", "music-effects", "open", { seconds: 9 });
    expect(out.map((s) => s.key)).toEqual(["final-split", "final"]);
    expect(out[0].request).toMatchObject({ modelId: "oss-dbs-separate", op: "separate-audio", inputs: { video: "/api/files/clip.mp4" }, params: { extra: { channels: "mono" }, sourceDuration: 9 }, step: { index: 1199 } });
    expect(out[1]).toMatchObject({ after: ["join", "final-split"], chain: [{ slot: "video" }, { slot: "audio", stem: "background" }] });
    expect(out[1].request.inputs).toBeUndefined();
  });

  it("an earlier step's clip going in: DBS waits for it; Lower the music takes two stems of the one split", () => {
    const steps: PlanStep[] = [
      { key: "sound", request: { feature: "x", modelId: "oss-segment", op: "trim" } },
      mux({ after: ["join", "sound"], chain: [{ slot: "video" }, { slot: "audio" }] }),
    ];
    const out = withOriginalSound(steps, "final", "lower-music", "open", { lowerDb: -18 });
    expect(out.map((s) => s.key)).toEqual(["sound", "final-split", "final"]);
    expect(out[1]).toMatchObject({ after: ["sound"], chain: [{ slot: "audio" }] });
    expect(out[2]).toMatchObject({
      after: ["join", "final-split", "final-split"],
      chain: [{ slot: "video" }, { slot: "audio", stem: "voice" }, { slot: "audio2", stem: "background" }],
      request: { params: { extra: { backgroundVolumeDb: -18 } } },
    });
    expect(withOriginalSound(steps, "final", "dialogue", "open")[2].chain).toEqual([{ slot: "video" }, { slot: "audio", stem: "voice" }]);
  });

  it("knows its choices, defaults and the cloud's words", () => {
    expect(ORIGINAL_SOUNDS.map((o) => o.label)).toEqual(["Everything", "Music & effects only", "Dialogue only", "Lower the music"]);
    expect(originalSoundDefault({ engine: "open" })).toBe("everything");
    // Everything until the split and stem mux have passed a real run; then Music & effects only where a person is replaced.
    expect(originalSoundDefault({ engine: "open", replacesPerson: true })).toBe("everything");
    expect(originalSoundDefault({ engine: "open", replacesPerson: true, live: true })).toBe("music-effects");
    expect(originalSoundDefault({ engine: "open", live: true })).toBe("everything");
    expect(originalSoundDefault({ engine: "cloud", replacesPerson: true })).toBe("everything");
    expect(originalSoundOn("dialogue", "cloud")).toBe("everything");
    expect(CLOUD_ORIGINAL_SOUND).toMatch(/run on your GPU \(open source\)/);
  });
});

describe("each studio's plan", () => {
  const shorts = (over: Partial<ShortsPlanInput> = {}): ShortsPlanInput => ({
    engine: "open",
    title: "Claymation · beach",
    source: { url: "/api/files/uploads/beach.mp4", duration: 30, hasAudio: true },
    range: { start: 4, end: 14 },
    look: lookFromPreset(SHORTS_PRESETS[0]),
    aspectRatio: "9:16",
    language: "auto",
    modelId: SHORTS_MODELS.open[0],
    maxRefs: 0,
    ...over,
  });
  const final = (steps: PlanStep[]) => steps.find((s) => s.request.op === "mux" && !s.key.endsWith("-split"))!;

  it("Shorts: Everything is unchanged; Music & effects only puts the background stem of the selection's sound back", () => {
    const before = planShorts(shorts());
    expect(planShorts(shorts({ originalSound: "everything" })).steps).toEqual(before.steps);
    const p = planShorts(shorts({ originalSound: "music-effects" }));
    const m = final(p.steps);
    const split = p.steps.find((s) => s.key === `${m.key}-split`)!;
    expect(split.request.modelId).toBe("oss-dbs-separate");
    expect(m.chain?.at(-1)).toEqual({ slot: "audio", stem: "background" });
    // The cloud puts everything back.
    const cloud = planShorts(shorts({ engine: "cloud", modelId: "gemini-omni-flash", originalSound: "music-effects" }));
    expect(cloud.steps.some((s) => s.request.modelId === "oss-dbs-separate")).toBe(false);
  });

  it("Shorts' Lower the music runs as one pipeline (two stems of one split)", () => {
    const p = planShorts(shorts({ originalSound: "lower-music" }));
    const run = createPipeline(p.steps.map((s) => ({ key: s.key, request: s.request, ...(s.after && { after: s.after }), ...(s.chain && { chain: s.chain }) })));
    const m = final(p.steps);
    expect(run.byKey[m.key].request.chain?.filter((c) => c.stem)).toEqual([
      { slot: "audio", stem: "voice" },
      { slot: "audio2", stem: "background" },
    ]);
  });

  it("Mixed Media on your GPU: the render, the selection's sound cut, split and put back as chosen", () => {
    const sketch = getMixedPreset("mixed-sketch")!;
    const input = (over: Partial<MixedPlanInput> = {}): MixedPlanInput => ({ engine: "open", title: "Sketch · skate", preset: sketch, values: defaultValues(sketch), source: { url: "/api/files/uploads/skate.mp4", duration: 12, hasAudio: true }, range: { start: 2, end: 7 }, fps: 8, resolution: "1K", modelId: "oss-mixed-media", ...over });
    expect(planMixed(input()).steps.map((s) => s.key)).toEqual(["render"]);
    const p = planMixed(input({ originalSound: "dialogue" }));
    expect(p.final).toBe("final");
    expect(p.steps.map((s) => s.key)).toEqual(["render", "cut", "final-split", "final"]);
    expect(muxOf(p.steps, "final").chain).toEqual([{ slot: "video" }, { slot: "audio", stem: "voice" }]);
    expect(muxOf(p.steps, "cut").request).toMatchObject({ modelId: "oss-trim", op: "trim", params: { startTime: 2, endTime: 7 } });
    // A silent clip has nothing to put back.
    expect(planMixed(input({ originalSound: "dialogue", source: { url: "/api/files/x.mp4", hasAudio: false } })).steps.map((s) => s.key)).toEqual(["render"]);
  });

  it("Remove object: a person removed on your GPU gets their speech out with Music & effects only", () => {
    const eraser = getEraser("oss-h3-person-remove")!;
    const input = (over: Partial<RemovalPlanInput> = {}): RemovalPlanInput => ({ engine: "open", mode: "type", eraser, title: "Remove · the man", source: { url: "/api/files/uploads/clip.mp4", duration: 12, fps: 30, width: 1280, height: 720, hasAudio: true }, range: { start: 2, end: 9 }, prompt: "Remove the man", ...over });
    const before = planRemoval(input());
    expect(planRemoval(input({ originalSound: "everything" })).steps).toEqual(before.steps);
    const p = planRemoval(input({ originalSound: "music-effects" }));
    expect(muxOf(p.steps, p.final).chain?.at(-1)).toEqual({ slot: "audio", stem: "background" });
    expect(p.steps.some((s) => s.request.modelId === "oss-dbs-separate")).toBe(true);
  });

  it("Remove object: an eraser that keeps the clip's sound gets a sound step when only part of it goes back", () => {
    const vace = getEraser("oss-vace-remove")!;
    const input: RemovalPlanInput = { engine: "open", mode: "type", eraser: vace, title: "Remove · the cup", source: { url: "/api/files/uploads/clip.mp4", duration: 4, fps: 16, width: 832, height: 480, hasAudio: true }, range: { start: 0, end: 4 }, prompt: "the cup" };
    const plain = planRemoval(input);
    const p = planRemoval({ ...input, originalSound: "dialogue" });
    expect(p.sound).toBe(true);
    if (!plain.sound) expect(plain.steps.some((s) => s.request.op === "mux")).toBe(false);
    expect(muxOf(p.steps, p.final).chain?.at(-1)).toEqual({ slot: "audio", stem: "voice" });
  });

  it("Genjutsu: where the clip's sound is put back on your GPU, the part chosen", () => {
    const maker = getMaker(ORIGINALS.motion, "open")!;
    const base: GenjutsuPlanInput = { engine: "open", mode: "motion", maker, title: "Genjutsu", source: { url: "/api/files/clip.mp4", duration: 20, fps: 30, width: 1280, height: 720, hasAudio: true }, range: { start: 4, end: 14 }, quality: "720p", references: ["/api/files/hero.png"] };
    const before = planGenjutsu(base);
    expect(planGenjutsu({ ...base, originalSound: "everything" }).steps).toEqual(before.steps);
    const p = planGenjutsu({ ...base, originalSound: "lower-music" });
    if (before.sound) {
      expect(p.steps.some((s) => s.request.modelId === "oss-dbs-separate")).toBe(true);
      expect(muxOf(p.steps, p.final).request.params?.extra?.backgroundVolumeDb).toBe(-12);
    } else expect(p.steps).toEqual(before.steps);
  });

  it("Character Swap Studio's assembly shape: the clip's file going back is split, its music & effects kept", () => {
    const req: GenerationRequest = { feature: "swap", modelId: "oss-mux", op: "mux", inputs: { audio: "/api/files/clip-24fps.mp4" } };
    const out = withOriginalSound([{ key: "final", request: req, after: ["join"], chain: [{ slot: "video" }] }], "final", "music-effects", "open");
    expect(out[0].request.inputs).toEqual({ video: "/api/files/clip-24fps.mp4" });
    expect(out[1].chain).toEqual([{ slot: "video" }, { slot: "audio", stem: "background" }]);
  });
});
