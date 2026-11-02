// Keyframe animation in the browser, in demo mode (no run reaches a GPU or a key): the Video
// studio's Frames mode in Animation style (a timing chip per gap, the live length, the playback rate, Keep mouth still,
// what the cloud keeps), Storyboard's "Animate these panels" opening it with the panels as keyframes, a character's
// "Animate between poses", and the Character Sheet page. Each at 1440 and 390 px, light and dark, without sideways
// scroll, failing on any console error.
// Usage: FUOBE_DEMO_MODE=on pnpm dev -p 3412 & node tests/e2e/inbetweening.mjs [appUrl] [--shots <dir>]
// Nothing is generated on a GPU: the storyboard is made in the cloud on placeholder results; Generate is never pressed.
import fs from "node:fs";
import path from "node:path";
import { launch, root } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(84)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};
const call = async (p, init) => {
  const r = await fetch(`${app}${p}`, init);
  return r.json();
};

const status = await call("/api/status");
if (status.demoMode === "off") throw new Error("run the app in demo mode (FUOBE_DEMO_MODE=on)");

// Three keyframes (the eval's drawn faces).
const upload = async (file) => {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(path.join(root, "scripts/eval/fixtures/character", file))], { type: "image/png" }), file);
  return (await call("/api/uploads", { method: "POST", body: form })).url;
};
const keys = [await upload("drawn-face-1.png"), await upload("drawn-face-2.png"), await upload("drawn-face-3.png")];

// A storyboard of three panels in the cloud (placeholder results: no key).
const board = await call("/api/storyboards", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    engine: "cloud",
    story: "A paper fox wakes, stretches and runs off",
    frames: 3,
  }),
});
const boardIds = (board.items ?? []).map((g) => g.id);
for (let i = 0; i < 120; i++) {
  const all = await Promise.all(boardIds.map((id) => call(`/api/generations/${id}`)));
  if (all.every((g) => ["succeeded", "failed", "canceled"].includes(g.status ?? g.generation?.status))) break;
  await new Promise((r) => setTimeout(r, 1000));
}
check("storyboard made on placeholder results", boardIds.length >= 3, `${boardIds.length} frames`);

// A character element with three pictures.
const element = await call("/api/elements", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Paper fox",
    kind: "character",
    references: keys,
  }),
});
const elementId = element.id ?? element.element?.id;

const browser = await launch();
const contextFor = async (engine, width, colorScheme) => {
  const context = await browser.newContext({
    viewport: { width, height: width < 500 ? 844 : 900 },
    colorScheme,
    ...(width < 500 && { isMobile: true, hasTouch: true }),
  });
  await context.addInitScript((e) => {
    try {
      localStorage.setItem("fuobe.engine", e);
    } catch {}
  }, engine);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  return { context, page, errors };
};
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shoot = (page, name) => (shots ? page.screenshot({ path: path.join(shots, name) }) : undefined);
const strip = (page) => page.locator("[data-frames-strip]").first();
const framesUrl = `/video?${new URLSearchParams({ model: "fuobe-animation", frames: keys.join(",") })}`;

