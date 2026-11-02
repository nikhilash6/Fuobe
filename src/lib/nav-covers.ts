/**
 * The navigation's covers, resolved on the server: the studios layout passes them down as props (about 2 KB), so no
 * client chunk carries the covers map for the bar, the launcher, the sheets, the goal row or the next steps.
 */
import "server-only";
import { coverIds } from "./nav-model";
import { presetCover } from "./preset-covers";

export interface NavCover {
  /** The still's small copy (320 px wide), for rows and tiles. */
  thumb: string;
  /** The full still, for the 4:3 cards. */
  poster: string;
}

/** Keyed by preset id. */
export type NavCovers = Record<string, NavCover>;

let cached: NavCovers | undefined;

/** Every cover the navigation shows (coverIds()), at its versioned URLs. A missing one is a mistake in the model. */
export function navCovers(): NavCovers {
  if (cached) return cached;
  const out: NavCovers = {};
  for (const id of coverIds()) {
    const c = presetCover(id);
    if (!c) throw new Error(`The navigation names ${id}, which has no cover`);
    out[id] = { thumb: c.thumb, poster: c.poster };
  }
  cached = out;
  return out;
}
