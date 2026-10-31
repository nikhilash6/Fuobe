#!/usr/bin/env node
/**
 * Cuts each named preset's peak frame from its published clip: the frame where the effect is at its height,
 * just before the clip's closing crossfade back into its first frame. Home's cards and the preset header rest on it,
 * and their clip starts from that same frame (PresetPreview's `rest`), so nothing jumps when it plays.
 *
 * The clips open on a still subject for about a second before the change starts. A card that plays by itself loops
 * back to just before the change starts (`from`), not to that still opening, and a hover starts there: the frame
 * whose mean difference from the first is past CHANGE, LEAD frames earlier.
 *
 * Output:
 *   public/previews/presets/peak/<id>.jpg          512x384, with the same settings as the covers' posters
 *   public/previews/presets/peak/thumbs/<id>.jpg   its 320 px copy, with the same settings as the posters' thumbs
 *   src/lib/preset-peaks.generated.ts              { "<id>": { at: <seconds>, from: <seconds>, v: <version> } }
 *
 * The frame is (duration − 0.45 s) × fps, rounded; `<id>@<frame>` picks another one by eye. Entries already in
 * the file stay, so the next run adds to it; `-<id>` takes one out, with its files. Nothing is rendered: it reads
 * the clips under public/ only.
 *
 * `v` is the content version of a peak and its 320 px copy (contentVersion, as the covers' own in
 * scripts/eval/lib/covers.mjs): both URLs end in ?v=<v> (onPeak), so a peak cut again gets a new URL. Every run
 * versions every entry from its files as they are; `--versions` alone does only that, hashing without cutting.
 *
 * Run: node scripts/gen-preset-peaks.mjs effect-flame-on app-relight effect-clone-explosion@84 -effect-earth-zoom-out …
 *      node scripts/gen-preset-peaks.mjs --versions
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { contentVersion } from "./eval/lib/covers.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRESETS = path.join(ROOT, "public", "previews", "presets");
const OUT_DIR = path.join(PRESETS, "peak");
const THUMB_DIR = path.join(OUT_DIR, "thumbs");
const OUT_TS = path.join(ROOT, "src", "lib", "preset-peaks.generated.ts");
/** How long before the end the peak sits: the clips close with a crossfade back into their first frame. */
const BEFORE_END = 0.45;
/** The thumbs' width, as the covers' own (scripts/eval/lib/covers.mjs). */
const THUMB_PX = 320;
/** The change has started once a frame's mean difference from the first passes this (of 255, on a 64x48 grey copy). */
const CHANGE = 3;
/** The loop comes back this many frames before that, while the frame still looks like the first. */
const LEAD = 3;

const tool = (name, args, encoding = "utf8") => {
  const r = spawnSync(process.env[name === "ffmpeg" ? "FUOBE_FFMPEG" : "FUOBE_FFPROBE"] ?? name, args, { encoding, maxBuffer: 64 << 20 });
  if (r.error?.code === "ENOENT") throw new Error(`gen-preset-peaks needs ${name} on PATH`);
  if (r.status !== 0) throw new Error(`${name} failed: ${String(r.stderr).trim().split("\n").at(-1)}`);
  return r.stdout;
};

/** A clip's frame rate and frame count, from its video stream. */
function probe(file) {
  const [rate, frames] = tool("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=r_frame_rate,nb_read_packets", "-of", "csv=p=0", file])
    .trim()
    .split(",");
  const [num, den] = rate.split("/").map(Number);
  return { fps: num / (den || 1), frames: Number(frames) };
}

/** The first frame whose mean difference from the clip's first frame passes CHANGE (0 if none does). */
function changeStarts(file) {
  const [w, h] = [64, 48];
  const n = w * h;
  const raw = tool("ffmpeg", ["-v", "error", "-i", file, "-vf", `scale=${w}:${h},format=gray`, "-f", "rawvideo", "-"], "buffer");
  for (let f = 1; (f + 1) * n <= raw.length; f++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += Math.abs(raw[f * n + i] - raw[i]);
    if (sum / n > CHANGE) return f;
  }
  return 0;
}

