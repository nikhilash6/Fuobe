// Browser check of Clean up voice (NVIDIA RE-USE): the Audio mode and the app.
// Usage: node tests/e2e/clean-voice.mjs [appUrl] [outDir] [--guest guestAppUrl]
//   appUrl: the app in demo mode (no keys; COMFYUI_URL pointing at nothing or a fake ComfyUI), signed in as the owner.
//   --guest: the same build with public sign-up on, seen signed out.
// Checks, at 1440 px and 390 px in light and dark: the empty tool with the demo player (it plays, the Before / After switch
// and the B / A keys swap sides at the same moment, the divider moves), the cloud engine's "runs on your GPU" note, the
// open engine's options and price, no sideways scroll; one audio run and one video run with "Put back on the video" (two
// Library items); the app page; the Library's Clean up voice action; the Canvas node; the switch on Lipsync's voice slot;
// and, with --guest, that a guest hears the demo and an upload asks to sign up. Screenshots go to outDir.
// The demo player shows only once DEMO_READY is set (a person has listened to the pairs): until then the checks see that
// it is absent. A page error (a hydration error included) fails the run.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DESKTOP, PHONE, launch, openRoute } from "./_browser.mjs";

const argv = process.argv.slice(2);
const guestAt = argv.indexOf("--guest");
const guestApp = guestAt >= 0 ? argv[guestAt + 1] : null;
const args = argv.filter((a, i) => !a.startsWith("--") && i !== guestAt + 1);
const app = args[0] ?? "http://localhost:3000";
const out = args[1] ?? fs.mkdtempSync("/tmp/fuobe-clean-voice-");
fs.mkdirSync(out, { recursive: true });

// A 6 s voice-like clip with hiss (bursts of a harmonic tone), and a 6 s video with it as its soundtrack.
const wav = path.join(out, "clean-source.wav");
const mp4 = path.join(out, "clean-source.mp4");
const ff = (a) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
};
ff(["-f", "lavfi", "-i", "aevalsrc=0.25*gt(sin(2*PI*1.5*t)\\,0)*(sin(2*PI*180*t)+0.4*sin(2*PI*360*t))+0.02*(random(0)-0.5):s=44100:d=6", wav]);
ff(["-f", "lavfi", "-i", "testsrc2=s=320x180:r=24:d=6", "-i", wav, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", mp4]);

// The demo shows once a person has listened to its pairs (src/lib/av/clean-voice.ts).
const DEMO_READY = /export const DEMO_READY = true/.test(fs.readFileSync(new URL("../../src/lib/av/clean-voice.ts", import.meta.url), "utf8"));

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
};
const noSideScroll = async (page, label) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 0, `${label}: no horizontal scroll (${over}px)`);
};
/** Page errors (React's hydration errors among them) fail the check. */
const watchErrors = (page, label) => page.on("pageerror", (e) => check(false, `${label}: no page error (${String(e.message).slice(0, 160)})`));
async function setup(browser, device, theme, engine) {
  const ctx = await browser.newContext({ ...device, colorScheme: theme });
  ctx.on("page", (p) => watchErrors(p, `${engine} ${theme}`));
  // (Init scripts run in every frame, about:blank too, where localStorage throws.)
  await ctx.addInitScript(
    ([e]) => {
      try {
        localStorage.setItem("fuobe.engine", e);
      } catch {}
    },
    [engine],
  );
  // Nothing but the app: a stray request to a local ComfyUI (8188…) is refused here.
  await ctx.route((u) => u.origin !== new URL(app).origin && (!guestApp || u.origin !== new URL(guestApp).origin) && /^https?:$/.test(u.protocol), (r) => r.abort());
  return ctx;
}
const clockOf = async (page, scope) => (await scope.locator("span.font-mono", { hasText: "/" }).first().innerText()).trim();

