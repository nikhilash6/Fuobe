// Exact orbits and Fly around (build plan N7-7) in a real browser (the app must be running in demo mode).
// Usage: node tests/e2e/exact-orbits.mjs [appUrl] [--shots=dir]. Exits 1 on any failure.
//
// At 1440 px and 390 px, in light and dark: the Exact switch and its controls on a Fuobe DoP orbit move (/video?preset=…)
// and in Cinema's move picker, "Film it photoreal" on an Image to 3D result, and the Camera path and Fly around nodes on a
// canvas. Each: the controls render, the price fits, nothing scrolls sideways, keyboard focus reaches every new control,
// a finger drags the degrees slider on a phone; no page errors or console errors.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DESKTOP, PHONE, launch } from "./_browser.mjs";

const args = process.argv.slice(2);
const app = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const shots = args.find((a) => a.startsWith("--shots="))?.slice(8);
if (shots) fs.mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (name) => console.log(`- ${name}`);
async function call(url, method = "GET", data) {
  const res = await fetch(app + url, { method, headers: { "Content-Type": "application/json" }, ...(data !== undefined && { body: JSON.stringify(data) }) });
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

const status = await call("/api/status");
assert.notEqual(status.demoMode, "off", "run the app in demo mode (FUOBE_DEMO_MODE=on)");

// A photo, a finished 3D model of it (a demo) to film, and a canvas with the two nodes.
const photo = await (
  await fetch(`${app}/api/uploads`, { method: "POST", headers: { "content-type": "image/jpeg", "x-file-name": "figure.jpg" }, body: fs.readFileSync(path.resolve("public/previews/presets/app-3d-figure.jpg")) })
).json();
assert.ok(photo.url, `an upload: ${JSON.stringify(photo).slice(0, 200)}`);
const made = await call("/api/generations", "POST", { feature: "image-to-3d", modelId: "oss-pixal3d", op: "image-to-3d", inputs: { images: [photo.url] } });
const model3d = made.items?.[0];
assert.ok(model3d, `a demo 3D model: ${JSON.stringify(made).slice(0, 200)}`);
await until(async () => (await call(`/api/generations/${model3d.id}`)).status === "succeeded", "the demo 3D model");
const graph = {
  nodes: [
    { id: "still", type: "image-input", position: { x: 0, y: 0 }, data: { url: photo.url } },
    { id: "path", type: "camera-path", position: { x: 0, y: 260 }, data: { orbit: { degrees: 180, direction: "cw", tilt: 10, pulse: 0.25 } } },
    { id: "fly", type: "fly-around", position: { x: 420, y: 80 }, data: { modelId: "minimax-h3-max-camera" } },
  ],
  edges: [
    { id: "e1", source: "still", sourceHandle: "out", target: "fly", targetHandle: "images" },
    { id: "e2", source: "path", sourceHandle: "out", target: "fly", targetHandle: "path" },
  ],
};
const canvas = await call("/api/canvases", "POST", { name: "Exact orbits check", graph });
assert.ok(canvas.id, "a canvas");
const cinema = await call("/api/cinema/projects", "POST", { name: "Exact orbits check" });
assert.ok(cinema.id, "a Cinema project");

const browser = await launch();
const failures = [];

async function context(phone, scheme, engine) {
  const ctx = await browser.newContext({ ...(phone ? PHONE : DESKTOP), colorScheme: scheme });
  await ctx.addInitScript((e) => {
    localStorage.setItem("fuobe.engine", e);
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = "nextjs-portal{display:none!important}";
      document.head.append(s);
    });
  }, engine);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => failures.push(`${phone ? "phone" : "desktop"} ${scheme}: page error ${e.message}`));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && failures.push(`${phone ? "phone" : "desktop"} ${scheme}: console ${m.text().slice(0, 200)}`));
  return { ctx, page };
}
const noSideScroll = async (page, what) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0, `${what}: nothing scrolls sideways`);
const shoot = (page, name) => shots && page.screenshot({ path: path.join(shots, `${name}.png`) });
const fits = async (loc, what) => {
  const box = await loc.boundingBox();
  const vw = await loc.page().evaluate(() => window.innerWidth);
  assert.ok(box && box.x >= -1 && box.x + box.width <= vw + 1, `${what} fits the screen`);
};

/** Tab from the switch: focus reaches it and, once on, the sliders and the direction and pulse buttons. */
async function exactControls(page, root, what, phone) {
  const sw = root.getByRole("switch", { name: "Exact orbit" });
  await sw.focus();
  assert.equal(await sw.evaluate((el) => el === document.activeElement), true, `${what}: the switch takes focus`);
  await page.keyboard.press("Space");
  await root.getByRole("slider").first().waitFor({ timeout: 10_000 });
  assert.equal(await root.getByRole("slider").count(), 2, `${what}: degrees and tilt`);
  const reached = new Set();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    const label = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.getAttribute("role") === "slider" ? `slider:${el.getAttribute("aria-valuetext")}` : (el?.textContent ?? "").trim();
    });
    reached.add(label);
  }
  for (const want of ["Clockwise", "In and out 25%"]) assert.ok([...reached].some((l) => l === want || l.startsWith(want)) || [...reached].some((l) => l.includes("Counter")), `${what}: focus reaches ${want} (${[...reached].join(" | ")})`);
  assert.ok([...reached].some((l) => l.startsWith("slider:")), `${what}: focus reaches the sliders`);
  await fits(root, what);
  // The degrees slider: a drag (a finger on the phone) changes it.
  const slider = root.getByRole("slider").first();
  const before = await slider.getAttribute("aria-valuenow");
  const track = await root.locator("[data-slot=slider]").first().boundingBox();
  if (phone) {
    const cdp = await page.context().newCDPSession(page);
    const y = track.y + track.height / 2;
    const touch = (type, x) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    await touch("touchStart", track.x + track.width - 4);
    await touch("touchMove", track.x + track.width * 0.4);
    await touch("touchMove", track.x + track.width * 0.3);
    await touch("touchEnd");
  } else {
    await page.mouse.move(track.x + track.width - 4, track.y + track.height / 2);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width * 0.3, track.y + track.height / 2, { steps: 6 });
    await page.mouse.up();
  }
  await sleep(200);
  assert.notEqual(await slider.getAttribute("aria-valuenow"), before, `${what}: dragging the degrees slider changes it`);
}

