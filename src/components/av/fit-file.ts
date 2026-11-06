"use client";

import { toast } from "sonner";
import { FIT_READ_MAX_SECONDS, mp3Kbps } from "@/lib/av/fit-upload";
import { ACCOUNT_PHOTO_BYTES, ACCOUNT_PHOTO_PIXELS, ACCOUNT_SOUND_BYTES, mayHaveAlpha, type FileFit } from "@/lib/av/fit-file";
import { readSeconds, toMp3 } from "./fit-audio";
import { fitImage } from "./fit-image";
import { uploadSwitchesNow } from "./use-upload-switches";

/**
 * The browser half of fitting an upload (src/lib/av/fit-file.ts): a photo becomes a JPEG (or a WebP) within an account's
 * caps, a sound an MP3 within an account's cap, said in a toast. Null when the owner switched that step off: the file goes
 * as it is, and the route says why it can't take it.
 */
export async function fitFile(file: File, fit: FileFit): Promise<File | null> {
  const sw = await uploadSwitchesNow();
  if (fit.kind === "photo") {
    if (!sw.photoConvert) return null;
    const out = await fitImage(file, { name: file.name, maxPixels: ACCOUNT_PHOTO_PIXELS, maxBytes: ACCOUNT_PHOTO_BYTES, keepAlpha: mayHaveAlpha(file) });
    toast.success(`Converted to ${out.file.type === "image/webp" ? "WebP" : "JPEG"} to upload it`);
    return out.file;
  }
  if (fit.kind === "sound") {
    if (!sw.soundConvert) return null;
    const seconds = await readSeconds(file);
    if (seconds && seconds > FIT_READ_MAX_SECONDS) throw new Error("This sound is too long to convert here (15 minutes at most). Save it as an MP3 and add it again");
    const out = await toMp3(file, { kbps: (seconds && mp3Kbps(seconds, ACCOUNT_SOUND_BYTES)) || 192, name: file.name });
    toast.success("Converted to MP3 to upload it");
    return out;
  }
  return null;
}
