import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 180_000 });

/**
 * Skills W7: a skill whose steps wait across studios ("dub, then captions, then a 9:16 cut") runs as a skill_runs row:
 * each step starts when the step it takes a result from is done, a failure fails the steps after it with the reason,
 * the state survives a restart, and the free dry run deletes the studio records it made.
 */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-skill-runs-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const recipes = await import("@/server/recipes");
const runs = await import("@/server/skill-runs");
const skills = await import("@/server/skills");
const gens = await import("@/server/generations");
const { db } = await import("@/server/db");
const { saveFile } = await import("@/server/storage");
const { recipeProblems, parseRecipe, isStaged } = await import("@/lib/recipe");
const { runAsDemo, inDemoScope, outsideDemo } = await import("@/server/demo-scope");
const { spendOf } = await import("@/lib/assist-schedule");
const tools = await import("@/server/assist/tools");

afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows keeps the open database.
  }
});

let clip = "";
beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
  clip = saveFile({ data: fs.readFileSync(path.join(__dirname, "fixtures/shorts-12s.mp4")), contentType: "video/mp4", source: "upload", name: "talk.mp4" }).url;
});

async function settle(ids: string[], ms = 90_000) {
  const until = Date.now() + ms;
  for (;;) {
    const all = ids.map((id) => gens.getGeneration(id, { includeDeleted: true })!);
    if (all.every((g) => ["succeeded", "failed", "canceled"].includes(g.status))) return all;
    if (Date.now() > until) throw new Error(`timed out: ${all.map((g) => `${g.id} ${g.status} ${g.message}`).join(", ")}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Sweep until the run stops going, letting the generation runner finish each step's work. */
async function finish(id: string, ms = 150_000) {
  const until = Date.now() + ms;
  for (;;) {
    const status = await runs.advanceSkillRun(id);
    if (status !== "running") return status;
    const ids = runs.getSkillRun(id)!.steps.filter((s) => s.status === "running").flatMap((s) => s.ids);
    if (ids.length) await settle(ids);
    if (Date.now() > until) throw new Error("the run didn't finish");
  }
}

/** Dub (a studio), then captions on the dub (a studio), then a 9:16 cut of the captioned clip (a model). */
const spanishShort = () => ({
  fuobeRecipe: 2,
  params: [{ id: "clip", label: "Clip", type: "video", required: true, example: clip }],
  steps: [
    { key: "dub", label: "Dub", kind: "tool", tool: "dub_video", input: { video: "{{clip}}", languages: ["Spanish"], lipsync: false, review: false } },
    { key: "captions", label: "Captions", kind: "tool", tool: "add_captions", input: { video: "{{steps.dub.output}}" } },
    { key: "cut", label: "9:16 cut", kind: "generate", request: { feature: "skill", modelId: "scale-video", op: "reframe", inputs: { video: "{{steps.captions.output}}" }, params: { aspectRatio: "9:16" } } },
  ],
});

function shortSkill(name = "spanish-short") {
  if (skills.getSkill(name)) return name;
  skills.createSkill({ name, title: "Spanish short", description: "Dub, caption and cut a clip for a Spanish short.", body: "# Spanish short" });
  recipes.saveRecipe(name, spanishShort());
  return name;
}

describe("the recipe format, version 2", () => {
  it("takes an earlier step's output by reference, checked against the step order and the kind it makes", () => {
    const parsed = parseRecipe(JSON.stringify(spanishShort()));
    expect(parsed.ok).toBe(true);
    const recipe = parsed.ok ? parsed.recipe : null!;
    expect(isStaged(recipe)).toBe(true);
    expect(recipeProblems(recipe)).toEqual([]);
    // A reference to a later step, to no step, and a kind that doesn't fit.
    const later = { ...recipe, steps: [recipe.steps[1], recipe.steps[0], recipe.steps[2]] };
    expect(recipeProblems(later)).toContain("Step “captions” takes the output of “dub”, which comes later: a step can only take an earlier step's output");
    const none = { ...recipe, steps: [recipe.steps[0], { ...recipe.steps[1], input: { video: "{{steps.nope.output}}" } }] } as typeof recipe;
    expect(recipeProblems(none)).toContain("Step “captions” takes the output of “nope”, which isn't a step");
    expect(recipeProblems(recipe, { kinds: { dub: "audio" } })).toContain("Step “captions” takes a video from “dub”, which makes a audio");
    // A dub for review makes no video until someone voices it: a later step can't take its result.
    const reviewed = { ...recipe, steps: recipe.steps.map((s) => (s.kind === "tool" && s.tool === "dub_video" ? { ...s, input: { ...s.input, review: true } } : s)) };
    expect(recipeProblems(reviewed)).toContain("Step “dub” dubs for review, so it makes no video for the steps after it: set \"review\": false to dub in one go");
    const unset = { ...recipe, steps: recipe.steps.map((s) => (s.kind === "tool" && s.tool === "dub_video" ? { ...s, input: { video: "{{clip}}", languages: ["Spanish"] } } : s)) };
    expect(recipeProblems(unset).some((p) => p.startsWith("Step “dub” dubs for review"))).toBe(true);
    // A step joined to another by `after` can't also take its output by reference (they start together).
    const cut = (key: string, video: string, after?: string) => ({ key, kind: "generate" as const, ...(after && { after }), request: { feature: "skill", modelId: "scale-video", op: "reframe", inputs: { video }, params: { aspectRatio: "9:16" } } });
    const joined = { ...recipe, steps: [recipe.steps[0], cut("a", "{{steps.dub.output}}"), cut("b", "{{steps.a.output}}", "a")] } as typeof recipe;
    expect(recipeProblems(joined)).toContain('Step “b” takes the output of “a”, which starts with it (they are joined by "after"): take it through "after" and a chain slot, or drop "after"');
    // Version 1 says what it needs.
    expect(recipeProblems({ ...recipe, fuobeRecipe: 1 })).toEqual(expect.arrayContaining([expect.stringMatching(/needs "fuobeRecipe": 2/)]));
    // On the server, the catalog says what each step makes.
    expect(recipes.allProblems(recipe)).toEqual([]);
  });

  it("is priced step by step, with stand-in files for the results steps wait for", () => {
    const name = shortSkill();
    const est = recipes.estimateRecipe(name, { values: { clip } }, "cloud");
    expect(est.errors).toEqual([]);
    expect(est.runs[0].errors).toEqual([]);
    expect(est.jobs.at(-1)).toMatchObject({ modelId: "scale-video", op: "reframe" });
    expect(est.runnable).toBe(true);
    // A step priced by the length of an earlier step's result is a guess: a spending cap holds it for a yes.
    const guessed = est.jobs.filter((j) => j.estimate);
    expect(guessed.length).toBeGreaterThan(0);
    expect(guessed.every((j) => j.note !== "Dub")).toBe(true);
    expect(spendOf(est.jobs.map((j) => ({ ...j, demo: false })))).toBeNull();
  });
});

describe("a run in stages", () => {
  it("starts the dub, waits, then starts the captions and the cut, each from the step before", async () => {
    const name = shortSkill();
    await recipes.verifyRecipe(name, "plan", "cloud");
    const out = await recipes.runRecipe(name, { values: { clip } }, "cloud");
    const run = out.runs[0];
    expect(run.skillRun).toBeTruthy();
    expect(run.waiting).toEqual(["Captions", "9:16 cut"]);
    expect(run.ids.length).toBeGreaterThan(0);
    const first = runs.getSkillRun(run.skillRun!)!;
    expect(first.steps.map((s) => [s.key, s.status])).toEqual([
      ["dub", "running"],
      ["captions", "waiting"],
      ["cut", "waiting"],
    ]);
    expect(first.steps[0].studio).toBeTruthy();
    // Every row it started carries the run's stamp.
    expect(gens.getGeneration(run.ids[0])!.request.skill).toEqual({ name, run: run.skillRun });
    expect(await finish(run.skillRun!)).toBe("done");
    const done = runs.getSkillRun(run.skillRun!)!;
    expect(done.steps.map((s) => s.status)).toEqual(["done", "done", "done"]);
    // The cut took the captioned clip, which took the dub.
    const cut = gens.getGeneration(done.steps[2].ids[0])!;
    const captions = gens.getGeneration(done.steps[1].ids.at(-1)!, { includeDeleted: true })!;
    expect(cut.request.inputs?.video).toMatch(/^\/api\/files\//);
    expect(captions.request.inputs?.video ?? JSON.stringify(captions.request)).not.toContain("{{steps.");
    expect(cut.request.inputs?.video).not.toBe(clip);
    expect(runs.listSkillRuns(name)[0]).toMatchObject({ id: run.skillRun, status: "done" });
  });

  it("a failed dub fails the steps after it, saying which step and why", async () => {
    const name = shortSkill();
    const out = await recipes.runRecipe(name, { values: { clip } }, "cloud");
    const id = out.runs[0].skillRun!;
    const dub = runs.getSkillRun(id)!.steps[0];
    // The dub's work fails (as a provider would fail it).
    const batches = db().prepare(`SELECT DISTINCT batch_id FROM generations WHERE id IN (${dub.ids.map(() => "?").join(", ")})`).all(...dub.ids) as { batch_id: string | null }[];
    db()
      .prepare(`UPDATE generations SET status = 'failed', error = 'No speech found in the clip' WHERE id IN (${dub.ids.map(() => "?").join(", ")}) OR batch_id IN (${batches.map(() => "?").join(", ") || "''"})`)
      .run(...dub.ids, ...batches.map((b) => b.batch_id));
    expect(await runs.advanceSkillRun(id)).toBe("failed");
    const r = runs.getSkillRun(id)!;
    expect(r.steps.map((s) => s.status)).toEqual(["failed", "failed", "failed"]);
    expect(r.error).toMatch(/^“Dub” failed/);
    expect(r.steps[1].error).toBe("“Dub” failed, so this didn't start");
    expect(r.steps[2].error).toBe("“Dub” failed, so this didn't start");
  });

  it("keeps its state in the database: a restart's sweep carries on", async () => {
    const name = shortSkill();
    await recipes.verifyRecipe(name, "plan", "cloud");
    const out = await recipes.runRecipe(name, { values: { clip } }, "cloud");
    const id = out.runs[0].skillRun!;
    await settle(runs.getSkillRun(id)!.steps[0].ids);
    // A restart: the database is opened again and the runner is gone.
    globalThis.__fuobeDb?.close();
    globalThis.__fuobeDb = undefined;
    // Opening the database clears the in-process demo setting ("auto"): set it again, as a test does.
    setSetting("demoMode", "auto");
    const timer = globalThis.__fuobeSkillRuns?.timer;
    if (timer) clearInterval(timer);
    globalThis.__fuobeSkillRuns = undefined;
    await runs.sweepSkillRuns();
    expect(runs.getSkillRun(id)!.steps.map((s) => s.status)).toEqual(["done", "running", "waiting"]);
    expect(await finish(id)).toBe("done");
  });
});

describe("checks of a run in stages", () => {
  it("the dry run runs the studios as demos, then deletes what they made", async () => {
    const name = shortSkill("spanish-short-check");
    const count = (t: string) => (db().prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
    const before = { dub: count("dub_sessions"), runs: count("skill_runs") };
    const v = await recipes.verifyRecipe(name, "demo", "cloud");
    expect(v.engines[0].plan.errors).toEqual([]);
    expect(v.engines[0].dryRun).toMatchObject({ ok: true, problems: [] });
    expect(v.view.recipe.verified?.cloud?.dryRun).toBeTruthy();
    expect({ dub: count("dub_sessions"), runs: count("skill_runs") }).toEqual(before);
    // Its rows are in the Trash, and none shows in the skill's history.
    expect(runs.listSkillRuns(name)).toEqual([]);
    const left = db().prepare("SELECT id, feature, model_id, status, batch_id FROM generations g WHERE json_extract(request_json, '$.skill.name') = ? AND NOT EXISTS (SELECT 1 FROM generation_trash t WHERE t.generation_id = g.id)").all(name);
    expect(left).toEqual([]);
  });

  it("a dry run's steps run as demos whoever moves it on, and the sweep leaves it alone", async () => {
    const id = "check-sweep";
    const steps = JSON.parse(JSON.stringify(spanishShort().steps).replaceAll("{{clip}}", clip));
    const state = () => JSON.parse((db().prepare("SELECT state_json FROM skill_runs WHERE id = ?").get(id) as { state_json: string }).state_json) as { steps: { status: string; ids: string[] }[] };
    // Started and moved on outside any demo scope, as a sweep would.
    expect(inDemoScope()).toBe(false);
    await runs.startSkillRun({ id, skill: "spanish-short-sweep", title: "Sweep", engine: "cloud", values: { clip }, steps, check: true }).done;
    const dub = state().steps[0];
    expect(dub.status).toBe("running");
    await settle(dub.ids);
    const batchOf = (ids: string[]) => (db().prepare(`SELECT DISTINCT batch_id FROM generations WHERE id IN (${ids.map(() => "?").join(", ")}) AND batch_id IS NOT NULL`).all(...ids) as { batch_id: string }[]).map((b) => b.batch_id);
    await settle((db().prepare(`SELECT id FROM generations WHERE batch_id IN (${batchOf(dub.ids).map(() => "?").join(", ") || "''"})`).all(...batchOf(dub.ids)) as { id: string }[]).map((g) => g.id));
    // The sweep skips a dry run: the steps after the dub still wait.
    await runs.sweepSkillRuns();
    expect(state().steps.map((s) => s.status)).toEqual(["running", "waiting", "waiting"]);
    const until = Date.now() + 150_000;
    for (;;) {
      const status = await runs.advanceSkillRun(id);
      if (status !== "running") {
        expect(status).toBe("done");
        break;
      }
      const going = state().steps.filter((s) => s.status === "running").flatMap((s) => s.ids);
      if (going.length) await settle(going);
      if (Date.now() > until) throw new Error("the dry run didn't finish");
    }
    // Every row it made, the studios' later steps too, is a demo on the demo provider.
    const ids = state().steps.flatMap((s) => s.ids);
    const batches = batchOf(ids);
    const rows = db().prepare(`SELECT id, provider, request_json FROM generations WHERE id IN (${ids.map(() => "?").join(", ")}) OR batch_id IN (${batches.map(() => "?").join(", ") || "''"})`).all(...ids, ...batches) as { provider: string; request_json: string }[];
    expect(rows.length).toBeGreaterThan(2);
    for (const r of rows) expect({ provider: r.provider, demo: (JSON.parse(r.request_json) as { demo?: boolean }).demo }).toEqual({ provider: "mock", demo: true });
    db().prepare("DELETE FROM skill_runs WHERE id = ?").run(id);
  });

  it("the sweep's timer never keeps the demo scope it was first made in", async () => {
    expect(runAsDemo(() => outsideDemo(() => inDemoScope()))).toBe(false);
    const cur = globalThis.__fuobeSkillRuns;
    if (cur) clearInterval(cur.timer);
    globalThis.__fuobeSkillRuns = undefined;
    runAsDemo(() => runs.ensureSkillRunRunner());
    const seen = await new Promise<boolean>((res) => {
      globalThis.__fuobeSkillRuns!.tick = () => res(inDemoScope());
    });
    expect(seen).toBe(false);
    runs.ensureSkillRunRunner();
  });

  it("runAsDemo puts everything a studio starts on the demo provider", async () => {
    expect(inDemoScope()).toBe(false);
    const out = await runAsDemo(async () => {
      expect(inDemoScope()).toBe(true);
      return tools.executeTool("add_captions", { video: clip }, { engine: "cloud" });
    });
    const ids = (out.items ?? []).flatMap((i) => (i.role === "generations" ? i.ids : []));
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(gens.getGeneration(id)).toMatchObject({ provider: "mock", request: expect.objectContaining({ demo: true }) });
  });
});
