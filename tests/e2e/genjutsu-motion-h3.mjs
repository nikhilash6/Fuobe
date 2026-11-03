// Motion transfer's "MiniMax H3" model choice, browser check at 390 and 1440 px.
// Owner (a studio without a password): Motion transfer's Model list on your GPU shows Fuobe Genjutsu first, then
// MiniMax H3 marked "Only you"; picking it says 2–15 s, the price check runs it on MiniMax H3 and refuses 20 s in words.
// With --guest or --account (a studio with a password and public sign-up; the account signs up and has no GPU or key,
// so neither adds files; MiniMax H3 not open yet): the page never names MiniMax H3, the price check for it answers
// "That isn't available here.", and Fuobe Genjutsu's is never refused that way.
// --open: MiniMax H3 has opened (gpu-tested.json), so a visitor sees it too and its price check answers.
// Nothing scrolls sideways.
// Usage: node tests/e2e/genjutsu-motion-h3.mjs [appUrl] [--guest | --account] [--open] [--shots <dir>]. Exits 1 on a failed check.
import fs from "node:fs";
import path from "node:path";
import { launch, root } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const who = argv.includes("--guest") ? "guest" : argv.includes("--account") ? "account" : "owner";
const opened = argv.includes("--open");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(76)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};
const H3 = "oss-h3-motion";
const NOT_HERE = "That isn't available here.";

async function upload(request, file, type, name) {
  const res = await request.post(`${app}/api/uploads`, { multipart: { file: { name, mimeType: type, buffer: fs.readFileSync(path.join(root, file)) } } });
  if (!res.ok()) throw new Error(`upload failed: ${res.status()}`);
  return (await res.json()).url;
}
const estimate = (request, body) => request.post(`${app}/api/genjutsu/estimate`, { data: body, failOnStatusCode: false });
const motionBody = (clip, pic, modelId) => ({
  engine: "open",
  mode: "motion",
  ...(modelId ? { modelId } : {}),
  quality: "720p",
  references: [pic],
  source: { url: clip, duration: 6, fps: 24, width: 1024, height: 768, hasAudio: true },
  range: { start: 0, end: 6 },
});

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
    const request = context.request;
    const shot = async (name) => shots && (await page.screenshot({ path: path.join(shots, `${who}-${name}-${width}.png`), fullPage: true }));
    const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const open = async (url) => {
      await page.goto(`${app}${url}`, { waitUntil: "load", timeout: 180_000 });
      await page.getByRole("tablist", { name: "Genjutsu modes" }).waitFor({ timeout: 120_000 });
      await page.waitForTimeout(1500);
    };
    const models = page.getByRole("radiogroup", { name: "Model" }).getByRole("radio");

    if (who === "account") {
      // Public sign-up: the account's cookie lands in this browser context.
      const res = await request.post(`${app}/api/auth/signup`, { data: { email: `motion-h3-${width}-${Date.now()}@example.com`, password: `Mh3-${Date.now()}-check!` }, failOnStatusCode: false });
      check(`${width}: an account signs up`, res.ok(), String(res.status()));
    }

    if (who !== "owner") {
      // A visitor (a guest, or an account with no GPU or key) adds no files: the page and the price check only.
      await open("/genjutsu");
      const text = await page.evaluate(() => document.body.innerText);
      check(`${width}: ${who === "account" ? "an" : "a"} ${who}'s Genjutsu names MiniMax H3 only once it opens`, text.includes("MiniMax H3") === false || opened, opened ? "open" : "");
      check(`${width}: /genjutsu fits the screen`, (await sideways()) <= 0);
      await shot("genjutsu");
      // The price check refuses a model that isn't open before it reads any file.
      const res = await estimate(request, motionBody("/api/files/none.mp4", "/api/files/none.png", H3));
      const said = (await res.text()).slice(0, 200);
      if (opened) check(`${width}: ${who === "account" ? "an" : "a"} ${who}'s price check for MiniMax H3 isn't refused as not here`, !said.includes(NOT_HERE), `${res.status()} ${said}`);
      else check(`${width}: ${who === "account" ? "an" : "a"} ${who}'s price check for MiniMax H3: "${NOT_HERE}"`, res.status() === 422 && said.includes(NOT_HERE), `${res.status()} ${said}`);
      const original = await estimate(request, motionBody("/api/files/none.mp4", "/api/files/none.png"));
      const its = (await original.text()).slice(0, 200);
      check(`${width}: Fuobe Genjutsu's price check isn't refused as not here`, !its.includes(NOT_HERE), `${original.status()} ${its}`);
    } else {
      const clip = await upload(request, "scripts/eval/fixtures/walk-6s.mp4", "video/mp4", "walk.mp4");
      const pic = await upload(request, "scripts/eval/fixtures/character/drawn-face-2.png", "image/png", "character.png");
      await open(`/genjutsu?video=${encodeURIComponent(clip)}&image=${encodeURIComponent(pic)}`);
      await page.waitForFunction(() => document.body.innerText.includes("Fuobe Genjutsu"), null, { timeout: 120_000 }).catch(() => {});
      await models.first().waitFor({ timeout: 60_000 }).catch(() => {});
      const labels = (await models.allInnerTexts()).map((t) => t.split("\n")[0].trim());
      check(`${width}: Model: Fuobe Genjutsu first, then MiniMax H3`, /^Fuobe Genjutsu/.test(labels[0] ?? "") && labels.some((l) => l.startsWith("MiniMax H3")), JSON.stringify(labels));
      const h3 = models.filter({ hasText: "MiniMax H3" });
      const onlyYou = (await h3.innerText()).includes("Only you");
      check(`${width}: MiniMax H3 is marked "Only you" ${opened ? "no more" : "until it opens"}`, onlyYou === !opened);
      check(`${width}: the tab and the modes keep their names`, (await page.getByRole("tab", { selected: true }).innerText()).replace(/Only you$/, "").trim() === "Motion transfer");
      await h3.click();
      await page.waitForTimeout(800);
      check(`${width}: MiniMax H3 picked`, (await h3.getAttribute("aria-checked")) === "true");
      check(`${width}: the part's hint says 2–15 s`, await page.getByText("2–15 s; the whole clip, or just the part you need").isVisible().catch(() => false));
      check(`${width}: MiniMax H3 fits the screen`, (await sideways()) <= 0);
      await shot("motion-h3");
      const res = await estimate(request, motionBody(clip, pic, H3));
      const est = await res.json().catch(() => ({}));
      check(`${width}: the price check runs it on MiniMax H3`, res.ok() && est.modelId === H3 && est.modelName === "MiniMax H3", `${res.status()} ${JSON.stringify(est).slice(0, 160)}`);
      const notes = (est.notes ?? []).join(" | ");
      check(`${width}: its notes give the time and the sound, and name no other model`, /min on your GPU · keeps the clip's sound/.test(notes) && !/Wan Animate/.test(notes), notes);
      check(`${width}: the page names no other model's GPU`, !(await page.evaluate(() => document.body.innerText)).includes("Wan Animate 2 needs"));
      const long = await estimate(request, { ...motionBody(clip, pic, H3), source: { url: clip, duration: 30, fps: 24, width: 1024, height: 768, hasAudio: true }, range: { start: 0, end: 20 } });
      check(`${width}: more than 15 s is refused in words`, long.status() === 422 && (await long.text()).includes("Pick a part between 2 and 15 seconds"), String(long.status()));
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
