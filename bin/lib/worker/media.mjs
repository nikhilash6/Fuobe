// Clips and sound for the worker's ComfyUI (docs/gpu-workers.md). Every clip and every sound a job sends is made again by
// ffmpeg into a fresh file before ComfyUI reads it: the streams are decoded and encoded again, and nothing else of the
// file (metadata, chapters, subtitles, attachments, data streams) is kept. Only ffmpeg ever reads the file as it came,
// in its own short-lived process at low priority. A worker without ffmpeg takes pictures only: it says so in its
// inventory, so no job that reads a clip or a sound comes to it.
//
// ffmpeg reads the file only as a plain local file in one of a short list of container formats: no playlist, list or
// reference format that would make it open other files or addresses. What it writes has limits too: at most an hour,
// at most 4096 pixels on the long side, and a size cap. A result that reaches the cap is refused.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

const VIDEO_EXT = new Set(["mp4", "m4v", "mov", "mkv", "webm", "avi", "gif", "mpg", "mpeg", "wmv", "flv", "3gp", "ts", "mts", "m2ts"]);
const AUDIO_EXT = new Set(["wav", "mp3", "flac", "ogg", "oga", "opus", "m4a", "aac", "wma", "aif", "aiff"]);

/** The loader inputs that read a clip, and a sound, the job sent (src/lib/lanes.ts MEDIA_LOADERS, by input). */
const VIDEO_INPUTS = { LoadVideo: ["file"], VHS_LoadVideo: ["video"], VHS_LoadVideoPath: ["video"], VHS_LoadVideoFFmpeg: ["video"], VHS_LoadVideoFFmpegPath: ["video"] };
const AUDIO_INPUTS = { LoadAudio: ["audio"], VHS_LoadAudio: ["audio_file"], VHS_LoadAudioUpload: ["audio"] };

const extOf = (name) => (String(name).includes(".") ? String(name).split(".").pop().toLowerCase() : "");

/**
 * Is this input a clip or a sound: by its type, its name, or a loader of the graph that reads it as one. Null: a
 * picture (the studio already made it again from its pixels).
 */
export function mediaKind(input, graph) {
  const type = String(input.contentType ?? "").split("/")[0].toLowerCase();
  const ext = extOf(input.name);
  const readBy = (map) =>
    Object.values(graph ?? {}).some((n) => (map[n?.class_type] ?? []).some((k) => typeof n.inputs?.[k] === "string" && n.inputs[k].replace(/ \[input\]$/, "") === input.name));
  if (type === "video" || VIDEO_EXT.has(ext) || readBy(VIDEO_INPUTS)) return "video";
  if (type === "audio" || AUDIO_EXT.has(ext) || readBy(AUDIO_INPUTS)) return "audio";
  return null;
}

/**
 * What a clip or a sound made again may be: at most `maxSeconds` long and `maxSide` pixels on its long side, and at
 * most `bytesPerInput` times its input's size, never under `minBytes` and never over `maxBytes`.
 */
export const MEDIA_LIMITS = { maxSeconds: 3600, maxSide: 4096, maxBytes: 2 * 2 ** 30, minBytes: 256 * 2 ** 20, bytesPerInput: 8 };

/** The size cap of what ffmpeg writes for an input of `inputBytes`. */
export const outputCap = (inputBytes) => Math.min(MEDIA_LIMITS.maxBytes, Math.max(MEDIA_LIMITS.minBytes, MEDIA_LIMITS.bytesPerInput * (Number(inputBytes) || 0)));

/**
 * The container formats ffmpeg may read a job's file as (its readers' names: "mov" covers MP4, MOV, M4A and 3GP, and
 * "matroska" covers MKV and WebM). No playlist, list or reference format.
 */
export const INPUT_FORMATS = ["mov", "matroska", "avi", "gif", "mpegts", "mpeg", "flv", "asf", "wav", "mp3", "flac", "ogg", "aac", "aiff"];

