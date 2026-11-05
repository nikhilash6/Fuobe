// "Set it up with my AI": the whole flow in a browser, at 390 and 1440 wide, in light and dark. A production server on
// 3651 with a throwaway data folder, and ComfyUI stand-ins (tests/helpers/fake-local-comfy.ts): one that doesn't let
// this page in yet (18190), one that lets it in without Fuobe's guard (18188), and one with the guard and every model
// the requirement index names (18192). The browser's requests to 127.0.0.1:8188 go to the stand-in the step needs;
// every other loopback port is refused, and sockets to them never leave the browser. A real ComfyUI on 8188 is never
// touched. The person's AI is played by plain fetches with no cookie, as an AI's web tool reads the status.
// E2E_FAKE_BASE moves the stand-ins (base, base + 2, base + 4) when something else uses those ports.
//
//   pnpm build && node tests/e2e/ai-setup.mjs
//
// Checks: a guest gets "Set it up with my AI" through sign-up; the panel opens with a code, and nothing moves when the
// code arrives; the hand-offs wait for the browser's question; each stand-in ticks the checklist on and the public
// status follows (text and JSON, no cookie); the guard step waits for the guard; it connects by itself and makes the
// first picture; the prefill links and the agent command carry the code and nothing else; End this code ends it; a
// ComfyUI that stops answering is waited for, with the time so far; Safari gets the web address; a phone gets Send to
// my computer, and its setup ends on the computer at the box for the address, under the same code; a web address's
// ComfyUI on the processor is said as such.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch, root } from "./_browser.mjs";
import { tempDir, removeDir, stopProcess } from "./_temp.mjs";

const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3651);
const FAKE_BASE = Number(process.env.E2E_FAKE_BASE ?? 18188);
const OPEN = FAKE_BASE;
const CLOSED = FAKE_BASE + 2;
const GUARDED = FAKE_BASE + 4;
const DEAD_PORT = 3659;
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const SITE = `http://127.0.0.1:${APP_PORT}`;
const shots = process.env.E2E_SHOTS ?? fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-ai-setup-shots-"));
fs.mkdirSync(shots, { recursive: true });
const data = tempDir("fuobe-ai-setup-e2e-");
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

const procs = [];
async function startFake(port, cors, more = []) {
  const args = ["--port", String(port), "--cors", cors, "--step-ms", "60", "--steps", "3", ...more];
  const p = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(root, "tests/helpers/fake-local-comfy.ts"), ...args], { stdio: ["ignore", "ignore", "inherit"] });
  procs.push(p);
  if (!(await until(() => fetch(`http://127.0.0.1:${port}/__fake/stats`).then((r) => r.ok), 15_000))) throw new Error(`the stand-in on ${port} didn't start`);
}

