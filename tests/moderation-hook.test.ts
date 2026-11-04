import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listenInRange, startFakeBilling, startFakeModeration, type FakeBilling, type FakeModeration } from "./helpers/fake-billing";
import { startFakeComfy, type FakeComfy } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

// The moderation hook (docs/moderation-hook.md): the run check, the optional output check and reports, against
// stand-in services. It ships off: with no address set nothing is checked.
const dir = tempDir("fuobe-moderation-hook-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_BILLING_URL;
delete process.env.FUOBE_MODERATION_URL;
process.env.FUOBE_HOSTED_RUNS = "1";
// Free for every account unless a test sets a billing service: something answers for runs on this install's GPUs.
process.env.FUOBE_HOSTED_FREE = "1";
globalThis.__fuobeTestDiskFree = 1e13;

const probe = http.createServer();
const comfyPort = await listenInRange(probe);
await new Promise<void>((r) => probe.close(() => r()));
const comfy: FakeComfy = await startFakeComfy({ output: "image", delayMs: 0 }, comfyPort);
process.env.COMFYUI_URL = comfy.url;

const auth = await import("@/server/auth");
const generationsRoute = await import("@/app/api/generations/route");
const reportsRoute = await import("@/app/api/reports/route");
const { proxy } = await import("@/proxy");
const { NextRequest } = await import("next/server");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const billing = await import("@/server/billing");
const outbox = await import("@/server/billing-outbox");
const checks = await import("@/server/output-checks");
const { getGeneration } = await import("@/server/generations");
const { fileAccount, fileHeld } = await import("@/server/account-library");
const { listReports } = await import("@/server/moderation");
const { POOL_WORDS } = await import("@/lib/relay");

let mod: FakeModeration;
let bill: FakeBilling;
let a = "";
let cookie = "";
beforeAll(async () => {
  mod = await startFakeModeration();
  bill = await startFakeBilling();
  auth.setPassword("install password");
  a = auth.createAccount("checks@example.com", "long enough").id;
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(a).value}`;
});
afterAll(async () => {
  globalThis.__fuobeTestDiskFree = undefined;
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_HOSTED_FREE", "FUOBE_MODERATION_URL", "FUOBE_MODERATION_TOKEN", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN"]) delete process.env[k];
  await mod.close();
  await bill.close();
  await comfy.close();
});
beforeEach(() => {
  resetRates();
  billing.resetBillingCache();
  mod.calls.length = 0;
  mod.down = false;
  mod.run = { allowed: true, checkOutputs: false };
  mod.output = { decision: "show" };
  bill.calls.length = 0;
  process.env.FUOBE_MODERATION_URL = mod.url;
  process.env.FUOBE_MODERATION_TOKEN = "test-moderation-token";
  delete process.env.FUOBE_BILLING_URL;
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
});

const post = (body: unknown) => {
  const text = JSON.stringify(body);
  return generationsRoute.POST(new Request("http://localhost:3000/api/generations", { method: "POST", headers: { cookie, host: "localhost:3000", "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }, body: text }));
};
const run = { feature: "image", modelId: "oss-z-image-turbo", prompt: "a quiet harbour" };
const row = (id: string) => db().prepare("SELECT status, stage, error, outputs_json FROM generations WHERE id = ?").get(id) as { status: string; stage: string | null; error: string | null; outputs_json: string };

async function until(fn: () => boolean, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function started(body: unknown = run): Promise<string> {
  const r = await post(body);
  expect(r.status).toBe(201);
  return ((await r.json()) as { items: { id: string }[] }).items[0].id;
}

describe("with no moderation service", () => {
  it("checks nothing, and a report waits for the owner", async () => {
    delete process.env.FUOBE_MODERATION_URL;
    const id = await started();
    await until(() => row(id).status === "succeeded");
    expect(row(id).stage).toBeNull();
    expect(mod.calls).toEqual([]);
    const r = await reportsRoute.POST(new Request("http://localhost:3000/api/reports", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ target: { generationId: id }, category: "other", text: "looks wrong" }) }));
    expect(r.status).toBe(201);
    expect(mod.calls).toEqual([]);
    const items = listReports();
    expect(items.some((i) => i.target.generationId === id && i.category === "other")).toBe(true);
  });
});

describe("the run check", () => {
  it("a blocked run makes nothing and sets nothing aside", async () => {
    process.env.FUOBE_BILLING_URL = bill.url;
    process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
    mod.run = { allowed: false, code: "blocked", text: "This request can't be made here." };
    const before = (db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n;
    const r = await post({ ...run, shown: { amount: 7, priceVersion: "v7" } });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe("This request can't be made here.");
    expect((db().prepare("SELECT COUNT(*) AS n FROM generations").get() as { n: number }).n).toBe(before);
    expect(bill.calls_of("/v1/reserve")).toEqual([]);
    const sent = mod.calls_of("/v1/check-run")[0];
    expect(sent.headers.authorization).toBe("Bearer test-moderation-token");
    expect(sent.body).toMatchObject({ prompt: "a quiet harbour", account: { id: a }, consent: null });
  });

  it("no answer: the run is refused as paused", async () => {
    mod.down = true;
    const r = await post(run);
    expect(r.status).toBe(503);
  });
});

describe("the output check", () => {
  it("checkOutputs false: no Checking stage and no output check; the result shows at once", async () => {
    const id = await started();
    await until(() => row(id).status === "succeeded");
    expect(mod.calls_of("/v1/check-output")).toEqual([]);
  });

  it("an answer with no checkOutputs field: the outputs are held, never served, until the check says show", async () => {
    mod.run = { allowed: true };
    mod.output = { decision: "wait", retryAfterS: 3600 };
    const id = await started();
    await until(() => row(id).stage === "checking");
    const g = getGeneration(id)!;
    // A run on this install's GPUs: the check is part of "Working", with no word of its own.
    expect(g.place).toBe("pool");
    expect(g.stage).toBeUndefined();
    expect(g.message).toBe(POOL_WORDS.working);
    expect(g.outputs).toEqual([]);
    const held = (JSON.parse(row(id).outputs_json) as { url: string }[])[0].url.replace(/^\/api\/files\//, "");
    expect(fileHeld(held)).toBe(true);
    expect(fileAccount(held)).not.toBe(a);
    // The account's own request for the file is refused by the sign-in proxy.
    const res = await proxy(new NextRequest(`http://localhost:3000/api/files/${held}`, { headers: { cookie, host: "localhost:3000" } }));
    expect(res.status).toBe(403);
    await until(() => mod.calls_of("/v1/check-output").length > 0);
    const asked = mod.calls_of("/v1/check-output")[0];
    expect(asked.headers["x-fuobe-generation"]).toBe(id);
    expect(asked.headers["x-fuobe-kind"]).toBe("image");
    expect(asked.bytes!.length).toBeGreaterThan(0);
    // Show: served, and the row succeeds.
    mod.output = { decision: "show" };
    db().prepare("UPDATE output_checks SET next_at = 0 WHERE generation_id = ?").run(id);
    await checks.sweepOutputChecks();
    expect(row(id).status).toBe("succeeded");
    expect(fileHeld(held)).toBe(false);
    expect(fileAccount(held)).toBe(a);
  });

  it("hide: the file goes, the row fails, and its hold is refunded as hidden", async () => {
    process.env.FUOBE_BILLING_URL = bill.url;
    process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
    mod.run = { allowed: true, checkOutputs: true };
    mod.output = { decision: "hide", text: "Removed by the checks. Not charged." };
    const id = await started({ ...run, shown: { amount: 7, priceVersion: "v7" } });
    await until(() => row(id).status === "failed");
    expect(row(id).error).toBe("Removed by the checks. Not charged.");
    // The account reads the check's own words (a run on this install's GPUs hides only technical reasons).
    expect(getGeneration(id)!.error).toBe("Removed by the checks. Not charged.");
    expect(getGeneration(id)!.notCharged).toBe(true);
    await outbox.sweepBilling();
    const hold = [...bill.holds.entries()].find(([, h]) => h.reports.has(id));
    expect(hold?.[1].reports.get(id)).toBe("hidden");
  });

  it("past the wait (a faked clock), the row fails and its files go", async () => {
    mod.run = { allowed: true, checkOutputs: true };
    mod.output = { decision: "wait", retryAfterS: 3600 };
    const id = await started();
    await until(() => row(id).stage === "checking");
    const file = (JSON.parse(row(id).outputs_json) as { assetId: string }[])[0].assetId;
    await checks.sweepOutputChecks(Date.now() + 25 * 3_600_000);
    expect(row(id).status).toBe("failed");
    expect(row(id).error).toBe(checks.UNCHECKED_WORDS);
    expect(getGeneration(id)!.error).toBe(checks.UNCHECKED_WORDS);
    expect(db().prepare("SELECT 1 FROM assets WHERE id = ?").get(file)).toBeUndefined();
  });
});

describe("reports", () => {
  it("go to the service when one is set", async () => {
    const r = await reportsRoute.POST(new Request("http://localhost:3000/api/reports", { method: "POST", headers: { cookie, host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ target: { shareId: "abc123" }, category: "impersonation", text: "not me" }) }));
    expect(r.status).toBe(201);
    expect(((await r.json()) as { text: string }).text).toBe("Report received.");
    expect(mod.calls_of("/v1/report")[0].body).toMatchObject({ target: { shareId: "abc123" }, category: "impersonation", reporter: { account: a, email: "checks@example.com" } });
  });

  it("refuse a report with no target or no category", async () => {
    const send = (body: unknown) => reportsRoute.POST(new Request("http://localhost:3000/api/reports", { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body) }));
    expect((await send({ category: "other" })).status).toBe(400);
    expect((await send({ target: { generationId: "x" }, category: "nope" })).status).toBe(400);
  });
});
