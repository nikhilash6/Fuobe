/**
 * The navigation's covers, resolved on the server: the studios layout passes them down as props (about 2 KB), so no
 * client chunk carries the covers map for the bar, the launcher, the sheets, the goal row or the next steps.
 */
import "server-only";
import { coverFraming, type CoverFraming } from "./cover-framing";
import { coverIds, launcherColumns } from "./nav-model";
import { hasMini, miniOf } from "./preset-cards";
import { presetCover } from "./preset-covers";

export interface NavCover {
  /** The still's small copy (320 px wide), for rows and tiles. */
  thumb: string;
  /** The full still, for the 4:3 cards. */
  poster: string;
  /** Its 96 px copy, for the launcher's rows and the phone's tiles (a preset's own poster only). */
  mini?: string;
  /** How it sits in a square tile or pill (cover-framing.ts), when it isn't centred there. */
  framing?: CoverFraming;
  /**
   * Its short muted clip's version, for the Studios menu's lead cards only (a row's picture is too small for a clip):
   * the clip is /previews/presets/<id>.mp4?v=<clipV>, played over the still while the card is pointed at.
   */
  clipV?: string;
}

/** Keyed by preset id. */
export type NavCovers = Record<string, NavCover>;

let cached: NavCovers | undefined;

/** Every cover the navigation shows (coverIds()), at its versioned URLs. A missing one is a mistake in the model. */
export function navCovers(): NavCovers {
  if (cached) return cached;
  const out: NavCovers = {};
  // The Studios menu's lead cards, for any viewer: only they play a clip.
  const leads = new Set((["guest", "account", "owner", undefined] as const).flatMap((k) => launcherColumns(k).map((c) => c.lead.cover)));
  for (const id of coverIds()) {
    const c = presetCover(id);
    if (!c) throw new Error(`The navigation names ${id}, which has no cover`);
    const framing = coverFraming(c.poster);
    const mini = hasMini(c.poster) ? miniOf(c.poster) : undefined;
    // Only a clip of its own, at the usual place (a stand-in's clip is another preset's).
    const own = `/previews/presets/${id}.mp4?v=`;
    const clipV = leads.has(id) && c.video?.startsWith(own) ? c.video.slice(own.length) : undefined;
    out[id] = { thumb: c.thumb, poster: c.poster, ...(mini && { mini }), ...(framing && { framing }), ...(clipV && { clipV }) };
  }
  cached = out;
  return out;
}
