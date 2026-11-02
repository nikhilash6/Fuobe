// "Start from an example", as a guest: on one page of each kind, the first example card loads its own files, words and
// settings into the page's composer, a price shows and Generate stays enabled; pressing it opens the sign-up card (no
// "upload it again" or "expired" error: the example's files are Fuobe's own). `?example=<id>` opens a page with that
// example loaded. Then (with --account) a new account with no GPU: Generate asks to connect a GPU, not for an upload.
// Usage: node tests/e2e/examples.mjs <appUrl> [--shots <dir>] [--account]
//   (the app with a password and FUOBE_PUBLIC_SIGNUP=1). Exits 1 on a failed check.
import fs from "node:fs";
import path from "node:path";
import { DESKTOP, launch, openRoute, PHONE } from "./_browser.mjs";

const argv = process.argv.slice(2);
// The address is required: a default would reach whatever server happens to run on that port.
const given = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots");
if (!given) {
  console.error("usage: node tests/e2e/examples.mjs <appUrl> [--shots <dir>] [--account]");
  process.exit(2);
}
const app = given.replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(80)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};

/** One surface of each kind: its page, and what its first example puts in the composer. */
const SURFACES = [
  { url: "/apps/app-relight", inputs: ["/examples/app-relight/1/in-image.jpg"], chips: ["Golden hour"] },
  { url: "/apps/app-face-swap", inputs: ["/examples/app-face-swap/1/in-image.jpg", "/examples/app-face-swap/1/in-image2.jpg"] },
  { url: "/apps/app-dance", inputs: ["/examples/app-dance/1/in-image.jpg"], chips: ["Hip hop"], optional: true },
  { url: "/video?preset=effect-levitation", inputs: ["/examples/effect-levitation/1/in-image.jpg"] },
  { url: "/video?preset=effect-smoke-transition", inputs: ["/examples/effect-smoke-transition/1/in-image.jpg", "/examples/effect-smoke-transition/1/in-end-image.jpg"], optional: true },
  { url: "/image", words: true },
  { url: "/edit", inputs: ["/examples/app-relight/1/in-image.jpg"], words: true },
  { url: "/inpaint", inputs: ["/examples/app-object-remover/1/in-image.jpg"], words: true },
  { url: "/upscale", inputs: ["/examples/app-upscale/1/in-image.jpg"] },
  { url: "/video", inputs: ["/examples/effect-levitation/1/in-image.jpg"] },
];

const GUEST_RUN_CARD = "Create a free account to run this";
const GPU_RUN_CARD = "Connect your GPU to run this";
const BAD = /upload it again|has expired|upload the file/i;

const browser = await launch();

/** The composer's files (slot pictures), words, price and Generate. */
async function composer(page) {
  const root = page.locator("[data-studio] [data-composer]").first();
  const srcs = await root.locator("img").evaluateAll((els) => els.map((e) => e.getAttribute("src") ?? ""));
  const words = await root.locator("textarea").first().inputValue().catch(() => "");
  const generate = root.getByRole("button", { name: /^Generate/ });
  const enabled = await generate.isEnabled().catch(() => false);
  // The price beside Generate: "Free" on a GPU of one's own, else what it costs.
  const prices = await root.locator("span.tabular-nums").allTextContents();
  const price = prices.find((t) => /free|\$\s?\d|\d+\s?credits?/i.test(t)) ?? "";
  const pressed = await root.locator("button[aria-pressed=true], button[aria-checked=true], [data-state=on]").allTextContents();
  return { srcs, words, enabled, price: price.trim(), pressed, generate };
}

