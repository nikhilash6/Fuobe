// Tab and chip rows in a real browser (a production build: `pnpm build && pnpm start`).
// Usage: node tests/e2e/tab-rows.mjs [appUrl]   Exits 1 if any check fails.
//
// 1. Every row of tabs or chips (the area pages' section tabs, Home's goals, Library, the hubs, the Marketing suite, the
//    galleries' categories, the studios' modes, the phone's Studios sheet and search) at 390 and 1440, light and dark:
//    it is the shared row (data-tab-row), its pills share one height and are fully rounded, exactly one is selected (a
//    row with nothing open yet, Home's goals, after a tap), and the page never scrolls sideways at 390.
// 2. The area tabs: stuck under the bar in a band with a hairline; a tap glides (450 to 650 ms, ease-out, no jump at the
//    end) and lands the section right under the band; the tapped tab is selected from the next frame and stays selected
//    when the last section can't reach the top; the fill slides (transform only) and only one pill ever looks selected.
// 3. Reduced motion: the tap jumps at once and nothing slides.
import { DESKTOP, launch, openRoute, PHONE } from "./_browser.mjs";

const app = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const browser = await launch();
const failures = [];
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${what}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(what);
};

const ROWS = [
  { name: "Home goals", route: "/", sel: "[data-goal-row] [data-tab-row]", none: true },
  { name: "Create sections", route: "/create", sel: 'nav[aria-label="Create sections"] [data-tab-row]' },
  { name: "Studios sections", route: "/studios", sel: 'nav[aria-label="Studios sections"] [data-tab-row]' },
  { name: "Motions & effects sections", route: "/motions-and-effects", sel: 'nav[aria-label="Motions & effects sections"] [data-tab-row]' },
  { name: "Apps categories", route: "/apps", sel: '[data-tab-row][aria-label="Categories"]' },
  { name: "Effects categories", route: "/effects", sel: '[data-tab-row][aria-label="Categories"]' },
  { name: "Library sections", route: "/library", sel: '[data-tab-row][aria-label="Library sections"]' },
  { name: "Audio modes", route: "/audio", sel: "[data-hub-chrome] [data-tab-row]" },
  { name: "Video tools modes", route: "/video-tools", sel: "[data-hub-chrome] [data-tab-row]" },
  { name: "Upscale modes", route: "/upscale", sel: "[data-hub-chrome] [data-tab-row]" },
  { name: "Marketing tools", route: "/marketing", sel: '[data-tab-row][aria-label="Marketing tools"]' },
  { name: "Marketing view", route: "/marketing", sel: '[data-tab-row][aria-label="View"]' },
  { name: "Genjutsu modes", route: "/genjutsu", sel: '[data-tab-row][aria-label="Genjutsu modes"]' },
  { name: "Shorts tabs", route: "/shorts", sel: '[data-tab-row][aria-label="Shorts Studio"]' },
  { name: "Mixed Media tabs", route: "/mixed-media", sel: '[data-tab-row][aria-label="Mixed Media"]' },
  { name: "Photodump packs", route: "/photodump", sel: '[data-tab-row][aria-label="Packs"]' },
  { name: "Studios sheet goals", route: "/", sel: '[role=dialog] [data-tab-row][aria-label="Show the studios for one goal"]', phoneOnly: true, setup: "sheet" },
  { name: "Search goals", route: "/", sel: '[role=dialog] [data-tab-row][aria-label="Show the studios for one goal"]', setup: "search" },
];

/** The row's pills: their heights, radii and how many are selected; the page's sideways overflow. */
const measure = (sel) => {
  const row = [...document.querySelectorAll(sel)].find((r) => r.checkVisibility());
  if (!row) return null;
  const pills = [...row.querySelectorAll(".tab-pill")].filter((p) => p.checkVisibility());
  const rr = row.getBoundingClientRect();
  return {
    n: pills.length,
    heights: [...new Set(pills.map((p) => Math.round(p.getBoundingClientRect().height)))],
    rounded: pills.every((p) => parseFloat(getComputedStyle(p).borderTopLeftRadius) >= p.getBoundingClientRect().height / 2 - 0.5),
    on: pills.filter((p) => p.matches('[data-on], [data-state="active"]')).length,
    pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
    rowInside: rr.left >= -1 && rr.right <= window.innerWidth + 1,
    // What paints a fill: the pills (a selected one paints none while the sliding fill is there) and the fill itself.
    lit: pills.filter((p) => getComputedStyle(p).backgroundColor !== "rgba(0, 0, 0, 0)").length + (row.hasAttribute("data-ind") ? 1 : 0),
  };
};

