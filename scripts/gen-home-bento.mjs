#!/usr/bin/env node
/**
 * Stills and data for Home's first screen (src/components/home/home-bento.tsx): small AVIF copies of pictures the site
 * already publishes, and the Audio tile's waveform, read from the Audio studio's own sample. Nothing is rendered: every
 * picture is a resized copy of a published one, so the tiles show exactly what the studios show.
 *
 * Output:
 *   public/previews/home/catwalk-512.avif             the catwalk clip's poster (its first frame), the video tile's still
 *   public/previews/home/image-4-{480,768}.avif       the Image studio's example 4
 *   public/previews/home/ba-{before,after}-{640,960}.avif         Colorize's before and after (4:3)
 *   public/previews/home/ba-{before,after}-tall-{360,576}.avif    the same pair, a 3:5 crop for the tall tile
 *   public/previews/home/board-{photo,film}.webp      the Canvas board's photo and a frame of its film, 168 px squares
 *   src/lib/home-bento.generated.ts                   each file's content version, and the waveform
 *
 * The waveform: the Clean up voice sample decoded to 8 kHz mono, its loudness (RMS) in WAVE_BARS equal slices, scaled
 * so the loudest is 1, with a floor of WAVE_FLOOR so a pause still shows a bar. It is keyed by the sample's own
 * version, so a new sample needs a new run (tests/home-bento.test.ts checks it).
 *
 * Run: node scripts/gen-home-bento.mjs            make every file and the generated module
 *      node scripts/gen-home-bento.mjs --dry-run  make and measure, write nothing
 * Needs ffmpeg on PATH (or FUOBE_FFMPEG).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { contentVersion } from "./eval/lib/covers.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const OUT_DIR = path.join(PUBLIC, "previews", "home");
const OUT_TS = path.join(ROOT, "src", "lib", "home-bento.generated.ts");
const DRY = process.argv.includes("--dry-run");

export const WAVE_BARS = 48;
export const WAVE_FLOOR = 0.12;
const WAVE_SOURCE = "/samples/clean-voice/clean.m4a";

/** The app the before/after tile shows (BENTO_BEFORE_AFTER in src/lib/home-bento.ts). */
const BA_APP = "app-colorize";
/**
 * The before/after tile is wide on a phone and a tablet (the 4:3 pair) and tall from lg: there it takes a 3:5 crop of
 * the 1280 pair around the subject, so it is never stretched past its own pixels and her face stays in the frame.
 */
const BA_TALL = { left: 352, top: 0, width: 576, height: 960 };
/** The Canvas board's two pictures (src/lib/home-bento.ts, BENTO_BOARD): the photo going in and a frame of the film. */
const BOARD_THUMBS = [
  { name: "board-photo.webp", from: "/examples/effect-pearl-earring/1/in-image.jpg" },
  { name: "board-film.webp", from: "/previews/presets/peak/effect-pearl-earring.jpg" },
];
/** Each copy: its name under previews/home, the published file it comes from, its width, and a crop where it has one. */
const STILLS = [
  { name: "catwalk-512.avif", from: "/previews/presets/motion-catwalk.jpg", width: 512 },
  { name: "image-4-480.avif", from: "/examples/image/4/out.jpg", width: 480 },
  { name: "image-4-768.avif", from: "/examples/image/4/out.jpg", width: 768 },
  ...["before", "after"].flatMap((side) => [
    ...[640, 960].map((width) => ({ name: `ba-${side}-${width}.avif`, from: `/previews/presets/ba/1280/${BA_APP}-${side}.jpg`, width })),
    ...[360, 576].map((width) => ({ name: `ba-${side}-tall-${width}.avif`, from: `/previews/presets/ba/1280/${BA_APP}-${side}.jpg`, width, crop: BA_TALL })),
  ]),
];
/** AVIF quality: the copies sit under a dark shade and are never shown larger than their own pixels. */
const QUALITY = 55;
/** The board's pictures show at 36 to 56 px: a 168 px square covers them on a 3x screen. */
const THUMB = 168;

