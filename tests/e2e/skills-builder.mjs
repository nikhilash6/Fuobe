// Skills W2 in a real browser (demo mode: no keys, ComfyUI unreachable). A 3-step chain is made in the composer — a
// picture (Image), an edit of it (Edit, with a photo of the product too) and a clip of the edit (Video) — then selected
// in the Library and turned into a skill with the bulk bar's "Make a skill": the review screen shows the 3 steps,
// waiting for each other; one input is switched to Varies and words selected in a prompt become an input of their own;
// Check it prices it and dry-runs it for free; Save opens the
// Run form ("Try it with new inputs"), which runs it with new words. That whole flow runs at 1440 px light (words picked
// with the mouse) and at 390 px dark (on a phone, the words typed: the keyboard's way). The result ⋯ menu offers "Make a
// skill from this…" too, and so does a creation opened from ⌘K (a viewer outside the page). At 1440 and 390 px, light
// and dark: nothing scrolls sideways, on a phone the review fills the screen and the bulk bar keeps Make a skill. The
// skills are deleted at the end.
// Usage: node tests/e2e/skills-builder.mjs [appUrl] [--shots <dir>]   (app running in demo mode). Exits 1 on a failed check.
import fs from "node:fs";
import path from "node:path";
import { launch, openRoute, root } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const errors = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(76)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};
const api = async (method, route, body) => {
  const res = await fetch(app + route, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return res.status === 204 ? null : res.json().catch(() => null);
};

async function upload(file, type, name) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(path.join(root, file))], { type }), name);
  const res = await fetch(`${app}/api/uploads`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return (await res.json()).url;
}

const tag = `sb${Date.now().toString(36).slice(-5)}`;
const photo = await upload("public/samples/grade-sample.jpg", "image/jpeg", "lamp.jpg");

