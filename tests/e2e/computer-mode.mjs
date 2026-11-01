// "Use the ComfyUI on this computer", end to end in Chromium: a production server on 3370 with a throwaway data
// folder, and the stand-in ComfyUI (tests/helpers/fake-local-comfy.ts) on 3371, first without Fuobe's setting, then
// restarted with it. The browser never reaches any other port on this computer (every other loopback address is
// refused before it leaves the browser), so a real ComfyUI on 8188 is never touched.
//
//   pnpm build && node tests/e2e/computer-mode.mjs
//
// Checks: the dialog from a refused run, the setting's fix (with Fuobe's guard) and start file, connecting by itself
// when ComfyUI comes back, the celebration, the run starting by itself with its steps and live preview, a tile that
// never goes backwards, the result in the library; a two-step run; a reload mid-run; ComfyUI started without the
// setting on a later visit, and closed; a browser not allowed yet, and another browser of the same account; another
// account can't take or fill the job; a guest gets nothing new; a phone and Safari get the link instead.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch, root } from "./_browser.mjs";

const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3370);
const FAKE_PORT = Number(process.env.E2E_FAKE_PORT ?? 3371);
const SITE = `http://127.0.0.1:${APP_PORT}`;
const FAKE = `http://127.0.0.1:${FAKE_PORT}`;
const shots = process.env.E2E_SHOTS ?? fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-computer-shots-"));
const data = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-computer-e2e-"));
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

// --- The stand-in ComfyUI, as its own process (a restart is a new process, as for the real one). It has every node and
// model the studio's workflows need, so the GPU check finds the tools ready.
let fakeProc = null;
async function startFake(cors, o = {}) {
  const args = ["--port", String(FAKE_PORT), "--cors", cors, "--steps", "8", "--step-ms", "300", "--has", path.join(root, "workflows/comfyui/requirements.json"), ...(o.guard ? ["--guard", "1"] : [])];
  fakeProc = spawn(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.join(root, "tests/helpers/fake-local-comfy.ts"), ...args], { stdio: ["ignore", "pipe", "inherit"] });
  await until(() => fetch(`${FAKE}/__fake/stats`).then((r) => r.ok), 15_000);
}
async function stopFake() {
  if (!fakeProc) return;
  const p = fakeProc;
  fakeProc = null;
  p.kill();
  await until(() => fetch(`${FAKE}/__fake/stats`).then(() => false, () => true), 10_000);
}
const fakeStats = () => fetch(`${FAKE}/__fake/stats`).then((r) => r.json());

