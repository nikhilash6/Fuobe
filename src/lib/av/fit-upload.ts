/**
 * Fit an upload to a tool instead of refusing it: one shared step for any tool whose provider takes only some sound files
 * (a format, a size, a length). It decides here, from what a file's header says (its length) before anything is read
 * into memory; the browser then converts or cuts it (src/components/av/fit-audio.ts) and the slot shows one short line
 * (src/components/av/fit-upload.tsx). Nothing is converted on the server, and an original too big to read is never
 * uploaded to be converted there.
 *
 * - A file the tool takes as it is: kept.
 * - Another format, too big, or a video's sound: converted to an MP3, at the best bit rate that keeps it under the
 *   tool's size (never under 96 kbit/s; 128 and up when the length allows).
 * - Longer than the tool takes, or than fits its size at 96 kbit/s: a part of it is offered (the first allowed stretch
 *   by default, or the part the person picks). Never a silent cut, never a quality crush.
 * - Past the caps a phone can read safely (200 MB, 15 minutes): said in one line, and the file isn't uploaded.
 *
 * Mureka's Extend, Remix and Stems are its first users (src/lib/av/song-fit.ts).
 */

/** What a tool takes, for the fitting step. */
export interface AudioFitRule {
  /** Who the file is for, in the line said after a conversion: "Converted to MP3 for Mureka". */
  for: string;
  /** The tool's name in the lines: "Extend". */
  tool: string;
  /** The formats it takes as they are ("mp3", "m4a"), as songFormat (src/lib/lyrics.ts) names them. */
  formats: readonly string[];
  /** The largest file it takes as it is, in bytes (none: any size). */
  maxBytes?: number;
  /** The length it takes, in seconds (a shorter file is left to the tool's own check: it can't be made longer). */
  minSeconds?: number;
  maxSeconds?: number;
  /** The largest file a conversion may make. */
  outMaxBytes: number;
  /**
   * The owner's switches (src/lib/av/upload-switches.ts): false leaves a file that would be converted, or offered a part,
   * as it is, so the tool's own check says why it can't take it, as before the step existed. On unless said.
   */
  convert?: boolean;
  trim?: boolean;
}

/** The largest file read in the browser to fit it: the app's own upload limit (MAX_MB in media-slot.tsx, /api/uploads). */
export const FIT_SOURCE_MAX_BYTES = 200 * 1024 * 1024;
/** The longest file read to fit it: 15 minutes decodes to about 320 MB of sound, as much as a phone should hold. */
export const FIT_READ_MAX_SECONDS = 15 * 60;
/** MP3 bit rates (kbit/s), best first, down to the floor: under 96 a song sounds worse than the tool deserves. */
export const FIT_KBPS = [320, 256, 192, 160, 128, 112, 96] as const;
export const FIT_MIN_KBPS = 96;

/** Bytes kept free in a converted file for frame padding and tags: 2 % and 16 KB. */
const room = (maxBytes: number) => maxBytes * 0.98 - 16_000;

/** The best bit rate that keeps `seconds` under `maxBytes`, or null when even 96 kbit/s is too big. */
export function mp3Kbps(seconds: number, maxBytes: number): number | null {
  if (!(seconds > 0)) return FIT_KBPS[0];
  return FIT_KBPS.find((k) => (seconds * k * 1000) / 8 <= room(maxBytes)) ?? null;
}

/** The longest sound that fits `maxBytes` at `kbps`, in whole seconds. */
export function secondsAt(kbps: number, maxBytes: number): number {
  return Math.floor(room(maxBytes) / ((kbps * 1000) / 8));
}

/** A file a sound can be taken from: any sound file, or a video file (its sound is used). */
export function fitSourceKind(file: { type?: string; name?: string }): "audio" | "video" | null {
  const type = (file.type ?? "").toLowerCase();
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("video/")) return "video";
  const ext = /\.([a-z0-9]{2,5})$/i.exec(file.name ?? "")?.[1]?.toLowerCase();
  if (ext && ["mp3", "m4a", "aac", "wav", "wave", "flac", "ogg", "oga", "opus", "weba", "aif", "aiff", "caf", "wma", "amr"].includes(ext)) return "audio";
  if (ext && ["mp4", "m4v", "mov", "webm", "mkv", "avi", "3gp"].includes(ext)) return "video";
  return null;
}

/** "75" -> "1:15". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "Take 2.wav" -> "Take 2.mp3". */
export function mp3Name(name: string | undefined): string {
  const base = (name ?? "").split(/[\\/]/).pop()?.replace(/\.[a-z0-9]{1,5}$/i, "").trim();
  return `${base || "Sound"}.mp3`;
}

export type FitPlan =
  | { kind: "keep" }
  /** Convert all of it at `kbps`. */
  | { kind: "convert"; kbps: number }
  /** Offer a part of at most `max` seconds of its `seconds` (the person picks where it starts; 0 by default). */
  | { kind: "trim"; seconds: number; max: number; line: string }
  | { kind: "refuse"; line: string };

/** The line said after a conversion. */
export const convertedLine = (rule: AudioFitRule) => `Converted to MP3 for ${rule.for}`;

/** The longest part a conversion can keep for this tool: its own length rule, and its size at 96 kbit/s. */
export function fitMaxSeconds(rule: AudioFitRule): number {
  return Math.min(rule.maxSeconds ?? Infinity, secondsAt(FIT_MIN_KBPS, rule.outMaxBytes));
}

/**
 * What to do with a file for this tool, from what is known before it is read: its format, size and length, and whether
 * it is a video. A length not known yet (`seconds` undefined) is read before a conversion: a file that needs one and whose
 * length can't be read is refused in words.
 */
export function planAudioFit(rule: AudioFitRule, file: { format?: string; bytes?: number; seconds?: number; video?: boolean }): FitPlan {
  if (rule.convert === false && rule.trim === false) return { kind: "keep" };
  const plan = planAll(rule, file);
  if ((plan.kind === "convert" && rule.convert === false) || (plan.kind === "trim" && rule.trim === false)) return { kind: "keep" };
  return plan;
}

function planAll(rule: AudioFitRule, file: { format?: string; bytes?: number; seconds?: number; video?: boolean }): FitPlan {
  const tooLong = !!rule.maxSeconds && !!file.seconds && file.seconds > rule.maxSeconds;
  const needs = !!file.video || (!!file.format && !rule.formats.includes(file.format)) || (!!rule.maxBytes && !!file.bytes && file.bytes > rule.maxBytes);
  if (!needs && !tooLong) return { kind: "keep" };
  if (file.bytes && file.bytes > FIT_SOURCE_MAX_BYTES) {
    return { kind: "refuse", line: `The largest file this takes is ${Math.round(FIT_SOURCE_MAX_BYTES / 1024 / 1024)} MB. Use a shorter clip` };
  }
  if (!file.seconds) return { kind: "refuse", line: `We couldn't read this file's length here. Save it as an MP3 and add it again` };
  const max = fitMaxSeconds(rule);
  if (file.seconds > max) {
    if (file.seconds > FIT_READ_MAX_SECONDS) {
      return { kind: "refuse", line: `This file is ${clock(file.seconds)}. A part can be cut here from a file of up to ${clock(FIT_READ_MAX_SECONDS)}: use a shorter clip` };
    }
    return { kind: "trim", seconds: file.seconds, max, line: `This one is ${clock(file.seconds)}. ${rule.tool} takes up to ${clock(max)}: pick the part to use` };
  }
  return { kind: "convert", kbps: mp3Kbps(file.seconds, rule.outMaxBytes) ?? FIT_MIN_KBPS };
}
