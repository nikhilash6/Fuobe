import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 180_000 });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-skill-runs-"));
process.env.FUOBE_DATA_DIR = dir;
// Nothing listens: models run on the demo provider, and there's no LLM.
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const skills = await import("@/server/skills");
const recipes = await import("@/server/recipes");
const runs = await import("@/server/skill-runs");
const gens = await import("@/server/generations");
const { db } = await import("@/server/db");
const { saveFile } = await import("@/server/storage");
const { executeTool } = await import("@/server/assist/tools");
const { inDemoScope, outsideDemo, runAsDemo } = await import("@/server/demo-scope");
const { llmText } = await import("@/server/enhance");
const lib = await import("@/lib/recipe");
const uses = await import("@/server/skill-uses");
const runsRoute = await import("@/app/api/assist/skills/[name]/runs/route");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

let clip = "";
beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
  clip = saveFile({ data: fs.readFileSync(path.join(__dirname, "fixtures/shorts-12s.mp4")), contentType: "video/mp4", source: "upload", name: "talk.mp4" }).url;
});

/** The user story's "Spanish short": dub the clip, burn captions into the dub, cut a 9:16 version of the captioned clip. */
const spanishShort = () => ({
  fuobeRecipe: 2,
  params: [
    { id: "video", label: "Clip", type: "video", required: true, example: clip },
    { id: "lang", label: "Language", type: "choice", options: ["Spanish", "German"], default: "Spanish" },
  ],
  steps: [
    { key: "dub", kind: "tool", label: "Dub", tool: "dub_video", input: { video: "{{video}}", languages: ["{{lang}}"], review: false } },
    { key: "captions", kind: "tool", label: "Captions", tool: "add_captions", input: { video: "{{steps.dub.output}}" } },
    { key: "cut", kind: "generate", label: "9:16 cut", request: { feature: "skill", modelId: "ltx-reframe", op: "reframe", inputs: { video: "{{steps.captions.output}}" }, params: { aspectRatio: "9:16" } } },
  ],
  checks: { cut: { kind: "video" } },
});

function makeSkill(name: string, recipe: unknown, title = "Spanish short") {
  skills.createSkill({ name, title, description: "Dub, captions and a 9:16 cut.", body: "# Spanish short" });
  return recipes.saveRecipe(name, recipe);
}

