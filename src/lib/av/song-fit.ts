import { EXTEND_UPLOAD_MAX_BYTES, REMIX_SECONDS, STEMS_FORMATS, STEMS_MAX_BYTES, UPLOAD_FORMATS } from "@/lib/lyrics";
import type { AudioFitRule } from "./fit-upload";

/**
 * Mureka's song tools as the fitting step's rules (src/lib/av/fit-upload.ts): Extend takes an MP3 or M4A of up to 10 MB,
 * Remix an MP3 or M4A of 10 s to 5:50, Stems an MP3 or M4A of up to 10 MB (src/lib/lyrics.ts, as the server checks them).
 * A converted song stays under 10 MB, so the same MP3 serves all three. One of Mureka's own songs goes by its id and is
 * never fitted (the caller leaves it out).
 */

/** The ops whose song is fitted. */
export const SONG_FIT_OPS = new Set(["song-extend", "song-remix", "song-stems"]);

/** What a converted song may weigh: Extend's and Stems' 10 MB. */
export const SONG_FIT_MAX_BYTES = Math.min(EXTEND_UPLOAD_MAX_BYTES, STEMS_MAX_BYTES);

/** The song slot's file picker: any sound or video file (a phone offers its videos too). */
export const SONG_ACCEPT = "audio/*,video/*";

/** The rule for a song tool's song, or null for any other op. */
export function murekaSongRule(op: string | undefined): AudioFitRule | null {
  if (op === "song-extend") return { for: "Mureka", tool: "Extend", formats: UPLOAD_FORMATS, maxBytes: EXTEND_UPLOAD_MAX_BYTES, outMaxBytes: SONG_FIT_MAX_BYTES };
  if (op === "song-stems") return { for: "Mureka", tool: "Stems", formats: STEMS_FORMATS, maxBytes: STEMS_MAX_BYTES, outMaxBytes: SONG_FIT_MAX_BYTES };
  if (op === "song-remix") {
    return { for: "Mureka", tool: "Remix", formats: UPLOAD_FORMATS, minSeconds: REMIX_SECONDS.min, maxSeconds: REMIX_SECONDS.max, outMaxBytes: SONG_FIT_MAX_BYTES };
  }
  return null;
}
