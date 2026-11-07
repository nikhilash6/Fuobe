import crypto from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";
import RUNNABLE from "./fixtures/gpu-runnable-workflows.json";

/**
 * Assist never plans a free step the GPUs here can't run. The pool is one worker built from a real GPU's files (the
 * workflows it ran, as lanesFor reads them back from its files and packs): no LTX-2.5 files on it. Every starter, chip
 * and skill on the offline planner, and every open model and operation the generate tool plans, is checked: a step
 * planned on the GPUs here (free) is one a worker can take, a step whose model can't run moves to the best one that can
 * (said on the card), and the owner's run of a model nothing here runs is refused before anything starts, in plain words.
 */

vi.setConfig({ testTimeout: 120_000 });
const dir = tempDir("fuobe-assist-runnable-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";
delete process.env.FUOBE_HOSTED_RUNS;

const { setSetting } = await import("@/server/settings");
const agent = await import("@/server/assist/agent");
const tools = await import("@/server/assist/tools");
const { db } = await import("@/server/db");
const pool = await import("@/server/computer/pool");
const { catalogVersion } = await import("@/server/computer/catalog-version");
const { loadIndex } = await import("@/server/gpu/index-file");
const { allLanes, lanesFor, needsOf } = await import("@/lib/lanes");
const { poolTakes } = await import("@/server/hosted");
const { createGenerations } = await import("@/server/generations");
const { createPipeline } = await import("@/server/chains");
const { listSkills } = await import("@/server/skills");
const { ASSIST_STARTERS } = await import("@/lib/starters/assist");
const { ASSIST_SUGGESTIONS } = await import("@/lib/assist");
const { MODELS, getModel } = await import("@/lib/catalog");
const { notOnGpusText } = await import("@/server/runs-here");

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/** The workflows the worker runs: lanesFor over the files and node packs of the workflows the real GPU ran. */
let runnable: string[] = [];

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("engineMode", "both");
  setSetting("comfyWhere", "workers");
  const index = loadIndex();
  const known = (RUNNABLE as string[]).filter((id) => index.workflows[id]);
  const files = new Map<string, { folder: string; name: string; size: number; sha256: string | null }>();
  const packs = new Set<string>();
  for (const id of known) {
    const n = needsOf(index, id)!;
    for (const f of n.files) files.set(`${f.folder}/${f.name}`, f);
    for (const p of n.packs) packs.add(p);
  }
  const can = lanesFor(index, { files: [...files.values()], nodePacks: [...packs].map((name) => ({ name, commit: null })), media: ["image", "video", "audio"] }, sha);
  runnable = can.workflows;
  // One worker, allowed every lane (as the owner's is), holding exactly those workflows.
  const w = pool.addWorker("studio-gpu");
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: Object.fromEntries(allLanes(index, sha).map((l) => [l.lane, { delayMs: 0 }])), claimAfterMs: 0 });
  db()
    .prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ?, catalog_version = ?, protocol = 3, seen_at = ?, paused_local = 0 WHERE id = ?")
    .run(JSON.stringify({ lanes: can.lanes, workflows: can.workflows }), JSON.stringify({ vramBytes: 32 * 2 ** 30 }), catalogVersion(), Date.now(), w.id);
});

type Planned = ReturnType<typeof tools.planFor>["jobs"][number];

/** A step the card calls free: it runs on the GPUs here at no cost. */
const free = (j: Planned) => !j.error && !j.demo && j.costUsd === 0 && getModel(j.modelId)?.routes.some((r) => r.provider === "comfyui" && r.op === j.op);

/** The worker takes the step's workflow (as the run's own check reads it). */
const takes = (j: Planned) => {
  const m = getModel(j.modelId)!;
  return m.routes.some((r) => r.provider === "comfyui" && r.op === j.op && poolTakes(r.endpoint));
};

const offline = (text: string, engine: "open" | "cloud", hint?: Parameters<typeof agent.offlinePlan>[2]) => {
  const p = agent.offlinePlan(text, engine, hint);
  return p && "input" in p ? { p, plan: tools.planFor(p.tool, p.input, { engine }) } : null;
};

