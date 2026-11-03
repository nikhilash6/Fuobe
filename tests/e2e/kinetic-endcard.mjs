// Click to Ad's animated end card, end to end (Kinetic Motion phase 1). Starts `next dev` on 3540 with a throwaway
// data folder, the owner's password, public sign-up on, Demo mode on (stand-in results, no GPU, no paid call) and a
// stand-in fal.ai on 3541 for an account's own key. Uses the system Chrome (WebCodecs H.264). Everything it starts is
// stopped at the end.
//
//   node tests/e2e/kinetic-endcard.mjs [evidence folder]
//
// KINETIC_PORT moves the app (and the stand-in to the next port).
//
// Checks. Owner: the preview animates (pixels differ between 0.2 s and 1.0 s, equal at 2.0 s and 2.4 s); Iris renders
// to an MP4 whose frame count is round(seconds × fps); Generate sends the clip and the run joins it after the ad; "Save
// the end card" makes a Library result whose file is the uploaded clip. Account with a stand-in key: uploads its clip,
// records it, sees it in its own runs and downloads it; the owner's Library doesn't list it. Account with neither: the
// upload is refused (connect-gpu). Guest: the page's note, and the record route answers 401. Reduced motion: the rest
// frame and no autoplay. Phone 390 × 844: no sideways scroll, 44 px chips and scrub bar. Frame times on desktop and on
// a 4× throttled phone. Evidence: MP4s of the five styles, contact sheets, screenshots, timings.
import { spawn, execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { DESKTOP, launch, PHONE, root } from "./_browser.mjs";
import { startFakeFal } from "../helpers/fake-cloud.ts";
import { tempDir } from "./_temp.mjs";

const PORT = Number(process.env.KINETIC_PORT ?? 3540);
const APP = `http://127.0.0.1:${PORT}`;
const out = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-kinetic-")));
fs.mkdirSync(out, { recursive: true });
const data = tempDir("fuobe-kinetic-data-");
const logFile = path.join(out, "server.log");
const PASSWORD = "owner password for kinetic";
const ACCT_FAL = "acct-kinetic-key:acct-kinetic-secret";

const failures = [];
const notes = [];
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};
const note = (s) => {
  console.log(`note ${s}`);
  notes.push(s);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const fal = await startFakeFal(PORT + 1);
fal.keys[ACCT_FAL] = "good";

const log = fs.openSync(logFile, "w");
const server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "-p", String(PORT), "-H", "127.0.0.1"], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: "development",
    FUOBE_DATA_DIR: data,
    FUOBE_PASSWORD: PASSWORD,
    FUOBE_PUBLIC_SIGNUP: "1",
    FUOBE_DEMO_MODE: "on",
    FUOBE_DEV_FAL_URL: fal.url,
    COMFYUI_URL: "http://127.0.0.1:9",
    OLLAMA_URL: "http://127.0.0.1:9",
    LMSTUDIO_URL: "http://127.0.0.1:9",
    UNSLOTH_URL: "http://127.0.0.1:9",
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

const api = async (route, { method = "GET", body, cookie, raw, type } = {}) => {
  const headers = { Origin: APP, ...(cookie && { cookie }) };
  if (raw) Object.assign(headers, { "Content-Type": type, "X-File-Name": encodeURIComponent(`file.${type.split("/")[1]}`) });
  else headers["Content-Type"] = "application/json";
  const res = await fetch(APP + route, { method, headers, ...(raw ? { body: raw } : body !== undefined && { body: JSON.stringify(body) }) });
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  try {
    json = JSON.parse(buf.toString("utf8"));
  } catch {}
  return { status: res.status, json, buf, headers: res.headers };
};
const cookieOf = (res) => /fuobe_session=[^;]+/.exec(res.headers.get("set-cookie") ?? "")?.[0];
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

/** The MP4's sample count, from its stsz box. */
function mp4Frames(buf) {
  const i = buf.indexOf(Buffer.from("stsz"));
  return i < 0 ? -1 : buf.readUInt32BE(i + 12);
}

