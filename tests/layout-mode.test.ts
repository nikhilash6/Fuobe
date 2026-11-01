import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { buildPayload, extractOutputs } from "@/lib/catalog/payload";
import { estimateCost, layoutCanvas, planGeneration } from "@/lib/catalog/plan";
import type { Generation, GenerationRequest, ModelDef, ModelRoute } from "@/lib/catalog/types";
import { fitCanvas } from "@/lib/comfy";
import { enterLayout, groupModels, layoutBoxModel, layoutModelNote, layoutNotes, layoutRequest, layoutShape, layoutSizeWarning, leaveLayout, settingsShape, withoutLayout } from "@/lib/composer";
import { compileFlux3, compileIdeogram, compileMoss, compileWords, type LayoutDraft } from "@/lib/layout-prompt";
import { boxesAt, contrastRatio, drawnBox, inkOn, keyResizedBox, KIND_COLOR, movedBox, newBox, nudgedBox, pickBox, resizedBox } from "@/lib/layout-edit";
import { editableLayout, editLayoutHref, outputActions, readEditLayoutParam } from "@/lib/output-actions";
import { slimModel } from "@/lib/studio-catalog";

// N7-2 (docs/research/new-models-7.md §5.3): Layout mode in the Image studio. The composer sends the neutral draft
// (params.extra.layout) with the prompt as its caption; the plan compiles it for the model at the exact size it renders;
// results reopen as boxes (Edit layout), from the request's own draft or from fal's actual_prompt.

const poster: LayoutDraft = {
  summary: { caption: "", meta: ["poster"], canvas: "single" },
  items: [
    { label: "text", caption: "Bold cream serif", text: "30% OFF", box: [0.1, 0.05, 0.9, 0.2], color: "#ff3b30" },
    { label: "object", caption: "Three lit candles", box: [0.25, 0.35, 0.75, 0.9] },
  ],
  aspect: "16:9",
};

const model = (id: string) => getModel(id)!;
const plan = (modelId: string, params: GenerationRequest["params"], prompt = "A candle sale poster", lookup: (id: string) => ModelDef | undefined = getModel) =>
  planGeneration({ feature: "image", op: "t2i", modelId, prompt, params } as GenerationRequest, lookup, getPreset);
const sent = (layout: LayoutDraft, prompt: string, params: GenerationRequest["params"] = {}) => layoutRequest(layout, prompt, params ?? {});

