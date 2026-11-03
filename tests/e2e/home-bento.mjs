// Home's first screen in a real browser (src/components/home/home-bento.tsx). Run it on a production server
// (`next build`, then `next start -p <port>`): the weight and layout-shift numbers mean little on a dev server.
//
// Usage: node tests/e2e/home-bento.mjs [appUrl] [--shots <dir>] [--weight-only]   (pnpm test:e2e:home)
//   E2E_BROWSER=webkit or firefox: run it in that engine (tests/e2e/_browser.mjs).
//   E2E_OWNER_PASSWORD: the studio's password, when it has one; the owner's pass signs in with it. Without one the
//   studio is the owner's, and the guest's pass is skipped.
//   --weight-only: only measure what the first screen downloads (to compare another build, such as main's).
//
// 1. Every width (390, 768, 1024, 1280, 1440, 1920), light and dark, as a guest and as the owner: no sideways scroll,
//    one h1, the headline in its own words ("Make anything:" on one line; the second line whole from 768, and on a
//    phone two lines that break before "finished film,"), it rose into place once, and the first screen holds what it
//    should (a phone: the video tile and the two under it; from 1024: all eight). A picture of each (--shots), and a
//    contact sheet of them all.
// 1b. Sharp at every width and pixel ratio (1x, 2x, 3x): every picture on the first screen is at least as wide as its
//    box shows it (object-fit: cover, times the ratio), up to the widest copy there is, and so is each clip once it
//    plays. No play sign on a tile that plays by itself, at any moment from the first paint until both clips play, and
//    nothing shifts as a clip takes over from its still.
// 1c. The swap: each tile's still is its clip's first frame (the clip at frame 0 over it differs by under 3 levels in
//    255 on average), at 390@3x and 1440@2x.
// 2. Layout shift under 0.01 at 390 and 1440, through a load and a scroll to the bottom and back.
// 3. Every tile's link answers 200, and the numbers tile opens every studio (the launcher; a phone's sheet).
// 4. Reduced motion and Save-Data: no clip is fetched or played, nothing moves by itself (the headline is still, the
//    split rests at 50 %, the live words stay), and the tiles keep their stills.
// 5. Pause previews stops the catwalk and freezes every animation; pressed again, they go on.
// 6. Weight: what the page downloads before `load` (clips aside), at 390 and 1440, reported; the first screen's own
//    stills stay under 420 KB (the clips' posters are encoded close to their clips' first frames, and a 3x phone or a
//    2x laptop gets the catwalk's 1536 px still). The clips are reported on their own.
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
/** The widest copy of each clip (scripts/gen-home-bento.mjs). */
const CLIP_MAX = 2048;
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
    const [line1, line2] = h1.querySelectorAll(":scope > span");
    // The lines a span's words fall on: its text's boxes, grouped by their top.
    const lines = (el) => {
      const r = document.createRange();
      r.selectNodeContents(el);
      const tops = [];
      for (const b of r.getClientRects()) if (b.width > 0 && !tops.some((t) => Math.abs(t - b.top) < b.height / 2)) tops.push(b.top);
      return tops.length;
    };
    const accent = line2.querySelector("[data-glow]");
    const rise = (el) =>
      el.getAnimations().map((a) => ({ name: a.animationName, state: a.playState, ms: a.effect.getTiming().duration, delay: a.effect.getTiming().delay, from: a.effect.getKeyframes()[0]?.opacity }));
    return {
      h1s: document.querySelectorAll("h1").length,
      text: h1.textContent.replace(/\s+/g, " ").trim(),
      line1Lines: lines(line1),
      line2Lines: lines(line2),
      line2Italic: getComputedStyle(line2).fontStyle,
      // On a phone the second line breaks before "finished film,": the accent starts its own line, at the left.
      accentStartsLine: Math.abs(accent.getClientRects()[0].left - line2.getBoundingClientRect().left) < 2,
      rise: { line1: rise(line1), line2: rise(line2) },
      scroll: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
      vh: innerHeight,
      tiles: Object.fromEntries(tiles.map((t) => [t, box(document.querySelector(`#home-bento [data-tile="${t}"]`))])),
      dark: document.documentElement.classList.contains("dark"),
    };
  }, TILES);

/**
 * Each picture and playing clip on the first screen against what its box needs: the box under object-fit: cover (its
 * width, or its height times the picture's shape when that is more), times the pixel ratio, up to the widest copy the
 * page offers for it.
 */
