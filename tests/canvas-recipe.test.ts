import { describe, expect, it } from "vitest";
import { CANT_DRAW, canvasToRecipe, recipeShape, recipeToCanvas, TABLE_LIMITS, type CanvasGraph } from "@/lib/catalog/canvas";
import { RecipeSchema, recipeProblems, type Recipe } from "@/lib/recipe";
import { buildRecipe, fixedDraft } from "@/lib/recipe-builder";

/** Skills as canvases (W5): a recipe drawn as a board and read back, a board as a recipe, and what isn't drawn. */

const recipe = (r: Omit<Recipe, "fuobeRecipe">): Recipe => RecipeSchema.parse({ fuobeRecipe: 1, ...r });

/** Cut-out → scene → turntable: a file and words in, a chain of three steps, a check on the last. */
const turntable = recipe({
  params: [
    { id: "product", label: "Product photo", type: "image", required: true, example: "/api/files/uploads/lamp.png" },
    { id: "name", label: "Product name", type: "text", required: true, example: "Lumen desk lamp", max: 200 },
  ],
  steps: [
    { key: "cutout", kind: "generate", label: "Cut out", request: { feature: "skill", modelId: "birefnet-cloud", op: "bg-remove", inputs: { images: ["{{product}}"] } } },
    {
      key: "scene",
      kind: "generate",
      after: ["cutout"],
      chain: [{ slot: "images" }],
      request: { feature: "skill", modelId: "nano-banana-pro", op: "edit", prompt: "{{name}} on a travertine plinth, soft window light", params: { aspectRatio: "1:1" } },
    },
    {
      key: "spin",
      kind: "generate",
      after: ["scene"],
      chain: [{ slot: "images" }],
      request: { feature: "image", modelId: "kling-3", op: "i2v", prompt: "slow turntable of the product", negativePrompt: "blur", params: { duration: 5, enhancePrompt: false } },
    },
  ],
  checks: { spin: { kind: "video", count: 1, aspect: "1:1" } },
});

const drawn = (r: Recipe): CanvasGraph => {
  const d = recipeToCanvas(r);
  if (!d.ok) throw new Error(`${d.reason}: ${d.detail}`);
  return d.graph;
};

describe("recipe → canvas → recipe", () => {
  it("draws inputs as input nodes and steps as model nodes wired by their chain slots", () => {
    const g = drawn(turntable);
    expect(g.nodes.filter((n) => n.type === "model")).toHaveLength(3);
    expect(g.nodes.find((n) => n.id === "input-product")).toMatchObject({ type: "image-input", data: { url: "/api/files/uploads/lamp.png", label: "Product photo" } });
    expect(g.nodes.find((n) => n.id === "input-name")).toMatchObject({ type: "prompt", data: { text: "Lumen desk lamp" } });
    // The words are the node's own, the input joins them where it was.
    expect(g.nodes.find((n) => n.id === "step-scene")!.data.prompt).toBe("{text} on a travertine plinth, soft window light");
    expect(g.edges.map((e) => `${e.source}>${e.target}:${e.targetHandle}`).sort()).toEqual(
      ["input-name>step-scene:prompt", "input-product>step-cutout:images", "step-cutout>step-scene:images", "step-scene>step-spin:images"].sort(),
    );
  });

  it("comes back as the same recipe (keys, labels, features, extras and checks included)", () => {
    const back = canvasToRecipe(drawn(turntable));
    expect(back.problems).toEqual([]);
    expect(recipeShape(back.recipe!)).toBe(recipeShape(turntable));
    expect(back.recipe!.steps).toEqual(turntable.steps);
    expect(back.recipe!.params).toEqual(turntable.params);
    expect(back.recipe!.checks).toEqual(turntable.checks);
    expect(back.varies.sort()).toEqual(["name", "product"]);
    expect(recipeProblems(back.recipe!)).toEqual([]);
  });

  it("keeps a fixed file fixed, an element as its node, two texts in order, and a model swapped on the board", () => {
    const r = recipe({
      params: [
        { id: "who", label: "Who", type: "element", required: true, example: "@Maya" },
        { id: "place", label: "Place", type: "text", required: true, example: "a rooftop in Lisbon" },
        { id: "mood", label: "Mood", type: "text", example: "golden hour" },
      ],
      steps: [
        {
          key: "still",
          kind: "generate",
          request: { feature: "skill", modelId: "nano-banana-pro", op: "edit", prompt: "{{who}} stands on {{place}}\n\n{{mood}}", inputs: { images: ["/api/files/uploads/logo.png"] } },
        },
      ],
    });
    const g = drawn(r);
    expect(g.nodes.find((n) => n.type === "element")).toMatchObject({ data: { handle: "Maya" } });
    expect(g.nodes.find((n) => n.id === "file-1")).toMatchObject({ type: "image-input", data: { input: { fixed: true } } });
    const back = canvasToRecipe(g);
    expect(back.recipe!.steps).toEqual(r.steps);
    expect(back.recipe!.params).toEqual(r.params);
    // Swapping the model on the board: the request follows the new model.
    const swapped = { ...g, nodes: g.nodes.map((n) => (n.type === "model" ? { ...n, data: { ...n.data, modelId: "qwen-image-edit-2511-cloud" } } : n)) };
    expect((canvasToRecipe(swapped).recipe!.steps[0] as { request: { modelId: string } }).request.modelId).toBe("qwen-image-edit-2511-cloud");
  });
});