const server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(APP_PORT), "-H", "127.0.0.1"], {
  cwd: root,
  env: { ...process.env, FUOBE_DATA_DIR: data, FUOBE_PASSWORD: `e2e-${Math.random().toString(36).slice(2)}`, FUOBE_PUBLIC_SIGNUP: "1", COMFYUI_URL: `http://127.0.0.1:${DEAD_PORT}`, NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

async function finish(code) {
  for (const p of procs) p.kill();
  await stopProcess(server);
  removeDir(data);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${shots}`);
  if (failed.length) console.log(serverLog.split("\n").slice(-30).join("\n"));
  process.exit(code ?? (failed.length ? 1 : 0));
}

/**
 * A context whose 127.0.0.1:8188 is `ctx.map[8188]` (a stand-in's port), every other loopback port refused. `safari`:
 * the page sees Safari as Safari shows itself (no userAgentData, a Mac), though Chromium runs it. Every setup request
 * that fails is kept (`ctx.failed`).
 */
async function context(browser, opts, { safari = false } = {}) {
  const ctx = await browser.newContext(opts);
  ctx.map = {};
  ctx.failed = [];
  ctx.reports = 0;
  if (safari)
    await ctx.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => undefined });
      Object.defineProperty(Navigator.prototype, "platform", { get: () => (/iPhone/.test(navigator.userAgent) ? "iPhone" : "MacIntel") });
    });
  ctx.on("response", (r) => {
    if (/^\/api\/setup\/session\/[^/]+\/report$/.test(new URL(r.url()).pathname)) ctx.reports++;
    // A code that just ended answers 404 to a report on its way: the tab makes a new one. Anything else is a failure.
    if (new URL(r.url()).pathname.startsWith("/api/setup/session") && r.status() >= 400 && r.status() !== 404) ctx.failed.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
  });
  await ctx.route(/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+/, async (route) => {
    const u = new URL(route.request().url());
    if (Number(u.port) === APP_PORT) return route.continue();
    const to = ctx.map[Number(u.port)];
    if (!to) return route.abort("connectionrefused");
    u.port = String(to);
    return route.continue({ url: u.toString() });
  });
  await ctx.routeWebSocket(new RegExp(`^wss?://(127\\.0\\.0\\.1|localhost|\\[::1\\]):(?!${APP_PORT})\\d+`), (ws) => ws.close());
  // The chats the hand-offs open never load.
  await ctx.route(/^https:\/\/(chatgpt\.com|claude\.ai)\//, (route) => route.fulfill({ status: 200, body: "chat" }));
  return ctx;
}

let n = 0;
async function signUp(page) {
  const email = `e2e-ai-setup-${++n}-${Date.now()}@example.com`;
  // Sign-ups from one address are slowed down after a few: wait as the answer says.
  for (let i = 0; i < 6; i++) {
    const r = await page.evaluate(
      (email) =>
        fetch("/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "long enough password" }) }).then((r) => ({
          status: r.status,
          wait: Number(r.headers.get("retry-after")) || 5,
        })),
      email,
    );
    if (r.status === 201 || r.status === 200) return email;
    if (r.status !== 429) throw new Error(`sign-up answered ${r.status}`);
    await sleep(r.wait * 1000 + 200);
  }
  throw new Error("sign-up kept answering 429");
}

/** The same account in another browser (the computer, after the phone). */
async function logIn(page, email) {
  for (let i = 0; i < 6; i++) {
    const r = await page.evaluate(
      (email) =>
        fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "long enough password" }) }).then((r) => ({
          status: r.status,
          wait: Number(r.headers.get("retry-after")) || 5,
        })),
      email,
    );
    if (r.status === 200 || r.status === 201) return;
    if (r.status !== 429) throw new Error(`log-in answered ${r.status}`);
    await sleep(r.wait * 1000 + 200);
  }
  throw new Error("log-in kept answering 429");
}

/** The setup code the panel shows, once it shows one. */
const codeOf = (page) =>
  until(async () => {
    const t = (await page.locator("span[aria-label^='Setup code']").textContent())?.trim();
    return t && /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(t) ? t : null;
  }, 15_000);

/** What the person's AI reads: the status, with no cookie. */
const status = (code, json = false) => fetch(`${SITE}/api/setup/${code}${json ? "?format=json" : ""}`).then(async (r) => ({ status: r.status, body: json ? await r.json() : await r.text() }));

