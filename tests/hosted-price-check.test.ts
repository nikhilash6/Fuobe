import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FAKE_POLICY, listenInRange, startFakeBilling, type FakeBilling } from "./helpers/fake-billing";
import { startFakeComfy, type FakeComfy } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

// The price check before Run (`?preview=1`) on hosted runs: where a new run would stand in line and the wait, and a
// refusal (busy, a limit, a model or files this install's GPUs don't take) said before Run is pressed, in the words the
// run itself would get. A run's state reads the same from the list and from its own route (a refresh, a second
// device). With hosted runs off every answer is as before.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
const dir = tempDir("fuobe-hosted-price-check-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;
delete process.env.FUOBE_HOSTED_FREE;
delete process.env.FUOBE_BILLING_URL;
delete process.env.FUOBE_MODERATION_URL;
globalThis.__fuobeTestDiskFree = 1e13;

const probe = http.createServer();
const comfyPort = await listenInRange(probe);
await new Promise<void>((r) => probe.close(() => r()));
const comfy: FakeComfy = await startFakeComfy({ output: "image", delayMs: 0 }, comfyPort);
process.env.COMFYUI_URL = comfy.url;

const auth = await import("@/server/auth");
const generationsRoute = await import("@/app/api/generations/route");
const oneRoute = await import("@/app/api/generations/[id]/route");
const { POOL_WORDS } = await import("@/lib/relay");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const billing = await import("@/server/billing");
const { HOSTED_WORDS } = await import("@/server/hosted");
const { POOL_LIMIT_WORDS } = await import("@/server/pool-limits");

let fake: FakeBilling;
let a = "";
let cookie = "";
let other = "";
beforeAll(async () => {
  fake = await startFakeBilling();
  auth.setPassword("install password");
  a = auth.createAccount("price-check@example.com", "long enough").id;
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(a).value}`;
  other = auth.createAccount("someone-else@example.com", "long enough").id;
});
afterAll(async () => {
  globalThis.__fuobeTestDiskFree = undefined;
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_HOSTED_FREE", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN"]) delete process.env[k];
  await fake.close();
  await comfy.close();
});
beforeEach(() => {
  resetRates();
  billing.resetBillingCache();
  delete process.env.FUOBE_HOSTED_RUNS;
  delete process.env.FUOBE_HOSTED_FREE;
  delete process.env.FUOBE_BILLING_URL;
  fake.policy = { ...FAKE_POLICY };
  fake.quoteAnswer = null;
  fake.down = false;
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
  auth.setAccountGpu(a, null);
});

const check = async (body: Record<string, unknown>, c: string | null = cookie) => {
  const text = JSON.stringify(body);
  const r = await generationsRoute.POST(
    new Request("http://localhost:3000/api/generations?preview=1", {
      method: "POST",
      headers: { host: "localhost:3000", "content-type": "application/json", "content-length": String(Buffer.byteLength(text)), ...(c && { cookie: c }) },
      body: text,
    }),
  );
  return { status: r.status, body: (await r.json()) as { place?: string; quote?: Record<string, unknown>; line?: { place: number; etaSeconds: number | null } } };
};
const fox = { feature: "image", modelId: "oss-z-image-turbo", prompt: "a fox in the snow" };

/** A run of `account`'s waiting in line on this install's GPUs (not started). */
let n = 0;
function waitingRun(account: string) {
  const id = `waiting-${++n}`;
  const now = Date.now();
  db()
    .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'oss-z-image-turbo', 'open', 'comfyui', 't2i', 'image', 'queued', ?, '[]', ?, ?)")
    .run(id, JSON.stringify({ account, place: "pool" }), now, now);
  return id;
}

describe("the price check with hosted runs off", () => {
  it("is as before: no place, no quote and no line", async () => {
    const r = await check(fox);
    expect(r.status).toBe(200);
    expect(r.body.place).toBeUndefined();
    expect(r.body.quote).toBeUndefined();
    expect(r.body.line).toBeUndefined();
  });
});

describe("the price check with hosted runs on", () => {
  beforeEach(() => {
    process.env.FUOBE_HOSTED_RUNS = "1";
    process.env.FUOBE_HOSTED_FREE = "1";
  });
  const useService = () => {
    process.env.FUOBE_BILLING_URL = fake.url;
    process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
  };

  it("says where a new run would stand in line: next with nobody ahead, behind every run that waits", async () => {
    const first = await check(fox);
    expect(first.body.place).toBe("pool");
    expect(first.body.quote).toMatchObject({ allowed: true });
    expect(first.body.line).toEqual({ place: 1, etaSeconds: null });
    waitingRun(other);
    waitingRun(other);
    expect((await check(fox)).body.line?.place).toBe(3);
  });

  it("shows the service's words as they are, and its wait", async () => {
    useService();
    const r = await check(fox);
    expect(r.body.quote).toMatchObject({ allowed: true, text: "7 units", sub: "from your test balance" });
    expect(r.body.line).toEqual({ place: 1, etaSeconds: 7 });
  });

  it("passes a refusal of the service's on (busy), with its words, before Run", async () => {
    useService();
    fake.quoteAnswer = { allowed: false, amount: 0, priceVersion: "v7", text: "Busy right now. Try again in about 10 min.", code: "busy", etaS: 2400 };
    const r = await check(fox);
    expect(r.body.place).toBe("pool");
    expect(r.body.quote).toMatchObject({ allowed: false, code: "busy", text: "Busy right now. Try again in about 10 min." });
  });

  it("the service not answering: refused as paused, in plain words", async () => {
    useService();
    fake.down = "error";
    const r = await check(fox);
    expect(r.body.quote).toMatchObject({ allowed: false, code: "paused", text: billing.BILLING_PAUSED });
  });

  it("the policy's limits on runs at once and in line are said before Run, with the run's own words", async () => {
    useService();
    fake.policy = { ...FAKE_POLICY, limits: { ...FAKE_POLICY.limits, activeRuns: 1 } };
    waitingRun(other);
    expect((await check(fox)).body.quote).toMatchObject({ allowed: true });
    waitingRun(a);
    const r = await check(fox);
    expect(r.body.quote).toMatchObject({ allowed: false, code: "limit", text: POOL_LIMIT_WORDS.active(1) });
    // Waiting runs have their own limit.
    billing.resetBillingCache();
    fake.policy = { ...FAKE_POLICY, limits: { ...FAKE_POLICY.limits, waiting: 1 } };
    expect((await check(fox)).body.quote).toMatchObject({ allowed: false, code: "limit", text: POOL_LIMIT_WORDS.waiting(1) });
  });

  it("a model, LoRAs or files this install's GPUs don't take: refused before Run for an account with no GPU of its own", async () => {
    useService();
    fake.policy = { ...FAKE_POLICY, pool: { deny: ["oss-z-image-turbo"] } };
    const denied = await check(fox);
    expect(denied.body.place).toBe("pool");
    expect(denied.body.quote).toMatchObject({ allowed: false, code: "not-offered", text: HOSTED_WORDS.notOffered });
    billing.resetBillingCache();
    fake.policy = { ...FAKE_POLICY };
    const loras = await check({ ...fox, loras: [{ file: "x.safetensors", url: "https://huggingface.co/x/x.safetensors" }] });
    expect(loras.body.quote).toMatchObject({ allowed: false, code: "not-offered", text: HOSTED_WORDS.loras });
    billing.resetBillingCache();
    fake.policy = { ...FAKE_POLICY, kinds: { image: false } };
    expect((await check(fox)).body.quote).toMatchObject({ allowed: false, code: "not-offered" });
  });

  it("an account with a GPU of its own: what this install's GPUs don't take goes to its own GPU, as before", async () => {
    useService();
    auth.setAccountGpu(a, { mode: "computer" });
    fake.policy = { ...FAKE_POLICY, pool: { deny: ["oss-z-image-turbo"] } };
    const r = await check(fox);
    expect(r.body.place).toBeUndefined();
    expect(r.body.quote).toBeUndefined();
  });

  it("a guest is priced and placed in line as an account would be", async () => {
    waitingRun(other);
    const r = await check(fox, null);
    expect(r.body.place).toBe("pool");
    expect(r.body.quote).toMatchObject({ allowed: true });
    expect(r.body.line?.place).toBe(2);
  });
});

describe("a run's state after a refresh or on a second device", () => {
  beforeEach(() => {
    process.env.FUOBE_HOSTED_RUNS = "1";
    process.env.FUOBE_HOSTED_FREE = "1";
  });
  const list = async () => {
    const r = await generationsRoute.GET(new Request("http://localhost:3000/api/generations", { headers: { host: "localhost:3000", cookie } }));
    return ((await r.json()) as { items: Record<string, unknown>[] }).items;
  };
  const one = async (id: string) => (await (await oneRoute.GET(new Request(`http://localhost:3000/api/generations/${id}`), { params: Promise.resolve({ id }) } as never)).json()) as Record<string, unknown>;
  const state = (g: Record<string, unknown> | undefined) => g && { status: g.status, message: g.message, progress: g.progress, queue: g.queue ?? null, place: g.place };

  it("the list and the run's own route say the same: In line with its place, then Working with its progress", async () => {
    waitingRun(other);
    const id = waitingRun(a);
    const listed = state((await list()).find((g) => g.id === id));
    expect(listed).toEqual({ status: "queued", message: POOL_WORDS.inLine, progress: null, queue: { place: 2, etaSeconds: null }, place: "pool" });
    expect(state(await one(id))).toEqual(listed);
    // A worker has it: Working, with its progress, and no place in line.
    const now = Date.now();
    db().prepare("INSERT INTO generation_runs (id, submitted_at, started_at) VALUES (?, ?, ?)").run(id, now, now);
    db().prepare("UPDATE generations SET status = 'running', progress = 0.5 WHERE id = ?").run(id);
    const working = state((await list()).find((g) => g.id === id));
    expect(working).toEqual({ status: "running", message: POOL_WORDS.working, progress: 0.5, queue: null, place: "pool" });
    expect(state(await one(id))).toEqual(working);
  });
});

