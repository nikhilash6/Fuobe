// Fly path in Cinema's 3D scene (build plan N7-5) in a real browser (the app must be running in demo mode; WebGL runs
// on SwiftShader). Usage: node tests/e2e/cinema-path.mjs [appUrl] [--shots=dir]. Exits 1 on the first failure.
//
// 1. 1440 px, light, cloud: the Path strip over the view (the still's chip, + Keyframe, Preview), the moves, the length
//    and quality, the motion words and "Film this path · price" beside Capture; K and + Keyframe add the flown pose as a
//    chip; a move replaces the keys; Preview flies the camera and gives it back; Film queues an H3 Max take that carries
//    the keys; Capture still re-renders a view. Keyboard focus reaches every new control; nothing scrolls sideways.
// 2. 1440 px, dark, open engine: Film records the scene along the path in the browser (81 frames), uploads it and queues
//    the Uni3C take with the still and the render; the render is a real video of 81 frames in the still's shape.
// 3. 390 px, light and dark: the Path button opens the Fly path sheet with the same controls; nothing scrolls sideways;
//    a finger drag on the view turns it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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
const hideDevBadge = (ctx) =>
  ctx.addInitScript(() =>
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = "nextjs-portal{display:none!important}";
      document.head.append(s);
    }),
  );
const noSideScroll = async (page, what) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0, `${what}: nothing scrolls sideways`);

const status = await call("/api/status");
assert.notEqual(status.demoMode, "off", "run the app in demo mode (FUOBE_DEMO_MODE=on)");
const project = await call("/api/cinema/projects", "POST", { name: "Fly path check" });
const items = async () => (await call(`/api/cinema/projects/${project.id}/items`)).items;
const errors = [];
let failed = false;

