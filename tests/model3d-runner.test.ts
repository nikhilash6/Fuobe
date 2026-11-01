import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { OutputFile } from "@/lib/catalog/types";

// How the runner hands an image-to-3D result from ComfyUI to the server's 3D finish (src/server/model3d-finish.ts):
// the outputs are stored, the job stays running until the web GLB is made (a restart resumes it, a cancel stops
// it), then it succeeds and its turntable is rendered after (a restart picks that up too).
// The finish itself is stubbed here (tests/model3d-finish.test.ts runs the real scripts).

vi.setConfig({ testTimeout: 30_000 });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-3d-runner-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:9";
process.env.OLLAMA_URL = "http://127.0.0.1:9";

type Done = (outputs: OutputFile[]) => void;
type Store = { read: () => OutputFile[] | null; write: (o: OutputFile[]) => void };
const finishes = new Map<string, { outputs: OutputFile[]; done: Done }>();
const turntables = new Map<string, Store>();
const stopped: string[] = [];
vi.mock("@/server/model3d-finish", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/model3d-finish")>();
  return {
    ...real,
    startModelFinish: (id: string, outputs: OutputFile[], o: { done: Done }) => {
      if (!finishes.has(id)) finishes.set(id, { outputs, done: o.done });
    },
    startTurntable: (id: string, store: Store) => void turntables.set(id, store),
    stopModelFinish: (id: string) => void stopped.push(id),
  };
});

const gens = await import("@/server/generations");
const { db } = await import("@/server/db");
const { provider } = await import("@/server/providers");

afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(f: () => T | undefined | null | false, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await sleep(50);
  }
}

type Row = { status: string; message: string | null; outputs_json: string; external_meta_json: string | null };
const row = (id: string) => db().prepare("SELECT * FROM generations WHERE id = ?").get(id) as Row;