/** Move a run on until it ends (the sweep does this every few seconds in the app). */
async function finish(id: string, ms = 150_000, mod = runs) {
  const until = Date.now() + ms;
  for (;;) {
    const v = (await mod.advanceSkillRun(id))!;
    if (v.status !== "running") return v;
    if (Date.now() > until) throw new Error(`timed out: ${lib.runLine(v.steps)}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

const count = (table: string) => (db().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe("the recipe format, version 2", () => {
  it("checks that every step reference points at an earlier step of a kind that fits", () => {
    const r = lib.RecipeSchema.parse(spanishShort());
    expect(lib.recipeProblems(r)).toEqual([]);
    expect(lib.isStaged(r)).toBe(true);
    expect(lib.recipeParts(r)).toEqual([
      { keys: ["dub"], needs: [] },
      { keys: ["captions"], needs: ["dub"] },
      { keys: ["cut"], needs: ["captions"] },
    ]);
    const broken = lib.RecipeSchema.parse({
      ...spanishShort(),
      steps: [
        { key: "dub", kind: "tool", tool: "dub_video", input: { video: "{{steps.captions.output}}", languages: ["{{lang}}"] } },
        { key: "captions", kind: "tool", tool: "add_captions", input: { video: "{{video}} {{steps.dub.output}}" } },
        { key: "layers", kind: "tool", tool: "split_layers", input: { image: "{{steps.dub.output}}" } },
        { key: "cut", kind: "generate", after: "captions", request: { feature: "skill", modelId: "ltx-reframe", op: "reframe", inputs: { video: "{{steps.nope.output}}" } } },
      ],
    });
    const problems = lib.recipeProblems(broken).join("\n");
    expect(problems).toMatch(/“dub” uses the output of “captions”, which comes after it/);
    expect(problems).toMatch(/a step's output fills a whole field/);
    expect(problems).toMatch(/“layers” takes an image from “dub”, which makes a video/);
    expect(problems).toMatch(/there's no step “nope”/);
    expect(problems).toMatch(/waits for the studio step “captions”: put \{\{steps.captions.output\}\} in its input instead/);
    // A dub that waits for its lines to be reviewed makes no video for the next step.
    expect(problems).toMatch(/“dub” waits for you to review its lines in Translate & dub/);
    // Version 1 files still load, and keep their rule: a tool step alone.
    const v1 = lib.RecipeSchema.parse({ ...spanishShort(), fuobeRecipe: 1 });
    expect(lib.recipeProblems(v1).join("\n")).toMatch(/needs "fuobeRecipe": 2/);
  });

  it("refuses a step that takes a Faceless episode's output: its result is only the first stills", () => {
    const scenes = Array.from({ length: 3 }, (_, i) => ({ narration: `Line ${i}`, visual: `Scene ${i}` }));
    const r = lib.RecipeSchema.parse({
      fuobeRecipe: 2,
      params: [],
      steps: [
        { key: "ep", kind: "tool", tool: "faceless_episode", input: { scenes, style: "flat 2D" } },
        { key: "captions", kind: "tool", tool: "add_captions", input: { video: "{{steps.ep.output}}" } },
      ],
    });
    expect(lib.recipeProblems(r).join("\n")).toMatch(/“captions” takes the output of “ep”, which no step can take yet: Faceless Studio finishes an episode/);
  });

  it("compiles to parts, and fills a reference with the step's first output of the field's kind", () => {
    const r = lib.RecipeSchema.parse(spanishShort());
    const c = lib.compile(r, { video: clip, lang: "Spanish" }, { skill: "s", run: "r", title: "Spanish short" });
    expect(c.kind).toBe("staged");
    if (c.kind !== "staged") return;
    expect(c.parts.map((p) => p.kind)).toEqual(["tool", "tool", "pipeline"]);
    const filled = lib.fillRefs({ video: "{{steps.dub.output}}", images: ["{{steps.dub.output}}"] }, (key, kind) => `/api/files/${key}.${kind}`);
    expect(filled).toEqual({ video: "/api/files/dub.video", images: ["/api/files/dub.image"] });
    expect(() => lib.fillRefs({ video: "{{steps.dub.output}}" }, () => undefined)).toThrow(/“dub” made no video/);
  });
});

describe("a skill that spans studios, in demo mode", () => {
  it("starts the dub, waits, then starts captions and the 9:16 cut as each step finishes", async () => {
    makeSkill("spanish-short", spanishShort());
    expect((await recipes.verifyRecipe("spanish-short", "plan")).ok).toBe(true);
    // Priced step by step: the dub, then captions and the cut on a stand-in for what the step before makes.
    const est = recipes.estimateRecipe("spanish-short", { values: { video: clip } }, "cloud");
    expect(est.runnable).toBe(true);
    expect(est.demo).toBe(true);
    expect(est.place?.studio).toBe("Translate & dub");

    const out = await recipes.runRecipe("spanish-short", { values: { video: clip } }, "cloud");
    expect(out.demo).toBe(true);
    const [run] = out.runs;
    expect(run.run).toBeTruthy();
    // The result names the run and which steps wait.
    expect(run.waiting).toEqual(["Captions", "9:16 cut"]);
    expect(run.href).toMatch(/dub=/);
    const started = runs.getSkillRun(run.run!)!;
    expect(started.steps.map((s) => s.status)).toEqual(["running", "waiting", "waiting"]);
    expect(started.steps[0]).toMatchObject({ studio: "Translate & dub", href: expect.stringContaining("dub=") });

    const done = await finish(run.run!);
    expect(done.status).toBe("done");
    expect(done.steps.map((s) => s.status)).toEqual(["done", "done", "done"]);
    // Each step took the one before's video.
    const dubbed = gens.getGeneration(done.steps[0].ids[0])!;
    const captioned = gens.getGeneration(done.steps[1].ids[0])!;
    const cut = gens.getGeneration(done.steps[2].ids[0])!;
    expect(captioned.request.inputs?.video).toBe(dubbed.outputs.find((o) => o.kind === "video")!.url);
    expect(cut.request.inputs?.video).toBe(captioned.outputs.find((o) => o.kind === "video")!.url);
    expect(cut).toMatchObject({ op: "reframe", status: "succeeded", provider: "mock" });
    // Every row carries the run's stamp and the skill's title.
    for (const g of [dubbed, captioned, cut]) expect(g.request).toMatchObject({ skill: { name: "spanish-short", run: run.run }, batchTitle: "Spanish short" });
    // ...and the key of the step that made it, a studio step's too (a failure is laid at the step that failed).
    [dubbed, captioned, cut].forEach((g, i) => expect(g.request.skill?.step).toBe(done.steps[i].key));
    expect(done.steps[1]).toMatchObject({ studio: "Captions", href: expect.stringMatching(/^\/video-tools\/captions\?video=/) });

    // The skill's dialog reads its runs.
    const res = await runsRoute.GET(new Request("http://x/api"), { params: Promise.resolve({ name: "spanish-short" }) } as never);
    const body = (await res.json()) as { items: { id: string; status: string }[] };
    expect(body.items[0]).toMatchObject({ id: run.run, status: "done" });
    expect(lib.runLine(done.steps)).toBe("Dub · done → Captions · done → 9:16 cut · done");
  });

  it("run_skill's result names the run and says which steps wait, so the agent doesn't start them itself", async () => {
    const out = await executeTool("run_skill", { name: "spanish-short", values: { video: clip } }, { engine: "cloud" });
    expect(out.isError).toBeFalsy();
    const body = JSON.parse(out.content as string) as { runs: { run: string; waiting: string[]; href: string }[]; note: string };
    expect(body.runs[0]).toMatchObject({ run: expect.any(String), waiting: ["Captions", "9:16 cut"], href: expect.stringContaining("dub=") });
    expect(body.note).toMatch(/Captions, 9:16 cut start by themselves when the steps before finish/);
    expect((await finish(body.runs[0].run)).status).toBe("done");
  });

  it("a failed dub fails the steps after it, and says which step failed and why", async () => {
    const out = await recipes.runRecipe("spanish-short", { values: { video: clip } }, "cloud");
    const id = out.runs[0].run!;
    const dub = runs.getSkillRun(id)!.steps[0].ids;
    for (const g of dub) {
      await gens.cancelGeneration(g);
      db().prepare("UPDATE generations SET status = 'failed', error = 'No speech found in the clip' WHERE id = ?").run(g);
    }
    const v = await finish(id);
    expect(v.status).toBe("failed");
    expect(v.error).toBe("Dub failed: No speech found in the clip");
    expect(v.steps.map((s) => [s.status, s.error])).toEqual([
      ["failed", "No speech found in the clip"],
      ["failed", "Didn't start: Dub failed"],
      ["failed", "Didn't start: Captions failed"],
    ]);
  });

  it("keeps its state through a restart: a fresh server reads the run from skill_runs and carries on", async () => {
    const out = await recipes.runRecipe("spanish-short", { values: { video: clip, lang: "German" } }, "cloud");
    const id = out.runs[0].run!;
    // A new process: modules loaded again, nothing in memory but the database.
    vi.resetModules();
    const fresh = await import("@/server/skill-runs");
    const v = await finish(id, 150_000, fresh);
    expect(v.status).toBe("done");
    expect(v.steps.map((s) => s.status)).toEqual(["done", "done", "done"]);
    const row = db().prepare("SELECT values_json, state_json FROM skill_runs WHERE id = ?").get(id) as { values_json: string; state_json: string };
    expect(JSON.parse(row.values_json)).toMatchObject({ video: clip, lang: "German" });
  });
});

describe("following runs", () => {
  it("the runs route lists a skill's newest 8, or exactly the runs asked for by id however many", async () => {
    makeSkill("many-runs", spanishShort());
    const state = JSON.stringify({ engine: "cloud", title: "Spanish short", labels: [], parts: [] });
    const add = db().prepare("INSERT INTO skill_runs (id, skill, status, values_json, state_json, created_at, updated_at) VALUES (?, ?, 'done', '{}', ?, ?, ?)");
    const ids = Array.from({ length: 12 }, (_, i) => `many${i}`);
    ids.forEach((id, i) => add.run(id, "many-runs", state, 1000 + i, 1000 + i));
    add.run("other0", "spanish-short", state, 5000, 5000);
    const get = async (q = "") => {
      const res = await runsRoute.GET(new Request(`http://x/api/assist/skills/many-runs/runs${q}`), { params: Promise.resolve({ name: "many-runs" }) });
      return { status: res.status, items: ((await res.json()) as { items?: { id: string }[] }).items?.map((r) => r.id) };
    };
    expect((await get()).items).toEqual(ids.slice(4).reverse());
    // The CLI following a 10-row table asks for its own runs: the oldest of them too, and never another skill's.
    const asked = [...ids.slice(0, 10), "other0"];
    expect((await get(`?ids=${asked.join(",")}`)).items?.sort()).toEqual(ids.slice(0, 10).sort());
    expect((await get(`?ids=${Array.from({ length: 51 }, (_, i) => `x${i}`).join(",")}`)).status).toBe(400);
  });
});