async function demoPlayer(page, label) {
  if (!DEMO_READY) {
    check((await page.getByText("Hear it first").count()) === 0, `${label}: no demo player until a person has listened to it`);
    return;
  }
  const player = page.getByLabel(/Before and after player/).first();
  await player.getByRole("button", { name: "Play" }).waitFor({ timeout: 20_000 });
  await page.waitForFunction(() => !document.querySelector('[aria-label^="Before and after player"] button[disabled]'), null, { timeout: 20_000 });
  check(await page.getByText("Sample and model: NVIDIA RE-USE (OpenMDW-1.1)", { exact: false }).isVisible(), `${label}: the demo credits NVIDIA RE-USE (OpenMDW-1.1)`);
  await player.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(900);
  const t1 = await clockOf(page, player);
  check(!t1.startsWith("0:00 /"), `${label}: the demo plays (${t1})`);
  // Switch to Before mid-play: the clock keeps running (one playhead), the divider shows the before whole.
  await player.getByRole("radio", { name: /Before/ }).click();
  await page.waitForTimeout(400);
  const t2 = await clockOf(page, player);
  check(t2 !== t1 && !t2.startsWith("0:00 /"), `${label}: Before keeps the same playhead (${t1} → ${t2})`);
  check((await player.getByRole("slider", { name: "Divider between before and after" }).getAttribute("aria-valuenow")) === "100", `${label}: the divider shows the before whole`);
  await player.focus();
  await page.keyboard.press("a");
  check((await player.getByRole("radio", { name: /After/ }).getAttribute("aria-checked")) === "true", `${label}: the A key switches to After`);
  await player.getByRole("button", { name: "Pause" }).click();
  const divider = player.getByRole("slider", { name: "Divider between before and after" });
  await divider.focus();
  await page.keyboard.press("ArrowRight");
  check((await divider.getAttribute("aria-valuenow")) === "5", `${label}: the divider moves with the keys`);
}

async function waitDone(feature, ms = 45_000) {
  const end = Date.now() + ms;
  for (;;) {
    const g = (await (await fetch(`${app}/api/generations?features=${feature}&limit=1`)).json()).items?.[0];
    if ((g && (g.status === "succeeded" || g.status === "failed")) || Date.now() > end) return g;
    await new Promise((r) => setTimeout(r, 800));
  }
}