const sharpness = (page) =>
  page.evaluate((CLIP_MAX) => {
    const dpr = devicePixelRatio;
    // The copies the browser could choose from for an img: its <picture>'s matching source, or its own srcset, each as
    // its URL and its width. (naturalWidth is no help here: under a w-descriptor it is scaled by the pixel ratio.)
    const copies = (img) => {
      const pic = img.closest("picture");
      const srcset = (pic ? [...pic.querySelectorAll("source")].find((s) => !s.media || matchMedia(s.media).matches)?.srcset : undefined) ?? img.srcset ?? "";
      return srcset
        .split(",")
        .map((c) => /^(\S+)\s+(\d+)w$/.exec(c.trim()))
        .filter(Boolean)
        .map((m) => ({ url: new URL(m[1], location.href).href, w: Number(m[2]) }));
    };
    const out = [];
    for (const img of document.querySelectorAll("#home-bento [data-tile] img")) {
      const r = img.getBoundingClientRect();
      if (!img.complete || !img.naturalWidth || r.width < 2) continue;
      const list = copies(img);
      const chosen = list.find((c) => c.url === img.currentSrc);
      const has = chosen?.w ?? img.naturalWidth;
      const ratio = img.naturalWidth / img.naturalHeight;
      const need = Math.ceil(Math.max(r.width, r.height * ratio) * dpr);
      const max = list.length ? Math.max(...list.map((c) => c.w)) : has;
      const what = new URL(img.currentSrc || img.src).pathname.split("/").pop();
      out.push({ what, tile: img.closest("[data-tile]").dataset.tile, has, need, max, ok: has >= Math.min(need, max) * 0.98 });
    }
    for (const v of document.querySelectorAll("#home-bento [data-tile] video")) {
      if (!v.videoWidth) continue;
      const r = v.getBoundingClientRect();
      const need = Math.ceil(Math.max(r.width, (r.height * v.videoWidth) / v.videoHeight) * dpr);
      const what = new URL(v.currentSrc).pathname.split("/").pop();
      out.push({ what, tile: v.closest("[data-tile]").dataset.tile, has: v.videoWidth, need, max: CLIP_MAX, ok: v.videoWidth >= Math.min(need, CLIP_MAX) * 0.98 });
    }
    return out;
  }, CLIP_MAX);

// ------------------------------------------------------------------------------------------- 1. every width
const shots = [];
const sharpNotes = [];
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
        check(`${tag}: "Make anything:" on one line, the second line in italic`, l.line1Lines === 1 && l.line2Italic === "italic", String(l.line1Lines));
        if (v.w >= 768) check(`${tag}: the second line whole`, l.line2Lines === 1, String(l.line2Lines));
        else check(`${tag}: the second line on two, the second starting at "finished film,"`, l.line2Lines === 2 && l.accentStartsLine, `${l.line2Lines} ${l.accentStartsLine}`);
        const [r1, r2] = [l.rise.line1[0], l.rise.line2[0]];
        check(
          `${tag}: the headline rose once, from 40 % (its words on the first paint)`,
          r1?.name === "hb-rise" && r1.ms === 700 && r2?.ms === 900 && r2.delay === 120 && [r1, r2].every((r) => r.state === "finished" && Number(r.from) === 0.4),
          JSON.stringify(l.rise),
        );
        if (v.phone) {
          const bottom = l.vh - 64;
          const first = ["video", "image", "threeD"];
          const out = first.filter((t) => l.tiles[t].top < 0 || l.tiles[t].bottom > bottom);
          check(`${tag}: the video tile and the two under it on the first screen`, out.length === 0, first.map((t) => `${t} ${Math.round(l.tiles[t].bottom)}`).join(", ") + ` ≤ ${bottom}`);
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

/**
 * Watches the first screen from the first paint: every play sign seen on a tile that plays by itself (the video and 3D
 * tiles), when each clip first showed, and every layout shift, with its time.
 */
const watchSwap = () => {
  window.__signs = [];
  window.__shown = {};
  window.__shifts2 = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (!e.hadRecentInput) window.__shifts2.push({ v: e.value, at: Math.round(e.startTime) });
  }).observe({ type: "layout-shift", buffered: true });
  const look = () => {
    for (const t of ["video", "threeD"]) {
      const tile = document.querySelector(`#home-bento [data-tile=${t}]`);
      if (!tile) continue;
      for (const el of tile.querySelectorAll("svg.lucide-play, [class*=play-glyph]")) {
        const st = getComputedStyle(el);
        if (el.getBoundingClientRect().width > 0 && st.visibility !== "hidden" && Number(st.opacity) > 0) window.__signs.push({ t, at: Math.round(performance.now()) });
      }
      if (!window.__shown[t] && tile.querySelector("video[data-ready]")) window.__shown[t] = Math.round(performance.now());
    }
    if (performance.now() < 15_000 && !(window.__shown.video && window.__shown.threeD)) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
};

