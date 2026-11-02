// Browser check of "Clean the voice first" (DBS D6).
// Usage: node tests/e2e/voice-first.mjs [appUrl] [outDir]   (the app in demo mode: no keys, no ComfyUI)
// Checks, at 1440 px and 390 px in light and dark: Transcribe with a video shows the switch on with its hint and "Free ·
// adds …" on the open engine, and its price on the cloud; with a recording only, off. Lipsync with a clip and a voice
// shows it off (the voice is an upload); turned on, it says the clip's music and effects go back (open) or don't (cloud). Captions shows it on under
// "Transcribe the speech". Toggling never changes the composer's height, nothing scrolls sideways, no console errors.
// Screenshots go to outDir.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DESKTOP, PHONE, launch, openRoute } from "./_browser.mjs";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const app = args[0] ?? "http://localhost:3000";
const out = args[1] ?? fs.mkdtempSync("/tmp/fuobe-voice-first-");
fs.mkdirSync(out, { recursive: true });

const ff = (a) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
};
const wav = path.join(out, "speech.wav");
const mp4 = path.join(out, "clip.mp4");
ff(["-f", "lavfi", "-i", "aevalsrc=0.2*sin(2*PI*330*t):s=44100:d=6", wav]);
ff(["-f", "lavfi", "-i", "color=c=teal:s=640x360:d=6:r=25", "-f", "lavfi", "-i", "aevalsrc=0.2*sin(2*PI*220*t)|0.2*sin(2*PI*277*t):s=44100:d=6", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", mp4]);

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
};
async function noSideScroll(page, label) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 0, `${label}: no horizontal scroll (${over}px)`);
}
function watchConsole(page, label) {
  page.on("console", (m) => m.type() === "error" && check(false, `${label}: console error: ${m.text().slice(0, 200)}`));
  page.on("pageerror", (e) => check(false, `${label}: page error: ${e.message.slice(0, 200)}`));
}
const sw = (page) => page.locator("[data-voice-first]").first();
const switchOn = async (page) => (await sw(page).getByRole("switch").getAttribute("aria-checked")) === "true";
const box = (page, sel) => page.locator(sel).first().boundingBox();

/** Toggle twice: the block's own height and the composer's never change. */
async function noShift(page, label, holder) {
  const before = [await box(page, "[data-voice-first]"), holder && (await box(page, holder))];
  await sw(page).getByRole("switch").click();
  await page.waitForTimeout(250);
  const mid = [await box(page, "[data-voice-first]"), holder && (await box(page, holder))];
  await sw(page).getByRole("switch").click();
  await page.waitForTimeout(250);
  const same = (a, b) => !a || !b || Math.abs(a.height - b.height) < 0.5;
  check(same(before[0], mid[0]) && same(before[1], mid[1]), `${label}: toggling moves nothing (${before[0]?.height} → ${mid[0]?.height})`);
}

