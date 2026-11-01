// Restore & colourise in the browser (demo mode: no keys, no GPU). The tool opened from a clip handed over: its canvas
// and tiles, the gated-download step and the GPU note, the words written from the frames (offline), Restore to 4K on
// the GPU and refused in the cloud with the reason, the cloud size, a demo run with its Before/After wipe. Then the
// Upscale tool's first step (Restore, then upscale), the masked Hugging Face token in Settings → LoRAs, the restore step offered under a clip
// in Shorts and the Explainer, and each page at 1440 and 390 px, light and dark, without sideways scroll.
// Usage: node tests/e2e/restore-flows.mjs [appUrl] [--shots <dir>]   Exits 1 on a failed check.
import { execFileSync } from "node:child_process";
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
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(76)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};
const fixture = path.join(root, "tests/fixtures/shorts-12s.mp4");
// Playwright's Chromium has no H.264 decoder: the Explainer reads its still in the browser, so it gets the clip as a
// black-and-white VP9 WebM (ffmpeg), which also shows the black-and-white wording.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-restore-e2e-"));
const greyWebm = path.join(tmp, "harbour-1930.webm");
execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", fixture, "-t", "4", "-vf", "hue=s=0", "-c:v", "libvpx-vp9", "-b:v", "200k", "-an", greyWebm]);

async function upload(file, type, name) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)], { type }), name);
  const res = await fetch(`${app}/api/uploads`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return (await res.json()).url;
}
const clip = await upload(fixture, "video/mp4", "harbour 1930.mp4");

const browser = await launch();
const contextFor = async (engine, viewport = { width: 1440, height: 900 }, colorScheme = "light") => {
  const context = await browser.newContext({ viewport, colorScheme, ...(viewport.width < 500 && { isMobile: true, hasTouch: true }) });
  await context.addInitScript((e) => {
    try {
      localStorage.setItem("fuobe.engine", e);
    } catch {}
  }, engine);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  return { context, page };
};
const text = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));

