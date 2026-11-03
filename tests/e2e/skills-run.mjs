// Skills W1 in a real browser (demo mode: no keys, ComfyUI unreachable). A skill with a recipe is seeded over the API;
// its card says "Runs by itself"; /assist/skills?run=<name> opens the Run form, which asks for a free test run first,
// then runs it once from the form (a photo, a name, a shape) and three times from pasted CSV rows, each priced first
// ("Placeholder · free" here); a switched-off skill's form says so and switches it back on; the skill's dialog says where it was
// tested, and in amber that it needs a new test run after its route changed, and Test again clears it. ⌘K lists
// "Run <skill>…". At 1440 and 390 px, light and dark: nothing scrolls sideways, and on a phone the form fills the screen.
// Usage: node tests/e2e/skills-run.mjs [appUrl] [--shots <dir>]   (app running in demo mode). Exits 1 on a failed check.
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
const send = (method, route, body) => fetch(app + route, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

async function upload(file, type, name) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(path.join(root, file))], { type }), name);
  const res = await fetch(`${app}/api/uploads`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return (await res.json()).url;
}

const NAME = "e2e-poster";
const photoFile = "public/samples/grade-sample.jpg";
const photo = await upload(photoFile, "image/jpeg", "lamp.jpg");
await send("DELETE", `/api/assist/skills/${NAME}`);
await send("POST", "/api/assist/skills", { name: NAME, title: "E2E Poster", description: "A staged product poster from a product photo.", body: "# Poster\n\n1. Cut the product out.\n2. Stage it." });
const put = await send("PUT", `/api/assist/skills/${NAME}/recipe`, {
  fuobeRecipe: 1,
  params: [
    { id: "product", label: "Product photo", type: "image", required: true, example: photo },
    { id: "name", label: "Product name", type: "text", required: true, example: "Lumen desk lamp", max: 200 },
    { id: "aspect", label: "Shape", type: "choice", options: ["1:1", "9:16", "16:9"], default: "1:1" },
  ],
  steps: [
    { key: "cutout", kind: "generate", label: "Cut-out", request: { feature: "skill", modelId: "birefnet-cloud", op: "bg-remove", inputs: { images: ["{{product}}"] } } },
    {
      key: "scene",
      kind: "generate",
      label: "Poster",
      after: ["cutout"],
      chain: [{ slot: "images", position: "first" }],
      request: { feature: "skill", modelId: "nano-banana-pro", op: "edit", prompt: "{{name}} on a travertine plinth, soft window light", params: { aspectRatio: "{{aspect}}" } },
    },
  ],
});
check("seed: a recipe skill saves over the API", put.ok, put.ok ? "" : await put.text());

/** Generations a run of the skill made (the server's stamp), newest first. */
async function stamped() {
  const r = await (await fetch(`${app}/api/generations?limit=200&steps=1`)).json();
  return r.items.filter((g) => g.request?.skill?.name === NAME);
}

