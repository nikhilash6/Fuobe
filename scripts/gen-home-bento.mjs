#!/usr/bin/env node
/**
 * Media and data for Home's first screen (src/components/home/home-bento.tsx): the video tile's reel of clips and its
 * poster, the 3D tile's clip and its poster, each in several widths, AVIF copies of pictures the site already
 * publishes, and the Audio tile's waveform, read from the Audio studio's own sample. Nothing is rendered: every file is a
 * copy of a published picture or of the full-size render a published clip was cut from, so the tiles show exactly what
 * the studios show, only sharper.
 *
 * Output (public/previews/home/):
 *   reel-<name>-{640,1024}.mp4                each clip of the video tile's reel (REEL), and at 1536 and 2048 where its
 *                                             2048 px master is in the masters folder
 *   reel-sand-storm-<width>.avif              the reel's first clip's first frame at each of its widths: the tile's poster
 *   rotation-{640,1024,1536,2048}.{mp4,avif}  the turning gown (the 3D tile) at four widths, and each one's first frame
 *   reel-sand-storm-1024.jpg, rotation-1024.jpg the 1024 px clips' first frames, for a browser without AVIF
 *   image-4-{480,768}.avif                the Image studio's example 4
 *   ba-{before,after}-{640,960,1280}.avif       Colorize's before and after (4:3)
 *   ba-{before,after}-tall-{432,691}.avif       the same pair, a 3:5 crop for the tall tile
 *   board-{photo,film}.webp               the Canvas board's photo and a frame of its film, 168 px squares
 * and src/lib/home-bento.generated.ts: each file's content version, the reel (its clips in order, each one's length and
 * framing), and the waveform.
 *
 * The reel: the video tile plays these clips one after another, each once, and crossfades into the next (after the
 * last, back to the first). Each is a stretch of its preset's full-size render: `from` (its first frame in the render)
 * and `frames` long, at CLIP_FPS, with no loop of its own. The 3D tile's clip is the published clip's own cut
 * (scripts/eval/lib/covers.mjs: its first CLIP_SECONDS at CLIP_FPS, looped the same way), made again from the full-size
 * render instead of the 512 px copy. All are H.264 High (a CRF per clip and width, faststart, no sound), tagged BT.709
 * so every browser shows their colours the same way. Each tile picks the width its box needs on the screen it is on
 * (bento-islands.tsx).
 *
 * The posters: the reel's first clip's and the 3D clip's own first frame, decoded from the encoded file the way a
 * browser shows it (BT.709, limited range), at POSTER_QUALITY: the tile shows it until its clip plays, and the clip
 * takes over on that same frame, so the swap can't be seen. They are made again from the clips on every run, with or without masters.
 *
 * Masters: the full-size renders are not in the repo. With --masters <dir> (or FUOBE_HOME_MASTERS) the clips, their
 * posters and the before/after copies are made from the files in it:
 *   <dir>/<preset>.mp4             the full-size render each reel clip and the 3D clip are cut from (1024 x 768, 24 fps)
 *   <dir>/<preset>-2048.mkv        the same render upscaled to 2048 x 1536, every frame (SeedVR2 7B, lossless FFV1,
 *                                  BT.709), for the 1536 and 2048 px copies: the 3D clip needs it; a reel clip without
 *                                  one comes at 640 and 1024 only
 *   <dir>/app-colorize-before.png, <dir>/app-colorize-after.png  Colorize's pair at full size (1536 x 1152)
 * Without it those files are kept as they are (and versioned; a reel clip in the widths it has), the posters are made
 * again from the clips kept, and so is the rest.
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
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { CLIP_FPS, CLIP_SECONDS, LOOP_FADE, contentVersion, loopsAlready, readY4m, seamless } from "./eval/lib/covers.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const OUT_DIR = path.join(PUBLIC, "previews", "home");
const OUT_TS = path.join(ROOT, "src", "lib", "home-bento.generated.ts");
const DRY = process.argv.includes("--dry-run");
const argAt = process.argv.indexOf("--masters");
const MASTERS = argAt > 0 ? process.argv[argAt + 1] : process.env.FUOBE_HOME_MASTERS;

export const WAVE_BARS = 48;
export const WAVE_FLOOR = 0.12;
const WAVE_SOURCE = "/samples/clean-voice/clean.m4a";

/** The app the before/after tile shows (BENTO_BEFORE_AFTER in src/lib/home-bento.ts). */
const BA_APP = "app-colorize";
/**
 * The before/after tile is wide on a phone and a tablet (the 4:3 pair) and tall from lg: there it takes a 3:5 crop of
 * the full-size pair (1536 x 1152) around the subject, so it is never stretched past its own pixels and her face stays
 * in the frame.
 */