describe("the composer's Layout mode helpers", () => {
  it("enters on the picture's shape with an empty layout, the prompt left as the caption", () => {
    expect(enterLayout({ aspectRatio: "3:2" })).toEqual({ summary: { caption: "", meta: [], canvas: "single" }, items: [], aspect: "3:2" });
    expect(enterLayout({}, { defaults: { aspectRatio: "1:1" } }).aspect).toBe("1:1");
    expect(enterLayout({ aspectRatio: "auto" })).not.toHaveProperty("aspect");
  });

  it("sends the draft as params.extra.layout, captioned with the prompt, on the shape picked", () => {
    const r = sent(poster, "  A candle sale poster ", { aspectRatio: "1:1", seed: 7, extra: { quality: "quality" } });
    expect(r.prompt).toBe("  A candle sale poster ");
    expect(r.params).toMatchObject({ aspectRatio: "1:1", seed: 7, extra: { quality: "quality" } });
    const layout = r.params.extra!.layout as LayoutDraft;
    expect(layout.summary.caption).toBe("A candle sale poster");
    expect(layout.aspect).toBe("1:1");
    expect(layout.items).toEqual(poster.items);
    // The draft in the composer is untouched.
    expect(poster.summary.caption).toBe("");
  });

  it("leaves with the boxes counted (for Undo) and no layout in the params", () => {
    expect(leaveLayout(poster, { aspectRatio: "16:9", extra: { layout: poster, quality: "fast" } })).toEqual({ params: { aspectRatio: "16:9", extra: { quality: "fast" } }, dropped: 2 });
    expect(leaveLayout(undefined, { aspectRatio: "16:9" })).toEqual({ params: { aspectRatio: "16:9" }, dropped: 0 });
    expect(leaveLayout(poster, { extra: { layout: poster } }).params).toEqual({ extra: undefined });
  });

  it("takes a request's layout back out of its params (Reuse), and drops one it can't read", () => {
    const { params, layout } = withoutLayout(sent(poster, "A poster", { seed: 3 }).params);
    expect(params).toEqual({ seed: 3, extra: undefined });
    expect(layout?.items.map((i) => i.box)).toEqual(poster.items.map((i) => i.box));
    expect(layout?.summary.caption).toBe("A poster");
    expect(withoutLayout({ extra: { layout: "nonsense", quality: "fast" } })).toEqual({ params: { extra: { quality: "fast" } } });
    expect(withoutLayout({ seed: 1 })).toEqual({ params: { seed: 1 } });
  });

  it("hides Enhance (nothing rewrites the boxes)", () => {
    const shape = settingsShape(model("oss-moss-image"), "t2i", "image", true);
    expect(shape.enhance).toBe(true);
    expect(layoutShape(shape)).toEqual({ ...shape, enhance: false });
  });

  it("says once when a model reads the layout as words", () => {
    for (const id of ["oss-moss-image", "moss-image", "flux-3", "ideogram-4-5"]) expect(layoutModelNote(model(id))).toBeNull();
    expect(layoutModelNote(model("nano-banana-pro"))).toBe("This model reads the layout as words, not exact positions.");
    // Bria FIBO 2 places boxes with location words, not coordinates.
    expect(layoutModelNote(model("bria-fibo-2"))).toBe("This model reads the layout as words, not exact positions.");
  });

  it("gives a words model its one line (no size warning: it never places boxes by position), a box reader its warning", () => {
    const big = { width: 4096, height: 4096, asked: { width: 4096, height: 4096 }, exact: false };
    expect(layoutNotes(model("nano-banana-pro"), big)).toEqual([{ text: "This model reads the layout as words, not exact positions.", tone: "info" }]);
    expect(layoutNotes(model("flux-3"), big)).toEqual([{ text: expect.stringContaining("FLUX.3 may place the boxes less exactly"), tone: "warn" }]);
    expect(layoutNotes(model("flux-3"), { ...big, width: 1024, height: 1024, asked: { width: 1024, height: 1024 } })).toEqual([]);
  });

  it("offers Use MOSS-Image only when Settings → Models & licences offers it", () => {
    const pick = (offered: boolean) => ({ id: "moss-image", getModel, offered: () => offered });
    expect(layoutBoxModel(model("nano-banana-pro"), pick(true))?.id).toBe("moss-image");
    expect(layoutBoxModel(model("nano-banana-pro"), pick(false))).toBeUndefined();
    // A box reader needs no fix.
    expect(layoutBoxModel(model("flux-3"), pick(true))).toBeUndefined();
  });

  it("reads FLUX.3's 512sq / 768sq tiers as that square's area, not the 1K guess", () => {
    expect(layoutCanvas(model("flux-3"), { aspectRatio: "1:1", resolution: "512sq" })).toMatchObject({ width: 512, height: 512 });
    const wide = layoutCanvas(model("flux-3"), { aspectRatio: "16:9", resolution: "768sq" });
    expect(wide.width / wide.height).toBeCloseTo(16 / 9, 1);
    expect(Math.abs(wide.width * wide.height - 768 * 768) / (768 * 768)).toBeLessThan(0.03);
  });

  it("warns past 2048 px a side or 4 MP, with the size the model renders instead", () => {
    expect(layoutSizeWarning({ width: 1024, height: 1024, asked: { width: 1024, height: 1024 }, exact: true }, "MOSS-Image")).toBeNull();
    expect(layoutSizeWarning({ width: 2048, height: 880, asked: { width: 2352, height: 1008 }, exact: true }, "MOSS-Image")).toBe(
      "2352 × 1008 is past 2048 px a side, so MOSS-Image renders 2048 × 880; the boxes keep their places",
    );
    expect(layoutSizeWarning({ width: 4096, height: 4096, asked: { width: 4096, height: 4096 }, exact: false }, "FLUX.3")).toBe(
      "about 4096 × 4096 is past 2048 px a side or 4 megapixels: FLUX.3 may place the boxes less exactly",
    );
  });

  it("lists the models that read boxes first in the picker", () => {
    const models = ["nano-banana-pro", "moss-image", "flux-3", "ideogram-4-5", "bria-fibo-2"].map(model);
    const base = { models, engine: "cloud" as const, engines: ["cloud" as const], query: "", recent: ["nano-banana-pro"], starred: [], best: [] };
    expect(groupModels(base).groups.map((g) => g.id)).toEqual(["recent", "all"]);
    const laid = groupModels({ ...base, boxes: true }).groups;
    expect(laid[0]).toMatchObject({ id: "boxes", label: "Reads your boxes" });
    expect(laid[0].models.map((m) => m.id)).toEqual(["moss-image", "flux-3", "ideogram-4-5"]);
    // A search ranks them first among equal matches too.
    const hits = groupModels({ ...base, boxes: true, query: "image" }).groups[0].models.map((m) => m.id);
    expect(hits.indexOf("moss-image")).toBeLessThan(hits.indexOf("nano-banana-pro"));
  });
});

