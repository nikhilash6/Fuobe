// Character Swap Studio, browser check (o/h3-studio): the whole flow in demo mode on the cloud engine — a project, the
// character, a clip, Detect edits, a cut at the playhead and Keep original, the transcript and Build shot prompts, a
// click on a frame and Track shot, a mask and a scene anchor approved, two segments (the second continuing from the
// first, waiting for it), takes made, compared and reviewed, Export decisions, and the assembly with a download. Then every stage at 1440 and 390 px, light and dark, without sideways scroll;
// a project on your GPU shows its 24 fps copy; an AVI on the cloud gets a copy the browser can play; the sidebar links
// here and Genjutsu's Character swap opens its clip and character in a new project; an unknown project is a 404.
// Usage: node tests/e2e/character-swap-studio.mjs [appUrl] [--shots <dir>]   (app in demo mode, ComfyUI unreachable).
// Exits 1 on a failed check.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch, root } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(72)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};
// The walk clip with a hard cut at 4 s (the last 2 s mirrored and inverted), as VP9 WebM: the browser reads its frames
// for Detect edits and the frame to click (Playwright's Chromium decodes no H.264).
const walk = path.join(root, "scripts/eval/fixtures/walk-6s.mp4");
const clipFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "swap-studio-e2e-")), "walk.webm");
execFileSync("ffmpeg", [
  "-v", "error", "-y", "-i", walk,
  "-filter_complex", "[0:v]split[a][b];[a]trim=0:4,setpts=PTS-STARTPTS[v1];[b]trim=4:6,setpts=PTS-STARTPTS,negate,hflip[v2];[v1][v2]concat=n=2:v=1:a=0[v]",
  "-map", "[v]", "-map", "0:a", "-c:v", "libvpx-vp9", "-b:v", "500k", "-deadline", "realtime", "-cpu-used", "8", "-c:a", "libopus", "-shortest", clipFile,
]);
const heroFile = path.join(root, "scripts/eval/fixtures/character/drawn-face-2.png");
const STAGES = ["Shots", "Words", "Who to swap", "Scene anchors", "Segments", "Takes & review", "Assemble"];

// A rerun starts clean: earlier runs' projects go.
for (const p of (await (await fetch(`${app}/api/swap-studio/projects`)).json()).items ?? []) {
  if (["Rain scene", "GPU check", "AVI check", "walk-handoff"].includes(p.name)) await fetch(`${app}/api/swap-studio/projects/${p.id}`, { method: "DELETE" });
}

