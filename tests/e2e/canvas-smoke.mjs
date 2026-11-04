// Canvas editor smoke test: the save and run state machine, in a real browser.
// Usage: node tests/e2e/canvas-smoke.mjs [appUrl] [--perf=60]
//   (app must be running in demo mode: no keys, COMFYUI_URL pointing nowhere). Exits 1 on any failure.
//
// Checks:
//   1. An edit followed at once by an in-app link (the debounce hasn't fired) reaches the server.
//   2. Renaming a canvas and then back to its first name is saved.
//   3. A result moved to the Trash from the Viewer leaves its node, and Run all makes it again.
//   4. --perf=N: a board of N nodes (prompt → image → video chains) loads, and typing in one prompt
//      repaints within budget (prints keystroke → paint times; fails above 50 ms on average).
//
// Playwright: the `playwright` (or `playwright-core`) package if it resolves, else the global install
// at /opt/node22/lib/node_modules. Chromium: $CHROMIUM_PATH, else the newest /opt/pw-browsers/chromium-*.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const app = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const perf = Number(args.find((a) => a.startsWith("--perf="))?.slice(7) ?? 0);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function loadPlaywright() {
  for (const from of [path.join(root, "package.json"), "/opt/node22/lib/node_modules/"]) {
    const req = createRequire(from);
    for (const name of ["playwright", "playwright-core"]) {
      try {
        return req(name);
      } catch {}
    }
  }
  throw new Error("Playwright not found: install playwright-core or run where the global install exists");
}

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const dir = "/opt/pw-browsers";
  if (!fs.existsSync(dir)) return undefined;
  const newest = fs
    .readdirSync(dir)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0];
  const exe = newest && path.join(dir, newest, "chrome-linux/chrome");
  return exe && fs.existsSync(exe) ? exe : undefined;
}

const api = async (p, init) => (await fetch(app + p, { headers: { "Content-Type": "application/json" }, ...init })).json();
const failures = [];
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(label);
};

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: chromiumPath() });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on("pageerror", (e) => failures.push(`page error: ${e.message}`));

try {
  // 1. Edit, then leave through the back link before the autosave debounce fires.
  const c = await api("/api/canvases", { method: "POST", body: JSON.stringify({ name: "Smoke test" }) });
  await page.goto(`${app}/canvas/${c.id}`, { waitUntil: "load" });
  await page.getByRole("button", { name: /Start with Text → Image/ }).click();
  const prompt = page.locator('[data-testid^="canvas-node-prompt-"] textarea');
  await prompt.waitFor();
  await prompt.fill("A paper boat on a canal");
  await page.getByRole("link", { name: "All canvases" }).click();
  await page.waitForURL(/\/canvas$/);
  await page.waitForTimeout(800);
  const saved = await api(`/api/canvases/${c.id}`);
  check("an edit made just before leaving is saved", saved.canvas.pages[0].graph.nodes.find((n) => n.type === "prompt")?.data.text === "A paper boat on a canal");

  // 2. Rename, then back.
  await page.goto(`${app}/canvas/${c.id}`, { waitUntil: "load" });
  const name = page.getByRole("textbox", { name: "Canvas name" });
  await name.fill("Renamed once");
  await name.press("Enter");
  await page.waitForTimeout(500);
  await name.fill("Smoke test");
  await name.press("Enter");
  await page.waitForTimeout(600);
  check("renaming back to the first name is saved", (await api(`/api/canvases/${c.id}`)).canvas.name === "Smoke test");

  // 3. Run, trash the result from the Viewer, run again.
  const image = page.locator('[data-testid^="canvas-node-model-"]').first();
  await page.getByRole("button", { name: "Run all", exact: true }).click();
  const thumb = image.locator('button[aria-label="Open result"]').first();
  await thumb.waitFor({ timeout: 60_000 });
  await thumb.click();
  const viewer = page.getByRole("dialog");
  await viewer.waitFor();
  await viewer.getByRole("button", { name: /delete|trash/i }).first().click();
  await page.waitForTimeout(600);
  if (await viewer.count()) await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  check("a trashed result leaves its node", (await thumb.count()) === 0 && /Not run yet/.test(await image.innerText()));
  await page.getByRole("button", { name: "Run all", exact: true }).click();
  await page.getByText(/Running 1 node/).first().waitFor({ timeout: 10_000 }).then(
    () => check("Run all makes the trashed result again", true),
    () => check("Run all makes the trashed result again", false),
  );
  await thumb.waitFor({ timeout: 60_000 });

  // 4. A big board stays responsive.
  if (perf > 0) {
    const chains = Math.ceil(perf / 3);
    const nodes = [];
    const edges = [];
    for (let i = 0; i < chains; i++) {
      const y = i * 520;
      nodes.push({ id: `p${i}`, type: "prompt", position: { x: 0, y }, data: { text: `Prompt ${i}: a fox in snow` } });
      nodes.push({ id: `i${i}`, type: "model", position: { x: 380, y }, data: { modelId: "nano-banana-pro", mediaKind: "image" } });
      nodes.push({ id: `v${i}`, type: "model", position: { x: 760, y }, data: { modelId: "kling-2-5-turbo", mediaKind: "video", op: "i2v", prompt: "it moves" } });
      edges.push({ id: `a${i}`, source: `p${i}`, sourceHandle: "out", target: `i${i}`, targetHandle: "prompt" });
      edges.push({ id: `b${i}`, source: `i${i}`, sourceHandle: "out", target: `v${i}`, targetHandle: "images" });
    }
    const big = await api("/api/canvases", { method: "POST", body: JSON.stringify({ name: `Perf ${chains * 3}`, graph: { nodes, edges } }) });
    const t0 = Date.now();
    await page.goto(`${app}/canvas/${big.id}`, { waitUntil: "load" });
    await page.locator(".react-flow__node").first().waitFor({ timeout: 120_000 });
    console.log(`     ${chains * 3} nodes: first node after ${Date.now() - t0} ms`);
    await page.waitForTimeout(1500);
    const times = await page.evaluate(async () => {
      const ta = document.querySelector('[data-testid="canvas-node-p0"] textarea');
      ta.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
      const out = [];
      for (let k = 0; k < 20; k++) {
        const t = performance.now();
        setter.call(ta, `${ta.value}x`);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
        out.push(performance.now() - t);
      }
      return out;
    });
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`     keystroke → paint ms: ${times.map((x) => Math.round(x)).join(", ")} (avg ${avg.toFixed(1)})`);
    check(`typing on a ${chains * 3}-node board repaints in under 50 ms on average`, avg < 50, `${avg.toFixed(1)} ms`);
  }
} catch (e) {
  failures.push(`script: ${e.message.split("\n")[0]}`);
  console.log(`FAIL ${e.message.split("\n")[0]}`);
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} canvas check(s) failed` : "\nAll canvas checks passed.");
process.exit(failures.length ? 1 : 0);
