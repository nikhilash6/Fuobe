/**
 * The video tile's reel on Home's first screen (src/components/home/bento-islands.tsx, BentoReel): its clips play one
 * after another, each once, and each crossfades into the next; after the last, the first again. These are the reel's
 * rules, kept apart from the component so they can be tested (tests/home-reel.test.ts).
 */
import { pickWidth, type Sized } from "@/lib/media-pick";

/** One clip of the reel: its preset, where the tile anchors it (object-position), and its copies in each width. */
export interface ReelClip {
  id: string;
  position: string;
  clips: Sized[];
}

/** How long the crossfade from one clip into the next takes, in ms. */
export const REEL_FADE_MS = 500;

/** The clip that plays after clip `i` of `n`: the next one, and after the last the first. */
export const nextInReel = (i: number, n: number): number => (i + 1) % n;

/**
 * Each clip's copy for a box that needs `need` pixels of width: the narrowest at least that wide, or the widest it
 * has (a clip is never offered past its own size).
 */
export const reelSources = (reel: readonly ReelClip[], need: number): string[] => reel.map((c) => pickWidth(c.clips, need).src);

/** Whether the crossfade into the next clip is due: the clip at `t` of its `d` seconds is within the fade of its end. */
export const fadeDue = (t: number, d: number, fadeMs = REEL_FADE_MS): boolean => d > 0 && t >= d - fadeMs / 1000;

/** How far through the whole reel it is (0 to 1), playing clip `i` of `n` at `t` of its `d` seconds. */
export const reelProgress = (i: number, n: number, t: number, d: number): number => (i + (d > 0 ? Math.min(1, Math.max(0, t / d)) : 0)) / n;
