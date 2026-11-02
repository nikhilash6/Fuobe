import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Generation } from "@/lib/catalog/types";

vi.setConfig({ testTimeout: 120_000 });

// "Redo from here" end to end in demo mode: an H3 person removal runs through the mock provider (which reports three
// windows), then POST /api/remove-object/reroll draws it again from one window and puts the sound back as before.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-person-reroll-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");
const { db } = await import("@/server/db");
const createRoute = await import("@/app/api/remove-object/route");
const rerollRoute = await import("@/app/api/remove-object/reroll/route");
const { REMOVE, REVIEW_EXTRA } = await import("@/lib/catalog/remove-object");

const json = (body?: unknown) => new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let clip = "";
beforeAll(() => {
  setSetting("demoMode", "auto");
  clip = saveFile({ data: fs.readFileSync(path.join(__dirname, "fixtures/shorts-12s.mp4")), contentType: "video/mp4", source: "upload", name: "skate.mp4" }).url;
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

async function settle(id: string, ms = 90_000): Promise<Generation> {
  const end = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

const batchOf = (id: string) => {
  const b = (db().prepare("SELECT batch_id FROM generations WHERE id = ?").get(id) as { batch_id: string }).batch_id;
  return db().prepare("SELECT id, model_id, op FROM generations WHERE batch_id = ? ORDER BY created_at, id").all(b) as { id: string; model_id: string; op: string }[];
};

/** An H3 person removal of part of the clip (so its sound is cut from the clip and chained into the mux). */
async function removal(): Promise<{ erase: Generation; mux: Generation; cut: Generation }> {
  const res = await createRoute.POST(json({ engine: "open", mode: "type", modelId: "oss-h3-person-remove", prompt: "the skater", source: { url: clip, name: "skate.mp4" }, range: { start: 1, end: 7 } }));
  expect(res.status).toBe(201);
  const out = (await res.json()) as { final: Generation };
  expect((await settle(out.final.id)).status).toBe("succeeded");
  const rows = batchOf(out.final.id);
  const erase = gens.getGeneration(rows.find((r) => r.model_id === "oss-h3-person-remove")!.id)!;
  const cut = rows.map((r) => gens.getGeneration(r.id)!).find((g) => g.op === "trim" && g.request.step?.label === "Original sound")!;
  return { erase, mux: gens.getGeneration(out.final.id)!, cut };
}

describe("Redo from here", () => {
  let first: Generation | undefined;

  it("sends the removal again with the window controls and the original inputs, then puts the sound back", async () => {
    const { erase, mux } = await removal();
    first = erase;
    const review = erase.outputs.find((o) => o.kind === "video")?.meta?.review as { windows: unknown[]; reuse: unknown; seed: string };
    expect(review.windows).toHaveLength(3);
    const res = await rerollRoute.POST(json({ id: erase.id, window: 1, seed: 42, requestId: "reroll-req-0001" }));
    expect(res.status).toBe(201);
    const made = (await res.json()) as { final: Generation; items: Generation[] };
    expect(made.items.map((g) => g.op)).toEqual(["remove-object", "mux"]);
    const [again, final] = made.items;
    expect(again).toMatchObject({ modelId: "oss-h3-person-remove", feature: REMOVE.stepFeature });
    const extra = again.request.params?.extra as Record<string, unknown>;
    expect(JSON.parse(String(extra[REVIEW_EXTRA.controls])).windows).toMatchObject({ "0": { locked: true }, "1": { seed: "42", locked: false } });
    expect(extra[REVIEW_EXTRA.reuse]).toEqual(review.reuse);
    expect(again.request.params?.seed).toBe(Number(review.seed));
    expect(again.request.inputs?.video).toBe(erase.request.inputs?.video);
    expect(final).toMatchObject({ op: "mux", feature: REMOVE.feature, modelId: mux.modelId });
    expect(final.request.inputs?.audio).toBe(mux.request.inputs?.audio);
    expect(final.request.title).toMatch(/ · from window 2$/);
    // The same press twice is one redo.
    const twice = (await (await rerollRoute.POST(json({ id: erase.id, window: 1, seed: 42, requestId: "reroll-req-0001" }))).json()) as { final: Generation };
    expect(twice.final.id).toBe(made.final.id);
    expect((await settle(made.final.id)).status).toBe("succeeded");
    // A redo of a redo keeps one window in the title.
    const redo = gens.getGeneration(again.id)!;
    const third = (await (await rerollRoute.POST(json({ id: redo.id, window: 2 }))).json()) as { final: Generation };
    expect(third.final.request.title).toMatch(/ · from window 3$/);
    expect(third.final.request.title).not.toMatch(/window 2/);
  });

  it("cuts the sound again when the first mux never got it", async () => {
    const { erase, mux, cut } = await removal();
    const req = { ...mux.request, inputs: {} };
    db().prepare("UPDATE generations SET request_json = ? WHERE id = ?").run(JSON.stringify(req), mux.id);
    const res = await rerollRoute.POST(json({ id: erase.id, window: 0 }));
    expect(res.status).toBe(201);
    const made = (await res.json()) as { final: Generation; items: Generation[] };
    expect(made.items.map((g) => g.op)).toEqual(["remove-object", "trim", "mux"]);
    expect(made.items[1].request).toMatchObject({ modelId: cut.modelId, inputs: { video: cut.request.inputs?.video }, params: { startTime: cut.request.params?.startTime, endTime: cut.request.params?.endTime } });
    const final = await settle(made.final.id);
    expect(final.status).toBe("succeeded");
    expect(final.request.inputs?.audio).toBeTruthy();
  });

  it("refuses what it can't redo", async () => {
    const erase = first!;
    const code = async (b: unknown) => (await rerollRoute.POST(json(b))).status;
    expect(await code({ id: "nope", window: 0 })).toBe(404);
    expect(await code({ id: erase.id, window: 3 })).toBe(422);
    expect(await code({ id: erase.id })).toBe(400);
    // Another step of the removal: not an H3 removal.
    const fit = batchOf(erase.id).find((r) => r.model_id === "oss-fit-clip")!;
    expect(await code({ id: fit.id, window: 0 })).toBe(422);
    // Still running.
    db().prepare("UPDATE generations SET status = 'running' WHERE id = ?").run(erase.id);
    expect(await code({ id: erase.id, window: 0 })).toBe(409);
  });
});
