// Browser check of Relight (the app's own tool: tap to place lights, a live preview, Generate lighting, Intensity).
// Usage: node tests/e2e/relight.mjs [appUrl] [outDir] [--guest guestAppUrl]
//   appUrl: the app signed in as the owner, its ComfyUI a stand-in (tests/helpers/fake-comfy-runner.ts --output image).
//   --guest: the same build with public sign-up on, seen signed out.
// Checks, on a phone (390 x 844, touch) and a desktop (1440 x 900): the page opens on the demo with its result and no
// sideways scroll; an Intensity chip changes the picture at once; a tap on the photo places a light where it was tapped;
// a colour chip changes the light near it and leaves the far corner alone; a look places its lights; Download gives a
// PNG at the photo's size; on the desktop the arrow keys move the selected light and Delete removes it; Generate
// lighting runs the hidden relight model on the stand-in and the result comes back. With --guest: a guest uses the demo,
// places a light, and Generate asks them to create an account (no error toast). A page error fails the run.
import fs from "node:fs";
import path from "node:path";
import { DESKTOP, PHONE, launch, openRoute } from "./_browser.mjs";

const argv = process.argv.slice(2);
const guestAt = argv.indexOf("--guest");
const guestApp = guestAt >= 0 ? argv[guestAt + 1] : null;
const args = argv.filter((a, i) => !a.startsWith("--") && i !== guestAt + 1);
const app = args[0] ?? "http://127.0.0.1:3330";
const out = args[1] ?? fs.mkdtempSync(path.join(process.env.TMPDIR ?? "/tmp", "fuobe-relight-"));
fs.mkdirSync(out, { recursive: true });

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
};

/** The stage's pixels at fractions (x 0 left … 1 right, y 0 top … 1 bottom) of the canvas. */
const pixels = (page, spots) =>
  page.evaluate((spots) => {
    const c = document.querySelector('[data-testid="relight-stage"] canvas');
    const t = document.createElement("canvas");
    t.width = c.width;
    t.height = c.height;
    const x = t.getContext("2d");
    x.drawImage(c, 0, 0);
    return spots.map(([fx, fy]) => [...x.getImageData(Math.min(c.width - 1, Math.round(fx * c.width)), Math.min(c.height - 1, Math.round(fy * c.height)), 1, 1).data.slice(0, 3)]);
  }, spots);
const diff = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
const markers = (page) =>
  page.$$eval('[data-testid="relight-stage"] [data-light]', (els) => {
    const box = document.querySelector('[data-testid="relight-stage"]').getBoundingClientRect();
    return els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: (r.left + r.width / 2 - box.left) / box.width, y: (r.top + r.height / 2 - box.top) / box.height, color: getComputedStyle(e.firstElementChild).backgroundColor };
    });
  });
const settle = (page) => page.waitForTimeout(250);

