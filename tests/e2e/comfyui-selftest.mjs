// End-to-end check of the open-source engine against a live ComfyUI.
// Usage: node tests/e2e/comfyui-selftest.mjs [appUrl]   (app must be running, ComfyUI reachable)
// Runs the weight-free workflows through Fuobe's own API (/api/uploads → POST /api/generations → poll →
// download the stored output): the self-tests, then the round-3 video tools on a clip the engine makes
// itself — add a soundtrack (one track, then voice + background), a VHS meta-batch pass, trim, cut a resampled segment and burn
// in captions. With ffprobe/ffmpeg on PATH every output is probed (streams, duration, frames, size) and the
// captioned frames are compared with the source frames; then a real-sized clip (600 frames, 640x360 @ 30 fps, with
// sound, made by ffmpeg) goes through mux, mix, captions and trim while the ComfyUI process's RSS is sampled
// (local server only: COMFYUI_PID, else the "main.py --port <port>" process found with pgrep; COMFYUI_PORT, default 8188).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { tempDir, removeDir } from "./_temp.mjs";

const app = process.argv[2] ?? "http://localhost:3000";
const tmp = tempDir("fuobe-selftest-");
const hasFfprobe = spawnSync("ffprobe", ["-version"]).status === 0;
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
if (!hasFfprobe) console.warn("! ffprobe not found: outputs are checked for kind and size only");

