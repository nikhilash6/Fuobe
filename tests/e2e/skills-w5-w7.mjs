// Skills W5 to W7 in a real browser (demo mode: no keys, ComfyUI unreachable), at 1440 and 390 px, light and dark:
// - W5: Canvas → Skills as canvases lists a skill that runs by itself and opens it as a canvas; the canvas menu has Save as skill…,
//   which opens the review screen with the canvas's steps.
// - W6: three runs of the same chain offer it as a skill above the Library (Make a skill, Not now, Don't suggest this),
//   and a skill's dialog shows its History.
// - W7: a skill whose steps wait across studios shows each step's progress in its dialog.
// A visitor (public sign-up) sees no suggestion, no history and no skills on the Canvas page. Nothing scrolls sideways.
// (A scheduled task that runs a skill, W4, has its own check: tests/e2e/schedule-skill.mjs.)
// Usage: node tests/e2e/skills-w5-w7.mjs [appUrl] [--shots <dir>]   (app running with FUOBE_DEMO_MODE=on). Exits 1 on a failed check.
//   E2E_OWNER_PASSWORD: the studio's password, when it has one (the owner's checks sign in with it, and the guest's
//   checks run too: start the app with FUOBE_PASSWORD and FUOBE_PUBLIC_SIGNUP=1).
import fs from "node:fs";
import path from "node:path";
import { launch, openRoute, root } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(80)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};
const PASSWORD = process.env.E2E_OWNER_PASSWORD;
let ownerCookie = "";
if (PASSWORD) {
  const res = await fetch(`${app}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: PASSWORD }) });
  ownerCookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  if (!res.ok || !ownerCookie) throw new Error(`couldn't sign in as the owner: ${res.status}`);
}
/** The owner's requests (signed in when the studio has a password). */
const ownerFetch = (url, init = {}) => fetch(url, { ...init, headers: { ...init.headers, ...(ownerCookie && { cookie: ownerCookie }) } });
const send = (method, route, body) => ownerFetch(app + route, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (method, route, body) => {
  const r = await send(method, route, body);
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
};

async function upload(file, type, name) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(path.join(root, file))], { type }), name);
  const res = await ownerFetch(`${app}/api/uploads`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return (await res.json()).url;
}