/** Down to `maxSide` pixels on the long side when bigger, keeping the shape, with even sides (H.264 and VP9 need them). */
const side = (dim) => `trunc(min(${dim}\\,${MEDIA_LIMITS.maxSide})/2)*2`;
export const FIT = `scale=w=if(gte(iw\\,ih)\\,${side("iw")}\\,-2):h=if(gte(iw\\,ih)\\,-2\\,${side("ih")})`;
const EVEN = ["-vf", FIT];
const H264 = [...EVEN, "-c:v", "libx264", "-preset", "veryfast", "-crf", "16", "-pix_fmt", "yuv420p"];
const VIDEO = {
  mp4: [...H264, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-f", "mp4"],
  m4v: [...H264, "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-f", "mp4"],
  mov: [...H264, "-c:a", "aac", "-b:a", "192k", "-f", "mov"],
  mkv: [...H264, "-c:a", "aac", "-b:a", "192k", "-f", "matroska"],
  webm: [...EVEN, "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-crf", "20", "-b:v", "0", "-c:a", "libopus", "-b:a", "160k", "-f", "webm"],
  avi: [...H264, "-c:a", "libmp3lame", "-q:a", "2", "-f", "avi"],
  gif: ["-an", "-filter_complex", `[0:v:0]${FIT},split[a][b];[a]palettegen[p];[b][p]paletteuse`, "-f", "gif"],
};
const AUDIO = {
  wav: ["-c:a", "pcm_s24le", "-f", "wav"],
  mp3: ["-c:a", "libmp3lame", "-q:a", "0", "-f", "mp3"],
  flac: ["-c:a", "flac", "-f", "flac"],
  ogg: ["-c:a", "libvorbis", "-q:a", "8", "-f", "ogg"],
  oga: ["-c:a", "libvorbis", "-q:a", "8", "-f", "ogg"],
  opus: ["-c:a", "libopus", "-b:a", "192k", "-f", "opus"],
  m4a: ["-c:a", "aac", "-b:a", "256k", "-f", "ipod"],
  aac: ["-c:a", "aac", "-b:a", "256k", "-f", "adts"],
  mp4: ["-c:a", "aac", "-b:a", "256k", "-f", "mp4"],
  webm: ["-c:a", "libopus", "-b:a", "192k", "-f", "webm"],
  aif: ["-c:a", "pcm_s16be", "-f", "aiff"],
  aiff: ["-c:a", "pcm_s16be", "-f", "aiff"],
};

/**
 * ffmpeg's arguments to make `src` again as `dst`: the first video stream and the first sound stream for a clip (the
 * format its name says: H.264 and AAC in MP4 when it says nothing ffmpeg writes well), the first sound stream for a
 * sound; no metadata, chapters, subtitles or data. ffmpeg reads `src` only as a local file (`file:` is the only protocol
 * it may use) in one of INPUT_FORMATS, and writes at most MEDIA_LIMITS.maxSeconds and `capBytes`.
 */
export function encodeArgs(kind, name, src, dst, capBytes = MEDIA_LIMITS.maxBytes) {
  const ext = extOf(name);
  const head = [
    "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
    "-protocol_whitelist", "file", "-format_whitelist", INPUT_FORMATS.join(","),
    "-i", `file:${src}`,
    "-map_metadata", "-1", "-map_chapters", "-1", "-sn", "-dn",
    "-t", String(MEDIA_LIMITS.maxSeconds), "-fs", String(Math.floor(capBytes)),
  ];
  const out = `file:${dst}`;
  if (kind === "video") {
    const fmt = VIDEO[ext] ?? VIDEO.mp4;
    return ext === "gif" ? [...head, ...fmt, out] : [...head, "-map", "0:v:0", "-map", "0:a:0?", ...fmt, out];
  }
  return [...head, "-vn", "-map", "0:a:0", ...(AUDIO[ext] ?? AUDIO.wav), out];
}

/** A file's size in bytes (0 when it isn't there). */
export function fileSize(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

/** ffmpeg's version line, or null when there is no working ffmpeg at `bin`. */
export function ffmpegVersion(bin) {
  if (!bin) return Promise.resolve(null);
  return new Promise((resolve) =>
    execFile(bin, ["-hide_banner", "-version"], { timeout: 15_000, windowsHide: true }, (err, out) => {
      const line = String(out ?? "").split(/\r?\n/)[0] ?? "";
      resolve(!err && /^ffmpeg version /i.test(line) ? line.slice(0, 120) : null);
    }),
  );
}

/**
 * Make a clip or a sound again (`encodeArgs`) in its own process at low priority, stopped after `timeoutMs`. True when
 * ffmpeg made it under `capBytes` (ffmpeg stops writing at the cap, so a file that reached it is cut short: false).
 */
export function reencode({ ffmpeg, kind, name, src, dst, capBytes = outputCap(fileSize(src)), timeoutMs = 20 * 60_000, spawnFn = spawn }) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(ffmpeg, encodeArgs(kind, name, src, dst, capBytes), { stdio: ["ignore", "ignore", "ignore"], windowsHide: true });
    } catch {
      return resolve(false);
    }
    try {
      if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
    } catch {}
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.once("error", () => (clearTimeout(timer), resolve(false)));
    child.once("exit", (code) => {
      clearTimeout(timer);
      const size = fileSize(dst);
      resolve(code === 0 && size > 0 && size < capBytes);
    });
  });
}
