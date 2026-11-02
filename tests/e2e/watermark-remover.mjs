// Browser check of the Watermark Remover app (its own page: scan, keep, remove, compare, brush, download).
// Usage: node tests/e2e/watermark-remover.mjs [appUrl] [outDir] [--guest guestAppUrl]
//   appUrl: the app in demo mode (no keys; COMFYUI_URL pointing at nothing), signed in as the owner.
//   --guest: the same build with public sign-up on, seen signed out.
// Checks, at 390 x 844 (taps) and 1440 px: the start screen; a photo added is scanned at once and its marks show with Text and
// Logo chips; a tap keeps a mark ("Remove 1"); Remove gives the result; a tap flips Before and After and a held press shows
// Before until it lets go; "Brush it" opens the brush and a stroke makes another pass (Undo then shows); Download is the PNG;
// ?image= scans at once; an empty scan says so and offers the brush; no sideways scroll; and, with --guest, that a guest
// is asked to sign up. Screenshots go to outDir. A page error fails the run.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DESKTOP, PHONE, launch, openRoute } from "./_browser.mjs";

const argv = process.argv.slice(2);
const guestAt = argv.indexOf("--guest");
const guestApp = guestAt >= 0 ? argv[guestAt + 1] : null;
const args = argv.filter((a, i) => !a.startsWith("--") && i !== guestAt + 1);
const app = args[0] ?? "http://localhost:3000";
const out = args[1] ?? fs.mkdtempSync("/tmp/fuobe-watermark-");
fs.mkdirSync(out, { recursive: true });
const PAGE = "/apps/app-watermark-remover";

// A 1200 x 900 test photo.
const photo = path.join(out, "photo.png");
const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1200x900:d=1", "-frames:v", "1", photo]);
if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
};
const noSideScroll = async (page, label) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 0, `${label}: no horizontal scroll (${over}px)`);
};
async function setup(browser, device, theme = "light", base = app) {
  const ctx = await browser.newContext({ ...device, colorScheme: theme, acceptDownloads: true });
  ctx.on("page", (p) => p.on("pageerror", (e) => check(false, `${theme}: no page error (${String(e.message).slice(0, 160)})`)));
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("fuobe.engine", "open");
    } catch {}
  });
  // Nothing but the app.
  await ctx.route((u) => u.origin !== new URL(base).origin && /^https?:$/.test(u.protocol), (rt) => rt.abort());
  return ctx;
}
async function waitPhase(page, want, ms = 45_000) {
  await page.waitForFunction((w) => w.includes(document.querySelector("[data-wm-phase]")?.getAttribute("data-wm-phase") ?? ""), want, { timeout: ms });
}
/** A tap at the middle of an element (a touch on the phone, a click on the desktop). */
async function tapAt(page, locator, touch) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("not on screen");
  if (touch) await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
  else await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

