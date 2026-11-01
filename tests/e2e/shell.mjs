// App-shell checks in a real browser (the app must be running; demo mode is fine).
// Usage: node tests/e2e/shell.mjs [appUrl]   (pnpm test:e2e:shell). Exits 1 on the first failure.
//
// 1. Phone: the sidebar drawer closes when a link in it is tapped (nav item, New creation, footer),
//    and its Search row opens the ⌘K palette.
// 2. A first visit shows Studios and folds Engine, with Library right after Create; a collapsed group
//    still shows the page you're on.
// 3. Landmarks: "Skip to content" is the first Tab stop, one <main>, the sidebar is <nav "Main">.
// 4. ⌘K / Ctrl+K opens the palette; a typo still finds a page and Enter opens it; Esc gives focus
//    back to the composer; an open-source model picked under the Cloud switch opens on its engine.
// 5. Full-screen studios (Assist, an open Cinema or Layers project…) fold the app sidebar to its rail
//    without changing the remembered state; opened by hand, it stays open inside that studio only.
// 6. Deep links into Settings (/settings#comfyui) scroll to the section after a client navigation.
// 7. Galleries: "Show more" pressed from the keyboard moves focus to the first new card.
// 8. New creation on Home starts over (empty composer, focused); the sidebar's bottom fade is never
//    deeper than what's hidden below it.
// 9. With public sign-up on: an account sees its email in the sidebar, and its menu signs it out
//    (a throwaway qa account, deleted at the end).
import assert from "node:assert/strict";
import path from "node:path";
import { DESKTOP, launch, openRoute, PHONE, root } from "./_browser.mjs";

const app = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const browser = await launch();
const step = (name) => console.log(`- ${name}`);

