import { beforeAll, describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 60_000 });

/**
 * Skills W6: Fuobe notices a chain of steps made again and again (the same models, operations and links, whatever the
 * words and files) and offers to save it as a skill, at most once a day, until it's saved or dismissed.
 */

const dir = tempDir("fuobe-skill-suggest-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const { createPipeline } = await import("@/server/chains");
const insights = await import("@/server/skill-insights");
const skills = await import("@/server/skills");
const recipes = await import("@/server/recipes");
const { db } = await import("@/server/db");
const { saveFile } = await import("@/server/storage");
const { encodePng } = await import("@/server/png");
const { shapeOf, recipeShapeNodes } = await import("@/lib/recipe");
const route = await import("@/app/api/skill-suggestions/route");

let photo = "";
beforeAll(() => {
  setSetting("demoMode", "auto");
  photo = saveFile({ data: encodePng({ width: 32, height: 32, data: Buffer.alloc(32 * 32 * 4, 150) }), contentType: "image/png", source: "upload", name: "p.png" }).url;
});

/** Cut-out → scene → turntable, with its own words and photo each time; its rows marked done (the sweep reads those). */
function turntable(words: string, o: { feature?: string; at?: number } = {}) {
  const feature = o.feature ?? "image";
  const p = createPipeline([
    { key: "cut", request: { feature, modelId: "birefnet-cloud", op: "bg-remove", inputs: { images: [photo] } } },
    { key: "scene", after: "cut", chain: [{ slot: "images", position: "first" }], request: { feature, modelId: "nano-banana-pro", op: "edit", prompt: `${words} on a plinth` } },
    { key: "spin", after: "scene", chain: [{ slot: "images" }], request: { feature, modelId: "kling-3", op: "i2v", prompt: `${words} turning`, params: { duration: 5 } } },
  ]);
  const ids = p.items.map((g) => g.id);
  db()
    .prepare(`UPDATE generations SET status = 'succeeded', outputs_json = '[]', created_at = COALESCE(?, created_at) WHERE id IN (${ids.map(() => "?").join(", ")})`)
    .run(o.at ?? null, ...ids);
  return p;
}

const clear = () => db().exec("DELETE FROM generations; DELETE FROM settings WHERE key = 'skills.suggestions'");

describe("the shape of a chain", () => {
  it("is the same for the same chain with other words and files, and differs with another model or link", () => {
    const a = shapeOf([
      { id: "1", modelId: "birefnet-cloud", op: "bg-remove", after: [] },
      { id: "2", modelId: "nano-banana-pro", op: "edit", after: ["1"], slots: ["images"] },
    ]);
    const b = shapeOf([
      { id: "x", modelId: "nano-banana-pro", op: "edit", after: ["y"] },
      { id: "y", modelId: "birefnet-cloud", op: "bg-remove", after: [] },
    ]);
    expect(a!.key).toBe(b!.key);
    expect(a!.steps.map((s) => s.modelId)).toEqual(["birefnet-cloud", "nano-banana-pro"]);
    const other = shapeOf([
      { id: "1", modelId: "birefnet-cloud", op: "bg-remove", after: [] },
      { id: "2", modelId: "nano-banana-pro", op: "edit", after: ["1"], slots: ["endImage"] },
    ]);
    expect(other!.key).not.toBe(a!.key);
    expect(shapeOf([{ id: "1", modelId: "m", after: ["2"] }])).toBeNull();
  });

  it("of a recipe matches the runs it makes", () => {
    const p = turntable("a lamp");
    const recipe = {
      steps: [
        { key: "a", kind: "generate" as const, request: { feature: "skill", modelId: "birefnet-cloud", op: "bg-remove" as const } },
        { key: "b", kind: "generate" as const, after: "a", chain: [{ slot: "images" as const, position: "first" as const }], request: { feature: "skill", modelId: "nano-banana-pro", op: "edit" as const } },
        { key: "c", kind: "generate" as const, after: "b", chain: [{ slot: "images" as const }], request: { feature: "skill", modelId: "kling-3", op: "i2v" as const } },
      ],
    };
    const deps = (id: string) => {
      const v = (db().prepare("SELECT depends_on FROM generations WHERE id = ?").get(id) as { depends_on: string | null }).depends_on;
      return !v ? [] : v.startsWith("[") ? (JSON.parse(v) as string[]) : [v];
    };
    const fromRuns = shapeOf(p.items.map((g) => ({ id: g.id, modelId: g.modelId, op: g.request.op, after: deps(g.id), slots: deps(g.id).map((_, i) => g.request.chain?.[i]?.slot ?? "images") })));
    expect(fromRuns!.key).toBe(shapeOf(recipeShapeNodes(recipe)!)!.key);
    clear();
  });
});

describe("suggestions", () => {
  it("offer a chain made 3 times in 14 days, with the newest run's last step to draft from", async () => {
    clear();
    turntable("a lamp");
    turntable("a vase");
    expect(insights.skillSuggestions({ force: true })).toEqual([]);
    const newest = turntable("a chair");
    const [s] = insights.skillSuggestions({ force: true });
    expect(s).toMatchObject({ words: "Background removal → Image edit → Image to video", count: 3, demo: true, ids: [newest.byKey.spin.id] });
    // Through the route, as the Library reads it.
    expect(((await (await route.GET()).json()) as { items: unknown[] }).items).toEqual([s]);
  });

  it("leave out older runs, helper rows and the evaluation harness's runs", () => {
    clear();
    turntable("a lamp", { at: Date.now() - 20 * 86_400_000 });
    turntable("a vase", { feature: "eval" });
    turntable("a cup", { feature: "mixed-media-preview" });
    turntable("a chair");
    turntable("a desk");
    expect(insights.skillSuggestions({ force: true })).toEqual([]);
  });

  it("are swept at most once a day", () => {
    clear();
    const now = Date.now();
    for (const w of ["a", "b", "c"]) turntable(w);
    expect(insights.skillSuggestions({ now })).toHaveLength(1);
    // Nothing is left, but the day's sweep stands until tomorrow.
    db().exec("DELETE FROM generations");
    expect(insights.skillSuggestions({ now: now + 3_600_000 })).toHaveLength(1);
    expect(insights.skillSuggestions({ now: now + 25 * 3_600_000 })).toEqual([]);
  });

  it("Not now hides one for a week; Don't suggest this for good", async () => {
    clear();
    for (const w of ["a", "b", "c"]) turntable(w);
    const now = Date.now();
    const [s] = insights.skillSuggestions({ now, force: true });
    insights.dismissSuggestion(s.id, "later", now);
    expect(insights.skillSuggestions({ now })).toEqual([]);
    expect(insights.skillSuggestions({ now: now + 8 * 86_400_000 }).map((x) => x.id)).toEqual([s.id]);
    const res = await route.POST(new Request("http://x/api/skill-suggestions", { method: "POST", body: JSON.stringify({ id: s.id, how: "never" }) }));
    expect(res.status).toBe(200);
    expect(insights.skillSuggestions({ now: now + 30 * 86_400_000, force: true })).toEqual([]);
    expect((await route.POST(new Request("http://x", { method: "POST", body: "{}" }))).status).toBe(400);
  });

  it("aren't offered for a chain a saved skill already makes", () => {
    clear();
    for (const w of ["a", "b", "c"]) turntable(w);
    expect(insights.skillSuggestions({ force: true })).toHaveLength(1);
    skills.createSkill({ name: "my-turntable", title: "My turntable", description: "x", body: "x" });
    recipes.saveRecipe("my-turntable", {
      fuobeRecipe: 1,
      params: [{ id: "product", label: "Product", type: "image", required: true, example: photo }],
      steps: [
        { key: "cut", kind: "generate", request: { feature: "skill", modelId: "birefnet-cloud", op: "bg-remove", inputs: { images: ["{{product}}"] } } },
        { key: "scene", kind: "generate", after: "cut", chain: [{ slot: "images", position: "first" }], request: { feature: "skill", modelId: "nano-banana-pro", op: "edit", prompt: "on a plinth" } },
        { key: "spin", kind: "generate", after: "scene", chain: [{ slot: "images" }], request: { feature: "skill", modelId: "kling-3", op: "i2v", prompt: "turning", params: { duration: 5 } } },
      ],
    });
    // At once, without waiting for the next day's sweep.
    expect(insights.skillSuggestions()).toEqual([]);
    expect(insights.skillSuggestions({ force: true })).toEqual([]);
  });
});
