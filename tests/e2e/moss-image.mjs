// N7-1 in the browser (no run reaches a GPU or fal): MOSS-Image in the Image studio's model menu on both engines with its
// price ($0.05 per megapixel in the cloud; "on your GPU, about 13 GB of files" and Free on the open engine), its Quality
// setting under Options reached by keyboard (on a phone, Options sits in the Settings sheet), and both rows in Settings →
// Models & licences with their switches on and their licence facts on screen (the cloud row's weights and fal's
// black-image catch shown whole; a cut note opened with "More" from the keyboard). A LoRA run's price is unknown, never
// free (the preview API: no picker attaches a LoRA to MOSS yet). Each page at 1440 and 390 px, light and dark, without
// sideways scroll. The prices follow the server, as /api/status says it runs: without a fal key the cloud runs are free
// demos, and without a reachable ComfyUI so are the open engine's (both "Placeholder · free", as every model in demo mode).
// Usage: node tests/e2e/moss-image.mjs [appUrl] [--shots <dir>] [--fal] [--live]   verify.sh runs it on each of its three
// servers: demo mode, FAL_KEY=anything with --fal for the hosted price ($0.05, unknown with a LoRA), and the live ComfyUI
// with --live for Free on your GPU. --fal and --live each fail the run when the server lacks a fal key or can't reach
// ComfyUI, so those prices are never skipped unseen.
// Nothing is sent: Generate is never pressed. Exits 1 on a failed check.
import fs from "node:fs";
import path from "node:path";
import { launch } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(84)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};
const flat = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const status = await (await fetch(`${app}/api/status`)).json().catch(() => ({}));
const fal = !!status.providers?.fal?.configured;
const comfy = !!status.providers?.comfyui?.configured;
// Placeholder results (Settings, off by default) make every run a free placeholder; with them off, nothing does.
const demo = status.demoMode === "on";
if (!fal) console.log('note: no fal key on this server: the cloud composer shows "Placeholder · free" (start it with FAL_KEY=anything for the hosted price)');
if (!comfy) console.log('note: ComfyUI is unreachable from this server: the open engine shows "Placeholder · free" too (Free once it is reachable)');
if (argv.includes("--fal")) check("server: a fal key is set (--fal), so the hosted price is checked", fal);
if (argv.includes("--live")) check("server: ComfyUI is reachable (--live), so Free on your GPU is checked", comfy);

const browser = await launch();
const contextFor = async (engine, width = 1440, colorScheme = "light") => {
  const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme, ...(width < 500 && { isMobile: true, hasTouch: true }) });
  await context.addInitScript((e) => {
    try {
      localStorage.setItem("fuobe.engine", e);
    } catch {}
  }, engine);
  const page = await context.newPage();
  page.setDefaultTimeout(60_000);
  return { context, page };
};
const composer = (page) => page.locator("[data-composer]").first();
const shoot = (page, name) => (shots ? page.screenshot({ path: path.join(shots, name) }) : undefined);
const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const openStudio = async (page) => {
  await page.goto(`${app}/image`, { waitUntil: "load" });
  await composer(page).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200);
};

