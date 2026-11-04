// A scheduled task that runs a saved skill, in a real browser (demo mode: no keys, ComfyUI unreachable). A skill with a recipe is seeded over the API.
// On Scheduled, "Schedule a task" → What to run: A skill → pick it: its inputs come from its Run form, a file input
// starts on "Newest upload (when it runs)" and can take a file instead, and the price shows before saving. Saved, the
// task reads "/<skill> Product photo: your newest image upload · …"; Run now makes a chat whose plan waits for approval
// with the newest upload attached; Edit reopens it in skill mode. At 1440 and 390 px, light and dark: nothing scrolls
// sideways, and no page error (a hydration error included) shows up.
// Placeholder results are switched on for the check and back after it.
// Usage: node tests/e2e/schedule-skill.mjs [appUrl] [--shots <dir>]   (app running in demo mode). Exits 1 on a failed check.
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

// Placeholder results on for this check (a demo run on the mock provider), as they were after it.
const demoBefore = (await (await fetch(`${app}/api/status`)).json()).demoMode;
await send("PUT", "/api/settings", { demoMode: "on" });

const NAME = "e2e-weekly-promo";
const TITLE = "E2E weekly promo";
await send("DELETE", `/api/assist/skills/${NAME}`);
for (const s of (await (await fetch(`${app}/api/assist/schedules`)).json()).items ?? []) if (s.skill?.name === NAME || s.title === TITLE) await send("DELETE", `/api/assist/schedules/${s.id}`);
await send("POST", "/api/assist/skills", { name: NAME, title: TITLE, description: "A promo still from the newest product photo.", body: "# Weekly promo\n\n1. Stage the product." });
const put = await send("PUT", `/api/assist/skills/${NAME}/recipe`, {
  fuobeRecipe: 1,
  params: [
    { id: "product", label: "Product photo", type: "image", required: true },
    { id: "name", label: "Product name", type: "text", required: true, max: 200, example: "Lumen desk lamp" },
  ],
  steps: [{ key: "ad", kind: "generate", label: "Promo", request: { feature: "skill", modelId: "nano-banana-pro", op: "edit", prompt: "{{name}} on a sunlit plinth", inputs: { images: ["{{product}}"] } } }],
});
check("seed: a recipe skill saves over the API", put.ok, put.ok ? "" : await put.text());
// The newest image upload, which a run reads when it starts.
const newest = await upload("public/samples/grade-sample.jpg", "image/jpeg", "newest-product.jpg");

const seen = (locator, ms = 20_000) =>
  locator
    .first()
    .waitFor({ state: "visible", timeout: ms })
    .then(() => true)
    .catch(() => false);
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const shot = (page, name) => shots && page.screenshot({ path: path.join(shots, `${name}.png`) });

