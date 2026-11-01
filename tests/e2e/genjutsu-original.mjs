// Fuobe Genjutsu on the Originals, browser check (build plan O5 + Openjutsu): /genjutsu runs Fuobe's Originals by
// default on both engines, with open weights and partners as labelled alternatives, and a Character swap mode
// (MiniMax H3). At 1440 and 390 px, light and dark: the Character swap mode shows who to swap, the quality, the first
// frame switch, the limits and the licence line; Describe my character and the clip's words; the swap LoRA's choices
// per engine; partners' resolutions; the model list badges each model's source; a run is made in demo mode and
// finishes; the open engine allows clicking the person, shows the GPU line, SAM's detection numbers, the History list
// under the window and the mask switch on the Original's graph only; Motion and Restyle list the
// Originals first and Restyle has Soul looks; no Higgsfield anywhere; nothing scrolls sideways.
// Usage: node tests/e2e/genjutsu-original.mjs [appUrl] [--shots <dir>]   (app running in demo mode, ComfyUI unreachable).
// Exits 1 on a failed check.
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

async function upload(file, type, name) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(path.join(root, file))], { type }), name);
  const res = await fetch(`${app}/api/uploads`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return (await res.json()).url;
}

// A 6 s clip (a drawn figure walking, with a hum) and a drawn character: Character swap needs 5 s or more.
const clip = await upload("scripts/eval/fixtures/walk-6s.mp4", "video/mp4", "walk.mp4");
const hero = await upload("scripts/eval/fixtures/character/drawn-face-2.png", "image/png", "hero.png");

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
      const shot = async (name) => shots && (await page.screenshot({ path: path.join(shots, `${name}-${width}-${scheme}.png`), fullPage: true }));
      const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const text = () => page.evaluate(() => document.body.innerText);
      // A list or dialog that is closing stays in the page (data-state="closed") until it has animated out, and holds
      // the page's clicks meanwhile: let it go before the next click.
      const settle = () =>
        page.waitForFunction(() => !document.querySelector('[role="listbox"][data-state="closed"], [role="dialog"][data-state="closed"]'), null, { timeout: 5000 }).catch(() => {});

      await page.goto(`${app}/genjutsu?mode=character&video=${encodeURIComponent(clip)}&image=${encodeURIComponent(hero)}`, { waitUntil: "load", timeout: 180_000 });
      const tab = page.getByRole("tab", { name: "Character swap" });
      await tab.waitFor({ timeout: 120_000 });
      // ?mode= is read once the page has the URL's query.
      await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === "Character swap", null, { timeout: 30_000 }).catch(() => {});
      check(`${tag}: Character swap is the open tab`, (await tab.getAttribute("aria-selected")) === "true");
      const who = page.getByRole("radiogroup", { name: "Who to swap" });
      await who.waitFor({ timeout: 60_000 });
      check(`${tag}: who to swap: Largest, Leftmost, Rightmost, Person #`, (await who.getByRole("radio").allInnerTexts()).join("|") === "Largest|Leftmost|Rightmost|Person #");
      check(`${tag}: quality 480p / 768p, 768p by default`, (await page.getByRole("radiogroup", { name: "Quality" }).getByRole("radio", { name: "768p" }).getAttribute("aria-checked")) === "true");
      check(`${tag}: the first frame is made first by default`, (await page.getByRole("switch", { name: "Make the first frame first" }).getAttribute("aria-checked")) === "true");
      // Clicking runs on the GPU only: the cloud says so.
      check(`${tag}: cloud: "Click them" is off, said in words`, (await page.getByRole("radio", { name: "Click them" }).isDisabled()) && /Clicking runs on your GPU/.test(await text()));
      const models = page.getByRole("radiogroup", { name: "Model", exact: true });
      await models.waitFor({ timeout: 30_000 });
      const first = (await models.getByRole("radio").first().innerText()).replace(/\s+/g, " ");
      check(`${tag}: the Original is first, badged`, /^Fuobe Character swap Fuobe Original/.test(first), JSON.stringify(first.slice(0, 60)));
      const listed = (await models.innerText()).replace(/\s+/g, " ");
      check(`${tag}: open weights and partners are labelled alternatives`, /Open weights/.test(listed) && /Partner/.test(listed));
      check(`${tag}: the licence line is in the picker`, /MiniMax H3 Community License — not licensed in the US, the EU, the UK and South Korea/.test(listed));
      check(`${tag}: each model's own licence (MIT for SCAIL-2, closed for partners)`, /SCAIL-2 weights: MIT/.test(listed) && /Closed model: pay per use/.test(listed));
      // The price (demo: no keys), the limits.
      await page.getByText(/Placeholder · free|≈ \$|Price unknown/).first().waitFor({ timeout: 60_000 });
      const body = await text();
      check(`${tag}: the limits are shown`, /One continuous shot: a hard cut breaks the swap/.test(body) && /The person must be visible in the part's first frame/.test(body));
      check(`${tag}: no Higgsfield anywhere`, !/higgsfield/i.test(body));
      check(`${tag}: no sideways scroll (Character swap)`, (await sideways()) <= 1, `${await sideways()} px`);
      // Describe my character (no text model in demo mode: said in words); the clip's words fill "What's said".
      const describe = page.getByRole("button", { name: "Describe my character" });
      check(`${tag}: "Describe my character" is offered with the picture in`, (await describe.count()) === 1 && !(await describe.isDisabled()));
      await describe.click();
      check(
        `${tag}: describing without a text model says so`,
        await page
          .getByText(/Describing needs a text model/)
          .first()
          .waitFor({ timeout: 20_000 })
          .then(() => true)
          .catch(() => false),
      );
      await page.getByText("Advanced").first().click();
      const loras = (await page.getByRole("radiogroup", { name: "Swap style" }).getByRole("radio").allInnerTexts()).join("|");
      check(`${tag}: cloud: the swap LoRA is V1.5 or V1 (fal's route needs one)`, loras === "V1.5|V1", loras);
      await page.getByRole("button", { name: "Use the clip's words" }).click();
      const said = page.locator("#gj-dialogue");
      const filled = await page
        .waitForFunction(() => /demo transcript/.test(document.querySelector("#gj-dialogue")?.value ?? ""), null, { timeout: 60_000 })
        .then(() => true)
        .catch(() => false);
      check(`${tag}: "Use the clip's words" fills What's said with the part's lines`, filled, JSON.stringify((await said.inputValue()).slice(0, 60)));
      // A partner in Character swap takes Genjutsu's resolutions (Recast renders 768p or 1080p).
      await models.getByRole("radio", { name: /H3 Max Recast/ }).click();
      await page.waitForTimeout(300);
      const res = (await page.getByRole("radiogroup", { name: "Resolution" }).getByRole("radio").allInnerTexts()).join("|");
      check(`${tag}: partners: the resolutions to pick from (1080p for Recast)`, res === "480p|720p|1080p", res);
      await models.getByRole("radio").first().click();
      await page.waitForTimeout(300);
      await shot("genjutsu-character-cloud");

      // A demo run: the steps run through and the result comes back.
      if (scheme === "light") {
        await page.getByRole("button", { name: "Generate" }).click();
        const done = await page
          .getByRole("link", { name: "Download" })
          .waitFor({ timeout: 120_000 })
          .then(() => true)
          .catch(() => false);
        check(`${tag}: a demo Character swap finishes with a before / after`, done);
        await shot("genjutsu-character-result");
      }

      // The open engine: clicks allowed, the GPU line.
      await page.getByRole("radiogroup", { name: "Engine" }).getByRole("radio", { name: "Open source" }).click();
      await page.waitForTimeout(600);
      check(`${tag}: open: "Click them" is on`, !(await page.getByRole("radio", { name: "Click them" }).isDisabled()));
      const openBody = await text();
      check(`${tag}: open: the GPU it was tested on`, /Tested by its authors on a 96 GB RTX PRO 6000/.test(openBody));
      check(`${tag}: open: the H3 Relay is an open alternative`, /H3 Relay/.test(openBody));
      // Advanced is still open from the cloud: on your GPU "None" is a choice, and the mask switch is the Original's.
      if (!(await page.getByRole("radiogroup", { name: "Swap style" }).isVisible().catch(() => false))) await page.getByText("Advanced").first().click();
      check(`${tag}: open: Advanced has the LoRA release and the window`, (await page.getByRole("radiogroup", { name: "Swap style" }).count()) === 1 && (await page.getByText("Window", { exact: true }).count()) >= 1);
      check(`${tag}: open: no swap LoRA is a choice on your GPU`, (await page.getByRole("radiogroup", { name: "Swap style" }).getByRole("radio", { name: "None" }).count()) === 1);
      check(`${tag}: open: Masked generation on the Original's graph`, (await page.getByRole("switch", { name: "Masked generation" }).count()) === 1);
      await page.getByRole("radiogroup", { name: "Who to swap" }).getByRole("radio", { name: "Person #" }).click();
      check(`${tag}: open: person numbers are SAM's detections, said so`, (await page.getByText("Detection number", { exact: true }).count()) === 1 && /not left to right/.test(await text()));
      // The History list stops below the window (the pack refuses a history as long as it).
      await page.locator("#gj-window").click();
      await page.getByRole("option", { name: "22 frames" }).click();
      await settle();
      await page.locator("#gj-history").click();
      const histories = (await page.getByRole("option").allInnerTexts()).join("|");
      await page.keyboard.press("Escape");
      await settle();
      check(`${tag}: open: History under a 22-frame window is 0, 1 or 18`, histories === "0 frames|1 frames|18 frames", histories);
      await page.locator("#gj-window").click();
      await page.getByRole("option", { name: "124 frames" }).click();
      await settle();
      // H3 Relay has no switch for the whole frame.
      await page.getByRole("radiogroup", { name: "Model", exact: true }).getByRole("radio", { name: /H3 Relay/ }).click();
      await page.waitForTimeout(300);
      check(`${tag}: open: the Relay graph has no mask switch`, (await page.getByRole("switch", { name: "Masked generation" }).count()) === 0);
      await page.getByRole("radiogroup", { name: "Model", exact: true }).getByRole("radio").first().click();
      await page.getByRole("radiogroup", { name: "Who to swap" }).getByRole("radio", { name: "Largest" }).click();
      check(`${tag}: no sideways scroll (open)`, (await sideways()) <= 1, `${await sideways()} px`);
      await shot("genjutsu-character-open");

      // Motion transfer: the Original first; Restyle: Soul looks, no Higgsfield.
      await page.getByRole("radiogroup", { name: "Engine" }).getByRole("radio", { name: "Cloud" }).click();
      await page.getByRole("tab", { name: "Motion transfer" }).click();
      await page.waitForTimeout(500);
      const motion = (await page.getByRole("radiogroup", { name: "Model", exact: true }).getByRole("radio").first().innerText()).replace(/\s+/g, " ");
      check(`${tag}: motion: Fuobe Genjutsu first, an Original (Lite by default)`, /^Fuobe Genjutsu Fuobe Original .*480p/.test(motion), JSON.stringify(motion.slice(0, 60)));
      await page.getByRole("tab", { name: "Restyle" }).click();
      await page.waitForTimeout(500);
      check(`${tag}: restyle: Soul looks are a tab`, (await page.getByRole("tab", { name: "Soul looks" }).count()) === 1);
      await page.getByRole("tab", { name: "Soul looks" }).click();
      check(`${tag}: restyle: no Higgsfield anywhere`, !/higgsfield/i.test(await text()));
      check(`${tag}: no sideways scroll (Restyle)`, (await sideways()) <= 1, `${await sideways()} px`);
      await shot("genjutsu-restyle-soul");
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
