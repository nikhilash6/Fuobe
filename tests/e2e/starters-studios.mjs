// The ready-made starters of Assist, the Library, Cinema Studio, Storyboard and Elements, and Moodboards' Curated
// first screen, as a guest, a fresh account and the owner, at 390 and 1440 px: an empty studio leads with its
// starters (the owner's marked until their covers exist), visitors see only starters with a real cover and no model or
// engine words, every starter has a read-only page, the Library's row opens each studio with its content loaded, and
// the owner's "Use template" types the job into Assist, makes the Cinema film (shot 1 in the prompt bar, ready to
// generate), fills Storyboard's composer and saves the element. After that the owner's own work leads and the
// starters sit in one row below.
//
// node tests/e2e/starters-studios.mjs <app address> <owner password> [screenshot folder]
// Against `next start` with a fresh data dir, FUOBE_PUBLIC_SIGNUP=1 and demo mode on (FUOBE_DEMO_MODE=on).
import fs from "node:fs";
import path from "node:path";
import { launch, PHONE, DESKTOP } from "./_browser.mjs";

const [app, password, shots] = process.argv.slice(2);
if (!app || !password) throw new Error("usage: node tests/e2e/starters-studios.mjs <app address> <owner password> [screenshot folder]");
if (shots) fs.mkdirSync(shots, { recursive: true });

// Curated looks with their real covers (published "soul/<id>" covers): only then does Moodboards open on Curated.
const SOUL_COVERS = /"soul\/[^"]+":/.test(fs.readFileSync(path.join(import.meta.dirname, "../../src/lib/template-covers.generated.ts"), "utf8"));

const ENGINE_WORDS = /Fuobe DoP|Effects 2\.0|\bGPU\b|Qwen|MiniMax|Nano Banana|Seedance|Ideogram|Kling|ElevenLabs|ACE-Step|placeholder|No cover yet/;
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(name);
};

/**
 * Each studio, the heading of its starters, how many the owner sees, how many a visitor sees today (those with a real
 * cover), a starter whose page is checked, and words of that starter a visitor never receives while it has no cover.
 */
const SURFACES = [
  // Assist's starters sit in one row of three under the composer (See all opens the rest).
  { path: "/assist", heading: "Start from a ready job", n: 5, shown: 0, page: "assist.jewel-campaign", words: "candlelit palace hall", row: 3 },
  { path: "/library", heading: "Make your first", n: 4, shown: 3, link: true },
  { path: "/cinema", heading: "Start from a ready film", n: 3, shown: 0, page: "cinema.riviera-night", words: "Monte Carlo casino" },
  { path: "/storyboard", heading: "Start from a ready story", n: 3, shown: 0, page: "storyboard.perfume-ad", words: "Nuit Noire perfume ad" },
  { path: "/elements", heading: "Start with a ready element", n: 5, shown: 4, page: "elements.amara" },
];

