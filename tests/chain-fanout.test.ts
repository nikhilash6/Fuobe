import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Generation, GenerationRequest, OutputFile } from "@/lib/catalog/types";
import { tempDir } from "./helpers/temp-dir";

// The per-index chain slot (ChainSlot.index): one step per output of a list-making step (fan-out),
// and one step with a slot per index that gathers them back in order (fan-in).

vi.setConfig({ testTimeout: 90_000 });

const dir = tempDir("fuobe-fanout-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { createPipeline } = await import("@/server/chains");
const { saveFile } = await import("@/server/storage");
const { db } = await import("@/server/db");

beforeAll(() => setSetting("demoMode", "auto"));

async function settle(id: string, ms = 80_000): Promise<Generation> {
  const end = Date.now() + ms;
  for (;;) {
    const g = gens.getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`timed out: ${g.status} ${g.message}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const count = () => (db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n;

/** A step that stays "running" until the test lets go of it (no provider polls it; the runner's sweep is minutes away). */
function held(): { id: string; fail: () => void } {
  const id = `held${Math.random().toString(36).slice(2, 10)}`;
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO generations (id, batch_id, feature, preset_id, model_id, engine, provider, op, kind, status, progress, message, prompt, request_json, provider_input_json, external_id, external_meta_json, outputs_json, error, cost_usd, favorite, created_at, updated_at, completed_at, depends_on)
       VALUES (?, NULL, 't', NULL, 'nano-banana-2', 'cloud', 'mock', 't2i', 'image', 'running', NULL, 'Held for the test', NULL, ?, NULL, NULL, NULL, '[]', NULL, 0, 0, ?, ?, NULL, NULL)`,
    )
    .run(id, JSON.stringify({ feature: "t", modelId: "nano-banana-2", op: "t2i", prompt: "held" }), now, now);
  return { id, fail: () => db().prepare("UPDATE generations SET status = 'failed', error = 'Let go', completed_at = ? WHERE id = ?").run(Date.now(), id) };
}

const row = (id: string) => db().prepare("SELECT status, error, external_id FROM generations WHERE id = ?").get(id) as { status: string; error: string | null; external_id: string | null };

describe("pickOutput with an index", () => {
  const frames: OutputFile[] = [
    { url: "/api/files/f2.png", kind: "image", meta: { index: 2 } },
    { url: "/api/files/f0.png", kind: "image", meta: { index: 0 } },
    { url: "/api/files/clip.mp4", kind: "video" },
    { url: "/api/files/f1.png", kind: "image", meta: { index: 1 } },
  ];

  it("takes output number i of the slot's kind, by meta.index", () => {
    expect(gens.pickOutput(frames, { slot: "images", index: 0 })?.url).toBe("/api/files/f0.png");
    expect(gens.pickOutput(frames, { slot: "images", index: 1 })?.url).toBe("/api/files/f1.png");
    expect(gens.pickOutput(frames, { slot: "images", index: 2 })?.url).toBe("/api/files/f2.png");
    expect(gens.pickOutput(frames, { slot: "video", index: 0 })?.url).toBe("/api/files/clip.mp4");
  });

  it("says when a planned list came back too short to read (more than a frame or two missing)", () => {
    const four = frames.filter((f) => f.kind === "image");
    expect(gens.listShortfall(four, { slot: "images", index: 2, of: 5 })).toBeNull();
    expect(gens.listShortfall(four, { slot: "images", index: 0, of: 6 })).toBe("made 3 images where 6 were planned");
    // Without a planned count (or an index) nothing is checked.
    expect(gens.listShortfall(four, { slot: "images", index: 40 })).toBeNull();
    expect(gens.listShortfall([], { slot: "images", of: 9 })).toBeNull();
  });

  it("goes by position when the outputs carry no index, and holds the last one past the end", () => {
    const plain: OutputFile[] = [
      { url: "/a.png", kind: "image" },
      { url: "/b.png", kind: "image" },
    ];
    expect(gens.pickOutput(plain, { slot: "images", index: 1 })?.url).toBe("/b.png");
    expect(gens.pickOutput(plain, { slot: "images", index: 7 })?.url).toBe("/b.png");
    expect(gens.pickOutput(frames, { slot: "images", index: 40 })?.url).toBe("/api/files/f2.png");
    expect(gens.pickOutput([{ url: "/c.mp4", kind: "video" }], { slot: "images", index: 0 })).toBeUndefined();
  });
});

describe("fan-out and fan-in in createPipeline", () => {
  const clip = () => saveFile({ data: fs.readFileSync(path.join(process.cwd(), "public/samples/demo-landscape.mp4")), contentType: "video/mp4", source: "upload" }).url;

  it("refuses an output number that isn't a whole number from 0, before creating anything", () => {
    const before = count();
    for (const index of [-1, 1.5]) {
      expect(() =>
        createPipeline([
          { key: "frames", request: { feature: "t", modelId: "extract-frames", op: "extract-frames", inputs: { video: "/api/files/a.mp4" } } },
          { key: "f0", request: { feature: "t", modelId: "nano-banana-2", op: "edit", prompt: "ink" }, after: "frames", chain: [{ slot: "images", index }] },
        ]),
      ).toThrow(/Step “f0”: an output number must be a whole number from 0/);
    }
    expect(count()).toBe(before);
  });

  it("restyles every extracted frame with the previous styled frame as a reference, then rebuilds the clip in order", async () => {
    const n = 5; // the demo extractor returns 4 frames: frame 5 holds the last one
    const steps = [
      { key: "frames", request: { feature: "t", modelId: "extract-frames", op: "extract-frames" as const, inputs: { video: clip() }, params: { frameInterval: 3 } } },
      ...Array.from({ length: n }, (_, i) => ({
        key: `f${i}`,
        request: { feature: "t", modelId: "nano-banana-2", op: "edit" as const, prompt: "Ink sketch", params: { seed: 7 } },
        after: i ? ["frames", `f${i - 1}`] : ["frames"],
        chain: i ? [{ slot: "images" as const, index: i, position: "first" as const }, { slot: "images" as const }] : [{ slot: "images" as const, index: i }],
      })),
      {
        key: "film",
        request: { feature: "t", modelId: "images-to-video", op: "images-to-video" as const, params: { fps: 8 } },
        after: Array.from({ length: n }, (_, i) => `f${i}`),
        chain: Array.from({ length: n }, () => ({ slot: "images" as const })),
      },
    ];
    const p = createPipeline(steps);
    expect(p.items.map((g) => g.op)).toEqual(["extract-frames", ...Array(n).fill("edit"), "images-to-video"]);

    const film = await settle(p.byKey.film.id);
    expect(film.status, film.error ?? "").toBe("succeeded");
    const frames = gens.getGeneration(p.byKey.frames.id)!.outputs;
    expect(frames).toHaveLength(4);
    const styled = Array.from({ length: n }, (_, i) => gens.getGeneration(p.byKey[`f${i}`].id)!);
    expect(styled[0].request.inputs?.images).toEqual([frames[0].url]);
    for (let i = 1; i < n; i++) expect(styled[i].request.inputs?.images).toEqual([frames[Math.min(i, 3)].url, styled[i - 1].outputs[0].url]);
    expect(styled.every((g) => g.request.params?.seed === 7 && g.request.chainFilled)).toBe(true);
    // Gathered back in frame order.
    expect(film.request.inputs?.images).toEqual(styled.map((g) => g.outputs[0].url));
  });

  it("refuses a planned count that doesn't fit its output number", () => {
    for (const slot of [{ slot: "images" as const, index: 3, of: 3 }, { slot: "images" as const, of: 4 }]) {
      expect(() =>
        createPipeline([
          { key: "frames", request: { feature: "t", modelId: "extract-frames", op: "extract-frames", inputs: { video: "/api/files/a.mp4" } } },
          { key: "f3", request: { feature: "t", modelId: "nano-banana-2", op: "edit", prompt: "ink" }, after: "frames", chain: [slot] },
        ]),
      ).toThrow(/Step “f3”: a list of \d+ has no output number/);
    }
  });

  it("fails the steps reading a list far shorter than planned before they are paid for; a frame short is held", async () => {
    // The demo extractor returns 4 frames when no count is asked for.
    const p = createPipeline([
      { key: "frames", request: { feature: "t", modelId: "extract-frames", op: "extract-frames", inputs: { video: clip() }, params: { frameInterval: 3 } } },
      { key: "far", request: { feature: "t", modelId: "nano-banana-2", op: "edit", prompt: "Ink" }, after: "frames", chain: [{ slot: "images", index: 0, of: 10 }] },
      { key: "near", request: { feature: "t", modelId: "nano-banana-2", op: "edit", prompt: "Ink" }, after: "frames", chain: [{ slot: "images", index: 4, of: 5 }] },
    ]);
    const far = await settle(p.byKey.far.id);
    expect(far).toMatchObject({ status: "failed", error: "An earlier step made 4 images where 10 were planned" });
    expect(row(far.id).external_id).toBeNull();
    const near = await settle(p.byKey.near.id);
    expect(near.status, near.error ?? "").toBe("succeeded");
    expect(near.request.inputs?.images).toEqual([gens.getGeneration(p.byKey.frames.id)!.outputs[3].url]);
  });

  it("drops the waiting steps that only fed a failed one, before they are paid for", async () => {
    // The extraction waits on a held step, so no frame can start; then a frame of the second lane fails on its own.
    const hold = held();
    // Lanes of 3 as the per-frame render makes them: a lane's first frame matches frame 0, the others the frame before.
    const lane = (i: number) => (i % 3 ? [`f${i - 1}`] : i ? ["f0"] : []);
    const p = createPipeline(
      [
        { key: "frames", request: { feature: "t", modelId: "extract-frames", op: "extract-frames", params: { frameInterval: 3, extra: { max_frames: 6 } } }, after: "hold", chain: [{ slot: "video" }] },
        ...Array.from({ length: 6 }, (_, i) => ({
          key: `f${i}`,
          request: { feature: "t", modelId: "nano-banana-2", op: "edit" as const, prompt: "Ink", dropWhenUnused: true },
          after: ["frames", ...lane(i)],
          chain: [{ slot: "images" as const, index: i, of: 6, position: "first" as const }, ...lane(i).map(() => ({ slot: "images" as const }))],
        })),
        { key: "film", request: { feature: "t", modelId: "images-to-video", op: "images-to-video", params: { fps: 8 } }, after: Array.from({ length: 6 }, (_, i) => `f${i}`), chain: Array.from({ length: 6 }, () => ({ slot: "images" as const })) },
      ],
      { existing: { hold: hold.id } },
    );
    expect(p.items).toHaveLength(8);
    expect(row(p.byKey.frames.id).status).toBe("queued");
    db().prepare("UPDATE generations SET status = 'failed', error = 'Refused by the safety filter', completed_at = ? WHERE id = ?").run(Date.now(), p.byKey.f3.id);
    // The film fails at once (not after the other frames), and takes the frames that only fed it along — frame 0
    // too, once the frames that matched it are dropped.
    const film = await settle(p.byKey.film.id, 20_000);
    expect(film).toMatchObject({ status: "failed", error: "An earlier step didn't finish" });
    await settle(p.byKey.f4.id, 20_000);
    expect(row(p.byKey.f4.id)).toMatchObject({ status: "failed", error: "An earlier step didn't finish" });
    for (const k of ["f0", "f1", "f2", "f5"]) expect(row(p.byKey[k].id), k).toEqual({ status: "canceled", error: gens.DROPPED_UNUSED, external_id: null });
    // A step not marked dropWhenUnused waits on (the extraction has no failed dependent of its own anyway).
    expect(row(p.byKey.frames.id).status).toBe("queued");
    hold.fail();
    expect((await settle(p.byKey.frames.id, 20_000)).status).toBe("failed");
  });

  it("launches a newer chain while more than 50 older steps wait", async () => {
    const hold = held();
    const waiting = Array.from({ length: 60 }, () => gens.createGenerations({ feature: "t", modelId: "nano-banana-2", op: "edit", prompt: "Ink" }, { dependsOn: hold.id })[0]);
    const p = createPipeline([
      { key: "a", request: { feature: "t", modelId: "nano-banana-2", op: "t2i", prompt: "A red chair" } },
      { key: "b", request: { feature: "t", modelId: "nano-banana-2", op: "edit", prompt: "Ink" }, after: "a" },
    ]);
    const b = await settle(p.byKey.b.id, 40_000);
    expect(b.status, b.error ?? "").toBe("succeeded");
    expect(waiting.every((w) => row(w.id).status === "queued")).toBe(true);
    // When the held step fails, every step waiting on it fails (the oldest 50 first, the rest a tick later).
    hold.fail();
    for (const w of waiting) expect(await settle(w.id, 20_000)).toMatchObject({ status: "failed", error: "An earlier step didn't finish" });
  });

  it("a person's Stop on a run makes a step already failed by the stop before it stopped, not failed", async () => {
    const hold = held();
    const next = gens.createGenerations({ feature: "t", modelId: "nano-banana-2", op: "edit", prompt: "Ink" }, { dependsOn: hold.id })[0];
    // The Stop reaches the first step; the sweep fails the waiting one before the Stop reaches it too.
    db().prepare("UPDATE generations SET status = 'canceled', completed_at = ? WHERE id = ?").run(Date.now(), hold.id);
    expect(await settle(next.id, 20_000)).toMatchObject({ status: "failed", error: "An earlier step didn't finish" });
    await gens.cancelGeneration(next.id);
    expect(row(next.id)).toMatchObject({ status: "canceled", error: null });
    // A step that failed because its input failed stays failed.
    const other = held();
    const after = gens.createGenerations({ feature: "t", modelId: "nano-banana-2", op: "edit", prompt: "Ink" }, { dependsOn: other.id })[0];
    other.fail();
    expect(await settle(after.id, 20_000)).toMatchObject({ status: "failed" });
    await gens.cancelGeneration(after.id);
    expect(row(after.id)).toMatchObject({ status: "failed", error: "An earlier step didn't finish" });
  });

  it("chains a pipeline's steps onto generations made before (a retry's kept steps)", () => {
    const hold = held();
    expect(() => createPipeline([{ key: "x", request: { feature: "t", modelId: "nano-banana-2", op: "edit", prompt: "Ink" }, after: "nope" }], { existing: { hold: hold.id } })).toThrow(/waits for “nope”, which isn't in the pipeline/);
    expect(() => createPipeline([{ key: "hold", request: { feature: "t", modelId: "nano-banana-2", op: "t2i", prompt: "Ink" } }], { existing: { hold: hold.id } })).toThrow(/Two steps are called “hold”/);
    const p = createPipeline([{ key: "x", request: { feature: "t", modelId: "nano-banana-2", op: "edit", prompt: "Ink" }, after: "hold" }], { existing: { hold: hold.id } });
    expect(p.items).toHaveLength(1);
    expect(db().prepare("SELECT depends_on FROM generations WHERE id = ?").get(p.byKey.x.id)).toEqual({ depends_on: hold.id });
    hold.fail();
  });

  it("takes the filled inputs out again for a retry, keeping the step's own", () => {
    const filled: GenerationRequest = {
      feature: "t",
      modelId: "nano-banana-2",
      op: "edit",
      inputs: { images: ["/frame3.png", "/own-anchor.png", "/styled2.png"], video: "/cut.mp4" },
      chain: [{ slot: "images", index: 3, position: "first" }, { slot: "images" }, { slot: "video" }],
      chainFilled: true,
    };
    const { chainFilled, ...waiting } = filled;
    expect(chainFilled).toBe(true);
    expect(gens.unfilledRequest(filled, 3)).toEqual({ ...waiting, inputs: { images: ["/own-anchor.png"] } });
    // Never filled (it never launched): unchanged.
    expect(gens.unfilledRequest(waiting, 3)).toEqual(waiting);
    // Nothing of its own: no inputs left.
    expect(gens.unfilledRequest({ feature: "t", modelId: "images-to-video", inputs: { images: ["/a.png", "/b.png"] }, chain: [{ slot: "images" }, { slot: "images" }], chainFilled: true }, 2).inputs).toBeUndefined();
  });

  it("orders and validates a few hundred steps quickly", () => {
    const n = 240;
    const steps = [
      { key: "frames", request: { feature: "t", modelId: "extract-frames", op: "extract-frames" as const, inputs: { video: "/api/files/a.mp4" } } },
      ...Array.from({ length: n }, (_, i) => ({
        key: `f${i}`,
        request: { feature: "t", modelId: "nano-banana-2", op: "edit" as const, prompt: "Ink" },
        after: i % 12 ? ["frames", `f${i - 1}`] : ["frames"],
        chain: i % 12 ? [{ slot: "images" as const, index: i, position: "first" as const }, { slot: "images" as const }] : [{ slot: "images" as const, index: i }],
      })),
    ];
    const t = performance.now();
    const p = createPipeline(steps);
    const ms = performance.now() - t;
    expect(p.items).toHaveLength(n + 1);
    // Each lane waits for the frame before it; lanes start together.
    const at = new Map(p.items.map((g, i) => [g.id, i]));
    for (let i = 1; i < n; i++) if (i % 12) expect(at.get(p.byKey[`f${i}`].id)!).toBeGreaterThan(at.get(p.byKey[`f${i - 1}`].id)!);
    expect(ms).toBeLessThan(15_000);
    for (const g of p.items) void gens.cancelGeneration(g.id);
  });
});
