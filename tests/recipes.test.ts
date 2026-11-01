import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Route handlers call connection() (no request scope in a test).
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 120_000 });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-recipes-"));
process.env.FUOBE_DATA_DIR = dir;
// Nothing listens: open models run on the demo provider, and there's no LLM.
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const skills = await import("@/server/skills");
const recipes = await import("@/server/recipes");
const gens = await import("@/server/generations");
const { db } = await import("@/server/db");
const { saveFile } = await import("@/server/storage");
const { encodePng } = await import("@/server/png");
const { changeAccess } = await import("@/server/model-access");
const { today } = await import("@/lib/recipe");
const recipeRoute = await import("@/app/api/assist/skills/[name]/recipe/route");
const runRoute = await import("@/app/api/assist/skills/[name]/run/route");
const estimateRoute = await import("@/app/api/assist/skills/[name]/estimate/route");
const verifyRoute = await import("@/app/api/assist/skills/[name]/verify/route");
const generationsRoute = await import("@/app/api/generations/route");
const { handleMcp } = await import("@/server/mcp");

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

let photo = "";
let clip = "";
beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
  photo = saveFile({ data: encodePng({ width: 64, height: 48, data: Buffer.alloc(64 * 48 * 4, 180) }), contentType: "image/png", source: "upload", name: "lamp.png" }).url;
  clip = saveFile({ data: fs.readFileSync(path.join(__dirname, "fixtures/shorts-12s.mp4")), contentType: "video/mp4", source: "upload", name: "talk.mp4" }).url;
});

/** The research's turntable recipe: a cut-out, a scene, a clip of it (cloud models). */
const lamp = () => ({
  fuobeRecipe: 1,
  params: [
    { id: "product", label: "Product photo", type: "image", required: true, example: photo },
    { id: "name", label: "Product name", type: "text", required: true, example: "Lumen desk lamp", max: 200 },
    { id: "aspect", label: "Shape", type: "choice", options: ["1:1", "9:16", "16:9"], default: "1:1" },
    { id: "takes", label: "Takes", type: "number", min: 1, max: 4, default: 1 },
  ],
  steps: [
    { key: "cutout", kind: "generate", request: { feature: "skill", modelId: "birefnet-cloud", op: "bg-remove", inputs: { images: ["{{product}}"] } } },
    {
      key: "scene",
      kind: "generate",
      after: ["cutout"],
      chain: [{ slot: "images", position: "first" }],
      request: { feature: "skill", modelId: "nano-banana-pro", op: "edit", prompt: "{{name}} on a travertine plinth, soft window light", params: { aspectRatio: "{{aspect}}" } },
    },
    {
      key: "spin",
      kind: "generate",
      after: ["scene"],
      chain: [{ slot: "images" }],
      request: { feature: "skill", modelId: "kling-3", op: "i2v", prompt: "slow turntable of the {{name}}", params: { duration: 5, numOutputs: "{{takes}}" } },
    },
  ],
  checks: { spin: { kind: "video" } },
});

/** Fuobe Soul, an Original: one step that runs on both engines. */
const soul = (model = "fuobe-soul") => ({
  fuobeRecipe: 1,
  params: [{ id: "subject", label: "Subject", type: "text", required: true, example: "a ceramicist at her wheel" }],
  steps: [{ key: "portrait", kind: "generate", request: { feature: "skill", modelId: model, op: "t2i", prompt: "{{subject}}, editorial portrait", params: { aspectRatio: "4:5" } } }],
});

const captions = () => ({
  fuobeRecipe: 1,
  params: [
    { id: "video", label: "Clip", type: "video", required: true, example: clip },
    { id: "lang", label: "Caption language", type: "choice", options: ["Spanish", "German"], default: "Spanish" },
  ],
  steps: [{ key: "captions", kind: "tool", tool: "add_captions", input: { video: "{{video}}", translate_to: "{{lang}}" } }],
});

function makeSkill(name: string, recipe: unknown, title = "Lamp turntable") {
  skills.createSkill({ name, title, description: "A product turntable from a photo.", body: "# Turntable\n\n1. Cut out, stage, spin." });
  recipes.saveRecipe(name, recipe);
}

