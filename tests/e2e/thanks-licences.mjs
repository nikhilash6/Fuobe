// Thanks & licences, as a guest: the page opens from the footer with Built on at the top (ComfyUI first, with its
// licence), the model makers (a maker's card keeps only its rows until cleared), the names some licences ask for (each
// with a Show all list), then every group with its jump chips, a search that narrows the rows and says when nothing
// matches, and no sideways scroll at 390 and 1440 px, light and dark, with 44 px taps on a phone. Then six feature pages
// that used to show licence notes show none.
// Usage: node tests/e2e/thanks-licences.mjs [appUrl] [--shots <dir>]   (the app with a password and FUOBE_PUBLIC_SIGNUP=1,
// so a browser with no session is a guest). Exits 1 on a failed check.
import fs from "node:fs";
import path from "node:path";
import { DESKTOP, launch, openRoute, PHONE } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(84)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};
const shot = (page, name, fullPage = false) => shots && page.screenshot({ path: path.join(shots, `${name}.png`), fullPage });
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

const GROUPS = ["Image models", "Video models", "Audio", "3D", "LoRAs", "ComfyUI node packs", "Code and libraries"];
/** Words a feature page no longer shows: the licence lines and notices that moved to Thanks & licences. */
const NOTES = /Models and licences|Community License|not licensed in|Built with DINOv3|Licence: |Licences \(for your information\)|non-commercial weights|Apache-2\.0|GPL-3\.0/i;
/** Feature pages that showed a licence note before (a box, a picker line, a notice), and still render for a guest. */
const FEATURES = ["/character-swap", "/genjutsu?mode=character", "/image-to-3d", "/apps/app-any-angle", "/live-edit", "/video-tools/remove-object"];

