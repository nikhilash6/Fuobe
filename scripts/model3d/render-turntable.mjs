#!/usr/bin/env node
// Turntable video of a GLB, rendered with <model-viewer> in headless Chromium on SwiftShader (CPU only: it
// refuses to run on a GPU), composited on a soft studio backdrop and encoded to H.264 by ffmpeg. The Fuobe
// server runs this in a child process after an image-to-3D job (src/server/model3d-finish.ts).
//
//   node scripts/model3d/render-turntable.mjs --glb web.glb --out turntable.mp4 --poster poster.webp [options]
//
// Options (defaults in brackets):
//   --material auto      matte -> studio HDR (scripts/model3d/studio_small_08-1k.hdr, Poly Haven CC0), exposure 1.15;
//                        metal -> model-viewer's "neutral" environment, exposure 1.3 (chrome reads black in a studio HDR);
//                        mixed / unknown -> neutral, exposure 1.15
//   --frames 96 --fps 24 one turn = 96 frames = 4 s; the model turns on the turntable, the lights stay put
//   --width 1024 --height 768 --dpr 2   rendered at 2x and downscaled with Lanczos (supersampling)
//   --phi 75 --fov 20 --radius 130%     camera: 15 degrees above, long lens, a little room around the model
//   --chromium <exe>     default: $FUOBE_CHROMIUM or $CHROMIUM_PATH, else the newest Playwright Chromium (headless shell first)
//   --ffmpeg <exe>       default: $FFMPEG_PATH, else ffmpeg on the PATH
//
// Prints "frame i/N" after each frame, then one JSON line: { frames, fps, seconds, renderer, ms }. Exit code 3 = no
// Chromium / no ffmpeg (not an error in the model: the page falls back to recording a turntable in the browser).
// Every step has its own time limit (loading the model, each frame, the encode), so a stuck render fails in minutes.
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import sharp from "sharp";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const { values: a } = parseArgs({
  options: {
    glb: { type: "string" },
    out: { type: "string" },
    poster: { type: "string" },
    material: { type: "string", default: "auto" },
    frames: { type: "string", default: "96" },
    fps: { type: "string", default: "24" },
    width: { type: "string", default: "1024" },
    height: { type: "string", default: "768" },
    dpr: { type: "string", default: "2" },
    phi: { type: "string", default: "75" },
    fov: { type: "string", default: "20" },
    radius: { type: "string", default: "130%" },
    chromium: { type: "string" },
    ffmpeg: { type: "string" },
  },
});
if (!a.glb || !a.out) {
  console.error("usage: render-turntable.mjs --glb model.glb --out turntable.mp4 [--poster poster.webp] [options]");
  process.exit(2);
}
const unavailable = (msg) => {
  console.error(msg);
  process.exit(3);
};

// Run by the Fuobe server (src/server/model3d-finish.ts): stop when it goes away (its end of stdin closes) or
// stops us. process.exit runs Playwright's exit handler, which kills the browser; ffmpeg ends with its input.
if (process.env.FUOBE_PARENT_PIPE === "1") {
  process.stdin.on("end", () => process.exit(1));
  process.stdin.on("error", () => process.exit(1));
  process.stdin.resume();
  process.stdin.unref?.();
}
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => process.exit(1));

/** Fail a step that takes longer than `ms`. */
function limit(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`${what} took over ${Math.round(ms / 1000)} s`)), ms)));
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
const LOAD_MS = 120_000;
const FRAME_MS = 30_000;
const ENCODE_MS = 120_000;

/** Lighting by material class (see the header). */
const LOOK = {
  matte: { env: path.join(here, "studio_small_08-1k.hdr"), exposure: 1.15 },
  metal: { env: "neutral", exposure: 1.3 },
  mixed: { env: "neutral", exposure: 1.15 },
  unknown: { env: "neutral", exposure: 1.15 },
};
const look = LOOK[a.material] ?? LOOK.unknown;
const W = Number(a.width);
const H = Number(a.height);
const DPR = Number(a.dpr);
const FRAMES = Number(a.frames);
const FPS = Number(a.fps);

