// Home's first screen in a real browser (src/components/home/home-bento.tsx). Run it on a production server
// (`next build`, then `next start -p <port>`): the weight and layout-shift numbers mean little on a dev server.
//
// Usage: node tests/e2e/home-bento.mjs [appUrl] [--shots <dir>] [--weight-only]   (pnpm test:e2e:home)
//   E2E_OWNER_PASSWORD: the studio's password, when it has one; the owner's pass signs in with it. Without one the
//   studio is the owner's, and the guest's pass is skipped.
//   --weight-only: only measure what the first screen downloads (to compare another build, such as main's).
//
// 1. Every width (390, 768, 1024, 1280, 1440, 1920), light and dark, as a guest and as the owner: no sideways scroll,
//    one h1, the headline (two lines from 768, its second line whole), and the first screen holds what it should
//    (a phone: the video tile and the three under it; from 1024: all eight). A picture of each (--shots), and a contact
//    sheet of them all.
// 2. Layout shift under 0.01 at 390 and 1440, through a load and a scroll to the bottom and back.
// 3. Every tile's link answers 200, and the numbers tile opens every studio (the launcher; a phone's sheet).
// 4. Reduced motion and Save-Data: no clip is fetched or played, nothing moves by itself (the split rests at 50 %, the
//    live words stay), and the tiles keep their stills.
// 5. Pause previews stops the catwalk and freezes every animation; pressed again, they go on.
// 6. Weight: what the page downloads before `load` (clips aside), at 390 and 1440, reported; the first screen's own
//    stills stay under 280 KB.
// 7. The composer: /?new=1 brings it into view with the focus; a plain visit stays at the top (no autofocus jump).
// 8. Every tile is a named link, and Tab reaches them in the grid's reading order with a visible ring.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { DESKTOP, launch, PHONE, root } from "./_browser.mjs";

const args = process.argv.slice(2);
const app = (args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--shots") ?? "http://localhost:3620").replace(/\/$/, "");
const shotsDir = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : undefined;
const weightOnly = args.includes("--weight-only");
if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

const browser = await launch();
const failures = [];
const notes = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(`${name} ${detail}`);
};

const WIDTHS = [
  { w: 390, h: 844, phone: true },
  { w: 768, h: 1024 },
  { w: 1024, h: 768 },
  { w: 1280, h: 800 },
  { w: 1440, h: 900 },
  { w: 1920, h: 1080 },
];
const TILES = ["video", "image", "audio", "threeD", "restore", "numbers", "live", "canvas"];
const HEADLINE = "Make anything: From an idea to a finished film, in one place.";

/** A context as `who`; null when that viewer can't be had here (a guest needs a studio with a password). */
async function context(who, opts) {
  const ctx = await browser.newContext(opts);
  if (who === "owner" && process.env.E2E_OWNER_PASSWORD) {
    const r = await ctx.request.post(`${app}/api/auth/login`, { data: { password: process.env.E2E_OWNER_PASSWORD } });
    assert.ok(r.ok(), "the owner signs in");
  }
  if (who === "guest" && !process.env.E2E_OWNER_PASSWORD) {
    await ctx.close();
    return null;
  }
  return ctx;
}

const viewportOpts = (v, extra = {}) => ({
  ...(v.phone ? PHONE : {}),
  viewport: { width: v.w, height: v.h },
  deviceScaleFactor: v.phone ? 3 : v.w >= 1440 ? 2 : 1,
  ...extra,
});

async function open(page, url = "/") {
  await page.goto(app + url, { waitUntil: "load", timeout: 90_000 });
  await page.locator("#home-bento h1").waitFor({ timeout: 20_000 });
}

