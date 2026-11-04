// Genjutsu's mode examples, browser check at 390 and 1440 px, light and dark. Each mode tab: the selected mode's example
// card shows when the mode has one for this viewer (one card at most, none for a mode without one); its loop downloads
// only once the card is half in view and plays muted; nothing moves when it arrives; the pause button, the actions and
// the settings toggle are 44 px; switching modes drops the loop. Reduced motion: the finished result as a still, no
// download until Play. Visitors (--viewer guest | account: a studio with a password and public sign-up) see the video,
// the settings and Copy its setup, and no Use this example, no model names, no "Only you". The owner: Use this example
// with no clip marks the card "In use" (the form's setup equals the recipe), Undo puts the form back, and with a clip
// and the example's kind of photos the estimate's request body equals the run that made the example
// (tests/fixtures/genjutsu-examples/<id>.json; the clip, photos and who-is-who are the test's own).
// Usage: node tests/e2e/genjutsu-examples.mjs [appUrl] [--viewer owner|guest|account] [--shots <dir>]   Exits 1 on a failed check.
import fs from "node:fs";
import path from "node:path";
import { launch, root, ENGINE } from "./_browser.mjs";

const argv = process.argv.slice(2);
const flag = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
const app = (argv.find((a, i) => !a.startsWith("--") && !["--viewer", "--shots"].includes(argv[i - 1])) ?? "http://localhost:4001").replace(/\/$/, "");
const viewer = flag("--viewer") ?? "owner";
const shots = flag("--shots");
if (shots) fs.mkdirSync(shots, { recursive: true });
const visitor = viewer !== "owner";

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(84)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};

const MODES = { motion: "Motion transfer", character: "Character swap", swap: "Object swap", restyle: "Restyle", insert: "Insert", picture: "From picture", finish: "Finish" };
// The examples in src/lib/examples/plan.json (load "genjutsu") and the features each needs open (requestFeatures).
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const NEEDS = { "genjutsu-character.1": ["group-swap"], "genjutsu-finish.1": ["finish-colours"] };
const FEATURE_WORKFLOWS = { "group-swap": ["video-group-swap-h3"], "finish-colours": ["video-fix-colours"] };
const validated = new Set(readJson("workflows/comfyui/manifest.json").workflows.filter((w) => w.validated === true).map((w) => w.id));
const passed = readJson("workflows/comfyui/gpu-tested.json").features ?? {};
const live = (k) => passed[k]?.passed === true && FEATURE_WORKFLOWS[k].every((id) => validated.has(id));
const rows = readJson("src/lib/examples/plan.json").filter((r) => r.load === "genjutsu");
/** mode → the example this viewer should see (the best ranked whose features are open). */
const expected = {};
for (const r of [...rows].sort((a, b) => a.rank - b.rank)) {
  const mode = r.surface.replace("tool:genjutsu/", "");
  if (expected[mode]) continue;
  if (!visitor || (NEEDS[r.id] ?? []).every(live)) expected[mode] = r;
}

async function upload(file, type, name) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(path.join(root, file))], { type }), name);
  const res = await fetch(`${app}/api/uploads`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return (await res.json()).url;
}
const code = (o) => `gj2.${Buffer.from(JSON.stringify(o)).toString("base64url")}`;

