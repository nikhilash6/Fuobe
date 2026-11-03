import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Route handlers call connection() (no request scope in a test).
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 60_000 });

/**
 * Skills W6: the Library notices a chain made SUGGEST_RULE.runs times in SUGGEST_RULE.days days and offers to save it
 * as a skill (shapeOf, the sweep, "Not now" and "Don't suggest this", and no card for a chain a saved skill has).
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-skill-suggest-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const { db } = await import("@/server/db");
const skills = await import("@/server/skills");
const recipes = await import("@/server/recipes");
const { trashGenerations } = await import("@/server/library");
const { shapeOf, shapeOfRecipe, shapeWords, SUGGEST_RULE } = await import("@/lib/recipe");
const route = await import("@/app/api/assist/skills/suggestions/route");

afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
});

const DAY = 86_400_000;
let n = 0;

/** One stored row, as the runner leaves a finished generation. */
function row(o: { request: Record<string, unknown>; after?: string[]; at: number; provider?: string; feature?: string; status?: string; batch?: string }): string {
  const id = `g${++n}`.padEnd(12, "x");
  const req = { feature: o.feature ?? "image", ...o.request };
  db()
    .prepare(
      `INSERT INTO generations (id, batch_id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at, depends_on)
       VALUES (?, ?, ?, ?, 'cloud', ?, ?, 'image', ?, ?, '[]', ?, ?, ?)`,
    )
    .run(id, o.batch ?? null, req.feature, String(req.modelId), o.provider ?? "fal", String(req.op ?? "t2i"), o.status ?? "succeeded", JSON.stringify(req), o.at, o.at, o.after?.length ? (o.after.length === 1 ? o.after[0] : JSON.stringify(o.after)) : null);
  return id;
}

/** The turntable chain: a cut-out, a scene from it, a clip of the scene. Prompts and inputs vary with `i`. */
function turntable(at: number, i: number, o: { provider?: string } = {}): string[] {
  const batch = `b${at}${i}`;
  const cut = row({ at, batch, provider: o.provider, request: { modelId: "birefnet-cloud", op: "bg-remove", inputs: { images: [`/api/files/uploads/p${i}.png`] } } });
  const scene = row({ at: at + 1, batch, provider: o.provider, after: [cut], request: { modelId: "nano-banana-pro", op: "edit", prompt: `product ${i} on a plinth`, chain: [{ slot: "images", position: "first" }] } });
  const spin = row({ at: at + 2, batch, provider: o.provider, after: [scene], request: { modelId: "kling-3", op: "i2v", prompt: `turntable ${i}`, params: { duration: 5 }, chain: [{ slot: "images" }] } });
  return [cut, scene, spin];
}

const node = (id: string, modelId: string, op: string, after: string[] = [], o: { feature?: string; slots?: string[] } = {}) => ({ id, modelId, op, after, slots: o.slots ?? after.map(() => "images"), ...(o.feature && { feature: o.feature }) });

