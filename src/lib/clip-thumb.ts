import { isClipRef } from "@/lib/catalog/elements";

/**
 * How a reference is drawn as a thumbnail (element cards, @mention chips): a photo as itself; a clip as a still of it, its
 * poster when one is known, else a frame grabbed from the clip in the browser. A clip is never handed to an <img>.
 */
export type ThumbSource = { kind: "image"; src: string } | { kind: "clip"; clip: string; poster?: string };

export function thumbSource(ref: string, poster?: string | null): ThumbSource {
  if (!isClipRef(ref)) return { kind: "image", src: ref };
  return poster && !isClipRef(poster) ? { kind: "clip", clip: ref, poster } : { kind: "clip", clip: ref };
}

/** Where in a clip its still is taken (seconds): just past the start, as the Video studio's chip shows it. */
export const CLIP_FRAME_AT = 0.1;

/** A grabbed still's longest side (px): sharp on a card at 2x, small enough to keep many in memory. */
export const CLIP_FRAME_SIDE = 640;

/** The size a still is drawn at: the clip's own, scaled down so its longest side is at most `max`. */
export function frameSize(width: number, height: number, max = CLIP_FRAME_SIDE): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const k = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/**
 * Stills grabbed from clips: one grab per clip address for the page's life (a clip that can't be read stays null, so it
 * isn't tried again), and at most `limit` clips decoding at once, so a page of clip elements doesn't open them all together.
 */
export function stillCache(grab: (clip: string) => Promise<string | null>, limit = 2) {
  const done = new Map<string, string | null>();
  const pending = new Map<string, Promise<string | null>>();
  const waiting: (() => void)[] = [];
  let running = 0;
  const next = () => {
    if (running >= limit) return;
    const go = waiting.shift();
    if (go) go();
  };
  return {
    /** The still if it is ready (a string), null if the clip can't be read, undefined while it isn't known yet. */
    peek: (clip: string): string | null | undefined => done.get(clip),
    get(clip: string): Promise<string | null> {
      if (done.has(clip)) return Promise.resolve(done.get(clip)!);
      const had = pending.get(clip);
      if (had) return had;
      const p = new Promise<string | null>((resolve) => {
        waiting.push(() => {
          running++;
          Promise.resolve()
            .then(() => grab(clip))
            .catch(() => null)
            .then((still) => {
              done.set(clip, still);
              pending.delete(clip);
              running--;
              resolve(still);
              next();
            });
        });
      });
      pending.set(clip, p);
      next();
      return p;
    },
  };
}