const browser = await launch();
try {
  for (const scheme of ["light", "dark"]) {
    for (const [width, height] of [
      [390, 844],
      [1440, 900],
    ]) {
      const tag = `${viewer} ${width} ${scheme}`;
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
      await context.addInitScript(() => {
        try {
          localStorage.setItem("fuobe.engine", "open");
        } catch {}
      });
      if (viewer === "account") {
        const email = `gj-example-${Date.now()}-${width}-${scheme}@example.com`;
        const res = await context.request.post(`${app}/api/auth/signup`, { data: { email, password: "example-pass-1" } });
        check(`${tag}: an account signs up`, res.ok(), String(res.status()));
      }
      const page = await context.newPage();
      const mp4s = [];
      const runs = [];
      page.on("request", (r) => {
        if (/\/examples\/genjutsu-[a-z]+\/\d+\/show\.mp4/.test(r.url())) mp4s.push(r.url());
        if (r.method() === "POST" && r.url().endsWith("/api/genjutsu")) runs.push(r.url());
      });
      const shot = async (name) => shots && (await page.screenshot({ path: path.join(shots, `${viewer}-${name}-${width}-${scheme}.png`) }));
      const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const open = async (url) => {
        await page.goto(`${app}${url}`, { waitUntil: "load", timeout: 180_000 });
        await page.getByRole("tablist", { name: "Genjutsu modes" }).waitFor({ timeout: 120_000 });
        await page.waitForTimeout(1200);
      };
      const cards = () => page.locator("[data-mode-example]");
      const card = () => cards().first();
      const box = (sel) => page.evaluate((s) => {
        const r = document.querySelector(s)?.getBoundingClientRect();
        return r ? [Math.round(r.x), Math.round(r.y + window.scrollY), Math.round(r.width), Math.round(r.height)].join(",") : null;
      }, sel);
      const playing = () =>
        page.evaluate(async () => {
          const v = document.querySelector("[data-example-video]");
          if (!v) return false;
          const t = v.currentTime;
          await new Promise((r) => setTimeout(r, 700));
          return !v.paused && v.muted && v.loop && v.currentTime !== t;
        });

      // Every open mode: a card where this viewer has an example, none elsewhere, one at most.
      await open("/genjutsu?mode=motion");
      check(`${tag}: no loop downloaded on a mode without an example`, expected.motion ? true : mp4s.length === 0, String(mp4s.length));
      const tabNames = (await page.getByRole("tablist", { name: "Genjutsu modes" }).getByRole("tab").allInnerTexts()).map((t) => t.replace(/\s*Only you$/, "").trim());
      for (const [id, label] of Object.entries(MODES)) {
        if (!tabNames.includes(label)) continue;
        await page.getByRole("tablist", { name: "Genjutsu modes" }).getByRole("tab", { name: new RegExp(`^${label}`) }).click();
        await page.waitForTimeout(500);
        const want = expected[id];
        const n = await cards().count();
        check(`${tag}: ${label} shows ${want ? `its example (${want.id})` : "no example card"}`, want ? n === 1 && (await card().getAttribute("data-mode-example")) === want.id : n === 0, `cards ${n}`);
      }

      for (const [id, row] of Object.entries(expected)) {
        const label = MODES[id];
        mp4s.length = 0;
        // The card off screen first (scrolled to the bottom): no download until it is half in view.
        await open(`/genjutsu?mode=${id}`);
        const shifts = await page.evaluate(() => {
          window.__shift = 0;
          new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && (window.__shift += e.value))).observe({ type: "layout-shift", buffered: true });
          return true;
        });
        const c = card();
        await c.waitFor({ timeout: 30_000 });
        const before = await box("[data-mode-example]");
        const drop = await box("#gj-clip-drop");
        await c.scrollIntoViewIfNeeded();
        await page.waitForFunction(() => !!document.querySelector("[data-example-video]"), null, { timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(1500);
        check(`${tag} ${label}: the loop plays muted once in view`, await playing());
        check(`${tag} ${label}: one download of its loop`, mp4s.length >= 1 && mp4s.every((u) => u.includes(row.output)), JSON.stringify(mp4s.map((u) => u.replace(app, ""))));
        check(`${tag} ${label}: nothing moves when the loop arrives`, before === (await box("[data-mode-example]")) && drop === (await box("#gj-clip-drop")), `${before} / ${await box("[data-mode-example]")}`);
        if (ENGINE === "chromium" && shifts) {
          const cls = await page.evaluate(() => window.__shift);
          check(`${tag} ${label}: no layout shift (CLS ${cls.toFixed(3)})`, cls < 0.02);
        }
        const loopBox = await c.locator("[data-example-video]").boundingBox();
        check(`${tag} ${label}: the loop is 4:3 and at least 358 px wide`, !!loopBox && loopBox.width >= 340 && Math.abs(loopBox.width / loopBox.height - 4 / 3) < 0.02, loopBox ? `${Math.round(loopBox.width)}×${Math.round(loopBox.height)}` : "none");
        if (width >= 1440) {
          const side = await c.locator("figcaption").boundingBox();
          // 960 px with its 1 px border: the loop takes what the 352 px column leaves.
          check(`${tag} ${label}: 960 px card, a 352 px column beside the loop`, Math.round((await c.boundingBox()).width) === 960 && Math.round(side.width) === 352 && Math.round(loopBox.width) === 606, `${Math.round((await c.boundingBox()).width)} / ${Math.round(side.width)} / ${Math.round(loopBox.width)}`);
        }
        const sizes = await c.evaluate((el) => [...el.querySelectorAll("button, summary")].filter((b) => b.getClientRects().length).map((b) => `${b.getAttribute("aria-label") ?? b.textContent?.trim()}:${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`));
        check(`${tag} ${label}: every target is 44 px or more`, sizes.every((s) => s.split(":").pop().split("x").every((d) => Number(d) >= 44) || /summary/.test(s)), JSON.stringify(sizes));
        const summary = c.locator("summary");
        if (await summary.isVisible()) check(`${tag} ${label}: "Settings it used" is a 44 px toggle`, ((await summary.boundingBox())?.height ?? 0) >= 44);
        // Pause and play.
        await c.getByRole("button", { name: "Pause the example" }).click();
        check(`${tag} ${label}: Pause stops the loop`, !(await playing()));
        await c.getByRole("button", { name: "Play the example" }).click();
        check(`${tag} ${label}: Play starts it again`, await playing());
        const text = await c.innerText();
        check(`${tag} ${label}: "EXAMPLE", the title and "What went in"`, /example/i.test(text) && text.includes(row.caption) && text.includes("What went in") && row.caption.length <= 40);
        check(`${tag} ${label}: no test words or file paths`, !/\b(test|pass(ed)?|owner|validated|oss-|\/api\/)/i.test(text), text.replace(/\s+/g, " ").slice(0, 160));
        if (visitor) {
          check(`${tag} ${label}: a visitor has no Use this example`, (await c.locator("[data-use-example]").count()) === 0);
          check(`${tag} ${label}: a visitor can copy its setup`, await c.getByRole("button", { name: /Copy its setup/ }).isVisible());
          check(`${tag} ${label}: no model names and no "Only you" for a visitor`, !/Group swap|Colour finish|Only you|MiniMax|H3/.test(text));
        } else {
          check(`${tag} ${label}: the owner has Use this example`, await c.locator("[data-use-example]").isVisible());
        }
        check(`${tag} ${label}: fits the screen`, (await sideways()) <= 0);
        await shot(`${id}`);
        // Leaving the mode drops the loop.
        await page.getByRole("tablist", { name: "Genjutsu modes" }).getByRole("tab", { name: /^Motion transfer/ }).click();
        await page.waitForTimeout(400);
        check(`${tag} ${label}: leaving the mode removes its loop`, (await page.locator("[data-example-video]").count()) === 0 && (await cards().count()) === (expected.motion ? 1 : 0));

        // The owner: Use this example with no clip puts the exact recipe in the form ("In use"), and Undo takes it out.
        if (!visitor && scheme === "light") {
          await open(`/genjutsu?mode=${id}`);
          await card().locator("[data-use-example]").click();
          await page.waitForTimeout(600);
          const used = card().locator("[data-use-example]");
          check(`${tag} ${label}: Use this example fills the form exactly ("In use")`, (await used.innerText()).includes("In use"), await used.innerText());
          check(`${tag} ${label}: it runs nothing (no run request)`, runs.length === 0);
          const undo = page.getByRole("button", { name: "Undo" });
          if (await undo.isVisible().catch(() => false)) {
            await undo.click();
            await page.waitForTimeout(500);
            check(`${tag} ${label}: Undo puts the form back`, (await card().locator("[data-use-example]").innerText()).includes("Use this example"));
          } else check(`${tag} ${label}: the toast offers Undo`, false);
        }
      }
      await context.close();

      // Reduced motion: the result as a still, the loop only on Play.
      if (scheme === "light") {
        const first = Object.entries(expected)[0];
        if (first) {
          const [id, row] = first;
          const rc = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
          if (viewer === "account") await rc.request.post(`${app}/api/auth/signup`, { data: { email: `gj-example-rm-${Date.now()}-${width}@example.com`, password: "example-pass-1" } });
          const p = await rc.newPage();
          const got = [];
          p.on("request", (r) => r.url().includes("/show.mp4") && got.push(r.url()));
          await p.goto(`${app}/genjutsu?mode=${id}`, { waitUntil: "load", timeout: 180_000 });
          const c = p.locator("[data-mode-example]").first();
          await c.waitFor({ timeout: 60_000 });
          await c.scrollIntoViewIfNeeded();
          await p.waitForTimeout(2000);
          const still = await c.locator("img").first().getAttribute("src");
          check(`${tag} reduced motion: the finished result as a still`, !!still && still.includes(row.rest.src) && (await c.locator("[data-example-video]").count()) === 0, String(still));
          check(`${tag} reduced motion: no download before Play`, got.length === 0, String(got.length));
          await c.getByRole("button", { name: "Play the example" }).click();
          await p.waitForTimeout(1500);
          check(`${tag} reduced motion: Play loads and plays it`, got.length >= 1 && (await p.evaluate(() => !document.querySelector("[data-example-video]")?.paused)));
          await rc.close();
        }
      }
    }
  }

  // The owner with a clip: the estimate's body equals the run that made each example.
  if (!visitor) {
    const clip = await upload("scripts/eval/fixtures/walk-6s.mp4", "video/mp4", "walk.mp4");
    const pics = [await upload("scripts/eval/fixtures/character/drawn-face-2.png", "image/png", "p1.png"), await upload("scripts/eval/fixtures/character/drawn-face-2.png", "image/png", "p2.png")];
    for (const width of [390, 1440]) {
      for (const row of Object.values(expected)) {
        const fixture = readJson(`tests/fixtures/genjutsu-examples/${row.id}.json`).body;
        const mode = row.genjutsu.recipe.mode;
        const context = await browser.newContext({ viewport: { width, height: 900 }, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
        await context.addInitScript(() => {
          try {
            localStorage.setItem("fuobe.engine", "open");
          } catch {}
        });
        const page = await context.newPage();
        const bodies = [];
        const runs = [];
        page.on("request", (r) => {
          if (r.method() !== "POST") return;
          if (r.url().endsWith("/api/genjutsu/estimate")) bodies.push(JSON.parse(r.postData() ?? "{}"));
          else if (r.url().endsWith("/api/genjutsu")) runs.push(r.url());
        });
        const refs = fixture.references.length ? { r: pics.slice(0, fixture.references.length) } : {};
        await page.goto(`${app}/genjutsu?video=${encodeURIComponent(clip)}&setup=${code({ m: mode, e: "open", ...refs })}`, { waitUntil: "load", timeout: 180_000 });
        const rowEl = page.locator("[data-mode-example-row]");
        await rowEl.waitFor({ timeout: 120_000 }).catch(() => {});
        check(`owner ${width} ${row.id}: with a clip, one "Example:" row in the side panel`, (await rowEl.count()) === 1 && (await page.locator("[data-mode-example]").count()) === 0);
        await rowEl.getByRole("button", { name: "See it" }).click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor({ timeout: 10_000 });
        await dialog.locator("[data-use-example]").click();
        await page.waitForTimeout(800);
        // Who is who in the example's own clip is the viewer's to give: the test gives the example's.
        const people = row.genjutsu.own?.character?.people ?? [];
        for (let i = 0; i < people.length; i++) {
          const field = page.getByRole("textbox", { name: `Character ${i + 1} replaces` });
          check(`owner ${width} ${row.id}: who becomes who is asked again (empty)`, (await field.inputValue()) === "");
          await field.fill(people[i].role);
        }
        await page.waitForTimeout(1500);
        const last = bodies.at(-1);
        const strip = (b) => {
          // The clip, its first frame's size and the photos are the viewer's own (the test's here).
          const rest = Object.fromEntries(Object.entries(b ?? {}).filter(([k]) => !["source", "references", "requestId", "frame"].includes(k)));
          // Finish keeps the clip's size: its quality plays no part in the run (tests/genjutsu-examples.test.ts).
          if (rest.mode === "finish") delete rest.quality;
          return JSON.stringify(Object.keys(rest).sort().reduce((o, k) => ((o[k] = rest[k]), o), {}));
        };
        check(`owner ${width} ${row.id}: the form's request equals the run that made it`, !!last && strip(last) === strip(fixture), `\n   form: ${strip(last)}\n   run:  ${strip(fixture)}`);
        check(`owner ${width} ${row.id}: the photos are the viewer's own`, !!last && JSON.stringify(last.references) === JSON.stringify(refs.r ?? []));
        check(`owner ${width} ${row.id}: Use this example ran nothing`, runs.length === 0);
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nall passed");