const BA_TALL = { left: 422, top: 0, width: 691, height: 1152 };
/**
 * The video tile's reel, in the order it plays: each clip's preset, the name of its copies here, the stretch of its
 * render it plays (`from`, its first frame; `frames`, at CLIP_FPS), where the tile anchors it (its object-position:
 * the tile is wider than the 4:3 clip, so only its top and bottom are cropped), and the CRF each width is encoded at
 * (chosen on close crops of faces and fine detail against the render; a busy picture, such as One Take's leaves, costs
 * more bits). The stretches are the ones that hold up frame by frame at the tile's size: One Take from the arch to its
 * look back (the render's last frame) and Sand Storm whole, from the first gust until the haze settles. The first clip's first frame is the
 * tile's poster.
 */
export const REEL = [
  { id: "effect-sand-storm", name: "reel-sand-storm", from: 0, frames: 124, position: "50% 0%", crf: { 640: 22, 1024: 22, 1536: 26, 2048: 27 } },
  { id: "motion-one-take", name: "reel-one-take", from: 28, frames: 96, position: "50% 15%", crf: { 640: 22, 1024: 23, 1536: 27, 2048: 28 } },
];
/**
 * The 3D tile's clip: its published preset, the name of its copies here, and the CRF each width is encoded at (the
 * wider copies, made from the 2048 px master, at a higher CRF: their pixels are smaller on the screen).
 */
const LOOPS = [{ key: "app-3d-rotation", name: "rotation", crf: { 640: 23, 1024: 23, 1536: 27, 2048: 28 } }];
/** The widths each clip and its poster are made at: a tile takes the first at least as wide as its box needs. */
const CLIP_WIDTHS = [640, 1024, 1536, 2048];
/** The widths a reel clip is made at from its render alone (wider ones need its 2048 px master). */
const RENDER_WIDTHS = [640, 1024];
/** From this width up, a clip is made from its 2048 px master (`<key>-2048.mkv`) instead of the render itself. */
const HD_FROM = 1536;
/** The width of each clip's first frame as a JPEG, the poster for a browser without AVIF (BENTO_CLIP_FALLBACK). */
const FALLBACK_WIDTH = 1024;
/** The Canvas board's two pictures (src/lib/home-bento.ts, BENTO_BOARD): the photo going in and a frame of the film. */
const BOARD_THUMBS = [
  { name: "board-photo.webp", from: "/examples/effect-pearl-earring/1/in-image.jpg" },
  { name: "board-film.webp", from: "/previews/presets/peak/effect-pearl-earring.jpg" },
];
/** Each copy: its name under previews/home, the published file it comes from, its width, and a crop where it has one. */
const STILLS = [
  { name: "image-4-480.avif", from: "/examples/image/4/out.jpg", width: 480 },
  { name: "image-4-768.avif", from: "/examples/image/4/out.jpg", width: 768 },
];
/** Copies made from a master (`master`: its file name in the masters folder). */
const MASTER_STILLS = ["before", "after"].flatMap((side) => [
  ...[640, 960, 1280].map((width) => ({ name: `ba-${side}-${width}.avif`, master: `${BA_APP}-${side}.png`, width })),
  ...[432, 691].map((width) => ({ name: `ba-${side}-tall-${width}.avif`, master: `${BA_APP}-${side}.png`, width, crop: BA_TALL })),
]);
/** AVIF quality: the copies sit under a dark shade, and each tile takes one at least as wide as it shows. */
const QUALITY = 55;
/** The clips' posters: close enough to the clip's own first frame that the swap from one to the other can't be seen. */
const POSTER_QUALITY = 65;
/** The colours every clip is tagged with (libx264 takes them as its own options): its poster is decoded the same way. */
const BT709 = ["-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709", "-color_range", "tv"];
/** The board's pictures show at 36 to 56 px: a 168 px square covers them on a 3x screen. */
const THUMB = 168;

