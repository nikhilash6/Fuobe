// Skills W6 in a real browser (demo mode: no keys, ComfyUI unreachable). Three cut-out → scene chains are made over the
// API by hand (the cut-out handed on as the scene's input), so the Library's All view shows "You've made … 3 times. Save
// it as a skill?" under the filters, saying it was made with demo results; Make a skill opens the builder with the
// newest chain. A recipe skill run twice shows a History section in its dialog (runs, success, last run, the runs with
// an Open link to that run in the Library, which shows "One run"). With a step's model switched off in Models &
// licences, the dialog's "Needs a re-check" line offers Suggest a fix, which lists other models with their prices and
// saves the picked one after its free check. Not now takes the card away. At 1440 and 390 px, light and dark: nothing
// scrolls sideways, the card is full width on a phone, and no page logs a console error.
// Usage: node tests/e2e/skills-upkeep.mjs [appUrl] [--shots <dir>]   (app running in demo mode, a fresh data folder).
// Exits 1 on a failed check.
import fs from "node:fs";
import path from "node:path";
import { launch, openRoute, root } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(76)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};
const api = async (method, route, body) => {
  const res = await fetch(app + route, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const out = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${route}: ${res.status} ${JSON.stringify(out)}`);
  return out;
};

async function upload(file, type, name) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(path.join(root, file))], { type }), name);
  const res = await fetch(`${app}/api/uploads`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return (await res.json()).url;
}

/** A generation once it has finished. */
async function finished(id, ms = 60_000) {
  const until = Date.now() + ms;
  for (;;) {
    const g = await api("GET", `/api/generations/${id}`);
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > until) throw new Error(`${id} didn't finish`);
    await new Promise((r) => setTimeout(r, 400));
  }
}

const photo = await upload("public/samples/grade-sample.jpg", "image/jpeg", "lamp.jpg");

// Three chains made by hand: a cut-out, then a scene from the cut-out (Edit, its result handed on).
for (let i = 1; i <= 3; i++) {
  const cut = await api("POST", "/api/generations", { feature: "image", modelId: "birefnet-cloud", op: "bg-remove", inputs: { images: [photo] } });
  const done = await finished(cut.items[0].id);
  // (Another model than the skill's below: a chain a saved skill already has is never suggested.)
  const scene = await api("POST", "/api/generations", { feature: "image", modelId: "seedream-5-pro", op: "edit", prompt: `Lamp ${i} on a travertine plinth`, inputs: { images: [done.outputs[0].url] } });
  await finished(scene.items[0].id);
}

// A recipe skill, checked and run twice.
const NAME = "e2e-upkeep";
await fetch(`${app}/api/assist/skills/${NAME}`, { method: "DELETE" });
await api("POST", "/api/assist/skills", { name: NAME, title: "Upkeep poster", description: "A staged product poster from a product photo.", body: "# Poster\n\n1. Cut out.\n2. Stage." });
await api("PUT", `/api/assist/skills/${NAME}/recipe`, {
  fuobeRecipe: 1,
  params: [
    { id: "product", label: "Product photo", type: "image", required: true, example: photo },
    { id: "name", label: "Product name", type: "text", required: true, example: "Lumen desk lamp", max: 200 },
  ],
  steps: [
    { key: "cutout", kind: "generate", label: "Cut-out", request: { feature: "skill", modelId: "birefnet-cloud", op: "bg-remove", inputs: { images: ["{{product}}"] } } },
    { key: "scene", kind: "generate", label: "Poster", after: ["cutout"], chain: [{ slot: "images", position: "first" }], request: { feature: "skill", modelId: "nano-banana-pro", op: "edit", prompt: "{{name}} on a plinth" } },
  ],
});
await api("POST", `/api/assist/skills/${NAME}/verify`, { level: "plan" });
for (const name of ["Desk lamp", "Floor lamp"]) {
  const r = await api("POST", `/api/assist/skills/${NAME}/run`, { values: { product: photo, name } });
  for (const id of r.runs[0].ids) await finished(id);
}

const seen = (locator, ms = 20_000) =>
  locator
    .first()
    .waitFor({ state: "visible", timeout: ms })
    .then(() => true)
    .catch(() => false);
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const shot = (page, name) => shots && page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: false });