const browser = await launch();
const errors = [];
try {
  let saved = false;
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    for (const scheme of ["light", "dark"]) {
      const tag = `${width} ${scheme}`;
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(`${tag}: ${e.message}`));
      page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(`${tag}: ${m.text()}`));
      await openRoute(page, `${app}/assist/scheduled`);
      await page.getByRole("button", { name: /Schedule a task|^New$|^Schedule$/ }).first().click();
      const dialog = page.getByRole("dialog");
      check(`${tag}: the dialog asks what to run`, await seen(dialog.getByRole("radio", { name: "A skill" })));
      await dialog.getByRole("radio", { name: "A skill" }).click();
      // The request's fields go: a skill needs no prompt and no assistant.
      check(`${tag}: skill mode hides the prompt and the assistant`, (await dialog.getByLabel("What should Assist do each time?").count()) === 0 && (await dialog.getByText("Assistant", { exact: true }).count()) === 0);
      await dialog.getByRole("combobox").first().click();
      await page.getByRole("option", { name: new RegExp(TITLE) }).click();
      check(`${tag}: its inputs come from the skill`, await seen(dialog.getByText("Product photo")));
      check(`${tag}: a file input starts on the newest upload`, (await dialog.getByRole("radio", { name: "Newest upload (when it runs)" }).getAttribute("aria-checked")) === "true");
      check(`${tag}: the name follows the skill`, (await dialog.getByLabel("Name", { exact: true }).inputValue()) === TITLE);
      await dialog.getByLabel("Product name").fill("Halo floor lamp");
      check(`${tag}: it's priced before saving (a demo here)`, await seen(dialog.getByText(/Free: a demo run/), 30_000));
      // A picked file instead: the slot appears, then back to the newest upload.
      await dialog.getByRole("radio", { name: "This file" }).click();
      check(`${tag}: "This file" offers a file slot`, await seen(dialog.getByText(/Every run uses this picture/)));
      await shot(page, `schedule-skill-file-${width}-${scheme}`);
      await dialog.getByRole("radio", { name: "Newest upload (when it runs)" }).click();
      await dialog.getByRole("radio", { name: "Ask me first" }).click();
      check(`${tag}: nothing scrolls sideways (dialog)`, await noSideScroll(page));
      await shot(page, `schedule-skill-${width}-${scheme}`);
      if (!saved) {
        await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
        check(`${tag}: it saves ("Scheduled")`, await seen(page.locator("[data-sonner-toast]").getByText("Scheduled", { exact: true })));
        const task = (await (await fetch(`${app}/api/assist/schedules`)).json()).items.find((s) => s.skill?.name === NAME);
        check(`${tag}: the task holds the skill and its values`, !!task && task.skill.values.name === "Halo floor lamp" && task.skill.sources?.product === "newest" && task.prompt === `/${NAME} Product photo: your newest image upload · Product name: Halo floor lamp`, task ? task.prompt : "no task");
        check(`${tag}: the list shows what it runs`, await seen(page.getByText(`/${NAME} Product photo: your newest image upload · Product name: Halo floor lamp`)));
        // Run now: a chat whose plan waits, with the newest upload attached.
        const run = await send("POST", `/api/assist/schedules/${task.id}/run`);
        const { threadId } = await run.json();
        let thread = null;
        for (let i = 0; i < 40 && thread?.thread?.status !== "waiting"; i++) {
          await new Promise((r) => setTimeout(r, 500));
          thread = await (await fetch(`${app}/api/assist/${threadId}`)).json();
        }
        const items = thread?.thread?.items ?? [];
        check(`${tag}: Run now: its plan waits for approval, priced`, items.some((i) => i.role === "approval" && i.status === "pending" && i.summary === TITLE));
        check(`${tag}: Run now: the newest upload is attached`, items.some((i) => i.role === "user" && i.attachments?.[0] === newest));
        await openRoute(page, `${app}/assist?c=${threadId}`);
        check(`${tag}: the chat shows the skill's card`, await seen(page.getByText(TITLE).first()));
        await shot(page, `schedule-skill-chat-${width}-${scheme}`);
        saved = true;
      } else {
        await page.keyboard.press("Escape");
      }
      // Edit reopens a skill task in skill mode.
      await openRoute(page, `${app}/assist/scheduled`);
      await page.getByRole("button", { name: `More for ${TITLE}`, exact: true }).click();
      await page.getByRole("menuitem", { name: /Edit/ }).click();
      const edit = page.getByRole("dialog");
      check(`${tag}: Edit reopens it as a skill`, (await edit.getByRole("radio", { name: "A skill" }).getAttribute("aria-checked")) === "true" && (await seen(edit.getByLabel("Product name"))));
      check(`${tag}: Edit keeps its values`, (await edit.getByLabel("Product name").inputValue()) === "Halo floor lamp");
      check(`${tag}: nothing scrolls sideways (edit)`, await noSideScroll(page));
      await shot(page, `schedule-skill-edit-${width}-${scheme}`);
      await context.close();
    }
  }
} finally {
  await browser.close();
  await send("PUT", "/api/settings", { demoMode: demoBefore === "on" ? "on" : "off" });
}
if (errors.length) console.log(`page errors:\n${errors.join("\n")}`);
check("no page errors", errors.length === 0);
console.log(failures.length ? `\n${failures.length} failed` : "\nall passed");
process.exit(failures.length ? 1 : 0);