function findChromium() {
  // CHROMIUM_PATH is what the e2e checks (tests/e2e/_browser.mjs) read too.
  const given = a.chromium || process.env.FUOBE_CHROMIUM || process.env.CHROMIUM_PATH;
  if (given) return fs.existsSync(given) ? given : null;
  const bases = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    "/opt/pw-browsers",
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "ms-playwright"),
    path.join(os.homedir(), ".cache", "ms-playwright"),
    path.join(os.homedir(), "Library", "Caches", "ms-playwright"),
  ].filter(Boolean);
  const exes = [
    ["chrome-headless-shell-win64", "chrome-headless-shell.exe"],
    ["chrome-headless-shell-linux64", "chrome-headless-shell"],
    ["chrome-headless-shell-mac-arm64", "chrome-headless-shell"],
    ["chrome-headless-shell-mac-x64", "chrome-headless-shell"],
    ["chrome-win64", "chrome.exe"],
    ["chrome-win", "chrome.exe"],
    ["chrome-linux64", "chrome"],
    ["chrome-linux", "chrome"],
  ];
  for (const base of bases) {
    let dirs = [];
    try {
      dirs = fs.readdirSync(base);
    } catch {
      continue;
    }
    // Headless shell first (no window, no GPU process surprises), newest revision first.
    const rank = (d) => (d.startsWith("chromium_headless_shell-") ? 0 : 1);
    const rev = (d) => Number(d.split("-").pop()) || 0;
    dirs = dirs.filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d)).sort((x, y) => rank(x) - rank(y) || rev(y) - rev(x));
    for (const d of dirs) {
      for (const [sub, exe] of exes) {
        const p = path.join(base, d, sub, exe);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

const ffmpeg = a.ffmpeg || process.env.FFMPEG_PATH || "ffmpeg";
function run(cmd, args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: [input ? "pipe" : "ignore", "ignore", "pipe"], windowsHide: true });
    let err = "";
    p.stderr.on("data", (d) => (err = (err + d).slice(-4000)));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited ${code}: ${err.trim().split("\n").slice(-3).join(" | ")}`))));
    if (input) input(p.stdin);
  });
}
try {
  await run(ffmpeg, ["-hide_banner", "-version"]);
} catch {
  unavailable("ffmpeg not found (set FFMPEG_PATH)");
}
const chromiumExe = findChromium();
if (!chromiumExe) unavailable("no Chromium found (install one with `npx playwright-core install chromium-headless-shell`, or set FUOBE_CHROMIUM)");
const { chromium } = await import("playwright-core");

// The backdrop: a warm seamless sweep (centre #F3ECE3 falling to #D8CBBB at the corners), at render size.
async function backdrop(w, h) {
  const px = Buffer.alloc(w * h * 3);
  const cx = w / 2;
  const cy = h * (700 / 1536);
  const r = w * (1250 / 2048);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = Math.pow(Math.min(1, Math.hypot(x - cx, (y - cy) * 1.25) / r), 1.6);
      const i = (y * w + x) * 3;
      px[i] = 243 - 27 * t;
      px[i + 1] = 236 - 33 * t;
      px[i + 2] = 227 - 40 * t;
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

const mvFile = path.join(root, "node_modules", "@google", "model-viewer", "dist", "model-viewer.min.js");
const decoderFile = path.join(root, "public", "vendor", "meshopt_decoder.js");
const envIsFile = look.env !== "neutral";
const files = {
  "/mv.js": [mvFile, "text/javascript"],
  "/meshopt_decoder.js": [decoderFile, "text/javascript"],
  "/model.glb": [a.glb, "model/gltf-binary"],
  ...(envIsFile ? { "/env.hdr": [look.env, "application/octet-stream"] } : {}),
};
const attrs = {
  "environment-image": envIsFile ? "/env.hdr" : "neutral",
  exposure: String(look.exposure),
  "tone-mapping": "neutral",
  "shadow-intensity": "0.85",
  "shadow-softness": "0.9",
  // The default limits clamp what we ask for: min-field-of-view is 25deg and the max radius is the auto framing radius.
  "min-field-of-view": "5deg",
  "max-field-of-view": "90deg",
  "max-camera-orbit": "Infinity 180deg 1000%",
  "camera-orbit": `0deg ${a.phi}deg ${a.radius}`,
  "field-of-view": `${a.fov}deg`,
  "interaction-prompt": "none",
  "interpolation-decay": "1",
  loading: "eager",
  reveal: "auto",
};
const page = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;background:transparent;overflow:hidden}model-viewer{display:block;width:${W}px;height:${H}px;background:transparent;--poster-color:transparent;--progress-bar-height:0}</style>
</head><body><script type="module">
import '/mv.js';
const MV = customElements.get('model-viewer');
MV.minimumRenderScale = 1;
MV.meshoptDecoderLocation = '/meshopt_decoder.js';
const mv = document.createElement('model-viewer');
for (const [k, v] of Object.entries(${JSON.stringify(attrs)})) mv.setAttribute(k, v);
window.__ready = new Promise((resolve, reject) => {
  mv.addEventListener('load', () => resolve(true), { once: true });
  mv.addEventListener('error', (e) => reject(new Error('model-viewer: ' + JSON.stringify(e.detail))), { once: true });
});
mv.src = '/model.glb';
document.body.appendChild(mv);
window.__mv = mv;
</script></body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x").pathname;
  if (url === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(page);
  }
  const f = files[url];
  if (!f || !fs.existsSync(f[0])) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "content-type": f[1], "content-length": fs.statSync(f[0]).size });
  fs.createReadStream(f[0]).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const t0 = Date.now();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-turntable-"));
let browser;
try {
  const plate = path.join(tmp, "backdrop.png");
  fs.writeFileSync(plate, await backdrop(W * DPR, H * DPR));
  browser = await chromium.launch({
    executablePath: chromiumExe,
    headless: true,
    // CPU rendering: ANGLE on SwiftShader (WebGL on SwiftShader needs the explicit opt-in). Only this local page loads.
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--disable-gpu-compositing"],
  });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  const tab = await ctx.newPage();
  await tab.goto(origin + "/");
  const renderer = await tab.evaluate(() => {
    const c = document.createElement("canvas").getContext("webgl2");
    if (!c) return "no webgl2";
    const ext = c.getExtension("WEBGL_debug_renderer_info");
    return String(ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER));
  });
  if (!/swiftshader/i.test(renderer)) throw new Error(`not on SwiftShader (${renderer}); refusing to render on the GPU`);
  await tab.waitForFunction(() => window.__mv && window.__ready, null, { timeout: LOAD_MS });
  await limit(tab.evaluate(() => window.__ready), LOAD_MS, "loading the model");
  // Let the environment (PMREM) and the contact shadow settle.
  await limit(
    tab.evaluate(() => new Promise((r) => { let n = 0; const f = () => (++n >= 8 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); })),
    FRAME_MS,
    "the first frames",
  );

  // Frames go straight into ffmpeg (no temp PNGs): backdrop + frame, composited at 2x, then Lanczos to the output size.
  let feed;
  const fed = new Promise((resolve) => (feed = resolve));
  const encode = run(
    ffmpeg,
    [
      "-hide_banner", "-v", "error", "-y",
      "-loop", "1", "-framerate", String(FPS), "-i", plate,
      "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
      "-filter_complex", `[0:v][1:v]overlay=format=auto:shortest=1,scale=${W}:${H}:flags=lanczos,format=yuv420p`,
      "-frames:v", String(FRAMES), "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
      "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
      "-movflags", "+faststart", "-an", a.out,
    ],
    (stdin) => feed(stdin),
  );
  const stdin = await fed;
  stdin.on("error", () => {}); // ffmpeg failing shows up as the encode error below
  let first;
  for (let i = 0; i < FRAMES; i++) {
    const theta = (2 * Math.PI * i) / FRAMES;
    const b64 = await limit(tab.evaluate(async (th) => {
      const mv = window.__mv;
      mv.resetTurntableRotation(th);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
      const blob = await mv.toBlob({ mimeType: "image/png" });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let s = "";
      for (let k = 0; k < buf.length; k += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(k, k + 0x8000));
      return btoa(s);
    }, theta), FRAME_MS, `frame ${i + 1}`);
    const png = Buffer.from(b64, "base64");
    if (i === 0) first = png;
    if (!stdin.write(png)) await limit(new Promise((r) => stdin.once("drain", r)), FRAME_MS, "ffmpeg taking a frame");
    console.log(`frame ${i + 1}/${FRAMES}`);
  }
  stdin.end();
  await limit(encode, ENCODE_MS, "encoding the video");
  if (a.poster && first) {
    // The first frame (the photo's own angle) on the same backdrop.
    await sharp(plate)
      .composite([{ input: first }])
      .toBuffer()
      .then((b) => sharp(b).resize(W, H, { kernel: "lanczos3" }).webp({ quality: 88 }).toFile(a.poster));
  }
  console.log(JSON.stringify({ frames: FRAMES, fps: FPS, seconds: FRAMES / FPS, renderer, material: a.material, ms: Date.now() - t0 }));
} finally {
  await limit(browser?.close() ?? Promise.resolve(), 15_000, "closing the browser").catch(() => {});
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
