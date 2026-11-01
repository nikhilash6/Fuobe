#!/usr/bin/env node
/**
 * Stills for Home's before/after slider (src/components/home/before-after.tsx), sharp on a large or 2x screen: for each
 * app whose cover is a before → after reveal clip, its before and its after, made from the clip's own masters rather
 * than cut from the small clip.
 *
 * Input: a masters folder with a folder per app id, holding start.png (the before), end.png (the after) and, for an
 * app that takes a second picture, donor.png: the inset card the clip opens on, drawn on the before as its poster
 * shows it (bottom right, in a white frame).
 *
 * Output:
 *   public/previews/presets/ba/1280/<id>-before.jpg, <id>-after.jpg   1280x960, for 2x desktops and 3x phones
 *   public/previews/presets/ba/960/<id>-before.jpg, <id>-after.jpg    960x720, for 1x desktops and 2x phones
 *   public/previews/presets/ba/512/<id>-before.jpg, <id>-after.jpg    512x384, the first paint and 1x phones
 *   src/lib/preset-before-after.generated.ts                          { "<id>": "<version>" }
 *
 * Framing: the card's, a 4:3 centre crop. A reveal clip pushes in slowly and its poster is a few frames in
 * (POSTER_ZOOM), so its stills take that crop too; both stills of a pair take the same one, so they line up under the
 * slider's handle.
 *
 * Check: before anything is written, each before is compared with the app's poster, and each after with its clip's
 * frame near the end (as gen-preset-peaks.mjs cuts it; at the zoom that matches best, since the clip has pushed in
 * further by then): the mean difference of 128x96 grey copies, at most MATCH. A pair that doesn't show what the
 * app's card shows fails the run, and nothing is written.
 *
 * The version is the content version of a pair's six files (contentVersion, as the covers' own): all six URLs end
 * in ?v=<version>, so a pair made again gets new URLs. Every run versions every entry from its files as they are.
 *
 * Run: node scripts/gen-before-after.mjs --masters <dir>             every reveal app, and every id already listed
 *      node scripts/gen-before-after.mjs --masters <dir> <id> …     only these (another app's pair: name it once)
 *      node scripts/gen-before-after.mjs -<id> …                    take these out, with their files
 *      node scripts/gen-before-after.mjs --versions                 hash only
 *      --dry-run makes and checks, and writes nothing.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { contentVersion, readManifest } from "./eval/lib/covers.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PRESETS = path.join(ROOT, "public", "previews", "presets");
const OUT_DIR = path.join(PRESETS, "ba");
const OUT_TS = path.join(ROOT, "src", "lib", "preset-before-after.generated.ts");
/** The stills' widths (4:3), largest first: the slider's srcset picks one per screen, and the smallest shows first. */
const WIDTHS = [1280, 960, 512];
/** JPEG quality per width: the large copies' fine grain hides a lower one; the small still, enlarged, would show it. */
const QUALITY = { 1280: 75, 960: 75, 512: 82 };
/** The model a reveal clip's cover lists in the manifest: an Ideogram still, and its edit as the after. */
const REVEAL_MODEL = "ideogram4+qwen-image-2.1-edit";
/**
 * A reveal clip pushes in 6 % over its 86 frames, and its poster is its 7th frame (the cover's loop crossfade takes
 * the first 6, covers.mjs), so the poster shows the still enlarged this much.
 */
const POSTER_ZOOM = 1 + (0.06 * 6) / 86;
/** The donor's inset card on a reveal clip's opening frames, in its 1024x768 frame: its white frame's box. */
const INSET = { left: 677, top: 498, width: 319, height: 242, frame: 6 };
/** How far (of 255) a still may differ from what the card shows, on average: a mismatch is 25 and more. */
const MATCH = 6;
/** How far before its end the clip frame an after is checked against sits (as gen-preset-peaks.mjs's peak). */
const BEFORE_END = 0.45;

const files = (id) => WIDTHS.flatMap((w) => ["before", "after"].map((side) => path.join(OUT_DIR, String(w), `${id}-${side}.jpg`)));

const read = () => {
  if (!fs.existsSync(OUT_TS)) return {};
  const text = fs.readFileSync(OUT_TS, "utf8");
  return JSON.parse(text.slice(text.indexOf("= {") + 2, text.lastIndexOf("}") + 1));
};

