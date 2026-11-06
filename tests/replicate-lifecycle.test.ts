import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeReplicate, type CloudRequest, type FakeCloud } from "./helpers/fake-cloud";
import { TINY_PNG } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

/**
 * A Replicate prediction's life as Replicate documents it (read 2026-11-06): a deadline sent with every prediction
 * (Cancel-After), how long a throttled call asks to wait (429), and an output Replicate deletes an hour after it is made
 * (data_removed; replicate.delivery links expire). Stand-ins only: no key is real and nothing leaves this machine.
 * https://replicate.com/docs/topics/predictions/create-a-prediction#prediction-deadlines
 * https://replicate.com/docs/topics/predictions/rate-limits
 * https://replicate.com/docs/topics/predictions/data-retention
 */
const dir = tempDir("fuobe-replicate-lifecycle-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ENGINE_MODE;
globalThis.__fuobeTestDiskFree = 1e13;

const auth = await import("@/server/auth");
const keys = await import("@/server/account-keys");
const generationsRoute = await import("@/app/api/generations/route");
const gens = await import("@/server/generations");
const { db } = await import("@/server/db");
const { setSetting } = await import("@/server/settings");
const { resetRates } = await import("@/server/rate");
const { replicateProvider } = await import("@/server/providers/replicate");

let rep: FakeCloud;
let delivery: http.Server;
let deliveryUrl = "";
/** Answers of the stand-in replicate.delivery, in turn (then 200 with a PNG). */
let deliveryAnswers: number[] = [];
let A = "";
const cookies: Record<string, string> = {};

beforeAll(async () => {
  rep = await startFakeReplicate();
  globalThis.__fuobeTestReplicateUrl = rep.url;
  rep.keys["owner-rep"] = "good";
  rep.keys["acct-rep-A"] = "good";
  setSetting("replicateToken", "owner-rep");
  delivery = http.createServer((req, res) => {
    const status = deliveryAnswers.shift() ?? 200;
    if (status !== 200) {
      res.writeHead(status, { "Content-Type": "text/plain" });
      return res.end("busy");
    }
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": String(TINY_PNG.length) });
    res.end(TINY_PNG);
  });
  await new Promise<void>((r) => delivery.listen(0, "127.0.0.1", r));
  deliveryUrl = `http://127.0.0.1:${(delivery.address() as { port: number }).port}`;
  auth.setPassword("install password");
  A = auth.createAccount("replicate-lifecycle-a@example.com", "long enough").id;
  keys.saveAccountKey(A, "replicate", "acct-rep-A");
  cookies.A = `${auth.SESSION_COOKIE}=${auth.createSession(A).value}`;
  gens.ensureRunner();
});
afterAll(async () => {
  globalThis.__fuobeTestReplicateUrl = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  gens.SELF_HEAL.scale = 1;
  await rep.close();
  await new Promise<void>((r) => delivery.close(() => r()));
});
beforeEach(async () => {
  resetRates();
  gens.SELF_HEAL.scale = 0.01;
  globalThis.__fuobePollHeals?.clear();
  db().prepare("UPDATE generations SET status = 'canceled' WHERE status IN ('queued', 'running')").run();
  rep.log.length = 0;
  rep.pollsToFinish = 2;
  rep.script = null;
  deliveryAnswers = [];
});

const isPoll = (r: CloudRequest) => r.method === "GET" && /^\/v1\/predictions\/[^/]+$/.test(r.path);
const accountRun = async () => {
  const text = JSON.stringify({ feature: "image", modelId: "nano-banana-pro", engine: "cloud", prompt: "a quiet harbour at dawn", prefer: "replicate" });
  const r = await generationsRoute.POST(new Request("http://localhost:3000/api/generations", { method: "POST", headers: { cookie: cookies.A, host: "localhost:3000", "content-type": "application/json", "content-length": String(text.length) }, body: text }));
  expect(r.status, await r.clone().text()).toBe(201);
  const g = ((await r.json()) as { items: { id: string; provider: string }[] }).items[0];
  expect(g.provider).toBe("replicate");
  return g.id;
};
const ownerRun = () => {
  const [g] = gens.createGenerations({ feature: "image", modelId: "nano-banana-pro", engine: "cloud", prompt: "a quiet harbour at dawn" });
  expect(g.provider).toBe("replicate");
  return g.id;
};
async function settle(id: string, until: (g: NonNullable<ReturnType<typeof gens.getGeneration>>) => boolean = (g) => !["queued", "running"].includes(g.status), ms = 15_000) {
  const end = Date.now() + ms;
  for (;;) {
    await globalThis.__fuobeRunner?.tick();
    const g = gens.getGeneration(id, { includeDeleted: true })!;
    if (until(g) || Date.now() > end) return g;
    await new Promise((r) => setTimeout(r, 15));
  }
}

describe("Replicate: a deadline with every prediction (Cancel-After)", () => {
  const sent = async (fn: () => Promise<unknown>) => {
    const real = globalThis.fetch;
    let headers: Record<string, string> = {};
    globalThis.fetch = (async (_url: string, init: RequestInit = {}) => {
      headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
      return new Response(JSON.stringify({ id: "p1", status: "starting" }), { status: 201, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      await fn();
    } finally {
      globalThis.fetch = real;
    }
    return headers;
  };
  const route = { op: "t2i", provider: "replicate", endpoint: "google/nano-banana-pro", map: {} } as never;
  const model = { id: "x" } as never;

  it("the owner's: 4 hours to start plus 45 minutes to run; an account's: 30 minutes plus 45", async () => {
    // Replicate: "Valid values are between 5 seconds and 24 hours"; an integer with s, m or h.
    expect((await sent(() => replicateProvider.submit({ generationId: "g", model, route, input: { prompt: "x" } as never })))["cancel-after"]).toBe("17100s");
    const own = await gens.asAccount(A, () => sent(() => replicateProvider.submit({ generationId: "g", model, route, input: { prompt: "x" } as never })));
    expect(own["cancel-after"]).toBe("4500s");
  });
});

describe("Replicate: a throttled call (429) waits as long as Replicate asks", () => {
  it("keeps the Retry-After header, else the wait in Replicate's words", async () => {
    const real = globalThis.fetch;
    const answers = [
      new Response(JSON.stringify({ detail: "Request was throttled. Expected available in 12 seconds." }), { status: 429, headers: { "content-type": "application/problem+json", "retry-after": "30" } }),
      new Response(JSON.stringify({ detail: "Request was throttled. Expected available in 12 seconds." }), { status: 429, headers: { "content-type": "application/problem+json" } }),
      new Response(JSON.stringify({ detail: "Request was throttled. Your rate limit resets in ~30s." }), { status: 429, headers: { "content-type": "application/problem+json" } }),
    ];
    globalThis.fetch = (async () => answers.shift()!) as typeof fetch;
    const waits: unknown[] = [];
    try {
      for (let i = 0; i < 3; i++) {
        await replicateProvider.poll({ externalId: "p1", meta: {}, route: { op: "t2i" } as never, model: {} as never, createdAt: 0 }).catch((e) => waits.push((e as { retryAfterS?: number }).retryAfterS));
      }
    } finally {
      globalThis.fetch = real;
    }
    expect(waits).toEqual([30, 12, 30]);
  });

  it("an account's poll that Replicate throttles asks again after Replicate's wait, not after 5 seconds", async () => {
    gens.SELF_HEAL.scale = 1;
    const id = await accountRun();
    await settle(id, (g) => g.status === "queued" && !!gens.getGeneration(id)?.provider && rep.log.some(isPoll), 5_000);
    rep.script = (r) => (isPoll(r) ? { status: 429, body: { detail: "Request was throttled. Expected available in 90 seconds." }, headers: { "Retry-After": "90" } } : null);
    await settle(id, () => !!globalThis.__fuobePollHeals?.get(id), 5_000);
    const heal = globalThis.__fuobePollHeals!.get(id)!;
    expect(heal.next - Date.now()).toBeGreaterThan(60_000);
    await gens.cancelGeneration(id);
  });
});

describe("Replicate: an output deleted an hour after it was made", () => {
  it("an account's run that collects it too late says it expired (not that Replicate sent nothing back)", async () => {
    rep.script = (r) => (isPoll(r) ? { status: 200, body: { id: r.path.split("/").at(-1), status: "succeeded", output: null, data_removed: true } } : null);
    const g = await settle(await accountRun());
    expect(g.status).toBe("failed");
    expect(g.trouble?.cause).toBe("result-expired");
  });

  it("the owner's run says so too", async () => {
    rep.script = (r) => (isPoll(r) ? { status: 200, body: { id: r.path.split("/").at(-1), status: "succeeded", output: null, data_removed: true } } : null);
    const g = await settle(ownerRun());
    expect(g.status).toBe("failed");
    expect(g.error).toMatch(/deleted this result an hour after it was made/);
  });

  it("the owner's result whose copy breaks off is copied again at a later poll, never kept as Replicate's expiring link", async () => {
    deliveryAnswers = [503, 503, 503];
    rep.script = (r) => (isPoll(r) ? { status: 200, body: { id: r.path.split("/").at(-1), status: "succeeded", output: `${deliveryUrl}/xezq/out.png` } } : null);
    const g = await settle(ownerRun());
    expect(g.status).toBe("succeeded");
    expect(g.outputs[0].url.startsWith(deliveryUrl)).toBe(false);
    expect(g.outputs[0].kind).toBe("image");
  });
});
