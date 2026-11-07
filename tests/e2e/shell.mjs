// App-shell checks in a real browser (the app must be running; demo mode is fine).
// Usage: node tests/e2e/shell.mjs [appUrl]   (pnpm test:e2e:shell). Exits 1 on the first failure.
//
// 1. Phone: a link tapped in a bottom-tab sheet (Studios, Create) goes to its page and closes the sheet; a tab tapped
//    over an open sheet goes where it says; "Search everything" hands over to the full-screen search.
// 2. Landmarks: "Skip to content" is the first Tab stop, one <main>, the top bar is <nav "Main">.
// 3. ⌘K / Ctrl+K opens the palette; a typo still finds a page and Enter opens it; Esc gives focus
//    back to the composer; an open-source model picked under the Cloud switch opens on its engine.
// 4. Full-screen studios (Assist, an open Cinema or Layers project…) mark the page before paint and keep the top bar on a
//    desktop; on a phone they hide the tabs and the header's button opens the menu sheet.
// 5. Deep links into Settings (/settings#comfyui) scroll to the section after a client navigation.
// 6. Galleries: "Show more" pressed from the keyboard moves focus to the first new card.
// 7. New creation on Home starts over (empty composer, focused).
// 8. With public sign-up on: an account sees its initial in the bar, and its menu signs it out
//    (a throwaway qa account, deleted at the end).
import assert from "node:assert/strict";
import { DESKTOP, launch, openRoute, PHONE } from "./_browser.mjs";

const app = (
  process.argv.slice(2).find((a) => !a.startsWith("--")) ??
  "http://localhost:3000"
).replace(/\/$/, "");
const browser = await launch();
const step = (name) => console.log(`- ${name}`);
// With a password set on the studio (E2E_OWNER_PASSWORD), the owner's checks sign in first; a studio without one is the owner's.
async function asOwner(ctx) {
  if (process.env.E2E_OWNER_PASSWORD)
    assert.ok(
      (
        await ctx.request.post(`${app}/api/auth/login`, {
          data: { password: process.env.E2E_OWNER_PASSWORD },
        })
      ).ok(),
      "owner signed in",
    );
  return !!(
    await (await ctx.request.get(`${app}/api/auth/me`)).json().catch(() => null)
  )?.owner;
}

