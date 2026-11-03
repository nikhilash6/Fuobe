// The top bar's six menus (Create, Studios, Apps, Motions & effects, Canvas, More) as a person uses them, in a real
// browser: resting on an item opens its menu, moving along the bar switches at once and the menu stays, a glide across
// the bar opens nothing, a diagonal into an open menu keeps it, clicks and taps toggle, the keys work, nothing is cut
// off at small windows, reduced motion lands at once, and a guest never sees owner-only rows. Each check names the
// complaint it guards: A "sometimes it shows the full menu, sometimes I have to press", B "sometimes nothing happens
// when I hover", C "the item with an arrow looks confusing".
// Usage: node tests/e2e/bar-menus.mjs [appUrl]
//   Run it against a production build (next start). E2E_OWNER_PASSWORD: the studio's password, for the owner's checks.
//   Exits 1 if any check fails. Timings allow ±40 ms (headless Chromium's frames).
import { launch, openRoute } from "./_browser.mjs";

const app = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const failures = [];
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${what}${!ok && detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(what);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SLACK = 40;
const OWNER_WORDS = ["No cover yet", "Fuobe DoP", "free on your GPU", "Qwen", "Wan 2", "LTX", "Kling", "ComfyUI", "New board"];
const HUBS = { create: "/create", studios: "/studios", apps: "/apps", motions: "/motions-and-effects", canvas: "/canvas" };

/** In the page: every frame, which menus are open (interactive) and painted, and the dimmed page's opacity. */
const SAMPLER = () => {
  const rec = { frames: [], arrive: {}, lastMove: 0 };
  window.__bm = rec;
  const state = () => {
    const open = [];
    const painted = [];
    for (const s of document.querySelectorAll("[data-mega-panel], [data-bar-card]")) {
      const id = s.dataset.megaPanel || s.dataset.barCard;
      if (s.dataset.phase === "open") open.push(id);
      if (s.dataset.phase && s.dataset.phase !== "gone") painted.push(id);
    }
    const sc = document.querySelector("[data-bar-scrim]");
    const skel = [...document.querySelectorAll("[data-mega-panel][data-phase=open] [data-mega-skeleton]")].some((e) => e.checkVisibility() && Number(getComputedStyle(e).opacity) > 0.05);
    return { open, painted, scrim: sc ? Number(getComputedStyle(sc).opacity) : 0, skel };
  };
  window.__bmState = state;
  const tick = () => {
    rec.frames.push({ t: performance.now(), ...state() });
    if (rec.frames.length > 6000) rec.frames.splice(0, 2000);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  document.addEventListener(
    "pointerover",
    (e) => {
      const b = e.target.closest?.("[data-bar-menu]");
      if (b) rec.arrive[b.dataset.barMenu] ??= performance.now();
    },
    true,
  );
  document.addEventListener("pointermove", () => (rec.lastMove = performance.now()), true);
  window.__bmMark = () => {
    rec.frames = [];
    rec.arrive = {};
    return performance.now();
  };
};

const browser = await launch();

async function context(opts = {}, who = "guest") {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...opts });
  if (who === "owner") await ctx.request.post(`${app}/api/auth/login`, { data: { password: process.env.E2E_OWNER_PASSWORD } });
  return ctx;
}
async function open(ctx, path = "/library", settle = 1600) {
  const p = await ctx.newPage();
  await p.addInitScript(SAMPLER);
  await openRoute(p, app + path, { settleMs: settle });
  return p;
}
const mark = (p) => p.evaluate(() => window.__bmMark());
const frames = (p) => p.evaluate(() => window.__bm.frames);
const arrive = (p) => p.evaluate(() => window.__bm.arrive);
const now = (p) => p.evaluate(() => window.__bmState());
const pageNow = (p) => p.evaluate(() => performance.now());
async function rect(p, sel) {
  return p.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].find((e) => e.checkVisibility());
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height };
  }, sel);
}
const item = (p, id) => rect(p, `[data-bar-menu="${id}"]`);
const visibleItems = (p) => p.evaluate(() => [...document.querySelectorAll("[data-top-bar] [data-bar-menu]")].filter((e) => e.checkVisibility()).map((e) => e.dataset.barMenu));

let cursor = { x: 700, y: 600 };
/**
 * Moves the mouse in a straight line at `speed` px/s (Infinity: one jump), about one move per frame. Where the pointer
 * is follows the clock, so the speed holds even when a move takes the browser a while to deliver.
 */