async function openScene(ctx, engine) {
  await ctx.addInitScript((e) => localStorage.setItem("fuobe.engine", e), engine);
  await hideDevBadge(ctx);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${app}/cinema/${project.id}`, { waitUntil: "load", timeout: 120_000 });
  await page.locator(`button[aria-label="Open 3D scene"]`).first().click({ force: true, timeout: 90_000 });
  await page.getByText(/Point cloud from a depth map · \d+k points/).waitFor({ timeout: 60_000 });
  return page;
}

try {
  step("a still and its cloud 3D scene");
  const settings = { camera: "modern", lens: "clean-sharp", focal: "24mm" };
  const made = await call(`/api/cinema/projects/${project.id}/generate`, "POST", {
    input: { engine: "cloud", mode: "image", action: "generate", prompt: "A dancer on a rooftop at dusk", settings, aspectRatio: "16:9" },
  });
  const still = await until(async () => (await items()).find((g) => g.id === made.items?.[0]?.id && g.status === "succeeded"), "the still");
  const built = await call(`/api/cinema/projects/${project.id}/generate`, "POST", {
    input: { engine: "cloud", mode: "image", action: "scene", prompt: "", settings, source: { url: still.outputs[0].url, kind: "image" }, aspectRatio: "16:9" },
  });
  await until(async () => (await items()).find((g) => g.id === built.items?.[0]?.id && g.status === "succeeded"), "the scene");

  step("1440 light, cloud: the Path strip, the moves and Film beside Capture");
  const ctx = await browser.newContext({ ...DESKTOP, colorScheme: "light" });
  const page = await openScene(ctx, "cloud");
  const strip = page.getByLabel("Fly path", { exact: true });
  await strip.getByRole("button", { name: /Keyframe 1: the start/ }).waitFor();
  const keyframe = strip.getByRole("button", { name: "Keyframe", exact: true });
  const previewBtn = strip.getByRole("button", { name: "Preview" });
  assert.equal(await previewBtn.isDisabled(), true, "Preview waits for a second keyframe");
  const film = page.getByRole("complementary").getByRole("button", { name: /^Film this path · Placeholder · free$/ });
  await film.waitFor();
  assert.equal(await film.isDisabled(), true, "Film waits for a path");
  await page.getByRole("complementary").getByRole("button", { name: /^Capture · Placeholder · free/ }).waitFor();
  await noSideScroll(page, "desktop viewer");

  step("flying and + Keyframe / K add the pose as a chip");
  const canvas = page.locator("canvas[aria-roledescription='3D view']");
  await canvas.focus();
  const pixels = () => canvas.screenshot().then((b) => b.toString("base64"));
  await page.keyboard.down("KeyD");
  await sleep(500);
  await page.keyboard.up("KeyD");
  for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowLeft");
  await keyframe.click();
  const chips = () => strip.getByRole("button", { name: /^Keyframe \d+: \d/ });
  await until(async () => (await chips().count()) === 1, "the first keyframe chip");
  assert.match(await chips().first().innerText(), /^5\.0 s · -?\d+° · [+-]?\d+° · \d\.\dx$/);
  await canvas.focus();
  await page.keyboard.down("KeyA");
  await sleep(700);
  await page.keyboard.up("KeyA");
  await page.keyboard.press("KeyK");
  await until(async () => (await chips().count()) === 2, "the K keyframe");
  assert.match(await chips().first().innerText(), /^2\.5 s/);
  await shoot(page, "path-desktop-keys");

  step("a move replaces the keys; Preview flies the camera and gives it back");
  await page.getByRole("button", { name: "Orbit 360°" }).click();
  await until(async () => (await chips().count()) === 4, "the orbit's keys");
  assert.equal(await page.getByRole("button", { name: "Orbit 360°" }).getAttribute("aria-pressed"), "true");
  assert.match(await chips().nth(1).innerText(), /^2\.5 s · 180° · 0° · 1\.0x$/);
  // Pixels of the view with the pointer away from the strip (a hovered button would differ).
  const settled = async () => {
    await page.mouse.move(1300, 20);
    await sleep(250);
    return pixels();
  };
  const before = await settled();
  await previewBtn.click();
  await strip.getByRole("button", { name: "Stop" }).waitFor();
  await sleep(1500);
  assert.notEqual(await pixels(), before, "Preview flies the camera");
  await strip.getByRole("button", { name: "Preview" }).waitFor({ timeout: 15_000 });
  assert.equal(await settled(), before, "the camera is back where it was");
  await shoot(page, "path-desktop-light");

  step("keyboard focus reaches every new control");
  await canvas.focus();
  const seen = new Set();
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    const name = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "").trim() : "";
    });
    seen.add(name);
  }
  for (const want of [/^Keyframe 1: the start/, /^Keyframe 2: /, /^Remove keyframe 2$/, /^Keyframe$/, /^Preview$/, /^Orbit 360°$/, /^Truck right$/, /^5 s$/, /^768p$/, /^Film this path/, /^Capture/]) {
    assert.ok([...seen].some((s) => want.test(s)), `focus reaches ${want} (saw: ${[...seen].slice(0, 60).join(" | ")})`);
  }
  assert.ok(await page.getByPlaceholder("The character keeps moving naturally while the camera follows the path").isVisible(), "the motion words field");

  step("Film queues an H3 Max take that carries the path; Capture still re-renders a view");
  await page.getByRole("radio", { name: "8 s" }).click();
  await page.getByPlaceholder(/keeps moving naturally/).fill("The dancer spins");
  await film.click();
  await page.locator("[data-sonner-toast]").filter({ hasText: "Filming this path" }).waitFor({ timeout: 30_000 });
  const cloudTake = await until(async () => (await items()).find((g) => g.feature === "cinema-path"), "the cloud path take");
  assert.equal(cloudTake.request.modelId, "minimax-h3-max-camera");
  assert.equal(cloudTake.request.op, "camera-path");
  assert.equal(cloudTake.request.params.cameraPath.length, 5);
  assert.equal(cloudTake.request.params.duration, 8);
  assert.equal(cloudTake.request.prompt, "The dancer spins");
  assert.equal(cloudTake.request.inputs.images.length, 1, "the still is the first frame");
  assert.equal(cloudTake.take?.path?.preset, "orbit_360");
  await page.getByRole("complementary").getByRole("button", { name: /^Capture/ }).click();
  await page.locator("[data-sonner-toast]").filter({ hasText: "Re-rendering this view" }).waitFor({ timeout: 30_000 });
  await until(async () => (await items()).find((g) => g.feature === "cinema-recompose"), "the recomposition");
  await ctx.close();

  step("1440 dark, open engine: Film records the path in the browser and queues the Uni3C take");
  const dark = await browser.newContext({ ...DESKTOP, colorScheme: "dark" });
  const p2 = await openScene(dark, "open");
  await p2.getByRole("button", { name: "Dolly in" }).click();
  await p2.getByText(/About 5\.1 s · 81 frames at 16 fps/).waitFor();
  const openFilm = p2.getByRole("complementary").getByRole("button", { name: /^Film this path · Placeholder · free$/ });
  await shoot(p2, "path-desktop-dark-open");
  await openFilm.click();
  await p2.getByRole("complementary").getByRole("button", { name: /Rendering the path… \d+%/ }).waitFor({ timeout: 10_000 });
  await p2.locator("[data-sonner-toast]").filter({ hasText: "Filming this path" }).waitFor({ timeout: 60_000 });
  const openTake = await until(async () => (await items()).find((g) => g.feature === "cinema-path" && g.request.modelId === "oss-uni3c-path"), "the open path take");
  const render = openTake.request.inputs.video;
  assert.match(render, /^\/api\/files\/uploads\/.+\.(webm|mp4)$/);
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-path-")), path.basename(render));
  fs.writeFileSync(tmp, Buffer.from(await (await (await api).fetch(app + render)).body()));
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=width,height,nb_read_frames", "-of", "json", tmp]).toString()).streams[0];
  console.log(`  render: ${path.extname(tmp)} ${probe.width}x${probe.height}, ${probe.nb_read_frames} frames`);
  assert.equal(Number(probe.nb_read_frames), 81, "the render has 81 frames");
  assert.equal(probe.width, 832, "the render is the still's 16:9 shape on Wan's grid");
  assert.equal(probe.height, 464);
  await noSideScroll(p2, "desktop dark");
  await dark.close();

  for (const scheme of ["light", "dark"]) {
    step(`390 ${scheme}: the Path sheet, no sideways scroll, a finger drag turns the view`);
    const phone = await browser.newContext({ ...PHONE, colorScheme: scheme });
    const p3 = await openScene(phone, "cloud");
    await noSideScroll(p3, `phone ${scheme}`);
    const view = p3.locator("canvas[aria-roledescription='3D view']");
    const shot = () => view.screenshot().then((b) => b.toString("base64"));
    const a = await shot();
    const box = await view.boundingBox();
    const cdp = await phone.newCDPSession(p3);
    const at = (x, y) => [{ x: box.x + x, y: box.y + y, id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(200, 200) });
    for (let i = 1; i <= 10; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(200 - i * 12, 200) });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(400);
    assert.notEqual(await shot(), a, "a finger drag turns the view");
    await p3.getByRole("button", { name: /^Path, 0 keyframes$/ }).click();
    const sheet = p3.getByRole("dialog", { name: "Fly path" });
    await sheet.getByRole("button", { name: "Keyframe", exact: true }).click();
    await sheet.getByRole("button", { name: /^Keyframe 2: 5\.0 s/ }).waitFor();
    await sheet.getByRole("button", { name: "Tilted ring" }).click();
    await sheet.getByRole("button", { name: /^Keyframe 9: 5\.0 s · 360°/ }).waitFor();
    await sheet.getByRole("button", { name: /^Film this path · Placeholder · free$/ }).waitFor();
    await noSideScroll(p3, `phone ${scheme} sheet`);
    const sheetBox = await sheet.boundingBox();
    assert.ok(sheetBox.width <= 390, "the sheet fits the phone");
    await shoot(p3, `path-phone-${scheme}`);
    await p3.keyboard.press("Escape");
    await p3.getByRole("button", { name: "Path, 8 keyframes" }).waitFor();
    await phone.close();
  }

  assert.deepEqual(errors, [], "no page errors");
  console.log("\nAll Fly path checks passed.");
} catch (e) {
  failed = true;
  console.log(`FAIL ${e.message.split("\n")[0]}`);
} finally {
  await call(`/api/cinema/projects/${project.id}`, "DELETE").catch(() => {});
  await browser.close();
}
process.exit(failed ? 1 : 0);