/** Whether a locator shows up within `ms` (the dialog's content loads after it opens). */
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
  let flowsDone = false;
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    for (const scheme of ["light", "dark"]) {
      const tag = `${width} ${scheme}`;
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
      const page = await context.newPage();
      // The card's chip.
      await openRoute(page, `${app}/assist/skills`);
      await page.getByRole("tab", { name: /My skills/ }).click();
      check(`${tag}: the card says "Runs by itself"`, await seen(page.getByText("Runs by itself").first()));

      // The Run form, by its deep link.
      await openRoute(page, `${app}/assist/skills?run=${NAME}`);
      const dialog = page.getByRole("dialog");
      check(`${tag}: ?run= opens the Run form`, await seen(dialog.getByRole("heading", { name: "Run E2E Poster" })));
      if (!flowsDone) {
        // 1. Untested: the form asks for the free test run first, and says nothing runs for real.
        check(`${tag}: it asks for a free test run first`, await seen(dialog.getByText("Do a free test run first.")));
        check(`${tag}: …and says nothing runs for real`, await seen(dialog.getByText(/Nothing runs for real and nothing is spent/)));
        await dialog.getByRole("button", { name: "Test run (free)" }).click();
        const checked = await page
          .getByText(/Test run passed — it runs on Cloud/)
          .first()
          .waitFor({ timeout: 90_000 })
          .then(() => true)
          .catch(() => false);
        check(`${tag}: the test run passes (plan + a free placeholder run)`, checked);
        // 2. One run: a photo, a name, a shape; the price before it starts.
        await dialog.locator('input[type="file"][accept^="image"]').first().setInputFiles(path.join(root, photoFile));
        await dialog.getByLabel("Product name").fill("Arc floor lamp");
        await dialog.getByRole("radio", { name: "16:9" }).click();
        const priced = await dialog
          .getByText(/Placeholder · free/)
          .waitFor({ timeout: 30_000 })
          .then(() => true)
          .catch(() => false);
        check(`${tag}: the form is priced before it runs (demo)`, priced);
        await dialog.getByRole("button", { name: "What runs" }).click();
        check(`${tag}: "What runs" lists both steps`, (await dialog.getByText("Cut-out").count()) > 0 && (await dialog.getByText(/Nano Banana Pro/).count()) > 0);
        await shot(page, `run-form-${width}-${scheme}`);
        const before = (await stamped()).length;
        await dialog.getByRole("button", { name: /^Run/ }).click();
        const started = await page
          .getByText("Started the run")
          .waitFor({ timeout: 30_000 })
          .then(() => true)
          .catch(() => false);
        check(`${tag}: Run starts it ("Started the run")`, started);
        const mine = await stamped();
        const batch = mine.slice(0, mine.length - before);
        check(`${tag}: one run is one batch of 2 steps with the skill's stamp`, batch.length === 2 && new Set(batch.map((g) => g.batchId)).size === 1 && batch.every((g) => g.request.batchTitle === "E2E Poster"), `${batch.length} rows`);
        check(`${tag}: the run took the form's inputs`, batch.some((g) => g.request.prompt === "Arc floor lamp on a travertine plinth, soft window light" && g.request.params?.aspectRatio === "16:9"));
        // 3. Many: three CSV rows, checked, priced together.
        await openRoute(page, `${app}/assist/skills?run=${NAME}`);
        await dialog.getByRole("tab", { name: "Many" }).click();
        await dialog.getByLabel("Rows to run").fill(`Product photo,Product name,Shape\n${photo},Desk lamp,1:1\n${photo},"Lamp, brass",9:16\n${photo},Floor lamp,16:9\n`);
        check(`${tag}: the rows are checked ("3 runs · all fine")`, await seen(dialog.getByText("3 runs · all fine")));
        const total = await dialog
          .getByText(/Placeholder · free · 3 runs/)
          .waitFor({ timeout: 30_000 })
          .then(() => true)
          .catch(() => false);
        check(`${tag}: the rows are priced together`, total);
        await shot(page, `run-many-${width}-${scheme}`);
        const before3 = (await stamped()).length;
        await dialog.getByRole("button", { name: /^Run 3/ }).click();
        const started3 = await page
          .getByText("Started 3 runs")
          .waitFor({ timeout: 30_000 })
          .then(() => true)
          .catch(() => false);
        check(`${tag}: Run 3 starts three runs`, started3);
        const rows = (await stamped()).slice(0, -before3 || undefined);
        check(`${tag}: three runs are three batches`, new Set(rows.map((g) => g.batchId)).size === 3 && rows.length === 6, `${rows.length} rows`);
        // A bad row is said inline, and nothing runs.
        await openRoute(page, `${app}/assist/skills?run=${NAME}`);
        await dialog.getByRole("tab", { name: "Many" }).click();
        await dialog.getByLabel("Rows to run").fill(`product,name\n${photo},Desk lamp\nnot-a-link,Floor lamp\n`);
        check(`${tag}: a bad row is marked inline`, await seen(dialog.getByText(/Product photo: a file from Fuobe/)));
        check(`${tag}: …and the footer says to fix it, with no price`, await seen(dialog.getByText("Fix the rows marked below")));
        // A switched-off skill's form says so (its Run is off), and switches it back on.
        await send("PATCH", `/api/assist/skills/${NAME}`, { enabled: false });
        await openRoute(page, `${app}/assist/skills?run=${NAME}`);
        check(`${tag}: a switched-off skill's form says so`, await seen(dialog.getByText("This skill is switched off")));
        check(`${tag}: …and its Run button is off`, await dialog.getByRole("button", { name: /^Run/ }).isDisabled());
        await dialog.getByRole("button", { name: "Switch it on" }).click();
        check(`${tag}: Switch it on brings the form back`, await seen(dialog.getByText("Runs in the cloud")));
        // 4. Test again: a different route than the one tested (Replicate preferred) needs a new test run, and Test again clears it.
        await send("PUT", "/api/settings", { cloudProvider: "replicate" });
        await openRoute(page, `${app}/assist/skills?skill=${NAME}`);
        const amber = await page
          .getByText(/Needs a new test run:/)
          .first()
          .waitFor({ timeout: 15_000 })
          .then(() => true)
          .catch(() => false);
        check(`${tag}: the skill says it needs a new test run after its route changed`, amber);
        await shot(page, `recheck-${width}-${scheme}`);
        if (amber) {
          await page.getByRole("button", { name: "Test again (free)" }).click();
          const ok = await page
            .getByText(/Test run passed — it still runs/)
            .first()
            .waitFor({ timeout: 90_000 })
            .then(() => true)
            .catch(() => false);
          check(`${tag}: Test again passes and clears it`, ok && (await seen(page.getByText(/Tested \d+ \w+ · Cloud ✓/).first())));
        }
        await send("PUT", "/api/settings", { cloudProvider: "auto" });
        await send("POST", `/api/assist/skills/${NAME}/verify`, { level: "demo" });
        // 5. ⌘K: "Run E2E Poster…".
        await openRoute(page, `${app}/library`);
        await page.keyboard.press("Control+k");
        await page.getByRole("combobox", { name: "Search Fuobe" }).fill("Run E2E");
        const listed = await page
          .getByRole("option", { name: /Run E2E Poster…/ })
          .waitFor({ timeout: 10_000 })
          .then(() => true)
          .catch(() => false);
        check(`${tag}: ⌘K lists "Run E2E Poster…"`, listed);
        if (listed) {
          await page.keyboard.press("Enter");
          await page.waitForURL(/\/assist\/skills\?run=e2e-poster/, { timeout: 15_000 }).catch(() => {});
          check(`${tag}: …and opens its Run form`, await seen(page.getByRole("heading", { name: "Run E2E Poster" })));
        }
        flowsDone = true;
        await openRoute(page, `${app}/assist/skills?run=${NAME}`);
      }
      // Layout: ready to run, at this size and scheme.
      check(`${tag}: the form is ready to run (tested on Cloud)`, await seen(dialog.getByText("Runs in the cloud")));
      const box = await dialog.boundingBox();
      check(`${tag}: the dialog fits the screen`, !!box && box.width <= width + 1 && box.x >= -1, box ? `${Math.round(box.width)}×${Math.round(box.height)}` : "");
      if (width < 500) check(`${tag}: on a phone it fills the screen`, !!box && box.height >= height - 2);
      await dialog.getByRole("tab", { name: "Many" }).click();
      await dialog.getByLabel("Rows to run").fill(`Product photo,Product name,Shape\n${photo},A very long product name that keeps on going and going,16:9\n`);
      check(`${tag}: nothing scrolls sideways`, await noSideScroll(page));
      await shot(page, `layout-${width}-${scheme}`);
      await openRoute(page, `${app}/assist/skills?skill=${NAME}`);
      check(`${tag}: the skill's dialog offers Run… and the .zip`, await seen(page.getByRole("button", { name: "Run…" })));
      await page.getByRole("button", { name: /Download/ }).click();
      check(`${tag}: …Download offers SKILL.md and the .zip`, await seen(page.getByRole("menuitem", { name: "Skill with its files (.zip)" })));
      await page.keyboard.press("Escape");
      check(`${tag}: the skill's dialog doesn't scroll sideways`, await noSideScroll(page));
      await shot(page, `detail-${width}-${scheme}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  await send("PUT", "/api/settings", { cloudProvider: "auto" });
  // Other checks (the Assist flows) expect My skills to start empty.
  await send("DELETE", `/api/assist/skills/${NAME}`);
}
console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
