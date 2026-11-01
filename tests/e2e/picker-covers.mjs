// Picker covers check, in a browser: what the unit tests (tests/picker-covers.test.ts) can't run without one.
// The camera motion and Mix pickers load small posters only and no clip until a tile plays; a hovered clip stops when
// the pointer leaves; the picked motion's clip goes on, without a gap or a restart, when the pointer leaves it.
// Cinema Studio's moves list loads only when shown; a row plays while the pointer rests on it and stops when the
// pointer leaves the list, and the row the arrow keys move to plays.
// Usage: node tests/e2e/picker-covers.mjs [appUrl]   (app must be running; demo mode is fine).
// Exits 1 when a check fails. Playwright and Chromium are found as tests/e2e/_browser.mjs says.
import { DESKTOP, launch } from "./_browser.mjs";

const app = (process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "http://localhost:3000").replace(/\/$/, "");
const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(64)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};

const browser = await launch();
const page = await (await browser.newContext(DESKTOP)).newPage();
page.on("pageerror", (e) => check(`no page error (${e.message.split("\n")[0]})`, false));

/** Posters and clips the page fetched, and the scripts with the pickers' covers code in them. */
const posters = [];
const clips = [];
const coverScripts = [];
page.on("response", async (r) => {
  const u = new URL(r.url());
  if (u.pathname.startsWith("/previews/") && u.pathname.endsWith(".jpg")) {
    const body = await r.body().catch(() => Buffer.alloc(0));
    posters.push({ path: u.pathname, bytes: body.length });
  } else if (u.pathname.endsWith(".js")) {
    // thumbOf's pattern (src/lib/preset-covers.ts): only the pickers' chunks have it.
    if ((await r.text().catch(() => "")).includes("/thumbs/$1")) coverScripts.push(u.pathname);
  }
});
page.on("request", (r) => {
  const u = new URL(r.url());
  if (u.pathname.startsWith("/previews/") && u.pathname.endsWith(".mp4")) clips.push(u.pathname);
});

/** The clips in an open popover: which file (without its version, ?v=), whether it plays, how far in. */
const videos = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-radix-popper-content-wrapper] video")].map((v) => ({
      file: (v.getAttribute("src") ?? "").split("?")[0].split("/").pop(),
      playing: !v.paused,
      t: v.currentTime,
    })),
  );
const until = async (fn, ms) => {
  for (const end = Date.now() + ms; ; await page.waitForTimeout(40)) {
    const v = await fn();
    if (v || Date.now() > end) return v;
  }
};
const playing = (file, ms = 3000) => until(async () => (await videos()).some((v) => v.file === file && v.playing && v.t > 0), ms);
const away = () => page.mouse.move(4, 450);
const kb = (list) => Math.round(list.reduce((s, p) => s + p.bytes, 0) / 1024);
/** Click until `shows` appears: a click before the page hydrates does nothing. */
const open = async (button, shows) => {
  for (let i = 0; i < 30 && !(await shows.isVisible().catch(() => false)); i++) {
    await button.click().catch(() => {});
    await shows.waitFor({ timeout: 2000 }).catch(() => {});
  }
};