/** The first screen's layout, read in the page. */
const layout = (page) =>
  page.evaluate((tiles) => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, w: r.width, h: r.height };
    };
    const h1 = document.querySelector("#home-bento h1");
    const line2 = h1.querySelector("span:last-child");
    const lh = parseFloat(getComputedStyle(h1).lineHeight);
    return {
      h1s: document.querySelectorAll("h1").length,
      text: h1.textContent.replace(/\s+/g, " ").trim(),
      h1Lines: Math.round(h1.getBoundingClientRect().height / lh),
      line2Lines: Math.round(line2.getBoundingClientRect().height / lh),
      line2Italic: getComputedStyle(line2).fontStyle,
      line2Color: getComputedStyle(line2).color,
      scroll: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
      vh: innerHeight,
      tiles: Object.fromEntries(tiles.map((t) => [t, box(document.querySelector(`#home-bento [data-tile="${t}"]`))])),
      dark: document.documentElement.classList.contains("dark"),
    };
  }, TILES);

// ------------------------------------------------------------------------------------------- 1. every width
const shots = [];
if (!weightOnly)
  for (const who of ["guest", "owner"]) {
    for (const scheme of ["light", "dark"]) {
      for (const v of WIDTHS) {
        const ctx = await context(who, viewportOpts(v, { colorScheme: scheme }));
        if (!ctx) {
          if (scheme === "light" && v.w === 390) console.log("- (skipped: the guest pass needs a studio with a password, E2E_OWNER_PASSWORD)");
          continue;
        }
        const page = await ctx.newPage();
        await open(page);
        await page.waitForTimeout(1500);
        const l = await layout(page);
        const tag = `${who} ${scheme} ${v.w}`;
        check(`${tag}: no sideways scroll`, l.scroll[0] === l.scroll[1], l.scroll.join(" vs "));
        check(`${tag}: one h1, the headline`, l.h1s === 1 && l.text === HEADLINE, `${l.h1s} · ${l.text}`);
        check(`${tag}: theme`, l.dark === (scheme === "dark"));
        if (v.w >= 768) check(`${tag}: headline on two lines, the second whole and italic`, l.h1Lines === 2 && l.line2Lines === 1 && l.line2Italic === "italic", `${l.h1Lines}/${l.line2Lines}`);
        if (v.phone) {
          const bottom = l.vh - 64;
          const first = ["video", "image", "threeD", "restore"];
          const out = first.filter((t) => l.tiles[t].top < 0 || l.tiles[t].bottom > bottom);
          check(`${tag}: the video tile and three more on the first screen`, out.length === 0, first.map((t) => `${t} ${Math.round(l.tiles[t].bottom)}`).join(", ") + ` ≤ ${bottom}`);
          check(`${tag}: every tile at least 44 px to tap`, TILES.every((t) => l.tiles[t].w >= 44 && l.tiles[t].h >= 44));
        }
        if (v.w >= 1024) {
          const out = TILES.filter((t) => l.tiles[t].bottom > l.vh || l.tiles[t].top < 0);
          check(`${tag}: all eight tiles on the first screen`, out.length === 0, out.join(", "));
        }
        if (shotsDir) {
          const f = path.join(shotsDir, `${who}-${scheme}-${v.w}.png`);
          await page.screenshot({ path: f });
          shots.push({ f, who, scheme, w: v.w });
        }
        await ctx.close();
      }
    }
  }

// ------------------------------------------------------------------------------------------- 2. layout shift
async function cls(v) {
  const ctx = await browser.newContext(viewportOpts(v));
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__cls = 0;
    window.__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        if (!e.hadRecentInput) {
          window.__cls += e.value;
          window.__shifts.push({ v: e.value, at: Math.round(e.startTime), nodes: (e.sources ?? []).map((s) => s.node?.id || s.node?.className?.toString?.().slice(0, 60) || s.node?.nodeName) });
        }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await open(page);
  await page.waitForTimeout(2500);
  const firstScreen = await page.evaluate(() => window.__cls);
  // Down the page and back, a screen at a time (the sections under it are laid out as they come near).
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += v.h * 0.8) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(120);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
  const all = await page.evaluate(() => ({ cls: window.__cls, shifts: window.__shifts }));
  await ctx.close();
  return { firstScreen, ...all };
}
if (!weightOnly)
  for (const v of [WIDTHS[0], WIDTHS[4]]) {
    const r = await cls(v);
    check(`layout shift at ${v.w}: first screen ${r.firstScreen.toFixed(4)}, whole page ${r.cls.toFixed(4)}`, r.firstScreen < 0.01, JSON.stringify(r.shifts.slice(0, 4)));
    notes.push(`CLS ${v.w}: first screen ${r.firstScreen.toFixed(4)}, through a scroll ${r.cls.toFixed(4)}`);
  }

