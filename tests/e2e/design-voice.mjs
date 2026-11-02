// Browser check of Audio → Design a voice and the Dialogue voice picker.
// Usage: node tests/e2e/design-voice.mjs [appUrl] [outDir]
//   appUrl: the app in demo mode (FUOBE_DEMO_MODE=on, no keys, COMFYUI_URL pointing at nothing), signed in as the owner.
// Checks, at 1440 px and 390 px in light and dark: the tool's chips, the description the model hears, the price ("Free on
// your GPU"; the cloud's per-character price), VoxCPM2 refused on the cloud with the reason, no sideways scroll; three takes
// made (placeholders), one saved as a voice; the saved voice in the Dialogue picker and in Elements → Voices with what it
// was designed with. Screenshots go to outDir. A page error or a console error fails the run.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DESKTOP, PHONE, launch, openRoute } from "./_browser.mjs";

const app = process.argv[2] ?? "http://localhost:3440";
const out = process.argv[3] ?? fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-design-voice-"));
fs.mkdirSync(out, { recursive: true });

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
};
const noSideScroll = async (page, label) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 0, `${label}: no horizontal scroll (${over}px)`);
};
async function setup(browser, device, theme, engine) {
  const ctx = await browser.newContext({ ...device, colorScheme: theme });
  ctx.on("page", (p) => {
    p.on("pageerror", (e) => check(false, `${engine} ${theme}: no page error (${String(e.message).slice(0, 160)})`));
    p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && check(false, `${engine} ${theme}: no console error (${m.text().slice(0, 160)})`));
  });
  await ctx.addInitScript(
    ([e]) => {
      try {
        localStorage.setItem("fuobe.engine", e);
      } catch {}
    },
    [engine],
  );
  await ctx.route((u) => u.origin !== new URL(app).origin && /^https?:$/.test(u.protocol), (r) => r.abort());
  return ctx;
}

