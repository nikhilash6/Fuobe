// The ready-made starters of Faceless Studio, Content Factory, Explainer, Ads Studio, Click to Ad and Marketing Studio,
// and Canvas's Outfit lookbook and Music video boards, as a guest, a fresh account and the owner, at 390 and 1440 px:
// the owner's empty studio leads with its starters (each one marked until its cover exists), visitors see only starters
// with a real cover and no model or engine words, every starter has a read-only page, and the owner's "Use template"
// opens the channel's first episode, the filled composer, the brand kit, the product's ad or the product shot, ready
// to run. After that the owner's own work leads and the starters sit in one row below.
//
// node tests/e2e/starters-series-and-ads.mjs <app address> <owner password> [screenshot folder]
// Against `next start` with a fresh data dir, FUOBE_PUBLIC_SIGNUP=1 and demo mode on (FUOBE_DEMO_MODE=on).
import fs from "node:fs";
import path from "node:path";
import { launch, PHONE, DESKTOP } from "./_browser.mjs";

const [app, password, shots] = process.argv.slice(2);
if (!app || !password) throw new Error("usage: node tests/e2e/starters-series-and-ads.mjs <app address> <owner password> [screenshot folder]");
if (shots) fs.mkdirSync(shots, { recursive: true });

const ENGINE_WORDS = /Fuobe DoP|Effects 2\.0|\bGPU\b|Qwen|MiniMax|Nano Banana|Seedance|Ideogram|Kling|ElevenLabs|ACE-Step|placeholder/;
const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(name);
};

/** Each studio, the heading of its starters, how many it has, and whether visitors see them yet (a real cover). */
const SURFACES = [
  // words: a cover-less starter's name and composer words, which a visitor's page must not carry.
  { path: "/faceless", heading: "Start from a ready channel", n: 3, covered: false, first: "faceless.boat-hotels", words: ["Hotels you reach by boat", "Only by Boat"] },
  { path: "/content-factory", heading: "Start from a ready series", n: 3, covered: false, first: "cf.underwater-fashion-week", words: ["Fashion week, underwater", "Paris fashion week was held underwater"] },
  { path: "/explainer", heading: "Start from a ready explainer", n: 3, covered: false, first: "ex.couture-400-hours", words: ["A couture gown in 400 hours", "takes 400 hours to make"] },
  // An ad and a video ad wait for their own covers (a plain product shot isn't what they make).
  { path: "/ads", heading: "Start from a ready brand", n: 2, covered: false, first: "ads.maison-verre", words: ["Maison Verre perfume", "Studio Marlow leather"] },
  { path: "/marketing/click-to-ad", heading: "Start from a ready product", n: 2, covered: false, first: "c2a.eau-de-verre", words: ["Perfume video ad", "Handbag video ad"] },
  { path: "/marketing", heading: "Start from a ready shoot", n: 2, covered: true, first: "mk.perfume-moss", tryIn: "/apps/app-product-shot?example=app-product-shot.1" },
];