// ------------------------------------------------------------------------------------------- 3. links
if (!weightOnly) {
  const ctx = await browser.newContext(DESKTOP);
  const page = await ctx.newPage();
  await open(page);
  const hrefs = await page.$$eval("#home-bento [data-tile]", (as) => as.map((a) => [a.dataset.tile, a.getAttribute("href")]));
  check("eight tiles, in the grid's reading order", hrefs.map((h) => h[0]).join() === TILES.join(), hrefs.map((h) => h[0]).join());
  for (const [tile, href] of hrefs) {
    if (href.startsWith("#")) {
      check(`${tile}: ${href} is on the page`, (await page.locator(href).count()) === 1);
      continue;
    }
    const r = await ctx.request.get(app + href, { maxRedirects: 5 });
    check(`${tile}: ${href} answers ${r.status()}`, r.status() === 200);
  }
  await page.locator('#home-bento [data-tile="numbers"]').click();
  await page.waitForTimeout(600);
  check("the numbers tile opens every studio (the launcher)", (await page.locator('section[aria-label="All studios"]:visible').count()) > 0 && page.url() === `${app}/`, page.url());
  await ctx.close();

  const phone = await browser.newContext(PHONE);
  const pp = await phone.newPage();
  await open(pp);
  await pp.locator('#home-bento [data-tile="numbers"]').scrollIntoViewIfNeeded();
  await pp.locator('#home-bento [data-tile="numbers"]').click();
  await pp.waitForTimeout(700);
  check("on a phone, the numbers tile opens the Studios sheet", (await pp.locator('[role="dialog"]:visible').count()) > 0);
  await phone.close();
}

