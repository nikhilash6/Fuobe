// Where a run happens and what it costs, in the Marketing suite's composers, for every audience, end to end.
// Starts a stand-in fal.ai (tests/helpers/fake-cloud.ts) on WIR_PORT+2 and `next dev` on WIR_PORT (3900) with a
// throwaway data folder and ComfyUI on a dead port. No real key, no paid call, no GPU. Everything is stopped at the end.
//
//   node tests/e2e/where-it-runs.mjs [screenshots folder]
//
// Audiences: the owner; an account with its own fal.ai key; an account with no key and no GPU; a guest. Each at 390
// and 1440 wide. Checks, per surface (Marketing Studio, Click to Ad, Ad Multiplier, Ads Studio's New ads, a Kinetic
// template): the composer has a place chip; the owner's says your GPU or the cloud (never "Not available here") and opens
// a panel with the engine switch; anyone else is told the tool isn't available here, with no price and never "Free";
// a Kinetic template and Click to Ad's end card say they run in your browser, free, to everyone; no horizontal scroll on
// a phone. The apps with tools of their own: Tap to Recolor (everyone) and Relight (the owner, before its GPU check)
// say your GPU, free, and what a guest (sign up) or an account with no GPU (connect it) does first.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DESKTOP, launch, PHONE, root } from "./_browser.mjs";
import { startFakeFal } from "../helpers/fake-cloud.ts";
import { tempDir, removeDir } from "./_temp.mjs";

const APP_PORT = Number(process.env.WIR_PORT ?? 3900);
const APP = `http://127.0.0.1:${APP_PORT}`;
const shots = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-where-it-runs-")));
fs.mkdirSync(shots, { recursive: true });
const data = tempDir("fuobe-where-it-runs-data-");
const logFile = path.join(shots, "server.log");

const PASSWORD = "owner password for where it runs";
const ACCT_FAL = "wir-acct-key-id:wir-acct-secret-41c2";
const KINETIC = "ms-kinetic-headline";

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const fal = await startFakeFal(APP_PORT + 2);
fal.keys[ACCT_FAL] = "good";

const log = fs.openSync(logFile, "w");
const server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "-p", String(APP_PORT), "-H", "127.0.0.1"], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "development",
    FUOBE_DATA_DIR: data,
    FUOBE_PASSWORD: PASSWORD,
    FUOBE_PUBLIC_SIGNUP: "1",
    FUOBE_DEV_FAL_URL: fal.url,
    COMFYUI_URL: "http://127.0.0.1:9",
    FUOBE_ACCOUNT_DISK_FREE_GB: "0",
  },
  stdio: ["ignore", log, log],
});

async function stopAll() {
  try {
    if (process.platform === "win32") execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
    else server.kill("SIGTERM");
  } catch {}
  await fal.close();
}