/** The local ComfyUI process, to watch its memory (null when it isn't on this machine). */
function comfyPid() {
  if (process.env.COMFYUI_PID) return Number(process.env.COMFYUI_PID);
  const r = spawnSync("pgrep", ["-f", `main.py.*--port ${process.env.COMFYUI_PORT ?? "8188"}`], { encoding: "utf8" });
  const pid = Number(r.stdout?.split("\n")[0]);
  return pid && fs.existsSync(`/proc/${pid}/status`) ? pid : null;
}
const rssOf = (pid) => Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${pid}/status`, "utf8"))?.[1] ?? 0) * 1024;
/** Run fn while sampling the ComfyUI process's RSS; returns fn's result and the peak growth in GB. */
async function watchMemory(fn) {
  const pid = comfyPid();
  if (!pid) return { result: await fn(), peakGb: null };
  const base = rssOf(pid);
  let peak = base;
  const timer = setInterval(() => {
    try {
      peak = Math.max(peak, rssOf(pid));
    } catch {}
  }, 50);
  try {
    return { result: await fn(), peakGb: (peak - base) / 2 ** 30 };
  } finally {
    clearInterval(timer);
  }
}

function png(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = [0];
    for (let x = 0; x < w; x++) row.push((x * 255) / w, (y * 255) / h, 160);
    rows.push(Buffer.from(row));
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Mono 16-bit PCM WAV with a sine tone. */
function wav(seconds, freq, rate = 22050) {
  const n = Math.round(seconds * rate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 0.3 * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

async function upload(buf, type, name) {
  const form = new FormData();
  form.append("file", new Blob([buf], { type }), name);
  const res = await fetch(`${app}/api/uploads`, { method: "POST", body: form });
  const up = await res.json();
  if (!res.ok) throw new Error(`upload ${name}: ${up.error}`);
  return up.url;
}

/** One generation through Fuobe's API; returns its outputs with the downloaded files. */
async function generate(label, body, expectKinds) {
  const res = await fetch(`${app}/api/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feature: "selftest", ...body }),
  });
  const created = await res.json();
  if (!res.ok) throw new Error(`${label}: ${created.error}`);
  const id = created.items[0].id;
  const t0 = Date.now();
  for (;;) {
    const g = await (await fetch(`${app}/api/generations/${id}`)).json();
    if (g.status === "succeeded") {
      if (g.provider !== "comfyui") throw new Error(`${label} ran on ${g.provider}, not ComfyUI (is ComfyUI reachable from the app?)`);
      const kinds = g.outputs.map((o) => o.kind);
      if (JSON.stringify(kinds) !== JSON.stringify(expectKinds)) throw new Error(`${label}: outputs ${JSON.stringify(kinds)}, expected ${JSON.stringify(expectKinds)}`);
      const files = [];
      for (const [i, out] of g.outputs.entries()) {
        const file = await fetch(`${app}${out.url}`);
        const bytes = Buffer.from(await file.arrayBuffer());
        if (!bytes.length) throw new Error(`${label}: output ${i} is empty`);
        const local = path.join(tmp, `${label}-${i}${path.extname(new URL(out.url, app).pathname) || ""}`);
        fs.writeFileSync(local, bytes);
        files.push({ ...out, local, bytes: bytes.length, contentType: file.headers.get("content-type") });
      }
      console.log(`✓ ${label} (${body.modelId}): ${files.map((f) => `${f.kind} ${f.contentType} ${f.bytes} B`).join(", ")} in ${Date.now() - t0} ms`);
      return { generation: g, files };
    }
    if (g.status === "failed" || g.status === "canceled") throw new Error(`${label}: ${g.status} — ${g.error}`);
    if (Date.now() - t0 > 300_000) throw new Error(`${label}: timed out (${g.status} ${g.message ?? ""})`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

function probe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,nb_read_frames,duration:format=duration", "-of", "json", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe ${file}: ${r.stderr}`);
  const j = JSON.parse(r.stdout);
  const v = j.streams.find((s) => s.codec_type === "video");
  const a = j.streams.find((s) => s.codec_type === "audio");
  const [num, den] = (v?.r_frame_rate ?? "0/1").split("/").map(Number);
  return {
    duration: Number(j.format?.duration ?? v?.duration ?? 0),
    video: v ? { codec: v.codec_name, width: v.width, height: v.height, fps: num / (den || 1), frames: Number(v.nb_read_frames) } : null,
    audio: a ? { codec: a.codec_name, duration: Number(a.duration ?? 0) } : null,
  };
}

function expectProbe(label, p, want) {
  const problems = [];
  if (want.audio !== undefined && !!p.audio !== want.audio) problems.push(`audio ${p.audio ? "present" : "missing"}`);
  if (want.frames !== undefined && p.video?.frames !== want.frames) problems.push(`${p.video?.frames} frames, expected ${want.frames}`);
  if (want.fps !== undefined && Math.abs((p.video?.fps ?? 0) - want.fps) > 0.01) problems.push(`${p.video?.fps} fps, expected ${want.fps}`);
  if (want.size && (p.video?.width !== want.size[0] || p.video?.height !== want.size[1])) problems.push(`${p.video?.width}x${p.video?.height}, expected ${want.size.join("x")}`);
  if (want.duration !== undefined && Math.abs(p.duration - want.duration) > (want.tolerance ?? 0.15)) problems.push(`${p.duration.toFixed(3)} s, expected ${want.duration} s`);
  if (problems.length) throw new Error(`${label}: ${problems.join("; ")} — ${JSON.stringify(p)}`);
  console.log(`  ffprobe ${label}: ${p.video ? `${p.video.codec} ${p.video.width}x${p.video.height} ${p.video.fps} fps ${p.video.frames} frames` : "no video"}, ${p.audio ? `${p.audio.codec} audio` : "no audio"}, ${p.duration.toFixed(2)} s`);
}

/** Gray pixels of the frame at `t` seconds. */
function frameAt(file, t) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"]);
  if (r.status !== 0) throw new Error(`ffmpeg frame ${file}@${t}: ${r.stderr}`);
  return r.stdout;
}
const changedPixels = (a, b) => a.reduce((n, v, i) => n + (Math.abs(v - b[i]) > 48 ? 1 : 0), 0);

async function selftests() {
  const image = await upload(png(64, 48), "image/png", "selftest.png");
  await generate("selftest-image", { modelId: "oss-selftest-image", op: "edit", prompt: "self-test", inputs: { images: [image] } }, ["image"]);
  await generate("selftest-video", { modelId: "oss-selftest-video", op: "i2v", prompt: "self-test", inputs: { images: [image] } }, ["video"]);
}

