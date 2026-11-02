import { describe, expect, it } from "vitest";
import {
  gapFor,
  gapPrompt,
  gapSelection,
  keptFrames,
  keyTimes,
  madeFrames,
  moveKey,
  requestTiming,
  snapGapFrames,
  stepGap,
  timingFor,
  timingFromTimes,
  timingProblem,
  totalFrames,
  totalSeconds,
  WORKFLOW_TIMING,
} from "@/lib/inbetween";

/** The frame indexes VHS's every-Nth selection keeps: images[skip::every]. */
const picked = (frames: number, speed: 1 | 2 | 3 | 4) => {
  const { skip, every } = gapSelection({ frames, speed });
  const out: number[] = [];
  for (let i = skip; i < frames; i += every) out.push(i);
  return out;
};

describe("in-between timing", () => {
  it("snaps a gap to Wan's 4n + 1 frames, 17 to 81", () => {
    expect(snapGapFrames(10)).toBe(17);
    expect(snapGapFrames(36)).toBe(37);
    expect(snapGapFrames(38)).toBe(37);
    expect(snapGapFrames(40)).toBe(41);
    expect(snapGapFrames(500)).toBe(81);
    expect(snapGapFrames(Number.NaN)).toBe(17);
    expect(stepGap({ frames: 17, speed: 1 }, -1).frames).toBe(17);
    expect(stepGap({ frames: 17, speed: 2 }, 1)).toEqual({ frames: 21, speed: 2 });
  });

  it("keeps every Nth frame counted back from the next keyframe, never the keyframe before", () => {
    for (const frames of [17, 21, 37, 45, 81])
      for (const speed of [1, 2, 3, 4] as const) {
        const p = picked(frames, speed);
        expect(p.at(-1)).toBe(frames - 1); // the next keyframe is on screen
        expect(p[0]).toBeGreaterThan(0); // the joint frame is dropped
        expect(p.length).toBe(gapSelection({ frames, speed }).kept);
        for (let i = 1; i < p.length; i++) expect(p[i] - p[i - 1]).toBe(speed);
      }
    expect(picked(17, 3)).toEqual([1, 4, 7, 10, 13, 16]);
    expect(picked(17, 4)).toEqual([4, 8, 12, 16]);
  });

  it("times the workflow's own five keyframes", () => {
    // 37 ×1 → 36, 17 ×3 → 6, 17 ×4 → 4, 45 ×1 → 44, plus keyframe 1.
    expect(keptFrames(WORKFLOW_TIMING)).toEqual([37, 6, 4, 44]);
    expect(totalFrames(WORKFLOW_TIMING)).toBe(91);
    expect(totalSeconds(WORKFLOW_TIMING)).toBeCloseTo(91 / 24);
    expect(keyTimes(WORKFLOW_TIMING)).toEqual([0, 1.5, 1.75, 1.917, 3.75]);
    expect(madeFrames(WORKFLOW_TIMING)).toBe(116);
    expect(totalSeconds({ ...WORKFLOW_TIMING, fps: 16 })).toBeCloseTo(91 / 16);
  });

  it("maps Frames mode's times to gaps at the playback rate", () => {
    const t = timingFromTimes([0, 1.5, 3, 4]);
    expect(t.fps).toBe(24);
    expect(t.gaps.map((g) => g.frames)).toEqual([37, 37, 25]);
    expect(keyTimes(t)).toEqual([0, 1.5, 3, 4]);
    // ×2 makes twice the frames for the same time; true time at 16 fps.
    expect(timingFromTimes([0, 1], { speed: 2 }).gaps[0]).toEqual({ frames: 49, speed: 2 });
    expect(timingFromTimes([0, 2], { fps: 16 }).gaps[0].frames).toBe(33);
    // The cloud keeps every frame at 16 fps.
    expect(timingFromTimes([0, 2], { fps: 24, speed: 3, engine: "cloud" })).toEqual({ gaps: [{ frames: 33, speed: 1 }], fps: 16 });
    // Too close: the shortest pass.
    expect(gapFor(0.1, 1, 24).frames).toBe(17);
  });

  it("moves a keyframe by retiming the gaps on either side", () => {
    const t = timingFromTimes([0, 1, 2]);
    const moved = moveKey(t, 1, 1.5);
    expect(keyTimes(moved)[1]).toBeCloseTo(1.5);
    expect(keyTimes(moved)[2]).toBeCloseTo(2.167, 2); // the later keyframe stays close (the shortest pass is 17 frames)
    expect(moveKey(t, 0, 3)).toBe(t);
  });

  it("fits saved timing to the keyframes and the engine", () => {
    const t = timingFor(4, { gaps: [{ frames: 30, speed: 3, prompt: "  jumps " }], fps: 16 });
    expect(t.gaps).toEqual([{ frames: 29, speed: 3, prompt: "jumps" }, { frames: 33, speed: 1 }, { frames: 33, speed: 1 }]);
    expect(timingFor(3, { gaps: [{ frames: 21, speed: 4 }], fps: 24 }, "cloud")).toEqual({ gaps: [{ frames: 21, speed: 1 }, { frames: 33, speed: 1 }], fps: 16 });
  });

  it("says what's wrong", () => {
    expect(timingProblem(timingFor(2, undefined), 1)).toMatch(/two keyframes/);
    expect(timingProblem({ gaps: [{ frames: 18, speed: 1 }], fps: 24 }, 2)).toMatch(/17 to 81/);
    expect(timingProblem({ gaps: [{ frames: 17, speed: 3 }], fps: 16 }, 2, "cloud")).toMatch(/your GPU/);
    expect(timingProblem({ gaps: [{ frames: 17, speed: 1 }], fps: 24 }, 2, "cloud")).toMatch(/16 fps/);
    expect(timingProblem({ gaps: [{ frames: 17, speed: 1 }], fps: 24 }, 3)).toMatch(/2 gaps/);
    expect(timingProblem(WORKFLOW_TIMING, 5)).toBeNull();
  });

  it("reads a request's timing, or makes it from the frame times", () => {
    expect(requestTiming({ inbetween: WORKFLOW_TIMING }, 5, undefined, "open")).toEqual(WORKFLOW_TIMING);
    expect(requestTiming({}, 3, [0, 1, 2], "open").gaps.map((g) => g.frames)).toEqual([25, 25]);
    expect(requestTiming(undefined, 2, undefined, "cloud")).toEqual({ gaps: [{ frames: 33, speed: 1 }], fps: 16 });
    expect(() => requestTiming({ inbetween: { gaps: [{ frames: 17, speed: 9 }], fps: 24 } }, 2, undefined, "open")).toThrow(/×1 to ×4/);
  });

  it("writes each gap's words", () => {
    expect(gapPrompt("A girl turns. ", { prompt: "she waves" }, true)).toBe("A girl turns. she waves. mouth does not move");
    expect(gapPrompt("", {}, false)).toBe("");
  });
});