/** A Pixal3D job at ComfyUI, as submit() leaves it (running), or a finished one. */
function insertJob(id: string, o: { meta?: Record<string, unknown>; outputs?: OutputFile[]; status?: string } = {}) {
  const now = Date.now();
  db()
    .prepare(
      `INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, progress, message, request_json, external_id, external_meta_json, outputs_json, created_at, updated_at)
       VALUES (?, 'image-to-3d', 'oss-pixal3d', 'open', 'comfyui', 'image-to-3d', 'model3d', ?, 0.5, NULL, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      o.status ?? "running",
      JSON.stringify({ feature: "image-to-3d", modelId: "oss-pixal3d", op: "image-to-3d", inputs: { images: ["/api/files/p.png"] } }),
      `prompt-${id}`,
      JSON.stringify(o.meta ?? {}),
      JSON.stringify(o.outputs ?? []),
      now,
      now,
    );
}

const comfy = provider("comfyui");
const realPoll = comfy.poll;
const realCancel = comfy.cancel;
const polledIds: string[] = [];
const canceledIds: string[] = [];
comfy.poll = async (ctx) => {
  polledIds.push(ctx.externalId);
  // A tiny stand-in for the GLB (the finish is stubbed, nothing parses it).
  return { state: "succeeded", outputs: [{ url: `data:model/gltf-binary;base64,${Buffer.from("glTF").toString("base64")}`, kind: "model3d", contentType: "model/gltf-binary" }] };
};
comfy.cancel = async (ctx) => void canceledIds.push(ctx.externalId);
afterAll(() => {
  comfy.poll = realPoll;
  comfy.cancel = realCancel;
});

const glb = (finish: Record<string, unknown>): OutputFile => ({
  url: "/api/files/raw.glb",
  kind: "model3d",
  contentType: "model/gltf-binary",
  assetId: "a1",
  meta: { web: "/api/files/web.glb", finish: { version: 2, ...finish } },
});

describe("the runner and the 3D finish", () => {
  // First: the runner starts with this file's first ensureRunner().
  it("on start, picks up the turntables of finished jobs still queued or rendering", async () => {
    insertJob("done-queued", { status: "succeeded", outputs: [glb({ turntable: "queued" })] });
    insertJob("done-rendering", { status: "succeeded", outputs: [glb({ turntable: "rendering", turntableProgress: 0.3 })] });
    insertJob("done-done", { status: "succeeded", outputs: [glb({ turntable: "done" })] });
    insertJob("done-skipped", { status: "succeeded", outputs: [glb({ turntable: "skipped: no Chromium" })] });
    gens.ensureRunner();
    expect([...turntables.keys()].sort()).toEqual(["done-queued", "done-rendering"]);
    // The store reads and writes the job's outputs, and reads null once the job is gone.
    const store = turntables.get("done-queued")!;
    expect(store.read()).toEqual([glb({ turntable: "queued" })]);
    store.write([glb({ turntable: "done" })]);
    expect(JSON.parse(row("done-queued").outputs_json)).toEqual([glb({ turntable: "done" })]);
    expect(gens.getGeneration("done-queued")!.status).toBe("succeeded");
    gens.deleteGeneration("done-queued");
    expect(stopped).toContain("done-queued");
    expect(store.read()).toBeNull();
  });

  it("stores the GLB, keeps the job running while the web GLB is made, then succeeds and starts the turntable", async () => {
    insertJob("job-finish");
    gens.ensureRunner();
    const started = await until(() => finishes.get("job-finish"));
    const r = row("job-finish");
    expect(r.status).toBe("running");
    expect(r.message).toBe("Finishing the 3D model");
    expect(JSON.parse(r.external_meta_json!)).toMatchObject({ finishing: true });
    const stored = JSON.parse(r.outputs_json) as OutputFile[];
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ kind: "model3d", contentType: "model/gltf-binary" });
    expect(stored[0].assetId).toBeTruthy();
    expect(started.outputs).toEqual(stored);

    // Polled again while finishing: the provider isn't asked again, the same finish keeps running.
    const asked = polledIds.filter((x) => x === "prompt-job-finish").length;
    await sleep(2_000);
    expect(polledIds.filter((x) => x === "prompt-job-finish").length).toBe(asked);
    expect(row("job-finish").status).toBe("running");
    expect(turntables.has("job-finish")).toBe(false);

    const finished: OutputFile[] = [{ ...stored[0], meta: { web: "/api/files/web.glb", finish: { version: 2, turntable: "queued" } } }];
    started.done(finished);
    const g = gens.getGeneration("job-finish")!;
    expect(g.status).toBe("succeeded");
    expect(g.outputs).toEqual(finished);
    expect(JSON.parse(row("job-finish").external_meta_json!)).not.toHaveProperty("finishing");
    // Done: the model can be opened now, and its turntable is on its way.
    expect(turntables.get("job-finish")!.read()).toEqual(finished);
  });

  it("a restart resumes the finish from the stored outputs, without asking the provider again", async () => {
    const outputs: OutputFile[] = [{ url: "/api/files/raw.glb", kind: "model3d", contentType: "model/gltf-binary", assetId: "a1" }];
    insertJob("job-resume", { meta: { finishing: true }, outputs });
    gens.ensureRunner();
    const started = await until(() => finishes.get("job-resume"));
    expect(started.outputs).toEqual(outputs);
    expect(polledIds).not.toContain("prompt-job-resume");
    started.done(outputs);
    expect(gens.getGeneration("job-resume")!.status).toBe("succeeded");
  });

  it("a cancel while finishing stops the finish without asking the provider, and a late result doesn't bring the job back", async () => {
    insertJob("job-cancel");
    gens.ensureRunner();
    const started = await until(() => finishes.get("job-cancel"));
    await gens.cancelGeneration("job-cancel");
    expect(stopped).toContain("job-cancel");
    expect(canceledIds).not.toContain("prompt-job-cancel");
    started.done(started.outputs);
    expect(gens.getGeneration("job-cancel")!.status).toBe("canceled");
    expect(turntables.has("job-cancel")).toBe(false);
  });
});