try {
  // A LoRA run goes to fal's /lora twin, whose price isn't published: unknown (null), never free.
  const preview = async (loras) =>
    (
      await fetch(`${app}/api/generations?preview=1`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature: "image", modelId: "moss-image", op: "t2i", prompt: 'A neon sign that reads "OPEN"', ...(loras && { loras }) }),
      })
    ).json();
  const plain = await preview();
  const withLora = await preview([{ file: "moss-style.safetensors", url: "https://huggingface.co/example/moss-style/resolve/main/moss-style.safetensors", strength: 0.8 }]);
  if (fal) {
    check("api: a plain MOSS-Image run is priced at $0.05 (1024 × 1024)", plain.costUsd === 0.05 && !plain.demo, JSON.stringify(plain.costUsd));
    check("api: a MOSS-Image run with a LoRA goes to /lora at an unknown price, not free", withLora.costUsd === null && withLora.route?.endpoint === "fal-ai/moss-image/lora", `${JSON.stringify(withLora.costUsd)} ${withLora.route?.endpoint ?? withLora.error ?? ""}`);
  } else if (demo) {
    // No fal key: a free demo run (placeholders), whatever it would cost; the LoRA still picks fal's /lora twin.
    check("api: without a fal key a plain MOSS-Image run is a free demo", plain.demo === true && plain.costUsd === 0, `${JSON.stringify(plain.costUsd)} demo=${plain.demo}`);
    check("api: without a fal key a MOSS-Image run with a LoRA goes to /lora, as a free demo", withLora.demo === true && withLora.costUsd === 0 && withLora.route?.endpoint === "fal-ai/moss-image/lora", `${JSON.stringify(withLora.costUsd)} ${withLora.route?.endpoint ?? withLora.error ?? ""}`);
  }

  for (const width of [1440, 390]) {
    for (const scheme of ["light", "dark"]) {
      const tag = `${width} ${scheme}`;
      for (const [engine, id] of [["cloud", "moss-image"], ["open", "oss-moss-image"]]) {
        const { context, page } = await contextFor(engine, width, scheme);
        await openStudio(page);
        // The model menu, from the keyboard: focus the model button, Enter, type, pick with the arrows.
        const button = page.getByRole("button", { name: /^Model: .*Change model$/ }).first();
        await button.focus();
        await page.keyboard.press("Enter");
        const search = page.getByPlaceholder(/Search (all )?models/);
        await search.waitFor();
        await search.fill("MOSS");
        const row = page.locator(`[cmdk-item][data-value$=":${id}"]`).first();
        await row.waitFor({ timeout: 15_000 });
        const text = flat(await row.innerText());
        if (engine === "cloud") check(`${tag} cloud: the model menu lists MOSS-Image at $0.05 per megapixel`, /MOSS-Image/.test(text) && /\$0\.05\/MP/.test(text), text);
        else check(`${tag} open: the model menu lists MOSS-Image, Free, about 13 GB of files on your GPU`, /MOSS-Image/.test(text) && /\bFree\b/.test(text) && /on your GPU, about 13 GB of files/.test(text), text);
        const box = await row.boundingBox();
        check(`${tag} ${engine}: the row fits the menu`, !!box && box.x >= 0 && box.x + box.width <= width + 1, box ? `${Math.round(box.x)}+${Math.round(box.width)}` : "no box");
        // Arrow keys reach the row; Enter picks it.
        let picked = false;
        for (let i = 0; i < 12 && !picked; i++) {
          picked = (await row.getAttribute("data-selected")) === "true";
          if (!picked) await page.keyboard.press("ArrowDown");
        }
        check(`${tag} ${engine}: the keyboard reaches the MOSS-Image row`, picked);
        await page.keyboard.press("Enter");
        await page.waitForTimeout(900);
        // Words to plan with: the price shows once there is something to run.
        await composer(page).getByRole("textbox").first().fill('A shop window poster that reads "OPEN" in neon');
        await page
          .waitForFunction(() => /\bFree\b|Demo|≈ \$/.test(document.querySelector("[data-composer]")?.textContent ?? ""), null, { timeout: 20_000 })
          .catch(() => {});
        const t = flat(await composer(page).innerText());
        check(`${tag} ${engine}: the composer now runs MOSS-Image`, /MOSS-Image/.test(t), t.slice(0, 100));
        const price = engine === "open" ? (comfy ? /\bFree\b/ : /Demo/) : fal ? /≈ \$0\.05\b/ : /Demo/;
        check(`${tag} ${engine}: its price shows before the run`, price.test(t), (t.match(/Placeholder · free|Demo|≈ \$[\d.]+|\bFree\b/) ?? ["no price"])[0]);
        if (engine === "open") {
          // Quality under Options, from the keyboard; on a phone Options is in the Settings sheet (a popover in a sheet).
          let scope = composer(page);
          if (width < 500) {
            const settings = composer(page).getByRole("button", { name: /^Settings:/ }).first();
            await settings.focus();
            await page.keyboard.press("Enter");
            scope = page.getByRole("dialog").first();
            await scope.waitFor({ timeout: 10_000 });
          }
          const options = scope.getByRole("button", { name: /^Options/ }).first();
          await options.focus();
          check(`${tag} open: the keyboard reaches Options`, await options.evaluate((el) => el === document.activeElement));
          await page.keyboard.press("Enter");
          const quality = page.getByRole("combobox", { name: "Quality" });
          await quality.waitFor({ timeout: 10_000 });
          const qbox = await quality.boundingBox();
          check(`${tag} open: Quality fits the screen`, !!qbox && qbox.x >= 0 && qbox.x + qbox.width <= width + 1, qbox ? `${Math.round(qbox.x)}+${Math.round(qbox.width)}` : "no box");
          check(`${tag} open: Options shows Quality, Auto = Standard · 25 steps`, /Auto · Standard · 25 steps/.test(flat(await quality.innerText())), flat(await quality.innerText()));
          // The words read in full: the text is no wider than the box that shows it (it was cut at "Auto · Standard · 2").
          const cut = () =>
            quality.evaluate((b) => {
              const v = b.querySelector('[data-slot="select-value"]') ?? b;
              const r = document.createRange();
              r.selectNodeContents(v);
              return { text: Math.round(r.getBoundingClientRect().width * 10) / 10, box: Math.round(v.getBoundingClientRect().width * 10) / 10 };
            });
          const before = await cut();
          check(`${tag} open: Quality's Auto · Standard · 25 steps isn't cut off`, before.text <= before.box + 0.5, `${before.text} px of text in ${before.box} px`);
          await quality.focus();
          await page.keyboard.press("Enter");
          const best = page.getByRole("option", { name: "Best · 50 steps" });
          await best.waitFor({ timeout: 10_000 });
          const opts = flat(await page.getByRole("listbox").innerText());
          check(`${tag} open: Quality offers Best · 50 steps and Fast · 8 steps`, /Best · 50 steps/.test(opts) && /Fast · 8 steps/.test(opts), opts);
          // The keyboard picks Best (arrows to it, Enter); the setting says so. Radix Select moves the focus in a timer
          // after each arrow key, so each key waits for that move as a person's next key does: keys sent faster all
          // start from the same option, and Enter then picks the one before Best.
          const focused = () => page.evaluate(() => document.activeElement?.textContent ?? "");
          for (let i = 0; i < 6 && (await best.getAttribute("data-highlighted")) === null; i++) {
            const from = await focused();
            await page.keyboard.press("ArrowDown");
            await page.waitForFunction((f) => (document.activeElement?.textContent ?? "") !== f, from, { timeout: 2_000 }).catch(() => {});
          }
          await page.keyboard.press("Enter");
          await page.waitForTimeout(300);
          check(`${tag} open: Best picked from the keyboard`, /Best · 50 steps/.test(flat(await quality.innerText())), flat(await quality.innerText()));
          const after = await cut();
          check(`${tag} open: Quality's Best · 50 steps isn't cut off`, after.text <= after.box + 0.5, `${after.text} px of text in ${after.box} px`);
          await shoot(page, `moss-options-${width}-${scheme}.png`);
          await page.keyboard.press("Escape");
          await page.keyboard.press("Escape");
          if (width < 500) await page.keyboard.press("Escape");
        }
        check(`${tag} ${engine}: no sideways scroll on the Image studio`, await noSideways(page));
        await shoot(page, `moss-image-${engine}-${width}-${scheme}.png`);
        await context.close();
      }

      // Settings → Models & licences: both rows, switched on, with their licences.
      const { context, page } = await contextFor("cloud", width, scheme);
      await page.goto(`${app}/settings/models`, { waitUntil: "load" });
      const find = page.getByRole("searchbox", { name: "Search names or licences" }).or(page.getByLabel("Search names or licences")).first();
      await find.waitFor({ timeout: 60_000 });
      await find.fill("MOSS");
      await page.waitForTimeout(800);
      for (const [id, want, fact] of [
        ["oss-moss-image", /Apache-2\.0/, /Spectrallic's MOSS-Image SFT 8-step DMD int8 file, Apache-2\.0/],
        ["moss-image", /Paid API · fal\.ai[\s\S]*Weights: Apache-2\.0/, /safety checker returns a black image/],
      ]) {
        const sw = page.locator(`#model-${id}`);
        await sw.waitFor({ timeout: 15_000 });
        const row = sw.locator("xpath=ancestor::li[1]");
        const rowText = flat(await row.innerText());
        check(`${tag} settings: ${id} is listed with its licence`, want.test(rowText), rowText.slice(0, 140));
        // The fact is on screen, not only in a hover title: a note cut at two lines opens with "More" from the keyboard.
        const more = row.getByRole("button", { name: /^More/ });
        if (await more.count()) {
          await more.first().focus();
          await page.keyboard.press("Enter");
          await page.waitForTimeout(200);
          check(`${tag} settings: ${id}'s cut note opens from the keyboard`, (await row.getByRole("button", { name: /^Less/ }).first().getAttribute("aria-expanded")) === "true");
        }
        const shown = await row.evaluate((li, src) => {
          const re = new RegExp(src);
          const p = [...li.querySelectorAll("p")].find((e) => re.test(e.textContent ?? ""));
          if (!p) return "missing";
          const r = p.getBoundingClientRect();
          return p.scrollHeight <= p.clientHeight + 1 && r.width > 0 && r.right <= window.innerWidth + 1 ? "shown" : `cut (${p.scrollHeight} > ${p.clientHeight})`;
        }, fact.source);
        check(`${tag} settings: ${id}'s ${fact.source.slice(0, 40)}… is on screen`, shown === "shown", shown);
        check(`${tag} settings: ${id} starts on`, (await sw.getAttribute("aria-checked")) === "true" || (await sw.getAttribute("data-state")) === "checked");
        // Keyboard: Space flips it, Space flips it back.
        await sw.focus();
        await page.keyboard.press("Space");
        await page.waitForTimeout(500);
        const off = await sw.getAttribute("aria-checked");
        await page.keyboard.press("Space");
        await page.waitForTimeout(500);
        check(`${tag} settings: ${id}'s switch works from the keyboard`, off === "false" && (await sw.getAttribute("aria-checked")) === "true", `${off} → ${await sw.getAttribute("aria-checked")}`);
      }
      check(`${tag} settings: no sideways scroll`, await noSideways(page));
      await shoot(page, `moss-settings-${width}-${scheme}.png`);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