const browser = await launch();
try {
  for (const [dname, device] of [
    ["1440", DESKTOP],
    ["390", PHONE],
  ]) {
    for (const theme of ["light", "dark"]) {
      const label = `${dname} ${theme}`;
      for (const engine of ["open", "cloud"]) {
        const ctx = await browser.newContext({ ...device, colorScheme: theme });
        await ctx.addInitScript(([e]) => localStorage.setItem("fuobe.engine", e), [engine]);
        const page = await ctx.newPage();
        const l = `${label} ${engine}`;
        watchConsole(page, l);

        // Transcribe: a video → on, with its time or price.
        await openRoute(page, `${app}/audio/transcribe`);
        await page.locator('[data-slot-key="video"] input[type="file"]').setInputFiles(mp4);
        await sw(page).waitFor({ timeout: 60_000 });
        check(await switchOn(page), `${l} Transcribe: on for a video`);
        const line = engine === "open" ? /Free · adds (under|about)/ : /\+\$0\.0\d$/;
        await sw(page).getByText(line).waitFor({ timeout: 30_000 }).catch(() => {});
        const text = (await sw(page).innerText()).replace(/\s+/g, " ");
        check(line.test(text), `${l} Transcribe: says what it adds (“${text}”)`);
        await noShift(page, `${l} Transcribe`, "[data-composer]");
        await page.screenshot({ path: path.join(out, `transcribe-${engine}-${dname}-${theme}.png`), fullPage: true });
        await noSideScroll(page, `${l} Transcribe`);
        // A recording only → off.
        await page.getByRole("button", { name: "Remove Video" }).first().click();
        await page.locator('[data-slot-key="audio"] input[type="file"]').setInputFiles(wav);
        await sw(page).waitFor({ timeout: 60_000 });
        await page.waitForTimeout(500);
        check(!(await switchOn(page)), `${l} Transcribe: off for a recording`);

        // Lipsync: a clip and a voice → off, then on, and what happens to the clip's music and effects.
        // A lip re-sync model on each engine (the studio opens on a talking-avatar model).
        await openRoute(page, `${app}/lipsync?model=${engine === "open" ? "oss-infinitetalk-v2v" : "sync-lipsync-3"}`);
        await page.locator('[data-slot-key="video"] input[type="file"]').setInputFiles(mp4);
        await page.locator('[data-slot-key="audio"] input[type="file"]').setInputFiles(wav);
        await sw(page).waitFor({ timeout: 60_000 });
        // The voice's header times or prices the step (a moment after the upload).
        await sw(page).getByText(engine === "open" ? /Free · adds (under|about)/ : /\+\$0\.0\d$/).waitFor({ timeout: 30_000 }).catch(() => {});
        // The voice is an audio upload: off, and on your GPU it says turning it on puts the clip's music and effects back.
        check(!(await switchOn(page)), `${l} Lipsync: off for an uploaded voice`);
        const offNote = engine === "open" ? "Turn it on to put the clip's music and effects back" : "keeps the clean voice only";
        await sw(page).getByText(offNote).waitFor({ timeout: 30_000 }).catch(() => {});
        check(await sw(page).getByText(offNote).isVisible(), `${l} Lipsync: says what turning it on does for the clip's music and effects`);
        await sw(page).getByRole("switch").click();
        check(await switchOn(page), `${l} Lipsync: turns on`);
        const note = engine === "open" ? "go back under the new lip movement" : "keeps the clean voice only";
        await sw(page).getByText(note).waitFor({ timeout: 30_000 }).catch(() => {});
        check(await sw(page).getByText(note).isVisible(), `${l} Lipsync: says what happens to the clip's music and effects`);
        await noShift(page, `${l} Lipsync`, "[data-composer]");
        await page.screenshot({ path: path.join(out, `lipsync-${engine}-${dname}-${theme}.png`), fullPage: true });
        await noSideScroll(page, `${l} Lipsync`);

        // Captions: on under "Transcribe the speech".
        await openRoute(page, `${app}/video-tools/captions`);
        await page.locator('input[type="file"]').first().setInputFiles(mp4);
        await sw(page).waitFor({ timeout: 60_000 });
        // The player reads the clip's length, which prices the cloud's step.
        if (engine === "cloud") await sw(page).getByText(/\+\$0\.0\d$/).waitFor({ timeout: 30_000 }).catch(() => {});
        check(await switchOn(page), `${l} Captions: on`);
        check(await page.getByRole("button", { name: /Transcribe the speech/ }).isVisible(), `${l} Captions: beside Transcribe the speech`);
        await noShift(page, `${l} Captions`);
        await page.screenshot({ path: path.join(out, `captions-${engine}-${dname}-${theme}.png`), fullPage: true });
        await noSideScroll(page, `${l} Captions`);
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} failed (screenshots in ${out})` : `\nAll good (screenshots in ${out})`);
process.exit(failures.length ? 1 : 0);