const count = () => (db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n;
const rowOf = (id: string) => db().prepare("SELECT batch_id, feature, provider, cost_usd, request_json FROM generations WHERE id = ?").get(id) as { batch_id: string; feature: string; provider: string; cost_usd: number | null; request_json: string };

async function settle(ids: string[], ms = 60_000) {
  const until = Date.now() + ms;
  for (;;) {
    const all = ids.map((id) => gens.getGeneration(id, { includeDeleted: true })!);
    if (all.every((g) => ["succeeded", "failed", "canceled"].includes(g.status))) return all;
    if (Date.now() > until) throw new Error(`timed out: ${all.map((g) => `${g.id} ${g.status} ${g.message}`).join(", ")}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

const json = (body: unknown) => new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const ctx = (name: string) => ({ params: Promise.resolve({ name }) }) as never;

describe("saving a recipe", () => {
  it("names every problem, and keeps the server's own fields out", () => {
    skills.createSkill({ name: "broken", title: "Broken", description: "x", body: "x" });
    const bad = { ...lamp(), steps: [{ key: "a", kind: "generate", request: { feature: "skill", modelId: "no-such-model", prompt: "{{nme}}" } }] };
    expect(() => recipes.saveRecipe("broken", bad)).toThrow(recipes.RecipeError);
    try {
      recipes.saveRecipe("broken", bad);
    } catch (e) {
      expect((e as InstanceType<typeof recipes.RecipeError>).problems).toEqual(expect.arrayContaining([expect.stringContaining("{{nme}}"), expect.stringContaining("“Product photo” ({{product}}) isn't used")]));
    }
    // The catalog, the tools a recipe may call, and the API's own limits.
    const unknown = { ...soul(), steps: [{ ...soul().steps[0], request: { ...soul().steps[0].request, modelId: "no-such-model" } }] };
    expect(() => recipes.saveRecipe("broken", unknown)).toThrow(/Fuobe has no model “no-such-model”/);
    expect(() => recipes.saveRecipe("broken", { ...soul(), steps: [{ key: "m", kind: "tool", tool: "remember", input: { text: "{{subject}}" } }] })).toThrow(/isn't a tool a recipe can run/);
    expect(() => recipes.saveRecipe("broken", { ...soul(), steps: [{ ...soul().steps[0], request: { ...soul().steps[0].request, params: { numOutputs: 20 } } }] })).toThrow(/numOutputs/);
    // verified is the server's to write: an edit starts unchecked.
    const saved = recipes.saveRecipe("broken", { ...soul(), verified: { cloud: { plan: "2026-01-01", catalog: "sha256:x" } } });
    expect(saved.verified).toBeUndefined();
    expect(skills.getSkill("broken")?.recipe).toBe(true);
  });

  it("refuses built-in skills: duplicate one first", () => {
    expect(() => recipes.saveRecipe("product-photoshoot", lamp())).toThrow(/Duplicate it first/);
    expect(() => skills.setSkillFile("product-photoshoot", "recipe.json", "{}")).toThrow(/Duplicate it first/);
    expect(() => recipes.recipeView("product-photoshoot")).toThrow(/has no recipe/);
    expect(skills.getSkill("product-photoshoot")?.recipe).toBeUndefined();
  });

  it("keeps a skill's files within their limits", () => {
    skills.createSkill({ name: "files", title: "Files", description: "x", body: "x" });
    expect(() => skills.setSkillFile("files", "../escape.md", "x")).toThrow(/isn't a file name/);
    expect(() => skills.setSkillFile("files", "image.png", "x")).toThrow(/isn't a file name/);
    expect(() => skills.setSkillFile("files", "big.txt", "x".repeat(400_001))).toThrow(/at most 400 KB/);
    expect(skills.setSkillFile("files", "notes.md", "hello").files).toEqual([{ path: "notes.md", size: 5 }]);
    expect(skills.setSkillFile("files", "notes.md", null).files).toEqual([]);
  });
});

describe("running a recipe", () => {
  it("runs only on an engine where it was checked", async () => {
    makeSkill("lamp-unchecked", lamp());
    await expect(recipes.runRecipe("lamp-unchecked", { values: { product: photo, name: "Lamp" } })).rejects.toThrow(/Check this skill on the cloud first/);
    expect(recipes.recipeView("lamp-unchecked")).toMatchObject({ engines: ["cloud"], ready: [], line: expect.stringMatching(/Not checked yet/) });
  });

  it("a 3-step recipe makes one batch of 3 rows with the skill stamp", async () => {
    makeSkill("lamp", lamp());
    const check = await recipes.verifyRecipe("lamp", "plan");
    expect(check.ok).toBe(true);
    expect(check.view.ready).toEqual(["cloud"]);
    const out = await recipes.runRecipe("lamp", { values: { product: photo, name: "Arc floor lamp", aspect: "9:16", takes: 2 } });
    expect(out.runs).toHaveLength(1);
    const [run] = out.runs;
    expect(run.ids).toHaveLength(3);
    const rows = run.ids.map(rowOf);
    expect(new Set(rows.map((r) => r.batch_id))).toEqual(new Set([run.batchId]));
    for (const r of rows) {
      const req = JSON.parse(r.request_json);
      expect(req.skill).toEqual({ name: "lamp", run: run.batchId });
      expect(req.batchTitle).toBe("Lamp turntable");
      expect(req.demo).toBeUndefined();
    }
    expect(JSON.parse(rows[1].request_json).prompt).toBe("Arc floor lamp on a travertine plinth, soft window light");
    expect(JSON.parse(rows[2].request_json).params).toMatchObject({ numOutputs: 2, duration: 5 });
    // Demo mode on auto with no keys: the whole chain runs on the demo provider, and finishes.
    const done = await settle(run.ids);
    expect(done.map((g) => g.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(done.every((g) => g.provider === "mock")).toBe(true);
    expect(out.demo).toBe(true);
  });

  it("3 CSV rows make 3 batches; one bad row starts nothing", async () => {
    const csv = `Product photo,Product name,Shape\n${photo},Desk lamp,1:1\n${photo},"Lamp, brass",16:9\n${photo},Floor lamp,9:16\n`;
    const est = recipes.estimateRecipe("lamp", { csv });
    expect(est).toMatchObject({ runnable: true, demo: true, errors: [] });
    expect(est.runs).toHaveLength(3);
    const out = await recipes.runRecipe("lamp", { csv });
    expect(out.runs).toHaveLength(3);
    expect(new Set(out.runs.map((r) => r.batchId)).size).toBe(3);
    expect(out.runs.every((r) => r.ids.length === 3)).toBe(true);
    await settle(out.runs.flatMap((r) => r.ids));
    const before = count();
    const bad = `product,name\n${photo},Desk lamp\n${photo},Lamp two\nnot-a-link,Floor lamp\n`;
    await expect(recipes.runRecipe("lamp", { csv: bad })).rejects.toThrow(/Row 4: Product photo: a file from Fuobe/);
    expect(count()).toBe(before);
  });

  it("prices rows together, with a total", async () => {
    setSetting("falKey", "test-key");
    try {
      const one = recipes.estimateRecipe("lamp", { values: { product: photo, name: "Lamp" } });
      expect(one.demo).toBe(false);
      expect(one.total).toBeGreaterThan(0);
      expect(one.jobs.map((j) => j.modelId)).toEqual(["birefnet-cloud", "nano-banana-pro", "kling-3"]);
      const two = recipes.estimateRecipe("lamp", { rows: [{ product: photo, name: "A" }, { product: photo, name: "B" }] });
      expect(two.total).toBeCloseTo(2 * one.total!, 5);
      // A row with a problem stops the batch: no total, and the row says why.
      const mixed = recipes.estimateRecipe("lamp", { rows: [{ product: photo, name: "A" }, { name: "B" }] });
      expect(mixed).toMatchObject({ runnable: false, total: null });
      expect(mixed.runs[1].errors).toEqual(["Product photo is needed"]);
    } finally {
      setSetting("falKey", "");
    }
  });

  it("a tool recipe (add_captions) runs through executeTool and opens its studio", async () => {
    makeSkill("caption-it", captions(), "Caption it");
    const check = await recipes.verifyRecipe("caption-it", "demo");
    expect(check.ok).toBe(true);
    // A studio step gets the plan check only in W1 (its dry run would make a record the user sees).
    expect(check.engines.map((e) => e.dryRun?.skipped)).toEqual([expect.stringContaining("checked by its plan only"), expect.stringContaining("checked by its plan only")]);
    const out = await recipes.runRecipe("caption-it", { values: { video: clip, lang: "German" } }, "open");
    expect(out.runs).toHaveLength(1);
    expect(out.runs[0].href).toMatch(/^\/video-tools\/captions\?video=/);
    expect(out.runs[0].ids.length).toBeGreaterThan(0);
    expect(gens.getGeneration(out.runs[0].ids[0])).toMatchObject({ op: "captions" });
    // The tool made its own requests: each one in its batch (the transcript too) carries the run's stamp and the
    // skill's title, as a pipeline's do, so the Library groups the run and its history reads back.
    const batch = out.runs[0].batchId!;
    expect(batch).toBeTruthy();
    const made = db().prepare("SELECT request_json FROM generations WHERE batch_id = ?").all(batch) as { request_json: string }[];
    expect(made.length).toBeGreaterThanOrEqual(out.runs[0].ids.length);
    for (const r of made) expect(JSON.parse(r.request_json)).toMatchObject({ skill: { name: "caption-it", run: batch }, batchTitle: "Caption it" });
  });

  it("a header with no rows is refused with the reason, not a crash", async () => {
    const res = await runRoute.POST(json({ csv: "product,name\n" }), ctx("lamp"));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "Add a row under the header: one row per run" });
    expect(recipes.estimateRecipe("lamp", { csv: "product,name\n" })).toMatchObject({ runnable: false, errors: ["Add a row under the header: one row per run"] });
    await expect(recipes.runRecipe("lamp", { rows: [] })).rejects.toThrow(/Add a row to run/);
  });

  it("without an engine, runs where it was checked", async () => {
    makeSkill("gpu-only", soul(), "GPU only");
    await recipes.verifyRecipe("gpu-only", "plan", "open");
    expect(recipes.recipeView("gpu-only").ready).toEqual(["open"]);
    expect(recipes.estimateRecipe("gpu-only", { values: { subject: "a potter" } }).engine).toBe("open");
    const out = await recipes.runRecipe("gpu-only", { values: { subject: "a potter" } });
    expect(out.engine).toBe("open");
    expect(gens.getGeneration(out.runs[0].ids[0])).toMatchObject({ engine: "open" });
    // Asked for the cloud, it still says to check it there first.
    await expect(recipes.runRecipe("gpu-only", { values: { subject: "a potter" } }, "cloud")).rejects.toThrow(/Check this skill on the cloud first/);
  });

  it("a skill switched off doesn't run until it's switched on", async () => {
    skills.setSkillEnabled("gpu-only", false);
    try {
      expect(recipes.recipeView("gpu-only").enabled).toBe(false);
      const before = count();
      await expect(recipes.runRecipe("gpu-only", { values: { subject: "a potter" } })).rejects.toThrow(/switched off — switch it on in Skills/);
      expect(() => recipes.estimateRecipe("gpu-only", { values: { subject: "a potter" } })).toThrow(/switched off/);
      expect((await runRoute.POST(json({ values: { subject: "a potter" } }), ctx("gpu-only"))).status).toBe(409);
      expect(count()).toBe(before);
    } finally {
      skills.setSkillEnabled("gpu-only", true);
    }
    expect(recipes.recipeView("gpu-only").enabled).toBe(true);
  });
});

describe("checking a recipe", () => {
  it("plans on each engine the steps allow: an Original on both, a partner model on its own", async () => {
    makeSkill("portrait", soul(), "Portrait");
    const r = await recipes.verifyRecipe("portrait", "plan");
    expect(r.ok).toBe(true);
    expect(r.engines.map((e) => e.engine)).toEqual(["cloud", "open"]);
    const v = r.view.recipe.verified!;
    expect(v.cloud).toMatchObject({ plan: today(), dryRun: null, catalog: expect.stringMatching(/^sha256:/) });
    expect(v.open).toMatchObject({ plan: today(), catalog: expect.stringMatching(/^sha256:/) });
    expect(v.cloud!.catalog).not.toBe(v.open!.catalog);
    expect(r.view.ready).toEqual(["cloud", "open"]);
    expect(r.view.models.map((m) => m.engine)).toEqual(["cloud", "open"]);
    // The lamp's models are cloud partners: the cloud only.
    expect(recipes.recipeView("lamp").engines).toEqual(["cloud"]);
    // Asked for one engine, only that one is checked.
    expect((await recipes.verifyRecipe("portrait", "plan", "open")).engines.map((e) => e.engine)).toEqual(["open"]);
  });

  it("dry-runs for free with Demo mode Off and no keys: all on the mock provider, hidden, then trashed", async () => {
    setSetting("demoMode", "off");
    try {
      makeSkill("lamp-dry", lamp());
      // A real run can't start here (nothing connected, demo off)…
      const r = await recipes.verifyRecipe("lamp-dry", "demo");
      // …but the recipe itself passes: its plan on the demo provider, and a dry run there.
      expect(r.ok).toBe(true);
      const [cloud] = r.engines;
      expect(cloud.plan).toMatchObject({ ok: true, notes: expect.arrayContaining([expect.stringContaining("Connect fal.ai")]) });
      expect(cloud.dryRun).toEqual({ ok: true, problems: [] });
      expect(r.view.recipe.verified?.cloud).toMatchObject({ plan: today(), dryRun: today() });
      const rows = db().prepare("SELECT id, provider, cost_usd, request_json FROM generations WHERE feature = 'skill-check'").all() as { id: string; provider: string; cost_usd: number | null; request_json: string }[];
      expect(rows).toHaveLength(3);
      expect(rows.every((x) => x.provider === "mock" && !x.cost_usd)).toBe(true);
      expect(rows.every((x) => JSON.parse(x.request_json).demo === true)).toBe(true);
      // Hidden from the Library, and in the Trash.
      const listed = new Set(gens.listGenerations({ limit: 200 }).map((g) => g.id));
      expect(rows.some((x) => listed.has(x.id))).toBe(false);
      const trashed = new Set((db().prepare("SELECT generation_id FROM generation_trash").all() as { generation_id: string }[]).map((t) => t.generation_id));
      expect(rows.every((x) => trashed.has(x.id))).toBe(true);
      // Running it for real still says what to connect.
      await expect(recipes.runRecipe("lamp-dry", { values: { product: photo, name: "Lamp" } })).rejects.toThrow(/Connect/);
    } finally {
      setSetting("demoMode", "auto");
    }
  });

  it("needs a re-check after a REPLACED_BY move, and after a model is switched off", async () => {
    // A recipe checked when it named Soul 2.0, which Fuobe retired.
    skills.createSkill({ name: "old-soul", title: "Old soul", description: "x", body: "x" });
    const checked = { ...soul("soul-2"), verified: { cloud: { plan: "2026-10-01", dryRun: "2026-10-01", real: null, catalog: "sha256:old" } } };
    skills.setSkillFile("old-soul", "recipe.json", JSON.stringify(checked));
    expect(recipes.recipeView("old-soul").recheck.cloud).toEqual(["Soul 2.0 (Higgsfield) was replaced by Fuobe Soul"]);
    // The re-check moves the step to what replaced it, as every run does.
    const again = await recipes.verifyRecipe("old-soul", "demo");
    expect(again.ok).toBe(true);
    expect(again.view.recipe.steps[0]).toMatchObject({ request: { modelId: "fuobe-soul" } });
    expect(again.view.recheck).toEqual({});

    // A model switched off in Settings → Models & licences.
    expect(recipes.recipeView("lamp").recheck).toEqual({});
    changeAccess([{ kind: "model", id: "nano-banana-pro", on: false }]);
    try {
      expect(recipes.recipeView("lamp").recheck.cloud).toEqual(["Nano Banana Pro is switched off in Settings → Models & licences"]);
      await expect(recipes.runRecipe("lamp", { values: { product: photo, name: "Lamp" } })).rejects.toThrow(/turned off|switched off/i);
    } finally {
      changeAccess([{ kind: "model", id: "nano-banana-pro", on: true }]);
    }
    expect(recipes.recipeView("lamp").recheck).toEqual({});
    // A different plan (another model in a step) no longer matches the hash that was checked.
    const file = JSON.parse(skills.skillFile("lamp", "recipe.json")!);
    file.steps[1].request.modelId = "seedream-5-pro";
    skills.setSkillFile("lamp", "recipe.json", JSON.stringify(file));
    expect(recipes.recipeView("lamp").recheck.cloud).toEqual(["The models, routes or prices it uses changed since it was checked"]);
  });

  it("never writes a check over a recipe saved while it ran, and keeps checks that finished meanwhile", async () => {
    makeSkill("race", soul(), "Race");
    // The dry run waits for its rows: the recipe is edited (a PUT, an upload) before it ends.
    const checking = recipes.verifyRecipe("race", "demo", "open");
    const edited = { ...soul(), params: [{ ...soul().params[0], example: "a baker at dawn" }] };
    recipes.saveRecipe("race", edited);
    await expect(checking).rejects.toThrow(/changed while it was being checked/);
    const stored = JSON.parse(skills.skillFile("race", "recipe.json")!);
    expect(stored.params[0].example).toBe("a baker at dawn");
    expect(stored.verified).toBeUndefined();
    // A check of the other engine that ends meanwhile only adds what it checked: both are kept.
    const open = recipes.verifyRecipe("race", "demo", "open");
    await recipes.verifyRecipe("race", "plan", "cloud");
    const r = await open;
    expect(r.view.recipe.verified).toMatchObject({ cloud: { plan: today() }, open: { plan: today(), dryRun: today() } });
  });

  it("only falls back to the demo route when a provider to connect is all that stops a run", () => {
    expect(recipes.onlyConnect(["Connect fal.ai or Replicate in Settings to run this model"])).toBe(true);
    expect(recipes.onlyConnect(["Connect Ollama in Settings to run this model (open-source text runs on your own machine)"])).toBe(true);
    expect(recipes.onlyConnect(["This model takes up to 3 images on fal.ai — remove some"])).toBe(false);
    expect(recipes.onlyConnect(["Connect fal.ai in Settings to run this model", "Fuobe Try-On runs with the LoRA “Try-On”, which this run leaves out. Pick another model or engine"])).toBe(false);
    expect(recipes.onlyConnect([])).toBe(false);
  });

  it("judges a look only with a model that sees images, and on the GPU never with a paid one", async () => {
    let vision = false;
    let asked = 0;
    const ollama = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        res.setHeader("Content-Type", "application/json");
        if (req.url === "/api/show") return res.end(JSON.stringify({ capabilities: vision ? ["completion", "vision"] : ["completion"] }));
        // The local-model layer (src/server/llm) finds a running Ollama by its model list before it calls it.
        if (req.url === "/api/tags") return res.end(JSON.stringify({ models: [{ name: "qwen3-vl:8b" }] }));
        if (req.url === "/api/chat") {
          asked++;
          return res.end(JSON.stringify({ message: { content: "No — a grey square, no one at a wheel." } }));
        }
        res.statusCode = 404;
        res.end("{}");
      });
    });
    await new Promise<void>((r) => ollama.listen(0, "127.0.0.1", () => r()));
    setSetting("ollamaUrl", `http://127.0.0.1:${(ollama.address() as AddressInfo).port}`);
    setSetting("enhanceProvider", "ollama");
    try {
      makeSkill("looked", { ...soul(), checks: { portrait: { kind: "image", look: "a ceramicist at her wheel" } } }, "Looked");
      // A text-only model would answer from the words alone: the look isn't judged, and the test doesn't fail on it.
      let r = await recipes.verifyRecipe("looked", "real", "open", { confirm: true });
      expect(asked).toBe(0);
      expect(r.engines[0].real).toMatchObject({ ok: true, notes: expect.arrayContaining([expect.stringContaining("the look wasn't judged")]) });
      // A model that sees images judges it; with a Claude key set and the helper on auto, the GPU still asks Ollama.
      vision = true;
      globalThis.__fuobeOllamaVision?.clear();
      setSetting("enhanceProvider", "auto");
      setSetting("anthropicKey", "sk-ant-test");
      r = await recipes.verifyRecipe("looked", "real", "open", { confirm: true });
      expect(asked).toBe(1);
      expect(r.engines[0].real).toMatchObject({ ok: false, problems: ["Step “portrait” doesn't look like “a ceramicist at her wheel”"] });
    } finally {
      setSetting("anthropicKey", "");
      setSetting("enhanceProvider", "none");
      setSetting("ollamaUrl", "");
      ollama.close();
    }
  });

  it("a real test asks first, and measures what it made", async () => {
    await expect(recipes.verifyRecipe("lamp-unchecked", "real")).rejects.toThrow(/confirm it with its price first/);
    const r = await recipes.verifyRecipe("lamp-unchecked", "real", undefined, { confirm: true });
    const [cloud] = r.engines;
    // No key: it ran as a demo, so it isn't recorded as a real test, and says so.
    expect(cloud.real).toMatchObject({ ok: true, demo: true, notes: [expect.stringContaining("ran as a demo")] });
    expect(r.view.recipe.verified?.cloud?.real).toBeNull();
  });
});