try {
  // ---------------------------------------------------------------------------
  // The tool on the GPU
  {
    const { context, page } = await contextFor("open");
    await page.goto(`${app}/video-tools/restore?video=${encodeURIComponent(clip)}`, { waitUntil: "load" });
    await page.getByText(/Canvas \d+×\d+ · \d+ tiles of 960×544/).first().waitFor({ timeout: 30_000 });
    const t = await text(page);
    check("GPU: canvas, tiles and windows read from the clip", /Canvas 1088×1920 · \d+ tiles of 960×544 · 3 windows of up to 97 frames/.test(t));
    check("GPU: the gated-download step with its link to Settings", /Restore IC-LoRA is gated/.test(t) && (await page.locator('a[href="/settings#huggingface"]').count()) > 0);
    check("GPU: the hardware note", /24 GB|GPU/.test(t));
    check("GPU: priced before it runs", /Free|Demo · free/.test(t));
    await page.getByRole("button", { name: /Write it from the frames/ }).click();
    await page.waitForFunction(() => (document.querySelector("#restore-prompt")?.value ?? "").length > 20, null, { timeout: 30_000 });
    const words = await page.locator("#restore-prompt").inputValue();
    check("words written from the frames, editable", /natural colour/.test(words), words.slice(0, 60));
    await page.locator("#restore-prompt").fill(`${words} Edited.`);
    check("the written words stay editable", (await page.locator("#restore-prompt").inputValue()).endsWith("Edited."));
    const four = page.getByRole("switch", { name: /Restore to 4K/ });
    check("Restore to 4K is offered on the GPU", (await four.count()) > 0 && !(await four.isDisabled()));
    await four.click();
    await page.getByText(/then 2176×3840/).first().waitFor({ timeout: 20_000 });
    check("Restore to 4K adds the detail pass at twice the canvas", true);
    if (shots) await page.screenshot({ path: path.join(shots, "restore-open-1440.png"), fullPage: true });
    await four.click();
    await page.getByRole("button", { name: /^Restore$/ }).click();
    await page.getByLabel("Compare the archive clip and the restored one").first().waitFor({ timeout: 90_000 });
    check("a demo run ends beside the original with a Before/After wipe", true);
    await page.getByRole("heading", { name: "Your restorations" }).waitFor({ timeout: 30_000 });
    check("the run is listed under Your restorations", true);
    if (shots) await page.screenshot({ path: path.join(shots, "restore-open-result-1440.png"), fullPage: true });
    await context.close();
  }

  // ---------------------------------------------------------------------------
  // The tool in the cloud
  {
    const { context, page } = await contextFor("cloud");
    await page.goto(`${app}/video-tools/restore?video=${encodeURIComponent(clip)}`, { waitUntil: "load" });
    await page.getByText(/in one pass a piece/).first().waitFor({ timeout: 30_000 });
    const t = await text(page);
    check("cloud: one untiled pass a piece, in pieces of up to 97 frames", /704×1280 in one pass a piece · 2 pieces of up to 97 frames/.test(t));
    check("cloud: Restore to 4K says it runs on your GPU", /Runs on your GPU \(open source\)/.test(t) && (await page.getByRole("switch", { name: /Restore to 4K/ }).isDisabled()));
    check("cloud: the size to pick", (await page.getByRole("radio", { name: "1080p" }).count()) > 0);
    if (shots) await page.screenshot({ path: path.join(shots, "restore-cloud-1440.png"), fullPage: true });
    await context.close();
  }

  // ---------------------------------------------------------------------------
  // Elsewhere: Upscale, Settings, Shorts, the Explainer
  {
    const { context, page } = await contextFor("open");
    await page.goto(`${app}/upscale/video`, { waitUntil: "load" });
    const up = page.getByRole("link", { name: /Restore archive footage first/ });
    await up.first().waitFor({ timeout: 30_000 });
    check("Upscale: Restore archive footage first", (await up.first().getAttribute("href")) === "/video-tools/restore?then=upscale");
    check("Upscale: the step says the upscale follows in one run", /then upscaled, in one run/.test(await text(page)));
    await page.goto(`${app}/video-tools/restore?then=upscale&video=${encodeURIComponent(clip)}`, { waitUntil: "load" });
    const then = page.getByRole("switch", { name: /Then upscale/ });
    await then.waitFor({ timeout: 30_000 });
    check("Restore opened from Upscale: Then upscale is on", (await then.getAttribute("aria-checked")) === "true");
    await page.getByText(/Then upscaled on your GPU with SeedVR2/).first().waitFor({ timeout: 30_000 });
    check("Restore opened from Upscale: the upscale is in the plan", true);

    await page.goto(`${app}/settings#huggingface`, { waitUntil: "load" });
    const token = page.locator("#huggingface input").first();
    await token.waitFor({ timeout: 30_000 });
    check("Settings: the Hugging Face token field is masked", (await token.getAttribute("type")) === "password");

    // A file set before React hydrates the drop zone is never read: wait for the step's heading, then a moment.
    await page.goto(`${app}/shorts`, { waitUntil: "load" });
    await page.getByRole("heading", { name: "Upload your video" }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await page.locator('input[type="file"]').first().setInputFiles(fixture);
    await page.getByRole("link", { name: /Restore & colourise it first/ }).first().waitFor({ timeout: 60_000 });
    const href = await page.getByRole("link", { name: /Restore & colourise it first/ }).first().getAttribute("href");
    check("Shorts: the restore step offered under the uploaded clip, with the clip", /^\/video-tools\/restore\?video=%2Fapi%2Ffiles%2F/.test(href ?? ""), href ?? "");
    if (shots) await page.screenshot({ path: path.join(shots, "shorts-old-footage-1440.png") });

    await page.goto(`${app}/explainer`, { waitUntil: "load" });
    await page.getByRole("button", { name: /Attach a file/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await page.locator('input[type="file"]').first().setInputFiles(greyWebm);
    await page.getByRole("link", { name: /Restore & colourise it first/ }).first().waitFor({ timeout: 60_000 });
    await page.getByText("This looks like black-and-white footage.").first().waitFor({ timeout: 30_000 });
    const t = await text(page);
    check("Explainer: a still from the footage as a source", /harbour-1930 still\.jpg/.test(t));
    check("Explainer: black-and-white footage said plainly", /This looks like black-and-white footage\./.test(t));
    await page.waitForFunction(() => /video=/.test([...document.querySelectorAll("a")].find((a) => /Restore & colourise it first/.test(a.textContent ?? ""))?.getAttribute("href") ?? ""), null, { timeout: 60_000 });
    check("Explainer: the restore step offered with the clip", true);
    if (shots) await page.screenshot({ path: path.join(shots, "explainer-old-footage-1440.png") });
    await context.close();
  }

  // ---------------------------------------------------------------------------
  // Every touched page at 1440 and 390 px, light and dark: nothing scrolls sideways.
  const pages = [`/video-tools/restore?video=${encodeURIComponent(clip)}`, "/video-tools/restore", "/upscale/video", "/settings#huggingface", "/shorts", "/explainer"];
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    for (const scheme of ["light", "dark"]) {
      for (const engine of ["open", "cloud"]) {
        const { context, page } = await contextFor(engine, { width, height }, scheme);
        for (const p of pages) {
          await page.goto(`${app}${p}`, { waitUntil: "load" });
          await page.waitForTimeout(900);
          const ok = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
          check(`${p.split("?")[0]}${p.includes("?") ? " (clip)" : ""} ${engine} at ${width}px ${scheme}: no sideways scroll`, ok);
          if (shots && p.startsWith("/video-tools/restore?")) await page.screenshot({ path: path.join(shots, `restore-${engine}-${width}-${scheme}.png`), fullPage: true });
        }
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures.length ? `\n${failures.length} failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
