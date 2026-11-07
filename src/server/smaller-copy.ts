import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import sharp from "sharp";
import type { GenerationRequest } from "@/lib/catalog/types";
import { accountTotalBytes, accountUsage } from "./account-files";
import { exampleStat, isExampleRef } from "./example-files";
import { absolutePath, adoptFile, contentTypeFor, filesRel, getAsset, guardRef, readRef, scratchDir } from "./storage";
import { runAsTenant } from "./tenant";

/**
 * "Send a smaller copy": a run whose file was too big for the account's GPU address (its tunnel's or its pod's size
 * limit, or ComfyUI's), or too slow to send over it, made again with a smaller copy of that file. A clip becomes 720p at
 * most (H.264, a lighter quality), a picture 2048 px on its longest side. The copy is a new file of the account's (its
 * original stays), and only made when the person presses the button.
 */

/** The run's inputs that a copy can stand in for, by where they are in the request. */
type Slot = { key: "video" | "audio" | "endImage"; ref: string } | { key: "images" | "videos"; at: number; ref: string };

function slots(req: GenerationRequest): Slot[] {
  const i = req.inputs ?? {};
  return [
    ...(i.video ? [{ key: "video" as const, ref: i.video }] : []),
    ...(i.endImage ? [{ key: "endImage" as const, ref: i.endImage }] : []),
    ...(i.images ?? []).map((ref, at) => ({ key: "images" as const, at, ref })),
    ...(i.videos ?? []).map((ref, at) => ({ key: "videos" as const, at, ref })),
  ];
}

export class SmallerCopyError extends Error {}

/** Copies are being made already (the account's own, or as many as the server makes at once): try again in a moment. */
export class SmallerCopyBusy extends SmallerCopyError {}

/**
 * How many copies the server makes at once (each account one at a time), and how many cores a clip's encode may use: a
 * copy is real work (a clip is encoded again), and the server is shared.
 */
export const SMALLER_COPY_LIMITS = { atOnce: 2, threads: 2 };

declare global {
  /** The smaller copies being made now: by account, and in all. */
  var __fuobeSmallerCopies: { total: number; accounts: Set<string> } | undefined;
}
const making = () => (globalThis.__fuobeSmallerCopies ??= { total: 0, accounts: new Set<string>() });

/** A stored input's size and type, read from the disk without reading the file. Null: not a file stored here. */
function storedSize(ref: string): { bytes: number; contentType: string } | null {
  try {
    if (ref.startsWith("/api/files/")) {
      const rel = filesRel(ref);
      if (rel === null) return null;
      const abs = absolutePath(rel);
      return { bytes: fs.statSync(abs).size, contentType: contentTypeFor(abs) };
    }
    if (isExampleRef(ref)) {
      const st = exampleStat(ref);
      return st ? { bytes: st.bytes, contentType: st.type } : null;
    }
    const asset = getAsset(ref);
    return asset ? { bytes: fs.statSync(absolutePath(asset.relPath)).size, contentType: asset.contentType } : null;
  } catch {
    return null;
  }
}

const CANT = "We couldn't make a smaller copy of this file. Trim the clip, or pick a smaller file.";
const FILES_FULL = "Your files are full, so a smaller copy can't be kept. Delete a few results, then try again.";

/** A clip re-encoded at 720p at most (ffmpeg), into `out`. */
function shrinkClip(input: string, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // A few cores at most (decoding, scaling and encoding), so one copy never takes the whole server.
    const threads = String(SMALLER_COPY_LIMITS.threads);
    const args = ["-hide_banner", "-loglevel", "error", "-y", "-filter_threads", threads, "-threads", threads, "-i", input, "-vf", "scale=-2:'min(720,ih)'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-threads", threads, "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out];
    let child;
    try {
      child = spawn(process.env.FFMPEG_PATH || "ffmpeg", args, { stdio: ["ignore", "ignore", "ignore"] });
    } catch {
      return reject(new SmallerCopyError(CANT));
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), 10 * 60_000);
    child.on("error", () => {
      clearTimeout(timer);
      reject(new SmallerCopyError(CANT));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new SmallerCopyError(CANT));
    });
  });
}