/** The newest generation whose prompt is these words, once it has finished. */
async function made(words, ms = 60_000) {
  const until = Date.now() + ms;
  for (;;) {
    const r = await api("GET", `/api/generations?q=${encodeURIComponent(words)}&limit=5`);
    const g = (r?.items ?? []).find((x) => x.request?.prompt === words);
    if (g && ["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > until) throw new Error(`no finished generation for “${words}”`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

const seen = (locator, ms = 20_000) =>
  locator
    .first()
    .waitFor({ state: "visible", timeout: ms })
    .then(() => true)
    .catch(() => false);
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const shot = (page, name) => shots && page.screenshot({ path: path.join(shots, `${name}.png`) });

/** Type the words in a studio's composer and press Generate. */
async function compose(page, route, words) {
  await openRoute(page, app + route, { settleMs: 1200 });
  await page.getByRole("textbox", { name: "Prompt" }).first().fill(words);
  await page.getByRole("button", { name: /^Generate$/ }).first().click();
  return made(words);
}

const words = { still: `${tag} brass desk lamp, studio light`, edit: `${tag} brass desk lamp on a travertine plinth`, clip: `${tag} slow turntable of the brass desk lamp` };
const skillNames = [];
const browser = await launch();
try {
  // ---------------------------------------------------------------------------
  // 1. A 3-step chain in the composer, its results handed on as the result tiles do (Edit, Animate).
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    const still = await compose(page, "/image", words.still);
    const edit = await compose(page, `/edit?image=${encodeURIComponent(still.outputs[0].url)}&ref=${encodeURIComponent(photo)}`, words.edit);
    const clip = await compose(page, `/video?image=${encodeURIComponent(edit.outputs[0].url)}`, words.clip);
    check("the composer made the chain (picture → edit → clip)", [still, edit, clip].every((g) => g.status === "succeeded") && clip.kind === "video", [still, edit, clip].map((g) => `${g.op}:${g.status}`).join(" "));
    await ctx.close();
  }

  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    for (const scheme of ["light", "dark"]) {
      const tagLine = `${width} ${scheme}`;
      const phone = width < 500;
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, ...(phone ? { isMobile: true, hasTouch: true } : {}) });
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await openRoute(page, `${app}/library`, { settleMs: 1200 });
      await page.getByRole("textbox", { name: "Search prompts" }).fill(tag);
      await page.waitForTimeout(1500);
      const dialog = page.getByRole("dialog");

      if ((width === 1440 && scheme === "light") || (phone && scheme === "dark")) {
        // 2. Select the three results, then Make a skill from the bulk bar.
        await page.getByRole("button", { name: "Select", exact: true }).click();
        for (const w of Object.values(words)) await page.getByRole("button", { name: new RegExp(`^Select “${w.slice(0, 24)}`) }).first().click({ force: true });
        const bar = page.getByRole("toolbar", { name: "Selection" });
        await bar.getByRole("button", { name: "Make a skill" }).click();
        check(`${tagLine}: Make a skill opens the review screen`, await seen(dialog.getByRole("heading", { name: "Make a skill" })));
        check(`${tagLine}: it shows the 3 steps behind them`, await seen(dialog.getByText("What changes next time"), 30_000) && (await dialog.locator("ol > li").count()) === 3);
        check(`${tagLine}: each waits for the one before`, (await dialog.getByText(/^waits for /).count()) === 2);
        check(`${tagLine}: it says they were demo results`, await seen(dialog.getByText(/Made from demo results/)));
        check(`${tagLine}: every input starts Fixed`, (await dialog.getByRole("radio", { name: "Varies", checked: true }).count()) === 0);
        // 3. One input varies: the picture's words. And two words of the edit's prompt become an input of their own
        //    (selected in the text), which every prompt that has them shares.
        const words1 = dialog.getByRole("radiogroup", { name: /Words for “Text to image”/ });
        await words1.getByRole("radio", { name: "Varies" }).click();
        check(`${tagLine}: one input switched to Varies`, (await dialog.getByText("1 input for the Run form").count()) === 1);
        const editRow = dialog.locator("li", { has: page.getByRole("radiogroup", { name: /Words for “Image edit”/ }) });
        if (!phone) {
          // Selected in the text (the selection is read as it changes).
          await editRow.locator("p.select-text").evaluate((el) => {
            const node = [...el.childNodes].map((n) => (n.nodeType === 3 ? n : n.firstChild)).find((n) => n?.textContent?.includes("brass desk lamp"));
            const at = node.textContent.indexOf("brass desk lamp");
            const range = document.createRange();
            range.setStart(node, at);
            range.setEnd(node, at + "brass desk lamp".length);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          });
        } else {
          // Typed: "type them" focuses the field, and words not in the prompt can't become an input.
          await editRow.getByRole("button", { name: "type them" }).click();
          const field = editRow.getByRole("textbox", { name: "Words from the prompt to make an input" });
          await field.waitFor();
          await page.waitForTimeout(150);
          check(`${tagLine}: "type them" puts the keyboard in the words field`, await field.evaluate((el) => el === document.activeElement));
          await page.keyboard.type("brass desk lamps");
          check(`${tagLine}: words that aren't in the prompt can't become an input`, await editRow.getByRole("button", { name: "Make it an input" }).isDisabled());
          await page.keyboard.press("Backspace");
          await editRow.getByRole("textbox", { name: "Its label" }).fill("Brass desk lamp");
        }
        await editRow.getByRole("button", { name: "Make it an input" }).click();
        check(`${tagLine}: selected words become an input, marked in the text`, (await dialog.locator("mark", { hasText: "brass desk lamp" }).count()) >= 1 && (await dialog.getByText("2 inputs for the Run form").count()) === 1);
        await shot(page, `builder-${width}-${scheme}`);
        // 4. Check it: priced on each engine, then a free dry run in the background.
        await dialog.getByRole("button", { name: "Check it" }).click();
        check(`${tagLine}: Check it passes the plan`, await seen(dialog.getByText(/^It runs on /), 60_000), (await dialog.locator("[aria-live=polite]").last().innerText().catch(() => "")).slice(0, 120));
        check(`${tagLine}: the dry run passes (free, on the demo provider)`, await seen(dialog.getByText("Dry run passed"), 120_000));
        // 5. Save: the Run form opens with the inputs it was made from.
        const title = await dialog.getByLabel("Title").inputValue();
        const skillName = await page.locator("#sb-name").inputValue();
        skillNames.push(skillName);
        await api("DELETE", `/api/assist/skills/${skillName}`);
        await dialog.getByRole("button", { name: "Save skill" }).click();
        check(`${tagLine}: Save opens "Try it with new inputs"`, await seen(page.getByRole("dialog").getByText(/Try it with new inputs/), 30_000));
        const view = await api("GET", `/api/assist/skills/${skillName}/recipe`);
        check(`${tagLine}: the skill is saved with its recipe (3 steps, 2 inputs)`, view?.recipe?.steps?.length === 3 && view.recipe.params.length === 2, `${view?.recipe?.steps?.length} steps, ${view?.recipe?.params?.map((p) => p.id).join(", ")}`);
        check(`${tagLine}: the words' input is in both prompts that had them`, view?.recipe?.steps?.filter((st) => /\{\{brass_desk_lamp\}\}/.test(st.request?.prompt ?? "")).length === 2);
        check(`${tagLine}: its checks came with it`, !!view?.recipe?.verified?.cloud?.plan || !!view?.recipe?.verified?.open?.plan);
        const run = page.getByRole("dialog");
        check(`${tagLine}: the Run form has the words it was made from`, (await run.getByRole("textbox").first().inputValue()) === words.still, title);
        await run.getByRole("textbox").first().fill(`${tag} green ceramic vase, studio light`);
        check(`${tagLine}: the run is priced first`, await seen(run.getByText(/Placeholder · free|Free on your GPU|on Cloud/), 30_000));
        await run.getByRole("button", { name: /^Run/ }).click();
        check(`${tagLine}: Run starts it`, await seen(page.getByText("Started the run"), 30_000));
        const r = await api("GET", "/api/generations?limit=50&steps=1");
        const mine = (r?.items ?? []).filter((g) => g.request?.skill?.name === skillName);
        check(`${tagLine}: one run of 3 steps with the new words`, mine.length === 3 && mine.some((g) => g.request.prompt === `${tag} green ceramic vase, studio light`) && mine.some((g) => g.request.prompt === `${tag} slow turntable of the brass desk lamp`), `${mine.length} rows`);
        // The run's rows share the chain's words: once done, to the Trash, out of the next flow's selection.
        for (const until = Date.now() + 60_000; Date.now() < until; await new Promise((r) => setTimeout(r, 500))) {
          const rows = ((await api("GET", "/api/generations?limit=50&steps=1"))?.items ?? []).filter((g) => g.request?.skill?.name === skillName);
          if (rows.every((g) => ["succeeded", "failed", "canceled"].includes(g.status))) break;
        }
        if (mine.length) await api("POST", "/api/generations/bulk", { action: "trash", ids: mine.map((g) => g.id) });
        await page.keyboard.press("Escape");
      }

      // The result ⋯ menu offers it too (here the picture alone: one step, its words an input to choose); the review fits.
      await openRoute(page, `${app}/library`, { settleMs: 1200 });
      await page.getByRole("textbox", { name: "Search prompts" }).fill(words.still);
      await page.waitForTimeout(1500);
      const card = page.locator("div.group\\/card", { has: page.getByRole("button", { name: new RegExp(`Open “${words.still.slice(0, 24)}`) }) }).first();
      if (!phone) await card.hover();
      await card.getByRole("button", { name: "More actions" }).click();
      const item = page.getByRole("menuitem", { name: "Make a skill from this…" });
      check(`${tagLine}: the result ⋯ menu offers "Make a skill from this…"`, await seen(item, 10_000));
      await item.click();
      check(`${tagLine}: it opens the review of that result's step`, (await seen(dialog.getByText("What changes next time"), 30_000)) && (await dialog.locator("ol > li").count()) === 1 && (await dialog.getByText("Prompt", { exact: true }).count()) === 1);
      check(`${tagLine}: nothing scrolls sideways`, await noSideScroll(page));
      if (phone) {
        // Measured at rest: the dialog opens with a short zoom (from 95 %), and a box read while it runs is that much
        // smaller (389×841 for a 390×844 review three quarters of the way in) whatever its layout is.
        await dialog.evaluate((el) => Promise.race([Promise.all(el.getAnimations().map((a) => a.finished)).catch(() => {}), new Promise((r) => setTimeout(r, 5000))]));
        const box = await dialog.boundingBox();
        check(`${tagLine}: on a phone the review fills the screen`, !!box && box.width >= width - 1 && box.height >= height - 2, box ? `${Math.round(box.width)}×${Math.round(box.height)}` : "");
        const inner = await dialog.evaluate((el) => [...el.querySelectorAll("*")].every((n) => n.scrollWidth <= n.clientWidth + 1 || getComputedStyle(n).overflowX !== "visible" || n.tagName === "PRE"));
        check(`${tagLine}: nothing inside the review is cut off sideways`, inner);
      }
      await shot(page, `builder-menu-${width}-${scheme}`);
      await page.keyboard.press("Escape");

      if (!phone && scheme === "light") {
        // A viewer outside the page (a creation opened from ⌘K) makes a skill too.
        await openRoute(page, `${app}/settings`, { settleMs: 1200 });
        await page.keyboard.press("Control+k");
        const palette = page.getByRole("dialog", { name: "Search Fuobe" });
        await palette.waitFor();
        await page.keyboard.type(words.still);
        await page.waitForTimeout(1500);
        await palette.getByRole("option").filter({ hasText: words.still }).first().click();
        await page.getByRole("button", { name: "Make a skill from this…" }).last().click();
        check(`${tagLine}: from a creation opened with ⌘K, Make a skill opens the review`, await seen(page.getByRole("dialog").getByText("What changes next time"), 30_000));
        await page.keyboard.press("Escape");
      }

      if (phone) {
        // The bulk bar keeps Make a skill on a phone (its label hides, the button stays), and still fits.
        await openRoute(page, `${app}/library`, { settleMs: 1200 });
        await page.getByRole("button", { name: "Select", exact: true }).click();
        await page.getByRole("button", { name: /^Select “/ }).first().click({ force: true });
        const bar = page.getByRole("toolbar", { name: "Selection" });
        check(`${tagLine}: the bulk bar keeps Make a skill`, await bar.getByRole("button", { name: "Make a skill" }).isVisible());
        check(`${tagLine}: every bulk action fits`, await bar.evaluate((el) => el.scrollWidth <= el.clientWidth + 1));
        check(`${tagLine}: the Library doesn't scroll sideways`, await noSideScroll(page));
      }
      await context.close();
    }
  }
} catch (e) {
  failures.push(`the script stopped: ${e.message}`);
  console.log(`FAIL the script stopped: ${e.stack ?? e}`);
} finally {
  await browser.close().catch(() => {});
  for (const n of skillNames) await api("DELETE", `/api/assist/skills/${n}`).catch(() => {});
}
if (errors.length) console.log(`page errors:\n${errors.join("\n")}`);
console.log(failures.length || errors.length ? `${failures.length} check(s) failed` : "All skill builder checks passed");
process.exit(failures.length || errors.length ? 1 : 0);
