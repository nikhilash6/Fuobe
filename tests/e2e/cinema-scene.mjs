// Cinema Studio's 3D scene in a real browser (the app must be running in demo mode; WebGL runs on SwiftShader).
// Usage: node tests/e2e/cinema-scene.mjs [appUrl] [--shots=dir]. Exits 1 on the first failure.
//
// 1. Cloud: "Create 3D scene" on a still asks first with the price, builds the demo depth map (painted with the
//    Spectral colour map, as Marigold's), and the viewer opens it as a point cloud; W A S D and the arrows move the
//    view; Capture uploads the frame as a PNG in the frame's ratio and queues a recomposition with the capture as
//    image 1 and the still as image 2. "Don't ask again" skips the question at that price until the toast's "Ask first".
// 2. Open engine: the scene is MoGe's mesh (the demo GLB here) and opens with its triangle count; at 390 px the
//    viewer fits, offers the Camera sheet and keeps Capture in reach.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DESKTOP, PHONE, chromiumPath, loadPlaywright } from "./_browser.mjs";

const args = process.argv.slice(2);
const app = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const shots = args.find((a) => a.startsWith("--shots="))?.slice(8);
if (shots) fs.mkdirSync(shots, { recursive: true });
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const step = (name) => console.log(`- ${name}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = browser.newContext().then((c) => c.request);
async function call(url, method = "GET", data) {
  const res = await (await api).fetch(app + url, { method, headers: { "Content-Type": "application/json" }, data: data === undefined ? undefined : JSON.stringify(data) });
  return res.json();
}
async function until(fn, what, ms = 90_000) {
  const t = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t > ms) throw new Error(`Timed out waiting for ${what}`);
    await sleep(700);
  }
}
const shoot = (page, name) => shots && page.screenshot({ path: path.join(shots, `${name}.png`) });
/** The dev build's corner badge sits over the viewer's bottom-left controls. */
const hideDevBadge = (ctx) =>
  ctx.addInitScript(() =>
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = "nextjs-portal{display:none!important}";
      document.head.append(s);
    }),
  );

const status = await call("/api/status");
assert.notEqual(status.demoMode, "off", "run the app in demo mode (FUOBE_DEMO_MODE=on)");
const project = await call("/api/cinema/projects", "POST", { name: "3D scene check" });
const items = async () => (await call(`/api/cinema/projects/${project.id}/items`)).items;
const errors = [];
let failed = false;

try {
  step("a still to build from");
  const settings = { camera: "modern", lens: "clean-sharp", focal: "24mm" };
  const made = await call(`/api/cinema/projects/${project.id}/generate`, "POST", {
    input: { engine: "cloud", mode: "image", action: "generate", prompt: "A lighthouse on a cliff at dusk", settings, aspectRatio: "16:9" },
  });
  assert.ok(made.items?.length, JSON.stringify(made));
  const still = await until(async () => (await items()).find((g) => g.id === made.items[0].id && g.status === "succeeded"), "the still");

  step("cloud: Create 3D scene asks first, with the price, and builds the point cloud");
  const ctx = await browser.newContext({ ...DESKTOP, colorScheme: "light" });
  await ctx.addInitScript(() => localStorage.setItem("fuobe.engine", "cloud"));
  await hideDevBadge(ctx);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${app}/cinema/${project.id}`, { waitUntil: "load", timeout: 120_000 });
  const tile = page.locator(`[aria-label^="Open"]`).first();
  await tile.waitFor({ timeout: 90_000 });
  await tile.hover();
  await page.getByRole("button", { name: "Create 3D scene" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("Cloud · Marigold V2 depth").waitFor();
  await dialog.getByRole("button", { name: /Build 3D scene · Placeholder · free/ }).waitFor();
  await shoot(page, "scene-create-dialog");
  await dialog.getByRole("checkbox", { name: "Don't ask again at this price" }).click();
  await dialog.getByRole("button", { name: /Build 3D scene/ }).click();
  await page.locator("[data-sonner-toast]").filter({ hasText: "Your 3D scene is ready" }).getByRole("button", { name: "Open" }).click({ timeout: 90_000 });
  await page.getByText(/Point cloud from a depth map · \d+k points/).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: /^Capture · Placeholder · free/ }).last().waitFor();

  step("the view flies and the frame follows the ratio");
  const canvas = page.locator("canvas[aria-roledescription='3D view']");
  await canvas.focus();
  const pixels = () => canvas.screenshot().then((b) => b.toString("base64"));
  const before = await pixels();
  await page.keyboard.down("KeyW");
  await sleep(600);
  await page.keyboard.up("KeyW");
  await page.keyboard.press("ArrowRight");
  await sleep(500);
  assert.notEqual(await pixels(), before, "W and → should move the view");
  await page.getByRole("radio", { name: "9:16" }).click();
  await page.getByText("9:16 · 24 mm · f/5.6").waitFor();
  await page.getByRole("button", { name: "50 mm", exact: true }).click();
  await page.getByText("9:16 · 50 mm · f/5.6").waitFor();
  await shoot(page, "scene-viewer-cloud");

  step("Capture uploads the frame and queues the recomposition");
  await page.getByRole("button", { name: /^Capture/ }).last().click();
  await page.locator("[data-sonner-toast]").filter({ hasText: "Re-rendering this view" }).waitFor({ timeout: 30_000 });
  const rec = await until(async () => (await items()).find((g) => g.feature === "cinema-recompose"), "the recomposition");
  const [capture, ref] = rec.request.inputs.images;
  assert.match(capture, /^\/api\/files\/uploads\/.+\.png$/);
  // The still as the feed shows it: Fuobe Soul Cinema's grade is applied in the browser, so its finished picture (the raw
  // one stays as meta.original).
  const shown = (await items()).find((g) => g.id === still.id).outputs[0];
  assert.ok([shown.url, shown.meta?.original].includes(ref), `the reference is the still (${ref})`);
  assert.match(rec.request.prompt, /^Re-render this exact camera view of the scene/);
  const png = Buffer.from(await (await (await api).fetch(app + capture)).body());
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [864, 1536], "the capture is the 9:16 frame");
  await page.getByRole("button", { name: "Close the 3D scene" }).click();

  step("Don't ask again holds at this price: the next build names it in its toast, which can turn the question back on");
  const quick = page.getByRole("button", { name: "Create 3D scene · Placeholder · free" }).last();
  await quick.click({ force: true });
  const built = page.locator("[data-sonner-toast]").filter({ hasText: "Placeholder · free · It appears next to the still" });
  await built.getByRole("button", { name: "Ask first" }).click({ timeout: 30_000 });
  assert.equal(await page.getByRole("dialog").count(), 0, "no question while skipped");
  await quick.click({ force: true });
  await page.getByRole("dialog").getByText("Cloud · Marigold V2 depth").waitFor();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await ctx.close();

  step("open engine: MoGe's mesh opens, and fits a phone with the Camera sheet");
  const open = await call(`/api/cinema/projects/${project.id}/generate`, "POST", {
    input: { engine: "open", mode: "image", action: "scene", prompt: "", settings, source: { url: still.outputs[0].url, kind: "image" }, aspectRatio: "16:9" },
  });
  const scene = await until(async () => (await items()).find((g) => g.id === open.items?.[0]?.id && g.status === "succeeded"), "the open scene");
  assert.deepEqual(
    scene.outputs.map((o) => o.kind),
    ["model3d", "image"],
  );
  const phone = await browser.newContext({ ...PHONE, colorScheme: "dark" });
  await phone.addInitScript(() => localStorage.setItem("fuobe.engine", "open"));
  await hideDevBadge(phone);
  const p2 = await phone.newPage();
  p2.on("pageerror", (e) => errors.push(e.message));
  await p2.goto(`${app}/cinema/${project.id}`, { waitUntil: "load", timeout: 120_000 });
  await p2.locator(`button[aria-label="Open 3D scene"]`).first().click({ force: true, timeout: 90_000 });
  await p2.getByText(/· \d+ triangles/).waitFor({ timeout: 60_000 });
  await p2.getByText("Drag to look · two fingers to move").waitFor();
  assert.equal(await p2.evaluate(() => document.documentElement.scrollWidth), 390);
  await shoot(p2, "scene-viewer-phone");
  await p2.getByRole("button", { name: "Camera" }).click();
  await p2.getByRole("dialog", { name: "Camera" }).getByText("Qwen-Image-Edit 2511 + Multiple-Angles LoRA").waitFor();
  await phone.close();
  assert.deepEqual(errors, [], "no page errors");
  console.log("\nAll 3D scene checks passed.");
} catch (e) {
  failed = true;
  console.log(`FAIL ${e.message.split("\n")[0]}`);
} finally {
  await call(`/api/cinema/projects/${project.id}`, "DELETE").catch(() => {});
  await browser.close();
}
process.exit(failed ? 1 : 0);