async function videoTools() {
  // A 3 s clip (24 frames @ 8 fps, 320x240, silent) made by the engine, plus two soundtracks.
  const still = await upload(png(320, 240), "image/png", "clip-still.png");
  const clip = (await generate("source-clip", { modelId: "oss-selftest-video", op: "i2v", prompt: "self-test", inputs: { images: [still] } }, ["video"])).files[0];
  const voice = await upload(wav(2.5, 440), "audio/wav", "voice.wav");
  const music = await upload(wav(3.5, 220), "audio/wav", "music.wav");
  if (hasFfprobe) expectProbe("source clip", probe(clip.local), { frames: 24, fps: 8, size: [320, 240], audio: false });

  const muxed = (await generate("mux", { modelId: "oss-mux", op: "mux", inputs: { video: clip.url, audio: voice } }, ["video"])).files[0];
  if (hasFfprobe) expectProbe("mux (one track)", probe(muxed.local), { frames: 24, fps: 8, size: [320, 240], audio: true });

  const mixed = (await generate("mux-mix", { modelId: "oss-mux", op: "mux", inputs: { video: clip.url, audio: voice }, params: { extra: { audio2: music, backgroundVolumeDb: -12 } } }, ["video"])).files[0];
  if (hasFfprobe) expectProbe("mux (voice + background)", probe(mixed.local), { frames: 24, fps: 8, audio: true });

  // VHS meta-batching (Mixed Media): three re-queued passes of 8 frames, collected from the last one.
  const passes = (await generate("meta-batch", { modelId: "oss-selftest-meta-batch", op: "v2v", prompt: "self-test", inputs: { video: muxed.url } }, ["video"])).files[0];
  if (hasFfprobe) expectProbe("meta-batch (3 passes)", probe(passes.local), { frames: 24, fps: 8, size: [320, 240], audio: true });

  const trimmed = (await generate("trim", { modelId: "oss-trim", op: "trim", inputs: { video: muxed.url }, params: { startTime: 0.5, endTime: 2 } }, ["video"])).files[0];
  if (hasFfprobe) expectProbe("trim 0.5-2.0 s", probe(trimmed.local), { frames: 12, fps: 8, size: [320, 240], audio: true, duration: 1.5 });

  const seg = await generate(
    "segment",
    { modelId: "oss-segment", op: "trim", inputs: { video: muxed.url }, params: { startTime: 1, endTime: 2, fps: 4, aspectRatio: "1:1", resolution: "480p" } },
    ["video", "image"],
  );
  if (hasFfprobe) expectProbe("segment 1-2 s @ 4 fps, 1:1", probe(seg.files[0].local), { frames: 5, fps: 4, size: [480, 480], audio: true });

  const cues = "0.00-1.00: Hello from Fuobe\n1.50-2.50: Open captions";
  const captioned = (await generate("captions", { modelId: "oss-captions-burnin", op: "captions", prompt: cues, inputs: { video: muxed.url }, params: { extra: { fontSize: 9 } } }, ["video"])).files[0];
  if (hasFfprobe) {
    expectProbe("captions burn-in", probe(captioned.local), { frames: 24, fps: 8, size: [320, 240], audio: true, duration: 3, tolerance: 0.2 });
    const during = changedPixels(frameAt(captioned.local, 0.5), frameAt(muxed.local, 0.5));
    const gap = changedPixels(frameAt(captioned.local, 1.25), frameAt(muxed.local, 1.25));
    if (during < 200 || gap > 50) throw new Error(`captions: ${during} pixels changed under a cue, ${gap} in the gap`);
    console.log(`  captions visible: ${during} pixels changed at 0.5 s (cue), ${gap} at 1.25 s (gap)`);
  }
}