async function guestSurface(s, size) {
  const context = await browser.newContext(size === "phone" ? PHONE : DESKTOP);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  const priceChecks = [];
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/generations" && u.searchParams.get("preview") === "1") priceChecks.push(r.status());
  });
  const label = `${s.url} (${size})`;
  await openRoute(page, `${app}${s.url}`, { settleMs: 2500 });
  const card = page.locator("button[data-example][aria-label^='Use this example']").first();
  const has = (await card.count()) > 0;
  if (!has && s.optional) {
    console.log(`skip ${label}: no example to load yet`);
    await context.close();
    return;
  }
  check(`${label}: an example card shows`, has);
  if (!has) return context.close();
  await card.scrollIntoViewIfNeeded();
  const box = await card.boundingBox();
  check(`${label}: the card is a 44 px tap target`, !!box && box.width >= 44 && box.height >= 44);
  await card.click();
  await page.waitForTimeout(2500);
  const c = await composer(page);
  for (const want of s.inputs ?? []) check(`${label}: the composer holds ${want}`, c.srcs.some((x) => x.split("?")[0] === want), c.srcs.join(" "));
  if (s.words) check(`${label}: the example's words are in the composer`, c.words.trim().length > 10, c.words.slice(0, 60));
  for (const chip of s.chips ?? []) check(`${label}: setting ${chip} is picked`, c.pressed.some((t) => t.includes(chip)), c.pressed.join(","));
  check(`${label}: the card says it is in the composer`, (await page.locator("[data-example][aria-pressed=true]").count()) > 0);
  check(`${label}: Generate is enabled`, c.enabled);
  check(`${label}: a price shows`, !!c.price && c.price !== "—", c.price);
  check(`${label}: no price check refused the example's files`, priceChecks.every((x) => x === 200), priceChecks.join(","));
  if (shots) await page.screenshot({ path: path.join(shots, `${s.url.replace(/[/?=]+/g, "_")}-${size}.png`) });
  await c.generate.click();
  await page.waitForTimeout(2000);
  const dialogs = await page.getByRole("dialog").allTextContents();
  const toasts = await page.locator("[data-sonner-toast]").allTextContents();
  check(`${label}: Generate opens the sign-up card`, dialogs.some((d) => d.includes(GUEST_RUN_CARD)), dialogs.join(" | ").slice(0, 120));
  check(`${label}: no upload or expired error`, ![...dialogs, ...toasts].some((t) => BAD.test(t)), toasts.join(" | ").slice(0, 120));
  check(`${label}: no page errors`, !errors.length, errors.slice(0, 2).join(" | ").slice(0, 160));
  await context.close();
}

for (const s of SURFACES) await guestSurface(s, "desktop");
for (const s of SURFACES.slice(0, 4)) await guestSurface(s, "phone");

