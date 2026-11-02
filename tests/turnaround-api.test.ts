import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** Turnaround video (build plan N7-6) through /api/turnaround and Cinema's "turnaround" action, on the demo provider. */

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-turnaround-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const cinema = await import("@/server/cinema");
const route = await import("@/app/api/turnaround/route");
const estimate = await import("@/app/api/turnaround/estimate/route");
const cinemaRoute = await import("@/app/api/cinema/projects/[id]/generate/route");
const { saveFile } = await import("@/server/storage");
const { encodePng } = await import("@/server/png");
const { NEEDS_CONSENT } = await import("@/server/turnaround");
const { ORBIT_PROMPT } = await import("@/lib/catalog/turnaround");
const { db } = await import("@/server/db");
const { routeResult } = (await import("../scripts/eval/lib/run.mjs")) as { routeResult: (answer: unknown, how?: string) => { id: string; op?: string }[] };

beforeAll(() => {
  setSetting("demoMode", "auto");
  setSetting("enhanceProvider", "none");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const upload = (name: string, width = 18, height = 32) => saveFile({ data: encodePng({ width, height, data: Buffer.alloc(width * height * 4, 128) }), contentType: "image/png", name, source: "upload" }).url;
const post = (body: unknown, preview = false) =>
  route.POST(new Request(`http://x/api/turnaround${preview ? "?preview=1" : ""}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

async function settle(id: string, ms = 60_000) {
  const until = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > until) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

describe("/api/turnaround", () => {
  it("previews the open engine's run: the sides drawn first, the film's frames, Free, the GPU it needs", async () => {
    const front = upload("front.png");
    const back = upload("back.png");
    const res = await post({ engine: "open", views: { front, back } }, true);
    expect(res.status).toBe(200);
    const p = await res.json();
    expect(p).toMatchObject({ route: "frames", routes: ["frames", "stills"], fills: ["right", "left"], steps: 3, costUsd: 0, demo: true, gpuGb: 24, duration: 8 });
    expect(p.frames.map((f: { side: string; from: string }) => `${f.side}:${f.from}`)).toEqual(["front:picture", "right:angles", "back:picture", "left:angles", "front:picture"]);
    expect(p.blocker).toBeUndefined();
  });

  it("runs it as one batch: the sides drawn, then each quarter turn waits for its own frames, then the film", async () => {
    const front = upload("front2.png");
    const back = upload("back2.png");
    const res = await post({ engine: "open", views: { front, back }, name: "Ada", requestId: "turn-open-1" });
    expect(res.status).toBe(201);
    const answer = await res.json();
    const { items, filmId, batchId } = answer;
    expect(items[0].id).toBe(filmId);
    // The answer names the film as `final`, so the evaluation harness measures it (not the last clip made).
    expect(answer.final.id).toBe(filmId);
    expect(routeResult(answer).map((g: { id: string }) => g.id)).toEqual([filmId]);
    expect(items[0]).toMatchObject({ modelId: "oss-join-clips", op: "concat", feature: "turnaround", prompt: "Turnaround · Ada" });
    const steps = items.slice(1);
    expect(steps.filter((g: { feature: string }) => g.feature === "turnaround-step").map((g: { request: { step: { label: string } } }) => g.request.step.label)).toEqual(["Right side (Angles)", "Left side (Angles)"]);
    const clips = steps.filter((g: { op: string }) => g.op === "flf2v");
    expect(clips).toHaveLength(4);
    expect(clips.every((g: { batchId: string; request: { prompt: string } }) => g.batchId === batchId && g.request.prompt === ORBIT_PROMPT)).toBe(true);
    // A second click gets the same run.
    const again = await (await post({ engine: "open", views: { front, back }, name: "Ada", requestId: "turn-open-1" })).json();
    expect(again.filmId).toBe(filmId);
    const done = await settle(filmId);
    expect(done).toMatchObject({ status: "succeeded", kind: "video" });
  }, 90_000);

  it("runs the cloud's reference route as a demo with no key, priced as a demo", async () => {
    const pics = { front: upload("cf.png"), right: upload("cr.png"), back: upload("cb.png"), left: upload("cl.png") };
    const preview = await (await post({ engine: "cloud", views: pics }, true)).json();
    expect(preview).toMatchObject({ route: "references", fills: [], demo: true, costUsd: 0, model: { id: "minimax-h3-max" } });
    expect(preview.gpuGb).toBeUndefined();
    const res = await post({ engine: "cloud", views: pics, route: "keyframes" });
    expect(res.status).toBe(201);
    const answer = await res.json();
    const { filmId, items } = answer;
    expect(items[0]).toMatchObject({ modelId: "flux-3-max", op: "keyframes", feature: "turnaround" });
    expect(routeResult(answer)[0].id).toBe(filmId);
    expect((await settle(filmId)).status).toBe("succeeded");
  }, 60_000);

  it("asks for Soul ID's consent line before filming a real person, and files a character's run in its feed", async () => {
    const front = upload("real.png");
    const blocked = await (await post({ engine: "cloud", views: { front }, realPerson: true }, true)).json();
    expect(blocked.blocker).toBe(NEEDS_CONSENT);
    const refused = await post({ engine: "cloud", views: { front }, realPerson: true });
    expect(refused.status).toBe(422);
    expect((await refused.json()).error).toBe(NEEDS_CONSENT);
    expect((await post({ engine: "cloud", views: { front }, elementId: "nope" })).status).toBe(404);
    const { createElement } = await import("@/server/elements");
    const el = createElement({ name: "Ada", kind: "character", references: [front] });
    const res = await post({ engine: "cloud", views: { front }, realPerson: true, consent: true, elementId: el.id });
    expect(res.status).toBe(201);
    const { items, filmId } = await res.json();
    expect(items[0]).toMatchObject({ modelId: "minimax-h3-max-camera", op: "camera-path", feature: `element:${el.id}` });
    await settle(filmId);
  }, 60_000);

  it("names the film, not a drawn side, when the cloud's references wait for the Angles app", async () => {
    const res = await post({ engine: "cloud", views: { front: upload("rf.png"), back: upload("rb.png") }, fill: true, requestId: "turn-refs-fill" });
    expect(res.status).toBe(201);
    const answer = await res.json();
    expect(answer.items.map((g: { op: string }) => g.op)).toEqual(["ref2v", "edit", "edit"]);
    expect(routeResult(answer)).toEqual([expect.objectContaining({ id: answer.filmId, op: "ref2v" })]);
    // It ends on the front, as it starts.
    expect(answer.final.request.inputs.endImage).toBe(answer.final.request.inputs.images[0]);
    await settle(answer.filmId);
  }, 60_000);

  it("asks a character's consent on the server whatever the client says, records it, and takes it from its Soul ID training", async () => {
    const { createElement } = await import("@/server/elements");
    const front = upload("char.png");
    const el = createElement({ name: "Bea", kind: "character", references: [front] });
    // Left out, or the switch turned off: still asked.
    for (const body of [{}, { realPerson: false }]) {
      const preview = await (await post({ engine: "cloud", views: { front }, elementId: el.id, ...body }, true)).json();
      expect(preview).toMatchObject({ blocker: NEEDS_CONSENT, consent: "asked" });
      const refused = await post({ engine: "cloud", views: { front }, elementId: el.id, ...body });
      expect(refused.status).toBe(422);
    }
    // Confirmed: every step records when.
    const before = Date.now();
    const ok = await post({ engine: "cloud", views: { front }, elementId: el.id, consent: true });
    expect(ok.status).toBe(201);
    const { items } = await ok.json();
    expect(items.every((g: { request: { consentAt?: number } }) => (g.request.consentAt ?? 0) >= before)).toBe(true);
    // A character trained for Soul ID with the consent line confirmed has it on file.
    const trained = createElement({ name: "Cy", kind: "character", references: [front] });
    const at = 1_790_000_000_000;
    db()
      .prepare(
        "INSERT INTO trainings (id, element_id, target, provider, status, progress, message, external_id, meta_json, trigger_word, error, cost_usd, created_at, updated_at, completed_at) VALUES (?, ?, 'demo', 'demo', 'succeeded', NULL, NULL, 'demo', ?, 'cy', NULL, NULL, ?, ?, ?)",
      )
      .run("tr-cy", trained.id, JSON.stringify({ consentAt: at }), at, at, at);
    const onFile = await (await post({ engine: "cloud", views: { front }, elementId: trained.id }, true)).json();
    expect(onFile.blocker).toBeUndefined();
    expect(onFile.consent).toBe("on-file");
    const run = await (await post({ engine: "cloud", views: { front }, elementId: trained.id })).json();
    expect(run.final.request.consentAt).toBe(at);
    // A Character Sheet with no character: the client's own switch (made-up people need no consent line).
    expect((await (await post({ engine: "cloud", views: { front } }, true)).json()).consent).toBeUndefined();
    await settle(run.filmId);
  }, 60_000);

  it("prices a job named by its model at /api/turnaround/estimate, as the evaluation harness does", async () => {
    const pics = { front: upload("ef.png"), right: upload("er.png"), back: upload("eb.png"), left: upload("el.png") };
    const ask = async (b: unknown) =>
      (await estimate.POST(new Request("http://x/api/turnaround/estimate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }))).json();
    expect(await ask({ engine: "cloud", views: pics, modelId: "flux-3-max", requestId: "r1" })).toMatchObject({ route: "keyframes", modelId: "flux-3-max", modelName: "FLUX 3 Max", demo: true });
    expect(await ask({ engine: "cloud", views: pics, modelId: "minimax-h3-max-camera" })).toMatchObject({ route: "camera", modelId: "minimax-h3-max-camera" });
    // A model the engine has no route for leaves the default.
    expect(await ask({ engine: "open", views: pics, modelId: "flux-3-max" })).toMatchObject({ route: "frames", modelId: "oss-wan22-14b" });
  });

  it("refuses pictures not uploaded here, and a run with no front view", async () => {
    expect((await post({ engine: "open", views: { front: "https://elsewhere.test/a.png" } })).status).toBe(400);
    const back = upload("only-back.png");
    const res = await post({ engine: "open", views: { back } });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/Pick the front view/);
  });
});

describe("Cinema: a Soul Cast result's turnaround as a take", () => {
  it("files the sheet's turnaround in the project, drawing its front and sides first on the open engine", async () => {
    const p = cinema.createProject({ name: "Casting" });
    const sheet = upload("sheet.png", 64, 36);
    const input = { engine: "open", mode: "video", action: "turnaround", prompt: "", turnaround: { sheet, name: "Rae" } };
    const res = await cinemaRoute.POST(new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input }) }), { params: Promise.resolve({ id: p.id }) });
    expect(res.status).toBe(201);
    const { items, plan } = await res.json();
    expect(plan.modelId).toBe("oss-wan22-14b");
    expect(plan.costUsd).toBe(0);
    const film = items.find((g: { op: string }) => g.op === "concat");
    expect(film).toMatchObject({ feature: "cinema-turnaround", prompt: "Turnaround · Rae" });
    expect(items.filter((g: { op: string }) => g.op === "edit")).toHaveLength(4);
    const listed = cinema.listItems(p.id).map((g) => g.id);
    expect(items.every((g: { id: string }) => listed.includes(g.id))).toBe(true);
    expect((await settle(film.id, 90_000)).status).toBe("succeeded");
  }, 100_000);
});