const ffmpeg = (args, input) => {
  const r = spawnSync(process.env.FUOBE_FFMPEG ?? "ffmpeg", args, { input, maxBuffer: 1 << 30 });
  if (r.error?.code === "ENOENT") throw new Error("gen-home-bento needs ffmpeg on PATH");
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${String(r.stderr).trim().split("\n").at(-1)}`);
  return r.stdout;
};

/**
 * A clip's loop at `width`, cut as covers.mjs encode() cuts the published one: decoded at CLIP_FPS, its first
 * CLIP_SECONDS (and the frames the crossfade takes back), looped without a seam unless it loops already. Returns its
 * y4m stream.
 */
function loopAt(src, width) {
  const seconds = CLIP_SECONDS + LOOP_FADE / CLIP_FPS;
  const y4m = ffmpeg(["-v", "error", "-i", src, "-t", String(seconds), "-an", "-sn", "-dn", "-vf", `scale=${width}:-2:flags=lanczos,fps=${CLIP_FPS},format=yuv420p`, "-f", "yuv4mpegpipe", "-"]);
  const { header, frames, luma } = readY4m(y4m);
  const cut = frames.slice(0, CLIP_SECONDS * CLIP_FPS);
  const looped = loopsAlready(cut, luma) ? cut : seamless(frames, Math.min(LOOP_FADE, Math.floor(frames.length / 4)));
  const stream = (list) => Buffer.concat([Buffer.from(`${header}\n`, "latin1"), ...list.flatMap((fr) => [Buffer.from("FRAME\n"), fr])]);
  return { all: stream(looped), frames: looped.length };
}

/**
 * A reel clip at `width`: `frames` frames from frame `from` of the render (at CLIP_FPS), played once, no loop. Returns
 * its y4m stream.
 */
function cutAt(src, width, from, frames) {
  const y4m = ffmpeg(["-v", "error", "-i", src, "-an", "-sn", "-dn", "-vf", `fps=${CLIP_FPS},trim=start_frame=${from}:end_frame=${from + frames},setpts=PTS-STARTPTS,scale=${width}:-2:flags=lanczos,format=yuv420p`, "-f", "yuv4mpegpipe", "-"]);
  const got = readY4m(y4m).frames.length;
  if (got !== frames) throw new Error(`${path.basename(src)} has ${got} frames from frame ${from}, not ${frames}`);
  return y4m;
}

/** H.264 High, the published clip's loop, muted, its index at the front so it starts before it has all loaded. */
function encodeClipBuffer(y4m, crf) {
  const out = path.join(os.tmpdir(), `gen-home-bento-${process.pid}.mp4`);
  try {
    encodeClip(y4m, crf, out);
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(out, { force: true });
  }
}

function encodeClip(y4m, crf, out) {
  ffmpeg(["-v", "error", "-y", "-f", "yuv4mpegpipe", "-i", "-", "-an", "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-tune", "film", "-crf", String(crf), "-g", String(2 * CLIP_FPS), "-pix_fmt", "yuv420p", ...BT709, "-map_metadata", "-1", "-movflags", "+faststart", out], y4m);
}

/** A clip's first frame as a PNG, decoded from the encoded file as a browser shows it. */
function firstFrame(file) {
  return ffmpeg(["-v", "error", "-i", file, "-frames:v", "1", "-vf", "scale=in_color_matrix=bt709:in_range=tv:flags=accurate_rnd+full_chroma_int+lanczos,format=rgb24", "-c:v", "png", "-f", "image2pipe", "-"]);
}

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
  if (MASTERS && !fs.existsSync(MASTERS)) throw new Error(`no masters folder at ${MASTERS}`);
  const master = (name) => path.join(MASTERS, name);
  const versions = {};
  let total = 0;
  // Made from the masters when there are any; without them the files already here are kept (and versioned).
  // The reel's widths: 640 and 1024 from each render, the wider ones from its 2048 px master where there is one;
  // without masters, the widths already here.
  const reelWidths = (c) =>
    CLIP_WIDTHS.filter((w) =>
      MASTERS ? RENDER_WIDTHS.includes(w) || fs.existsSync(master(`${c.id}-2048.mkv`)) : fs.existsSync(path.join(OUT_DIR, `${c.name}-${w}.mp4`)),
    );
  const reel = REEL.map((c) => ({ ...c, widths: reelWidths(c) }));
  for (const c of reel) if (!RENDER_WIDTHS.every((w) => c.widths.includes(w))) throw new Error(`${c.name} is made from the full-size renders: run with --masters <dir>`);
  const fromMasters = [
    ...reel.flatMap((c) =>
      c.widths.map((w) => ({
        name: `${c.name}-${w}.mp4`,
        clip: true,
        make: () => encodeClipBuffer(cutAt(master(RENDER_WIDTHS.includes(w) ? `${c.id}.mp4` : `${c.id}-2048.mkv`), w, c.from, c.frames), c.crf[w]),
      })),
    ),
    ...LOOPS.flatMap((c) =>
      CLIP_WIDTHS.map((w) => ({
        name: `${c.name}-${w}.mp4`,
        clip: true,
        make: () => encodeClipBuffer(loopAt(master(w >= HD_FROM ? `${c.key}-2048.mkv` : `${c.key}.mp4`), w).all, c.crf[w]),
      })),
    ),
    ...MASTER_STILLS.map((s) => ({
      ...s,
      make: () => {
        const img = sharp(master(s.master));
        return (s.crop ? img.extract(s.crop) : img).resize(s.width).avif({ quality: QUALITY, effort: 6 }).toBuffer();
      },
    })),
  ];
  for (const s of fromMasters) {
    const out = path.join(OUT_DIR, s.name);
    if (!MASTERS) {
      if (!fs.existsSync(out)) throw new Error(`${s.name} is made from the full-size renders: run with --masters <dir>`);
      console.log(`${s.name}  kept (no --masters)`);
    } else {
      const buf = await s.make();
      if (!s.clip) total += buf.length;
      console.log(`${s.name}  ${(buf.length / 1024).toFixed(1)} KB`);
      if (DRY) continue;
      if (!fs.existsSync(out) || !fs.readFileSync(out).equals(buf)) fs.writeFileSync(out, buf);
    }
    if (!DRY) versions[`/previews/home/${s.name}`] = contentVersion([out]);
  }
  // Each poster, from its clip as it is now (just made, or kept): the reel's first clip's, and the 3D clip's.
  const posterSets = [{ name: reel[0].name, widths: reel[0].widths }, ...LOOPS.map((c) => ({ name: c.name, widths: CLIP_WIDTHS }))];
  const posters = posterSets.flatMap((c) => c.widths.map((w) => ({ name: `${c.name}-${w}.avif`, clip: `${c.name}-${w}.mp4` })));
  const jobs = [
    ...posters.map((p) => ({
      ...p,
      make: () => {
        // A dry run writes no clip: it reads the one already here.
        return sharp(firstFrame(path.join(OUT_DIR, p.clip))).avif({ quality: POSTER_QUALITY, effort: 6 }).toBuffer();
      },
    })),
    // For a browser without AVIF: the FALLBACK_WIDTH clip's first frame as a JPEG.
    ...posterSets.map((c) => ({
      name: `${c.name}-${FALLBACK_WIDTH}.jpg`,
      make: () => sharp(firstFrame(path.join(OUT_DIR, `${c.name}-${FALLBACK_WIDTH}.mp4`))).jpeg({ quality: 85, mozjpeg: true }).toBuffer(),
    })),
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
  console.log(`stills ${(total / 1024).toFixed(1)} KB (clips aside) Â· waveform ${wave.length} bars over ${seconds.toFixed(2)} s`);
  if (DRY) return;
  const source = contentVersion([path.join(PUBLIC, WAVE_SOURCE)]);
  const body = `/**
 * Home's first screen (src/components/home/home-bento.tsx): the content version of each file made for it, the video
 * tile's reel, and the Audio tile's waveform, read from the Clean up voice sample (its version is \`wave.source\`). Generated by
 * scripts/gen-home-bento.mjs: run it again rather than editing.
 */
export const HOME_BENTO_MEDIA: Record<string, string> = ${JSON.stringify(versions, null, 2)};

/** The video tile's reel, in the order it plays: each clip's preset, its copies' name, its length and its framing. */
export const HOME_BENTO_REEL = ${JSON.stringify(
    REEL.map(({ id, name, frames, position }) => ({ id, name, frames, fps: CLIP_FPS, position })),
    null,
    2,
  )};

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
