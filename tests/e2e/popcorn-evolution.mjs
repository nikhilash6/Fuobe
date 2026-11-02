// Build plan O13, browser check: Video tools → Evolution, the Storyboard's Soul looks and the Canvas picker's
// Effects 2.0 chains, at 1440 and 390 px, light and dark, in demo mode (no keys, ComfyUI and Ollama unreachable).
// Evolution: a clip goes in, Low / Medium / High, the direction written by the offline writer, a long direction said to
// be cut, the price before it runs (a demo), a run that finishes with a before / after; the cloud runs the GPU's model
// hosted on fal (Wan 2.2 Fun VACE, no LTX-2.3), 480p / 580p / 720p, and says in one line what stays on the GPU; the open
// engine says "on your GPU". Storyboard: the cloud board runs on Fuobe's open recipe with Nano Banana Pro a partner choice, the look chip
// starts at "No look", a look is picked, the board's price is shown, a board in that look is made. Canvas: the
// effect films have their own section and one opens as a canvas with the edit and the effect. Nothing scrolls
// sideways. Usage: node tests/e2e/popcorn-evolution.mjs [appUrl] [--shots <dir>]. Exits 1 on a failed check.
import fs from "node:fs";
import path from "node:path";
import { launch, root } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(72)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};

const clipFile = path.join(root, "scripts/eval/fixtures/walk-6s.mp4");
const refFile = path.join(root, "scripts/eval/fixtures/references/warm-1.png");

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
      // Every label a look chip shows on a page, from the server's HTML on (the Storyboard's must only ever say No look).
      await context.addInitScript(() => {
        window.__lookLabels = [];
        new MutationObserver(() => {
          for (const b of document.querySelectorAll('button[aria-label^="Look: "]')) {
            const label = b.getAttribute("aria-label");
            if (!window.__lookLabels.includes(label)) window.__lookLabels.push(label);
          }
        }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-label"] });
      });
      const page = await context.newPage();
      const shot = async (name) => shots && (await page.screenshot({ path: path.join(shots, `${name}-${width}-${scheme}.png`), fullPage: true }));
      const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const text = () => page.evaluate(() => document.body.innerText);

      // ---- Evolution
      await page.goto(`${app}/video-tools/evolution`, { waitUntil: "load", timeout: 180_000 });
      await page.getByRole("heading", { name: "Take a clip further" }).waitFor({ timeout: 120_000 });
      check(`${tag}: Evolution is a Video tools tab`, (await page.getByRole("link", { name: "Evolution" }).count()) + (await page.getByRole("tab", { name: "Evolution" }).count()) > 0);
      check(`${tag}: no sideways scroll (Evolution, empty)`, (await sideways()) <= 1, `${await sideways()} px`);
      await page.locator('input[type="file"]').first().setInputFiles(clipFile);
      const change = page.getByRole("radiogroup", { name: "How much should change?" });
      await change.waitFor({ timeout: 60_000 });
      check(`${tag}: Low / Medium / High, Medium first`, (await change.getByRole("radio").allInnerTexts()).join("|") === "Low|Medium|High" && (await change.getByRole("radio", { name: "Medium" }).getAttribute("aria-checked")) === "true");
      await page.getByRole("radio", { name: "High" }).click();
      check(`${tag}: the intensity says what stays`, /Only the motion and timing stay/.test(await text()));
      // A reference, then the writer.
      await page.locator('input[type="file"][accept="image/*"][multiple]').setInputFiles(refFile);
      await page.waitForFunction(() => !document.body.innerText.includes("Uploading references"), null, { timeout: 30_000 }).catch(() => {});
      const direction = page.getByRole("textbox", { name: "Creative direction" });
      // A direction longer than the models take: the page says so as you type (the words stay out of the estimate).
      await page.waitForFunction(() => /Placeholder · free|≈ \$|Free/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => {});
      await direction.fill("A night market in the rain. ".repeat(80));
      await page.waitForFunction(() => /Only the first 1,500 characters of the direction reach the model/.test(document.body.innerText), null, { timeout: 15_000 }).catch(() => {});
      check(`${tag}: a long direction is said to be cut`, /Only the first 1,500 characters of the direction reach the model/.test(await text()));
      await direction.fill("");
      await page.waitForFunction(() => !/Only the first 1,500 characters/.test(document.body.innerText), null, { timeout: 15_000 }).catch(() => {});
      check(`${tag}: an empty one isn't`, !/Only the first 1,500 characters/.test(await text()));
      await page.getByRole("button", { name: "Write it for me" }).click();
      await page.waitForFunction(() => (document.querySelector("#evolution-direction")?.value ?? "").length > 40, null, { timeout: 30_000 }).catch(() => {});
      const written = await direction.inputValue();
      check(`${tag}: the offline writer wrote the direction`, /reimagined from the ground up/.test(written) && /Written by Fuobe's offline writer/.test(await text()), JSON.stringify(written.slice(0, 50)));
      await page.waitForFunction(() => /Placeholder · free|≈ \$|Free/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => {});
      check(`${tag}: the price before it runs (a demo here)`, /Placeholder · free/.test(await text()) && /Fuobe Evolution · \d+(\.\d+)? s · 720p/.test(await text()));
      // The cloud runs the GPU's model hosted on fal, never a substitute, and says in one line what the GPU keeps.
      check(`${tag}: cloud: Wan 2.2 Fun VACE hosted on fal, no LTX-2.3`, /runs the GPU's model hosted on fal/.test(await text()) && /Wan 2\.2 Fun VACE re-renders the piece by its depth with that frame as its reference/.test(await text()) && !/LTX/.test(await text()));
      check(`${tag}: cloud: one line says the change level's limit`, /In the cloud the change level shapes each piece's direction frame; how much of the clip's own look stays is set on your GPU only/.test(await text()));
      check(`${tag}: cloud: the references reach each piece's direction frame`, /In the cloud the first 3 also go into each piece's direction frame/.test(await text()));
      check(`${tag}: cloud: 480p, 580p or 720p`, (await page.getByRole("radiogroup", { name: "Resolution" }).getByRole("radio").allInnerTexts()).join("|") === "480p|580p|720p");
      check(`${tag}: no sideways scroll (Evolution, set up)`, (await sideways()) <= 1, `${await sideways()} px`);
      await shot("evolution-setup");
      await page.getByRole("button", { name: "Evolve" }).click();
      await page.getByRole("heading", { name: /^Evolution · / }).waitFor({ timeout: 30_000 }).catch(() => {});
      const done = await page
        .getByRole("slider", { name: /Compare the original and the result/ })
        .waitFor({ timeout: 120_000 })
        .then(() => true)
        .catch(() => false);
      check(`${tag}: the run finishes with a before / after`, done);
      check(`${tag}: the run says who wrote its direction`, /Written by Fuobe's offline writer:/.test(await text()));
      await shot("evolution-done");
      // The open engine: free, segments, the GPU line.
      await page.getByRole("radiogroup", { name: "Engine" }).getByRole("radio", { name: "Open source" }).click();
      await page.waitForFunction(() => /segments|Needs a 24 GB GPU/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => {});
      check(`${tag}: open engine: 480p first, the GPU line`, (await page.getByRole("radiogroup", { name: "Resolution" }).getByRole("radio", { name: "480p" }).getAttribute("aria-checked")) === "true" && /Needs a 24 GB GPU/.test(await text()));
      check(`${tag}: open engine: no cloud-only line`, !/In the cloud the change level/.test(await text()));
      check(`${tag}: no sideways scroll (Evolution, open)`, (await sideways()) <= 1, `${await sideways()} px`);
      await page.getByRole("radiogroup", { name: "Engine" }).getByRole("radio", { name: "Cloud" }).click();

      // ---- Storyboard
      await page.goto(`${app}/storyboard`, { waitUntil: "load", timeout: 180_000 });
      await page.getByRole("heading", { name: "Tell it frame by frame" }).waitFor({ timeout: 120_000 });
      const chip = page.getByRole("button", { name: "Look: No look" });
      await chip.waitFor({ timeout: 30_000 });
      // The chip is its own chunk: until that chunk is in, the server's chip can be swapped for a placeholder and back
      // (for a moment, or most of a second on a busy server). So it's counted once the chip on screen is React's, and
      // every label it showed on the way counts too.
      const hydrated = await page
        .waitForFunction(() => {
          const b = document.querySelectorAll('button[aria-label^="Look: "]');
          return b.length === 1 && Object.keys(b[0]).some((k) => k.startsWith("__react"));
        }, null, { timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
      const labels = await page.evaluate(() => window.__lookLabels);
      check(`${tag}: the look chip starts at No look`, hydrated && (await chip.count()) === 1 && labels.join("|") === "Look: No look", labels.join(", "));
      // The cloud board is Fuobe's open recipe; Nano Banana Pro is a partner choice.
      const frames = page.getByRole("radiogroup", { name: "Frames made on" });
      check(`${tag}: cloud frames on Fuobe first, Nano Banana Pro a choice`, (await frames.getByRole("radio", { name: "Fuobe" }).getAttribute("aria-checked")) === "true" && (await frames.getByRole("radio", { name: "Nano Banana Pro" }).count()) === 1);
      check(`${tag}: it runs on hosted Qwen-Image-Edit with the next-scene LoRA`, /Runs on Qwen-Image-Edit 2509 \(hosted\) with the next-scene LoRA/.test(await text()));
      await frames.getByRole("radio", { name: "Nano Banana Pro" }).click();
      await page.waitForFunction(() => /Runs on Nano Banana Pro\./.test(document.body.innerText), null, { timeout: 15_000 }).catch(() => {});
      check(`${tag}: the partner choice says so`, /Runs on Nano Banana Pro\./.test(await text()));
      await frames.getByRole("radio", { name: "Fuobe" }).click();
      await page.getByRole("textbox", { name: "Your story" }).fill("a girl waits at a rainy bus stop, the bus arrives, she looks back");
      await chip.click();
      // DigitalCam is a Soul look (the picker opens on Soul 2.0): a search looks through both.
      await page.getByRole("textbox", { name: "Search looks" }).fill("DigitalCam");
      const pick = page.getByRole("button", { name: "DigitalCam" }).first();
      await pick.waitFor({ timeout: 30_000 });
      await pick.click();
      await page.getByRole("button", { name: "Look: DigitalCam" }).waitFor({ timeout: 15_000 }).catch(() => {});
      check(`${tag}: a look is picked`, (await page.getByRole("button", { name: "Look: DigitalCam" }).count()) === 1);
      await page.waitForFunction(() => /Frame 1 sets the DigitalCam look/.test(document.body.innerText), null, { timeout: 15_000 }).catch(() => {});
      check(`${tag}: it says frame 1 sets the look`, /Frame 1 sets the DigitalCam look/.test(await text()));
      await page.waitForFunction(() => /Placeholder · free/.test(document.body.innerText), null, { timeout: 15_000 }).catch(() => {});
      check(`${tag}: the board's price before it runs (a demo here)`, /Placeholder · free/.test(await text()) && /4 frames/.test(await text()));
      check(`${tag}: no sideways scroll (Storyboard)`, (await sideways()) <= 1, `${await sideways()} px`);
      await shot("storyboard-look");
      await page.getByRole("button", { name: "Generate storyboard" }).click();
      const board = await page
        .getByRole("button", { name: "Open frame 1" })
        .first()
        .waitFor({ timeout: 90_000 })
        .then(() => true)
        .catch(() => false);
      check(`${tag}: a board in the look is made (demo)`, board && /Fuobe Soul/.test(await text()));
      check(`${tag}: no sideways scroll (Storyboard with a board)`, (await sideways()) <= 1, `${await sideways()} px`);

      // ---- Canvas: effect films
      await page.goto(`${app}/canvas?tab=templates`, { waitUntil: "load", timeout: 180_000 });
      const section = page.getByRole("heading", { name: "Effect films" });
      await section.waitFor({ timeout: 120_000 });
      const cards = await page.locator("section", { has: section }).getByRole("button", { name: "Use template" }).count();
      check(`${tag}: the effect films have their own section`, cards >= 10, `${cards} cards`);
      check(`${tag}: the chain cards name their models`, /Qwen-Image-Edit 2511 \(hosted\) · Fuobe DoP/.test(await text()));
      check(`${tag}: no sideways scroll (templates)`, (await sideways()) <= 1, `${await sideways()} px`);
      await shot("canvas-templates");
      if (width >= 1000 && scheme === "light") {
        const card = page.locator("article", { hasText: "Agamemnon" });
        await card.getByRole("button", { name: "Use template" }).click();
        await page.waitForURL(/\/canvas\/[^?]+/, { timeout: 60_000 });
        await page.getByText("Set the scene").first().waitFor({ timeout: 60_000 }).catch(() => {});
        check(`${tag}: a chain opens as a canvas: the edit, then the effect`, /Set the scene/.test(await text()) && /Agamemnon/.test(await text()));
        await shot("canvas-chain");
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
