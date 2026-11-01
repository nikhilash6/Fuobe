// Turnaround video (build plan N7-6) in a real browser. The app must run in demo mode with ComfyUI unreachable
// (FUOBE_DEMO_MODE=on COMFYUI_URL=http://127.0.0.1:9). Usage: node tests/e2e/turnaround.mjs [appUrl] [--shots=dir].
//
// At 1440 px and 390 px, in light and in dark:
// 1. Character Sheet: a finished sheet offers "Turnaround video"; the dialog shows the views (the person's own sides), Draw the
//    missing sides, the length and shape, the consent line for photos someone brought, and the price or GPU line before
//    running; keyboard focus reaches every control; nothing scrolls sideways; at 390 px a finger drag scrolls the dialog.
//    Once (1440 light, open engine) it runs: progress, then the film in the dialog and in the Library's list.
// 2. A character's page: "Fly around" opens the same dialog; in the cloud the routes (References, Keyframes, Camera path)
//    and the camera path's moves, priced; a real person needs the consent line before Fly around runs.
// 3. Cinema's Soul Cast results: "Turnaround video" files a take in the project (no consent line: Soul Cast makes the person).
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
async function call(url, method = "GET", data) {
  const res = await fetch(app + url, { method, headers: { "Content-Type": "application/json" }, body: data === undefined ? undefined : JSON.stringify(data) });
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
async function upload(file, name) {
  const f = new FormData();
  f.append("file", new Blob([fs.readFileSync(file)], { type: "image/png" }), name);
  return (await (await fetch(`${app}/api/uploads`, { method: "POST", body: f })).json()).url;
}
const generation = (id) => call(`/api/generations/${id}`);

const status = await call("/api/status");
assert.notEqual(status.demoMode, "off", "run the app in demo mode (FUOBE_DEMO_MODE=on)");

// A sheet made "From Reference" (photos someone brought), a character with three pictures, a Cinema project.
const fixtures = path.join(root, "scripts/eval/fixtures/character");
const photos = await Promise.all(["drawn-face-1.png", "drawn-face-2.png", "drawn-face-3.png"].map((f) => upload(path.join(fixtures, f), f)));
const sheetRun = await call("/api/photodump/character", "POST", { mode: "reference", engine: "open", images: [photos[0]] });
const sheetId = sheetRun.items[0].id;
await until(async () => (await generation(sheetId))?.status === "succeeded", "the sheet");
const element = await call("/api/elements", "POST", { name: "Ada Turn", kind: "character", references: photos });
const elementId = element.id;
const project = await call("/api/cinema/projects", "POST", { name: "Turnaround check" });

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

/** Tab through the dialog and name what got focus: every new control must be reached. */
async function focusWalk(page, dialog, max = 60) {
  const seen = new Set();
  await dialog.locator("button, [role=switch], [role=radio], [role=checkbox]").first().focus();
  for (let i = 0; i < max; i++) {
    const name = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? `${el.getAttribute("role") ?? el.tagName.toLowerCase()}:${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40)}` : "";
    });
    seen.add(name);
    await page.keyboard.press("Tab");
  }
  return [...seen].join(" | ");
}