async function settled(ids, ms = 120_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const all = await Promise.all(ids.map(async (id) => (await (await ownerFetch(`${app}/api/generations/${id}`)).json()).status));
    if (all.every((s) => ["succeeded", "failed", "canceled"].includes(s))) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Seed

const photo = await upload("public/samples/grade-sample.jpg", "image/jpeg", "lamp.jpg");
const clip = await upload("public/samples/demo-landscape.mp4", "video/mp4", "talk.mp4");
const POSTER = "e2e-w4-poster";
const SHORT = "e2e-w7-short";
for (const n of [POSTER, SHORT]) await send("DELETE", `/api/assist/skills/${n}`);
await send("POST", "/api/assist/skills", { name: POSTER, title: "E2E Poster", description: "A product poster from a product photo.", body: "# Poster" });
const put = await json("PUT", `/api/assist/skills/${POSTER}/recipe`, {
  fuobeRecipe: 1,
  params: [
    { id: "product", label: "Product photo", type: "image", required: true, example: photo },
    { id: "name", label: "Product name", type: "text", required: true, example: "Lumen desk lamp", max: 200 },
  ],
  steps: [
    { key: "cutout", kind: "generate", label: "Cut-out", request: { feature: "skill", modelId: "birefnet-cloud", op: "bg-remove", inputs: { images: ["{{product}}"] } } },
    { key: "scene", kind: "generate", label: "Poster", after: "cutout", chain: [{ slot: "images" }], request: { feature: "skill", modelId: "nano-banana-pro", op: "edit", prompt: "{{name}} on a travertine plinth" } },
  ],
});
check("seed: a recipe skill saves", put.ok, put.ok ? "" : JSON.stringify(put.body));
await json("POST", `/api/assist/skills/${POSTER}/verify`, { level: "plan" });
const run = await json("POST", `/api/assist/skills/${POSTER}/run`, { values: { product: photo, name: "Halo lamp" }, engine: "cloud" });
check("seed: the skill runs once (its History)", run.ok, run.ok ? "" : JSON.stringify(run.body));
if (run.ok) await settled(run.body.runs[0].ids);

await send("POST", "/api/assist/skills", { name: SHORT, title: "E2E Spanish short", description: "Dub, caption and cut a clip.", body: "# Short" });
const staged = await json("PUT", `/api/assist/skills/${SHORT}/recipe`, {
  fuobeRecipe: 2,
  params: [{ id: "clip", label: "Clip", type: "video", required: true, example: clip }],
  steps: [
    { key: "dub", label: "Dub", kind: "tool", tool: "dub_video", input: { video: "{{clip}}", languages: ["Spanish"], lipsync: false, review: false } },
    { key: "captions", label: "Captions", kind: "tool", tool: "add_captions", input: { video: "{{steps.dub.output}}" } },
    { key: "cut", label: "9:16 cut", kind: "generate", request: { feature: "skill", modelId: "scale-video", op: "reframe", inputs: { video: "{{steps.captions.output}}" }, params: { aspectRatio: "9:16" } } },
  ],
});
check("seed: a skill that waits across studios saves", staged.ok, staged.ok ? "" : JSON.stringify(staged.body));
await json("POST", `/api/assist/skills/${SHORT}/verify`, { level: "plan", engine: "cloud" });
const stagedRun = await json("POST", `/api/assist/skills/${SHORT}/run`, { values: { clip }, engine: "cloud" });
check("seed: it starts the dub and waits with the rest", stagedRun.ok && stagedRun.body.runs[0].waiting?.length === 2, JSON.stringify(stagedRun.body?.runs?.[0]?.waiting ?? stagedRun.body));

// Three runs of the same chain (cut-out → still → clip) through MCP's generate, with other words each time.
for (const w of ["a lamp", "a vase", "a chair"]) {
  const r = await json("POST", "/api/mcp", {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "generate",
      arguments: {
        summary: `Turntable of ${w}`,
        jobs: [
          { model_id: "birefnet-cloud", op: "bg-remove", prompt: "", images: [photo] },
          { model_id: "nano-banana-pro", op: "edit", prompt: `${w} on a plinth`, after: 0 },
          { model_id: "kling-3", op: "i2v", prompt: `${w} turning`, after: 1, duration: 5 },
        ],
        engine: "cloud",
      },
    },
  });
  const text = r.body?.result?.content?.[0]?.text ?? "";
  const ids = [...text.matchAll(/"([\w-]{12})"/g)].map((m) => m[1]);
  check(`seed: a chain for ${w} starts`, r.ok && ids.length > 0, r.ok ? "" : JSON.stringify(r.body));
  if (ids.length) await settled([...new Set(ids)]);
}

// ---------------------------------------------------------------------------
// The browser

const seen = (locator, ms = 20_000) =>
  locator
    .first()
    .waitFor({ state: "visible", timeout: ms })
    .then(() => true)
    .catch(() => false);
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const shot = (page, name) => shots && page.screenshot({ path: path.join(shots, `${name}.png`) });