const tool = (name, args, encoding = "utf8") => {
  const r = spawnSync(process.env[name === "ffmpeg" ? "FUOBE_FFMPEG" : "FUOBE_FFPROBE"] ?? name, args, { encoding, maxBuffer: 64 << 20 });
  if (r.error?.code === "ENOENT") throw new Error(`gen-before-after needs ${name} on PATH`);
  if (r.status !== 0) throw new Error(`${name} failed: ${String(r.stderr).trim().split("\n").at(-1)}`);
  return r.stdout;
};

/** A still cropped to 4:3 about its centre, enlarged by `zoom` (cropped further), at `width`. */
async function framed(file, zoom, width) {
  const { width: w, height: h } = await sharp(file).metadata();
  const [cw, ch] = w / h > 4 / 3 ? [(h * 4) / 3, h] : [w, (w * 3) / 4];
  const [zw, zh] = [Math.round(cw / zoom), Math.round(ch / zoom)];
  return sharp(file)
    .extract({ left: Math.round((w - zw) / 2), top: Math.round((h - zh) / 2), width: zw, height: zh })
    .resize(width, (width * 3) / 4, { fit: "fill", kernel: "lanczos3" });
}

/** The donor's inset card at `width`, and where it goes: as the clip draws it, scaled from its 1024 px frame. */
async function inset(donor, width) {
  const s = width / 1024;
  const box = { left: Math.round(INSET.left * s), top: Math.round(INSET.top * s), width: Math.round(INSET.width * s), height: Math.round(INSET.height * s) };
  const f = Math.max(1, Math.round(INSET.frame * s));
  const input = await sharp(donor)
    .resize(box.width - 2 * f, box.height - 2 * f, { fit: "cover", position: "centre", kernel: "lanczos3" })
    .extend({ top: f, bottom: f, left: f, right: f, background: "#ffffff" })
    .png()
    .toBuffer();
  return { input, left: box.left, top: box.top };
}

/** A pair's stills (JPEG buffers, in files()' order), from its masters folder. */
async function make(folder, zoom) {
  const donor = path.join(folder, "donor.png");
  const out = [];
  for (const width of WIDTHS) {
    let before = await framed(path.join(folder, "start.png"), zoom, width);
    if (fs.existsSync(donor)) before = sharp(await before.png().toBuffer()).composite([await inset(donor, width)]);
    const after = await framed(path.join(folder, "end.png"), zoom, width);
    for (const img of [before, after]) out.push(await img.jpeg({ quality: QUALITY[width], mozjpeg: true }).toBuffer());
  }
  return out;
}

/** A 128x96 grey copy, cropped about its centre by `zoom` first. */
async function grey(input, zoom = 1) {
  const { width: w, height: h } = await sharp(input).metadata();
  const [zw, zh] = [Math.round(w / zoom), Math.round(h / zoom)];
  return sharp(input)
    .extract({ left: Math.round((w - zw) / 2), top: Math.round((h - zh) / 2), width: zw, height: zh })
    .resize(128, 96, { fit: "fill", kernel: "lanczos3" })
    .greyscale()
    .raw()
    .toBuffer();
}
const gap = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;

/** The clip's frame BEFORE_END from its end, as a PNG buffer. */
function clipFrame(clip) {
  const [rate, frames] = tool("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=r_frame_rate,nb_read_packets", "-of", "csv=p=0", clip])
    .trim()
    .split(",");
  const [num, den] = rate.split("/").map(Number);
  const fps = num / (den || 1);
  const n = Math.max(0, Math.min(Number(frames) - 1, Math.round((Number(frames) / fps - BEFORE_END) * fps)));
  return tool("ffmpeg", ["-v", "error", "-i", clip, "-vf", `select=eq(n\\,${n})`, "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-"], "buffer");
}

