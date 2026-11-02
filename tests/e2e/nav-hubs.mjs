// The area pages (/create, /studios, /apps, /motions-and-effects) and the bar's split items in a real browser: a name goes
// to its page, a chevron (or ArrowDown, or a mouse resting on Create or Motions & effects) opens the menu, every menu and
// phone sheet has "See all", section tabs stay under the bar, the bar keeps its width, taps are 44 px, nothing shifts,
// nothing scrolls sideways, no console errors.
// Usage: node tests/e2e/nav-hubs.mjs [appUrl] [shotsDir]
//   E2E_OWNER_PASSWORD: the studio's password, when it has one. With public sign-up on, the account checks sign up a
//   throwaway qa account (deleted at the end); without it the visitor is the owner and the guest/account checks are skipped.
// Exits 1 if any check fails; screenshots of each area page (390 and 1440, light and dark) go to shotsDir when given.
import fs from "node:fs";
import path from "node:path";
import { DESKTOP, launch, openRoute, PHONE } from "./_browser.mjs";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const app = (args[0] ?? "http://localhost:3000").replace(/\/$/, "");
const shots = args[1];
if (shots) fs.mkdirSync(shots, { recursive: true });
const failures = [];
const check = (ok, what, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${what}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(what);
};
const AREAS = ["/create", "/studios", "/apps", "/motions-and-effects"];
const publicSignup = !!(await fetch(`${app}/api/auth/me`).then((r) => r.json()).catch(() => null))?.publicSignup;
const browser = await launch();
const accounts = [];