describe("the server-set fields", () => {
  it("strips skill and demo from API input, like chainFilled", async () => {
    setSetting("demoMode", "off");
    try {
      const res = await generationsRoute.POST(json({ feature: "image", modelId: "nano-banana-pro", op: "t2i", prompt: "a lamp", demo: true, skill: { name: "lamp", run: "forged" }, chainFilled: true }));
      // Without the flag, Demo mode off and no key: the API refuses, rather than running a free demo.
      expect(res.status).toBe(422);
      expect(((await res.json()) as { error: string }).error).toMatch(/Connect/);
    } finally {
      setSetting("demoMode", "auto");
    }
    const ok = (await (await generationsRoute.POST(json({ feature: "image", modelId: "nano-banana-pro", op: "t2i", prompt: "a lamp", demo: true, skill: { name: "lamp", run: "forged" } }))).json()) as { items: { request: Record<string, unknown> }[] };
    expect(ok.items[0].request.skill).toBeUndefined();
    expect(ok.items[0].request.demo).toBeUndefined();
  });

  it("serves a recipe skill's Run it section in its MCP prompt", async () => {
    const r = (await handleMcp({ jsonrpc: "2.0", id: 1, method: "prompts/get", params: { name: "lamp" } })) as { result: { messages: { content: { text: string } }[] } };
    expect(r.result.messages[0].content.text).toContain("## Run it");
  });
});