/** The scrub bar to `t`, then the main canvas's pixels. */
async function frameAt(page, t) {
  await page.evaluate((v) => {
    const el = document.querySelector('input[type=range][aria-label="Time"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, t);
  await page.waitForTimeout(150);
  return page.evaluate(() => document.querySelector('canvas[data-kinetic-player="main"]').toDataURL("image/png"));
}

const MONOGRAM =
  "data:image/svg+xml," +
  encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'><circle cx='60' cy='60' r='54' fill='none' stroke='#efe2c4' stroke-width='4'/><path d='M34 84V38l26 30 26-30v46' fill='none' stroke='#efe2c4' stroke-width='7' stroke-linejoin='round' stroke-linecap='round'/></svg>",
  );

const timings = {};
let browser;
try {
  for (let i = 0; i < 300; i++) {
    try {
      const r = await fetch(`${APP}/login`);
      if (r.status < 500) break;
    } catch {}
    await wait(1000);
  }
  const owner = cookieOf(await api("/api/auth/login", { method: "POST", body: { password: PASSWORD } }));
  check(!!owner, "owner signs in");

  // A fictional premium brand: a product photo, a monogram (SVG, traced by Draw-on) and its colours and fonts.
  const photo = await sharp({ create: { width: 900, height: 1200, channels: 3, background: "#d9c7a8" } })
    .composite([{ input: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='900' height='1200'><defs><radialGradient id='g' cx='50%' cy='45%' r='55%'><stop offset='0' stop-color='#fff6e6'/><stop offset='1' stop-color='#b89a72'/></radialGradient></defs><rect width='900' height='1200' fill='url(#g)'/><rect x='330' y='360' width='240' height='480' rx='40' fill='#6b1d2a'/><rect x='370' y='300' width='160' height='80' rx='16' fill='#2a1a14'/></svg>") }])
    .png()
    .toBuffer();
  const up = await api("/api/uploads", { method: "POST", cookie: owner, raw: photo, type: "image/png" });
  check(up.status === 201, `owner uploads a product photo (${up.status})`);
  const brand = await api("/api/brands", { method: "POST", cookie: owner, body: { description: "Maison Ardent makes quiet, exceptional skincare.", name: "Maison Ardent", colors: ["#6b1d2a", "#e9d8b4"] } });
  check(brand.status === 201, `owner makes a brand kit (${brand.status})`);
  // Kit logos are stored files (a picture): the monogram drawn at 480 px with a clear ground.
  const logoPng = await sharp(Buffer.from(decodeURIComponent(MONOGRAM.slice("data:image/svg+xml,".length))), { density: 384 }).resize(480, 480).png().toBuffer();
  const logoUp = await api("/api/uploads", { method: "POST", cookie: owner, raw: logoPng, type: "image/png" });
  check(logoUp.status === 201, `owner uploads the logo (${logoUp.status})`);
  const kit = await api(`/api/brands/${brand.json.id}`, { method: "PATCH", cookie: owner, body: { logo: logoUp.json.url, colors: ["#6b1d2a", "#e9d8b4"], fonts: { heading: "Playfair Display", body: "Inter" } } });
  check(kit.status === 200, `the kit gets its logo, colours and fonts (${kit.status})`);
  const prod = await api("/api/products", { method: "POST", cookie: owner, body: { name: "Barrier Cream", brandId: brand.json.id, description: "A rich overnight cream that calms dry, reactive skin.", url: "https://maisonardent.com/products/barrier-cream", images: [up.json.url] } });
  check(prod.status === 201, `owner adds the product (${prod.status})`);

  browser = await launch({ channel: "chrome" });
  const [cname, cvalue] = owner.split("=");
  const ownerContext = async (opts) => {
    const ctx = await browser.newContext({ ...opts, baseURL: APP });
    await ctx.addCookies([{ name: cname, value: cvalue, url: APP }]);
    return ctx;
  };
  const openCard = async (page) => {
    page.on('pageerror', (e) => console.log('pageerror', e.message));
    page.on('console', (m) => m.type() === 'error' && console.log('console', m.text().slice(0, 300)));
    await page.goto("/marketing/click-to-ad", { waitUntil: "load", timeout: 240_000 });
    await page.getByRole("button", { name: /Barrier Cream/ }).first().click({ timeout: 120_000 });
    await page.locator('canvas[data-kinetic-player="main"]').waitFor({ timeout: 60_000 }).catch(async (e) => {
      await page.screenshot({ path: path.join(out, 'crash.png'), fullPage: true });
      throw e;
    });
    await page.waitForTimeout(1500);
  };

  // ---- Owner, desktop
  const desk = await ownerContext({ ...DESKTOP });
  await desk.addInitScript(() => (window.__kineticStats = { frames: [] }));
  const page = await desk.newPage();
  const uploads = [];
  page.on("response", (r) => {
    if (r.url().endsWith("/api/uploads") && r.request().method() === "POST") uploads.push({ type: r.request().headers()["content-type"], answer: r.json().catch(() => null) });
  });
  await openCard(page);
  await page.locator('canvas[data-kinetic-player="main"]').scrollIntoViewIfNeeded();
  // Frame times while it plays (draw cost per frame).
  await page.evaluate(() => (window.__kineticStats.frames = []));
  await page.waitForTimeout(5000);
  const desktopFrames = await page.evaluate(() => window.__kineticStats.frames.slice());
  const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] ?? NaN;
  timings.previewDesktop = { frames: desktopFrames.length, p95ms: +p95(desktopFrames).toFixed(2), medianMs: +[...desktopFrames].sort((a, b) => a - b)[desktopFrames.length >> 1]?.toFixed(2) };
  check(desktopFrames.length > 100 && p95(desktopFrames) <= 20, `desktop preview draws fast (${desktopFrames.length} frames in 5 s, p95 ${timings.previewDesktop.p95ms} ms)`);

  const a = await frameAt(page, 0.2);
  const b = await frameAt(page, 1.0);
  const c = await frameAt(page, 2.5);
  await frameAt(page, 0.3);
  const d = await frameAt(page, 2.5);
  check(a !== b, "the preview animates (0.2 s and 1.0 s differ)");
  check(c === d, "the last frame is the same picture whenever it is sought");
  const panel = page.locator('canvas[data-kinetic-player="main"]');
  for (const t of [0.15, 0.4, 0.7, 1.0, 1.6]) {
    await frameAt(page, t);
    await panel.screenshot({ path: path.join(out, `preview-draw-on-${String(t).replace(".", "_")}s.png`) });
  }
  await page.getByText("End card", { exact: true }).first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, "click-to-ad-endcard-1440.png"), fullPage: false });

  // Iris: render, upload, Generate.
  await page.getByRole("button", { name: /^Iris/ }).first().click();
  await page.waitForTimeout(800);
  uploads.length = 0;
  const started = Date.now();
  const runReq = page.waitForRequest((r) => r.url().endsWith("/api/marketing/click-to-ad") && r.method() === "POST", { timeout: 120_000 });
  await page.getByRole("button", { name: /Generate video/ }).click();
  const req = await runReq;
  timings.irisCardMs = Date.now() - started;
  const sent = JSON.parse(req.postData());
  check(/\.mp4$/.test(sent.endCard?.clip ?? "") && sent.endCard?.variant === "iris" && /\.png$/.test(sent.endCard?.image ?? ""), `Generate sends the rendered Iris clip and its poster (${JSON.stringify(sent.endCard)})`);
  check(timings.irisCardMs <= 4000, `the 2.5 s card renders and uploads in ${timings.irisCardMs} ms (budget 4 s before upload)`);
  const fps = sent.engine === "open" ? 25 : 24;
  const clip = await api(sent.endCard.clip, { cookie: owner });
  const frames = mp4Frames(clip.buf);
  check(frames === Math.round(sent.endCard.seconds * fps), `the clip has round(${sent.endCard.seconds} × ${fps}) = ${frames} frames`);
  fs.writeFileSync(path.join(out, `click-to-ad-card-iris-720x1280-${fps}fps.mp4`), clip.buf);
  await page.waitForTimeout(3000);
  const gens = await api("/api/generations?limit=200&steps=1", { cookie: owner });
  const items = gens.json?.items ?? [];
  const usesClip = items.filter((g) => JSON.stringify(g.request?.inputs ?? {}).includes(sent.endCard.clip));
  const joinStep = items.find((g) => g.request?.modelId === (sent.engine === "open" ? "oss-join-sound1" : "join-clips"));
  check(usesClip.length > 0 && usesClip.some((g) => ["merge-audio-video", "oss-join-sound1"].includes(g.request?.modelId)), `the run takes the clip in its ${sent.engine === "open" ? "join" : "silent-track mux"} step`);
  check(!!joinStep, `the run ends on the join after the ad (${joinStep?.request?.modelId})`);
  note(`Click to Ad ran on the ${sent.engine} engine; card ${fps} fps.`);

  // Save the end card (each style) to the Library: 1080 × 1920 at 30 fps.
  const styles = ["draw-on", "rise", "iris", "split", "glint"];
  timings.saveMs = {};
  for (const s of styles) {
    await page.getByRole("button", { name: new RegExp(`^${s === "draw-on" ? "Draw-on" : s[0].toUpperCase() + s.slice(1)}`) }).first().click();
    await page.waitForTimeout(500);
    uploads.length = 0;
    const t0 = Date.now();
    const recorded = page.waitForResponse((r) => r.url().endsWith("/api/generations/local") && r.request().method() === "POST", { timeout: 120_000 });
    await page.getByRole("button", { name: /^Save .+ to Library$/ }).click();
    check((await recorded).status() === 201, `${s}: the result is recorded`);
    await page.getByText("Saved to your Library").first().waitFor({ timeout: 30_000 });
    timings.saveMs[s] = Date.now() - t0;
    const lib = await api("/api/generations?limit=50", { cookie: owner });
    const g = (lib.json?.items ?? []).find((x) => x.modelId === "local-motion" && x.request?.params?.extra?.motion?.scene === `end-card/${s}`);
    check(!!g && g.feature === "kinetic-end-card" && g.status === "succeeded", `"Save the end card" (${s}) makes a Library result`);
    if (!g) continue;
    const file = await api(g.outputs[0].url, { cookie: owner });
    const sentClip = await uploads.find((u) => /video\//.test(u.type ?? ""))?.answer;
    check(!!sentClip && sentClip.url === g.outputs[0].url && sentClip.size === file.buf.length, `the Library's file is the uploaded ${s} clip (${file.buf.length} bytes)`);
    check(mp4Frames(file.buf) === 75, `${s}: 75 frames (2.5 s at 30 fps)`);
    const poster = g.outputs[0].meta?.poster ?? "";
    check(poster.startsWith("/api/files/") && poster.endsWith(".png"), `${s}: its tile shows the clip's last frame (${g.outputs[0].meta?.poster})`);
    fs.writeFileSync(path.join(out, `end-card-${s}-1080x1920-30fps.mp4`), file.buf);
    await page.waitForTimeout(400);
  }
  await page.goto("/library", { waitUntil: "load", timeout: 120_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(out, "library-1440.png") });

  // ---- Reduced motion: the rest frame, no autoplay.
  const calm = await ownerContext({ ...DESKTOP, reducedMotion: "reduce" });
  const cp = await calm.newPage();
  await openCard(cp);
  const r1 = await cp.evaluate(() => document.querySelector('canvas[data-kinetic-player="main"]').toDataURL());
  await cp.waitForTimeout(700);
  const r2 = await cp.evaluate(() => document.querySelector('canvas[data-kinetic-player="main"]').toDataURL());
  check(r1 === r2, "reduced motion: the preview holds the rest frame (no autoplay)");
  check(await cp.getByRole("button", { name: "Play" }).first().isVisible(), "reduced motion: Play is offered");
  await calm.close();

  // ---- Phone 390 × 844 (DPR 3), throttled 4×.
  const phone = await ownerContext({ ...PHONE, deviceScaleFactor: 3 });
  await phone.addInitScript(() => (window.__kineticStats = { frames: [] }));
  const pp = await phone.newPage();
  await openCard(pp);
  await pp.locator('canvas[data-kinetic-player="main"]').scrollIntoViewIfNeeded();
  const overflow = await pp.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `phone: no sideways scroll (${overflow} px)`);
  const rightEdge = await pp.evaluate(() => Math.max(...[...document.querySelectorAll('[aria-label="Call to action on the end card"], [aria-label="End card style"], canvas[data-kinetic-player="main"]')].map((e) => e.getBoundingClientRect().right)) - window.innerWidth);
  check(rightEdge <= 0, `phone: the end card panel stays inside the screen (${Math.round(rightEdge)} px past the edge)`);
  const chipH = await pp.$$eval('[role=group][aria-label="End card style"] button', (els) => els.map((e) => e.getBoundingClientRect().height));
  check(chipH.length === 6 && chipH.every((h) => h >= 44), `phone: the six style chips are at least 44 px (${chipH.map(Math.round).join(", ")})`);
  const scrubH = await pp.$eval('input[type=range][aria-label="Time"]', (e) => e.getBoundingClientRect().height);
  check(scrubH >= 44, `phone: the scrub bar is at least 44 px (${scrubH})`);
  await frameAt(pp, 0.6);
  await pp.screenshot({ path: path.join(out, "click-to-ad-endcard-390-mid.png") });
  await frameAt(pp, 2.2);
  await pp.screenshot({ path: path.join(out, "click-to-ad-endcard-390.png") });
  await pp.getByRole("button", { name: "Play" }).first().click();
  const cdp = await phone.newCDPSession(pp);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await pp.evaluate(() => (window.__kineticStats.frames = []));
  await pp.waitForTimeout(5000);
  const phoneFrames = await pp.evaluate(() => window.__kineticStats.frames.slice());
  timings.previewPhone4x = { frames: phoneFrames.length, p95ms: +p95(phoneFrames).toFixed(2) };
  check(phoneFrames.length > 60 && p95(phoneFrames) <= 33, `throttled phone preview: ${phoneFrames.length} frames in 5 s, p95 draw ${timings.previewPhone4x.p95ms} ms`);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await phone.close();

  // ---- An account with a stand-in fal.ai key: its own clip, saved through Fuobe, in its own runs.
  const acct = cookieOf(await api("/api/auth/signup", { method: "POST", body: { email: "kinetic@example.com", password: "account password" } }));
  check(!!acct, "an account signs up");
  const key = await api("/api/account/keys/fal", { method: "PUT", cookie: acct, body: { key: ACCT_FAL } });
  check(key.status === 200, `the account adds its own key (${key.status})`);
  const mine = fs.readFileSync(path.join(out, "end-card-draw-on-1080x1920-30fps.mp4"));
  const aUp = await api("/api/uploads", { method: "POST", cookie: acct, raw: mine, type: "video/mp4" });
  check(aUp.status === 201, `the account uploads its rendered clip (${aUp.status})`);
  const recipe = { v: 1, scene: "end-card/draw-on", seed: 1, size: "9:16", fps: 30, duration: 2.5, fields: { brand: "Sora Skin", product: "Daily Veil SPF 50" }, brand: { name: "Sora Skin", colors: ["#c8643c", "#f2e6d8"], fonts: { heading: "Fraunces", body: "Manrope" } }, export: { format: "mp4", blurSamples: 8, shutter: 180 } };
  const rec = await api("/api/generations/local", { method: "POST", cookie: acct, body: { feature: "kinetic-end-card", modelId: "local-motion", op: "motion", prompt: "Sora Skin · Daily Veil SPF 50", title: "Sora Skin end card", inputs: {}, params: { extra: { motion: recipe } }, output: { url: aUp.json?.url, kind: "video", contentType: "video/mp4" } } });
  check(rec.status === 201 && rec.json?.status === "succeeded", `the account records its clip (${rec.status})`);
  const theirs = await api("/api/generations?limit=50", { cookie: acct });
  check((theirs.json?.items ?? []).some((g) => g.id === rec.json?.id), "it shows in the account's own runs");
  const dl = await api(aUp.json?.url, { cookie: acct });
  check(dl.status === 200 && sha(dl.buf) === sha(mine), "the account downloads its clip from Fuobe");
  const ownerList = await api("/api/generations?limit=200", { cookie: owner });
  check(!(ownerList.json?.items ?? []).some((g) => g.id === rec.json?.id), "the owner's Library doesn't list the account's result");
  const stolen = await api("/api/generations/local", { method: "POST", cookie: acct, body: { feature: "kinetic-end-card", modelId: "local-motion", op: "motion", prompt: "x", inputs: {}, params: { extra: { motion: recipe } }, output: { url: sent.endCard.clip, kind: "video", contentType: "video/mp4" } } });
  check(stolen.status === 403, `the account can't record the owner's clip (${stolen.status})`);

  // ---- An account with neither a GPU nor a key: the upload asks it to connect one.
  const bare = cookieOf(await api("/api/auth/signup", { method: "POST", body: { email: "bare@example.com", password: "account password" } }));
  const refused = await api("/api/uploads", { method: "POST", cookie: bare, raw: mine, type: "video/mp4" });
  check(refused.status === 403 && refused.json?.code === "connect-gpu", `an account with no GPU or key can't upload (${refused.status} ${refused.json?.code})`);

  // ---- Guest (phone and desktop): the page's note, the end card previews live on a sample kit with their words, and
  // saving it opens the sign-up card. The record route asks to sign up.
  for (const [name, viewport] of [["390", PHONE], ["1440", DESKTOP]]) {
    const guest = await browser.newContext({ ...viewport, baseURL: APP });
    const gp = await guest.newPage();
    await gp.goto("/marketing/click-to-ad", { waitUntil: "load", timeout: 120_000 });
    await gp.waitForTimeout(1500);
    check(await gp.getByText("Click to Ad isn't available here.").first().isVisible(), `guest ${name}: the page says Click to Ad isn't available here`);
    const main = gp.locator('canvas[data-kinetic-player="main"]');
    await main.waitFor({ timeout: 60_000 });
    await main.scrollIntoViewIfNeeded();
    await gp.getByRole("textbox", { name: "Product name on the end card" }).fill("The Night Serum");
    await gp.waitForTimeout(1200);
    const g1 = await gp.evaluate(() => document.querySelector('canvas[data-kinetic-player="main"]').toDataURL());
    await gp.waitForTimeout(400);
    const g2 = await gp.evaluate(() => document.querySelector('canvas[data-kinetic-player="main"]').toDataURL());
    check(g1 !== g2, `guest ${name}: the end card preview plays`);
    const gOverflow = await gp.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    check(gOverflow <= 0, `guest ${name}: no sideways scroll (${gOverflow} px)`);
    await gp.screenshot({ path: path.join(out, `click-to-ad-guest-${name}.png`) });
    await gp.getByRole("button", { name: /^Save Draw-on to Library$/ }).click();
    const card = gp.getByText(/Create a free account/).first();
    check(await card.waitFor({ timeout: 10_000 }).then(() => true, () => false), `guest ${name}: saving the end card asks to create a free account`);
    await gp.screenshot({ path: path.join(out, `click-to-ad-guest-${name}-save.png`) });
    await guest.close();
  }
  const gRec = await api("/api/generations/local", { method: "POST", body: { feature: "x", modelId: "local-motion", op: "motion", prompt: "x", inputs: {}, output: { url: "/api/files/x.mp4", kind: "video", contentType: "video/mp4" } } });
  check(gRec.status === 401, `guest: recording a result answers 401 (${gRec.status})`);
  await desk.close();
} catch (e) {
  failures.push(`crashed: ${e?.stack ?? e}`);
  console.error(e);
} finally {
  await browser?.close().catch(() => {});
  await stopAll();
}

fs.writeFileSync(path.join(out, "e2e-result.json"), JSON.stringify({ failures, notes, timings }, null, 2));
console.log(JSON.stringify({ timings }, null, 2));
console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