let browser;
try {
  if (!(await until(() => fetch(`${SITE}/api/auth/me`).then((r) => r.ok), 120_000, 500))) throw new Error(`the studio didn't start:\n${serverLog}`);
  await startFake(CLOSED, "off");
  await startFake(OPEN, SITE);
  await startFake(GUARDED, SITE, ["--guard", "1", "--has", path.join(root, "workflows/comfyui/requirements.json")]);
  browser = await launch();

  for (const [w, scheme] of [
    [{ name: "1440", viewport: { width: 1440, height: 1100 } }, "light"],
    [{ name: "390", viewport: { width: 390, height: 1500 } }, "dark"],
  ]) {
    const tag = `${w.name}-${scheme}`;
    const ctx = await context(browser, { viewport: w.viewport, colorScheme: scheme });
    const page = await ctx.newPage();
    if (process.env.E2E_CONSOLE) page.on("console", (m) => console.log(`[page] ${m.type()} ${m.text()}`));

    // A guest: the button signs up first.
    await page.goto(`${SITE}/connect?setup=ai`, { waitUntil: "load" });
    const guestButton = page.getByRole("link", { name: "Set it up with my AI" });
    check(`${tag}: a guest gets Set it up with my AI, through sign-up`, !!(await until(() => guestButton.isVisible(), 30_000)) && /\/login\?signup=1&next=%2Fconnect%3Fsetup%3Dai/.test((await guestButton.getAttribute("href")) ?? ""));
    await page.screenshot({ path: path.join(shots, `${tag}-0-guest.png`) });

    // An account: the panel, with a code. The code is held back a moment here: the page keeps its place for it.
    await signUp(page);
    let held = 0;
    await ctx.route(`${SITE}/api/setup/session`, async (route) => {
      if (route.request().method() === "POST" && held++ === 0) await sleep(2500);
      return route.continue();
    });
    await page.goto(`${SITE}/connect?setup=ai`, { waitUntil: "load" });
    const heading = page.getByRole("heading", { name: "Set it up with your AI" });
    check(`${tag}: the panel opens`, !!(await until(() => heading.isVisible(), 30_000)));
    // Where the checklist sits under the panel's heading (the page around the panel may settle meanwhile).
    const below = async () => {
      const [h, l] = await Promise.all([heading.boundingBox(), page.getByRole("list", { name: "Setup steps" }).boundingBox()]);
      return h && l ? l.y - h.y : null;
    };
    const beforeCode = (await until(() => page.locator("[data-code-line=waiting]").isVisible(), 5000)) ? await below() : null;
    const code = await codeOf(page);
    check(`${tag}: …with a setup code`, !!code, code ?? "");
    const afterCode = await below();
    check(`${tag}: nothing moves when the code arrives`, beforeCode !== null && afterCode !== null && Math.abs(beforeCode - afterCode) < 1, `${beforeCode} -> ${afterCode}`);
    const chatNow = page.getByRole("link", { name: /Open in ChatGPT/ });
    check(`${tag}: the hand-offs are ready before Fuobe looks (no browser question first)`, !!(await until(() => chatNow.isVisible(), 10_000)));
    const checklistTop = await page.getByRole("list", { name: "Setup steps" }).boundingBox();
    await page.screenshot({ path: path.join(shots, `${tag}-1-open.png`), fullPage: true });
    // Nothing changes while nobody acts: the tab reports a change once, then only its heartbeat (every 25 s at most).
    await sleep(2000);
    const before = ctx.reports;
    await sleep(8000);
    check(`${tag}: a quiet tab sends few reports`, ctx.reports - before <= 2, `${ctx.reports - before} in 8 s`);

    // ComfyUI that doesn't let this page in yet.
    ctx.map = { 8188: CLOSED };
    await page.getByRole("button", { name: "Let Fuobe look" }).click();
    const steps = page.getByRole("list", { name: "Setup steps" });
    check(`${tag}: ComfyUI is running ticks, on port 8188`, !!(await until(() => steps.getByText("port 8188").first().isVisible(), 20_000)));
    const open = page.getByRole("link", { name: /Open in ChatGPT/ });
    const checklistAfter = await page.getByRole("list", { name: "Setup steps" }).boundingBox();
    check(`${tag}: the checklist stays put after the look`, !!checklistTop && !!checklistAfter && Math.abs(checklistTop.y - checklistAfter.y) < 4, `${checklistTop?.y} -> ${checklistAfter?.y}`);
    const href = (await open.getAttribute("href")) ?? "";
    const q = new URL(href).searchParams.get("q") ?? "";
    check(`${tag}: Open in ChatGPT carries the steps, the status and the code`, href.startsWith("https://chatgpt.com/?q=") && q.includes(`${SITE}/api/setup/guide/direct/`) && q.includes(`${SITE}/api/setup/${code}`) && href.length <= 2000);
    const claudeHref = (await page.getByRole("link", { name: /Open in Claude/ }).getAttribute("href")) ?? "";
    check(`${tag}: Open in Claude too`, claudeHref.startsWith("https://claude.ai/new?q="));
    let st = await until(async () => {
      const s = await status(code);
      return /\[done\] ComfyUI is running: .*port 8188/.test(s.body) ? s : null;
    }, 20_000);
    check(`${tag}: the AI's status follows, as text`, !!st && st.status === 200 && st.body.includes("Next step: ComfyUI is running on port 8188, but it doesn't let Fuobe in yet"), st?.body.split("\n").slice(0, 6).join(" | "));
    check(`${tag}: …ASCII only, with the address to read next`, !!st && /^[\x0a\x20-\x7e]*$/.test(st.body) && st.body.includes("?r="));
    await page.screenshot({ path: path.join(shots, `${tag}-2-needs-setting.png`), fullPage: true });

    // ComfyUI restarted with the setting, but no guard yet.
    ctx.map = { 8188: OPEN };
    check(`${tag}: ComfyUI lets Fuobe in ticks`, !!(await until(() => steps.getByText("127.0.0.1:3651 only").isVisible(), 30_000)));
    st = await until(async () => {
      const s = await status(code, true);
      return s.body.next?.id === "add-guard" ? s : null;
    }, 20_000);
    check(`${tag}: …and the status asks for the guard (JSON)`, !!st && st.body.steps[1].state === "done" && st.body.steps[2].state === "todo");
    check(`${tag}: it doesn't connect without the guard`, (await page.getByRole("button", { name: "Make your first picture" }).count()) === 0);
    await page.screenshot({ path: path.join(shots, `${tag}-3-no-guard.png`), fullPage: true });

    // With the guard (and every model): connects by itself, then the first picture.
    ctx.map = { 8188: GUARDED };
    check(`${tag}: the guard ticks, and it connects by itself`, !!(await until(() => steps.getByText("Fuobe's guard is on").isVisible(), 30_000)));
    const make = page.getByRole("button", { name: "Make your first picture" });
    check(`${tag}: a picture model is ready, and Make your first picture shows`, !!(await until(() => make.isVisible(), 60_000)));
    await page.screenshot({ path: path.join(shots, `${tag}-4-connected.png`), fullPage: true });
    st = await until(async () => {
      const s = await status(code, true);
      return s.body.next?.id === "make-picture" ? s : null;
    }, 15_000);
    check(`${tag}: the status says to press Make your first picture`, !!st);
    await make.click();
    const ready = await until(() => page.getByRole("heading", { name: "Your GPU is ready" }).isVisible(), 120_000);
    check(`${tag}: the first picture is made, and the finish shows it`, !!ready && (await page.getByRole("img", { name: /Your first picture/ }).isVisible()));
    await sleep(800);
    await page.screenshot({ path: path.join(shots, `${tag}-5-finish.png`), fullPage: true });
    st = await until(async () => {
      const s = await status(code, true);
      return s.body.state === "done" ? s : null;
    }, 20_000);
    check(`${tag}: …and the status says done`, !!st && st.body.next.id === "done");
    check(`${tag}: the tab's title says so`, (await page.title()).startsWith("Your GPU is ready"));
    check(`${tag}: the status never holds the account's email or the GPU's name`, !JSON.stringify(st?.body ?? {}).includes("example.com") && !JSON.stringify(st?.body ?? {}).includes("5090"));

    // End this code: the AI's reads stop.
    await page.goto(`${SITE}/connect?setup=ai`, { waitUntil: "load" });
    await heading.waitFor({ timeout: 30_000 });
    await sleep(1500);
    const lookAgain = page.getByRole("button", { name: "Let Fuobe look" });
    if (await lookAgain.isVisible()) await lookAgain.click();
    await page.getByRole("button", { name: /AI app on this computer/ }).or(page.getByRole("tab", { name: "Windows" })).first().waitFor({ timeout: 20_000 });
    if (w.name === "1440") {
      await page.getByRole("button", { name: /AI app on this computer/ }).click();
      const line = (await page.getByLabel("the command", { exact: true }).textContent()) ?? "";
      check(`${tag}: the agent command is one plain line`, /^claude "[A-Za-z0-9 .,:/-]+"$/.test(line), line);
    }
    await page.getByRole("button", { name: "More about this code" }).click();
    await page.getByRole("menuitem", { name: "End this code" }).click();
    await page.getByText("Your AI can't see Fuobe's checks now.").waitFor({ timeout: 10_000 });
    const gone = await status(code, true);
    check(`${tag}: End this code ends it`, gone.status === 404 && gone.body.state === "not_active");
    check(`${tag}: no setup request of the tab failed`, ctx.failed.length === 0, ctx.failed.slice(0, 5).join(", "));
    await ctx.close();
  }

  // A ComfyUI on a port Fuobe doesn't wait for (8288) restarts with Fuobe's setting: it is found again by itself, and
  // the status says it is restarting meanwhile, never to install ComfyUI.
  {
    const ctx = await context(browser, { viewport: { width: 1440, height: 1100 } });
    const page = await ctx.newPage();
    await page.goto(`${SITE}/connect`, { waitUntil: "load" });
    await signUp(page);
    await page.goto(`${SITE}/connect?setup=ai`, { waitUntil: "load" });
    await page.getByRole("heading", { name: "Set it up with your AI" }).waitFor({ timeout: 30_000 });
    const codeEl = page.locator("span[aria-label^='Setup code']");
    const code = await until(async () => {
      const t = (await codeEl.textContent())?.trim();
      return t && /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(t) ? t : null;
    }, 15_000);
    ctx.map = { 8288: CLOSED };
    await page.getByRole("button", { name: "Let Fuobe look" }).click();
    const steps = page.getByRole("list", { name: "Setup steps" });
    check("restart on 8288: found there first", !!(await until(() => steps.getByText("port 8288").first().isVisible(), 30_000)));
    ctx.map = {};
    const quiet = await until(async () => {
      const s = await status(code, true);
      return s.body.next?.id === "restarting" ? s : null;
    }, 30_000);
    check("restart on 8288: the status says it is restarting, not to install it", !!quiet, quiet ? "" : JSON.stringify((await status(code, true)).body.next));
    check("restart on 8288: …that a portable ComfyUI can take up to 5 minutes", !!quiet && quiet.body.next.say.includes("up to 5 minutes"), quiet?.body.next.say);
    check("restart on 8288: the panel waits with the time so far", !!(await until(() => page.getByText(/ComfyUI stopped answering on port 8288\. Waiting for it to start again… \(\d+ s\)/).isVisible(), 15_000)));
    await page.screenshot({ path: path.join(shots, "restart-8288-waiting.png"), fullPage: true });
    // After a minute: still waiting (not "start ComfyUI"), and why it can take this long.
    check("restart on 8288: after a minute, still waiting, with why", !!(await until(() => page.getByText("A portable or Easy-Install ComfyUI can take up to 5 minutes.", { exact: false }).isVisible(), 80_000)));
    const later = await until(async () => {
      const s = await status(code, true);
      return s.body.next?.id === "restarting" && s.body.next.say.includes("1 min ago") ? s : null;
    }, 30_000);
    check("restart on 8288: …and the status counts the minutes", !!later, JSON.stringify((await status(code, true)).body.next?.say));
    check("restart on 8288: …and the step says so", await page.getByRole("list", { name: "Setup steps" }).getByText("Starting again: 1 min so far").isVisible());
    await page.screenshot({ path: path.join(shots, "restart-8288-minute.png"), fullPage: true });
    ctx.map = { 8288: OPEN };
    check("restart on 8288: found again by itself with Fuobe's setting", !!(await until(() => steps.getByText("127.0.0.1:3651 only").isVisible(), 40_000)));
    await page.screenshot({ path: path.join(shots, "restart-8288.png"), fullPage: true });
    await ctx.close();
  }

  // Safari: the web address way.
  {
    const ctx = await context(browser, {
      viewport: { width: 1440, height: 1000 },
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
    }, { safari: true });
    const page = await ctx.newPage();
    await page.goto(`${SITE}/connect`, { waitUntil: "load" });
    await signUp(page);
    await page.goto(`${SITE}/connect?setup=ai`, { waitUntil: "load" });
    await page.getByRole("heading", { name: "Set it up with your AI" }).waitFor({ timeout: 30_000 });
    check("Safari: the web address way, for a Mac", await page.getByText("For ComfyUI on your macOS computer, through a web address.").isVisible());
    check("Safari: the address form is in the checklist", await page.getByLabel("Your ComfyUI's web address").isVisible());
    const href = (await page.getByRole("link", { name: /Open in ChatGPT/ }).getAttribute("href").catch(() => "")) ?? "";
    check("Safari: the message asks for a web address, on a Mac", decodeURIComponent(href).includes("/api/setup/guide/address/mac"));
    await page.screenshot({ path: path.join(shots, "safari-1440.png"), fullPage: true });
    await ctx.close();
  }

  // A phone: Send to my computer.
  {
    const ctx = await context(browser, {
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
      colorScheme: "dark",
    }, { safari: true });
    const page = await ctx.newPage();
    await page.goto(`${SITE}/connect`, { waitUntil: "load" });
    await signUp(page);
    await page.goto(`${SITE}/connect?setup=ai`, { waitUntil: "load" });
    await page.getByRole("heading", { name: "Set it up with your AI" }).waitFor({ timeout: 30_000 });
    check("phone: Send to my computer comes first", await page.getByRole("button", { name: /Send to my computer|Copy link for my computer/ }).isVisible());
    check("phone: the AI apps wait for the computer to be picked", await page.getByText("Pick the computer that runs ComfyUI first.").isVisible());
    await page.getByRole("tab", { name: "Windows" }).click();
    const href = await until(() => page.getByRole("link", { name: /Open in ChatGPT/ }).getAttribute("href"), 10_000);
    check("phone: the message says every command runs on the computer", !!href && decodeURIComponent(href).includes("I am on my phone now"));
    const wide = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check("phone: no sideways scroll", !wide);
    await page.screenshot({ path: path.join(shots, "phone-390-dark.png"), fullPage: true });
    await ctx.close();
  }

  // From a phone to the computer: the address lands on the computer's clipboard, so the setup ends on the computer, at
  // the page the status names, signed in to the same account: the box for the address, in focus, under the same code.
  {
    const phoneCtx = await context(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: IPHONE }, { safari: true });
    const phone = await phoneCtx.newPage();
    await phone.goto(`${SITE}/connect`, { waitUntil: "load" });
    const email = await signUp(phone);
    await phone.goto(`${SITE}/connect?setup=ai`, { waitUntil: "load" });
    await phone.getByRole("heading", { name: "Set it up with your AI" }).waitFor({ timeout: 30_000 });
    await phone.getByRole("tab", { name: "Windows" }).click();
    const code = await codeOf(phone);
    check("phone to computer: the phone has a code", !!code, code ?? "");
    check("phone to computer: the phone says where the address goes, with a link for the computer", (await phone.getByText(/On that computer, open .*\/connect\?setup=ai&way=address/).isVisible()) && (await phone.getByRole("button", { name: /this link (to|for) my computer/ }).isVisible()));
    await phone.screenshot({ path: path.join(shots, "phone-to-computer-1-phone.png"), fullPage: true });
    let st = await until(async () => {
      const s = await status(code, true);
      return s.body.next?.id === "start-tunnel" ? s : null;
    }, 15_000);
    const how = st?.body.next.how.join(" ") ?? "";
    check("phone to computer: the status sends the person to that page on the computer, same account", how.includes(`${SITE}/connect?setup=ai&way=address`) && how.includes("same account as on the phone"), st?.body.next.say);

    const pcCtx = await context(browser, { viewport: { width: 1440, height: 900 } });
    const pc = await pcCtx.newPage();
    await pc.goto(`${SITE}/connect?setup=ai&way=address`, { waitUntil: "load" });
    const logInLink = pc.locator('a[href*="next=%2Fconnect%3Fsetup%3Dai%26way%3Daddress"]', { hasText: "Log in" }).first();
    check("phone to computer: signed out, Log in comes back to the same page", !!(await until(() => logInLink.isVisible(), 30_000)));
    await pc.screenshot({ path: path.join(shots, "phone-to-computer-2-guest-1440.png") });
    await logIn(pc, email);
    await pc.goto(`${SITE}/connect?setup=ai&way=address`, { waitUntil: "load" });
    await pc.getByRole("heading", { name: "Set it up with your AI" }).waitFor({ timeout: 30_000 });
    const box = pc.getByLabel("Your ComfyUI's web address");
    check("phone to computer: the computer shows the box for the address", !!(await until(() => box.isVisible(), 15_000)));
    check("phone to computer: …in focus, so a paste goes there", !!(await until(() => box.evaluate((el) => el === document.activeElement), 5000)));
    check("phone to computer: …on the first screen", !!(await box.boundingBox().then((b) => b && b.y >= 0 && b.y + b.height <= 900)));
    const pcCode = await codeOf(pc);
    check("phone to computer: …under the same setup code", pcCode === code, `${pcCode} / ${code}`);
    st = await until(async () => {
      const s = await status(code, true);
      return s.body.fuobe_open && s.body.way === "address" && s.body.computer === "windows" ? s : null;
    }, 15_000);
    check("phone to computer: the AI sees the computer's tab, on the web address", !!st && st.body.next.id === "start-tunnel" && st.body.next.say.includes("paste the address into Your ComfyUI's web address in Fuobe"), st?.body.next.say);
    await pc.screenshot({ path: path.join(shots, "phone-to-computer-3-computer-1440.png") });
    check("phone to computer: the phone hands over", !!(await until(() => phone.getByText("This setup is open in another tab or on another device.").isVisible(), 40_000)));
    await phone.screenshot({ path: path.join(shots, "phone-to-computer-4-phone-after.png"), fullPage: true });
    // Two tabs on one code: neither ends the other's wait, so nothing is refused and the waits stay few.
    const waits = { n: 0 };
    for (const c of [phoneCtx, pcCtx]) c.on("request", (r) => /\/wait\?tab=/.test(r.url()) && waits.n++);
    await sleep(10_000);
    check("phone to computer: two tabs wait calmly", waits.n <= 4, `${waits.n} waits in 10 s`);
    check("phone to computer: no setup request of either tab failed", phoneCtx.failed.length + pcCtx.failed.length === 0, [...phoneCtx.failed, ...pcCtx.failed].slice(0, 5).join(", "));
    await phoneCtx.close();
    await pcCtx.close();
  }

  // A web address whose ComfyUI runs on the processor: said as such, never as a GPU that is too small. (The server
  // never tests an address on this computer, so the account's saved address and its check are played here.)
  {
    const ctx = await context(browser, { viewport: { width: 1440, height: 1000 }, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15" }, { safari: true });
    const page = await ctx.newPage();
    await page.goto(`${SITE}/connect`, { waitUntil: "load" });
    await signUp(page);
    await ctx.route(`${SITE}/api/account/gpu`, (route) => (route.request().method() === "GET" ? route.fulfill({ json: { gpu: { mode: "link", url: "https://cpu-only-example.trycloudflare.com" } } }) : route.continue()));
    await ctx.route(`${SITE}/api/status`, async (route) => {
      const r = await route.fetch();
      const j = await r.json();
      j.viewer = { ...j.viewer, gpu: { connected: true, mode: "link", online: true, device: "cpu", host: "tunnel" } };
      return route.fulfill({ response: r, json: j });
    });
    await ctx.route(/\/api\/gpu\/badges/, (route) =>
      route.fulfill({ json: { connected: true, checkedAt: Date.now(), models: { "oss-z-image-turbo#t2i": ["g", 0, 0, 0], "oss-krea2-turbo#t2i": ["g", 0, 0, 0], "oss-sdxl#t2i": ["g", 0, 0, 0], "oss-flux1-schnell#t2i": ["g", 0, 0, 0] }, presets: {} } }),
    );
    await page.goto(`${SITE}/connect?setup=ai`, { waitUntil: "load" });
    await page.getByRole("heading", { name: "Set it up with your AI" }).waitFor({ timeout: 30_000 });
    const steps = page.getByRole("list", { name: "Setup steps" });
    check("processor, web address: the model step says it runs on the processor", !!(await until(() => steps.getByText("ComfyUI runs on the processor").isVisible(), 20_000)));
    check("processor, web address: …and what that means", await page.getByText("on the processor one picture would take many minutes", { exact: false }).isVisible());
    check("processor, web address: never a GPU that is too small", !(await page.getByText("too little memory", { exact: false }).isVisible()) && !(await steps.getByText("No small picture model fits this GPU").isVisible()));
    await page.screenshot({ path: path.join(shots, "address-cpu-1440.png"), fullPage: true });
    await ctx.close();
  }
} catch (e) {
  console.error(e);
  check("the run finished", false, String(e?.message ?? e));
} finally {
  await browser?.close().catch(() => {});
  await finish();
}
