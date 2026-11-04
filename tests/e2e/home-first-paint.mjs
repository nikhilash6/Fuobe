// Home's first screen on a full load, in Chromium, when what it depends on hangs and while the studio restarts.
// Run it on a production build (`pnpm build`): it starts two `next start` servers from it (a blue and a green, on one
// throwaway data folder) behind a small proxy, as a deploy switches between them.
//
//   pnpm build && node tests/e2e/home-first-paint.mjs        (pnpm test:e2e:first-paint)
//
// Every load is a new browser context (nothing cached), at 1x and at 4x CPU slowdown, as a guest, an account, the owner,
// and the owner whose runs go to the ComfyUI on their own computer (the Open source engine): that ComfyUI takes every
// request and never answers, as one busy at full load can. The studio's own ComfyUI never answers either.
//
// Checks, for each of them:
// 1. The headline is drawn within 3 s, and Home's route skeleton is never on screen (no skeleton in front of Home).
// 2. The same while every /api request hangs (a busy or restarting server): the page never waits for one.
// 3. The owner's own engine was really asked (the busy ComfyUI saw the tab's look), and the page didn't wait for it.
// 4. A restart, as a deploy does it: the proxy sends new requests to the other server and the old one is stopped
//    (SIGTERM; on Windows, which can't send one, a kill). Home loads in a loop through two switches, each within 3 s,
//    and a tab opened before the switch still opens Home within 3 s afterwards. Off Windows: the old server stops within
//    10 s although an owner tab holds its live-updates stream open.
// 5. A click to Home from another page shows it within 3 s.
//
// Ports (all on 127.0.0.1): E2E_PORT_BASE (3810): the proxy, +1 and +2 the two servers, +3 the studio's ComfyUI,
// +7 the owner's ComfyUI. The browser reaches no other port on this computer, so a real ComfyUI is never touched.
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { launch, root } from "./_browser.mjs";
import { removeDir, stopProcess, tempDir } from "./_temp.mjs";

const BASE = Number(process.env.E2E_PORT_BASE ?? 3810);
const PROXY = BASE;
const SERVERS = [BASE + 1, BASE + 2];
const STUDIO_COMFY = BASE + 3;
const OWN_COMFY = BASE + 7;
const SITE = `http://127.0.0.1:${PROXY}`;
const LIMIT_MS = 3000;
const PASSWORD = `e2e-${Math.random().toString(36).slice(2)}`;
const data = tempDir("fuobe-first-paint-e2e-");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 30_000, every = 250) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() > end) return null;
    await sleep(every);
  }
}

// --- ComfyUI stand-ins that take every request and never answer (a ComfyUI busy at full load can do that).
const hung = { studio: 0, own: 0 };
const held = new Set();
function hangingServer(port, name) {
  const s = http.createServer((req, res) => {
    hung[name]++;
    held.add(res);
    // The page's look at its own ComfyUI asks first whether it may (CORS): the answer lets it through, and the look itself then hangs.
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "Access-Control-Allow-Origin": req.headers.origin ?? "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Private-Network": "true" });
      res.end();
    }
  });
  s.on("upgrade", (_req, socket) => held.add(socket)); // its socket too
  return new Promise((r) => s.listen(port, "127.0.0.1", () => r(s)));
}

