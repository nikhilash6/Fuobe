// nm10-flux3-klein in the browser (no run reaches a GPU or fal): FLUX 3 Klein in the Image studio's model menu on both engines,
// in its "Best for this studio" list on your GPU beside Ideogram 4 and Qwen-Image 2.1, with its price before the run ($0.009 an
// image at 1K in the cloud, Free on your GPU) and its Prompt helper under Options on both engines (saying a layout with boxes
// goes as typed); the Edit studio taking an image and nine references for it (ten in all), and in the cloud following the
// photo's shape (Resolution, no Aspect ratio); the Train dialog's FLUX 3 Klein target ($4.30 for 1,000 steps on fal, Free on your GPU, the
// licence as information); and both rows in Settings → Models & licences, switched on. Each page at 1440 and 390 px, light and
// dark, without sideways scroll. The API prices are checked through the preview route: with a fal key ($0.009 at 1K, $0.048 at
// 2K with a LoRA on the /lora twin), else as fal's "connect" answer.
// Usage: node tests/e2e/flux3-klein.mjs [appUrl] [--shots <dir>]
// Nothing is sent: Generate is never pressed. Exits 1 on a failed check.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { launch } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3440").replace(/\/$/, "");
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
const demo = status.demoMode === "on";

/** A small solid PNG (no fixture needed): `seed` picks its colour. */
function png(seed, w = 64, h = 48) {
  const crc = (buf) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3);
  for (let x = 0; x < w; x++) row.set([(seed * 47) % 256, (seed * 91) % 256, (seed * 13) % 256], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

async function upload(buf, name) {
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "image/png" }), name);
  const res = await fetch(`${app}/api/uploads`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return (await res.json()).url;
}

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
const openStudio = async (page, where) => {
  await page.goto(`${app}/${where}`, { waitUntil: "load" });
  await composer(page).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200);
};
/** Open the model menu from the keyboard; returns its search box. */
const openMenu = async (page) => {
  // On a phone the desktop toolbar's button is in the page but hidden: the visible one.
  const button = page.locator('button[aria-label^="Model: "][aria-label$="Change model"]:visible').first();
  const search = page.getByPlaceholder(/^Search( (all )?models)?/);
  // A page that is still settling (a dev server compiling it) can swallow the first key: try again.
  for (let i = 0; i < 3; i++) {
    await button.waitFor({ state: "visible", timeout: 60_000 });
    await button.focus();
    await page.keyboard.press("Enter");
    if (await search.waitFor({ timeout: 10_000 }).then(() => true, () => false)) return search;
  }
  await search.waitFor();
  return search;
};
/** Pick a model from the open menu by searching for it (arrows, then Enter). */
const pick = async (page, query, id) => {
  const search = page.getByPlaceholder(/^Search( (all )?models)?/);
  await search.fill(query);
  const row = page.locator(`[cmdk-item][data-value$=":${id}"]`).first();
  await row.waitFor({ timeout: 15_000 });
  const text = flat(await row.innerText());
  let picked = false;
  for (let i = 0; i < 12 && !picked; i++) {
    picked = (await row.getAttribute("data-selected")) === "true";
    if (!picked) await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  return { text, picked };
};

try {
  // ---- The prices, through the preview route (what the composer and the server agree on).
  const preview = async (body) => (await fetch(`${app}/api/generations?preview=1`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
  const run = { feature: "image", op: "t2i", prompt: "a fox in snow" };
  const lora = [{ file: "klein-style.safetensors", url: "https://huggingface.co/example/klein-style/resolve/main/klein-style.safetensors", strength: 0.8 }];
  const at1k = await preview({ ...run, modelId: "flux-3-klein", params: { aspectRatio: "1:1", resolution: "1K" } });
  const loras2k = await preview({ ...run, modelId: "flux-3-klein", params: { aspectRatio: "1:1", resolution: "2K" }, loras: lora });
  const local = await preview({ ...run, modelId: "oss-flux3-klein", params: { aspectRatio: "1:1", resolution: "2K" } });
  if (fal) {
    check("api: FLUX 3 Klein at 1K costs $0.009 an image", at1k.costUsd === 0.009 && !at1k.demo, JSON.stringify(at1k.costUsd));
    check("api: with a LoRA at 2K it goes to /lora at $0.012 a megapixel ($0.048)", loras2k.costUsd === 0.048 && loras2k.route?.endpoint === "blackforestlabs/flux-3/klein/text-to-image/lora", `${loras2k.costUsd} ${loras2k.route?.endpoint ?? loras2k.error}`);
  } else if (demo) {
    check("api: without a fal key a FLUX 3 Klein run is a free demo", at1k.demo === true && at1k.costUsd === 0, JSON.stringify(at1k));
  } else {
    check("api: without a fal key the cloud asks to connect fal.ai", /Connect fal\.ai/.test(at1k.error ?? ""), at1k.error ?? JSON.stringify(at1k));
  }
  if (comfy) check("api: on your GPU it is free, on flux3-klein-t2i", local.costUsd === 0 && local.route?.endpoint === "flux3-klein-t2i", `${local.costUsd} ${local.route?.endpoint ?? local.error}`);

  // An element with five photos, for the Train dialog.
  const photos = [];
  for (let i = 0; i < 5; i++) photos.push(await upload(png(i + 1, 640, 640), `klein-ref-${i}.png`));
  const elRes = await fetch(`${app}/api/elements`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Klein Test", kind: "character", references: photos }) });
  const element = await elRes.json();
  check("api: an element to train", elRes.ok && !!element.id, elRes.ok ? element.id : JSON.stringify(element));

  for (const width of [1440, 390]) {
    for (const scheme of ["light", "dark"]) {
      const tag = `${width} ${scheme}`;

      // ---- Image studio, both engines.
      for (const [engine, id] of [["open", "oss-flux3-klein"], ["cloud", "flux-3-klein"]]) {
        const { context, page } = await contextFor(engine, width, scheme);
        await openStudio(page, "image");
        await openMenu(page);
        if (engine === "open") {
          // Best for this studio, on your GPU: Ideogram 4, Qwen-Image 2.1, then FLUX 3 Klein.
          const best = page.locator('[cmdk-group]').filter({ hasText: "Best for this studio" }).first();
          await best.waitFor({ timeout: 15_000 });
          const names = (await best.locator("[cmdk-item]").evaluateAll((els) => els.map((e) => e.getAttribute("data-value") ?? ""))).map((v) => v.split(":").pop());
          // The studio's default leads (Qwen-Image 2.1 when no caption writer is set up for Ideogram 4).
          check(`${tag} open: Best for this studio: Ideogram 4 and Qwen-Image 2.1, then FLUX 3 Klein`, names.slice(0, 2).sort().join(",") === "oss-ideogram-4,oss-qwen-image-21" && names[2] === "oss-flux3-klein", names.join(","));
        }
        const { text, picked } = await pick(page, "Klein", id);
        if (engine === "cloud") check(`${tag} cloud: the menu lists FLUX 3 Klein with its price`, /FLUX 3 Klein/.test(text) && /<\$0\.01\/image|\$0\.009/.test(text), text);
        else check(`${tag} open: the menu lists FLUX 3 Klein, Free on your GPU`, /FLUX 3 Klein/.test(text) && /\bFree\b/.test(text), text);
        check(`${tag} ${engine}: the keyboard reaches the FLUX 3 Klein row`, picked);
        await composer(page).getByRole("textbox").first().fill("A man walking his dog, afternoon sun");
        await page.waitForFunction(() => /\bFree\b|Demo|Placeholder|≈ \$|Connect/.test(document.querySelector("[data-composer]")?.textContent ?? ""), null, { timeout: 20_000 }).catch(() => {});
        const t = flat(await composer(page).innerText());
        check(`${tag} ${engine}: the composer runs FLUX 3 Klein`, /FLUX 3 Klein/.test(t), t.slice(0, 100));
        if (engine === "open") check(`${tag} open: Free before the run`, comfy ? /\bFree\b/.test(t) : /Demo|Placeholder|Free/.test(t), (t.match(/Demo|Placeholder|≈ \$[\d.]+|\bFree\b/) ?? ["no price"])[0]);
        else {
          // fal's $0.009 reads "≈ <$0.01" in the composer.
          const price = /≈ <?\$0\.0\d|Demo|Placeholder|Connect fal/;
          check(`${tag} cloud: its price (or fal's connect step) shows before the run`, price.test(t), (t.match(/Demo|Placeholder|Connect[^.]*|≈ <?\$[\d.]+/) ?? ["no price"])[0]);
        }
        {
          // The Prompt helper under Options on both engines (on a phone, in the Settings sheet).
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
          await page.keyboard.press("Enter");
          const helper = page.getByRole("combobox", { name: "Prompt helper" });
          await helper.waitFor({ timeout: 10_000 });
          const hbox = await helper.boundingBox();
          check(`${tag} ${engine}: Options shows the Prompt helper, on by default, layout boxes named`, /On · full caption \(not with boxes\)/.test(flat(await helper.innerText())), flat(await helper.innerText()));
          // The words read in full: the text is no wider than the box that shows it.
          const cut = await helper.evaluate((b) => {
            const v = b.querySelector('[data-slot="select-value"]') ?? b;
            const r = document.createRange();
            r.selectNodeContents(v);
            return { text: Math.round(r.getBoundingClientRect().width * 10) / 10, box: Math.round(v.getBoundingClientRect().width * 10) / 10 };
          });
          check(`${tag} ${engine}: the Prompt helper's words aren't cut off`, cut.text <= cut.box + 0.5, `${cut.text} px of text in ${cut.box} px`);
          check(`${tag} ${engine}: the Prompt helper fits the screen`, !!hbox && hbox.x >= 0 && hbox.x + hbox.width <= width + 1, hbox ? `${Math.round(hbox.x)}+${Math.round(hbox.width)}` : "no box");
          await shoot(page, `klein-options-${engine}-${width}-${scheme}.png`);
          await page.keyboard.press("Escape");
          await page.keyboard.press("Escape");
          if (width < 500) await page.keyboard.press("Escape");
        }
        check(`${tag} ${engine}: no sideways scroll on the Image studio`, await noSideways(page));
        await shoot(page, `klein-image-${engine}-${width}-${scheme}.png`);
        await context.close();
      }

      // ---- Edit studio on your GPU: the image and nine references.
      {
        const { context, page } = await contextFor("open", width, scheme);
        await openStudio(page, "edit");
        await openMenu(page);
        await pick(page, "Klein", "oss-flux3-klein");
        const inputs = () => composer(page).locator('input[type="file"]');
        await inputs().first().setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png(20, 320, 240) });
        await page.waitForTimeout(800);
        for (let i = 0; i < 9; i++) {
          await inputs().last().setInputFiles({ name: `ref-${i}.png`, mimeType: "image/png", buffer: png(30 + i) });
          await page.waitForTimeout(500);
        }
        await page.waitForFunction(() => !/Uploading/.test(document.querySelector("[data-composer]")?.textContent ?? ""), null, { timeout: 30_000 }).catch(() => {});
        const removable = await composer(page).getByRole("button", { name: /^Remove reference \d+/ }).count();
        check(`${tag} edit: FLUX 3 Klein takes the image and 9 references`, removable === 9, `${removable} references`);
        const addRef = await composer(page).getByText("Add ref", { exact: true }).count();
        check(`${tag} edit: no "Add ref" once ten are in`, addRef === 0, `${addRef}`);
        await composer(page).getByRole("textbox").first().fill("Put the people of the references around a table in the first image");
        await page.waitForTimeout(800);
        const t = flat(await composer(page).innerText());
        check(`${tag} edit: Free on your GPU before the run`, comfy ? /\bFree\b/.test(t) : /Demo|Placeholder|Free/.test(t), (t.match(/Demo|Placeholder|≈ \$[\d.]+|\bFree\b/) ?? ["no price"])[0]);
        check(`${tag} edit: no sideways scroll with ten images`, await noSideways(page));
        await shoot(page, `klein-edit-10-${width}-${scheme}.png`);
        await context.close();
      }

      // ---- Edit studio in the cloud: the result follows the photo's shape, at the Resolution picked (no Aspect ratio).
      {
        const { context, page } = await contextFor("cloud", width, scheme);
        await openStudio(page, "edit");
        await openMenu(page);
        await pick(page, "Klein", "flux-3-klein");
        await composer(page).locator('input[type="file"]').first().setInputFiles({ name: "wide.png", mimeType: "image/png", buffer: png(21, 320, 180) });
        await page.waitForFunction(() => !/Uploading/.test(document.querySelector("[data-composer]")?.textContent ?? ""), null, { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(800);
        const settings = flat(await composer(page).getByRole("button", { name: /^Settings:/ }).first().getAttribute("aria-label"));
        check(`${tag} cloud edit: Resolution without an Aspect ratio (the photo's shape)`, /\b1K\b/.test(settings) && !/\b\d+:\d+\b/.test(settings), settings);
        check(`${tag} cloud edit: no sideways scroll`, await noSideways(page));
        await shoot(page, `klein-edit-cloud-${width}-${scheme}.png`);
        await context.close();
      }

      // ---- The Train dialog: FLUX 3 Klein under More models.
      if (element.id) {
        const { context, page } = await contextFor("open", width, scheme);
        await page.goto(`${app}/elements/${element.id}`, { waitUntil: "load" });
        const train = page.getByRole("button", { name: /^Train$/ }).first();
        await train.waitFor({ timeout: 60_000 });
        await train.click();
        const dialog = page.getByRole("dialog").first();
        await dialog.waitFor();
        const more = dialog.getByRole("button", { name: /More models/ }).first();
        await more.waitFor({ timeout: 20_000 });
        check(`${tag} train: More models names FLUX 3 Klein`, /FLUX 3 Klein/.test(flat(await more.innerText())), flat(await more.innerText()));
        await more.focus();
        await page.keyboard.press("Enter");
        const klein = dialog.getByRole("region", { name: "FLUX 3 Klein" }).or(dialog.locator('section[aria-label="FLUX 3 Klein"]')).first();
        await klein.waitFor({ timeout: 10_000 });
        await klein.scrollIntoViewIfNeeded();
        const k = flat(await klein.innerText());
        check(`${tag} train: Klein Base LoRA on both engines`, /FLUX 3 Image Klein Base LoRA/.test(k), k.slice(0, 120));
        check(`${tag} train: no licence line (Thanks & licences lists it)`, !/Licence:/.test(k), (k.match(/Licence:[^·]*/) ?? [""])[0]);
        check(`${tag} train: Cloud at $4.30, 1,000 steps`, /Cloud \$4\.30/.test(k) && /1,000 steps/.test(k), k.match(/Cloud[^]*?steps/)?.[0]?.slice(0, 120));
        check(`${tag} train: Your GPU is Free`, /Your GPU Free/.test(k));
        const box = await klein.boundingBox();
        check(`${tag} train: the section fits the screen`, !!box && box.x >= 0 && box.x + box.width <= width + 1, box ? `${Math.round(box.x)}+${Math.round(box.width)}` : "no box");
        check(`${tag} train: no sideways scroll`, await noSideways(page));
        await shoot(page, `klein-train-${width}-${scheme}.png`);
        await context.close();
      }

      // ---- Settings → Models & licences: both rows, switched on.
      {
        const { context, page } = await contextFor("cloud", width, scheme);
        await page.goto(`${app}/settings/models`, { waitUntil: "load" });
        const find = page.getByRole("searchbox", { name: "Search names or licences" }).or(page.getByLabel("Search names or licences")).first();
        await find.waitFor({ timeout: 60_000 });
        await find.fill("Klein");
        await page.waitForTimeout(800);
        for (const [id, want] of [
          ["oss-flux3-klein", /FLUX Kommunity License v1\.0/],
          ["flux-3-klein", /Paid API · fal\.ai[\s\S]*Weights: FLUX Kommunity License v1\.0/],
        ]) {
          const sw = page.locator(`#model-${id}`);
          await sw.waitFor({ timeout: 15_000 });
          const row = sw.locator("xpath=ancestor::li[1]");
          const rowText = flat(await row.innerText());
          check(`${tag} settings: ${id} is listed with its licence`, want.test(rowText), rowText.slice(0, 160));
          check(`${tag} settings: ${id} starts on`, (await sw.getAttribute("aria-checked")) === "true" || (await sw.getAttribute("data-state")) === "checked");
        }
        check(`${tag} settings: no sideways scroll`, await noSideways(page));
        await shoot(page, `klein-settings-${width}-${scheme}.png`);
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  if (failures.length) {
    console.log(`\n${failures.length} check(s) failed`);
    process.exitCode = 1;
  } else console.log("\nall checks passed");
}