async function setup(page, r) {
  if (r.setup === "sheet") await page.locator('nav[aria-label="Main"]').last().getByRole("button", { name: "Studios" }).click();
  if (r.setup === "search") await page.keyboard.press("Control+k");
  if (r.setup) await page.waitForTimeout(800);
}

// 1. Every row, at both widths and in both themes.
for (const device of [PHONE, DESKTOP]) {
  const w = device.viewport.width;
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ ...device, colorScheme: scheme });
    await ctx.addInitScript((d) => {
      try {
        localStorage.setItem("theme", d);
      } catch {}
    }, scheme);
    const page = await ctx.newPage();
    for (const r of ROWS) {
      if (r.phoneOnly && w !== 390) continue;
      const tag = `${r.name} at ${w} ${scheme}`;
      try {
        await openRoute(page, `${app}${r.route}`);
        await setup(page, r);
        let m = await page.evaluate(measure, r.sel);
        if (!m) {
          check(false, `${tag}: the row is the shared row`, "not found");
          continue;
        }
        if (r.none) {
          check(m.on === 0, `${tag}: nothing open before a tap`, `${m.on}`);
          await page.locator(r.sel).locator(".tab-pill").nth(1).click();
          await page.waitForTimeout(400);
          m = await page.evaluate(measure, r.sel);
        }
        check(m.n > 1 && m.heights.length === 1, `${tag}: ${m.n} pills of one height`, m.heights.join(","));
        check(m.rounded, `${tag}: every pill fully rounded`);
        check(m.on === 1, `${tag}: exactly one selected`, `${m.on}`);
        check(m.lit === 1, `${tag}: one fill on screen`, `${m.lit}`);
        if (w === 390) check(m.pageOverflow <= 0 && m.rowInside, `${tag}: nothing scrolls the page sideways`, `${m.pageOverflow}px`);
      } catch (e) {
        check(false, tag, e.message.split("\n")[0]);
      }
    }
    await ctx.close();
  }
}

