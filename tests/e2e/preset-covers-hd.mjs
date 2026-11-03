// Preset covers' larger copies in a real browser (scripts/gen-preset-hd.mjs, src/lib/preset-hd.ts). Run it on a
// production server (`next build`, then `next start -p <port>`).
//
// Usage: node tests/e2e/preset-covers-hd.mjs [appUrl] [--pages /,/apps,...] [--presets id,id,...]
//   Default pages: Home, the hubs, Marketing, and the own page of each preset in --presets (or a few with copies).
//
// At 390x844 @3x and 1440x900 @2x, on each page, after a scroll to the end and back:
// 1. Sharp: every preset cover's still the browser loaded (a <picture> or an img with a srcset under
//    /previews/presets/ or an example's resting frame) is at least as wide as its box shows it (object-fit: cover,
//    times the pixel ratio), up to the widest copy offered; each clip that plays is as wide as its box needs, up to
//    1024 px (or its still's widest copy, when that is less).
// 2. The swap: each clip, at the moment it shows (its first frame, or the frame its card rests on once seeked there),
//    differs from its card's still by under SWAP_MAX levels in 255 on average (64x48 grey copies, each from its mean).
// 3. Layout shift from cover media (a moved node that is or holds a cover's still or clip) under 0.01 through the
//    load and the scroll; the whole page's shift is reported.
// 4. Weight: the bytes of cover media fetched (stills and clips), reported per page.
import { launch, PHONE } from "./_browser.mjs";

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const app = (args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) ?? "http://localhost:3890").replace(/\/$/, "");
const presets = (opt("--presets") ?? "motion-dolly-in,app-truck-ad,effect-wind-to-face").split(",").filter(Boolean);
const own = presets.map((id) => (id.startsWith("app-") ? `/apps/${id}` : `/video?preset=${id}`));
const pages = opt("--pages")?.split(",") ?? ["/", "/studios", "/apps", "/ads", "/marketing", "/effects", "/motions", "/motions-and-effects", "/create", ...own];
const SWAP_MAX = 8;
const VIEWS = [
  { name: "390@3x", ctx: { ...PHONE, deviceScaleFactor: 3 } },
  { name: "1440@2x", ctx: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 } },
];

const failures = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures.push(`${name} ${detail}`);
};

/** Installed before the page loads: layout shift, and each cover clip's first shown frame against its card's still. */
function watch() {
  // The page's whole shift (reported), and the shift of cover media: a shift whose moved nodes are a cover's still or
  // clip, or hold one (a card that grows as its picture loads).
  window.__cls = 0;
  window.__coverCls = 0;
  const COVER = /\/(previews\/presets|examples\/[^/]+\/\d+\/out-peak)/;
  const isCover = (n) => {
    if (!(n instanceof Element)) return false;
    const media = n.matches("img,video") ? [n] : [...n.querySelectorAll("img,video")];
    return media.length > 0 && media.length <= 2 && media.some((m) => COVER.test(m.currentSrc || m.src || ""));
  };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.hadRecentInput) continue;
        window.__cls += e.value;
        if ((e.sources ?? []).some((s) => isCover(s.node))) window.__coverCls += e.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
  window.__swaps = [];
  const grey = (src, w = 64, h = 48) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    // The still or clip as the card shows it: covering a 4:3 box.
    const sw = src.videoWidth || src.naturalWidth;
    const sh = src.videoHeight || src.naturalHeight;
    const s = Math.max(w / sw, h / sh);
    g.drawImage(src, (w - sw * s) / 2, (h - sh * s) / 2, sw * s, sh * s);
    const d = g.getImageData(0, 0, w, h).data;
    const out = new Float32Array(w * h);
    for (let i = 0; i < out.length; i++) out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    const m = out.reduce((a, v) => a + v, 0) / out.length;
    return out.map((v) => v - m);
  };
  const shown = (v) => {
    if (v.__seen || !v.videoWidth) return;
    const img = v.parentElement?.querySelector("img");
    if (!img?.complete || !img.naturalWidth || !/\/(previews\/presets|examples)\//.test(img.currentSrc)) return;
    v.__seen = true;
    try {
      const a = grey(v);
      const b = grey(img);
      let sum = 0;
      for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
      window.__swaps.push({ clip: v.currentSrc.replace(location.origin, ""), still: img.currentSrc.replace(location.origin, ""), t: v.currentTime, d: sum / a.length });
    } catch {}
  };
  // A clip without a frame to rest on shows once its first frame is there; one with a frame, once it has seeked to it.
  document.addEventListener("loadeddata", (e) => e.target instanceof HTMLVideoElement && e.target.currentTime === 0 && !e.target.onseeked && shown(e.target), true);
  document.addEventListener("seeked", (e) => e.target instanceof HTMLVideoElement && shown(e.target), true);
}

