/**
 * Which tile of a picker plays its clip (cover-tile.tsx: the camera motion and Mix grids, Cinema Studio's moves). One
 * at a time: the tile hovered or keyboard-focused, once it has had the pointer for a moment (HOVER_INTENT, as in the
 * galleries), or the row a list highlights; while there is none, the picked tile. Unlike a gallery, nothing plays for
 * being in view: a picker shows dozens of tiles at once.
 *
 * The picked tile plays unasked, so not with Save-Data or on 2G, and only once no other tile has played for
 * PICKED_RESUME (moving the pointer from tile to tile doesn't restart it each time). When the pointer or focus
 * leaves the picked tile itself, or a tile picked while it played, its clip just goes on. Nothing plays when the
 * user prefers reduced motion.
 *
 * Pure apart from the environment it's given, so the rules are testable without a browser.
 */
import { HOVER_INTENT, type PlaybackEnv } from "./preview-playback";

/** How long after the last hovered tile stops before the picked tile plays again, in ms. */
export const PICKED_RESUME = 400;

export function createPickerPlayback(env: Pick<PlaybackEnv, "matches" | "delay" | "saveData">) {
  const listeners = new Set<() => void>();
  /** The tile hovered, focused or highlighted. */
  let asked: string | null = null;
  /** No tile has played for a moment: the picked one may. */
  let resting = true;
  /** The tile a hover is about to play, and what calls that off. */
  let pending: { id: string; cancel: () => void } | null = null;
  let resume: (() => void) | null = null;

  const notify = () => listeners.forEach((l) => l());
  const reducedMotion = () => env.matches("(prefers-reduced-motion: reduce)");
  const cancelPending = () => {
    pending?.cancel();
    pending = null;
  };
  const cancelResume = () => {
    resume?.();
    resume = null;
  };

  return {
    subscribe(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    /** Whether `id` plays: the hovered, focused or highlighted tile, else the picked one (see above). */
    plays: (id: string, picked = false) => !reducedMotion() && (asked === id || (picked && asked === null && resting && !env.saveData())),
    canHover: () => env.matches("(hover: hover) and (pointer: fine)"),
    /** Hover, keyboard focus or highlight: play this one once it has had the pointer for HOVER_INTENT. */
    play(id: string) {
      cancelPending();
      cancelResume();
      if (reducedMotion()) return;
      const cancel = env.delay(() => {
        pending = null;
        asked = id;
        resting = false;
        notify();
      }, HOVER_INTENT);
      pending = { id, cancel };
    },
    /**
     * Stop this one, if it's the one playing (or about to); the picked tile plays again after PICKED_RESUME. When this
     * one is the picked tile (`picked`), it plays on as that, without a gap.
     */
    stop(id: string, picked = false) {
      if (pending?.id === id) cancelPending();
      if (asked === id) {
        asked = null;
        if (picked) resting = true;
        notify();
      }
      if (asked === null && !pending && !resting && !resume)
        resume = env.delay(() => {
          resume = null;
          resting = true;
          notify();
        }, PICKED_RESUME);
    },
  };
}