async function signIn(ctx, persona) {
  if (persona === "owner") {
    const r = await ctx.request.post(`${app}/api/auth/login`, { data: { password } });
    if (!r.ok()) throw new Error(`owner login ${r.status()}`);
  } else if (persona === "account") {
    const email = `starters-sa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
    const r = await ctx.request.post(`${app}/api/auth/signup`, { data: { email, password: "starters-sa-pw-123" } });
    if (!r.ok()) throw new Error(`signup ${r.status()}`);
  }
}

const browser = await launch();
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
      // Click to Ad's end-card Save button reads the viewer's runs label from the browser (a hydration mismatch, #418, for
      // an account): not this page's, logged apart so it doesn't hide a new error.
      const known = [];
      page.on("pageerror", (e) => (/\/marketing\/click-to-ad/.test(page.url()) && /#418/.test(String(e)) ? known : errors).push(`${page.url()} :: ${String(e).slice(0, 200)}`));
      const shot = async (name) => shots && page.screenshot({ path: path.join(shots, `${name}--${persona}--${size}.png`), fullPage: false });
      const fullShot = async (name) => shots && page.screenshot({ path: path.join(shots, `${name}--${persona}--${size}--full.png`), fullPage: true });
      const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const text = () => page.locator("main, body").first().innerText();
      const owner = persona === "owner";

      // ---- Each studio's first screen, with nothing of one's own yet
      for (const s of SURFACES) {
        const name = s.path.slice(1).replaceAll("/", "-");
        await page.goto(`${app}${s.path}`, { waitUntil: "load", timeout: 180_000 });
        if (owner || s.covered) await page.getByRole("heading", { name: s.heading }).waitFor({ timeout: 60_000 }).catch(() => {});
        else await page.waitForTimeout(2500);
        const section = page.locator("#starters");
        const cards = section.locator("article");
        const n = await cards.count();
        const t = await text();
        if (owner) {
          check(`${tag}: ${s.path} leads with its ${s.n} starters`, n === s.n, `${n}`);
          check(`${tag}: ${s.path} starters each have Use template`, (await section.getByRole("button", { name: "Use template" }).count()) === s.n);
          if (!s.covered) check(`${tag}: ${s.path} marks the starters without a cover`, (await section.getByText("No cover yet").count()) === s.n);
        } else if (s.covered) {
          check(`${tag}: ${s.path} shows its covered starters to a visitor`, n === s.n && (await cards.evaluateAll((els) => els.every((e) => e.querySelector("img")))), `${n}`);
          check(`${tag}: ${s.path} visitor cards say See how it works`, (await section.getByText("See how it works").count()) === s.n && !/Use template|No cover yet/.test(await section.innerText()));
          const firstCard = await cards.first().evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
          check(`${tag}: ${s.path} starters sit near the top`, firstCard < (size === "390" ? 2200 : 1400), `${Math.round(firstCard)} px`);
          // The first card's title is clear of the docked composer (nothing lies over it).
          const hidden = await cards
            .first()
            .locator("h3")
            .first()
            .evaluate((h) => {
              h.scrollIntoView({ block: "nearest" });
              const r = h.getBoundingClientRect();
              const at = document.elementFromPoint(r.left + Math.min(r.width / 2, 40), r.top + r.height / 2);
              return !at || !h.closest("article")?.contains(at);
            })
            .catch(() => true);
          check(`${tag}: ${s.path} first starter card is clear of the composer`, !hidden);
        } else {
          check(`${tag}: ${s.path} shows a visitor no starter without its cover`, n === 0 && !/No cover yet|Use template/.test(t) && !t.includes(s.heading));
          // Nor in the page's data: a cover-less starter's words never reach a visitor.
          const html = await (await ctx.request.get(`${app}${s.path}`)).text();
          const leak = s.words.find((w) => html.includes(w));
          check(`${tag}: ${s.path} sends a visitor none of a cover-less starter's words`, !leak, leak);
        }
        if (!owner) check(`${tag}: no model or engine words on ${s.path}`, !ENGINE_WORDS.test(n ? await section.innerText() : ""), (t.match(ENGINE_WORDS) ?? [""])[0]);
        check(`${tag}: no sideways scroll on ${s.path}`, (await sideways()) <= 1, `${await sideways()} px`);
        await shot(`${name}-first`);
        if (size === "1440" || s.covered) await fullShot(`${name}-first`);

        // The starter's page.
        await page.goto(`${app}${s.path}/start/${s.first}`, { waitUntil: "load" });
        if (owner || s.covered) {
          await page.getByRole("heading", { name: "What goes in" }).waitFor({ timeout: 60_000 });
          const pt = await text();
          check(`${tag}: ${s.first}'s page says what goes in, the steps and what comes out`, /The steps/i.test(pt) && /What comes out/i.test(pt));
          if (owner) {
            // The owner's action shows once the viewer is known (after hydration).
            await page.getByText("Use template").first().waitFor({ timeout: 30_000 }).catch(() => {});
            check(`${tag}: the owner can use ${s.first} from its page`, (await page.getByRole("button", { name: "Use template" }).count()) + (await page.getByRole("link", { name: "Use template" }).count()) === 1);
          }
          else {
            check(`${tag}: ${s.first}'s page has no model words and no Use template`, !ENGINE_WORDS.test(pt) && !/Use template/.test(pt), (pt.match(ENGINE_WORDS) ?? [""])[0]);
            check(`${tag}: ${s.first}'s page shows its photo`, (await page.locator("main img, body img").count()) >= 2);
            if (s.tryIn) {
              // A visitor goes on to the app that makes the same from the same photo, its example loaded.
              const go = page.getByRole("link", { name: /^Try it in / });
              await go.waitFor({ timeout: 30_000 }).catch(() => {});
              check(`${tag}: ${s.first}'s page leads a visitor to the app with its example`, (await go.getAttribute("href").catch(() => null)) === s.tryIn);
              if (size === "1440") {
                await go.click();
                await page.waitForURL((u) => u.pathname === s.tryIn.split("?")[0], { timeout: 60_000 });
                await page.getByText("In the composer").first().waitFor({ timeout: 60_000 }).catch(() => {});
                check(`${tag}: the app opens with the starter's example in the composer`, /In the composer/.test(await text()));
                await shot(`${name}-try-in`);
              }
            }
          }
          check(`${tag}: no sideways scroll on ${s.first}'s page`, (await sideways()) <= 1, `${await sideways()} px`);
        } else {
          // A real 404, with none of its words in what is sent.
          const r = await ctx.request.get(`${app}${s.path}/start/${s.first}`);
          const html = await r.text();
          const leak = s.words.find((w) => html.includes(w));
          check(`${tag}: ${s.first} (no cover yet) is a 404 for a visitor, with none of its words`, r.status() === 404 && !leak, `${r.status()} ${leak ?? ""}`);
          check(`${tag}: ${s.first}'s page shows a visitor no steps`, !/The steps/i.test(await text()));
        }
        await shot(`${name}-start`);
      }

      // A starter page whose id isn't that studio's answers a real 404.
      if (size === "1440") {
        for (const bad of ["/ads/start/faceless.boat-hotels", "/explainer/start/nope.x"]) {
          const r = await page.goto(`${app}${bad}`, { waitUntil: "load" });
          check(`${tag}: ${bad} is a real 404`, r?.status() === 404, String(r?.status()));
        }
        // A starter not shown yet keeps its name out of the page title.
        await page.goto(`${app}/faceless/start/faceless.boat-hotels`, { waitUntil: "load" });
        check(`${tag}: a starter with no cover yet has a neutral title`, !/Hotels you reach by boat/.test(await page.title()), await page.title());
      }

      // Explainer with no history: the owner's ready explainers stand where the history is, without its tabs and search.
      if (owner) {
        await page.goto(`${app}/explainer`, { waitUntil: "load" });
        await page.getByRole("heading", { name: SURFACES[2].heading }).waitFor({ timeout: 60_000 });
        check(`${tag}: Explainer hides the empty History toolbar under its starters`, !(await page.getByRole("heading", { name: "History" }).isVisible()) && !(await page.getByRole("textbox", { name: "Search your explainers" }).isVisible()));
      }

      // Canvas's new boards: the owner sees them marked, visitors not until their covers exist.
      await page.goto(`${app}/canvas`, { waitUntil: "load" });
      await page.getByRole("heading", { name: "What's a canvas?" }).waitFor({ timeout: 60_000 });
      if (owner) await page.getByRole("button", { name: "Use template" }).first().waitFor();
      else await page.waitForTimeout(1500);
      const ct = await page.locator("#templates").innerText();
      if (owner) check(`${tag}: Canvas lists Outfit lookbook and Music video for the owner`, /Outfit lookbook/.test(ct) && /Music video/.test(ct));
      else check(`${tag}: Canvas keeps Outfit lookbook and Music video from visitors until their covers exist`, !/Outfit lookbook|Music video/.test(ct));

      // ---- The owner's "Use template", studio by studio
      if (owner && size === "1440") {
        const tapFirstUse = async (s) => {
          await page.goto(`${app}${s.path}`, { waitUntil: "load" });
          await page.getByRole("heading", { name: s.heading }).waitFor({ timeout: 60_000 });
          await page.locator("#starters article").first().getByRole("button", { name: "Use template" }).click();
        };

        // Faceless: the channel is made, its first episode's setup opens with the topic in.
        await tapFirstUse(SURFACES[0]);
        await page.waitForURL(/\/faceless\/[^/]+\/new\?starter=/, { timeout: 60_000 });
        const own = page.locator("textarea").first();
        await own.waitFor();
        check(`${tag}: a ready channel opens its first episode with the topic written in`, (await own.inputValue()) === "Five hotels you can only reach by boat");
        await shot("faceless-from-starter");
        await page.getByRole("button", { name: "Next" }).click();
        await page.getByRole("heading", { name: "Video settings" }).waitFor();
        check(`${tag}: the channel's look is the starter's`, /Editorial Motion Graphics/.test(await text()));
        await page.getByRole("button", { name: /Write the script/ }).click();
        await page.waitForURL(/\/faceless\/[^/]+\/(?!new)[^/?]+$/, { timeout: 60_000 });
        check(`${tag}: Write the script makes episode 1`, true);
        await page.goto(`${app}/faceless`, { waitUntil: "load" });
        await page.getByRole("heading", { name: "My channels" }).waitFor();
        await page.getByRole("heading", { name: SURFACES[0].heading }).waitFor({ timeout: 30_000 }).catch(() => {});
        const order = await page.evaluate(() => [...document.querySelectorAll("h2")].map((h) => h.textContent?.trim()));
        check(`${tag}: with a channel, My channels leads and the starters sit below`, order.indexOf("My channels") >= 0 && order.indexOf("My channels") < order.indexOf(SURFACES[0].heading), order.join(" | "));
        await shot("faceless-with-channel");

        // Content Factory: the composer fills with the style and the idea.
        await tapFirstUse(SURFACES[1]);
        await page.waitForTimeout(800);
        const cfPrompt = await page.locator("textarea").first().inputValue();
        check(`${tag}: a ready series fills the composer`, cfPrompt === "What if Paris fashion week was held underwater?" && /Preset: What if/.test(await text()), cfPrompt);
        await shot("content-factory-filled");
        await page.goto(`${app}/content-factory?starter=cf.narcissus`, { waitUntil: "load" });
        await page.waitForTimeout(1500);
        check(`${tag}: ?starter= fills the composer too`, (await page.locator("textarea").first().inputValue()) === "Narcissus retold as a modern supermodel" && /Preset: Myths retold/i.test(await text()));
        await page.getByRole("button", { name: /^Generate$/ }).click();
        await page.waitForURL(/\/content-factory\/[^/?]+$/, { timeout: 90_000 });
        check(`${tag}: Generate makes the series`, true);
        await shot("content-factory-series");

        // Explainer: the form fills with the topic, style and length.
        await tapFirstUse(SURFACES[2]);
        await page.waitForTimeout(800);
        const exPrompt = await page.locator("textarea").first().inputValue();
        check(`${tag}: a ready explainer fills the form`, exPrompt === "How a couture gown takes 400 hours to make" && /Editorial Motion Graphics/.test(await text()), exPrompt);
        await shot("explainer-filled");
        await page.getByRole("button", { name: /^Generate$/ }).click();
        await page.waitForURL(/\/explainer\/[^/?]+$/, { timeout: 90_000 });
        check(`${tag}: Generate makes the explainer`, true);

        // Click to Ad first, on a data dir with no products yet: the product it makes is picked on this same page.
        await tapFirstUse(SURFACES[4]);
        await page.waitForURL(/\/marketing\/click-to-ad\?product=/, { timeout: 90_000 });
        await page.getByText("Your product kit").first().waitFor({ timeout: 60_000 }).catch(() => {});
        check(`${tag}: a ready product opens Click to Ad with its kit (first product made)`, /Your product kit/.test(await text()) && !/No saved products yet/.test(await text()));
        check(`${tag}: Click to Ad's Use template stops spinning once open`, (await page.locator("#starters .animate-spin").count()) === 0);
        await shot("click-to-ad-from-starter");

        // Marketing Studio's second shoot makes a product no one made before: the template and that product are in.
        await page.goto(`${app}${SURFACES[5].path}`, { waitUntil: "load" });
        await page.getByRole("heading", { name: SURFACES[5].heading }).waitFor({ timeout: 60_000 });
        await page.locator("#starters article").nth(1).getByRole("button", { name: "Use template" }).click();
        await page.waitForURL(/\/marketing\?template=ps-studio-white&product=/, { timeout: 90_000 });
        await page.locator('img[src^="/api/files/"]').first().waitFor({ timeout: 60_000 }).catch(() => {});
        check(`${tag}: a ready shoot opens with its template and its new product`, /Studio White/.test(await text()) && (await page.locator('img[src^="/api/files/"]').count()) > 0);
        check(`${tag}: Marketing's Use template stops spinning once open`, (await page.locator("#starters .animate-spin").count()) === 0);
        await shot("marketing-from-starter");

        // Ads Studio: the brand kit with its product (the perfume's, made by Click to Ad, reused).
        await tapFirstUse(SURFACES[3]);
        await page.waitForURL(/\/ads\/[^/?]+\?step=new$/, { timeout: 90_000 });
        await page.getByText("Eau de Verre").first().waitFor({ timeout: 60_000 }).catch(() => {});
        check(`${tag}: a ready brand opens with its product`, /Maison Verre/.test(await text()) && /Eau de Verre/.test(await text()));
        await shot("ads-brand-from-starter");

        // With products of its own, Ads Studio's brands lead and the starters sit below.
        await page.goto(`${app}/ads`, { waitUntil: "load" });
        await page.getByRole("heading", { name: "Your brands" }).waitFor();
        await page.getByRole("heading", { name: "Start from a ready brand" }).waitFor({ timeout: 30_000 }).catch(() => {});
        const ads = await page.evaluate(() => [...document.querySelectorAll("h2")].map((h) => h.textContent?.trim()));
        check(`${tag}: with brands, Your brands leads and the starters sit below`, ads.indexOf("Your brands") >= 0 && ads.indexOf("Your brands") < ads.indexOf("Start from a ready brand"), ads.join(" | "));
      }
      check(`${tag}: no page errors`, errors.length === 0, errors[0]);
      if (known.length) console.log(`note ${tag}: ${known.length} known end-card hydration error(s) on Click to Ad`);
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
