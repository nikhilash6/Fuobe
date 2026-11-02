// The navigation in a real browser: the top bar and its Studios launcher, the search palette, the phone's tabs and
// sheets, Home's goal row, the next steps under a result and the explore count.
// Usage: node tests/e2e/nav.mjs [appUrl] [shotsDir]
//   The app must be running with placeholders on (Settings → demo mode), so a result can be made without a key.
//   E2E_OWNER_PASSWORD: the studio's password, when it has one (the owner's checks sign in with it; a studio without
//   one is the owner's). Account checks need public sign-up; they make throwaway qa accounts and delete them.
// Exits 1 if any check fails; screenshots (dark and light, 1440x900 and 390x844) go to shotsDir when given.
import fs from "node:fs";
import path from "node:path";
import { DESKTOP, launch, openRoute, PHONE } from "./_browser.mjs";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const app = (args[0] ?? "http://localhost:3000").replace(/\/$/, "");
const shots = args[1];
if (shots) fs.mkdirSync(shots, { recursive: true });
const failures = [];
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${what}${!ok && detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(what);
};
const shot = async (page, name) => shots && (await page.screenshot({ path: path.join(shots, `${name}.png`) }));
const me = async (ctx) => (await (await ctx.request.get(`${app}/api/auth/me`)).json().catch(() => null)) ?? {};
const publicSignup = !!(await fetch(`${app}/api/auth/me`).then((r) => r.json()).catch(() => null))?.publicSignup;
const VISITOR_WORDS = ["ComfyUI", "add key", "offline", "Paid APIs only", "Open source only", "Placeholder"];

const browser = await launch();
const accounts = [];