const browser = await launch();
let projectUrl = "";
try {
  // ---------------------------------------------------------------------------
  // The flow, once (1440 light).
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
    await context.addInitScript(() => {
      try {
        localStorage.setItem("fuobe.engine", "cloud");
      } catch {}
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    const text = () => page.evaluate(() => document.body.innerText);
    const shot = async (name) => shots && (await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true }));

    await page.goto(`${app}/character-swap`, { waitUntil: "load", timeout: 180_000 });
    await page.getByRole("heading", { name: "Swap a character through whole clips" }).waitFor({ timeout: 120_000 });
    check("projects page: hero and steps", (await text()).includes("Who and the scene"));
    check("sidebar links the studio", (await page.locator('a[href="/character-swap"]').count()) > 0);
    await page.getByPlaceholder("Project name, e.g. Rain scene").fill("Rain scene");
    await page.getByRole("button", { name: /New project · cloud/ }).click();
    await page.waitForURL(/\/character-swap\/swap-/, { timeout: 60_000 });
    projectUrl = page.url();
    await page.getByRole("heading", { name: "Rain scene" }).waitFor();
    check("project page opens", true, projectUrl.split("/").pop());

    // The character and the clip.
    await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles(heroFile);
    await page.locator('img[src^="/api/files/"]').first().waitFor();
    const desc = page.getByLabel("Description");
    await desc.fill("a cartoon man with round glasses and a blue scarf");
    await desc.blur();
    await page.locator('input[type="file"][accept^="video/"]').setInputFiles(clipFile);
    await page.getByRole("button", { name: /^walk/ }).waitFor({ timeout: 90_000 });
    check("clip added (6 s, 144 frames at 24 fps)", /144 frames at 24 fps/.test(await text()));

    // Shots: detect, then a cut at 4 s, shot 2 kept as filmed.
    await page.getByRole("button", { name: "Detect edits" }).click();
    await page.getByText(/edits? detected|Detected \d+ edit/).waitFor({ timeout: 90_000 });
    const found = await text();
    check("Detect edits finds the cut at 4 s (frame 96)", /Detected 1 edit at frames 96 /.test(found), found.match(/Detected[^\n]*|No edits[^\n]*/)?.[0] ?? "");
    if (/Detected 1 edit at frames 96 /.test(found)) await page.getByRole("button", { name: "Use them" }).click();
    else {
      // Placed by hand at the playhead instead (typed: the timeline is for the mouse).
      await page.getByLabel("Playhead frame").fill("96");
      await page.getByLabel("Playhead frame").press("Enter");
      await page.getByRole("button", { name: "Cut at the playhead" }).click();
    }
    // The playhead by keyboard: typed frame number.
    await page.getByLabel("Playhead frame").fill("30");
    await page.getByLabel("Playhead frame").press("Enter");
    await page.waitForFunction(() => Math.abs(document.querySelector("video").currentTime - 30.5 / 24) < 0.01, null, { timeout: 10_000 });
    check("the playhead moves to a typed frame", true);
    await page.getByRole("radiogroup", { name: "Shot 2" }).getByRole("radio", { name: /Keep original/ }).click();
    await page.getByRole("button", { name: "Save shots" }).click();
    await page.getByRole("button", { name: "Saved" }).waitFor();
    check("cuts saved: two shots, the second kept", /Shot 2[\s\S]*96–144/.test(await text()));
    await shot("01-shots");

    // Words: transcript, Build shot prompts.
    await page.getByRole("tab", { name: "Words" }).click();
    await page.getByRole("button", { name: /^Transcribe/ }).click();
    await page.getByText("This is a demo transcript.").first().waitFor({ timeout: 60_000 });
    await page.getByRole("button", { name: "Build shot prompts" }).click();
    await page.waitForFunction(() => [...document.querySelectorAll("textarea")].some((t) => t.value.includes('Current shot dialogue: "This is a demo transcript.')), null, { timeout: 20_000 });
    check("transcript and shot prompt (H3 tags, the shot's words)", true);
    await shot("02-words");

    // Who to swap: a click on a frame, Track shot, approve.
    await page.getByRole("tab", { name: "Who to swap" }).click();
    await page.getByRole("button", { name: "Show this frame" }).click();
    const stage = page.getByRole("application");
    await stage.waitFor();
    const box = await stage.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    check("include point placed", (await page.getByRole("button", { name: /Take away point 1 \(include\)/ }).count()) === 1);
    await page.getByRole("button", { name: /^Track shot/ }).click();
    const approveMask = page.getByRole("button", { name: "Approve", exact: true }).first();
    await approveMask.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Approve" && !b.disabled), null, { timeout: 60_000 });
    await approveMask.click();
    await page.getByRole("button", { name: "Unapprove" }).waitFor();
    check("mask version made and approved (and can be unapproved)", true);
    // The shot strip is one tab stop; the arrow keys pick shots.
    const radios = page.getByRole("radiogroup", { name: "Shot", exact: true }).getByRole("radio");
    check("shot strip: one tab stop", (await radios.evaluateAll((els) => els.filter((e) => e.tabIndex === 0).length)) === 1);
    await radios.first().focus();
    await page.keyboard.press("ArrowRight");
    check("shot strip: ArrowRight picks shot 2", (await radios.nth(1).getAttribute("aria-checked")) === "true" && (await page.evaluate(() => document.activeElement?.textContent ?? "")).startsWith("Shot 2"));
    await page.keyboard.press("ArrowLeft");
    await page.getByRole("button", { name: "Unapprove" }).waitFor();
    await shot("03-who");

    // Scene anchor: make, approve.
    await page.getByRole("tab", { name: "Scene anchors" }).click();
    await page.getByRole("button", { name: "Make anchor" }).click();
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Approve" && !b.disabled), null, { timeout: 60_000 });
    await page.getByRole("button", { name: "Approve", exact: true }).first().click();
    await page.getByRole("button", { name: "Approved" }).waitFor();
    check("scene anchor made and approved", true);
    await shot("04-anchors");

    // Segments: split in two (the second continues), prices, queue all; the second waits, then both are chosen.
    await page.getByRole("tab", { name: "Segments" }).click();
    await page.getByRole("button", { name: "Split", exact: true }).click();
    await page.getByRole("listitem", { name: "Segment 2" }).waitFor();
    check("price shown before running", /Placeholder · free/.test(await text()));
    await page.getByRole("button", { name: "Queue all segments" }).click();
    await page.getByText("waits for the segment before").waitFor({ timeout: 20_000 });
    check("the continuing segment waits for the one before", true);
    await page.waitForFunction(() => [...document.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "Chosen").length >= 2, null, { timeout: 150_000 });
    check("both takes made and chosen", true);
    await shot("05-segments");

    // Review: compare, favourite, keep.
    await page.getByRole("tab", { name: "Takes & review" }).click();
    await page.getByRole("button", { name: "Play both from the start" }).waitFor();
    check("two takes side by side", (await page.locator("video").count()) >= 2);
    await page.getByRole("button", { name: "Favourite" }).first().click();
    await page.getByRole("radiogroup", { name: "Take 1 decision" }).first().getByRole("radio", { name: "Keep" }).click();
    await page.getByRole("radiogroup", { name: "Clip decision" }).getByRole("radio", { name: "Keep" }).click();
    await page.getByRole("button", { name: "Unfavourite" }).first().waitFor();
    // The edits save as they're made: read the export once they have.
    const decisionsUrl = `${new URL(projectUrl).pathname.replace("/character-swap/", "/api/swap-studio/projects/")}/decisions`;
    const exported = await page
      .waitForFunction(
        async (u) => {
          const d = await (await fetch(u)).json();
          return d.clips?.[0]?.review === "keep" && d.clips[0].shots[0].segments[0].takes[0].favourite === true && d.clips[0].shots[0].segments[0].takes[0].decision === "keep" ? d : false;
        },
        decisionsUrl,
        { timeout: 15_000, polling: 500 },
      )
      .then((h) => h.jsonValue())
      .catch(() => null);
    const last = exported ?? (await page.evaluate(async (u) => (await fetch(u)).json(), decisionsUrl));
    check("Export decisions: the clip's review and the take's", !!exported, exported ? "" : JSON.stringify(last.clips?.[0]?.shots?.[0]?.segments?.map((g) => g.takes.map((t) => [t.favourite, t.decision]))) + ` review=${last.clips?.[0]?.review}`);
    await shot("06-review");

    // Assemble.
    await page.getByRole("tab", { name: "Assemble" }).click();
    await page.getByRole("button", { name: "Assemble clip" }).click();
    await page.getByRole("link", { name: "Download" }).waitFor({ timeout: 120_000 });
    check("assembled, with a download", true);
    await shot("07-assemble");
    await context.close();
  }

  // ---------------------------------------------------------------------------
  // Every stage at both widths, light and dark: nothing scrolls sideways.
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    for (const scheme of ["light", "dark"]) {
      const tag = `${width} ${scheme}`;
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
      const page = await context.newPage();
      page.setDefaultTimeout(60_000);
      const sideways = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      await page.goto(`${app}/character-swap`, { waitUntil: "load", timeout: 120_000 });
      await page.getByRole("link", { name: "Rain scene" }).waitFor();
      check(`${tag}: projects page, no sideways scroll`, (await sideways()) <= 0, `${await sideways()}px`);
      if (shots) await page.screenshot({ path: path.join(shots, `home-${width}-${scheme}.png`), fullPage: true });
      await page.goto(projectUrl, { waitUntil: "load" });
      await page.getByRole("tab", { name: "Shots" }).waitFor();
      for (const s of STAGES) {
        await page.getByRole("tab", { name: s }).click();
        await page.waitForTimeout(400);
        const over = await sideways();
        check(`${tag}: ${s}, no sideways scroll`, over <= 0, `${over}px`);
        if (shots) await page.screenshot({ path: path.join(shots, `${s.replace(/\W+/g, "-").toLowerCase()}-${width}-${scheme}.png`), fullPage: true });
      }
      await context.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Your GPU (a demo here): the 24 fps copy; Genjutsu's link; a 404.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    const created = await (await fetch(`${app}/api/swap-studio/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "GPU check", engine: "open" }) })).json();
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(walk)], { type: "video/mp4" }), "walk.mp4");
    const up = await (await fetch(`${app}/api/uploads`, { method: "POST", body: form })).json();
    await fetch(`${app}/api/swap-studio/projects/${created.id}/clips`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: up.url, name: "walk.mp4" }) });
    await page.goto(`${app}/character-swap/${created.id}`, { waitUntil: "load" });
    await page.getByText("24 fps copy").first().waitFor();
    check("your GPU: the clip's 24 fps copy is made on import", true);
    await page.getByRole("tab", { name: "Assemble" }).click();
    check("your GPU: where it runs (ComfyUI connection)", /Runs on your ComfyUI/.test(await page.evaluate(() => document.body.innerText)));
    await page.goto(`${app}/genjutsu?mode=character`, { waitUntil: "load" });
    await page.getByRole("link", { name: /Open in Character Swap Studio/ }).waitFor({ timeout: 90_000 });
    check("Genjutsu's Character swap links the studio", true);

    // From Genjutsu with a clip and a character: a new project with both.
    const upload = async (file, type, name) => {
      const f = new FormData();
      f.append("file", new Blob([fs.readFileSync(file)], { type }), name);
      return (await (await fetch(`${app}/api/uploads`, { method: "POST", body: f })).json()).url;
    };
    const gClip = await upload(clipFile, "video/webm", "walk-handoff.webm");
    const gHero = await upload(heroFile, "image/png", "hero.png");
    await page.goto(`${app}/genjutsu?mode=character&video=${encodeURIComponent(gClip)}&image=${encodeURIComponent(gHero)}`, { waitUntil: "load" });
    const open = page.getByRole("button", { name: /Open in Character Swap Studio/ });
    await open.waitFor({ timeout: 90_000 });
    await page.waitForFunction(() => ![...document.querySelectorAll("button")].find((b) => /Open in Character Swap Studio/.test(b.textContent ?? ""))?.disabled, null, { timeout: 30_000 });
    await open.click();
    await page.waitForURL(/\/character-swap\/swap-/, { timeout: 60_000 });
    await page.getByText("Clips · 1").waitFor({ timeout: 60_000 });
    const handedId = page.url().split("/").pop();
    const handed = await (await fetch(`${app}/api/swap-studio/projects/${handedId}`)).json();
    // Named after the clip (Genjutsu's name for an adopted upload is its stored file name).
    check(
      "Genjutsu hands the clip and character to a new studio project",
      handed.project.clips.length === 1 && handed.project.clips[0].source.url === gClip && handed.project.character.image === gHero && handed.project.name === handed.project.clips[0].name,
      `${handed.project.name} · ${handed.project.clips.length} clip`,
    );
    await fetch(`${app}/api/swap-studio/projects/${handedId}`, { method: "DELETE" });

    // An AVI on the cloud: the browser can't play it, so the page gets an H.264 copy (a sample clip in demo mode).
    const avi = path.join(path.dirname(clipFile), "walk.avi");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", walk, "-c:v", "mjpeg", "-q:v", "5", "-c:a", "pcm_s16le", avi]);
    const aviProject = await (await fetch(`${app}/api/swap-studio/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "AVI check", engine: "cloud" }) })).json();
    await page.goto(`${app}/character-swap/${aviProject.id}`, { waitUntil: "load" });
    await page.locator('input[type="file"][accept^="video/"]').setInputFiles(avi);
    await page.getByRole("button", { name: /^walk/ }).waitFor({ timeout: 90_000 });
    await page.getByText(/Your browser can.t play this clip \(AVI\)/).waitFor({ timeout: 30_000 });
    const aviView = await (await fetch(`${app}/api/swap-studio/projects/${aviProject.id}`)).json();
    check("an AVI on the cloud gets a browser copy (fal scale-video)", !!aviView.project.clips[0].preview?.genId && aviView.project.clips[0].source.playable === false);
    const missing = await fetch(`${app}/character-swap/swap-nothing-here`);
    check("an unknown project is a 404", missing.status === 404, String(missing.status));
    await context.close();
  }
} catch (e) {
  check("flow finished", false, String(e?.message ?? e).slice(0, 300));
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} failed` : "\nall ok");
process.exit(failures.length ? 1 : 0);
