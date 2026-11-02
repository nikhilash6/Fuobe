// Browser check of Open-H3 Regenerate 2K (n7-3-regenerate-2k).
// Usage: node tests/e2e/regenerate-2k.mjs [appUrl] [outDir]   (the app in demo mode, Settings → demo on: no keys, no ComfyUI)
// At 1440 px and 390 px, light and dark: Upscale → Video on the open engine with Restore · faithful and Regenerate ·
// creative side by side (picked by keyboard), the prompt box Regenerate needs, its "Free on your GPU", GPU and shape lines,
// "Describe the clip for me" filling the box for a clip with no words,
// and the Options chip with Creativity and Speed; the cloud engine's line that Regenerate runs on your GPU; the
// "Regenerate a soft AI clip in 2K" row; "Regenerate in 2K" in a feed tile's menu (and a tap on it at 390 px) and in
// the Library viewer; the Canvas palette's "Regenerate (creative)" (disabled with the GPU-only reason on a cloud
// board); no sideways scroll. Screenshots go to outDir.
import fs from "node:fs";
import path from "node:path";
import { DESKTOP, PHONE, launch, openRoute } from "./_browser.mjs";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const app = (args[0] ?? "http://localhost:3440").replace(/\/$/, "");
const out = args[1] ?? fs.mkdtempSync("/tmp/fuobe-regenerate-");
fs.mkdirSync(out, { recursive: true });

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
};
const json = async (p, init) => {
  const res = await fetch(app + p, { headers: { "Content-Type": "application/json" }, ...init });
  const body = await res.json();
  if (!res.ok) throw new Error(`${p}: ${body.error ?? res.status}`);
  return body;
};
const noSideScroll = async (page, label) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 0, `${label}: no horizontal scroll (${over}px)`);
};
const setup = async (browser, device, theme, engine) => {
  const ctx = await browser.newContext({ ...device, colorScheme: theme });
  await ctx.addInitScript(([e]) => localStorage.setItem("fuobe.engine", e), [engine]);
  await ctx.route((u) => u.origin !== new URL(app).origin && /^https?:$/.test(u.protocol), (rt) => rt.abort());
  return ctx;
};

// A finished open H3 clip (demo mode: a placeholder result) for the tile, the viewer and the next steps.
const made = await json("/api/generations", {
  method: "POST",
  body: JSON.stringify({ feature: "video", modelId: "oss-minimax-h3", op: "t2v", prompt: "A red fox trots through fresh snow at dawn, slow push-in", params: { duration: 5, aspectRatio: "16:9" } }),
});
const gid = (made.items ?? [made])[0].id;
let clipUrl = "";
for (let i = 0; i < 60; i++) {
  const g = await json(`/api/generations/${gid}`);
  clipUrl = (g.generation ?? g).outputs?.[0]?.url ?? "";
  if ((g.generation ?? g).status === "succeeded") break;
  await new Promise((r) => setTimeout(r, 1000));
}