// --- The proxy, as Apache in front of the two servers: requests in flight stay where they started, new ones go to the
// live server. `hangApi`: every /api request is held without an answer (a busy or restarting server).
let live = SERVERS[0];
let hangApi = false;
const proxy = http.createServer((req, res) => {
  if (hangApi && req.url.startsWith("/api/")) return void held.add(res);
  const up = http.request({ host: "127.0.0.1", port: live, path: req.url, method: req.method, headers: req.headers }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(up);
  res.on("close", () => up.destroy());
});

// --- The two servers.
const procs = new Map();
function startServer(port) {
  const p = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: root,
    env: {
      ...process.env,
      FUOBE_DATA_DIR: data,
      FUOBE_PASSWORD: PASSWORD,
      FUOBE_PUBLIC_SIGNUP: "1",
      FUOBE_ACCOUNT_DISK_FREE_GB: "0.5",
      COMFYUI_URL: `http://127.0.0.1:${STUDIO_COMFY}`,
      NODE_ENV: "production",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  p.log = "";
  p.stdout.on("data", (d) => (p.log += d));
  p.stderr.on("data", (d) => (p.log += d));
  procs.set(port, p);
  return until(() => fetch(`http://127.0.0.1:${port}/login`).then((r) => r.ok), 120_000, 500);
}
/** Stop a server as the service manager does: SIGTERM (Windows can't send one: a kill). Resolves with the ms it took. */
async function stopServer(port) {
  const p = procs.get(port);
  procs.delete(port);
  const t = Date.now();
  if (process.platform === "win32") await stopProcess(p);
  else {
    const exited = new Promise((r) => p.once("exit", r));
    p.kill("SIGTERM");
    await Promise.race([exited, sleep(30_000)]);
    if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL");
  }
  return Date.now() - t;
}

// --- Signing in: once for the owner and once for an account (sign-in is rate limited), straight to a server (the
// proxy may be holding /api requests); every context then carries that session's cookie (one for every port).
const direct = () => `http://127.0.0.1:${live}`;
const sessions = {};
async function session(who) {
  if (sessions[who]) return sessions[who];
  const [route, body] = who === "account" ? ["/api/auth/signup", { email: `e2e-${Math.random().toString(36).slice(2, 8)}@example.com`, password: "long enough password" }] : ["/api/auth/login", { password: PASSWORD }];
  const r = await fetch(direct() + route, { method: "POST", headers: { "content-type": "application/json", origin: direct() }, body: JSON.stringify(body) });
  const cookies = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0].split("=")).map(([name, ...v]) => ({ name, value: v.join("=") }));
  if (!r.ok || !cookies.length) throw new Error(`${who}'s sign-in answered ${r.status}`);
  return (sessions[who] = cookies);
}
/** Where the owner's runs go: "server" (the studio's ComfyUI) or "computer" (the ComfyUI on the owner's own computer). */
let comfyWhere = "server";
async function setWhere(v) {
  if (comfyWhere === v) return;
  const cookie = (await session("owner")).map((c) => `${c.name}=${c.value}`).join("; ");
  const r = await fetch(`${direct()}/api/settings`, { method: "PUT", headers: { "content-type": "application/json", origin: direct(), cookie }, body: JSON.stringify({ comfyWhere: v }) });
  if (!r.ok) throw new Error(`Settings answered ${r.status}: ${await r.text()}`);
  comfyWhere = v;
}