// --- The studio.
const server = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "start", "-p", String(APP_PORT), "-H", "127.0.0.1"], {
  cwd: root,
  env: {
    ...process.env,
    FUOBE_DATA_DIR: data,
    FUOBE_PASSWORD: `e2e-${Math.random().toString(36).slice(2)}`,
    FUOBE_PUBLIC_SIGNUP: "1",
    // The studio's own ComfyUI: an address where nothing listens (never the real one).
    COMFYUI_URL: "http://127.0.0.1:3398",
    NODE_ENV: "production",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

async function finish(code) {
  await stopFake().catch(() => {});
  server.kill();
  await sleep(500);
  try {
    fs.rmSync(data, { recursive: true, force: true });
  } catch {}
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${shots}`);
  if (failed.length) console.log(serverLog.split("\n").slice(-40).join("\n"));
  process.exit(code ?? (failed.length ? 1 : 0));
}

let browser;
try {
  if (!(await until(() => fetch(`${SITE}/api/auth/me`).then((r) => r.ok), 90_000, 500))) throw new Error(`the studio didn't start:\n${serverLog}`);
  await startFake("off");
  browser = await launch();

  /** A browser context of its own, signed up as `email`; every loopback port but the studio's and the stand-in's refused. */
  async function account(email, o = {}, { port: rememberPort = true, login = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, ...o });
    // Every request this browser makes to an app on this computer (not the studio), as it leaves the page.
    ctx.loopback = [];
    await ctx.route(/^(https?|wss?):\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+/, (route) => {
      const port = Number(new URL(route.request().url()).port);
      if (port !== APP_PORT) ctx.loopback.push(route.request().url());
      return port === APP_PORT || port === FAKE_PORT ? route.continue() : route.abort("connectionrefused");
    });
    const page = await ctx.newPage();
    if (process.env.E2E_CONSOLE) page.on("console", (m) => console.log(`[page] ${m.type()} ${m.text()}`));
    await page.goto(`${SITE}/status`, { waitUntil: "load" });
    if (email) {
      const status = await page.evaluate(
        ({ email, login }) => fetch(login ? "/api/auth/login" : "/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "long enough password" }) }).then((r) => r.status),
        { email, login },
      );
      if (status !== 201 && status !== 200) throw new Error(`sign-up answered ${status}`);
    }
    // The finder looks at the stand-in's port first (and the others are refused anyway).
    if (rememberPort) await page.evaluate((port) => localStorage.setItem("fuobe.comfy.port", String(port)), FAKE_PORT);
    return { ctx, page };
  }

  const api = (page, url, init = {}) =>
    page.evaluate(
      async ({ url, init }) => {
        const r = await fetch(url, init);
        return { status: r.status, body: await r.json().catch(() => null) };
      },
      { url, init },
    );
  const runs = async (page) => (await api(page, "/api/generations?limit=20")).body?.items ?? [];

  async function composer(page, url) {
    await page.goto(SITE + url, { waitUntil: "load", timeout: 120_000 });
    await page.waitForSelector("[data-composer-toolbar]", { timeout: 60_000 });
    await page.waitForFunction(() => Object.keys(document.querySelector("[data-composer-toolbar]") ?? {}).some((k) => k.startsWith("__react")), null, { timeout: 60_000 });
  }

  // 1. A refused run opens the dialog; the setting's fix; ComfyUI comes back with it; connected; the run starts by itself.
  {
    const { ctx, page } = await account("e2e-a@example.com");
    await composer(page, "/image?model=oss-z-image-turbo");
    await page.locator("[data-composer] textarea").fill("a lighthouse at dusk");
    await page.getByRole("button", { name: "Generate", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("Connect your GPU to run this").waitFor({ timeout: 20_000 });
    const first = await until(() => dialog.getByText("Use the ComfyUI on this computer", { exact: true }).isVisible(), 15_000);
    check("a refused run opens the dialog, this computer first", !!first);
    check("the browser's question is explained before it comes", await dialog.getByText("Press Allow. Fuobe only talks to ComfyUI.").isVisible());
    check("no error toast on top of the dialog", (await page.locator("[data-sonner-toast]").filter({ hasText: "Free accounts run" }).count()) === 0);
    await page.screenshot({ path: path.join(shots, "1-choose.png") });
    // The link, the second choice, fits inside the dialog.
    const linkToggle = dialog.getByRole("button", { name: /Run from anywhere with a link/ });
    await linkToggle.click();
    const field = await until(() => dialog.locator("input").first().boundingBox(), 10_000);
    const box = await dialog.boundingBox();
    check("the link form fits inside the dialog", !!field && !!box && field.x + field.width <= box.x + box.width - 16, JSON.stringify({ field, box }));
    await page.screenshot({ path: path.join(shots, "1b-link.png") });
    await linkToggle.click();
    await dialog.getByRole("button", { name: "Find my ComfyUI" }).click();
    await dialog.getByText("It needs one setting to work with Fuobe").waitFor({ timeout: 20_000 });
    check("ComfyUI without the setting: the one setting it needs", true);
    check("the fix says what the setting does to other websites, and that Fuobe's guard turns them away, before the download", await dialog.getByText(/other websites send work to your ComfyUI\. The start file adds Fuobe's guard/).isVisible());
    await page.screenshot({ path: path.join(shots, "2-needs-setting.png") });
    const startButton = dialog.getByRole("button", { name: "Download start file" });
    if (await startButton.isVisible()) {
      const [dl] = await Promise.all([page.waitForEvent("download"), startButton.click()]);
      const file = await dl.path();
      const text = fs.readFileSync(file, "utf8");
      check(
        "the Windows start file names only this site and this port",
        dl.suggestedFilename() === "Start ComfyUI for Fuobe.bat" && text.includes(`--enable-cors-header ${SITE}`) && text.includes(`$Port = ${FAKE_PORT}`) && text.includes("\r\n"),
        dl.suggestedFilename(),
      );
      check("the start file adds Fuobe's guard and never changes the person's own start files", text.includes("fuobe_guard.py") && text.includes("Add-Guard $nodes") && !/WriteAllLines\(\$bat|\.bak/.test(text));
    } else {
      check("the fix for this computer is shown", await dialog.getByText("--enable-cors-header").first().isVisible());
    }
    // ComfyUI restarts with the setting: Fuobe notices by itself.
    await stopFake();
    const waited = await until(() => dialog.getByText("Waiting for ComfyUI to start").isVisible(), 10_000);
    check("ComfyUI restarting: waiting for it, by itself", !!waited);
    await startFake(SITE, { guard: true });
    await dialog.getByText("Your GPU is connected").waitFor({ timeout: 30_000 });
    check("the connected screen says Fuobe's guard keeps other websites out", await dialog.getByText("Fuobe's guard keeps other websites out of your ComfyUI.").isVisible());
    check("nothing on the connected screen leads away from the run that's about to start", (await dialog.getByRole("link", { name: "See them" }).count()) === 0);
    check("connected by itself, with no click", true);
    check("the GPU is named", await dialog.getByText(/RTX 5090/).first().isVisible());
    await page.screenshot({ path: path.join(shots, "3-connected.png") });
    const ready = await until(() => dialog.getByText(/Ready now:|need a one-time download/).isVisible(), 20_000);
    check("the check says what's ready", !!ready);
    if (process.env.E2E_CONSOLE) for (let i = 0; i < 4; i++) {
      await sleep(1000);
      await page.screenshot({ path: path.join(shots, `3b-after-${i}.png`) });
    }
    // The dialog closes into the run.
    const closed = await until(async () => !(await dialog.isVisible().catch(() => false)), 20_000);
    check("the run starts by itself and the dialog closes", !!closed);
    // The toast, and when the picture showed, as they happen.
    let toastAt = 0;
    let pictureAt = 0;
    const firstToast = until(async () => (await page.getByText(/^Made on your RTX 5090 in \d+ s\.$/).first().isVisible()) && (toastAt = Date.now()), 60_000, 100);
    // The tile's words and %, as they change, until the run is done: they never go backwards.
    const labels = [];
    let sampling = true;
    const sampler = (async () => {
      while (sampling) {
        const t = await page
          .evaluate(() => {
            const p = document.querySelector("p.shimmer-text");
            if (!p) return document.querySelector('img[src^="/api/files/outputs/"]') ? "picture" : null;
            const pct = /(\d+)%/.exec(p.parentElement?.querySelector("p.font-mono")?.textContent ?? "")?.[1];
            return `${p.textContent}|${pct ?? ""}`;
          })
          .catch(() => null);
        if (t === "picture" && !pictureAt) pictureAt = Date.now();
        if (t && labels.at(-1) !== t) labels.push(t);
        await sleep(100);
      }
    })();
    const tile = await until(() => page.getByText("Keep this tab open", { exact: true }).first().isVisible(), 30_000);
    check("the run's tile says to keep this tab open", !!tile);
    const note = page.locator('[data-sidebar="footer"] [role="status"]').filter({ hasText: "Your GPU is working. Keep this tab open." });
    const noted = await until(() => note.isVisible(), 20_000);
    check("the note says the GPU is working, in the sidebar's own space", !!noted);
    // Nothing of Fuobe's own sits over the page's buttons (the newest run's Reuse and More among them).
    const covered = await page.evaluate(() =>
      [...document.querySelectorAll("#content button")]
        .filter((b) => {
          const r = b.getBoundingClientRect();
          if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) return false;
          const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return !!el && !b.contains(el) && !!el.closest('[role="status"]');
        })
        .map((b) => b.getAttribute("aria-label") || b.textContent.trim()),
    );
    check("no note covers a button of the page", covered.length === 0, covered.join(", "));
    const preview = await until(() => page.locator('img[src^="blob:"]').first().isVisible(), 20_000);
    check("a live preview from ComfyUI shows on the tile", !!preview);
    await page.screenshot({ path: path.join(shots, "4-running.png") });
    const done = await until(async () => (await runs(page)).find((g) => g.status === "succeeded" || g.status === "failed"), 60_000);
    check("the run finished on the computer", done?.status === "succeeded", done?.error ?? done?.status ?? "no run");
    await until(() => pictureAt, 10_000, 100);
    sampling = false;
    await sampler;
    const saving = labels.findIndex((l) => l.startsWith("Saving to Fuobe"));
    const back = saving >= 0 ? labels.slice(saving).filter((l) => /step \d+ of/.test(l)) : [];
    check("the tile never goes back once it is saving", saving >= 0 && back.length === 0, labels.join(" → "));
    const off = labels
      .map((l) => /step (\d+) of (\d+)\|(\d+)$/.exec(l))
      .filter(Boolean)
      .filter((m) => Math.abs(Number(m[3]) - (Number(m[1]) / Number(m[2])) * 100) > 15);
    check("the tile's % agrees with its step count", off.length === 0, off.map((m) => m[0]).join(", "));
    const out = done?.outputs?.[0];
    const file = out ? await page.evaluate((u) => fetch(u).then((r) => r.headers.get("content-type")), out.url) : null;
    check("the result is in the account's library, as a picture", !!out?.assetId && file === "image/png", `${out?.url} ${file}`);
    check("the first run on this computer says where it was made, and how fast, once its picture is there", !!(await firstToast) && !!pictureAt && toastAt >= pictureAt - 1500, `toast ${toastAt - pictureAt} ms after the picture`);
    await page.screenshot({ path: path.join(shots, "5-done.png") });
    const chip = await until(() => page.getByText(/^Your computer · NVIDIA GeForce RTX 5090/).first().isVisible(), 40_000);
    check("the status strip says the GPU is this computer's", !!chip);

    // 2. A two-step run (a picture, then a clip from it): both steps run on the computer.
    const pic = await page.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = 64;
      c.getContext("2d").fillRect(0, 0, 64, 64);
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      const r = await fetch("/api/uploads", { method: "POST", headers: { "content-type": "image/png", "x-file-name": "me.png" }, body: blob });
      return (await r.json()).url;
    });
    const two = await api(page, "/api/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ feature: "video", modelId: "fuobe-dop", presetId: "effect-window", prompt: "", inputs: { images: [pic] } }),
    });
    const ids = (two.body?.items ?? []).map((g) => g.id);
    const batch = two.body?.items?.[0]?.batchId;
    const chain = await until(async () => {
      const all = await runs(page);
      const mine = all.filter((g) => ids.includes(g.id) || (batch && g.batchId === batch));
      return mine.length >= 2 && mine.every((g) => g.status === "succeeded" || g.status === "failed") ? mine : null;
    }, 120_000);
    check("a two-step run: both steps ran on the computer", chain?.every((g) => g.status === "succeeded"), (chain ?? []).map((g) => `${g.kind} ${g.status} ${g.error ?? ""}`).join(" · ") || `start ${two.status}`);

    // 3. A reload in the middle of a run picks it up again, without sending it twice.
    const before = (await fakeStats()).posts;
    const one = await api(page, "/api/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a red door" }) });
    const id = one.body?.items?.[0]?.id;
    await until(async () => (await fakeStats()).posts > before, 20_000, 100);
    await page.reload({ waitUntil: "load" });
    const again = await until(async () => (await runs(page)).find((g) => g.id === id && (g.status === "succeeded" || g.status === "failed")), 60_000);
    const after = (await fakeStats()).posts;
    check("a reload mid-run picks the job up again, sent once", again?.status === "succeeded" && after - before === 1, `${again?.status ?? "?"}, prompts sent: ${after - before}`);

    // 3b. A later visit: ComfyUI started without the setting, and a run waits. The card with the fix opens by itself, the
    // note, the run and the status strip all say the setting is missing (steadily), and the run goes on once it's there.
    {
      await stopFake();
      await startFake("off");
      const r = await api(page, "/api/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a green field" }) });
      const rid = r.body?.items?.[0]?.id;
      const card = page.getByRole("dialog");
      const opened = await until(() => card.getByText("Your ComfyUI needs Fuobe's setting again").isVisible(), 40_000);
      check("ComfyUI without the setting on a later visit: the card with its fix opens by itself", !!opened);
      check("the card shows the fix for it", !!(await until(() => card.getByText(/without Fuobe's setting this time/).first().isVisible(), 15_000)));
      await page.screenshot({ path: path.join(shots, "7-setting-again.png") });
      const seen = new Set();
      for (let end = Date.now() + 12_000; Date.now() < end; await sleep(250)) {
        const t = await page.locator('[data-sidebar="footer"] [role="status"]').first().textContent().catch(() => null);
        if (t) seen.add(t);
      }
      check("the note says the setting is missing, steadily, with its fix", seen.size > 0 && [...seen].every((t) => t.includes("without Fuobe's setting") && t.includes("Show me how")), [...seen].join(" | "));
      const waiting = (await runs(page)).find((g) => g.id === rid);
      check("the run says the same", waiting?.message === "ComfyUI is running without Fuobe's setting. Fuobe goes on once it has it.", waiting?.message);
      check("the status strip doesn't say all is well", !!(await until(() => page.getByText("needs a setting").first().isVisible(), 15_000)));
      await stopFake();
      await startFake(SITE, { guard: true });
      check("connected again by itself", !!(await until(() => card.getByText("Your GPU is connected").isVisible(), 30_000)));
      await page.keyboard.press("Escape");
      const ran = await until(async () => (await runs(page)).find((g) => g.id === rid && (g.status === "succeeded" || g.status === "failed")), 60_000);
      check("the waiting run goes on once ComfyUI has the setting", ran?.status === "succeeded", ran?.error ?? ran?.status);
    }

    // 3c. ComfyUI closed: the note, the run and the status strip say so (never "starting" or "online"), and the run goes on
    // once ComfyUI is back.
    {
      await stopFake();
      const r = await api(page, "/api/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a quiet harbour" }) });
      const rid = r.body?.items?.[0]?.id;
      const down = await until(() => page.locator('[data-sidebar="footer"] [role="status"]').filter({ hasText: "ComfyUI isn't answering" }).isVisible(), 30_000);
      check("ComfyUI closed: the note says so, with a way to find it", !!down && (await page.getByRole("button", { name: "Find my ComfyUI" }).isVisible()));
      const waiting = await until(async () => (await runs(page)).find((g) => g.id === rid && g.message === "ComfyUI isn't answering. Start it again, and Fuobe goes on by itself."), 20_000);
      check("the run says ComfyUI isn't answering", !!waiting);
      check("the status strip says ComfyUI isn't running", !!(await until(() => page.getByText("ComfyUI not running").first().isVisible(), 20_000)));
      await page.screenshot({ path: path.join(shots, "8-comfy-closed.png") });
      // Settings → Your GPU, on this computer: what's wrong here and the one fix, never "open Fuobe on that computer".
      await page.goto(`${SITE}/settings`, { waitUntil: "load" });
      const settings = await until(() => page.getByText("ComfyUI isn't running on this computer. Start it, and Fuobe connects by itself.").first().isVisible(), 30_000);
      check("Settings on this computer says ComfyUI isn't running here, with the fix", !!settings && !(await page.getByText("Open Fuobe on the computer with your ComfyUI").first().isVisible()));
      await page.screenshot({ path: path.join(shots, "8b-settings-closed.png") });
      await startFake(SITE, { guard: true });
      const ran = await until(async () => (await runs(page)).find((g) => g.id === rid && (g.status === "succeeded" || g.status === "failed")), 60_000);
      check("the run goes on once ComfyUI is back", ran?.status === "succeeded", ran?.error ?? ran?.status);
    }

    // 4. Another account can't take, read or fill A's job.
    const { ctx: bctx, page: bpage } = await account("e2e-b@example.com");
    await api(bpage, "/api/account/gpu", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "computer" }) });
    // A's job, taken by A from a script with A's own session (no tab), so its id and token are known here.
    await page.close();
    const apage = await ctx.newPage();
    await apage.route("**/*", (r) => (r.request().resourceType() === "document" ? r.fulfill({ body: "<!doctype html><title>bare</title>" }) : r.continue()));
    await apage.goto(`${SITE}/bare`);
    await api(apage, "/api/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a blue boat" }) });
    await sleep(1500);
    await api(apage, "/api/gpu/computer/beat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device: "e2e-device-a1", takeover: true }) });
    const claimed = await until(async () => {
      const r = await api(apage, "/api/gpu/computer/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device: "e2e-device-a1" }) });
      return r.status === 200 ? r.body.task : null;
    }, 15_000, 500);
    const bClaim = await api(bpage, "/api/gpu/computer/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device: "e2e-device-b1" }) });
    const lease = claimed?.lease ?? "0".repeat(64);
    const tid = claimed?.id ?? "AAAAAAAAAAAAAAAA";
    const b = await bpage.evaluate(
      async ({ tid, lease }) => {
        const s = async (p) => (await p).status;
        return {
          inputs: await s(fetch(`/api/gpu/computer/tasks/${tid}/inputs/0`, { headers: { "x-fuobe-lease": lease } })),
          report: await s(fetch(`/api/gpu/computer/tasks/${tid}/report`, { method: "POST", headers: { "content-type": "application/json", "x-fuobe-lease": lease }, body: JSON.stringify({ event: "gone" }) })),
          outputs: await s(fetch(`/api/gpu/computer/tasks/${tid}/outputs/0?offset=0&total=4`, { method: "PUT", headers: { "x-fuobe-lease": lease }, body: new Uint8Array([137, 80, 78, 71]) })),
          release: await s(fetch(`/api/gpu/computer/tasks/${tid}/release`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lease }) })),
        };
      },
      { tid, lease },
    );
    check("another account's computer never claims A's job", !!claimed && bClaim.status === 204, `A claimed: ${!!claimed}, B's claim: ${bClaim.status}`);
    check("A's job, with A's own token, is not found for B on every route", b.inputs === 404 && b.report === 404 && b.outputs === 404 && b.release === 404, JSON.stringify(b));
    await api(apage, `/api/gpu/computer/tasks/${tid}/release`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lease }) });
    await bctx.close();
    await ctx.close();
  }

  // 4b. A browser that hasn't been allowed to reach this computer's apps never does so by itself: its note asks, the card
  // explains the browser's question, and once connected it runs the waiting run. Another browser of the same account
  // then starts where that computer last found ComfyUI.
  {
    const { ctx, page } = await account("e2e-c@example.com", {}, { port: false });
    await api(page, "/api/account/gpu", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "computer" }) });
    await page.goto(`${SITE}/library`, { waitUntil: "load" });
    const r = await api(page, "/api/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a paper boat" }) });
    const rid = r.body?.items?.[0]?.id;
    const ask = page.locator('[data-sidebar="footer"] [role="status"]').filter({ hasText: "Run them from this browser?" });
    check("a browser not allowed yet: its note asks first", !!(await until(() => ask.isVisible(), 30_000)));
    check("…and it never reached an app on this computer by itself", ctx.loopback.length === 0, ctx.loopback.slice(0, 3).join(" "));
    await page.evaluate((port) => localStorage.setItem("fuobe.comfy.port", String(port)), FAKE_PORT);
    await ask.getByRole("button", { name: "Connect" }).click();
    const card = page.getByRole("dialog");
    await card.getByText("Run your GPU jobs from this browser").waitFor({ timeout: 15_000 });
    check("the card explains the browser's question before it comes", await card.getByText("Press Allow. Fuobe only talks to ComfyUI.").isVisible());
    await card.getByRole("button", { name: "Find my ComfyUI" }).click();
    check("connected from the card", !!(await until(() => card.getByText("Your GPU is connected").isVisible(), 30_000)));
    await page.keyboard.press("Escape");
    const ran = await until(async () => (await runs(page)).find((g) => g.id === rid && (g.status === "succeeded" || g.status === "failed")), 60_000);
    check("the waiting run ran once this browser was connected", ran?.status === "succeeded", ran?.error ?? ran?.status);
    // Another browser of the same account, which remembers nothing: it looks where the computer last found ComfyUI.
    const other = await account("e2e-c@example.com", {}, { port: false, login: true });
    await other.page.evaluate(() => localStorage.setItem("fuobe.computer.reached", "1"));
    await other.page.goto(`${SITE}/library`, { waitUntil: "load" });
    const looked = await until(() => other.ctx.loopback.find((u) => u.includes("/system_stats")), 20_000);
    check("another browser of the account starts where its computer last found ComfyUI", !!looked && looked.includes(`:${FAKE_PORT}/`) && !other.ctx.loopback.some((u) => u.includes(":8188/")), looked ?? other.ctx.loopback.slice(0, 3).join(" "));
    await other.ctx.close();
    await ctx.close();
  }

  // 5. A guest gets nothing new.
  {
    const { ctx, page } = await account(null);
    const g = await page.evaluate(async () => {
      const s = async (p) => (await p).status;
      return {
        beat: await s(fetch("/api/gpu/computer/beat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ device: "e2e-guest-01" }) })),
        claim: await s(fetch("/api/gpu/computer/claim", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })),
        inputs: await s(fetch("/api/gpu/computer/tasks/AAAAAAAAAAAAAAAA/inputs/0")),
        outputs: await s(fetch("/api/gpu/computer/tasks/AAAAAAAAAAAAAAAA/outputs/0?offset=0&total=1", { method: "PUT", body: "x" })),
        inventory: await s(fetch("/api/gpu/inventory", { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" })),
        me: await fetch("/api/auth/me").then((r) => r.json()),
      };
    });
    check("a guest gets 401 from every new route, and no runner", g.beat === 401 && g.claim === 401 && g.inputs === 401 && g.outputs === 401 && [401, 409].includes(g.inventory) && !g.me.computer, JSON.stringify(g));
    await ctx.close();
  }

  // 6. A phone, and Safari: the link, with why.
  {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
    const { ctx, page } = await account("e2e-phone@example.com", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: iphone });
    await page.goto(`${SITE}/connect`, { waitUntil: "load" });
    const phone = await until(() => page.getByText("Your phone can't run ComfyUI.").first().isVisible(), 30_000);
    check("a phone gets the link option, with why", !!phone && (await page.getByText(/public address/i).first().isVisible()));
    check("…and only the tunnel steps: nothing looks for a ComfyUI on the phone", !(await page.getByText(/No ComfyUI answered|may ask to let this site reach/).first().isVisible().catch(() => false)) && ctx.loopback.length === 0, ctx.loopback.slice(0, 3).join(" "));
    await page.screenshot({ path: path.join(shots, "6-phone.png") });
    // In "this computer" mode, the phone's page never tries to run the jobs itself: they wait for the computer's tab.
    await api(page, "/api/account/gpu", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "computer" }) });
    const beats = [];
    page.on("request", (r) => r.url().includes("/api/gpu/computer/") && beats.push(r.url()));
    await page.reload({ waitUntil: "load" });
    await sleep(4000);
    check("a phone in this-computer mode never runs the jobs itself", beats.length === 0, beats.join(" "));
    await ctx.close();
    const safari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
    const s = await account("e2e-safari@example.com", { userAgent: safari });
    // Safari has no navigator.userAgentData (Chromium keeps its own under another user agent).
    await s.ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, "userAgentData", { get: () => undefined }));
    await s.page.goto(`${SITE}/connect`, { waitUntil: "load" });
    const sa = await until(() => s.page.getByText("Safari can't reach apps on this computer").first().isVisible(), 30_000);
    check("Safari gets the link option, with why", !!sa);
    await s.ctx.close();
  }
} catch (e) {
  check("the run didn't stop early", false, (e && e.stack) || String(e));
} finally {
  await browser?.close().catch(() => {});
  await finish();
}