const read = () => {
  if (!fs.existsSync(OUT_TS)) return {};
  const text = fs.readFileSync(OUT_TS, "utf8");
  const json = text.slice(text.indexOf("= {") + 2, text.lastIndexOf("}") + 1);
  return JSON.parse(json);
};

/** Half a frame in, so a seek lands inside that frame. */
const timeOf = (frame, fps) => Math.round(((frame + 0.5) / fps) * 1e4) / 1e4;

const args = process.argv.slice(2);
if (!args.length) {
  console.error("usage: node scripts/gen-preset-peaks.mjs <id>[@frame] … -<id> …   (or --versions alone)");
  process.exit(1);
}
fs.mkdirSync(THUMB_DIR, { recursive: true });
const peaks = read();
for (const arg of args) {
  if (arg === "--versions") continue;
  if (arg.startsWith("-")) {
    const id = arg.slice(1);
    delete peaks[id];
    for (const f of [path.join(OUT_DIR, `${id}.jpg`), path.join(THUMB_DIR, `${id}.jpg`)]) fs.rmSync(f, { force: true });
    console.log(`${id}: taken out`);
    continue;
  }
  const [id, pick] = arg.split("@");
  const clip = path.join(PRESETS, `${id}.mp4`);
  if (!fs.existsSync(clip)) throw new Error(`${id} has no clip in public/previews/presets`);
  const { fps, frames } = probe(clip);
  const n = pick ? Number(pick) : Math.round((frames / fps - BEFORE_END) * fps);
  if (!(n >= 0 && n < frames)) throw new Error(`${id}: frame ${n} is outside its ${frames} frames`);
  const still = path.join(OUT_DIR, `${id}.jpg`);
  tool("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", clip, "-vf", `select=eq(n\\,${n}),format=yuvj420p`, "-frames:v", "1", "-q:v", "4", still]);
  tool("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", still, "-vf", `scale='min(${THUMB_PX},iw)':-2,format=yuvj420p`, "-frames:v", "1", "-q:v", "5", path.join(THUMB_DIR, `${id}.jpg`)]);
  const from = Math.min(n, Math.max(0, changeStarts(clip) - LEAD));
  peaks[id] = { at: timeOf(n, fps), from: timeOf(from, fps) };
  console.log(`${id}: frame ${n} of ${frames}, at ${peaks[id].at}s; loops from frame ${from}, ${peaks[id].from}s`);
}

// Every peak's version, from its still and its small copy as they are now.
const sorted = Object.entries(peaks)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([id, p]) => {
    const files = [path.join(OUT_DIR, `${id}.jpg`), path.join(THUMB_DIR, `${id}.jpg`)];
    if (!files.every((f) => fs.existsSync(f))) throw new Error(`${id} has no peak in public/previews/presets/peak (and thumbs/): cut it again, or take it out with -${id}`);
    return [id, { at: p.at, from: p.from, v: contentVersion(files) }];
  });
fs.writeFileSync(
  OUT_TS,
  `/**
 * Peak frames of preset clips: public/previews/presets/peak/<id>.jpg (and its 320 px copy in thumbs/), the time inside
 * that frame where the clip starts when a card resting on it plays (\`at\`), and where its loop comes back to, just
 * before the change starts (\`from\`). \`v\` is the content version both files' URLs end in (?v=, onPeak), so a peak cut
 * again gets a new URL. Generated by scripts/gen-preset-peaks.mjs: run it again rather than editing.
 */
export const PRESET_PEAKS: Record<string, { at: number; from: number; v: string }> = {
${sorted.map(([id, p]) => `  ${JSON.stringify(id)}: { "at": ${p.at}, "from": ${p.from}, "v": ${JSON.stringify(p.v)} }`).join(",\n")}
};
`,
);
console.log(`wrote ${sorted.length} peaks`);
