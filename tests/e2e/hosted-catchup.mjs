// The hosted catch-up (build package nm10-hosted-catchup), browser check at 1440 and 390 px, light and dark, in demo mode:
// Lipsync prices H3 Max Lip Sync on the voice's length (1.2x over 15 s) and refuses a voice under 5 s before Generate; Relight
// on H3 Max asks for a light, draws its sphere and prices the clip's seconds; Edit video's "Insert a moment" has a two-handle
// range over the clip and prices the new moment; Image to 3D offers Tripo P2 and a Retexture action on a result. No console
// errors, nothing scrolls sideways.
// Usage: node tests/e2e/hosted-catchup.mjs [appUrl] [--shots <dir>]   (app running with FUOBE_DEMO_MODE=on; needs ffmpeg).
// Exits 1 on a failed check.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch, root } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(78)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-catchup-e2e-"));
const ff = (args) => {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", ...args]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
};
const clip = path.join(tmp, "clip-8s.mp4");
ff(["-f", "lavfi", "-i", "testsrc=size=1280x720:rate=24", "-t", "8", "-pix_fmt", "yuv420p", clip]);
const voice20 = path.join(tmp, "voice-20s.wav");
ff(["-f", "lavfi", "-i", "sine=frequency=220:duration=20", voice20]);
const voice2 = path.join(root, "scripts/eval/fixtures/voice.wav");
const portrait = path.join(root, "scripts/eval/fixtures/start-frame.png");

