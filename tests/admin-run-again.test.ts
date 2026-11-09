import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listenOnFreePort, startFakeBilling, type FakeBilling } from "./helpers/fake-billing";
import { startFakeComfy, type FakeComfy } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

// POST /api/admin/generations/{id}/again: an account's run made again for it, with changes and a notice, on the place
// it ran, free. A stand-in billing service and a stand-in ComfyUI as this install's GPUs.
const dir = tempDir("fuobe-run-again-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ALLOW_PRIVATE_URLS;
delete process.env.FUOBE_MODERATION_URL;
globalThis.__fuobeTestDiskFree = 1e13;

const probe = http.createServer();
const comfyPort = await listenOnFreePort(probe);
await new Promise<void>((r) => probe.close(() => r()));
const comfy: FakeComfy = await startFakeComfy({ output: "image", delayMs: 0 }, comfyPort);
process.env.COMFYUI_URL = comfy.url;

const auth = await import("@/server/auth");
const generationsRoute = await import("@/app/api/generations/route");
const againRoute = await import("@/app/api/admin/generations/[id]/again/route");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const billing = await import("@/server/billing");
const tokens = await import("@/server/admin-tokens");

let fake: FakeBilling;
let a = "";
let cookie = "";
let owner = "";
let withGpu = "";
let gpuCookie = "";
beforeAll(async () => {
  fake = await startFakeBilling();
  globalThis.__fuobeTestGpuPort = comfy.port;
  auth.setPassword("install password");
  owner = `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
  a = auth.createAccount("again@example.com", "long enough").id;
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(a).value}`;
  withGpu = auth.createAccount("again-gpu@example.com", "long enough").id;
  auth.setAccountGpu(withGpu, { mode: "link", url: comfy.url } as never);
  gpuCookie = `${auth.SESSION_COOKIE}=${auth.createSession(withGpu).value}`;
});
afterAll(async () => {
  globalThis.__fuobeTestGpuPort = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  delete process.env.FUOBE_HOSTED_RUNS;
  delete process.env.FUOBE_BILLING_URL;
  delete process.env.FUOBE_BILLING_TOKEN;
  delete process.env.FUOBE_PUBLIC_SIGNUP;
  await fake.close();
  await comfy.close();
});

beforeEach(() => {
  resetRates();
  billing.resetBillingCache();
  fake.calls.length = 0;
  fake.down = false;
  fake.refuse = null;
  fake.price = { amount: 7, version: "v7" };
  process.env.FUOBE_HOSTED_RUNS = "1";
  process.env.FUOBE_BILLING_URL = fake.url;
  process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
});

const post = (body: unknown, c = cookie) => {
  const text = JSON.stringify(body);
  return generationsRoute.POST(
    new Request("http://localhost:3000/api/generations", { method: "POST", headers: { cookie: c, host: "localhost:3000", "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }, body: text }),
  );
};
const again = (id: string, body: unknown, headers: Record<string, string> = { cookie: owner }) =>
  againRoute.POST(
    new Request(`http://localhost:3000/api/admin/generations/${id}/again`, { method: "POST", headers: { host: "localhost:3000", "content-type": "application/json", ...headers }, body: body === undefined ? "" : JSON.stringify(body) }),
    { params: Promise.resolve({ id }) } as never,
  );
const stored = (id: string) => JSON.parse((db().prepare("SELECT request_json FROM generations WHERE id = ?").get(id) as { request_json: string }).request_json) as Record<string, unknown> & { params?: Record<string, unknown> };
const admissions = () => (db().prepare("SELECT COUNT(*) AS n FROM pool_admissions").get() as { n: number }).n;
const lastAudit = () => db().prepare("SELECT action, target, detail_json, status FROM admin_audit ORDER BY id DESC LIMIT 1").get() as { action: string; target: string | null; detail_json: string | null; status: number };
const NOTICE = "We had an issue making the 15-second version, so here is a 5-second version of your video.";

let seq = 0;
/** A run as the runner stores it (an account's on this install's GPUs unless said). */
function stash(request: Record<string, unknown>, o: { dependsOn?: string } = {}): string {
  const id = `stash-${++seq}`;
  const now = Date.now();
  db()
    .prepare(
      "INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at, depends_on) VALUES (?, 'video', ?, 'open', 'comfyui', ?, 'video', 'canceled', ?, '[]', ?, ?, ?)",
    )
    .run(id, request.modelId, request.op ?? "t2v", JSON.stringify(request), now, now, o.dependsOn ?? null);
  return id;
}
const h3 = (extra: Record<string, unknown> = {}) => ({ feature: "video", modelId: "oss-minimax-h3", op: "t2v", prompt: "a model walks a runway in silver light", params: { duration: 15, resolution: "768p", aspectRatio: "16:9" }, account: a, place: "pool", hold: "old-hold", charge: "7 units", charged: true, ...extra });

describe("running an account's run again for it", () => {
  it("makes a new run in the same account on this install's GPUs, with the changes and the notice, and free", async () => {
    const r = await post({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse at dusk", params: { aspectRatio: "16:9", seed: 3 }, shown: { amount: 7, priceVersion: "v7" } });
    expect(r.status).toBe(201);
    const first = ((await r.json()) as { items: { id: string }[] }).items[0].id;
    expect(fake.calls_of("/v1/reserve")).toHaveLength(1);
    const admitted = admissions();

    const res = await again(first, { changes: { params: { seed: 11 } }, notice: NOTICE });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { original: string; account: string; place: string; ids: string[]; items: { id: string; notice: string; params: Record<string, unknown> }[] };
    expect(body).toMatchObject({ original: first, account: a, place: "pool" });
    expect(body.ids).toHaveLength(1);
    expect(body.ids[0]).not.toBe(first);
    expect(body.items[0].notice).toBe(NOTICE);
    expect(body.items[0].params).toMatchObject({ seed: 11, aspectRatio: "16:9" });

    const made = stored(body.ids[0]);
    expect(made.account).toBe(a);
    expect(made.place).toBe("pool");
    expect(made.notice).toBe(NOTICE);
    expect(made.prompt).toBe("a lighthouse at dusk");
    expect(made.modelId).toBe("oss-z-image-turbo");
    // Free: nothing set aside, no charge, and not counted against the limits on runs here.
    expect(made.hold).toBeUndefined();
    expect(made.charge).toBeUndefined();
    expect(fake.calls_of("/v1/reserve")).toHaveLength(1);
    expect(admissions()).toBe(admitted);

    const log = lastAudit();
    expect(log).toMatchObject({ action: "run.again", target: first, status: 201 });
    const detail = JSON.parse(log.detail_json!) as Record<string, unknown>;
    expect(detail).toMatchObject({ account: a, ids: body.ids, place: "pool", changed: ["params.seed"], params: { seed: 11 }, notice: true });
    expect(log.detail_json).not.toContain("lighthouse");
  });

  it("changes a MiniMax H3 clip's length to one the model makes, and keeps everything else", async () => {
    const id = stash(h3());
    const res = await again(id, { changes: { params: { duration: 5 } }, notice: NOTICE });
    expect(res.status).toBe(201);
    const { ids } = (await res.json()) as { ids: string[] };
    const made = stored(ids[0]);
    expect(made.params).toMatchObject({ duration: 5, resolution: "768p", aspectRatio: "16:9" });
    expect(made).toMatchObject({ modelId: "oss-minimax-h3", op: "t2v", account: a, place: "pool", notice: NOTICE });
    expect(made.hold).toBeUndefined();
    expect(made.charged).toBeUndefined();
  });

  it("refuses a length the model doesn't make, and a setting the request doesn't take, with the reason", async () => {
    const id = stash(h3());
    for (const duration of [20, 4.5, 0]) {
      const res = await again(id, { changes: { params: { duration } } });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/duration|seconds/);
    }
    const typo = await again(id, { changes: { params: { durration: 5 } } });
    expect(typo.status).toBe(400);
    expect(((await typo.json()) as { error: string }).error).toBe("Unknown setting: durration");
    for (const bad of [{ changes: { model: "x" } }, { other: 1 }, { notice: 5 }, { notice: "x".repeat(301) }, { changes: { prompt: " " } }, [1]]) {
      expect((await again(id, bad)).status).toBe(400);
    }
    expect(lastAudit()).toMatchObject({ action: "run.again", target: id, status: 400 });
  });

  it("answers 404 for no such run and for the owner's own, and 409 for a step of a longer run", async () => {
    expect((await again("no-such-run", {})).status).toBe(404);
    const mine = stash({ ...h3(), account: undefined, place: undefined });
    const res = await again(mine, {});
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toMatch(/yours/);
    const step = stash(h3(), { dependsOn: mine });
    expect((await again(step, {})).status).toBe(409);
    expect(lastAudit()).toMatchObject({ action: "run.again", target: step, status: 409 });
  });

  it("is the owner's, or an admin token's with queue:control", async () => {
    const id = stash(h3());
    expect((await again(id, {}, { cookie })).status).toBe(403);
    const reader = tokens.createAdminToken({ name: "reader", scopes: ["runs:read", "outputs:view"] }).token;
    const denied = await again(id, {}, { authorization: `Bearer ${reader}` });
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as { code: string }).code).toBe("scope");
    const control = tokens.createAdminToken({ name: "control", scopes: ["queue:control"] }).token;
    const ok = await again(id, { changes: { params: { duration: 5 } } }, { authorization: `Bearer ${control}` });
    expect(ok.status).toBe(201);
    const { ids } = (await ok.json()) as { ids: string[] };
    expect(stored(ids[0]).notice).toBeUndefined();
  });

  it("runs a run that went to the account's own GPU there again", async () => {
    const r = await post({ feature: "image", modelId: "oss-z-image-turbo", prompt: "a quiet harbour", params: { seed: 1 } }, gpuCookie);
    expect(r.status).toBe(201);
    const first = ((await r.json()) as { items: { id: string }[] }).items[0].id;
    expect(stored(first).place).toBeUndefined();
    const res = await again(first, { changes: { prompt: "a quiet harbour at dawn" }, notice: NOTICE });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { place: string; ids: string[] };
    expect(body.place).toBe("own");
    const made = stored(body.ids[0]);
    expect(made).toMatchObject({ account: withGpu, prompt: "a quiet harbour at dawn", notice: NOTICE });
    expect(made.place).toBeUndefined();
    expect(JSON.parse(lastAudit().detail_json!)).toMatchObject({ changed: ["prompt"], place: "own" });
  });
});
