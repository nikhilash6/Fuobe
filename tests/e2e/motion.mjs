// The site's motion (src/app/motion.css, src/components/page-motion.tsx): it runs where it should, on the tokens, and
// is instant under reduced motion. The app must be running, a production build with placeholder results on
// (`FUOBE_DEMO_MODE=on pnpm start`). Usage: node tests/e2e/motion.mjs [appUrl] [--only=<text>] [--engine=webkit|firefox].
// Exits 1 on a failure.
//
// At 1440 and 390, each with and without prefers-reduced-motion:
// 1. A page link (bar or tabs) fades the new page in: #content[data-page-in] from its first frame, the animation on
//    the tokens, the old page never shown again, and the new page's text there within two frames. Back is instant.
// 2. Menus (desktop) open in 200 ms and close in 120 ms; the phone's sheets slide in (320 ms, no fade) and out (200 ms).
// 3. A card under the pointer (desktop) lifts 2 px, its shadow shows and its cover zooms; a press gives a little.
// 4. Pictures further down Home wait hidden and fade in as they load.
// 5. A result that finishes while the studio is open settles in (data-arrive), and only then; the feed doesn't shift.
// Reduced motion: none of the above moves (no page-in, no marks, durations ≈ 0, no lift).
// Layout shift on Home's load and scroll, and on a route change, stays at the audit's numbers or under; menu, card and
// sheet interactions add no long tasks.
import { DESKTOP, launch, loadPlaywright, PHONE } from "./_browser.mjs";

