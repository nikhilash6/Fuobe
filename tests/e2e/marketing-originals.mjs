// Build plan O10, browser check in demo mode: the Originals are the first choice on both engines and partners stay
// choices — Marketing Studio's model menu (Fuobe Marketing Image), Ads Studio's "Pictures by" (and its price line),
// the AI Influencer builder (Fuobe Soul), Photodump's model chips (Qwen-Image-Edit 2511 hosted), Fashion Factory's
// outfit and photoset steps (Fuobe Try-On, Qwen-Image-Edit 2511; the next model when the try-on LoRA is switched off)
// and the try-on LoRA's row in Settings → Models & licences. Then each page at 1440 and 390 px, light and dark, without
// sideways scroll.
// Usage: node tests/e2e/marketing-originals.mjs [appUrl] [--shots <dir>]   (app in demo mode, ComfyUI unreachable).
// Exits 1 on a failed check.
import fs from "node:fs";
import path from "node:path";
import { launch, root } from "./_browser.mjs";

const argv = process.argv.slice(2);
const app = (argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--shots") ?? "http://localhost:3000").replace(/\/$/, "");
const shots = argv.includes("--shots") ? argv[argv.indexOf("--shots") + 1] : undefined;
if (shots) fs.mkdirSync(shots, { recursive: true });

const failures = [];
const check = (label, ok, extra = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label.padEnd(72)}${extra ? ` ${extra}` : ""}`);
  if (!ok) failures.push(label);
};

async function upload(file, type, name) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(path.join(root, file))], { type }), name);
  const res = await fetch(`${app}/api/uploads`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return (await res.json()).url;
}
const post = async (url, body, method = "POST") => {
  const res = await fetch(`${app}${url}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`);
  return res.json();
};

// A brand with a product, and a character: what Ads Studio and Fashion Factory need.
const productImage = await upload("scripts/eval/fixtures/start-frame.png", "image/png", "product.png");
const face = await upload("scripts/eval/fixtures/character/drawn-face-1.png", "image/png", "face.png");
const brand = await post("/api/brands", { description: "Ember & Oat — small-batch granola roasted in Portland", name: "Ember & Oat" });
await post("/api/products", { name: "Maple Granola", brandId: brand.id, images: [productImage] });
const character = await post("/api/elements", { name: "Ines", kind: "character", references: [face] });

const engines = ["cloud", "open"];
const browser = await launch();
try {
  const contextFor = async (engine, viewport, colorScheme, fashion) => {
    const context = await browser.newContext({ viewport, colorScheme });
    await context.addInitScript(
      ([e, f]) => {
        try {
          localStorage.setItem("fuobe.engine", e);
          if (f) localStorage.setItem("fuobe.fashion", JSON.stringify(f));
        } catch {}
      },
      [engine, fashion ?? null],
    );
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    return { context, page };
  };
  const text = (page) => page.evaluate(() => document.body.innerText);
  const noSideways = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  const fashionAt = { step: "clothing", templateId: "red-room", elementId: character.id, baseIds: [], base: productImage, outfitIds: [], outfit: productImage };
  const radios = (page, name) => page.getByRole("radiogroup", { name }).getByRole("radio").allInnerTexts();

  // ---------------------------------------------------------------------------
  // The flows, once per engine (1440 light).
  for (const engine of engines) {
    const { context, page } = await contextFor(engine, { width: 1440, height: 900 }, "light", fashionAt);
    // Marketing Studio: the model menu.
    await page.goto(`${app}/marketing`, { waitUntil: "load", timeout: 180_000 });
    await page.getByRole("button", { name: /^Settings:/ }).first().click();
    const panel = page.getByRole("dialog").last();
    await panel.getByText("Fuobe Marketing Image").first().waitFor();
    const models = (await panel.innerText()).split("\n");
    const first = models.findIndex((l) => /Fuobe Marketing Image|GPT Image|Nano Banana|Bria|Ideogram|Recraft|Product Photography/.test(l));
    // The page opens on Standalone: in the cloud its recipe runs on your GPU only, so the Original is listed last, greyed,
    // with that line, and a partner is the first pick (the 2026-10-30 rule).
    if (engine === "open") check("open: Marketing Studio's first model is Fuobe Marketing Image", models[first] === "Fuobe Marketing Image", models[first]);
    else {
      check("cloud: Standalone's first model is a partner, not the Original", models[first] !== "Fuobe Marketing Image", models[first]);
      check("cloud: Standalone lists the Original as running on your GPU only", models.includes("Fuobe Original · runs on your GPU only: its cut-out and studio relight aren't offered in the cloud") && (await panel.locator('[aria-disabled="true"]').count()) === 1);
    }
    check(`${engine}: partner models ${engine === "cloud" ? "stay" : "aren't"} in the menu`, engine === "cloud" ? models.some((l) => /GPT Image 2\.5/.test(l)) : !models.some((l) => /GPT Image/.test(l)));
    await page.keyboard.press("Escape");

    // Ads Studio: New ads.
    await page.goto(`${app}/ads/${brand.id}?step=new`, { waitUntil: "load" });
    await page.getByText(/Create \d+ ads? for/).first().waitFor();
    await page.waitForFunction(() => /Fuobe Marketing Image ·|Fuobe Marketing Image$/m.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => {});
    const ads = await text(page);
    check(`${engine}: Ads Studio prices its pictures on Fuobe Marketing Image`, /Fuobe Marketing Image/.test(ads));
    if (engine === "cloud") {
      check("cloud: Ads Studio offers Nano Banana Pro and GPT Image 2.5 as choices", await page.getByLabel("Pictures by").isVisible());
      await page.getByLabel("Pictures by").click();
      const options = await page.getByRole("option").allInnerTexts();
      check("cloud: the picture menu lists the Original first", options[0] === "Fuobe Marketing Image" && options.includes("Nano Banana Pro") && options.includes("GPT Image 2.5"), options.join(" | "));
      await page.getByRole("option", { name: "Nano Banana Pro" }).click();
      await page.waitForFunction(() => /Nano Banana Pro ·/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => {});
      check("cloud: picking Nano Banana Pro reprices the batch on it", /Nano Banana Pro ·/.test(await text(page)));
    } else {
      check("open: no partner menu on your GPU", !(await page.getByLabel("Pictures by").count()));
    }

    // The AI Influencer builder (the engine comes from this browser's storage once the page hydrates).
    await page.goto(`${app}/influencer`, { waitUntil: "load" });
    await page.getByRole("heading", { level: 1 }).first().waitFor();
    if (engine === "cloud") {
      await page.locator("#ib-model").waitFor();
      await page.waitForFunction(() => /Runs on Fuobe Soul/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => {});
      const model = await page.locator("#ib-model").innerText();
      check("cloud: the influencer sheet defaults to Fuobe Soul, priced on it", /Fuobe Soul/.test(model) && /Runs on Fuobe Soul/.test(await text(page)), model);
      check("cloud: its note says the face and clothing go on with Qwen-Image-Edit 2511", /Qwen-Image-Edit 2511/.test(await text(page)));
    } else {
      await page.waitForFunction(() => /Fuobe Soul on your GPU/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => {});
      check("open: the influencer sheet is Fuobe Soul on your GPU, free", /Fuobe Soul on your GPU/.test(await text(page)) && /Free on your GPU/.test(await text(page)));
    }

    // Photodump: the model chips of a pack.
    await page.goto(`${app}/photodump`, { waitUntil: "load" });
    await page.getByRole("button", { name: /Winter special/i }).first().dblclick();
    await page.getByRole("radiogroup", { name: "Model" }).waitFor();
    const chips = await page.getByRole("radiogroup", { name: "Model" }).getByRole("radio").allInnerTexts();
    check(`${engine}: Photodump offers Qwen-Image-Edit 2511 next to Fuobe Soul`, chips.includes("Qwen-Image-Edit 2511") && chips.some((c) => /Fuobe Soul/.test(c)), chips.join(" | "));
    if (engine === "cloud") check("cloud: Nano Banana Pro and Seedream stay Photodump choices", chips.includes("Nano Banana Pro") && chips.includes("Seedream 5.0 Pro"));

    // Fashion Factory: the outfit step.
    await page.goto(`${app}/fashion-factory`, { waitUntil: "load" });
    await page.getByRole("heading", { name: "Upload outfit" }).waitFor();
    await page.getByRole("radiogroup", { name: "Outfit model" }).waitFor();
    const outfit = await radios(page, "Outfit model");
    const on = await page.getByRole("radio", { name: "Fuobe Try-On" }).getAttribute("aria-checked");
    if (engine === "cloud") {
      check("cloud: Fashion Factory's outfit runs on Fuobe Try-On, FASHN and Nano Banana Pro after it", outfit[0] === "Fuobe Try-On" && on === "true" && outfit.includes("FASHN Try-On"), outfit.join(" | "));
      const set = await radios(page, "Photoset model");
      check("cloud: the photoset runs on Qwen-Image-Edit 2511, Nano Banana Pro a choice", set[0] === "Qwen-Image-Edit 2511" && set.includes("Nano Banana Pro"), set.join(" | "));
    } else {
      check("open: the outfit runs on Fuobe Try-On, Qwen-Image-Edit 2511 after it", outfit[0] === "Fuobe Try-On" && on === "true" && outfit.includes("Qwen-Image-Edit 2511"), outfit.join(" | "));
      check("open: one photoset model on your GPU, no menu", !(await page.getByRole("radiogroup", { name: "Photoset model" }).count()));
    }
    await context.close();
  }

  // The try-on LoRA switched off: Fuobe Try-On can't run, so the outfit step starts on the next model on each engine.
  await post("/api/settings/models", { changes: [{ kind: "lora", id: "tryon-klein-4b.safetensors", on: false }] }, "PUT");
  try {
    for (const engine of engines) {
      const { context, page } = await contextFor(engine, { width: 1440, height: 900 }, "light", fashionAt);
      await page.goto(`${app}/fashion-factory`, { waitUntil: "load" });
      await page.getByRole("heading", { name: "Upload outfit" }).waitFor();
      await page.waitForFunction(() => !/Fuobe Try-On/.test(document.querySelector('[role="radiogroup"][aria-label="Outfit model"]')?.textContent ?? "Fuobe Try-On"), null, { timeout: 30_000 }).catch(() => {});
      const outfit = (await page.getByRole("radiogroup", { name: "Outfit model" }).count()) ? await radios(page, "Outfit model") : [];
      const want = engine === "cloud" ? "FASHN Try-On" : "Qwen-Image-Edit 2511";
      const picked = outfit.length ? await page.getByRole("radio", { name: want }).getAttribute("aria-checked") : null;
      // On your GPU Qwen-Image-Edit is then the only outfit model: no menu.
      check(`${engine}: with the try-on LoRA off the outfit menu starts on ${want}`, engine === "cloud" ? !outfit.includes("Fuobe Try-On") && picked === "true" : !outfit.length, outfit.join(" | "));
      // The server's default moves on the same way (a request that names no model).
      const priced = await post("/api/photodump/fashion?preview=1", { step: "outfit", templateId: "red-room", base: productImage, garment: productImage, engine });
      check(`${engine}: and the outfit step's default runs on ${want}`, priced.modelId === (engine === "cloud" ? "fashn-tryon" : "oss-qwen-edit"), priced.modelId ?? priced.error);
      await context.close();
    }
  } finally {
    await post("/api/settings/models", { changes: [{ kind: "lora", id: "tryon-klein-4b.safetensors", on: true }] }, "PUT").catch(() => {});
  }

  // Settings → Models & licences: the try-on LoRA, its licence and its switch.
  {
    const { context, page } = await contextFor("cloud", { width: 1440, height: 900 }, "light");
    await page.goto(`${app}/settings/models`, { waitUntil: "load" });
    await page.getByLabel("Search names or licences").fill("Fuobe");
    await page.waitForFunction(() => /Fuobe Marketing Image/.test(document.body.innerText) && /Fuobe Try-On/.test(document.body.innerText), null, { timeout: 30_000 }).catch(() => {});
    check("Settings lists Fuobe Marketing Image and Fuobe Try-On", /Fuobe Marketing Image/.test(await text(page)) && /Fuobe Try-On/.test(await text(page)));
    await page.getByRole("button", { name: /^LoRAs/ }).first().click();
    await page.getByLabel("Search names or licences").fill("try-on");
    await page.getByText("Virtual Try-On for FLUX.2 [klein] 4B (xocialize)").first().waitFor();
    const lora = await text(page);
    check("Settings lists the try-on LoRA with its Apache-2.0 licence", /Virtual Try-On for FLUX\.2 \[klein\] 4B \(xocialize\)/.test(lora) && /Apache-2\.0/.test(lora));
    check("the try-on LoRA has its switch", (await page.getByRole("switch").count()) > 0);
    // Settings → LoRAs: the adapter's download and mirror status, under its own kind.
    await page.goto(`${app}/settings#loras`, { waitUntil: "load" });
    await page.getByRole("button", { name: /LoRA library/ }).click();
    await page.getByRole("radio", { name: "Adapters" }).click();
    await page.getByText("Virtual Try-On for FLUX.2 [klein] 4B (xocialize)").first().waitFor({ timeout: 30_000 }).catch(() => {});
    check("Settings → LoRAs lists the try-on LoRA under Adapters", /Virtual Try-On for FLUX\.2 \[klein\] 4B \(xocialize\)/.test(await text(page)) && /FLUX\.2 \[klein\] 4B/.test(await text(page)));
    await context.close();
  }

  // ---------------------------------------------------------------------------
  // Every touched page at 1440 and 390 px, light and dark: nothing scrolls sideways.
  const pages = ["/marketing", `/ads/${brand.id}?step=new`, "/influencer", "/photodump", "/fashion-factory", "/settings/models"];
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ]) {
    for (const scheme of ["light", "dark"]) {
      const { context, page } = await contextFor("cloud", { width: w, height: h }, scheme, fashionAt);
      for (const p of pages) {
        await page.goto(`${app}${p}`, { waitUntil: "load" });
        await page.waitForTimeout(600);
        check(`${p} at ${w}px ${scheme}: no sideways scroll`, await noSideways(page));
        if (shots) await page.screenshot({ path: path.join(shots, `${p.replace(/[/?=]+/g, "_").replace(/^_/, "") || "home"}-${w}-${scheme}.png`), fullPage: false });
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await fetch(`${app}/api/brands/${brand.id}`, { method: "DELETE" }).catch(() => {});
}

console.log(failures.length ? `\n${failures.length} failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
