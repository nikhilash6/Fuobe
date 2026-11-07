import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import { onEngine } from "@/lib/catalog/engines";
import { estimateCost } from "@/lib/catalog/plan";
import { GAP_STEP, keyTimes, MAX_GAP_FRAMES, MIN_GAP_FRAMES, resampleGap } from "@/lib/inbetween";

/*
 * Fuobe Animation in the cloud: Replicate's fast Wan 2.2 makes at least 81 frames a clip, so each gap (17-81 frames in
 * steps of 4) is made as 81 and brought down to its own frames inside the film.
 */
describe("a gap made as 81 frames, brought to its own length", () => {
  it("takes every Nth frame exactly where 80 divides by the gap's steps", () => {
    expect(resampleGap(81, 17)).toEqual({ interval: 5, picks: Array.from({ length: 17 }, (_, i) => i) });
    expect(resampleGap(81, 21)).toEqual({ interval: 4, picks: Array.from({ length: 21 }, (_, i) => i) });
    expect(resampleGap(81, 41)).toEqual({ interval: 2, picks: Array.from({ length: 41 }, (_, i) => i) });
    // The frames taken are the made frames 0, N, 2N … 80: both keyframes land on screen.
    for (const f of [17, 21, 41]) {
      const r = resampleGap(81, f)!;
      expect((r.picks.at(-1)! * r.interval), `${f}`).toBe(80);
    }
  });

  it("otherwise takes every frame and picks the nearest one at each of the gap's places in time", () => {
    const r = resampleGap(81, 33)!;
    expect(r.interval).toBe(1);
    expect(r.picks).toHaveLength(33);
    // 80 / 32 = 2.5 made frames a gap frame: 0, 2.5 → 3 (half rounds up), 5, 7.5 → 8 …
    expect(r.picks.slice(0, 5)).toEqual([0, 3, 5, 8, 10]);
    expect(r.picks.at(-1)).toBe(80);
  });

  it("every gap length the studio offers: as many frames as the gap, in order, from the first made frame to the last", () => {
    for (let f = MIN_GAP_FRAMES; f < MAX_GAP_FRAMES; f += GAP_STEP) {
      const r = resampleGap(81, f)!;
      const made = r.picks.map((p) => p * r.interval);
      expect(made, `${f}`).toHaveLength(f);
      expect(made[0], `${f}`).toBe(0);
      expect(made.at(-1), `${f}`).toBe(80);
      for (let i = 1; i < made.length; i++) expect(made[i], `${f} @${i}`).toBeGreaterThan(made[i - 1]);
      // Each pick is the made frame nearest its place in time (within half a frame).
      made.forEach((m, i) => expect(Math.abs(m - (i * 80) / (f - 1)), `${f} @${i}`).toBeLessThanOrEqual(0.5));
    }
  });

  it("a gap already as long as its clip is left as made", () => {
    expect(resampleGap(81, 81)).toBeNull();
    expect(resampleGap(17, 33)).toBeNull();
  });
});

describe("the cloud film's price on Replicate", () => {
  const cloud = onEngine(getModel("fuobe-animation")!, "cloud");

  it("is Replicate's price per output video, one clip a gap, whatever the gap's length", () => {
    expect(cloud.routes.map((r) => `${r.provider}:${r.endpoint}`)).toContain("replicate:wan-video/wan-2.2-i2v-fast");
    expect(cloud.pricing).toMatchObject({ unit: "video", usd: 0.11, byResolution: { "720p": 0.11, "480p": 0.05 } });
    // One gap's clip.
    expect(estimateCost(cloud, { resolution: "480p", duration: 1 }, 1, "flf2v")).toBeCloseTo(0.05, 6);
    expect(estimateCost(cloud, { resolution: "720p", duration: 5 }, 1, "flf2v")).toBeCloseTo(0.11, 6);
    // The film: three gaps of 17, 33 and 81 frames at 720p are three clips.
    const timing = { gaps: [{ frames: 17, speed: 1 as const }, { frames: 33, speed: 1 as const }, { frames: 81, speed: 1 as const }], fps: 16 as const };
    expect(estimateCost(cloud, { resolution: "720p", keyframeTimes: keyTimes(timing), extra: { inbetween: timing } }, 1, "keyframes")).toBeCloseTo(0.33, 6);
    expect(estimateCost(cloud, { resolution: "480p", keyframeTimes: [0, 1, 2] }, 1, "keyframes")).toBeCloseTo(0.1, 6);
  });
});
