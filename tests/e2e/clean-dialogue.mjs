// Browser check of Split soundtrack → Clean up dialogue (DBS D5).
// Usage: node tests/e2e/clean-dialogue.mjs [appUrl] [outDir]   (the app in demo mode: no keys, no ComfyUI)
// Checks, at 1440 px and 390 px in light and dark: /audio/split?preset=clean-dialogue opens on Clean up dialogue; with a
// clip in, the open engine offers the level under the dialogue (−18 dB picked), says what it removes and how it relates
// to Clean up voice, and prices it Free; the cloud engine offers VEED, DeepFilterNet 3 and ElevenLabs with a price and
// says it gives the voice alone; no sideways scroll and no console errors. Then one demo run on the open engine gives a
// result, "Fine-tune in the mixer" switches to Split into stems, and a split's mixer opens on the Clean dialogue preset
// (and back on Original once Split into stems is picked by hand after visiting Clean up dialogue);
// last, a result's actions menu in the Library offers "Clean up dialogue". Screenshots go to outDir.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DESKTOP, PHONE, launch, openRoute } from "./_browser.mjs";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const app = args[0] ?? "http://localhost:3000";
const out = args[1] ?? fs.mkdtempSync("/tmp/fuobe-clean-dialogue-");
fs.mkdirSync(out, { recursive: true });

const wav = path.join(out, "clean-source.wav");
const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "aevalsrc=0.2*sin(2*PI*330*t)|0.2*sin(2*PI*440*t):s=44100:d=6", wav]);
if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
};
async function noSideScroll(page, label) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 0, `${label}: no horizontal scroll (${over}px)`);
}
async function setup(browser, device, theme, engine) {
  const ctx = await browser.newContext({ ...device, colorScheme: theme });
  await ctx.addInitScript(([e]) => localStorage.setItem("fuobe.engine", e), [engine]);
  return ctx;
}
function watchConsole(page, label) {
  page.on("console", (m) => m.type() === "error" && check(false, `${label}: console error: ${m.text().slice(0, 200)}`));
  page.on("pageerror", (e) => check(false, `${label}: page error: ${e.message.slice(0, 200)}`));
}

