// Browser check of Character swap in 2K.
// Usage: node tests/e2e/character-swap-2k.mjs [appUrl] [outDir]   (the app in demo mode: no keys, no ComfyUI)
// At 1440 px and 390 px, light and dark: Character Swap Studio's Assemble → Finish with "Sharpen to 1080p / 2K / 4K"
// (the sizes picked by keyboard and by touch, why a size can't be picked as text on the page, the price or GPU time, Run),
// on a cloud project with a chosen take and on a project on your GPU; a run on the cloud makes a 2K version that Takes &
// review shows beside the take with "Use the 2K version"; Genjutsu's Character swap Quality with 2K and 4K and their
// prices (the cloud) or GPU time (your GPU, with 1080p, and 4K turned off with the reason). No sideways scroll anywhere,
// no page error and no console error. Screenshots go to outDir.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DESKTOP, PHONE, launch, openRoute, root } from "./_browser.mjs";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const app = (args[0] ?? "http://localhost:3440").replace(/\/$/, "");
const out = args[1] ?? fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-swap-2k-"));
fs.mkdirSync(out, { recursive: true });

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
};
const json = async (p, init) => {
  const res = await fetch(app + p, { headers: { "Content-Type": "application/json" }, ...init });
  const body = await res.json();
  if (!res.ok) throw new Error(`${p}: ${body.error ?? res.status}`);
  return body;
};
const upload = async (file, type) => {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)], { type }), path.basename(file));
  const res = await fetch(`${app}/api/uploads`, { method: "POST", body: form });
  const body = await res.json();
  if (!res.ok) throw new Error(`upload: ${body.error}`);
  return body.url;
};
const noSideScroll = async (page, label) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 0, `${label}: no horizontal scroll (${over}px)`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A 6 s 1920×1080 clip with sound (H.264: the server reads its header; the checks don't play it), and the character.
const clipFile = path.join(out, "street.mp4");
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", path.join(root, "scripts/eval/fixtures/walk-6s.mp4"), "-t", "6", "-vf", "scale=1920:1080,setsar=1", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", clipFile]);
const clipUrl = await upload(clipFile, "video/mp4");
const heroUrl = await upload(path.join(root, "scripts/eval/fixtures/character/drawn-face-2.png"), "image/png");

// A rerun starts clean.
for (const p of (await json("/api/swap-studio/projects")).items ?? []) if (/^2K check/.test(p.name)) await fetch(`${app}/api/swap-studio/projects/${p.id}`, { method: "DELETE" });

/** A project with the clip, no scene anchor, one 6 s segment; on the cloud its take is made (demo) and chosen. */
async function project(engine) {
  const p = await json("/api/swap-studio/projects", { method: "POST", body: JSON.stringify({ name: `2K check · ${engine}`, engine, character: { image: heroUrl, description: "a cartoon man with round glasses" } }) });
  let v = await json(`/api/swap-studio/projects/${p.id}/clips`, { method: "POST", body: JSON.stringify({ url: clipUrl, name: "street.mp4" }) });
  const c = v.clips[0];
  const shot = c.shots[0];
  const edit = (e) => json(`/api/swap-studio/projects/${p.id}`, { method: "PATCH", body: JSON.stringify(e) });
  await edit({ type: "shot", clipId: c.id, shotId: shot.id, patch: { settings: { useAnchor: false } } });
  v = await edit({ type: "layout", clipId: c.id, shotId: shot.id, op: { op: "partition", frames: 144 } });
  if (engine === "cloud") {
    const seg = v.clips[0].shots[0].segments[0];
    await json(`/api/swap-studio/projects/${p.id}/queue`, { method: "POST", body: JSON.stringify({ clipId: c.id, shotId: shot.id, segmentId: seg.id, mode: "all" }) });
    for (let i = 0; i < 120; i++) {
      const view = await json(`/api/swap-studio/projects/${p.id}`);
      const s = view.project.clips[0].shots[0].segments[0];
      if (s.selectedTake && view.gens[s.takes[0].genId]?.status === "succeeded") break;
      await sleep(1000);
    }
  }
  return { id: p.id, clipId: c.id, shotId: shot.id };
}

