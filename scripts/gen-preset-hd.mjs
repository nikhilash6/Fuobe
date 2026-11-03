#!/usr/bin/env node
/**
 * Larger copies of preset covers, for boxes wider than the published clip and still (a starter card, a preset header,
 * an example card, a 2x or 3x screen): the clip, its poster, its peak frame and its examples' resting frame at more
 * widths, made from the render the published cover was cut from rather than enlarged from the published copy.
 *
 * Input: one or more masters folders (--masters, in the order to try), each with a folder per preset id holding
 * clip.mp4 (the render) and, as pnpm eval:covers reads it, an optional meta.json (`{"length": "full"}`), or for a
 * cover that is a still, start.png or end.png. The clip is cut and looped as the published one (coverLoop in
 * scripts/eval/lib/covers.mjs), so every copy has the same frames at the same times. A preset's render can sit in
 * more than one folder, in different versions: the first one whose copies show what the published cover shows is used.
 *
 * Output, for a clip cover, for each width W in CLIP_WIDTHS up to the render's own width:
 *   public/previews/presets/hd/<W>/<id>.mp4          H.264 High, BT.709 tags, its index at the front
 *   public/previews/presets/hd/<W>/<id>.avif, .jpg   the poster: the clip's first frame (or the frame it rests on)
 *   public/previews/presets/hd/<W>/peak/<id>.avif, .jpg   the peak frame (preset-peaks.generated.ts), when it has one
 *   public/previews/presets/hd/<W>/rest/<id>.avif, .jpg   the frame its examples rest on (an example row's `rest` in
 *                                                    src/lib/examples/plan.json, cut by cut-example-peaks.mjs), when it has one
 * For a still cover, for each width in STILL_WIDTHS up to the original's: hd/<W>/<id>.avif, .jpg.
 * And AVIF copies of every still at SMALL_PX (hd/320/), so a small tile on a browser that takes AVIF stays small.
 *   src/lib/preset-hd.generated.ts   { "<id>": { w: [<widths>], v: "<version>", still?: <published px>, rest?: "<url>" } }
 * A clip's stills are decoded from the encoded clip the way a browser shows it, so the swap from still to clip can't be seen.
 *
 * Check: each poster, peak and resting frame is compared with the published one (the mean difference of 128x96 grey
 * copies, at most MATCH): a render whose copies don't show what the card shows is not used. A clip copy is held
 * to MAX_KBPS.
 *
 * A render no wider than the published copy has nothing to add, and a preset with no matching render can't be made:
 * the run lists both (a new render or an upscale is the way) and goes on with the others.
 *
 * Run: node scripts/gen-preset-hd.mjs --masters <dir> [--masters <dir> …] <id> …   make these
 *      --jobs <n> makes them in n processes at once
 *      node scripts/gen-preset-hd.mjs -<id> …                  take these out, with their files
 *      node scripts/gen-preset-hd.mjs --versions               hash only
 *      --dry-run makes and checks, and writes nothing. --report <file> writes what was made and what wasn't, as JSON.
 * Needs ffmpeg on PATH (or FUOBE_FFMPEG).
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { CLIP_FPS, contentVersion, coverLoop } from "./eval/lib/covers.mjs";

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.join(path.dirname(SELF), "..");
const PUBLIC = path.join(ROOT, "public");
const PRESETS = path.join(PUBLIC, "previews", "presets");
const OUT_DIR = path.join(PRESETS, "hd");
const OUT_TS = path.join(ROOT, "src", "lib", "preset-hd.generated.ts");
const PEAKS_TS = path.join(ROOT, "src", "lib", "preset-peaks.generated.ts");
const PLAN = path.join(ROOT, "src", "lib", "examples", "plan.json");
/** The clip copies' widths (4:3): a 440 px card on a 2x screen takes 1024, a phone's half-width tile 640. */
const CLIP_WIDTHS = [640, 1024];
/** A still cover's copies (published at 768): a preset's own page shows it 996 px wide on a phone at 3x. */
const STILL_WIDTHS = [1024];
/** The small AVIF stills' width, as the JPEG thumbs' (thumbOf). */
const SMALL_PX = 320;
/** The published clips' width: a render no wider has nothing to add. */
const PUBLISHED_PX = 512;
/** CRF per width: the larger copy is seen larger, so it keeps more. */
const CRF = { 640: 26, 1024: 25 };
/**
 * The most bits a second a clip copy may take (kbit/s, x264's VBV): a calm clip stays at its CRF, far under it, and a
 * grainy or fast one is held to it, so a 5 s copy weighs at most about 0.75 MB at 640 and 1.3 MB at 1024.
 */
