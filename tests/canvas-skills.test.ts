import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Route handlers call connection() (no request scope in a test).
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 120_000 });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-canvas-skills-"));
process.env.FUOBE_DATA_DIR = dir;
// Nothing listens: open models run on the demo provider, and there's no LLM.
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const { saveFile } = await import("@/server/storage");
const { encodePng } = await import("@/server/png");
const { createCanvas, getCanvas, updateCanvas } = await import("@/server/canvas");
const recipes = await import("@/server/recipes");
const skills = await import("@/server/skills");
const gens = await import("@/server/generations");
const { buildRecipe } = await import("@/lib/recipe-builder");
const { CANT_DRAW, recipeShape } = await import("@/lib/catalog/canvas");
const canvasesRoute = await import("@/app/api/canvases/route");
const draftRoute = await import("@/app/api/assist/skills/draft/route");
const saveRoute = await import("@/app/api/assist/skills/draft/save/route");
type Recipe = import("@/lib/recipe").Recipe;
type SkillDraft = import("@/lib/recipe-builder").SkillDraft;

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const post = (url: string, body: unknown) => new Request(`http://localhost:3000${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

let photo = "";
let turntable: Recipe;
beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
  photo = saveFile({ data: encodePng({ width: 64, height: 48, data: Buffer.alloc(64 * 48 * 4, 180) }), contentType: "image/png", source: "upload", name: "lamp.png" }).url;
  turntable = {
    fuobeRecipe: 1,
    params: [
      { id: "product", label: "Product photo", type: "image", required: true, example: photo },
      { id: "name", label: "Product name", type: "text", required: true, example: "Lumen desk lamp", max: 200 },
    ],
    steps: [
      { key: "cutout", kind: "generate", label: "Cut out", request: { feature: "skill", modelId: "birefnet-cloud", op: "bg-remove", inputs: { images: ["{{product}}"] } } },
      { key: "scene", kind: "generate", after: ["cutout"], chain: [{ slot: "images" }], request: { feature: "skill", modelId: "nano-banana-pro", op: "edit", prompt: "{{name}} on a travertine plinth", params: { aspectRatio: "1:1" } } },
    ],
    checks: { scene: { kind: "image", count: 1, aspect: "1:1" } },
  };
  skills.createSkill({ name: "lamp-scene", title: "Lamp scene", description: "A product on a plinth.", body: "# Lamp scene" });
  recipes.saveRecipe("lamp-scene", turntable);
  skills.createSkill({ name: "caption-it", title: "Caption it", description: "Caption a clip.", body: "# Caption it" });
  recipes.saveRecipe("caption-it", { fuobeRecipe: 1, params: [], steps: [{ key: "captions", kind: "tool", tool: "add_captions", input: { video: photo.replace(".png", ".mp4") } }] });
});

const draftOf = async (canvas: string) => {
  const r = await draftRoute.POST(post("/api/assist/skills/draft", { canvas }));
  expect(r.status).toBe(200);
  return (await r.json()) as { draft: SkillDraft | null; refusals: { reason: string }[] };
};
/** The review screen's starting choices: what starts as Varies. */
const startChoices = (d: SkillDraft) => ({ varies: Object.fromEntries(d.candidates.filter((c) => c.varies).map((c) => [c.id, true])) });

describe("Open as canvas", () => {
  it("makes a new canvas with the skill drawn on it", async () => {
    const r = await canvasesRoute.POST(post("/api/canvases", { skill: "lamp-scene" }));
    expect(r.status).toBe(201);
    const c = await r.json();
    expect(c.name).toBe("Lamp scene");
    const g = c.pages[0].graph;
    expect(g.nodes.map((n: { id: string }) => n.id).sort()).toEqual(["input-name", "input-product", "step-cutout", "step-scene"]);
    // What the board has no field for survives the canvases route's checks.
    expect(g.nodes.find((n: { id: string }) => n.id === "step-scene").data.skill).toMatchObject({ key: "scene", from: "lamp-scene", check: { kind: "image" } });
  });

  it("refuses a skill that can't be drawn, saying so", async () => {
    const r = await canvasesRoute.POST(post("/api/canvases", { skill: "caption-it" }));
    expect(r.status).toBe(422);
    expect((await r.json()).error).toMatch(new RegExp(`^${CANT_DRAW}`));
    expect((await canvasesRoute.POST(post("/api/canvases", { skill: "nope" }))).status).toBe(404);
    // The Skills tab reads the same answer from the skill's recipe view.
    expect(recipes.recipeView("caption-it").canvas).toMatchObject({ ok: false, studio: "Captions" });
    expect(recipes.recipeView("lamp-scene").canvas).toEqual({ ok: true });
  });
});

describe("Save as skill from a canvas", () => {
  it("drafts a skill opened as a canvas with its inputs Varies, and saves a swapped model back into it", async () => {
    const c = await (await canvasesRoute.POST(post("/api/canvases", { skill: "lamp-scene" }))).json();
    const { draft } = await draftOf(c.id);
    expect(draft!.replaces).toEqual({ name: "lamp-scene", title: "Lamp scene" });
    expect(draft!.name).toBe("lamp-scene-2");
    expect(draft!.recipe.params).toEqual([]);
    expect(draft!.candidates.map((x) => [x.id, x.kind, x.varies])).toEqual([
      ["product", "media", true],
      ["name", "text", true],
    ]);
    // As it starts, the review screen builds the skill it was drawn from.
    const built = buildRecipe(draft!, startChoices(draft!));
    expect(built.steps).toEqual(turntable.steps);

    // Swap the scene's model on the board, then save it back.
    const graph = getCanvas(c.id)!.pages[0].graph;
    updateCanvas(c.id, { graph: { ...graph, nodes: graph.nodes.map((n) => (n.id === "step-scene" ? { ...n, data: { ...n.data, modelId: "qwen-image-edit-2511-cloud" } } : n)) } });
    const again = (await draftOf(c.id)).draft!;
    const recipe = buildRecipe(again, startChoices(again));
    const saved = await saveRoute.POST(post("/api/assist/skills/draft/save", { name: "lamp-scene", title: "Lamp scene", description: "A product on a plinth.", body: "# Lamp scene", recipe, replace: true }));
    expect(saved.status).toBe(201);
    const now = recipes.getRecipe("lamp-scene");
    expect((now.recipe.steps[1] as { request: { modelId: string } }).request.modelId).toBe("qwen-image-edit-2511-cloud");
    expect(now.skill.body).toBe("# Lamp scene");
    expect(now.recipe.verified?.cloud?.plan).toBeTruthy();
    // A built-in or a skill that's gone isn't replaced.
    const refused = await saveRoute.POST(post("/api/assist/skills/draft/save", { name: "product-photoshoot", title: "x", description: "x", body: "x", recipe, replace: true }));
    expect(refused.status).toBe(403);
  });

  it("drafts a board made on the Canvas with every input Fixed, and a Table's rows for the Many tab; it then runs from its form", async () => {
    const c = createCanvas({
      name: "Fox posters",
      graph: {
        nodes: [
          { id: "t", type: "table", position: { x: 0, y: 0 }, data: { columns: ["Animal"], rows: [["fox"], ["owl"]] } },
          { id: "img", type: "image-input", position: { x: 0, y: 200 }, data: { url: photo } },
          { id: "m", type: "model", position: { x: 400, y: 0 }, data: { modelId: "nano-banana-pro", op: "edit", prompt: "a {Animal} poster in this style" } },
        ],
        edges: [
          { id: "e1", source: "t", target: "m", sourceHandle: "out", targetHandle: "prompt" },
          { id: "e2", source: "img", target: "m", sourceHandle: "out", targetHandle: "images" },
        ],
      },
    });
    const { draft } = await draftOf(c.id);
    expect(draft!.replaces).toBeUndefined();
    expect(draft!.name).toBe("fox-posters");
    expect(draft!.candidates.map((x) => [x.id, x.varies ?? false, x.part ?? false])).toEqual([
      ["image", false, false],
      ["animal", true, true],
    ]);
    expect(draft!.rows).toEqual([{ animal: "fox" }, { animal: "owl" }]);
    expect((draft!.recipe.steps[0] as { request: { prompt: string } }).request.prompt).toBe("a fox poster in this style");
    const recipe = buildRecipe(draft!, startChoices(draft!));
    expect((recipe.steps[0] as { request: { prompt: string } }).request.prompt).toBe("a {{animal}} poster in this style");
    const saved = await saveRoute.POST(post("/api/assist/skills/draft/save", { name: draft!.name, title: draft!.title, description: draft!.description, body: "# Fox posters", recipe }));
    expect(saved.status).toBe(201);
    expect(recipes.getRecipe("fox-posters").recipe.source).toMatchObject({ from: "canvas", canvas: c.id });
    // Run from its form, once per row: two runs of one step each, stamped with the skill.
    const out = await recipes.runRecipe("fox-posters", { rows: draft!.rows });
    expect(out.runs).toHaveLength(2);
    const g = gens.getGeneration(out.runs[0].ids[0])!;
    expect(g.request.prompt).toBe("a fox poster in this style");
    expect(g.request.skill).toMatchObject({ name: "fox-posters" });
  });

  it("names a node that can't run", async () => {
    const c = createCanvas({ name: "Broken", graph: { nodes: [{ id: "m", type: "model", position: { x: 0, y: 0 }, data: { modelId: "kling-3", op: "i2v" } }], edges: [] } });
    const { draft, refusals } = await draftOf(c.id);
    expect(draft).toBeNull();
    expect(refusals[0]).toMatchObject({ id: "m" });
    expect((await draftRoute.POST(post("/api/assist/skills/draft", { canvas: "nope" }))).status).toBe(404);
  });

  it("draws a skill made from a canvas the same way back", async () => {
    const r = recipes.getRecipe("lamp-scene").recipe;
    const c = await (await canvasesRoute.POST(post("/api/canvases", { skill: "lamp-scene" }))).json();
    const { draft } = await draftOf(c.id);
    expect(recipeShape(buildRecipe(draft!, startChoices(draft!)))).toBe(recipeShape({ ...r, checks: r.checks }));
  });

  it("saves back a skill's inputs a canvas holds no value for: words with no example, and settings", async () => {
    skills.createSkill({ name: "fox-shots", title: "Fox shots", description: "Shots of anything.", body: "# Fox shots" });
    recipes.saveRecipe("fox-shots", {
      fuobeRecipe: 1,
      params: [
        { id: "subject", label: "Subject", type: "text", required: true },
        { id: "takes", label: "Takes", type: "number", default: 1, min: 1, max: 4 },
      ],
      steps: [{ key: "a", kind: "generate", request: { feature: "skill", modelId: "nano-banana-pro", op: "t2i", prompt: "A photo of {{subject}}", params: { numOutputs: "{{takes}}" as unknown as number } } }],
      checks: { a: { kind: "image", count: "{{takes}}" } },
    });
    expect(recipes.recipeView("fox-shots").canvas).toEqual({ ok: true });
    const c = await (await canvasesRoute.POST(post("/api/canvases", { skill: "fox-shots" }))).json();
    const { draft } = await draftOf(c.id);
    expect(draft!.candidates.map((x) => [x.id, x.varies ?? false, x.locked ?? null])).toEqual([
      ["subject", true, null],
      ["takes", true, null],
    ]);
    const recipe = buildRecipe(draft!, startChoices(draft!));
    const saved = await saveRoute.POST(post("/api/assist/skills/draft/save", { name: "fox-shots", title: "Fox shots", description: "Shots of anything.", body: "# Fox shots", recipe, replace: true }));
    expect(saved.status).toBe(201);
    const now = recipes.getRecipe("fox-shots").recipe;
    expect(now.params.map((p) => p.id).sort()).toEqual(["subject", "takes"]);
    expect((now.steps[0] as { request: { prompt: string; params: object } }).request).toMatchObject({ prompt: "A photo of {{subject}}", params: { numOutputs: "{{takes}}" } });
    expect(now.checks).toEqual({ a: { kind: "image", count: "{{takes}}" } });
  });
});