/**
 * The run's request again with a smaller copy of its biggest file (saved as a new file of the account's), and that copy's
 * size. Throws SmallerCopyError in plain words when no copy can be made (or it isn't smaller), SmallerCopyBusy when the
 * account's last copy is still being made or the server makes as many as it does at once.
 */
export async function withSmallerCopy(accountId: string, req: GenerationRequest): Promise<{ request: GenerationRequest; bytes: number }> {
  const now = making();
  if (now.accounts.has(accountId)) throw new SmallerCopyBusy("Your last smaller copy is still being made. Try again once it's done.");
  if (now.total >= SMALLER_COPY_LIMITS.atOnce) throw new SmallerCopyBusy("Lots of smaller copies are being made right now — try again in a minute.");
  now.accounts.add(accountId);
  now.total++;
  try {
    return await runAsTenant({ kind: "account", id: accountId }, () => makeSmaller(accountId, req));
  } finally {
    now.accounts.delete(accountId);
    now.total--;
  }
}

const isPictureOrClip = (contentType: string) => contentType.startsWith("image/") || contentType.startsWith("video/");

async function makeSmaller(accountId: string, req: GenerationRequest): Promise<{ request: GenerationRequest; bytes: number }> {
  // The biggest picture or clip, by its size on the disk: only that one is read.
  const sized: { slot: Slot; bytes: number }[] = [];
  for (const slot of slots(req)) {
    try {
      // Only the account's own files (one that is gone, or another's, can't be made smaller here).
      guardRef(slot.ref);
    } catch {
      continue;
    }
    const s = storedSize(slot.ref);
    if (s && isPictureOrClip(s.contentType)) sized.push({ slot, bytes: s.bytes });
  }
  const pick = sized.sort((a, b) => b.bytes - a.bytes)[0];
  if (!pick) throw new SmallerCopyError(CANT);
  // Room for the copy (at most four fifths of the file, or it isn't kept) before any work is done.
  if (accountUsage(accountId).total + Math.ceil(pick.bytes * 0.8) > accountTotalBytes(accountId)) throw new SmallerCopyError(FILES_FULL);
  let f: { data: Buffer; contentType: string; name: string };
  try {
    f = await readRef(pick.slot.ref);
  } catch {
    throw new SmallerCopyError(CANT);
  }
  if (!isPictureOrClip(f.contentType)) throw new SmallerCopyError(CANT);
  const biggest = { slot: pick.slot, data: f.data, contentType: f.contentType, name: f.name };
  const work = path.join(scratchDir(), `smaller-${nanoid(8)}`);
  const video = biggest.contentType.startsWith("video/");
  const out = `${work}-out.${video ? "mp4" : "jpg"}`;
  try {
    if (video) {
      fs.writeFileSync(work, biggest.data);
      await shrinkClip(work, out);
    } else {
      const small = await sharp(biggest.data).rotate().resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      fs.writeFileSync(out, small);
    }
    const bytes = fs.statSync(out).size;
    // Only a copy that is clearly smaller helps.
    if (!bytes || bytes > biggest.data.length * 0.8) throw new SmallerCopyError("This file is as small as we can make it here. Trim the clip, or pick a smaller file.");
    if (accountUsage(accountId).total + bytes > accountTotalBytes(accountId)) throw new SmallerCopyError(FILES_FULL);
    const name = `${biggest.name.replace(/\.[^.]+$/, "") || "file"}-smaller.${video ? "mp4" : "jpg"}`;
    const asset = adoptFile({ from: out, contentType: video ? "video/mp4" : "image/jpeg", name, source: "upload", accountId });
    const inputs = { ...req.inputs };
    const s = biggest.slot;
    if (s.key === "images" || s.key === "videos") {
      const list = [...(inputs[s.key] ?? [])];
      list[s.at] = asset.url;
      inputs[s.key] = list;
    } else inputs[s.key] = asset.url;
    return { request: { ...req, inputs }, bytes };
  } catch (e) {
    fs.rmSync(out, { force: true });
    throw e instanceof SmallerCopyError ? e : new SmallerCopyError(CANT);
  } finally {
    fs.rmSync(work, { force: true });
  }
}