describe("the recipe routes", () => {
  it("reads, saves, prices, checks and runs over HTTP", async () => {
    skills.createSkill({ name: "via-api", title: "Via API", description: "x", body: "x" });
    const put = await recipeRoute.PUT(new Request("http://x", { method: "PUT", body: JSON.stringify(soul()) }), ctx("via-api"));
    expect(put.status).toBe(200);
    const bad = await recipeRoute.PUT(new Request("http://x", { method: "PUT", body: JSON.stringify({ ...soul(), params: [] }) }), ctx("via-api"));
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ problems: [expect.stringContaining("{{subject}}")] });
    expect((await runRoute.POST(json({ values: { subject: "a potter" } }), ctx("via-api"))).status).toBe(409);
    const verify = await verifyRoute.POST(json({ level: "plan" }), ctx("via-api"));
    expect(verify.status).toBe(200);
    const est = await (await estimateRoute.POST(json({ csv: "subject\na potter\na baker", engine: "open" }), ctx("via-api"))).json();
    expect(est).toMatchObject({ engine: "open", runnable: true, runs: [{ errors: [] }, { errors: [] }] });
    const run = await runRoute.POST(json({ rows: [{ subject: "a potter" }], engine: "open" }), ctx("via-api"));
    expect(run.status).toBe(201);
    const body = (await run.json()) as { runs: { ids: string[] }[] };
    expect(gens.getGeneration(body.runs[0].ids[0])).toMatchObject({ modelId: "fuobe-soul", engine: "open" });
    const view = await (await recipeRoute.GET(new Request("http://x"), ctx("via-api"))).json();
    expect(view).toMatchObject({ name: "via-api", engines: ["cloud", "open"], ready: ["cloud", "open"] });
    expect((await recipeRoute.GET(new Request("http://x"), ctx("nope"))).status).toBe(404);
  });
});
