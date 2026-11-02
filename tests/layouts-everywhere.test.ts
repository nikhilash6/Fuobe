import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// N7-8 (docs/research/new-models-7.md §5.9): layouts from Canvas, Marketing Studio, Ads Studio and Assist.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-layouts-everywhere-"));
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const { getModel, getPreset } = await import("@/lib/catalog");
const { planGeneration } = await import("@/lib/catalog/plan");
const { describeNode, cleanGraph } = await import("@/lib/catalog/canvas");
const { compileMoss, validateLayout, readsBoxes } = await import("@/lib/layout-prompt");
const { adDraft, adPlanDraft, fillLayout, layoutPlaceholders, LOGO_CAPTION, productRect, roughMeasure } = await import("@/lib/layout-surfaces");
const { planAd, themeFrom } = await import("@/components/ads/layout");
const { DRAWN_WORDS_MODELS, drawnWordsModel, formatModels, FORMATS, wordsOnTop, MARKETING_IMAGE_MODEL } = await import("@/lib/catalog/marketing");
const { planByRules, readPlanned } = await import("@/lib/layout-plan");
const { setSetting } = await import("@/server/settings");
const mk = await import("@/server/marketing");
const ads = await import("@/server/ads");
const { planLayoutFromWords } = await import("@/server/layout-plan");
const skills = await import("@/server/skills");
const canvasServer = await import("@/server/canvas");
const tools = await import("@/server/assist/tools");

import type { CanvasEdge, CanvasGraph, CanvasNode } from "@/lib/catalog/canvas";
import type { BrandKit, Product } from "@/lib/catalog/marketing";
import type { GenerationRequest } from "@/lib/catalog/types";
import type { LayoutDraft } from "@/lib/layout-prompt";

setSetting("demoMode", "auto");

const brand = {
  id: "b1",
  name: "Ember & Wick",
  tagline: "Small-batch candles",
  colors: ["#a3411f", "#f6efe3", "#1d1a17"],
  fonts: { heading: "Fraunces", body: "Inter" },
  values: [],
  aesthetics: ["warm", "handmade"],
  tone: ["friendly"],
  sellingPoints: [],
  competitors: [],
  socials: [],
  images: [],
  details: [],
  status: "ready",
  source: "manual",
  logo: "/api/files/logo.png",
} as unknown as BrandKit;
const product = {
  id: "p1",
  brandId: "b1",
  name: "Autumn Soy Candle",
  description: "Amber glass jar, cedar and clove",
  sellingPoints: ["40-hour burn"],
  images: ["/api/files/candle.png"],
  createdAt: 0,
  updatedAt: 0,
} as unknown as Product;

const inside = (d: LayoutDraft) => d.items.every((it) => it.box.every((v) => v >= 0 && v <= 1) && it.box[2] > it.box[0] && it.box[3] > it.box[1]);
const overlaps = (a: number[], b: number[]) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

// ---------------------------------------------------------------------------