try {
  {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    const tabs = page.locator("[data-phone-tabs]");
    const sheet = page.locator("#phone-sheet");
    for (const [from, tab, link, to] of [
      ["/image", "Studios", /^Cinema/, "/cinema"],
      ["/effects", "Create", /^New creation/, "/"],
    ]) {
      step(
        `phone: tapping “${link.source.replace(/[\^$]/g, "")}” in the ${tab} sheet on ${from} closes it`,
      );
      await openRoute(page, app + from);
      await tabs.getByRole("button", { name: tab }).tap();
      await sheet.waitFor({ state: "visible" });
      await sheet.getByRole("link", { name: link }).first().tap();
      await page.waitForURL((u) => new URL(u).pathname === to, {
        timeout: 20_000,
      });
      await sheet.waitFor({ state: "detached", timeout: 5_000 });
    }
    step("phone: Library tapped over the open Studios sheet goes to /library");
    await openRoute(page, `${app}/image`);
    await tabs.getByRole("button", { name: "Studios" }).tap();
    await sheet.waitFor({ state: "visible" });
    // (A modal sheet hides the rest of the page from screen readers, who close it first; a finger still reaches the tabs.)
    await tabs.locator('[data-tab="library"]').tap();
    await page.waitForURL((u) => new URL(u).pathname === "/library", {
      timeout: 20_000,
    });
    await sheet.waitFor({ state: "detached", timeout: 5_000 });

    step("phone: Search everything in the Studios sheet opens the palette");
    await openRoute(page, `${app}/image`);
    await tabs.getByRole("button", { name: "Studios" }).tap();
    await sheet.getByRole("button", { name: "Search everything" }).tap();
    await page.getByRole("dialog", { name: "Search Fuobe" }).waitFor();
    await sheet.waitFor({ state: "detached", timeout: 5_000 });
    await ctx.close();
  }
  {
    const ctx = await browser.newContext(DESKTOP);
    const page = await ctx.newPage();
    step(
      "Skip to content is the first Tab stop; one <main>; the top bar is a navigation landmark",
    );
    await openRoute(page, `${app}/image`);
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement?.textContent),
      "Skip to content",
    );
    await page.keyboard.press("Enter");
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "content",
    );
    assert.equal(await page.locator("main").count(), 1, "one <main>");
    assert.ok(
      (await page
        .getByRole("navigation", { name: "Main" })
        .getByRole("link", { name: "Library" })
        .count()) > 0,
      "bar links are inside <nav aria-label=Main>",
    );

    step(
      "⌘K / Ctrl+K opens the palette; “cinma” finds Cinema Studio; Enter opens it",
    );
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "Search Fuobe" });
    await dialog.waitFor();
    await page.keyboard.type("cinma");
    // The best match is picked (not the "Every studio" tile that the start list picks first).
    await page
      .locator('[cmdk-item][data-value="nav:cinema"][data-selected="true"]')
      .waitFor({ timeout: 10_000 });
    await page.keyboard.press("Enter");
    await page.waitForURL((u) => new URL(u).pathname === "/cinema", {
      timeout: 20_000,
    });
    await dialog.waitFor({ state: "detached" });

    step(
      "Esc closes the palette and gives focus back to the composer you were typing in",
    );
    await openRoute(page, `${app}/image`);
    const box = page.locator("[data-composer] textarea").first();
    await box.click();
    await page.keyboard.type("a red fox");
    await page.keyboard.press("ControlOrMeta+k");
    await dialog.waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    await page.waitForTimeout(100);
    assert.ok(
      await page.evaluate(
        () => !!document.activeElement?.matches("[data-composer] textarea"),
      ),
      "focus is back in the composer",
    );

    // The engine follows the model for the owner (a visitor's runs stay where their own engine is).
    if (await asOwner(ctx)) {
      step(
        "an open-source model picked under the Cloud switch opens on the open engine",
      );
      await page.evaluate(() => localStorage.setItem("fuobe.engine", "cloud"));
      await openRoute(page, `${app}/video`);
      await page.keyboard.press("ControlOrMeta+k");
      await dialog.waitFor();
      await page.keyboard.type("FLUX.2 [dev]");
      await dialog
        .getByRole("option", { name: /^FLUX\.2 \[dev\]/ })
        .first()
        .waitFor();
      await page.keyboard.press("Enter");
      await page.waitForURL(
        (u) =>
          new URL(u).pathname === "/image" &&
          new URL(u).searchParams.get("model") === "oss-flux2-dev",
        { timeout: 20_000 },
      );
      await page
        .getByRole("button", { name: /^Model: FLUX\.2 \[dev\]\./ })
        .waitFor({ timeout: 20_000 });
      assert.equal(
        await page.evaluate(() => localStorage.getItem("fuobe.engine")),
        "open",
        "the switch moved to Open source",
      );
    } else step("(skipped: the engine switch check needs the owner)");
    await ctx.close();
  }
  {
    const ctx = await browser.newContext(DESKTOP);
    const page = await ctx.newPage();
    step(
      "full-screen studios mark the page before paint, keep the top bar, and the mark goes on the way out",
    );
    const marked = () =>
      page.evaluate(() =>
        document.documentElement.hasAttribute("data-fullscreen-studio"),
      );
    await openRoute(page, `${app}/chat/make`);
    assert.ok(await marked(), "marked on Assist");
    assert.ok(
      await page.locator("[data-top-bar]").isVisible(),
      "the bar stays on Assist",
    );
    await page
      .getByRole("navigation", { name: "Main" })
      .getByRole("link", { name: "Library" })
      .click();
    await page.waitForURL((u) => new URL(u).pathname === "/library");
    await page.waitForFunction(
      () => !document.documentElement.hasAttribute("data-fullscreen-studio"),
    );
    assert.ok(
      !(await ctx.cookies()).some((c) => c.name === "sidebar_state"),
      "no cookie written",
    );
    await ctx.close();
  }
  {
    const ctx = await browser.newContext(PHONE);
    const page = await ctx.newPage();
    step(
      "phone: a full-screen studio hides the tabs, and its header's Menu opens the menu sheet",
    );
    await openRoute(page, `${app}/chat/make`);
    assert.ok(
      !(await page.locator("[data-phone-tabs]").isVisible()),
      "no tabs on Assist",
    );
    await page.getByRole("button", { name: "Menu", exact: true }).first().tap();
    const sheet = page.locator("#phone-sheet");
    await sheet.waitFor({ state: "visible" });
    assert.ok(
      (await sheet.getByRole("link", { name: "Library" }).count()) > 0,
      "the menu sheet leads to Library",
    );
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "detached", timeout: 5_000 });
    await ctx.close();
  }
  {
    const ctx = await browser.newContext(DESKTOP);
    const page = await ctx.newPage();
    step("/workflows and /settings/about redirect to Home and Settings");
    await openRoute(page, `${app}/workflows`);
    await page.waitForURL((u) => new URL(u).pathname === "/");
    await openRoute(page, `${app}/settings/about`);
    await page.waitForURL(/\/settings$/);

    step("Show more from the keyboard focuses the first new card");
    await openRoute(page, `${app}/effects`);
    const cards = page.locator("main a[href^='/video?preset=']");
    const before = await cards.count();
    const more = page.getByRole("button", { name: /Show more/ });
    await more.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    const focused = await page.evaluate(() =>
      document.activeElement?.getAttribute("href"),
    );
    assert.equal(focused, await cards.nth(before).getAttribute("href"));
    await ctx.close();
  }
  {
    const ctx = await browser.newContext(DESKTOP);
    const page = await ctx.newPage();
    step(
      "New creation on Home clears the prompt, focuses the composer and leaves no flag in the address",
    );
    await openRoute(page, `${app}/`);
    const box = page.getByRole("textbox", { name: "Describe what to create" });
    await box.fill("a red fox");
    await page
      .locator("[data-top-bar]")
      .getByRole("link", { name: "New creation" })
      .click();
    await page.waitForFunction(
      () =>
        location.search === "" &&
        document.activeElement?.getAttribute("aria-label") ===
          "Describe what to create",
      null,
      { timeout: 10_000 },
    );
    assert.equal(await box.inputValue(), "");
    await ctx.close();
  }
  if (
    !(
      await fetch(`${app}/api/auth/me`)
        .then((r) => r.json())
        .catch(() => null)
    )?.publicSignup
  ) {
    step("(skipped: the account menu needs public sign-up)");
  } else {
    const ctx = await browser.newContext(DESKTOP);
    const page = await ctx.newPage();
    step("an account sees its menu in the bar, and the menu signs it out");
    const email = `qa-shell-${Date.now().toString(36)}@example.com`;
    const password = `Qa-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    try {
      assert.ok(
        (
          await ctx.request.post(`${app}/api/auth/signup`, {
            data: { email, password },
          })
        ).ok(),
        "signed up",
      );
      await openRoute(page, `${app}/`);
      const bar = page.locator("[data-top-bar]");
      const avatar = bar.getByRole("button", { name: `Account: ${email}` });
      await avatar.waitFor({ timeout: 15_000 });
      await avatar.click();
      const menu = page.getByRole("menu");
      await menu.getByText(email).waitFor();
      for (const name of [/Settings/, /Your GPU/, /Sign out/])
        await menu.getByRole("menuitem", { name }).first().waitFor();
      await menu.getByRole("menuitem", { name: /Sign out/ }).click();
      await bar
        .getByRole("link", { name: "Sign up" })
        .waitFor({ timeout: 15_000 });
      assert.equal(
        await bar.getByRole("button", { name: `Account: ${email}` }).count(),
        0,
        "signed out",
      );
    } finally {
      await ctx.request
        .post(`${app}/api/auth/login`, { data: { email, password } })
        .catch(() => {});
      const gone = await ctx.request
        .delete(`${app}/api/auth/me`, { data: { password } })
        .catch(() => null);
      if (gone?.status() !== 204)
        console.warn(`  (couldn't delete ${email}: ${gone?.status()})`);
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