const browser = await launch();
for (const [label, device] of [
  ["390", PHONE],
  ["1440", DESKTOP],
]) {
  for (const scheme of ["light", "dark"]) {
    const tag = `${label} ${scheme}`;
    const context = await browser.newContext({ ...device, colorScheme: scheme });
    const page = await context.newPage();

    // The footer leads there (Home), as a guest.
    if (scheme === "light") {
      await openRoute(page, `${app}/`);
      const footer = page.locator("footer").getByRole("link", { name: "Thanks & licences" });
      check(`${tag}: the footer links to Thanks & licences`, (await footer.count()) > 0 && (await footer.first().getAttribute("href")) === "/settings/licences");
    }

    await openRoute(page, `${app}/settings/licences`);
    check(`${tag}: the page opens for a guest`, (await page.locator("h1").first().innerText()).trim() === "Thanks & licences");
    const nav = page.getByRole("navigation", { name: "Jump to a group" });
    const chips = (await nav.getByRole("link").allInnerTexts()).map((t) => t.replace(/\s+\d+$/, "").trim());
    check(`${tag}: a jump chip for each group`, GROUPS.every((g) => chips.includes(g)), chips.join(", "));
    for (const g of GROUPS) check(`${tag}: ${g} is listed`, (await page.getByRole("heading", { level: 2, name: new RegExp(`^${g.replace(/[()]/g, "\\$&")}`) }).count()) === 1);
    // Built on: ComfyUI first, with its page and licence.
    const builtOn = page.locator("#thanks-built-on").locator("..");
    const firstName = (await builtOn.locator("p.font-heading").first().innerText()).trim();
    check(`${tag}: Built on thanks ComfyUI first`, firstName === "ComfyUI", firstName);
    check(`${tag}: ComfyUI links its code and its GPL-3.0 licence`, (await builtOn.locator('a[href="https://github.com/Comfy-Org/ComfyUI"]').count()) > 0 && (await builtOn.getByRole("link", { name: /GPL-3\.0/ }).count()) > 0);
    const builtText = await builtOn.innerText();
    check(`${tag}: Built on names Hugging Face, Next.js, React, three.js and FFmpeg`, ["Hugging Face", "Next.js", "React", "three.js", "FFmpeg"].every((n) => builtText.includes(n)));
    check(`${tag}: the model makers name Qwen, Ideogram, Black Forest Labs, Wan and MiniMax`, ["Qwen team", "Ideogram", "Black Forest Labs", "Wan team", "MiniMax"].every((n) => builtText.includes(n)));

    // The names licences ask for stay on show, each with a count and a Show all list.
    const creditsBox = page.locator("#thanks-credits").locator("..");
    const credits = await creditsBox.innerText();
    check(`${tag}: the credits name MiniMax H3, DINOv3 and Llama`, /MiniMax H3/.test(credits) && /Built with DINOv3/.test(credits) && /Built with Llama/.test(credits));
    check(`${tag}: and say why they're there`, /licences ask us to show their name/.test(credits));
    const h3 = creditsBox.locator("li", { hasText: "MiniMax H3" }).first();
    check(`${tag}: MiniMax H3 says how many rows carry it`, /In \d+ models and tools/.test(await h3.innerText()));
    const h3List = h3.locator("details ul");
    check(`${tag}: its list is folded away`, !(await h3List.isVisible()));
    await h3.locator("summary").click();
    check(`${tag}: Show all lists every one`, (await h3List.isVisible()) && (await h3List.locator("li").count()) > 5, `${await h3List.locator("li").count()} names`);
    check(`${tag}: no sideways scroll`, await noSideways(page));
    if (label === "390") {
      const small = await page.evaluate(() =>
        [...document.querySelectorAll("[data-thanks] a, [data-thanks] button, [data-thanks] input, [data-thanks] summary, a[href=\"/settings#about\"]")]
          .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== "hidden")
          .map((el) => ({ h: el.getBoundingClientRect().height, t: (el.textContent || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim().slice(0, 30) }))
          .filter((x) => x.h < 43.5),
      );
      check(`${tag}: every tap target is at least 44 px tall`, small.length === 0, small.slice(0, 4).map((s) => `${s.t}=${Math.round(s.h)}`).join(" | "));
    }
    await h3.locator("summary").click();
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(300);
    await shot(page, `thanks-${label}-${scheme}`);

    // A maker's card keeps only the rows that run its models, until it is cleared.
    await page.locator('a[href="#by-ideogram"]').click();
    await page.waitForTimeout(1200);
    const status = page.getByRole("status").filter({ hasText: "Models by" });
    check(`${tag}: a maker's card filters the list`, (await status.innerText().catch(() => "")).includes("Ideogram"));
    const imageRows = await page.locator("#thanks-image li").allInnerTexts();
    check(`${tag}: to that maker's rows`, imageRows.length > 0 && imageRows.some((t) => t.includes("Ideogram 4")) && (await page.locator("#thanks-loras").count()) === 0, `${imageRows.length} image rows`);
    const listTop = await page.locator("#thanks-image").evaluate((el) => el.getBoundingClientRect().top);
    const viewH = await page.evaluate(() => innerHeight);
    check(`${tag}: and brings them into view`, listTop > 0 && listTop < viewH - 80, `top ${Math.round(listTop)} of ${viewH}`);
    await shot(page, `thanks-${label}-${scheme}-maker`);
    await page.getByRole("button", { name: "Show everything" }).click();
    await page.waitForTimeout(400);
    check(`${tag}: clearing the maker brings every group back`, (await page.locator("section[id^='thanks-']").count()) >= GROUPS.length);

    // A chip jumps to its group.
    await nav.getByRole("link", { name: /^ComfyUI node packs/ }).click();
    await page.waitForTimeout(2000);
    const top = await page.locator("#thanks-packs").evaluate((el) => el.getBoundingClientRect().top);
    check(`${tag}: a chip jumps to its group`, top >= -2 && top < 260, `top ${Math.round(top)}`);

    // Search narrows the rows; nothing found is said.
    const search = page.getByRole("searchbox", { name: /Search models, LoRAs/ });
    await search.fill("dinov3");
    await page.waitForTimeout(400);
    const rows = await page.locator("#thanks-3d li").count();
    check(`${tag}: a search narrows the rows`, rows > 0 && (await page.locator("#thanks-loras").count()) === 0, `${rows} 3D rows`);
    await shot(page, `thanks-${label}-${scheme}-search`);
    await search.fill("zzzz-nothing");
    await page.waitForTimeout(400);
    check(`${tag}: and says when nothing matches`, await page.getByText("Nothing matches that search.").isVisible());
    await page.getByRole("button", { name: "Clear the search" }).click();
    await page.waitForTimeout(400);
    check(`${tag}: clearing it brings every group back`, (await page.locator("section[id^='thanks-']").count()) >= GROUPS.length);

    // The feature pages that used to show notes.
    if (scheme === "light") {
      for (const route of FEATURES) {
        await openRoute(page, `${app}${route}`, { settleMs: 1500 });
        const text = await page.locator("main").first().innerText().catch(() => "");
        const hit = text.match(NOTES)?.[0];
        check(`${tag}: ${route} shows no licence note`, !hit, hit ?? "");
        check(`${tag}: ${route} has no sideways scroll`, await noSideways(page));
        await shot(page, `feature-${label}${route.replace(/[/?=&]+/g, "-")}`);
      }
    }
    await context.close();
  }
}
await browser.close();

console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
