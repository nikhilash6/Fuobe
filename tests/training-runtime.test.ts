import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-train-rt-"));
process.env.FUOBE_DATA_DIR = dir;

const { db } = await import("@/server/db");
const { createElement, getElement, updateElement } = await import("@/server/elements");
const { pollTrainings, listTrainings } = await import("@/server/training");
const { setSetting } = await import("@/server/settings");

// A stand-in fal queue and AI-Toolkit.
const routes: Record<string, { status: number; body: unknown }> = {};
const server = http.createServer((req, res) => {
  const r = routes[req.url!.split("?")[0]] ?? { status: 404, body: { detail: "not found" } };
  res.writeHead(r.status, { "content-type": "application/json" });
  res.end(JSON.stringify(r.body));
});
let base = "";
beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  setSetting("falKey", "test-key");
  setSetting("aiToolkitUrl", base);
  // The stand-in answers as fal.ai: a fal.ai key is sent only to fal.ai's own hosts (provider-keys.ts standIn).
  globalThis.__fuobeTestFalUrl = base;
});
afterAll(() => {
  globalThis.__fuobeTestFalUrl = undefined;
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function training(o: { target: string; provider: string; status: string; externalId?: string | null; meta?: unknown; age?: number }) {
  const el = createElement({ name: `Maya ${Math.random().toString(36).slice(2, 6)}`, kind: "character", references: [] });
  updateElement(el.id, { status: "training" });
  const id = `t_${Math.random().toString(36).slice(2, 10)}`;
  const at = Date.now() - (o.age ?? 0);
  db()
    .prepare(
      `INSERT INTO trainings (id, element_id, target, provider, status, external_id, meta_json, trigger_word, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'mayafz', ?, ?)`,
    )
    .run(id, el.id, o.target, o.provider, o.status, o.externalId ?? null, o.meta ? JSON.stringify(o.meta) : null, at, at);
  return { id, elementId: el.id };
}

const state = (id: string) => listTrainings().find((t) => t.id === id)!;

describe("training jobs reach an end (S6)", () => {
  it("fails a fal training whose result URL answers 4xx, and frees the element", async () => {
    routes["/fal/status"] = { status: 200, body: { status: "COMPLETED" } };
    routes["/fal/response"] = { status: 422, body: { detail: "Training failed: not enough faces" } };
    const t = training({ target: "fal-z-image", provider: "fal", status: "running", externalId: "req1", meta: { statusUrl: `${base}/fal/status`, responseUrl: `${base}/fal/response` } });
    await pollTrainings();
    expect(state(t.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/422.*not enough faces/) });
    expect(getElement(t.elementId)?.status).toBe("ready");
  });

  it("fails on a reported error, keeps polling through a transient one", async () => {
    routes["/fal/err"] = { status: 200, body: { status: "COMPLETED", error: "Out of memory" } };
    routes["/fal/busy"] = { status: 503, body: { detail: "try later" } };
    const bad = training({ target: "fal-z-image", provider: "fal", status: "running", externalId: "r2", meta: { statusUrl: `${base}/fal/err`, responseUrl: `${base}/x` } });
    const busy = training({ target: "fal-z-image", provider: "fal", status: "running", externalId: "r3", meta: { statusUrl: `${base}/fal/busy`, responseUrl: `${base}/x` } });
    await pollTrainings();
    expect(state(bad.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/Out of memory/) });
    expect(state(busy.id)).toMatchObject({ status: "running", message: expect.stringMatching(/Checking status failed/) });
    db().prepare("UPDATE trainings SET status = 'failed' WHERE id = ?").run(busy.id);
  });

  it("fails an AI-Toolkit job that was deleted (404)", async () => {
    const t = training({ target: "aitk-z-image", provider: "ai-toolkit", status: "running", externalId: "job-gone" });
    await pollTrainings();
    expect(state(t.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/AI-Toolkit 404/) });
  });

  it("gives up after 8 hours", async () => {
    routes["/fal/slow"] = { status: 200, body: { status: "IN_PROGRESS", logs: [] } };
    const t = training({ target: "fal-z-image", provider: "fal", status: "running", externalId: "r4", meta: { statusUrl: `${base}/fal/slow` }, age: 9 * 3_600_000 });
    await pollTrainings();
    expect(state(t.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/8 hours/) });
  });

  it("fails a training a restart cut off before it reached the trainer, so it can be started again", async () => {
    const t = training({ target: "fal-z-image", provider: "fal", status: "queued", age: 5 * 60_000 });
    const fresh = training({ target: "fal-z-image", provider: "fal", status: "queued" });
    await pollTrainings();
    expect(state(t.id)).toMatchObject({ status: "failed", error: expect.stringMatching(/Interrupted/) });
    expect(getElement(t.elementId)?.status).toBe("ready");
    expect(state(fresh.id).status).toBe("queued");
  });
  it("links a blocker to the Settings section that lifts it: the engine mode it names, else the trainer's connection", async () => {
    const { describeTargets } = await import("@/server/training");
    const { TRAINING_TARGETS, trainingSettingsHref } = await import("@/lib/catalog/training");
    const fal = TRAINING_TARGETS.find((t) => t.provider === "fal" && t.engine === "cloud")!;
    const gpu = TRAINING_TARGETS.find((t) => t.provider === "ai-toolkit")!;
    setSetting("demoMode", "off");
    try {
      // "Paid APIs only": the GPU trainer says to change Settings → Engine mode, so the link goes there.
      setSetting("engineMode", "cloud");
      const [locked] = describeTargets([gpu]);
      expect(locked.blocker).toMatch(/Settings → Engine mode/);
      expect(trainingSettingsHref(locked)).toBe("/settings#engine");
      setSetting("engineMode", "both");
      const [aitk, falKey] = describeTargets([gpu, fal]);
      expect(trainingSettingsHref(aitk)).toBe("/settings#training");
      expect(trainingSettingsHref(falKey)).toBe("/settings#fal");
    } finally {
      setSetting("engineMode", "both");
      setSetting("demoMode", "auto");
    }
  });
});