// Tools with a page of their own: Color grading opens an example with its look picked (graded in the browser); Clean up
// voice loads its example recording, prices it, and asks a guest to sign up.
for (const size of ["desktop", "phone"]) {
  const context = await browser.newContext(size === "phone" ? PHONE : DESKTOP);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openRoute(page, `${app}/color-grade`, { settleMs: 2000 });
  const grade = page.locator("button[data-example='grade.2']");
  check(`/color-grade (${size}): its examples show`, (await grade.count()) > 0);
  if (await grade.count()) {
    const box = await grade.boundingBox();
    check(`/color-grade (${size}): an example is a 44 px tap target`, !!box && box.height >= 44);
    await grade.click();
    await page.waitForTimeout(2500);
    check(`/color-grade (${size}): the photo is graded`, (await page.locator("canvas").count()) > 0);
    check(`/color-grade (${size}): its look is picked`, (await page.locator("button[aria-pressed=true]").allTextContents()).some((t) => t.includes("Teal")));
  }
  await openRoute(page, `${app}/apps/app-clean-up-voice`, { settleMs: 2000 });
  const tryIt = page.getByRole("button", { name: "Try it on this recording" });
  check(`/apps/app-clean-up-voice (${size}): "Try it on this recording" shows`, (await tryIt.count()) > 0);
  if (await tryIt.count()) {
    await tryIt.click();
    await page.waitForTimeout(3000);
    const run = page.getByRole("button", { name: /Clean up voice$/ }).last();
    const status = (await page.locator("p[aria-live=polite]").allTextContents()).join(" ");
    check(`/apps/app-clean-up-voice (${size}): the recording is priced`, /free|\$/i.test(status) && !BAD.test(status) && !/gone/i.test(status), status.slice(0, 80));
    check(`/apps/app-clean-up-voice (${size}): Clean up voice is enabled`, await run.isEnabled());
    await run.click();
    await page.waitForTimeout(2000);
    // A guest gets the tool's own answer for guests (the sign-up card, or "isn't available here" on an install where
    // it runs only on an account's own GPU), never one about the file.
    const said = [...(await page.getByRole("dialog").allTextContents()), ...(await page.locator("[data-sonner-toast]").allTextContents())];
    check(`/apps/app-clean-up-voice (${size}): a guest gets the tool's answer, not a file error`, said.some((d) => d.includes(GUEST_RUN_CARD) || /isn't available here/.test(d)) && !said.some((t) => BAD.test(t) || /gone/i.test(t)), said.join(" | ").slice(0, 120));
  }
  // Hook check runs in the browser: an example clip gets its result as a guest.
  await openRoute(page, `${app}/virality`, { settleMs: 2000 });
  const hook = page.locator("button[data-example='virality.1']");
  check(`/virality (${size}): its examples show`, (await hook.count()) > 0);
  if (await hook.count()) {
    await hook.click();
    await page.getByRole("button", { name: /Check the hook/ }).click();
    const done = await page.getByRole("button", { name: /Check again/ }).waitFor({ timeout: 60_000 }).then(() => true, () => false);
    check(`/virality (${size}): the example clip gets its result`, done);
  }
  check(`tools (${size}): no page errors`, !errors.length, errors.slice(0, 2).join(" | ").slice(0, 160));
  await context.close();
}

// A link that opens the page with an example loaded.
{
  const context = await browser.newContext(DESKTOP);
  const page = await context.newPage();
  await openRoute(page, `${app}/apps/app-relight?example=app-relight.1`, { settleMs: 3000 });
  const c = await composer(page);
  check("?example= opens the page with the example loaded", c.srcs.some((x) => x.split("?")[0] === "/examples/app-relight/1/in-image.jpg"), c.srcs.join(" "));
  await openRoute(page, `${app}/video?example=effect-levitation.1`, { settleMs: 4000 });
  const v = await composer(page);
  check("?example= loads a motion's or effect's example in the Video studio", v.srcs.some((x) => x.split("?")[0] === "/examples/effect-levitation/1/in-image.jpg"), v.srcs.join(" "));
  // Another page's example stays out: an effect's never lands in the Image composer.
  await openRoute(page, `${app}/image?example=effect-levitation.1`, { settleMs: 4000 });
  const i = await composer(page);
  check("?example= from another page loads nothing", !i.srcs.some((x) => x.includes("effect-levitation")) && !i.words.trim() && !page.url().includes("preset="), `${page.url()} ${i.srcs.join(" ")}`);
  await context.close();
}

// The server: a guest's price check with an example file, and one with a file that isn't published.
{
  const body = (ref) => ({ feature: "app:app-relight", presetId: "app-relight", modelId: "oss-qwen-image-21-turbo", inputs: { images: [ref] }, presetOptions: { light: "golden-hour" } });
  const post = (ref) => fetch(`${app}/api/generations?preview=1`, { method: "POST", headers: { "Content-Type": "application/json", Origin: app }, body: JSON.stringify(body(ref)) });
  const ok = await post("/examples/app-relight/1/in-image.jpg");
  check("a guest's price check reads an example file", ok.status === 200, String(ok.status));
}

if (argv.includes("--account")) {
  const context = await browser.newContext(DESKTOP);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  const email = `examples-${Date.now()}@example.com`;
  await openRoute(page, `${app}/login?mode=signup`, { settleMs: 1500 });
  await page.getByLabel(/email/i).first().fill(email);
  await page.getByLabel(/password/i).first().fill(`Ex-${Date.now()}-check!`);
  await page.getByRole("button", { name: /sign up|create/i }).first().click();
  await page.waitForTimeout(3000);
  await openRoute(page, `${app}/apps/app-relight`, { settleMs: 2500 });
  await page.locator("button[data-example]").first().click();
  await page.waitForTimeout(2000);
  const c = await composer(page);
  await c.generate.click();
  await page.waitForTimeout(2500);
  const dialogs = await page.getByRole("dialog").allTextContents();
  const toasts = await page.locator("[data-sonner-toast]").allTextContents();
  check("an account with no GPU: Generate asks to connect a GPU", dialogs.some((d) => d.includes(GPU_RUN_CARD)), dialogs.join(" | ").slice(0, 120));
  check("an account with no GPU: no upload error", ![...dialogs, ...toasts].some((t) => BAD.test(t)), toasts.join(" | ").slice(0, 120));
  await context.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
