import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Skills W6: `pnpm eval:from-skill <name>` writes a suite from a saved skill's recipe (its examples and checks), and the
 * harness runs it through the skill's own routes, served over HTTP as a running Fuobe serves them, on the demo provider.
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 120_000, hookTimeout: 60_000 });

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-eval-skill-"));
const results = path.join(dir, "results");
process.env.FUOBE_DATA_DIR = path.join(dir, "data");
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const skills = await import("@/server/skills");
const recipes = await import("@/server/recipes");
const { saveFile } = await import("@/server/storage");
const { encodePng } = await import("@/server/png");
const status = await import("@/app/api/status/route");
const models = await import("@/app/api/models/route");
const generations = await import("@/app/api/generations/route");
const generation = await import("@/app/api/generations/[id]/route");
const uploads = await import("@/app/api/uploads/route");
const files = await import("@/app/api/files/[...path]/route");
const recipeRoute = await import("@/app/api/assist/skills/[name]/recipe/route");
const estimateRoute = await import("@/app/api/assist/skills/[name]/estimate/route");
const runRoute = await import("@/app/api/assist/skills/[name]/run/route");

const evalCli = (await import("../scripts/eval/eval.mjs")) as { main: (argv: string[], io?: object) => Promise<number> };
const fromSkill = (await import("../scripts/eval/lib/from-skill.mjs")) as { suiteFromSkill: (view: unknown) => Record<string, unknown> & { cases: Record<string, unknown>[] } };
const runner = (await import("../scripts/eval/lib/run.mjs")) as { routeResult: (answer: unknown, how?: string) => { id: string }[] };
const store = (await import("../scripts/eval/lib/store.mjs")) as { latestJobs: (d: string) => (Record<string, unknown> & { status: string; caseId: string })[] };

const ctx = (params: Record<string, unknown>) => ({ params: Promise.resolve(params) }) as never;
const ROUTES: [string, RegExp, (req: Request, m: RegExpExecArray) => Promise<Response>][] = [
  ["GET", /^\/api\/status$/, () => status.GET()],
  ["GET", /^\/api\/models$/, (r) => models.GET(r)],
  ["POST", /^\/api\/generations$/, (r) => generations.POST(r)],
  ["GET", /^\/api\/generations\/([^/]+)$/, (r, m) => generation.GET(r, ctx({ id: m[1] }))],
  ["POST", /^\/api\/uploads$/, (r) => uploads.POST(r)],
  ["GET", /^\/api\/files\/(.+)$/, (r, m) => files.GET(r, ctx({ path: m[1].split("/").map(decodeURIComponent) }))],
  ["GET", /^\/api\/assist\/skills\/([^/]+)\/recipe$/, (r, m) => recipeRoute.GET(r, ctx({ name: m[1] }))],
  ["POST", /^\/api\/assist\/skills\/([^/]+)\/estimate$/, (r, m) => estimateRoute.POST(r, ctx({ name: m[1] }))],
  ["POST", /^\/api\/assist\/skills\/([^/]+)\/run$/, (r, m) => runRoute.POST(r, ctx({ name: m[1] }))],
];

let server: http.Server;
let base = "";
let photo = "";

beforeAll(async () => {
  setSetting("demoMode", "on");
  setSetting("enhanceProvider", "none");
  photo = saveFile({ data: encodePng({ width: 64, height: 48, data: Buffer.alloc(64 * 48 * 4, 180) }), contentType: "image/png", source: "upload", name: "lamp.png" }).url;
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://fuobe.test");
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const route = ROUTES.find(([method, re]) => method === req.method && re.test(url.pathname));
    if (!route) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "Not found" }));
    }
    const body = chunks.length && req.method !== "GET" ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://localhost${url.pathname}${url.search}`, { method: req.method, headers: req.headers as Record<string, string>, body });
    try {
      const answer = await route[2](request, route[1].exec(url.pathname)!);
      res.writeHead(answer.status, Object.fromEntries(answer.headers));
      res.end(Buffer.from(await answer.arrayBuffer()));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: (e as Error).message }));
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

async function cli(argv: string[]) {
  let out = "";
  let err = "";
  const sink = (put: (s: string) => void) => new Writable({ write: (c, _e, done) => (put(c.toString()), done()) });
  const code = await evalCli.main(argv, { stdout: sink((s) => (out += s)), stderr: sink((s) => (err += s)), env: { ...process.env, FUOBE_EVAL_RESULTS: results, FUOBE_URL: base, FUOBE_CONFIG: path.join(dir, "no-config.json"), FUOBE_EVAL_PYTHON: "/nonexistent/python" } });
  return { code, stdout: out, stderr: err };
}