const MAX_KBPS = { 640: 1200, 1024: 2000 };
const AVIF_QUALITY = 62;
const JPEG_QUALITY = 82;
/** How far (of 255) a copy may differ from the published still, on average: another frame is 10 and more. */
const MATCH = 6;
/** The colours every clip is tagged with (libx264 takes them as its own options): its stills are decoded the same way. */
const BT709 = ["-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709", "-color_range", "tv"];

const argv = process.argv.slice(2);
const DRY = argv.includes("--dry-run");
/** The values of a repeatable option. */
const valuesOf = (flag) => argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []));
const MASTERS = valuesOf("--masters");
const JOBS = Number(valuesOf("--jobs")[0] ?? 1);
const PART = valuesOf("--part")[0];
const REPORT = valuesOf("--report")[0];
const valued = new Set(["--masters", "--jobs", "--part", "--report"]);
const named = argv.filter((a, i) => !a.startsWith("--") && !valued.has(argv[i - 1]));

const tool = (name, args, input) => {
  const r = spawnSync(process.env[name === "ffmpeg" ? "FUOBE_FFMPEG" : "FUOBE_FFPROBE"] ?? name, args, { input, maxBuffer: 1 << 30 });
  if (r.error?.code === "ENOENT") throw new Error(`gen-preset-hd needs ${name} on PATH`);
  if (r.status !== 0) throw new Error(`${name} failed: ${String(r.stderr).trim().split("\n").at(-1)}`);
  return r.stdout;
};

const readTs = (file) => {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, "utf8");
  return JSON.parse(text.slice(text.indexOf("= {") + 2, text.lastIndexOf("}") + 1));
};

/** A still's folder under each width: the poster at the top, the peak and the examples' resting frame in their own. */
const rel = (w, id, ext, kind = "poster") => path.join(OUT_DIR, String(w), ...(kind === "poster" ? [] : [kind]), `${id}.${ext}`);

/** Every file an entry has, in a fixed order (its version is theirs). */
function filesOf(id, entry, hasPeak) {
  const kinds = ["poster", ...(entry.still ? [] : [...(hasPeak ? ["peak"] : []), ...(entry.rest ? ["rest"] : [])])];
  const out = [];
  for (const w of entry.w) out.push(...(entry.still ? [] : [rel(w, id, "mp4")]), ...kinds.flatMap((k) => [rel(w, id, "avif", k), rel(w, id, "jpg", k)]));
  out.push(...kinds.map((k) => rel(SMALL_PX, id, "avif", k)));
  return out;
}

