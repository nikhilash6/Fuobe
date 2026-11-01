// Kling 4.0 in the cloud (build package nm10-kling-4), browser check at 1440 and 390 px, light and dark: the Video
// studio's Best list has Kling 4.0 next to Seedance 2.5 with its Top and 30 s badges and its price, the @ menu says its
// elements take no voices yet; a Cinema take on Kling 4.0 runs (demo); Edit video lists Kling 4.0 at its edit rate
// (in + out), says what a 720p clip is billed on before the total, and refuses a clip under 700 px before Generate;
// nothing scrolls sideways.
// Usage: node tests/e2e/kling-4.mjs [appUrl] [--shots <dir>]   (app running in demo mode, ComfyUI unreachable; needs ffmpeg).
// Exits 1 on a failed check.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launch, root } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (
  argv.find(
    (a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots",
  ) ?? "http://localhost:3000"
).replace(/\/$/, "");
const shots = argv.includes("--shots")
  ? argv[argv.indexOf("--shots") + 1]
  : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(
    `${ok ? "ok  " : "FAIL"} ${label.padEnd(76)}${extra ? ` ${extra}` : ""}`,
  );
  if (!ok) failures.push(label);
};

// A 4 s 1280×720 clip Kling 4.0 takes, and the 432×768 fixture it doesn't (under 700 px on a side).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-kling-4-e2e-"));
const clip720 = path.join(tmp, "clip-720p.mp4");
const made = spawnSync("ffmpeg", [
  "-v",
  "error",
  "-y",
  "-f",
  "lavfi",
  "-i",
  "testsrc=size=1280x720:rate=24",
  "-t",
  "4",
  "-pix_fmt",
  "yuv420p",
  clip720,
]);
if (made.status !== 0) throw new Error(`ffmpeg failed: ${made.stderr}`);
const narrow = path.join(root, "scripts/eval/fixtures/walk-6s.mp4");