/** A finger drag up inside the dialog scrolls it (390 px). */
async function fingerScroll(page, dialog) {
  const box = await dialog.boundingBox();
  const before = await dialog.evaluate((el) => el.scrollTop);
  const cdp = await page.context().newCDPSession(page);
  const at = (x, y) => [{ x, y, id: 1 }];
  const x = box.x + box.width / 2;
  const y0 = box.y + box.height - 60;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(x, y0) });
  for (let i = 1; i <= 12; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(x, y0 - i * 25) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(500);
  return (await dialog.evaluate((el) => el.scrollTop)) > before;
}

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
  const engine = scheme === "light" ? "open" : "cloud";
  await ctx.addInitScript((e) => localStorage.setItem("fuobe.engine", e), engine);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);

  // 1. Character Sheet
  await page.goto(`${app}/character-sheet`, { waitUntil: "load", timeout: 120_000 });
  const open = page.getByRole("button", { name: /^Turnaround video/ });
  await open.waitFor({ timeout: 60_000 });
  check(`${tag}: Character Sheet offers "Turnaround video" on the finished sheet`, true);
  check(`${tag}: no sideways scroll on Character Sheet`, (await sideways(page)) <= 1);
  await open.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByText(/^Views$/).waitFor();
  const price = dialog.getByText(engine === "open" ? /Free · on your GPU|Placeholder · free/ : /Placeholder · free|≈ \$/);
  await price.waitFor({ timeout: 30_000 });
  const text = await dialog.innerText();
  check(`${tag}: the five slots (Front, Right side, Back, Left side, Sheet)`, ["Front", "Right side", "Back", "Left side", "Sheet"].every((s) => text.includes(s)), text.slice(0, 200));
  check(`${tag}: the person's own left and right are explained`, /their right side is on your left/.test(text));
  const priceText = await price.innerText();
  check(`${tag}: the price or GPU line shows before running`, (engine === "open" ? /Free · on your GPU|Placeholder · free/ : /Placeholder · free|≈ \$\d/).test(priceText), priceText);
  check(`${tag}: the consent line is asked for (photos someone brought)`, /I consent to this biometric data processing/.test(text));
  const make = dialog.getByRole("button", { name: /Make turnaround/ });
  check(`${tag}: Make turnaround waits for the consent line`, await make.isDisabled());
  check(`${tag}: the blocker says why`, /Confirm the consent line first/.test(text));
  check(`${tag}: no sideways scroll with the dialog open`, (await sideways(page)) <= 1);
  const walked = await focusWalk(page, dialog);
  check(
    `${tag}: keyboard focus reaches the slots, the switches, the chips and the consent box`,
    /Front: /.test(walked) && /Left side: /.test(walked) && /switch:Draw the missing sides/.test(walked) && /radio:/.test(walked) && /checkbox:I confirm the consent line/.test(walked),
    walked,
  );
  if (phone) check(`${tag}: a finger drag scrolls the dialog`, await fingerScroll(page, dialog));
  await shoot(page, `sheet-dialog-${size}-${scheme}`);
  // Flip "Draw the missing sides": the right side's slot goes from drawn first to not used (or back), then returns.
  const fillSwitch = dialog.getByRole("switch", { name: "Draw the missing sides" });
  const rightSlot = dialog.getByRole("button", { name: /^Right side: / });
  const slotState = async () => (await rightSlot.getAttribute("aria-label")).replace(/^Right side: | — change$/g, "");
  const was = { on: await fillSwitch.getAttribute("aria-checked"), slot: await slotState() };
  await fillSwitch.click();
  const flipped = await until(
    async () => ((await fillSwitch.getAttribute("aria-checked")) !== was.on && (await slotState()) !== was.slot ? await slotState() : null),
    "the plan to change with Draw the missing sides",
    20_000,
  ).catch(() => null);
  check(`${tag}: Draw the missing sides changes the plan (right side: ${was.slot} → ${flipped ?? "unchanged"})`, !!flipped && /drawn first|not used/.test(`${was.slot} ${flipped}`));
  await fillSwitch.click();
  const back = await until(async () => ((await slotState()) === was.slot ? true : null), "the plan to return", 20_000).catch(() => false);
  check(`${tag}: switching it back restores the plan`, back);
  if (engine === "cloud") {
    const routes = dialog.getByRole("radiogroup", { name: "Route" });
    await routes.waitFor();
    check(`${tag}: the cloud offers References, Keyframes and Camera path`, /References[\s\S]*Keyframes[\s\S]*Camera path/.test(await routes.innerText()));
  }
  await dialog.getByRole("checkbox", { name: "I confirm the consent line" }).click();
  await until(async () => !(await make.isDisabled()), "Make turnaround to be ready", 20_000).catch(async (e) => {
    console.log((await dialog.innerText()).slice(-600));
    await shoot(page, `stuck-${size}-${scheme}`);
    throw e;
  });
  check(`${tag}: with the consent line ticked, Make turnaround is ready`, true);
  if (size === "1440" && scheme === "light") {
    await make.click();
    await dialog.getByRole("status").first().waitFor();
    check(`${tag}: progress shows while it renders`, /steps done/.test(await dialog.innerText()));
    const film = dialog.locator("video");
    await film.waitFor({ timeout: 120_000 });
    const filmSrc = await film.getAttribute("src");
    check(`${tag}: the film is in the dialog when it's done`, !!filmSrc && filmSrc.startsWith("/api/files/"), filmSrc ?? "no src");
    await shoot(page, "sheet-done");
    const lib = (await call("/api/generations?features=turnaround&limit=10")).items ?? [];
    check(`${tag}: the film is in the feed (Turnaround · in the Library's list)`, lib.some((g) => g.op === "concat" && g.status === "succeeded"), JSON.stringify(lib.map((g) => [g.op, g.status])));
    await page.keyboard.press("Escape");
    check(`${tag}: the button says it's ready`, /ready/.test(await page.getByRole("button", { name: /^Turnaround video/ }).innerText()));
  } else await page.keyboard.press("Escape");

  // 2. A character's page
  await page.goto(`${app}/elements/${elementId}`, { waitUntil: "load", timeout: 120_000 });
  const fly = page.getByRole("button", { name: /^Fly around/ });
  await fly.waitFor({ timeout: 60_000 });
  check(`${tag}: a character's page offers Fly around`, true);
  check(`${tag}: no sideways scroll on the character's page`, (await sideways(page)) <= 1);
  await fly.click();
  const flyDialog = page.getByRole("dialog");
  await flyDialog.getByText(/^Fly around Ada Turn/).waitFor();
  await flyDialog.getByText(engine === "open" ? /Free · on your GPU|Placeholder · free/ : /Placeholder · free|≈ \$/).waitFor({ timeout: 30_000 });
  if (engine === "cloud") {
    await flyDialog.getByRole("radio", { name: "Camera path" }).click();
    const paths = flyDialog.getByRole("radiogroup", { name: "Path" });
    await paths.waitFor();
    check(`${tag}: the camera path offers Orbit 360° and N7-5's moves`, /Orbit 360°[\s\S]*Arc 90° left[\s\S]*Tilted ring/.test(await paths.innerText()));
    await flyDialog.getByRole("radio", { name: "Tilted ring" }).click();
    check(`${tag}: a move is picked`, (await flyDialog.getByRole("radio", { name: "Tilted ring" }).getAttribute("aria-checked")) === "true");
  }
  const flyText = await flyDialog.innerText();
  check(`${tag}: a character always asks the consent line (no "A real person" switch to turn it off)`, /I consent to this biometric data processing/.test(flyText) && !(await flyDialog.getByRole("switch", { name: "These pictures show a real person" }).count()));
  check(`${tag}: no sideways scroll with Fly around open`, (await sideways(page)) <= 1);
  if (phone) check(`${tag}: a finger drag scrolls Fly around`, await fingerScroll(page, flyDialog));
  await shoot(page, `fly-${size}-${scheme}`);
  if (size === "1440" && scheme === "dark") {
    await flyDialog.getByRole("checkbox", { name: "I confirm the consent line" }).click();
    const go = flyDialog.getByRole("button", { name: /^Fly around$/ });
    await until(async () => !(await go.isDisabled()), "Fly around to be ready");
    await go.click();
    await flyDialog.getByRole("status").first().waitFor();
    const feed = await until(async () => {
      const items = (await call(`/api/generations?features=element:${elementId}&limit=20`)).items ?? [];
      return items.find((g) => g.op === "camera-path") ?? null;
    }, "the fly-around in the character's feed");
    check(`${tag}: Fly around lands in the character's feed`, !!feed, feed?.modelId);
    // The cloud run's film comes back to the dialog too (the demo provider stands in for fal).
    const flyFilm = flyDialog.locator("video");
    await flyFilm.waitFor({ timeout: 120_000 });
    check(`${tag}: the cloud film shows in the dialog`, ((await flyFilm.getAttribute("src")) ?? "").startsWith("/api/files/"));
  }
  await page.keyboard.press("Escape");

  // 3. Cinema's Soul Cast (once per width)
  if (scheme === "light") {
    await page.goto(`${app}/cinema/${project.id}`, { waitUntil: "load", timeout: 120_000 });
    const chip = page.getByRole("button", { name: "Soul Cast: build a character" }).locator("visible=true").first();
    const director = page.getByRole("button", { name: /^Director/ }).locator("visible=true").first();
    await sleep(1500);
    if (!(await chip.count()) && (await director.count())) await director.click();
    await chip.click();
    const cast = page.getByRole("dialog").filter({ hasText: /Build your cast/ });
    await cast.waitFor();
    await cast.getByRole("button", { name: /Generate character/ }).click();
    const turn = cast.getByRole("button", { name: /^Turnaround video/ });
    await turn.waitFor({ timeout: 90_000 });
    check(`${tag}: Soul Cast results offer "Turnaround video"`, true);
    await turn.click();
    const td = page.getByRole("dialog").filter({ hasText: /^Turnaround video/ });
    await td.getByText(/Free · on your GPU|Placeholder · free/).waitFor({ timeout: 30_000 });
    check(`${tag}: no consent line for a Soul Cast character`, !/I consent to this biometric/.test(await td.innerText()));
    check(`${tag}: no sideways scroll over Soul Cast`, (await sideways(page)) <= 1);
    await shoot(page, `cast-${size}`);
    if (!phone) {
      await td.getByRole("button", { name: /Make turnaround/ }).click();
      await td.getByRole("status").first().waitFor();
      const take = await until(async () => {
        const items = (await call(`/api/cinema/projects/${project.id}/items`)).items ?? [];
        return items.find((g) => g.feature === "cinema-turnaround" && g.op === "concat") ?? null;
      }, "the turnaround take");
      check(`${tag}: the turnaround is a take in the project`, !!take);
    }
    await page.keyboard.press("Escape");
  }
  await ctx.close();
}

await browser.close();
console.log(failures ? `${failures} check(s) failed` : "all checks passed");
process.exit(failures ? 1 : 0);