// ------------------------------------------------------------------------------------------- 4. reduced motion, Save-Data
if (!weightOnly) {
  const ctx = await browser.newContext({ ...DESKTOP, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const clips = [];
  page.on("request", (r) => r.url().includes(".mp4") && clips.push(r.url()));
  await open(page);
  await page.waitForTimeout(3000);
  const pill = () => page.locator("#home-bento [data-tile=live]").innerText();
  const a = await pill();
  await page.waitForTimeout(1000);
  const b = await pill();
  const state = await page.evaluate(() => ({
    play: document.getElementById("home-bento").dataset.play ?? null,
    videos: [...document.querySelectorAll("#home-bento video")].filter((v) => v.getAttribute("src") && !v.paused).length,
    split: getComputedStyle(document.querySelector("#home-bento [data-tile=restore] picture:nth-of-type(2) img")).clipPath,
  }));
  check("reduced motion: nothing moves by itself", state.play === null && state.videos === 0 && clips.length === 0, JSON.stringify({ ...state, clips: clips.length }));
  check("reduced motion: the split rests at 50 %", /inset\(0(px)? 50%/.test(state.split), state.split);
  check("reduced motion: the live words stay", a === b, `${JSON.stringify(a)} / ${JSON.stringify(b)}`);
  await ctx.close();

  const sd = await browser.newContext(DESKTOP);
  await sd.addInitScript(() => Object.defineProperty(navigator, "connection", { value: { saveData: true, effectiveType: "4g", addEventListener() {} }, configurable: true }));
  const sp = await sd.newPage();
  const cdp = await sd.newCDPSession(sp);
  await cdp.send("Network.enable");
  await cdp.send("Network.setExtraHTTPHeaders", { headers: { "Save-Data": "on" } });
  const sdClips = [];
  sp.on("request", (r) => r.url().includes(".mp4") && sdClips.push(r.url()));
  await open(sp);
  await sp.waitForTimeout(3500);
  const sdPlay = await sp.evaluate(() => document.getElementById("home-bento").dataset.play ?? null);
  check("Save-Data: no clip fetched, nothing moves", sdClips.length === 0 && sdPlay === null, `${sdClips.length} clips, play=${sdPlay}`);
  await sd.close();
}

// ------------------------------------------------------------------------------------------- 5. pause previews
if (!weightOnly) {
  const ctx = await browser.newContext(DESKTOP);
  const page = await ctx.newPage();
  await open(page);
  const playing = () =>
    page.evaluate(() => {
      const v = document.querySelector("#home-bento [data-tile=video] video");
      return v ? { paused: v.paused, t: v.currentTime } : null;
    });
  await page.waitForFunction(() => {
    const v = document.querySelector("#home-bento [data-tile=video] video");
    return v && !v.paused && v.currentTime > 0.2;
  }, null, { timeout: 8000 }).catch(() => {});
  const before = await playing();
  check("the catwalk plays by itself after load", !!before && !before.paused, JSON.stringify(before));
  await page.getByRole("button", { name: "Pause previews" }).click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    v: document.querySelector("#home-bento [data-tile=video] video")?.paused,
    play: document.getElementById("home-bento").dataset.play,
    running: document.getElementById("home-bento").getAnimations({ subtree: true }).filter((a) => a.playState === "running").length,
  }));
  check("Pause previews stops the clip and freezes the tiles", after.v === true && after.play === "0" && after.running === 0, JSON.stringify(after));
  const live1 = await page.locator("#home-bento [data-tile=live]").innerText();
  await page.waitForTimeout(800);
  check("paused, the live words stop", live1 === (await page.locator("#home-bento [data-tile=live]").innerText()));
  await page.getByRole("button", { name: "Play previews" }).click();
  await page.waitForTimeout(1500);
  const again = await page.evaluate(() => ({
    v: document.querySelector("#home-bento [data-tile=video] video")?.paused,
    play: document.getElementById("home-bento").dataset.play,
  }));
  check("Play previews starts them again", again.v === false && again.play === "1", JSON.stringify(again));
  await ctx.close();
}

// ------------------------------------------------------------------------------------------- 6. weight
async function weight(v) {
  const ctx = await browser.newContext(viewportOpts(v));
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  const reqs = new Map();
  let loaded = false;
  cdp.on("Network.responseReceived", (e) => reqs.set(e.requestId, { url: e.response.url, type: e.type, mime: e.response.mimeType, bytes: 0, done: false }));
  cdp.on("Network.loadingFinished", (e) => {
    const r = reqs.get(e.requestId);
    if (r && !loaded) Object.assign(r, { bytes: e.encodedDataLength, done: true });
  });
  await page.goto(app + "/", { waitUntil: "load", timeout: 90_000 });
  loaded = true;
  await page.waitForTimeout(300);
  const by = {};
  let total = 0;
  let own = 0;
  const media = [];
  // The first screen's own pictures: the tiles' stills (anything else is the page's, below it).
  const ownUrls = new Set(await page.evaluate(() => [...document.querySelectorAll("#home-bento img")].map((i) => new URL(i.currentSrc || i.src, location.href).pathname)));
  for (const r of reqs.values()) {
    if (!r.done || r.mime.startsWith("video/")) continue;
    const kind = r.type === "Document" ? "html" : r.type === "Stylesheet" ? "css" : r.type === "Script" ? "js" : r.type === "Font" ? "fonts" : r.type === "Image" ? "images" : "other";
    by[kind] = (by[kind] ?? 0) + r.bytes;
    total += r.bytes;
    const pathname = new URL(r.url).pathname;
    if (kind === "images" && ownUrls.has(pathname)) {
      own += r.bytes;
      media.push(`${pathname} ${(r.bytes / 1024).toFixed(1)}`);
    }
  }
  await ctx.close();
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  return { total, own, line: `${v.w}@${viewportOpts(v).deviceScaleFactor}x: ${kb(total)} (${Object.entries(by).map(([k, n]) => `${k} ${kb(n)}`).join(", ")}); the first screen's own stills ${kb(own)}`, media };
}
for (const v of [WIDTHS[0], WIDTHS[4]]) {
  const r = await weight(v);
  // The whole page's total is reported (main's own script and fonts are most of it: compare with --weight-only on
  // main's build); the first screen's own stills have a budget of their own.
  check(`weight before load, clips aside: ${r.line}`, weightOnly || r.own < 280 * 1024);
  notes.push(`weight ${r.line}`);
  notes.push(`  first screen's stills: ${r.media.join(" · ")}`);
}