const browser = await launch();
try {
  // ---- The empty tool and the options, at both widths and themes.
  for (const [dname, device] of [
    ["1440", DESKTOP],
    ["390", PHONE],
  ]) {
    for (const theme of ["light", "dark"]) {
      const label = `${dname} ${theme}`;
      const ctx = await setup(browser, device, theme, "cloud");
      const page = await ctx.newPage();
      await openRoute(page, `${app}/audio/clean`);
      check(await page.getByRole("heading", { name: "Clean up voice" }).first().isVisible(), `${label}: the empty tool says what it is`);
      check(await page.getByText("Add a voice recording or a video to clean").isVisible(), `${label}: the drop zone`);
      await demoPlayer(page, label);
      await page.screenshot({ path: path.join(out, `clean-empty-${dname}-${theme}.png`), fullPage: true });
      await noSideScroll(page, `${label} empty`);
      await page.locator('input[type="file"]').setInputFiles(wav);
      await page.getByText("Clean up voice runs on your GPU (open source).").waitFor({ timeout: 20_000 });
      check(true, `${label}: the cloud engine says Clean up voice runs on your GPU`);
      await page.screenshot({ path: path.join(out, `clean-cloud-${dname}-${theme}.png`), fullPage: true });
      await page.getByRole("button", { name: "Use open source" }).click();
      await page.getByText(/Free · runs on your ComfyUI|Demo · free/).waitFor({ timeout: 20_000 });
      for (const g of ["Strength", "Model", "Quality", "Background", "Level"]) check(await page.getByRole("radiogroup", { name: g }).isVisible(), `${label}: the ${g} control`);
      check((await page.getByRole("radio", { name: "Full", exact: true }).getAttribute("aria-checked")) === "true", `${label}: audio starts at Full strength`);
      await page.screenshot({ path: path.join(out, `clean-open-${dname}-${theme}.png`), fullPage: true });
      await noSideScroll(page, `${label} with a source`);
      await ctx.close();
    }
  }

  // ---- A run per source kind; a video goes back on the picture.
  for (const [kind, file, device, dname, theme] of [
    ["audio", wav, DESKTOP, "1440", "light"],
    ["video", mp4, PHONE, "390", "dark"],
  ]) {
    const ctx = await setup(browser, device, theme, "open");
    const page = await ctx.newPage();
    await openRoute(page, `${app}/audio/clean`);
    await page.locator('input[type="file"]').setInputFiles(file);
    await page.getByText(/Free · runs on your ComfyUI|Demo · free/).waitFor({ timeout: 30_000 });
    if (kind === "video") {
      check((await page.getByRole("radio", { name: "Remove everything but the voice" }).getAttribute("aria-checked")) === "true", "video: Remove everything but the voice is the default");
      check((await page.getByRole("radio", { name: "Natural", exact: true }).getAttribute("aria-checked")) === "true", "video: Natural strength is the default");
      check(await page.getByRole("switch", { name: /Put back on the video/ }).isChecked(), "video: Put back on the video is on");
    }
    await page.getByRole("button", { name: "Clean up voice" }).last().click();
    await page.getByText("Your before and after").waitFor({ timeout: 45_000 });
    const result = page.getByLabel(/Before and after player/).last();
    await result.getByRole("button", { name: "Play" }).waitFor({ timeout: 20_000 });
    check(await page.getByRole("link", { name: "Use in Lipsync" }).isVisible(), `${kind}: Use in Lipsync`);
    check(await page.getByRole("link", { name: "Download" }).isVisible(), `${kind}: Download`);
    const g = await waitDone("voice-clean");
    check(g?.status === "succeeded" && g.outputs?.[0]?.kind === "audio", `${kind}: the clean voice is in the Library (${g?.status})`);
    if (kind === "video") {
      const v = await waitDone("voice-clean-remux");
      check(v?.status === "succeeded" && v.outputs?.[0]?.kind === "video", `video: the clean video is in the Library too (${v?.status}, ${v?.modelId})`);
    }
    await noSideScroll(page, `${kind} result (${dname})`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, `clean-result-${kind}-${dname}.png`), fullPage: true });
    await ctx.close();
  }

  // ---- The app page, the Library action, the Canvas node and Lipsync's voice slot.
  {
    const ctx = await setup(browser, DESKTOP, "light", "open");
    const page = await ctx.newPage();
    await openRoute(page, `${app}/apps/app-clean-up-voice`);
    check(await page.getByRole("heading", { name: "Clean up voice" }).first().isVisible(), "app: the app page is the tool");
    check(await page.getByRole("link", { name: "Apps" }).first().isVisible(), "app: an Apps breadcrumb");
    await page.screenshot({ path: path.join(out, "clean-app-1440.png"), fullPage: true });
    const g = await waitDone("voice-clean", 1000);
    if (g) {
      await openRoute(page, `${app}/library`);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: path.join(out, "clean-library-1440.png") });
    }
    await openRoute(page, `${app}/lipsync`);
    await page.waitForTimeout(1200);
    const sw = page.getByRole("switch", { name: /Clean up voice/ });
    check(await sw.first().isVisible(), "lipsync: the voice slot offers Clean up voice");
    await page.screenshot({ path: path.join(out, "clean-lipsync-switch-1440.png") });
    // Off: the voice lands as it is. On: the voice already in the slot is cleaned, Generate waits meanwhile, and the slot
    // then holds the clean file.
    check(!(await sw.first().isChecked()), "lipsync: the switch starts off");
    await page.locator('[data-slot-key="audio"] input[type="file"]').setInputFiles(wav);
    await page.waitForTimeout(2500);
    check((await page.getByRole("status", { name: "Cleaning the voice" }).count()) === 0, "lipsync: with the switch off the voice isn't cleaned");
    await sw.first().click();
    // (Generate's "Waiting for the clean voice" ranks below a missing portrait: tests/clean-voice.test.ts covers it.)
    const cleaning = await page
      .getByRole("status", { name: "Cleaning the voice" })
      .waitFor({ timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    check(cleaning, "lipsync: turning the switch on cleans the voice already in the slot");
    check(await page.getByText("Cleaning the voice… about 20 s").first().isVisible().catch(() => false), "lipsync: the switch says in words that it is cleaning");
    const badge = page.getByRole("button", { name: "Clean voice: hear the original" });
    check(await badge.waitFor({ timeout: 45_000 }).then(() => true).catch(() => false), "lipsync: the slot holds the clean voice, with the original to compare");
    await badge.click();
    check(await page.getByLabel(/Before and after player/).last().isVisible(), "lipsync: the badge plays the original against the clean voice");
    await page.screenshot({ path: path.join(out, "clean-lipsync-cleaned-1440.png") });
    await page.keyboard.press("Escape");
    check(await page.getByRole("button", { name: /Clean voice · Hear original/ }).first().isVisible(), "lipsync: beside the switch, Clean voice · Hear original");
    await page.screenshot({ path: path.join(out, "clean-lipsync-status-1440.png") });
    // Off again: the slot goes back to the voice as it was added.
    await sw.first().click();
    const back = await badge
      .waitFor({ state: "detached", timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    check(back, "lipsync: turning the switch off puts the original back in the slot");
    await ctx.close();
  }
  {
    // Lipsync on a phone: the switch has its own line under the slot row, its label whole.
    const ctx = await setup(browser, PHONE, "light", "open");
    const page = await ctx.newPage();
    await openRoute(page, `${app}/lipsync`);
    await page.waitForTimeout(1200);
    const label = page.locator("label", { hasText: "Clean up voice" }).filter({ visible: true }).first();
    const box = await label.boundingBox();
    const width = await page.evaluate(() => document.documentElement.clientWidth);
    check(!!box && box.x >= 0 && box.x + box.width <= width, `lipsync 390: the switch label is whole on screen (${box ? Math.round(box.x + box.width) : "none"} of ${width} px)`);
    await noSideScroll(page, "lipsync 390");
    await page.screenshot({ path: path.join(out, "clean-lipsync-390.png") });
    await ctx.close();
  }
  {
    const ctx = await setup(browser, PHONE, "dark", "open");
    const page = await ctx.newPage();
    await openRoute(page, `${app}/apps/app-clean-up-voice`);
    await page.getByRole("heading", { name: "Clean up voice" }).first().waitFor({ timeout: 20_000 });
    await demoPlayer(page, "app 390");
    await noSideScroll(page, "app 390");
    await page.screenshot({ path: path.join(out, "clean-app-390-dark.png"), fullPage: true });
    await ctx.close();
  }
} finally {
  if (!guestApp) await browser.close();
}

// ---- A guest: the demo plays, an upload asks to sign up.
if (guestApp) {
  try {
    for (const [dname, device] of [
      ["1440", DESKTOP],
      ["390", PHONE],
    ]) {
      const ctx = await browser.newContext({ ...device, colorScheme: "light" });
      await ctx.route((u) => u.origin !== new URL(guestApp).origin && /^https?:$/.test(u.protocol), (r) => r.abort());
      const page = await ctx.newPage();
      watchErrors(page, `guest ${dname}`);
      for (const route of ["/apps/app-clean-up-voice", "/audio/clean"]) await openRoute(page, `${guestApp}${route}`);
      await page.waitForTimeout(1500);
      await demoPlayer(page, `guest ${dname}`);
      await page.getByRole("button", { name: "Upload" }).first().click();
      const card = page.getByText(/Create a free account/).first();
      check(await card.waitFor({ timeout: 10_000 }).then(() => true).catch(() => false), `guest ${dname}: Upload asks to create a free account`);
      await page.screenshot({ path: path.join(out, `clean-guest-${dname}.png`), fullPage: true });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

console.log(`\nScreenshots in ${out}`);
if (failures.length) {
  console.log(`${failures.length} failed`);
  process.exitCode = 1;
}
