// Blockout to film (package blockout-film) in a real browser (the app must be running in demo mode; WebGL runs on
// SwiftShader). Usage: node tests/e2e/cinema-blockout.mjs [appUrl] [--shots=dir]. Exits 1 on the first failure.
//
// 1. 1440 px, light, cloud: the composer's Blockout chip opens the panel; "Build it here" opens the builder on the
//    corridor example; Shot shows the camera's view; "Use this blockout" renders the grey box (24 fps) and its depth
//    (16 fps) in the browser and hands them back; the beats carry the example's words, a still gets a role, the prompt
//    reads in the workflow's sections with @Video1 / @Image1, Seedance 2.5 is priced, and Film queues a take that
//    remembers the blockout. The renders are real videos with the right frame counts.
// 2. 1440 px, dark, open engine: an uploaded grey-box clip, beats added by hand, "Free", the GPU's words, Film queues
//    the first frame, the cut and the window on Wan 2.2 Fun VACE.
// 3. 390 px, light and dark: the panel and the builder fit with nothing scrolling sideways.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DESKTOP, PHONE, chromiumPath, loadPlaywright } from "./_browser.mjs";
import { tempDir, removeDir } from "./_temp.mjs";

const args = process.argv.slice(2);
const app = (args.find((a) => !a.startsWith("--")) ?? "http://localhost:3440").replace(/\/$/, "");
const shots = args.find((a) => a.startsWith("--shots="))?.slice(8);
if (shots) fs.mkdirSync(shots, { recursive: true });
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const step = (name) => console.log(`- ${name}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = browser.newContext().then((c) => c.request);
async function call(url, method = "GET", data) {
  const res = await (await api).fetch(app + url, { method, headers: { "Content-Type": "application/json" }, data: data === undefined ? undefined : JSON.stringify(data) });
  return res.json();
}
async function until(fn, what, ms = 90_000) {
  const t = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t > ms) throw new Error(`Timed out waiting for ${what}`);
    await sleep(700);
  }
}
const shoot = (page, name) => shots && page.screenshot({ path: path.join(shots, `${name}.png`) });
const hideDevBadge = (ctx) =>
  ctx.addInitScript(() =>
    document.addEventListener("DOMContentLoaded", () => {
      const s = document.createElement("style");
      s.textContent = "nextjs-portal{display:none!important}";
      document.head.append(s);
    }),
  );
const noSideScroll = async (page, what) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0, `${what}: nothing scrolls sideways`);
const tmp = tempDir("fuobe-blockout-e2e-");
/** Frames and codec of a stored file, read with ffprobe. */
async function probe(url) {
  const res = await (await api).fetch(app + url);
  const file = path.join(tmp, path.basename(url));
  fs.writeFileSync(file, Buffer.from(await res.body()));
  const out = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,nb_read_frames", "-of", "json", file]).toString());
  return out.streams[0];
}

const status = await call("/api/status");
assert.notEqual(status.demoMode, "off", "run the app in demo mode (FUOBE_DEMO_MODE=on)");
const project = await call("/api/cinema/projects", "POST", { name: "Blockout check" });
const items = async () => (await call(`/api/cinema/projects/${project.id}/items`)).items;
const errors = [];
let failed = false;

async function open(ctx, engine, query = "") {
  await ctx.addInitScript((e) => localStorage.setItem("fuobe.engine", e), engine);
  await hideDevBadge(ctx);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${app}/cinema/${project.id}${query}`, { waitUntil: "load", timeout: 120_000 });
  return page;
}

