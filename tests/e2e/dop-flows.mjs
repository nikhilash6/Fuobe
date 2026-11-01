// Fuobe DoP in the browser (build plan O4): a camera motion or effect picked in the Video studio runs on its Original,
// the price says Free on the open engine and the hosted price in the cloud, a move whose cloud route is LTX-2.3's
// camera LoRA follows the engine switch, a colour-grade effect's clip offers its grade, and Color grading opens with
// it picked. Then the pages it changes fit a 390 px phone in light and dark mode.
// Usage: node tests/e2e/dop-flows.mjs [appUrl] [--shots=dir]   (the app runs in demo mode, no GPU; a fal key, any
// string, adds the cloud price checks, and nothing is sent to fal; --shots saves screenshots there)
import fs from "node:fs";
import path from "node:path";
import { DESKTOP, launch, openRoute, PHONE, root } from "./_browser.mjs";

const args = process.argv.slice(2);
const app = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const shots = args.find((a) => a.startsWith("--shots="))?.slice(8);
if (shots) fs.mkdirSync(shots, { recursive: true });
/** Save a screenshot when --shots names a folder. */
const shoot = (page, name) => (shots ? page.screenshot({ path: path.join(shots, name) }) : undefined);
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

/** Upload the eval harness's start frame (a person on a bridge would do; this is its synthetic stand-in). */
async function uploadStart() {
  const data = fs.readFileSync(path.join(root, "scripts/eval/fixtures/start-frame.png"));
  const form = new FormData();
  form.append("file", new Blob([data], { type: "image/png" }), "start.png");
  const res = await fetch(`${app}/api/uploads`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return (await res.json()).url;
}

const start = await uploadStart();
// Cloud prices show when a fal key is set (any key: nothing is sent to fal here); demo mode shows "Placeholder · free".
const status = await (await fetch(`${app}/api/status`)).json().catch(() => ({}));
const fal = !!status?.providers?.fal?.configured;
if (!fal) console.log("note: no fal key on this server, so the cloud price checks are skipped (start it with FAL_KEY=anything to run them)");
const browser = await launch();

/** A page on an engine (the composer's switch is kept in localStorage). */
async function studio(engine, query, opts = DESKTOP, scheme = "light") {
  const ctx = await browser.newContext({ ...opts, colorScheme: scheme });
  await ctx.addInitScript((e) => localStorage.setItem("fuobe.engine", e), engine);
  const page = await ctx.newPage();
  await openRoute(page, `${app}/video?${query}`, { settleMs: 1500 });
  await page.waitForSelector("[data-composer]", { timeout: 30_000 });
  return { page, ctx };
}

const composerText = (page) => page.locator("[data-composer]").innerText();

// 1. A motion from the gallery lands on Fuobe DoP: free on the GPU, the LoRA endpoint's price in the cloud.
{
  const { page, ctx } = await studio("open", `preset=motion-overhead&image=${encodeURIComponent(start)}`);
  await page.waitForFunction(() => /Fuobe DoP/.test(document.querySelector("[data-composer]")?.textContent ?? ""), null, { timeout: 20_000 }).catch(() => {});
  const text = await composerText(page);
  check("a motion opens on Fuobe DoP (open engine)", /Fuobe DoP/.test(text), text.replace(/\s+/g, " ").slice(0, 160));
  check("its price on the open engine is free", /free/i.test(text), (text.match(/(Demo · )?[Ff]ree/) ?? ["no price"])[0]);
  await shoot(page, "motion-open-1440.png");
  await ctx.close();
}
{
  const { page, ctx } = await studio("cloud", `preset=motion-overhead&image=${encodeURIComponent(start)}`);
  await page.waitForFunction((f) => (f ? /\$0\.50/ : /Fuobe DoP/).test(document.querySelector("[data-composer]")?.textContent ?? ""), fal, { timeout: 20_000 }).catch(() => {});
  const text = await composerText(page);
  check("in the cloud it runs on Fuobe DoP", /Fuobe DoP/.test(text), text.replace(/\s+/g, " ").slice(0, 160));
  if (fal) check("in the cloud it shows the hosted price before the run ($0.10/s with LoRAs)", /\$0\.50/.test(text), (text.match(/\$\d+\.\d+/) ?? ["no price"])[0]);
  await shoot(page, "motion-cloud-1440.png");
  await ctx.close();
}

// 2. Jib Up: Fuobe DoP on the GPU (the crane LoRA), Fuobe DoP · LTX in the cloud (LTX-2.3's jib camera LoRA).
{
  const { page, ctx } = await studio("cloud", `preset=motion-jib-up&image=${encodeURIComponent(start)}`);
  await page.waitForFunction(() => /Fuobe DoP · LTX/.test(document.querySelector("[data-composer]")?.textContent ?? ""), null, { timeout: 20_000 }).catch(() => {});
  check("a camera-LoRA move runs on Fuobe DoP · LTX in the cloud", /Fuobe DoP · LTX/.test(await composerText(page)));
  // Fuobe DoP (Wan) picked on purpose for the move stays picked: the engine didn't change.
  await page.getByRole("button", { name: /^Model: .*Change model$/ }).first().click();
  await page.getByPlaceholder(/Search (all )?models/).fill("Fuobe DoP");
  await page.locator('[cmdk-item][data-value$=":fuobe-dop"]').first().click();
  await page.waitForTimeout(2000);
  const chip = await page.getByRole("button", { name: /^Model: .*Change model$/ }).first().getAttribute("aria-label");
  check("the sibling Original picked for the move stays picked", chip === "Model: Fuobe DoP. Change model", chip ?? "no model chip");
  await ctx.close();
}

// 2b. A move Fuobe DoP has nothing of its own for in the cloud (Whip Pan: no LoRA, no camera LoRA) leaves the studio's
// model as it is there; on the GPU it lands on Fuobe DoP.
{
  const { page, ctx } = await studio("cloud", `preset=motion-whip-pan&image=${encodeURIComponent(start)}`);
  await page.waitForTimeout(2500);
  const chip = await page.getByRole("button", { name: /^Model: .*Change model$/ }).first().getAttribute("aria-label");
  check("a words-only move keeps the studio's model in the cloud", !!chip && !/Fuobe DoP/.test(chip), chip ?? "no model chip");
  await ctx.close();
}

// 2c. The same Original across the engine switch takes the new engine's default size (480p on the GPU, 720p in the cloud).
{
  const { page, ctx } = await studio("open", `preset=motion-overhead&image=${encodeURIComponent(start)}`);
  await page.waitForFunction(() => /Fuobe DoP/.test(document.querySelector("[data-composer]")?.textContent ?? ""), null, { timeout: 20_000 }).catch(() => {});
  const before = await composerText(page);
  await page.getByRole("button", { name: /^Model: .*Change model$/ }).first().click();
  await page.getByRole("radio", { name: "Cloud" }).first().click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(2000);
  const after = await composerText(page);
  const chip = await page.getByRole("button", { name: /^Model: .*Change model$/ }).first().getAttribute("aria-label");
  check("switching engines keeps Fuobe DoP", chip === "Model: Fuobe DoP. Change model", chip ?? "no model chip");
  check("480p on the GPU becomes 720p in the cloud", /480p/.test(before) && /720p/.test(after) && !/480p/.test(after), `${(before.match(/\d{3}p/) ?? ["?"])[0]} → ${(after.match(/\d{3}p/) ?? ["?"])[0]}`);
  await ctx.close();
}

// 3. A relight effect adds its relight step to the cloud price; a colour-grade effect's clip offers its grade.
if (fal) {
  // The clip carries no LoRA (the Relight LoRA is on the still): 5 s at $0.08/s, plus about $0.035 to relight the frame.
  const { page, ctx } = await studio("cloud", `preset=effect-window&image=${encodeURIComponent(start)}`);
  await page.waitForFunction(() => /\$0\.43/.test(document.querySelector("[data-composer]")?.textContent ?? ""), null, { timeout: 20_000 }).catch(() => {});
  const text = await composerText(page);
  check("a relight effect's price includes relighting the start frame ($0.40 + $0.035)", /\$0\.435?\b/.test(text), (text.match(/\$\d+\.\d+/) ?? ["no price"])[0]);
  await ctx.close();
}
{
  const res = await fetch(`${app}/api/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feature: "video", modelId: "fuobe-dop", presetId: "effect-candy-pink", prompt: "a woman on a bridge", inputs: { images: [start] }, engine: "open" }),
  });
  const made = res.ok ? await res.json() : null;
  const id = made?.items?.[0]?.id;
  // The demo provider finishes in a moment.
  let done = null;
  for (let i = 0; i < 60 && id; i++) {
    const g = await (await fetch(`${app}/api/generations/${id}`)).json();
    if (g.status === "succeeded") {
      done = g;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  check("a colour-grade effect's clip carries its grade", done?.outputs?.[0]?.meta?.grade === "candy-pink", JSON.stringify(done?.outputs?.[0]?.meta ?? {}));
  const { page, ctx } = await studio("open", "");
  const chip = page.getByRole("link", { name: "Apply the Candy Pink grade" }).first();
  await chip.waitFor({ timeout: 20_000 }).catch(() => {});
  check("the clip's first next step applies the grade", (await chip.count()) > 0);
  if (await chip.count()) {
    await chip.click();
    await page.waitForURL(/\/color-grade\?/, { timeout: 20_000 });
    await page.waitForTimeout(1500);
    const pressed = await page.locator('[aria-pressed="true"]').allInnerTexts();
    check("Color grading opens with the grade picked", pressed.some((t) => /Candy Pink/.test(t)), pressed.join(" | ").slice(0, 120));
    await shoot(page, "grade-1440.png");
  }
  await ctx.close();
}

// 4. The pages it changes fit a phone, light and dark.
for (const scheme of ["light", "dark"]) {
  for (const [engine, route] of [
    ["open", `/video?preset=motion-overhead&image=${encodeURIComponent(start)}`],
    ["cloud", `/video?preset=motion-jib-up&image=${encodeURIComponent(start)}`],
    ["open", "/motions"],
    ["open", "/effects"],
    ["open", "/color-grade?preset=candy-pink"],
  ]) {
    const ctx = await browser.newContext({ ...PHONE, colorScheme: scheme });
    await ctx.addInitScript((e) => localStorage.setItem("fuobe.engine", e), engine);
    const page = await ctx.newPage();
    await openRoute(page, app + route, { settleMs: 1200 });
    // A dev server's first compile of a page can reload it once: measure again after the reload settles.
    const measure = () => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    const w = await measure().catch(async () => {
      await page.waitForLoadState("load");
      await page.waitForTimeout(1200);
      return measure();
    });
    check(`${route.split("&")[0]} fits 390 px (${scheme})`, w.scroll <= w.client, `page ${w.scroll} px, window ${w.client} px`);
    const name = `${route.replace(/[^a-z0-9]+/gi, "-").slice(1, 40)}-${scheme}-390.png`;
    await shoot(page, name);
    await ctx.close();
  }
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
