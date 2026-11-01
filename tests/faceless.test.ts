import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import { buildPayload } from "@/lib/catalog/payload";
import type { GenerationRequest } from "@/lib/catalog/types";
import {
  bedFits,
  blockCount,
  blockShots,
  buildEpisodeGraph,
  changedKeys,
  channelName,
  defaultSettings,
  descendants,
  ENGINE_MODELS,
  estimateGraph,
  EXPLAINER_STYLE_IDS,
  explainerSeconds,
  FACELESS_LENGTHS,
  FACELESS_STYLE_IDS,
  finalKey,
  foldJoins,
  GENRES,
  genreInfo,
  getStyle,
  narrationText,
  normalizeBlocks,
  offlineScript,
  offlineTopics,
  parseScript,
  parseTopics,
  parseVisuals,
  placeholderBlocks,
  planBlocks,
  planRerun,
  planRetry,
  secondsFor,
  shotsFor,
  splitScript,
  STYLES,
  stepCostUsd,
  subjectOf,
  totalSeconds,
  wordCount,
  youtubeKind,
  ANIMATION_MODES,
  filmSeconds,
  musicLength,
  musicPlan,
  plannedTiming,
  resolveModels,
  sameCameraMove,
  sceneSpans,
  sceneTiming,
  spokenTimes,
  staleSteps,
  styleRefLimit,
  withTiming,
  type EpisodeSettings,
  type GraphInput,
  type ScriptBlock,
  type TimedText,
} from "@/lib/catalog/faceless";

const research = JSON.parse(fs.readFileSync(path.join(__dirname, "../docs/research/higgsfield-marketing-agents.json"), "utf8"));

const block = (i: number, words = 20, seconds?: number): ScriptBlock => {
  const narration = Array.from({ length: words }, (_, w) => `w${i}x${w}`).join(" ");
  return { id: `b${i}`, narration, visual: `Scene ${i}`, motion: "slow push-in", seconds: seconds ?? secondsFor(narration) };
};

const graphFor = (s: Partial<EpisodeSettings>, blocks: ScriptBlock[], extra: Partial<GraphInput> = {}) => {
  const settings = { ...defaultSettings(s.engine ?? "cloud", genreInfo("education")), ...s };
  return buildEpisodeGraph({ feature: "faceless", title: "How tides work", genre: genreInfo("education"), settings, blocks, fallbackVoice: "/api/files/uploads/demo-voice.wav", ...extra }, getModel);
};

describe("research data", () => {
  it("has the 12 Faceless styles and the 22 Explainer styles in Higgsfield's order", () => {
    const names = (ids: string[]) => ids.map((id) => getStyle(id).name);
    expect(names(FACELESS_STYLE_IDS)).toEqual(research.faceless.styles.map((s: { name: string }) => s.name));
    expect(names(EXPLAINER_STYLE_IDS)).toEqual(research.explainer.styles);
    expect(new Set(STYLES.map((s) => s.id)).size).toBe(STYLES.length);
    for (const s of STYLES) expect(s.look.length).toBeGreaterThan(40);
  });

  it("has the 4 genres with their one-liners, and the offered lengths", () => {
    expect(GENRES.map((g) => [g.label, g.hint])).toEqual(research.faceless.genres.map((g: { label: string; hint: string }) => [g.label, g.hint]));
    expect(FACELESS_LENGTHS).toEqual(research.faceless.settings.length.seconds);
    for (const g of GENRES) expect(FACELESS_STYLE_IDS).toContain(g.style);
  });

  it("only uses models and voices the catalog has", () => {
    for (const engine of ["cloud", "open"] as const) {
      const m = ENGINE_MODELS[engine];
      for (const id of [m.still, m.styleStill, m.editStill, m.video, ...m.videoChoices, m.narration, m.cloneNarration, m.longNarration, m.music, m.join, m.mux, m.mixMusic, m.levelMusic, m.captions, m.align, m.sourceStill, m.upscale, m.write].filter(Boolean)) {
        expect(getModel(id!), id).toBeTruthy();
      }
    }
    const voices = getModel("elevenlabs-v4")!.options.voices!.map((v) => v.id);
    for (const g of GENRES) expect(voices).toContain(g.voice);
    expect(voices).toContain("XrExE9yKIg1WjnnlVkGX");
  });
});

