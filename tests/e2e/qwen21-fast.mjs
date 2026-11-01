// nm10-qwen21-fast in the browser (no run reaches a GPU): Qwen-Image 2.1's Options in the Image and Edit studios on your GPU
// (Speed with Draft, Fast, "writes the details", Turbo for edits only and Full as Auto; GPU; Decoder), and Storyboard's choice
// of next-frame model on your GPU (Qwen-Image 2.1 by default, Classic), absent in the cloud. Each page at 1440 and 390 px,
// light and dark, without sideways scroll. The price on your GPU is checked through the preview route (Free).
// Usage: node tests/e2e/qwen21-fast.mjs [appUrl] [--shots <dir>]
// Nothing is sent: Generate is never pressed. Exits 1 on a failed check.
import fs from "node:fs";
import path from "node:path";
import { launch } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(84)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};
const flat = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

const browser = await launch();
const contextFor = async (engine, width = 1440, colorScheme = "light") => {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme, ...(width < 500 && { isMobile: true, hasTouch: true }) });
  await context.addInitScript((e) => {
    try {
      localStorage.setItem("fuobe.engine", e);
    } catch {}
  }, engine);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  return { context, page };
};
const composer = (page) => page.locator("[data-composer]").first();
const shoot = (page, name) => (shots ? page.screenshot({ path: path.join(shots, name) }) : undefined);
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const openStudio = async (page, where) => {
  await page.goto(`${app}/${where}`, { waitUntil: "load" });
  await composer(page).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200);
};
const openMenu = async (page) => {
  const button = page.locator('button[aria-label^="Model: "][aria-label$="Change model"]:visible').first();
  const search = page.getByPlaceholder(/^Search( (all )?models)?/);
  for (let i = 0; i < 3; i++) {
    await button.waitFor({ state: "visible", timeout: 60_000 });
    await button.focus();
    await page.keyboard.press("Enter");
    if (await search.waitFor({ timeout: 10_000 }).then(() => true, () => false)) return search;
  }
  await search.waitFor();
  return search;
};
const pick = async (page, query, id) => {
  const search = page.getByPlaceholder(/^Search( (all )?models)?/);
  await search.fill(query);
  const row = page.locator(`[cmdk-item][data-value$=":${id}"]`).first();
  await row.waitFor({ timeout: 15_000 });
  const text = flat(await row.innerText());
  let picked = false;
  for (let i = 0; i < 12 && !picked; i++) {
    picked = (await row.getAttribute("data-selected")) === "true";
    if (!picked) await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  return { text, picked };
};
/** Opens Options (on a phone, from the Settings sheet); returns nothing, the popover is open. */
const openOptions = async (page, width) => {
  let scope = composer(page);
  if (width < 500) {
    const settings = composer(page).getByRole("button", { name: /^Settings:/ }).first();
    await settings.focus();
    await page.keyboard.press("Enter");
    scope = page.getByRole("dialog").first();
    await scope.waitFor({ timeout: 10_000 });
  }
  const options = scope.getByRole("button", { name: /^Options/ }).first();
  await options.focus();
  await page.keyboard.press("Enter");
};
/** The options a combobox lists, then closes it. */
const listOf = async (page, box) => {
  await box.focus();
  await page.keyboard.press("Enter");
  const list = page.getByRole("listbox").last();
  await list.waitFor({ timeout: 10_000 });
  const items = (await list.getByRole("option").allInnerTexts()).map(flat);
  await page.keyboard.press("Escape");
  return items;
};

try {
  const preview = async (body) => (await fetch(`${app}/api/generations?preview=1`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  const fast = await preview({ feature: "image", op: "t2i", modelId: "oss-qwen-image-21", prompt: "a koi pond", params: { aspectRatio: "1:1", resolution: "1K", extra: { speed: "fast" } } });
  check("api: a Fast Qwen-Image 2.1 picture on your GPU is free", fast.costUsd === 0, JSON.stringify({ cost: fast.costUsd, demo: fast.demo, error: fast.error }));

  for (const width of [1440, 390]) {
    for (const scheme of ["light", "dark"]) {
      const tag = `${width} ${scheme}`;
      for (const [studio, op] of [["image", "t2i"], ["edit", "edit"]]) {
        const { context, page } = await contextFor("open", width, scheme);
        await openStudio(page, studio);
        await openMenu(page);
        const { text } = await pick(page, "Qwen-Image 2.1", "oss-qwen-image-21");
        check(`${tag} ${studio}: the menu lists Qwen-Image 2.1 with its speeds, Free on your GPU`, /Draft to Full speed/.test(text) && /\bFree\b/.test(text), text);
        await composer(page).getByRole("textbox").first().fill(op === "t2i" ? "A koi pond at night, neon rain" : "Make it night");
        await openOptions(page, width);
        const speed = page.getByRole("combobox", { name: "Speed" });
        await speed.waitFor({ timeout: 10_000 });
        check(`${tag} ${studio}: Options → Speed starts on Auto · Full`, /Auto · Full · 25 steps/.test(flat(await speed.innerText())), flat(await speed.innerText()));
        const speeds = await listOf(page, speed);
        const want = ["Auto · Full · 25 steps", "Draft · 2 steps", "Fast · 4 steps", "Fast · writes the details (6 steps)", ...(op === "edit" ? ["Turbo · 8 steps (edits)"] : []), "Full · 25 steps"];
        check(`${tag} ${studio}: Speed offers ${op === "edit" ? "Turbo for edits" : "no Turbo for new pictures"}`, JSON.stringify(speeds) === JSON.stringify(want), speeds.join(" | "));
        const gpu = page.getByRole("combobox", { name: "GPU" });
        const gpus = await listOf(page, gpu);
        check(`${tag} ${studio}: GPU says the small one reads English prompts only`, gpus.includes("Small GPU (16 GB) · English prompts only") && gpus[0] === "Auto", gpus.join(" | "));
        const decoder = page.getByRole("combobox", { name: "Decoder" });
        check(`${tag} ${studio}: Decoder starts on Standard`, /Auto · Standard/.test(flat(await decoder.innerText())), flat(await decoder.innerText()));
        await shoot(page, `${studio}-${width}-${scheme}.png`);
        check(`${tag} ${studio}: nothing scrolls sideways`, await noSideways(page));
        await context.close();
      }

      // ---- Storyboard: the next-frame model on your GPU, none in the cloud.
      for (const engine of ["open", "cloud"]) {
        const { context, page } = await contextFor(engine, width, scheme);
        await page.goto(`${app}/storyboard`, { waitUntil: "load" });
        await page.locator("h1").first().waitFor({ timeout: 60_000 }).catch(() => {});
        await page.waitForTimeout(1500);
        const group = page.getByRole("radiogroup", { name: "Next frames made on" });
        if (engine === "open") {
          await group.waitFor({ timeout: 20_000 });
          const radios = group.getByRole("radio");
          const names = (await radios.allInnerTexts()).map(flat);
          check(`${tag} storyboard open: next frames on Qwen-Image 2.1 or Classic`, names.join("|") === "Qwen-Image 2.1|Classic", names.join("|"));
          check(`${tag} storyboard open: Qwen-Image 2.1 is picked`, (await radios.first().getAttribute("aria-checked")) === "true");
          await radios.nth(1).click();
          check(`${tag} storyboard open: Classic can be picked`, (await radios.nth(1).getAttribute("aria-checked")) === "true");
          await shoot(page, `storyboard-${width}-${scheme}.png`);
        } else check(`${tag} storyboard cloud: no next-frame choice`, (await group.count()) === 0);
        check(`${tag} storyboard ${engine}: nothing scrolls sideways`, await noSideways(page));
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nall passed");