try {
  {
    step("1440 light, cloud: build the corridor example, render it, add a still, film it on Seedance 2.5");
    const ctx = await browser.newContext({ ...DESKTOP, colorScheme: "light" });
    const page = await open(ctx, "cloud");
    await page.getByRole("button", { name: "Blockout: film a grey-box blockout" }).click({ timeout: 90_000 });
    const panel = page.getByRole("dialog", { name: "Blockout to film" });
    await panel.waitFor();
    await shoot(page, "1-panel-empty-1440-light");
    await noSideScroll(page, "the empty panel");
    await panel.getByRole("button", { name: /Build it here/ }).click();
    const builder = page.getByRole("dialog", { name: "Blockout builder" });
    await builder.waitFor({ timeout: 60_000 });
    await sleep(1500);
    await shoot(page, "1-builder-1440-light");
    await builder.getByRole("radio", { name: "Shot" }).click();
    await builder.getByRole("slider", { name: "Playhead" }).focus();
    for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowRight");
    await sleep(500);
    await shoot(page, "1-builder-shot-1440-light");
    assert.ok(await builder.getByText(/Through the shot camera/).isVisible());
    await builder.getByRole("tab", { name: "Camera" }).click();
    assert.equal(await builder.getByRole("list", { name: "Camera keys" }).getByRole("listitem").count(), 3, "the example's three camera keys");
    step("frame the camera from the keyboard: a typed value keys it at the playhead");
    const camX = builder.getByRole("group", { name: "Camera (m)" }).getByLabel("x", { exact: true });
    await camX.fill("0.5");
    await camX.press("Tab");
    assert.equal(await builder.getByRole("list", { name: "Camera keys" }).getByRole("listitem").count(), 4, "a fourth key, typed");
    await builder.getByRole("button", { name: /^Remove the key at 1\.[23] s$/ }).click();
    assert.equal(await builder.getByRole("list", { name: "Camera keys" }).getByRole("listitem").count(), 3);
    await builder.getByRole("tab", { name: "Build" }).click();
    await builder.getByRole("button", { name: "Box", exact: true }).click();
    await builder.getByRole("tab", { name: "Piece" }).click();
    assert.equal(await builder.getByRole("textbox", { name: "Name" }).inputValue(), "Box");
    await builder.getByRole("button", { name: "Remove", exact: true }).click();
    await noSideScroll(page, "the builder");
    step("render the grey box and its depth in the browser");
    await builder.getByRole("button", { name: "Use this blockout" }).click();
    await panel.getByText("Built in your browser").waitFor({ timeout: 600_000 });
    const video = await panel.locator("video").getAttribute("src");
    const grey = await probe(video);
    assert.equal(grey.nb_read_frames, "192", "8 s at 24 fps");
    assert.deepEqual([grey.width, grey.height], [1280, 720]);
    console.log(`  grey box: ${grey.codec_name} ${grey.width}x${grey.height}, ${grey.nb_read_frames} frames`);
    assert.equal(await panel.getByLabel("Beat 2 name").inputValue(), "The door opens");
    assert.match(await panel.getByLabel("What happens in beat 1").inputValue(), /walks slowly down the narrow corridor/);
    step("a still with a role, the look and sound, the compiled prompt and the price");
    const png = path.join(tmp, "interior.png");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x334455:s=320x240", "-frames:v", "1", png]);
    await panel.locator('input[type=file][accept^="image/"]').setInputFiles(png);
    await panel.getByLabel("Reference 1 is the").waitFor();
    await panel.getByLabel("Reference 1 is the").selectOption("interior");
    await panel.getByLabel("Style").fill("Low-key horror, cold torchlight");
    await panel.getByLabel("Sounds").fill("Footsteps on concrete, a long door creak");
    const prompt = await until(async () => {
      const v = await panel.getByLabel("Compiled prompt").inputValue();
      return /@Image1 is the interior/.test(v) && v;
    }, "the compiled prompt");
    for (const h of ["Subject:", "Action:", "Camera:", "Style:", "Constraints:", "Audio:"]) assert.ok(prompt.includes(h), h);
    assert.match(prompt, /0\.0–4\.5s — Arrival: A woman walks slowly/);
    assert.match(await panel.getByText(/^≈ \$|Placeholder/).first().innerText(), /\$|Placeholder/);
    step("MiniMax H3 Max 3D: the prompt box stops at 2000 characters");
    await panel.getByRole("radio", { name: /MiniMax H3 Max 3D/ }).click();
    assert.equal(await panel.getByLabel("Compiled prompt").getAttribute("maxlength"), "2000");
    assert.match(await panel.locator("#blockout-prompt-count").innerText(), /\/ 2000 characters/);
    await panel.getByRole("radio", { name: /Seedance 2\.5/ }).click();
    assert.equal(await panel.locator("#blockout-prompt-count").count(), 0);
    await shoot(page, "1-panel-ready-1440-light");
    await noSideScroll(page, "the ready panel");
    await panel.getByRole("button", { name: "Film it" }).click();
    await until(async () => (await items()).find((g) => g.take?.action === "blockout"), "the blockout take");
    const take = (await items()).find((g) => g.take?.action === "blockout");
    assert.equal(take.feature, "cinema-blockout");
    assert.equal(take.request.modelId, "seedance-2-5");
    assert.deepEqual(take.take.blockout.beats, ["Arrival", "The door opens", "Into the dark"]);
    assert.equal(take.request.inputs.videos[0], video);
    step("the depth render: 8 s at 16 fps, and the first frame");
    const uploads = (await call("/api/assets?source=upload")).items ?? [];
    const depthAsset = uploads.find((a) => /blockout-depth/.test(a.name ?? ""));
    assert.ok(depthAsset, "the depth render was uploaded");
    const depth = await probe(depthAsset.url);
    assert.equal(depth.nb_read_frames, "128", "8 s at 16 fps");
    assert.deepEqual([depth.width, depth.height], [832, 464]);
    assert.ok(uploads.some((a) => /blockout-first-frame/.test(a.name ?? "")), "the first frame was uploaded");
    await ctx.close();
  }
  {
    step("1440 dark, open engine: an uploaded grey box, hand-made beats, free on your GPU");
    const ctx = await browser.newContext({ ...DESKTOP, colorScheme: "dark" });
    const page = await open(ctx, "open", "?blockout=1");
    const panel = page.getByRole("dialog", { name: "Blockout to film" });
    await panel.waitFor({ timeout: 90_000 });
    const clip = path.join(tmp, "greybox.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=24", "-t", "6", "-pix_fmt", "yuv420p", "-c:v", "libx264", clip]);
    await panel.locator('input[type=file][accept^="video/"]').first().setInputFiles(clip);
    await panel.getByText("greybox.mp4").waitFor({ timeout: 60_000 });
    await panel.getByText(/no depth pass: Depth Anything 3 reads it on your GPU/).waitFor();
    step("a near = dark depth pass (Blender's mist), inverted");
    const mist = path.join(tmp, "mist.mp4");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "gradients=size=640x360:rate=16", "-t", "6", "-pix_fmt", "yuv420p", "-c:v", "libx264", mist]);
    await panel.locator('input[type=file][accept^="video/"]').nth(1).setInputFiles(mist);
    await panel.getByText(/with its depth/).waitFor({ timeout: 60_000 });
    assert.ok(await panel.getByText(/near is bright, far is dark/).isVisible());
    await panel.getByLabel(/Near is dark/).check();
    await panel.getByLabel("What happens in beat 1").fill("A man creeps along the wall.");
    await panel.getByRole("button", { name: "Beat", exact: true }).click();
    await panel.getByLabel("Beat 2 name").fill("Lights out");
    await panel.getByLabel("What happens in beat 2").fill("The lights die.");
    await panel.getByText(/^(Free|Placeholder · free)$/).first().waitFor();
    assert.ok(await panel.getByText(/not the dialogue or sound/).first().isVisible());
    await shoot(page, "2-panel-open-1440-dark");
    await noSideScroll(page, "the open panel");
    await panel.getByRole("button", { name: "Film it" }).click();
    const runs = await until(async () => {
      const list = (await items()).filter((g) => g.feature === "cinema-blockout" && g.engine !== "cloud" && g.request.modelId !== "seedance-2-5");
      return list.length >= 4 && list;
    }, "the open engine's steps");
    const models = runs.map((g) => g.request.modelId);
    for (const m of ["oss-extract-frame", "oss-qwen-edit", "oss-segment", "oss-wan22-vace-blockout"]) assert.ok(models.includes(m), m);
    const win = runs.find((g) => g.request.modelId === "oss-wan22-vace-blockout");
    assert.equal(win.request.params?.extra?.invertDepth, true, "the mist pass is inverted");
    await ctx.close();
  }
  {
    step("the GPU board's link: /cinema?blockout=1 asks for the project and opens Blockout to film in it");
    const ctx = await browser.newContext({ ...DESKTOP, colorScheme: "light" });
    await hideDevBadge(ctx);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => !(/^Hydration failed/.test(e.message) && /ViewerRowPlaceholder/.test(e.message)) && errors.push(e.message));
    await page.goto(`${app}/cinema?blockout=1`, { waitUntil: "load", timeout: 120_000 });
    await page.getByText(/Blockout to film: pick the project to film it in/).waitFor({ timeout: 60_000 });
    await page.getByRole("link", { name: /Blockout check/ }).first().click();
    await page.getByRole("dialog", { name: "Blockout to film" }).waitFor({ timeout: 90_000 });
    assert.match(page.url(), /\?blockout=1$/);
    await ctx.close();
  }
  for (const scheme of ["light", "dark"]) {
    step(`390 ${scheme}: the panel and the builder fit`);
    const ctx = await browser.newContext({ ...PHONE, colorScheme: scheme });
    const page = await open(ctx, "cloud", "?blockout=1");
    const panel = page.getByRole("dialog", { name: "Blockout to film" });
    await panel.waitFor({ timeout: 90_000 });
    await noSideScroll(page, `the panel at 390 (${scheme})`);
    await shoot(page, `3-panel-390-${scheme}`);
    await panel.getByRole("button", { name: /Build it here/ }).click();
    const builder = page.getByRole("dialog", { name: "Blockout builder" });
    await builder.waitFor({ timeout: 60_000 });
    await sleep(1500);
    await noSideScroll(page, `the builder at 390 (${scheme})`);
    assert.ok(await builder.getByRole("button", { name: "Use this blockout" }).isVisible());
    await shoot(page, `3-builder-390-${scheme}`);
    await builder.getByRole("button", { name: "Close the builder" }).click();
    await panel.waitFor();
    await ctx.close();
  }
  if (errors.length) console.log("PAGE ERRORS:\n" + errors.map((e) => e.slice(0, 600)).join("\n---\n"));
  assert.deepEqual(errors, [], "no page errors");
  console.log("ok");
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser.close();
  removeDir(tmp);
  process.exit(failed ? 1 : 0);
}
