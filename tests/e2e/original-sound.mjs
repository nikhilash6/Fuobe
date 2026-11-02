// Browser check of the "Original sound" choice (DBS D7) in Shorts, Mixed Media, Genjutsu and Remove object, and
// Faceless's "Use a clip's soundtrack as the bed".
// Usage: node tests/e2e/original-sound.mjs [appUrl] [outDir]   (the app in demo mode: no keys, no ComfyUI)
// Character Swap Studio's Assemble stage too.
// Checks, at 1440 px and 390 px in light and dark: on the open engine the setting lists Everything, Music & effects only,
// Dialogue only and Lower the music (with its level slider), and Genjutsu's Character swap suggests Music & effects
// only; on the cloud it reads Everything with the line that the other choices run on your GPU; no sideways scroll and
// no console errors. Screenshots go to outDir.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DESKTOP, PHONE, launch, openRoute } from "./_browser.mjs";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const app = args[0] ?? "http://localhost:3000";
const out = args[1] ?? fs.mkdtempSync("/tmp/fuobe-original-sound-");
fs.mkdirSync(out, { recursive: true });

// An 8 s 9:16 video with a tone as its soundtrack.
const mp4 = path.join(out, "sound-source.mp4");
const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=360x640:r=24:d=8", "-f", "lavfi", "-i", "sine=f=330:d=8", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", mp4]);
if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
};
const noSideScroll = async (page, label) => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 0, `${label}: no horizontal scroll (${over}px)`);
};
const setup = async (browser, device, theme, engine) => {
  const ctx = await browser.newContext({ ...device, colorScheme: theme });
  await ctx.addInitScript(([e]) => localStorage.setItem("fuobe.engine", e), [engine]);
  await ctx.route((u) => u.origin !== new URL(app).origin && /^https?:$/.test(u.protocol), (rt) => rt.abort());
  return ctx;
};
const watchErrors = (page, label) => {
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) check(false, `${label}: console error: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => check(false, `${label}: page error: ${e.message.slice(0, 200)}`));
};

const ONLY = process.env.ONLY;
const STUDIOS = [
  { name: "shorts", url: "/shorts", upload: true },
  { name: "mixed-media", url: "/mixed-media", upload: true },
  { name: "genjutsu", url: "/genjutsu", upload: true },
  { name: "remove-object", url: "/video-tools/remove-object", upload: true },
];

const field = (page) => page.getByTestId("original-sound");

const browser = await launch();
try {
  for (const [dname, device] of [
    ["1440", DESKTOP],
    ["390", PHONE],
  ]) {
    for (const theme of ["light", "dark"]) {
      for (const s of STUDIOS.filter((x) => !ONLY || ONLY === x.name)) {
        for (const engine of ["open", "cloud"]) {
          const label = `${s.name} ${engine} ${dname} ${theme}`;
          const ctx = await setup(browser, device, theme, engine);
          const page = await ctx.newPage();
          watchErrors(page, label);
          await openRoute(page, `${app}${s.url}`);
          if (s.upload) await page.locator('input[type="file"][accept*="video"], input[type="file"]').first().setInputFiles(mp4);
          const f = field(page);
          try {
            await f.waitFor({ timeout: 30_000 });
          } catch {
            check(false, `${label}: the Original sound setting shows`);
            await page.screenshot({ path: path.join(out, `${s.name}-${engine}-${dname}-${theme}-missing.png`), fullPage: true });
            await ctx.close();
            continue;
          }
          await f.scrollIntoViewIfNeeded();
          const combo = f.getByRole("combobox");
          check((await combo.innerText()).includes("Everything"), `${label}: starts on Everything`);
          if (engine === "cloud") {
            check(await f.getByText(/run on your GPU \(open source\)\. The cloud puts the whole sound back\./).isVisible(), `${label}: the cloud says the other choices run on your GPU`);
            await combo.click();
            const off = page.getByRole("option", { name: /Dialogue only/ });
            check((await off.getAttribute("aria-disabled")) === "true" || (await off.getAttribute("data-disabled")) !== null, `${label}: Dialogue only is turned off on the cloud`);
            await page.keyboard.press("Escape");
          } else {
            await combo.click();
            for (const o of ["Everything", "Music & effects only", "Dialogue only", "Lower the music"]) check(await page.getByRole("option", { name: new RegExp(o) }).isVisible(), `${label}: offers ${o}`);
            await page.getByRole("option", { name: /Lower the music/ }).click();
            check(await f.getByRole("slider", { name: "Music and effects level" }).isVisible(), `${label}: Lower the music shows its level`);
            check(await f.getByText("−12 dB").isVisible(), `${label}: the level starts at −12 dB`);
          }
          await page.waitForTimeout(400);
          await f.screenshot({ path: path.join(out, `${s.name}-${engine}-${dname}-${theme}.png`) });
          await noSideScroll(page, label);
          await ctx.close();
        }
      }
      // Genjutsu's Character swap suggests Music & effects only on your GPU.
      {
        const label = `genjutsu character open ${dname} ${theme}`;
        const ctx = await setup(browser, device, theme, "open");
        const page = await ctx.newPage();
        watchErrors(page, label);
        await openRoute(page, `${app}/genjutsu?mode=character`);
        const tab = page.getByRole("tab", { name: /Character swap/ }).or(page.getByRole("radio", { name: /Character swap/ })).or(page.getByRole("button", { name: /^Character swap/ }));
        if (await tab.count()) await tab.first().click();
        await page.locator('input[type="file"]').first().setInputFiles(mp4);
        const f = field(page);
        await f.waitFor({ timeout: 30_000 }).catch(() => {});
        if (await f.count()) {
          check((await f.getByRole("combobox").innerText()).includes("Music & effects only"), `${label}: suggests Music & effects only`);
          await f.screenshot({ path: path.join(out, `genjutsu-character-${dname}-${theme}.png`) });
        } else check(false, `${label}: the Original sound setting shows`);
        await noSideScroll(page, label);
        await ctx.close();
      }
    }
  }
  // Faceless: "Use a clip's soundtrack as the bed" under Background music (a channel per engine, made through the API).
  for (const engine of ["open", "cloud"]) {
    const res = await fetch(`${app}/api/faceless/channels`, { method: "POST", headers: { "content-type": "application/json", origin: app }, body: JSON.stringify({ idea: "Tides explained", genre: "education", engine, name: `Tides ${engine}` }) });
    const channel = await res.json();
    if (!res.ok) {
      check(false, `faceless ${engine}: channel made (${res.status} ${channel.error ?? ""})`);
      continue;
    }
    for (const [dname, device] of [
      ["1440", DESKTOP],
      ["390", PHONE],
    ]) {
      for (const theme of ["light", "dark"]) {
        const label = `faceless ${engine} ${dname} ${theme}`;
        const ctx = await setup(browser, device, theme, engine);
        const page = await ctx.newPage();
        watchErrors(page, label);
        await openRoute(page, `${app}/faceless/${channel.id}/new`);
        const bed = page.getByTestId("music-clip");
        if (!(await bed.isVisible().catch(() => false))) {
          const own = page.getByRole("textbox").first();
          await own.fill("Why the sea has two tides a day");
          await page.getByRole("button", { name: /^Next/ }).first().click();
        }
        try {
          await bed.waitFor({ timeout: 20_000 });
        } catch {
          check(false, `${label}: the clip bed setting shows`);
          await page.screenshot({ path: path.join(out, `faceless-${engine}-${dname}-${theme}-missing.png`), fullPage: true });
          await ctx.close();
          continue;
        }
        await bed.scrollIntoViewIfNeeded();
        check(await bed.getByText("Use a clip's soundtrack as the bed").isVisible(), `${label}: names the clip bed`);
        if (engine === "open") {
          check(await bed.getByText(/talking taken out, looped under the voice/).isVisible(), `${label}: says what it does`);
          await bed.locator('input[type="file"]').setInputFiles(mp4).catch(() => {});
          await page.waitForTimeout(3000);
          check(await bed.getByText(/8 s · loops with a soft crossfade/).isVisible().catch(() => false), `${label}: reads the clip's length`);
        } else check(await bed.getByText(/Runs on your GPU \(open source\)/).isVisible(), `${label}: the cloud says it runs on your GPU`);
        await bed.screenshot({ path: path.join(out, `faceless-${engine}-${dname}-${theme}.png`) });
        await noSideScroll(page, label);
        await ctx.close();
      }
    }
  }
  // Character Swap Studio: Assemble suggests Music & effects only on your GPU; the cloud puts back everything.
  for (const engine of ["open", "cloud"]) {
    const created = await (await fetch(`${app}/api/swap-studio/projects`, { method: "POST", headers: { "Content-Type": "application/json", origin: app }, body: JSON.stringify({ name: `Sound ${engine}`, engine }) })).json();
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(mp4)], { type: "video/mp4" }), "walk.mp4");
    const up = await (await fetch(`${app}/api/uploads`, { method: "POST", body: form, headers: { origin: app } })).json();
    await fetch(`${app}/api/swap-studio/projects/${created.id}/clips`, { method: "POST", headers: { "Content-Type": "application/json", origin: app }, body: JSON.stringify({ url: up.url, name: "walk.mp4" }) });
    for (const [dname, device] of [
      ["1440", DESKTOP],
      ["390", PHONE],
    ]) {
      for (const theme of ["light", "dark"]) {
        const label = `swap-studio ${engine} ${dname} ${theme}`;
        const ctx = await setup(browser, device, theme, engine);
        const page = await ctx.newPage();
        watchErrors(page, label);
        await openRoute(page, `${app}/character-swap/${created.id}`);
        await page.getByRole("tab", { name: "Assemble" }).click();
        const f = field(page);
        try {
          await f.waitFor({ timeout: 30_000 });
        } catch {
          check(false, `${label}: the Original sound setting shows`);
          await page.screenshot({ path: path.join(out, `swap-${engine}-${dname}-${theme}-missing.png`), fullPage: true });
          await ctx.close();
          continue;
        }
        await f.scrollIntoViewIfNeeded();
        const shown = await f.getByRole("combobox").innerText();
        check(shown.includes(engine === "open" ? "Music & effects only" : "Everything"), `${label}: starts on ${engine === "open" ? "Music & effects only (suggested)" : "Everything"}`);
        await f.screenshot({ path: path.join(out, `swap-${engine}-${dname}-${theme}.png`) });
        await noSideScroll(page, label);
        await ctx.close();
      }
    }
    await fetch(`${app}/api/swap-studio/projects/${created.id}`, { method: "DELETE", headers: { origin: app } });
  }
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} failed` : "\nAll checks passed");
process.exit(failures.length ? 1 : 0);