const browser = await launch();
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    for (const scheme of ["light", "dark"]) {
      const tag = `${width} ${scheme}`;
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
      const page = await context.newPage();
      const errors = [];
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      page.on("pageerror", (e) => errors.push(String(e)));

      // The suggestion card, in the Library's All view.
      await openRoute(page, `${app}/library`);
      const card = page.getByRole("region", { name: "A skill to save" });
      check(`${tag}: the Library suggests the chain made 3 times`, await seen(card.getByText(/You've made ‘Background removal → image edit’ 3 times\. Save it as a skill\?/)));
      check(`${tag}: the card says it was made with demo results`, await seen(card.getByText(/Made with demo results so far/)));
      check(`${tag}: the card offers Make a skill, Not now and Don't suggest this`, (await card.getByRole("button", { name: "Make a skill" }).count()) === 1 && (await card.getByRole("button", { name: "Not now" }).count()) === 1 && (await card.getByRole("button", { name: "Don't suggest this" }).count()) === 1);
      const box = await card.boundingBox();
      if (width < 500) check(`${tag}: the card is full width on a phone`, !!box && box.width >= width - 40, box ? `${Math.round(box.width)} px` : "");
      check(`${tag}: the Library doesn't scroll sideways`, await noSideScroll(page));
      await shot(page, `library-card-${width}-${scheme}`);
      // Not in the other views.
      await openRoute(page, `${app}/library?tab=images`);
      check(`${tag}: no card outside All`, (await page.getByRole("region", { name: "A skill to save" }).count()) === 0);

      // The skill's History.
      await openRoute(page, `${app}/assist/skills?skill=${NAME}`);
      const dialog = page.getByRole("dialog");
      check(`${tag}: the skill's dialog shows its History`, await seen(dialog.getByText("History", { exact: true })));
      check(`${tag}: History counts 2 runs, all done`, await seen(dialog.getByText(/^2 runs · 100% succeeded · nothing spent · last /)));
      check(`${tag}: History lists each run with an Open link`, (await dialog.getByRole("link", { name: "Open" }).count()) === 2);
      await dialog.getByText("History", { exact: true }).scrollIntoViewIfNeeded();
      check(`${tag}: the dialog doesn't scroll sideways`, await noSideScroll(page));
      await shot(page, `skill-history-${width}-${scheme}`);
      check(`${tag}: no console errors`, errors.length === 0, errors.slice(0, 2).join(" | "));
      await context.close();
    }
  }

  // The flows, once (1440, light).
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));

  // History → Open shows that run in the Library.
  await openRoute(page, `${app}/assist/skills?skill=${NAME}`);
  await page.getByRole("dialog").getByRole("link", { name: "Open" }).first().click();
  await page.waitForURL(/\/library\?batch=/, { timeout: 20_000 }).catch(() => {});
  check("Open shows the run in the Library (\"One run\")", await seen(page.getByText("One run", { exact: true })));
  // Its two steps (one stack, "Upkeep poster — 2 steps", or its two results), and nothing else.
  const run = await seen(page.getByRole("button", { name: /Upkeep poster/ }), 20_000);
  const others = await page.getByRole("button", { name: /Lamp \d on a travertine plinth/ }).count();
  check("the Library shows that run's results only", run && others === 0, `${others} others`);
  await shot(page, "library-one-run-1440-light");

  // Make a skill opens the builder with the newest chain.
  await openRoute(page, `${app}/library`);
  await page.getByRole("region", { name: "A skill to save" }).getByRole("button", { name: "Make a skill" }).click();
  check("Make a skill opens the builder", await seen(page.getByRole("dialog").getByText(/Background removal|Cut|Image edit/), 30_000));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // Suggest a fix, with a step's model switched off.
  await api("PUT", "/api/settings/models", { changes: [{ kind: "model", id: "nano-banana-pro", on: false }] });
  try {
    await openRoute(page, `${app}/assist/skills?skill=${NAME}`);
    const dialog = page.getByRole("dialog");
    check("the re-check line says the model is switched off", await seen(dialog.getByText(/Needs a re-check: Nano Banana Pro is switched off/)));
    await dialog.getByRole("button", { name: "Suggest a fix" }).click();
    const fix = page.getByRole("dialog", { name: "Suggest a fix" });
    check("Suggest a fix lists models with their prices", await seen(fix.getByText(/Cloud · (Placeholder · free|\$|<\$)/)));
    await shot(page, "suggest-fix-1440-light");
    await fix.getByRole("button", { name: "Check and save" }).first().click();
    check("the picked model is checked and saved", await seen(page.getByText(/Fixed — checked and saved/), 90_000));
    const view = await api("GET", `/api/assist/skills/${NAME}/recipe`);
    check("the step runs on the new model now", view.recipe.steps[1].request.modelId !== "nano-banana-pro", view.recipe.steps[1].request.modelId);
  } finally {
    await api("PUT", "/api/settings/models", { changes: [{ kind: "model", id: "nano-banana-pro", on: true }] });
  }

  // Not now: the card goes, and stays gone.
  await openRoute(page, `${app}/library`);
  await page.getByRole("region", { name: "A skill to save" }).getByRole("button", { name: "Not now" }).click();
  await page.waitForTimeout(800);
  check("Not now takes the card away", (await page.getByRole("region", { name: "A skill to save" }).count()) === 0);
  await openRoute(page, `${app}/library`);
  await page.waitForTimeout(1500);
  check("…and it stays away", (await page.getByRole("region", { name: "A skill to save" }).count()) === 0);
  check("flows: no console errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await context.close();
} finally {
  await browser.close();
  await fetch(`${app}/api/assist/skills/${NAME}`, { method: "DELETE" });
}

console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