/** A browser context as `who`: "guest", "owner" (signed in when the studio has a password) or "account" (signed up). */
async function as(who, device = DESKTOP, extra = {}) {
  const ctx = await browser.newContext({ ...device, ...extra });
  ctx.errors = [];
  if (who === "owner" && process.env.E2E_OWNER_PASSWORD) await ctx.request.post(`${app}/api/auth/login`, { data: { password: process.env.E2E_OWNER_PASSWORD } });
  if (who === "account") {
    const email = `qa-nav-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`;
    const password = `Qa-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    const res = await ctx.request.post(`${app}/api/auth/signup`, { data: { email, password } });
    if (!res.ok()) throw new Error(`sign-up answered ${res.status()}`);
    accounts.push({ ctx, password });
  }
  const kind = await me(ctx);
  if (who === "owner" && !kind.owner) throw new Error("couldn't sign in as the owner (set E2E_OWNER_PASSWORD)");
  return ctx;
}
async function page(ctx) {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => ctx.errors.push(e.message.split("\n")[0]));
  p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && ctx.errors.push(m.text().slice(0, 200)));
  return p;
}
const focused = (p) =>
  p.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return null;
    const style = getComputedStyle(a);
    const ring = (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || (style.boxShadow && style.boxShadow !== "none");
    return { name: (a.getAttribute("aria-label") || a.textContent || "").replace(/\s+/g, " ").trim(), ring, col: a.getAttribute("data-col"), row: a.getAttribute("data-row"), href: a.getAttribute("href") };
  });
const inView = (loc) =>
  loc.evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
    }),
  );
const sideScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

try {
  // 1. Keyboard order and focus rings, desktop.
  {
    const ctx = await as("guest");
    const p = await page(ctx);
    await openRoute(p, `${app}/image`);
    const order = [];
    let rings = true;
    for (let i = 0; i < 12; i++) {
      await p.keyboard.press("Tab");
      const f = await focused(p);
      order.push(f?.name ?? "");
      if (i > 0 && !f?.ring) rings = false;
    }
    const want = ["Skip to content", "Fuobe home", "Create", /^Studios/, "Apps", "Motions & effects", "Canvas", "Assist", "Library", /^Search/, "New creation"];
    const ok = want.every((w, i) => (typeof w === "string" ? order[i] === w : w.test(order[i])));
    check(ok, "Tab order: Skip, wordmark, Create, Studios, Apps, Motions & effects, Canvas, Assist, Library, Search, New creation", order.join(" › "));
    check(rings, "every bar stop shows a focus ring");
    // The search field is 280 px from 1440 (an lg rule must not win over it) and its name is the words it shows.
    const field = await p.locator('[data-top-bar] button[aria-keyshortcuts="/ Meta+K Control+K"]').evaluate((b) => ({ w: b.getBoundingClientRect().width, text: b.innerText.trim(), label: b.getAttribute("aria-label") }));
    check(field.w >= 270 && field.text.startsWith("Search studios, apps, effects…") && !field.label, "search field: 280 px at 1440, its name is its visible words", JSON.stringify(field));
    // Hovering the bar loads no routes ahead; opening the launcher loads its own.
    const reqs = [];
    p.on("request", (r) => r.headers()["next-router-prefetch"] && reqs.push(r.url()));
    await p.locator("[data-top-bar]").getByRole("link", { name: "Fuobe home" }).hover();
    await p.locator("[data-top-bar]").getByRole("link", { name: "Library", exact: true }).hover();
    await p.mouse.move(700, 500);
    await p.waitForTimeout(3000);
    const onHover = reqs.length;
    await p.locator("[data-top-bar]").getByRole("button", { name: /^Studios/ }).click();
    await p.waitForTimeout(3000);
    check(onHover <= 3 && reqs.length > onHover, "prefetch: hovering the bar loads at most the hovered links; opening Studios loads its routes", `${onHover} on hover, ${reqs.length} after opening`);
    await p.keyboard.press("Escape");
    await ctx.close();
  }

  // 2. The Studios launcher: keys, fit, a pick, and the active marks.
  {
    const ctx = await as("guest");
    const p = await page(ctx);
    await openRoute(p, `${app}/image`);
    const trigger = p.locator("[data-top-bar]").getByRole("button", { name: /^Studios/ });
    const panel = p.locator("#studios-launcher");
    const heading = p.locator("main h1").first();
    const before = await heading.boundingBox();
    await trigger.focus();
    await p.keyboard.press("Enter");
    await panel.waitFor({ state: "visible" });
    check((await trigger.getAttribute("aria-expanded")) === "true", "launcher: Enter opens it (aria-expanded)");
    const first = await focused(p);
    check(/^Cinema Studio/.test(first?.name ?? ""), "launcher: focus starts on Cinema Studio", first?.name);
    await p.keyboard.press("ArrowRight");
    const right = await focused(p);
    check(right?.col === "1" && right?.row === "0", "launcher: Right goes to the next column's lead", JSON.stringify(right));
    await p.keyboard.press("ArrowDown");
    const down = await focused(p);
    check(down?.col === "1" && down?.row === "1", "launcher: Down goes down the column", JSON.stringify(down));
    await p.keyboard.press("ArrowUp");
    await p.keyboard.press("ArrowLeft");
    const back = await focused(p);
    check(back?.col === "0" && back?.row === "0", "launcher: Up and Left come back", JSON.stringify(back));
    await p.keyboard.press("End");
    const end = await focused(p);
    await p.keyboard.press("Home");
    const home = await focused(p);
    check(end?.href !== home?.href && home?.col === "0" && home?.row === "0", "launcher: End and Home jump to the ends");
    const after = await heading.boundingBox();
    check(!!before && !!after && before.y === after.y && before.x === after.x, "launcher: opening it does not move the page");
    await shot(p, "launcher-keys-1440");
    await p.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    check(await trigger.evaluate((t) => t === document.activeElement), "launcher: Esc closes it and focus goes back to Studios");
    // Search from the launcher, then Esc: focus comes back to Studios (the launcher's own button is gone by then).
    await trigger.click();
    await panel.getByRole("button", { name: /^Search all apps/ }).click();
    await p.getByRole("dialog", { name: "Search Fuobe" }).waitFor();
    await p.keyboard.press("Escape");
    await p.getByRole("dialog", { name: "Search Fuobe" }).waitFor({ state: "detached" });
    check(await trigger.evaluate((t) => t === document.activeElement), "launcher: its Search, then Esc, gives focus back to Studios");
    await trigger.click();
    await panel.waitFor({ state: "visible" });
    await p.keyboard.press("/");
    await p.getByRole("dialog", { name: "Search Fuobe" }).waitFor();
    await p.keyboard.press("Escape");
    await p.getByRole("dialog", { name: "Search Fuobe" }).waitFor({ state: "detached" });
    check(await trigger.evaluate((t) => t === document.activeElement), "launcher: / from inside it, then Esc, gives focus back to Studios");
    for (const [w, h] of [
      [1440, 900],
      [1280, 800],
      [1280, 720],
      [1024, 768],
    ]) {
      await p.setViewportSize({ width: w, height: h });
      await trigger.click();
      await panel.waitFor({ state: "visible" });
      const links = panel.getByRole("link");
      const seen = await inView(links);
      const scrolls = await panel.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
      check(seen.length === 33 && seen.every(Boolean) && !scrolls, `launcher at ${w}x${h}: all 33 links on screen, no scrolling`, `${seen.filter(Boolean).length}/${seen.length}`);
      await p.keyboard.press("Escape");
    }
    await p.setViewportSize(DESKTOP.viewport);
    await trigger.click();
    await panel.getByRole("link", { name: /^Marketing Studio/ }).click();
    const landed = await (p.waitForURL((u) => new URL(u).pathname === "/marketing", { timeout: 20_000 }).then(() => panel.waitFor({ state: "hidden" }))).then(() => true, () => false);
    check(landed, "launcher: Marketing Studio lands on /marketing and the launcher closes");
    check((await trigger.getAttribute("data-active")) !== null, "on /marketing the Studios trigger is marked");
    await trigger.click();
    check((await panel.getByRole("link", { name: /^Marketing Studio/ }).getAttribute("aria-current")) === "page", "…and Marketing Studio has aria-current=page");
    await p.keyboard.press("Escape");
    check(ctx.errors.length === 0, "launcher pages: no console errors", ctx.errors.join(" | "));
    await ctx.close();
  }

  // 3. Create and the guest menu are real menus.
  {
    const ctx = await as("guest");
    const p = await page(ctx);
    await openRoute(p, `${app}/`);
    for (const name of ["Create", "Menu"]) {
      const button = p.locator("[data-top-bar]").getByRole("button", { name, exact: true });
      await button.focus();
      await p.keyboard.press("Enter");
      const menu = p.getByRole("menu");
      await menu.waitFor();
      await p.keyboard.press("ArrowDown");
      const item = await p.evaluate(() => document.activeElement?.getAttribute("role"));
      await p.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
      check(item === "menuitem" && (await button.evaluate((b) => b === document.activeElement)), `${name}: role=menu, arrows reach the items, Esc gives focus back`);
    }
    await ctx.close();
  }

  // 4. The search palette.
  {
    const ctx = await as("owner");
    const p = await page(ctx);
    const dialog = p.getByRole("dialog", { name: "Search Fuobe" });
    await openRoute(p, `${app}/`);
    await p.locator("main h1").first().click();
    await p.keyboard.press("/");
    check(await dialog.waitFor({ timeout: 10_000 }).then(() => true, () => false), "palette: / on the page opens it");
    await shot(p, "palette-empty-1440");
    await p.keyboard.press("Escape");
    await openRoute(p, `${app}/image`);
    const box = p.locator("[data-composer] textarea").first();
    await box.click();
    await p.keyboard.type("a/b");
    check((await box.inputValue()).endsWith("a/b") && !(await dialog.isVisible()), "palette: / typed in the composer is a slash");
    await p.keyboard.press("ControlOrMeta+k");
    await dialog.waitFor();
    await p.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    check(await p.evaluate(() => !!document.activeElement?.matches("[data-composer] textarea")), "palette: Ctrl+K from the composer, Esc back to the composer");
    await p.keyboard.press("ControlOrMeta+k");
    await dialog.waitFor();
    await p.keyboard.type("ad for my perfume");
    await p.locator('[cmdk-item][data-selected="true"]').first().waitFor();
    await p.waitForTimeout(500);
    const rows = await dialog.locator("[cmdk-item]").evaluateAll((els) => els.slice(0, 3).map((e) => e.getAttribute("data-value")));
    check(rows.join() === "nav:marketing,nav:ads,app:app-giant-product", "palette: “ad for my perfume” → Marketing Studio, Ads Studio, Giant Product", rows.join());
    // Screen readers hear the row that is selected: the field's aria-activedescendant follows it, typing included.
    const announced = () => p.evaluate(() => {
      const sel = document.querySelector("[cmdk-item][data-selected=true]")?.id;
      const input = document.querySelector("[cmdk-input]")?.getAttribute("aria-activedescendant");
      return !!sel && sel === input;
    });
    const a1 = await announced();
    await p.keyboard.press("ArrowDown");
    await p.waitForTimeout(100);
    const a2 = await announced();
    await p.keyboard.type(" ");
    await p.waitForTimeout(500);
    const a3 = await announced();
    await p.keyboard.press("Backspace");
    await p.waitForTimeout(500);
    check(a1 && a2 && a3, "palette: aria-activedescendant names the selected row (on typing and on arrows)", JSON.stringify([a1, a2, a3]));
    // The goal chips are buttons outside the listbox.
    check((await dialog.locator("[role=listbox] button").count()) === 0, "palette: no buttons inside the listbox");
    await shot(p, "palette-perfume-keys-1440");
    await p.keyboard.press("Enter");
    check(await (p.waitForURL((u) => new URL(u).pathname === "/marketing", { timeout: 20_000 })).then(() => true, () => false), "palette: Enter opens Marketing Studio");
    await p.keyboard.press("ControlOrMeta+k");
    await dialog.waitFor();
    await dialog.getByRole("group", { name: "Show the studios for one goal" }).getByRole("button", { name: /^Sell/ }).click();
    await p.waitForTimeout(300);
    const tiles = await dialog.locator('[cmdk-item][data-value^="tile:"]').count();
    check(tiles === 5, "palette: the Sell chip shows 5 studios", String(tiles));
    await p.keyboard.press("Escape");
    await openRoute(p, `${app}/`);
    await p.keyboard.press("ControlOrMeta+k");
    await dialog.waitFor();
    await p.waitForTimeout(400);
    const firstTile = await dialog.locator('[cmdk-item][data-selected="true"]').getAttribute("data-value");
    await p.keyboard.press("Enter");
    await p.waitForURL((u) => new URL(u).pathname !== "/", { timeout: 20_000 }).catch(() => {});
    check(firstTile?.startsWith("tile:") && new URL(p.url()).pathname !== "/", "palette: Enter on an empty query opens a studio tile", `${firstTile} → ${p.url()}`);
    check(ctx.errors.length === 0, "palette pages: no console errors", ctx.errors.join(" | "));
    await ctx.close();
  }

  // 5. Phone: tabs, the Studios sheet, search, full-screen studios, no sideways scroll.
  for (const size of [PHONE.viewport, { width: 360, height: 640 }]) {
    const label = `${size.width}x${size.height}`;
    const ctx = await as("guest", { ...PHONE, viewport: size });
    const p = await page(ctx);
    await openRoute(p, `${app}/image`);
    const tabs = p.locator("[data-phone-tabs]");
    const cells = await tabs.locator("[data-tab]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.width, r.height, r.bottom]));
    check(cells.length === 5 && cells.every(([w, h]) => w >= 44 && h >= 44), `${label}: five tabs, each at least 44x44`, JSON.stringify(cells));
    check(cells.every(([, , b]) => Math.abs(b - size.height) <= 8), `${label}: the tabs sit at the bottom`);
    await tabs.getByRole("button", { name: "Studios" }).tap();
    const sheet = p.locator("#phone-sheet");
    await sheet.waitFor({ state: "visible" });
    await p.waitForTimeout(350);
    const tiles = sheet.locator("ul").first().getByRole("link");
    const seen = await inView(tiles);
    if (size.height >= 844) check(seen.length === 33 && seen.every(Boolean), `${label}: the Studios sheet shows all 33 without scrolling`, `${seen.filter(Boolean).length}/${seen.length}`);
    else check(seen.length === 33, `${label}: the Studios sheet lists all 33 (it scrolls inside at this height)`, String(seen.length));
    await sheet.getByRole("button", { name: /^Film/ }).tap();
    check((await sheet.locator("ul").first().getByRole("link").count()) === 8, `${label}: the Film chip shows 8`);
    if (size.height >= 844) await shot(p, "phone-studios-sheet-film-390");
    await tabs.locator('[data-tab="library"]').tap();
    const went = await (p.waitForURL((u) => new URL(u).pathname === "/library", { timeout: 20_000 }).then(() => sheet.waitFor({ state: "detached", timeout: 5_000 }))).then(() => true, () => false);
    check(went, `${label}: Library tapped over the open sheet goes to /library and closes it`);
    for (const [tab, name] of [["studios", "Studios"], ["create", "Create"], ["you", "You"]]) {
      await tabs.getByRole("button", { name }).focus();
      await p.keyboard.press("Enter");
      await sheet.waitFor({ state: "visible" });
      await p.keyboard.press("Escape");
      const closed = await (sheet.waitFor({ state: "detached", timeout: 5_000 })).then(() => true, () => false);
      const back = await p.evaluate((t) => document.activeElement?.getAttribute("data-tab") === t, tab);
      check(closed && back, `${label}: Esc closes the ${name} sheet and focus goes back to its tab`);
    }
    await openRoute(p, `${app}/image`);
    await p.locator("main").getByRole("button", { name: "Search", exact: true }).first().tap();
    const dialog = p.getByRole("dialog", { name: "Search Fuobe" });
    await dialog.waitFor();
    const full = await dialog.evaluate((d) => {
      const r = d.getBoundingClientRect();
      return r.width >= innerWidth - 1 && r.height >= innerHeight - 1;
    });
    check(full && (await dialog.getByRole("button", { name: /^Cancel/ }).isVisible()), `${label}: the header's search opens the full-screen palette with Cancel`);
    await dialog.getByRole("button", { name: /^Cancel/ }).tap();
    await dialog.waitFor({ state: "detached" });
    for (const r of ["/assist"]) {
      await openRoute(p, app + r);
      check(!(await tabs.isVisible()), `${label}: no tabs on ${r}`);
      await p.getByRole("button", { name: "Menu", exact: true }).first().tap();
      await sheet.waitFor({ state: "visible" });
      check((await sheet.getByRole("link", { name: "Library" }).count()) > 0, `${label}: the header's Menu on ${r} opens the menu sheet`);
      await p.keyboard.press("Escape");
    }
    for (const r of ["/", "/image", "/video", "/audio", "/marketing", "/library", "/settings", "/cinema", "/apps", "/effects"]) {
      await openRoute(p, app + r, { settleMs: 300 });
      const over = await sideScroll(p);
      if (over > 0) check(false, `${label}: ${r} does not scroll sideways`, `${over}px`);
    }
    check(ctx.errors.length === 0, `${label}: no console errors`, ctx.errors.join(" | "));
    await ctx.close();
  }

  // 6. No layout shift on load, for each kind of viewer. Each page is seen once first: the bar keeps the room of the pills
  // and the avatar this browser saw last (and an owner's very first Home also has its first-run guide arrive).
  for (const who of ["guest", "owner", ...(publicSignup ? ["account"] : [])]) {
    const ctx = await as(who);
    await ctx.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    const p = await page(ctx);
    for (const r of ["/", "/image", "/library", "/marketing"]) {
      await p.goto(app + r, { waitUntil: "load" });
      await p.waitForTimeout(1500);
      await p.goto(app + r, { waitUntil: "load" });
      await p.waitForTimeout(2500);
      const cls = await p.evaluate(() => window.__cls);
      check(cls < 0.01, `${who}: ${r} CLS ${cls.toFixed(4)} < 0.01`);
    }
    check(ctx.errors.length === 0, `${who}: no console errors on load`, ctx.errors.join(" | "));
    await ctx.close();
  }

  // 7. Home's goal row.
  for (const who of ["guest", "owner"]) {
    const ctx = await as(who);
    const p = await page(ctx);
    await openRoute(p, `${app}/`);
    const row = p.getByRole("toolbar", { name: "Start from a goal" });
    const goals = row.locator("[data-goal]");
    check((await goals.count()) === 6, `${who}: six goals on Home`);
    await goals.first().focus();
    await p.keyboard.press("ArrowRight");
    await p.keyboard.press("ArrowRight");
    const at = await p.evaluate(() => document.activeElement?.getAttribute("data-goal"));
    check(at === "sell", `${who}: Right moves along the goals`, at);
    const title = p.locator("main h1").first();
    const before = await title.boundingBox();
    await p.keyboard.press("Enter");
    const band = p.locator("#goal-band");
    await band.waitFor({ state: "visible" });
    const text = await band.innerText();
    check(/Marketing Studio/.test(text) && /Giant product/i.test(text), `${who}: Sell opens its band (Marketing Studio … Giant product)`);
    check((await title.boundingBox())?.y === before?.y, `${who}: the band leaves the page above it in place`);
    check(/Plan it with Assist/.test(text) === (who === "owner"), `${who}: “Plan it with Assist” only for the owner`);
    if (who === "owner") await shot(p, "home-sell-band-keys-1440");
    await p.keyboard.press("Escape");
    await band.waitFor({ state: "detached" });
    check((await p.evaluate(() => document.activeElement?.getAttribute("data-goal"))) === "sell", `${who}: Esc closes the band, focus back on Sell`);
    await ctx.close();
  }

  // 8. Next steps under a result (the owner's feed; a placeholder result).
  {
    const ctx = await as("owner");
    const p = await page(ctx);
    await openRoute(p, `${app}/image`);
    const made = await p.evaluate(() =>
      fetch("/api/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ feature: "image", modelId: "nano-banana-pro", prompt: "a matte black perfume bottle on wet stone, product photo", params: { aspectRatio: "1:1" } }) }).then((r) => r.json()),
    );
    const id = made.items?.[0]?.id;
    for (let i = 0; i < 40; i++) {
      const g = await p.evaluate((id) => fetch(`/api/generations/${id}`).then((r) => r.json()), id);
      if ((g.generation ?? g).status === "succeeded") break;
      await p.waitForTimeout(500);
    }
    await openRoute(p, `${app}/image`);
    const steps = p.getByRole("group", { name: /Keep going with this picture/ }).first();
    const shown = await steps.waitFor({ timeout: 30_000 }).then(() => true, () => false);
    const hrefs = shown ? await steps.getByRole("link").evaluateAll((els) => els.map((e) => e.getAttribute("href"))) : [];
    check(shown && hrefs.length >= 3 && hrefs.length <= 5 && hrefs.every((h) => /[?&]image=/.test(h)), "image result: “Keep going with this picture” with 3-5 links that carry the picture", hrefs.join(" "));
    await steps.scrollIntoViewIfNeeded().catch(() => {});
    await shot(p, "next-steps-1440");
    const sharpen = steps.getByRole("link", { name: /Sharpen to 4K/ });
    if (await sharpen.count()) {
      await sharpen.click();
      await p.waitForURL((u) => new URL(u).pathname.startsWith("/upscale"), { timeout: 20_000 });
      await p.waitForTimeout(1500);
      check((await p.locator('main img[src^="/api/files/"]').count()) > 0, "Sharpen to 4K opens Upscale with the picture in its slot");
    }
    const clip = await p.evaluate(() =>
      fetch("/api/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ feature: "video", modelId: "oss-minimax-h3", op: "t2v", prompt: "a fashion model walks a neon runway, slow push-in", params: { duration: 5, aspectRatio: "16:9" } }) }).then((r) => r.json()),
    );
    for (let i = 0; i < 40; i++) {
      const g = await p.evaluate((id) => fetch(`/api/generations/${id}`).then((r) => r.json()), clip.items?.[0]?.id);
      if ((g.generation ?? g).status === "succeeded") break;
      await p.waitForTimeout(500);
    }
    await openRoute(p, `${app}/video`);
    const clipSteps = p.getByRole("group", { name: /Keep going with this clip/ }).first();
    await clipSteps.waitFor({ timeout: 30_000 }).catch(() => {});
    const firstClip = await clipSteps.getByRole("link").first().getAttribute("href").catch(() => null);
    check(!!firstClip && /\/(extend|color-grade)/.test(firstClip), "clip result: Extend comes first (after a grade's own step)", firstClip);
    await ctx.close();
  }

  // 9. Explore: three studios visited show in the menu; blocked storage breaks nothing.
  {
    const ctx = await as("owner");
    const p = await page(ctx);
    for (const r of ["/cinema", "/shorts", "/marketing"]) await openRoute(p, app + r, { settleMs: 400 });
    await p.locator("[data-top-bar]").getByRole("button", { name: /^Account and settings/ }).click();
    const menu = p.getByRole("menu");
    await menu.waitFor();
    const text = await menu.innerText();
    check(/\b3 of 28 studios tried/.test(text) && /Next to try:/.test(text), "explore: 3 visited show as “3 of 28 studios tried” with a next one", text.match(/\d+ of \d+ studios tried/)?.[0]);
    await shot(p, "account-menu-explore-1440");
    await p.keyboard.press("Escape");
    await ctx.close();
    const blocked = await as("guest");
    await blocked.addInitScript(() => {
      const no = () => {
        throw new DOMException("blocked", "SecurityError");
      };
      Object.defineProperty(window, "localStorage", { get: no });
    });
    const q = await page(blocked);
    for (const r of ["/", "/image", "/library"]) {
      await openRoute(q, app + r, { settleMs: 400 });
      check(await q.locator("[data-top-bar]").isVisible(), `blocked storage: ${r} still renders`);
    }
    await q.locator("[data-top-bar]").getByRole("button", { name: "Menu", exact: true }).click();
    check(!/studios tried/.test(await q.getByRole("menu").innerText()), "blocked storage: the menu shows no explore count");
    await blocked.close();
  }

  // 10. What visitors never see.
  for (const who of ["guest", ...(publicSignup ? ["account"] : [])]) {
    const ctx = await as(who);
    const p = await page(ctx);
    await openRoute(p, `${app}/image`);
    const button = who === "guest" ? p.locator("[data-top-bar]").getByRole("button", { name: "Menu", exact: true }) : p.locator("[data-top-bar]").getByRole("button", { name: /^Account: / });
    await button.click();
    const menuText = await p.getByRole("menu").innerText();
    await p.keyboard.press("Escape");
    const phone = await browser.newContext({ ...PHONE, storageState: await ctx.storageState() });
    const q = await phone.newPage();
    await openRoute(q, `${app}/image`);
    await q.locator("[data-phone-tabs]").getByRole("button", { name: "You" }).tap();
    await q.locator("#phone-sheet").waitFor({ state: "visible" });
    const sheetText = await q.locator("#phone-sheet").innerText();
    if (who === "guest") await shot(q, "phone-you-sheet-guest-390");
    await phone.close();
    const said = VISITOR_WORDS.filter((w) => menuText.includes(w) || sheetText.includes(w));
    check(said.length === 0, `${who}: the menu and the You sheet never say setup words`, said.join(", "));
    for (const query of ["comfyui server", "restore colourise"]) {
      await p.keyboard.press("ControlOrMeta+k");
      const dialog = p.getByRole("dialog", { name: "Search Fuobe" });
      await dialog.waitFor();
      await p.keyboard.type(query);
      await p.waitForTimeout(700);
      const values = await dialog.locator("[cmdk-item]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-value")} ${e.textContent}`));
      const bad = values.filter((v) => /setting:comfyui|video-tools-restore|Restore & colourise/i.test(v));
      check(bad.length === 0, `${who}: searching “${query}” offers no owner-only row`, bad.slice(0, 2).join(" | "));
      await p.keyboard.press("Escape");
    }
    await ctx.close();
  }

  // 11. Reduced motion: no transitions on the launcher, sheets and band.
  {
    const ctx = await as("guest", DESKTOP, { reducedMotion: "reduce" });
    const p = await page(ctx);
    await openRoute(p, `${app}/`);
    await p.locator("[data-top-bar]").getByRole("button", { name: /^Studios/ }).click();
    const dur = (sel) => p.locator(sel).first().evaluate((e) => [getComputedStyle(e).transitionDuration, getComputedStyle(e).animationDuration, getComputedStyle(e).animationName]);
    const launcher = await dur("#studios-launcher");
    check(launcher[0].split(",").every((d) => parseFloat(d) === 0) && (launcher[2] === "none" || parseFloat(launcher[1]) === 0), "reduced motion: the launcher doesn't animate", launcher.join(" "));
    await p.keyboard.press("Escape");
    await p.locator('[data-goal="sell"]').click();
    const band = await dur("#goal-band");
    check(band[0].split(",").every((d) => parseFloat(d) === 0) && (band[2] === "none" || parseFloat(band[1]) === 0), "reduced motion: the goal band doesn't animate", band.join(" "));
    await ctx.close();
    const phone = await as("guest", PHONE, { reducedMotion: "reduce" });
    const q = await page(phone);
    await openRoute(q, `${app}/image`);
    await q.locator("[data-phone-tabs]").getByRole("button", { name: "Studios" }).tap();
    await q.locator("#phone-sheet").waitFor({ state: "visible" });
    const sheet = await q.locator("#phone-sheet").evaluate((e) => [getComputedStyle(e).animationName, getComputedStyle(e).animationDuration]);
    check(sheet[0] === "none" || parseFloat(sheet[1]) === 0, "reduced motion: the Studios sheet doesn't slide", sheet.join(" "));
    await phone.close();
  }

  // 12. Screenshots in both themes for review.
  if (shots) {
    for (const scheme of ["dark", "light"]) {
      const ctx = await as("owner", DESKTOP, { colorScheme: scheme });
      const p = await page(ctx);
      await openRoute(p, `${app}/`);
      await shot(p, `bar-home-1440-${scheme}`);
      await p.locator("[data-top-bar]").getByRole("button", { name: /^Studios/ }).click();
      await p.waitForTimeout(400);
      await shot(p, `launcher-1440-${scheme}`);
      await p.keyboard.press("Escape");
      await p.locator('[data-goal="sell"]').click();
      await p.waitForTimeout(500);
      await shot(p, `home-sell-band-1440-${scheme}`);
      await p.keyboard.press("ControlOrMeta+k");
      await p.keyboard.type("ad for my perfume");
      await p.waitForTimeout(900);
      await shot(p, `palette-perfume-1440-${scheme}`);
      await p.keyboard.press("Escape");
      await p.locator("[data-top-bar]").getByRole("button", { name: /^Account and settings/ }).click();
      await p.waitForTimeout(400);
      await shot(p, `account-menu-owner-1440-${scheme}`);
      await ctx.close();
      const phone = await as("owner", PHONE, { colorScheme: scheme });
      const q = await page(phone);
      await openRoute(q, `${app}/`);
      await shot(q, `phone-home-390-${scheme}`);
      await q.locator("[data-phone-tabs]").getByRole("button", { name: "Studios" }).tap();
      await q.waitForTimeout(500);
      await shot(q, `phone-studios-sheet-390-${scheme}`);
      await q.locator("[data-phone-tabs]").locator('[data-tab="you"]').tap();
      await q.waitForTimeout(500);
      await shot(q, `phone-you-sheet-390-${scheme}`);
      await phone.close();
    }
  }
} catch (e) {
  check(false, `stopped: ${e.message.split("\n").slice(0, 4).join(" ")}`);
} finally {
  for (const { ctx, password } of accounts) {
    await ctx.request.delete(`${app}/api/auth/me`, { data: { password } }).catch(() => {});
    await ctx.close().catch(() => {});
  }
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} failed:\n- ${failures.join("\n- ")}` : "\nNavigation checks passed.");
process.exit(failures.length ? 1 : 0);