const ffmpeg = (args) => {
  const r = spawnSync(process.env.FUOBE_FFMPEG ?? "ffmpeg", args, { maxBuffer: 64 << 20 });
  if (r.error?.code === "ENOENT") throw new Error("gen-home-bento needs ffmpeg on PATH");
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${String(r.stderr).trim().split("\n").at(-1)}`);
  return r.stdout;
};

/** The sample's loudness in `bars` slices, 0..1, the loudest 1, none under `floor`. */
export function waveform(samples, bars = WAVE_BARS, floor = WAVE_FLOOR) {
  const per = Math.floor(samples.length / bars);
  const rms = Array.from({ length: bars }, (_, i) => {
    let sum = 0;
    for (let j = i * per; j < (i + 1) * per; j++) sum += samples[j] * samples[j];
    return Math.sqrt(sum / per);
  });
  const max = Math.max(...rms) || 1;
  return rms.map((r) => Math.max(floor, Math.round((r / max) * 1000) / 1000));
}

function readWave() {
  const raw = ffmpeg(["-v", "error", "-i", path.join(PUBLIC, WAVE_SOURCE), "-ac", "1", "-ar", "8000", "-f", "s16le", "-"]);
  const samples = new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.length / 2));
  return { wave: waveform(Array.from(samples, (s) => s / 32768)), seconds: samples.length / 8000 };
}

async function main() {
  if (!DRY) fs.mkdirSync(OUT_DIR, { recursive: true });
  const versions = {};
  let total = 0;
  const jobs = [
    ...STILLS.map((s) => ({
      ...s,
      make: () => {
        const img = sharp(path.join(PUBLIC, s.from));
        return (s.crop ? img.extract(s.crop) : img).resize(s.width).avif({ quality: QUALITY, effort: 6 }).toBuffer();
      },
    })),
    ...BOARD_THUMBS.map((s) => ({ ...s, make: () => sharp(path.join(PUBLIC, s.from)).resize(THUMB, THUMB, { fit: "cover", position: "attention" }).webp({ quality: 72 }).toBuffer() })),
  ];
  for (const s of jobs) {
    const buf = await s.make();
    total += buf.length;
    const out = path.join(OUT_DIR, s.name);
    console.log(`${s.name}  ${(buf.length / 1024).toFixed(1)} KB`);
    if (DRY) continue;
    // Only a changed picture is written, so its version (and URL) stays the same run to run.
    if (!fs.existsSync(out) || !fs.readFileSync(out).equals(buf)) fs.writeFileSync(out, buf);
    versions[`/previews/home/${s.name}`] = contentVersion([out]);
  }
  const { wave, seconds } = readWave();
  console.log(`stills ${(total / 1024).toFixed(1)} KB · waveform ${wave.length} bars over ${seconds.toFixed(2)} s`);
  if (DRY) return;
  const source = contentVersion([path.join(PUBLIC, WAVE_SOURCE)]);
  const body = `/**
 * Home's first screen (src/components/home/home-bento.tsx): the content version of each still made for it, and the
 * Audio tile's waveform, read from the Clean up voice sample (its version is \`wave.source\`). Generated by
 * scripts/gen-home-bento.mjs: run it again rather than editing.
 */
export const HOME_BENTO_MEDIA: Record<string, string> = ${JSON.stringify(versions, null, 2)};

export const HOME_BENTO_WAVE = {
  src: ${JSON.stringify(WAVE_SOURCE)},
  source: ${JSON.stringify(source)},
  seconds: ${Math.round(seconds * 100) / 100},
  bars: ${JSON.stringify(wave)},
};
`;
  fs.writeFileSync(OUT_TS, body);
  console.log(`wrote ${path.relative(ROOT, OUT_TS)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