describe("what isn't drawn", () => {
  const base = turntable.steps[1] as Extract<Recipe["steps"][number], { kind: "generate" }>;
  const refused = (r: Recipe) => {
    const d = recipeToCanvas(r);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe(CANT_DRAW);
    return d.ok ? "" : d.detail;
  };
  const withStep = (patch: object, params = turntable.params) => recipe({ params, steps: [turntable.steps[0], { ...base, ...patch } as Recipe["steps"][number]] });

  it.each([
    ["audio2", { chain: [{ slot: "audio2" }] }],
    ["audios", { chain: [{ slot: "audios" }] }],
    ["model3d", { chain: [{ slot: "model3d" }] }],
    ["mask", { chain: [{ slot: "mask" }] }],
    ["a stem", { chain: [{ slot: "audio", stem: "music" }] }],
    ["an index", { chain: [{ slot: "images", index: 0 }] }],
    ["a position", { chain: [{ slot: "images", position: "first" }] }],
  ])("a chain slot with %s", (_, patch) => {
    expect(refused(withStep(patch))).toMatch(/can't wire yet/);
  });

  it("a step that takes an earlier step's result by reference (recipe version 2)", () => {
    const r = withStep({ request: { ...base.request, inputs: { images: ["{{steps.cutout.output}}"] } } });
    expect(refused({ ...r, fuobeRecipe: 2 })).toMatch(/by reference, which a canvas can't wire yet/);
  });

  it("an input a canvas has no port for", () => {
    expect(refused(withStep({ request: { ...base.request, inputs: { mask: "/api/files/m.png" } } }))).toMatch(/no port/);
  });

  it("a settings input (a number or a choice) that isn't a whole setting, or has no value to show", () => {
    const inWords = recipe({
      params: [{ id: "takes", label: "Takes", type: "number", default: 1, min: 1, max: 4 }],
      steps: [{ key: "a", kind: "generate", request: { feature: "skill", modelId: "nano-banana-pro", op: "t2i", prompt: "a lamp, {{takes}} takes" } }],
    });
    expect(refused(inWords)).toMatch(/no node for Takes/);
    const blank = recipe({
      params: [{ id: "shape", label: "Shape", type: "choice", options: ["1:1", "16:9"] }],
      steps: [{ key: "a", kind: "generate", request: { feature: "skill", modelId: "nano-banana-pro", op: "t2i", prompt: "a lamp", params: { aspectRatio: "{{shape}}" as unknown as string } } }],
    });
    expect(refused(blank)).toMatch(/Give Shape a default first/);
  });

  it("a studio step shows as one note, never nodes", () => {
    const r = recipe({ params: [], steps: [{ key: "dub", kind: "tool", tool: "dub_video", input: { video: "/api/files/a.mp4", language: "es" } }] });
    const d = recipeToCanvas(r);
    expect(d).toMatchObject({ ok: false, reason: CANT_DRAW, studio: "dub_video" });
  });

  it("two text inputs apart in one prompt", () => {
    const r = recipe({
      params: [
        { id: "a", label: "A", type: "text", example: "x" },
        { id: "b", label: "B", type: "text", example: "y" },
      ],
      steps: [{ key: "s", kind: "generate", request: { feature: "skill", modelId: "nano-banana-pro", op: "t2i", prompt: "{{a}} next to {{b}}" } }],
    });
    expect(refused(r)).toMatch(/apart/);
  });
});

describe("canvas → recipe", () => {
  const board = (nodes: CanvasGraph["nodes"], edges: [string, string, string][]): CanvasGraph => ({
    nodes,
    edges: edges.map(([source, target, targetHandle]) => ({ id: `${source}-${target}-${targetHandle}`, source, target, sourceHandle: "out", targetHandle })),
  });

  it("makes unconnected input nodes inputs and model nodes steps", () => {
    const g = board(
      [
        { id: "p", type: "prompt", position: { x: 0, y: 0 }, data: { text: "a red fox in snow" } },
        { id: "img", type: "image-input", position: { x: 0, y: 200 }, data: { url: "/api/files/uploads/fox.png" } },
        { id: "m", type: "model", position: { x: 400, y: 0 }, data: { modelId: "nano-banana-pro", op: "edit" } },
        { id: "v", type: "model", position: { x: 800, y: 0 }, data: { modelId: "kling-3", op: "i2v", prompt: "it runs" } },
      ],
      [
        ["p", "m", "prompt"],
        ["img", "m", "images"],
        ["m", "v", "images"],
      ],
    );
    const { recipe: r, problems, varies } = canvasToRecipe(g, { canvas: "c1" });
    expect(problems).toEqual([]);
    expect(varies).toEqual([]);
    expect(r!.params.map((p) => [p.id, p.type, p.example])).toEqual([
      ["text_prompt", "text", "a red fox in snow"],
      ["image", "image", "/api/files/uploads/fox.png"],
    ]);
    expect(r!.steps).toMatchObject([
      { key: "nano-banana-pro", request: { feature: "skill", modelId: "nano-banana-pro", op: "edit", prompt: "{{text_prompt}}", inputs: { images: ["{{image}}"] } } },
      { key: "kling-3-0", after: ["nano-banana-pro"], chain: [{ slot: "images" }], request: { modelId: "kling-3", op: "i2v", prompt: "it runs" } },
    ]);
    expect(r!.checks).toEqual({ "kling-3-0": { kind: "video" } });
    expect(r!.source).toEqual({ from: "canvas", canvas: "c1" });
    expect(recipeProblems(r!)).toEqual([]);
    // The draft starts with every input Fixed: the recipe as it ran, and the inputs that could vary.
    const draft = fixedDraft(r!, varies);
    expect(draft.recipe.params).toEqual([]);
    expect((draft.recipe.steps[0] as { request: { prompt: string } }).request.prompt).toBe("a red fox in snow");
    expect(draft.candidates.map((c) => [c.id, c.kind, c.varies ?? false])).toEqual([
      ["text_prompt", "text", false],
      ["image", "media", false],
    ]);
    expect(buildRecipe(draft, { varies: { image: true, text_prompt: true } }).steps).toEqual(r!.steps);
  });

  it("turns a Table's columns into text inputs and its rows into the Many tab's rows", () => {
    const g = board(
      [
        { id: "t", type: "table", position: { x: 0, y: 0 }, data: { columns: ["Animal", "Place"], rows: [["fox", "snow"], ["owl", "forest"], ["", ""]] } },
        { id: "m", type: "model", position: { x: 400, y: 0 }, data: { modelId: "nano-banana-pro", op: "t2i", prompt: "a {Animal} in the {Place}" } },
      ],
      [["t", "m", "prompt"]],
    );
    const { recipe: r, rows, varies, problems } = canvasToRecipe(g);
    expect(problems).toEqual([]);
    expect(r!.params.map((p) => p.id)).toEqual(["animal", "place"]);
    expect((r!.steps[0] as { request: { prompt: string } }).request.prompt).toBe("a {{animal}} in the {{place}}");
    expect(rows).toEqual([
      { animal: "fox", place: "snow" },
      { animal: "owl", place: "forest" },
    ]);
    expect(varies).toEqual(["animal", "place"]);
  });

  it("reads a table as text when no column is named, and refuses more rows than a run takes", () => {
    const many = Array.from({ length: TABLE_LIMITS.rows + 1 }, (_, i) => [`row ${i}`]);
    const g = board(
      [
        { id: "t", type: "table", position: { x: 0, y: 0 }, data: { columns: ["Subject"], rows: many } },
        { id: "m", type: "model", position: { x: 400, y: 0 }, data: { modelId: "nano-banana-pro", op: "t2i" } },
      ],
      [["t", "m", "prompt"]],
    );
    expect(canvasToRecipe(g).problems[0].message).toMatch(/up to 50/);
    const ok = canvasToRecipe({ ...g, nodes: g.nodes.map((n) => (n.id === "t" ? { ...n, data: { ...n.data, rows: many.slice(0, 2) } } : n)) });
    expect((ok.recipe!.steps[0] as { request: { prompt: string } }).request.prompt).toBe("{{subject}}");
    expect(ok.rows).toEqual([{ subject: "row 0" }, { subject: "row 1" }]);
  });

  it("names a node that can't run, and a board with no model", () => {
    expect(canvasToRecipe({ nodes: [], edges: [] }).problems[0].message).toMatch(/Add a model/);
    const g = board([{ id: "m", type: "model", position: { x: 0, y: 0 }, data: { modelId: "kling-3", op: "i2v" } }], []);
    const out = canvasToRecipe(g);
    expect(out.recipe).toBeNull();
    expect(out.problems[0]).toMatchObject({ nodeId: "m" });
  });
});

describe("settings inputs ride on their nodes", () => {
  /** What W2 makes when the takes and the shape vary: optional inputs with defaults, followed by the step's check. */
  const posters = recipe({
    params: [
      { id: "subject", label: "Subject", type: "text", required: true, example: "a red fox" },
      { id: "takes", label: "Takes", type: "number", default: 2, min: 1, max: 4, step: 1 },
      { id: "shape", label: "Shape", type: "choice", default: "1:1", options: ["1:1", "16:9", "9:16"] },
    ],
    steps: [
      {
        key: "poster",
        kind: "generate",
        request: { feature: "skill", modelId: "nano-banana-pro", op: "t2i", prompt: "{{subject}}, poster style", params: { numOutputs: "{{takes}}" as unknown as number, aspectRatio: "{{shape}}" as unknown as string } },
      },
    ],
    checks: { poster: { kind: "image", count: "{{takes}}", aspect: "{{shape}}" } },
  });
  const node = (g: CanvasGraph) => g.nodes.find((n) => n.id === "step-poster")!;
  const withParams = (g: CanvasGraph, patch: object, data: object = {}): CanvasGraph => ({
    ...g,
    nodes: g.nodes.map((n) => (n.id === "step-poster" ? { ...n, data: { ...n.data, ...data, params: { ...n.data.params, ...patch } } } : n)),
  });

  it("draws the values on the node and comes back as the same recipe", () => {
    const g = drawn(posters);
    expect(node(g).data.params).toMatchObject({ numOutputs: 2, aspectRatio: "1:1" });
    const back = canvasToRecipe(g);
    expect(back.problems).toEqual([]);
    expect(recipeShape(back.recipe!)).toBe(recipeShape(posters));
    expect(back.varies.sort()).toEqual(["shape", "subject", "takes"]);
  });

  it("follows a value changed on the board, and lets go of one the input doesn't take or a swapped model", () => {
    const changed = canvasToRecipe(withParams(drawn(posters), { aspectRatio: "16:9" })).recipe!;
    expect(changed.params.find((p) => p.id === "shape")).toMatchObject({ default: "16:9" });
    expect((changed.steps[0] as { request: { params: object } }).request.params).toMatchObject({ aspectRatio: "{{shape}}" });
    // 21:9 isn't one of the input's options: the setting stays as the board has it, and the check stops following it.
    const out = canvasToRecipe(withParams(drawn(posters), { aspectRatio: "21:9" })).recipe!;
    expect(out.params.map((p) => p.id)).toEqual(["subject", "takes"]);
    expect((out.steps[0] as { request: { params: object } }).request.params).toMatchObject({ aspectRatio: "21:9", numOutputs: "{{takes}}" });
    expect(out.checks).toEqual({ poster: { kind: "image", count: "{{takes}}" } });
    expect(recipeProblems(out)).toEqual([]);
    const swapped = canvasToRecipe(withParams(drawn(posters), {}, { modelId: "qwen-image-2512-cloud" })).recipe;
    expect(swapped!.params.map((p) => p.id)).toEqual(["subject"]);
  });

  it("starts as Varies in the review and saves back as the skill had it; Fixed puts the value in the steps and checks", () => {
    const back = canvasToRecipe(drawn(posters));
    const draft = fixedDraft(back.recipe!, back.varies);
    const takes = draft.candidates.find((c) => c.id === "takes")!;
    expect(takes).toMatchObject({ kind: "setting", kept: true, varies: true, optional: true, example: 2 });
    const start = buildRecipe(draft, { varies: Object.fromEntries(draft.candidates.filter((c) => c.varies).map((c) => [c.id, true])) });
    expect(start.steps).toEqual(posters.steps);
    expect(start.checks).toEqual(posters.checks);
    expect([...start.params].sort((a, b) => a.id.localeCompare(b.id))).toEqual([...posters.params].sort((a, b) => a.id.localeCompare(b.id)));
    const fixed = buildRecipe(draft, { varies: { subject: true, shape: true } });
    expect((fixed.steps[0] as { request: { params: object } }).request.params).toEqual({ numOutputs: 2, aspectRatio: "{{shape}}" });
    expect(fixed.checks).toEqual({ poster: { kind: "image", count: 2, aspect: "{{shape}}" } });
    expect(recipeProblems(fixed)).toEqual([]);
  });
});

describe("the way back keeps what the skill asks for", () => {
  it("keeps words a skill asks for with no example as an input, and Fixed leaves them empty", () => {
    const r = recipe({
      params: [{ id: "subject", label: "Subject", type: "text", required: true }],
      steps: [{ key: "a", kind: "generate", request: { feature: "skill", modelId: "nano-banana-pro", op: "t2i", prompt: "A photo of {{subject}}" } }],
    });
    const back = canvasToRecipe(drawn(r));
    const draft = fixedDraft(back.recipe!, back.varies);
    expect(draft.candidates[0]).toMatchObject({ id: "subject", kept: true, varies: true });
    expect(draft.candidates[0].locked).toBeUndefined();
    const start = buildRecipe(draft, { varies: { subject: true } });
    expect(start.params).toEqual(r.params);
    expect(start.steps).toEqual(r.steps);
    const fixed = buildRecipe(draft, { varies: {} });
    expect(fixed.params).toEqual([]);
    expect((fixed.steps[0] as { request: { prompt: string } }).request.prompt).toBe("A photo of ");
  });

  it("drops a step's check when its model is swapped for one that makes something else", () => {
    const r = recipe({
      params: [{ id: "subject", label: "Subject", type: "text", required: true, example: "a lamp" }],
      steps: [{ key: "a", kind: "generate", request: { feature: "skill", modelId: "nano-banana-pro", op: "t2i", prompt: "{{subject}}" } }],
      checks: { a: { kind: "image", count: 1 } },
    });
    const g = drawn(r);
    expect(canvasToRecipe(g).recipe!.checks).toEqual(r.checks);
    const video: CanvasGraph = { ...g, nodes: g.nodes.map((n) => (n.type === "model" ? { ...n, data: { ...n.data, modelId: "kling-3", op: "t2v" as const, mediaKind: "video" as const } } : n)) };
    const out = canvasToRecipe(video);
    expect(out.problems).toEqual([]);
    expect(out.recipe!.checks).toEqual({ a: { kind: "video" } });
    // A skill whose step had no check gets none on the way back while its model stays.
    const none = recipe({ ...r, checks: undefined });
    expect(canvasToRecipe(drawn(none)).recipe!.checks).toBeUndefined();
  });
});

describe("a Video concatenator", () => {
  it("compiles to its cuts and join as a run of the board does, with its clips as inputs", () => {
    const g: CanvasGraph = {
      nodes: [
        { id: "a", type: "video-input", position: { x: 0, y: 0 }, data: { url: "/api/files/uploads/a.mp4", label: "First clip" } },
        { id: "b", type: "video-input", position: { x: 0, y: 200 }, data: { url: "/api/files/uploads/b.mp4", label: "Second clip" } },
        { id: "f", type: "concat", position: { x: 400, y: 0 }, data: { label: "Film", modelId: "oss-join-encoded", params: { aspectRatio: "16:9" }, clips: { a: { start: 1, end: 3, mute: true } } } },
      ],
      edges: [
        { id: "e1", source: "a", sourceHandle: "out", target: "f", targetHandle: "videos" },
        { id: "e2", source: "b", sourceHandle: "out", target: "f", targetHandle: "videos" },
      ],
    };
    const out = canvasToRecipe(g);
    expect(out.problems).toEqual([]);
    const r = out.recipe!;
    expect(r.params.map((p) => [p.id, p.type])).toEqual([
      ["first_clip", "video"],
      ["second_clip", "video"],
    ]);
    expect(r.steps.length).toBeGreaterThan(1);
    const steps = r.steps as Extract<Recipe["steps"][number], { kind: "generate" }>[];
    // The join is the node's own step (its label and the skill's feature); every cut before it is a helper step.
    const join = steps.find((s) => s.label === "Film")!;
    expect(join.request).toMatchObject({ feature: "skill", modelId: "oss-join-encoded" });
    expect(steps.filter((s) => s !== join).every((s) => s.request.feature === "canvas-step")).toBe(true);
    expect(steps.indexOf(join)).toBe(steps.length - 1);
    // Each clip reaches a cut through its input, and the first clip keeps its window.
    expect(JSON.stringify(steps)).toContain("{{first_clip}}");
    expect(JSON.stringify(steps)).toContain("{{second_clip}}");
    expect(recipeProblems(r)).toEqual([]);
    expect(RecipeSchema.safeParse(r).success).toBe(true);
  });
});