/** A picture's or clip's width. */
const widthOf = (file) => Number(String(tool("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "csv=p=0", file])).trim().split("\n")[0]);

/** Frame `n` of an encoded clip as a PNG, decoded as a browser shows it (BT.709, limited range). */
const frameOf = (file, n) =>
  tool("ffmpeg", ["-v", "error", "-i", file, "-vf", `select=eq(n\\,${n}),scale=in_color_matrix=bt709:in_range=tv:flags=accurate_rnd+full_chroma_int+lanczos,format=rgb24`, "-frames:v", "1", "-c:v", "png", "-f", "image2pipe", "-"]);

/**
 * Mean difference (of 255) between two pictures' 128x96 grey copies, each taken from its own mean brightness: an older
 * still cut with another colour decode (a few levels lighter or darker all over) still counts as the same frame, and
 * another frame (the subject moved) differs 10 and more.
 */
async function gap(a, b) {
  const grey = (x) => sharp(x).resize(128, 96, { fit: "fill" }).greyscale().raw().toBuffer();
  const [p, q] = await Promise.all([grey(a), grey(b)]);
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  const [mp, mq] = [mean(p), mean(q)];
  let sum = 0;
  for (let i = 0; i < p.length; i++) sum += Math.abs(p[i] - mp - (q[i] - mq));
  return sum / p.length;
}

function readMeta(folder) {
  try {
    return JSON.parse(fs.readFileSync(path.join(folder, "meta.json"), "utf8")) ?? {};
  } catch {
    return {};
  }
}

/** The frame each preset's examples rest on (plan.json rows whose output is its cover): { url, at }. */
function examplesRest() {
  const out = {};
  if (!fs.existsSync(PLAN)) return out;
  const plan = JSON.parse(fs.readFileSync(PLAN, "utf8"));
  for (const row of Array.isArray(plan) ? plan : (plan.rows ?? [])) {
    const id = typeof row.output === "string" && row.output.startsWith("cover:") ? row.output.slice(6) : undefined;
    if (!id || !row.rest?.src) continue;
    if (out[id] && out[id].url !== row.rest.src) throw new Error(`${id}: its examples rest on two frames (${out[id].url}, ${row.rest.src})`);
    out[id] = { url: row.rest.src, at: row.rest.at };
  }
  return out;
}

/** A render that doesn't show what the published cover shows: the next folder's may. */
class Mismatch extends Error {}

const hd = readTs(OUT_TS);
const peaks = readTs(PEAKS_TS);
const rests = examplesRest();
const reRender = [];
const failed = [];

/** The frame number (at CLIP_FPS) a time inside it names, as gen-preset-peaks.mjs and cut-example-peaks.mjs give it. */
const frameAt = (at) => Math.round(at * CLIP_FPS - 0.5);

/** Encode a looped clip at its width's CRF, held to MAX_KBPS. */
function encodeClip(looped, stream, w, tmp) {
  const crf = CRF[w] ?? 25;
  const kbps = MAX_KBPS[w] ?? 2000;
  tool("ffmpeg", ["-v", "error", "-y", "-f", "yuv4mpegpipe", "-i", "-", "-an", "-c:v", "libx264", "-profile:v", "high", "-preset", "slow", "-tune", "film", "-crf", String(crf), "-maxrate", `${kbps}k`, "-bufsize", `${2 * kbps}k`, "-g", String(2 * CLIP_FPS), "-pix_fmt", "yuv420p", ...BT709, "-map_metadata", "-1", "-movflags", "+faststart", tmp], stream(looped));
  return crf;
}

/** A clip cover's copies from one render, or a Mismatch. */
async function fromClip(id, folder, src, own) {
  const widths = [...new Set(CLIP_WIDTHS.map((w) => Math.min(w, own)))].filter((w) => w > PUBLISHED_PX);
  const meta = readMeta(folder);
  const opts = meta.length === "full" ? { length: "full" } : {};
  const peak = peaks[id];
  const rest = rests[id];
  const published = {
    poster: path.join(PRESETS, `${id}.jpg`),
    peak: path.join(PRESETS, "peak", `${id}.jpg`),
    rest: rest && path.join(PUBLIC, ...rest.url.split("?")[0].split("/").filter(Boolean)),
  };
  const made = new Map();
  let largest = {};
  for (const w of widths) {
    const { looped, rest: restFrame, stream } = coverLoop(src, opts, `scale=${w}:-2:flags=lanczos`);
    const tmp = path.join(os.tmpdir(), `gen-preset-hd-${process.pid}-${w}.mp4`);
    try {
      const crf = encodeClip(looped, stream, w, tmp);
      made.set(rel(w, id, "mp4"), fs.readFileSync(tmp));
      const stills = [
        { kind: "poster", n: restFrame ?? 0 },
        ...(peak ? [{ kind: "peak", n: frameAt(peak.at) }] : []),
        ...(rest && fs.existsSync(published.rest) ? [{ kind: "rest", n: frameAt(rest.at) }] : []),
      ];
      for (const s of stills) {
        const png = frameOf(tmp, s.n);
        const d = await gap(png, published[s.kind]);
        console.log(`${id} ${w} crf ${crf} ${s.kind} (frame ${s.n}): differs ${d.toFixed(2)} from the published one`);
        if (d > MATCH) throw new Mismatch(`its ${w} px ${s.kind} from ${src} differs ${d.toFixed(2)} (> ${MATCH}) from the published one`);
        made.set(rel(w, id, "avif", s.kind), await sharp(png).avif({ quality: AVIF_QUALITY, effort: 6 }).toBuffer());
        made.set(rel(w, id, "jpg", s.kind), await sharp(png).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer());
        if (w === widths.at(-1)) largest[s.kind] = png;
      }
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  for (const [kind, png] of Object.entries(largest)) made.set(rel(SMALL_PX, id, "avif", kind), await sharp(png).resize(SMALL_PX).avif({ quality: AVIF_QUALITY, effort: 6 }).toBuffer());
  return { made, entry: { w: widths, ...(largest.rest && { rest: rests[id].url.split("?")[0] }) } };
}

/** A still cover's copies from one original, or a Mismatch. */
async function fromStill(id, src, own, publishedW) {
  const published = path.join(PRESETS, `${id}.jpg`);
  const widths = STILL_WIDTHS.filter((w) => w > publishedW && w <= own);
  const made = new Map();
  for (const w of widths) {
    const png = await sharp(src).resize(w, null, { kernel: "lanczos3" }).png().toBuffer();
    const d = await gap(png, published);
    console.log(`${id} ${w} still: differs ${d.toFixed(2)} from the published one`);
    if (d > MATCH) throw new Mismatch(`its ${w} px still from ${src} differs ${d.toFixed(2)} (> ${MATCH}) from the published one`);
    made.set(rel(w, id, "avif"), await sharp(png).avif({ quality: AVIF_QUALITY, effort: 6 }).toBuffer());
    made.set(rel(w, id, "jpg"), await sharp(png).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toBuffer());
    if (w === widths.at(-1)) made.set(rel(SMALL_PX, id, "avif"), await sharp(png).resize(SMALL_PX).avif({ quality: AVIF_QUALITY, effort: 6 }).toBuffer());
  }
  return { made, entry: { w: widths, still: publishedW } };
}

async function make(id) {
  if (!MASTERS.length) throw new Error(`${id}: copies are made from the renders: run with --masters <dir>`);
  const clip = fs.existsSync(path.join(PRESETS, `${id}.mp4`));
  const publishedW = widthOf(path.join(PRESETS, `${id}.jpg`));
  const wider = clip ? PUBLISHED_PX : publishedW;
  // Each render that could be it, in the folders' order: the first whose copies show the published cover wins.
  const tries = MASTERS.flatMap((dir) => (clip ? ["clip.mp4"] : ["start.png", "end.png"]).map((f) => ({ folder: path.join(dir, id), src: path.join(dir, id, f) }))).filter((t) => fs.existsSync(t.src));
  const sized = tries.map((t) => ({ ...t, own: widthOf(t.src) }));
  const usable = sized.filter((t) => t.own > wider && (clip || t.own >= Math.min(...STILL_WIDTHS)));
  if (!usable.length) {
    const best = Math.max(0, ...sized.map((t) => t.own));
    reRender.push({ id, why: sized.length ? `its largest render is ${best} px wide` : "no render found" });
    return;
  }
  const misses = [];
  for (const t of usable) {
    try {
      const { made, entry } = clip ? await fromClip(id, t.folder, t.src, t.own) : await fromStill(id, t.src, t.own, publishedW);
      for (const [file, buf] of made) {
        console.log(`  ${path.relative(PRESETS, file).split(path.sep).join("/")}  ${(buf.length / 1024).toFixed(1)} KB`);
        if (DRY) continue;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, buf);
      }
      if (!DRY) hd[id] = entry;
      return entry;
    } catch (e) {
      if (!(e instanceof Mismatch)) throw e;
      misses.push(e.message);
    }
  }
  failed.push({ id, why: misses.join("; ") });
}

/** Make `ids` in `n` child processes, and take their entries in. */
async function inParallel(ids, n) {
  const parts = Array.from({ length: n }, (_, i) => ids.filter((_, j) => j % n === i)).filter((p) => p.length);
  await Promise.all(
    parts.map(
      (part, i) =>
        new Promise((resolve, reject) => {
          const file = path.join(os.tmpdir(), `gen-preset-hd-${process.pid}-part${i}.json`);
          const args = [SELF, ...MASTERS.flatMap((m) => ["--masters", m]), "--part", file, ...(DRY ? ["--dry-run"] : []), ...part];
          const child = spawn(process.execPath, args, { stdio: ["ignore", "inherit", "inherit"] });
          child.on("error", reject);
          child.on("exit", (code) => {
            if (code !== 0) return reject(new Error(`part ${i} stopped (exit ${code})`));
            const got = JSON.parse(fs.readFileSync(file, "utf8"));
            fs.rmSync(file, { force: true });
            Object.assign(hd, got.entries);
            reRender.push(...got.reRender);
            failed.push(...got.failed);
            resolve();
          });
        }),
    ),
  );
}

const makes = named.filter((a) => !a.startsWith("-"));
for (const arg of named.filter((a) => a.startsWith("-"))) {
  const id = arg.slice(1);
  if (hd[id] && !DRY) for (const f of filesOf(id, hd[id], true)) fs.rmSync(f, { force: true });
  delete hd[id];
  console.log(`${id}: taken out`);
}
if (PART) {
  const entries = {};
  for (const id of makes) {
    const entry = await make(id);
    if (entry) entries[id] = entry;
  }
  fs.writeFileSync(PART, JSON.stringify({ entries, reRender, failed }));
  process.exit(0);
}
if (JOBS > 1 && makes.length > 1) await inParallel(makes, JOBS);
else for (const id of makes) await make(id);

if (reRender.length) console.log(`needs a new render or an upscale (nothing larger than the published copy): ${reRender.map((r) => `${r.id} (${r.why})`).join(", ")}`);
if (failed.length) console.log(`no render shows the published cover: ${failed.map((f) => f.id).join(", ")}`);
if (REPORT) fs.writeFileSync(REPORT, JSON.stringify({ made: makes.filter((id) => hd[id]), reRender, failed }, null, 1));

if (!DRY) {
  const sorted = Object.entries(hd)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, e]) => {
      const files = filesOf(id, e, Boolean(peaks[id]));
      const missing = files.filter((f) => !fs.existsSync(f));
      if (missing.length) throw new Error(`${id}: ${missing.length} of its copies are missing (${path.relative(ROOT, missing[0])}): make it again, or take it out with -${id}`);
      return [id, { w: e.w, v: contentVersion(files), ...(e.still && { still: e.still }), ...(e.rest && { rest: e.rest }) }];
    });
  fs.writeFileSync(
    OUT_TS,
    `/**
 * Larger copies of preset covers (public/previews/presets/hd/<w>/): for a clip cover, the clip, its poster, its peak
 * frame and the frame its examples rest on (\`rest\`, that still's published URL) at each width in \`w\` (H.264; AVIF and
 * JPEG stills); for a still cover (\`still\`: its published width), the still. And AVIF stills at 320 px. \`v\` is the
 * content version every copy's URL ends in (?v=), so copies made again get new URLs. Read through src/lib/preset-hd.ts.
 * Generated by scripts/gen-preset-hd.mjs: run it again rather than editing.
 */
export const PRESET_HD: Record<string, { w: number[]; v: string; still?: number; rest?: string }> = {
${sorted.map(([id, e]) => `  ${JSON.stringify(id)}: ${JSON.stringify(e).replace(/,"/g, ', "').replace(/^\{/, "{ ").replace(/\}$/, " }")}`).join(",\n")}
};
`,
  );
  console.log(`wrote ${sorted.length} entries`);
}