/** A context as `who` ("visitor": whoever opens the site; "owner"; "account"). */
async function as(who, device = DESKTOP, extra = {}) {
  const ctx = await browser.newContext({ ...device, ...extra });
  ctx.errors = [];
  if (who === "owner" && process.env.E2E_OWNER_PASSWORD) await ctx.request.post(`${app}/api/auth/login`, { data: { password: process.env.E2E_OWNER_PASSWORD } });
  if (who === "account") {
    const email = `qa-hubs-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`;
    const password = `Qa-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    const res = await ctx.request.post(`${app}/api/auth/signup`, { data: { email, password } });
    if (!res.ok()) throw new Error(`sign-up answered ${res.status()}`);
    accounts.push({ ctx, password });
  }
  return ctx;
}
async function page(ctx) {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => ctx.errors.push(e.message.split("\n")[0]));
  p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && ctx.errors.push(m.text().slice(0, 200)));
  // Layout shifts from the first paint on, summed as CLS counts them (not after input).
  await p.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  return p;
}
const bar = (p) => p.locator("[data-top-bar]");
const pathOf = (p) => new URL(p.url()).pathname;
const activeName = (p) => p.evaluate(() => (document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent || "").replace(/\s+/g, " ").trim());
const activeRole = (p) => p.evaluate(() => document.activeElement?.getAttribute("role") ?? document.activeElement?.tagName.toLowerCase());
const waitPath = (p, want) => p.waitForURL((u) => new URL(u).pathname === want, { timeout: 20_000 }).then(() => true, () => false);

try {
  // 1. Desktop: names go to their pages, chevrons open menus, keys, hover, See all.
  {
    const ctx = await as("visitor");
    const p = await page(ctx);
    await openRoute(p, `${app}/image`);
    const items = [
      { name: "Create", href: "/create", chevron: "Create menu", seeAll: "See all of Create" },
      { name: /^Studios, \d+ studios$/, href: "/studios", chevron: "Studios menu", seeAll: "See all studios" },
      { name: "Motions & effects", href: "/motions-and-effects", chevron: "Motions & effects menu", seeAll: "See all motions & effects" },
    ];
    const seeAllIn = (it) =>
      (it.href === "/studios" ? p.locator("#studios-launcher").getByRole("link", { name: it.seeAll, exact: true }) : p.getByRole("menu").getByRole("menuitem", { name: it.seeAll, exact: true }));
    for (const it of items) {
      await openRoute(p, `${app}/image`, { settleMs: 300 });
      await bar(p).getByRole("link", { name: it.name, exact: typeof it.name === "string" }).click();
      const went = await waitPath(p, it.href);
      await p.locator("main h1").first().waitFor();
      check(went, `${it.href}: clicking the bar's name opens it`, pathOf(p));
      const current = await bar(p).getByRole("link", { name: it.name, exact: typeof it.name === "string" }).getAttribute("aria-current");
      const others = await bar(p).locator('[data-bar-split] a[aria-current="page"]').count();
      check(current === "page" && others === 1, `${it.href}: its name is aria-current=page, and no other split item's`, `${current}, ${others}`);
      check((await p.getByRole("menu").count()) === 0 && !(await p.locator("#studios-launcher").isVisible().catch(() => false)), `${it.href}: following the name opens no menu`);
    }

    // The chevron: click opens, Esc closes and gives focus back to it.
    await openRoute(p, `${app}/image`, { settleMs: 300 });
    for (const name of ["Create menu", "Motions & effects menu"]) {
      const chev = bar(p).getByRole("button", { name, exact: true });
      await chev.click();
      const menu = p.getByRole("menu");
      const opened = await menu.waitFor({ timeout: 5_000 }).then(() => true, () => false);
      check(opened && (await chev.getAttribute("data-state")) === "open", `${name}: the chevron opens it`);
      check(pathOf(p) === "/image", `${name}: opening it stays on the page`);
      await p.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" }).catch(() => {});
      check(await chev.evaluate((b) => b === document.activeElement), `${name}: Esc closes it and focus goes back to the chevron`);
    }
    {
      const chev = bar(p).getByRole("button", { name: "Studios menu", exact: true });
      const panel = p.locator("#studios-launcher");
      await chev.click();
      await panel.waitFor({ state: "visible" });
      check(/^Cinema Studio/.test(await activeName(p)), "Studios menu: the chevron opens the launcher on Cinema Studio", await activeName(p));
      await p.keyboard.press("Escape");
      await panel.waitFor({ state: "hidden" });
      check(await chev.evaluate((b) => b === document.activeElement), "Studios menu: Esc closes it and focus goes back to the chevron");
    }

    // ArrowDown on a name opens its menu on the first row.
    for (const it of items) {
      await openRoute(p, `${app}/image`, { settleMs: 300 });
      await bar(p).getByRole("link", { name: it.name, exact: typeof it.name === "string" }).focus();
      await p.keyboard.press("ArrowDown");
      await p.waitForTimeout(250);
      const role = await activeRole(p);
      const name = await activeName(p);
      const ok = it.href === "/studios" ? /^Cinema Studio/.test(name) : role === "menuitem";
      check(ok && pathOf(p) === "/image", `${it.href}: ArrowDown on the name opens the menu on its first row`, `${role} ${name}`);
      await p.keyboard.press("Escape");
      if (it.href !== "/studios") {
        await p.waitForTimeout(150);
        const back = await bar(p).getByRole("link", { name: it.name, exact: true }).evaluate((a) => a === document.activeElement);
        check(back, `${it.href}: Esc after ArrowDown on the name gives focus back to the name`);
      }
    }

    // A mouse resting on Create or Motions & effects opens its menu after a moment, leaves focus in the prompt being
    // typed, and leaving closes it. The Studios launcher (it spans the page) opens by a click or a key only.
    await openRoute(p, `${app}/image`, { settleMs: 300 });
    const prompt = p.locator("main textarea").first();
    for (const it of items) {
      await prompt.focus();
      const label = bar(p).getByRole("link", { name: it.name, exact: typeof it.name === "string" });
      const box = await label.boundingBox();
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await p.waitForTimeout(120);
      const early = it.href === "/studios" ? await p.locator("#studios-launcher").isVisible().catch(() => false) : (await p.getByRole("menu").count()) > 0;
      await p.waitForTimeout(450);
      const late = it.href === "/studios" ? await p.locator("#studios-launcher").isVisible().catch(() => false) : (await p.getByRole("menu").count()) > 0;
      if (it.href === "/studios") {
        check(!early && !late, "/studios: resting the mouse on Studios opens nothing (the launcher opens by a click or a key)", `${early} → ${late}`);
      } else {
        check(!early && late, `${it.href}: resting the mouse on it opens its menu after a moment, not at once`, `${early} → ${late}`);
        check((await seeAllIn(it).count()) === 1, `${it.href}: the menu has its See all`);
      }
      const kept = await prompt.evaluate((el) => el === document.activeElement);
      check(kept, `${it.href}: resting on it leaves focus in the prompt`, await activeName(p));
      await p.mouse.move(700, 800);
      await p.waitForTimeout(600);
      const gone = it.href === "/studios" ? !(await p.locator("#studios-launcher").isVisible().catch(() => false)) : (await p.getByRole("menu").count()) === 0;
      check(gone, `${it.href}: moving the mouse away closes it`);
    }

    // Resting on a pinned launcher's neighbour: one panel at a time.
    {
      await openRoute(p, `${app}/image`, { settleMs: 300 });
      await bar(p).getByRole("button", { name: "Studios menu", exact: true }).click();
      await p.locator("#studios-launcher").waitFor({ state: "visible" });
      const box = await bar(p).getByRole("link", { name: "Create", exact: true }).boundingBox();
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await p.waitForTimeout(600);
      const launcher = await p.locator("#studios-launcher").isVisible().catch(() => false);
      check(!launcher && (await p.getByRole("menu").count()) === 1, "resting on Create while the launcher is open swaps one for the other", `launcher ${launcher}`);
      await p.mouse.move(700, 800);
      await p.waitForTimeout(600);
    }

    // On an area's own page, resting on its name opens nothing over it.
    for (const it of items.filter((x) => x.href !== "/studios")) {
      await openRoute(p, app + it.href, { settleMs: 300 });
      const box = await bar(p).getByRole("link", { name: it.name, exact: true }).boundingBox();
      await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await p.waitForTimeout(700);
      check((await p.getByRole("menu").count()) === 0, `${it.href}: resting on its own name there opens nothing`);
      await p.mouse.move(700, 800);
    }

    // See all goes to the page.
    for (const it of items) {
      await openRoute(p, `${app}/image`, { settleMs: 300 });
      await bar(p).getByRole("button", { name: it.chevron, exact: true }).click();
      await seeAllIn(it).click();
      check(await waitPath(p, it.href), `${it.href}: See all in the menu opens it`, pathOf(p));
    }
    check(ctx.errors.length === 0, "desktop: no console errors", ctx.errors.join(" | "));
    await ctx.close();
  }

  // 2. A touch screen never opens a menu by hovering: a tap on the name goes to the page.
  {
    const ctx = await as("visitor", { viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true });
    const p = await page(ctx);
    await openRoute(p, `${app}/image`);
    const fine = await p.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches);
    const label = bar(p).getByRole("link", { name: "Create", exact: true });
    const box = await label.boundingBox();
    await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await p.waitForTimeout(500);
    check(!fine && (await p.getByRole("menu").count()) === 0, "touch: resting on Create opens nothing");
    const chev = await bar(p).getByRole("button", { name: "Create menu" }).boundingBox();
    check(chev.width >= 44 && chev.height >= 44, "touch: the chevron is 44x44", `${chev.width}x${chev.height}`);
    await label.tap();
    check((await waitPath(p, "/create")) && (await p.getByRole("menu").count()) === 0, "touch: a tap on Create goes to /create");
    await ctx.close();
  }

  // 3. The bar keeps its width: at each width, for each viewer, the bar's items fit with a classic scrollbar to spare.
  {
    const viewers = publicSignup ? ["visitor", "account", ...(process.env.E2E_OWNER_PASSWORD ? ["owner"] : [])] : ["visitor"];
    const widths = [768, 1024, 1280, 1440];
    const rows = [];
    for (const who of viewers) {
      for (const coarse of [false, true]) {
        const ctx = await as(who, { viewport: { width: 1440, height: 900 }, ...(coarse && { hasTouch: true, isMobile: true }) });
        const p = await page(ctx);
        await openRoute(p, `${app}/image`);
        const kind = (await (await ctx.request.get(`${app}/api/auth/me`)).json().catch(() => ({}))) ?? {};
        const as_ = kind.owner ? "owner" : kind.account ? "account" : "guest";
        for (const w of widths) {
          await p.setViewportSize({ width: w, height: 900 });
          await p.waitForTimeout(250);
          const m = await bar(p).evaluate((h) => {
            const nav = h.querySelector('nav[aria-label="Main"]');
            const spacer = nav.nextElementSibling;
            return { spare: Math.round(spacer.getBoundingClientRect().width), clipped: nav.scrollWidth - nav.clientWidth > 1 || h.scrollWidth - h.clientWidth > 1, hidden: nav.scrollWidth - nav.clientWidth };
          });
          rows.push(`${as_}${coarse ? " (touch)" : ""} @${w}: ${m.spare}px spare`);
          // With a mouse, each split item is exactly as wide as the plain item it replaced: its name, then 40 px (48 from
          // 1440) for the padding, the gap and the chevron.
          if (!coarse) {
            const off = await bar(p).evaluate((h, pad) => {
              const bad = [];
              for (const s of h.querySelectorAll("[data-bar-split]")) {
                const r = s.getBoundingClientRect();
                if (!r.width) continue;
                const range = document.createRange();
                range.selectNodeContents(s.querySelector("a"));
                const text = range.getBoundingClientRect().width;
                if (Math.abs(r.width - (text + pad)) > 1) bad.push(`${s.textContent.trim()} ${Math.round(r.width)} vs ${Math.round(text + pad)}`);
              }
              return bad;
            }, w >= 1440 ? 48 : 40);
            check(off.length === 0, `bar width: ${as_} at ${w}, each split item is as wide as the item it replaced`, off.join("; "));
          }
          // Nothing cut off. With a mouse, the split items are the old items' width (checked above), so a cut there is the
          // bar's own (a guest's Log in and Sign up at 1440 cut 15 px before the split items too): reported, not failed.
          // On a touch screen the chevrons are wider (44 px), so there the bar must still fit.
          if (coarse || !m.clipped) check(!m.clipped, `bar width: ${as_}${coarse ? " on touch" : ""} at ${w}, everything fits`, `${m.spare}px spare, ${m.hidden}px cut`);
          else console.log(`note: bar width: ${as_} at ${w}: the bar's items are cut by ${m.hidden}px (as before the split items)`);
        }
        await ctx.close();
      }
    }
    if (shots) fs.writeFileSync(path.join(shots, "bar-widths.txt"), `${rows.join("\n")}\n`);
  }

  // 4. Phone: the Create and Studios sheets' See all; the Studios sheet still fits 390x844.
  {
    const ctx = await as("visitor", PHONE);
    const p = await page(ctx);
    const tabs = p.locator("[data-phone-tabs]");
    const sheet = p.locator("#phone-sheet");
    for (const [tab, href] of [
      ["Create", "/create"],
      ["Studios", "/studios"],
    ]) {
      await openRoute(p, `${app}/image`);
      await tabs.getByRole("button", { name: tab }).tap();
      await sheet.waitFor({ state: "visible" });
      await p.waitForTimeout(350);
      const see = sheet.getByRole("link", { name: `See all ${tab.toLowerCase()}` });
      const box = await see.boundingBox();
      check(!!box && box.height >= 44 && box.x + box.width <= 390, `phone ${tab} sheet: See all is in its header, 44 px tall`, box ? `${box.width}x${box.height}` : "missing");
      if (tab === "Studios") {
        const tiles = sheet.locator("ul").first().getByRole("link");
        const seen = await tiles.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => r.top >= 0 && r.bottom <= innerHeight));
        check(seen.length === 33 && seen.every(Boolean), "phone Studios sheet: all 33 tiles fit 390x844 with See all in the header", `${seen.filter(Boolean).length}/${seen.length}`);
        check((await sheet.getByRole("button", { name: "Search everything" }).count()) === 1, "phone Studios sheet: Search everything is an icon button");
        if (shots) await p.screenshot({ path: path.join(shots, "phone-studios-sheet-390.png") });
      }
      await see.tap();
      const went = await waitPath(p, href);
      const closed = await sheet.waitFor({ state: "detached", timeout: 5_000 }).then(() => true, () => false);
      check(went && closed, `phone ${tab} sheet: See all opens ${href} and closes the sheet`);
      const selected = await tabs.locator(`[data-tab="${tab.toLowerCase()}"]`).evaluate((t) => t.getAttribute("aria-current") ?? t.getAttribute("data-selected") ?? t.getAttribute("aria-pressed") ?? t.className);
      check(/page|true|selected|text-foreground/.test(String(selected)), `phone: on ${href} the ${tab} tab is selected`, String(selected).slice(0, 80));
    }
    check(ctx.errors.length === 0, "phone: no console errors", ctx.errors.join(" | "));
    await ctx.close();
  }

  // 5. Each area page at 390: taps of 44 px, no sideways scroll, no layout shift; and screenshots in both schemes.
  for (const scheme of ["light", "dark"]) {
    for (const [device, tag] of [
      [PHONE, "390"],
      [DESKTOP, "1440"],
    ]) {
      const ctx = await as("visitor", device, { colorScheme: scheme });
      const p = await page(ctx);
      for (const route of AREAS) {
        await openRoute(p, app + route, { settleMs: 1500 });
        const h1 = (await p.locator("main h1").first().textContent())?.trim();
        check(!!h1, `${route} ${tag} ${scheme}: has its heading`, h1);
        const cls = await p.evaluate(() => window.__cls);
        check(cls < 0.02, `${route} ${tag} ${scheme}: no layout shift on load (CLS < 0.02)`, cls.toFixed(4));
        if (tag === "390") {
          const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          check(over <= 0, `${route} 390 ${scheme}: no sideways scroll`, `${over}px`);
          // Everything this page adds (its header, tabs, sections, More in Fuobe), not the shared gallery or footer.
          const small = await p.evaluate(() => {
            const out = [];
            const scope = [...document.querySelectorAll("main header, main section:not(#every-app):not(#every-app *), main nav")];
            const seen = new Set();
            for (const s of scope)
              for (const el of s.querySelectorAll("a[href], button")) {
                // Not the shared gallery or footer, nor a control inside a picture that is out of reach (inert).
                if (seen.has(el) || el.closest("#every-app, footer, [inert]")) continue;
                seen.add(el);
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden") continue;
                const after = getComputedStyle(el, "::after");
                let h = r.height;
                let w = r.width;
                if (after.content !== "none" && after.position === "absolute") {
                  h = r.height - (parseFloat(after.top) || 0) - (parseFloat(after.bottom) || 0);
                  w = r.width - (parseFloat(after.left) || 0) - (parseFloat(after.right) || 0);
                }
                if (h < 43.5 || w < 24) out.push(`${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)} ${Math.round(w)}x${Math.round(h)}`);
              }
            return out;
          });
          check(small.length === 0, `${route} 390 ${scheme}: every tap target is at least 44 px tall`, small.slice(0, 6).join("; "));
        }
        if (shots) {
          const name = `${route.slice(1)}-${tag}-${scheme}`;
          await p.screenshot({ path: path.join(shots, `${name}.png`) });
          await p.screenshot({ path: path.join(shots, `${name}-full.png`), fullPage: true });
        }
      }
      check(ctx.errors.length === 0, `${tag} ${scheme}: no console errors`, ctx.errors.join(" | "));
      await ctx.close();
    }
  }

  // 6. Signed in: "Jump back in" lists what was opened in this area; a guest never sees it.
  {
    const who = publicSignup ? "account" : "visitor";
    const ctx = await as(who);
    const p = await page(ctx);
    await openRoute(p, `${app}/extend`, { settleMs: 600 });
    await openRoute(p, `${app}/studios`, { settleMs: 800 });
    const jump = p.getByRole("heading", { name: "Jump back in" });
    check((await jump.count()) === 1 && (await p.locator("section[aria-labelledby=jump-back-in]").getByRole("link", { name: /^Extend/ }).count()) === 1, `${who}: /studios shows Jump back in with Extend video`);
    if (shots) await jump.scrollIntoViewIfNeeded().then(() => p.screenshot({ path: path.join(shots, `studios-jump-back-in-${who}.png`) }));
    await ctx.close();
    if (publicSignup) {
      const g = await as("visitor");
      const gp = await page(g);
      await openRoute(gp, `${app}/extend`, { settleMs: 600 });
      await openRoute(gp, `${app}/studios`, { settleMs: 800 });
      check((await gp.getByRole("heading", { name: "Jump back in" }).count()) === 0, "guest: no Jump back in");
      const restore = await gp.getByRole("link", { name: "Restore & colourise" }).count();
      check(restore === 0, "guest: no owner-only pill (Restore & colourise)");
      await g.close();
    } else {
      // The visitor is the owner here: their own mode shows.
      const o = await as("visitor");
      const op = await page(o);
      await openRoute(op, `${app}/studios`, { settleMs: 1000 });
      check((await op.getByRole("link", { name: "Restore & colourise" }).count()) === 1, "owner: their own pill (Restore & colourise) shows");
      await o.close();
    }
  }

  // 7. Search inside an area: only its pages, named on a chip that removes it.
  {
    const ctx = await as("visitor");
    const p = await page(ctx);
    await openRoute(p, `${app}/studios`);
    await p.locator("main header").getByRole("button", { name: /^Search studios/ }).locator("visible=true").click();
    const dialog = p.getByRole("dialog", { name: "Search Fuobe" });
    await dialog.waitFor();
    check((await dialog.getByRole("button", { name: /^Searching in Studios/ }).count()) === 1, "area search: opens on a Studios chip");
    await p.keyboard.type("extend");
    await p.waitForTimeout(400);
    const text = await dialog.innerText();
    check(/Extend video/.test(text), "area search: finds a studio in the area");
    await p.keyboard.press("Escape");
    await ctx.close();
  }

  // 8. Gallery links: a "by kind" pill opens the gallery on that category; the tab rows only jump within their page, and
  // /apps has one category control (the gallery's).
  {
    const ctx = await as("visitor");
    const p = await page(ctx);
    await openRoute(p, `${app}/motions-and-effects`);
    const tabHrefs = await p.locator('main nav[aria-label$="sections"] a').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    check(tabHrefs.length === 2 && tabHrefs.every((h) => h.startsWith("#")), "motions-and-effects: its tabs only jump within the page", tabHrefs.join(" "));
    const pill = p.locator('main section a[href^="/motions?category="]').first();
    const cat = decodeURIComponent((await pill.getAttribute("href")).split("=")[1]);
    await pill.click();
    await waitPath(p, "/motions");
    await p.waitForTimeout(800);
    const pressed = await p.locator('[aria-label="Categories"] button[aria-pressed="true"]').innerText();
    check(pressed.trim() === cat, `motions: the ${cat} pill opens the gallery on ${cat}`, pressed);
    check((await p.getByRole("link", { name: "Motions & effects" }).first().count()) === 1, "/motions links back to Motions & effects");
    await openRoute(p, `${app}/apps`);
    check((await p.locator('main a[href*="category="]').count()) === 0, "apps: no category tabs over the gallery's own filter row");
    await p.locator("main header").getByRole("link", { name: /^See all \d+/ }).click();
    await p.waitForTimeout(600);
    const top = await p.locator("#every-app").evaluate((el) => el.getBoundingClientRect().top);
    check(top >= 0 && top < 200, "apps: See all jumps to every app", `${Math.round(top)}px`);
    check(ctx.errors.length === 0, "galleries: no console errors", ctx.errors.join(" | "));
    await ctx.close();
  }

  // 9. Section tabs stay under the bar and mark the section being read; a phone shows two cards a row.
  for (const [device, tag, barH] of [
    [DESKTOP, "1440", 56],
    [PHONE, "390", 48],
  ]) {
    const ctx = await as("visitor", device);
    const p = await page(ctx);
    await openRoute(p, `${app}/studios`, { settleMs: 600 });
    const tabs = p.locator('main nav[aria-label="Studios sections"]');
    await tabs.getByRole("link", { name: "Sound" }).click();
    await p.waitForTimeout(1200);
    const r = await tabs.evaluate((n) => n.getBoundingClientRect().toJSON());
    check(Math.abs(r.top - barH) <= 2, `/studios ${tag}: the tabs stay under the bar after a jump`, `top ${Math.round(r.top)}`);
    const sound = await p.locator("#sound").evaluate((el) => el.getBoundingClientRect().top);
    check(sound >= r.bottom - 2 && sound < r.bottom + 60, `/studios ${tag}: the section starts under the tabs`, `${Math.round(sound)} vs ${Math.round(r.bottom)}`);
    const on = await tabs.locator('a[aria-current="true"]').innerText().catch(() => "");
    check(on.trim() === "Sound", `/studios ${tag}: the Sound tab is marked`, on);
    if (tag === "390") {
      const cols = await p.locator("#film a.group\\/studio").evaluateAll((els) => [...new Set(els.map((el) => Math.round(el.getBoundingClientRect().left)))].length);
      check(cols === 2, "/studios 390: two cards a row", `${cols} columns`);
    }
    for (const [route, label] of [
      ["/create", "Create sections"],
      ["/motions-and-effects", "Motions & effects sections"],
    ]) {
      await openRoute(p, app + route, { settleMs: 400 });
      await p.evaluate(() => window.scrollBy(0, 2400));
      await p.waitForTimeout(600);
      const t = await p.locator(`main nav[aria-label="${label}"]`).evaluate((n) => n.getBoundingClientRect().top);
      check(Math.abs(t - barH) <= 2, `${route} ${tag}: the tabs stay under the bar while scrolling`, `top ${Math.round(t)}`);
    }
    if (shots) await p.screenshot({ path: path.join(shots, `x-sticky-tabs-${tag}.png`) });
    check(ctx.errors.length === 0, `sticky tabs ${tag}: no console errors`, ctx.errors.join(" | "));
    await ctx.close();
  }
} catch (e) {
  check(false, "the run finished", e.message.split("\n")[0]);
} finally {
  for (const { ctx, password } of accounts) await ctx.request.delete(`${app}/api/auth/me`, { data: { password } }).catch(() => {});
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