describe("an ad plan as a layout (AdPlan → draft)", () => {
  const plan = planAd({
    ratio: "4:5",
    layout: "overlay",
    content: { headline: "Autumn Glow", body: "Hand-poured soy, cedar and clove.", cta: "Shop now" },
    theme: themeFrom(brand),
    image: { w: 1080, h: 1350 },
    logo: { w: 3, h: 1 },
    measure: roughMeasure,
  });

  it("maps the headline, body and button to text items with their words, the logo and the product to objects", () => {
    const d = adPlanDraft(plan, { mode: "words", product: "Autumn Soy Candle in amber glass", caption: "A finished social ad" });
    const texts = d.items.filter((i) => i.label === "text").map((i) => i.text?.replace(/\n/g, " "));
    expect(texts).toEqual(["Autumn Glow", "Hand-poured soy, cedar and clove.", "Shop now"]);
    expect(d.items.find((i) => i.caption === LOGO_CAPTION)?.label).toBe("object");
    const prod = d.items.find((i) => i.caption.startsWith("Autumn Soy Candle"))!;
    expect(prod.label).toBe("object");
    // The product stays out of the words' space, and every box is inside the picture.
    for (const t of d.items.filter((i) => i.label === "text")) expect(overlaps(prod.box, t.box), t.text).toBe(false);
    expect(inside(d)).toBe(true);
    expect(d.aspect).toBe("4:5");
    expect(d.summary.caption).toMatch(/soft dark shade/);
    expect(validateLayout(d, 1088, 1360).filter((i) => i.level === "error")).toEqual([]);
    // The type is described by family and colour, never as a CSS font string.
    expect(d.items.find((i) => i.text === "Autumn Glow")?.caption).toMatch(/Fraunces-style typeface/);
    expect(JSON.stringify(d)).not.toMatch(/px "/);
  });

  it("keeps clear: only the product, in the part of the picture the words leave free", () => {
    const d = adPlanDraft(plan, { mode: "clear", product: "Autumn Soy Candle", caption: "Advertising photograph" });
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({ label: "object", caption: "Autumn Soy Candle" });
    const r = productRect(plan);
    expect(r.y + r.h).toBeLessThanOrEqual(plan.headline.y);
    expect(d.summary.caption).toMatch(/No text, letters or logos anywhere/);
  });

  it("uses the whole picture when the words sit beside it (Panel)", () => {
    const panel = planAd({ ratio: "4:5", layout: "panel", content: { headline: "Autumn Glow" }, theme: themeFrom(brand), image: { w: 1080, h: 1350 }, measure: roughMeasure });
    expect(productRect(panel)).toEqual({ x: panel.image!.x, y: panel.image!.y, w: panel.image!.w, h: panel.image!.h });
    const d = adPlanDraft(panel, { mode: "words", product: "candle", caption: "" });
    expect(d.items[0].caption).toMatch(/flat, solid #[0-9a-f]{6} colour panel/i);
  });
});

describe("a table row in a layout's {Column} placeholders", () => {
  const draft: LayoutDraft = {
    summary: { caption: "A poster for {Product}", meta: [], canvas: "single" },
    items: [
      { label: "text", caption: "Bold", text: "{Headline}", box: [0.1, 0.05, 0.9, 0.2] },
      { label: "text", caption: "Price tag", text: "Only {Price}", box: [0.6, 0.8, 0.95, 0.95] },
      { label: "object", caption: "{Product} on a table", box: [0.2, 0.3, 0.8, 0.75] },
    ],
  };
  it("finds the placeholders and fills them, leaving unknown ones as written", () => {
    expect(layoutPlaceholders(draft).sort()).toEqual(["Headline", "Price", "Product"]);
    const f = fillLayout(draft, ["Headline", " Price ", "Other"], ["Autumn Glow", "$18", "x"]);
    expect(f.items.map((i) => i.text ?? i.caption)).toEqual(["Autumn Glow", "Only $18", "{Product} on a table"]);
    expect(f.summary.caption).toBe("A poster for {Product}");
    expect(draft.items[0].text).toBe("{Headline}"); // not changed in place
  });
});

// ---------------------------------------------------------------------------

const node = (id: string, type: CanvasNode["type"], x: number, y: number, data: CanvasNode["data"] = {}): CanvasNode => ({ id, type, position: { x, y }, data });
const edge = (source: string, target: string, targetHandle = "prompt"): CanvasEdge => ({ id: `${source}>${target}:${targetHandle}`, source, sourceHandle: "out", target, targetHandle });
const poster: LayoutDraft = {
  summary: { caption: "A warm candle sale poster", meta: ["poster"], canvas: "single" },
  items: [
    { label: "text", caption: "Bold cream serif", text: "30% OFF", box: [0.1, 0.05, 0.9, 0.2] },
    { label: "object", caption: "Three lit candles", box: [0.25, 0.35, 0.75, 0.9] },
  ],
  aspect: "3:4",
};
const board = (modelId: string, params: CanvasNode["data"]["params"] = {}, layout: LayoutDraft = poster): CanvasGraph => ({
  nodes: [node("l", "layout", 0, 0, { layout }), node("m", "model", 400, 0, { modelId, mediaKind: "image", params })],
  edges: [edge("l", "m")],
});

describe("the Canvas Layout node", () => {
  it("is an Inputs node with a text output that a model's Prompt takes", () => {
    const g = cleanGraph(board("oss-moss-image"));
    expect(g.edges).toHaveLength(1);
    // A board saved and read back keeps the layout (the server's own check).
    const parsed = canvasServer.parseGraph(g)!;
    expect(parsed.nodes[0].data.layout?.items).toHaveLength(2);
  });

  it("compiles for each downstream model at the size it renders (sourceOf → planLayout)", () => {
    const at = (modelId: string, params: CanvasNode["data"]["params"] = {}) => {
      const g = board(modelId, params);
      const d = describeNode(g, g.nodes[1]);
      expect(d.error, modelId).toBeUndefined();
      expect(d.request?.params?.extra?.layout, modelId).toBeTruthy();
      return d.plan!;
    };
    // MOSS-Image on your GPU: its JSON at the canvas the node's picture takes (3:4, then 16:9).
    const tall = at("oss-moss-image", { aspectRatio: "3:4" });
    expect(tall.layout).toMatchObject({ format: "moss", boxes: 2 });
    expect(tall.prompt).toBe(compileMoss({ ...poster, summary: { ...poster.summary, caption: "A warm candle sale poster" } }, tall.layout!.width!, tall.layout!.height!));
    expect(tall.layout!.height!).toBeGreaterThan(tall.layout!.width!);
    const wide = at("oss-moss-image", { aspectRatio: "16:9" });
    expect(wide.layout!.width!).toBeGreaterThan(wide.layout!.height!);
    expect(wide.prompt).not.toBe(tall.prompt);
    // MOSS-Image on fal: the same JSON, the size sent with it, expansion off.
    const fal = at("moss-image");
    expect(fal.layout?.format).toBe("moss");
    expect(fal.params.enhancePrompt).toBe(false);
    // FLUX.3 and Ideogram 4.5 read their own forms.
    expect(at("flux-3").layout?.format).toBe("flux3");
    expect(at("ideogram-4-5").layout?.format).toBe("ideogram");
    // A model that doesn't place boxes gets sentences.
    const words = at("nano-banana-pro");
    expect(readsBoxes(getModel("nano-banana-pro"))).toBe(false);
    expect(words.layout?.format).toBe("words");
    expect(words.prompt).toMatch(/30% OFF/);
  });

  it("reads as sentences in a text model, and asks for a box and for one layout at a time", () => {
    const text = board("text-llm");
    text.nodes[1].data.mediaKind = "text";
    const r = describeNode(text, text.nodes[1]);
    expect(r.request?.params?.extra?.layout).toBeUndefined();
    expect(r.request?.prompt).toMatch(/30% OFF/);
    const empty = board("oss-moss-image", {}, { ...poster, items: [] });
    expect(describeNode(empty, empty.nodes[1]).error).toMatch(/Draw a box in “Layout”/);
    const two = board("oss-moss-image");
    two.nodes.push(node("l2", "layout", 0, 300, { layout: poster }));
    two.edges.push(edge("l2", "m"));
    expect(describeNode(two, two.nodes[1]).error).toBe("Connect one layout at a time");
  });

  it("with a Table, fills {Column} in the layout's words row by row: one layout, a batch of posters", () => {
    const layout: LayoutDraft = {
      ...poster,
      items: [
        { ...poster.items[0], text: "{Offer}" },
        { ...poster.items[1], caption: "{Product}, lit, on a table" },
      ],
    };
    const g = board("oss-moss-image", {}, layout);
    g.nodes.push(
      node("t", "table", 0, 300, {
        columns: ["Offer", "Product"],
        rows: [
          ["30% OFF", "Soy candles"],
          ["2 FOR $30", "Beeswax tapers"],
        ],
      }),
    );
    g.edges.push(edge("t", "m"));
    const d = describeNode(g, g.nodes[1]);
    expect(d.error).toBeUndefined();
    expect(d.rows).toBe(2);
    const drafts = d.steps!.map((s) => s.request.params?.extra?.layout as LayoutDraft);
    expect(drafts.map((x) => x.items[0].text)).toEqual(["30% OFF", "2 FOR $30"]);
    expect(drafts.map((x) => x.items[1].caption)).toEqual(["Soy candles, lit, on a table", "Beeswax tapers, lit, on a table"]);
    // The row's cells went into the layout, so they aren't added to the prompt as well.
    expect(d.steps!.every((s) => !(s.request.prompt ?? "").includes("Soy candles, 30% OFF"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("Marketing Studio: Words drawn by the model", () => {
  const ctx = { product, brand };
  it("keeps the words on top by default and says which models draw them in place", () => {
    expect([
      wordsOnTop("open", MARKETING_IMAGE_MODEL),
      wordsOnTop("open", MARKETING_IMAGE_MODEL, true),
      wordsOnTop("cloud", MARKETING_IMAGE_MODEL, true),
      wordsOnTop("cloud", "moss-image", true),
    ]).toEqual([true, false, false, false]);
    expect(formatModels(FORMATS.ads, "open", { product: true, avatar: false }, true).map((c) => c.id)).toEqual(["oss-moss-image"]);
    expect(formatModels(FORMATS.poster, "cloud", { product: false, avatar: false }, true).map((c) => c.id)).toEqual(["moss-image", "ideogram-4-5", "flux-3"]);
    // Formats without words don't change.
    expect(formatModels(FORMATS["product-standalone"], "open", { product: true, avatar: false }, true)[0].id).toBe(MARKETING_IMAGE_MODEL);
    for (const e of ["open", "cloud"] as const) for (const c of DRAWN_WORDS_MODELS[e]) expect(readsBoxes(getModel(c.id)), c.id).toBe(true);
    expect(drawnWordsModel("cloud", "flux-3")).toBe("flux-3");
    expect(drawnWordsModel("open", "flux-3")).toBe("oss-moss-image");
  });

  it("on your GPU: MOSS-Image draws the headline and button from the format's copy places", () => {
    const run = mk.planMarketing({ engine: "open", format: "ads", templateId: "ad-hero-headline", headline: "Crunch, sorted", drawnWords: true }, ctx);
    const r = run.steps[0].request;
    expect(r).toMatchObject({ modelId: "oss-moss-image", op: "t2i" });
    expect(r.inputs).toBeUndefined();
    const layout = r.params?.extra?.layout as LayoutDraft;
    expect(layout.items.filter((i) => i.label === "text").map((i) => i.text?.replace(/\n/g, " "))).toEqual(["Crunch, sorted", "Shop now"]);
    expect(layout.items.some((i) => i.label === "object" && i.caption.startsWith("Autumn Soy Candle"))).toBe(true);
    expect(r.prompt).not.toContain("“Crunch, sorted”");
    expect(run.meta.overlay).toBeNull();
    expect(run.notes.join(" ")).toMatch(/draws your product from its name and description/);
    // The plan compiles it for MOSS-Image at the size it renders.
    const p = planGeneration(r as GenerationRequest, getModel, getPreset);
    expect(p.layout).toMatchObject({ format: "moss" });
    expect(p.prompt).toMatch(/"text":"Crunch, sorted"/);
  });

  it("in the cloud: MOSS-Image hosted by default, FLUX.3 with the product photo", () => {
    const moss = mk.planMarketing({ engine: "cloud", format: "poster", prompt: "Autumn launch", headline: "Autumn Glow", drawnWords: true }, { brand, product: null });
    expect(moss.steps[0].request).toMatchObject({ modelId: "moss-image", op: "t2i" });
    expect((moss.steps[0].request.params?.extra?.layout as LayoutDraft).items.some((i) => i.text === "Autumn Glow")).toBe(true);
    const flux = mk.planMarketing({ engine: "cloud", format: "ads", templateId: "ad-hero-headline", modelId: "flux-3", drawnWords: true }, ctx);
    expect(flux.steps[0].request).toMatchObject({ modelId: "flux-3", op: "edit", inputs: { images: [product.images[0], brand.logo] } });
    expect((flux.steps[0].request.params?.extra?.layout as LayoutDraft).items.filter((i) => i.caption === LOGO_CAPTION)).toHaveLength(1);
    // MOSS-Image can't take the logo: no logo box for it to make one up in.
    expect((moss.steps[0].request.params?.extra?.layout as LayoutDraft).items.some((i) => /logo/i.test(i.caption))).toBe(false);
    // Ideogram 4.5 edits: it keeps the product photo and takes the logo too.
    const ideo = mk.planMarketing({ engine: "cloud", format: "ads", templateId: "ad-hero-headline", modelId: "ideogram-4-5", drawnWords: true }, ctx);
    expect(ideo.steps[0].request).toMatchObject({ modelId: "ideogram-4-5", op: "edit", inputs: { images: [product.images[0], brand.logo] } });
    expect(ideo.notes.join(" ")).not.toMatch(/draws your product from its name/);
    // The estimate prices the drawing model.
    const est = mk.estimateMarketing({ engine: "cloud", format: "ads", templateId: "ad-hero-headline", drawnWords: true, productImages: product.images });
    expect(est.steps?.[0]?.modelId ?? JSON.stringify(est)).toMatch(/moss-image/);
  });
});

// ---------------------------------------------------------------------------

describe("Ads Studio: drawn ads and the keep-clear layout", () => {
  const concept = { visual: "three candles on an oak table", headline: "Autumn Glow", body: "Hand-poured soy.", cta: "Shop now" };
  it("sends the words as a layout instead of the no-text instruction, on both engines", () => {
    const open = ads.visualRequest(concept, product, brand, "open", null, true);
    expect(open).toMatchObject({ modelId: "oss-moss-image", op: "t2i", params: { aspectRatio: "4:5" } });
    expect(open.prompt).not.toMatch(/No text, letters/);
    const layout = open.params?.extra?.layout as LayoutDraft;
    expect(layout.items.filter((i) => i.label === "text").map((i) => i.text?.replace(/\n/g, " "))).toEqual([brand.name.toUpperCase(), "Autumn Glow", "Hand-poured soy.", "Shop now"]);
    // MOSS-Image draws from words alone: it can't take the logo, so the brand's name is drawn in its place, not a made-up logo.
    expect(layout.items.some((i) => /logo/i.test(i.caption))).toBe(false);
    const cloud = ads.visualRequest(concept, product, brand, "cloud", "ideogram-4-5", true);
    expect(cloud.modelId).toBe("ideogram-4-5");
    expect(planGeneration(cloud, getModel, getPreset).layout?.format).toBe("ideogram");
  });

  it("a model that takes references keeps the product photo and gets the brand's own logo for its logo box", () => {
    for (const id of ["ideogram-4-5", "flux-3"]) {
      const r = ads.visualRequest(concept, product, brand, "cloud", id, true);
      expect(r, id).toMatchObject({ modelId: id, op: "edit", inputs: { images: [product.images[0], brand.logo] } });
      expect((r.params?.extra?.layout as LayoutDraft).items.filter((i) => i.caption === LOGO_CAPTION), id).toHaveLength(1);
      expect(r.prompt, id).toMatch(/last reference image is the brand's logo/);
    }
    // No logo in the kit (or an SVG one): no logo box, the photo alone.
    for (const logo of [undefined, "/api/files/logo.svg"]) {
      const r = ads.visualRequest(concept, product, { ...brand, logo } as BrandKit, "cloud", "flux-3", true);
      expect(r.inputs?.images).toEqual([product.images[0]]);
      expect((r.params?.extra?.layout as LayoutDraft).items.some((i) => /logo/i.test(i.caption))).toBe(false);
    }
    // Without a product photo there is nothing to edit: drawn from words, no logo.
    const bare = ads.visualRequest(concept, null, brand, "cloud", "ideogram-4-5", true);
    expect(bare).toMatchObject({ op: "t2i", inputs: undefined });
    expect((bare.params?.extra?.layout as LayoutDraft).items.some((i) => /logo/i.test(i.caption))).toBe(false);
  });

  it("without it: the visual alone, and a keep-clear layout only for a model that reads boxes", () => {
    const plain = ads.visualRequest(concept, product, brand, "cloud");
    expect(plain.params?.extra).toBeUndefined();
    expect(plain.prompt).toMatch(/No text, letters/);
    const flux = ads.visualRequest(concept, product, brand, "cloud", "flux-3");
    const layout = flux.params?.extra?.layout as LayoutDraft;
    expect(layout.items).toHaveLength(1);
    expect(layout.items[0].label).toBe("object");
    expect(flux.inputs?.images).toEqual(product.images);
    expect(planGeneration(flux, getModel, getPreset).layout).toMatchObject({ format: "flux3", boxes: 1 });
  });

  it("an estimate for drawn ads prices the model that draws them", () => {
    const e = ads.estimateBatch({ brandId: "b1", engine: "cloud", items: [{ productId: "p1", count: 2 }], drawnWords: true }, { brand, product });
    expect(e.modelId).toBe("moss-image");
    const draft = adDraft({ ratio: "4:5", layout: "overlay", content: { headline: "x" }, brand, mode: "clear", product: "y", caption: "" });
    expect(draft.aspect).toBe("4:5");
  });
});

// ---------------------------------------------------------------------------

describe("Plan layout and the Layout Poster skill", () => {
  it("lays out a poster from the sentence when no text model is there, and the result passes validateLayout", () => {
    const d = planByRules("a sale poster for my candle shop, 30% off", 768, 1024);
    expect(d.items.find((i) => i.label === "text")?.text).toBe("30% OFF");
    expect(d.items.map((i) => i.text).filter(Boolean)).toContain("Candle Shop");
    expect(d.aspect).toBe("3:4");
    expect(validateLayout(d, 768, 1024)).toEqual([]);
    const quoted = planByRules('a launch poster for our bakery that says "Fresh at 7"', 1536, 1024);
    expect(quoted.items[0].text).toBe("Fresh at 7");
    expect(validateLayout(quoted, 1536, 1024)).toEqual([]);
  });

  it("reads the planner's pixel draft (MOSS's abs / xyxy) into a layout that passes validateLayout", () => {
    const answer = JSON.stringify({
      width: 768,
      height: 1024,
      bbox_coord_space: "abs",
      bbox_format: "xyxy",
      summary: { caption: "A warm autumn sale poster", meta: ["poster"], canvas: "single" },
      items: [
        { label: "text", caption: "Large cream serif", text: "Autumn Glow", bbox: [64, 48, 704, 200] },
        { label: "object", caption: "Three lit candles", bbox: [112, 320, 656, 848] },
      ],
    });
    const d = readPlanned(`Here it is:\n${answer}`, 768, 1024)!;
    expect(d.items[0].box[0]).toBeCloseTo(64 / 768, 6);
    expect(d.items[1].box[3]).toBeCloseTo(848 / 1024, 6);
    expect(validateLayout(d, 768, 1024)).toEqual([]);
    // A text box without words doesn't run: not a plan.
    expect(readPlanned(answer.replace('"text":"Autumn Glow",', ""), 768, 1024)).toBeNull();
    expect(readPlanned("no layout here", 768, 1024)).toBeNull();
  });

  it("asks the AI helper first and falls back to the rules", async () => {
    setSetting("enhanceProvider", "local");
    const good =
      '{"width":1024,"height":1024,"bbox_coord_space":"abs","bbox_format":"xyxy","summary":{"caption":"x","meta":[],"canvas":"single"},"items":[{"label":"text","caption":"bold","text":"SALE","bbox":[100,50,900,250]}]}';
    const asked: string[] = [];
    const r = await planLayoutFromWords("a sale poster", 1024, 1024, async (system, user) => (asked.push(user), good));
    expect(r.by).toBe("llm");
    expect(asked[0]).toMatch(/Canvas: 1024 × 1024/);
    expect((await planLayoutFromWords("a sale poster, 20% off", 1024, 1024, async () => "sorry")).by).toBe("rules");
    setSetting("enhanceProvider", "none");
    expect((await planLayoutFromWords("a sale poster", 1024, 1024, async () => good)).by).toBe("rules");
  });

  it("ships skills/layout-poster, which Assist's skill loader picks up with its reference and the Apache-2.0 notice", () => {
    const s = skills.getSkill("layout-poster")!;
    expect(s).toBeTruthy();
    expect(s.source).toBe("builtin");
    expect(s.files?.map((f) => f.path)).toContain("references/layout.md");
    expect(skills.listSkills().some((x) => x.name === "layout-poster")).toBe(true);
    const md = fs.readFileSync(path.join(process.cwd(), "skills/layout-poster/SKILL.md"), "utf8");
    expect(md).toMatch(/Apache\s+License, Version 2\.0/);
    expect(fs.readFileSync(path.join(process.cwd(), "skills/layout-poster/references/layout.md"), "utf8")).toMatch(/2b46b1e0e13b5aaec253879e0d006a42564b8b27/);
    // The draft in its reference example is one the planner reads and validateLayout passes.
    const example = /```json\n([\s\S]+?)```/.exec(fs.readFileSync(path.join(process.cwd(), "skills/layout-poster/references/layout.md"), "utf8"))![1];
    expect(readPlanned(example, 768, 1024)?.items).toHaveLength(4);
  });
});

// ---------------------------------------------------------------------------

describe("Assist: a generate job's layout", () => {
  const pixel = (n: number) => ({
    width: 896,
    height: 1152,
    bbox_coord_space: "abs",
    bbox_format: "xyxy",
    summary: { caption: "A sale poster", meta: ["poster"], canvas: "single" },
    items: Array.from({ length: n }, (_, i) => ({ label: "text", caption: "Bold words", text: `Line ${i + 1}`, bbox: [16, 16 + (i % 60) * 16, 400, 30 + (i % 60) * 16] })),
  });

  it("runs in the nearest shape the model lists, and keeps at most 64 boxes", () => {
    for (const id of ["flux-3", "ideogram-4-5"]) {
      const r = tools.asRequest({ model_id: id, prompt: "A poster", layout: pixel(3) } as Parameters<typeof tools.asRequest>[0]);
      const listed = getModel(id)!.options.aspectRatios!;
      expect(listed, id).not.toContain("7:9");
      expect(listed, id).toContain(r.params?.aspectRatio);
      expect((r.params?.extra?.layout as LayoutDraft).aspect).toBe("7:9");
    }
    // An aspect the job names wins.
    expect(tools.asRequest({ model_id: "flux-3", prompt: "x", layout: pixel(1), aspect_ratio: "1:1" } as Parameters<typeof tools.asRequest>[0]).params?.aspectRatio).toBe("1:1");
    const many = tools.asRequest({ model_id: "flux-3", prompt: "x", layout: pixel(80) } as Parameters<typeof tools.asRequest>[0]);
    expect((many.params?.extra?.layout as LayoutDraft).items).toHaveLength(64);
  });
});