const browser = await launch();
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    for (const scheme of ["light", "dark"]) {
      const tag = `${width} ${scheme}`;
      const context = await browser.newContext({
        viewport: { width, height },
        colorScheme: scheme,
        ...(width < 500 ? { isMobile: true, hasTouch: true } : {}),
      });
      await context.addInitScript(() => {
        try {
          localStorage.setItem("fuobe.engine", "cloud");
        } catch {}
      });
      const page = await context.newPage();
      const shot = async (name) =>
        shots &&
        (await page.screenshot({
          path: path.join(shots, `${name}-${width}-${scheme}.png`),
        }));
      const sideways = () =>
        page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
      const call = async (url, method = "GET", data) => {
        const r = await page.request.fetch(app + url, {
          method,
          headers: { "Content-Type": "application/json" },
          data: data === undefined ? undefined : JSON.stringify(data),
        });
        return r.json();
      };

      // ---- Video studio: the Best list and the @ menu.
      await page.goto(`${app}/video`, { waitUntil: "load", timeout: 180_000 });
      const chip = page.getByRole("button", { name: /^Model: / }).first();
      await chip.waitFor({ timeout: 120_000 });
      await page.waitForTimeout(800);
      await chip.click();
      const best = page
        .locator("[cmdk-group]")
        .filter({ hasText: /Best/ })
        .first();
      await best.waitFor({ timeout: 15_000 });
      const ids = await best
        .locator("[cmdk-item]")
        .evaluateAll((els) =>
          els.map((e) => (e.getAttribute("data-value") ?? "").split(":")[1]),
        );
      check(
        `${tag}: Best lists Kling 4.0 right after Seedance 2.5`,
        ids.indexOf("kling-4") === ids.indexOf("seedance-2-5") + 1 &&
          ids.includes("kling-4"),
        ids.join(", "),
      );
      const row = page.locator('[cmdk-item][data-value="best:kling-4"]');
      const rowText = await row.innerText();
      check(
        `${tag}: its row shows Top, 30 s and the per-second price`,
        /Top/.test(rowText) &&
          /30 s/.test(rowText) &&
          /\$0\.235\/sec/.test(rowText),
        rowText.replace(/\n/g, " | "),
      );
      await shot("video-picker");
      check(
        `${tag}: no sideways scroll with the picker open`,
        (await sideways()) <= 1,
        `${await sideways()} px`,
      );
      await row.click();
      await page.waitForTimeout(500);
      check(
        `${tag}: Kling 4.0 is picked`,
        /Model: Kling 4\.0/.test(
          (await page
            .getByRole("button", { name: /^Model: / })
            .first()
            .getAttribute("aria-label")) ?? "",
        ),
      );
      const prompt = page.locator("textarea").first();
      await prompt.click();
      await prompt.fill("A lighthouse keeper with @");
      await page.waitForTimeout(400);
      const menu = await page
        .getByRole("listbox")
        .filter({ hasText: /Elements/ })
        .first()
        .innerText()
        .catch(() => "");
      check(
        `${tag}: the @ menu says Kling elements take no voices yet`,
        /voices aren't used/.test(menu),
        menu.replace(/\n/g, " | ").slice(0, 160),
      );
      await shot("video-mention");
      await prompt.fill("");

      // ---- Cinema: a Kling 4.0 take (demo).
      const project = await call("/api/cinema/projects", "POST", {
        name: `Kling 4 ${tag}`,
      });
      await page.goto(`${app}/cinema/${project.id}`, {
        waitUntil: "load",
        timeout: 180_000,
      });
      const scene = page.getByPlaceholder(/Describe your scene/);
      await scene.waitFor({ timeout: 180_000 });
      const engine = page.getByRole("radiogroup", { name: "Engine" });
      const cloud = engine.getByRole("radio", { name: /Cloud/ });
      for (
        let i = 0;
        i < 4 &&
        (await cloud.count()) &&
        (await cloud.getAttribute("aria-checked")) !== "true";
        i++
      ) {
        await cloud.click();
        await page.waitForTimeout(400);
      }
      const modelChip = page
        .getByRole("button", { name: /^Model: / })
        .locator("visible=true")
        .first();
      await modelChip.click();
      const cmenu = page.getByRole("menu");
      await cmenu.waitFor();
      const items = (await cmenu.getByRole("menuitem").allInnerTexts()).map(
        (t) => t.split("\n")[0],
      );
      check(
        `${tag}: Cinema lists Kling 4.0 after Seedance 2.5`,
        items.indexOf("Kling 4.0") === items.indexOf("Seedance 2.5") + 1,
        items.join(", "),
      );
      await cmenu
        .getByRole("menuitem")
        .filter({ hasText: /^Kling 4\.0/ })
        .first()
        .click();
      await cmenu.waitFor({ state: "hidden" });
      await scene.fill(
        "A storm over the bay, the lighthouse beam sweeping the waves",
      );
      await page.waitForTimeout(600);
      await shot("cinema-bar");
      check(
        `${tag}: no sideways scroll in Cinema`,
        (await sideways()) <= 1,
        `${await sideways()} px`,
      );
      const before = (await call(`/api/cinema/projects/${project.id}/items`))
        .items.length;
      await page
        .getByRole("button", { name: /^Generate/ })
        .locator("visible=true")
        .first()
        .click();
      let takes = [];
      for (let i = 0; i < 20 && takes.length <= before; i++) {
        await page.waitForTimeout(750);
        takes = (await call(`/api/cinema/projects/${project.id}/items`)).items;
      }
      check(
        `${tag}: Generate makes a Kling 4.0 take (demo)`,
        takes.length === before + 1 && takes[0]?.modelId === "kling-4",
        takes.map((g) => g.modelId).join(","),
      );

      // ---- Edit video: the edit's rate, what's billed, and the clip limits.
      await page.goto(`${app}/video-edit?model=kling-4`, {
        waitUntil: "load",
        timeout: 180_000,
      });
      const editChip = page.getByRole("button", { name: /^Model: / }).first();
      await editChip.waitFor({ timeout: 120_000 });
      // The link's model applies once the page has hydrated.
      await page
        .waitForFunction(
          () =>
            /Model: Kling 4\.0/.test(
              document
                .querySelector("button[aria-label^='Model: ']")
                ?.getAttribute("aria-label") ?? "",
            ),
          null,
          { timeout: 15_000 },
        )
        .catch(() => {});
      check(
        `${tag}: Edit video opens on Kling 4.0`,
        /Model: Kling 4\.0/.test(
          (await editChip.getAttribute("aria-label")) ?? "",
        ),
        (await editChip.getAttribute("aria-label")) ?? "",
      );
      await editChip.click();
      const editRow = page
        .locator('[cmdk-item][data-value$=":kling-4"]')
        .first();
      await editRow.waitFor({ timeout: 15_000 });
      const editRowText = await editRow.innerText();
      check(
        `${tag}: the picker prices Kling 4.0 as an edit (in + out)`,
        /\$0\.141\/sec in\+out/.test(editRowText),
        editRowText.replace(/\n/g, " | "),
      );
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await page
        .locator('input[type="file"][accept^="video/"]')
        .first()
        .setInputFiles(clip720);
      const line = page.getByText(/in \+ \d+(\.\d)? s out: billed on/);
      const shown = await line
        .first()
        .waitFor({ timeout: 30_000 })
        .then(
          () => true,
          () => false,
        );
      check(
        `${tag}: the clip's billing shows before the total`,
        shown &&
          /4 s in \+ 4 s out: billed on 8 s at \$0\.141\/s/.test(
            await line.first().innerText(),
          ),
        shown ? await line.first().innerText() : "no line",
      );
      await page.locator("textarea").first().fill("Make it snow");
      await page.waitForTimeout(500);
      await shot("edit-video");
      check(
        `${tag}: no sideways scroll in Edit video`,
        (await sideways()) <= 1,
        `${await sideways()} px`,
      );
      // A clip under 700 px on a side: Generate says so instead of running.
      await page
        .getByRole("button", { name: /Remove|Clear/ })
        .filter({ hasText: "" })
        .first()
        .click({ timeout: 3000 })
        .catch(() => {});
      await page
        .locator('input[type="file"][accept^="video/"]')
        .first()
        .setInputFiles(narrow);
      const blocked = await page
        .waitForFunction(
          () =>
            [
              ...document.querySelectorAll("button[aria-label^='Generate']"),
            ].some((b) => /700 px/.test(b.getAttribute("aria-label") ?? "")),
          null,
          { timeout: 30_000 },
        )
        .then(
          () => true,
          () => false,
        );
      check(`${tag}: a 432×768 clip is refused before Generate`, blocked);
      await context.close();
    }
  }
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nall passed");
