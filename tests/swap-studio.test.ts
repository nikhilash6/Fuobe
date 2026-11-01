import { describe, expect, it } from "vitest";
import { coarseTimes, coarseWindows, fineWidth, FINE_MAX_WIDTH, mafd, sceneCuts, sceneScores, studioFrames, timeFrame, windowChunks, windowCuts, windowFrames } from "@/lib/av/scene-cuts";
import { pointsValue } from "@/lib/catalog/payload";
import {
  addCut,
  applyLayout,
  approvedMask,
  assemblyPieces,
  assemblyTakes,
  autoSelect,
  buildSegmentPrompt,
  clipNeedsPreview,
  clipProblem,
  cloudFilmSize,
  cueWords,
  currentSegments,
  DEFAULT_SETTINGS,
  defaultMaskBase,
  dependencies,
  digest,
  enginePrompt,
  exportDecisions,
  freezeTake,
  maskMemoryProblem,
  maskPieceAt,
  maskPieces,
  maskProblem,
  masterKeep,
  moveCut,
  newSegment,
  newShot,
  normalizedSize,
  pageClip,
  planQueue,
  predecessors,
  referenceContext,
  removeCut,
  removeTake,
  segmentDialogue,
  segmentPrompt,
  segmentSpeaker,
  segmentStates,
  segmentsProblem,
  selectTake,
  settingSignature,
  shotPrompt,
  shotsFromCuts,
  shotSpeaker,
  speakerIn,
  stableJson,
  studioHandOff,
  updateTake,
  voicesOf,
  windowRanges,
  wordsIn,
  type MaskVersion,
  type SwapClip,
  type SwapProject,
  type SwapSegment,
  type SwapShot,
  type SwapTake,
} from "@/lib/catalog/swap-studio";
import { cloudCallSeconds, cloudMaskCut, frozenTakePlan, maskPointsPayload, planAnchor, planAssembly, planMask, planNormalize, planPreview, planSegmentTake, planTranscribe, STUDIO_MODELS } from "@/lib/catalog/swap-studio-plan";

// ---------------------------------------------------------------------------
// Fixtures

// One sequence for the whole file: ids made in different calls never collide.
let tick = 0;
const golden = () => (((tick++ * 0.6180339887) % 1) + 1) % 1;
const seq = () => golden;

function frame(value: number, n = 16): Uint8ClampedArray {
  const px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) px.set([value, value, value, 255], i * 4);
  return px;
}

function clipOf(over: Partial<SwapClip> = {}): SwapClip {
  return {
    id: "clip-1",
    name: "walk",
    source: { url: "/api/files/uploads/x/walk.mp4", name: "walk.mp4", duration: 20, fps: 30, width: 1920, height: 1080, hasAudio: true },
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
    ...over,
  };
}

function projectOf(clips: SwapClip[], engine: SwapProject["engine"] = "open"): SwapProject {
  return { id: "p1", name: "Demo", engine, character: { image: "/api/files/uploads/x/hero.png", description: "a woman in a yellow raincoat" }, defaults: { ...DEFAULT_SETTINGS }, clips, createdAt: 0, updatedAt: 0, revision: 1 };
}

function shotOf(start: number, end: number, over: Partial<SwapShot> = {}): SwapShot {
  return { ...newShot(start, end, DEFAULT_SETTINGS, true, seq()), id: `shot-${start}`, ...over };
}

function take(id: string, over: Partial<SwapTake> = {}): SwapTake {
  return { id, createdAt: 1, engine: "open", state: "launched", genId: `g-${id}`, signature: "", dependencies: [], prompt: "", seed: 1, favourite: false, decision: "pending", notes: "", ...over };
}

/** Segments whose selected takes match their current settings (and what they continue from). */
function ready(project: SwapProject, clip: SwapClip, shot: SwapShot): SwapShot {
  const items = currentSegments(shot).map((s) => ({ ...s }));
  const out = { ...shot, segments: items };
  items.forEach((seg, i) => {
    const t = take(`t-${seg.id}`, { signature: settingSignature(project, clip, out, seg), dependencies: dependencies(items, i) });
    items[i] = { ...seg, takes: [t], selectedTake: t.id };
    // Later dependencies name the selected takes: recompute once the earlier one is set.
    for (let j = i + 1; j < items.length; j++) items[j] = { ...items[j] };
  });
  items.forEach((seg, i) => {
    const t = { ...seg.takes[0], dependencies: dependencies(items, i), signature: settingSignature(project, clip, out, seg) };
    items[i] = { ...seg, takes: [t] };
  });
  return out;
}

// ---------------------------------------------------------------------------
// Shot detection maths (FFmpeg's scene score)

describe("scene cuts", () => {
  it("scores a still frame 0 and a hard cut over Akatz's 0.32", () => {
    const frames = [frame(20), frame(20), frame(20), frame(200), frame(200)];
    const scores = sceneScores(frames);
    expect(scores[0]).toBe(0);
    expect(scores[1]).toBe(0);
    expect(scores[3]).toBeCloseTo(1, 5); // MAFD 180, jump 180: min / 100, clipped to 1
    expect(scores[4]).toBe(0);
    expect(sceneCuts(scores, [0, 1, 2, 3, 4], 5)).toEqual([3]);
  });

  it("doesn't cut on steady motion: a high MAFD without a jump scores low", () => {
    // Every frame differs from the last by 40 levels: MAFD 40 each time, no jump after the first pair.
    const frames = Array.from({ length: 8 }, (_, i) => frame((i * 40) % 256));
    const scores = sceneScores(frames.slice(0, 6));
    expect(mafd(frames[0], frames[1])).toBeCloseTo(40, 5);
    expect(scores.slice(2).every((s) => s < 0.32)).toBe(true);
    // The second frame has no MAFD before it (FFmpeg starts at 0): it scores MAFD / 100.
    expect(scores[1]).toBeCloseTo(0.4, 5);
  });

  it("ignores a stretch's first two frames, except at the clip's start", () => {
    const frames = [frame(10), frame(80), frame(150), frame(150), frame(150)];
    // From frame 40: the jump at index 1 is an artefact of starting mid-clip.
    expect(windowCuts([40, 41, 42, 43, 44], frames, 480)).toEqual([]);
    // From frame 0 FFmpeg's history is just as empty: a jump at frame 1 counts.
    expect(windowCuts([0, 1, 2, 3, 4], [frame(0), frame(200), frame(200), frame(200), frame(200)], 480)).toEqual([1]);
  });

  it("keeps cuts inside the clip and drops repeats", () => {
    expect(sceneCuts([0, 0.9, 0.9, 0.5], [0, 0, 479, 480], 480)).toEqual([479]);
    expect(sceneCuts([1, 1], [12, 12], 480)).toEqual([12]);
  });

  it("plans the coarse pass and the stretches the fine pass reads", () => {
    const times = coarseTimes(10, 6);
    expect(times[0]).toBe(0);
    expect(times.at(-1)).toBe(10);
    expect(times.length).toBe(61);
    expect(coarseTimes(150, 6, 600).length).toBeLessThanOrEqual(601);
    const scores = times.map((_, i) => (i === 30 || i === 31 ? 0.5 : 0));
    const w = coarseWindows(times, scores, studioFrames(10));
    // Samples 29–31 are one stretch: frames from two before sample 29 to one after sample 31.
    expect(w).toEqual([{ from: timeFrame(times[29]) - 2, to: timeFrame(times[31]) + 1 }]);
    expect(windowFrames(w[0]).length).toBe(w[0].to - w[0].from + 1);
  });
});