// ------------------------------------------------------------------------------------------- 7. composer
if (!weightOnly) {
  const ctx = await browser.newContext(DESKTOP);
  const page = await ctx.newPage();
  await open(page);
  await page.waitForTimeout(1500);
  check("a plain visit stays at the top (no autofocus jump)", (await page.evaluate(() => scrollY)) === 0);
  await open(page, "/?new=1");
  await page.waitForTimeout(1500);
  const c = await page.evaluate(() => {
    const t = document.querySelector('textarea[aria-label="Describe what to create"]');
    const r = t.getBoundingClientRect();
    return { focused: document.activeElement === t, inView: r.top >= 0 && r.bottom <= innerHeight };
  });
  check("New creation (?new=1) brings the composer into view with the focus", c.focused && c.inView, JSON.stringify(c));
  await ctx.close();
}

// ------------------------------------------------------------------------------------------- 8. names and Tab order
if (!weightOnly) {
  const ctx = await browser.newContext(DESKTOP);
  const page = await ctx.newPage();
  await open(page);
  const names = await page.$$eval("#home-bento a", (as) => as.map((a) => a.getAttribute("aria-label") ?? a.textContent.trim()));
  check("every link on the first screen has a name", names.length === 8 && names.every((n) => n && n.length > 5), names.join(" | "));
  await page.locator("#home-bento h1").click();
  const order = [];
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => document.activeElement?.dataset?.tile ?? document.activeElement?.tagName));
  }
  check("Tab reaches the tiles in reading order", order.join() === TILES.join(), order.join());
  await page.keyboard.press("Shift+Tab");
  const ring = await page.evaluate(() => getComputedStyle(document.activeElement).boxShadow);
  check("a focused tile shows its ring", ring && ring !== "none", ring);
  if (shotsDir) await page.screenshot({ path: path.join(shotsDir, "focus-ring-1440.png"), clip: { x: 0, y: 0, width: 1440, height: 900 } });
  await ctx.close();
}

await browser.close();

// ------------------------------------------------------------------------------------------- contact sheet
if (shotsDir && shots.length) {
  const sharp = createRequire(path.join(root, "package.json"))("sharp");
  const W = 480;
  const tiles = await Promise.all(
    shots.map(async (s) => {
      const { data, info } = await sharp(s.f).resize({ width: W }).png().toBuffer({ resolveWithObject: true });
      return { ...s, buf: data, h: info.height };
    }),
  );
  const rows = [];
  for (const who of ["guest", "owner"])
    for (const scheme of ["light", "dark"]) {
      const row = tiles.filter((t) => t.who === who && t.scheme === scheme);
      if (row.length) rows.push(row);
    }
  const rowH = rows.map((r) => Math.max(...r.map((t) => t.h)));
  const cols = Math.max(...rows.map((r) => r.length));
  const pad = 12;
  const composite = [];
  let y = pad;
  rows.forEach((r, i) => {
    r.forEach((t, j) => composite.push({ input: t.buf, left: pad + j * (W + pad), top: y }));
    y += rowH[i] + pad;
  });
  await sharp({ create: { width: pad + cols * (W + pad), height: y, channels: 3, background: "#777" } })
    .composite(composite)
    .jpeg({ quality: 82 })
    .toFile(path.join(shotsDir, "contact-sheet.jpg"));
  console.log(`contact sheet: ${path.join(shotsDir, "contact-sheet.jpg")}`);
}

console.log("\n" + notes.join("\n"));
if (failures.length) {
  console.log(`\n${failures.length} failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nall passed");