async function signIn(ctx, persona) {
  if (persona === "owner") {
    const r = await ctx.request.post(`${app}/api/auth/login`, { data: { password } });
    if (!r.ok()) throw new Error(`owner login ${r.status()}`);
  } else if (persona === "account") {
    const email = `starters-st-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
    const r = await ctx.request.post(`${app}/api/auth/signup`, { data: { email, password: "starters-st-pw-123" } });
    if (!r.ok()) throw new Error(`signup ${r.status()}`);
  }
}

const browser = await launch();
/** The film the owner's phone made from a starter (its path), opened again at 1440. */
let phoneFilm = null;
try {
  for (const persona of ["guest", "account", "owner"]) {
    for (const [size, device] of [
      ["390", PHONE],
      ["1440", DESKTOP],
    ]) {
      const tag = `${persona} ${size}`;
      const ctx = await browser.newContext({ ...device, colorScheme: "light" });
      await signIn(ctx, persona);
      const page = await ctx.newPage();
      page.setDefaultTimeout(30_000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(`${page.url()} :: ${String(e).slice(0, 200)}`));
      const shot = async (name) => shots && page.screenshot({ path: path.join(shots, `${name}--${persona}--${size}.png`), fullPage: false });
      const fullShot = async (name) => shots && page.screenshot({ path: path.join(shots, `${name}--${persona}--${size}--full.png`), fullPage: true });
      const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const text = () => page.locator("main, body").first().innerText();
      const owner = persona === "owner";

      // ---- Each studio's first screen, with nothing of one's own yet
      for (const s of SURFACES) {
        const name = s.path.slice(1);
        const want = Math.min(owner ? s.n : s.shown, s.row ?? Infinity);
        const first = await page.goto(`${app}${s.path}`, { waitUntil: "load", timeout: 180_000 });
        // The page itself (its HTML and its data) carries no words of a starter a visitor can't see.
        if (!owner && s.words && !s.shown) check(`${tag}: ${s.path} sends a visitor no words of a starter without its cover`, !((await first?.text()) ?? "").includes(s.words));
        if (want) await page.getByRole("heading", { name: s.heading }).waitFor({ timeout: 60_000 }).catch(() => {});
        else await page.waitForTimeout(2500);
        const section = page.locator("#starters");
        const cards = section.locator("article");
        const n = await cards.count();
        const t = await text();
        check(`${tag}: ${s.path} shows ${want} starters`, n === want, `${n}`);
        if (owner && !s.link) {
          check(`${tag}: ${s.path} starters each have Use template`, (await section.getByRole("button", { name: "Use template" }).count()) === want);
          check(`${tag}: ${s.path} marks the starters without a cover`, (await section.getByText("No cover yet").count()) === want - Math.min(s.shown, want));
          if (s.row) {
            await section.getByRole("button", { name: "See all" }).click();
            check(`${tag}: ${s.path} See all shows all ${s.n}`, (await cards.count()) === s.n, `${await cards.count()}`);
          }
        } else if (want && !owner) {
          check(`${tag}: ${s.path} cards each show their cover`, await cards.evaluateAll((els) => els.every((e) => e.querySelector("img, video"))));
        }
        if (owner && s.link) check(`${tag}: ${s.path} marks the link starter without a cover`, (await section.getByText("No cover yet").count()) === s.n - s.shown);
        if (!owner && want) {
          if (!s.link) check(`${tag}: ${s.path} visitor cards say See how it works`, (await section.getByText("See how it works").count()) === want && !/Use template|No cover yet/.test(await section.innerText()));
          else check(`${tag}: ${s.path} cards say Open it`, (await section.getByText("Open it").count()) === want);
          const top = await cards.first().evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
          check(`${tag}: ${s.path} starters sit near the top`, top < (size === "390" ? 1100 : 800), `${Math.round(top)} px`);
        } else if (!owner) {
          check(`${tag}: ${s.path} shows a visitor no starter without its cover`, !t.includes(s.heading) && !/No cover yet|Use template/.test(t));
        }
        if (!owner) check(`${tag}: no model or engine words in ${s.path}'s starters`, !ENGINE_WORDS.test(n ? await section.innerText() : ""));
        if (size === "1440" && n === 4) {
          const tops = await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
          check(`${tag}: ${s.path}'s four cards sit in one row`, new Set(tops).size === 1, tops.join(","));
        }
        check(`${tag}: no sideways scroll on ${s.path}`, (await sideways()) <= 1, `${await sideways()} px`);
        await shot(`${name}-first`);
        if (size === "1440" || want) await fullShot(`${name}-first`);

        // The starter's read-only page.
        if (s.page) {
          const res = await page.goto(`${app}${s.path}/start/${s.page}`, { waitUntil: "load" });
          if (owner || s.shown) {
            await page.getByRole("heading", { name: "What goes in" }).waitFor({ timeout: 60_000 });
            const pt = await text();
            check(`${tag}: ${s.page}'s page says what goes in, the steps and what comes out`, /The steps/i.test(pt) && /What comes out/i.test(pt));
            if (owner) {
              await page.getByText("Use template").first().waitFor({ timeout: 30_000 }).catch(() => {});
              check(`${tag}: the owner can use ${s.page} from its page`, (await page.getByRole("button", { name: "Use template" }).count()) + (await page.getByRole("link", { name: "Use template" }).count()) === 1);
            } else {
              check(`${tag}: ${s.page}'s page has no model words and no Use template`, !ENGINE_WORDS.test(pt) && !/Use template/.test(pt), (pt.match(ENGINE_WORDS) ?? [""])[0]);
              check(`${tag}: ${s.page}'s page shows its pictures`, (await page.locator("main img").count()) >= 2);
            }
            check(`${tag}: no sideways scroll on ${s.page}'s page`, (await sideways()) <= 1, `${await sideways()} px`);
          } else {
            // A starter with no cover yet has no page for a visitor: a real 404, and none of its words in the answer.
            const body = (await res?.text()) ?? "";
            check(`${tag}: ${s.page} (no cover yet) is a 404 for a visitor`, res?.status() === 404 && !/The steps/i.test(await text()), String(res?.status()));
            check(`${tag}: ${s.page}'s words don't reach a visitor`, !body.includes(s.words), s.words);
          }
          await shot(`${name}-start`);
        }
      }

      // The Library's row opens each studio with its content loaded, for everyone.
      if (size === "1440" || !owner) {
        await page.goto(`${app}/library`, { waitUntil: "load" });
        await page.getByRole("heading", { name: "Make your first" }).waitFor({ timeout: 60_000 });
        await page.locator("#starters article").filter({ hasText: "A portrait that comes alive" }).getByRole("link").first().click();
        if (owner) {
          await page.waitForURL(/\/canvas\/start\/effect-chain-pearl-earring$/, { timeout: 60_000 });
          await page.getByRole("heading", { name: "What goes in" }).waitFor({ timeout: 60_000 }).catch(() => {});
          check(`${tag}: the Library's portrait opens its ready board for the owner`, /What goes in/i.test(await text()));
        } else {
          await page.waitForURL((u) => u.pathname === "/video" && u.searchParams.get("example") === "effect-pearl-earring.1", { timeout: 60_000 });
          await page.getByText("In the composer").first().waitFor({ timeout: 60_000 }).catch(() => {});
          check(`${tag}: the Library's portrait opens the Video studio with its photo in`, /In the composer/.test(await text()));
          await shot("library-to-video");
        }
        await page.goto(`${app}/library`, { waitUntil: "load" });
        await page.getByRole("heading", { name: "Make your first" }).waitFor({ timeout: 60_000 });
        await page.locator("#starters article").filter({ hasText: "A gown on a Namib dune" }).getByRole("link").first().click();
        await page.waitForURL((u) => u.pathname === "/image", { timeout: 60_000 });
        await page.getByText("In the composer").first().waitFor({ timeout: 60_000 }).catch(() => {});
        check(`${tag}: the Library's gown opens the Image studio with its prompt in`, /In the composer/.test(await text()));
        await shot("library-to-image");
      }

      // A starter page whose id isn't that studio's answers a real 404.
      if (size === "1440") {
        for (const bad of ["/cinema/start/elements.amara", "/elements/start/nope.x", "/assist/start/storyboard.heist"]) {
          const r = await page.goto(`${app}${bad}`, { waitUntil: "load" });
          check(`${tag}: ${bad} is a real 404`, r?.status() === 404, String(r?.status()));
        }
        await page.goto(`${app}/cinema/start/cinema.riviera-night`, { waitUntil: "load" });
        if (!owner) check(`${tag}: a starter with no cover yet has a neutral title`, !/Riviera/.test(await page.title()), await page.title());
      }

      // Moodboards opens on Curated while there are none of one's own, once the curated looks have their real covers.
      await page.goto(`${app}/moodboards`, { waitUntil: "load" });
      await page.getByRole("tab", { name: "Curated" }).waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1500);
      const curatedOn = (await page.getByRole("tab", { name: "Curated" }).getAttribute("aria-selected")) === "true";
      check(`${tag}: Moodboards opens on Curated only while curated looks have their covers`, curatedOn === SOUL_COVERS, `curated ${curatedOn}, covers ${SOUL_COVERS}`);
      if (curatedOn) check(`${tag}: Moodboards says how to start from a curated look`, /Start from a curated look/.test(await text()));
      check(`${tag}: no sideways scroll on /moodboards`, (await sideways()) <= 1, `${await sideways()} px`);
      await shot("moodboards-first");

      // ?starter= of a story or a job with no cover yet fills nothing for a visitor (its words never reach them).
      if (!owner && size === "1440") {
        await page.goto(`${app}/storyboard?starter=storyboard.capri-swim`, { waitUntil: "load" });
        const story = page.getByRole("textbox", { name: "Your story" });
        await story.waitFor({ timeout: 60_000 });
        await page.waitForTimeout(1500);
        check(`${tag}: ?starter= of a story with no cover leaves a visitor's composer empty`, !/Capri/.test(await story.inputValue()));
        await page.goto(`${app}/assist?starter=assist.serum-ugc`, { waitUntil: "load" });
        await page.waitForTimeout(2500);
        const typedIn = (await page.locator("textarea").first().inputValue().catch(() => "")) ?? "";
        check(`${tag}: ?starter= of a job with no cover types nothing into a visitor's Assist`, !/serum/.test(typedIn), typedIn.slice(0, 40));
      }

      // ---- The owner's "Use template", studio by studio
      if (owner) {
        const tapUse = async (s, title) => {
          await page.goto(`${app}${s.path}`, { waitUntil: "load" });
          await page.getByRole("heading", { name: s.heading }).waitFor({ timeout: 60_000 });
          await page.locator("#starters article").filter({ hasText: title }).getByRole("button", { name: "Use template" }).click();
        };

        // Assist: the job is typed into the composer, never sent.
        await tapUse(SURFACES[0], "Emerald necklace campaign");
        await page.waitForTimeout(800);
        const typed = await page.locator("textarea").first().inputValue();
        check(`${tag}: a ready job types its words into Assist`, /^A campaign for an emerald and diamond necklace/.test(typed), typed.slice(0, 60));
        check(`${tag}: nothing was sent`, !/[?&]c=/.test(page.url()));
        await shot("assist-filled");
        await page.goto(`${app}/assist?starter=assist.serum-ugc`, { waitUntil: "load" });
        await page.waitForTimeout(1500);
        check(`${tag}: ?starter= types a ready job in too`, /^A 15-second vertical creator video/.test(await page.locator("textarea").first().inputValue()));
        if (size === "390") {
          // On a phone the ready jobs sit below the skills: a link beside "All skills" goes to them.
          await page.goto(`${app}/assist`, { waitUntil: "load" });
          const ready = page.getByRole("link", { name: "Ready jobs" });
          await ready.waitFor({ timeout: 60_000 }).catch(() => {});
          check(`${tag}: a phone's Assist links to the ready jobs`, await ready.isVisible().catch(() => false));
          const readyTop = await ready.evaluate((e) => e.getBoundingClientRect().top).catch(() => Infinity);
          check(`${tag}: the Ready jobs link is on the first screen`, readyTop < 844, `${Math.round(readyTop)} px`);

          // Cinema on a phone: shot 1 in the prompt bar, and the empty view says where shots 2 and 3 are.
          await tapUse(SURFACES[2], "Riviera night");
          await page.waitForURL(/\/cinema\/[^/?]+$/, { timeout: 90_000 });
          await page.getByText("Shot 1 of 3 is ready below.").first().waitFor({ timeout: 60_000 }).catch(() => {});
          check(`${tag}: a phone's ready film says where shots 2 and 3 are`, /Shot 1 of 3 is ready below\. Shots 2 and 3 are in the AI Director\./.test(await text()));
          phoneFilm = new URL(page.url()).pathname;
          await shot("cinema-from-starter");
        }

        if (size === "1440") {
          // Cinema: the film is made with its look and brief, and opens with shot 1 in the prompt bar.
          await tapUse(SURFACES[2], "Riviera night");
          await page.waitForURL(/\/cinema\/[^/?]+$/, { timeout: 90_000 });
          if (phoneFilm) check(`${tag}: Use template again opens the untouched film made before`, new URL(page.url()).pathname === phoneFilm, `${new URL(page.url()).pathname} vs ${phoneFilm}`);
          const prompt = page.getByRole("textbox", { name: "Prompt" });
          await prompt.waitFor({ timeout: 60_000 });
          await page.waitForFunction(() => /emerald silk gown/.test(document.querySelector('textarea[aria-label="Prompt"]')?.value ?? ""), null, { timeout: 30_000 }).catch(() => {});
          check(`${tag}: a ready film opens with shot 1 in the prompt bar`, /emerald silk gown/.test(await prompt.inputValue()), (await prompt.inputValue()).slice(0, 60));
          check(`${tag}: the AI Director shows the three shots`, /Here are the 3 shots/.test(await text()));
          await shot("cinema-from-starter");
          await page.getByRole("button", { name: /^Generate/ }).first().click();
          await page.locator('[data-status="succeeded"], video, img[src*="/api/files/"]').first().waitFor({ timeout: 120_000 }).catch(() => {});
          check(`${tag}: shot 1 runs (demo)`, (await page.locator('video, img[src*="/api/files/"]').count()) > 0);
          await shot("cinema-shot-1");
          await page.goto(`${app}/cinema`, { waitUntil: "load" });
          await page.getByText("Riviera night").first().waitFor({ timeout: 60_000 });
          await page.getByRole("heading", { name: SURFACES[2].heading }).waitFor({ timeout: 30_000 }).catch(() => {});
          const projTop = (await page.getByText("Updated just now").first().boundingBox())?.y ?? Infinity;
          const rowTop = (await page.locator("#starters").boundingBox())?.y ?? -1;
          const order = projTop < rowTop;
          check(`${tag}: with a film, the projects lead and the starters sit in a row below`, order);
          await fullShot("cinema-with-project");

          // Elements: the element is saved from its own picture.
          await tapUse(SURFACES[4], "Amara");
          await page.getByText("Type @Amara in any image or video prompt.").first().waitFor({ timeout: 60_000 }).catch(() => {});
          check(`${tag}: saving a ready element says how to use it`, (await page.getByText("Type @Amara in any image or video prompt.").count()) > 0);
          await page.getByText("@Amara").first().waitFor({ timeout: 60_000 }).catch(() => {});
          check(`${tag}: a ready element is saved as @Amara`, /@Amara/.test(await text()) && !/Amara_2/.test(await text()));
          await page.locator("#starters").waitFor({ timeout: 30_000 }).catch(() => {});
          check(`${tag}: a saved element's card leaves the row`, (await page.locator("#starters article").filter({ has: page.getByText("Amara", { exact: true }) }).count()) === 0 && (await page.locator("#starters article").count()) > 0);
          await fullShot("elements-with-one");
        }

        // Storyboard: the composer fills with the story, the frames, the shape and the look.
        await tapUse(SURFACES[3], "Perfume ad in 6 frames");
        const story = page.getByRole("textbox", { name: "Your story" });
        await page.waitForTimeout(800);
        check(`${tag}: a ready story fills Storyboard's composer`, /^Nuit Noire perfume ad/.test(await story.inputValue()) && /6 frames/.test(await text()));
        await shot("storyboard-filled");
        if (size === "1440") {
          await page.getByRole("button", { name: "Generate storyboard" }).click();
          await page.getByRole("button", { name: /^Open frame 1$/ }).first().waitFor({ timeout: 120_000 }).catch(() => {});
          check(`${tag}: Generate makes the board (demo)`, (await page.getByRole("button", { name: /^Open frame / }).count()) > 0);
          await page.goto(`${app}/storyboard`, { waitUntil: "load" });
          await page.getByRole("heading", { name: SURFACES[3].heading }).waitFor({ timeout: 60_000 }).catch(() => {});
          const below = await page.evaluate((h) => {
            const frame = document.querySelector('[aria-label^="Open frame"]');
            const head = [...document.querySelectorAll("h2")].find((e) => e.textContent?.trim() === h);
            return frame && head ? frame.getBoundingClientRect().top < head.getBoundingClientRect().top : false;
          }, SURFACES[3].heading);
          check(`${tag}: with a board, the board leads and the starters sit below`, below);
          await fullShot("storyboard-with-board");
        }
      }
      check(`${tag}: no page errors`, errors.length === 0, errors[0]);
      await ctx.close();
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