async function stageBox(page) {
  const s = page.locator('[data-testid="relight-stage"]');
  await s.scrollIntoViewIfNeeded();
  return s.boundingBox();
}
async function tapAt(page, device, fx, fy) {
  const b = await stageBox(page);
  const x = b.x + fx * b.width;
  const y = b.y + fy * b.height;
  if (device.hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await settle(page);
}

async function ownerRun(browser, name, device) {
  const ctx = await browser.newContext({ ...device, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check(false, `${name}: no page error (${String(e.message).slice(0, 160)})`));
  const runs = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && new URL(r.url()).pathname === "/api/generations") runs.push(JSON.parse(r.postData() ?? "{}"));
  });
  await openRoute(page, `${app}/apps/app-relight`);
  await page.locator('[data-testid="relight-stage"] canvas').waitFor();
  await page.waitForTimeout(1500);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 0, `${name}: no horizontal scroll (${over}px)`);
  check(await page.getByText("Light your photo like a set.").isVisible(), `${name}: the hero line`);
  check(await page.getByRole("button", { name: /Lit with these lights/ }).isVisible(), `${name}: the demo opens with its result`);
  const text = await page.locator("main, body").first().innerText();
  const named = /Viggle|Qwen|LoRA|\bseed\b|6-step/i.exec(text.replace(/viggle-6/g, ""));
  check(!named, `${name}: no model, add-on or step names outside the owner's line${named ? ` (…${text.slice(Math.max(0, named.index - 60), named.index + 40)}…)` : ""}`);
  await page.screenshot({ path: path.join(out, `${name}-demo.png`), fullPage: false });

  // Intensity: instant.
  const spots = [
    [0.3, 0.4],
    [0.7, 0.6],
    [0.5, 0.2],
  ];
  const before = await pixels(page, spots);
  await page.getByRole("radiogroup", { name: "Intensity" }).getByRole("radio", { name: "100 %" }).click();
  await settle(page);
  const after = await pixels(page, spots);
  check(spots.some((_, i) => diff(before[i], after[i]) > 4), `${name}: Intensity 100 % changes the picture at once`);
  await page.getByRole("radiogroup", { name: "Intensity" }).getByRole("radio", { name: "60 %" }).click();

  // Download: a PNG at the photo's size.
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
  const file = path.join(out, `${name}-download.png`);
  await download.saveAs(file);
  const png = fs.readFileSync(file);
  check(png.subarray(1, 4).toString() === "PNG" && png.readUInt32BE(16) === 1280 && png.readUInt32BE(20) === 960, `${name}: Download gives a 1280 x 960 PNG`);

  // A look places its lights.
  await page.getByRole("radiogroup", { name: "Looks" }).getByRole("radio", { name: "Neon night" }).click();
  await settle(page);
  const neon = await markers(page);
  check(neon.length === 2 && neon[0].color === "rgb(240, 40, 220)" && neon[1].color === "rgb(40, 96, 255)", `${name}: Neon night places magenta left and blue right`);
  check(neon[0].x < 0.35 && neon[1].x > 0.65, `${name}: its lights sit on their sides`);

  // A tap on an empty spot adds a light there.
  await tapAt(page, device, 0.5, 0.15);
  const three = await markers(page);
  const added = three[2];
  check(three.length === 3 && Math.abs(added.x - 0.5) < 0.02 && Math.abs(added.y - 0.15) < 0.02, `${name}: a tap places a light where tapped (${added ? `${added.x.toFixed(3)}, ${added.y.toFixed(3)}` : "none"})`);
  check(await page.getByTestId("lights-changed").isVisible(), `${name}: "Lights changed" shows`);
  await page.screenshot({ path: path.join(out, `${name}-three-lights.png`) });

  // A colour chip changes the light near it and leaves the far corner alone.
  const near = [[0.5, 0.18]];
  const far = [[0.02, 0.98]];
  const n0 = await pixels(page, [...near, ...far]);
  await page.getByRole("radiogroup", { name: "Colour" }).getByRole("radio", { name: "Teal" }).click();
  await settle(page);
  const n1 = await pixels(page, [...near, ...far]);
  check(diff(n0[0], n1[0]) > 6, `${name}: Teal changes the picture near the light (${diff(n0[0], n1[0])})`);
  check(diff(n0[1], n1[1]) <= 3, `${name}: the far corner stays the same (${diff(n0[1], n1[1])})`);

  if (!device.hasTouch) {
    // Desktop extras: the arrow keys move the selected light, Delete removes it.
    await page.locator('[data-testid="relight-stage"]').focus();
    const m0 = (await markers(page))[2];
    await page.keyboard.press("ArrowRight");
    await settle(page);
    const m1 = (await markers(page))[2];
    check(m1.x > m0.x + 0.01, `${name}: ArrowRight moves the selected light`);
    await page.keyboard.press("Delete");
    await settle(page);
    check((await markers(page)).length === 2, `${name}: Delete removes it`);
  } else {
    await page.getByRole("button", { name: "Remove light", exact: true }).click();
    await settle(page);
    check((await markers(page)).length === 2, `${name}: Remove light removes it`);
  }

  // Generate lighting on the stand-in ComfyUI.
  await page.getByRole("radiogroup", { name: "Looks" }).getByRole("radio", { name: "Candlelight" }).click();
  await settle(page);
  const generate = page.getByRole("button", { name: /Generate lighting|Generate again/ }).last();
  await generate.click();
  await page.getByRole("button", { name: /Lit with these lights/ }).waitFor({ timeout: 60_000 }).catch(() => {});
  const lit = runs.find((r) => r.modelId === "oss-qwen-image-21-relight");
  check(!!lit && /warm amber light/.test(lit.prompt) && lit.inputs?.images?.[0]?.startsWith("/api/files/"), `${name}: Generate runs the relight model with the photo and the words`);
  check(await page.getByRole("button", { name: /Lit with these lights/ }).isVisible(), `${name}: the result comes back`);
  check(await page.getByRole("button", { name: "Keep", exact: true }).isVisible(), `${name}: Keep is offered to the owner`);
  await page.screenshot({ path: path.join(out, `${name}-generated.png`), fullPage: true });
  await ctx.close();
}

async function guestRun(browser, name, device) {
  const ctx = await browser.newContext({ ...device });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => check(false, `${name}: no page error (${String(e.message).slice(0, 160)})`));
  await openRoute(page, `${guestApp}/apps/app-relight`);
  await page.locator('[data-testid="relight-stage"] canvas').waitFor();
  await page.waitForTimeout(1500);
  check(await page.getByRole("button", { name: /Lit with these lights/ }).isVisible(), `${name}: a guest sees the demo's result`);
  const before = await pixels(page, [[0.4, 0.4]]);
  await page.getByRole("radiogroup", { name: "Intensity" }).getByRole("radio", { name: "35 %" }).click();
  await settle(page);
  check(diff(before[0], (await pixels(page, [[0.4, 0.4]]))[0]) > 2, `${name}: Intensity works for a guest`);
  await tapAt(page, device, 0.5, 0.12);
  check((await markers(page)).length === 3, `${name}: a guest places a light`);
  await page.getByRole("button", { name: /Generate again|Generate lighting/ }).last().click();
  const prompt = page.getByText("Create a free account to run this");
  await prompt.waitFor({ timeout: 10_000 }).catch(() => {});
  check(await prompt.isVisible(), `${name}: Generate asks a guest to create an account`);
  check((await page.locator("[data-sonner-toast][data-type='error']").count()) === 0, `${name}: no error toast`);
  check(await page.getByText("Create a free account to light your own photos.").isVisible(), `${name}: the line under Generate says why`);
  await page.screenshot({ path: path.join(out, `${name}-guest.png`) });
  await ctx.close();
}

const browser = await launch();
try {
  await ownerRun(browser, "phone", PHONE);
  await ownerRun(browser, "desktop", DESKTOP);
  if (guestApp) {
    await guestRun(browser, "guest-phone", PHONE);
    await guestRun(browser, "guest-desktop", DESKTOP);
  }
} finally {
  await browser.close();
}
console.log(`\nScreenshots in ${out}`);
if (failures.length) {
  console.log(`${failures.length} check(s) failed`);
  process.exit(1);
}