const browser = await launch();
try {
  for (const scheme of ["light", "dark"]) {
    for (const [width, height] of [
      [1440, 900],
      [390, 844],
    ]) {
      const tag = `${width}-${scheme}`;
      const phone = width < 600;
      const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, ...(phone && { isMobile: true, hasTouch: true }) });
      if (PASSWORD) await ctx.request.post(`${app}/api/auth/login`, { data: { password: PASSWORD } });
      const page = await ctx.newPage();

      // W6 + W7: the skill's History, and the run that waits across studios.
      await openRoute(page, `${app}/chat/skills?skill=${POSTER}`);
      check(`${tag} history: the skill's runs show in its dialog`, await seen(page.getByRole("dialog").getByText(/\b\d+ runs?\b/)));
      await shot(page, `history-${tag}`);
      await openRoute(page, `${app}/chat/skills?skill=${SHORT}`);
      check(`${tag} runs in stages: each step's progress shows`, await seen(page.getByRole("dialog").locator("[data-skill-run]")));
      check(`${tag} runs in stages: the steps are named`, await seen(page.getByRole("dialog").getByText(/Captions ·/)));
      check(`${tag} history: nothing scrolls sideways`, await noSideScroll(page));
      await shot(page, `run-steps-${tag}`);

      // W6: the suggestion above the Library.
      await openRoute(page, `${app}/library`);
      const card = page.locator("[data-skill-suggestion]");
      check(`${tag} library: a chain made 3 times is offered as a skill`, await seen(card, 30_000));
      check(`${tag} library: Make a skill, Not now and Don't suggest this`, (await card.getByRole("button").count()) === 3);
      check(`${tag} library: nothing scrolls sideways`, await noSideScroll(page));
      await shot(page, `suggestion-${tag}`);
      await card.getByRole("button", { name: /Make a skill/ }).click();
      check(`${tag} library: Make a skill opens the review screen`, await seen(page.getByRole("dialog").getByText("Make a skill")));
      await page.keyboard.press("Escape");

      // W5: Canvas → Skills as canvases, Open as canvas, then Save as skill… from its menu.
      await openRoute(page, `${app}/canvas?tab=skills`);
      check(`${tag} canvas: Skills as canvases lists the skill`, await seen(page.locator("[data-skill-canvases]").getByText("E2E Poster")));
      check(`${tag} canvas: a skill a canvas can't hold says why`, await seen(page.getByText(/This skill can't be drawn yet/)));
      check(`${tag} canvas: nothing scrolls sideways`, await noSideScroll(page));
      await shot(page, `canvas-skills-${tag}`);
      if (!phone) {
        await page.locator("article", { hasText: "E2E Poster" }).getByRole("button", { name: /Open as canvas/ }).click();
        await page.waitForURL(/\/canvas\/[\w-]+$/, { timeout: 30_000 });
        check(`${tag} canvas: Open as canvas draws its steps`, await seen(page.getByText("Poster").first()));
        await page.getByRole("button", { name: "More run options" }).click();
        await page.getByRole("menuitem", { name: /Save as skill/ }).click();
        check(`${tag} canvas: Save as skill… opens the review screen`, await seen(page.getByRole("dialog").getByText(/From this canvas/)));
        await shot(page, `canvas-save-skill-${tag}`);
        await page.keyboard.press("Escape");
      }
      await ctx.close();
    }
  }

  // A visitor under public sign-up: the owner's suggestions, history and run steps stay the owner's.
  if (PASSWORD) {
    const guest = await fetch(`${app}/api/skill-suggestions`).then((r) => r.json());
    check("guest: no skill suggestions", Array.isArray(guest.items) && guest.items.length === 0, JSON.stringify(guest));
    const history = await fetch(`${app}/api/assist/skills/${POSTER}/history`);
    check("guest: a skill's history is refused", !history.ok, String(history.status));
    const dismiss = await fetch(`${app}/api/skill-suggestions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "x", how: "never" }) });
    check("guest: dismissing a suggestion is refused", !dismiss.ok, String(dismiss.status));
    for (const scheme of ["light", "dark"]) {
      for (const [width, height] of [
        [1440, 900],
        [390, 844],
      ]) {
        const tag = `guest-${width}-${scheme}`;
        const phone = width < 600;
        const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, ...(phone && { isMobile: true, hasTouch: true }) });
        const page = await ctx.newPage();
        await openRoute(page, `${app}/library`, { settleMs: 2500 });
        check(`${tag} library: no skill suggestion`, (await page.locator("[data-skill-suggestion]").count()) === 0);
        check(`${tag} library: nothing scrolls sideways`, await noSideScroll(page));
        await shot(page, `guest-library-${tag}`);
        await openRoute(page, `${app}/canvas?tab=skills`, { settleMs: 2500 });
        check(`${tag} canvas: the page opens`, await seen(page.locator("main").first()));
        check(`${tag} canvas: no skills for a visitor`, (await page.locator("[data-skill-canvases], #skills").count()) === 0);
        check(`${tag} canvas: no Open as canvas for a visitor`, (await page.getByRole("button", { name: /Open as canvas/ }).count()) === 0);
        check(`${tag} canvas: nothing scrolls sideways`, await noSideScroll(page));
        await shot(page, `guest-canvas-skills-${tag}`);
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
}

// Leave the studio as it was found.
for (const n of [POSTER, SHORT]) await send("DELETE", `/api/assist/skills/${n}`);

console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
