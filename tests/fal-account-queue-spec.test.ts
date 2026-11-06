import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startFakeFal, type FakeCloud } from "./helpers/fake-cloud";
import { tempDir } from "./helpers/temp-dir";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("next/headers", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/headers")>()), cookies: async () => ({ delete: () => {}, get: () => undefined }) }));

/**
 * An account's runs on its own fal.ai key, against fal.ai's documented queue (spec audit, 2026-11-06). Stand-in fal.ai
 * (tests/helpers/fake-cloud.ts): no real key, no paid call.
 *   Status 404: https://fal.ai/docs/api-reference/inference-api/queue/status ("The request does not exist, or it belongs
 *     to a different account"): asking again can't bring it back.
 *   Concurrency: https://fal.ai/docs/documentation/model-apis/concurrency-limits (a key's jobs start a few at a time, 2 on
 *     a new account; "additional requests wait in the queue and are dispatched as soon as a slot frees up. Requests are
 *     never rejected due to concurrency limits").
 */
const dir = tempDir("fuobe-fal-account-queue-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FAL_KEY;
globalThis.__fuobeTestDiskFree = 1e13;

const auth = await import("@/server/auth");
const keys = await import("@/server/account-keys");
const generationsRoute = await import("@/app/api/generations/route");
await import("@/server/generations");
const { db } = await import("@/server/db");
const { setSetting } = await import("@/server/settings");
const { resetRates } = await import("@/server/rate");

let fal: FakeCloud;
let cookie = "";

beforeAll(async () => {
  fal = await startFakeFal();
  globalThis.__fuobeTestFalUrl = fal.url;
  fal.keys["owner-fal"] = "good";
  fal.keys["acct-fal"] = "good";
  setSetting("falKey", "owner-fal");
  auth.setPassword("install password");
  const id = auth.createAccount("fal-queue-spec@example.com", "long enough").id;
  keys.saveAccountKey(id, "fal", "acct-fal");
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(id).value}`;
});
afterAll(async () => {
  fal.script = null;
  globalThis.__fuobeTestFalUrl = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  await fal.close();
});
beforeEach(async () => {
  resetRates();
  fal.script = null;
  fal.pollsToFinish = Infinity;
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
  await new Promise((r) => setTimeout(r, 150));
});

const run = async () => {
  const text = JSON.stringify({ feature: "image", prompt: "a quiet harbour at dawn", modelId: "nano-banana-pro", engine: "cloud" });
  const r = await generationsRoute.POST(
    new Request("http://localhost:3000/api/generations", { method: "POST", headers: { cookie, host: "localhost:3000", "content-type": "application/json", "content-length": String(text.length) }, body: text }),
  );
  const json = await r.json();
  if (r.status !== 201) throw new Error(`${r.status}: ${JSON.stringify(json)}`);
  return (json.items[0] as { id: string }).id;
};
const row = (id: string) => db().prepare("SELECT status, error, message, external_id FROM generations WHERE id = ?").get(id) as { status: string; error: string | null; message: string | null; external_id: string | null };
const started = (id: string) => !!db().prepare("SELECT started_at FROM generation_runs WHERE id = ?").pluck().get(id);
async function handedOver(id: string) {
  for (let i = 0; i < 300 && !row(id).external_id && ["queued", "running"].includes(row(id).status); i++) await new Promise((r) => setTimeout(r, 10));
  return row(id).external_id!;
}
async function ticks(n: number) {
  for (let i = 0; i < n; i++) {
    await globalThis.__fuobeRunner?.tick();
    await new Promise((r) => setTimeout(r, 30));
  }
}
const going = (id: string) => ["queued", "running"].includes(row(id).status);

describe("an account's run on its fal.ai key, as fal.ai's queue documents it", () => {
  it("a status fal.ai no longer has for the key (404 NOT_FOUND) ends the run at once, in words about the run", async () => {
    const id = await run();
    const ext = await handedOver(id);
    fal.script = (r) => (r.method === "GET" && r.path.split("?")[0].endsWith(`/requests/${ext}/status`) ? { status: 404, body: { status: "NOT_FOUND" } } : null);
    for (let i = 0; i < 40 && going(id); i++) await ticks(1);
    // Not "This model isn't available", not "Waiting for your GPU", and not waited out to "fal.ai was busy for 30 minutes".
    expect(row(id)).toMatchObject({ status: "failed", error: "fal.ai no longer has this run for your key. Press Retry to run it again." });
  });

  it("a job waiting behind the account's own started fal.ai jobs (its concurrency limit) isn't stopped as 'fal.ai was busy'", async () => {
    const a = await run();
    const b = await run();
    const ahead = new Set([await handedOver(a), await handedOver(b)]);
    // a and b run at fal.ai; any other job of the key waits at the front of its queue (its place never moves).
    fal.script = (r) => {
      const m = /\/requests\/([^/?]+)\/status/.exec(r.path);
      if (r.method !== "GET" || !m) return null;
      return { status: 200, body: ahead.has(m[1]) ? { status: "IN_PROGRESS", request_id: m[1], logs: [] } : { status: "IN_QUEUE", request_id: m[1], queue_position: 0 } };
    };
    for (let i = 0; i < 40 && !(started(a) && started(b)); i++) await ticks(1);
    expect(started(a) && started(b)).toBe(true);
    const c = await run();
    await handedOver(c);
    // Sent 31 minutes ago, before its first poll: the 30 minutes an account's job may wait without moving are over.
    db().prepare("UPDATE generation_runs SET submitted_at = ? WHERE id = ?").run(Date.now() - 31 * 60_000, c);
    await ticks(4);
    expect(row(c).status).not.toBe("failed");
    expect(going(c)).toBe(true);
    // Once the account's own jobs there are over, a place that still hasn't moved is fal.ai being busy, as before.
    db().prepare("UPDATE generations SET status = 'canceled' WHERE id IN (?, ?)").run(a, b);
    for (let i = 0; i < 20 && going(c); i++) await ticks(1);
    expect(row(c)).toMatchObject({ status: "failed", error: "fal.ai was busy for 31 minutes, so this run stopped. Press Retry in a few minutes." });
  });
});
