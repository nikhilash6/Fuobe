/**
 * The owner's switches for the fitting step (src/lib/av/fit-upload.ts): what a browser may do to a file that doesn't fit a
 * tool before it is uploaded. All on by default. A switch that is off leaves that kind of file as it was before the step
 * existed: the slot says why the tool can't take it, and the server's own checks stand.
 *
 * Stored by the server (src/server/upload-switches.ts), changed by the owner (Settings, or PATCH /api/admin/site/uploads),
 * and read by every browser on load (GET /api/site/uploads), so a change applies without a deploy.
 */

export interface UploadSwitches {
  /** A sound converted to an MP3 (another format, too big, a video's sound). */
  soundConvert: boolean;
  /** A part of a sound offered when it is longer than the tool takes. */
  soundTrim: boolean;
  /** A part of a clip offered when it is longer than the tool takes. */
  videoTrim: boolean;
  /** A photo converted or made smaller (HEIC, AVIF, too big, too many pixels). */
  photoConvert: boolean;
  /** A crop of a photo offered when its shape is outside what the tool takes. */
  photoCrop: boolean;
}

export const UPLOAD_SWITCH_KEYS = ["soundConvert", "soundTrim", "videoTrim", "photoConvert", "photoCrop"] as const satisfies readonly (keyof UploadSwitches)[];

export const UPLOAD_SWITCH_DEFAULTS: UploadSwitches = { soundConvert: true, soundTrim: true, videoTrim: true, photoConvert: true, photoCrop: true };

/** Each switch in the owner's words, grouped by kind of file (Settings and the docs use these). */
export const UPLOAD_SWITCH_LABELS: Record<keyof UploadSwitches, { group: "Sound" | "Video" | "Photos"; label: string; hint: string }> = {
  soundConvert: { group: "Sound", label: "Convert to MP3", hint: "Another format, a file that's too big, or a video's sound becomes an MP3 the tool takes." },
  soundTrim: { group: "Sound", label: "Offer a part", hint: "A sound longer than the tool takes: pick the part to use." },
  videoTrim: { group: "Video", label: "Offer a part", hint: "A clip longer than the tool takes: pick the part to use (MP4 and MOV)." },
  photoConvert: { group: "Photos", label: "Convert or make smaller", hint: "HEIC, AVIF or a photo that's too big becomes a JPEG the tool takes." },
  photoCrop: { group: "Photos", label: "Offer a crop", hint: "A photo whose shape the tool can't take: pick the crop to use." },
};

/** A change checked against `base`: any of the switches, each true or false. The error says what is wrong, in words. */
export function checkUploadSwitches(body: unknown, base: UploadSwitches = UPLOAD_SWITCH_DEFAULTS): { switches: UploadSwitches } | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Send the switches as an object" };
  const b = body as Record<string, unknown>;
  const unknown = Object.keys(b).filter((k) => !(UPLOAD_SWITCH_KEYS as readonly string[]).includes(k));
  if (unknown.length) return { error: `Unknown switch: ${unknown[0].slice(0, 40)}` };
  const out = { ...base };
  for (const k of UPLOAD_SWITCH_KEYS) {
    if (b[k] === undefined) continue;
    if (typeof b[k] !== "boolean") return { error: `${k} is true or false` };
    out[k] = b[k];
  }
  return { switches: out };
}

/** A stored or fetched value read leniently: anything missing or not valid is on (the default). */
export function readUploadSwitches(v: unknown): UploadSwitches {
  const out = { ...UPLOAD_SWITCH_DEFAULTS };
  if (!v || typeof v !== "object") return out;
  for (const k of UPLOAD_SWITCH_KEYS) {
    const x = (v as Record<string, unknown>)[k];
    if (typeof x === "boolean") out[k] = x;
  }
  return out;
}