// ------------------------------------------------------------------------------------------- 1b. sharp at every ratio
if (!weightOnly)
  for (const v of WIDTHS)
    for (const dpr of [1, 2, 3]) {
      const ctx = await browser.newContext({ ...(v.phone ? PHONE : {}), viewport: { width: v.w, height: v.h }, deviceScaleFactor: dpr });
      const page = await ctx.newPage();
      await page.addInitScript(watchSwap);
      await open(page);
      // The clips start once their tile's still is up and on screen: wait until each has its first frame.
      await page
        .waitForFunction(() => [...document.querySelectorAll("#home-bento [data-tile] video")].filter((x) => x.videoWidth > 0).length >= 2, null, { timeout: 12_000 })
        .catch(() => {});
      await page.waitForTimeout(300);
      const s = await sharpness(page);
      const bad = s.filter((x) => !x.ok);
      const clips = s.filter((x) => x.what.endsWith(".mp4"));
      check(
        `sharp at ${v.w}@${dpr}x: ${s.length} pictures and clips at least their box x ratio`,
        bad.length === 0 && clips.length === 2,
        (bad.length ? bad : clips).map((x) => `${x.tile} ${x.what} ${x.has} for ${x.need} (max ${x.max})`).join("; "),
      );
      sharpNotes.push(`${v.w}@${dpr}x: ${s.map((x) => `${x.tile} ${x.what} ${x.has}/${x.need}`).join(", ")}`);
      const w = await page.evaluate(() => ({ signs: window.__signs, shown: window.__shown, shifts: window.__shifts2, load: Math.round(performance.getEntriesByType("navigation")[0]?.loadEventEnd ?? 0) }));
      check(`no play sign at ${v.w}@${dpr}x on the tiles that play by themselves`, w.signs.length === 0, JSON.stringify(w.signs.slice(0, 3)));
      // Nothing shifts as a clip takes over from its still (from 100 ms before it shows to 600 ms after).
      const atSwap = w.shifts.filter((x) => Object.values(w.shown).some((t) => x.at >= t - 100 && x.at <= t + 600));
      check(`no layout shift at the swap at ${v.w}@${dpr}x`, atSwap.length === 0 && Object.keys(w.shown).length === 2, `${JSON.stringify(w.shown)} load ${w.load}; ${JSON.stringify(atSwap)}`);
      if (dpr === 2 || (v.phone && dpr === 3)) notes.push(`clips shown at ${v.w}@${dpr}x: video ${w.shown.video} ms, 3D ${w.shown.threeD} ms (load ${w.load} ms)`);
      await ctx.close();
    }

