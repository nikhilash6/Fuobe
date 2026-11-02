import "server-only";
import type { ElementVoice, StudioElement } from "@/lib/catalog/elements";
import { listElements, updateElement } from "./elements";
import { fetchRemote } from "./remote-fetch";
import { saveFile } from "./storage";
import { tenant } from "./tenant";

/**
 * Saved voices (Design a voice, nm10-voice-design): an Element voice whose clip (references[0]) is the take picked. A
 * later line that names that clip as its voice sample reuses the voice on either engine: ComfyUI clones the clip, and
 * VoxCPM2 / Qwen3-TTS read what it says (ElementVoice.transcript) for a closer clone; fal's Qwen3-TTS clones it once into
 * an embedding file, which is kept on the element after that first cloud line, so later lines go straight to speech.
 *
 * Elements are the owner's library: inside a tenant (an account's run, a visitor's price check) nothing here reads or
 * writes them.
 */

/** The same stored file, whatever query or host prefix the reference carries. */
const samePath = (a: string, b: string) => a.split(/[?#]/)[0] === b.split(/[?#]/)[0];

/** The saved voice a voice sample is, if it is one (the owner's runs only). */
export function savedVoiceFor(sample: string | undefined): (StudioElement & { voice: ElementVoice }) | null {
  if (!sample || tenant()) return null;
  const el = listElements("voice").find((e) => e.voice && e.references[0] && samePath(e.references[0], sample));
  return el?.voice ? (el as StudioElement & { voice: ElementVoice }) : null;
}

/** Hosts fal answers a clone with (its CDN and storage). The file is fetched from nowhere else. */
const FAL_FILE_HOST = /(^|\.)(fal\.media|fal\.run|fal\.ai)$/i;
/** fal's own bucket on Google Cloud Storage (its schema examples answer from it): that bucket only, not the whole host. */
const isFalFile = (u: URL) => FAL_FILE_HOST.test(u.hostname) || (u.hostname === "storage.googleapis.com" && u.pathname.startsWith("/falserverless/"));
/** A Qwen3-TTS speaker embedding is a few kilobytes; anything near this is not one. */
const MAX_EMBEDDING_BYTES = 8 * 2 ** 20;

/**
 * After a cloud line cloned a saved voice's clip (fal's clone-voice; FieldMap.cloneFirst), the embedding file is stored
 * by Fuobe and kept on the element, so the next line skips the clone. Quietly does nothing for a sample that isn't a
 * saved voice, a voice that already has one, a link that isn't fal's, or inside a tenant. Returns the stored file's URL.
 */
export async function keepVoiceEmbedding(sample: string | undefined, url: string | undefined, fetchFile = fetchRemote): Promise<string | null> {
  const saved = savedVoiceFor(sample);
  if (!saved || saved.voice.embedding || !url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !isFalFile(u)) return null;
  const file = await fetchFile(url, { maxBytes: MAX_EMBEDDING_BYTES, timeoutMs: 60_000 });
  // The clip may have changed while the file came down, or another line kept its embedding first: only the clip it was
  // cloned from keeps it, and nothing is stored that the element wouldn't keep.
  const now = savedVoiceFor(sample);
  if (!now || now.id !== saved.id || now.voice.embedding) return null;
  const asset = saveFile({ data: file.data, contentType: "application/octet-stream", name: `${saved.handle}-voice.safetensors`, source: "derived" });
  updateElement(saved.id, { voice: { ...now.voice, embedding: asset.url } });
  return asset.url;
}