const browser = await launch();
try {
  // 1440 light, open engine: describe, make three takes, save one.
  {
    const ctx = await setup(browser, DESKTOP, "light", "open");
    const page = await ctx.newPage();
    await openRoute(page, `${app}/audio/design`);
    check(await page.getByRole("heading", { name: "Design a voice" }).isVisible(), "1440: the tool's heading");
    check(await page.getByRole("tab", { name: "Design a voice" }).or(page.getByRole("link", { name: "Design a voice" })).first().isVisible(), "1440: the Audio tab");
    await page.getByRole("group", { name: "Tone" }).getByRole("button", { name: "Warm", exact: true }).click();
    await page.getByRole("group", { name: "Age" }).getByRole("button", { name: "Older", exact: true }).click();
    await page.getByRole("group", { name: "Gender" }).getByRole("button", { name: "Male", exact: true }).click();
    await page.getByRole("group", { name: "Accent" }).getByRole("button", { name: "British", exact: true }).click();
    await page.getByLabel("Describe the voice in your own words").fill("a gravelly narrator with a smile in his voice");
    const heard = await page.getByText("The model hears:").locator("..").innerText();
    check(heard.includes("A warm, older male voice with a British accent. A gravelly narrator with a smile in his voice."), `1440: the description the model hears (${heard.slice(0, 120)})`);
    check(await page.getByText("Free on your GPU", { exact: true }).isVisible(), "1440: free on the open engine");
    await page.screenshot({ path: `${out}/design-1440-light.png`, fullPage: true });
    await page.getByRole("button", { name: /Make 3 (new )?takes/ }).click();
    const takes = page.locator("li").filter({ has: page.locator("audio") });
    await takes.nth(2).waitFor({ timeout: 60_000 });
    check((await takes.count()) === 3, "1440: three takes, each with a player");
    await takes.first().getByRole("button", { name: "Save as voice" }).click();
    await page.getByLabel("Voice name").fill("Old Narrator");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Saved", { exact: true }).first().waitFor({ timeout: 15_000 });
    check(true, "1440: a take saved as a voice");
    await noSideScroll(page, "1440 light");
    await page.screenshot({ path: `${out}/design-1440-light-takes.png`, fullPage: true });
    const saved = await (await fetch(`${app}/api/elements?kind=voice`)).json();
    const v = saved.items.find((e) => e.name === "Old Narrator");
    check(!!v && v.voice?.modelId === "oss-qwen3-tts" && /British accent/.test(v.voice?.description ?? "") && !!v.voice?.transcript && v.references[0]?.startsWith("/api/files/"), "the saved voice keeps its model, words, line and take");

    // Elements → Voices shows what it was designed with.
    await openRoute(page, `${app}/elements`);
    const card = page.getByText("Designed with Qwen3-TTS").first();
    await card.waitFor({ timeout: 15_000 }).catch(() => {});
    check(await card.isVisible().catch(() => false), "Elements: the voice says what it was designed with");
    await page.screenshot({ path: `${out}/elements-1440-light.png`, fullPage: true });

    // Dialogue's voice picker lists it.
    await openRoute(page, `${app}/audio/dialogue`);
    const pick = page.getByRole("button", { name: /add a sample|Speaker A/i }).first();
    await pick.click();
    const row = page.getByRole("button", { name: /Old Narrator/ }).first();
    await row.waitFor({ timeout: 10_000 }).catch(() => {});
    check(await row.isVisible().catch(() => false), "Dialogue: the saved voice is in the picker");
    check(await page.getByText("Designed with Qwen3-TTS").first().isVisible().catch(() => false), "Dialogue: with what it was designed with");
    await page.screenshot({ path: `${out}/dialogue-picker-1440-light.png` });
    await ctx.close();
  }
  // 1440 dark, cloud engine: VoxCPM2 refused with the reason; Qwen3-TTS priced per character.
  {
    const ctx = await setup(browser, DESKTOP, "dark", "cloud");
    const page = await ctx.newPage();
    await openRoute(page, `${app}/audio/design`);
    await page.getByRole("group", { name: "Tone" }).getByRole("button", { name: "Calm", exact: true }).click();
    const bar = page.locator("p[aria-live=polite]").last();
    const cloudPrice = await bar.innerText();
    check(/3 takes · (≈ \$|Price unknown|Under)/.test(cloudPrice), `1440 dark cloud: a price before running (${cloudPrice})`);
    await page.getByRole("radio", { name: /VoxCPM2/ }).click();
    check(await page.getByText("VoxCPM2 runs on your GPU (open source)").first().isVisible(), "1440 dark cloud: VoxCPM2 says it runs on your GPU");
    await noSideScroll(page, "1440 dark");
    await page.screenshot({ path: `${out}/design-1440-dark-cloud.png`, fullPage: true });
    await ctx.close();
  }
  // 390 px, light and dark.
  for (const theme of ["light", "dark"]) {
    const ctx = await setup(browser, PHONE, theme, "open");
    const page = await ctx.newPage();
    await openRoute(page, `${app}/audio/design`);
    await page.getByRole("group", { name: "Pace" }).getByRole("button", { name: "Measured", exact: true }).click();
    await noSideScroll(page, `390 ${theme}`);
    await page.screenshot({ path: `${out}/design-390-${theme}.png`, fullPage: true });
    await openRoute(page, `${app}/audio/dialogue`);
    await noSideScroll(page, `390 ${theme} dialogue`);
    // On a phone the voice chips may sit behind the composer's settings: open the picker where it shows.
    const chip = page.getByRole("button", { name: /add a sample/i }).first();
    if (await chip.isVisible().catch(() => false)) {
      await chip.click();
      await page.waitForTimeout(400);
      await noSideScroll(page, `390 ${theme} dialogue picker open`);
    }
    await page.screenshot({ path: `${out}/dialogue-picker-390-${theme}.png` });
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} failed` : "\nAll checks passed");
console.log(`Screenshots: ${out}`);
process.exit(failures.length ? 1 : 0);