let project;
try {
  // The camera motion picker (Video studio).
  await page.goto(`${app}/video`, { waitUntil: "load", timeout: 120_000 });
  const grid = page.locator('[aria-label="Camera motions"]');
  const tile = (name) => grid.locator("button[aria-pressed]", { hasText: new RegExp(`^${name}$`) }).first();
  await page.getByRole("button", { name: "Camera motion" }).waitFor({ timeout: 60_000 });
  posters.length = 0;
  await open(page.getByRole("button", { name: "Camera motion" }), tile("Zoom In"));
  await page.waitForTimeout(1500);
  const opened = posters.splice(0);
  check("motion picker: small posters only", opened.length > 0 && opened.every((p) => p.path.startsWith("/previews/presets/thumbs/")), `${opened.length} posters`);
  check("…well under 300 KB when it opens", kb(opened) < 300, `${kb(opened)} KB`);
  check("…and no clip until a tile plays", clips.length === 0, clips.join(", "));
  await tile("Dolly In").hover();
  check("hovering Dolly In plays its clip", await playing("motion-dolly-in.mp4"));
  await away();
  await page.waitForTimeout(250);
  check("…which goes once the pointer leaves", (await videos()).length === 0, JSON.stringify(await videos()));

  // Picked: it plays when the picker opens again, and goes on when the pointer rests on it and leaves.
  await tile("Zoom In").click();
  await page.waitForTimeout(500);
  if (!(await grid.isVisible().catch(() => false))) await open(page.getByRole("button", { name: "Zoom In", exact: true }).first(), tile("Zoom In"));
  check("the picked motion plays when the picker opens again", await playing("motion-zoom-in.mp4", 4000));
  await tile("Zoom In").hover();
  await page.waitForTimeout(600);
  await away();
  const trace = [];
  for (let i = 0; i < 16; i++) {
    trace.push((await videos()).find((v) => v.file === "motion-zoom-in.mp4")?.t ?? null);
    await page.waitForTimeout(40);
  }
  // Never back to the poster (null): the clip stays mounted and doesn't start over.
  check("…and goes on without a gap when the pointer leaves it", trace.every((t) => t !== null), trace.map((t) => (t === null ? "poster" : t.toFixed(2))).join(" "));
  await page.keyboard.press("Escape");

  // Mix, an effects tab: small posters there too.
  await page.goto(`${app}/video?preset=motion-crash-zoom-in`, { waitUntil: "load", timeout: 120_000 });
  const mix = page.locator('[aria-label="Mix"]');
  await page.getByRole("button", { name: "Mix", exact: true }).waitFor({ timeout: 60_000 });
  await open(page.getByRole("button", { name: "Mix", exact: true }), mix.locator("button[aria-pressed]").nth(5));
  await page.waitForTimeout(1500);
  // Rest on a tile, pick it (Mix stays open), go on to its strength slider: its clip goes on, no gap, no restart.
  const dolly = mix.locator("button[aria-pressed]", { hasText: /^Dolly In$/ }).first();
  await dolly.hover();
  await playing("motion-dolly-in.mp4");
  await dolly.click();
  await page.getByRole("slider", { name: "Dolly In strength" }).hover();
  const picked = [];
  for (let i = 0; i < 16; i++) {
    picked.push((await videos()).find((v) => v.file === "motion-dolly-in.mp4")?.t ?? null);
    await page.waitForTimeout(40);
  }
  check("Mix: a tile picked while it plays goes on when the pointer leaves", picked.every((t) => t !== null), picked.map((t) => (t === null ? "poster" : t.toFixed(2))).join(" "));
  posters.length = 0;
  await mix.getByRole("tab", { name: "Color Grade" }).click();
  await page.waitForTimeout(2000);
  const tab = posters.splice(0);
  check("Mix, Color Grade tab: small posters only, well under 300 KB", tab.length > 0 && tab.every((p) => p.path.includes("/thumbs/")) && kb(tab) < 300, `${tab.length} posters, ${kb(tab)} KB`);
  await page.keyboard.press("Escape");

  // Cinema Studio's moves.
  const res = await page.request.fetch(`${app}/api/cinema/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, data: JSON.stringify({ name: "Picker covers check" }) });
  project = await res.json();
  coverScripts.length = 0;
  await page.goto(`${app}/cinema/${project.id}`, { waitUntil: "load", timeout: 120_000 });
  await page.waitForSelector("text=Your first shot", { timeout: 120_000 });
  await page.waitForTimeout(1500);
  check("Cinema loads no covers code before the moves list shows", coverScripts.length === 0, coverScripts.join(", "));
  await open(page.getByRole("radiogroup", { name: "Mode" }).getByRole("radio", { name: "Video" }), page.getByRole("button", { name: "Add a camera move" }));
  const row = (name) => page.locator("[cmdk-item]", { hasText: name }).first();
  await open(page.getByRole("button", { name: "Add a camera move" }), row("Tilt Up"));
  await page.waitForTimeout(800);
  check("…and loads it with the list", coverScripts.length > 0);
  check("the moves list shows small posters", (await page.locator("[cmdk-list] img").count()) > 0 && (await page.locator("[cmdk-list] img").first().getAttribute("src"))?.includes("/thumbs/"));
  check("…and plays nothing on opening", !(await videos()).some((v) => v.playing));
  await row("Tilt Up").hover();
  check("hovering Tilt Up plays its clip", await playing("motion-tilt-up.mp4"));
  await away();
  await page.waitForTimeout(300);
  check("…which stops once the pointer leaves the list", !(await videos()).some((v) => v.playing), JSON.stringify(await videos()));
  // The arrow keys: the highlighted row plays.
  await page.getByPlaceholder("Search camera moves…").fill("tilt down");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  check("the row the arrow keys move to plays", await playing("motion-tilt-down.mp4"));
  await page.keyboard.press("Escape");
} catch (e) {
  check(`ran to the end (${e.message.split("\n")[0]})`, false);
} finally {
  if (project?.id) await page.request.fetch(`${app}/api/cinema/projects/${project.id}`, { method: "DELETE" }).catch(() => {});
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
