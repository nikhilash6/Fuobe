// Skills W7 in a real browser (demo mode: no keys, ComfyUI unreachable). A skill that spans studios is seeded over the
// API ("dub the clip, burn captions into the dub, cut a 9:16 version"), checked for free and run from its Run form: the
// toast says which steps start by themselves and opens the run's progress in the skill's dialog, which shows
// "Dub · running → Captions · waiting → 9:16 cut · waiting" with "Open in Translate & dub", and moves on by itself until
// every step is done. At 1440 and 390 px, light and dark: nothing scrolls sideways; any console error fails the check.
// Usage: node tests/e2e/skills-span.mjs [appUrl] [--shots <dir>]   (app running in demo mode). Exits 1 on a failed check.
import fs from "node:fs";
import path from "node:path";
import { launch, openRoute, root } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const errors = [];
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

const NAME = "e2e-spanish-short";
const clip = await upload("tests/fixtures/shorts-12s.mp4", "video/mp4", "talk.mp4");
await send("DELETE", `/api/assist/skills/${NAME}`);
await send("POST", "/api/assist/skills", { name: NAME, title: "Spanish short", description: "Dub a clip, burn captions into the dub and cut a 9:16 version.", body: "# Spanish short\n\n1. Dub.\n2. Captions.\n3. 9:16 cut." });
const put = await send("PUT", `/api/assist/skills/${NAME}/recipe`, {
  fuobeRecipe: 2,
  params: [
    { id: "video", label: "Clip", type: "video", required: true, example: clip },
    { id: "lang", label: "Language", type: "choice", options: ["Spanish", "German"], default: "Spanish" },
  ],
  steps: [
    { key: "dub", kind: "tool", label: "Dub", tool: "dub_video", input: { video: "{{video}}", languages: ["{{lang}}"], review: false } },
    { key: "captions", kind: "tool", label: "Captions", tool: "add_captions", input: { video: "{{steps.dub.output}}" } },
    { key: "cut", kind: "generate", label: "9:16 cut", request: { feature: "skill", modelId: "ltx-reframe", op: "reframe", inputs: { video: "{{steps.captions.output}}" }, params: { aspectRatio: "9:16" } } },
  ],
  checks: { cut: { kind: "video" } },
});
check("seed: a skill that spans studios saves over the API", put.ok, put.ok ? "" : await put.text());
const verify = await send("POST", `/api/assist/skills/${NAME}/verify`, { level: "demo", engine: "cloud" });
const verified = verify.ok ? await verify.json() : null;
check("seed: its free check passes, studio dry runs included", !!verified?.ok, verified ? JSON.stringify(verified.engines?.[0]?.dryRun) : await verify.text());

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
  let ranFromForm = false;
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    for (const scheme of ["light", "dark"]) {
      const tag = `${width} ${scheme}`;
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
      page.on("console", (m) => m.type() === "error" && errors.push(`${tag}: ${m.text()}`));
      const dialog = page.getByRole("dialog");
      if (!ranFromForm) {
        // Run it from its form: the toast says which steps wait and opens the run's progress.
        await openRoute(page, `${app}/assist/skills?run=${NAME}`);
        check(`${tag}: ?run= opens the Run form`, await seen(dialog.getByRole("heading", { name: "Run Spanish short" })));
        await dialog.locator('input[type="file"][accept*="video"]').first().setInputFiles(path.join(root, "tests/fixtures/shorts-12s.mp4"));
        check(`${tag}: the form is priced before it runs (demo)`, await seen(dialog.getByText(/Placeholder · free/), 30_000));
        await shot(page, `span-form-${width}-${scheme}`);
        await dialog.getByRole("button", { name: /^Run/ }).click();
        check(`${tag}: the toast says the later steps start by themselves`, await seen(page.getByText(/Captions, 9:16 cut start by themselves when the step before is done/), 30_000));
        await page.getByRole("button", { name: "See progress" }).click();
        ranFromForm = true;
      } else {
        await openRoute(page, `${app}/assist/skills?skill=${NAME}`);
      }
      check(`${tag}: the skill's dialog opens`, await seen(dialog.getByRole("heading", { name: "Spanish short" })));
      const runs = dialog.getByRole("region", { name: "Runs" });
      check(`${tag}: its Runs section lists the run's steps in order`, await seen(runs.getByText("9:16 cut")), (await runs.textContent().catch(() => ""))?.slice(0, 160));
      check(`${tag}: a step with a studio page says "Open in Translate & dub"`, await seen(runs.getByRole("link", { name: /Open in Translate & dub/ })));
      await shot(page, `span-runs-${width}-${scheme}`);
      // The run moves on by itself (the server's sweep), and the section follows it.
      const done = await seen(runs.locator("li").first().getByText("Done", { exact: true }), 120_000);
      check(`${tag}: the run ends with every step done`, done, (await runs.locator("li").first().textContent().catch(() => ""))?.slice(0, 200));
      if (done) check(`${tag}: Captions opens in its studio too`, await seen(runs.getByRole("link", { name: /Open in Captions/ })));
      check(`${tag}: nothing scrolls sideways`, await noSideScroll(page));
      await shot(page, `span-done-${width}-${scheme}`);
      await context.close();
    }
  }
} catch (e) {
  failures.push("script");
  console.log(`FAIL the script stopped: ${e.stack ?? e}`);
} finally {
  await browser.close();
}
if (errors.length) console.log(`page errors:\n${errors.join("\n")}`);
console.log(failures.length || errors.length ? `${failures.length} check(s) failed` : "All skills-that-span-studios checks passed");
process.exit(failures.length || errors.length ? 1 : 0);