describe("shapeOf", () => {
  it("gives the same chain with other prompts and inputs one shape, and its steps in order", () => {
    const a = shapeOf([node("a1", "birefnet-cloud", "bg-remove"), node("a2", "nano-banana-pro", "edit", ["a1"]), node("a3", "kling-3", "i2v", ["a2"])]);
    const b = shapeOf([node("b3", "kling-3", "i2v", ["b2"]), node("b1", "birefnet-cloud", "bg-remove"), node("b2", "nano-banana-pro", "edit", ["b1"])]);
    expect(a.key).toBe(b.key);
    expect(a.steps).toBe(3);
    expect(shapeWords(a.labels)).toBe("Background removal → image edit → image to video");
    // Another model, another slot or another link is another shape.
    expect(shapeOf([node("a1", "birefnet-cloud", "bg-remove"), node("a2", "seedream-5-pro", "edit", ["a1"]), node("a3", "kling-3", "i2v", ["a2"])]).key).not.toBe(a.key);
    expect(shapeOf([node("a1", "birefnet-cloud", "bg-remove"), node("a2", "nano-banana-pro", "edit", ["a1"], { slots: ["endImage"] }), node("a3", "kling-3", "i2v", ["a2"])]).key).not.toBe(a.key);
    expect(shapeOf([node("a1", "birefnet-cloud", "bg-remove"), node("a2", "nano-banana-pro", "edit", ["a1"]), node("a3", "kling-3", "i2v", ["a1"])]).key).not.toBe(a.key);
  });

  it("ignores helper rows and the evaluation harness, and counts a step's several takes once", () => {
    const plain = shapeOf([node("a1", "birefnet-cloud", "bg-remove"), node("a2", "nano-banana-pro", "edit", ["a1"])]);
    const helped = shapeOf([
      node("a1", "birefnet-cloud", "bg-remove"),
      node("a2", "nano-banana-pro", "edit", ["a1"]),
      node("a3", "nano-banana-pro", "edit", ["a1"]),
      node("h1", "oss-z-image-turbo", "t2i", [], { feature: "eval" }),
      node("h2", "oss-z-image-turbo", "t2i", ["a2"], { feature: "faceless-step" }),
      node("h3", "nano-banana-pro", "edit", ["a1"], { feature: "skill-check" }),
    ]);
    expect(helped).toEqual(plain);
    expect(plain.steps).toBe(2);
  });

  it("matches a recipe's shape with its runs'", () => {
    const recipe = {
      steps: [
        { key: "cutout", kind: "generate" as const, request: { feature: "skill", modelId: "birefnet-cloud", op: "bg-remove" } },
        { key: "scene", kind: "generate" as const, after: ["cutout"], chain: [{ slot: "images" as const, position: "first" as const }], request: { feature: "skill", modelId: "nano-banana-pro", op: "edit" } },
      ],
    };
    expect(shapeOfRecipe(recipe)!.key).toBe(shapeOf([node("x", "birefnet-cloud", "bg-remove"), node("y", "nano-banana-pro", "edit", ["x"])]).key);
    expect(shapeOfRecipe({ steps: [{ key: "c", kind: "tool", tool: "add_captions", input: {} }] })).toBeNull();
  });
});

