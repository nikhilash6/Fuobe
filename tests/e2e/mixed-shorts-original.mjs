// Fuobe Mixed Media and Fuobe Shorts on the Originals, browser check (build plan O9). At 1440 and 390 px, light and
// dark, in demo mode (no keys, ComfyUI unreachable): /mixed-media runs Fuobe Mixed Media by default, frame by frame on
// both engines, with Smooth on both and Fast on the cloud only, the partner frame editors (Nano Banana 2, Seedream 5.0
// Flash) still in the model menu, a preview frame that says every frame is drawn like it, and a demo render that
// finishes; /shorts runs Fuobe Shorts by default on both engines with Gemini Omni Flash still a choice, and a demo
// session starts on it. Then, once, with a (fake) fal key: the cloud estimates are real prices before anything runs
// (frames × a price a frame on Mixed Media, a dollar figure on Shorts). Nothing scrolls sideways.
// Usage: node tests/e2e/mixed-shorts-original.mjs [appUrl] [--shots <dir>]   (app running in demo mode, ComfyUI unreachable).
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
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(76)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};

async function upload(file, type, name) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(path.isAbsolute(file) ? file : path.join(root, file))], { type }), name);
  const res = await fetch(`${app}/api/uploads`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return (await res.json()).url;
}

const putSettings = (body) => fetch(`${app}/api/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// A 6 s portrait clip with sound: Mixed Media trims to ≤10 s, Shorts makes segments of it.
const clip = await upload("scripts/eval/fixtures/walk-6s.mp4", "video/mp4", "walk.mp4");
// The cloud preview grabs its frame in the browser, and Playwright's Chromium can't decode H.264: Mixed Media gets the
// same clip as VP9 when ffmpeg is here (else the cloud preview isn't checked).
const webm = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-e2e-o9-")), "walk.webm");
const vp9 = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", path.join(root, "scripts/eval/fixtures/walk-6s.mp4"), "-c:v", "libvpx-vp9", "-b:v", "300k", "-c:a", "libopus", webm]).status === 0;
const mmClip = vp9 ? await upload(webm, "video/webm", "walk.webm") : clip;

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
          if (!sessionStorage.getItem("e2e.engine.set")) {
            localStorage.setItem("fuobe.engine", "cloud");
            sessionStorage.setItem("e2e.engine.set", "1");
          }
        } catch {}
      });
      const page = await context.newPage();
      const shot = async (name) => shots && (await page.screenshot({ path: path.join(shots, `${name}-${width}-${scheme}.png`), fullPage: true }));
      const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const settle = () =>
        page.waitForFunction(() => !document.querySelector('[role="listbox"][data-state="closed"], [role="dialog"][data-state="closed"]'), null, { timeout: 5000 }).catch(() => {});
      const engine = async (name) => {
        const radio = page.getByRole("radiogroup", { name: "Engine" }).getByRole("radio", { name: new RegExp(name, "i") }).first();
        if (width < 500) {
          // On a phone a toast spans the top of the screen, over the Engine switch, for a few seconds ("Rendering your
          // video", the notifications offer). Sonner holds a toast while a pointer rests on it, and a click would leave
          // the mouse there, so the toast would never go. Like a finger, the tap leaves no pointer behind (the mouse
          // waits at the bottom) and waits for the toast to go.
          await page.mouse.move(width / 2, height - 1);
          await radio.tap();
        } else await radio.click();
        await page.waitForTimeout(400);
      };
      const restyle = () => page.getByRole("radiogroup", { name: "Restyle" });
      const modes = async () => (await restyle().getByRole("radio").allInnerTexts()).map((t) => t.trim());
      const checkedMode = async () => (await restyle().locator('[aria-checked="true"]').innerText()).trim();
      const menu = async (trigger) => {
        await page.getByRole("combobox", { name: trigger }).click();
        const opts = (await page.getByRole("option").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
        await page.keyboard.press("Escape");
        await settle();
        return opts;
      };
      // The estimate (the price, "Placeholder · free" or "Free · your GPU"), not the trimmer's live length.
      const cost = (scope) => page.locator(scope).locator('span[aria-live="polite"].font-mono').filter({ hasText: /Demo|Free|≈ \$|Price unknown/ }).first();
      const costShown = (scope) =>
        cost(scope)
          .waitFor({ timeout: 30_000 })
          .then(
            () => cost(scope).innerText(),
            () => "",
          );

      // ---- Mixed Media ------------------------------------------------------------------------------------------
      await page.goto(`${app}/mixed-media?preset=mixed-sketch&video=${encodeURIComponent(mmClip)}`, { waitUntil: "load" });
      // While the page streams in, React can hold a second copy of it in a <div hidden> (at phone width the client draws
      // the page itself before that copy is swapped in, then drops it): wait for the shown editor, then for one editor.
      await page.locator("#mm-editor").getByRole("button", { name: "Generate video" }).waitFor({ timeout: 30_000 });
      const oneEditor = await page.waitForFunction(() => document.querySelectorAll("#mm-editor").length === 1, null, { timeout: 10_000 }).then(
        () => true,
        () => false,
      );
      check(`${tag} · mixed: one editor once the page has loaded (no duplicate ids)`, oneEditor, `${await page.locator("#mm-editor").count()} found`);
      await page.waitForTimeout(800);
      const editor = page.locator("#mm-editor");
      check(`${tag} · mixed: Per frame, Smooth and Fast on the cloud`, JSON.stringify(await modes()) === JSON.stringify(["Per frame", "Smooth", "Fast"]), JSON.stringify(await modes()));
      check(`${tag} · mixed: Per frame is the default`, (await checkedMode()) === "Per frame");
      const mmModel = (await page.getByRole("combobox", { name: "Model" }).innerText()).replace(/\s+/g, " ");
      check(`${tag} · mixed: Fuobe Mixed Media is the default model`, /Fuobe Mixed Media/.test(mmModel), mmModel);
      const mmOpts = await menu("Model");
      check(`${tag} · mixed: the partner frame editors stay in the menu`, mmOpts.some((o) => /Nano Banana 2/.test(o)) && mmOpts.some((o) => /Seedream 5\.0 Flash/.test(o)), JSON.stringify(mmOpts));
      check(`${tag} · mixed: the Original's menu line shows its price`, mmOpts.some((o) => /Fuobe Mixed Media.*\$/.test(o)), mmOpts[0]);
      check(`${tag} · mixed: the Original's line names its recipe`, (await editor.innerText()).includes("Fuobe Original · every frame drawn again by Z-Image Turbo"));
      const mmCost = await costShown("#mm-editor");
      check(`${tag} · mixed: the estimate shows before running (demo)`, /Placeholder · free/.test(mmCost), mmCost);
      check(`${tag} · mixed: frames counted before running (6 s × 8 FPS)`, /48 frames · 8 FPS/.test(await editor.innerText()));
      // The preview frame: one frame in the look (the Original's edit route), drawn as every frame will be.
      const preview = async (where) => {
        await editor.getByRole("button", { name: /Generate preview frame/ }).click();
        const drawn = await editor
          .getByText("Every frame is drawn like this one")
          .waitFor({ timeout: 60_000 })
          .then(
            () => true,
            () => false,
          );
        check(`${tag} · mixed: the preview (${where}) says every frame is drawn like it`, drawn, drawn ? "" : (await editor.innerText()).replace(/\s+/g, " ").match(/Preview frame.{0,240}/)?.[0]);
      };
      if (vp9) await preview("cloud");
      // Smooth: the Original only, no frame rate, priced per second.
      await restyle().getByRole("radio", { name: "Smooth" }).click();
      await page.waitForTimeout(300);
      const smoothText = await editor.innerText();
      check(`${tag} · mixed: Smooth runs on Fuobe Mixed Media`, /Fuobe Mixed Media/.test(await editor.getByText(/Fuobe Mixed Media/).first().innerText()) && /Wan 2\.2 Fun VACE/.test(smoothText));
      check(`${tag} · mixed: Smooth has no frame rate`, !(await page.getByRole("radiogroup", { name: "Frame rate" }).count()));
      check(`${tag} · mixed: Smooth's hint says priced per second`, /priced per second/.test(smoothText));
      await restyle().getByRole("radio", { name: "Per frame" }).click();
      await page.waitForTimeout(300);
      // A demo render: the request names the Original, Per frame, and finishes.
      const sent = page.waitForResponse((r) => r.url().endsWith("/api/mixed-media") && r.request().method() === "POST", { timeout: 30_000 });
      await editor.getByRole("button", { name: "Generate video" }).click();
      const res = await sent.catch(() => null);
      const req = res ? JSON.parse(res.request().postData() ?? "{}") : {};
      check(`${tag} · mixed: the render asks for the Original, per frame`, res?.ok() && req.modelId === "fuobe-mixed-media" && req.mode === "frames", res ? `${res.status()} ${req.modelId} ${req.mode}` : "no request");
      // The render's own video ("Your video"), not the trimmer's preview of the clip, which is there from the start.
      const latest = editor.locator('[aria-live="polite"]').filter({ has: page.getByText("Your video", { exact: true }) });
      const done = await latest
        .locator("video")
        .waitFor({ timeout: 120_000 })
        .then(
          () => true,
          () => false,
        );
      check(`${tag} · mixed: the demo render finishes with a video`, done, done ? "" : (await latest.innerText({ timeout: 1000 }).catch(() => "no render shown")).replace(/\s+/g, " "));
      await shot("mixed-cloud");
      check(`${tag} · mixed: nothing scrolls sideways (cloud)`, (await sideways()) <= 0, `${await sideways()} px`);
      // Your GPU: Per frame and Smooth, no Fast, the Original first, free.
      await page.evaluate(() => window.scrollTo(0, 0));
      await engine("Open source");
      check(`${tag} · mixed: your GPU has Per frame and Smooth, no Fast`, JSON.stringify(await modes()) === JSON.stringify(["Per frame", "Smooth"]), JSON.stringify(await modes()));
      const openModel = await editor.innerText();
      check(`${tag} · mixed: Fuobe Mixed Media on your GPU`, /Fuobe Mixed Media/.test(openModel) && /free on your GPU/i.test(openModel));
      const openCost = await costShown("#mm-editor");
      check(`${tag} · mixed: free on your GPU (demo)`, /free/i.test(openCost), openCost);
      await preview("your GPU");
      await shot("mixed-open");
      check(`${tag} · mixed: nothing scrolls sideways (open)`, (await sideways()) <= 0, `${await sideways()} px`);
      if (width < 500) {
        // The phone bar says what's next: the clip is in, so it's the settings and the render.
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(500);
        const bar = page.locator("button", { hasText: "Settings & render" });
        check(`${tag} · mixed: the phone bar goes to the settings once a clip is in`, (await bar.count()) > 0 && !(await page.locator("button", { hasText: "Add a clip" }).count()));
      }
      await engine("Cloud");

      // ---- Shorts -----------------------------------------------------------------------------------------------
      await page.goto(`${app}/shorts?preset=shorts-claymation&video=${encodeURIComponent(clip)}`, { waitUntil: "load" });
      await page.getByRole("button", { name: /Generate short/ }).waitFor({ timeout: 30_000 });
      await page.waitForTimeout(800);
      const shModel = (await page.getByRole("combobox", { name: "Restyle model" }).innerText()).replace(/\s+/g, " ");
      check(`${tag} · shorts: Fuobe Shorts is the default on the cloud`, /Fuobe Shorts/.test(shModel), shModel);
      const shOpts = await menu("Restyle model");
      check(`${tag} · shorts: Gemini Omni Flash stays a choice`, shOpts.some((o) => /Gemini Omni Flash/.test(o)), JSON.stringify(shOpts));
      const body = await page.locator("body").innerText();
      check(`${tag} · shorts: the Original's line names its recipe`, body.includes("Fuobe Original · each segment's first frame is drawn in the look"));
      const shCost = await costShown("main");
      check(`${tag} · shorts: the estimate shows before running (demo)`, /Placeholder · free/.test(shCost), shCost);
      await shot("shorts-cloud");
      check(`${tag} · shorts: nothing scrolls sideways (cloud)`, (await sideways()) <= 0, `${await sideways()} px`);
      await engine("Open source");
      const openSh = (await page.getByRole("combobox", { name: "Restyle model" }).count())
        ? (await page.getByRole("combobox", { name: "Restyle model" }).innerText()).replace(/\s+/g, " ")
        : await page.locator("body").innerText();
      check(`${tag} · shorts: Fuobe Shorts on your GPU`, /Fuobe Shorts/.test(openSh), openSh.slice(0, 80));
      await shot("shorts-open");
      check(`${tag} · shorts: nothing scrolls sideways (open)`, (await sideways()) <= 0, `${await sideways()} px`);
      await engine("Cloud");
      if (scheme === "light") {
        // A demo session on the Original (once per width: each makes a session in the Library).
        const started = page.waitForResponse((r) => r.url().endsWith("/api/shorts/sessions") && r.request().method() === "POST", { timeout: 30_000 });
        await page.getByRole("button", { name: /Generate short/ }).click();
        const s = await started.catch(() => null);
        const sreq = s ? JSON.parse(s.request().postData() ?? "{}") : {};
        check(`${tag} · shorts: a demo session starts on Fuobe Shorts`, s?.ok() && sreq.modelId === "fuobe-shorts" && sreq.engine === "cloud", s ? `${s.status()} ${sreq.modelId}` : "no request");
        await page.waitForTimeout(1500);
        check(`${tag} · shorts: nothing scrolls sideways (session)`, (await sideways()) <= 0, `${await sideways()} px`);
      }
      await context.close();
    }
  }

  // ---- Real prices before running (a fake fal key: estimates only, nothing is run) ---------------------------------
  const r = await putSettings({ falKey: "fal-e2e-fake-key" });
  check("prices · a fal key can be saved for the estimate", r.ok, String(r.status));
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(() => {
      try {
        localStorage.setItem("fuobe.engine", "cloud");
      } catch {}
    });
    const page = await context.newPage();
    await page.goto(`${app}/mixed-media?preset=mixed-sketch&video=${encodeURIComponent(mmClip)}`, { waitUntil: "load" });
    const editor = page.locator("#mm-editor");
    await editor.getByRole("button", { name: "Generate video" }).waitFor({ timeout: 30_000 });
    const perFrame = await editor
      .getByText(/frames × \$[\d.]+ a frame \(Fuobe Mixed Media\)/)
      .waitFor({ timeout: 20_000 })
      .then(
        () => editor.getByText(/frames × \$[\d.]+ a frame/).innerText(),
        () => "",
      );
    check("prices · mixed: frames × a price a frame on Fuobe Mixed Media", !!perFrame, perFrame);
    const estimate = editor.locator('span[aria-live="polite"].font-mono').filter({ hasText: /≈ \$/ }).first();
    await estimate.waitFor({ timeout: 30_000 }).catch(() => {});
    const price = await estimate.innerText();
    check("prices · mixed: a dollar estimate before running", /≈ \$\d/.test(price), price);
    // A 2K pick under Per frame doesn't carry over to Smooth, which shows no Resolution: its first frame is drawn at 1K.
    await page.getByRole("radiogroup", { name: "Resolution" }).getByRole("radio", { name: "2K" }).click();
    await page.waitForTimeout(800);
    const asked = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/api/mixed-media/estimate")) asked.push(req.postDataJSON());
    });
    await page.getByRole("radiogroup", { name: "Restyle" }).getByRole("radio", { name: "Smooth" }).click();
    await page.waitForTimeout(1500);
    const smoothAsk = asked.filter((b) => b?.mode === "smooth").at(-1);
    check("prices · mixed: Smooth asks for 1K after a 2K pick under Per frame", smoothAsk?.resolution === "1K", JSON.stringify(smoothAsk?.resolution));
    check("prices · mixed: Smooth shows no Resolution", !(await page.getByRole("radiogroup", { name: "Resolution" }).count()));
    const smoothPrice = await estimate.innerText().catch(() => "");
    const smoothLine = (await editor.innerText()).match(/\d+\.\d s · 720p/)?.[0] ?? "";
    check("prices · mixed: Smooth counts seconds at 720p", !!smoothLine, smoothLine);
    check("prices · mixed: Smooth priced before running", /≈ \$\d/.test(smoothPrice), smoothPrice);
    await page.goto(`${app}/shorts?preset=shorts-claymation&video=${encodeURIComponent(clip)}`, { waitUntil: "load" });
    await page.getByRole("button", { name: /Generate short/ }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2000);
    const shortsPrice = (await page.locator("body").innerText()).match(/≈ \$[\d.]+/)?.[0] ?? "";
    check("prices · shorts: a dollar estimate on Fuobe Shorts before running", !!shortsPrice, shortsPrice);
    if (shots) await page.screenshot({ path: path.join(shots, "shorts-priced-1440.png"), fullPage: true });
    await context.close();
  } finally {
    await putSettings({ falKey: "" });
  }
} finally {
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll checks passed");
process.exit(failures.length ? 1 : 0);
