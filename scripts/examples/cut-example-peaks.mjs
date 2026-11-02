#!/usr/bin/env node
/**
 * Gives every example whose output is a preset's clip a still where the change shows: the clip's peak frame, cut as
 * scripts/gen-preset-peaks.mjs cuts the covers' own (just before the clip's closing crossfade back into its first
 * frame). Without it a card rests on the clip's first frame, the same picture as what went in, until the clip plays.
 *
 * A clip that already has a cover peak (src/lib/preset-peaks.generated.ts) keeps it: the card rests where the preset's
 * own card does. For the others, the peak goes to public/examples/<preset id>/1/out-peak.jpg (512 px at most) and the
 * row gets `rest` in plan.json: { src, at, from }, as PresetPreview's own. Then run publish-examples.mjs for the
 * manifest. A published peak is never replaced (a new cut needs a new path). CPU only: ffmpeg and sharp.
 *
 *   node scripts/examples/cut-example-peaks.mjs            # every row that needs one
 *   node scripts/examples/cut-example-peaks.mjs --dry-run  # list them
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLIC = path.join(ROOT, "public");
const PLAN = path.join(ROOT, "src/lib/examples/plan.json");
const PEAKS_TS = path.join(ROOT, "src/lib/preset-peaks.generated.ts");
/** As gen-preset-peaks.mjs: how long before the end the peak sits, and where the loop comes back to. */
const BEFORE_END = 0.45;
const CHANGE = 3;
const LEAD = 3;

const tool = (name, args, encoding = "utf8") => {
  const r = spawnSync(name, args, { encoding, maxBuffer: 64 << 20 });
  if (r.error?.code === "ENOENT") throw new Error(`cut-example-peaks needs ${name} on PATH`);
  if (r.status !== 0) throw new Error(`${name} failed: ${String(r.stderr).trim().split("\n").at(-1)}`);
  return r.stdout;
};

function probe(file) {
  const [rate, frames] = tool("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=r_frame_rate,nb_read_packets", "-of", "csv=p=0", file])
    .trim()
    .split(",");
  const [num, den] = rate.split("/").map(Number);
  return { fps: num / (den || 1), frames: Number(frames) };
}

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

const timeOf = (frame, fps) => Math.round(((frame + 0.5) / fps) * 1e4) / 1e4;

function coverPeaks() {
  const text = fs.readFileSync(PEAKS_TS, "utf8");
  return JSON.parse(text.slice(text.indexOf("= {") + 2, text.lastIndexOf("}") + 1));
}

async function cut(id) {
  const clip = path.join(PUBLIC, "previews", "presets", `${id}.mp4`);
  if (!fs.existsSync(clip)) return null;
  const { fps, frames } = probe(clip);
  const n = Math.round((frames / fps - BEFORE_END) * fps);
  if (!(n >= 0 && n < frames)) throw new Error(`${id}: frame ${n} is outside its ${frames} frames`);
  const tmp = path.join(os.tmpdir(), `fuobe-example-peak-${process.pid}-${id}.png`);
  tool("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", clip, "-vf", `select=eq(n\\,${n})`, "-frames:v", "1", tmp]);
  const jpg = await sharp(tmp).resize({ width: 512, height: 512, fit: "inside", withoutEnlargement: true }).toColorspace("srgb").jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  fs.rmSync(tmp, { force: true });
  const from = Math.min(n, Math.max(0, changeStarts(clip) - LEAD));
  return { jpg, at: timeOf(n, fps), from: timeOf(from, fps) };
}

async function main() {
  const dry = process.argv.includes("--dry-run");
  const plan = JSON.parse(fs.readFileSync(PLAN, "utf8"));
  const peaks = coverPeaks();
  const done = new Map();
  let made = 0;
  for (const row of plan) {
    if (!row.output.startsWith("cover:") || row.rest) continue;
    const id = row.output.slice(6);
    if (peaks[id]) continue;
    if (!done.has(id)) {
      const pub = `/examples/${id}/1/out-peak.jpg`;
      if (dry) {
        console.log(`${row.id}: ${pub}`);
        done.set(id, null);
        continue;
      }
      const c = await cut(id);
      if (!c) {
        done.set(id, null);
        continue;
      }
      const file = path.join(PUBLIC, pub.slice(1));
      if (fs.existsSync(file)) {
        if (Buffer.compare(fs.readFileSync(file), c.jpg) !== 0) throw new Error(`${pub} is published with other bytes: a published example file is never replaced`);
      } else {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, c.jpg);
        made++;
      }
      done.set(id, { src: pub, at: c.at, from: c.from });
    }
    const rest = done.get(id);
    if (rest) row.rest = rest;
  }
  if (!dry) fs.writeFileSync(PLAN, `${JSON.stringify(plan, null, 1)}\n`);
  console.log(`${done.size} clips, ${made} new peaks`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