describe("the plan compiles the layout at the size the model renders", () => {
  it("on your GPU: the aspect ratio and resolution on the 16 px grid, sent as the graph's width and height", () => {
    const p = plan("oss-moss-image", { aspectRatio: "16:9", resolution: "1K", extra: { layout: poster } });
    expect(p.params.extra).toMatchObject({ width: 1360, height: 768 });
    expect(p.prompt).toBe(compileMoss({ ...poster, summary: { ...poster.summary, caption: "A candle sale poster" } }, 1360, 768));
    expect(p.layout).toEqual({ format: "moss", boxes: 2, width: 1360, height: 768 });
    expect(p.params.enhancePrompt).toBe(false);
    expect(p.params.extra?.layout).toBeDefined();
    expect(estimateCost(p.model, p.params)).toBe(0);
  });

  it("on your GPU: a side past 2048 is scaled down whole, as the ComfyUI provider fits a canvas the request names", () => {
    const p = plan("oss-moss-image", { aspectRatio: "21:9", resolution: "1.5K", extra: { layout: poster } });
    expect(p.params.extra).toMatchObject({ width: 2048, height: 880 });
    // The provider fits params.extra.width / height with the manifest's limits: the same size, so the boxes land where drawn.
    const manifest = JSON.parse(fs.readFileSync("workflows/comfyui/manifest.json", "utf8")) as { workflows: { id: string; limits: Record<string, number> }[] };
    const limits = manifest.workflows.find((w) => w.id === "moss-image-t2i")!.limits;
    expect(fitCanvas(2048, 880, limits)).toEqual({ width: 2048, height: 880 });
    expect(layoutCanvas(model("oss-moss-image"), { aspectRatio: "21:9", resolution: "1.5K" })).toEqual({ width: 2048, height: 880, asked: { width: 2352, height: 1008 }, exact: true });
  });

  it("on fal: image_size equal to the canvas, prompt expansion off, priced for that size", () => {
    const m = model("moss-image");
    const p = plan("moss-image", { aspectRatio: "16:9", extra: { layout: poster } });
    expect(p.params.extra?.image_size).toEqual({ width: 1360, height: 768 });
    const out = buildPayload((m.routes[0] as ModelRoute).map!, { prompt: p.prompt, ...p.params });
    expect(out).toMatchObject({ image_size: { width: 1360, height: 768 }, enable_prompt_expansion: false, output_format: "png" });
    expect(out.prompt).toBe(compileMoss({ ...poster, summary: { ...poster.summary, caption: "A candle sale poster" } }, 1360, 768));
    expect(out).not.toHaveProperty("layout");
    expect(estimateCost(p.model, p.params, 1, p.op)).toBe(Math.round(0.05 * ((1360 * 768) / 1048576) * 1000) / 1000);
  });

  it("on fal: a canvas asked for is clamped to 512–2048 with the minimum respected", () => {
    const p = plan("moss-image", { extra: { layout: poster, image_size: { width: 3000, height: 300 } } });
    expect(p.params.extra?.image_size).toEqual({ width: 2048, height: 512 });
    expect(p.layout).toMatchObject({ width: 2048, height: 512 });
    const small = plan("moss-image", { extra: { layout: poster, image_size: { width: 300, height: 300 } } });
    expect(small.params.extra?.image_size).toEqual({ width: 512, height: 512 });
  });

  it("compiles the same at the browser's slim catalog (route sizes kept as previews)", () => {
    const slim = slimModel(model("moss-image"));
    expect(slim.routes[0].map).toBeUndefined();
    const p = plan("moss-image", { aspectRatio: "16:9", extra: { layout: poster } }, "A candle sale poster", (id) => (id === slim.id ? slim : getModel(id)));
    expect(p.params.extra?.image_size).toEqual({ width: 1360, height: 768 });
    expect(estimateCost(p.model, p.params, 1, p.op)).toBe(estimateCost(model("moss-image"), p.params, 1, p.op));
  });

  it("gives FLUX.3 and Ideogram 4.5 their own compilers, expansion off, and every other model plain sentences", () => {
    const captioned = { ...poster, summary: { ...poster.summary, caption: "A candle sale poster" } };
    const flux = plan("flux-3", { aspectRatio: "16:9", extra: { layout: poster } });
    expect(flux.prompt).toBe(compileFlux3(captioned));
    expect(buildPayload(model("flux-3").routes[0].map!, { prompt: flux.prompt, ...flux.params }).enable_prompt_expansion).toBe(false);
    const ideo = plan("ideogram-4-5", { aspectRatio: "16:9", extra: { layout: poster } });
    expect(ideo.prompt).toBe(compileIdeogram(captioned));
    expect(buildPayload(model("ideogram-4-5").routes[0].map!, { prompt: ideo.prompt, ...ideo.params }).enable_prompt_expansion).toBe(false);
    // Neither renders a size Fuobe names: no image_size of their own.
    expect(flux.params.extra).not.toHaveProperty("image_size");
    const nano = plan("nano-banana-pro", { aspectRatio: "16:9", extra: { layout: poster } });
    expect(nano.prompt).toBe(compileWords(captioned));
    expect(nano.layout).toEqual({ format: "words", boxes: 2 });
    // Bria FIBO 2 gets its VGL beside the words.
    const bria = plan("bria-fibo-2", { aspectRatio: "1:1", extra: { layout: poster } });
    expect(bria.params.extra?.vgl).toMatchObject({ text_render: [{ text: "30% OFF" }] });
  });

  it("refuses a text box without its words, and an unreadable layout", () => {
    const empty: LayoutDraft = { ...poster, items: [{ ...poster.items[0], text: " " }, poster.items[1]] };
    expect(() => plan("moss-image", { extra: { layout: empty } })).toThrow("Type the words for box 1");
    expect(() => plan("oss-moss-image", { extra: { layout: { items: "x" } } })).toThrow(/couldn't be read/);
  });

  it("is a plain prompt with no boxes, its caption the prompt", () => {
    const p = plan("moss-image", { extra: { layout: { ...poster, items: [] } } });
    expect(p.prompt).toBe("A candle sale poster");
    expect(p.params.extra).not.toHaveProperty("image_size");
  });
});

describe("Edit layout", () => {
  const fixture = JSON.parse(fs.readFileSync("tests/fixtures/moss-actual-prompt.json", "utf8")) as Record<string, unknown>;
  const gen = (over: Partial<Generation>): Generation =>
    ({
      id: "gen_abc123",
      status: "succeeded",
      kind: "image",
      op: "t2i",
      feature: "image",
      modelId: "moss-image",
      outputs: [{ url: "/api/files/outputs/a.png", kind: "image" }],
      request: { feature: "image", modelId: "moss-image", prompt: "A candle sale poster", params: {} },
      ...over,
    }) as Generation;

  it("reopens a layout run's own draft with its seed", () => {
    const r = sent(poster, "A candle sale poster", { seed: 41 });
    const g = gen({ request: { feature: "image", modelId: "moss-image", prompt: r.prompt, params: r.params } });
    const e = editableLayout(g, 0)!;
    expect(e).toMatchObject({ caption: "A candle sale poster", seed: 41, from: "request" });
    expect(e.draft.items.map((i) => i.text ?? i.caption)).toEqual(["30% OFF", "Three lit candles"]);
    // The seed the provider reported (ComfyUI's own pick, fal's) wins over the request's.
    const reported = gen({ request: g.request, outputs: [{ url: "/api/files/outputs/a.png", kind: "image", meta: { seed: 99 } }] });
    expect(editableLayout(reported, 0)?.seed).toBe(99);
    expect(outputActions(g, 0).find((a) => a.id === "edit-layout")).toEqual({ id: "edit-layout", label: "Edit layout", placement: "menu", href: "/image?layout=gen_abc123" });
  });

  it("decodes fal's actual_prompt at the picture's own size, so a plain prompt's render opens as boxes", () => {
    const outputs = extractOutputs(fixture, "t2i");
    expect(outputs).toHaveLength(1);
    expect(outputs[0].meta).toMatchObject({ seed: 418207, width: 1360, height: 768 });
    const g = gen({ outputs: outputs.map((o) => ({ ...o, url: "/api/files/outputs/b.png" })), request: { feature: "image", modelId: "moss-image", prompt: "candle sale poster", params: {} } });
    const e = editableLayout(g, 0)!;
    expect(e.from).toBe("expansion");
    expect(e.seed).toBe(418207);
    expect(e.caption).toBe("A warm autumn sale poster for a candle shop");
    expect(e.draft.summary.meta).toEqual(["poster", "flat design"]);
    expect(e.draft.items.map((i) => [i.label, i.text ?? null])).toEqual([["text", "秋季特卖 30% OFF"], ["object", null]]);
    // Compiled again at the same size, the boxes are the ones fal planned (y before x, from the centre).
    const again = JSON.parse(compileMoss(e.draft, 1360, 768)) as { items: { bbox: number[] }[] };
    expect(again.items.map((i) => i.bbox)).toEqual([
      [-320, -560, -160, 560],
      [-96, -400, 320, 400],
    ]);
    expect(outputActions(g, 0).some((a) => a.id === "edit-layout")).toBe(true);
  });

  it("is offered only when it can work", () => {
    expect(editableLayout(gen({}), 0)).toBeNull();
    expect(outputActions(gen({}), 0).some((a) => a.id === "edit-layout")).toBe(false);
    // Still running, a video, a plan with no boxes, a plan without the picture's size.
    const r = sent(poster, "A poster");
    const laid = { feature: "image", modelId: "moss-image", prompt: "A poster", params: r.params } as GenerationRequest;
    expect(editableLayout(gen({ status: "running", request: laid }), 0)).toBeNull();
    expect(editableLayout(gen({ request: laid, outputs: [{ url: "/a.mp4", kind: "video" }] }), 0)).toBeNull();
    expect(editableLayout(gen({ outputs: [{ url: "/a.png", kind: "image", meta: { actualPrompt: "just words", width: 1024, height: 1024 } }] }), 0)).toBeNull();
    expect(editableLayout(gen({ outputs: [{ url: "/a.png", kind: "image", meta: { actualPrompt: fixture.actual_prompt } }] }), 0)).toBeNull();
    // fal's other models' outputs never carry an actual_prompt, only the seed.
    expect(extractOutputs({ images: [{ url: "https://x/a.png", width: 1, height: 1 }], seed: 3 }, "t2i")[0]).toMatchObject({ meta: { seed: 3 } });
    expect(extractOutputs({ images: [{ url: "https://x/a.png", width: 1, height: 1 }] }, "t2i")[0]).not.toHaveProperty("meta");
    // A run with Layout on but no box drawn has nothing to reopen.
    const empty = { feature: "image", modelId: "moss-image", prompt: "A poster", params: { extra: { layout: { ...poster, items: [] } } } } as GenerationRequest;
    expect(editableLayout(gen({ request: empty }), 0)).toBeNull();
    expect(outputActions(gen({ request: empty }), 0).some((a) => a.id === "edit-layout")).toBe(false);
  });

  it("reopens a cloud layout run (expansion off, no actual_prompt) with the seed fal drew it with", () => {
    for (const modelId of ["moss-image", "flux-3", "ideogram-4-5"]) {
      const r = sent(poster, "A candle sale poster");
      const outputs = extractOutputs({ images: [{ url: "https://fal/x.png", width: 1360, height: 768, content_type: "image/png" }], seed: 918273 }, "t2i");
      const g = gen({ modelId, outputs, request: { feature: "image", modelId, prompt: r.prompt, params: r.params } });
      expect(editableLayout(g, 0)).toMatchObject({ seed: 918273, from: "request" });
    }
  });

  it("links to the Image studio with the generation and the picture", () => {
    expect(editLayoutHref({ id: "gen_abc123" }, 0)).toBe("/image?layout=gen_abc123");
    expect(editLayoutHref({ id: "gen_abc123" }, 2)).toBe("/image?layout=gen_abc123.2");
    expect(readEditLayoutParam("gen_abc123.2")).toEqual({ id: "gen_abc123", index: 2 });
    expect(readEditLayoutParam("gen_abc123")).toEqual({ id: "gen_abc123", index: 0 });
    for (const bad of ["", null, "../etc", "a.b", "x".repeat(80)]) expect(readEditLayoutParam(bad)).toBeNull();
  });
});

describe("Reuse", () => {
  it("round-trips: the request the composer sends comes back as the same boxes and words, and plans to the same prompt", () => {
    const asked = sent(poster, "A candle sale poster", { aspectRatio: "16:9", seed: 12 });
    const stored = JSON.parse(JSON.stringify(asked)) as typeof asked;
    const back = withoutLayout(stored.params);
    expect(back.params).toEqual({ aspectRatio: "16:9", seed: 12, extra: undefined });
    expect(back.layout?.items).toEqual(poster.items);
    // The composer sends it again from Layout mode: the same compiled prompt at the same size.
    const again = sent({ ...back.layout!, summary: { ...back.layout!.summary, caption: "" } }, stored.prompt, back.params);
    const a = plan("oss-moss-image", asked.params, asked.prompt);
    const b = plan("oss-moss-image", again.params, again.prompt);
    expect(b.prompt).toBe(a.prompt);
    expect(b.params.extra).toMatchObject({ width: 1360, height: 768 });
    expect(b.params.seed).toBe(12);
  });
});

describe("the editor's box maths", () => {
  // Whole pixels at this size: boxes snap to the canvas's pixels.
  const W = 1000;
  const H = 500;

  it("draws a box corner to corner on the canvas's own pixels, kept inside, none for a click", () => {
    expect(drawnBox(100, 50, 500, 250, W, H)).toEqual([0.1, 0.1, 0.5, 0.5]);
    // Dragged up and to the left, and past the edge; snapped to whole pixels.
    expect(drawnBox(500, 250, -50, -50, W, H)).toEqual([0, 0, 0.5, 0.5]);
    expect(drawnBox(100.4, 50.4, 500.4, 250.4, W, H)).toEqual([0.1, 0.1, 0.5, 0.5]);
    expect(drawnBox(100, 100, 108, 104, W, H)).toBeNull();
    // A canvas drawn small on screen asks for more: a 20 px drift isn't a box when 8 screen px are 23 canvas px.
    expect(drawnBox(100, 100, 120, 120, W, H)).not.toBeNull();
    expect(drawnBox(100, 100, 120, 120, W, H, 23)).toBeNull();
    expect(drawnBox(100, 100, 130, 130, W, H, 23)).not.toBeNull();
    // Never below 16 px, whatever is asked.
    expect(drawnBox(100, 100, 110, 110, W, H, 2)).toBeNull();
  });

  it("picks the top box, keeps a picked one under another, and cycles on the same spot", () => {
    const boxes: [number, number, number, number][] = [
      [0, 0, 1, 1],
      [0.2, 0.2, 0.6, 0.6],
      [0.4, 0.4, 0.8, 0.8],
    ];
    const stack = boxesAt(boxes, 0.5, 0.5);
    expect(stack).toEqual([2, 1, 0]);
    expect(pickBox(stack, null, false)).toBe(2);
    expect(pickBox(stack, 0, false)).toBe(0);
    expect(pickBox(stack, 2, true)).toBe(1);
    expect(pickBox(stack, 1, true)).toBe(0);
    expect(pickBox(stack, 0, true)).toBe(2);
    expect(pickBox([], 1, true)).toBeNull();
  });

  it("moves, resizes and nudges within the canvas, never below 16 px", () => {
    const box: [number, number, number, number] = [0.1, 0.1, 0.5, 0.5];
    expect(movedBox(box, 100, 50, W, H)).toEqual([0.2, 0.2, 0.6, 0.6]);
    // Pushed past the right edge: held there whole.
    expect(movedBox(box, 5000, 0, W, H)).toEqual([0.6, 0.1, 1, 0.5]);
    // The south-east handle drags the corner; the north-west corner stays.
    expect(resizedBox(box, "se", 100, 50, W, H)).toEqual([0.1, 0.1, 0.6, 0.6]);
    expect(resizedBox(box, "n", 0, -1000, W, H)[1]).toBe(0);
    const tiny = resizedBox(box, "e", -5000, 0, W, H);
    expect(Math.round((tiny[2] - tiny[0]) * W)).toBe(16);
    expect(nudgedBox(box, "ArrowRight", false, W, H)).toEqual([0.101, 0.1, 0.501, 0.5]);
    expect(nudgedBox(box, "ArrowUp", true, W, H)).toEqual([0.1, 0.08, 0.5, 0.48]);
    expect(nudgedBox(box, "Enter", false, W, H)).toBeNull();
    expect(newBox(0)).toEqual([0.333333, 0.333333, 0.666667, 0.666667]);
  });

  it("resizes from the keyboard: Alt+arrows move the right and bottom edges, Shift for ten", () => {
    const box: [number, number, number, number] = [0.1, 0.1, 0.5, 0.5];
    expect(keyResizedBox(box, "ArrowRight", false, W, H)).toEqual([0.1, 0.1, 0.501, 0.5]);
    expect(keyResizedBox(box, "ArrowLeft", true, W, H)).toEqual([0.1, 0.1, 0.49, 0.5]);
    expect(keyResizedBox(box, "ArrowDown", true, W, H)).toEqual([0.1, 0.1, 0.5, 0.52]);
    expect(keyResizedBox(box, "ArrowUp", false, W, H)).toEqual([0.1, 0.1, 0.5, 0.498]);
    // The same limits as a handle: held at the edge and at 16 px.
    expect(keyResizedBox([0.1, 0.1, 0.995, 0.5], "ArrowRight", true, W, H)?.[2]).toBe(1);
    const narrow = keyResizedBox([0.1, 0.1, 0.117, 0.5], "ArrowLeft", true, W, H)!;
    expect(Math.round((narrow[2] - narrow[0]) * W)).toBe(16);
    expect(keyResizedBox(box, "Enter", false, W, H)).toBeNull();
  });

  it("writes a box's number in the ink that reads on its colour (WCAG AA for the kind colours)", () => {
    for (const c of Object.values(KIND_COLOR)) expect(contrastRatio(c, inkOn(c))).toBeGreaterThanOrEqual(4.5);
    expect(inkOn(KIND_COLOR.object)).toBe("#ffffff");
    expect(inkOn("#ff9f0a")).toBe("#1d1d1f");
    expect(inkOn("#34c759")).toBe("#1d1d1f");
    expect(inkOn("#ffff00")).toBe("#1d1d1f");
    expect(inkOn("#ffffff")).toBe("#1d1d1f");
    expect(inkOn("#1c1c80")).toBe("#ffffff");
    expect(inkOn("not a colour")).toBe("#ffffff");
  });
});