describe("the fake pool", () => {
  it("is the real GPU's: Ideogram 4, MiniMax H3 and Wan 2.2 run, LTX-2.5 doesn't", () => {
    expect(runnable).toEqual(expect.arrayContaining(["ideogram4-t2i", "minimax-h3-i2v", "wan22-i2v-14b-lightx2v"]));
    expect(runnable).not.toContain("ltx25-i2v");
    expect(poolTakes("ltx25-i2v")).toBe(false);
    expect(poolTakes("wan22-i2v-14b")).toBe(true);
  });
});

describe("Assist plans only free steps that can run", () => {
  it("the gold watch ad: the still, then a clip on a model the GPUs run, in shots, said on the card", () => {
    const r = offline(ASSIST_SUGGESTIONS[0], "open")!;
    expect(r.plan.jobs.map((j) => [j.kind, j.op])).toEqual([
      ["image", "t2i"],
      ["video", "i2v"],
    ]);
    const clip = r.plan.jobs[1];
    expect(clip.error).toBeUndefined();
    expect(clip.modelId).not.toBe("oss-ltx25");
    expect(free(clip) && takes(clip)).toBe(true);
    expect(getModel(clip.modelId)?.options.multiShot).toBeTruthy();
    expect(clip.changes?.[0]).toMatch(/^LTX-2\.5 isn't on your GPUs yet, so this step runs on /);
    // The run starts what the card showed: both steps, on the same models, nothing refused.
    expect(tools.planFor(r.p.tool, r.p.input, { engine: "open" }).jobs.map((j) => j.modelId)).toEqual(r.plan.jobs.map((j) => j.modelId));
  });

  it.each(["open", "cloud"] as const)("every chip, starter and skill on the offline planner (%s)", (engine) => {
    const asks: { what: string; text: string; hint?: Parameters<typeof agent.offlinePlan>[2] }[] = [
      ...ASSIST_SUGGESTIONS.map((text) => ({ what: `chip: ${text}`, text })),
      ...ASSIST_STARTERS.flatMap(({ id, seed }) => {
        if (seed.kind !== "assist") return [];
        const skill = seed.skill;
        return [{ what: `starter ${id}`, text: seed.prompt, hint: skill ? listSkills().find((k) => k.name === skill)?.offline : undefined }];
      }),
      ...listSkills().map((s) => ({ what: `skill ${s.name}`, text: "A model in a red silk gown on a Lake Como terrace at golden hour", hint: s.offline })),
      ...listSkills().map((s) => ({ what: `skill ${s.name}, animated`, text: "A hero still of a gold watch on a model's wrist, then animate it", hint: s.offline })),
    ];
    for (const a of asks) {
      const r = offline(a.text, engine, a.hint);
      if (!r) continue;
      for (const j of r.plan.jobs) {
        // No step names a model nothing here runs: it moved to one that does.
        expect(j.error ?? "", a.what).not.toMatch(/isn't on your GPUs|don't have .*files/);
        if (free(j)) expect(takes(j), `${a.what}: ${j.modelName} (${j.op})`).toBe(true);
      }
    }
  });

  it("every open model and operation the generate tool plans: free only where a worker takes it", () => {
    const img = "/api/files/x/still.png";
    const vid = "/api/files/x/clip.mp4";
    const snd = "/api/files/x/voice.wav";
    let freeSteps = 0;
    for (const m of MODELS) {
      if (m.hidden) continue;
      for (const r of m.routes) {
        if (r.provider !== "comfyui") continue;
        const job = { model_id: m.id, op: r.op, prompt: "A model in a black velvet suit on a palace staircase", images: [img], video: vid, audio: snd, ...(m.engines?.length ? { engine: "open" as const } : {}) };
        const plan = tools.planFor("generate", { summary: "check", jobs: [job] }, { engine: "open" });
        for (const j of plan.jobs) {
          if (!free(j)) continue;
          freeSteps++;
          expect(takes(j), `${m.id} ${r.op} → ${j.modelId}`).toBe(true);
        }
      }
    }
    expect(freeSteps).toBeGreaterThan(20);
  });

  it("search_models lists what the GPUs can't run last, saying so", async () => {
    const out = await tools.getTool("search_models")!.run({ kind: "video", task: "i2v" }, { engine: "open" } as never);
    const models = JSON.parse(String(out.content)).models as { id: string; notOnYourGpus?: string }[];
    const ltx = models.findIndex((m) => m.id === "oss-ltx25");
    expect(ltx).toBeGreaterThan(-1);
    expect(models[ltx].notOnYourGpus).toBeTruthy();
    expect(models.findIndex((m) => m.id === "oss-wan22-14b")).toBeLessThan(ltx);
    expect(models.find((m) => m.id === "oss-wan22-14b")?.notOnYourGpus).toBeUndefined();
  });
});

describe("the owner's runs meet the same check before anything starts", () => {
  const still = { feature: "image", modelId: "oss-ideogram-4", prompt: "A gold watch on a model's wrist" };
  const clip = { feature: "video", modelId: "oss-ltx25", op: "i2v", prompt: "The still comes to life" } as const;
  const rows = () => (db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n;

  it("a run of a model whose files no GPU has is refused in plain words", () => {
    const before = rows();
    expect(() => createGenerations({ ...clip, inputs: { images: ["/api/files/x/still.png"] } } as never)).toThrow("Your GPUs don't have LTX-2.5's files yet.");
    expect(rows()).toBe(before);
  });

  it("a chain whose second step can't run starts nothing", () => {
    const before = rows();
    expect(() =>
      createPipeline([
        { key: "still", request: still as never },
        { key: "clip", request: clip as never, after: "still" },
      ]),
    ).toThrow(/LTX-2\.5's files/);
    expect(rows()).toBe(before);
  });

  const jobs = [
    { model_id: "oss-ideogram-4", prompt: "A gold watch" },
    { model_id: "oss-ltx25", op: "i2v", prompt: "It comes to life", after: 0 },
  ];

  it("an Assist plan that names LTX-2.5 (an AI planner's) moves that step before Run", () => {
    const plan = tools.planFor("generate", { summary: "x", jobs }, { engine: "open" });
    expect(plan.jobs[1].error).toBeUndefined();
    expect(plan.jobs[1].modelId).not.toBe("oss-ltx25");
    expect(free(plan.jobs[1]) && takes(plan.jobs[1])).toBe(true);
  });

  it("a step nothing here can take, and no key runs in the cloud, is said before Run and blocks the chain", () => {
    const w = db().prepare("SELECT id, lanes_json FROM relay_workers").get() as { id: string; lanes_json: string };
    const keep = JSON.parse(w.lanes_json) as { lanes: string[]; workflows: string[] };
    // The worker loses every video workflow: no image-to-video model runs on the GPUs here, and no cloud key is set.
    db()
      .prepare("UPDATE relay_workers SET lanes_json = ? WHERE id = ?")
      .run(JSON.stringify({ lanes: keep.lanes, workflows: keep.workflows.filter((id) => !/i2v|video|h3|wan|ltx|hunyuan|kandinsky/.test(id)) }), w.id);
    try {
      const plan = tools.planFor("generate", { summary: "x", jobs }, { engine: "open" });
      expect(plan.jobs[1].error).toBe("Your GPUs don't have LTX-2.5's files yet. Add them to a worker's ComfyUI, or pick another model.");
      expect(plan.jobs[1].costUsd).not.toBeNull();
      expect(free(plan.jobs[1])).toBe(false);
    } finally {
      db().prepare("UPDATE relay_workers SET lanes_json = ? WHERE id = ?").run(w.lanes_json, w.id);
    }
  });

  it("the words for a missing model's files name the cause, not a lane setting", () => {
    expect(notOnGpusText("LTX-2.5", "files")).toMatch(/^Your GPUs don't have LTX-2\.5's files yet\./);
    expect(notOnGpusText("LTX-2.5", "files")).not.toMatch(/lane/i);
    expect(notOnGpusText("LTX-2.5", "lane")).toMatch(/Allow its lane/);
  });
});