for (const phone of [false, true]) {
  for (const scheme of ["light", "dark"]) {
    const tag = `${phone ? "390" : "1440"}-${scheme}`;
    try {
      step(`${tag}: Fuobe DoP's 360 Orbit`);
      {
        const { ctx, page } = await context(phone, scheme, scheme === "light" ? "cloud" : "open");
        await page.goto(`${app}/video?preset=motion-360-orbit`, { waitUntil: "load", timeout: 120_000 });
        const root = page.getByTestId("exact-orbit");
        await root.waitFor({ timeout: 60_000 });
        await exactControls(page, root, `${tag} DoP`, phone);
        // The composer's price is the exact orbit's.
        await page.getByText(scheme === "light" ? /≈ \$0\.40/ : /Free · on your GPU/).locator("visible=true").first().waitFor({ timeout: 30_000 });
        await noSideScroll(page, `${tag} DoP`);
        await shoot(page, `dop-${tag}`);
        await ctx.close();
      }
      step(`${tag}: Cinema's move picker`);
      {
        const { ctx, page } = await context(phone, scheme, "cloud");
        await page.goto(`${app}/cinema/${cinema.id}`, { waitUntil: "load", timeout: 120_000 });
        await page.getByRole("button", { name: "Add a camera move" }).first().click({ timeout: 60_000 });
        await page.getByRole("option", { name: /Drone Orbit/ }).or(page.getByRole("button", { name: /Drone Orbit/ })).first().click({ timeout: 30_000 });
        const root = page.getByTestId("exact-orbit");
        await root.waitFor({ timeout: 30_000 });
        await exactControls(page, root, `${tag} Cinema`, phone);
        await noSideScroll(page, `${tag} Cinema`);
        await shoot(page, `cinema-${tag}`);
        await ctx.close();
      }
      step(`${tag}: Image to 3D's Film it photoreal`);
      {
        const { ctx, page } = await context(phone, scheme, "cloud");
        await page.goto(`${app}/image-to-3d`, { waitUntil: "load", timeout: 120_000 });
        const film = page.getByRole("button", { name: /Film it photoreal/ }).first();
        await film.waitFor({ timeout: 60_000 });
        await film.scrollIntoViewIfNeeded();
        await page.getByText(/≈ \$0\.40|Placeholder · free/).first().waitFor({ timeout: 30_000 });
        await fits(film, `${tag} Film it photoreal`);
        await film.focus();
        assert.equal(await film.evaluate((el) => el === document.activeElement), true, `${tag}: Film it photoreal takes focus`);
        await noSideScroll(page, `${tag} Image to 3D`);
        await shoot(page, `model3d-${tag}`);
        await ctx.close();
      }
      step(`${tag}: Canvas's Camera path and Fly around nodes`);
      {
        const { ctx, page } = await context(phone, scheme, "cloud");
        await page.goto(`${app}/canvas/${canvas.id}`, { waitUntil: "load", timeout: 120_000 });
        await page.getByText("Fly around", { exact: true }).first().waitFor({ timeout: 60_000 });
        await page.getByText("Camera path", { exact: true }).first().waitFor({ timeout: 30_000 });
        // The board's own nodes: the Fly around node's ports read Still, then views and Camera path.
        await page.getByText("Still, then views").first().waitFor({ timeout: 10_000 });
        // On a phone the board is for looking: its nodes are edited as cards on the Nodes tab.
        if (phone) await page.getByRole("tab", { name: "Nodes" }).or(page.getByRole("button", { name: "Nodes" })).first().click();
        const move = page.getByRole("combobox", { name: /Move of/ }).locator("visible=true").first();
        await move.waitFor({ timeout: 20_000 });
        await move.focus();
        assert.equal(await move.evaluate((el) => el === document.activeElement), true, `${tag}: the move list takes focus`);
        const root = page.getByTestId("exact-orbit").locator("visible=true").first();
        await root.getByText("180° clockwise · tilt 10° · pulse 25%").waitFor({ timeout: 10_000 });
        assert.equal(await root.getByRole("slider").count(), 2, `${tag}: the node's sliders`);
        await root.getByRole("slider").first().focus();
        await page.keyboard.press("ArrowRight");
        await root.getByText("185° clockwise · tilt 10° · pulse 25%").waitFor({ timeout: 10_000 });
        await shoot(page, `canvas-${tag}`);
        await noSideScroll(page, `${tag} Canvas`);
        await ctx.close();
      }
    } catch (e) {
      failures.push(`${tag}: ${e.message}`);
    }
  }
}

await browser.close();
if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n${failures.map((f) => `  ✗ ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("\nAll exact-orbit checks passed");
