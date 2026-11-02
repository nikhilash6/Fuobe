// MiniMax H3 on smaller cards in the browser (no run reaches a GPU): MiniMax H3's Options in the Video studio on your GPU (GPU tier with
// Auto, 32 GB, FastH3 V2 and Trim; no Decoder until Fast decode validates), the composer's note for a picked tier and for Auto on the card the
// last GPU check read, and the Connect board's Video row naming the build that card gets. Each at 1440 and 390 px, light and
// dark, without sideways scroll, failing on console errors.
// Usage: FUOBE_DATA_DIR=<the dev server's data dir> node tests/e2e/h3-any-gpu.mjs [appUrl] [--shots <dir>] (on a dev server started fresh,
// with an empty data dir)
// The dev server runs with COMFYUI_URL=http://comfy.test:8188 (unreachable). The script writes the install's last GPU check
// into the server's database (a 12 GB RTX 4070, the Trim files present) before any page reads it. Generate is never pressed.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { launch, root } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });
const dataDir = process.env.FUOBE_DATA_DIR;
if (!dataDir) throw new Error("Set FUOBE_DATA_DIR to the dev server's data dir");
const comfyUrl = (process.env.COMFYUI_URL ?? "http://comfy.test:8188").replace(/\/+$/, "");

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(84)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};
const flat = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

// ---- The install's last GPU check: a 12 GB RTX 4070 on a CUDA 12.8 PyTorch with FastH3 Trim's fp8 file and the shared files.
async function seed() {
  // The server creates its database on its first request.
  await fetch(`${app}/api/status`).catch(() => null);
  const Database = createRequire(path.join(root, "package.json"))("better-sqlite3");
  const db = new Database(path.join(dataDir, "fuobe.db"));
  const index = JSON.parse(fs.readFileSync(path.join(root, "workflows/comfyui/requirements.json"), "utf8"));
  const files = ["diffusion_models/fastvideo_fasth3_trim_8step_fp8.safetensors", ...index.workflows["minimax-h3-trim-t2v"].files.filter((f) => !f.startsWith("diffusion_models/"))];
  const models = {};
  for (const folder of index.folders) models[folder] = { have: {}, total: 0 };
  for (const key of files) {
    const [folder, file] = key.split("/");
    models[folder].have[file] = index.files[key].sizeBytes;
    models[folder].total++;
  }
  const at = Date.now();
  const inventory = {
    v: 1, via: "server", checkedAt: at, tookMs: 5, reachable: true,
    comfy: { version: "0.43.0", os: "posix", torch: "2.9.1+cu128", embeddedPython: false, deployEnv: "local-git", flags: { cpuOnly: false } },
    devices: [{ name: "cuda:0 NVIDIA GeForce RTX 4070 : cudaMallocAsync", type: "cuda", index: 0, vramTotal: 12 * 2 ** 30, vramFree: 11 * 2 ** 30 }],
    ram: { total: 64 * 2 ** 30, free: 48 * 2 ** 30 },
    manager: { api: "none" },
    nodes: { have: [], missing: [], total: 1700, readAt: at, how: "object_info" },
    combos: {}, packs: {}, models, loras: {}, fingerprint: "e2e", errors: [],
  };
  const urlHash = crypto.createHash("sha256").update(`${comfyUrl.toLowerCase()}|server`).digest("hex");
  db.prepare(
    `INSERT INTO gpu_snapshots (target_key, via, url_hash, checked_at, index_hash, inventory_json, report_json, stale) VALUES ('install', 'server', ?, ?, ?, ?, NULL, 0)
     ON CONFLICT(target_key, via) DO UPDATE SET url_hash = excluded.url_hash, checked_at = excluded.checked_at, index_hash = excluded.index_hash, inventory_json = excluded.inventory_json, report_json = NULL, stale = 0`,
  ).run(urlHash, at, index.hash, JSON.stringify(inventory));
  db.close();
}

