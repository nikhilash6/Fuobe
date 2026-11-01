// Fuobe Cinema browser check (build plan O6): the Cinema workspace runs on the Originals, with no Higgsfield anywhere.
// At 1440 and 390 px, light and dark: the model menu lists Fuobe Cinema first with an "Original" badge and what runs on
// each engine; a camera move says how the Original drives it (LTX-2.3's camera LoRA in the cloud); the price shows
// before running ("Free" on the open engine); a take is made in demo mode; Soul Cast and Soul Location name Fuobe Soul
// and their look; Soul's post steps (a still's 21:9 crop and grade, the location's Movie grade) run in Cinema's feed and
// builders; the Director panel's move list drops its badges for a partner model; nothing scrolls sideways.
// Usage: node tests/e2e/cinema-original.mjs [appUrl] [--shots <dir>]   (app running in demo mode, ComfyUI unreachable).
// Exits 1 on a failed check.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function loadPlaywright() {
  for (const from of [path.join(root, "package.json"), "/opt/node22/lib/node_modules/", "/opt/node-tools/node_modules/"]) {
    const req = createRequire(from);
    for (const name of ["playwright", "playwright-core"]) {
      try {
        return req(name);
      } catch {}
    }
  }
  throw new Error("Playwright not found: install playwright-core or run where the global install exists");
}

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const dir = "/opt/pw-browsers";
  if (!fs.existsSync(dir)) return undefined;
  const newest = fs
    .readdirSync(dir)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0];
  const exe = newest && path.join(dir, newest, "chrome-linux/chrome");
  return exe && fs.existsSync(exe) ? exe : undefined;
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: chromiumPath() });
const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(64)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};
if (shots) fs.mkdirSync(shots, { recursive: true });
/** Poll until `get` answers something (or 30 s pass). */
async function waitFor(get, ms = 30_000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await get();
    if (v || Date.now() > until) return v;
    await new Promise((r) => setTimeout(r, 750));
  }
}