// ------------------------------------------------------------------------------------------- 1c. the swap
/** How far the clip at frame 0 is from the still under it: the tile's clip area shot with the clip shown and hidden. */
async function swapDiff(page, tile) {
  const clip = page.locator(`#home-bento [data-tile=${tile}] .hb-clip`);
  await page.evaluate(async (tile) => {
    const v = document.querySelector(`#home-bento [data-tile=${tile}] video`);
    v.pause();
    v.currentTime = 0;
    await new Promise((r) => (v.seeking ? v.addEventListener("seeked", r, { once: true }) : r()));
    // Then two frames of the page, so the seeked frame is on screen (a paused clip presents no further frames).
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 100))));
    // The line along the bottom follows the clip: out of both shots.
    for (const el of document.querySelectorAll(`#home-bento [data-tile=${tile}] .hb-progress`)) el.style.visibility = "hidden";
  }, tile);
  const withClip = await clip.screenshot({ animations: "disabled" });
  await page.evaluate((tile) => (document.querySelector(`#home-bento [data-tile=${tile}] video`).style.visibility = "hidden"), tile);
  const still = await clip.screenshot({ animations: "disabled" });
  const sharp = createRequire(path.join(root, "package.json"))("sharp");
  const [a, b] = await Promise.all([withClip, still].map((x) => sharp(x).removeAlpha().raw().toBuffer()));
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return { diff: sum / a.length, withClip, still };
}
if (!weightOnly)
  for (const [v, dpr] of [
    [WIDTHS[0], 3],
    [WIDTHS[4], 2],
  ]) {
    const ctx = await browser.newContext({ ...(v.phone ? PHONE : {}), viewport: { width: v.w, height: v.h }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    await open(page);
    await page.waitForFunction(() => document.querySelectorAll("#home-bento [data-tile] video[data-ready]").length >= 2, null, { timeout: 12_000 }).catch(() => {});
    for (const tile of ["video", "threeD"]) {
      if (!(await page.locator(`#home-bento [data-tile=${tile}] video[data-ready]`).count())) {
        check(`the swap at ${v.w}@${dpr}x, ${tile}: its clip plays`, false);
        continue;
      }
      const src = await page.evaluate((tile) => new URL(document.querySelector(`#home-bento [data-tile=${tile}] video`).currentSrc).pathname.split("/").pop(), tile);
      const r = await swapDiff(page, tile);
      check(`the swap at ${v.w}@${dpr}x, ${tile}: the still is ${src}'s first frame`, r.diff < 3, `mean difference ${r.diff.toFixed(2)} of 255`);
      if (shotsDir) {
        fs.writeFileSync(path.join(shotsDir, `swap-${tile}-${v.w}@${dpr}x-clip.png`), r.withClip);
        fs.writeFileSync(path.join(shotsDir, `swap-${tile}-${v.w}@${dpr}x-still.png`), r.still);
      }
    }
    await ctx.close();
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
    headline: document.querySelector("#home-bento h1").parentElement.getAnimations({ subtree: true }).length,
  }));
  check("reduced motion: nothing moves by itself", state.play === null && state.videos === 0 && clips.length === 0 && state.headline === 0, JSON.stringify({ ...state, clips: clips.length }));
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
  check("the catwalk plays by itself", !!before && !before.paused, JSON.stringify(before));
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
  // The clips come once their stills are up: every byte of a video response, counted as it arrives (a clip may come in ranges).
  const clips = new Map();
  cdp.on("Network.responseReceived", (e) => reqs.set(e.requestId, { url: e.response.url, type: e.type, mime: e.response.mimeType, bytes: 0, done: false }));
  cdp.on("Network.dataReceived", (e) => {
    const r = reqs.get(e.requestId);
    if (r?.mime.startsWith("video/")) clips.set(r.url, (clips.get(r.url) ?? 0) + e.encodedDataLength);
  });
  cdp.on("Network.loadingFinished", (e) => {
    const r = reqs.get(e.requestId);
    if (r && !loaded) Object.assign(r, { bytes: e.encodedDataLength, done: true });
  });
  await page.goto(app + "/", { waitUntil: "load", timeout: 90_000 });
  loaded = true;
  await page.waitForTimeout(300);
  // The first screen's own pictures: the tiles' stills (anything else is the page's, below it).
  const ownUrls = new Set(await page.evaluate(() => [...document.querySelectorAll("#home-bento img")].map((i) => new URL(i.currentSrc || i.src, location.href).pathname)));
  // Then the clips, until both tiles have theirs whole (or 15 s).
  await page
    .waitForFunction(
      () => {
        const v = [...document.querySelectorAll("#home-bento [data-tile] video")];
        return v.length >= 2 && v.every((x) => x.readyState >= 4 && x.buffered.length > 0 && x.buffered.end(0) >= x.duration - 0.05);
      },
      null,
      { timeout: 15_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(500);
  const by = {};
  let total = 0;
  let own = 0;
  const media = [];
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
  const clipBytes = [...clips.values()].reduce((a, b) => a + b, 0);
  const clipLine = [...clips].map(([u, n]) => `${new URL(u).pathname.split("/").pop()} ${kb(n)}`).join(" · ");
  return {
    total,
    own,
    clipBytes,
    line: `${v.w}@${viewportOpts(v).deviceScaleFactor}x: ${kb(total)} (${Object.entries(by).map(([k, n]) => `${k} ${kb(n)}`).join(", ")}); the first screen's own stills ${kb(own)}; clips ${kb(clipBytes)} (${clipLine || "none"})`,
    media,
  };
}
for (const v of [WIDTHS[0], WIDTHS[3], WIDTHS[4], WIDTHS[5]]) {
  const r = await weight(v);
  // The whole page's total is reported (main's own script and fonts are most of it: compare with --weight-only on
  // main's build); the first screen's own stills have a budget of their own.
  check(`weight before load, clips aside: ${r.line}`, weightOnly || r.own < 420 * 1024);
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

console.log("\n" + [...notes, ...sharpNotes.map((n) => `sharp ${n}`)].join("\n"));
if (failures.length) {
  console.log(`\n${failures.length} failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nall passed");