const lamp = () => ({
  fuobeRecipe: 1,
  params: [
    { id: "product", label: "Product photo", type: "image", required: true, example: photo },
    { id: "name", label: "Product name", type: "text", required: true, example: "Lumen desk lamp", max: 200 },
    { id: "aspect", label: "Shape", type: "choice", options: ["1:1", "9:16"], default: "1:1" },
  ],
  steps: [
    { key: "cutout", kind: "generate", request: { feature: "skill", modelId: "birefnet-cloud", op: "bg-remove", inputs: { images: ["{{product}}"] } } },
    { key: "scene", kind: "generate", after: ["cutout"], chain: [{ slot: "images", position: "first" }], request: { feature: "skill", modelId: "nano-banana-pro", op: "edit", prompt: "{{name}} on a plinth", params: { aspectRatio: "{{aspect}}" } } },
  ],
  checks: { scene: { kind: "image", count: 1, aspect: "{{aspect}}", look: "a lamp on a plinth" } },
});

describe("pnpm eval:from-skill", () => {
  it("writes a suite from the recipe's examples and checks, and the harness runs it through the skill's routes", async () => {
    skills.createSkill({ name: "lamp-scene", title: "Lamp scene", description: "A product on a plinth.", body: "x" });
    recipes.saveRecipe("lamp-scene", lamp());
    expect((await recipes.verifyRecipe("lamp-scene", "plan")).ok).toBe(true);
    const out = path.join(dir, "suites", "skill-lamp-scene.json");
    const w = await cli(["from-skill", "lamp-scene", "--out", out]);
    expect(w.code, w.stderr).toBe(0);
    const suite = JSON.parse(fs.readFileSync(out, "utf8"));
    expect(suite).toMatchObject({ suite: "skill-lamp-scene", kind: "image", targets: { cloud: { models: ["nano-banana-pro"] }, demo: { models: ["nano-banana-pro"] } } });
    expect(suite.cases).toHaveLength(1);
    expect(suite.cases[0]).toMatchObject({
      id: "skill-lamp-scene/cloud",
      engines: ["cloud", "demo"],
      inputs: { images: [photo] },
      demoInputs: { images: ["fixtures/start-frame.png"] },
      submit: { route: "/api/assist/skills/lamp-scene/run", estimate: "/api/assist/skills/lamp-scene/estimate", body: { engine: "cloud", values: { product: "{{inputs.images.0}}", name: "Lumen desk lamp", aspect: "1:1" } } },
    });
    expect(suite.cases[0].note).toMatch(/Its checks: scene: image · 1 take · \{\{aspect\}\} · looks like “a lamp on a plinth”/);

    const r = await cli(["run", "--suite", out, "--engine", "demo", "--no-metrics"]);
    expect(r.code, r.stderr).toBe(0);
    const runId = /Run (\S+):/.exec(r.stderr)?.[1] ?? "";
    const rows = store.latestJobs(path.join(results, runId));
    expect(rows.map((x) => [x.caseId, x.status])).toEqual([["skill-lamp-scene/cloud", "succeeded"]]);
    // Its runs carry the skill's stamp, so they're in its History.
    expect(recipes.skillHistory("lamp-scene").runs).toBe(1);
  });

  it("reads a skill run's answer: its rows, the last one the result", () => {
    const answer = { engine: "cloud", demo: true, runs: [{ batchId: "b1", ids: ["g1", "g2", "g3"], href: "/library" }] };
    expect(runner.routeResult(answer)).toEqual([{ id: "g3" }]);
    expect(runner.routeResult(answer, "all").map((g) => g.id)).toEqual(["g1", "g2", "g3"]);
  });

  it("refuses a skill that runs a studio tool, or runs nowhere here", () => {
    const view = { name: "caps", title: "Caps", engines: ["cloud"], recipe: { params: [], steps: [{ key: "c", kind: "tool", tool: "add_captions", input: {} }] } };
    expect(() => fromSkill.suiteFromSkill(view)).toThrow(/runs a studio tool/);
    expect(() => fromSkill.suiteFromSkill({ ...view, engines: [], why: "It runs on cloud models, which aren't available here", recipe: lamp() })).toThrow(/doesn't run on this Fuobe: It runs on cloud models/);
  });

  it("refuses a skill that runs in parts (a step takes another's output by reference)", () => {
    const parts = lamp();
    const scene = { key: "scene", kind: "generate", request: { ...parts.steps[1].request, inputs: { images: ["{{steps.cutout.output}}"] } } };
    const view = { name: "parts", title: "Parts", engines: ["cloud"], recipe: { ...parts, fuobeRecipe: 2, steps: [parts.steps[0], scene] } };
    expect(() => fromSkill.suiteFromSkill(view)).toThrow(/runs in parts/);
    expect(() => fromSkill.suiteFromSkill({ ...view, recipe: lamp() })).not.toThrow();
  });
});