const browser = await launch();
try {
  for (const [dname, device, theme] of [
    ["390", PHONE, "dark"],
    ["1440", DESKTOP, "light"],
  ]) {
    const touch = dname === "390";
    const label = `${dname} ${theme}`;
    const ctx = await setup(browser, device, theme);
    const page = await ctx.newPage();
    await openRoute(page, `${app}${PAGE}`);
    check(await page.getByRole("heading", { name: "Clean up a photo" }).isVisible(), `${label}: the start screen says what it does`);
    check(await page.getByRole("button", { name: "Add a photo" }).isVisible(), `${label}: Add a photo`);
    check(await page.getByRole("button", { name: "From Library" }).isVisible(), `${label}: From Library`);
    await page.screenshot({ path: path.join(out, `wm-start-${dname}.png`), fullPage: true });
    await noSideScroll(page, `${label} start`);

    // Add a photo: it is scanned at once.
    await page.locator("[data-wm-file]").setInputFiles(photo);
    await waitPhase(page, ["scanning", "regions"]);
    await page.screenshot({ path: path.join(out, `wm-scanning-${dname}.png`) });
    await waitPhase(page, ["regions"]);
    check(await page.getByRole("heading", { name: "Found 2. Tap any you want to keep." }).isVisible(), `${label}: the header counts the marks`);
    const chips = await page.locator("[data-wm-chip]").allInnerTexts();
    check(chips.some((c) => c.includes("Text")) && chips.some((c) => c.includes("Logo")), `${label}: Text and Logo chips (${chips.join(" | ")})`);
    check((await page.locator("[data-wm-remove]").innerText()).includes("Remove 2"), `${label}: Remove 2`);
    await page.screenshot({ path: path.join(out, `wm-regions-${dname}.png`), fullPage: true });
    await noSideScroll(page, `${label} regions`);

    // Tap the logo on the picture: kept.
    await tapAt(page, page.locator('[data-wm-region="r2"]'), touch);
    check((await page.locator('[data-wm-region="r2"]').getAttribute("data-on")) === null, `${label}: a tap keeps the mark`);
    check((await page.locator("[data-wm-remove]").innerText()).includes("Remove 1"), `${label}: Remove 1`);
    check((await page.locator('[data-wm-chip="r2"]').getAttribute("aria-pressed")) === "true", `${label}: its chip says kept`);
    // Both kept: nothing to remove.
    await page.locator('[data-wm-chip="r1"]').click();
    check((await page.locator("[data-wm-remove]").innerText()).includes("Everything is kept") && (await page.locator("[data-wm-remove]").isDisabled()), `${label}: everything kept disables Remove`);
    await page.locator('[data-wm-chip="r1"]').click();
    await page.screenshot({ path: path.join(out, `wm-kept-${dname}.png`) });

    // Remove.
    await page.locator("[data-wm-remove]").click();
    await waitPhase(page, ["result"]);
    check(true, `${label}: the result shows`);
    const cmp = page.locator("[data-wm-compare]");
    check((await cmp.getAttribute("data-wm-compare")) === "after", `${label}: the result opens on After`);
    await tapAt(page, cmp, touch);
    check((await cmp.getAttribute("data-wm-compare")) === "before", `${label}: a tap shows Before`);
    await tapAt(page, cmp, touch);
    check((await cmp.getAttribute("data-wm-compare")) === "after", `${label}: another tap goes back to After`);
    const b = await cmp.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(450);
    check((await cmp.getAttribute("data-wm-compare")) === "before", `${label}: holding shows Before`);
    await page.mouse.up();
    check((await cmp.getAttribute("data-wm-compare")) === "after", `${label}: letting go shows After`);
    const dl = page.locator("[data-wm-download]");
    check(!!(await dl.getAttribute("download")) && /\.png$/.test(await dl.getAttribute("download")), `${label}: Download is a PNG (${await dl.getAttribute("download")})`);
    await page.screenshot({ path: path.join(out, `wm-result-${dname}.png`), fullPage: true });
    await noSideScroll(page, `${label} result`);

    // Brush a missed spot.
    await page.locator("[data-wm-brush]").click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ timeout: 15_000 });
    const canvas = dialog.locator("canvas").last();
    await canvas.waitFor({ timeout: 15_000 });
    const c = await canvas.boundingBox();
    await page.mouse.move(c.x + c.width * 0.3, c.y + c.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(c.x + c.width * 0.6, c.y + c.height * 0.55, { steps: 8 });
    await page.mouse.up();
    await page.screenshot({ path: path.join(out, `wm-brush-${dname}.png`) });
    await dialog.getByRole("button", { name: /^Use this/ }).click();
    await waitPhase(page, ["removing", "result"]);
    await page.waitForFunction(() => document.querySelector("[data-wm-phase]")?.getAttribute("data-wm-phase") === "result" && [...document.querySelectorAll("button")].some((x) => x.textContent?.includes("Undo")), null, { timeout: 45_000 });
    check(true, `${label}: a brushed pass makes a new result, with Undo`);
    await ctx.close();
  }

  // ?image= hand-off: scanned at once.
  {
    const items = (await (await fetch(`${app}/api/generations?features=app:app-watermark-remover&statuses=succeeded&limit=1`)).json()).items ?? [];
    const url = items[0]?.outputs?.[0]?.url;
    check(!!url, "a result is in the Library");
    const ctx = await setup(browser, PHONE);
    const page = await ctx.newPage();
    await openRoute(page, `${app}${PAGE}?image=${encodeURIComponent(url)}`);
    await waitPhase(page, ["regions"]);
    check(true, "?image= scans at once and shows the marks");
    await page.screenshot({ path: path.join(out, "wm-handoff-390.png") });
    await ctx.close();
  }

  // An empty scan: the report says nothing was found (the live stream is cut so the poll carries the answer).
  {
    const ctx = await setup(browser, PHONE);
    await ctx.route("**/api/generations/stream", (rt) => rt.abort());
    await ctx.route(/\/api\/generations\/[^/?]+$/, async (rt) => {
      if (rt.request().url().endsWith("/stream")) return rt.abort();
      if (rt.request().method() !== "GET") return rt.continue();
      const res = await rt.fetch();
      const g = await res.json();
      if (g?.op === "watermark-scan" && g.status === "succeeded") g.outputs = g.outputs.map((o) => (o.kind === "text" ? { ...o, text: JSON.stringify({ coordinate_space: "pixels", image_size: [1200, 900], boxes: [], rejected_boxes: [], status: "no_overlay_detected" }) } : o));
      await rt.fulfill({ response: res, json: g });
    });
    const page = await ctx.newPage();
    await openRoute(page, `${app}${PAGE}`);
    await page.locator("[data-wm-file]").setInputFiles(photo);
    await waitPhase(page, ["empty"]);
    check(await page.getByText("Nothing to remove found. Brush the area you want gone.").isVisible(), "an empty scan says so");
    check(await page.getByRole("button", { name: "Brush it" }).isVisible(), "and offers the brush");
    await page.screenshot({ path: path.join(out, "wm-empty-390.png") });
    await noSideScroll(page, "390 empty");
    await ctx.close();
  }

  // A guest is asked to sign up before a photo goes anywhere.
  if (guestApp) {
    const ctx = await setup(browser, PHONE, "light", guestApp);
    const page = await ctx.newPage();
    await openRoute(page, `${guestApp}${PAGE}`);
    check(await page.getByRole("heading", { name: "Clean up a photo" }).isVisible(), "guest: the start screen");
    const chooser = page.waitForEvent("filechooser", { timeout: 3000 }).then(() => true).catch(() => false);
    await page.getByRole("button", { name: "Add a photo" }).click();
    const asked = await page
      .getByText("Create a free account to add your own files")
      .first()
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    check(asked, "guest: Add a photo asks to create an account");
    check(!(await chooser), "guest: no file chooser opens");
    await page.screenshot({ path: path.join(out, "wm-guest-390.png") });
    // ?image= from a link: the scan is a run, so the guest gets the run's card and the page says it in words.
    await openRoute(page, `${guestApp}${PAGE}?image=${encodeURIComponent("/previews/presets/app-remove-background.jpg")}`);
    const runCard = await page
      .getByText("Create a free account to run this")
      .first()
      .waitFor({ timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    check(runCard, "guest: a hand-off asks to create an account to run it");
    await page.screenshot({ path: path.join(out, "wm-guest-handoff-390.png") });
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll checks passed");
process.exitCode = failures.length ? 1 : 0;
