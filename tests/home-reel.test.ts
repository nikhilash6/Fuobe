import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOME_BENTO_MEDIA, HOME_BENTO_REEL } from "@/lib/home-bento.generated";
import { REEL_FADE_MS, fadeDue, nextInReel, reelProgress, reelSources, type ReelClip } from "@/lib/home-reel";
import { REEL } from "../scripts/gen-home-bento.mjs";
import { mp4Seconds, mp4Size } from "./helpers/mp4-length";

/*
 * The video tile's reel on Home's first screen (src/lib/home-reel.ts, BentoReel in src/components/home/bento-islands.tsx,
 * REEL in scripts/gen-home-bento.mjs): the order it plays in, each clip's cut, and the copy it picks for a screen.
 */

const root = process.cwd();
const file = (url: string) => path.join(root, "public", url.split("?")[0]);

describe("Home's video reel", () => {
  it("plays Sand Storm, then One Take, then Sand Storm again", () => {
    expect(HOME_BENTO_REEL.map((c) => c.id)).toEqual(["effect-sand-storm", "motion-one-take"]);
    const n = HOME_BENTO_REEL.length;
    const order = [0];
    for (let i = 0; i < 6; i++) order.push(nextInReel(order.at(-1)!, n));
    expect(order).toEqual([0, 1, 0, 1, 0, 1, 0]);
    // The generated list is the script's, in the same order (run node scripts/gen-home-bento.mjs after changing REEL).
    expect(HOME_BENTO_REEL).toEqual(REEL.map(({ id, name, frames, position }) => ({ id, name, frames, fps: 24, position })));
  });

  it("cuts each clip to its stretch of the render: that many frames at 24 fps, played once", () => {
    for (const c of REEL) {
      // Inside the render (124 frames, 5.17 s), and long enough to read: 3.5 s or more.
      expect(c.from).toBeGreaterThanOrEqual(0);
      expect(c.from + c.frames).toBeLessThanOrEqual(124);
      expect(c.frames / 24).toBeGreaterThanOrEqual(3.5);
      for (const w of [640, 1024]) {
        const url = `/previews/home/${c.name}-${w}.mp4`;
        expect(HOME_BENTO_MEDIA[url], url).toBeDefined();
        expect(mp4Size(file(url))).toEqual({ w, h: (w * 3) / 4 });
        // Its own length, not the 4 s loop of a cover clip: no frames crossfaded back into its start.
        expect(mp4Seconds(file(url))).toBeCloseTo(c.frames / 24, 2);
      }
    }
    // The stretches chosen: Sand Storm's first 96 (to the sand round her), One Take from frame 28 to its end.
    expect(REEL.map((c) => [c.from, c.frames])).toEqual([
      [0, 96],
      [28, 96],
    ]);
  });

  it("picks each clip's narrowest copy at least as wide as the tile needs, else its widest", () => {
    const reel: ReelClip[] = [
      { id: "a", position: "50% 15%", clips: [640, 1024].map((w) => ({ src: `a-${w}`, w })) },
      { id: "b", position: "50% 0%", clips: [640, 1024, 1536, 2048].map((w) => ({ src: `b-${w}`, w })) },
    ];
    expect(reelSources(reel, 500)).toEqual(["a-640", "b-640"]);
    expect(reelSources(reel, 1000)).toEqual(["a-1024", "b-1024"]);
    // A 3x phone (358 px box: 1074) and a 2x laptop (567 px box: 1134): the 1536 px copy where there is one.
    expect(reelSources(reel, 1074)).toEqual(["a-1024", "b-1536"]);
    expect(reelSources(reel, 1134)).toEqual(["a-1024", "b-1536"]);
    expect(reelSources(reel, 3000)).toEqual(["a-1024", "b-2048"]);
  });

  it("starts the crossfade a fade's length before a clip's end, and follows the whole reel", () => {
    expect(REEL_FADE_MS).toBeGreaterThanOrEqual(400);
    expect(REEL_FADE_MS).toBeLessThanOrEqual(600);
    expect(fadeDue(3.4, 4)).toBe(false);
    expect(fadeDue(4 - REEL_FADE_MS / 1000, 4)).toBe(true);
    expect(fadeDue(4, 4)).toBe(true);
    // Not before its length is known.
    expect(fadeDue(0, NaN)).toBe(false);
    expect(fadeDue(0, 0)).toBe(false);
    expect(reelProgress(0, 3, 0, 4)).toBe(0);
    expect(reelProgress(1, 3, 2, 4)).toBeCloseTo(0.5, 5);
    expect(reelProgress(2, 3, 4, 4)).toBe(1);
    expect(reelProgress(1, 3, 1, NaN)).toBeCloseTo(1 / 3, 5);
  });
});
