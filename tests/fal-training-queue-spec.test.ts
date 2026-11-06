import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * A LoRA training on fal.ai's queue, as the queue documents it (spec audit, 2026-11-06). The network is faked; no real key,
 * no paid call.
 *   https://fal.ai/docs/api-reference/inference-api/openapi/queue.json: QueueStatus.status is IN_QUEUE, IN_PROGRESS or
 *     COMPLETED ("A failed or cancelled request also has the status COMPLETED", with `error`).
 *   https://fal.ai/docs/documentation/model-apis/inference/queue ("Cancel a Request"): a job runs, and is charged, until it
 *     is cancelled with PUT cancel_url.
 */
vi.mock("@/server/providers/fal", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/providers/fal")>();
  return { ...real, falProvider: { ...real.falProvider, prepareFile: async (_d: Buffer, _t: string, name?: string) => `https://fal.test/upload/${name ?? "file"}` } };
});

const dir = tempDir("fuobe-fal-training-queue-");
process.env.FUOBE_DATA_DIR = dir;
const { db } = await import("@/server/db");
const { createElement, updateElement } = await import("@/server/elements");
const { startTraining, pollTrainings, listTrainings } = await import("@/server/training");
const { setSetting } = await import("@/server/settings");

interface Call {
  url: string;
  method: string;
}
let calls: Call[] = [];
let routes: Record<string, (c: Call) => Response> = {};
const realFetch = globalThis.fetch;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
beforeEach(() => {
  calls = [];
  routes = {};
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const call = { url: String(input), method: init?.method ?? "GET" };
    calls.push(call);
    const hit = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => call.url.startsWith(k));
    return hit ? routes[hit](call) : json({ detail: "not here" }, 404);
  }) as typeof fetch;
  setSetting("falKey", "test-key");
  setSetting("engineMode", "both");
  setSetting("demoMode", "auto");
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const character = () => createElement({ name: `Maya ${Math.random().toString(36).slice(2, 6)}`, kind: "character", references: Array.from({ length: 6 }, () => PNG) });

describe("a LoRA training on fal.ai's queue", () => {
  it("keeps the cancel address fal.ai gives, and stops the job there when Fuobe gives up on it", async () => {
    const at = "https://queue.fal.run/fal-ai/flux-lora-fast-training/requests/req-1";
    routes["https://queue.fal.run/"] = (c) => (c.method === "POST" ? json({ status: "IN_QUEUE", request_id: "req-1", status_url: `${at}/status`, response_url: at, cancel_url: `${at}/cancel`, queue_position: 0 }) : json({ status: "IN_QUEUE", request_id: "req-1", queue_position: 0 }, 202));
    const el = character();
    const t = startTraining(el.id, "fal-z-image", { consent: true });
    for (let i = 0; i < 200 && !calls.some((c) => c.method === "POST" && c.url.startsWith("https://queue.fal.run/")); i++) await new Promise((r) => setTimeout(r, 10));
    for (let i = 0; i < 100 && !db().prepare("SELECT external_id FROM trainings WHERE id = ?").pluck().get(t.id); i++) await new Promise((r) => setTimeout(r, 10));
    const meta = JSON.parse(db().prepare("SELECT meta_json FROM trainings WHERE id = ?").pluck().get(t.id) as string) as Record<string, unknown>;
    expect(meta.cancelUrl).toBe(`${at}/cancel`);
    // Past Fuobe's longest training (8 hours) it fails here, and fal.ai is told to stop (it would run on, and charge).
    db().prepare("UPDATE trainings SET created_at = ? WHERE id = ?").run(Date.now() - 9 * 3_600_000, t.id);
    routes[`${at}/cancel`] = () => json({ status: "CANCELLATION_REQUESTED" }, 202);
    await pollTrainings();
    expect(listTrainings(el.id).find((x) => x.id === t.id)?.status).toBe("failed");
    expect(calls.filter((c) => c.url === `${at}/cancel`).map((c) => c.method)).toEqual(["PUT"]);
    updateElement(el.id, { status: "ready" });
  });
});
