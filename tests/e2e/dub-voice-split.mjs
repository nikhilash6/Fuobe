// Browser check of Translate & dub's Voice split (DBS D3).
// Usage: node tests/e2e/dub-voice-split.mjs [appUrl] [outDir]   (the app in demo mode: no keys, no ComfyUI)
// Checks, at 1440 px and 390 px in light and dark: the open engine's Voice split (MelBand RoFormer by default, DBS
// with "Keeps the music and sound effects of the original"), the route line and the price line following it; the
// cloud engine's Demucs note, its line that DBS runs on your GPU, and no Voice split; no sideways scroll. Then a DBS
// dub in demo mode: its first step runs on DBS + Qwen3-ASR. Screenshots go to outDir.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DESKTOP, PHONE, launch, openRoute } from "./_browser.mjs";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const app = args[0] ?? "http://localhost:3000";
const out = args[1] ?? fs.mkdtempSync("/tmp/fuobe-dub-split-");
fs.mkdirSync(out, { recursive: true });

// A 4 s video with a tone as its soundtrack.
const mp4 = path.join(out, "dub-source.mp4");
const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=24:d=4", "-f", "lavfi", "-i", "sine=f=330:d=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", mp4]);
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
const setup = async (browser, device, theme, engine) => {
  const ctx = await browser.newContext({ ...device, colorScheme: theme });
  await ctx.addInitScript(([e]) => localStorage.setItem("fuobe.engine", e), [engine]);
  // Connect your GPU's card looks for a ComfyUI on this computer: it reaches nothing but the app.
  await ctx.route((u) => u.origin !== new URL(app).origin && /^https?:$/.test(u.protocol), (rt) => rt.abort());
  return ctx;
};
const PRICE = /Placeholder · free|Free on your GPU/;

const browser = await launch();
try {
  for (const [dname, device] of [
    ["1440", DESKTOP],
    ["390", PHONE],
  ]) {
    for (const theme of ["light", "dark"]) {
      const label = `${dname} ${theme}`;
      // ---- Open engine: the Voice split.
      let ctx = await setup(browser, device, theme, "open");
      let page = await ctx.newPage();
      await openRoute(page, `${app}/audio/translate`);
      await page.locator('input[type="file"]').setInputFiles(mp4);
      await page.getByText(PRICE).first().waitFor({ timeout: 30_000 });
      const split = page.getByRole("combobox", { name: "Voice split" });
      check(await split.isVisible(), `${label}: the open engine shows a Voice split`);
      check((await split.innerText()).includes("MelBand RoFormer"), `${label}: MelBand RoFormer is the default`);
      check(await page.getByText("Music model: some sound effects may be lowered, and singing may be replaced.").isVisible(), `${label}: MelBand says what a music model does`);
      await page.screenshot({ path: path.join(out, `dub-open-melband-${dname}-${theme}.png`), fullPage: true });
      await split.click();
      await page.getByRole("option", { name: "DBS: keeps music and effects, CPU-friendly" }).click();
      check(await page.getByText("Keeps the music and sound effects of the original.").isVisible(), `${label}: DBS keeps the music and sound effects`);
      check(await page.getByText(/Open source: DBS splits the dialogue from the music and effects/).isVisible(), `${label}: the route line follows the split`);
      await page.getByText(PRICE).first().waitFor({ timeout: 20_000 });
      const price = await page.getByText(PRICE).first().innerText();
      check(PRICE.test(price), `${label}: the price line with DBS reads "${price}"`);
      await page.screenshot({ path: path.join(out, `dub-open-dbs-${dname}-${theme}.png`), fullPage: true });
      await noSideScroll(page, `${label} open`);
      await ctx.close();

      // ---- Cloud engine: Demucs, no Voice split.
      ctx = await setup(browser, device, theme, "cloud");
      page = await ctx.newPage();
      await openRoute(page, `${app}/audio/translate`);
      check(await page.getByText("Music and effects: Demucs. Music model: some sound effects may be lowered, and singing may be replaced.").isVisible(), `${label}: the cloud names Demucs and what it does`);
      check(await page.getByText("Keeping the music and sound effects of the original (DBS) runs on your GPU (open source).").isVisible(), `${label}: the cloud says DBS runs on your GPU`);
      check((await page.getByRole("combobox", { name: "Voice split" }).count()) === 0, `${label}: no Voice split on the cloud`);
      await page.screenshot({ path: path.join(out, `dub-cloud-${dname}-${theme}.png`), fullPage: true });
      await noSideScroll(page, `${label} cloud`);
      await ctx.close();
    }
  }

  // ---- A DBS dub in demo mode: its first step runs on DBS + Qwen3-ASR.
  const ctx = await setup(browser, DESKTOP, "light", "open");
  const page = await ctx.newPage();
  await openRoute(page, `${app}/audio/translate`);
  await page.locator('input[type="file"]').setInputFiles(mp4);
  await page.getByText(PRICE).first().waitFor({ timeout: 30_000 });
  await page.getByRole("combobox", { name: "Voice split" }).click();
  await page.getByRole("option", { name: /^DBS/ }).click();
  await page.getByRole("button", { name: "Translate" }).click();
  await page.getByText("Voice, background and transcript").first().waitFor({ timeout: 30_000 });
  check(await page.getByText("DBS + Qwen3-ASR").first().isVisible(), "a DBS dub's first step runs on DBS + Qwen3-ASR");
  await page.screenshot({ path: path.join(out, "dub-session-dbs-1440.png"), fullPage: true });
  await ctx.close();
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