// ---------------------------------------------------------------------------
// Clips and shots

describe("clips and shots", () => {
  it("takes the researched formats and length", () => {
    expect(clipProblem({ name: "a.avi", duration: 10 })).toBeNull();
    expect(clipProblem({ name: "a.mkv", duration: 149.66 })).toBeNull();
    expect(clipProblem({ name: "a.gif" })).toMatch(/MP4, MOV, MKV, WebM or AVI/);
    expect(clipProblem({ name: "a.mp4", duration: 150 })).toMatch(/149\.66/);
    expect(normalizedSize(3840, 2160)).toEqual({ width: 2048, height: 1152 });
    expect(normalizedSize(1279, 721)).toEqual({ width: 1278, height: 720 });
  });

  it("makes shots from cuts and keeps an unchanged shot whole", () => {
    const clip = clipOf();
    const first = shotsFromCuts(clip, [120, 300], DEFAULT_SETTINGS, undefined, seq());
    expect(first.map((s) => [s.start, s.end])).toEqual([
      [0, 120],
      [120, 300],
      [300, 480],
    ]);
    const edited = { ...first[0], mode: "preserve" as const, approvedAnchor: "a1" };
    const second = shotsFromCuts({ ...clip, shots: [edited, first[1], first[2]] }, [120, 200, 300], DEFAULT_SETTINGS, undefined, seq());
    expect(second[0]).toBe(edited);
    // A changed shot keeps the mode and who of the shot it overlaps most, but nothing frame-bound.
    expect(second[1].start).toBe(120);
    expect(second[1].approvedAnchor).toBeNull();
    expect(second.length).toBe(4);
    const modes = shotsFromCuts(clip, [240], DEFAULT_SETTINGS, ["preserve", "generate"], seq());
    expect(modes.map((s) => s.mode)).toEqual(["preserve", "generate"]);
  });

  it("adds, moves and removes cuts within the clip", () => {
    expect(addCut([120], 60, 480)).toEqual([60, 120]);
    expect(addCut([120], 0, 480)).toEqual([120]);
    expect(addCut([120], 480, 480)).toEqual([120]);
    expect(moveCut([60, 120], 120, 10, 480)).toEqual([60, 61]);
    expect(moveCut([60, 120], 60, 500, 480)).toEqual([119, 120]);
    expect(removeCut([60, 120], 60)).toEqual([120]);
  });
});

// ---------------------------------------------------------------------------
// Transcript, speakers and prompts

describe("words and prompts", () => {
  const cues = [
    { start: 0, end: 2, text: "Hello there my friend", speaker: "speaker_0" },
    { start: 6, end: 7, text: "Who are you?", speaker: "speaker_1" },
  ];

  it("spreads a cue's words over its time and takes them by their middle", () => {
    const words = cueWords(cues);
    expect(words.map((w) => w.text)).toEqual(["Hello", "there", "my", "friend", "Who", "are", "you?"]);
    // Frames 0–24 (0–1 s): "Hello" (mid 0.25) and "there" (mid 0.75).
    expect(wordsIn(words, 0, 24).map((w) => w.text)).toEqual(["Hello", "there"]);
    expect(voicesOf(cues)).toEqual(["speaker_0", "speaker_1"]);
  });

  it("marks who speaks from the voices' roles", () => {
    const words = cueWords(cues);
    expect(speakerIn(words, { speaker_0: "target", speaker_1: "offscreen" }, 0, 48)).toBe("target");
    expect(speakerIn(words, { speaker_0: "target", speaker_1: "offscreen" }, 144, 168)).toBe("offscreen");
    expect(speakerIn(words, {}, 72, 96)).toBe("none");
    const clip = clipOf({ transcript: { cues, voices: { speaker_0: "other" } } });
    expect(shotSpeaker(clip, shotOf(0, 48))).toBe("other");
    expect(shotSpeaker(clip, shotOf(0, 48, { speaker: "none" }))).toBe("none");
    expect(shotSpeaker(clipOf({ source: { ...clipOf().source, hasAudio: false } }), shotOf(0, 48))).toBe("none");
  });

  it("builds the shot prompt in H3's tags with the speaker line", () => {
    const p = shotPrompt("a woman in a yellow raincoat.", "offscreen", "Hello there");
    expect(p).toContain("Replace only the selected person in <Video 1> with the single character in <Picture 1>: a woman in a yellow raincoat.");
    expect(p).toContain("<Picture 2> is the exact first-frame scene and pose anchor.");
    expect(p).toContain("Speech is offscreen; do not make the selected character speak.");
    expect(p).toContain('Current shot dialogue: "Hello there".');
    expect(shotPrompt("", "none", "", false)).not.toContain("<Picture 2>");
    expect(shotPrompt("", "none", "")).toContain("the reference character");
  });

  it("builds each segment's prompt from its own words and pictures", () => {
    const clip = clipOf({ transcript: { cues, voices: { speaker_0: "target", speaker_1: "other" } } });
    const project = projectOf([clip]);
    const shot = shotOf(0, 240, { approvedAnchor: "a1", anchors: [{ id: "a1", createdAt: 0, source: "imported", url: "/api/files/a.png" }] });
    const items = currentSegments(shot);
    expect(items.map((s) => [s.start, s.end])).toEqual([
      [0, 124],
      [124, 240],
    ]);
    const p0 = segmentPrompt(project, clip, shot, items[0]);
    expect(p0).toContain("<Picture 2> is the exact first-frame scene and pose anchor.");
    expect(p0).toContain('Current segment dialogue: "Hello there my friend".');
    expect(p0).not.toContain("Current shot dialogue");
    const p1 = segmentPrompt(project, clip, shot, items[1]);
    expect(p1).toContain("<Picture 2> is the generated boundary from the preceding segment.");
    expect(p1).toContain('"Who are you?"');
    expect(segmentDialogue(clip, shot, items[1])).toBe("Who are you?");
    expect(segmentSpeaker(clip, shot, items[1])).toBe("other");
    expect(segmentPrompt(project, clip, shot, { ...items[1], performancePrompt: "Exact words" })).toBe("Exact words");
    const built = buildSegmentPrompt(project, clip, shot, { ...items[1], prompt: "Keep the umbrella" });
    expect(built).toContain("Another person is speaking");
    expect(built).toContain("Current segment dialogue:");
    expect(built.endsWith("Keep the umbrella")).toBe(true);
    expect(referenceContext(18, true)).toContain("<Picture 3> is an additional scene and performance reference");
    expect(referenceContext(0, false)).toBe("");
  });

  it("puts the prompt in fal's words on the cloud", () => {
    const text = "Replace only the selected person in <Video 1> with the single character in <Picture 1>. <Picture 2> is the generated boundary. <Picture 3> is a reference. <Audio 1> and source video determine exact timing.";
    expect(enginePrompt(text, "open", { selection: "largest", index: 0, words: "person" })).toBe(text);
    const cloud = enginePrompt(text, "cloud", { selection: "leftmost", index: 0, words: "person" }, { swapPictures: true });
    expect(cloud).toContain("Replace only the person on the left in Video 1 with the single character in Image 1.");
    expect(cloud).toContain("Image 3 is the generated boundary. Image 2 is a reference.");
    expect(cloud).toContain("Video 1's sound and motion determine exact timing");
    expect(cloud).not.toMatch(/<|>/);
  });
});

// ---------------------------------------------------------------------------
// Segment planning and continuation dependencies

