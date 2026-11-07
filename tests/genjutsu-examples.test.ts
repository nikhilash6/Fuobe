import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ALL_FEATURES,
  decodeSetup,
  encodeSetup,
  FINISH_COLOURS_DEFAULT,
  GENJUTSU_MODES,
  getMaker,
  modeOpen,
  planGenjutsu,
  type GenjutsuMode,
  type GenjutsuPlanInput,
  type GenjutsuSetup,
} from "@/lib/catalog/genjutsu";
import { exampleFor, examplesOf, exampleSettings, recipeProblem, sameRecipe, toRecipe } from "@/lib/examples/genjutsu";
import type { GenjutsuRecipe } from "@/lib/examples/types";
import { genjutsuLive } from "@/server/genjutsu-live";
import plan from "@/lib/examples/plan.json";

// Each Genjutsu mode's example: one card per mode, its recipe exact (a setup code keeps every field, and the recipe plus
// the example's own inputs plans the same run as the one that made it), the fields about the example's own clip and
// photos never in a recipe, and a viewer sees only an example whose mode and model are open to them.

// home-showcase.ts (which the catalog's fallback rows borrow from) imports next/cache.
vi.mock("next/cache", () => ({ cacheLife: () => {} }));
const { genjutsuExamples } = await import("@/lib/examples/catalog");

type Row = { id: string; surface: string; load?: string; genjutsu?: { recipe: GenjutsuRecipe; own?: { character?: Record<string, unknown> } } };
const rows = (plan as Row[]).filter((r) => r.load === "genjutsu");
const examples = genjutsuExamples();
const none = () => false;

/** A run's request body, as the form sends it (src/components/genjutsu/genjutsu-studio.tsx). */
interface Body {
  engine: "open" | "cloud";
  mode: GenjutsuMode;
  modelId: string;
  tier?: "standard" | "high";
  quality?: string;
  target?: GenjutsuPlanInput["target"];
  references: string[];
  source: GenjutsuPlanInput["source"] & { name?: string };
  range: { start: number; end: number };
  seed?: number;
  character?: GenjutsuPlanInput["character"];
  object?: GenjutsuPlanInput["object"];
  finish?: GenjutsuPlanInput["finish"];
  originalSound?: GenjutsuPlanInput["originalSound"];
}

/** The run a body plans: every step's request, as the server would queue it. */
const planOf = (b: Body) =>
  planGenjutsu({
    engine: b.engine,
    mode: b.mode,
    maker: getMaker(b.modelId, b.engine)!,
    title: "Genjutsu",
    source: b.source,
    range: b.range,
    // A body with no quality (a Finish run) plans with the form's default.
    quality: b.quality ?? "720p",
    references: b.references,
    ...(b.target && { target: b.target }),
    ...(b.seed !== undefined && { seed: b.seed }),
    ...(b.character && { character: b.character }),
    ...(b.object && { object: b.object }),
    ...(b.finish && { finish: b.finish }),
    ...(b.originalSound && { originalSound: b.originalSound }),
  });

/** "Use this example" on the example's own clip and photos, with who-is-who given again: the body the form sends. */
function remake(recipe: GenjutsuRecipe, own: { character?: Record<string, unknown> } | undefined, run: Body, quality = "720p"): Body {
  return {
    engine: recipe.engine ?? "open",
    mode: recipe.mode,
    modelId: recipe.model!,
    ...(recipe.tier && { tier: recipe.tier }),
    // A recipe with no quality keeps the form's own (Finish keeps the clip's size).
    quality: recipe.quality ?? quality,
    ...(recipe.target && { target: recipe.target }),
    references: run.references,
    source: run.source,
    range: { start: 0, end: Math.min(run.source.duration ?? recipe.length, recipe.length) },
    ...(recipe.seed !== undefined && { seed: recipe.seed }),
    ...((recipe.character || own?.character) && { character: { ...recipe.character, ...own?.character } }),
    ...(recipe.object && { object: recipe.object }),
    ...(recipe.finish && { finish: recipe.finish }),
    ...(recipe.originalSound && recipe.originalSound !== "everything" && { originalSound: recipe.originalSound }),
  };
}