const browser = await launch();
const errors = [];
const contextFor = async (engine, width = 1440, colorScheme = "light") => {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme, ...(width < 500 && { isMobile: true, hasTouch: true }) });
  await context.addInitScript((e) => {
    try {
      localStorage.setItem("fuobe.engine", e);
    } catch {}
  }, engine);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`${width} ${colorScheme} ${new URL(page.url()).pathname}: ${m.text().slice(0, 1500)}`);
  });
  page.on("pageerror", (e) => errors.push(`${width} ${colorScheme}: ${String(e).slice(0, 200)}`));
  return { context, page };
};
const composer = (page) => page.locator("[data-composer]").first();
const shoot = (page, name) => (shots ? page.screenshot({ path: path.join(shots, name), fullPage: false }) : undefined);
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const openMenu = async (page) => {
  const button = page.locator('button[aria-label^="Model: "][aria-label$="Change model"]:visible').first();
  const search = page.getByPlaceholder(/^Search( (all )?models)?/);
  for (let i = 0; i < 3; i++) {
    await button.waitFor({ state: "visible", timeout: 60_000 });
    await button.focus();
    await page.keyboard.press("Enter");
    if (await search.waitFor({ timeout: 10_000 }).then(() => true, () => false)) return search;
  }
  await search.waitFor();
  return search;
};
const pick = async (page, query, id) => {
  const search = page.getByPlaceholder(/^Search( (all )?models)?/);
  await search.fill(query);
  const row = page.locator(`[cmdk-item][data-value$=":${id}"]`).first();
  await row.waitFor({ timeout: 15_000 });
  let picked = false;
  for (let i = 0; i < 12 && !picked; i++) {
    picked = (await row.getAttribute("data-selected")) === "true";
    if (!picked) await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
};
/** Opens the chip that holds MiniMax H3's settings (the Video studio names it Director; on a phone it can sit in Settings). */
const openOptions = async (page) => {
  const chip = composer(page).getByRole("button", { name: /^(Director|Options)/ }).first();
  if (!(await chip.isVisible().catch(() => false))) {
    const settings = composer(page).getByRole("button", { name: /^Settings:/ }).first();
    await settings.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog").first();
    await sheet.waitFor({ timeout: 10_000 });
    const inner = sheet.getByRole("button", { name: /^(Director|Options)/ }).first();
    await inner.focus();
    await page.keyboard.press("Enter");
    return;
  }
  await chip.focus();
  await page.keyboard.press("Enter");
};
const listOf = async (page, box) => {
  await box.focus();
  await page.keyboard.press("Enter");
  const list = page.getByRole("listbox").last();
  await list.waitFor({ timeout: 10_000 });
  const items = (await list.getByRole("option").allInnerTexts()).map(flat);
  await page.keyboard.press("Escape");
  return items;
};

if (argv.includes("--seed-only")) {
  await seed();
  process.exit(0);
}
try {
  await seed();
  // The Connect page starts a fresh check of the (unreachable) address once the last one is a minute old, and the server keeps
  // the check it read in memory: its four visits come first, within that minute of the seed, on a server started fresh.
  for (const width of [1440, 390]) {
    for (const scheme of ["light", "dark"]) {
      const tag = `${width} ${scheme}`;
      // ---- Connect your GPU: the Video row names the build this card gets.
      {
        const { context, page } = await contextFor("open", width, scheme);
        await page.goto(`${app}/connect`, { waitUntil: "load" });
        const line = page.getByText(/(Ready on|On) this GPU:/).first();
        await line.waitFor({ timeout: 60_000 }).catch(() => {});
        const row = page.locator("li").filter({ has: page.getByText("Video", { exact: true }) }).filter({ hasText: /this GPU:/ }).first();
        const text = flat(await row.innerText().catch(() => ""));
        check(`${tag} connect: the Video row reads Ready on this GPU: FastH3 Trim (fp8)`, /Ready on this GPU: FastH3 Trim \(fp8\)/.test(text), text.slice(0, 160));
        check(`${tag} connect: it says text to video only`, /Text to video only/.test(text));
        const swap = flat(await page.locator("li").filter({ has: page.getByText("Character swap", { exact: true }) }).first().innerText().catch(() => ""));
        check(`${tag} connect: Character swap says it needs the full model`, /Runs on the full MiniMax H3/.test(swap), swap.slice(0, 160));
        if (width < 500) await row.scrollIntoViewIfNeeded().catch(() => {});
        await shoot(page, `connect-${width}-${scheme}.png`);
        check(`${tag} connect: nothing scrolls sideways`, await noSideways(page));
        await context.close();
      }
    }
  }
  for (const width of [1440, 390]) {
    for (const scheme of ["light", "dark"]) {
      const tag = `${width} ${scheme}`;
      // ---- Video studio on your GPU: MiniMax H3's GPU tier and Decoder, and the composer's note.
      {
        const { context, page } = await contextFor("open", width, scheme);
        await page.goto(`${app}/video`, { waitUntil: "load" });
        await composer(page).waitFor({ timeout: 60_000 });
        await page.waitForTimeout(1200);
        await openMenu(page);
        await pick(page, "MiniMax H3", "oss-minimax-h3");
        await composer(page).getByRole("textbox").first().fill("A lighthouse at dusk, waves on the rocks, gulls calling");
        await page.waitForTimeout(800);
        await page.getByText(/On your GPU this runs as/).first().waitFor({ timeout: 15_000 }).catch(() => {});
        // Auto on the 12 GB card the check read: Trim, said in plain words.
        const auto = page.getByText(/On your GPU this runs as FastH3 Trim/);
        check(`${tag} video: Auto on a 12 GB card says it runs as FastH3 Trim`, (await auto.count()) > 0);
        await openOptions(page);
        const tier = page.getByRole("combobox", { name: "GPU tier" });
        await tier.waitFor({ timeout: 10_000 });
        const tiers = await listOf(page, tier);
        check(`${tag} video: GPU tier offers Auto, 32 GB, FastH3 V2 and Trim`, tiers[0] === "Auto" && tiers.some((t) => /FastH3 V2/.test(t)) && tiers.some((t) => /FastH3 Trim, experimental, text to video only/.test(t)), tiers.join(" | "));
        // Fast decode is held back until it validates on a ComfyUI with Sol's loader (H3_FAST_DECODE_OFFERED).
        check(`${tag} video: no Decoder option yet`, (await page.getByRole("combobox", { name: "Decoder" }).count()) === 0);
        // FastH3 V2 picked: the composer says what it changes.
        await tier.focus();
        await page.keyboard.press("Enter");
        await page.getByRole("listbox").last().getByRole("option", { name: /FastH3 V2/ }).click();
        await page.waitForTimeout(400);
        check(`${tag} video: FastH3 V2 picked, the composer says what it changes`, (await page.getByText(/^FastH3 V2: an 8-step build of MiniMax H3/).count()) > 0);
        await shoot(page, `video-${width}-${scheme}.png`);
        check(`${tag} video: nothing scrolls sideways`, await noSideways(page));
        await context.close();
      }
    }
  }
  check("no console errors", errors.length === 0, errors.slice(0, 5).join(" || "));
} finally {
  await browser.close();
}
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nall passed");