describe("segments", () => {
  it("follows H3's window plan for the default layout", () => {
    expect(windowRanges(120, 124, 18)).toEqual([{ start: 0, end: 120 }]);
    expect(windowRanges(300, 124, 18)).toEqual([
      { start: 0, end: 124 },
      { start: 124, end: 247 },
      { start: 247, end: 300 },
    ]);
    const shot = shotOf(0, 300);
    const items = currentSegments(shot);
    expect(items.map((s) => s.connection)).toEqual(["start", "continue", "continue"]);
    expect(items.map((s) => s.anchorMode)).toEqual(["shot", "none", "none"]);
    expect(items[1].seed).toBe(DEFAULT_SETTINGS.seed + 1);
    // The default layout's ids are stable per range.
    expect(currentSegments(shot).map((s) => s.id)).toEqual(items.map((s) => s.id));
  });

  it("checks a layout the way Akatz's app does", () => {
    const shot = shotOf(0, 400);
    const a = newSegment(shot, 0, 200, 0, seq());
    const b = newSegment(shot, 200, 400, 1, seq());
    expect(segmentsProblem(shot, [a, b])).toBeNull();
    expect(segmentsProblem(shot, [a, { ...b, start: 201 }])).toMatch(/without gaps/);
    expect(segmentsProblem(shot, [{ ...a, connection: "continue" }, b])).toMatch(/first segment starts fresh/);
    expect(segmentsProblem(shot, [{ ...a, end: 10 }, { ...b, start: 10, history: 18 }])).toMatch(/history extends before/);
    expect(segmentsProblem(shot, [{ ...a, end: 362 }, { ...b, start: 362, connection: "start" }])).toBeNull();
    expect(segmentsProblem({ start: 0, end: 400 }, [{ ...a, end: 363 }, { ...b, start: 363, connection: "start" }])).toMatch(/one diffusion pass/);
    // A continuing 361-frame segment needs 362 with its boundary: still one pass. 362 continuing frames don't fit.
    expect(segmentsProblem({ start: 0, end: 723 }, [{ ...a, end: 362 }, { ...b, start: 362, end: 723 }])).toBeNull();
    expect(segmentsProblem({ start: 0, end: 724 }, [{ ...a, end: 362 }, { ...b, start: 362, end: 724 }])).toMatch(/Segment 2 must fit one diffusion pass/);
    expect(segmentsProblem(shot, [a, b], "cloud")).toBeNull();
    expect(segmentsProblem({ start: 0, end: 230 }, [{ ...a, end: 200 }, { ...b, start: 200, end: 230 }], "cloud")).toMatch(/2–15 s/);
  });

  it("splits, merges, moves boundaries and partitions", () => {
    const shot = shotOf(0, 600, { segments: null });
    const parts = applyLayout(shot, { op: "partition", frames: 240 }, seq());
    expect(parts.map((s) => [s.start, s.end, s.connection])).toEqual([
      [0, 240, "start"],
      [240, 480, "continue"],
      [480, 600, "continue"],
    ]);
    const withDirection = { ...shot, segments: parts.map((s, i) => (i === 1 ? { ...s, prompt: "Smile" } : s)) };
    const split = applyLayout(withDirection, { op: "split", frame: 300 }, seq());
    expect(split.map((s) => [s.start, s.end])).toEqual([
      [0, 240],
      [240, 300],
      [300, 480],
      [480, 600],
    ]);
    expect(split[1].prompt).toBe("Smile");
    expect(split[2].needsReview).toBe(true);
    // The untouched first and last segments are the same segments.
    expect(split[0].id).toBe(parts[0].id);
    const merged = applyLayout({ ...shot, segments: split }, { op: "merge", index: 2 }, seq());
    expect(merged.map((s) => [s.start, s.end])).toEqual([
      [0, 240],
      [240, 480],
      [480, 600],
    ]);
    // Segment 2 starts fresh; moving its end to 245 leaves segment 3 five frames of sequence to continue from.
    const fresh = merged.map((s, i) => (i === 1 ? { ...s, connection: "start" as const } : s));
    const moved = applyLayout({ ...shot, segments: fresh }, { op: "boundary", index: 2, frame: 245 }, seq());
    expect(moved.map((s) => [s.start, s.end])).toEqual([
      [0, 240],
      [240, 245],
      [245, 600],
    ]);
    // A continuation can't reach before its sequence: 5 frames back holds a history of 1 at most.
    expect(moved[2].history).toBe(1);
    expect(() => applyLayout({ ...shot, segments: merged }, { op: "boundary", index: 1, frame: 10 })).toThrow(/one diffusion pass/);
    expect(() => applyLayout(shot, { op: "split", frame: 0 })).toThrow(/playhead/);
    expect(() => applyLayout(shot, { op: "partition", frames: 400 })).toThrow(/15 seconds/);
  });

  it("draws history from the segments before, never across a fresh start", () => {
    const shot = shotOf(0, 400);
    const a = newSegment(shot, 0, 10, 0, seq());
    const b = { ...newSegment(shot, 10, 20, 1, seq()), history: 1 };
    const c = { ...newSegment(shot, 20, 400, 2, seq()), history: 18 };
    const items = [a, b, c];
    // 18 frames: 10 from b, 8 from a.
    expect(predecessors(items, 2).map((p) => [p.segment.id, p.frames])).toEqual([
      [a.id, 8],
      [b.id, 10],
    ]);
    expect(dependencies(items, 1)).toEqual([{ segmentId: a.id, takeId: null, frames: 1 }]);
    expect(() => predecessors([a, { ...b, connection: "start" }, c], 2)).toThrow(/Not enough preceding frames/);
    expect(predecessors([a, b, { ...c, connection: "start" }], 2)).toEqual([]);
  });

  it("knows which takes are current, stale or missing", () => {
    const clip = clipOf();
    const project = projectOf([clip]);
    const shot = ready(project, clip, shotOf(0, 300, { approvedAnchor: "a1", anchors: [{ id: "a1", createdAt: 0, source: "imported", url: "/api/files/a.png" }] }));
    expect(segmentStates(project, clip, shot).map((s) => s.status)).toEqual(["ready", "ready", "ready"]);
    // A new seed on the first segment: its take is stale, and the ones continuing from it are blocked.
    const changed = { ...shot, segments: shot.segments!.map((s, i) => (i === 0 ? { ...s, seed: 7 } : s)) };
    const states = segmentStates(project, clip, changed);
    expect(states.map((s) => s.status)).toEqual(["stale", "stale", "stale"]);
    expect(states[1].blocked).toBe(true);
    // A new character picture makes every take stale.
    const other = { ...project, character: { ...project.character, image: "/api/files/b.png" } };
    expect(segmentStates(other, clip, shot)[0].status).toBe("stale");
    // The cloud doesn't mask: a mask approved later doesn't make its takes stale.
    const cloud = projectOf([clip], "cloud");
    const cloudShot = ready(cloud, clip, shotOf(0, 120, { settings: { ...DEFAULT_SETTINGS, useAnchor: false } }));
    const masked = { ...cloudShot, approvedMask: "m1", masks: [{ id: "m1" } as MaskVersion] };
    expect(segmentStates(cloud, clip, masked)[0].status).toBe("ready");
  });

  it("queues one segment, from here, or all, with continuations waiting on their segment", () => {
    const clip = clipOf();
    const project = projectOf([clip]);
    const base = shotOf(0, 300, { approvedAnchor: "a1", anchors: [{ id: "a1", createdAt: 0, source: "imported", url: "/api/files/a.png" }] });
    const items = currentSegments(base);
    const shot = { ...base, segments: items };
    const active = () => false;
    const all = planQueue(project, clip, shot, items[0].id, "all", { active });
    expect("entries" in all && all.entries.map((e) => [e.index, e.waitsOn])).toEqual([
      [0, []],
      [1, [items[0].id]],
      [2, [items[1].id]],
    ]);
    // Segment 2 alone needs segment 1's take first.
    const one = planQueue(project, clip, shot, items[1].id, "segment", { active });
    expect("problem" in one && one.problem).toMatch(/Generate segment 1 first/);
    // With segment 1 current, "from here" makes 2 and 3; 3 waits on 2.
    const done = ready(project, clip, shot);
    const fresh = { ...done, segments: done.segments!.map((s, i) => (i ? { ...s, takes: [], selectedTake: null } : s)) };
    const from = planQueue(project, clip, fresh, items[1].id, "from", { active, hasMaster: () => true });
    expect("entries" in from && from.entries.map((e) => [e.index, e.waitsOn])).toEqual([
      [1, []],
      [2, [items[1].id]],
    ]);
    // Without a master to continue from (your GPU), it can't start.
    const noMaster = planQueue(project, clip, fresh, items[1].id, "segment", { active, hasMaster: () => false });
    expect("problem" in noMaster && noMaster.problem).toMatch(/lossless master/);
    // A segment already queued is refused when asked for alone, and skipped otherwise.
    const busy = { ...fresh, segments: fresh.segments!.map((s, i) => (i === 1 ? { ...s, takes: [take("w", { state: "waiting" })] } : s)) };
    expect("problem" in planQueue(project, clip, busy, items[1].id, "segment", { active })).toBe(true);
    // Everything current: nothing to do.
    expect(planQueue(project, clip, done, items[0].id, "all", { active })).toEqual({ problem: "These segments are already current, queued or generating" });
    // The scene anchor must be approved.
    const noAnchor = planQueue(project, clip, { ...shot, approvedAnchor: null }, items[0].id, "segment", { active });
    expect("problem" in noAnchor && noAnchor.problem).toMatch(/approve a scene anchor/);
    expect(planQueue(project, clip, { ...shot, mode: "preserve" }, items[0].id, "all", { active })).toEqual({ problem: expect.stringMatching(/keeps its original/) });
  });
});