describe("blocks", () => {
  it("splits a length into 10-second blocks", () => {
    expect(planBlocks(60)).toEqual([10, 10, 10, 10, 10, 10]);
    expect(planBlocks(25)).toEqual([9, 8, 8]);
    expect(planBlocks(15)).toEqual([8, 7]);
    expect(planBlocks(600)).toHaveLength(60);
    expect(blockCount(300)).toBe(30);
    expect(blockCount(5)).toBe(1);
  });

  it("times a block from its lines and splits lines that don't fit", () => {
    expect(secondsFor("one two three four five")).toBe(3);
    expect(secondsFor(block(1, 20).narration)).toBe(9);
    expect(secondsFor(block(1, 40).narration)).toBe(10);
    const long = normalizeBlocks([{ narration: "First sentence is here and it goes on for a while. " + "More words ".repeat(20) + "end.", visual: "A lighthouse", motion: "" }]);
    expect(long.length).toBeGreaterThan(1);
    expect(long[0].visual).toBe("A lighthouse");
    expect(long.every((b) => b.seconds <= 10 && wordCount(b.narration) <= 24)).toBe(true);
  });

  it("splits a pasted script into blocks that each fit 10 seconds, keeping every word", () => {
    const text = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} has exactly seven words.`).join(" ");
    const blocks = splitScript(text);
    expect(blocks.length).toBeGreaterThanOrEqual(9);
    expect(blocks.every((b) => wordCount(b.narration) <= 23)).toBe(true);
    expect(blocks.map((b) => b.narration).join(" ")).toBe(text);
    expect(totalSeconds(blocks)).toBe(blocks.reduce((n, b) => n + b.seconds, 0));
  });

  it("covers a block with the fewest shots the video model can make", () => {
    expect(shotsFor(10, undefined, [3, 10])).toEqual([10]);
    expect(shotsFor(7, undefined, [3, 10])).toEqual([7]);
    expect(shotsFor(10, [3, 5])).toEqual([5, 5]);
    expect(shotsFor(8, [3, 5])).toEqual([5, 3]);
    expect(shotsFor(4, [3, 5])).toEqual([5]);
    expect(shotsFor(7, [4, 5, 6, 8, 10, 12, 30])).toEqual([8]);
    expect(blockShots(10, getModel("oss-wan22-14b-fast"))).toEqual([5, 5]);
    expect(blockShots(10, getModel("gemini-omni-flash"))).toEqual([10]);
  });

  it("cuts MiniMax H3's shots to the block, any 3–15 s on your GPU, any 5–15 s hosted", () => {
    const h3 = getModel("oss-minimax-h3")!;
    // The open graph renders any length on its 17n + 5 frame grid.
    for (let s = 1; s <= 40; s++) for (const shot of blockShots(s, h3)) expect(shot >= 3 && shot <= 15, `${s}: ${shot}`).toBe(true);
    expect(blockShots(2, h3)).toEqual([3]);
    expect(blockShots(4, h3)).toEqual([4]);
    expect(blockShots(7, h3)).toEqual([7]);
    expect(blockShots(12, h3)).toEqual([12]);
    expect(blockShots(20, h3)).toEqual([10, 10]);
    expect(blockShots(40, h3)).toEqual([14, 13, 13]);
    expect(filmSeconds(9, h3)).toBe(9);
    // Hosted H3 takes any whole second from 5 to 15 (fal's schema).
    expect(blockShots(7, getModel("minimax-h3"))).toEqual([7]);
    expect(blockShots(3, getModel("minimax-h3"))).toEqual([5]);
    expect(blockShots(18, getModel("minimax-h3"))).toEqual([9, 9]);
  });
});

describe("render graph", () => {
  const six = Array.from({ length: 6 }, (_, i) => block(i));

  it("cloud, fully animated: still → Gemini Omni Flash clip per block → join → voice-over → subtitles", () => {
    const g = graphFor({ engine: "cloud", animation: "animated", music: false }, six);
    const parts = g.map((s) => s.part);
    expect(parts.filter((p) => p === "still")).toHaveLength(6);
    expect(parts.filter((p) => p === "clip")).toHaveLength(6);
    const clip = g.find((s) => s.part === "clip")!;
    expect(clip.request).toMatchObject({ modelId: "gemini-omni-flash", op: "i2v", params: { resolution: "720p", duration: 9, aspectRatio: "16:9" } });
    expect(clip.after).toEqual(["still-b0"]);
    expect(clip.chain).toEqual([{ slot: "images", position: "first" }]);
    const join = g.find((s) => s.key === "join")!;
    expect(join.request.modelId).toBe("join-clips");
    expect(join.after).toHaveLength(6);
    const mix = g.find((s) => s.key === "mix")!;
    expect(mix.request.modelId).toBe("merge-audio-video");
    expect(mix.after).toEqual(["join", "narration"]);
    expect(mix.label).toBe("Mixing");
    // ElevenLabs forced alignment reads the known script with the recording.
    expect(g.find((s) => s.key === "words")!.request).toMatchObject({ modelId: "elevenlabs-align", op: "transcribe", prompt: narrationText(six) });
    const narration = g.find((s) => s.key === "narration")!;
    expect(narration.request).toMatchObject({ modelId: "elevenlabs-v4", op: "tts", params: { voice: "Xb7hH8MSUJpSbSDYk0k2" } });
    expect(narration.request.prompt).toBe(narrationText(six));
    expect(g.find((s) => s.key === "captions")!.request).toMatchObject({ modelId: "auto-subtitle", title: "How tides work" });
    expect(g.find((s) => s.key === "captions")!.after).toEqual(["mix"]);
    expect(finalKey(g)).toBe("captions");
    expect(g.every((s) => s.request.feature === "faceless" && s.request.batchTitle === "How tides work")).toBe(true);
  });

  it("cloud, frame by frame: a Ken Burns zoom over each still (fal image-to-video), in and out by turns, no video model", () => {
    // Scenes whose motion words name no move take the cycle; one that names it gets it.
    const still = six.map((b, i) => ({ ...b, motion: i === 4 ? "zoom out to reveal the valley on the left" : "" }));
    const g = graphFor({ engine: "cloud", animation: "frames", music: false }, still);
    const clips = g.filter((s) => s.part === "clip");
    expect(clips).toHaveLength(6);
    expect(clips[0]).toMatchObject({ label: "Scene 1 · camera move", after: ["still-b0"], chain: [{ slot: "images", position: "first" }] });
    expect(clips[0].request).toMatchObject({ modelId: "ken-burns", op: "still-motion", params: { duration: 9, fps: 24, zoomFrom: 1, easing: "ease-in-out", aspectRatio: "16:9" } });
    expect(clips[0].request.prompt).toMatch(/^Slow push-in toward/);
    const dir = (p: GenerationRequest["params"]) => (p!.zoomTo! > p!.zoomFrom! ? "in" : "out");
    expect(clips.map((c) => dir(c.request.params))).toEqual(["in", "out", "in", "out", "out", "out"]);
    // What fal gets: the zoomed-in end and its focal point (in percent), the direction and the easing.
    const route = getModel("ken-burns")!.routes[0];
    const payload = buildPayload(route.map!, { ...clips[4].request.params, images: ["/still.png"] });
    expect(payload).toMatchObject({ image_url: "/still.png", zoom_direction: "out", easing: "ease_in_out", frames_per_second: 24, duration: 9 });
    expect(payload.zoom_factor).toBeCloseTo(1.225, 3);
    expect(payload.zoom_x).toBeLessThan(50); // the valley on the left
    // Joined with the cloud join; priced as Ken Burns, far below animating every scene.
    expect(g.find((s) => s.key === "join")!.request.modelId).toBe("join-clips");
    const animated = estimateGraph(graphFor({ engine: "cloud", animation: "animated", music: false }, six), getModel);
    const frames = estimateGraph(g, getModel);
    expect(frames.parts.clip).toBeCloseTo(0.006, 5);
    expect(frames.total).toBeLessThan(animated.total - 5);
  });

  it("open, frame by frame: zoom and pan per scene; a scene over 10 s is one move in pieces; one packet-copy join", () => {
    const blocks = [{ ...block(0, 20, 14), motion: "pan left across the harbour" }, { ...block(1, 20, 6), motion: "" }, { ...block(2, 20, 8), motion: "" }];
    const g = graphFor({ engine: "open", animation: "frames", music: false, voice: null }, blocks);
    const clips = g.filter((s) => s.part === "clip");
    expect(clips.map((c) => [c.key, c.seconds, c.label])).toEqual([
      ["clip-b0-1", 7, "Scene 1 · camera move 1 of 2"],
      ["clip-b0-2", 7, "Scene 1 · camera move 2 of 2"],
      ["clip-b1-1", 6, "Scene 2 · camera move"],
      ["clip-b2-1", 8, "Scene 3 · camera move"],
    ]);
    const [a, b] = clips.map((c) => c.request.params!);
    expect(clips[0].request).toMatchObject({ modelId: "oss-ken-burns", op: "still-motion", params: { resolution: "720p", fps: 24, aspectRatio: "16:9", easing: "linear" } });
    // One pan left in two pieces: the second goes on from the first, at the same zoom.
    expect(a.zoomFrom).toBe(a.zoomTo);
    expect(b.zoomFrom).toBe(a.zoomTo);
    expect(a.panFrom!.x).toBeGreaterThan(a.panTo!.x);
    expect(b.panFrom!.x).toBeLessThan(a.panTo!.x);
    expect(a.panTo!.x - b.panFrom!.x).toBeLessThan(0.002); // one frame's step
    // Scenes that fit one job keep the eased move; the cycle gives the second scene a pan right.
    expect(clips[2].request.params).toMatchObject({ easing: "ease-in-out" });
    expect(clips[2].request.prompt).toBe("Slow pan right");
    const join = g.find((s) => s.key === "join")!;
    expect(join.request.modelId).toBe("oss-join-encoded");
    expect(join.after).toEqual(clips.map((c) => c.key));
    expect(estimateGraph(g, getModel).total).toBe(0);
    // A 10-minute explainer joins 24 scenes at a time (packet copy needs no memory per frame).
    const long = graphFor({ engine: "open", animation: "frames", music: false, voice: null }, Array.from({ length: 60 }, (_, i) => block(i)));
    expect(long.filter((s) => s.part === "join").map((j) => j.after!.length)).toEqual([24, 24, 12, 3]);
  });

  it("open: MiniMax H3 shots as long as the block, one copy join, Chatterbox, music under the voice, Qwen3-ASR timed burn-in", () => {
    const g = graphFor({ engine: "open", animation: "animated", music: true, voice: null }, six);
    const stills = g.filter((s) => s.part === "still");
    expect(stills[0].request).toMatchObject({ modelId: "oss-qwen-image-21", params: { aspectRatio: "16:9", numOutputs: 1 } });
    expect(stills[0].request.op).toBeUndefined();
    expect(stills[0].request.inputs).toBeUndefined();
    const clips = g.filter((s) => s.part === "clip");
    // Each 9 s block is one 9 s H3 clip at 768p; H3 always makes sound, so no audio switch is sent.
    expect(clips).toHaveLength(6);
    expect(clips[0].request).toMatchObject({ modelId: "oss-minimax-h3", op: "i2v", params: { duration: 9, resolution: "768p" } });
    expect(clips.every((c) => c.request.params?.generateAudio === undefined)).toBe(true);
    const joins = g.filter((s) => s.part === "join");
    // The clips share one canvas and 24 fps: one copy join of all 6, which never decodes them (flat memory).
    expect(joins.map((j) => j.after!.length)).toEqual([6]);
    expect(joins.every((j) => j.request.modelId === "oss-join-encoded")).toBe(true);
    const narration = g.find((s) => s.key === "narration")!;
    expect(narration.request).toMatchObject({ modelId: "oss-chatterbox", inputs: { voiceAudio: "/api/files/uploads/demo-voice.wav" } });
    // The bed is as long as the film (six 9 s shots) plus a second.
    expect(g.find((s) => s.key === "music")!.request).toMatchObject({ modelId: "oss-ace-step", op: "music", params: { duration: 55, extra: { lyrics: "[Instrumental]" } } });
    const mix = g.find((s) => s.key === "mix")!;
    expect(mix).toMatchObject({ after: ["join", "narration", "music"], chain: [{ slot: "video" }, { slot: "audio" }, { slot: "audio2" }] });
    expect(mix.request).toMatchObject({ modelId: "oss-mux", params: { extra: { backgroundVolumeDb: -14 } } });
    // Qwen3-ASR times the narration (the scenes are cut to it) and its lines are burned in.
    const words = g.find((s) => s.key === "words")!;
    expect(words).toMatchObject({ after: ["narration"], chain: [{ slot: "audio" }], request: { modelId: "oss-qwen3-asr", op: "transcribe" } });
    expect(words.request.prompt).toBeUndefined();
    expect(g.find((s) => s.key === "captions")).toMatchObject({ after: ["mix", "words"], chain: [{ slot: "video" }, { slot: "prompt" }], request: { modelId: "oss-captions-burnin" } });
    expect(estimateGraph(g, getModel).total).toBe(0);
    // Wan 2.2 Lightning stays a choice: 5-second shots, 12 clips → 3 joins of 4 → the final join of 3.
    const wan = graphFor({ engine: "open", animation: "animated", music: true, voice: null, videoModel: "oss-wan22-14b-fast" }, six);
    const wanClips = wan.filter((s) => s.part === "clip");
    expect(wanClips).toHaveLength(12);
    expect(wanClips[0].request).toMatchObject({ modelId: "oss-wan22-14b-fast", params: { duration: 5, resolution: "480p" } });
    expect(wanClips[1].request.prompt).toMatch(/keeps moving/);
    expect(wan.filter((s) => s.part === "join").map((j) => j.after!.length)).toEqual([4, 4, 4, 3]);
    expect(ENGINE_MODELS.open.videoChoices).toEqual(["oss-minimax-h3", "oss-wan22-14b-fast"]);
    expect(ENGINE_MODELS.cloud.videoChoices).toContain("minimax-h3");
  });

  it("hosted MiniMax H3 in the cloud: any 5–15 s shot at 768P", () => {
    const g = graphFor({ engine: "cloud", animation: "animated", music: false, videoModel: "minimax-h3" }, six);
    const clips = g.filter((s) => s.part === "clip");
    expect(clips).toHaveLength(6);
    expect(clips[0].request).toMatchObject({ modelId: "minimax-h3", op: "i2v", params: { duration: 9, resolution: "768P" } });
    expect(estimateGraph(g, getModel).parts.clip).toBeGreaterThan(0);
  });

  it("follows the voice, style references and the music choice", () => {
    const sample = graphFor({ engine: "cloud", voice: { kind: "sample", url: "/api/files/uploads/me.wav" } }, six);
    expect(sample.find((s) => s.key === "narration")!.request).toMatchObject({ modelId: "chatterbox-cloud", inputs: { voiceAudio: "/api/files/uploads/me.wav" } });
    const refs = graphFor({ engine: "cloud", styleRefs: ["/api/files/a.png", "/api/files/b.png"] }, six);
    const still = refs.find((s) => s.part === "still")!;
    expect(still.request.inputs?.images).toEqual(["/api/files/a.png", "/api/files/b.png"]);
    expect(still.request.prompt).toMatch(/style of the reference images/);
    const openRefs = graphFor({ engine: "open", styleRefs: ["/api/files/a.png", "/api/files/b.png", "/api/files/c.png"] }, six);
    expect(openRefs.find((s) => s.part === "still")!.request).toMatchObject({ modelId: "oss-style-krea2", inputs: { images: ["/api/files/a.png", "/api/files/b.png"] } });
    // A cloud episode with music: the Sonilo bed (as long as the film) is levelled to -28 LUFS, then fal's
    // compose lays the voice and the bed on the film in one pass — no ComfyUI needed.
    const music = graphFor({ engine: "cloud", music: true }, six);
    expect(music.find((s) => s.key === "music")!.request).toMatchObject({ modelId: "sonilo-music", params: { duration: 55 } });
    expect(music.find((s) => s.key === "level")).toMatchObject({
      part: "music",
      after: ["music"],
      chain: [{ slot: "audio" }],
      request: { modelId: "ffmpeg-loudnorm", op: "level", params: { extra: { integrated_loudness: -28 } } },
    });
    const composed = music.find((s) => s.key === "mix")!;
    expect(composed).toMatchObject({ label: "Mixing voice and music", after: ["join", "narration", "level"], chain: [{ slot: "video" }, { slot: "audio" }, { slot: "audio2" }] });
    expect(composed.request).toMatchObject({ modelId: "ffmpeg-compose", op: "mux", params: { duration: 54 } });
    expect(music.every((s) => getModel(s.request.modelId)!.engine === "cloud")).toBe(true);
    // No subtitles: the mix is the final step and carries the title.
    const plain = graphFor({ engine: "cloud", subtitles: false, music: false }, six);
    expect(finalKey(plain)).toBe("mix");
    expect(plain.find((s) => s.key === "mix")!.request.title).toBe("How tides work");
    // A long script goes to the narration model without the 5,000-character limit.
    const long = graphFor({ engine: "cloud" }, Array.from({ length: 40 }, (_, i) => block(i, 24)));
    expect(narrationText(Array.from({ length: 40 }, (_, i) => block(i, 24))).length).toBeGreaterThan(5000);
    expect(long.find((s) => s.key === "narration")!.request.modelId).toBe("elevenlabs-multilingual-v2");
  });

  it("builds a picture edit for a block the timeline editor changes", () => {
    const g = graphFor({ engine: "open" }, six, { stillEdits: { b2: { source: "/api/files/outputs/still.png", instruction: "make it night" } } });
    expect(g.find((s) => s.key === "still-b2")!.request).toMatchObject({ modelId: "oss-qwen-image-21-turbo", op: "edit", inputs: { images: ["/api/files/outputs/still.png"] } });
    expect(g.find((s) => s.key === "still-b2")!.request.prompt).toMatch(/^make it night\. Keep everything else/);
  });

  it("folds long films so a change re-runs only its branch", () => {
    expect(foldJoins(["a"], 4)).toEqual([]);
    expect(foldJoins(["a", "b"], 4)).toEqual([[{ key: "join", after: ["a", "b"] }]]);
    const levels = foldJoins(Array.from({ length: 30 }, (_, i) => `c${i}`), 24);
    expect(levels.map((l) => l.map((j) => j.after.length))).toEqual([[24, 6], [2]]);
    expect(levels[1][0]).toEqual({ key: "join", after: ["join-1-1", "join-1-2"] });
    const open = foldJoins(Array.from({ length: 60 }, (_, i) => `c${i}`), 4);
    expect(open.map((l) => l.length)).toEqual([15, 4, 1]);
    expect(open[2][0].key).toBe("join");
  });
});

describe("timeline re-runs and retries", () => {
  const blocks = Array.from({ length: 12 }, (_, i) => block(i));
  // Wan 2.2 Lightning's 5-second shots: two clips per block.
  const g = graphFor({ engine: "open", music: true, videoModel: "oss-wan22-14b-fast" }, blocks);

  it("a picture change re-runs that block's still and clips, the joins up its branch, the mix and the subtitles", () => {
    const plan = planRerun(g, changedKeys(g, ["b3"], "picture"));
    expect(plan.rerun.filter((k) => k.startsWith("still-"))).toEqual(["still-b3"]);
    expect(plan.rerun.filter((k) => k.startsWith("clip-"))).toEqual(["clip-b3-1", "clip-b3-2"]);
    // 24 clips → 6 joins of 4 → 2 joins → final: b3's clips are in the first join of each level.
    expect(plan.rerun.filter((k) => k.startsWith("join"))).toEqual(["join-1-2", "join-2-1", "join"]);
    expect(plan.rerun).toEqual(expect.arrayContaining(["mix", "captions"]));
    expect(plan.rerun).not.toContain("narration");
    expect(plan.rerun).not.toContain("words");
    expect(plan.reuse).toContain("still-b4");
    expect(plan.rerun.length + plan.reuse.length).toBe(g.length);
  });

  it("a motion change keeps the still; a narration change re-voices, re-times the captions and re-mixes", () => {
    const motion = planRerun(g, changedKeys(g, ["b0"], "motion"));
    expect(motion.rerun).not.toContain("still-b0");
    expect(motion.rerun).toContain("clip-b0-1");
    const voice = planRerun(g, changedKeys(g, ["b0"], "narration"));
    expect(voice.rerun).toEqual(["narration", "words", "mix", "captions"]);
  });

  it("a retry redoes failed steps and what waits on them, and keeps what finished", () => {
    const status: Record<string, string> = Object.fromEntries(g.map((s) => [s.key, "succeeded"]));
    status["clip-b5-2"] = "failed";
    for (const k of descendants(g, ["clip-b5-2"])) status[k] = "failed";
    const plan = planRetry(g, status);
    expect(plan.rerun[0]).toBe("clip-b5-2");
    expect(plan.rerun).not.toContain("still-b5");
    expect(plan.rerun).not.toContain("narration");
    expect(planRetry(g, Object.fromEntries(g.map((s) => [s.key, "succeeded"]))).rerun).toEqual([]);
  });

  it("makes again what an older render kept for a step the graph now asks for differently", () => {
    // A Frame by frame episode rendered before its scenes became Ken Burns moves: Wan 2.2 made each 8 s scene
    // as a 5 s and a 3 s shot. Its Ken Burns graph has one 8 s move per scene under the first shot's key.
    const scenes = [block(0, 20, 8), block(1, 20, 8), block(2, 20, 8)];
    const wan = graphFor({ engine: "open", animation: "animated", music: false, voice: null, videoModel: "oss-wan22-14b-fast" }, scenes);
    expect(wan.filter((s) => s.block === 0 && s.part === "clip").map((s) => s.seconds)).toEqual([5, 3]);
    const kb = graphFor({ engine: "open", animation: "frames", music: false, voice: null }, scenes);
    expect(kb.filter((s) => s.part === "clip").map((s) => [s.key, s.seconds])).toEqual([
      ["clip-b0-1", 8],
      ["clip-b1-1", 8],
      ["clip-b2-1", 8],
    ]);
    const old = new Map(wan.map((s) => [s.key, s.request]));
    const stale = staleSteps(kb, (k) => old.get(k));
    expect(stale).toEqual(expect.arrayContaining(["clip-b0-1", "clip-b1-1", "clip-b2-1", "join"]));
    expect(stale).not.toContain("still-b0");
    expect(stale).not.toContain("narration");
    // Its own requests are never stale; a clip of another length is.
    const own = new Map(kb.map((s) => [s.key, s.request]));
    expect(staleSteps(kb, (k) => own.get(k))).toEqual([]);
    const longer = (k: string) => (k === "clip-b1-1" ? { ...own.get(k)!, params: { ...own.get(k)!.params, duration: 9 } } : own.get(k));
    expect(staleSteps(kb, longer)).toEqual(["clip-b1-1"]);
  });

  it("keeps a music bed while it still serves the film", () => {
    // A plain bed: as long as it covers the film.
    expect(bedFits({ duration: 61 }, { duration: 55 })).toBe(true);
    expect(bedFits({ duration: 61 }, { duration: 70 })).toBe(false);
    // Whole plays (cloud): 2 plays of 600 s cover a film that grew from 650 s to 660 s.
    expect(bedFits({ duration: 651, sourceDuration: 600 }, { duration: 661, sourceDuration: 600 })).toBe(true);
    expect(bedFits({ duration: 651, sourceDuration: 600 }, { duration: 1201, sourceDuration: 600 })).toBe(false);
    // A crossfaded loop (open) ends on its fade-out: remade when the film grows, or shrinks by a second or more.
    const loop = { duration: 301, sourceDuration: 240, crossfade: 3 };
    expect(bedFits(loop, loop)).toBe(true);
    expect(bedFits(loop, { ...loop, duration: 305 })).toBe(false);
    expect(bedFits(loop, { ...loop, duration: 299 })).toBe(false);
    // In a graph: the loop step is judged so, the bed itself by length.
    const g = graphFor({ engine: "open", music: true, voice: null }, placeholderBlocks(300));
    const made = new Map(g.map((s) => [s.key, s.request]));
    const shorter = graphFor({ engine: "open", music: true, voice: null }, placeholderBlocks(280));
    expect(staleSteps(shorter, (k) => made.get(k))).toEqual(["music-loop"]);
  });

  it("knows a Motion change that reads as the move a scene already has", () => {
    const moves = (motion: string) => graphFor({ engine: "open", animation: "frames", music: false, voice: null }, [block(0), { ...block(1), motion }]).find((s) => s.key === "clip-b1-1")!.request;
    // Scene 2 pans right by the cycle: words with no camera move keep it, a zoom is another move.
    const cycle = moves("");
    expect(sameCameraMove(cycle, moves("the flags wave in the wind"))).toBe(true);
    expect(sameCameraMove(cycle, moves("zoom into the lighthouse"))).toBe(false);
    expect(sameCameraMove(cycle, moves("pan right toward the upper left"))).toBe(false);
  });
});

describe("cost", () => {
  it("prices narration per thousand characters and video per second at its resolution", () => {
    const tts = getModel("elevenlabs-v4")!;
    expect(stepCostUsd(tts, { feature: "x", modelId: tts.id, prompt: "a".repeat(2500) })).toBe(0.24);
    const gemini = getModel("gemini-omni-flash")!;
    expect(stepCostUsd(gemini, { feature: "x", modelId: gemini.id, params: { duration: 10, resolution: "720p" } })).toBe(1);
    expect(stepCostUsd(gemini, { feature: "x", modelId: gemini.id, params: { duration: 10, resolution: "360p" } })).toBe(0.3);
    expect(stepCostUsd(getModel("auto-subtitle"), { feature: "x", modelId: "auto-subtitle" }, 120)).toBe(0.06);
    expect(stepCostUsd(getModel("oss-wan22-14b-fast"), { feature: "x", modelId: "oss-wan22-14b-fast" })).toBe(0);
  });

  it("estimates a one-minute cloud episode by parts", () => {
    const g = graphFor({ engine: "cloud", animation: "animated", music: false }, placeholderBlocks(60));
    const e = estimateGraph(g, getModel);
    expect(e.parts.still).toBeCloseTo(0.9, 5);
    expect(e.parts.clip).toBeCloseTo(6, 5);
    // Forced alignment: $0.22 per started hour of audio.
    expect(e.parts.words).toBeCloseTo(0.22, 5);
    expect(e.total).toBeGreaterThan(7.1);
    expect(e.total).toBeLessThan(7.4);
    expect(e.unknown).toBe(false);
    // Only what a change re-runs.
    const one = estimateGraph(g, getModel, ["still-p0", "clip-p0-1"]);
    expect(one.total).toBeCloseTo(1.15, 5);
  });
});

describe("writing", () => {
  it("reads the LLM's script, topics and visuals, with or without code fences", () => {
    const script = parseScript('Here you go:\n```json\n{"title":"Tides","scenes":[{"narration":"The moon pulls the sea.","visual":"The moon over the ocean","motion":"waves rise"}]}\n```');
    expect(script?.title).toBe("Tides");
    expect(script?.blocks[0]).toMatchObject({ narration: "The moon pulls the sea.", visual: "The moon over the ocean", motion: "waves rise" });
    // Prose instead of JSON becomes a pasted script.
    const prose = parseScript("The moon pulls the sea towards it. Twice a day, the water rises and falls along every coast.");
    expect(prose?.blocks.length).toBe(1);
    expect(parseScript("{}")).toBeNull();
    expect(parseTopics('{"topics":[{"title":"Why the sea is salty","hook":"It came from rocks."},{"title":""}]}')).toEqual([{ title: "Why the sea is salty", hook: "It came from rocks." }]);
    expect(parseVisuals('{"scenes":[{"n":1,"visual":"A","motion":"m"},{"n":2,"visual":"B"}]}', 2)).toEqual([
      { visual: "A", motion: "m" },
      { visual: "B", motion: "" },
    ]);
    expect(parseVisuals('{"scenes":[{"n":1,"visual":"A"}]}', 2)).toBeNull();
  });

  it("writes offline: channel names, topics and a script of the asked length", () => {
    expect(subjectOf("Channel about survival in the wild")).toBe("survival in the wild");
    expect(channelName("Channel about the rise and fall of empires")).toBe("The Rise and Fall of Empires");
    const topics = offlineTopics("Channel about ancient civilizations", "history", 5);
    expect(topics).toHaveLength(5);
    expect(topics[0].title).toMatch(/ancient civilizations/);
    expect(new Set(offlineTopics("x", "kids", 5, 5).map((t) => t.title)).size).toBe(5);
    // A template that would repeat the channel's own words is skipped.
    const empires = offlineTopics("Channel about the rise and fall of empires", "history", 5);
    expect(empires).toHaveLength(5);
    expect(empires.some((t) => /rise and fall of the rise and fall/i.test(t.title))).toBe(false);
    expect(subjectOf("The untold beginning of Rome")).toBe("the untold beginning of Rome");
    expect(subjectOf("Explain how dinosaurs went extinct, for kids")).toBe("how dinosaurs went extinct, for kids");
    const script = offlineScript("how volcanoes erupt", "education", 6);
    expect(script).toHaveLength(6);
    expect(script.every((b) => b.seconds <= 10 && b.narration && b.visual)).toBe(true);
  });

  it("checks reference links and explainer durations", () => {
    expect(youtubeKind("https://www.youtube.com/@kurzgesagt")).toBe("channel");
    expect(youtubeKind("https://youtu.be/dQw4w9WgXcQ")).toBe("video");
    expect(youtubeKind("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("video");
    expect(youtubeKind("https://youtube.com/playlist?list=PL123")).toBe("playlist");
    expect(youtubeKind("https://vimeo.com/123")).toBeNull();
    expect(youtubeKind("not a link")).toBeNull();
    expect(explainerSeconds("auto")).toBeNull();
    expect(explainerSeconds(45)).toBe(45);
    expect(() => explainerSeconds(14)).toThrow(/between 15 and 600/);
    expect(() => explainerSeconds(30.5)).toThrow(/whole number/);
  });
});

/** Word timings as a forced aligner gives them: every word at `pace` seconds a word, a pause between blocks. */
function aligned(blocks: ScriptBlock[], pace: number, pause = 0.4, lead = 0.15): TimedText[] {
  const cues: TimedText[] = [];
  let t = lead;
  for (const b of blocks) {
    for (const w of b.narration.split(/\s+/).filter(Boolean)) {
      cues.push({ start: t, end: t + pace * 0.9, text: w });
      t += pace;
    }
    t += pause;
  }
  return cues;
}

describe("timing: every scene cut to its spoken lines", () => {
  const six = Array.from({ length: 6 }, (_, i) => block(i));
  const gemini = getModel("gemini-omni-flash");
  const wan = getModel("oss-wan22-14b-fast");

  it("finds where each block's lines start, from forced-alignment words or ASR phrases", () => {
    const words = aligned(six, 0.5);
    const t = spokenTimes(six, words)!;
    expect(t.starts[0]).toBeCloseTo(0.15);
    // 20 words × 0.5 s, then a 0.4 s pause, per block.
    expect(t.starts[1]).toBeCloseTo(0.15 + 10.4);
    expect(t.starts[5]).toBeCloseTo(0.15 + 5 * 10.4);
    expect(t.end).toBeCloseTo(words[words.length - 1].end);
    // Phrase cues (five words each, as ASR and caption grouping give them): the same starts, interpolated.
    const phrases: TimedText[] = [];
    for (let i = 0; i < words.length; i += 5) phrases.push({ start: words[i].start, end: words[i + 4].end, text: words.slice(i, i + 5).map((w) => w.text).join(" ") });
    const p = spokenTimes(six, phrases)!;
    six.forEach((_, i) => expect(Math.abs(p.starts[i]! - t.starts[i]!)).toBeLessThan(0.5));
    // An ASR that mishears some words and hears one that isn't there still lines up.
    const heard = words.map((w, i) => (i % 9 === 4 ? { ...w, text: "mmm," } : w));
    heard.splice(30, 0, { start: heard[30].start, end: heard[30].start + 0.1, text: "uh" });
    const asr = spokenTimes(six, heard)!;
    six.forEach((_, i) => expect(Math.abs(asr.starts[i]! - t.starts[i]!)).toBeLessThan(0.6));
  });

  it("refuses timings that aren't this narration (a demo transcript, nothing)", () => {
    const demo = [
      { start: 0, end: 2.3, text: "This is a demo transcript." },
      { start: 2.5, end: 4.8, text: "Connect a speech-to-text provider in Settings," },
      { start: 5, end: 7.3, text: "or start ComfyUI, to transcribe your clip for real." },
    ];
    expect(spokenTimes(six, demo)).toBeNull();
    expect(spokenTimes(six, [])).toBeNull();
  });

  it("cuts each scene to its lines, the next scene absorbing a shot's rounding (Gemini: any whole second)", () => {
    // A slow narrator: about 11 s a block where 9 s were planned.
    const t = spokenTimes(six, aligned(six, 0.53))!;
    const timing = sceneTiming(six, t, gemini);
    const secs = six.map((b) => timing[b.id]);
    expect(secs.every((s) => Number.isInteger(s) && s >= 3)).toBe(true);
    let film = 0;
    six.forEach((b, i) => {
      // Each scene starts in the film within a rounding of where its lines start.
      if (i > 0) expect(Math.abs(film - t.starts[i]!)).toBeLessThan(0.75);
      film += timing[b.id];
    });
    expect(film).toBeGreaterThanOrEqual(t.end);
    expect(film).toBeLessThan(t.end + 2);
    // The graph makes exactly those lengths (a scene over 10 s takes two shots), and the timeline shows them.
    const g = graphFor({ engine: "cloud", music: false }, withTiming(six, timing));
    expect(sceneSpans(g, 6).map((s) => s.seconds)).toEqual(secs);
    expect(g.filter((s) => s.part === "clip").length).toBeGreaterThan(6);
    expect(g.find((s) => s.key === "mix")!.seconds).toBe(film);
  });

  it("doesn't drift with Wan's 3- and 5-second shots either", () => {
    const t = spokenTimes(six, aligned(six, 0.42))!;
    const timing = sceneTiming(six, t, wan);
    let film = 0;
    six.forEach((b, i) => {
      if (i > 0) expect(Math.abs(film - t.starts[i]!)).toBeLessThan(2.5);
      film += timing[b.id];
    });
    expect(Math.abs(film - t.end)).toBeLessThan(3.5);
    // Planned lengths as film: a 9-second block is 5 + 5 on Wan.
    expect(plannedTiming(six, wan)).toEqual(Object.fromEntries(six.map((b) => [b.id, 10])));
  });

  it("keeps each scene on its lines with MiniMax H3 on your GPU, short lines too", () => {
    const h3 = getModel("oss-minimax-h3")!;
    // Eight short lines of 9 words, about 3.6 s each when spoken.
    const eight = Array.from({ length: 8 }, (_, i) => block(i, 9));
    const t = spokenTimes(eight, aligned(eight, 0.36))!;
    const timing = sceneTiming(eight, t, h3);
    let film = 0;
    eight.forEach((b, i) => {
      if (i > 0) expect(Math.abs(film - t.starts[i]!), `scene ${i + 1}`).toBeLessThan(1);
      film += timing[b.id];
    });
    expect(film).toBeGreaterThanOrEqual(t.end);
    expect(film).toBeLessThan(t.end + 2);
    // The graph makes those lengths, each scene one H3 clip.
    const g = graphFor({ engine: "open", music: false, voice: null }, withTiming(eight, timing));
    expect(sceneSpans(g, 8).map((s) => s.seconds)).toEqual(eight.map((b) => timing[b.id]));
    expect(g.filter((s) => s.part === "clip")).toHaveLength(8);
  });

  it("gives a block the same shots planned or timed (the graph derives them from its length)", () => {
    for (const m of [gemini, wan, getModel("seedance-2-5"), getModel("oss-minimax-h3")]) {
      for (let s = 3; s <= 25; s++) expect(blockShots(filmSeconds(s, m), m)).toEqual(blockShots(s, m));
    }
  });

  it("keeps the scenes that moved a second or less when a narration change is re-timed", () => {
    const before = sceneTiming(six, spokenTimes(six, aligned(six, 0.5))!, gemini);
    // Scene 3's lines get twice as long; the new take reads the rest at nearly the same pace.
    const changed = six.map((b, i) => (i === 2 ? { ...b, narration: `${b.narration} ${b.narration}` } : b));
    const after = sceneTiming(changed, spokenTimes(changed, aligned(changed, 0.505))!, gemini, before);
    expect(after.b0).toBe(before.b0);
    expect(after.b1).toBe(before.b1);
    expect(after.b2).toBeGreaterThan(before.b2 + 5);
    expect(six.filter((b) => after[b.id] !== before[b.id]).length).toBeLessThanOrEqual(3);
  });

  it("lets a scene without lines keep its own length, out of the scene before it", () => {
    const blocks = [block(0), { ...block(1, 0), seconds: 4 }, block(2)];
    const t = spokenTimes(blocks, aligned(blocks, 0.5))!;
    expect(t.starts[1]).toBeNull();
    const timing = sceneTiming(blocks, t, gemini);
    expect(timing.b1).toBe(4);
    expect(Math.abs(timing.b0 + timing.b1 - t.starts[2]!)).toBeLessThan(1);
  });
});

describe("pictures from sources, style references, music length, frame pricing", () => {
  const six = Array.from({ length: 6 }, (_, i) => block(i));
  const [a, b, c, x] = ["/api/files/uploads/a.png", "/api/files/uploads/b.png", "/api/files/uploads/c.png", "/api/files/uploads/x.png"];

  it("draws open pictures from attached images with a multi-image edit model", () => {
    const g = graphFor({ engine: "open", voice: null, sourceImages: [a, b] }, six);
    const still = g.find((s) => s.part === "still")!;
    expect(still.request).toMatchObject({ modelId: "oss-qwen-image-21-turbo", op: "edit", inputs: { images: [a, b] } });
    expect(still.request.prompt).toMatch(/attached source pictures/);
    expect(still.request.prompt).toMatch(/Style: /);
    // Style references win over the sources; the open style model reads two of them.
    const refs = graphFor({ engine: "open", voice: null, styleRefs: [a, b, c], sourceImages: [x] }, six);
    expect(refs.find((s) => s.part === "still")!.request).toMatchObject({ modelId: "oss-style-krea2", inputs: { images: [a, b] } });
    expect(styleRefLimit("open", getModel)).toBe(2);
    expect(styleRefLimit("cloud", getModel)).toBe(3);
    // The cloud picture model reads the references and the sources.
    const cloud = graphFor({ engine: "cloud", styleRefs: [a], sourceImages: [x] }, six);
    expect(cloud.find((s) => s.part === "still")!.request).toMatchObject({ modelId: "nano-banana-pro", inputs: { images: [a, x] } });
  });

  it("makes the music bed as long as the film, up to what the model makes", () => {
    expect(musicLength(getModel("sonilo-music"), 300)).toBe(301);
    expect(musicLength(getModel("sonilo-music"), 700)).toBe(600);
    expect(musicLength(getModel("oss-ace-step"), 300)).toBe(240);
    expect(musicLength(getModel("elevenlabs-music"), 50)).toBe(60);
  });

  it("makes Frame by frame a camera move whatever video model Fully animated would use, and says so on each engine", () => {
    const priced = (animation: "animated" | "frames") => estimateGraph(graphFor({ engine: "cloud", music: false, videoModel: "seedance-2-5", animation }, placeholderBlocks(300)), getModel);
    expect(priced("frames").parts.clip).toBeLessThan(0.05);
    expect(priced("animated").parts.clip).toBeGreaterThan(50);
    expect(resolveModels({ ...defaultSettings("cloud", genreInfo("history")), animation: "frames", videoModel: "seedance-2-5" }, 100, getModel).video).toBe("ken-burns");
    const frames = ANIMATION_MODES.find((m) => m.id === "frames")!;
    expect(frames.copy).toMatch(/Ken Burns zoom.*a fraction of the price/);
    expect(frames.openCopy).toMatch(/pan and zoom.*no GPU/);
  });

  it("loops a music bed past what the model makes: crossfaded on the open engine, whole plays on the cloud", () => {
    const [ace, sonilo, openLoop, cloudLoop] = ["oss-ace-step", "sonilo-music", "oss-audio-loop", "join-audio"].map((id) => getModel(id));
    expect(musicPlan(ace, openLoop, 200)).toEqual({ bed: 201, loop: null, short: 0 });
    expect(musicPlan(ace, openLoop, 300)).toEqual({ bed: 240, loop: { duration: 301, crossfade: 3 }, short: 0 });
    expect(musicPlan(ace, openLoop, 700)).toEqual({ bed: 240, loop: { duration: 600, crossfade: 3 }, short: 100 });
    expect(musicPlan(sonilo, cloudLoop, 300)).toEqual({ bed: 301, loop: null, short: 0 });
    expect(musicPlan(sonilo, cloudLoop, 650)).toEqual({ bed: 600, loop: { duration: 651, plays: 2 }, short: 0 });
    expect(musicPlan(ace, undefined, 300)).toEqual({ bed: 240, loop: null, short: 60 });
    // A bed that covers the film but not the second after it is not looped.
    expect(musicPlan(sonilo, cloudLoop, 600)).toEqual({ bed: 600, loop: null, short: 0 });
    expect(musicPlan(ace, openLoop, 240)).toEqual({ bed: 240, loop: null, short: 0 });
    expect(musicPlan(ace, openLoop, 240.4)).toEqual({ bed: 240, loop: { duration: 242, crossfade: 3 }, short: 0 });

    // A five-minute open episode: ACE-Step's 240 s bed, looped to the film with 3 s crossfades, under the voice.
    const open = graphFor({ engine: "open", music: true, voice: null }, placeholderBlocks(300));
    const length = open.filter((s) => s.part === "clip").reduce((n, s) => n + s.seconds!, 0);
    expect(open.find((s) => s.key === "music")!.request.params?.duration).toBe(240);
    const loop = open.find((s) => s.key === "music-loop")!;
    expect(loop).toMatchObject({ part: "music", after: ["music"], chain: [{ slot: "audio" }], seconds: length + 1 });
    expect(loop.request).toMatchObject({ modelId: "oss-audio-loop", op: "audio-loop", params: { duration: length + 1, sourceDuration: 240, crossfade: 3 } });
    expect(open.find((s) => s.key === "mix")!.after).toEqual(["join", "narration", "music-loop"]);
    // A ten-minute cloud explainer: Sonilo's 600 s, played twice (the compose cuts it to the film), then levelled.
    const cloud = graphFor({ engine: "cloud", music: true, animation: "frames" }, placeholderBlocks(640));
    const cl = cloud.find((s) => s.key === "music-loop")!;
    expect(cl.request).toMatchObject({ modelId: "join-audio", op: "audio-loop", params: { sourceDuration: 600 } });
    expect(cl.request.params?.crossfade).toBeUndefined();
    expect(buildPayload(getModel("join-audio")!.routes.find((r) => r.op === "audio-loop")!.map!, { ...cl.request.params, audio: "/bed.mp3" }).audio_urls).toEqual(["/bed.mp3", "/bed.mp3"]);
    expect(cloud.find((s) => s.key === "level")!.after).toEqual(["music-loop"]);
    expect(cloud.find((s) => s.key === "mix")!.after).toEqual(["join", "narration", "level"]);
    expect(estimateGraph(cloud, getModel, ["music-loop"]).total).toBeLessThan(0.01);
    // Short films need no loop.
    expect(graphFor({ engine: "open", music: true, voice: null }, six).some((s) => s.key === "music-loop")).toBe(false);
  });
});

describe("offline topic suggestions", () => {
  it("brings new topics every round until the templates run out", () => {
    for (const g of GENRES) {
      const first = offlineTopics("Channel about volcanoes", g.id, 5);
      const second = offlineTopics("Channel about volcanoes", g.id, 5, 1, first.map((t) => t.title));
      expect(second).toHaveLength(5);
      expect(second.filter((t) => first.some((f) => f.title === t.title))).toEqual([]);
      const third = offlineTopics("Channel about volcanoes", g.id, 5, 2, [...first, ...second].map((t) => t.title));
      expect(third).toHaveLength(5);
      expect(third.filter((t) => ![...first, ...second].some((f) => f.title === t.title)).length).toBeGreaterThanOrEqual(2);
      // Without the list of shown titles, rounds page through the templates.
      const paged = offlineTopics("Channel about volcanoes", g.id, 5, 1);
      expect(paged.filter((t) => first.some((f) => f.title === t.title))).toEqual([]);
    }
  });
});
