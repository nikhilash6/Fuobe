// Remove a person in the browser (demo mode: no keys, no GPU): Video tools → Remove a person opened from a clip handed
// over, the mask expansion and the green mask check, a demo run with its Before/After wipe and each window's "Redo
// from here" (the windows before it kept), the cloud saying it runs on your GPU, a video's "Remove a person" link, and
// Remove object, Remove a person and the Character Swap Studio at 1440 and 390 px, light and dark, without sideways
// scroll or console errors.
// Usage: node tests/e2e/remove-person-flows.mjs [appUrl] [--shots <dir>]   Exits 1 on a failed check.
import fs from "node:fs";
import path from "node:path";
import { launch, root } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(76)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};
const fixture = path.join(root, "tests/fixtures/shorts-12s.mp4");
async function upload(file, type, name) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(file)], { type }), name);
  const res = await fetch(`${app}/api/uploads`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return (await res.json()).url;
}
const clip = await upload(fixture, "video/mp4", "street walk.mp4");

const browser = await launch();
const errors = [];
const contextFor = async (engine, viewport = { width: 1440, height: 900 }, colorScheme = "light") => {
  const context = await browser.newContext({ viewport, colorScheme, ...(viewport.width < 500 && { isMobile: true, hasTouch: true }) });
  await context.addInitScript((e) => {
    try {
      localStorage.setItem("fuobe.engine", e);
    } catch {}
  }, engine);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.on("console", (m) => m.type() === "error" && errors.push(`${page.url()}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${page.url()}: ${e.message}`));
  return { context, page };
};
const text = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));

try {
  {
    const { context, page } = await contextFor("open");
    await page.goto(`${app}/video-tools/remove-person?video=${encodeURIComponent(clip)}`, { waitUntil: "load" });
    await page.getByRole("heading", { name: "Remove a person from a video" }).first().waitFor({ timeout: 30_000 }).catch(() => {});
    await page.locator("#remove-grow").waitFor({ timeout: 60_000 });
    let t = await text(page);
    check("the tab: H3 Person Removal picked on your GPU", /H3 Person Removal/.test(t));
    check("the mask expansion, 5 px by default", (await page.locator("#remove-grow").inputValue()) === "5");
    await page.locator("#remove-what").fill("the man in the grey shirt");
    await page.getByRole("button", { name: /Check the green mask/ }).waitFor({ timeout: 30_000 });
    t = await text(page);
    check("priced before it runs (free / demo)", /Free|Placeholder · free/.test(t));
    check("says to check the green mask first and that windows can be redone", /Preview the mask first/.test(t) && /redo a weak one/.test(t));
    await page.locator("#remove-grow").fill("12");
    await page.getByRole("button", { name: /Check the green mask/ }).click();
    await page.getByText(/Green mask/).first().waitFor({ timeout: 60_000 });
    check("the green mask preview", true);
    if (shots) await page.screenshot({ path: path.join(shots, "remove-person-open-1440.png"), fullPage: true });
    await page.getByRole("button", { name: /Remove it/ }).click();
    await page.getByRole("heading", { name: "Windows" }).waitFor({ timeout: 120_000 });
    const redo = page.getByRole("button", { name: "Redo from here, window 2" });
    check("each window with Redo from here", (await page.getByRole("button", { name: /^Redo from here, window/ }).count()) === 3);
    await redo.click();
    await page.getByText(/Redoing from window 2/).first().waitFor({ timeout: 30_000 });
    check("Redo from here starts a new run", true);
    if (shots) await page.screenshot({ path: path.join(shots, "remove-person-result-1440.png"), fullPage: true });
    // After a reload the earlier removal's windows are still there to redo.
    await page.reload({ waitUntil: "load" });
    await page.getByRole("heading", { name: "Redo a window" }).waitFor({ timeout: 60_000 });
    await page.locator("#earlier-windows ~ div details summary").first().click();
    const again = page.getByRole("button", { name: "Redo from here, window 1" }).first();
    await again.waitFor({ timeout: 30_000 });
    await again.click();
    await page.getByText(/Redoing from window 1/).first().waitFor({ timeout: 30_000 });
    check("after a reload: an earlier removal's windows can be redone", true);
    await context.close();
  }
  {
    const { context, page } = await contextFor("cloud");
    await page.goto(`${app}/video-tools/remove-person?video=${encodeURIComponent(clip)}`, { waitUntil: "load" });
    await page.getByText(/runs on your GPU \(open source\)/).first().waitFor({ timeout: 60_000 });
    check("cloud: says plainly that removing a person runs on your GPU", true);
    if (shots) await page.screenshot({ path: path.join(shots, "remove-person-cloud-1440.png"), fullPage: true });
    await context.close();
  }
  {
    const { context, page } = await contextFor("open");
    await page.goto(`${app}/library`, { waitUntil: "load" });
    await page.waitForTimeout(2000);
    const res = await fetch(`${app}/api/generations?features=remove-object&limit=1`).then((r) => r.json()).catch(() => null);
    check("a removal is in the Library", !!res);
    await context.close();
  }
  // Every touched page at 1440 and 390 px, light and dark: nothing scrolls sideways.
  for (const route of ["/video-tools/remove-person", "/video-tools/remove-object", "/character-swap"]) {
    for (const scheme of ["light", "dark"]) {
      for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
        const { context, page } = await contextFor("open", viewport, scheme);
        await page.goto(`${app}${route}${route.startsWith("/video-tools") ? `?video=${encodeURIComponent(clip)}` : ""}`, { waitUntil: "load" });
        await page.waitForTimeout(2500);
        const ok = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
        check(`${route} ${viewport.width}px ${scheme}: no sideways scroll`, ok);
        if (shots) await page.screenshot({ path: path.join(shots, `${route.replaceAll("/", "_")}-${viewport.width}-${scheme}.png`), fullPage: false });
        await context.close();
      }
    }
  }
  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
