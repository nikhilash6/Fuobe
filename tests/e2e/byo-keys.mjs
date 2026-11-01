// Your keys, end to end (DESIGN: an account brings its own fal.ai or Replicate key). Starts stand-in fal.ai and
// Replicate servers (tests/helpers/fake-cloud.ts) on 3391/3392 and `next dev` on 3390 with a throwaway data folder, the
// owner's sentinel keys in the environment and Settings, and FUOBE_DEV_FAL_URL / FUOBE_DEV_REPLICATE_URL pointing at
// the stand-ins. No real key, no paid call. Everything it starts is stopped at the end.
//
//   node tests/e2e/byo-keys.mjs [screenshots folder]
//
// BYO_PORT moves all three (app, fal.ai, Replicate on the next two ports) when 3390–3392 are taken.
//
// Checks: the owner's runs send the owner's key; an account without a key can't run a paid model; an account adds a
// bad key (refused) and a good one; its paid run sends only its key; removing the key with a run going asks first and
// stops the run with that key; no key shows in any answer, page or server log. Screenshots: Settings → Your keys and
// the model picker, on a phone and a desktop.
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DESKTOP, launch, PHONE, root } from "./_browser.mjs";
import { startFakeFal, startFakeReplicate } from "../helpers/fake-cloud.ts";

