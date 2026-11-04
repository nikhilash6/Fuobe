// The evaluation harness's pages in a browser: the run report (contact sheet) and the blind A/B
// review, at 1440 and 390 px, light and dark. Checks that nothing scrolls sideways, that the review
// never names a variant, and that keyboard ratings reach review/ratings.json and the summary.
//
//   node tests/e2e/eval-review.mjs            (builds a small run from the fixtures in a temp folder)
//   node tests/e2e/eval-review.mjs <run dir>  (a real run: scripts/eval/results/<runId>)
//
// Screenshots go to $SHOTS (default: the temp folder).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DESKTOP, launch, PHONE, root } from "./_browser.mjs";
import { tempDir } from "./_temp.mjs";

const { writeReport, loadRun } = await import(path.join(root, "scripts/eval/lib/report.mjs"));
const { serveReview, writeReview } = await import(path.join(root, "scripts/eval/lib/review.mjs"));
const { latestJobs } = await import(path.join(root, "scripts/eval/lib/store.mjs"));

const tmp = tempDir("fuobe-eval-review-");
const shots = process.env.SHOTS ?? fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-eval-review-shots-"));
let runDir = process.argv[2] ? path.resolve(process.argv[2]) : null;

/** A run like the runner writes: two looks × two variants × two seeds, on the fixture images. */
function fixtureRun() {
  const dir = path.join(tmp, "results", "20261023-120000-soul-open-e2e0");
  fs.mkdirSync(path.join(dir, "outputs"), { recursive: true });
  const pics = ["start-frame.png", "end-frame.png", "references/warm-1.png", "references/warm-2.png"].map((f) => path.join(root, "scripts/eval/fixtures", f));
  const rows = [];
  const metrics = { version: 1, jobs: {}, groups: {}, models: { clip: { repo: "laion/CLIP-ViT-B-32-laion2B-s34B-b79K", licence: "MIT" } }, skipped: {} };
  let n = 0;
  for (const look of ["v1-general", "v2-flash-editorial"]) {
    for (const variant of ["recipe", "prompt-only"]) {
      for (const seed of [1001, 2002]) {
        const id = `soul__${look}--portrait--s${seed}--${variant}`;
        fs.mkdirSync(path.join(dir, "outputs", id), { recursive: true });
        fs.copyFileSync(pics[n++ % pics.length], path.join(dir, "outputs", id, "1.png"));
        rows.push({
          id,
          key: `soul/${look}/portrait/s${seed}`,
          suite: "soul",
          caseId: `soul/${look}`,
          caseTitle: look === "v1-general" ? "Soul v1 · General" : "Soul 2.0 · Flash editorial — a long title that has to wrap on a phone without pushing the page sideways",
          variant,
          promptId: "portrait",
          prompt: "a young woman with freckles and loose dark hair looks over her shoulder on a quiet city street",
          seed,
          engine: "open",
          kind: "image",
          status: "succeeded",
          model: { id: "oss-z-image-turbo", provider: "comfyui" },
          outputs: [{ file: `outputs/${id}/1.png`, kind: "image" }],
          recipe: { kind: "soul-look", look: { name: look }, applied: variant === "recipe" ? [{ file: "AWPortrait-Z.safetensors", strength: 0.6 }] : [], sent: { complete: true, loras: [] }, complete: true },
          costUsd: { estimate: 0, actual: 0 },
          timing: { wallMs: 9000 + seed },
          notes: [],
        });
        metrics.jobs[id] = { clip: 25 + seed / 1000 + (variant === "recipe" ? 1 : 0), aesthetic: 5.5, style: 0.6 + (variant === "recipe" ? 0.05 : 0) };
      }
    }
  }
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify({ runId: path.basename(dir), suite: "soul", title: "Fuobe Soul · the 139 looks", engine: "open", variants: ["recipe", "prompt-only"], variantInfo: { recipe: "The research recipe", "prompt-only": "The look's words without LoRAs" }, startedAt: Date.now(), server: { url: "http://localhost:3000" }, harness: { commit: "e2e" } }));
  fs.writeFileSync(path.join(dir, "jobs.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  fs.writeFileSync(path.join(dir, "metrics.json"), JSON.stringify(metrics));
  return dir;
}

runDir ??= fixtureRun();
const resultsRoot = path.dirname(runDir);
writeReport(runDir, resultsRoot);
const runId = path.basename(runDir);
const made = writeReview({ dir: runDir, runId, rows: latestJobs(runDir) });
const { server, url } = await serveReview(runDir);

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
};

