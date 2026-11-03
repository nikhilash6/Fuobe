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
const { inDemoScope, runAsDemo } = await import("@/server/demo-scope");
const lib = await import("@/lib/recipe");
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
    expect(done.steps[1]).toMatchObject({ studio: "Captions", href: expect.stringMatching(/^\/video-tools\/captions\?video=/) });

    // The skill's dialog reads its runs.
    const res = await runsRoute.GET(new Request("http://x/api"), { params: Promise.resolve({ name: "spanish-short" }) } as never);
    const body = (await res.json()) as { items: { id: string; status: string }[] };
    expect(body.items[0]).toMatchObject({ id: run.run, status: "done" });
    expect(lib.runLine(done.steps)).toBe("Dub · done → Captions · done → 9:16 cut · done");
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
    } finally {
      setSetting("demoMode", "auto");
    }
  });
});