describe("Genjutsu mode examples", () => {
  it("each example sits on a real mode, one card list per mode, best first", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const mode = r.surface.replace("tool:genjutsu/", "");
      expect(GENJUTSU_MODES.map((m) => m.id), r.id).toContain(mode);
      expect(examples[mode as GenjutsuMode]?.some((c) => c.id === r.id), r.id).toBe(true);
    }
  });

  it("every recipe survives a gj2 setup code with nothing dropped, and gj1 codes still read", () => {
    for (const r of rows) {
      const recipe = r.genjutsu!.recipe;
      expect(recipeProblem(recipe, recipe.mode), r.id).toBeNull();
      const code = encodeSetup(recipe);
      expect(code).toMatch(/^gj2\./);
      expect(decodeSetup(code, ALL_FEATURES), r.id).toEqual(recipe);
      expect(sameRecipe(toRecipe(decodeSetup(code)!), recipe), r.id).toBe(true);
    }
    const gj1 = `gj1.${Buffer.from(JSON.stringify({ m: "finish", e: "open", f: { tool: "colours" } })).toString("base64url")}`;
    expect(decodeSetup(gj1)).toMatchObject({ mode: "finish", engine: "open", finish: { tool: "colours" } });
  });

  it("gj2 keeps the seed, the part's length and the sound, and drops what is out of range", () => {
    const s: GenjutsuSetup = { mode: "character", engine: "open", model: "oss-h3-group-swap", quality: "720p", target: "type", seed: 123456, length: 5.1666, originalSound: "music-effects" };
    expect(decodeSetup(encodeSetup(s))).toMatchObject({ seed: 123456, length: 5.167, originalSound: "music-effects" });
    const bad = `gj2.${Buffer.from(JSON.stringify({ m: "finish", sd: -4, pl: 600, os: "loud" })).toString("base64url")}`;
    const back = decodeSetup(bad)!;
    expect(back.seed).toBeUndefined();
    expect(back.length).toBeUndefined();
    expect(back.originalSound).toBeUndefined();
  });

  it("a recipe never names the example's files or who is who in its clip", () => {
    const base: GenjutsuRecipe = { mode: "character", engine: "open", model: "oss-h3-group-swap", quality: "720p", target: "type", length: 5 };
    expect(recipeProblem(base, "character")).toBeNull();
    expect(recipeProblem({ ...base, references: ["/api/files/a.png"] } as GenjutsuRecipe, "character")).toMatch(/files/);
    for (const k of ["description", "people", "who", "index", "subject"]) expect(recipeProblem({ ...base, character: { [k]: k === "index" ? 1 : "x" } } as GenjutsuRecipe, "character"), k).toMatch(new RegExp(`character\\.${k}`));
    expect(recipeProblem(base, "finish")).toMatch(/runs character/);
    expect(recipeProblem({ ...base, length: 40 }, "character")).toMatch(/outside/);
    // The form's own clip and photos fall out of a setup before it is compared with an example.
    expect(toRecipe({ ...base, references: ["/api/files/mine.png"], character: { people: [{ role: "the man" }] } as GenjutsuSetup["character"] })).toEqual(base);
  });

  it("the recipe plus the example's own clip and photos plans the same run as the one that made it", () => {
    const dir = path.join(process.cwd(), "tests", "fixtures", "genjutsu-examples");
    for (const r of rows) {
      const file = path.join(dir, `${r.id}.json`);
      expect(fs.existsSync(file), `${r.id}: its run's fixture`).toBe(true);
      const run = (JSON.parse(fs.readFileSync(file, "utf8")) as { body: Body }).body;
      const again = remake(r.genjutsu!.recipe, r.genjutsu!.own, run);
      expect(again.modelId, r.id).toBe(run.modelId);
      expect(again.range, r.id).toEqual(run.range);
      expect(planOf(again), r.id).toEqual(planOf(run));
      // A recipe with no quality of its own: the form's quality changes nothing in the run.
      if (!r.genjutsu!.recipe.quality) for (const q of ["480p", "1080p", "4K"]) expect(planOf(remake(r.genjutsu!.recipe, r.genjutsu!.own, run, q)), `${r.id} ${q}`).toEqual(planOf(run));
    }
  });

  it("the settings list names no model, no seed, no file and no test words for a visitor", () => {
    for (const r of rows) {
      const list = exampleSettings(r.genjutsu!.recipe).join(" | ");
      expect(list, r.id).not.toMatch(/oss-|fuobe-|H3|Wan|test|pass|owner|seed|part|\/api\//i);
      // The length in whole seconds, as "What went in" says it.
      expect(list, r.id).toContain(`${Math.round(r.genjutsu!.recipe.length)} s`);
      expect((r as Row & { genjutsu: { went: string } }).genjutsu.went, r.id).toContain(`${Math.round(r.genjutsu!.recipe.length)} s`);
    }
    const finish = { mode: "finish" as const, engine: "open" as const, model: "oss-fix-colours", finish: { tool: "colours" as const }, length: 5.166, originalSound: "everything" as const };
    // Finish's settings left out read as the plan's own defaults (FINISH_COLOURS_DEFAULT).
    expect(exampleSettings(finish)).toEqual(["Finish: Soft film", "Strength 40%", "Soften detail 33%", "5 s", "Original sound"]);
    // The owner: no model chip for Finish (its finish chip names it), the exact length and the seed.
    expect(exampleSettings({ ...finish, seed: 3 }, { owner: true })).toEqual(["Finish: Soft film", "Strength 40%", "Soften detail 33%", "5.2 s", "Original sound", "Seed 3"]);
    const character = rows.find((r) => r.id === "genjutsu-character.1")!.genjutsu!.recipe;
    expect(exampleSettings(character)).toEqual(["720p", "5 s", "Original sound"]);
    expect(exampleSettings(character, { owner: true })[0]).toBe(getMaker(character.model, character.engine)!.label);
  });

  it("a page sends only the examples open to everyone; the Finish recipe writes its settings out", () => {
    // Nothing open: only examples that need no feature of their own (a mode open to everyone, on a model with no gate).
    for (const [mode, cards] of Object.entries(genjutsuExamples(() => false))) for (const c of cards!) expect(c.load.needs, `${mode}: ${c.id}`).toEqual([]);
    const live = genjutsuLive();
    const open = genjutsuExamples((f) => live[f]);
    for (const [mode, cards] of Object.entries(genjutsuExamples())) {
      const shown = open[mode as GenjutsuMode] ?? [];
      expect(shown.every((c) => c.load.needs.every((f) => live[f])), mode).toBe(true);
      expect(shown.length).toBeLessThanOrEqual(cards!.length);
    }
    const f = rows.find((r) => r.id === "genjutsu-finish.1")!.genjutsu!.recipe.finish!;
    expect({ finish: f.finish, strength: f.strength, soften: f.soften }).toEqual(FINISH_COLOURS_DEFAULT);
  });

  it("a viewer sees an example only where its mode and its model are open to them; the owner sees every one", () => {
    for (const m of GENJUTSU_MODES) {
      const cards = examples[m.id] ?? [];
      // The owner: the best example of every mode that has one.
      expect(exampleFor(examples, m.id, ALL_FEATURES)?.id, m.id).toBe(cards[0]?.id);
      // Nothing open: only the five first modes show, and only an example that needs nothing.
      const closed = exampleFor(examples, m.id, none);
      if (closed) expect(closed.load.needs, m.id).toEqual([]);
      if (!modeOpen(m.id, none)) expect(closed, m.id).toBeUndefined();
    }
    for (const r of rows) {
      const card = Object.values(examples)
        .flat()
        .find((c) => c!.id === r.id)!;
      const mode = card.load.recipe.mode;
      // Each feature it needs closes it on its own.
      for (const f of card.load.needs) expect(examplesOf(examples, mode, (g) => g !== f).some((c) => c.id === r.id), `${r.id} without ${f}`).toBe(false);
      // The committed gate (src/server/genjutsu-live.ts): what a visitor sees today.
      const live = genjutsuLive();
      const visitor = examplesOf(examples, mode, (f) => !!live[f]).map((c) => c.id);
      expect(visitor.includes(r.id), r.id).toBe(card.load.needs.every((f) => live[f]));
    }
  });

  it("only modes with an example show a card (no empty card)", () => {
    for (const m of GENJUTSU_MODES) if (!examples[m.id]) expect(exampleFor(examples, m.id, ALL_FEATURES)).toBeUndefined();
  });
});