/** How far the small before is from the poster, and the small after from the clip's late frame (at its best zoom). */
async function check(id, stills, cover) {
  const local = (url) => path.join(ROOT, "public", ...url.split("?")[0].split("/").filter(Boolean));
  const [before, after] = stills.slice(-2);
  const result = { before: gap(await grey(before), await grey(local(cover.poster))) };
  if (cover.video) {
    const frame = await grey(clipFrame(local(cover.video)));
    let best = Infinity;
    for (let z = 1; z <= 1.08; z += 0.004) best = Math.min(best, gap(await grey(after, z), frame));
    result.after = best;
  }
  return result;
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const mastersAt = args.indexOf("--masters");
const masters = mastersAt >= 0 ? args[mastersAt + 1] : undefined;
const named = args.filter((a, i) => !a.startsWith("-") && !(mastersAt >= 0 && i === mastersAt + 1));
const dropped = args.filter((a) => /^-[a-z0-9]/.test(a)).map((a) => a.slice(1));
if (!masters && !dropped.length && !flag("--versions")) {
  console.error("usage: node scripts/gen-before-after.mjs --masters <dir> [<id> …] | -<id> … | --versions   [--dry-run]");
  process.exit(1);
}
if (masters && !fs.statSync(masters, { throwIfNoEntry: false })?.isDirectory()) throw new Error(`No masters folder at ${masters}`);

const manifest = readManifest();
const pairs = read();
const dry = flag("--dry-run");
for (const id of dropped) {
  delete pairs[id];
  if (!dry) for (const f of files(id)) fs.rmSync(f, { force: true });
  console.log(`${id}: taken out`);
}

const failed = [];
const made = new Map();
if (masters) {
  const reveals = Object.keys(manifest).filter((id) => manifest[id].model === REVEAL_MODEL);
  const ids = named.length ? named : [...new Set([...reveals, ...Object.keys(pairs)])].sort();
  for (const id of ids) {
    const folder = path.join(masters, id);
    const missing = ["start.png", "end.png"].filter((f) => !fs.existsSync(path.join(folder, f)));
    // A pair named once before, whose masters aren't in this folder, stays as it is.
    if (missing.length && !named.length && pairs[id] && !reveals.includes(id)) {
      console.log(`${id}: kept (no masters here)`);
      continue;
    }
    if (missing.length) {
      failed.push(`${id}: no ${missing.join(" or ")} in ${folder}`);
      continue;
    }
    const cover = manifest[id];
    if (!cover) {
      failed.push(`${id}: no cover in the manifest to match`);
      continue;
    }
    const stills = await make(folder, cover.model === REVEAL_MODEL ? POSTER_ZOOM : 1);
    const gaps = await check(id, stills, cover);
    const said = `before ${gaps.before.toFixed(2)}, after ${gaps.after === undefined ? "(no clip)" : gaps.after.toFixed(2)}`;
    if (gaps.before > MATCH || gaps.after > MATCH) failed.push(`${id}: doesn't match its cover (${said} of at most ${MATCH})`);
    else made.set(id, stills);
    const kb = WIDTHS.map((w, i) => `${w} ${Math.round(stills[2 * i].length / 1024)}+${Math.round(stills[2 * i + 1].length / 1024)} KB`).join(", ");
    console.log(`${id}: ${said}; ${kb}${fs.existsSync(path.join(folder, "donor.png")) ? ", with its donor" : ""}`);
  }
}
if (failed.length) {
  console.error(`\n${failed.length} failed, nothing written:\n  ${failed.join("\n  ")}`);
  process.exit(1);
}
if (dry) {
  console.log(`dry run: ${made.size} pairs made and checked, nothing written`);
  process.exit(0);
}

for (const [id, stills] of made) {
  files(id).forEach((f, i) => {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, stills[i]);
  });
  pairs[id] = "";
}
// Every pair's version, from its files as they are now.
const sorted = Object.keys(pairs)
  .sort()
  .map((id) => {
    if (!files(id).every((f) => fs.existsSync(f))) throw new Error(`${id} is missing a still in public/previews/presets/ba: make it again, or take it out with -${id}`);
    return [id, contentVersion(files(id))];
  });
fs.writeFileSync(
  OUT_TS,
  `/**
 * Stills for Home's before/after slider, sharp on every screen: public/previews/presets/ba/1280/<id>-before.jpg and
 * <id>-after.jpg (1280x960), the same at 960x720 in ba/960/, and at 512x384 in ba/512/, shown first. The value is the
 * content version all six URLs end in (?v=), so a pair made again gets new URLs. Generated by
 * scripts/gen-before-after.mjs: run it again rather than editing.
 */
export const PRESET_BEFORE_AFTER: Record<string, string> = {
${sorted.map(([id, v]) => `  ${JSON.stringify(id)}: ${JSON.stringify(v)}`).join(",\n")}
};
`,
);
console.log(`wrote ${sorted.length} pairs`);