const browser = await launch();
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    for (const scheme of ["light", "dark"]) {
      const tag = `${width} ${scheme}`;
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
      await context.addInitScript(() => {
        try {
          localStorage.setItem("fuobe.engine", "cloud");
        } catch {}
      });
      const page = await context.newPage();
      const errors = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(String(e)));
      const shot = async (name) => shots && (await page.screenshot({ path: path.join(shots, `${name}-${width}-${scheme}.png`) }));
      const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const open = async (url, name) => {
        await page.goto(`${app}${url}`, { waitUntil: "load", timeout: 180_000 });
        const chip = page.getByRole("button", { name: /^Model: / }).first();
        await chip.waitFor({ timeout: 120_000 });
        await page
          .waitForFunction((n) => (document.querySelector("button[aria-label^='Model: ']")?.getAttribute("aria-label") ?? "").includes(n), name, { timeout: 20_000 })
          .catch(() => {});
        return (await chip.getAttribute("aria-label")) ?? "";
      };
      const composerText = () => page.locator(".group\\/composer").first().innerText();
      // On a phone the model's own chips sit in the Settings sheet.
      const chips = async () => {
        if (width < 500) {
          await page.getByRole("button", { name: /^Settings:/ }).first().click();
          await page.waitForTimeout(400);
        }
      };
      // Demo mode shows placeholders as free: the price checked is the picker row's (the amounts are unit-tested).
      const rowPrice = async (id) => {
        await page.getByRole("button", { name: /^Model: / }).first().click();
        const row = page.locator(`[cmdk-item][data-value$=":${id}"]`).first();
        await row.waitFor({ timeout: 15_000 });
        const text = await row.innerText();
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        return text.replace(/\n/g, " | ");
      };

      // ---- Lipsync: H3 Max Lip Sync on a 20 s voice (×1.2 over 15 s) and a 2 s one (refused).
      check(`${tag}: Lipsync opens on H3 Max Lip Sync`, (await open("/lipsync?model=minimax-h3-max-lipsync", "H3 Max Lip Sync")).includes("H3 Max Lip Sync"));
      await page.locator('input[type="file"][accept^="image/"]').first().setInputFiles(portrait);
      await page.locator('input[type="file"][accept^="audio/"]').first().setInputFiles(voice20);
      const lipRow = await rowPrice("minimax-h3-max-lipsync");
      check(`${tag}: the picker prices H3 Max Lip Sync per second`, /\$0\.08\/sec/.test(lipRow), lipRow);
      await shot("lipsync");
      check(`${tag}: no sideways scroll in Lipsync`, (await sideways()) <= 1, `${await sideways()} px`);
      await open("/lipsync?model=minimax-h3-max-lipsync", "H3 Max Lip Sync");
      await page.locator('input[type="file"][accept^="image/"]').first().setInputFiles(portrait);
      await page.locator('input[type="file"][accept^="audio/"]').first().setInputFiles(voice2);
      const short = await page
        .getByRole("button", { name: /^Generate — .*needs at least 5 s of audio/ })
        .first()
        .waitFor({ timeout: 20_000 })
        .then(
          () => true,
          () => false,
        );
      check(`${tag}: a 2 s voice is refused before Generate`, short);

      // ---- Relight: H3 Max asks for a light, draws its sphere, prices the clip.
      check(`${tag}: Relight opens on H3 Max Relight`, (await open("/video-tools/relight?model=minimax-h3-max-relight", "H3 Max Relight")).includes("H3 Max Relight"));
      await page.locator('input[type="file"][accept^="video/"]').first().setInputFiles(clip);
      const ask = await page
        .getByRole("button", { name: /^Generate — Pick a light: / })
        .first()
        .waitFor({ timeout: 20_000 })
        .then(
          () => true,
          () => false,
        );
      check(`${tag}: it asks for a light first`, ask);
      await chips();
      await page.getByRole("button", { name: /^Pick a light/ }).locator("visible=true").first().click();
      await page.getByRole("button", { name: /^Golden hour/ }).first().click();
      const lit = await page
        .getByRole("button", { name: /Light · Golden hour/ })
        .locator("visible=true")
        .first()
        .waitFor({ timeout: 20_000 })
        .then(
          () => true,
          () => false,
        );
      check(`${tag}: the Golden hour sphere is set`, lit);
      await shot("relight");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await page.locator("h1").first().click({ force: true });
      await page.waitForTimeout(300);
      const relightRow = await rowPrice("minimax-h3-max-relight");
      check(`${tag}: the picker prices H3 Max Relight per second`, /\$0\.08\/sec/.test(relightRow), relightRow);
      check(`${tag}: no sideways scroll in Relight`, (await sideways()) <= 1, `${await sideways()} px`);
      await page.keyboard.press("Escape");

      // ---- Edit video: Insert a moment with a two-handle range.
      check(`${tag}: Edit video opens on H3 Max Insert`, (await open("/video-edit?model=minimax-h3-max-insert", "Insert a moment")).includes("Insert a moment"));
      await page.locator('input[type="file"][accept^="video/"]').first().setInputFiles(clip);
      await page.waitForTimeout(1500);
      await chips();
      const range = page.getByRole("button", { name: /^Insert · / }).locator("visible=true").first();
      const hasRange = await range
        .waitFor({ timeout: 20_000 })
        .then(
          () => true,
          () => false,
        );
      check(`${tag}: the insert range chip shows`, hasRange, hasRange ? await range.innerText() : "");
      if (hasRange) {
        await range.click();
        const thumbs = page.getByRole("slider");
        await thumbs.first().waitFor({ timeout: 10_000 });
        check(`${tag}: the range has two handles over the 8 s clip`, (await thumbs.count()) === 2 && (await thumbs.nth(1).getAttribute("aria-valuemax")) === "8");
        const before = Number(await thumbs.first().getAttribute("aria-valuenow"));
        check(`${tag}: the handles open around the clip's middle`, before === 3.5, String(before));
        await thumbs.first().focus();
        await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(300);
        const after = Number(await thumbs.first().getAttribute("aria-valuenow"));
        check(`${tag}: a handle moves by 1/8 s`, after === before + 0.125, String(after));
        await shot("insert");
        check(`${tag}: no sideways scroll with the range open`, (await sideways()) <= 1, `${await sideways()} px`);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        await page.locator("h1").first().click({ force: true });
        await page.waitForTimeout(300);
      }
      const insertRow = await rowPrice("minimax-h3-max-insert");
      check(`${tag}: the picker prices H3 Max Insert per second`, /\$0\.06\/sec/.test(insertRow), insertRow);

      // ---- Image to 3D: Tripo P2 is offered; a result has Retexture.
      await page.goto(`${app}/image-to-3d?model=tripo-p2`, { waitUntil: "load", timeout: 180_000 });
      await page.getByRole("heading").first().waitFor({ timeout: 120_000 });
      await page.waitForTimeout(1500);
      const body = await page.locator("main").innerText();
      check(`${tag}: Image to 3D offers Tripo P2`, /Tripo P2/.test(body));
      const up = await page.request.post(`${app}/api/uploads`, { multipart: { file: { name: "chair.png", mimeType: "image/png", buffer: fs.readFileSync(portrait) } } });
      const photo = (await up.json()).url;
      const res = await page.request.fetch(`${app}/api/generations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify({ feature: "image-to-3d", modelId: "tripo-p2", op: "image-to-3d", inputs: { images: [photo] } }),
      });
      check(`${tag}: a Tripo P2 run starts (demo)`, res.ok(), String(res.status()));
      const retexture = page.getByRole("button", { name: /^Retexture$/ }).first();
      let shown = false;
      for (let i = 0; i < 12 && !shown; i++) {
        await page.waitForTimeout(5000);
        await page.reload({ waitUntil: "load" });
        await page.waitForTimeout(2500);
        shown = await retexture.isVisible().catch(() => false);
      }
      check(`${tag}: a 3D result has Retexture`, shown);
      if (shown) {
        await retexture.click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor({ timeout: 10_000 });
        await dialog.getByLabel("The new look").fill("weathered bronze with green patina");
        const price = await dialog
          .getByText(/\$0\.30|Placeholder/)
          .first()
          .waitFor({ timeout: 20_000 })
          .then(
            () => true,
            () => false,
          );
        check(`${tag}: Retexture shows its price before running`, price, (await dialog.innerText()).replace(/\n/g, " | ").slice(0, 200));
        await shot("retexture");
        check(`${tag}: no sideways scroll with Retexture open`, (await sideways()) <= 1, `${await sideways()} px`);
        await page.keyboard.press("Escape");
      }
      check(`${tag}: no console errors`, errors.length === 0, errors.slice(0, 3).join(" | ").slice(0, 300));
      await context.close();
    }
  }
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nall checks passed");
