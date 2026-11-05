import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import sharp from "sharp";
import type { GenerationRequest } from "@/lib/catalog/types";
import { accountTotalBytes, accountUsage } from "./account-files";
import { adoptFile, readRef, scratchDir } from "./storage";

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

const CANT = "We couldn't make a smaller copy of this file. Trim the clip, or pick a smaller file.";

/** A clip re-encoded at 720p at most (ffmpeg), into `out`. */
function shrinkClip(input: string, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vf", "scale=-2:'min(720,ih)'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", out];
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
 * size. Throws SmallerCopyError in plain words when no copy can be made (or it isn't smaller).
 */
export async function withSmallerCopy(accountId: string, req: GenerationRequest): Promise<{ request: GenerationRequest; bytes: number }> {
  const files: { slot: Slot; data: Buffer; contentType: string; name: string }[] = [];
  for (const slot of slots(req)) {
    try {
      const f = await readRef(slot.ref);
      files.push({ slot, data: f.data, contentType: f.contentType, name: f.name });
    } catch {
      // A file that is gone: the run can't be made again with it, whatever its size.
    }
  }
  const biggest = files.filter((f) => /^(image|video)\//.test(f.contentType)).sort((a, b) => b.data.length - a.data.length)[0];
  if (!biggest) throw new SmallerCopyError(CANT);
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
    if (accountUsage(accountId).total + bytes > accountTotalBytes(accountId)) throw new SmallerCopyError("Your files are full, so a smaller copy can't be kept. Delete a few results, then try again.");
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
