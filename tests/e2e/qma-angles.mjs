// qma-angles in a real browser. The app must run in demo mode with ComfyUI unreachable
// (FUOBE_DEMO_MODE=on COMFYUI_URL=http://127.0.0.1:9). Usage: node tests/e2e/qma-angles.mjs [appUrl] [--shots=dir].
//
// At 1440 px and 390 px, in light and in dark, on your GPU:
// 1. The Angles app on QMA · 96 views: the orbit pad beside the angle, height and distance chips; dragging it right swings
//    the camera to the right side, the chips follow; the model's own camera settings aren't asked twice; nothing scrolls
//    sideways; no console errors.
// 2. Character Sheet's Turnaround dialog: "Stills · 8 views" as a route, "Drawn with" offers QMA · 96 views, the still route
//    hides length and shape and prices Free on your GPU. Once (1440 light) the still set runs and its pictures show.
// Nothing reaches a GPU.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DESKTOP, PHONE, chromiumPath, loadPlaywright, root } from "./_browser.mjs";

const args = process.argv.slice(2);
const app = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const shots = args.find((a) => a.startsWith("--shots="))?.slice(8);
if (shots) fs.mkdirSync(shots, { recursive: true });
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: chromiumPath() });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (what, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${what}${ok || !detail ? "" : ` — ${detail}`}`);
  if (!ok) failures++;
};
const call = async (url, method = "GET", data) =>
  (await fetch(app + url, { method, headers: { "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) })).json();
async function until(fn, what, ms = 90_000) {
  const t = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t > ms) throw new Error(`Timed out waiting for ${what}`);
    await sleep(700);
  }
}
async function upload(file, name) {
  const f = new FormData();
  f.append("file", new Blob([fs.readFileSync(file)], { type: "image/png" }), name);
  return (await (await fetch(`${app}/api/uploads`, { method: "POST", body: f })).json()).url;
}

const status = await call("/api/status");
assert.notEqual(status.demoMode, "off", "run the app in demo mode (FUOBE_DEMO_MODE=on)");
const fixtures = path.join(root, "scripts/eval/fixtures/character");
const photo = await upload(path.join(fixtures, "drawn-face-1.png"), "drawn-face-1.png");
const sheetRun = await call("/api/photodump/character", "POST", { mode: "reference", engine: "open", images: [photo] });
await until(async () => (await call(`/api/generations/${sheetRun.items[0].id}`))?.status === "succeeded", "the sheet");

const hideDevBadge = (ctx) =>
  ctx.addInitScript(() =>
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = "nextjs-portal{display:none!important}";
      document.head.append(s);
    }),
  );
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const shoot = (page, name) => shots && page.screenshot({ path: path.join(shots, `${name}.png`) });

for (const [size, scheme] of [
  ["1440", "light"],
  ["1440", "dark"],
  ["390", "light"],
  ["390", "dark"],
]) {
  const tag = `${size} ${scheme}`;
  const phone = size === "390";
  const ctx = await browser.newContext({ ...(phone ? PHONE : DESKTOP), colorScheme: scheme });
  await hideDevBadge(ctx);
  await ctx.addInitScript(() => localStorage.setItem("fuobe.engine", "open"));
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));

  // 1. The Angles app on QMA · 96 views
  await page.goto(`${app}/apps/app-angles?model=oss-qwen-image-21-qma`, { waitUntil: "load", timeout: 120_000 });
  const pad = page.getByRole("slider", { name: /^Camera orbit/ });
  await pad.waitFor({ timeout: 60_000 });
  check(`${tag}: the orbit pad shows beside the chips`, await pad.isVisible());
  const model = await page.locator('button[aria-label^="Model: "]:visible').first().getAttribute("aria-label");
  check(`${tag}: the app runs on QMA · 96 views`, /QMA · 96 views/.test(model ?? ""), model ?? "");
  const before = await pad.getAttribute("aria-valuetext");
  const box = await pad.boundingBox();
  // Back to the front first (arrow keys move one view), then a quarter of the pad's width to the right = 90°.
  await pad.focus();
  for (let i = 0; i < 8 && !(await pad.getAttribute("aria-valuetext")).startsWith("Front ·"); i++) await page.keyboard.press("ArrowLeft");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(box.x + box.width / 2 + (i * box.width) / 24, box.y + box.height / 2);
  await page.mouse.up();
  await sleep(300);
  const after = await pad.getAttribute("aria-valuetext");
  check(`${tag}: dragging right swings the camera to the right side (${before} → ${after})`, /^Right side ·/.test(after ?? ""));
  const chip = page.getByRole("radiogroup", { name: "Angle" }).getByRole("radio", { name: "Right side" });
  check(`${tag}: the Angle chips follow the pad`, (await chip.getAttribute("aria-checked")) === "true");
  await page.keyboard.press("ArrowUp");
  await sleep(200);
  check(`${tag}: arrow up raises it one height`, /Elevated/.test((await pad.getAttribute("aria-valuetext")) ?? ""));
  check(`${tag}: no second Angle setting in the model's controls`, (await page.getByRole("button", { name: /Director controls/ }).count()) === 0 || !(await page.locator("label", { hasText: /^Angle/ }).count()));
  check(`${tag}: no sideways scroll on the Angles app`, (await sideways(page)) <= 1);
  await shoot(page, `angles-${size}-${scheme}`);

  // 2. Character Sheet's Turnaround dialog
  await page.goto(`${app}/character-sheet`, { waitUntil: "load", timeout: 120_000 });
  const open = page.getByRole("button", { name: /^Turnaround video/ });
  await open.waitFor({ timeout: 60_000 });
  await open.click();
  const dialog = page.getByRole("dialog");
  const routes = dialog.getByRole("radiogroup", { name: "Route" });
  await routes.waitFor({ timeout: 30_000 });
  check(`${tag}: the open engine offers Frames and Stills · 8 views`, /Frames[\s\S]*Stills · 8 views/.test(await routes.innerText()));
  const drawn = dialog.getByRole("radiogroup", { name: "Drawn with" });
  check(`${tag}: the missing sides can be drawn with QMA · 96 views`, /QMA · 96 views/.test(await drawn.innerText()));
  await drawn.getByRole("radio", { name: "QMA · 96 views" }).click();
  await until(async () => /QMA · 96 views draws the/.test(await dialog.innerText()), "the QMA fill note", 20_000).then(
    () => check(`${tag}: the plan says QMA draws the missing sides`, true),
    () => check(`${tag}: the plan says QMA draws the missing sides`, false),
  );
  await routes.getByRole("radio", { name: "Stills · 8 views" }).click();
  await until(async () => /draws the character from 7 more sides/.test(await dialog.innerText()), "the stills plan", 20_000).catch(() => null);
  const text = await dialog.innerText();
  check(`${tag}: the still set's plan and Free price`, /draws the character from 7 more sides/.test(text) && /Free · on your GPU|Placeholder · free/.test(text), text.slice(-400));
  check(`${tag}: no length or shape for stills`, !(await dialog.getByRole("radiogroup", { name: "Length" }).count()) && !(await dialog.getByRole("radiogroup", { name: "Shape" }).count()));
  check(`${tag}: no sideways scroll with the dialog open`, (await sideways(page)) <= 1);
  await shoot(page, `stills-${size}-${scheme}`);
  if (size === "1440" && scheme === "light") {
    await dialog.getByRole("checkbox", { name: "I confirm the consent line" }).click();
    const make = dialog.getByRole("button", { name: /Make 8 views/ });
    await until(async () => !(await make.isDisabled()), "Make 8 views", 20_000);
    await make.click();
    await until(async () => (await dialog.locator("img").count()) >= 7 && /Your views are ready/.test(await dialog.innerText()), "the still set", 120_000).then(
      () => check(`${tag}: the 7 drawn views show when they're done`, true),
      () => check(`${tag}: the 7 drawn views show when they're done`, false),
    );
    await shoot(page, "stills-done");
  }
  await page.keyboard.press("Escape");
  check(`${tag}: no console errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}
await browser.close();
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