/** A real-sized clip through the memory-sensitive tools: picture stream-copied (mux), chunked burn-in (captions). */
async function realClip() {
  if (!hasFfmpeg || !hasFfprobe) {
    console.warn("! ffmpeg/ffprobe not found: skipping the 600-frame clip");
    return;
  }
  const src = path.join(tmp, "real.mp4");
  const made = spawnSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=44100", "-t", "20", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src]);
  if (made.status !== 0) throw new Error(`ffmpeg: ${made.stderr}`);
  const clip = await upload(fs.readFileSync(src), "video/mp4", "real.mp4");
  const voice = await upload(wav(12, 550), "audio/wav", "real-voice.wav");
  const bed = await upload(wav(20, 220), "audio/wav", "real-bed.wav");
  const report = (label, gb) => console.log(`  ${label}: ComfyUI RSS ${gb === null ? "not sampled (remote server)" : `+${gb.toFixed(2)} GB at peak`}`);

  const one = await watchMemory(() => generate("real mux", { modelId: "oss-mux", op: "mux", inputs: { video: clip, audio: voice } }, ["video"]));
  expectProbe("real mux (one track)", probe(one.result.files[0].local), { frames: 600, fps: 30, size: [640, 360], audio: true, duration: 20, tolerance: 0.1 });
  report("mux, 600 frames", one.peakGb);

  const mix = await watchMemory(() => generate("real mix", { modelId: "oss-mux", op: "mux", inputs: { video: clip, audio: voice }, params: { extra: { audio2: bed, backgroundVolumeDb: -12 } } }, ["video"]));
  const mixed = probe(mix.result.files[0].local);
  expectProbe("real mux (voice over a 20 s bed)", mixed, { frames: 600, fps: 30, audio: true, duration: 20, tolerance: 0.1 });
  if (mixed.audio.duration < 19.5) throw new Error(`real mix: the soundtrack stops at ${mixed.audio.duration} s (the 12 s voice cut the bed short)`);
  report("mix, 600 frames", mix.peakGb);

  // Captions over most of the clip: 9 cues of 1.8 s with 0.2 s gaps, the last 2 s uncaptioned.
  const cues = Array.from({ length: 9 }, (_, i) => `${(i * 2).toFixed(2)}-${(i * 2 + 1.8).toFixed(2)}: Caption number ${i + 1}`).join("\n");
  const cap = await watchMemory(() => generate("real captions", { modelId: "oss-captions-burnin", op: "captions", prompt: cues, inputs: { video: clip } }, ["video"]));
  const captioned = cap.result.files[0].local;
  expectProbe("real captions", probe(captioned), { frames: 600, fps: 30, size: [640, 360], audio: true, duration: 20, tolerance: 0.1 });
  const under = changedPixels(frameAt(captioned, 5.0), frameAt(src, 5.0));
  const gap = changedPixels(frameAt(captioned, 5.9), frameAt(src, 5.9));
  const after = changedPixels(frameAt(captioned, 19), frameAt(src, 19));
  if (under < 200 || gap > 400 || after > 400) throw new Error(`real captions: ${under} pixels changed under a cue, ${gap} in a gap, ${after} after the last cue`);
  console.log(`  captions visible: ${under} pixels changed at 5.0 s (cue), ${gap} at 5.9 s (gap), ${after} at 19 s (after the last cue)`);
  report("captions, 600 frames", cap.peakGb);

  const cut = await watchMemory(() => generate("real trim", { modelId: "oss-trim", op: "trim", inputs: { video: clip }, params: { startTime: 4, endTime: 14 } }, ["video"]));
  expectProbe("real trim 4-14 s", probe(cut.result.files[0].local), { fps: 30, size: [640, 360], audio: true, duration: 10, tolerance: 0.1 });
  report("trim, 300 frames", cut.peakGb);
}

try {
  await selftests();
  await videoTools();
  await realClip();
  console.log("ComfyUI engine OK");
} finally {
  removeDir(tmp);
}
