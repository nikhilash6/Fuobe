// nm10-pika-flex in the browser (no run reaches a GPU): MiniMax H3 on your GPU in the Video studio with Quality → "Fast · Pika
// Flex (6 steps)", the References button opening a tray with "Add clip" and "Add voice" beside the image references, an uploaded
// clip and voice named Clip 1 and Voice 1 in the order line, Free before the run; a too-long voice clip refused before anything
// runs; the hosted MiniMax H3 in the cloud without the tray; a Cinema take on your GPU with MiniMax H3; Lipsync & avatars with
// MiniMax H3's "Talk from a voice clip". Each page at 1440 and 390 px, light and dark, no sideways scroll and no console errors.
// Usage: node tests/e2e/pika-flex.mjs [appUrl] [--shots <dir>]   (the app in demo mode: FUOBE_DEMO_MODE=on)
// Nothing is sent: Generate is never pressed. Exits 1 on a failed check.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { launch } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(84)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};

// Media made with ffmpeg: a 4 s clip, a 3 s voice and a 17 s voice (too long for a reference).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pika-flex-e2e-"));
const ff = (args) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const clip = path.join(tmp, "clip.mp4");
const voice = path.join(tmp, "voice.wav");
const longVoice = path.join(tmp, "long.wav");
ff(["-f", "lavfi", "-i", "testsrc=size=320x180:rate=24:duration=4", "-pix_fmt", "yuv420p", clip]);
ff(["-f", "lavfi", "-i", "sine=frequency=440:duration=3", voice]);
ff(["-f", "lavfi", "-i", "sine=frequency=330:duration=17", longVoice]);

const browser = await launch();
const errors = [];
async function open(url, { engine = "open", width = 1440, scheme = "light" } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: scheme, ...(width < 500 && { isMobile: true, hasTouch: true }) });
  await context.addInitScript((e) => {
    try {
      localStorage.setItem("fuobe.engine", e);
    } catch {}
  }, engine);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.on("console", (m) => m.type() === "error" && errors.push(`${url} ${width} ${scheme}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${url} ${width} ${scheme}: ${e.message}`));
  await page.goto(`${app}${url}`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  return { context, page };
}
const noSideways = async (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shot = async (page, name) => shots && (await page.screenshot({ path: path.join(shots, `${name}.png`) }));

for (const [width, scheme] of [
  [1440, "light"],
  [1440, "dark"],
  [390, "light"],
  [390, "dark"],
]) {
  const tag = `${width} ${scheme}`;
  // Video studio, MiniMax H3 on your GPU.
  {
    const { context, page } = await open("/video?model=oss-minimax-h3", { width, scheme });
    const refs = page.getByRole("button", { name: "References" });
    check(`video ${tag}: References button`, await refs.isVisible());
    await refs.click();
    await page.waitForTimeout(500);
    check(`video ${tag}: Add clip and Add voice tiles`, (await page.locator('[data-slot-key="refClips"]').count()) > 0 && (await page.locator('[data-slot-key="refAudios"]').count()) > 0);
    await page.locator('[data-slot-key="refClips"] input[type=file]').setInputFiles(clip);
    await page.locator('[data-slot-key="refAudios"] input[type=file]').setInputFiles(voice);
    await page.waitForTimeout(4000);
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    check(`video ${tag}: order line names Clip 1 and Voice 1`, /References in order: Clip 1, Voice 1/.test(body), body.match(/References in order[^.]*/)?.[0] ?? "");
    // Phones fold the price into the Generate row (demo mode says "Placeholder" there): checked on desktop.
    if (width > 500) check(`video ${tag}: Free before the run`, /\bfree\b/i.test(body));
    check(`video ${tag}: no sideways scroll`, await noSideways(page));
    await shot(page, `video-refs-${width}-${scheme}`);
    // A 17 s voice is refused before anything runs.
    await page.getByRole("button", { name: "Remove Voice 1" }).click();
    await page.locator('[data-slot-key="refAudios"] input[type=file]').setInputFiles(longVoice);
    await page.waitForTimeout(3500);
    const after = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    check(`video ${tag}: a 17 s voice is refused`, /Voice 1 is 17 s: trim it to 15 s or less/.test(after));
    if (width === 1440) {
      // Quality: Standard, Sharper and Fast · Pika Flex (6 steps).
      await page.getByRole("button", { name: /^Quality/ }).first().click();
      await page.waitForTimeout(600);
      const box = page.getByRole("combobox").filter({ hasText: "Standard" }).first();
      if (await box.isVisible().catch(() => false)) await box.click();
      await page.waitForTimeout(500);
      const options = await page.evaluate(() => [...document.querySelectorAll("option, [role=option]")].map((o) => o.textContent).join(" | "));
      const s = `${(await page.locator("body").innerText()).replace(/\s+/g, " ")} ${options}`;
      check(`video ${tag}: Quality offers Fast · Pika Flex (6 steps)`, /Fast · Pika Flex \(6 steps\)/.test(s) && /Standard · 8 steps/.test(s));
      await shot(page, `video-quality-${width}-${scheme}`);
      await page.keyboard.press("Escape");
    }
    await context.close();
  }
  // The cloud's hosted MiniMax H3 has no References tray.
  {
    const { context, page } = await open("/video?model=minimax-h3", { engine: "cloud", width, scheme });
    check(`video cloud ${tag}: no References button`, (await page.getByRole("button", { name: "References" }).count()) === 0);
    check(`video cloud ${tag}: no sideways scroll`, await noSideways(page));
    await context.close();
  }
  // Cinema on your GPU with MiniMax H3.
  {
    const { context, page } = await open("/cinema?model=oss-minimax-h3", { width, scheme });
    check(`cinema ${tag}: loads`, (await page.locator("body").innerText()).length > 50);
    check(`cinema ${tag}: no sideways scroll`, await noSideways(page));
    await shot(page, `cinema-${width}-${scheme}`);
    await context.close();
  }
  // Lipsync & avatars with MiniMax H3's Talk from a voice clip.
  {
    const { context, page } = await open("/lipsync?model=oss-minimax-h3", { width, scheme });
    const body = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    check(`lipsync ${tag}: MiniMax H3 picked`, /MiniMax H3/.test(body));
    check(`lipsync ${tag}: no sideways scroll`, await noSideways(page));
    await shot(page, `lipsync-${width}-${scheme}`);
    await context.close();
  }
}

check("no console errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nall passed");