const browser = await launch();
try {
  for (const [name, device] of [
    ["1440", DESKTOP],
    ["390", PHONE],
  ]) {
    for (const scheme of ["light", "dark"]) {
      const ctx = await browser.newContext({ ...device, colorScheme: scheme });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));

      await page.goto(pathToFileURL(path.join(runDir, "report.html")).href, { waitUntil: "load" });
      // The contact sheet's pictures load lazily: bring each into view (a run of clips may have one picture at the end).
      await page.evaluate(async () => {
        for (const m of document.querySelectorAll("img, video")) m.scrollIntoView({ block: "center" });
        await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(300);
      const report = await page.evaluate(() => ({
        overflow: document.scrollingElement.scrollWidth - window.innerWidth,
        bg: getComputedStyle(document.body).backgroundColor,
        imgs: [...document.images].filter((i) => i.complete && i.naturalWidth > 0).length + [...document.querySelectorAll("video")].filter((v) => v.readyState >= 1).length,
        h1: document.querySelector("h1")?.textContent,
      }));
      check(report.overflow <= 0, `report ${name} ${scheme}: no sideways scroll (${report.overflow}px over)`);
      check(scheme === "dark" ? report.bg === "rgb(9, 9, 11)" : report.bg === "rgb(255, 255, 255)", `report ${name} ${scheme}: ${scheme} background (${report.bg})`);
      check(report.imgs > 0, `report ${name} ${scheme}: ${report.imgs} pictures and clips load`);
      await page.screenshot({ path: path.join(shots, `report-${name}-${scheme}.png`), fullPage: false });

      await page.goto(url, { waitUntil: "load" });
      await page.waitForSelector("#stage img, #stage video, #stage h2, #stage p");
      const review = await page.evaluate(() => ({ overflow: document.scrollingElement.scrollWidth - window.innerWidth, text: document.body.innerText }));
      check(review.overflow <= 0, `review ${name} ${scheme}: no sideways scroll (${review.overflow}px over)`);
      check(!/prompt-only|recipe/.test(review.text), `review ${name} ${scheme}: the page doesn't name a variant`);
      await page.screenshot({ path: path.join(shots, `review-${name}-${scheme}.png`), fullPage: false });
      check(errors.length === 0, `${name} ${scheme}: no page errors ${errors.join("; ")}`);
      await ctx.close();
    }
  }

  // Rate every pair with the keyboard on a desktop: ← for the first half, → for the rest, one undo on the way.
  const ctx = await browser.newContext(DESKTOP);
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: "load" });
  await page.waitForSelector("#stage");
  // A keyboard user who tabs to "Left is better" and presses Space rates left (the button's own action), not "same".
  const ratingsFile = path.join(runDir, "review", "ratings.json");
  const before = fs.existsSync(ratingsFile) ? JSON.parse(fs.readFileSync(ratingsFile, "utf8")).ratings.length : 0;
  await page.focus('[data-choice="left"]');
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
  const pressed = JSON.parse(fs.readFileSync(ratingsFile, "utf8")).ratings;
  check(pressed.length === before + 1 && pressed.at(-1).choice === "left", `review: Space on the focused "Left is better" button rates left (${pressed.at(-1)?.choice})`);
  await page.keyboard.press("u");
  await page.waitForTimeout(200);
  for (let i = 0; i < made.pairs; i++) {
    await page.keyboard.press(i < made.pairs / 2 ? "ArrowLeft" : "ArrowRight");
    await page.waitForTimeout(180);
    if (i === 0) {
      await page.keyboard.press("u");
      await page.waitForTimeout(120);
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(180);
    }
  }
  await page.waitForTimeout(400);
  const done = await page.locator("#stage").innerText();
  check(/All done/.test(done), `review: all ${made.pairs} pairs rated ("${done.split("\n")[0]}")`);
  check(/Saved to the run folder/.test(await page.locator("#saved").innerText()), "review: ratings saved to the run folder");
  const saved = JSON.parse(fs.readFileSync(path.join(runDir, "review", "ratings.json"), "utf8"));
  check(saved.ratings.length === made.pairs, `review/ratings.json holds ${saved.ratings.length} of ${made.pairs} ratings`);
  // A reload resumes where the ratings are.
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(300);
  check(/All done/.test(await page.locator("#stage").innerText()), "review: a reload keeps the ratings");
  await ctx.close();

  const summary = writeReport(runDir, resultsRoot);
  check(summary.ratings.total === made.pairs, `summary: ${summary.ratings.total} ratings unblinded (${JSON.stringify(summary.ratings.pairs)})`);
  check(loadRun(runDir).ratings.ratings.every((r) => ["left", "right", "same", "skip"].includes(r.choice)), "summary: ratings keep their choices");
} finally {
  await browser.close();
  server.close();
}

console.log(`\nScreenshots: ${shots}`);
if (failures.length) {
  console.log(`${failures.length} check(s) failed`);
  process.exit(1);
}