/** Every loaded preset cover still and playing cover clip, against what its box needs. */
const sharpness = (page) =>
  page.evaluate(() => {
    const dpr = devicePixelRatio;
    const COVER = /\/(previews\/presets|examples\/[^/]+\/\d+\/out-peak)/;
    const copies = (img) => {
      const pic = img.closest("picture");
      const srcset = pic?.querySelector("source")?.srcset ?? "";
      const own = img.srcset || "";
      return [...srcset.split(","), ...own.split(",")]
        .map((c) => /^(\S+)\s+(\d+)w$/.exec(c.trim()))
        .filter(Boolean)
        .map((m) => ({ url: new URL(m[1], location.href).href, w: Number(m[2]) }));
    };
    const out = [];
    for (const img of document.querySelectorAll("img")) {
      const r = img.getBoundingClientRect();
      if (!img.complete || !img.naturalWidth || r.width < 2 || !COVER.test(img.currentSrc)) continue;
      if (!img.srcset && !img.closest("picture")) continue;
      // A menu's row or a picker's small tile is not a cover box this checks.
      if (r.width < 60) continue;
      const list = copies(img);
      const chosen = list.find((c) => c.url === img.currentSrc);
      const has = chosen?.w ?? img.naturalWidth;
      const ratio = img.naturalWidth / img.naturalHeight;
      const need = Math.ceil(Math.max(r.width, r.height * ratio) * dpr);
      const max = list.length ? Math.max(...list.map((c) => c.w)) : has;
      out.push({ kind: "still", what: new URL(img.currentSrc).pathname, box: [Math.round(r.width), Math.round(r.height)], has, need, max, ok: has >= Math.min(need, max) * 0.98 });
    }
    for (const v of document.querySelectorAll("video")) {
      if (!v.videoWidth || !/\/previews\/presets\//.test(v.currentSrc)) continue;
      const r = v.getBoundingClientRect();
      if (r.width < 60) continue;
      const img = v.parentElement?.querySelector("img");
      const offered = img ? copies(img).map((c) => c.w) : [];
      const max = Math.min(1024, offered.length ? Math.max(...offered) : 512);
      const need = Math.ceil(Math.max(r.width, (r.height * v.videoWidth) / v.videoHeight) * dpr);
      out.push({ kind: "clip", what: new URL(v.currentSrc).pathname, box: [Math.round(r.width), Math.round(r.height)], has: v.videoWidth, need, max, ok: v.videoWidth >= Math.min(need, max) * 0.98 });
    }
    return out;
  });

const browser = await launch();
for (const view of VIEWS) {
  for (const url of pages) {
    const ctx = await browser.newContext(view.ctx);
    await ctx.addInitScript(watch);
    let bytes = 0;
    ctx.on("response", async (res) => {
      if (!/\/(previews\/presets|examples)\//.test(res.url())) return;
      const len = Number(res.headers()["content-length"] ?? 0);
      bytes += len;
    });
    const page = await ctx.newPage();
    const tag = `${view.name} ${url}`;
    try {
      await page.goto(app + url, { waitUntil: "load", timeout: 90_000 });
      await page.waitForTimeout(2500);
      const seen = new Map();
      const take = async () => {
        for (const row of await sharpness(page)) seen.set(`${row.kind} ${row.what} ${row.box}`, row);
      };
      await take();
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      for (let y = 0; y < height; y += 700) {
        await page.evaluate((top) => window.scrollTo(0, top), y);
        await page.waitForTimeout(450);
        await take();
      }
      await page.waitForTimeout(1500);
      await take();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(600);
      const rows = [...seen.values()];
      const bad = rows.filter((r) => !r.ok);
      check(`${tag}: ${rows.length} cover stills and clips at least as wide as their boxes need`, bad.length === 0, bad.slice(0, 4).map((r) => `${r.kind} ${r.what} ${r.box} has ${r.has} needs ${r.need} (max ${r.max})`).join("; "));
      const swaps = await page.evaluate(() => window.__swaps);
      const jumps = swaps.filter((s) => s.d > SWAP_MAX);
      check(`${tag}: ${swaps.length} clips start on their card's still`, jumps.length === 0, jumps.slice(0, 3).map((s) => `${s.clip} over ${s.still} at ${s.t.toFixed(2)} s differs ${s.d.toFixed(1)}`).join("; "));
      const [cls, coverCls] = await page.evaluate(() => [window.__cls, window.__coverCls]);
      check(`${tag}: cover stills and clips shift nothing (under 0.01)`, coverCls < 0.01, `covers ${coverCls.toFixed(4)}, whole page ${cls.toFixed(4)}`);
      console.log(`     ${tag}: cover media fetched ${(bytes / 1024).toFixed(0)} KB`);
    } catch (e) {
      check(`${tag}: opens`, false, String(e).split("\n")[0]);
    }
    await ctx.close();
  }
}
await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nall passed");
