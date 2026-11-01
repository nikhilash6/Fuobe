#!/usr/bin/env node
/**
 * Makes Clean up voice's demo pairs (public/samples/clean-voice/) with the final ComfyUI-RE-USE pack, on a ComfyUI that
 * you name (it never guesses one): NVIDIA's sample at its own rate, and the same speech as an 8 kHz phone line restored
 * to 48 kHz. Needs ffmpeg on PATH for the AAC files.
 *
 *   node scripts/gen-clean-voice-demo.mjs --comfy http://127.0.0.1:8190 --sample path/to/mic_test2.wav [--out public/samples/clean-voice]
 *   node scripts/gen-clean-voice-demo.mjs --from <folder> [--out <folder>]
 *
 * --from takes pairs already made (noisy-mic-before.wav, noisy-mic-after.wav, phone-before.wav, phone-after.wav) and only
 * finishes them. Finishing a pair: the lead-in before the first word is cut to 0.2 s (found on the clean side, whose
 * gaps are silent), and both sides get the same gain, to about -18 LUFS on the louder one, so their levels still match.
 *
 * A person listens to the pairs before they ship (noise and the whine gone, no robotic sound, no seams, the phone pair
 * fuller and not harsh), then sets DEMO_READY in src/lib/av/clean-voice.ts.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const comfy = args.comfy?.replace(/\/$/, '');
if (!args.from && (!comfy || !args.sample)) {
  console.error('Usage: node scripts/gen-clean-voice-demo.mjs --comfy <ComfyUI URL> --sample <mic_test2.wav> [--out <folder>]\n       node scripts/gen-clean-voice-demo.mjs --from <folder with the four WAVs> [--out <folder>]');
  process.exit(2);
}
const out = path.resolve(args.out ?? path.join(HERE, '..', 'public', 'samples', 'clean-voice'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clean-voice-demo-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ffmpeg = (...a) => execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', ...a]);
/** ffmpeg's report (stderr) for an analysis pass. */
const analyse = (file, filter) => spawnSync('ffmpeg', ['-nostdin', '-hide_banner', '-i', file, '-af', filter, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;

const LEAD_IN = 0.2;
const TARGET_LUFS = -18;

async function upload(file) {
  const form = new FormData();
  form.append('image', new Blob([fs.readFileSync(file)]), path.basename(file));
  form.append('type', 'input');
  form.append('overwrite', 'true');
  const r = await fetch(`${comfy}/upload/image`, { method: 'POST', body: form });
  if (!r.ok) throw new Error(`upload ${r.status}`);
  return (await r.json()).name;
}

/** One clean on the ComfyUI: the FLAC it saved, written to `dest`. */
async function clean(input, rate, dest) {
  const graph = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'workflows', 'comfyui', 'voice-clean-reuse.json'), 'utf8'));
  graph['1'].inputs.audio = await upload(input);
  graph['3'].inputs.rate = rate;
  graph['4'].inputs.filename_prefix = 'fuobe/clean-voice-demo';
  const r = await fetch(`${comfy}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph }) });
  if (!r.ok) throw new Error(`prompt ${r.status}: ${await r.text()}`);
  const { prompt_id: id } = await r.json();
  for (;;) {
    await sleep(1000);
    const h = (await (await fetch(`${comfy}/history/${id}`)).json())[id];
    if (!h) continue;
    if (h.status?.status_str === 'error') throw new Error(JSON.stringify(h.status.messages ?? h.status));
    const f = h.outputs?.['4']?.audio?.[0];
    if (!f) continue;
    console.log('report', h.outputs['5']?.text?.[0]);
    const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder ?? '', type: f.type });
    fs.writeFileSync(dest, Buffer.from(await (await fetch(`${comfy}/view?${q}`)).arrayBuffer()));
    return;
  }
}

/** Seconds before the first word: where the clean side's first silence (under -50 dB, 0.3 s or more) at the start ends. */
function speechStart(cleanFile) {
  const log = analyse(cleanFile, 'silencedetect=noise=-50dB:d=0.3');
  const first = /silence_start: (-?[\d.]+)[\s\S]*?silence_end: ([\d.]+)/.exec(log);
  return first && Number(first[1]) <= 0.05 ? Number(first[2]) : 0;
}

/** Integrated loudness (LUFS) of a file. */
function loudness(file) {
  const m = /I:\s+(-?[\d.]+) LUFS/.exec(analyse(file, 'ebur128=framelog=quiet'));
  return m ? Number(m[1]) : NaN;
}

/** A pair, finished: the same cut and the same gain on both sides, as AAC-LC 192 kb/s. */
function finish(name, before, after) {
  const start = Math.max(0, speechStart(after) - LEAD_IN);
  const cut = (src, dest) => ffmpeg('-ss', start.toFixed(3), '-i', src, '-c:a', 'pcm_f32le', dest);
  const b = path.join(tmp, `${name}-before-cut.wav`);
  const a = path.join(tmp, `${name}-after-cut.wav`);
  cut(before, b);
  cut(after, a);
  const loudest = Math.max(loudness(b), loudness(a));
  const gain = Number.isFinite(loudest) ? TARGET_LUFS - loudest : 0;
  for (const [src, side] of [[b, 'before'], [a, 'after']]) {
    ffmpeg('-i', src, '-af', `volume=${gain.toFixed(2)}dB,alimiter=limit=0.89:level=false`, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', path.join(out, `${name}-${side}.m4a`));
  }
  console.log(`${name}: cut ${start.toFixed(2)} s of lead-in, gain ${gain.toFixed(1)} dB on both sides`);
}

fs.mkdirSync(out, { recursive: true });
const src = args.from ? path.resolve(args.from) : tmp;
if (!args.from) {
  const phone = path.join(tmp, 'phone-before.wav');
  ffmpeg('-i', args.sample, '-ac', '1', '-ar', '8000', phone);
  ffmpeg('-i', args.sample, path.join(tmp, 'noisy-mic-before.wav'));
  await clean(args.sample, 'source', path.join(tmp, 'noisy-mic-after.flac'));
  await clean(phone, '48000', path.join(tmp, 'phone-after.flac'));
  ffmpeg('-i', path.join(tmp, 'noisy-mic-after.flac'), path.join(tmp, 'noisy-mic-after.wav'));
  ffmpeg('-i', path.join(tmp, 'phone-after.flac'), path.join(tmp, 'phone-after.wav'));
}
finish('noisy-mic', path.join(src, 'noisy-mic-before.wav'), path.join(src, 'noisy-mic-after.wav'));
finish('phone', path.join(src, 'phone-before.wav'), path.join(src, 'phone-after.wav'));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Wrote the demo pairs to ${out}. Listen to them before they ship.`);