// ---------------------------------------------------------------------------
// Masks

describe("mask point payloads", () => {
  const who = { selection: "rightmost" as const, index: 0, words: "the man in the hat" };
  const pts = [
    { x: 100, y: 200, label: "positive" as const },
    { x: 300, y: 50, label: "negative" as const },
  ];

  it("sends clicks to SAM 3.1 as each engine takes them", () => {
    expect(maskPointsPayload("open", pts, who)).toEqual({ points: pts, prompt: "the man in the hat", selection: "index", subjectIndex: 0 });
    expect(maskPointsPayload("open", [], who)).toEqual({ prompt: "the man in the hat", selection: "rightmost", subjectIndex: 0 });
    expect(maskPointsPayload("open", [], { selection: "index", index: 2, words: "" })).toEqual({ prompt: "person", selection: "index", subjectIndex: 2 });
    expect(maskPointsPayload("cloud", pts, who)).toEqual({ points: pts });
    expect(maskPointsPayload("cloud", [], who)).toEqual({ prompt: "the man in the hat" });
  });

  it("plans the open mask with the frame, its span and the version it corrects", () => {
    const clip = clipOf();
    const shot = shotOf(120, 360);
    const base: MaskVersion = { id: "m1", createdAt: 0, kind: "track", engine: "open", frame: 0, points: [], who, pieces: [{ from: 0, frames: 240, url: "/api/files/m1.mp4" }] };
    const [step] = planMask({ engine: "open", clip, shot, kind: "frame", frame: 30, points: pts, who, base });
    expect(step.request.modelId).toBe(STUDIO_MODELS.open.mask);
    // Frames 120–360 of the clip: Trim Video starts half a frame early and runs a quarter frame long.
    expect(step.request.params).toMatchObject({ startTime: 119.5 / 24, endTime: expect.closeTo((119.5 + 240.25) / 24, 9), points: pts, extra: { keyFrame: 30, spanFrames: 1, shotFrames: 240, prevMask: "/api/files/m1.mp4", selection: "index", subjectIndex: 0 } });
    // Tracking the whole shot from its first frame needs no earlier version.
    const [whole] = planMask({ engine: "open", clip, shot, kind: "track", frame: 0, points: [], who, base });
    expect((whole.request.params?.extra as Record<string, unknown>).prevMask).toBeUndefined();
    expect(whole.request.inputs?.video).toBe(clip.normalized!.url);
  });

  it("plans the cloud mask on a cut that starts at the clicked frame", () => {
    const clip = clipOf();
    const shot = shotOf(120, 360);
    const steps = planMask({ engine: "cloud", clip, shot, kind: "track", frame: 24, points: pts, who, base: null });
    expect(steps[0].request).toMatchObject({ modelId: "trim-video", params: { startTime: 6, endTime: 15 }, inputs: { video: clip.source.url } });
    expect(steps[1].request).toMatchObject({ modelId: "sam-3-1-video-mask", params: { points: pts, matteOutput: "matte" } });
    expect(steps[1].request.prompt).toBeUndefined();
    expect(steps[1].chain).toEqual([{ slot: "video" }]);
  });

  it("layers cloud pieces and finds the one covering a frame", () => {
    const base: MaskVersion = { id: "m1", createdAt: 0, kind: "track", engine: "cloud", frame: 0, points: [], who, pieces: [{ from: 0, frames: 240, url: "a" }] };
    const pieces = maskPieces("cloud", "track", 100, 240, base);
    expect(pieces).toEqual([
      { from: 0, frames: 240, url: "a" },
      { from: 100, frames: 140 },
    ]);
    const v = { ...base, pieces: [pieces[0], { ...pieces[1], url: "b" }] };
    expect(maskPieceAt(v, 50)?.url).toBe("a");
    expect(maskPieceAt(v, 150)?.url).toBe("b");
    expect(maskPieceAt(v, 240)).toBeNull();
    expect(maskPieces("open", "frame", 100, 240, base)).toEqual([{ from: 0, frames: 240 }]);
    expect(maskProblem("open", "frame", 10, 240, [], who, base)).toMatch(/Click the person/);
    expect(maskProblem("open", "frame", 10, 240, pts, who, null)).toMatch(/Track the shot first/);
    expect(maskProblem("cloud", "track", 10, 240, [{ x: 1, y: 1, label: "negative" }], who, null)).toMatch(/include point/);
    expect(maskProblem("cloud", "track", 240, 240, [], who, null)).toMatch(/inside the shot/);
    expect(maskProblem("cloud", "track", 0, 240, [], who, base)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Takes and review

describe("takes and review", () => {
  const seg: SwapSegment = { ...newSegment(shotOf(0, 120), 0, 120, 0, seq()), takes: [take("a"), take("b"), take("c", { state: "stopped", reason: "x" })], selectedTake: "a" };

  it("picks, favourites, decides and notes takes", () => {
    expect(selectTake(seg, "b").selectedTake).toBe("b");
    expect(() => selectTake(seg, "c")).toThrow(/didn't run/);
    expect(() => selectTake(seg, "zz")).toThrow(/gone/);
    const fav = updateTake(seg, "b", { favourite: true, decision: "keep", notes: "Best eyes" });
    expect(fav.takes[1]).toMatchObject({ favourite: true, decision: "keep", notes: "Best eyes" });
    expect(() => updateTake(seg, "b", { notes: "x".repeat(2001) })).toThrow(/2,000/);
    expect(removeTake(seg, "a").selectedTake).toBeNull();
    expect(removeTake(seg, "b").selectedTake).toBe("a");
  });

  it("selects a finished take only when nothing changed since it was queued", () => {
    const clip = clipOf();
    const project = projectOf([clip]);
    const shot = shotOf(0, 120, { settings: { ...DEFAULT_SETTINGS, useAnchor: false } });
    const items = currentSegments(shot);
    const s = items[0];
    const t = take("new", { signature: settingSignature(project, clip, shot, s), dependencies: [], replaces: null });
    expect(autoSelect(project, clip, shot, s, t, items)).toBe(true);
    expect(autoSelect(project, clip, shot, { ...s, selectedTake: "other" }, t, items)).toBe(false);
    expect(autoSelect(project, clip, shot, { ...s, seed: 99 }, t, [{ ...s, seed: 99 }])).toBe(false);
  });

  it("exports every decision as JSON", () => {
    const clip = clipOf({ review: "maybe", reviewNotes: "Check shot 2", shots: [shotOf(0, 120, { segments: [seg] }), shotOf(120, 480, { mode: "preserve" })] });
    const out = exportDecisions(projectOf([clip]), (t) => (t.id === "a" ? "/api/files/a.mp4" : undefined), new Date("2026-10-27T10:00:00Z"));
    expect(out.exportedAt).toBe("2026-10-27T10:00:00.000Z");
    expect(out.clips[0]).toMatchObject({ clip: "walk", review: "maybe", notes: "Check shot 2", assembled: false });
    expect(out.clips[0].shots[0].segments[0]).toMatchObject({ segment: 1, frames: [0, 120], selectedTake: "a" });
    expect(out.clips[0].shots[0].segments[0].takes[0]).toMatchObject({ take: "a", video: "/api/files/a.mp4", decision: "pending" });
    expect(out.clips[0].shots[1].segments).toEqual([]);
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });
});

// ---------------------------------------------------------------------------
// Engine steps

describe("engine steps", () => {
  it("prepares the clip at 24 fps on your GPU and transcribes on both engines", () => {
    const clip = clipOf();
    const [n] = planNormalize(clip);
    expect(n.request).toMatchObject({ modelId: "oss-fit-clip", op: "trim", inputs: { video: clip.source.url }, params: { startTime: 0, fps: 24, extra: { width: 1920, height: 1080 } } });
    expect(n.request.feature).toBe("swap-studio-step");
    expect(planTranscribe(clip, "cloud")[0].request).toMatchObject({ modelId: "scribe-v2", inputs: { video: clip.source.url } });
    expect(planTranscribe(clip, "open")[0].request).toMatchObject({ modelId: "oss-qwen3-asr", inputs: { video: clip.normalized!.url } });
  });

  it("makes an anchor from the frame with the engine's image edit", () => {
    const clip = clipOf();
    const project = projectOf([clip]);
    const shot = shotOf(48, 300, { anchorInstructions: "Rain on her hood", who: { selection: "leftmost", index: 0, words: "person" } });
    const open = planAnchor({ engine: "open", project, clip, shot, frame: 48 });
    expect(open.map((s) => s.request.modelId)).toEqual(["oss-extract-frame", "oss-qwen-image-21"]);
    expect(open[0].request.params).toMatchObject({ startTime: 47.5 / 24, extra: { frameIndex: 0 } });
    expect(open[1].request.prompt).toContain("Replace ONLY the person on the left");
    expect(open[1].request.prompt).toContain("a woman in a yellow raincoat");
    expect(open[1].request.prompt?.endsWith("Rain on her hood")).toBe(true);
    expect(open[1].chain).toEqual([{ slot: "images", position: "first" }]);
    const cloud = planAnchor({ engine: "cloud", project, clip, shot: { ...shot, anchorBasePrompt: "My own brief" }, frame: 48, modelId: "nano-banana-pro" });
    expect(cloud.map((s) => s.request.modelId)).toEqual(["trim-video", "extract-frame", "nano-banana-pro"]);
    expect(cloud[2].request.prompt).toBe("My own brief\n\nRain on her hood");
  });

  it("plans a take on your GPU with the mask, the history master and the anchor after the boundary", () => {
    const clip = clipOf();
    const project = projectOf([clip]);
    const shot = shotOf(120, 420, { settings: { ...DEFAULT_SETTINGS, lora: "v1", expansion: 32 } });
    const items = currentSegments(shot);
    const { steps, final } = planSegmentTake({
      engine: "open",
      project,
      clip,
      shot,
      seg: items[1],
      shotNumber: 2,
      segNumber: 2,
      takeNumber: 1,
      prompt: "P <Picture 2>",
      history: 18,
      anchor: "/api/files/anchor.png",
      mask: "/api/files/mask.mp4",
      previous: { master: "/api/files/master.mkv", frames: 124 },
    });
    expect(final).toBe("swap");
    const r = steps[0].request;
    expect(r.modelId).toBe("oss-h3-swap-segment");
    expect(r.inputs).toEqual({ video: clip.normalized!.url, images: [project.character.image, "/api/files/anchor.png"] });
    // The source starts 18 frames before the segment (the history the master replaces).
    const first = 120 + 124 - 18;
    expect(r.params).toMatchObject({ startTime: (first - 0.5) / 24, endTime: expect.closeTo((first - 0.5 + (247 - 124 + 18) + 0.25) / 24, 9), resolution: "768p", seed: items[1].seed });
    expect(r.params?.extra).toMatchObject({ lora: "v1", maskGrow: 32, maskVideo: "/api/files/mask.mp4", maskStart: (124 - 18 - 0.5) / 24, historyVideo: "/api/files/master.mkv", historyStart: 106, historyLength: 18, anchorAfterHistory: true });
    expect(() => planSegmentTake({ engine: "open", project, clip, shot, seg: items[1], shotNumber: 1, segNumber: 2, takeNumber: 1, prompt: "", history: 18, anchor: null, previous: null })).toThrow(/lossless master/);
  });

  it("plans a cloud take: the cut, the previous take's last frame and fal's H3 with the LoRA", () => {
    const clip = clipOf();
    const project = projectOf([clip], "cloud");
    const shot = shotOf(0, 300, { who: { selection: "rightmost", index: 0, words: "person" } });
    const items = currentSegments(shot);
    const { steps, final } = planSegmentTake({ engine: "cloud", project, clip, shot, seg: items[1], shotNumber: 1, segNumber: 2, takeNumber: 3, prompt: "Replace only the selected person in <Video 1>. <Picture 2> is the generated boundary. <Picture 3> is a reference.", history: 18, anchor: "/api/files/a.png", previous: { video: "/api/files/prev.mp4", frames: 124 } });
    expect(steps.map((s) => s.key)).toEqual(["cut", "boundary", "swap", "fit"]);
    // H3 makes whole seconds (6 s for these 123 frames): the take is cut back to the segment, so the next segment's
    // boundary is this one's real last frame and the take lines up with the clip's sound.
    expect(final).toBe("fit");
    expect(steps[3]).toMatchObject({ request: { modelId: "trim-video", params: { startTime: 0, endTime: 123 / 24 } }, after: ["swap"], chain: [{ slot: "video" }] });
    expect(steps[0].request.params).toEqual({ startTime: 124 / 24, endTime: 247 / 24 });
    expect(steps[1].request).toMatchObject({ modelId: "extract-frame", inputs: { video: "/api/files/prev.mp4" }, params: { extra: { frame_type: "last" } } });
    const swap = steps[2];
    expect(swap.request.modelId).toBe("fuobe-character-swap");
    // Image 2 is the anchor (a fixed input), Image 3 the boundary (chained after it): the prompt says so.
    expect(swap.request.inputs?.images).toEqual([project.character.image, "/api/files/a.png"]);
    expect(swap.chain).toEqual([{ slot: "video" }, { slot: "images", position: "last" }]);
    expect(swap.request.prompt).toBe("Replace only the person on the right in Video 1. Image 3 is the generated boundary. Image 2 is a reference.");
    expect(swap.request.loras?.[0].file).toBe("h3_character_swap_v1.5.safetensors");
    expect(swap.request.params).toMatchObject({ duration: 6, sourceDuration: 123 / 24, resolution: "768p" });
    expect(cloudCallSeconds(48)).toBe(5);
    expect(cloudCallSeconds(361)).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Assembly plan

describe("assembly", () => {
  const clip = clipOf();
  const project = projectOf([clip]);
  const shots = [shotOf(0, 100, { mode: "preserve" }), shotOf(100, 160, { mode: "preserve" }), ready(project, clip, shotOf(160, 400, { settings: { ...DEFAULT_SETTINGS, useAnchor: false } })), shotOf(400, 480, { mode: "preserve" })];
  const assembled = { ...clip, shots };

  it("lays the chosen takes over the original timeline, kept shots merged", () => {
    const r = assemblyPieces(project, assembled);
    expect("pieces" in r).toBe(true);
    const pieces = "pieces" in r ? r.pieces : [];
    expect(pieces.map((p) => [p.kind, p.start, p.end])).toEqual([
      ["source", 0, 160],
      ["take", 160, 284],
      ["take", 284, 400],
      ["source", 400, 480],
    ]);
    expect(assemblyTakes(pieces).length).toBe(2);
    expect("stale" in r && r.stale).toEqual([]);
    const missing = assemblyPieces(project, { ...assembled, shots: [shots[0], shotOf(100, 480)] });
    expect("problem" in missing && missing.problem).toMatch(/Shot 2, segment 1 has no chosen take/);
    expect(assemblyPieces(project, { ...assembled, shots: [shots[0]] })).toEqual({ problem: expect.stringMatching(/No shot replaces/) });
  });

  it("fits, joins and puts the sound back on your GPU", () => {
    const r = assemblyPieces(project, assembled);
    const pieces = "pieces" in r ? r.pieces : [];
    const { steps, final } = planAssembly({ engine: "open", clip: assembled, pieces, videoOf: (p) => `/api/files/${p.take.id}.mp4` });
    expect(final).toBe("final");
    expect(steps.filter((s) => s.request.modelId === "oss-fit-clip").length).toBe(4);
    expect(steps[0].request.params).toMatchObject({ startTime: 0, endTime: 160 / 24, fps: 24, extra: { width: 1920, height: 1080 } });
    expect(steps[3].request.params).toMatchObject({ startTime: 400 / 24, endTime: 400 / 24 + 80 / 24 });
    expect(steps[1].request).toMatchObject({ inputs: { video: `/api/files/${pieces[1].kind === "take" ? pieces[1].take.id : ""}.mp4` }, params: { startTime: 0, endTime: 124 / 24 } });
    const join = steps.find((s) => s.key === "join")!;
    expect(join.request.modelId).toBe("oss-join-encoded");
    expect(join.after).toEqual(["piece0", "piece1", "piece2", "piece3"]);
    const mux = steps.find((s) => s.key === "final")!;
    expect(mux.request).toMatchObject({ modelId: "oss-mux", feature: "swap-studio", inputs: { audio: clip.normalized!.url } });
    expect(steps.filter((s) => s.request.feature === "swap-studio").length).toBe(1);
  });

  it("cuts, joins in folds of 24 and mutes a silent clip on the cloud", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ kind: "source" as const, start: i * 10, end: i * 10 + 10 }));
    const silent = { ...clip, source: { ...clip.source, hasAudio: false } };
    const { steps, final } = planAssembly({ engine: "cloud", clip: silent, pieces: many, videoOf: () => "" });
    expect(final).toBe("final");
    expect(steps.filter((s) => s.request.modelId === "join-clips").map((s) => s.after?.length)).toEqual([24, 6, 2]);
    const mux = steps.find((s) => s.key === "final")!;
    expect(mux.request.inputs?.audio).toMatch(/^silence:|20/);
    expect(steps.find((s) => s.key === "join")!.request.params?.extra).toEqual({ target_fps: 24 });
    // One piece with sound: no join, the cut (scaled to the film's frame) goes straight to the mux.
    const one = planAssembly({ engine: "cloud", clip, pieces: [{ kind: "source", start: 0, end: 480 }], videoOf: () => "" });
    expect(one.steps.map((s) => s.key)).toEqual(["piece0-cut", "piece0", "final"]);
    expect(one.steps[2].after).toEqual(["piece0"]);
  });

  it("ends on the join for a silent clip on your GPU", () => {
    const silent = { ...clip, source: { ...clip.source, hasAudio: false } };
    const { steps, final } = planAssembly({ engine: "open", clip: silent, pieces: [{ kind: "source", start: 0, end: 100 }, { kind: "source", start: 100, end: 200 }], videoOf: () => "" });
    expect(final).toBe("join");
    expect(steps.find((s) => s.key === "join")!.request.feature).toBe("swap-studio");
  });
});

describe("signatures", () => {
  it("are stable whatever the key order", () => {
    expect(stableJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(digest({ a: 1, b: 2 })).toBe(digest({ b: 2, a: 1 }));
    expect(digest({ a: 1 })).not.toBe(digest({ a: 2 }));
  });
});

// ---------------------------------------------------------------------------
// Review fixes: continuation on both engines, stale takes, engine-bound masks, anchors off, the cloud's browser copy

describe("continuing a segment", () => {
  it("your GPU's master keeps only the frames the next segment reads", () => {
    const shot = shotOf(0, 480, { settings: { ...DEFAULT_SETTINGS, useAnchor: false } });
    const items = currentSegments(shot);
    // The default layout continues with 18 frames of history: each master keeps 18 frames, not the whole segment.
    expect(items.map((_, i) => masterKeep(items, i, shot.settings))).toEqual([18, 18, 18, 18]);
    const longer = items.map((g, i) => (i === 2 ? { ...g, history: 52 } : g));
    expect(masterKeep(longer, 1, shot.settings)).toBe(52);
    // Never more than the segment, at least one frame.
    expect(masterKeep([{ ...items[0], end: 10 }], 0, { historyFrames: 18 })).toBe(10);
    expect(masterKeep(items, 3, { historyFrames: 0 })).toBe(1);

    const clip = clipOf();
    const project = projectOf([clip]);
    const plan = planSegmentTake({ engine: "open", project, clip, shot, seg: items[1], shotNumber: 1, segNumber: 2, takeNumber: 1, prompt: "P", history: 18, anchor: null, previous: { master: "/api/files/master.mkv", frames: 18 }, keep: 18 });
    // The previous master holds 18 frames: the history is all of them.
    expect(plan.steps[0].request.params?.extra).toMatchObject({ historyStart: 0, historyLength: 18, masterKeep: 18, segmentFrames: items[1].end - items[1].start });
  });

  it("refuses to continue from a take whose master kept fewer frames than the history asks for", () => {
    const clip = clipOf();
    const project = projectOf([clip]);
    const base = shotOf(0, 300, { settings: { ...DEFAULT_SETTINGS, useAnchor: false } });
    const done = ready(project, clip, { ...base, segments: currentSegments(base) });
    const kept = (n: number) => ({ ...done, segments: done.segments!.map((g, i) => (i === 0 ? { ...g, takes: g.takes.map((t) => ({ ...t, frozen: { ...freezeTake(project, done, g), keep: n } })) } : i ? { ...g, takes: [], selectedTake: null } : g)) });
    const short = planQueue(project, clip, kept(1), done.segments![1].id, "segment", { active: () => false, hasMaster: () => true });
    expect("problem" in short && short.problem).toMatch(/kept its last 1 frame to continue from — use at most 1 frames of history/);
    expect("entries" in planQueue(project, clip, kept(18), done.segments![1].id, "segment", { active: () => false, hasMaster: () => true })).toBe(true);
  });

  it("a frozen take on your GPU saves the frames it was queued to keep", () => {
    const clip = clipOf();
    const project = projectOf([clip]);
    const shot = shotOf(0, 300, { settings: { ...DEFAULT_SETTINGS, useAnchor: false } });
    const items = currentSegments(shot);
    const t = take("k", { prompt: "P", frozen: { ...freezeTake(project, shot, items[0]), keep: 35 } });
    const plan = frozenTakePlan(project, clip, shot, items[0], t, { shot: 1, segment: 1, take: 1 }, null);
    expect(plan.steps[0].request.params?.extra).toMatchObject({ masterKeep: 35, segmentFrames: items[0].end - items[0].start });
  });
});

describe("assembling with takes made before later changes", () => {
  it("uses the chosen takes as they are and names the out-of-date ones", () => {
    const clip = clipOf();
    const project = projectOf([clip], "cloud");
    const shot = ready(project, clip, shotOf(0, 120, { settings: { ...DEFAULT_SETTINGS, useAnchor: false } }));
    const c = { ...clip, shots: [shot, shotOf(120, 480, { mode: "preserve" })] };
    expect(assemblyPieces(project, c)).toMatchObject({ stale: [] });
    // A new description changes every prompt: the takes are out of date, the assembly still runs with them.
    const edited = { ...project, character: { ...project.character, description: "a woman in a red coat" } };
    expect(segmentStates(edited, c, shot)[0].status).toBe("stale");
    const r = assemblyPieces(edited, c);
    expect("pieces" in r && r.pieces.map((p) => p.kind)).toEqual(["take", "source"]);
    expect("stale" in r && r.stale).toEqual(["Shot 1, segment 1"]);
    // A take that never ran can't be assembled.
    const stopped = { ...shot, segments: shot.segments!.map((g) => ({ ...g, takes: g.takes.map((t) => ({ ...t, state: "stopped" as const })) })) };
    expect(assemblyPieces(project, { ...c, shots: [stopped, c.shots[1]] })).toEqual({ problem: expect.stringMatching(/no chosen take/) });
  });
});

describe("masks belong to the engine that made them", () => {
  const who = { selection: "largest" as const, index: 0, words: "person" };
  const cloudMask: MaskVersion = { id: "mc", createdAt: 0, kind: "track", engine: "cloud", frame: 30, points: [], who, pieces: [{ from: 30, frames: 210, url: "/api/files/cloudmask.mp4" }] };
  const gpuMask: MaskVersion = { id: "mg", createdAt: 0, kind: "track", engine: "open", frame: 0, points: [], who, pieces: [{ from: 0, frames: 240, url: "/api/files/gpumask.mp4" }] };

  it("a cloud-approved mask isn't sent to your GPU's segment graph, nor counted in its signature", () => {
    const clip = clipOf();
    const project = projectOf([clip]);
    const shot = shotOf(0, 240, { masks: [cloudMask], approvedMask: "mc", settings: { ...DEFAULT_SETTINGS, useAnchor: false } });
    expect(approvedMask(shot)).toBe(cloudMask);
    expect(approvedMask(shot, "open")).toBeNull();
    expect(freezeTake(project, shot, currentSegments(shot)[0]).mask).toBeNull();
    const plain = shotOf(0, 240, { settings: { ...DEFAULT_SETTINGS, useAnchor: false } });
    expect(settingSignature(project, clip, { ...shot, id: plain.id }, currentSegments(shot)[0])).toBe(settingSignature(project, clip, plain, currentSegments(shot)[0]));
    // Your GPU's own approved mask is.
    const own = { ...shot, masks: [cloudMask, gpuMask], approvedMask: "mg" };
    expect(freezeTake(project, own, currentSegments(own)[0]).mask).toBe("/api/files/gpumask.mp4");
  });

  it("Track shot corrects this engine's versions only", () => {
    const shot = shotOf(0, 240, { masks: [gpuMask, cloudMask], approvedMask: "mc" });
    expect(defaultMaskBase(shot, "open")).toBe(gpuMask);
    expect(defaultMaskBase(shot, "cloud")).toBe(cloudMask);
    expect(defaultMaskBase({ ...shot, masks: [cloudMask] }, "open")).toBeNull();
    expect(maskProblem("open", "track", 0, 240, [], who, defaultMaskBase({ ...shot, masks: [cloudMask] }, "open"))).toBeNull();
    expect(maskProblem("open", "track", 0, 240, [], who, cloudMask)).toMatch(/other engine/);
  });
});

describe("scene anchor off", () => {
  it("a segment set to the scene anchor runs without one once anchors are off", () => {
    const clip = clipOf();
    const project = projectOf([clip], "cloud");
    const base = shotOf(0, 240);
    const items = currentSegments(base);
    expect(items[0].anchorMode).toBe("shot");
    const on = planQueue(project, clip, { ...base, segments: items }, items[0].id, "segment", { active: () => false });
    expect("problem" in on && on.problem).toMatch(/approve a scene anchor/);
    const off = { ...base, segments: items, settings: { ...base.settings, useAnchor: false } };
    expect("entries" in planQueue(project, clip, off, items[0].id, "segment", { active: () => false })).toBe(true);
    // A segment reference of its own is still needed when picked.
    const custom = { ...off, segments: items.map((g, i) => (i ? g : { ...g, anchorMode: "custom" as const })) };
    const r = planQueue(project, clip, custom, items[0].id, "segment", { active: () => false });
    expect("problem" in r && r.problem).toMatch(/pick its reference image/);
  });
});

describe("the cloud's pieces", () => {
  it("scales every piece to one frame inside merge-videos' 512–2048 px and joins at 24 fps", () => {
    expect(cloudFilmSize(1920, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(cloudFilmSize(3840, 2160)).toEqual({ width: 2048, height: 1152 });
    expect(cloudFilmSize(72, 128)).toEqual({ width: 512, height: 910 });
    expect(cloudFilmSize(undefined, 1080)).toBeNull();
    const clip = clipOf();
    const t = take("t1");
    const { steps } = planAssembly({ engine: "cloud", clip, pieces: [{ kind: "source", start: 0, end: 100 }, { kind: "take", start: 100, end: 224, take: t, segmentId: "s" }], videoOf: () => "/api/files/take.mp4" });
    expect(steps.map((s) => [s.key, s.request.modelId])).toEqual([
      ["piece0-cut", "trim-video"],
      ["piece0", "scale-video"],
      ["piece1", "scale-video"],
      ["join", "join-clips"],
      ["final", "merge-audio-video"],
    ]);
    expect(steps[1]).toMatchObject({ request: { op: "reframe", params: { extra: { width: 1920, height: 1080 } } }, after: ["piece0-cut"], chain: [{ slot: "video" }] });
    // A take is already its segment's length (planSegmentTake trims it): it is only scaled.
    expect(steps[2].request.inputs).toEqual({ video: "/api/files/take.mp4" });
  });

  it("Update frame near the clip's end reads its last half second, the clicks on the frame inside it", () => {
    const clip = clipOf();
    const shot = shotOf(400, 480);
    expect(cloudMaskCut(clip, shot, "frame", 10)).toEqual({ from: 410, to: 422, offset: 0 });
    // Past the shot's end is fine (the clicked frame is what counts); the clip's end isn't.
    expect(cloudMaskCut(clip, shotOf(0, 100), "frame", 99)).toEqual({ from: 99, to: 111, offset: 0 });
    expect(cloudMaskCut(clip, shot, "frame", 79)).toEqual({ from: 468, to: 480, offset: 11 });
    expect(cloudMaskCut(clip, shot, "track", 20)).toEqual({ from: 420, to: 480, offset: 0 });
    const steps = planMask({ engine: "cloud", clip, shot, kind: "frame", frame: 79, points: [{ x: 5, y: 6, label: "positive" }], who: shot.who, base: null });
    expect(steps[0].request.params).toEqual({ startTime: 468 / 24, endTime: 20 });
    expect(steps[1].request.params?.points).toEqual([{ x: 5, y: 6, label: "positive", frame: 11 }]);
    // fal's SAM 3.1 video takes the frame as frame_index (left out on the first frame).
    expect(pointsValue("sam", [{ x: 5, y: 6, frame: 11 }, { x: 1, y: 2, label: "negative" }])).toEqual([
      { x: 5, y: 6, label: 1, frame_index: 11 },
      { x: 1, y: 2, label: 0 },
    ]);
    expect(maskPieces("cloud", "frame", 79, 80, null, 11)).toEqual([{ from: 79, frames: 1, offset: 11 }]);
  });

  it("makes a copy the browser can play when it can't play the clip (AVI, or a codec it lacks)", () => {
    const avi = clipOf({ source: { ...clipOf().source, url: "/api/files/uploads/x/old.avi", name: "old.avi" }, normalized: null });
    const mkv = clipOf({ source: { ...clipOf().source, name: "a.mkv", playable: false }, normalized: null });
    const mp4 = clipOf({ normalized: null });
    expect([avi, mkv, mp4].map((c) => clipNeedsPreview("cloud", c))).toEqual([true, true, false]);
    expect(clipNeedsPreview("open", avi)).toBe(false);
    const [step] = planPreview(avi)!;
    expect(step.request).toMatchObject({ modelId: "scale-video", op: "reframe", inputs: { video: avi.source.url }, params: { extra: { width: 1920, height: 1080 } }, feature: "swap-studio-step" });
    expect(planPreview({ ...avi, source: { ...avi.source, width: undefined } })).toBeNull();
    // The page plays the copy once it's made; the cloud's jobs still read the upload as filmed.
    expect(pageClip("cloud", avi)).toBe(avi.source.url);
    expect(pageClip("cloud", { ...avi, preview: { url: "/api/files/copy.mp4" } })).toBe("/api/files/copy.mp4");
    expect(pageClip("open", clipOf())).toBe(clipOf().normalized!.url);
  });
});

describe("your GPU's mask memory", () => {
  it("refuses a shot the server can't hold, in words", () => {
    const GB = 2 ** 30;
    const shot = { width: 1920, height: 1080, quality: "768p", shotFrames: 240, correcting: true };
    expect(maskMemoryProblem(shot, 64 * GB)).toBeNull();
    expect(maskMemoryProblem(shot, 16 * GB)).toMatch(/needs about \d+ GB of RAM and this ComfyUI can spare 8 GB.*or track it at 0\.5 MP/);
    // Tracking holds fewer copies than correcting; 0.5 MP holds half.
    expect(maskMemoryProblem({ ...shot, correcting: false }, 32 * GB)).toBeNull();
    expect(maskMemoryProblem({ ...shot, quality: "480p" }, 32 * GB)).toBeNull();
    expect(maskMemoryProblem({ ...shot, shotFrames: 3592 }, 64 * GB)).toMatch(/149\.7 s shot/);
    expect(maskMemoryProblem({ ...shot, width: undefined }, 1)).toBeNull();
  });
});

describe("the fine pass of Detect edits", () => {
  it("reads frames at the clip's size (a small picture scores a cut lower), in bounded pieces", () => {
    // Shrinking averages pixels: a cut between two textures scores lower when downscaled.
    const a = new Uint8ClampedArray(4 * 4 * 4);
    const b = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 16; i++) {
      const v = (i + Math.floor(i / 4)) % 2 ? 255 : 0;
      a.set([v, v, v, 255], i * 4);
      b.set([255 - v, 255 - v, 255 - v, 255], i * 4);
    }
    const avg = (px: Uint8ClampedArray) => {
      let t = 0;
      for (let i = 0; i < 16; i++) t += px[i * 4];
      const m = t / 16;
      return new Uint8ClampedArray([m, m, m, 255]);
    };
    expect(mafd(a, b)).toBe(255);
    expect(mafd(avg(a), avg(b))).toBeLessThan(1);
    expect(fineWidth(1920)).toBe(FINE_MAX_WIDTH);
    expect(fineWidth(480)).toBe(480);
    expect(fineWidth(undefined)).toBe(640);
    // Pieces decide on the same frames as the whole stretch: each starts two frames before its first decision.
    const w = { from: 100, to: 160 };
    const pieces = windowChunks(w, 24);
    expect(pieces).toEqual([
      { from: 100, to: 123 },
      { from: 122, to: 145 },
      { from: 144, to: 160 },
    ]);
    const frames = windowFrames(w);
    const pixels = frames.map((f) => frame(f < 150 ? 10 : 240));
    const whole = windowCuts(frames, pixels, 480);
    const parts = pieces.flatMap((p) => {
      const fs = windowFrames(p);
      return windowCuts(fs, fs.map((f) => pixels[f - w.from]), 480);
    });
    expect(whole).toEqual([150]);
    expect(parts).toEqual(whole);
    expect(windowChunks({ from: 0, to: 5 }, 24)).toEqual([{ from: 0, to: 5 }]);
  });
});

describe("from Genjutsu", () => {
  it("opens the whole clip and the character in a new project on the same engine", () => {
    const h = studioHandOff({ engine: "cloud", clip: { url: "/api/files/uploads/x/street.mov", name: "street.mov", size: 1234, duration: 42, width: 1920, height: 1080 }, image: "/api/files/uploads/x/hero.png", description: "  a knight\n in armour " });
    expect(h).toEqual({
      project: { name: "street", engine: "cloud", character: { image: "/api/files/uploads/x/hero.png", description: "a knight in armour" } },
      clip: { url: "/api/files/uploads/x/street.mov", name: "street.mov", bytes: 1234, duration: 42, width: 1920, height: 1080 },
    });
    // Still uploading (no file yet), or nothing: an empty project with the character.
    expect(studioHandOff({ engine: "open", clip: { name: "a.mp4" }, image: "blob:x" })).toEqual({ project: { name: "Character swap", engine: "open", character: { image: null, description: "" } }, clip: null });
  });
});
