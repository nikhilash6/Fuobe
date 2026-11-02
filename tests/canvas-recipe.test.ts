import { describe, expect, it } from "vitest";
import { canvasToRecipe, CANT_DRAW, recipeToCanvas } from "@/lib/catalog/canvas-recipe";
import type { CanvasGraph } from "@/lib/catalog/canvas";
import { RecipeSchema, recipeProblems, type Recipe } from "@/lib/recipe";

/** Skills W5: a skill's recipe drawn as a canvas and back, and a canvas (with a Table) turned into a skill's recipe. */

const photo = "/api/files/uploads/2026-11-01/lamp.png";

/** A portrait from words, then a clip from it, then a clip from a photo of the product: drawable as it is. */
const drawable = (): Recipe =>
  RecipeSchema.parse({
    fuobeRecipe: 1,
    params: [
      { id: "subject", label: "Subject", type: "text", required: true, example: "a ceramicist at her wheel" },
      { id: "product", label: "Product photo", type: "image", required: true, example: photo },
    ],
    steps: [
      { key: "portrait", label: "Portrait", kind: "generate", request: { feature: "skill", modelId: "nano-banana-pro", op: "t2i", prompt: "{{subject}}, editorial portrait", params: { aspectRatio: "4:5" } } },
      { key: "clip", label: "Clip", kind: "generate", after: "portrait", chain: [{ slot: "images" }], request: { feature: "skill", modelId: "kling-3", op: "i2v", prompt: "she looks up and smiles", params: { duration: 5 } } },
      { key: "still", label: "Product still", kind: "generate", request: { feature: "skill", modelId: "nano-banana-pro", op: "edit", prompt: "on a travertine plinth", inputs: { images: ["{{product}}"] } } },
    ],
  });

describe("a recipe as a canvas", () => {
  it("draws inputs as input nodes and steps as model nodes, with an edge per link, and comes back the same", () => {
    const recipe = drawable();
    const { graph, readOnly } = recipeToCanvas(recipe);
    expect(readOnly).toBeUndefined();
    expect(graph.nodes.map((n) => [n.id, n.type])).toEqual([
      ["in-subject", "prompt"],
      ["in-product", "image-input"],
      ["portrait", "model"],
      ["clip", "model"],
      ["still", "model"],
    ]);
    expect(graph.edges.map((e) => [e.source, e.target, e.targetHandle])).toEqual([
      ["in-subject", "portrait", "prompt"],
      ["portrait", "clip", "images"],
      ["in-product", "still", "images"],
    ]);
    // The input node shows the example; the model node's own words keep where the input goes.
    expect(graph.nodes[0].data.text).toBe("a ceramicist at her wheel");
    expect(graph.nodes[2].data.prompt).toBe("{text}, editorial portrait");
    const back = canvasToRecipe(graph);
    expect("error" in back).toBe(false);
    if ("error" in back) return;
    expect(back.refusals).toEqual([]);
    expect(back.recipe.params).toEqual(recipe.params);
    expect(back.recipe.steps).toEqual(recipe.steps);
    expect(recipeProblems(back.recipe)).toEqual([]);
  });

  it("takes a model swapped on the canvas back into the step", () => {
    const { graph } = recipeToCanvas(drawable());
    const node = graph.nodes.find((n) => n.id === "still")!;
    node.data.modelId = "seedream-5-pro";
    const back = canvasToRecipe(graph);
    if ("error" in back) throw new Error(back.error);
    expect(back.recipe.steps.find((s) => s.key === "still")).toMatchObject({ request: { modelId: "seedream-5-pro", inputs: { images: ["{{product}}"] } } });
  });

  it("opens read-only what it can't draw: a slot with no port, part of a result, several inputs in one prompt, a studio step", () => {
    const base = drawable();
    const audio2 = { ...base, steps: [{ ...base.steps[0], request: { ...(base.steps[0] as { request: object }).request, inputs: { audio2: photo } } }] } as Recipe;
    expect(recipeToCanvas(audio2).readOnly).toMatch(new RegExp(`^${CANT_DRAW}: step “portrait” takes audio2`));
    const position = { ...base, steps: [base.steps[0], { ...base.steps[1], chain: [{ slot: "images", position: "first" }] }] } as Recipe;
    expect(recipeToCanvas(position).readOnly).toMatch(/takes one part of an earlier result/);
    const words = { ...base, steps: [{ ...base.steps[0], request: { ...(base.steps[0] as { request: object }).request, prompt: "{{subject}} with {{product}}" } }] } as Recipe;
    expect(recipeToCanvas(words).readOnly).toMatch(/several inputs into its words/);
    const tool = RecipeSchema.parse({ fuobeRecipe: 1, params: [{ id: "video", label: "Video", type: "video", required: true }], steps: [{ key: "captions", kind: "tool", tool: "add_captions", input: { video: "{{video}}" } }] });
    const drawn = recipeToCanvas(tool);
    expect(drawn.graph.nodes.find((n) => n.id === "captions")).toMatchObject({ type: "note", data: { label: "Studio step" } });
  });
});

describe("a canvas as a recipe", () => {
  it("makes each model node a step, keeps files and words fixed, and a Table's columns inputs with its rows as runs", () => {
    const graph: CanvasGraph = {
      nodes: [
        { id: "t1", type: "table", position: { x: 0, y: 0 }, data: { columns: ["Product", "Colour"], rows: [["lamp", "red"], ["vase", "blue"], ["", ""]] } },
        { id: "img", type: "image-input", position: { x: 0, y: 300 }, data: { url: photo } },
        { id: "m1", type: "model", position: { x: 400, y: 0 }, data: { modelId: "nano-banana-pro", op: "edit", prompt: "a {Colour} {Product} on a plinth" } },
        { id: "note", type: "note", position: { x: 0, y: 600 }, data: { text: "not run" } },
      ],
      edges: [
        { id: "e1", source: "t1", target: "m1", sourceHandle: "out", targetHandle: "prompt" },
        { id: "e2", source: "img", target: "m1", sourceHandle: "out", targetHandle: "images" },
      ],
    };
    const out = canvasToRecipe(graph, { id: "cv1" });
    if ("error" in out) throw new Error(out.error);
    expect(out.recipe.params.map((p) => [p.id, p.type, p.example])).toEqual([
      ["Product", "text", "lamp"],
      ["Colour", "text", "red"],
    ]);
    expect(out.recipe.steps).toEqual([{ key: "m1", kind: "generate", request: expect.objectContaining({ feature: "skill", modelId: "nano-banana-pro", op: "edit", inputs: { images: [photo] } }) }]);
    expect((out.recipe.steps[0] as { request: { prompt: string } }).request.prompt).toContain("a {{Colour}} {{Product}} on a plinth");
    expect(out.rows).toEqual([
      { Product: "lamp", Colour: "red" },
      { Product: "vase", Colour: "blue" },
    ]);
    expect(out.recipe.source).toMatchObject({ from: "canvas", canvas: "cv1" });
    expect(out.nodes).toEqual({ m1: "m1" });
  });

  it("says why a canvas with nothing to run can't be a skill", () => {
    expect(canvasToRecipe({ nodes: [{ id: "p", type: "prompt", position: { x: 0, y: 0 }, data: { text: "hi" } }], edges: [] })).toEqual({ error: "Add a model node first: a skill needs a step" });
  });
});