const cloud = await project("cloud");
const open = await project("open");

const browser = await launch();
try {
  for (const [dname, device] of [
    ["1440", DESKTOP],
    ["390", PHONE],
  ]) {
    for (const theme of ["light", "dark"]) {
      const label = `${dname} ${theme}`;
      const ctx = await browser.newContext({ ...device, colorScheme: theme });
      await ctx.route((u) => u.origin !== new URL(app).origin && /^https?:$/.test(u.protocol), (rt) => rt.abort());
      const page = await ctx.newPage();
      page.on("pageerror", (e) => failures.push(`${label} page error: ${e.message.split("\n")[0]}`));
      // React reports hydration errors on the console: every console error fails the check.
      page.on("console", (m) => m.type() === "error" && failures.push(`${label} console error: ${m.text().split("\n")[0]}`));
      const touch = !!device.hasTouch;
      const press = (loc) => (touch ? loc.tap() : loc.click());

      // ---- Character Swap Studio on the cloud: Assemble → Finish.
      await openRoute(page, `${app}/character-swap/${cloud.id}`);
      await press(page.getByRole("tab", { name: "Assemble" }));
      const sharpenTitle = page.getByRole("heading", { name: "Sharpen to 1080p / 2K / 4K" });
      await sharpenTitle.waitFor({ timeout: 60_000 });
      check(await sharpenTitle.isVisible(), `${label} cloud: the Sharpen card`);
      await page.getByText(/1 chosen take/).waitFor({ timeout: 30_000 }).catch(() => undefined);
      check((await page.getByRole("heading", { name: /backplate/i }).count()) === 0 && (await page.getByText("Not available", { exact: false }).count()) === 0, `${label} cloud: Finish is Sharpen alone`);
      const sizes = page.getByRole("radiogroup", { name: "Sharpen to" });
      const r = (n) => sizes.getByRole("radio", { name: n, exact: true });
      check(await r("1080p").isDisabled(), `${label} cloud: 1080p is off (fal makes 2K or 4K)`);
      check((await r("2K").getAttribute("aria-checked")) === "true", `${label} cloud: 2K is picked`);
      check(await r("4K").isDisabled(), `${label} cloud: 4K is off (the film is joined at 1920×1080)`);
      // Why, as text on the page that the size group points to (a turned-off size can't take focus or show a tooltip on touch).
      const why = await sizes.getAttribute("aria-describedby");
      const whyText = why ? await page.locator(`[id="${why}"]`).innerText() : "";
      check(/4K: Joined at 1920×1080, so 4K adds nothing to the film/.test(whyText) && (await page.locator(`[id="${why}"]`).isVisible()), `${label} cloud: 4K says why, on the page`);
      check(/1080p: The cloud makes 2K or 4K/.test(whyText), `${label} cloud: 1080p says why, on the page`);
      await page.waitForFunction(() => /Placeholder · free|≈ \$/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => undefined);
      const body = await page.evaluate(() => document.body.innerText);
      check(/Makes each chosen take again at 2K on MiniMax H3/.test(body), `${label} cloud: the cloud's copy (a new render, the whole frame)`);
      check(/1 chosen take · 6 s · MiniMax H3 at 2K/.test(body), `${label} cloud: the takes and seconds`);
      check(/Placeholder · free|≈ \$/.test(body), `${label} cloud: a price before running`);
      check(/joined at 1920×1080/i.test(body), `${label} cloud: the join's size`);
      // Keyboard reaches the size and the button.
      await r("2K").focus();
      check(await page.evaluate(() => document.activeElement?.getAttribute("role") === "radio"), `${label} cloud: keyboard focus on the size`);
      const run = page.getByRole("button", { name: /^Sharpen to 2K/ });
      if (await run.isEnabled()) {
        await run.focus();
        check(await page.evaluate(() => /Sharpen to 2K/.test(document.activeElement?.textContent ?? "")), `${label} cloud: keyboard focus on Sharpen`);
      } else check(/1 of 1 ready/.test(body), `${label} cloud: Sharpen rests once every chosen take has its 2K version`);
      await noSideScroll(page, `${label} cloud Assemble`);
      await page.screenshot({ path: path.join(out, `assemble-cloud-${dname}-${theme}.png`), fullPage: true });

      // Run once (the first pass), then the version beside the take in Takes & review.
      if (dname === "1440" && theme === "light") {
        await run.click();
        await page.getByText(/of 1 ready/).waitFor({ timeout: 30_000 });
        check(true, `${label} cloud: Sharpen runs (a 2K version on its way)`);
        await page.getByText(/1 of 1 ready/).waitFor({ timeout: 120_000 });
      }
      await press(page.getByRole("tab", { name: "Takes & review" }));
      await page.getByText("2K version").first().waitFor({ timeout: 60_000 });
      const use = page.getByRole("button", { name: "Use the 2K version" });
      const using = page.getByText("The assembly uses the 2K version");
      if ((await use.count()) > 0) {
        check(true, `${label} cloud: the 2K version beside the take, with Use the 2K version`);
        await press(use);
        await using.waitFor({ timeout: 15_000 });
      }
      check(await using.isVisible(), `${label} cloud: picked, the assembly uses it`);
      await noSideScroll(page, `${label} cloud Takes & review`);
      await page.screenshot({ path: path.join(out, `review-cloud-${dname}-${theme}.png`), fullPage: true });
      // Back to the take for the next pass.
      await press(page.getByRole("button", { name: "Use the take instead" }));
      await use.waitFor({ timeout: 15_000 });

      // ---- On your GPU: 1080p only (the footage is 1080p), free, the GPU time.
      await openRoute(page, `${app}/character-swap/${open.id}`);
      await press(page.getByRole("tab", { name: "Assemble" }));
      await page.getByRole("heading", { name: "Sharpen to 1080p / 2K / 4K" }).waitFor({ timeout: 60_000 });
      const og = page.getByRole("radiogroup", { name: "Sharpen to" });
      check((await og.getByRole("radio", { name: "1080p", exact: true }).getAttribute("aria-checked")) === "true", `${label} GPU: 1080p is picked`);
      check(await og.getByRole("radio", { name: "2K", exact: true }).isDisabled(), `${label} GPU: 2K is off (the part redrawn is below 1440)`);
      check(await og.getByRole("radio", { name: "4K", exact: true }).isDisabled(), `${label} GPU: 4K is off (joined at up to 2048 px)`);
      const ogWhy = await og.getAttribute("aria-describedby");
      const ogText = ogWhy ? await page.locator(`[id="${ogWhy}"]`).innerText() : "";
      check(/2K: Your character is redrawn in a 1842×1052 part of the frame/.test(ogText), `${label} GPU: 2K says why, on the page`);
      check(/4K: Your GPU joins the clip at up to 2048 px a side, so 4K adds nothing over 2K/.test(ogText), `${label} GPU: 4K says why, on the page`);
      const ob = await page.evaluate(() => document.body.innerText);
      check(/Redraws each chosen take at 1080p with Open-H3 Regenerate, then puts only your character back over the original footage/.test(ob), `${label} GPU: the card names the size picked and the model`);
      check(/Free on your GPU · about \d+ min on a 72 GB GPU|Placeholder · free/.test(ob), `${label} GPU: free, with the GPU time`);
      check(/Choose a take for every swapped segment first/.test(ob), `${label} GPU: says what's missing before it can run`);
      check(await page.getByRole("button", { name: /^Sharpen to 1080p/ }).isDisabled(), `${label} GPU: Run waits for the takes`);
      await noSideScroll(page, `${label} GPU Assemble`);
      await page.screenshot({ path: path.join(out, `assemble-open-${dname}-${theme}.png`), fullPage: true });

      // ---- Genjutsu's Character swap: Quality with 2K and 4K.
      for (const engine of ["cloud", "open"]) {
        await page.evaluate((e) => localStorage.setItem("fuobe.engine", e), engine);
        await openRoute(page, `${app}/genjutsu?mode=character&video=${encodeURIComponent(clipUrl)}&image=${encodeURIComponent(heroUrl)}`);
        const q = page.getByRole("radiogroup", { name: "Quality" });
        await q.waitFor({ timeout: 60_000 });
        const names = await q.getByRole("radio").allInnerTexts();
        check(
          JSON.stringify(names.map((s) => s.trim())) === JSON.stringify(engine === "cloud" ? ["480p", "768p", "2K", "4K"] : ["480p", "768p", "1080p", "2K", "4K"]),
          `${label} Genjutsu ${engine}: Quality offers ${names.join(", ")}`,
        );
        // Keyboard: from 768p, the arrow picks the next size.
        await q.getByRole("radio", { name: "768p", exact: true }).focus();
        await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(300);
        const next = engine === "cloud" ? "2K" : "1080p";
        check((await q.getByRole("radio", { name: next, exact: true }).getAttribute("aria-checked")) === "true", `${label} Genjutsu ${engine}: the arrow key picks ${next}`);
        await press(q.getByRole("radio", { name: "2K", exact: true }));
        await page.waitForTimeout(300);
        const g = await page.evaluate(() => document.body.innerText);
        // The whole line is on the page, not cut short (the field's hint holds the short price).
        const line = page.getByText(/redraw the 768p swap at the higher size/);
        const fits = await line.evaluate((el) => el.scrollWidth <= el.clientWidth + 1 && getComputedStyle(el).textOverflow !== "ellipsis").catch(() => false);
        check(fits, `${label} Genjutsu ${engine}: the size's line wraps instead of being cut`);
        if (engine === "cloud") {
          check(/2K and 4K redraw the 768p swap at the higher size\. \$0\.81 for 5 s, \$2\.44 for 15 s\./.test(g), `${label} Genjutsu cloud: 2K's price ($0.81 for 5 s)`);
          await press(q.getByRole("radio", { name: "4K", exact: true }));
          await page.waitForTimeout(300);
          check(/\$1\.00 for 5 s, \$3\.00 for 15 s/.test(await page.evaluate(() => document.body.innerText)), `${label} Genjutsu cloud: 4K's price`);
        } else {
          check(/1080p and 2K redraw the 768p swap at the higher size\. Free on your GPU, about 3 min more per 5 s on a 72 GB GPU\. Your GPU joins the clip at up to 2048 px a side/.test(g), `${label} Genjutsu GPU: free, with the GPU time and the 2048 px join`);
          check(await q.getByRole("radio", { name: "4K", exact: true }).isDisabled(), `${label} Genjutsu GPU: 4K is off`);
          const qWhy = await q.getAttribute("aria-describedby");
          check(!!qWhy && /4K: Your GPU joins the clip at up to 2048 px a side, so 4K adds nothing over 2K/.test(await page.locator(`[id="${qWhy}"]`).innerText()), `${label} Genjutsu GPU: 4K says why, on the page`);
        }
        await noSideScroll(page, `${label} Genjutsu ${engine}`);
        await page.screenshot({ path: path.join(out, `genjutsu-${engine}-${dname}-${theme}.png`), fullPage: true });
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
for (const p of [cloud, open]) await fetch(`${app}/api/swap-studio/projects/${p.id}`, { method: "DELETE" });
console.log(failures.length ? `\n${failures.length} failed:\n- ${failures.join("\n- ")}` : "\nAll checks passed");
process.exit(failures.length ? 1 : 0);