const app = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
// --engine=webkit runs the same checks in Safari's engine (layout shift and long tasks are Chromium-only reports there).
const engine = process.argv.find((a) => a.startsWith("--engine="))?.slice(9) ?? "chromium";
const browser = engine === "chromium" ? await launch() : await loadPlaywright()[engine].launch();
if (engine !== "chromium") console.log(`engine: ${engine} (layout shift and long tasks are not reported by this engine)`);
const failures = [];
const check = (ok, msg) => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`);
  if (!ok) failures.push(msg);
};
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
/** Long-task time per interaction, compared at the end with the same run under reduce: motion adds none (80 ms of slack for one stray task, a GC or a chunk, which shows in either). */
const longs = [];
/** Home's load + scroll layout shift, with and without motion (motion may add none). */
const homeShift = {};

/** Before the page's scripts: layout shifts, long tasks, and every animation that starts (name, duration, target). */
const PROBE = () => {
  const w = window;
  w.__m = { shifts: [], longs: [], anims: [] };
  try {
    new PerformanceObserver((l) => l.getEntries().forEach((e) => !e.hadRecentInput && w.__m.shifts.push({ v: e.value, t: e.startTime }))).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__m.longs.push({ d: e.duration, t: e.startTime }))).observe({ type: "longtask", buffered: true });
  } catch {}
  const seen = new WeakSet();
  const scan = () => {
    for (const a of document.getAnimations()) {
      if (seen.has(a)) continue;
      seen.add(a);
      const el = a.effect?.target;
      const t = a.effect?.getTiming?.() ?? {};
      w.__m.anims.push({
        name: a.animationName ?? (a.transitionProperty ? "transition:" + a.transitionProperty : "waapi"),
        dur: typeof t.duration === "number" ? t.duration : 0,
        delay: t.delay ?? 0,
        slot: el?.getAttribute?.("data-slot") ?? "",
        id: el?.id ?? "",
        inContent: !!el?.closest?.("#content"),
        t: performance.now(),
      });
    }
  };
  const loop = () => {
    try {
      scan();
    } catch {}
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // Marks set by the page's motion code, as they happen.
  w.__marks = [];
  new MutationObserver((rs) => {
    for (const r of rs) if (r.type === "attributes" && r.target.hasAttribute(r.attributeName)) w.__marks.push({ attr: r.attributeName, value: r.target.getAttribute(r.attributeName), gen: (r.target.closest?.("[data-gen-id]") ?? r.target.querySelector?.("[data-gen-id]"))?.getAttribute("data-gen-id") ?? null, el: r.target.tagName + (r.target.closest?.("[data-arrive]") ? " in tile" : ""), t: performance.now() });
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-page-in", "data-arrive", "data-follow", "data-enter", "data-fade", "data-reveal", "data-motion-reveal"] });
};

const since = (page, t0) =>
  page.evaluate((t0) => {
    const m = window.__m;
    return {
      shifts: m.shifts.filter((s) => s.t >= t0).reduce((s, x) => s + x.v, 0),
      longs: m.longs.filter((l) => l.t >= t0),
      anims: m.anims.filter((a) => a.t >= t0),
      marks: window.__marks.filter((k) => k.t >= t0),
    };
  }, t0);
const now = (page) => page.evaluate(() => performance.now());
/** Records, each frame for 700 ms, the pinned (sticky or fixed) bar at the top-left of the screen: its y and its opacity. */
const TRACK_TOP = () => {
  const w = window;
  w.__top = [];
  const t0 = performance.now();
  const loop = (t) => {
    let el = document.elementFromPoint(30, 20);
    let bar = null;
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const p = getComputedStyle(n).position;
      if (p === "sticky" || p === "fixed") bar = n;
    }
    if (bar && bar.closest("#content")) {
      let op = 1;
      for (let n = bar; n && n !== document.body; n = n.parentElement) op *= +getComputedStyle(n).opacity;
      w.__top.push({ pinned: true, y: Math.round(bar.getBoundingClientRect().y * 10) / 10, op: Math.round(op * 100) / 100 });
    } else w.__top.push({ pinned: false });
    if (t - t0 < 700) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
};

async function context({ phone, reduce }) {
  const ctx = await browser.newContext({ ...(phone ? PHONE : DESKTOP), reducedMotion: reduce ? "reduce" : "no-preference" });
  await ctx.addInitScript(PROBE);
  const page = await ctx.newPage();
  return { ctx, page };
}

async function settle(page, url) {
  await page.goto(app + url, { waitUntil: "load", timeout: 90_000 });
  await page.locator("h1").first().waitFor({ timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

// A first visit warms the server's caches, so the first measured run isn't the cold one.
{
  const warm = await browser.newContext(DESKTOP);
  const p = await warm.newPage();
  for (const url of ["/", "/apps", "/library", "/effects", "/image"]) await p.goto(app + url, { waitUntil: "load", timeout: 90_000 }).catch(() => {});
  await warm.close();
}

for (const phone of [false, true]) {
  for (const reduce of [false, true]) {
    const tag = `${phone ? 390 : 1440}${reduce ? " reduce" : ""}`;
    if (only && !tag.includes(only) && !["route", "menu", "sheet", "card", "image", "result"].some((s) => only.includes(s))) continue;
    console.log(`\n# ${tag}`);
    const { ctx, page } = await context({ phone, reduce });
    const nav = () => page.getByRole("navigation", { name: "Main" });

    // Home: layout shift on load and while scrolling (reveals and fades must add none).
    await settle(page, "/");
    {
      const t0 = 0;
      for (let i = 0; i < 12; i++) {
        // Mobile WebKit has no wheel: scroll the page by script there (the reveals see the same scroll).
        if (phone && engine === "webkit") await page.evaluate(() => window.scrollBy(0, 600));
        else await page.mouse.wheel(0, 600);
        await page.waitForTimeout(150);
      }
      await page.waitForTimeout(800);
      const r = await since(page, t0);
      homeShift[tag] = r.shifts;
      const base = 0.03; // the audit's Home load at a92342c1: 0.022 at 1440 (the "What Fuobe makes" section, not motion)
      check(r.shifts <= base, `Home load + scroll layout shift ${r.shifts.toFixed(4)} ≤ ${base}`);
      const fades = r.marks.filter((k) => k.attr === "data-fade");
      const reveals = r.marks.filter((k) => k.attr === "data-reveal");
      if (reduce) check(fades.length === 0 && reveals.length === 0, `no picture fades or section reveals (${fades.length}, ${reveals.length})`);
      else {
        check(fades.some((k) => k.value === "wait") && fades.some((k) => k.value === "in"), `pictures further down wait, then fade in (${fades.length} marks)`);
        check(reveals.some((k) => k.value === "in"), `sections below the first screen reveal on scroll (${reveals.length} marks)`);
      }
      const firstScreen = await page.evaluate(() => [...document.querySelectorAll("[data-reveal=wait]")].filter((el) => el.getBoundingClientRect().bottom < 0).length);
      check(firstScreen === 0, "no section above the screen is left hidden");
    }

    // 1. A page link fades the new page in; Back is instant.
    if (!only || only.includes("route")) {
      await settle(page, "/");
      const link = nav().getByRole("link", { name: "Library" }).first();
      // The pinned bar at the top of a phone's page (the app bar) stays put and opaque through the change.
      if (phone) await page.evaluate(TRACK_TOP);
      const t0 = await now(page);
      const click = Date.now();
      await link.click();
      await page.waitForURL(/\/library/, { timeout: 15_000 });
      const urlMs = Date.now() - click;
      await page.waitForTimeout(900);
      const r = await since(page, t0);
      const pageIn = r.marks.filter((k) => k.attr === "data-page-in");
      const fades = r.anims.filter((a) => a.inContent && a.name === "motion-fade");
      if (reduce) {
        check(pageIn.length === 0 && fades.length === 0, `route: no page motion (${pageIn.length} marks, ${fades.length} fades)`);
      } else {
        check(pageIn.length === 1, `route: #content marked as arriving (${pageIn.length})`);
        const rise = r.anims.find((a) => a.inContent && a.name === "motion-rise-page");
        check(fades.length > 0 && near(fades[0].dur, 239, 3), `route: new page fades in on the tokens (${fades[0]?.dur} ms)`);
        check(!!rise && near(rise.dur, 320), `route: and settles 8 px over 320 ms (${rise?.dur} ms)`);
        const left = await page.evaluate(() => document.getElementById("content").hasAttribute("data-page-in"));
        check(!left, "route: the mark is gone once the page has arrived");
      }
      check(r.shifts <= 0.01, `route: layout shift ${r.shifts.toFixed(4)}`);
      if (phone) {
        const top = await page.evaluate(() => window.__top);
        const moved = top.filter((x) => x.pinned && (Math.abs(x.y) > 0.5 || x.op < 0.99));
        check(top.some((x) => x.pinned) && moved.length === 0, `route: the phone's pinned top bar stays at y 0, opacity 1 (${moved.length} of ${top.length} frames off${moved[0] ? `: y ${moved[0].y}, opacity ${moved[0].op}` : ""})`);
      }
      console.log(`  info click → URL ${urlMs} ms`);
      longs.push({ tag, what: "route", ms: r.longs.reduce((s, l) => s + l.d, 0) });
      const t1 = await now(page);
      await page.goBack();
      await page.waitForTimeout(700);
      const back = await since(page, t1);
      check(back.marks.filter((k) => k.attr === "data-page-in").length === 0, "Back: instant (no page motion)");
    }

    // 1b. A tab in the page's own tab row changes the page in place, even across segments (Marketing → Ads).
    if (!only || only.includes("route")) {
      await settle(page, "/marketing");
      const tab = page.getByRole("navigation", { name: "Marketing tools" }).getByRole("link", { name: "Ads Studio" });
      if (await tab.count()) {
        const t0 = await now(page);
        await tab.click();
        await page.waitForURL(/\/ads/,{ timeout: 15_000 });
        await page.waitForTimeout(700);
        const r = await since(page, t0);
        check(r.marks.filter((k) => k.attr === "data-page-in").length === 0, "tab row: /marketing → /ads changes in place (no page motion)");
      } else check(false, "tab row: the Marketing tools row has an Ads Studio tab");
    }

    // 1c. A jump to a section lands on it shown (no section waiting to reveal at or above it).
    if (!only || only.includes("route")) {
      await settle(page, "/studios");
      const target = await page.evaluate(() => {
        const secs = [...document.querySelectorAll("#content [data-reveal][id]")];
        return secs.at(-1)?.id ?? null;
      });
      if (target) {
        await page.evaluate((id) => {
          const a = document.createElement("a");
          a.href = "#" + id;
          a.textContent = "jump";
          document.getElementById("content").prepend(a);
          a.click();
        }, target);
        await page.waitForTimeout(120);
        const hidden = await page.evaluate((id) => {
          const t = document.getElementById(id);
          return [...document.querySelectorAll("#content [data-reveal]")].filter((s) => (s === t || s.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) && getComputedStyle(s).opacity !== "1").map((s) => s.id || s.tagName);
        }, target);
        check(hidden.length === 0, `section jump: #${target} and the sections above it are shown at once (${hidden.join(", ") || "none hidden"})`);
      }
    }

    // 2. Menus (desktop) and sheets (phone).
    if (!only || only.includes("menu") || only.includes("sheet")) {
      await settle(page, "/");
      if (!phone) {
        // The bar's menus move by transitions (bar-menus.tsx, motion.css): in over the base token, out over the fast one.
        const btn = page.locator('[data-top-bar] [data-bar-menu="create"]');
        const opacityOf = (r, id) => r.anims.find((a) => a.id === id && a.name === "transition:opacity");
        let t0 = await now(page);
        await btn.click();
        await page.waitForTimeout(400);
        let r = await since(page, t0);
        const open = opacityOf(r, "create-menu");
        check(reduce ? !open || open.dur < 1 : !!open && near(open.dur, 200), open ? `menu opens in ${open.dur} ms` : "menu opens at once (no animation)");
        longs.push({ tag, what: "menu open", ms: r.longs.reduce((s, l) => s + l.d, 0) });
        t0 = await now(page);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
        r = await since(page, t0);
        const close = opacityOf(r, "create-menu");
        check(!close || (reduce ? close.dur < 1 : near(close.dur, 120)), `menu closes in ${close?.dur ?? "no"} ms`);
        // A menu opened by resting on it stays open when the item is then clicked (the click pins it).
        await page.mouse.move(5, 500);
        await page.waitForTimeout(400);
        await btn.hover();
        await page.waitForTimeout(400);
        check((await page.locator('#create-menu[data-phase="open"]').count()) === 1, "menu: resting on the item opens it");
        await btn.click();
        await page.waitForTimeout(400);
        check((await page.locator('#create-menu[data-phase="open"]').count()) === 1, "menu: opened by hover, a click on the item keeps it open");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        await page.mouse.move(5, 500);
        await page.waitForTimeout(400);
        // The Studios panel leaves quickly (the fast token), and is gone after.
        const studios = page.locator('[data-top-bar] [data-bar-menu="studios"]');
        await studios.click();
        await page.waitForTimeout(400);
        t0 = await now(page);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
        r = await since(page, t0);
        const fadeOut = opacityOf(r, "studios-launcher");
        check(reduce ? !fadeOut || fadeOut.dur < 1 : !!fadeOut && near(fadeOut.dur, 120), `launcher closes over the fast token (${fadeOut?.dur ?? "no"} ms)`);
        check(await page.locator("#studios-launcher").isHidden(), "launcher is gone after it closes");
      } else {
        for (const s of ["Create", "You"]) {
          let t0 = await now(page);
          await nav().getByRole("button", { name: s, exact: true }).click();
          await page.waitForTimeout(500);
          let r = await since(page, t0);
          const open = r.anims.find((a) => a.id === "phone-sheet" && a.name === "enter");
          check(reduce ? !open || open.dur < 1 : !!open && near(open.dur, 320), open ? `${s} sheet slides in over ${open.dur} ms` : `${s} sheet opens at once (no animation)`);
          const opacity = await page.locator("#phone-sheet").evaluate((el) => getComputedStyle(el).getPropertyValue("--tw-enter-opacity").trim());
          check(opacity === "1", `${s} sheet: a solid surface (no fade: --tw-enter-opacity ${opacity})`);
          longs.push({ tag, what: `${s} sheet open`, ms: r.longs.reduce((s, l) => s + l.d, 0) });
          t0 = await now(page);
          await page.keyboard.press("Escape");
          await page.waitForTimeout(500);
          r = await since(page, t0);
          const close = r.anims.find((a) => a.id === "phone-sheet" && a.name === "exit");
          check(!close || (reduce ? close.dur < 1 : near(close.dur, 200)), `${s} sheet slides out over ${close?.dur ?? "no"} ms`);
          check(await page.evaluate(() => document.activeElement && document.activeElement !== document.body), `${s} sheet: focus comes back`);
        }
      }
    }

    // 3. Cards (pointer devices only).
    if (!phone && (!only || only.includes("card"))) {
      await settle(page, "/effects");
      const card = page.locator("main a.card-motion").first();
      // The grid may re-render once after hydration: try again if the card was replaced under us.
      for (let i = 0; i < 3; i++) {
        try {
          await card.scrollIntoViewIfNeeded({ timeout: 5_000 });
          break;
        } catch {
          await page.waitForTimeout(500);
        }
      }
      const t0 = await now(page);
      await card.hover();
      await page.waitForTimeout(450);
      const s = await card.evaluate((el) => ({
        translate: getComputedStyle(el).translate,
        shadow: getComputedStyle(el, "::after").opacity,
        zoom: getComputedStyle(el.querySelector(".card-cover > :first-child")).scale,
      }));
      if (reduce) check(s.translate === "none" || s.translate === "0px" || s.translate === "0px 0px", `card: no lift (${s.translate})`);
      else {
        check(s.translate === "0px -2px", `card lifts 2 px (${s.translate})`);
        check(s.shadow === "1", `card: its shadow shows (${s.shadow})`);
        check(s.zoom === "1.03", `card: its cover leans in (${s.zoom})`);
      }
      const box = await card.boundingBox();
      await page.mouse.move(box.x + 30, box.y + 30);
      await page.mouse.down();
      // Wait for the press to settle (an engine may start its transition a frame later), at most 600 ms.
      await card.evaluate((el) => new Promise((done) => {
        const t0 = performance.now();
        const tick = () => (getComputedStyle(el).scale === "0.985" || performance.now() - t0 > 600 ? done() : requestAnimationFrame(tick));
        tick();
      }));
      const pressed = await card.evaluate((el) => getComputedStyle(el).scale);
      check(reduce ? pressed === "1" || pressed === "none" : pressed === "0.985", `card press gives a little (${pressed})`);
      await page.mouse.move(box.x - 40, box.y - 40);
      await page.mouse.up();
      const r = await since(page, t0);
      longs.push({ tag, what: "card hover and press", ms: r.longs.reduce((s, l) => s + l.d, 0) });
      const props = [...new Set(r.anims.filter((a) => a.name.startsWith("transition:")).map((a) => a.name.slice(11)))];
      check(props.every((p) => ["translate", "scale", "opacity", "background-color", "color", "box-shadow", "border-color", "outline-color"].includes(p)), `card: only compositor properties move (${props.join(", ")})`);
    }

    // 5. A result that finishes while the studio is open.
    if (!only || only.includes("result")) {
      await settle(page, "/image");
      const prompt = page.locator("main textarea").first();
      if (await prompt.count()) {
        await prompt.fill("Editorial portrait, soft window light");
        const t0 = await now(page);
        const before = await page.locator("main [data-gen-id]").first().getAttribute("data-gen-id").catch(() => null);
        await page.locator("main button[aria-label^='Generate']").first().click();
        // The new request rises in at the top; then its placeholder result arrives.
        await page
          .waitForFunction(
            (before) => {
              const top = document.querySelector("main [data-gen-id]");
              return top && top.getAttribute("data-gen-id") !== before && top.querySelector("[class*='group/tile']");
            },
            before,
            { timeout: 45_000 },
          )
          .catch(() => {});
        await page.waitForTimeout(1200);
        const r = await since(page, t0);
        const arrive = r.marks.filter((k) => k.attr === "data-arrive");
        const enter = r.marks.filter((k) => k.attr === "data-enter");
        if (reduce) check(arrive.length === 0 && enter.length === 0, `result: appears still (${arrive.length}, ${enter.length})`);
        else {
          check(enter.length >= 1, `result: the new request rises in (${enter.length})`);
          check(arrive.length >= 1, `result: the picture settles in (${arrive.length})`);
          const sweep = r.anims.find((a) => a.name === "motion-sweep");
          check(!!sweep && near(sweep.dur, 500), `result: one light passes over it (${sweep?.dur} ms)`);
          // Only the picture settles into its tile: the tile's frame never fades, and the picture has no load fade too.
          const arrived = new Set(arrive.map((k) => k.gen).filter(Boolean));
          const stacked = r.marks.filter((k) => (k.attr === "data-motion-reveal" || k.attr === "data-fade") && arrived.has(k.gen));
          check(stacked.length === 0, `result: one motion on the tile (no skeleton hand-over or load fade inside it: ${stacked.length}${stacked.length ? ": " + stacked.map((k) => `${k.attr}=${k.value} ${k.el}`).join(", ") : ""})`);
        }
        const base = phone ? 0.049 : 0.024;
        check(r.shifts <= base, `result: layout shift ${r.shifts.toFixed(4)} ≤ the audit's ${base}`);
        // A reload shows the same feed still.
        const t1 = await now(page);
        await page.reload({ waitUntil: "load" });
        await page.waitForTimeout(1500);
        const again = await page.evaluate(() => window.__marks.filter((k) => k.attr === "data-arrive" || k.attr === "data-enter").length);
        check(again === 0, `result: a reload doesn't replay it (${again}, from ${Math.round(t1)})`);
      } else console.log("  skip result: no prompt on /image");
    }
    await ctx.close();
  }
}

await browser.close();
console.log("\n# against reduced motion (the same run with motion off)");
for (const w of [1440, 390]) {
  const a = homeShift[`${w}`], b = homeShift[`${w} reduce`];
  if (a !== undefined && b !== undefined) check(a <= b + 0.005, `${w}: Home layout shift with motion ${a.toFixed(4)} vs without ${b.toFixed(4)}`);
  for (const what of [...new Set(longs.filter((l) => l.tag === `${w}`).map((l) => l.what))]) {
    const on = longs.find((l) => l.tag === `${w}` && l.what === what)?.ms ?? 0;
    const off = longs.find((l) => l.tag === `${w} reduce` && l.what === what)?.ms ?? 0;
    check(on <= off + 80, `${w} ${what}: long tasks with motion ${Math.round(on)} ms vs without ${Math.round(off)} ms`);
  }
}
console.log(failures.length ? `\n${failures.length} failure(s)` : "\nall motion checks pass");
process.exit(failures.length ? 1 : 0);