const browser = await launch();
try {
  for (const [dname, device] of [
    ["1440", DESKTOP],
    ["390", PHONE],
  ]) {
    for (const theme of ["light", "dark"]) {
      const label = `${dname} ${theme}`;
      const ctx = await setup(browser, device, theme, "open");
      const page = await ctx.newPage();
      watchConsole(page, label);
      await openRoute(page, `${app}/audio/split?preset=clean-dialogue`);
      const opened = await page.getByRole("heading", { name: "Clean up dialogue" }).first().waitFor({ timeout: 30_000 }).then(() => true, () => false);
      check(opened, `${label}: the preset opens on Clean up dialogue`);
      check((await page.getByRole("radio", { checked: true, name: "Clean up dialogue" }).count()) === 1, `${label}: Clean up dialogue is the picked task`);
      await noSideScroll(page, `${label} empty`);
      await page.locator('input[type="file"]').setInputFiles(wav);
      await page.getByText(/^Free$|Placeholder · free/).first().waitFor({ timeout: 60_000 });
      check(await page.getByRole("radio", { checked: true, name: "−18 dB" }).isVisible(), `${label}: the music and effects stay at −18 dB by default`);
      check(await page.getByText("Removes music and sound effects. For hiss and hum, use Clean up voice or a cloud cleaner.").isVisible(), `${label}: says what the open route removes`);
      check(await page.getByRole("link", { name: "Clean up voice" }).first().isVisible(), `${label}: points to Clean up voice and says how they relate`);
      await page.screenshot({ path: path.join(out, `clean-open-${dname}-${theme}.png`), fullPage: true });
      await noSideScroll(page, `${label} open engine`);
      // The cloud engine: the header's switch.
      await page.getByRole("radiogroup", { name: "Engine" }).getByRole("radio", { name: "Cloud" }).click();
      await page.getByRole("radio", { name: "Clean (VEED)" }).waitFor({ timeout: 60_000 });
      for (const n of ["Denoise (DeepFilterNet 3)", "Voice only (ElevenLabs)"]) check(await page.getByRole("radio", { name: n }).isVisible(), `${label}: offers ${n}`);
      check(await page.getByText("The cloud gives the clean voice on its own, with no music or effects under it.").isVisible(), `${label}: says the cloud gives the voice alone`);
      await page.getByText("Removes background noise and levels the voice. Keeps quiet and distant words.").nth(1).waitFor({ timeout: 60_000 });
      check(!(await page.getByText(/^Takes the music/).count()), `${label}: the cloud's summary is the cleaner's, not the open engine's`);
      await page.getByText(/≈ \$|under \$0\.01|Placeholder · free/).first().waitFor({ timeout: 60_000 });
      check(true, `${label}: the cloud cleaner is priced: ${(await page.getByText(/≈ \$|under \$0\.01|Placeholder · free/).first().innerText()).trim()}`);
      await page.screenshot({ path: path.join(out, `clean-cloud-${dname}-${theme}.png`), fullPage: true });
      await noSideScroll(page, `${label} cloud engine`);
      await ctx.close();
    }
  }

  // ---- One demo run on the open engine, then the mixer on its preset.
  const ctx = await setup(browser, DESKTOP, "light", "open");
  const page = await ctx.newPage();
  watchConsole(page, "run");
  await openRoute(page, `${app}/audio/split?preset=clean-dialogue`);
  await page.locator('input[type="file"]').setInputFiles(wav);
  await page.getByText(/^Free$|Placeholder · free/).first().waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "Clean it" }).click();
  await page.getByRole("button", { name: "Fine-tune in the mixer" }).waitFor({ timeout: 40_000 });
  check(await page.getByLabel("Play the clean dialogue").isVisible(), "run: the clean dialogue plays on the page");
  await page.screenshot({ path: path.join(out, "clean-result.png"), fullPage: true });
  await page.getByRole("button", { name: "Fine-tune in the mixer" }).click();
  await page.getByRole("button", { name: "Split it" }).click();
  await page.getByRole("heading", { name: "Stems and mixer" }).waitFor({ timeout: 40_000 });
  check((await page.getByRole("radio", { checked: true, name: "Clean dialogue (−18 dB)" }).count()) === 1, "run: the mixer opens on the Clean dialogue preset");
  await page.screenshot({ path: path.join(out, "clean-mixer.png"), fullPage: true });
  // Visiting Clean up dialogue and then picking Split into stems yourself puts the mixer back on the original mix.
  await page.getByRole("radio", { name: "Clean up dialogue" }).click();
  await page.getByRole("radio", { name: "Split into stems" }).click();
  await page.getByRole("heading", { name: "Stems and mixer" }).waitFor({ timeout: 40_000 });
  check(
    await page.getByRole("radio", { checked: true, name: "Original", exact: true }).waitFor({ timeout: 20_000 }).then(() => true, () => false),
    "run: Split into stems picked after Clean up dialogue opens the mixer on Original",
  );

  // ---- The hand-off on a result: the Library's actions menu (a phone's ⋯ button on each tile).
  const phone = await setup(browser, PHONE, "dark", "open");
  const lib = await phone.newPage();
  watchConsole(lib, "library");
  await openRoute(lib, `${app}/library`);
  const more = lib.getByRole("button", { name: "More actions", exact: true }).first();
  await more.waitFor({ timeout: 30_000 });
  await more.click();
  const item = lib.getByRole("menuitem", { name: "Clean up dialogue" });
  check(await item.waitFor({ timeout: 10_000 }).then(() => true, () => false), "library: a result's menu offers Clean up dialogue");
  await lib.screenshot({ path: path.join(out, "clean-chip-390.png") });
  await item.click();
  await lib.waitForURL(/\/audio\/split\?.*preset=clean-dialogue/, { timeout: 30_000 });
  check(await lib.getByRole("radio", { checked: true, name: "Clean up dialogue" }).waitFor({ timeout: 30_000 }).then(() => true, () => false), "library: the chip opens Split soundtrack on Clean up dialogue with the file in");
  await noSideScroll(lib, "library hand-off 390");
  await phone.close();
  await ctx.close();
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} failure(s)` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