const api = async (route, { method = "GET", body, cookie } = {}) => {
  const res = await fetch(APP + route, { method, headers: { "Content-Type": "application/json", Origin: APP, ...(cookie && { cookie }) }, ...(body !== undefined && { body: JSON.stringify(body) }) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, text, json, headers: res.headers };
};
const cookieOf = (res) => /fuobe_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")?.[0];

/** The page's place chip, once the viewer is known (the chip waits for it). */
async function chipOf(page, scope = page, sel = "[data-run-place]") {
  const chip = scope.locator(sel).first();
  await chip.waitFor({ state: "attached", timeout: 60_000 }).catch(() => {});
  if (!(await chip.count())) return null;
  return { el: chip, where: await chip.getAttribute("data-run-place"), text: ((await chip.textContent()) ?? "").trim(), aria: (await chip.getAttribute("aria-label")) ?? "" };
}

const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

try {
  for (let i = 0; i < 240; i++) {
    try {
      const r = await fetch(`${APP}/login`);
      if (r.status < 500) break;
    } catch {}
    await wait(1000);
  }

  const owner = cookieOf(await api("/api/auth/login", { method: "POST", body: { password: PASSWORD } }));
  check(!!owner, "owner signs in");
  // A brand kit and a product, so Ads Studio's New ads has something to price.
  const brand = await api("/api/brands", { method: "POST", cookie: owner, body: { name: "Maison Test", description: "A small perfume house in Paris." } });
  const brandId = brand.json?.id;
  if (brandId) await api("/api/products", { method: "POST", cookie: owner, body: { name: "Eau de Nuit", brandId, description: "A night perfume." } });
  check(!!brandId, `owner makes a brand kit for New ads (${brand.status})`);

  const keyed = cookieOf(await api("/api/auth/signup", { method: "POST", body: { email: "wir-keyed@example.com", password: "account password one" } }));
  check(!!keyed, "an account signs up (it will add its key)");
  const put = await api("/api/account/keys/fal", { method: "PUT", cookie: keyed, body: { key: ACCT_FAL } });
  check(put.status === 200, `that account adds its own fal.ai key (${put.status})`);
  const bare = cookieOf(await api("/api/auth/signup", { method: "POST", body: { email: "wir-bare@example.com", password: "account password two" } }));
  check(!!bare, "an account signs up with no key and no GPU");

  const AUDIENCES = [
    ["owner", owner],
    ["account-with-key", keyed],
    ["account-without", bare],
    ["guest", null],
  ];
  const SURFACES = [
    ["marketing", "/marketing", "Marketing Studio"],
    ["click-to-ad", "/marketing/click-to-ad", "Click to Ad"],
    ["multiplier", "/ads/multiplier", "Ad Multiplier"],
    ...(brandId ? [["new-ads", `/ads/${brandId}?step=new`, "Ads Studio"]] : []),
  ];

  const browser = await launch();
  for (const [who, cookie] of AUDIENCES) {
    for (const [size, opts] of [
      ["1440", DESKTOP],
      ["390", PHONE],
    ]) {
      const ctx = await browser.newContext({ ...opts, baseURL: APP });
      if (cookie) {
        const [name, value] = cookie.split("=");
        await ctx.addCookies([{ name, value, url: APP }]);
      }
      const page = await ctx.newPage();
      for (const [id, route, tool] of SURFACES) {
        // Ads Studio's brand pages are the owner's: anyone else never reaches New ads.
        if (id === "new-ads" && who !== "owner") continue;
        await page.goto(route, { waitUntil: "load", timeout: 240_000 });
        await page.waitForTimeout(2500);
        const tag = `${who} ${size} ${tool}`;
        if (id === "click-to-ad") {
          // Before a product is picked: the end card to try, drawn in your browser, free, for everyone.
          const card = await chipOf(page, page.locator('section[aria-labelledby="c2a-end-card-try"]'));
          check(card?.where === "browser" && /Your browser/.test(card.text) && /Free/.test(card.text), `${tag}: the end card runs in your browser, free ("${card?.text}")`);
          if (who !== "owner") {
            // No products of its own and no composer: the page says it isn't available here.
            check(await page.getByText("Click to Ad isn't available here.").first().isVisible().catch(() => false), `${tag}: the page says it isn't available here`);
            check(!(await page.locator('[data-run-place]:not([data-run-place="browser"])').count()), `${tag}: no run place offered`);
            if (size === "390") check(await noSideScroll(page), `${tag}: no horizontal scroll at 390`);
            await page.screenshot({ path: path.join(shots, `${who}-${size}-${id}.png`) });
            continue;
          }
          await page.getByRole("button", { name: /Eau de Nuit/ }).first().click();
          await page.waitForTimeout(2500);
        }
        const chip = await chipOf(page, page, '[data-run-place]:not([data-run-place="browser"])');
        check(!!chip, `${tag}: the composer says where it runs`);
        if (!chip) continue;
        if (who === "owner") {
          check(chip.where === "gpu" || chip.where === "cloud", `${tag}: on your GPU or in the cloud (${chip.where}: "${chip.text}")`);
          check(chip.where !== "gpu" || /Your GPU/.test(chip.text), `${tag}: the GPU chip says Your GPU`);
          // A cloud chip names its model (never a bare "Cloud"), and the screen reader never hears "on Cloud".
          check(chip.where !== "cloud" || !/^Cloud\b/.test(chip.text), `${tag}: the cloud chip names its model ("${chip.text}")`);
          check(!/on Cloud\b/.test(chip.aria), `${tag}: the chip's label names no bare cloud ("${chip.aria}")`);
          if (size === "390" && id === "marketing") {
            // A phone's Marketing chip is its icon and price: the format chip keeps its room.
            const label = chip.el.locator("span").first();
            check(!(await label.isVisible().catch(() => true)), `${tag}: the phone chip leaves its label to the panel`);
          }
          await chip.el.click();
          const panel = page.getByText(chip.where === "gpu" ? "Runs on your GPU" : "Runs in the cloud").first();
          check(await panel.isVisible({ timeout: 10_000 }).catch(() => false), `${tag}: the chip opens where it runs`);
          if (size === "1440") {
            await page.waitForTimeout(900);
            // The popover takes focus itself: no control's tooltip covers its words.
            check(!(await page.locator('[role="tooltip"]').first().isVisible().catch(() => false)), `${tag}: no tooltip covers the panel`);
          }
          await page.screenshot({ path: path.join(shots, `${who}-${size}-${id}-panel.png`) });
          const sw = page.getByRole("radiogroup").or(page.locator('[role="dialog"] button, [data-radix-popper-content-wrapper] button').filter({ hasText: /Cloud|Open source/ }));
          check((await sw.count()) > 0, `${tag}: the engine switch is in the panel`);
          await page.keyboard.press("Escape");
        } else {
          check(chip.where === "unavailable" && /Not available here/.test(chip.text), `${tag}: told it isn't available here ("${chip.text}")`);
          check(!/free|\$/i.test(chip.text + chip.aria), `${tag}: no price and never "free"`);
        }
        if (size === "390") check(await noSideScroll(page), `${tag}: no horizontal scroll at 390`);
        await page.screenshot({ path: path.join(shots, `${who}-${size}-${id}.png`) });
      }

      // A Kinetic template: drawn in your browser, free, for everyone.
      await page.goto(`/marketing?template=${KINETIC}`, { waitUntil: "load", timeout: 240_000 });
      const panel = page.locator(`[data-kinetic-template="${KINETIC}"]`);
      await panel.waitFor({ timeout: 120_000 }).catch(() => {});
      const k = await chipOf(page, panel);
      check(k?.where === "browser" && /Your browser/.test(k.text) && /Free/.test(k.text), `${who} ${size} Kinetic: runs in your browser, free ("${k?.text}")`);
      if (k) {
        await k.el.click();
        check(await page.getByText("Runs in your browser").first().isVisible({ timeout: 10_000 }).catch(() => false), `${who} ${size} Kinetic: the chip says it plays instantly and free`);
        await page.screenshot({ path: path.join(shots, `${who}-${size}-kinetic.png`) });
        await page.keyboard.press("Escape");
      }
      if (size === "390") check(await noSideScroll(page), `${who} 390 Kinetic: no horizontal scroll`);

      // Apps with tools of their own: on your GPU, free; a guest signs up and an account connects its GPU first.
      const APPS = [["recolor", "/apps/app-tap-to-recolor", "Tap to Recolor"], ...(who === "owner" ? [["relight", "/apps/app-relight", "Relight"]] : [])];
      for (const [id, route, tool] of APPS) {
        const tag = `${who} ${size} ${tool}`;
        await page.goto(route, { waitUntil: "load", timeout: 240_000 });
        if (id === "recolor") await page.getByText("Try it on this photo").first().click({ timeout: 60_000 }).catch(() => {});
        const a = await chipOf(page);
        check(a?.where === "gpu" && /Your GPU/.test(a.text) && /Free/.test(a.text), `${tag}: runs on your GPU, free ("${a?.text}")`);
        if (!a) continue;
        await a.el.click();
        check(await page.getByText("Runs on your GPU").first().isVisible({ timeout: 10_000 }).catch(() => false), `${tag}: the chip opens where it runs`);
        const next = { owner: null, guest: "Sign up free", "account-with-key": "Connect your GPU", "account-without": "Connect your GPU" }[who];
        if (next) check(await page.getByRole(next === "Sign up free" ? "link" : "button", { name: next }).first().isVisible().catch(() => false), `${tag}: says what to do first ("${next}")`);
        await page.screenshot({ path: path.join(shots, `${who}-${size}-${id}.png`) });
        await page.keyboard.press("Escape");
        if (size === "390") check(await noSideScroll(page), `${tag}: no horizontal scroll at 390`);
      }
      await ctx.close();
    }
  }
  await browser.close();
} catch (e) {
  console.error(e);
  failures.push(String(e?.message ?? e));
} finally {
  await stopAll();
  removeDir(data);
}

console.log(`\n${failures.length ? `${failures.length} FAILED` : "all passed"} · screenshots in ${shots}`);
process.exit(failures.length ? 1 : 0);
