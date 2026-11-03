// Marketing's code-drawn templates, end to end (Kinetic Motion phase 2). Starts `next dev` on 3540 with a throwaway
// data folder, the owner's password, public sign-up on, Demo mode on and a stand-in fal.ai on 3541 for an account's
// own key. Uses the system Chrome (WebCodecs H.264). Everything it starts is stopped at the end.
//
//   node tests/e2e/kinetic-templates.mjs [evidence folder]
//
// KINETIC_PORT moves the app (and the stand-in to the next port).
//
// Checks. Owner: Kinetic Headline opens in its own panel, takes a headline with *stars*, and plays; Save to Library
// shows its progress and the toast, and the Library lists the clip by its title with its recipe in params.extra.motion;
// it shows under "Made with this template", opens in the viewer and downloads as the stored MP4 (1080 × 1920, 150
// frames). Account with a stand-in key: Logo Sting with its own logo from the Brand row, saved to its own runs, listed
// in its strip and downloaded; the owner's Library doesn't list it, the owner's Accounts' runs does. Account with
// neither: Save opens the Connect card and nothing is uploaded. Guest: the fields and preview work, Save opens the
// sign-up card before anything renders, a code template shows no "not available" note while an AI template still does.
// Covers: the ten code templates' tiles show their versioned cover and clip. Phone 390 and desktop 1440 for each
// viewer: no sideways scroll, controls at least 44 px. Evidence: screenshots, the saved clips, timings.
import { spawn, execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { DESKTOP, launch, PHONE, root } from "./_browser.mjs";
import { startFakeFal } from "../helpers/fake-cloud.ts";

const PORT = Number(process.env.KINETIC_PORT ?? 3540);
const APP = `http://127.0.0.1:${PORT}`;
const out = path.resolve(process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-kinetic-templates-")));
fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-kinetic-templates-data-"));
const PASSWORD = "owner password for kinetic templates";
const ACCT_FAL = "acct-templates-key:acct-templates-secret";
const CODE_TEMPLATES = ["ms-kinetic-headline", "m2-line-reveal", "ms-logo-sting", "ms-feature-cards", "ms-dashboard-zoom", "m2-retro-starburst", "m2-offer-badge", "ms-big-number", "ms-five-star-quote", "ms-end-card"];

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

const log = fs.openSync(path.join(out, "server.log"), "w");
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

const api = async (route, { method = "GET", body, cookie } = {}) => {
  const res = await fetch(APP + route, { method, headers: { Origin: APP, "Content-Type": "application/json", ...(cookie && { cookie }) }, ...(body !== undefined && { body: JSON.stringify(body) }) });
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
const mp4Frames = (buf) => {
  const i = buf.indexOf(Buffer.from("stsz"));
  return i < 0 ? -1 : buf.readUInt32BE(i + 12);
};
/** The MP4's picture size, from its first avc1 sample entry. */
const mp4Size = (buf) => {
  const i = buf.indexOf(Buffer.from("avc1"), buf.indexOf(Buffer.from("stsd")));
  return i < 0 ? null : { w: buf.readUInt16BE(i + 28), h: buf.readUInt16BE(i + 30) };
};
const mainCanvas = 'canvas[data-kinetic-player="main"]';
const pixels = (page) => page.evaluate((sel) => document.querySelector(sel).toDataURL(), mainCanvas);

/** Opens a template's panel and waits for its preview. */
async function openTemplate(page, id) {
  page.on("pageerror", (e) => console.log("pageerror", e.message));
  await page.goto(`/marketing?template=${id}`, { waitUntil: "load", timeout: 240_000 });
  await page.locator(`[data-kinetic-template="${id}"] ${mainCanvas}`).waitFor({ timeout: 120_000 });
  await page.waitForTimeout(1800);
}

/** No sideways scroll, and every control in the panel at least 44 px tall. */
async function layoutChecks(page, who, name) {
  const sideways = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
  check(sideways <= 0, `${who} ${name}: no sideways scroll (${sideways} px)`);
  const small = await page.$$eval("[data-kinetic-template] button, [data-kinetic-template] input:not([type=color]):not([type=file]), [data-kinetic-template] textarea", (els) =>
    // (A picture tile's own corner buttons, Remove and Choose from library, sit on its 56 px tile, which is the control.)
    els.filter((e) => e.getClientRects().length && !e.closest("[data-kinetic-made]") && !(e.closest(".group\\/slot") && e.getBoundingClientRect().height <= 24)).map((e) => [e.getAttribute("aria-label") || e.textContent?.trim().slice(0, 20) || e.tagName, Math.round(e.getBoundingClientRect().height)]).filter(([, h]) => h < 44),
  );
  check(small.length === 0, `${who} ${name}: every control in the panel is at least 44 px (${JSON.stringify(small)})`);
}

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
  browser = await launch({ channel: "chrome" });
  const withCookie = async (cookie, opts) => {
    const ctx = await browser.newContext({ ...opts, baseURL: APP });
    if (cookie) {
      const [n, v] = cookie.split("=");
      await ctx.addCookies([{ name: n, value: v, url: APP }]);
    }
    return ctx;
  };

  // ---- Owner, desktop: Kinetic Headline with a marked word, saved to the Library.
  const desk = await withCookie(owner, DESKTOP);
  const page = await desk.newPage();
  const uploads = [];
  page.on("response", (r) => {
    if (r.url().endsWith("/api/uploads") && r.request().method() === "POST") uploads.push({ type: r.request().headers()["content-type"], answer: r.json().catch(() => null) });
  });
  await openTemplate(page, "ms-kinetic-headline");
  check(!(await page.getByText("Marketing Studio isn't available here.").isVisible().catch(() => false)), "owner: no note on a code template");
  check(await page.getByRole("textbox", { name: "Prompt" }).isHidden(), "owner: the composer gives way to the template's panel");
  const headline = "Close the month *before* lunch.";
  await page.getByRole("textbox", { name: "Headline", exact: true }).fill(headline);
  await page.waitForTimeout(900);
  const p1 = await pixels(page);
  await page.waitForTimeout(500);
  const p2 = await pixels(page);
  check(p1 !== p2, "owner: the preview plays the typed headline");
  await layoutChecks(page, "owner", "1440");
  await page.locator("[data-kinetic-template]").screenshot({ path: path.join(out, "owner-kinetic-headline-1440.png") });

  const t0 = Date.now();
  const recorded = page.waitForResponse((r) => r.url().endsWith("/api/generations/local") && r.request().method() === "POST", { timeout: 180_000 });
  // Watched from before the press: the render is quick, and the toast goes after a few seconds.
  const sawProgress = page.waitForFunction(() => /Rendering \d+ of \d+/.test(document.querySelector("[data-kinetic-template]")?.textContent ?? ""), null, { timeout: 60_000, polling: 16 }).then(() => true, () => false);
  const sawToast = page.getByText("Saved to your Library").first().waitFor({ timeout: 120_000 }).then(() => true, () => false);
  await page.getByRole("button", { name: "Save to Library" }).click();
  check((await recorded).status() === 201, "owner: the clip is recorded");
  timings.ownerSaveMs = Date.now() - t0;
  check(await sawProgress, "owner: the progress line runs while it renders");
  check(await sawToast, "owner: the toast says it's saved");
  note(`5 s at 1080 × 1920, 30 fps, blur 8: rendered and saved in ${timings.ownerSaveMs} ms`);
  const lib = await api("/api/generations?features=marketing-kinetic&limit=20", { cookie: owner });
  const g = (lib.json?.items ?? []).find((x) => x.modelId === "local-motion");
  check(!!g && g.feature === "marketing-kinetic" && g.status === "succeeded", "owner: the Library lists the clip as a Kinetic result");
  const motion = g?.request?.params?.extra?.motion;
  check(motion?.scene === "marketing/kinetic-headline" && motion?.fields?.headline === headline && motion?.controls?.template === "ms-kinetic-headline", "owner: its recipe (the headline exactly as typed) is in params.extra.motion");
  check(/Close the month before lunch\./.test(g?.request?.prompt ?? ""), `owner: it is listed by its words (${g?.request?.prompt})`);
  const file = g ? await api(g.outputs[0].url, { cookie: owner }) : null;
  const sentClip = await uploads.find((u) => /video\//.test(u.type ?? ""))?.answer;
  check(!!file && sentClip?.url === g.outputs[0].url && sentClip.size === file.buf.length, "owner: the stored file is the uploaded clip");
  check(file && mp4Frames(file.buf) === 150, `owner: 150 frames (5 s at 30 fps): ${file && mp4Frames(file.buf)}`);
  const size = file && mp4Size(file.buf);
  check(size?.w === 1080 && size?.h === 1920, `owner: 1080 × 1920 (${JSON.stringify(size)})`);
  if (file) fs.writeFileSync(path.join(out, "owner-kinetic-headline-1080x1920.mp4"), file.buf);

  // "Made with this template" opens it in the viewer, which downloads the same bytes.
  const tile = page.locator(`[data-kinetic-made="${g?.id}"]`);
  check(await tile.waitFor({ timeout: 20_000 }).then(() => true, () => false), "owner: it shows under Made with this template");
  await tile.click();
  await page.waitForTimeout(1200);
  const dl = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("dialog").getByRole("link", { name: /^Download$/ }).or(page.getByRole("dialog").getByRole("button", { name: /^Download$/ })).first().click();
  const download = await dl.catch(() => null);
  const dlPath = download && path.join(out, "owner-download.mp4");
  if (download) await download.saveAs(dlPath);
  check(!!download && sha(fs.readFileSync(dlPath)) === sha(file.buf), "owner: Download in the viewer gives the saved clip");
  await page.keyboard.press("Escape");

  // Covers: every code template's tile shows its versioned cover and clip.
  await page.goto("/marketing", { waitUntil: "load", timeout: 120_000 });
  await page.waitForTimeout(2500);
  const html = await page.content();
  const missing = CODE_TEMPLATES.filter((id) => !new RegExp(`templates/marketing/${id}\\.jpg\\?v=[0-9a-f]{8}`).test(html.replaceAll("%2F", "/").replaceAll("&amp;", "&")));
  check(missing.length === 0, `the ten code templates' tiles show their versioned covers (missing: ${missing.join(", ") || "none"})`);
  const instant = await page.getByText("Instant", { exact: true }).count();
  check(instant >= CODE_TEMPLATES.length, `their tiles say Instant (${instant})`);
  await page.screenshot({ path: path.join(out, "gallery-1440.png") });
  await desk.close();

  // ---- Owner, phone.
  const ownerPhone = await withCookie(owner, { ...PHONE, deviceScaleFactor: 3 });
  const op = await ownerPhone.newPage();
  await openTemplate(op, "m2-line-reveal");
  await layoutChecks(op, "owner", "390");
  await op.screenshot({ path: path.join(out, "owner-line-reveal-390.png"), fullPage: true });
  await ownerPhone.close();

  // ---- An account with a stand-in fal.ai key: Logo Sting with its own logo, saved to its own runs.
  const acct = cookieOf(await api("/api/auth/signup", { method: "POST", body: { email: "templates@example.com", password: "account password" } }));
  check(!!acct, "an account signs up");
  check((await api("/api/account/keys/fal", { method: "PUT", cookie: acct, body: { key: ACCT_FAL } })).status === 200, "the account adds its own key");
  const logo = await sharp(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'><circle cx='300' cy='300' r='250' fill='#f2e6d8'/><path d='M190 420V180h70l40 130 40-130h70v240' fill='none' stroke='#c8643c' stroke-width='44' stroke-linejoin='round'/></svg>")).png().toBuffer();
  const logoFile = path.join(out, "account-logo.png");
  fs.writeFileSync(logoFile, logo);
  for (const [name, vp] of [["1440", DESKTOP], ["390", { ...PHONE, deviceScaleFactor: 3 }]]) {
    const ctx = await withCookie(acct, vp);
    const ap = await ctx.newPage();
    await openTemplate(ap, "ms-logo-sting");
    await ap.getByRole("button", { name: /^Brand/ }).click();
    await ap.getByRole("textbox", { name: "Brand name", exact: true }).fill("Sora Skin");
    if (name === "1440") {
      await ap.locator("[data-kinetic-template] input[type=file]").first().setInputFiles(logoFile);
      await ap.waitForTimeout(2500);
    }
    await layoutChecks(ap, "account", name);
    await ap.locator("[data-kinetic-template]").screenshot({ path: path.join(out, `account-logo-sting-${name}.png`) });
    if (name === "1440") {
      const rec = ap.waitForResponse((r) => r.url().endsWith("/api/generations/local") && r.request().method() === "POST", { timeout: 180_000 });
      await ap.getByRole("button", { name: "Save to your runs" }).click();
      check((await rec).status() === 201, "account: its clip is recorded");
      check(await ap.getByText("Saved to your runs").first().waitFor({ timeout: 30_000 }).then(() => true, () => false), "account: the toast says it's in its runs");
      const theirs = await api("/api/generations?features=marketing-kinetic&limit=20", { cookie: acct });
      const ag = (theirs.json?.items ?? [])[0];
      check(ag?.request?.params?.extra?.motion?.brand?.logo?.startsWith("/api/files/") && ag?.request?.params?.extra?.motion?.brand?.name === "Sora Skin", "account: the clip was made with its own logo and name");
      check(await ap.locator(`[data-kinetic-made="${ag?.id}"]`).waitFor({ timeout: 20_000 }).then(() => true, () => false), "account: it shows in its Made with this template strip");
      const f = ag ? await api(ag.outputs[0].url, { cookie: acct }) : null;
      check(f?.status === 200 && mp4Frames(f.buf) === 150, "account: it downloads its clip from Fuobe");
      if (f) fs.writeFileSync(path.join(out, "account-logo-sting-1080x1350.mp4"), f.buf);
      const ownerList = await api("/api/generations?limit=200", { cookie: owner });
      check(!(ownerList.json?.items ?? []).some((x) => x.id === ag?.id), "the owner's Library doesn't list the account's clip");
      const admin = await api("/api/admin/generations?limit=50", { cookie: owner });
      check((admin.json?.items ?? []).some((x) => x.id === ag?.id), "the owner's Accounts' runs lists it");
    }
    await ctx.close();
  }

  // ---- An account with neither a GPU nor a key: Save asks it to connect one, before anything renders.
  const bare = cookieOf(await api("/api/auth/signup", { method: "POST", body: { email: "bare-templates@example.com", password: "account password" } }));
  const bctx = await withCookie(bare, DESKTOP);
  const bp = await bctx.newPage();
  let bareUploads = 0;
  bp.on("request", (r) => r.url().endsWith("/api/uploads") && bareUploads++);
  await openTemplate(bp, "ms-big-number");
  await bp.getByRole("button", { name: "Save to your runs" }).click();
  check(await bp.getByText(/Connect your GPU/).first().waitFor({ timeout: 10_000 }).then(() => true, () => false), "account without a GPU or key: Save opens the Connect card");
  check(!(await bp.getByText(/^Rendering \d+ of/).isVisible().catch(() => false)) && bareUploads === 0, `account without a GPU or key: nothing renders or uploads (${bareUploads} uploads)`);
  await bp.screenshot({ path: path.join(out, "account-bare-save.png") });
  await bctx.close();

  // ---- Guest: fields and preview work, Save asks to sign up first, AI templates keep their note.
  for (const [name, vp] of [["390", { ...PHONE, deviceScaleFactor: 3 }], ["1440", DESKTOP]]) {
    const gctx = await withCookie(null, vp);
    const gp = await gctx.newPage();
    let guestUploads = 0;
    gp.on("request", (r) => r.url().endsWith("/api/uploads") && guestUploads++);
    await openTemplate(gp, "ms-five-star-quote");
    check(!(await gp.getByText("Marketing Studio isn't available here.").isVisible().catch(() => false)), `guest ${name}: no "not available" note on a code template`);
    await gp.getByRole("textbox", { name: "Quote", exact: true }).fill("“Worth every penny — I’m on my third bottle.”");
    await gp.waitForTimeout(900);
    const g1 = await pixels(gp);
    await gp.waitForTimeout(450);
    check(g1 !== (await pixels(gp)), `guest ${name}: the preview plays their words`);
    await layoutChecks(gp, "guest", name);
    await gp.locator("[data-kinetic-template]").screenshot({ path: path.join(out, `guest-quote-${name}.png`) });
    await gp.getByRole("button", { name: "Save to Library" }).click();
    check(await gp.getByText(/Create a free account/).first().waitFor({ timeout: 10_000 }).then(() => true, () => false), `guest ${name}: Save opens the sign-up card`);
    check(!(await gp.getByText(/^Rendering \d+ of/).isVisible().catch(() => false)) && guestUploads === 0, `guest ${name}: nothing renders or uploads first`);
    await gp.screenshot({ path: path.join(out, `guest-quote-${name}-save.png`) });
    await gp.goto("/marketing?template=m2-sticker-pop", { waitUntil: "load", timeout: 120_000 });
    await gp.waitForTimeout(1500);
    check(await gp.getByText("Marketing Studio isn't available here.").first().isVisible(), `guest ${name}: an AI template still says Marketing Studio isn't available here`);
    await gctx.close();
  }

  // ---- Reduced motion: the rest frame, no autoplay.
  const calm = await withCookie(null, { ...DESKTOP, reducedMotion: "reduce" });
  const cp = await calm.newPage();
  await openTemplate(cp, "ms-big-number");
  const r1 = await pixels(cp);
  await cp.waitForTimeout(700);
  check(r1 === (await pixels(cp)), "reduced motion: the preview holds its rest frame");
  await calm.close();
} catch (e) {
  failures.push(`crashed: ${e?.stack ?? e}`);
  console.error(e);
} finally {
  await browser?.close().catch(() => {});
  await stopAll();
}

fs.writeFileSync(path.join(out, "e2e-result.json"), JSON.stringify({ failures, notes, timings }, null, 2));
console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
