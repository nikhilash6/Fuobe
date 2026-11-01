import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Generation } from "@/lib/catalog/types";

vi.setConfig({ testTimeout: 120_000 });

// /api/evolution end to end in demo mode (no keys, no ComfyUI, no LLM): a run on either engine becomes one pipeline of
// ordinary generations that the mock provider runs through; estimates with a fal key price the real LTX-2.3 route.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-evolution-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

const { setSetting } = await import("@/server/settings");
const gens = await import("@/server/generations");
const { saveFile } = await import("@/server/storage");
const { encodePng } = await import("@/server/png");
const { db } = await import("@/server/db");
const createRoute = await import("@/app/api/evolution/route");
const estimateRoute = await import("@/app/api/evolution/estimate/route");
const directionRoute = await import("@/app/api/evolution/direction/route");
const { changeAccess } = await import("@/server/model-access");

const json = (body?: unknown) => new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

let clip = "";
let ref = "";
beforeAll(() => {
  setSetting("demoMode", "auto");
  // A 12 s, 16 fps, 72×128 clip with a sound track.
  clip = saveFile({ data: fs.readFileSync(path.join(__dirname, "fixtures/shorts-12s.mp4")), contentType: "video/mp4", source: "upload", name: "walk.mp4" }).url;
  const data = Buffer.alloc(32 * 32 * 4, 200);
  ref = saveFile({ data: encodePng({ width: 32, height: 32, data }), contentType: "image/png", source: "upload", name: "ref.png" }).url;
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
  return db().prepare("SELECT id, model_id, op, feature, engine FROM generations WHERE batch_id = ? ORDER BY created_at, id").all(b) as { id: string; model_id: string; op: string; feature: string; engine: string }[];
};

const src = { duration: 12, fps: 16, width: 72, height: 128, hasAudio: true };
const body = (over: Record<string, unknown> = {}) => ({ engine: "cloud", intensity: "medium", references: [ref], source: { url: clip, name: "walk.mp4", ...src }, ...over });

describe("Evolution: estimates", () => {
  it("no keys: a demo; the GPU is free", async () => {
    const cloud = await (await estimateRoute.POST(json(body()))).json();
    expect(cloud).toMatchObject({ modelName: "Fuobe Evolution", engine: "cloud", resolution: "720p", pieces: 1, seconds: 12, demo: true });
    expect(cloud.notes.join(" ")).toMatch(/LTX-2.3 takes no pictures: your reference shapes the direction/);
    const open = await (await estimateRoute.POST(json(body({ engine: "open" })))).json();
    expect(open).toMatchObject({ engine: "open", resolution: "480p", pieces: 3, costUsd: 0 });
    expect(open.notes.join(" ")).toMatch(/Qwen-Image 2.1 Turbo takes its first frame toward the direction with your first reference/);
  });

  describe("with a fal key (estimates submit nothing)", () => {
    beforeAll(() => setSetting("falKey", "fal-test-key"));
    afterAll(() => setSetting("falKey", ""));

    it("LTX-2.3 per megapixel of video in the clip's shape, plus the sound put back", async () => {
      const e = await (await estimateRoute.POST(json(body()))).json();
      expect(e).toMatchObject({ demo: false, pieces: 1, steps: 2 });
      // 9:16 at 720p is 704 × 1280; 12 s at 24 fps is 289 frames: 260.4 MP → 261 × $0.001605.
      expect(e.costUsd).toBeGreaterThanOrEqual(261 * 0.001605);
      expect(e.costUsd).toBeLessThan(261 * 0.001605 + 0.02);
      const hd = await (await estimateRoute.POST(json(body({ resolution: "1080p" })))).json();
      expect(hd.costUsd).toBeGreaterThan(e.costUsd * 2);
    });
  });

  it("refuses what can't run, in words", async () => {
    const say = async (b: unknown) => (await (await estimateRoute.POST(json(b))).json()).error;
    expect(await say(body({ range: { start: 0, end: 3 } }))).toBe("Select at least 4 seconds");
    expect(await say(body({ engine: "open", resolution: "1080p" }))).toMatch(/isn't offered on your GPU/);
    expect(await say({ engine: "cloud" })).toBe("Add a clip and pick how much should change");
    // Past the limits, the limit is said (not the schema's generic refusal), on every route.
    expect(await say(body({ direction: "x".repeat(10_001) }))).toBe("Keep the direction under 10,000 characters");
    expect(await say(body({ references: Array(41).fill(ref) }))).toBe("Use up to 40 references");
    const create = await createRoute.POST(json(body({ references: Array(41).fill(ref) })));
    expect([create.status, (await create.json()).error]).toEqual([422, "Use up to 40 references"]);
    const long = await createRoute.POST(json(body({ direction: "A night market. ".repeat(700) })));
    expect([long.status, (await long.json()).error]).toEqual([422, "Keep the direction under 10,000 characters"]);
    const write = await directionRoute.POST(json({ engine: "cloud", references: Array(41).fill(ref) }));
    expect([write.status, (await write.json()).error]).toEqual([422, "Use up to 40 references"]);
    changeAccess([{ kind: "model", id: "fuobe-evolution", on: false }]);
    expect(await say(body())).toBe("Fuobe Evolution is switched off in the cloud in Settings → Models & licences");
    changeAccess([{ kind: "reset" }]);
  });
});

describe("Evolution: a direction longer than the models take", () => {
  it("the estimate says only its first sentences reach the model, and the page says the same words", async () => {
    const { DIRECTION_CUT_NOTE, directionPrompt } = await import("@/lib/catalog/evolution");
    const direction = "A night market in the rain. ".repeat(80);
    expect(directionPrompt(direction).cut).toBe(true);
    const est = await (await estimateRoute.POST(json(body({ direction })))).json();
    expect(est.notes).toContain(DIRECTION_CUT_NOTE);
    const short = await (await estimateRoute.POST(json(body({ direction: "A night market in the rain." })))).json();
    expect(short.notes).not.toContain(DIRECTION_CUT_NOTE);
  });
});

describe("Evolution: the direction", () => {
  it("no LLM running: Fuobe's offline writer, from the intensity, your words and the references", async () => {
    const res = await directionRoute.POST(json({ engine: "cloud", intensity: "high", idea: "a western at high noon", references: [ref, ref] }));
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d).toEqual({
      direction: "The same motion and timing, reimagined from the ground up: a western at high noon. It takes the characters, objects, colours and style of the 2 reference images. Smooth, natural motion, consistent from the first frame to the last.",
      by: "offline",
      why: "Ollama isn't running",
    });
    setSetting("demoMode", "on");
    const demo = await (await directionRoute.POST(json({ engine: "open", intensity: "low", references: [] }))).json();
    expect(demo).toMatchObject({ by: "offline", why: "demo mode" });
    expect(demo.direction).toMatch(/^The same scene, the same people and the same camera, with richer light/);
    setSetting("demoMode", "auto");
  });
});

describe("Evolution: runs (demo)", () => {
  const run = async (b: unknown) => {
    const res = await createRoute.POST(json(b));
    const out = await res.json();
    expect(res.status, out.error).toBe(201);
    return out as { final: Generation; items: Generation[]; direction: string; by: string };
  };

  it("cloud: no direction given, the offline writer writes one; Fuobe Evolution at video_strength 0.35, then the sound", async () => {
    const { final, items, direction, by } = await run(body({ idea: "a rainy neon street" }));
    expect(by).toBe("offline");
    expect(direction).toMatch(/now in a new world: a rainy neon street/);
    expect(final.feature).toBe("evolution");
    expect(items.filter((g) => g.feature === "evolution")).toHaveLength(1);
    const rows = batchOf(final.id);
    expect(rows.map((r) => `${r.op}:${r.model_id}`)).toEqual(["v2v:fuobe-evolution", "mux:merge-audio-video"]);
    const evolve = gens.getGeneration(rows[0].id)!;
    expect(evolve.request).toMatchObject({ engine: "cloud", params: { extra: { video_strength: 0.35 } } });
    expect(evolve.request.prompt).toBe(direction);
    const done = await settle(final.id);
    expect(done.status, done.error ?? undefined).toBe("succeeded");
    expect(done.outputs[0].kind).toBe("video");
  });

  it("GPU: segments cut, direction frames, the graph at denoise 0.85, joined with the clip's sound; your direction as written", async () => {
    const { final, by, direction } = await run(body({ engine: "open", intensity: "high", direction: "A paper-cut diorama world with layered card stock." }));
    expect(by).toBe("you");
    expect(direction).toBe("A paper-cut diorama world with layered card stock.");
    const rows = batchOf(final.id);
    expect(rows.filter((r) => r.model_id === "fuobe-evolution")).toHaveLength(3);
    expect(rows.filter((r) => r.model_id === "oss-qwen-image-21-turbo")).toHaveLength(3);
    const evolve = gens.getGeneration(rows.find((r) => r.model_id === "fuobe-evolution")!.id)!;
    expect(evolve.request).toMatchObject({ engine: "open", params: { extra: { denoise: 0.85 } } });
    const done = await settle(final.id);
    expect(done.status, done.error ?? undefined).toBe("succeeded");
    expect(done.feature).toBe("evolution");
  });
});