// 2. The area tabs: the band, the glide, the landing, the slide.
for (const device of [PHONE, DESKTOP]) {
  const w = device.viewport.width;
  const ctx = await browser.newContext(device);
  const page = await ctx.newPage();
  await openRoute(page, `${app}/create`);
  const band = 'nav[aria-label="Create sections"]';
  const tabs = page.locator(`${band} .tab-pill`);
  const n = await tabs.count();
  // A middle section: one that can reach the top.
  const target = await tabs.nth(1).getAttribute("data-section");
  const run = await page.evaluate(
    async ({ band, i }) => {
      const pill = document.querySelectorAll(`${band} .tab-pill`)[i];
      const row = pill.closest("[data-tab-row]");
      const frames = [];
      const t0 = performance.now();
      pill.click();
      const selectedAt = [];
      await new Promise((res) => {
        const tick = () => {
          const t = performance.now() - t0;
          const ind = row.querySelector(".tab-ind > span");
          frames.push({ t, y: scrollY, moving: row.hasAttribute("data-ind-moving"), transform: getComputedStyle(ind).transform, on: row.querySelectorAll("[data-on]").length });
          if (pill.hasAttribute("data-on") && !selectedAt.length) selectedAt.push(frames.length);
          if (t < 1200) requestAnimationFrame(tick);
          else res();
        };
        requestAnimationFrame(tick);
      });
      const sec = document.getElementById(pill.dataset.section);
      const b = document.querySelector(band).getBoundingClientRect();
      const ys = frames.map((f) => f.y);
      const start = ys[0];
      const end = ys.at(-1);
      const settled = frames.find((f) => f.y === end).t;
      // The largest step between frames in the last fifth of the way: an ease-out ends in small steps, never a jump.
      const steps = ys.slice(1).map((y, k) => Math.abs(y - ys[k]));
      const tailFrom = ys.findIndex((y) => Math.abs(end - y) <= Math.abs(end - start) / 5);
      const tail = Math.max(0, ...steps.slice(Math.max(0, tailFrom)));
      return {
        steps: steps.filter((d) => d > 0).map(Math.round).join(","),
        settled,
        travel: Math.abs(end - start),
        tail,
        firstStep: steps[0],
        gap: sec.getBoundingClientRect().top - b.bottom,
        stuck: document.querySelector(band).hasAttribute("data-stuck"),
        selectedFrame: selectedAt[0],
        maxOn: Math.max(...frames.map((f) => f.on)),
        slid: frames.some((f) => f.moving),
        hash: location.hash,
      };
    },
    { band, i: 1 },
  );
  check(run.travel > 0 && run.settled >= 380 && run.settled <= 720, `/create at ${w}: the glide takes 450-650 ms`, `${Math.round(run.settled)} ms over ${run.travel}px`);
  check(run.tail <= Math.max(6, run.travel / 25), `/create at ${w}: the glide eases out with no jump at the end`, `last steps ≤ ${run.tail}px; steps ${run.steps}`);
  check(run.gap >= 0 && run.gap <= 24, `/create at ${w}: the section lands right under the band`, `${Math.round(run.gap)}px below it`);
  check(run.stuck, `/create at ${w}: the band is stuck under the bar with its hairline`);
  check(run.selectedFrame !== undefined && run.selectedFrame <= 2, `/create at ${w}: the tapped tab is selected from the next frame`, `frame ${run.selectedFrame}`);
  check(run.maxOn === 1, `/create at ${w}: one tab selected all the way`);
  check(run.slid, `/create at ${w}: the fill slides to the tapped tab`);
  check(run.hash === `#${target}`, `/create at ${w}: the address names the section`, run.hash);
  // The last section: too short to reach the top, still the one selected.
  await tabs.nth(n - 1).click();
  await page.waitForTimeout(1100);
  const last = await page.evaluate((band) => [...document.querySelectorAll(`${band} .tab-pill[data-on]`)].map((p) => p.dataset.section), band);
  const lastId = await tabs.nth(n - 1).getAttribute("data-section");
  check(last.length === 1 && last[0] === lastId, `/create at ${w}: the last tab stays selected at the end of the page`, last.join(","));
  // Wheel back up: the scroll-spy follows again, one tab at a time.
  await page.mouse.move(w / 2, 400);
  await page.mouse.wheel(0, -100000);
  await page.waitForTimeout(900);
  const top = await page.evaluate((band) => [...document.querySelectorAll(`${band} .tab-pill[data-on]`)].map((p) => p.dataset.section), band);
  const firstId = await tabs.nth(0).getAttribute("data-section");
  check(top.length === 1 && top[0] === firstId, `/create at ${w}: back at the top the first tab is selected`, top.join(","));
  await ctx.close();
}

// 3. Reduced motion: an instant jump, nothing slides.
{
  const ctx = await browser.newContext({ ...DESKTOP, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await openRoute(page, `${app}/create`);
  const band = 'nav[aria-label="Create sections"]';
  const r = await page.evaluate(async (band) => {
    const pill = document.querySelectorAll(`${band} .tab-pill`)[1];
    const row = pill.closest("[data-tab-row]");
    const y0 = scrollY;
    pill.click();
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    const sec = document.getElementById(pill.dataset.section);
    return { moved: scrollY !== y0, gap: sec.getBoundingClientRect().top - document.querySelector(band).getBoundingClientRect().bottom, sliding: row.hasAttribute("data-ind-moving"), transition: getComputedStyle(row.querySelector(".tab-ind > span")).transitionDuration };
  }, band);
  check(r.moved && r.gap >= 0 && r.gap <= 24, "reduced motion: the tap jumps straight to the section", `${Math.round(r.gap)}px below the band`);
  check(!r.sliding && r.transition === "0s", "reduced motion: the fill does not slide");
  await ctx.close();
}

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("\nall tab-row checks passed");