try {
  {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    for (const [from, link, to] of [
      ["/models", /^Effects$/, "/effects"],
      ["/effects", /^New creation/, "/"],
      ["/", /^Favorites$/, "/library"],
      // The footer's engine status links to Settings too.
      ["/models", /^Cloud models/, "/settings"],
    ]) {
      step(`phone: tapping “${link.source.replace(/[\^$]/g, "")}” in the drawer on ${from} closes it`);
      await openRoute(page, app + from);
      await page.getByRole("button", { name: "Toggle Sidebar" }).first().tap();
      const drawer = page.locator('[data-mobile="true"]');
      await drawer.waitFor({ state: "visible" });
      await drawer.getByRole("link", { name: link }).first().tap();
      await page.waitForURL((u) => new URL(u).pathname === to, { timeout: 20_000 });
      await drawer.waitFor({ state: "detached", timeout: 5_000 });
    }
    step("phone: Search in the drawer opens the palette");
    await openRoute(page, `${app}/models`);
    await page.getByRole("button", { name: "Toggle Sidebar" }).first().tap();
    await page.locator('[data-mobile="true"]').getByRole("button", { name: /^Search/ }).tap();
    await page.getByRole("dialog", { name: "Search Fuobe" }).waitFor();
    await page.locator('[data-mobile="true"]').waitFor({ state: "detached", timeout: 5_000 });
    await ctx.close();
  }
  {
    const ctx = await browser.newContext(DESKTOP);
    const page = await ctx.newPage();
    step("a first visit shows Studios, folds Engine, and Library follows Create");
    await openRoute(page, `${app}/image`);
    const groups = await page.locator("[data-nav-group]").evaluateAll((els) => els.map((e) => [e.getAttribute("data-nav-group"), e.getAttribute("data-open")]));
    assert.deepEqual(groups, [["create", "true"], ["library", "true"], ["studios", "true"], ["engine", "false"]]);

    step("Skip to content is the first Tab stop; one <main>; the sidebar is a navigation landmark");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Skip to content");
    await page.keyboard.press("Enter");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "content");
    assert.equal(await page.locator("main").count(), 1, "one <main>");
    assert.ok((await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Video" }).count()) > 0, "sidebar links are inside <nav aria-label=Main>");

    step("⌘K / Ctrl+K opens the palette; “cinma” finds Cinema Studio; Enter opens it");
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "Search Fuobe" });
    await dialog.waitFor();
    await page.keyboard.type("cinma");
    // The start list (which also lists Cinema Studio) gives way to the matches.
    await dialog.getByRole("option", { name: /^New creation/ }).waitFor({ state: "detached" });
    await dialog.getByRole("option", { name: /^Cinema Studio/ }).first().waitFor();
    await page.keyboard.press("Enter");
    await page.waitForURL((u) => new URL(u).pathname === "/cinema", { timeout: 20_000 });
    await dialog.waitFor({ state: "detached" });

    step("Esc closes the palette and gives focus back to the composer you were typing in");
    await openRoute(page, `${app}/image`);
    const box = page.locator("[data-composer] textarea").first();
    await box.click();
    await page.keyboard.type("a red fox");
    await page.keyboard.press("ControlOrMeta+k");
    await dialog.waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await page.waitForTimeout(100);
    assert.ok(await page.evaluate(() => !!document.activeElement?.matches("[data-composer] textarea")), "focus is back in the composer");

    step("an open-source model picked under the Cloud switch opens on the open engine");
    await page.evaluate(() => localStorage.setItem("fuobe.engine", "cloud"));
    await openRoute(page, `${app}/video`);
    await page.keyboard.press("ControlOrMeta+k");
    await dialog.waitFor();
    await page.keyboard.type("FLUX.2 [dev]");
    await dialog.getByRole("option", { name: /^FLUX\.2 \[dev\]/ }).first().waitFor();
    await page.keyboard.press("Enter");
    await page.waitForURL((u) => new URL(u).pathname === "/image" && new URL(u).searchParams.get("model") === "oss-flux2-dev", { timeout: 20_000 });
    await page.getByRole("button", { name: /^Model: FLUX\.2 \[dev\]\./ }).waitFor({ timeout: 20_000 });
    assert.equal(await page.evaluate(() => localStorage.getItem("fuobe.engine")), "open", "the switch moved to Open source");
    await ctx.close();
  }
  {
    const ctx = await browser.newContext(DESKTOP);
    const page = await ctx.newPage();
    step("full-screen studios fold the app sidebar to its rail, and it comes back on the way out");
    const sidebar = page.locator('[data-slot="sidebar"]').first();
    await openRoute(page, `${app}/assist`);
    assert.equal(await sidebar.getAttribute("data-state"), "collapsed", "folded on Assist");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Image", exact: true }).click();
    await page.waitForURL((u) => new URL(u).pathname === "/image");
    await page.waitForFunction(() => document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state") === "expanded");
    const cookies = await ctx.cookies();
    assert.ok(!cookies.some((c) => c.name === "sidebar_state" && c.value === "false"), "the remembered state is untouched");

    step("opened by hand in Assist, the sidebar stays open on Assist's own pages, and folds again next time");
    const nav = page.getByRole("navigation", { name: "Main" });
    const state = (s) => page.waitForFunction((s) => document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state") === s, s);
    await nav.getByRole("link", { name: "Assist", exact: true }).click();
    await page.waitForURL((u) => new URL(u).pathname === "/assist");
    await state("collapsed");
    await nav.getByRole("button", { name: "Toggle Sidebar" }).click();
    await state("expanded");
    await page.evaluate(() => window.next.router.push("/assist/skills"));
    await page.waitForURL((u) => new URL(u).pathname === "/assist/skills");
    await page.waitForTimeout(300);
    assert.equal(await sidebar.getAttribute("data-state"), "expanded", "still open on Skills");
    await nav.getByRole("link", { name: "Image", exact: true }).click();
    await page.waitForURL((u) => new URL(u).pathname === "/image");
    await nav.getByRole("link", { name: "Assist", exact: true }).click();
    await page.waitForURL((u) => new URL(u).pathname === "/assist");
    await state("collapsed");
    assert.ok(!(await ctx.cookies()).some((c) => c.name === "sidebar_state"), "no cookie written");
    await ctx.close();
  }
  {
    // Below 1440 px the Layers editor used to fold the sidebar itself, writing the cookie.
    const ctx = await browser.newContext({ ...DESKTOP, viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    step("reopening a Layers project leaves the remembered sidebar state alone");
    await openRoute(page, `${app}/layers`);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Upload Media" }).first().click();
    await (await chooser).setFiles(path.join(root, "public/samples/grade-sample.jpg"));
    await page.waitForURL(/\/layers\/[\w-]+$/, { timeout: 60_000 });
    await page.getByRole("button", { name: "Separate layers" }).waitFor({ timeout: 60_000 });
    await page.getByRole("link", { name: "All projects" }).click();
    await page.waitForURL((u) => new URL(u).pathname === "/layers");
    await page.getByRole("link", { name: /^Open project/ }).first().click();
    await page.waitForURL(/\/layers\/[\w-]+$/);
    await page.getByRole("button", { name: "Separate layers" }).waitFor({ timeout: 60_000 });
    await page.getByRole("link", { name: "All projects" }).click();
    await page.waitForURL((u) => new URL(u).pathname === "/layers");
    await page.waitForFunction(() => document.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state") === "expanded");
    assert.ok(!(await ctx.cookies()).some((c) => c.name === "sidebar_state" && c.value === "false"), "the cookie still says expanded");
    await ctx.close();
  }
  {
    const ctx = await browser.newContext(DESKTOP);
    const page = await ctx.newPage();
    step("a collapsed group still shows the active page");
    await openRoute(page, `${app}/cinema`);
    const studios = page.locator('[data-nav-group="studios"]');
    if ((await studios.getAttribute("data-open")) !== "false") await studios.locator("[data-nav-toggle]").click();
    assert.equal(await studios.getAttribute("data-open"), "false");
    assert.ok(await studios.getByRole("link", { name: "Cinema Studio" }).isVisible(), "Cinema Studio stays visible");
    assert.ok(!(await studios.getByRole("link", { name: "Upscale" }).isVisible()), "other Studios items are folded away");
    await studios.locator("[data-nav-toggle]").click(); // leave it open for the next run

    step("/workflows → Server settings scrolls to the ComfyUI section");
    await openRoute(page, `${app}/workflows`);
    await page.getByRole("link", { name: "Server settings" }).click();
    await page.waitForURL(/\/settings#comfyui$/);
    await page.locator("#comfyui").waitFor();
    await page.waitForTimeout(400);
    const top = await page.locator("#comfyui").evaluate((el) => el.getBoundingClientRect().top);
    assert.ok(top >= -2 && top < 300, `ComfyUI section near the top of the screen (top ${Math.round(top)}px)`);

    step("Show more from the keyboard focuses the first new card");
    await openRoute(page, `${app}/effects`);
    const cards = page.locator("main a[href^='/video?preset=']");
    const before = await cards.count();
    const more = page.getByRole("button", { name: /Show more/ });
    await more.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("href"));
    assert.equal(focused, await cards.nth(before).getAttribute("href"));
    await ctx.close();
  }
  {
    const ctx = await browser.newContext(DESKTOP);
    const page = await ctx.newPage();
    step("New creation on Home clears the prompt, focuses the composer and leaves no flag in the address");
    await openRoute(page, `${app}/`);
    const box = page.getByRole("textbox", { name: "Describe what to create" });
    await box.fill("a red fox");
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "New creation" }).click();
    await page.waitForFunction(() => location.search === "" && document.activeElement?.getAttribute("aria-label") === "Describe what to create", null, { timeout: 10_000 });
    assert.equal(await box.inputValue(), "");

    step("the sidebar's bottom fade is no deeper than what's hidden below it");
    const fade = await page.locator('[data-sidebar="content"]').evaluate((el) => ({
      hidden: el.scrollHeight - el.clientHeight - el.scrollTop,
      depth: parseFloat(el.style.getPropertyValue("--fade-b")) || 0,
    }));
    assert.ok(fade.depth <= Math.max(0, Math.ceil(fade.hidden)) && fade.depth <= 40, `fade ${fade.depth}px for ${fade.hidden}px hidden`);
    await ctx.close();
  }
  if (!(await fetch(`${app}/api/auth/me`).then((r) => r.json()).catch(() => null))?.publicSignup) {
    step("(skipped: the account row needs public sign-up)");
  } else {
    const ctx = await browser.newContext(DESKTOP);
    const page = await ctx.newPage();
    step("an account sees its email in the sidebar, and its menu signs it out");
    const email = `qa-shell-${Date.now().toString(36)}@example.com`;
    const password = `Qa-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    try {
      assert.ok((await ctx.request.post(`${app}/api/auth/signup`, { data: { email, password } })).ok(), "signed up");
      await openRoute(page, `${app}/`);
      const nav = page.getByRole("navigation", { name: "Main" });
      await nav.getByText(email).waitFor({ timeout: 15_000 });
      await nav.getByRole("button", { name: `Account: ${email}` }).click();
      const menu = page.getByRole("menu");
      for (const name of ["Settings", "Your GPU", "Sign out"]) await menu.getByRole("menuitem", { name }).waitFor();
      await menu.getByRole("menuitem", { name: "Sign out" }).click();
      await nav.getByRole("link", { name: "Log in" }).waitFor({ timeout: 15_000 });
      assert.equal(await nav.getByText(email).count(), 0, "signed out");
    } finally {
      await ctx.request.post(`${app}/api/auth/login`, { data: { email, password } }).catch(() => {});
      const gone = await ctx.request.delete(`${app}/api/auth/me`, { data: { password } }).catch(() => null);
      if (gone?.status() !== 204) console.warn(`  (couldn't delete ${email}: ${gone?.status()})`);
      await ctx.close();
    }
  }
  console.log("\nShell checks passed.");
} catch (e) {
  console.error(`\nFAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
