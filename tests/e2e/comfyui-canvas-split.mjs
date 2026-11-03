// The Canvas Split soundtrack node on the open engine, end to end against a live ComfyUI with ComfyUI-DBS (DBS D8).
// Usage: node tests/e2e/comfyui-canvas-split.mjs [appUrl]   (app running with ComfyUI reachable; no cloud keys needed)
// A 12 s clip made here with ffmpeg (a chord, a voice-like warble and noise bursts) goes into a board:
//   Video → Split soundtrack (DBS, CPU) → Music & effects → Add soundtrack (stream-copy mux, CPU) with the same video,
//   and Dialogue → Qwen3-ASR (needs its weights: planned, not run here).
// The run is for the mux (so the split runs first); the split must make four stems tagged voice / music / effects /
// background, and the mux's clip must carry the Music & effects stem's sound (the picture copied as it was).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const app = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-canvas-split-"));
for (const tool of ["ffprobe", "ffmpeg"]) if (spawnSync(tool, ["-version"]).status !== 0) throw new Error(`${tool} is needed on PATH`);

function clip() {
  const file = path.join(tmp, "scene.mp4");
  const sound =
    "aevalsrc='0.15*sin(2*PI*220*t)+0.12*sin(2*PI*277*t)+0.1*sin(2*PI*330*t)+0.3*sin(2*PI*(140+40*sin(2*PI*3*t))*t)*(0.5+0.5*sin(2*PI*4*t))*between(mod(t,3),0,1.8)+0.2*(random(0)-0.5)*between(mod(t,2.5),2,2.3)':s=44100:d=12";
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=24:duration=12", "-f", "lavfi", "-i", sound, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg: ${r.stderr}`);
  return file;
}

async function upload(file) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)], { type: "video/mp4" }), path.basename(file));
  const res = await fetch(`${app}/api/uploads`, { method: "POST", body: form });
  const up = await res.json();
  if (!res.ok) throw new Error(`upload: ${up.error}`);
  return up.url;
}

const json = async (p, init) => {
  const res = await fetch(app + p, { headers: { "Content-Type": "application/json" }, ...init });
  const body = await res.json();
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${p}: ${body.error}`);
  return body;
};

async function download(url, name) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, Buffer.from(await (await fetch(app + url)).arrayBuffer()));
  return file;
}

/** The sound of a file as mono float samples at 44.1 kHz. */
function samples(file) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "44100", "-f", "f32le", "-"], { maxBuffer: 256 * 2 ** 20 });
  if (r.status !== 0) throw new Error(`ffmpeg audio ${file}: ${r.stderr}`);
  return new Float32Array(r.stdout.buffer.slice(r.stdout.byteOffset, r.stdout.byteOffset + r.stdout.length));
}

const rms = (s) => 10 * Math.log10(s.reduce((a, x) => a + x * x, 0) / Math.max(1, s.length) + 1e-12);

/** Correlation of two signals over their common length. */
function corr(a, b) {
  const n = Math.min(a.length, b.length);
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return ab / Math.sqrt(aa * bb + 1e-12);
}

function check(label, cond, detail) {
  if (!cond) throw new Error(`${label}: ${detail}`);
  console.log(`  ${label}: ${detail}`);
}

async function done(id, label) {
  const t0 = Date.now();
  for (;;) {
    const g = await json(`/api/generations/${id}`);
    if (g.status === "succeeded") return { g, ms: Date.now() - t0 };
    if (g.status === "failed" || g.status === "canceled") throw new Error(`${label}: ${g.status} — ${g.error}`);
    if (Date.now() - t0 > 900_000) throw new Error(`${label}: timed out (${g.status} ${g.message ?? ""})`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

try {
  const url = await upload(clip());
  const n = (id, type, data, x, y) => ({ id, type, position: { x, y }, data });
  const graph = {
    nodes: [
      n("clip", "video-input", { url, label: "Scene" }, 0, 0),
      n("split", "split-soundtrack", { modelId: "oss-dbs-separate", params: { extra: { separationModel: "DBS-BSRNN-DnR" } } }, 400, 0),
      n("asr", "model", { modelId: "oss-qwen3-asr", mediaKind: "text" }, 800, 0),
      n("mux", "model", { modelId: "oss-mux", mediaKind: "video", op: "mux" }, 800, 400),
      n("out", "output", {}, 1200, 0),
    ],
    edges: [
      { id: "e1", source: "clip", sourceHandle: "out", target: "split", targetHandle: "video" },
      { id: "e2", source: "split", sourceHandle: "out", target: "asr", targetHandle: "audio" },
      { id: "e3", source: "split", sourceHandle: "background", target: "mux", targetHandle: "audio" },
      { id: "e4", source: "clip", sourceHandle: "out", target: "mux", targetHandle: "video" },
      { id: "e5", source: "split", sourceHandle: "music", target: "out", targetHandle: "in" },
    ],
  };
  const canvas = await json("/api/canvases", { method: "POST", body: JSON.stringify({ name: "Split soundtrack live check", graph }) });
  const saved = canvas.pages?.[0]?.graph ?? canvas.graph;
  check("saved with every stem edge", saved.edges.length === 5, saved.edges.map((e) => `${e.source}:${e.sourceHandle}→${e.target}:${e.targetHandle}`).join(", "));
  const run = await json(`/api/canvases/${canvas.id}/run`, { method: "POST", body: JSON.stringify({ targets: ["mux"] }) });
  check("split then mux", run.ran.join(",") === "split,mux", `${run.items.map((g) => `${g.modelId}`).join(" → ")}; price ${run.costUsd}`);
  const split = await done(run.canvas.runs.split.ids[0], "split");
  check("on ComfyUI", split.g.provider === "comfyui", `${split.g.modelId} on ${split.g.provider} in ${(split.ms / 1000).toFixed(1)} s`);
  const stems = split.g.outputs.filter((o) => o.kind === "audio");
  check("four stems", ["voice", "music", "effects", "background"].every((s) => stems.some((o) => o.meta?.stem === s)), stems.map((o) => o.meta?.stem).join(", "));
  const files = {};
  for (const o of stems) files[o.meta.stem] = samples(await download(o.url, `${o.meta.stem}.flac`));
  for (const [s, x] of Object.entries(files)) console.log(`    ${s}: ${(x.length / 44100).toFixed(2)} s, ${rms(x).toFixed(1)} dB`);
  const mux = await done(run.canvas.runs.mux.ids[0], "mux");
  const video = mux.g.outputs.find((o) => o.kind === "video");
  const muxed = samples(await download(video.url, "muxed.mp4"));
  const withBed = corr(muxed, files.background);
  const withVoice = corr(muxed, files.voice);
  check("the clip carries Music & effects", withBed > 0.9 && withBed > withVoice, `correlation with Music & effects ${withBed.toFixed(3)}, with Dialogue ${withVoice.toFixed(3)}`);
  const asr = await json(`/api/canvases/${canvas.id}`);
  check("Transcribe not run (plan only)", !asr.runs?.asr, "Dialogue → Qwen3-ASR stays planned");
  console.log(`\nThe Canvas Split soundtrack node works end to end on the open engine (files in ${tmp}).`);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exitCode = 1;
}