describe("the demo scope", () => {
  it("is left by the timers a dry run may start first, and asks no LLM inside it", async () => {
    await runAsDemo(async () => {
      expect(inDemoScope()).toBe(true);
      expect(outsideDemo(() => inDemoScope())).toBe(false);
      expect(gens.outsideRuns(() => inDemoScope())).toBe(false);
      // The skill-run sweep, first started here, ticks outside the scope.
      const seen = await new Promise<boolean>((resolve) => outsideDemo(() => setTimeout(() => resolve(inDemoScope()), 1)));
      expect(seen).toBe(false);
      expect(await llmText("system", "user")).toBeNull();
    });
  });
});

describe("the studio dry run", () => {
  it("runs a studio module as a demo with no change to its code", async () => {
    expect(inDemoScope()).toBe(false);
    setSetting("demoMode", "off");
    try {
      const out = await runAsDemo(async () => {
        expect(inDemoScope()).toBe(true);
        return executeTool("add_captions", { video: clip }, { engine: "cloud" });
      });
      expect(out.isError).toBeFalsy();
      const ids = (out.items ?? []).flatMap((i) => (i.role === "generations" ? i.ids : []));
      for (const g of ids) expect(gens.getGeneration(g)).toMatchObject({ provider: "mock", request: { demo: true } });
    } finally {
      setSetting("demoMode", "auto");
    }
  });

  it("checks a recipe that spans studios for free with Demo mode off, then deletes the studio records it made", async () => {
    setSetting("demoMode", "off");
    try {
      makeSkill("spanish-check", spanishShort());
      const before = { dubs: count("dub_sessions"), runs: count("skill_runs") };
      const check = await recipes.verifyRecipe("spanish-check", "demo", "cloud");
      expect(check.engines[0].dryRun).toEqual({ ok: true, problems: [] });
      expect(check.view.recipe.verified?.cloud?.dryRun).toBeTruthy();
      // The dub session it opened is gone, and the run isn't one of the skill's runs.
      expect(count("dub_sessions")).toBe(before.dubs);
      expect(count("skill_runs")).toBe(before.runs);
      // What it made is in the Trash.
      const live = db().prepare("SELECT COUNT(*) AS n FROM generations g WHERE json_extract(request_json, '$.skill.name') = 'spanish-check' AND NOT EXISTS (SELECT 1 FROM generation_trash t WHERE t.generation_id = g.id)").get() as { n: number };
      expect(live.n).toBe(0);
      const made = db().prepare("SELECT COUNT(*) AS n FROM generations WHERE json_extract(request_json, '$.skill.name') = 'spanish-check'").get() as { n: number };
      expect(made.n).toBeGreaterThanOrEqual(3);
      // Its studio steps' rows keep their studio's feature, so they say they're a check: not a run in the skill's
      // history (W6) or in its use count (Assist's ranking).
      expect(recipes.skillHistory("spanish-check")).toMatchObject({ runs: 0, lastRun: null, recent: [] });
      uses.forgetSkillUses();
      expect(uses.skillUses().has("spanish-check")).toBe(false);
    } finally {
      setSetting("demoMode", "auto");
    }
  });

  it("checks a one-studio skill for free without the check counting as one of its runs", async () => {
    makeSkill("captions-check", { fuobeRecipe: 1, params: [{ id: "video", label: "Clip", type: "video", required: true, example: clip }], steps: [{ key: "captions", kind: "tool", tool: "add_captions", input: { video: "{{video}}" } }] }, "Captions");
    const check = await recipes.verifyRecipe("captions-check", "demo", "cloud");
    expect(check.engines[0].dryRun).toEqual({ ok: true, problems: [] });
    const rows = db().prepare("SELECT feature, json_extract(request_json, '$.skill.check') AS checked FROM generations WHERE json_extract(request_json, '$.skill.name') = 'captions-check'").all() as { feature: string; checked: number }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.feature !== lib.SKILL_CHECK_FEATURE && r.checked === 1)).toBe(true);
    expect(recipes.skillHistory("captions-check")).toMatchObject({ runs: 0, lastRun: null, recent: [] });
    uses.forgetSkillUses();
    expect(uses.skillUses().has("captions-check")).toBe(false);
  });

  it("checks a Faceless episode by its plan only: it goes on in Faceless Studio's own steps after its result", async () => {
    const scenes = Array.from({ length: 3 }, (_, i) => ({ narration: `Line ${i}`, visual: `Scene ${i}` }));
    makeSkill("faceless-check", { fuobeRecipe: 2, params: [], steps: [{ key: "ep", kind: "tool", tool: "faceless_episode", input: { scenes, style: "flat 2D" } }] }, "Episode");
    const episodes = count("faceless_episodes");
    const check = await recipes.verifyRecipe("faceless-check", "demo", "cloud");
    expect(check.engines[0].plan.ok).toBe(true);
    expect(check.engines[0].dryRun).toEqual({ ok: true, problems: [], skipped: "A studio step (faceless_episode) is checked by its plan only" });
    expect(count("faceless_episodes")).toBe(episodes);
  });
});