async function session(width, height, scheme) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
  const page = await context.newPage();
  const call = async (url, method = "GET", data) => {
    const r = await page.request.fetch(app + url, { method, headers: { "Content-Type": "application/json" }, data: data === undefined ? undefined : JSON.stringify(data) });
    return r.json();
  };
  const tag = `${width} ${scheme}`;
  const shot = async (name) => shots && (await page.screenshot({ path: path.join(shots, `${name}-${width}-${scheme}.png`) }));
  const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const project = await call("/api/cinema/projects", "POST", { name: `Original check ${tag}` });
  // The project page sends no Higgsfield flag.
  const view = await call(`/api/cinema/projects/${project.id}`);
  check(`${tag}: the project's context has no Higgsfield flag`, view.context && !("higgsfield" in view.context), JSON.stringify(view.context));

  // Start on the cloud engine (the switch remembers it per browser).
  await page.goto(`${app}/cinema/${project.id}`, { waitUntil: "load", timeout: 120_000 });
  const prompt = page.getByPlaceholder(/Describe your scene/);
  await prompt.waitFor({ timeout: 180_000 });
  const engine = page.getByRole("radiogroup", { name: "Engine" });
  // Pick an engine (a click that only closes a menu is tried again).
  const pick = async (name) => {
    const r = engine.getByRole("radio", { name });
    for (let i = 0; i < 4 && (await r.count()) && (await r.getAttribute("aria-checked")) !== "true"; i++) {
      await r.click();
      await page.waitForTimeout(400);
    }
    check(`${tag}: the ${String(name).replace(/[/^]/g, "")} engine is picked`, (await r.getAttribute("aria-checked")) === "true");
  };
  await pick(/Cloud/);
  check(`${tag}: no sideways scroll on the workspace`, (await sideways()) <= 1, `${await sideways()} px`);

  // The model menu: Fuobe Cinema first, marked Original, with what runs in the cloud.
  const modelChip = page.getByRole("button", { name: /^Model: / });
  check(`${tag}: the default video model is Fuobe Cinema`, (await modelChip.getAttribute("aria-label")) === "Model: Fuobe Cinema", await modelChip.getAttribute("aria-label"));
  await modelChip.click();
  const menu = page.getByRole("menu");
  await menu.waitFor();
  const items = await menu.getByRole("menuitem").allInnerTexts();
  check(`${tag}: the menu lists Fuobe Cinema first, as an Original`, /^Fuobe Cinema\s*Original/.test(items[0] ?? ""), JSON.stringify(items[0]));
  check(`${tag}: it says LTX-2.3 runs in the cloud`, /LTX-2\.3 on fal/.test(items[0] ?? ""));
  check(`${tag}: partner models stay pickable`, ["Seedance 2.5", "Kling 3.0", "Veo 3.1"].every((n) => items.some((t) => t.startsWith(n))), items.map((t) => t.split("\n")[0]).join(", "));
  check(`${tag}: nothing in the menu mentions Higgsfield`, !/Higgsfield/i.test(items.join(" ")));
  await shot("model-menu");
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });

  // A camera move: the picker says how the Original drives it, and the bar's notes say it again.
  await prompt.fill("A violinist plays alone on an empty theatre stage");
  await page.getByRole("button", { name: "Add a camera move" }).click();
  const dolly = page.getByRole("option", { name: /Dolly In/ }).first();
  await dolly.waitFor();
  check(`${tag}: Dolly In shows "Camera LoRA" in the cloud`, /Camera LoRA/.test(await dolly.innerText()));
  await shot("moves");
  await dolly.click();
  await page.waitForTimeout(500);
  const body = await page.locator("body").innerText();
  check(`${tag}: the bar says the move drives LTX-2.3's camera LoRA`, /Dolly In drives LTX-2\.3's dolly in camera LoRA/.test(body));
  // 30 s in the cloud: one 20 s take plus an extend, and the duration chip says 30 s (not "the model makes 20 s").
  const durationChip = page.getByRole("button", { name: /^Duration: / }).locator("visible=true");
  if (await durationChip.count()) {
    await durationChip.first().click();
    await page.getByRole("button", { name: "30s", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    const chipText = ((await durationChip.first().textContent()) ?? "").replace(/^Duration:\s*/, "").trim();
    const notes30 = await page.locator("body").innerText();
    check(`${tag}: 30 s shows as 30 s, with an extend for the last 10 s`, chipText === "30s" && /an extend adds the last 10s/.test(notes30), chipText);
    await durationChip.first().click();
    await page.getByRole("button", { name: "5s", exact: true }).click();
    await page.keyboard.press("Escape");
  }
  // A dialog, sheet or menu that is closing stays in the page (data-state="closed") until it has animated out, and
  // keeps the rest hidden from assistive tech meanwhile: let it go before looking for what's under it.
  const settle = () =>
    page.waitForFunction(() => !document.querySelector('[role="dialog"][data-state="closed"], [role="menu"][data-state="closed"]'), null, { timeout: 5000 }).catch(() => {});
  // A Director's Panel chip: in its own row from sm up, in the folded Director sheet on a phone. The sheet re-renders
  // while a dialog it opened closes, and can swap the chip out under the click: a short try, then open it and click again.
  const directorChip = async (name) => {
    const chip = page.getByRole("button", { name }).locator("visible=true").first();
    const director = page.getByRole("button", { name: /^Director/ }).locator("visible=true").first();
    const openSheet = async () => {
      await settle();
      if (!(await chip.count()) && (await director.count())) await director.click();
    };
    await openSheet();
    if (await chip.click({ timeout: 3000 }).then(() => true, () => false)) return;
    await openSheet();
    await chip.click();
  };
  // The Director panel's move list badges like the prompt bar's: none when a partner model gets the moves in words.
  const directorMoves = async () => {
    await directorChip("Camera settings");
    await page.getByRole("tab", { name: /Movement/ }).click();
    const opt = page.getByRole("option", { name: /Dolly In/ }).locator("visible=true").first();
    await opt.waitFor();
    const text = await opt.innerText();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    // A phone's folded Director sheet closes too.
    if (await page.getByRole("dialog").locator("visible=true").count()) await page.keyboard.press("Escape");
    await settle();
    return text;
  };
  check(`${tag}: the Director's move list badges Dolly In on Fuobe Cinema`, /Camera LoRA/.test(await directorMoves()));
  const pickModel = async (name) => {
    await modelChip.click();
    await menu.waitFor();
    await menu.getByRole("menuitem").filter({ hasText: name }).first().click();
    await menu.waitFor({ state: "hidden" });
  };
  await pickModel(/^Seedance 2\.5/);
  check(`${tag}: no move badges in the Director's list for a partner model`, !/Camera LoRA|LoRA|Focus move|Fun Camera/.test(await directorMoves()));
  await pickModel(/^Fuobe Cinema/);
  const generate = page.getByRole("button", { name: /^Generate/ }).first();
  check(`${tag}: the price shows before running`, /Demo|≈ \$|Free/.test(body));
  await shot("cloud-bar");
  const before = (await call(`/api/cinema/projects/${project.id}/items`)).items.length;
  await generate.click();
  await page.waitForTimeout(2500);
  const takes = (await call(`/api/cinema/projects/${project.id}/items`)).items;
  check(`${tag}: Generate makes a Fuobe Cinema take (demo)`, takes.length === before + 1 && takes[0]?.modelId === "fuobe-cinema", takes.map((g) => g.modelId).join(","));
  check(`${tag}: the take asked for the camera LoRA`, takes[0]?.request?.params?.extra?.camera_lora === "dolly_in");

  // A still on Fuobe Soul Cinema at 21:9: the feed crops the 16:9 render to 21:9 and grades it in the browser.
  const still = await call(`/api/cinema/projects/${project.id}/generate`, "POST", {
    input: { engine: "cloud", mode: "image", action: "generate", prompt: "A lighthouse keeper at the window", settings: { camera: "modern", lens: "clean-sharp", focal: "50mm" }, aspectRatio: "21:9", batch: 1 },
  });
  const stillId = still.items?.[0]?.id;
  check(`${tag}: a still runs on Fuobe Soul Cinema`, still.plan?.modelId === "fuobe-soul-cinema", still.plan?.modelId ?? JSON.stringify(still).slice(0, 200));
  // Made through the API, so the open feed learns of it on its next load.
  await waitFor(async () => (await call(`/api/cinema/projects/${project.id}/items`)).items.find((x) => x.id === stillId && x.status === "succeeded"));
  await page.reload({ waitUntil: "load" });
  await prompt.waitFor({ timeout: 120_000 });
  const graded = await waitFor(async () => {
    const g = (await call(`/api/cinema/projects/${project.id}/items`)).items.find((x) => x.id === stillId);
    return g?.outputs?.[0]?.meta?.finished ? g : null;
  });
  const meta = graded?.outputs?.[0]?.meta;
  check(`${tag}: the Cinema feed finishes the still (21:9 crop, grade)`, !!meta && meta.crop === "21:9" && meta.grade === "teal-orange" && !!meta.original, JSON.stringify(meta ?? null));

  // The open engine: free, Wan 2.2 Lightning, a Fun Camera badge for pans.
  await pick(/Open source/);
  const openBody = await page.locator("body").innerText();
  check(`${tag}: the open engine says Free`, /\bFree\b/.test(openBody) || /Demo/.test(openBody));
  await modelChip.click();
  await menu.waitFor();
  const openItems = await menu.getByRole("menuitem").allInnerTexts();
  check(`${tag}: open menu: Fuobe Cinema on Wan 2.2 Lightning, then LTX-2.5 (sound)`, /Wan 2\.2 Lightning on your GPU/.test(openItems[0] ?? "") && /^LTX-2\.5/.test(openItems[1] ?? ""), openItems.map((t) => t.split("\n")[0]).join(", "));
  await shot("open-menu");
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  await pick(/Cloud/);
  check(`${tag}: no sideways scroll after the menus`, (await sideways()) <= 1);

  // Soul Cast and Soul Location name Fuobe Soul and the look (on a phone they sit in the folded Director sheet).
  const builder = async (name) => {
    await directorChip(name);
    const dialog = page.getByRole("dialog").filter({ hasText: /Build your cast|Create location/ });
    await dialog.waitFor();
    return dialog;
  };
  const cast = await builder("Soul Cast: build a character");
  const castText = await cast.innerText();
  check(`${tag}: Soul Cast runs on Fuobe Soul, Realistic look, in the cloud`, /Fuobe Soul · Realistic look/.test(castText) && !/on your GPU/.test(castText), castText.match(/Fuobe[^\n]*/)?.[0] ?? "");
  check(`${tag}: Soul Cast shows a price before running`, /Placeholder · free|Free|≈ \$/.test(castText));
  check(`${tag}: no sideways scroll in Soul Cast`, (await sideways()) <= 1);
  await shot("soul-cast");
  await page.keyboard.press("Escape");
  await cast.waitFor({ state: "hidden" });
  const loc = await builder("Soul Location: build a location");
  await loc.getByRole("textbox").first().fill("an abandoned diner on Route 66 at dusk");
  const locText = await loc.innerText();
  check(`${tag}: Soul Location runs on Fuobe Soul, Movie look`, /Fuobe Soul · Movie look/.test(locText), locText.match(/Fuobe[^\n]*/)?.[0] ?? "");
  await loc.getByRole("button", { name: /Generate location/ }).click();
  await page.waitForTimeout(3000);
  const made = (await call(`/api/cinema/projects/${project.id}/items`)).items.filter((g) => g.feature === "cinema-location");
  check(`${tag}: a location is made on Fuobe Soul with the Movie look`, made.length > 0 && made.every((g) => g.modelId === "fuobe-soul" && g.presetId === "v1-movie"), made.map((g) => `${g.modelId}/${g.presetId}`).join(","));
  // The Movie look's grade is applied in the browser (the builder runs Soul's post steps), so a saved element is finished.
  const finished = await waitFor(async () => {
    const rows = (await call(`/api/cinema/projects/${project.id}/items`)).items.filter((g) => g.feature === "cinema-location" && g.status === "succeeded");
    return rows.length > 0 && rows.every((g) => g.outputs.every((o) => o.kind !== "image" || o.meta?.finished)) ? rows : null;
  });
  check(`${tag}: the location's grade is applied in the browser`, !!finished && finished[0].outputs[0].meta?.grade === "teal-orange", JSON.stringify(finished?.[0]?.outputs?.[0]?.meta ?? null));
  check(`${tag}: no sideways scroll in Soul Location`, (await sideways()) <= 1);
  await shot("soul-location");
  await page.keyboard.press("Escape");
  return { context, project };
}

try {
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ])
    for (const scheme of ["light", "dark"]) {
      const { context } = await session(w, h, scheme);
      await context.close();
    }
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
