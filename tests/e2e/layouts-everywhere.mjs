// Layouts everywhere in the browser (nothing is run: no GPU, no fal key): the Canvas Layout node and its editor (boxes drawn by touch
// at 390 px, Plan layout from a sentence, Done back on the card), Marketing Studio's "Words drawn by the model" switch with
// its hint and the drawing model in Settings, and Ads Studio's switch with its hint. Each at 1440 and 390 px, light and
// dark: the controls render, nothing scrolls sideways, keyboard focus reaches every new control, no console errors.
// Usage: node tests/e2e/layouts-everywhere.mjs [appUrl] [--shots <dir>]   (a server in demo mode: FUOBE_DEMO_MODE=on)
import fs from "node:fs";
import path from "node:path";
import { launch } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(90)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};
const api = async (p, body) => (await fetch(app + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

// A board: a Layout node (one box) into MOSS-Image on your GPU.
const layout = { summary: { caption: "", meta: [], canvas: "single" }, items: [{ label: "text", caption: "Bold", text: "30% OFF", box: [0.1, 0.05, 0.9, 0.2] }], aspect: "3:4" };
const newCanvas = () =>
  api("/api/canvases", {
    name: "Layouts",
    graph: {
      nodes: [
        { id: "l", type: "layout", position: { x: 0, y: 0 }, data: { layout } },
        { id: "m", type: "model", position: { x: 420, y: 0 }, data: { modelId: "oss-moss-image", mediaKind: "image", params: { aspectRatio: "3:4" } } },
      ],
      edges: [{ id: "e1", source: "l", sourceHandle: "out", target: "m", targetHandle: "prompt" }],
    },
  });
const first = await newCanvas();
check("api: a board with a Layout node saves", !!first.id, first.error ?? "");
// A brand with a product, for Ads Studio.
const brand = await api("/api/brands", { name: "Ember & Wick", description: "Small-batch soy candles", colors: ["#a3411f", "#f6efe3"] });
const brandId = brand.id ?? brand.brand?.id;
const product = brandId ? await api("/api/products", { brandId, name: "Autumn Soy Candle", description: "Amber glass jar", images: [] }) : {};
check("api: a brand and a product for Ads Studio", !!brandId && !!product.id, JSON.stringify(brand).slice(0, 120));

const browser = await launch();
const errorsOf = (page) => {
  const errs = [];
  page.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  page.on("pageerror", (e) => errs.push(e.message));
  return errs;
};
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const shoot = (page, name) => (shots ? page.screenshot({ path: path.join(shots, name) }) : undefined);
/** Tab until the element (a locator) has focus, up to n presses. */
const tabTo = async (page, locator, n = 80) => {
  const el = await locator.elementHandle();
  for (let i = 0; i < n; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate((e) => document.activeElement === e || e.contains(document.activeElement), el)) return true;
  }
  return false;
};

try {
  for (const width of [1440, 390]) {
    for (const scheme of ["light", "dark"]) {
      const tag = `${width} ${scheme}`;
      const phone = width < 500;
      const context = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, colorScheme: scheme, ...(phone && { isMobile: true, hasTouch: true }) });
      await context.addInitScript(() => {
        try {
          localStorage.setItem("fuobe.engine", "open");
        } catch {}
      });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const errs = errorsOf(page);

      // --- Canvas: the Layout node and its editor (a fresh board each time)
      const canvas = await newCanvas();
      await page.goto(`${app}/canvas/${canvas.id}`, { waitUntil: "load" });
      const card = page.locator(".react-flow__node-layout").first();
      await card.waitFor();
      await page.waitForTimeout(1200);
      check(
        `${tag} canvas: the Layout node shows its box${phone ? "" : " and Edit layout"}`,
        (await card.innerText()).includes("1 box") && (phone || (await card.getByRole("button", { name: "Edit layout", exact: true }).count()) === 1),
      );
      // Phones edit in the Nodes list (the board is read-only there).
      if (phone)
        await page
          .getByRole("button", { name: "Nodes", exact: true })
          .or(page.getByRole("tab", { name: "Nodes", exact: true }))
          .first()
          .click();
      const edit = phone ? page.getByRole("button", { name: "Edit layout", exact: true }).first() : card.getByRole("button", { name: "Edit layout", exact: true });
      await edit.waitFor();
      check(`${tag} canvas: keyboard focus reaches Edit layout`, await tabTo(page, edit, 120));
      await edit.click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      const board = dialog.locator("[data-layout-canvas]");
      await board.waitFor();
      check(`${tag} editor: opens on the board's 3:4 canvas sized for MOSS-Image`, /3:4/.test(await dialog.innerText()));
      // Draw a box: by touch on a phone, with the mouse on a desktop.
      const b = await board.boundingBox();
      const from = { x: b.x + b.width * 0.2, y: b.y + b.height * 0.4 };
      const to = { x: b.x + b.width * 0.7, y: b.y + b.height * 0.8 };
      if (phone) {
        const cdp = await context.newCDPSession(page);
        const touch = (type, p) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: p ? [{ x: p.x, y: p.y, id: 1 }] : [] });
        await touch("touchStart", from);
        for (let i = 1; i <= 8; i++) await touch("touchMove", { x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 });
        await touch("touchEnd");
      } else {
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 8 });
        await page.mouse.up();
      }
      await page.waitForTimeout(300);
      check(`${tag} editor: dragging draws a second box${phone ? " (touch)" : ""}`, (await board.locator("[data-layout-box]").count()) === 2);
      // Plan layout from the whole picture's words.
      const plan = dialog.getByRole("button", { name: "Plan layout" });
      if (phone && !(await plan.isVisible()))
        await dialog
          .getByRole("button", { name: /boxes|box/ })
          .first()
          .click();
      await dialog.locator("#layout-caption").fill("a sale poster for my candle shop, 30% off");
      check(`${tag} editor: Plan layout is there with its hint`, (await plan.isVisible()) && (await dialog.locator("#layout-plan-hint").isVisible()));
      if (!phone) {
        await dialog.locator("#layout-caption").focus();
        await page.keyboard.press("Shift+Tab");
        check(`${tag} editor: keyboard focus reaches Plan layout`, await plan.evaluate((e) => document.activeElement === e));
      }
      await plan.click();
      await page.waitForFunction(() => document.querySelectorAll("[data-layout-box]").length >= 3, null, { timeout: 30_000 }).catch(() => {});
      const planned = await board.locator("[data-layout-box]").count();
      check(`${tag} editor: Plan layout lays out the poster's boxes`, planned >= 3, `${planned} boxes`);
      check(`${tag} editor: the planned headline reads 30% OFF`, (await dialog.innerText()).includes("30% OFF"));
      check(`${tag} editor: nothing scrolls sideways`, await noSideways(page));
      await shoot(page, `editor-${width}-${scheme}.png`);
      await dialog.getByRole("button", { name: "Done" }).click();
      await page.waitForTimeout(500);
      const shown = phone ? await page.locator("main").innerText() : await card.innerText();
      check(`${tag} canvas: Done puts the planned boxes on the ${phone ? "node's row" : "card"}`, shown.includes(`${planned} boxes`), shown.replace(/\s+/g, " ").slice(0, 80));
      check(`${tag} canvas: nothing scrolls sideways`, await noSideways(page));
      await shoot(page, `canvas-${width}-${scheme}.png`);

      // --- Marketing Studio: Ads format, Words on the image → Words drawn by the model
      await page.goto(`${app}/marketing?template=ad-hero-headline`, { waitUntil: "load" });
      const words = page.getByRole("button", { name: "Headline and button text" });
      await words.waitFor();
      await page.waitForTimeout(800);
      await words.click();
      const sw = page.getByRole("switch", { name: "Words drawn by the model" });
      await sw.waitFor();
      check(
        `${tag} marketing: the switch and its hint render, off by default`,
        (await sw.getAttribute("aria-checked")) === "false" && (await page.getByText("set on top in your brand fonts, letter for letter").first().isVisible()),
      );
      await sw.focus();
      await page.keyboard.press("Space");
      check(`${tag} marketing: the switch turns on from the keyboard`, (await sw.getAttribute("aria-checked")) === "true");
      check(`${tag} marketing: nothing scrolls sideways (panel open)`, await noSideways(page));
      await shoot(page, `marketing-${width}-${scheme}.png`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await page.getByRole("button", { name: /^Settings:/ }).click();
      await page.waitForTimeout(400);
      check(`${tag} marketing: Settings lists MOSS-Image as the model that draws the words`, await page.getByText("draws your words in place").first().isVisible());
      await page.keyboard.press("Escape");

      // --- Ads Studio: the switch and its hint
      if (brandId) {
        await page.goto(`${app}/ads/${brandId}`, { waitUntil: "load" });
        await page.waitForTimeout(1500);
        await page.getByText("New ads", { exact: true }).first().click();
        const adsSwitch = page.getByRole("switch", { name: "Words drawn by the model" });
        const found = await adsSwitch.waitFor({ timeout: 15_000 }).then(
          () => true,
          () => false,
        );
        check(`${tag} ads: the switch renders with its hint`, found && (await page.locator("#ads-drawn-words-hint").isVisible()));
        if (found) {
          check(`${tag} ads: keyboard focus reaches the switch`, phone || (await tabTo(page, adsSwitch, 120)));
          await adsSwitch.click();
          await page.waitForTimeout(800);
          check(`${tag} ads: on, it says the ad is drawn whole in 4:5`, await page.getByText("drawn whole in 4:5").first().isVisible());
          const price = await page
            .locator("text=/Placeholder · free|Free|≈/")
            .first()
            .isVisible()
            .catch(() => false);
          check(`${tag} ads: a price shows beside Create`, price);
          check(`${tag} ads: nothing scrolls sideways`, await noSideways(page));
          await shoot(page, `ads-${width}-${scheme}.png`);
        }
      }
      check(`${tag}: no console errors`, errs.length === 0, errs.slice(0, 2).join(" | "));
      await context.close();
    }
  }
} catch (e) {
  check(`script: ${e.message.split("\n")[0]}`, false);
} finally {
  await browser.close();
}
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nall passed");
