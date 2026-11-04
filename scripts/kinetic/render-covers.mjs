#!/usr/bin/env node
// Covers for Marketing's code-drawn templates, rendered by Kinetic Motion itself (no model, no GPU): each template
// plays its showcase (src/lib/motion/showcase.ts) at its own size, 1080 on the short side, 30 fps, through the same
// renderClip the Save button uses, on the development-only page /dev/kinetic-covers in the system Chrome (WebCodecs
// H.264). Each clip is written as a cover master, then versioned into the site like every other template tile:
//
//   node scripts/kinetic/render-covers.mjs <masters dir> [--url http://127.0.0.1:3540] [--only ms-kinetic-headline,…]
//   pnpm eval:covers --templates <masters dir>
//
// Without --url it starts `next dev` on 3540 (KINETIC_COVERS_PORT moves it) and stops it at the end. Writes
// <masters>/marketing/<id>/clip.mp4, poster.png (its last frame, full size: the tile's still) and meta.json { "rest": "end" }: the tile
// rests on the finished piece, with every word set ({ "rest": seconds } for a piece whose words give way to its logo:
// the moment they are all set).
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { values: a, positionals } = parseArgs({ allowPositionals: true, options: { url: { type: "string" }, only: { type: "string" }, chrome: { type: "string" } } });
const masters = positionals[0];
if (!masters) {
  console.error("usage: render-covers.mjs <masters dir> [--url http://127.0.0.1:3540] [--only id,id]");
  process.exit(2);
}
const only = a.only ? new Set(a.only.split(",").map((s) => s.trim())) : null;

function playwright() {
  const req = createRequire(path.join(root, "package.json"));
  for (const name of ["playwright-core", "playwright"]) {
    try {
      return req(name);
    } catch {}
  }
  throw new Error("playwright-core isn't installed");
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let server = null;
let base = a.url?.replace(/\/$/, "");
if (!base) {
  const port = Number(process.env.KINETIC_COVERS_PORT ?? 3540);
  base = `http://127.0.0.1:${port}`;
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-covers-"));
  server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "development", FUOBE_DATA_DIR: data, COMFYUI_URL: "http://127.0.0.1:9", OLLAMA_URL: "http://127.0.0.1:9" },
    stdio: "ignore",
  });
}
const stop = () => {
  if (!server) return;
  try {
    if (process.platform === "win32") execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
    else server.kill("SIGTERM");
  } catch {}
};
process.on("exit", stop);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));

let browser;
let failed = 0;
try {
  for (let i = 0; i < 240; i++) {
    try {
      const r = await fetch(`${base}/dev/kinetic-covers`);
      if (r.status === 200) break;
      if (r.status === 404) throw new Error(`${base}/dev/kinetic-covers isn't there (a production build has no covers page)`);
    } catch (e) {
      if (/isn't there/.test(e.message)) throw e;
    }
    await wait(1000);
  }
  browser = await playwright().chromium.launch(a.chrome ? { executablePath: a.chrome } : { channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.on("pageerror", (e) => console.error("page:", e.message));
  await page.goto(`${base}/dev/kinetic-covers`, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("[data-kinetic-ready]", { timeout: 240_000 });
  const list = await page.evaluate(() => window.__kinetic.showcases());
  for (const s of list) {
    if (only && !only.has(s.id)) continue;
    const dir = path.join(path.resolve(masters), "marketing", s.id);
    try {
      const r = await page.evaluate((recipe) => window.__kinetic.render(recipe), s.recipe);
      if (r.type !== "video/mp4") throw new Error(`made ${r.type}, not an MP4 (this Chrome has no H.264 encoder)`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "clip.mp4"), Buffer.from(r.clip, "base64"));
      fs.writeFileSync(path.join(dir, "poster.png"), Buffer.from(r.poster, "base64"));
      // The tile rests on the finished piece, or just before the event its showcase names (the headline, all set).
      let rest = "end";
      if (s.poster) {
        const { events } = await page.evaluate((recipe) => window.__kinetic.frames(recipe, []), s.recipe);
        const at = events.find((e) => e[0] === s.poster)?.[1];
        if (typeof at === "number") rest = Math.max(0, Math.round((at - 0.08) * 100) / 100);
      }
      fs.writeFileSync(path.join(dir, "meta.json"), `${JSON.stringify({ rest })}\n`);
      console.log(`${s.id}: ${r.w}x${r.h}, ${r.frames} frames, ${Math.round(r.ms)} ms`);
    } catch (e) {
      failed++;
      console.error(`${s.id}: ${e.message}`);
    }
  }
} finally {
  await browser?.close().catch(() => {});
  stop();
}
console.log(failed ? `${failed} failed` : `Masters in ${path.resolve(masters)}. Next: pnpm eval:covers --templates ${path.resolve(masters)}`);
process.exit(failed ? 1 : 0);