const APP_PORT = Number(process.env.BYO_PORT ?? 3390);
const APP = `http://127.0.0.1:${APP_PORT}`;
const shots = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-byo-shots-")));
fs.mkdirSync(shots, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-byo-data-"));
const logFile = path.join(data, "..", `${path.basename(data)}-server.log`);

const PASSWORD = "owner password for the smoke";
const OWNER_FAL = "owner-fal-db-key:owner-fal-db-secret";
const OWNER_ENV = { FAL_KEY: "owner-fal-env:owner-fal-env-secret", REPLICATE_API_TOKEN: "r8_ownerEnvToken" };
const ACCT_FAL = "acct-smoke-key-id:acct-smoke-secret-9f3a";
const BAD_FAL = "acct-wrong-key-id:acct-wrong-secret-0000";
const SECRETS = [OWNER_FAL, "owner-fal-db-secret", OWNER_ENV.FAL_KEY, OWNER_ENV.REPLICATE_API_TOKEN, ACCT_FAL, "acct-smoke-secret-9f3a", BAD_FAL, "acct-wrong-secret-0000"];

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const fal = await startFakeFal(APP_PORT + 1);
const rep = await startFakeReplicate(APP_PORT + 2);
for (const k of [OWNER_FAL, OWNER_ENV.FAL_KEY, ACCT_FAL]) fal.keys[k] = "good";
rep.keys[OWNER_ENV.REPLICATE_API_TOKEN] = "good";

const log = fs.openSync(logFile, "w");
const server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "-p", String(APP_PORT), "-H", "127.0.0.1"], {
  cwd: root,
  env: {
    ...process.env,
    ...OWNER_ENV,
    NODE_ENV: "development",
    FUOBE_DATA_DIR: data,
    FUOBE_PASSWORD: PASSWORD,
    FUOBE_PUBLIC_SIGNUP: "1",
    FUOBE_DEV_FAL_URL: fal.url,
    FUOBE_DEV_REPLICATE_URL: rep.url,
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
  await rep.close();
}

/** fetch with a cookie jar of one cookie. */
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
const readable = [];
/** Settings → Your keys alone, scrolled into view. */
const shootKeys = async (page, name) => {
  await page.waitForTimeout(400);
  await page.locator("#your-keys").screenshot({ path: path.join(shots, name) });
};

try {
  // The server is up (first compile can take a while).
  for (let i = 0; i < 240; i++) {
    try {
      const r = await fetch(`${APP}/login`);
      if (r.status < 500) break;
    } catch {}
    await wait(1000);
  }

  // The owner: signs in, sets the studio's own fal.ai key in Settings, runs a paid model on it.
  const ownerLogin = await api("/api/auth/login", { method: "POST", body: { password: PASSWORD } });
  const owner = cookieOf(ownerLogin);
  check(!!owner, "owner signs in");
  check((await api("/api/settings", { method: "PUT", cookie: owner, body: { falKey: OWNER_FAL } })).status === 200, "owner saves the studio's fal.ai key");
  fal.log.length = 0;
  const ownerRun = await api("/api/generations", { method: "POST", cookie: owner, body: { feature: "image", modelId: "nano-banana-pro", engine: "cloud", prompt: "the owner's harbour" } });
  check(ownerRun.status === 201, `owner's paid run starts (${ownerRun.status})`);
  for (let i = 0; i < 60 && !fal.log.some((r) => r.method === "POST"); i++) await wait(500);
  check(fal.log.length > 0 && fal.log.every((r) => r.authorization === `Key ${OWNER_FAL}`), "the owner's run sends the owner's key");

  // An account signs up: no key, no GPU.
  const signup = await api("/api/auth/signup", { method: "POST", body: { email: "smoke@example.com", password: "account password" } });
  const acct = cookieOf(signup);
  check(!!acct, "an account signs up");
  fal.log.length = 0;
  rep.log.length = 0;
  const noKey = await api("/api/generations", { method: "POST", cookie: acct, body: { feature: "image", modelId: "nano-banana-pro", engine: "cloud", prompt: "x" } });
  check(noKey.status === 403 && fal.log.length === 0 && rep.log.length === 0, `an account without a key can't run a paid model, and nothing reaches a provider (${noKey.status}: ${noKey.json?.error})`);
  readable.push(noKey.text);

  const browser = await launch();
  const [name, value] = acct.split("=");
  const contexts = [];
  for (const [label, opts] of [
    ["desktop", DESKTOP],
    ["phone", PHONE],
  ]) {
    const ctx = await browser.newContext({ ...opts, baseURL: APP });
    await ctx.addCookies([{ name, value, url: APP }]);
    contexts.push([label, ctx]);
  }
  const [, desk] = contexts[0];
  const page = await desk.newPage();

  // The Image studio: the switch is locked on open source, pointing at Your keys.
  await page.goto("/image", { waitUntil: "load", timeout: 180_000 });
  await page.waitForTimeout(2500);
  const lockedSwitch = page.getByRole("link", { name: /Open source only/ }).first();
  check((await lockedSwitch.getAttribute("href").catch(() => null)) === "/settings#your-keys", "the engine switch is locked on open source, linking to Your keys");

  // Settings → Your keys: a bad key, then a good one.
  await page.goto("/settings#your-keys", { waitUntil: "load", timeout: 180_000 });
  await page.getByRole("heading", { name: "Your keys" }).waitFor({ timeout: 60_000 });
  await shootKeys(page, "your-keys-empty-desktop.png");
  const falField = page.getByLabel("fal.ai API key");
  await falField.fill(BAD_FAL);
  await page.getByRole("button", { name: "Check and save" }).first().click();
  await page.getByText("fal.ai didn't accept this key").waitFor({ timeout: 30_000 });
  check(true, "a bad key is refused with plain words");
  await shootKeys(page, "your-keys-refused-desktop.png");
  await falField.fill(ACCT_FAL);
  await page.getByRole("button", { name: "Check and save" }).first().click();
  await page.getByText("Key ending in").waitFor({ timeout: 30_000 });
  check((await page.content()).includes("9f3a"), "a good key is saved and shown by its last 4 characters");
  await shootKeys(page, "your-keys-saved-desktop.png");
  readable.push(await page.content());

  // The Image studio again: the switch opens, the picker dims Replicate-only models, the price says who pays.
  await page.goto("/image", { waitUntil: "load", timeout: 180_000 });
  await page.waitForTimeout(2500);
  const radio = page.getByRole("radiogroup", { name: "Engine" }).first();
  check(await radio.isVisible().catch(() => false), "with a key, the engine switch switches");
  await page.getByRole("radio", { name: "Cloud" }).first().click().catch(() => {});
  // The price shows once there is something to run.
  await page.locator("textarea").first().fill("a quiet harbour at dawn");
  await page.waitForTimeout(800);
  const chip = await page.locator("text=/your fal\\.ai account/").first().textContent().catch(() => null);
  check(!!chip, `the price says who pays (${chip?.trim()})`);
  await page.screenshot({ path: path.join(shots, "studio-price-desktop.png") });
  await page.getByRole("button", { name: /^Model: / }).first().click();
  await page.getByPlaceholder(/Search/).first().fill("imagen");
  await page.waitForTimeout(800);
  check(await page.getByText("Add your Replicate key").first().isVisible().catch(() => false), "the picker dims a Replicate-only model with Add your Replicate key");
  await page.screenshot({ path: path.join(shots, "picker-desktop.png") });
  await page.getByText("Add your Replicate key").first().click();
  await page.getByRole("dialog").getByText("Add your Replicate key").waitFor({ timeout: 10_000 });
  check(true, "choosing a dimmed model opens Add your Replicate key");
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(shots, "add-key-dialog-desktop.png") });
  await page.keyboard.press("Escape");
  readable.push(await page.content());

  // A paid run on the account's key: only its key reaches fal.ai, and a result arrives.
  fal.log.length = 0;
  const run = await api("/api/generations", { method: "POST", cookie: acct, body: { feature: "image", modelId: "nano-banana-pro", engine: "cloud", prompt: "the account's harbour" } });
  check(run.status === 201, `the account's paid run starts (${run.status})`);
  readable.push(run.text);
  const id = run.json?.items?.[0]?.id;
  let done = null;
  for (let i = 0; i < 80 && id; i++) {
    const g = await api(`/api/generations/${id}`, { cookie: acct });
    if (g.json && !["queued", "running"].includes(g.json.status)) {
      done = g.json;
      readable.push(g.text);
      break;
    }
    await wait(500);
  }
  check(done?.status === "succeeded" && done.outputs?.length > 0, `a result arrives (${done?.status} ${done?.error ?? ""})`);
  check(fal.log.length > 0 && fal.log.every((r) => r.authorization === `Key ${ACCT_FAL}`), "the provider saw only the account's key");

  // Remove the key while a run is going: it asks first, then stops the run with that key.
  fal.pollsToFinish = Infinity;
  fal.log.length = 0;
  const slow = await api("/api/generations", { method: "POST", cookie: acct, body: { feature: "image", modelId: "nano-banana-pro", engine: "cloud", prompt: "a slow harbour" } });
  for (let i = 0; i < 40 && !fal.log.some((r) => r.method === "POST"); i++) await wait(250);
  await page.goto("/settings#your-keys", { waitUntil: "load", timeout: 180_000 });
  await page.getByText("Key ending in").waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "Remove", exact: true }).first().click();
  await page.getByRole("button", { name: "Remove key" }).click();
  await page.getByText(/run is using this key now/).waitFor({ timeout: 20_000 });
  await shootKeys(page, "your-keys-runs-going-desktop.png");
  await page.getByRole("button", { name: "Stop runs and remove" }).click();
  await page.getByText("Your fal.ai key is removed from this studio.").waitFor({ timeout: 20_000 });
  const cancel = fal.log.find((r) => r.path.endsWith("/cancel"));
  check(cancel?.authorization === `Key ${ACCT_FAL}`, "removing the key stopped the running job at fal.ai with that key");
  const slowRow = await api(`/api/generations/${slow.json?.items?.[0]?.id}`, { cookie: acct });
  check(slowRow.json?.status === "canceled", `the run going on it stopped (${slowRow.json?.status})`);

  // Phones: Settings → Your keys and the studio, no sideways scroll.
  const [, phone] = contexts[1];
  const p2 = await phone.newPage();
  await p2.goto("/settings#your-keys", { waitUntil: "load", timeout: 180_000 });
  await p2.getByRole("heading", { name: "Your keys" }).waitFor({ timeout: 60_000 });
  await shootKeys(p2, "your-keys-phone.png");
  const sideways = await p2.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(sideways <= 0, `no sideways scroll on a phone (${sideways}px)`);

  // Every answer and page the account read, every provider log and the server log: no key, anywhere.
  readable.push((await api("/api/account/keys", { cookie: acct })).text, (await api("/api/status", { cookie: acct })).text, (await api("/api/auth/me", { cookie: acct })).text);
  readable.push((await api("/api/admin/accounts", { cookie: owner })).text, (await api("/api/admin/accounts?format=csv", { cookie: owner })).text);
  const serverLog = fs.readFileSync(logFile, "utf8");
  const leaks = SECRETS.filter((s) => readable.some((t) => t.includes(s)) || serverLog.includes(s));
  check(leaks.length === 0, `no key in any answer, page or the server log${leaks.length ? `: ${leaks.join(", ")}` : ""}`);
  const ownerAtProvider = [...fal.log, ...rep.log].some((r) => [OWNER_FAL, OWNER_ENV.FAL_KEY, OWNER_ENV.REPLICATE_API_TOKEN].some((k) => r.authorization?.includes(k)));
  check(!ownerAtProvider, "the owner's keys never reached a provider during the account's work");

  await browser.close();
} catch (e) {
  failures.push(`crashed: ${e.stack ?? e}`);
  console.error(e);
} finally {
  await stopAll();
  console.log(`\nscreenshots: ${shots}\nserver log: ${logFile}`);
  try {
    fs.rmSync(data, { recursive: true, force: true });
  } catch {}
}
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nall passed");