describe("the Library's sweep", () => {
  const now = Date.UTC(2026, 10, 3, 12);

  it("suggests a chain made 3 times in 14 days, with the newest run's rows, and not before", () => {
    expect(SUGGEST_RULE).toEqual({ runs: 3, days: 14 });
    // One run a month ago doesn't count; two this week aren't enough.
    turntable(now - 20 * DAY, 0);
    turntable(now - 3 * DAY, 1);
    turntable(now - 2 * DAY, 2);
    // A one-step job made often is never a chain.
    for (let i = 0; i < 5; i++) row({ at: now - DAY + i, request: { modelId: "nano-banana-pro", op: "t2i", prompt: `cat ${i}` } });
    // The eval harness and a skill's own runs don't count.
    const evalRun = row({ at: now - DAY, feature: "eval", request: { modelId: "birefnet-cloud", op: "bg-remove" } });
    row({ at: now - DAY + 1, feature: "eval", after: [evalRun], request: { modelId: "nano-banana-pro", op: "edit" } });
    const skilled = row({ at: now - DAY, request: { modelId: "birefnet-cloud", op: "bg-remove", skill: { name: "x", run: "r" } } });
    row({ at: now - DAY + 1, after: [skilled], request: { modelId: "nano-banana-pro", op: "edit", skill: { name: "x", run: "r" } } });
    row({ at: now - DAY + 2, request: { modelId: "kling-3", op: "i2v" } });
    expect(recipes.sweepSuggestions(now)).toEqual([]);

    const newest = turntable(now - DAY, 3);
    const found = recipes.sweepSuggestions(now);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ count: 3, ids: newest, labels: ["Background removal", "Image edit", "Image to video"], demo: false, last: now - DAY + 2 });
    expect(found[0].shape).toMatch(/^[0-9a-f]{16}$/);
  });

  it("keeps an account's runs out, and says when every run was a demo", () => {
    const later = now + DAY;
    for (let i = 0; i < 3; i++) {
      const a = row({ at: later - 5 * DAY + i * 10, request: { modelId: "birefnet-cloud", op: "bg-remove", account: "acc1" } });
      row({ at: later - 5 * DAY + i * 10 + 1, after: [a], request: { modelId: "seedream-5-pro", op: "edit", account: "acc1" } });
    }
    expect(recipes.sweepSuggestions(later).some((s) => s.labels.length === 2)).toBe(false);
    for (let i = 0; i < 3; i++) {
      const a = row({ at: later - 4 * DAY + i * 10, provider: "mock", request: { modelId: "birefnet-cloud", op: "bg-remove" } });
      row({ at: later - 4 * DAY + i * 10 + 1, provider: "mock", after: [a], request: { modelId: "seedream-5-pro", op: "edit" } });
    }
    const demo = recipes.sweepSuggestions(later).find((s) => s.labels.length === 2);
    expect(demo).toMatchObject({ count: 3, demo: true });
  });

  it("runs once a day, and leaves out what was dismissed or put off", async () => {
    const first = recipes.skillSuggestions({ now });
    const turn = first.find((s) => s.labels.length === 3)!;
    expect(turn).toBeTruthy();
    // A fourth run the same day: the day's sweep stands until tomorrow (or a fresh one).
    turntable(now - 1000, 4);
    expect(recipes.skillSuggestions({ now: now + 60_000 }).find((s) => s.shape === turn.shape)?.count).toBe(3);
    expect(recipes.skillSuggestions({ now: now + DAY + 1 }).find((s) => s.shape === turn.shape)?.count).toBe(4);

    // Not now: gone for a week, then back.
    const res = await route.POST(new Request("http://x/api/assist/skills/suggestions", { method: "POST", body: JSON.stringify({ shape: turn.shape, action: "later" }) }));
    expect(res.status).toBe(200);
    expect(recipes.skillSuggestions({ now: now + DAY + 2 }).some((s) => s.shape === turn.shape)).toBe(false);
    expect(recipes.skillSuggestions({ now: now + 3 * DAY, fresh: true }).some((s) => s.shape === turn.shape)).toBe(false);
    // (Back after a week, if it's still made often: the window moves too, so the runs are made again here.)
    for (let i = 0; i < 3; i++) turntable(now + 7 * DAY + i * 100, 10 + i);
    expect(recipes.skillSuggestions({ now: now + 9 * DAY, fresh: true }).some((s) => s.shape === turn.shape)).toBe(true);

    // Don't suggest this: never again.
    recipes.dismissSuggestion(turn.shape, "never", now + 9 * DAY);
    expect(recipes.skillSuggestions({ now: now + 9 * DAY, fresh: true }).some((s) => s.shape === turn.shape)).toBe(false);
    expect((await route.POST(new Request("http://x", { method: "POST", body: JSON.stringify({ shape: "nope", action: "dismiss" }) }))).status).toBe(400);
  });

  it("offers nothing for a chain a saved skill has, and drops a suggestion whose rows were trashed", async () => {
    const at = Date.UTC(2026, 11, 1, 12);
    for (let i = 0; i < 3; i++) {
      const a = row({ at: at - DAY + i * 10, request: { modelId: "birefnet-cloud", op: "bg-remove" } });
      row({ at: at - DAY + i * 10 + 1, after: [a], request: { modelId: "gpt-image-2", op: "edit" } });
    }
    const found = recipes.skillSuggestions({ now: at, fresh: true }).find((s) => s.labels.length === 2)!;
    expect(found).toBeTruthy();
    skills.createSkill({ name: "cut-and-place", title: "Cut and place", description: "d", body: "b" });
    recipes.saveRecipe("cut-and-place", {
      fuobeRecipe: 1,
      params: [{ id: "photo", label: "Photo", type: "image", required: true }],
      steps: [
        { key: "cut", kind: "generate", request: { feature: "skill", modelId: "birefnet-cloud", op: "bg-remove", inputs: { images: ["{{photo}}"] } } },
        { key: "place", kind: "generate", after: ["cut"], chain: [{ slot: "images", position: "first" }], request: { feature: "skill", modelId: "gpt-image-2", op: "edit", prompt: "on a plinth" } },
      ],
    });
    expect(recipes.skillSuggestions({ now: at }).some((s) => s.shape === found.shape)).toBe(false);
    skills.deleteSkill("cut-and-place");
    expect(recipes.skillSuggestions({ now: at }).some((s) => s.shape === found.shape)).toBe(true);
    trashGenerations([found.ids[0]]);
    expect(recipes.skillSuggestions({ now: at }).some((s) => s.shape === found.shape)).toBe(false);
    // The route answers the owner with the same list.
    const res = await route.GET(new Request("http://x/api/assist/skills/suggestions"));
    expect(Array.isArray((await res.json()).items)).toBe(true);
  });

  it("keeps \"suggestions\" from being a skill's name", () => {
    expect(() => skills.createSkill({ name: "suggestions", title: "S", description: "d", body: "b" })).toThrow(/reserved/);
  });
});
