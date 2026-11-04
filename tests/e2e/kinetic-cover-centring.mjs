// The Logo End Card's centred lines are drawn where they were measured, in the faces the browser really loaded: each of
// the five styles' rest frame, as the gallery cover (3:4 tile) and in the four sizes, at 1080 px and at 300 px wide.
// The product line, the call to action's label and the web address must each have their ink centred on the frame
// (within 3 px at 1080, 2 px at 300). A line measured in a fallback face and drawn in the real one lands off centre.
//
//   node tests/e2e/kinetic-cover-centring.mjs [--url http://127.0.0.1:3540]
//
// Without --url it starts `next dev` on 3540 (KINETIC_PORT moves it) with a throwaway data folder and stops it at the
// end. Uses the system Chrome.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { launch, root } from "./_browser.mjs";

const { values: a } = parseArgs({ options: { url: { type: "string" } } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let server = null;
let base = a.url?.replace(/\/$/, "");
if (!base) {
  const port = Number(process.env.KINETIC_PORT ?? 3540);
  base = `http://127.0.0.1:${port}`;
  const data = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-centring-"));
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

const failures = [];
let browser;
try {
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(`${base}/dev/kinetic-covers`)).status === 200) break;
    } catch {}
    await wait(1000);
  }
  browser = await launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));
  await page.goto(`${base}/dev/kinetic-covers`, { waitUntil: "load", timeout: 240_000 });
  await page.waitForSelector("[data-kinetic-ready]", { timeout: 240_000 });
  const card = (await page.evaluate(() => window.__kinetic.showcases())).find((s) => s.id === "ms-end-card");
  if (!card) throw new Error("no Logo End Card showcase");
  let checked = 0;
  for (const style of ["draw-on", "rise", "iris", "split", "glint"]) {
    for (const size of ["cover", "9:16", "4:5", "1:1", "16:9"]) {
      const controls = { ...card.recipe.controls, style };
      if (size !== "cover") delete controls.cover;
      const recipe = { ...card.recipe, scene: `end-card/${style}`, controls, ...(size !== "cover" && { size }) };
      const rows = await page.evaluate(([r]) => window.__kinetic.centring(r, [1080, 300], ["product", "cta", "website"]), [recipe]);
      for (const row of rows) {
        const off = Math.abs(row.ink - row.frame);
        const ok = off <= (row.width >= 1000 ? 3 : 2);
        checked++;
        if (!ok) failures.push(`${style} ${size} ${row.width}px ${row.field}: ink centre ${row.ink.toFixed(1)} vs ${row.frame} (${off.toFixed(1)} px off)`);
      }
    }
  }
  console.log(`${checked} centred lines checked`);
  if (checked < 100) failures.push(`only ${checked} lines checked`);
} catch (e) {
  failures.push(String(e?.stack ?? e));
} finally {
  await browser?.close();
  stop();
}
for (const f of failures) console.log(`FAIL ${f}`);
console.log(failures.length ? `${failures.length} failed` : "all centred");
process.exit(failures.length ? 1 : 0);
