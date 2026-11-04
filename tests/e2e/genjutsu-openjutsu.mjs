// Genjutsu's Openjutsu modes, browser check. As the owner (a studio without a password): the From picture and Finish
// tabs show and every tab is 44 px tall; Character swap with four characters shows Who becomes who, and a tap on the
// part's first frame writes where that person stands; From picture's two-step header with step 2 locked until a frame
// is used; Finish's tool switch; nothing scrolls sideways at 390 px. With --guest (a studio with a password and public
// sign-up, nothing open yet): only the five existing tabs, ?mode=picture and ?mode=finish land on Motion transfer, and
// nothing scrolls sideways at 390 or 1440 px.
// Usage: node tests/e2e/genjutsu-openjutsu.mjs [appUrl] [--guest] [--shots <dir>]   (app running in demo mode). Exits 1 on a failed check.
import fs from "node:fs";
import path from "node:path";
import { launch, root } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const guest = argv.includes("--guest");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(72)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};
const EXISTING = ["Motion transfer", "Character swap", "Object swap", "Restyle", "Insert"];

async function upload(file, type, name) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(path.join(root, file))], { type }), name);
  const res = await fetch(`${app}/api/uploads`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return (await res.json()).url;
}
const code = (o) => `gj1.${Buffer.from(JSON.stringify(o)).toString("base64url")}`;

const browser = await launch();
try {
  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
    await context.addInitScript(() => {
      try {
        localStorage.setItem("fuobe.engine", "open");
      } catch {}
    });
    const page = await context.newPage();
    const shot = async (name) => shots && (await page.screenshot({ path: path.join(shots, `${name}-${width}.png`), fullPage: true }));
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const tabs = async () => (await page.getByRole("tablist", { name: "Genjutsu modes" }).getByRole("tab").allInnerTexts()).map((t) => t.replace(/\s*Only you$/, "").trim());
    const open = async (url) => {
      await page.goto(`${app}${url}`, { waitUntil: "load", timeout: 180_000 });
      await page.getByRole("tablist", { name: "Genjutsu modes" }).waitFor({ timeout: 120_000 });
      await page.waitForTimeout(1500);
    };
    const selected = () => page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.replace(/Only you$/, ""));

    if (guest) {
      await open("/genjutsu");
      check(`${width}: a guest sees the five existing tabs only`, JSON.stringify(await tabs()) === JSON.stringify(EXISTING), JSON.stringify(await tabs()));
      check(`${width}: no "Only you" for a guest`, !(await page.evaluate(() => document.body.innerText.includes("Only you"))));
      check(`${width}: /genjutsu fits the screen`, (await sideways()) <= 0);
      await shot("guest-genjutsu");
      for (const m of ["picture", "finish"]) {
        await open(`/genjutsu?mode=${m}`);
        check(`${width}: ?mode=${m} lands on Motion transfer for a guest`, (await selected()) === "Motion transfer", String(await selected()));
      }
      await page.goto(`${app}/character-swap`, { waitUntil: "load", timeout: 120_000 });
      await page.waitForTimeout(1500);
      check(`${width}: /character-swap fits the screen`, (await sideways()) <= 0);
      await shot("guest-character-swap");
    } else {
      const clip = await upload("scripts/eval/fixtures/walk-6s.mp4", "video/mp4", "walk.mp4");
      const pics = [];
      for (let i = 0; i < 4; i++) pics.push(await upload("scripts/eval/fixtures/character/drawn-face-2.png", "image/png", `c${i}.png`));
      await open("/genjutsu");
      const t = await tabs();
      check(`${width}: the owner sees From picture and Finish`, t.includes("From picture") && t.includes("Finish"), JSON.stringify(t));
      const heights = await page.evaluate(() => [...document.querySelectorAll('[role="tablist"][aria-label="Genjutsu modes"] [role="tab"]')].map((b) => Math.round(b.getBoundingClientRect().height)));
      check(`${width}: every mode tab is 44 px tall`, heights.every((h) => h >= 44), JSON.stringify(heights));

      // Character swap with four characters on your GPU: Who becomes who, and a tap writes the words.
      await open(`/genjutsu?video=${encodeURIComponent(clip)}&setup=${code({ m: "character", e: "open", r: pics })}`);
      const rows = page.getByRole("textbox", { name: /Character \d replaces/ });
      await rows.first().waitFor({ timeout: 120_000 }).catch(() => {});
      check(`${width}: four characters, one "Replaces…" row each`, (await rows.count()) === 4, String(await rows.count()));
      check(`${width}: four characters fit the screen`, (await sideways()) <= 0);
      await shot("owner-group-swap");
      const tap = page.getByRole("button", { name: "Tap them" }).first();
      await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Tap them") && !b.disabled), null, { timeout: 60_000 }).catch(() => {});
      if (await tap.isEnabled()) {
        await tap.click();
        const stage = page.getByRole("button", { name: /Tap the person character 1 replaces/ });
        await stage.scrollIntoViewIfNeeded();
        const box = await stage.boundingBox();
        if (box) await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.5);
        check(`${width}: a tap on the left writes "the person on the left"`, (await rows.first().inputValue()) === "the person on the left", await rows.first().inputValue());
      } else check(`${width}: "Tap them" opens the part's first frame`, false, "the frame didn't load");

      // From picture: two steps, the first one first.
      await open(`/genjutsu?mode=picture&video=${encodeURIComponent(clip)}&image=${encodeURIComponent(pics[0])}`);
      const steps = page.getByRole("list", { name: "Steps" });
      await steps.waitFor({ timeout: 60_000 }).catch(() => {});
      check(`${width}: From picture's step 1 is current`, (await steps.locator('[aria-current="step"]').innerText().catch(() => "")) === "1 First frame");
      check(`${width}: Generate makes the first frame first`, await page.getByRole("button", { name: "Make the first frame" }).isVisible().catch(() => false));
      check(`${width}: the 17 looks and your own words`, (await page.getByRole("radiogroup", { name: "Light" }).getByRole("radio").count().catch(() => 0)) === 19);
      check(`${width}: From picture fits the screen`, (await sideways()) <= 0);
      await shot("owner-from-picture");

      // Finish: the two tools.
      await open(`/genjutsu?mode=finish&tool=faces&video=${encodeURIComponent(clip)}`);
      const tool = page.getByRole("radiogroup", { name: "Tool" });
      await tool.waitFor({ timeout: 60_000 }).catch(() => {});
      check(`${width}: Finish: Fix faces · Fix colours`, (await tool.getByRole("radio").allInnerTexts().catch(() => [])).join("|") === "Fix faces|Fix colours");
      check(`${width}: Finish fits the screen`, (await sideways()) <= 0);
      await shot("owner-finish");
    }
    await context.close();
  }
} finally {
  await browser.close();
}
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nall good");