const browser = await launch();
try {
  for (const [dname, device] of [
    ["1440", DESKTOP],
    ["390", PHONE],
  ]) {
    for (const theme of ["light", "dark"]) {
      const label = `${dname} ${theme}`;
      // ---- Upscale → Video, open engine.
      let ctx = await setup(browser, device, theme, "open");
      let page = await ctx.newPage();
      // (The sidebar's account row hydrates its dev-server Suspense script differently: not this package's.)
      page.on("pageerror", (e) => !/Hydration failed[\s\S]*ViewerRowPlaceholder/.test(e.message) && failures.push(`${label} page error: ${e.message.split("\n")[0]}`));
      await openRoute(page, `${app}/upscale/video`);
      const group = page.getByRole("radiogroup", { name: "How to finish the clip" });
      await group.waitFor({ timeout: 30_000 });
      const restore = group.getByRole("radio", { name: /Restore · faithful/ });
      const regen = group.getByRole("radio", { name: /Regenerate · creative/ });
      check((await restore.getAttribute("aria-checked")) === "true", `${label}: Restore · faithful (SeedVR2) is picked by default`);
      check(await regen.isVisible(), `${label}: Regenerate · creative sits beside it`);
      // Keyboard: the picked radio is the Tab stop; the right arrow picks Regenerate.
      await restore.focus();
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(400);
      check((await regen.getAttribute("aria-checked")) === "true", `${label}: the arrow key picks Regenerate`);
      check(await page.evaluate(() => document.activeElement?.getAttribute("role") === "radio"), `${label}: focus stays on the choice`);
      const gpu = page.getByText(/Free on your GPU · About 3 minutes per 5 s at 2K on a 72 GB GPU\. Needs about 40 GB of new files/);
      // (The owner's line replaces the visitor's once the viewer is known.)
      check(await gpu.waitFor({ timeout: 15_000 }).then(() => true, () => false), `${label}: the price and GPU lines show (the owner's view)`);
      check(await page.getByText(/Comes out 16:9, or 9:16 for a tall clip: other shapes are cropped to fit\./).isVisible(), `${label}: the 16:9 / 9:16 line shows`);
      const box = page.locator("[data-composer] textarea");
      check((await box.count()) > 0 && (await box.first().isVisible()), `${label}: the prompt box shows for Regenerate`);
      check(((await box.first().getAttribute("placeholder")) ?? "").startsWith("Describe the clip"), `${label}: its placeholder asks to describe the clip`);
      check(await page.getByText("Regenerate a soft AI clip in 2K").isVisible(), `${label}: the "before upscaling" list has the Regenerate row`);
      // The Options chip holds Creativity and Speed (on a phone it sits in the Settings sheet).
      const options = page.getByRole("button", { name: "Options", exact: true });
      if (!(await options.isVisible().catch(() => false))) {
        await page.getByRole("button", { name: /^Settings:/ }).first().click();
        await page.waitForTimeout(500);
      }
      if (await options.first().isVisible().catch(() => false)) {
        if (device === PHONE) await options.first().tap();
        else await options.first().click();
        await page.waitForTimeout(500);
      }
      check(await page.getByText("Creativity", { exact: true }).first().isVisible(), `${label}: the Creativity control renders`);
      check(await page.getByText("Speed", { exact: true }).first().isVisible(), `${label}: the Speed control renders`);
      await page.screenshot({ path: path.join(out, `upscale-regenerate-options-${dname}-${theme}.png`), fullPage: true });
      await noSideScroll(page, `${label} options`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(out, `upscale-regenerate-${dname}-${theme}.png`), fullPage: true });
      await noSideScroll(page, `${label} open`);
      await ctx.close();

      // ---- A clip with no words (as from an upload): "Describe the clip for me" fills the prompt box, by keyboard.
      ctx = await setup(browser, device, theme, "open");
      page = await ctx.newPage();
      page.on("pageerror", (e) => !/Hydration failed[\s\S]*ViewerRowPlaceholder/.test(e.message) && failures.push(`${label} page error: ${e.message.split("\n")[0]}`));
      await openRoute(page, `${app}/upscale/video?video=${encodeURIComponent(clipUrl)}&model=oss-h3-regenerate&resolution=1440p`);
      const describe = page.getByRole("button", { name: "Describe the clip for me" });
      await describe.waitFor({ timeout: 30_000 }).catch(() => {});
      check(await describe.isVisible(), `${label}: a clip with no words offers "Describe the clip for me"`);
      await describe.focus();
      check(await describe.evaluate((el) => el === document.activeElement), `${label}: the describe button takes keyboard focus`);
      await page.keyboard.press("Enter");
      const words = page.locator("[data-composer] textarea").first();
      let filled = "";
      for (let i = 0; i < 40 && !filled; i++) {
        await page.waitForTimeout(500);
        filled = (await words.inputValue().catch(() => "")).trim();
      }
      check(filled.length > 0, `${label}: the clip's words fill the prompt box (${filled.slice(0, 40)}…)`);
      check(!(await describe.isVisible().catch(() => false)), `${label}: the button goes once the box has words`);
      await page.screenshot({ path: path.join(out, `upscale-regenerate-described-${dname}-${theme}.png`), fullPage: true });
      await noSideScroll(page, `${label} described`);
      await ctx.close();

      // ---- Upscale → Video, cloud engine: Regenerate says it runs on your GPU.
      ctx = await setup(browser, device, theme, "cloud");
      page = await ctx.newPage();
      await openRoute(page, `${app}/upscale/video`);
      const line = page.getByText("Runs on your GPU (open source)");
      await line.first().waitFor({ timeout: 30_000 });
      check(await line.first().isVisible(), `${label}: the cloud engine says Regenerate runs on your GPU (open source)`);
      check((await page.getByRole("radiogroup", { name: "How to finish the clip" }).count()) === 0, `${label}: no open choices on the cloud engine`);
      await page.screenshot({ path: path.join(out, `upscale-cloud-${dname}-${theme}.png`), fullPage: true });
      await noSideScroll(page, `${label} cloud`);
      const use = page.getByRole("button", { name: "Use it on your GPU" });
      await use.click();
      await page.getByRole("radiogroup", { name: "How to finish the clip" }).waitFor({ timeout: 10_000 });
      check((await page.getByRole("radio", { name: /Regenerate · creative/ }).getAttribute("aria-checked")) === "true", `${label}: "Use it on your GPU" moves to the open engine on Regenerate`);
      await ctx.close();

      // ---- A feed tile's menu and the Library viewer.
      ctx = await setup(browser, device, theme, "open");
      page = await ctx.newPage();
      await openRoute(page, `${app}/video`);
      // The next steps under the newest result.
      const chipStep = page.getByRole("navigation", { name: "Next steps" }).first().getByRole("link", { name: "Regenerate in 2K" });
      await chipStep.waitFor({ timeout: 30_000 });
      check(await chipStep.isVisible(), `${label}: the next steps offer Regenerate in 2K`);
      const tileOpen = page.getByRole("button", { name: /^Open “A red fox/ }).first();
      if (device !== PHONE) {
        const box = await tileOpen.boundingBox();
        if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      }
      const more = page.getByRole("button", { name: "More actions" }).first();
      await more.waitFor({ timeout: 30_000 });
      if (device === PHONE) await more.tap();
      else await more.click();
      const item = page.getByRole("menuitem", { name: "Regenerate in 2K" });
      await item.waitFor({ timeout: 10_000 });
      check(await item.isVisible(), `${label}: a feed tile's menu has Regenerate in 2K`);
      await page.screenshot({ path: path.join(out, `tile-menu-${dname}-${theme}.png`) });
      if (device === PHONE) await item.tap();
      else await item.click();
      await page.waitForURL(/\/upscale\/video\?/, { timeout: 20_000 });
      const u = new URL(page.url());
      check(u.searchParams.get("model") === "oss-h3-regenerate" && u.searchParams.get("resolution") === "1440p" && !!u.searchParams.get("video"), `${label}: it opens Upscale → Video on Regenerate at 2K with the clip`);
      await page.getByRole("radiogroup", { name: "How to finish the clip" }).waitFor({ timeout: 30_000 });
      check(((await page.locator("[data-composer] textarea").first().inputValue()) ?? "").includes("red fox"), `${label}: …with the clip's own words, to edit`);
      await noSideScroll(page, `${label} hand-off`);
      await openRoute(page, `${app}/library`);
      const tile = page.getByRole("button", { name: /^Open “A red fox/ }).first();
      await tile.waitFor({ timeout: 30_000 });
      await tile.click({ force: true });
      const viewer = page.getByRole("dialog").last();
      await viewer.waitFor({ timeout: 15_000 });
      // A phone's viewer keeps the hand-offs under its ⋯ menu.
      if (device === PHONE) {
        await page.waitForTimeout(800);
        await viewer.getByRole("button", { name: "More actions and details" }).tap();
      }
      const viewerItem = page
        .getByRole("button", { name: "Regenerate in 2K" })
        .or(page.getByRole("link", { name: "Regenerate in 2K" }))
        .or(page.getByRole("menuitem", { name: "Regenerate in 2K" }));
      const shown = await viewerItem
        .first()
        .waitFor({ timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      check(shown, `${label}: the Library viewer has Regenerate in 2K`);
      await page.screenshot({ path: path.join(out, `library-viewer-${dname}-${theme}.png`) });
      await noSideScroll(page, `${label} library`);
      await ctx.close();
    }
  }

  // ---- Canvas: the palette's Regenerate (creative), at 1440 px (the phone's palette is the same list).
  for (const engine of ["open", "cloud"]) {
    const ctx = await setup(browser, DESKTOP, "light", engine);
    const page = await ctx.newPage();
    const c = await json("/api/canvases", { method: "POST", body: JSON.stringify({ name: `Regenerate check ${engine}`, graph: { nodes: [], edges: [] } }) });
    await page.goto(`${app}/canvas/${c.id ?? c.canvas?.id}`, { waitUntil: "load" });
    const palette = page.getByRole("complementary", { name: "Add nodes" });
    await palette.waitFor({ timeout: 60_000 });
    await palette.getByPlaceholder("Search nodes").fill("regenerate");
    await page.waitForTimeout(400);
    const entry = palette.getByText("Regenerate (creative)");
    check(await entry.first().isVisible(), `canvas ${engine}: the palette lists Regenerate (creative)`);
    const disabled = await palette.locator('[aria-disabled="true"]').filter({ hasText: "Regenerate (creative)" }).count();
    if (engine === "cloud") {
      check(disabled === 1, "canvas cloud: the entry is disabled");
      check(await palette.getByText(/Runs on your GPU \(open source\): switch the board to Open source/).first().isVisible(), "canvas cloud: with the GPU-only reason");
    } else check(disabled === 0, "canvas open: the entry can be added");
    await page.screenshot({ path: path.join(out, `canvas-palette-${engine}.png`) });
    await ctx.close();
  }
} catch (e) {
  failures.push(`script: ${e.message.split("\n")[0]}`);
  console.log(`✗ ${e.message.split("\n")[0]}`);
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} failed:\n${failures.join("\n")}` : "\nall passed");
console.log(`screenshots: ${out}`);
process.exit(failures.length ? 1 : 0);