// --- One full load of Home in a new context: when the skeleton and the headline were first on screen.
let browser;
async function context(who) {
  if (who === "owner") await setWhere("server");
  if (who === "owner-computer") await setWhere("computer");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // This computer's other apps: only the proxy, the servers and the owner's stand-in ComfyUI are reachable.
  await ctx.route(/^(https?|wss?):\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+/, (route) => {
    const port = Number(new URL(route.request().url()).port);
    return port === PROXY || port === OWN_COMFY ? route.continue() : route.abort("connectionrefused");
  });
  if (who !== "guest") await ctx.addCookies((await session(who === "account" ? "account" : "owner")).map((c) => ({ ...c, domain: "127.0.0.1", path: "/", httpOnly: true, sameSite: "Lax" })));
  if (who === "owner-computer") {
    // The Open source engine, on the ComfyUI this browser reached before (on the stand-in's port).
    await ctx.addInitScript((port) => {
      try {
        localStorage.setItem("fuobe.engine", "open");
        localStorage.setItem("fuobe.comfy.port", String(port));
        localStorage.setItem("fuobe.computer.reached", "1");
      } catch {}
    }, OWN_COMFY);
  }
  await ctx.addInitScript(() => {
    const W = (window.__W = {});
    let seen;
    const tick = () => {
      const now = performance.now();
      const skeleton = document.querySelector('main [aria-label="Loading"]');
      if (W.skeleton === undefined && skeleton) W.skeleton = now;
      if (seen !== undefined) return void (W.headline = now); // the frame after it entered the page: drawn
      if (document.querySelector("main h1") && !skeleton) seen = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  return ctx;
}
async function measure(page, timeout = 20_000) {
  await page.waitForFunction(() => window.__W?.headline !== undefined, null, { timeout, polling: 100 }).catch(() => {});
  return page.evaluate(() => ({ ...window.__W, title: document.querySelector("main h1")?.textContent?.trim() ?? "" }));
}
async function loadHome(who, { cpu = 1 } = {}) {
  const ctx = await context(who);
  try {
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    await page.goto(`${SITE}/`, { waitUntil: "commit", timeout: 30_000 });
    return await measure(page);
  } finally {
    await ctx.close();
  }
}
const fmt = (w) => `headline ${w.headline === undefined ? "never" : `${Math.round(w.headline)} ms`}, skeleton ${w.skeleton === undefined ? "never" : `at ${Math.round(w.skeleton)} ms`}`;
const inTime = (w) => w.headline !== undefined && w.headline <= LIMIT_MS && w.skeleton === undefined;

const AUDIENCES = ["guest", "account", "owner", "owner-computer"];

async function finish(code) {
  await browser?.close().catch(() => {});
  for (const port of [...procs.keys()]) await stopServer(port).catch(() => {});
  for (const h of held) h.destroy?.();
  proxy.close();
  removeDir(data);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) for (const p of procs.values()) console.log(p.log.split("\n").slice(-30).join("\n"));
  process.exit(code ?? (failed.length ? 1 : 0));
}

try {
  for (const port of [PROXY, ...SERVERS, STUDIO_COMFY, OWN_COMFY]) {
    const free = await new Promise((r) => {
      const s = net.createServer().once("error", () => r(false)).listen(port, "127.0.0.1", () => s.close(() => r(true)));
    });
    if (!free) throw new Error(`port ${port} is in use`);
  }
  await hangingServer(STUDIO_COMFY, "studio");
  await hangingServer(OWN_COMFY, "own");
  await new Promise((r) => proxy.listen(PROXY, "127.0.0.1", r));
  if (!(await startServer(SERVERS[0]))) throw new Error(`the studio didn't start:\n${procs.get(SERVERS[0])?.log}`);
  if (!(await startServer(SERVERS[1]))) throw new Error(`the second server didn't start:\n${procs.get(SERVERS[1])?.log}`);
  browser = await launch(process.platform === "win32" && !process.env.CHROMIUM_PATH ? { channel: "chrome" } : {});

  // A first load warms the server (a deploy's health check does it too).
  await loadHome("guest");

  // 1. Every audience, with both ComfyUIs hanging, at 1x and 4x.
  for (const cpu of [1, 4])
    for (const who of AUDIENCES) {
      const runs = [];
      for (let i = 0; i < 2; i++) runs.push(await loadHome(who, { cpu }));
      check(`${who}, ${cpu}x CPU: the headline within 3 s, no skeleton in front of Home`, runs.every(inTime), runs.map(fmt).join(" | "));
    }

  // 3. The owner's engine was asked: the page looked at the busy ComfyUI, and still didn't wait for it.
  {
    const before = hung.own;
    const ctx = await context("owner-computer");
    const page = await ctx.newPage();
    await page.goto(`${SITE}/`, { waitUntil: "commit" });
    const w = await measure(page);
    const asked = await until(() => hung.own > before, 15_000);
    check("the owner's own engine: the tab looked at the busy ComfyUI on this computer", !!asked, `${hung.own - before} requests`);
    check("…and Home's headline didn't wait for it", inTime(w), fmt(w));
    await ctx.close();
  }

  // 2. Every /api request hangs.
  hangApi = true;
  for (const who of AUDIENCES) {
    const w = await loadHome(who);
    check(`${who}, every /api request hanging: the headline within 3 s`, inTime(w), fmt(w));
  }
  hangApi = false;

  // 5. A click to Home from another page.
  for (const who of ["guest", "owner-computer"]) {
    const ctx = await context(who);
    const page = await ctx.newPage();
    await page.goto(`${SITE}/library`, { waitUntil: "load" });
    await page.locator("main h1").first().waitFor({ timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(500);
    const t = Date.now();
    await page.locator('a[href="/"]').first().click();
    const ok = await until(() => page.evaluate(() => location.pathname === "/" && !!document.querySelector("main h1") && /Make anything/i.test(document.querySelector("main h1")?.textContent ?? "")), LIMIT_MS, 50);
    check(`${who}: a click to Home shows it within 3 s`, !!ok, `${Date.now() - t} ms`);
    await ctx.close();
  }

  // 4. Restarts, as a deploy does them: switch, then stop the old server; twice (blue to green, then back).
  {
    // Tabs opened before the switch: the owner's (with its live-updates stream open) and an account's.
    const before = [];
    for (const who of ["owner-computer", "account"]) {
      const ctx = await context(who);
      const page = await ctx.newPage();
      await page.goto(`${SITE}/library`, { waitUntil: "load" });
      await page.locator("main h1").first().waitFor({ timeout: 20_000 }).catch(() => {});
      before.push({ who, ctx, page });
    }
    const loads = [];
    let looping = true;
    let loopError = null;
    const loop = (async () => {
      for (let i = 0; looping; i++) {
        const who = AUDIENCES[i % AUDIENCES.length];
        // A sign-in that met the stopping server is tried again: what is measured is Home.
        const w = await loadHome(who).catch(() => sleep(500).then(() => loadHome(who)));
        loads.push({ who, w });
      }
    })().catch((e) => (loopError = e));
    for (const step of [0, 1]) {
      await sleep(3000);
      const old = live;
      const next = SERVERS[(SERVERS.indexOf(old) + 1) % 2];
      if (!procs.has(next) && !(await startServer(next))) throw new Error("the new server didn't start");
      live = next;
      await sleep(1500);
      const ms = await stopServer(old);
      if (process.platform !== "win32") check(`restart ${step + 1}: the old server stops within 10 s with an owner tab's stream open`, ms <= 10_000, `${ms} ms`);
      await sleep(3000);
      if (step === 0) {
        // The old tabs, after the switch: to Home.
        for (const b of before) {
          const t = Date.now();
          await b.page.locator('a[href="/"]').first().click();
          const ok = await until(() => b.page.evaluate(() => location.pathname === "/" && /Make anything/i.test(document.querySelector("main h1")?.textContent ?? "")), LIMIT_MS, 50);
          check(`${b.who}: a tab opened before the restart opens Home within 3 s after it`, !!ok, `${Date.now() - t} ms`);
          await b.ctx.close();
        }
      }
    }
    looping = false;
    await loop;
    if (loopError) check("restarts: the loop of Home loads ran", false, loopError.stack ?? String(loopError));
    const slow = loads.filter((l) => !inTime(l.w));
    check(`restarts: ${loads.length} Home loads through two switches, each within 3 s with no skeleton`, loads.length >= 8 && slow.length === 0, slow.map((l) => `${l.who}: ${fmt(l.w)}`).join(" | ") || `slowest ${Math.round(Math.max(...loads.map((l) => l.w.headline ?? Infinity)))} ms`);
  }
  check("the studio's own ComfyUI was asked and never answered (the hanging dependency was in play)", hung.studio > 0, `${hung.studio} requests`);
} catch (e) {
  check("the run", false, e.stack ?? String(e));
}
await finish();