for (const width of [1440, 390]) {
  for (const scheme of ["light", "dark"]) {
    const tag = `${width} ${scheme}`;
    // ---- Frames mode, Animation style, on your GPU
    {
      const { context, page, errors } = await contextFor("open", width, scheme);
      await page.goto(`${app}${framesUrl}`, { waitUntil: "load" });
      await strip(page).waitFor({ timeout: 90_000 });
      await page.waitForTimeout(1500);
      const s = strip(page);
      check(`${tag}: Frames opens with the 3 handed-over keyframes`, (await s.locator('button[aria-label^="Frame "][aria-label$=": replace"]').count()) === 3);
      check(`${tag}: Animation style is on`, (await s.getByRole("switch").first().getAttribute("aria-checked")) === "true");
      check(`${tag}: a timing chip per gap`, (await s.locator("[data-gap-chip]").count()) === 2);
      check(`${tag}: the last keyframe is the end frame`, (await s.locator('button[aria-label^="Frame 3, end frame"]').count()) === 1);
      const before = await s.locator("[data-animation-length]").innerText();
      await s.locator("[data-gap-chip]").first().click();
      const pop = page.getByRole("dialog").last();
      await pop.waitFor();
      await pop.getByRole("radio", { name: "×3" }).click();
      await pop.getByRole("button", { name: "More frames" }).click();
      // Typed key by key, as a person types: the spaces stay.
      const words = pop.getByPlaceholder("she jumps and lands");
      await words.click();
      await words.pressSequentially("he leaps high", { delay: 20 });
      await page.waitForTimeout(300);
      check(`${tag}: a gap's words keep their spaces as typed`, (await words.inputValue()) === "he leaps high", await words.inputValue());
      const chip = await s.locator("[data-gap-chip]").first().innerText();
      check(`${tag}: the chip shows the gap's frames and speed`, /\d+ f · ×3/.test(chip.replace(/\s+/g, " ")), chip.replace(/\s+/g, " "));
      await shoot(page, `frames-gap-${width}-${scheme}.png`);
      await page.keyboard.press("Escape");
      const after = await s.locator("[data-animation-length]").innerText();
      check(`${tag}: the total length follows the timing`, before !== after, `${before} → ${after}`);
      await s.getByRole("radio", { name: /16 fps/ }).click();
      await s.getByText("Keep mouth still").click();
      await page.waitForTimeout(400);
      const longer = await s.locator("[data-animation-length]").innerText();
      check(`${tag}: 16 fps plays it longer`, parseFloat(longer) > parseFloat(after), longer);
      // The price on your GPU: Free.
      const free = await page.locator("[data-composer]").first().getByText(/free/i).count();
      check(`${tag}: free on your GPU`, free > 0);
      check(`${tag}: no sideways scroll (Frames)`, await noSideways(page));
      await shoot(page, `frames-${width}-${scheme}.png`);
      // Style off: back to Wan 2.2 14B's frames.
      await s.getByRole("switch").first().click();
      await page.waitForTimeout(800);
      check(`${tag}: Animation off leaves the gap chips`, (await s.locator("[data-gap-chip]").count()) === 0);
      check(`${tag}: no console errors (Frames)`, errors.length === 0, errors.slice(0, 2).join(" | "));
      await context.close();
    }
    // ---- In the cloud: every frame kept at 16 fps, said plainly
    if (scheme === "light") {
      const { context, page, errors } = await contextFor("cloud", width, scheme);
      await page.goto(`${app}${framesUrl}`, { waitUntil: "load" });
      await strip(page).waitFor({ timeout: 90_000 });
      await page.waitForTimeout(1500);
      const s = strip(page);
      check(`${tag}: cloud says what runs on your GPU`, (await s.getByText(/Faster speeds and 24 fps playback are on your GPU/).count()) === 1);
      check(`${tag}: cloud plays at 16 fps only`, (await s.getByRole("radio", { name: /24 fps/ }).count()) === 0);
      await s.locator("[data-gap-chip]").first().click();
      const pop = page.getByRole("dialog").last();
      await pop.waitFor();
      check(`${tag}: cloud keeps ×2–×4 for your GPU`, await pop.getByRole("radio", { name: "×3" }).isDisabled());
      await page.keyboard.press("Escape");
      check(`${tag}: no sideways scroll (cloud)`, await noSideways(page));
      check(`${tag}: no console errors (cloud)`, errors.length === 0, errors.slice(0, 2).join(" | "));
      await shoot(page, `frames-cloud-${width}.png`);
      await context.close();
    }
    // ---- Storyboard: Animate these panels
    {
      const { context, page, errors } = await contextFor("cloud", width, scheme);
      await page.goto(`${app}/storyboard`, { waitUntil: "load" });
      const link = page.locator("[data-animate-panels]").first();
      await link.waitFor({ timeout: 90_000 });
      check(`${tag}: no sideways scroll (Storyboard)`, await noSideways(page));
      await shoot(page, `storyboard-${width}-${scheme}.png`);
      await link.click();
      await page.waitForURL(/\/video\?/, { timeout: 60_000 });
      await strip(page).waitFor({ timeout: 90_000 });
      await page.waitForTimeout(1200);
      check(`${tag}: Animate these panels opens Frames with the panels`, (await strip(page).locator("[data-gap-chip]").count()) === boardIds.length - 1);
      check(`${tag}: no console errors (Storyboard)`, errors.length === 0, errors.slice(0, 2).join(" | "));
      await context.close();
    }
    // ---- A character: Animate between poses; the Character Sheet page
    {
      const { context, page, errors } = await contextFor("open", width, scheme);
      if (elementId) {
        await page.goto(`${app}/elements/${elementId}`, { waitUntil: "load" });
        const btn = page.locator("[data-animate-poses]").first();
        await btn.waitFor({ timeout: 90_000 });
        await btn.click();
        const pop = page.getByRole("dialog").last();
        await pop.waitFor();
        check(`${tag}: three poses picked by default`, (await pop.locator('button[aria-pressed="true"]').count()) === 3);
        check(`${tag}: no sideways scroll (character)`, await noSideways(page));
        await shoot(page, `poses-${width}-${scheme}.png`);
        await pop.getByRole("link", { name: /Animate 3 poses/ }).click();
        await page.waitForURL(/\/video\?/, { timeout: 60_000 });
        await strip(page).waitFor({ timeout: 90_000 });
        check(`${tag}: the poses open as keyframes`, (await strip(page).locator("[data-gap-chip]").count()) === 2);
      } else check(`${tag}: character element made`, false);
      await page.goto(`${app}/character-sheet`, { waitUntil: "load" });
      await page.waitForTimeout(2500);
      check(`${tag}: no sideways scroll (Character Sheet)`, await noSideways(page));
      await shoot(page, `character-sheet-${width}-${scheme}.png`);
      check(`${tag}: no console errors (character)`, errors.length === 0, errors.slice(0, 2).join(" | "));
      await context.close();
    }
  }
}
await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nall passed");