async function glide(p, to, speed = 800) {
  const from = { ...cursor };
  const d = Math.hypot(to.x - from.x, to.y - from.y);
  if (speed === Infinity || d < 1) {
    await p.mouse.move(to.x, to.y);
  } else {
    const start = performance.now();
    for (;;) {
      const k = Math.min(1, ((performance.now() - start) / 1000) * (speed / d));
      await p.mouse.move(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k);
      if (k >= 1) break;
      await sleep(14);
    }
  }
  cursor = { ...to };
}
/** The pointer off to the page's bottom corner, and nothing open (Esc for a pinned menu), past the switch window. */
async function away(p) {
  const vp = p.viewportSize();
  await glide(p, { x: vp.width - 40, y: vp.height - 1 }, Infinity);
  await sleep(450);
  if ((await now(p)).open.length) await p.keyboard.press("Escape");
  await sleep(450);
}
/** The first frame at or after `t0` where `pred` holds (ms after t0), or null. */
const firstAt = (fs, t0, pred) => {
  const f = fs.find((x) => x.t >= t0 && pred(x));
  return f ? f.t - t0 : null;
};

try {
  // ---------- 1. Semantics (C) ----------
  {
    const ctx = await context();
    const p = await open(ctx);
    const r = await p.evaluate(() => {
      const nav = document.querySelector('[data-top-bar] nav[aria-label="Main"]');
      const out = [];
      for (const b of nav.querySelectorAll("[data-bar-menu]")) {
        if (!b.checkVisibility()) continue;
        const text = b.innerText.trim().split(/\s+/)[0];
        const name = b.getAttribute("aria-label") ?? b.innerText.trim();
        const chev = b.querySelector("[data-bar-chevron]");
        const cr = chev.getBoundingClientRect();
        const hit = document.elementFromPoint(cr.x + cr.width / 2, cr.y + cr.height / 2);
        out.push({
          id: b.dataset.barMenu,
          tag: b.tagName,
          expanded: b.getAttribute("aria-expanded"),
          controls: !!document.getElementById(b.getAttribute("aria-controls") ?? "-"),
          named: name.includes(text),
          inner: b.querySelectorAll("a, button, input, [tabindex]").length,
          // Anything else to press that overlaps the item (the old split pill had a link and a chevron button).
          siblingsFocusable: [...nav.querySelectorAll("a[href], button")].filter((s) => {
            if (s === b || b.contains(s) || !s.checkVisibility()) return false;
            const o = s.getBoundingClientRect();
            const r = b.getBoundingClientRect();
            return o.left < r.right - 1 && o.right > r.left + 1 && o.top < r.bottom - 1 && o.bottom > r.top + 1;
          }).length,
          chevHidden: chev.getAttribute("aria-hidden") === "true",
          chevHit: b.contains(hit),
        });
      }
      return { items: out, roles: nav.querySelectorAll('[role="menu"], [role="menuitem"], [aria-haspopup="menu"]').length };
    });
    check(r.items.length === 5, "1 (C): 1440 shows five menu items (Create, Studios, Apps, Motions & effects, Canvas)", r.items.map((i) => i.id).join());
    for (const i of r.items) {
      check(i.tag === "BUTTON" && i.expanded === "false" && i.controls, `1 (C): ${i.id} is one button with aria-expanded and aria-controls`, JSON.stringify(i));
      check(i.named && i.inner === 0 && i.siblingsFocusable === 0, `1 (C): ${i.id} is named by its words, with nothing else to press inside or beside it`, JSON.stringify(i));
      check(i.chevHidden && i.chevHit, `1 (C): ${i.id}'s chevron is decoration (aria-hidden, the button takes a press on it)`);
    }
    check(r.roles === 0, "1 (C): no menu roles in the bar (a disclosure of links)");
    // The open highlight: one filled box, the size of the open item.
    await p.locator('[data-bar-menu="apps"]').click();
    await sleep(400);
    const ind = await p.evaluate(() => {
      const i = document.querySelector("[data-bar-indicator]").getBoundingClientRect();
      const b = document.querySelector('[data-bar-menu="apps"]').getBoundingClientRect();
      return { d: Math.max(Math.abs(i.left - b.left), Math.abs(i.top - b.top), Math.abs(i.width - b.width), Math.abs(i.height - b.height)), on: document.querySelector("[data-bar-indicator]").hasAttribute("data-on") };
    });
    check(ind.on && ind.d <= 1, "1 (C): an open item has the one highlight behind it, the item's own size", JSON.stringify(ind));
    await ctx.close();
  }

  // ---------- 2. Rest opens, every item, on its own page too (A, B) ----------
  for (const size of [
    { width: 1440, height: 900 },
    { width: 1280, height: 720 },
  ]) {
    const ctx = await context({ viewport: size });
    for (const path of ["/library", ...Object.values(HUBS)]) {
      if (size.width < 1440 && path !== "/library") continue;
      const p = await open(ctx, path);
      cursor = { x: size.width / 2, y: size.height - 10 };
      const ids = await visibleItems(p);
      const only = path === "/library" ? ids : ids.filter((id) => HUBS[id] === path);
      for (const id of only) {
        await away(p);
        const at = await item(p, id);
        await mark(p);
        await glide(p, { x: at.x, y: at.y }, Infinity);
        await sleep(450);
        const fs = await frames(p);
        const a = (await arrive(p))[id];
        const t = a == null ? null : firstAt(fs, a, (f) => f.open.includes(id));
        check(t !== null && t >= 100 - SLACK && t <= 180 + SLACK, `2 (A,B): ${size.width} ${path}: resting on ${id} opens it at ~120 ms`, `${t?.toFixed(0)} ms`);
      }
      await p.close();
    }
    await ctx.close();
  }

  // ---------- 3. Switch and stay; 17. the scrim never drops during a switch (A) ----------
  for (const [size, pairsOf] of [
    [{ width: 1440, height: 900 }, ["create", "studios", "apps", "motions", "canvas"]],
    [{ width: 1280, height: 720 }, ["create", "studios", "motions", "more"]],
  ]) {
    const ctx = await context({ viewport: size });
    const p = await open(ctx);
    for (const how of ["hover", "click"]) {
      for (const a of pairsOf) {
        for (const b of pairsOf) {
          if (a === b) continue;
          if (size.width === 1280 && how === "click" && !["motions", "more"].includes(a)) continue;
          await away(p);
          const ra = await item(p, a);
          const rb = await item(p, b);
          await glide(p, { x: ra.x, y: ra.y }, Infinity);
          if (how === "click") await p.mouse.click(ra.x, ra.y);
          await p.waitForFunction((id) => window.__bmState().open.includes(id), a, { timeout: 2000 }).catch(() => {});
          await sleep(250);
          const t0 = await mark(p);
          await glide(p, { x: rb.x, y: rb.y }, 900);
          await sleep(2000);
          const fs = await frames(p);
          const arr = (await arrive(p))[b];
          const t = arr == null ? null : firstAt(fs, arr, (f) => f.open.includes(b));
          const tail = fs.at(-1);
          const none = fs.filter((f) => f.t >= t0 && f.open.length === 0).length;
          const two = fs.filter((f) => f.open.length > 1).length;
          const scrimDrop = Math.max(0, ...fs.map((f, i) => (i ? fs[i - 1].scrim - f.scrim : 0)));
          const label = `3 (A): ${size.width} ${how}-opened ${a} → ${b}`;
          check(t !== null && t <= 50 + SLACK, `${label}: switches at once`, `${t?.toFixed(0)} ms`);
          check(tail.open.length === 1 && tail.open[0] === b, `${label}: still open 2 s later`, tail.open.join());
          check(none === 0 && two === 0, `${label}: never a frame with none or two open`, `none ${none}, two ${two}`);
          check(scrimDrop < 0.02, `17: ${size.width} ${a} → ${b}: the dimmed page never fades during the switch`, scrimDrop.toFixed(3));
        }
      }
    }
    await ctx.close();
  }

  // ---------- 4. Run along the bar (A) ----------
  {
    const ctx = await context();
    const p = await open(ctx);
    await away(p);
    const seq = ["studios", "apps", "motions", "canvas"];
    const st = await item(p, "studios");
    await glide(p, { x: st.x, y: st.y }, Infinity);
    await p.waitForFunction(() => window.__bmState().open.includes("studios"), null, { timeout: 2000 });
    const t0 = await mark(p);
    for (const id of seq.slice(1)) {
      await sleep(150);
      const r = await item(p, id);
      await glide(p, { x: r.x, y: r.y }, 1500);
    }
    await sleep(2000);
    const fs = await frames(p);
    const a = await arrive(p);
    const late = seq.slice(1).map((id) => (a[id] == null ? 999 : firstAt(fs, a[id], (f) => f.open.includes(id)) ?? 999));
    check(late.every((t) => t <= 50 + SLACK), "4 (A): 150 ms on each of Studios, Apps, Motions & effects, Canvas: each opens on arrival", late.map((t) => t.toFixed(0)).join());
    check(fs.at(-1).open.join() === "canvas" && !fs.some((f) => f.t >= t0 && !f.open.length), "4 (A): the last stays open, never a frame with none");
    await ctx.close();
  }

  // ---------- 5. Glide with nothing open; 6. glide away with a menu open ----------
  {
    const ctx = await context();
    const p = await open(ctx);
    const wm = await rect(p, '[data-top-bar] a[aria-label="Fuobe home"]');
    const search = await rect(p, "[data-top-bar] button[aria-keyshortcuts]");
    for (const [speed, most] of [
      [1500, 0],
      [600, 0],
      [300, 1],
    ]) {
      await away(p);
      await glide(p, { x: wm.x, y: wm.y }, Infinity);
      await sleep(300);
      await mark(p);
      await glide(p, { x: search.x, y: search.y }, speed);
      await sleep(250);
      const fs = await frames(p);
      // Menus opened from nothing (once one is open, the next items switch to theirs: that is a menubar).
      const opens = fs.filter((f, i) => i && f.open.length && !fs[i - 1].open.length).length;
      check(opens <= most, `5: a glide from the wordmark to search at ${speed} px/s opens ${most ? "at most one menu" : "nothing"}`, `${opens}: ${[...new Set(fs.flatMap((f) => f.open))].join()}`);
    }
    // 6. With Studios open, away along the bar to search: one close, the dimmed page fades once.
    await away(p);
    const st = await item(p, "studios");
    await glide(p, { x: st.x, y: st.y }, Infinity);
    await p.waitForFunction(() => window.__bmState().open.includes("studios"), null, { timeout: 2000 });
    await mark(p);
    await glide(p, { x: search.x, y: search.y }, 900);
    await sleep(900);
    const fs = await frames(p);
    let closes = 0;
    let fades = 0;
    for (let i = 1; i < fs.length; i++) {
      if (fs[i - 1].open.length && !fs[i].open.length) closes++;
      if (fs[i].scrim < fs[i - 1].scrim - 0.001 && !(fs[i - 1].scrim < fs[i - 2]?.scrim - 0.001)) fades++;
    }
    check(closes === 1 && !fs.at(-1).open.length, "6: gliding away from an open menu closes it exactly once", `closes ${closes}`);
    check(fades <= 1, "6: the dimmed page fades out at most once", `fades ${fades}`);
    await ctx.close();
  }

  // ---------- 7. Leave into the page; re-entering in time keeps it ----------
  {
    const ctx = await context();
    const p = await open(ctx);
    for (const back of [false, true]) {
      await away(p);
      const cr = await item(p, "create");
      await glide(p, { x: cr.x, y: cr.y }, Infinity);
      await p.waitForFunction(() => window.__bmState().open.includes("create"), null, { timeout: 2000 });
      await sleep(200);
      await mark(p);
      await glide(p, { x: 1200, y: 700 }, Infinity);
      const left = await p.evaluate(() => window.__bm.lastMove);
      if (back) {
        await sleep(200);
        await glide(p, { x: cr.x, y: cr.y }, Infinity);
      }
      await sleep(700);
      const fs = await frames(p);
      if (!back) {
        const startClose = firstAt(fs, left, (f) => !f.open.includes("create"));
        const gone = firstAt(fs, left, (f) => !f.painted.includes("create"));
        check(startClose !== null && Math.abs(startClose - 300) <= SLACK && gone !== null && gone <= 460 + SLACK, "7: a menu the pointer opened starts to close 300 ms after the pointer left, gone by 460", `${startClose?.toFixed(0)} / ${gone?.toFixed(0)}`);
      } else check(fs.every((f) => f.open.includes("create")), "7: coming back within 250 ms keeps it open");
    }
    await ctx.close();
  }

  // ---------- 8. Diagonals ----------
  {
    const ctx = await context();
    const p = await open(ctx);
    await away(p);
    const st = await item(p, "studios");
    await glide(p, { x: st.x, y: st.y }, Infinity);
    await p.waitForFunction(() => window.__bmState().open.includes("studios"), null, { timeout: 2000 });
    await mark(p);
    await glide(p, { x: 1330, y: 420 }, 700);
    await sleep(600);
    let fs = await frames(p);
    check(fs.every((f) => f.open.join() === "studios"), "8: Studios → its far-right column: no switch, no close");
    await away(p);
    const cr = await item(p, "create");
    await glide(p, { x: cr.x, y: cr.y }, Infinity);
    await p.waitForFunction(() => window.__bmState().open.includes("create"), null, { timeout: 2000 });
    await sleep(150);
    await mark(p);
    // A shallow line from Create into its right column, across the bottom of the Studios item.
    const right = await rect(p, '[data-bar-card="create"] [data-col="1"][data-row="1"]');
    await glide(p, { x: right.x, y: right.y }, 600);
    await sleep(600);
    fs = await frames(p);
    const crossed = await arrive(p);
    check(fs.every((f) => f.open.join() === "create"), "8: Create → its right column across the Studios item: no switch, no close", `crossed Studios: ${crossed.studios != null}; ${[...new Set(fs.map((f) => f.open.join()))].join(" / ")}`);
    await ctx.close();
  }

  // ---------- 9. Clicks (A) ----------
  {
    const ctx = await context();
    const p = await open(ctx);
    for (const id of ["create", "studios", "apps"]) {
      await away(p);
      const r = await item(p, id);
      await glide(p, { x: r.x, y: r.y }, Infinity);
      await mark(p);
      const t0 = await pageNow(p);
      await p.mouse.click(r.x, r.y);
      await sleep(300);
      let fs = await frames(p);
      const t = firstAt(fs, t0, (f) => f.open.includes(id));
      check(t !== null && t <= 50 + SLACK, `9 (A): a click on ${id} opens it at once`, `${t?.toFixed(0)} ms`);
      check(new URL(p.url()).pathname === "/library", `9 (A): a click on ${id} never leaves the page`);
      await p.mouse.click(r.x, r.y);
      await sleep(250);
      check(!(await now(p)).open.length, `9 (A): a second click on ${id} closes it`);
    }
    for (const delay of [30, 500, 2000]) {
      await away(p);
      const r = await item(p, "studios");
      await glide(p, { x: r.x, y: r.y }, Infinity);
      await p.waitForFunction(() => window.__bmState().open.includes("studios"), null, { timeout: 2000 });
      await sleep(delay);
      await mark(p);
      await p.mouse.click(r.x, r.y);
      await glide(p, { x: 700, y: 895 }, Infinity);
      await sleep(800);
      const fs = await frames(p);
      check(fs.every((f) => f.open.includes("studios")), `9 (A): a click ${delay} ms after a hover open pins it (never closes); leaving keeps it`);
      await p.mouse.click(r.x, r.y);
      await sleep(200);
    }
    // A click during the rest wait opens it, pinned.
    await away(p);
    const ap = await item(p, "apps");
    await glide(p, { x: ap.x, y: ap.y }, Infinity);
    await p.mouse.click(ap.x, ap.y);
    await glide(p, { x: 700, y: 895 }, Infinity);
    await sleep(800);
    check((await now(p)).open.join() === "apps", "9 (A): a click during the rest wait opens it pinned");
    await p.keyboard.press("Escape");
    await sleep(200);
    // Ctrl-click: the area's page in a new tab; the menu state does not change (here: Studios, opened by resting on it).
    await away(p);
    const sr = await item(p, "studios");
    await glide(p, { x: sr.x, y: sr.y }, Infinity);
    await sleep(400);
    const before = (await now(p)).open.join();
    const tab = ctx.waitForEvent("page", { timeout: 5000 }).catch(() => null);
    await p.keyboard.down("Control");
    await p.mouse.click(sr.x, sr.y);
    await p.keyboard.up("Control");
    const np = await tab;
    if (np) await np.waitForLoadState("domcontentloaded").catch(() => {});
    check(!!np && new URL(np.url()).pathname === "/studios", "9: Ctrl-click on an item opens its page in a new tab", np?.url());
    await sleep(300);
    check(before === "studios" && (await now(p)).open.join() === before, "9: Ctrl-click leaves the menus as they were", before);
    await ctx.close();
  }

  // ---------- 10. Touch laptop with a mouse (B) ----------
  {
    const ctx = await context({ hasTouch: true });
    const p = await open(ctx);
    for (const id of await visibleItems(p)) {
      await away(p);
      const r = await item(p, id);
      await glide(p, { x: r.x, y: r.y }, Infinity);
      await sleep(400);
      check((await now(p)).open.includes(id), `10 (B): on a touch laptop, resting the mouse on ${id} opens it`);
    }
    await ctx.close();
  }

  // ---------- 11. Cold load (A) ----------
  for (const id of ["apps", "motions", "canvas"]) {
    const ctx = await context();
    const p = await ctx.newPage();
    await p.addInitScript(SAMPLER);
    await p.goto(`${app}/library`, { waitUntil: "load" });
    await sleep(1500);
    const r = await item(p, id);
    cursor = { x: 700, y: 880 };
    await mark(p);
    await glide(p, { x: r.x, y: r.y }, Infinity);
    await sleep(900);
    const fs = await frames(p);
    const opened = fs.some((f) => f.open.includes(id));
    check(opened && !fs.some((f) => f.skel), `11 (A): cold load, the first hover on ${id} 1.5 s after load shows its links, never a skeleton`);
    await ctx.close();
  }
  {
    const ctx = await context();
    const p = await ctx.newPage();
    await p.addInitScript(SAMPLER);
    await p.goto(`${app}/library`, { waitUntil: "commit" });
    // The first Studios item that shows (while the page streams in, its first paint's copy).
    const btn = p.locator('[data-bar-menu="studios"]:visible').first();
    await btn.waitFor({ state: "visible", timeout: 30_000 });
    const r = await btn.boundingBox();
    await p.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await p.mouse.down();
    await p.mouse.up();
    const ok = await p.waitForFunction(() => window.__bmState?.().open.includes("studios"), null, { timeout: 6000 }).then(
      () => true,
      () => false,
    );
    check(ok, "11 (A): a press on an item right after the first paint opens its menu once the page is ready");
    await ctx.close();
  }

  // ---------- 12. Keyboard; 13. hub pages ----------
  for (const who of ["guest", ...(process.env.E2E_OWNER_PASSWORD ? ["owner"] : [])]) {
    const ctx = await context({}, who);
    const p = await open(ctx, "/library");
    const focused = () => p.evaluate(() => ({ menu: document.activeElement?.dataset?.barMenu, col: document.activeElement?.dataset?.col, row: document.activeElement?.dataset?.row, label: document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent?.trim(), seeAll: document.activeElement?.hasAttribute("data-see-all") }));
    if (who === "guest") {
      await p.locator('[data-bar-menu="studios"]').focus();
      await p.keyboard.press("Enter");
      await sleep(250);
      check((await now(p)).open.join() === "studios" && (await focused()).menu === "studios", "12: Enter opens the panel and focus stays on the item");
      await p.keyboard.press("Tab");
      const f = await focused();
      check(/^See all/.test(f.label ?? ""), "12, 13: the next Tab lands on See all", f.label);
      await p.keyboard.press("Shift+Tab");
      check((await focused()).menu === "studios" && (await now(p)).open.join() === "studios", "12: Shift+Tab from See all goes back to the item, the panel stays open");
      await p.keyboard.press(" ");
      await sleep(250);
      check(!(await now(p)).open.length, "12: Space closes it");
      await p.keyboard.press("ArrowDown");
      await sleep(400);
      const d = await focused();
      check((await now(p)).open.join() === "studios" && d.col === "0" && d.row === "0", "12: ArrowDown opens it and focuses the first lead row", JSON.stringify(d));
      await p.locator('[data-bar-menu="studios"]').focus();
      await p.keyboard.press("ArrowRight");
      await sleep(250);
      check((await focused()).menu === "apps" && (await now(p)).open.join() === "apps", "12: ArrowRight moves to the next item and the open panel follows");
      await p.keyboard.press("ArrowLeft");
      await sleep(250);
      check((await focused()).menu === "studios" && (await now(p)).open.join() === "studios", "12: ArrowLeft moves back");
      await p.keyboard.press("Escape");
      await sleep(250);
      check(!(await now(p)).open.length && (await focused()).menu === "studios", "12: Esc closes and gives focus back to the item");
      // Tab past the last link of Create's card: it closes and focus goes on to the next item.
      await p.locator('[data-bar-menu="create"]').focus();
      await p.keyboard.press("Enter");
      await sleep(250);
      for (let i = 0; i < 20; i++) {
        await p.keyboard.press("Tab");
        if ((await focused()).menu) break;
      }
      await sleep(250);
      check((await focused()).menu === "studios" && !(await now(p)).open.length, "12: Tab past the last link closes the menu and focuses the next item");
      // Esc after a hover open while typing elsewhere leaves focus there.
      await p.evaluate(() => {
        const i = document.createElement("input");
        i.id = "bm-field";
        i.style.cssText = "position:fixed;left:20px;bottom:20px;z-index:100";
        document.body.append(i);
        i.focus();
      });
      cursor = { x: 700, y: 600 };
      const st = await item(p, "studios");
      await glide(p, { x: st.x, y: st.y }, Infinity);
      await sleep(400);
      await p.keyboard.press("Escape");
      await sleep(200);
      check(!(await now(p)).open.length && (await p.evaluate(() => document.activeElement?.id)) === "bm-field", "12: Esc after a hover open while typing closes it and leaves focus in the field");
      await away(p);
      // 13. See all is the first Tab stop in every panel, and marks its own page.
      for (const [id, href] of Object.entries(HUBS)) {
        const q = await open(ctx, href);
        await q.locator(`[data-bar-menu="${id}"]`).focus();
        await q.keyboard.press("Enter");
        await sleep(400);
        await q.keyboard.press("Tab");
        const f = await q.evaluate(() => ({ href: document.activeElement?.getAttribute("href"), cur: document.activeElement?.getAttribute("aria-current"), see: document.activeElement?.hasAttribute("data-see-all") }));
        check(f.href === href && f.see && f.cur === "page", `13: ${id}: See all is the first Tab stop and is marked on ${href}`, JSON.stringify(f));
        await q.close();
      }
    } else {
      await p.locator('[data-bar-menu="canvas"]').focus();
      await p.keyboard.press("ArrowDown");
      await sleep(1500);
      const t = await p.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
      check(/New board/.test(t), "12: owner: ArrowDown on Canvas focuses New board", t.slice(0, 40));
    }
    await ctx.close();
  }

  // ---------- 14. Touch tablet ----------
  {
    const ctx = await context({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: false });
    const p = await open(ctx);
    const coarse = await p.evaluate(() => matchMedia("(pointer: coarse)").matches);
    const ids = await visibleItems(p);
    for (const id of ids) {
      const r = await item(p, id);
      check(!coarse || (r.w >= 44 && r.h >= 44), `14: ${id} is at least 44x44 on a touch screen`, `${r.w}x${r.h}`);
    }
    const a = await item(p, ids[0]);
    const b = await item(p, ids[1]);
    await p.touchscreen.tap(a.x, a.y);
    await sleep(300);
    check((await now(p)).open.join() === ids[0], `14: a tap opens ${ids[0]}`);
    await p.touchscreen.tap(b.x, b.y);
    await sleep(300);
    check((await now(p)).open.join() === ids[1], `14: a tap on ${ids[1]} switches at once`);
    await p.touchscreen.tap(b.x, b.y);
    await sleep(300);
    check(!(await now(p)).open.length, "14: tapping it again closes it");
    await p.touchscreen.tap(a.x, a.y);
    await sleep(300);
    // A tap outside on a link of the page: it only closes the menu.
    const link = await p.evaluate(() => {
      const l = [...document.querySelectorAll("main a[href]")].find((x) => {
        const r = x.getBoundingClientRect();
        return x.checkVisibility() && r.top > 450 && r.bottom < innerHeight - 10 && r.width > 20;
      });
      if (!l) return null;
      const r = l.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2, href: l.getAttribute("href") };
    });
    const at = p.url();
    if (link) {
      await p.touchscreen.tap(link.x, link.y);
      await sleep(900);
      check(!(await now(p)).open.length && p.url() === at, "14: a tap outside closes the menu and does not follow the link under it", `${link.href} → ${p.url()}`);
    } else check(false, "14: a link to tap under the menu", "none found");
    // A tap's own pointer moves never count as hovering: after the tap that closes it, nothing opens again.
    await p.touchscreen.tap(b.x, b.y);
    await sleep(300);
    await p.touchscreen.tap(b.x, b.y);
    await mark(p);
    await sleep(600);
    check(!(await now(p)).open.length && !(await frames(p)).some((f) => f.open.length), "14: no hover opens on a touch tablet (a tap that closes stays closed)");
    await ctx.close();
  }

  // ---------- 15. Fit ----------
  for (const size of [
    { width: 1280, height: 720 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    const ctx = await context({ viewport: size });
    const p = await open(ctx);
    const ids = await visibleItems(p);
    for (const id of ids) {
      await p.locator(`[data-bar-menu="${id}"]`).click();
      await sleep(500);
      const m = await p.evaluate((id) => {
        const s = document.querySelector(`[data-mega-panel="${id}"], [data-bar-card="${id}"]`);
        const box = s.matches("[data-bar-card]") ? s.firstElementChild : s;
        const r = box.getBoundingClientRect();
        const see = s.querySelector("[data-see-all]");
        return { bottom: r.bottom, scroll: box.scrollHeight - box.clientHeight, see: id === "more" || (!!see && see.checkVisibility() && see.getBoundingClientRect().bottom <= innerHeight) };
      }, id);
      check(m.bottom <= size.height + 0.5 && m.scroll <= 1 && m.see, `15: ${size.width}x${size.height} ${id}: fits the window, no scrolling inside, See all shows`, JSON.stringify(m));
      await p.keyboard.press("Escape");
      await sleep(200);
    }
    // During a switch too (every frame).
    if (ids.includes("apps")) {
      await away(p);
      const st = await item(p, "studios");
      const ap = await item(p, "apps");
      await glide(p, { x: st.x, y: st.y }, Infinity);
      await sleep(500);
      const over = await p.evaluate(async () => {
        let worst = 0;
        const end = performance.now() + 600;
        while (performance.now() < end) {
          for (const s of document.querySelectorAll("[data-mega-panel]:not([hidden])")) worst = Math.max(worst, s.getBoundingClientRect().bottom - innerHeight);
          await new Promise(requestAnimationFrame);
        }
        return worst;
      }).then(async (v) => v);
      await glide(p, { x: ap.x, y: ap.y }, 900);
      check(over <= 0.5, `15: ${size.width}x${size.height}: nothing passes the window bottom during a switch`, over.toFixed(1));
    }
    await ctx.close();
  }

  // ---------- 16. Reduced motion ----------
  {
    const ctx = await context({ reducedMotion: "reduce" });
    const p = await open(ctx);
    await away(p);
    const st = await item(p, "studios");
    const ap = await item(p, "apps");
    await mark(p);
    await glide(p, { x: st.x, y: st.y }, Infinity);
    await sleep(400);
    await glide(p, { x: ap.x, y: ap.y }, 900);
    await sleep(400);
    await away(p);
    const fs = await frames(p);
    const a = await arrive(p);
    const t = a.studios == null ? null : firstAt(fs, a.studios, (f) => f.open.includes("studios"));
    check(t !== null && t >= 100 - SLACK && t <= 180 + SLACK, "16: reduced motion keeps the rest timing", `${t?.toFixed(0)} ms`);
    const op = await p.evaluate(async () => {
      const out = [];
      document.querySelector('[data-bar-menu="canvas"]').click();
      for (let i = 0; i < 4; i++) {
        await new Promise(requestAnimationFrame);
        const s = document.querySelector('[data-mega-panel="canvas"]');
        out.push([s.dataset.phase, Number(getComputedStyle(s).opacity), Number(getComputedStyle(document.querySelector("[data-mega-sheet]")).opacity)]);
      }
      return out;
    });
    check(op.every(([ph, o, sh]) => ph !== "open" || (o === 1 && sh === 1)), "16: reduced motion: an opening panel is whole in its first frame", JSON.stringify(op));
    await ctx.close();
  }

  // ---------- 18. Public sign-up: a guest never sees owner-only rows ----------
  {
    const ctx = await context();
    const p = await open(ctx);
    for (const id of await visibleItems(p)) {
      await p.locator(`[data-bar-menu="${id}"]`).click();
      await sleep(600);
      const text = await p.evaluate((id) => document.querySelector(`[data-mega-panel="${id}"], [data-bar-card="${id}"]`).innerText, id);
      const bad = OWNER_WORDS.filter((w) => text.includes(w));
      check(!bad.length, `18: a guest's ${id} menu has no owner-only rows or words`, bad.join());
      await p.keyboard.press("Escape");
      await sleep(150);
    }
    await ctx.close();
  }

  // ---------- 19. Phone ----------
  {
    const ctx = await context({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const p = await open(ctx);
    const shown = await p.evaluate(() => [...document.querySelectorAll("[data-bar-menu]")].filter((e) => e.checkVisibility()).length);
    check(shown === 0, "19: a phone shows no top-bar menu item (its tabs and sheets stay as they were)");
    await ctx.close();
  }
} catch (e) {
  check(false, "the run finished", e.stack?.split("\n").slice(0, 3).join(" | "));
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nAll bar menu checks passed");
process.exit(failures.length ? 1 : 0);
