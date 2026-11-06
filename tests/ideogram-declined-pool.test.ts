import crypto from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Generation } from "@/lib/catalog/types";
import { startFakeBilling, FAKE_POLICY, type FakeBilling } from "./helpers/fake-billing";
import { tempDir } from "./helpers/temp-dir";

/**
 * An account's free Ideogram 4 run on this install's GPUs that comes back as the grey "blocked" card is made again in its
 * place, on the same GPUs: once more with a new seed, then with Qwen-Image 2.1. One press of Run stays one run: the
 * hourly count, the runs at once and the billing hold count it once, and the billing service gets one report for it.
 * The cards are for the owner only (Accounts' runs), never the account's. (The rules themselves on the owner's runs:
 * tests/ideogram-declined.test.ts.)
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 60_000 });

const dir = tempDir("fuobe-ideogram-declined-pool-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:7";
process.env.OLLAMA_URL = "http://127.0.0.1:7";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;
delete process.env.FUOBE_HOSTED_FREE;
delete process.env.FUOBE_BILLING_URL;
delete process.env.FUOBE_MODERATION_URL;
delete process.env.ANTHROPIC_API_KEY;
globalThis.__fuobeTestDiskFree = 1e13;

const realFetch = globalThis.fetch;
let allowed: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (allowed.some((a) => url.startsWith(a))) return realFetch(input, init);
  return new Response("not reachable in this test", { status: 599 });
}) as typeof fetch;

const auth = await import("@/server/auth");
const generationsRoute = await import("@/app/api/generations/route");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { setSetting } = await import("@/server/settings");
const pool = await import("@/server/computer/pool");
const { catalogVersion } = await import("@/server/computer/catalog-version");
const billing = await import("@/server/billing");
const { queueReports } = await import("@/server/billing-outbox");
const limits = await import("@/server/pool-limits");
const { comfyProvider, loadManifest } = await import("@/server/providers/comfyui");
const { loadIndex } = await import("@/server/gpu/index-file");
const { allLanes } = await import("@/lib/lanes");
const { getGeneration } = await import("@/server/generations");
const { listAccountRuns } = await import("@/server/account-admin");
const { DECLINED_NOTICE, DECLINED_WORDS } = await import("@/server/safety-card");
const { encodePng } = await import("@/server/png");

const HOST = "localhost:3000";
const SITE_HEADERS = { host: HOST, "sec-fetch-site": "same-origin", origin: `http://${HOST}` };
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

const png = (w: number, h: number, at: (x: number, y: number) => [number, number, number]) => {
  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...at(x, y), 255], (y * w + x) * 4);
  return encodePng({ width: w, height: h, data });
};
const card = png(640, 480, (x, y) => (y > 232 && y < 248 && x > 180 && x < 460 && x % 4 < 2 ? [58, 58, 57] : [120, 118, 116]));
const gradient = png(640, 480, (x, y) => [Math.round((x / 639) * 255), Math.round((y / 479) * 255), 128]);
const dataUri = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;

let fake: FakeBilling;
let n = 0;

function account() {
  const a = auth.createAccount(`declined-${++n}@example.com`, "long enough");
  return { id: a.id, cookie: `${auth.SESSION_COOKIE}=${auth.createSession(a.id).value}` };
}

const post = async (body: Record<string, unknown>, cookie: string) => {
  const text = JSON.stringify(body);
  const r = await generationsRoute.POST(
    new Request(`http://${HOST}/api/generations`, { method: "POST", headers: { ...SITE_HEADERS, cookie, "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }, body: text }),
  );
  return { status: r.status, body: (await r.json()) as { items?: { id: string }[]; code?: string; error?: string } };
};

/** A worker as the owner adds it, connected: the line is open for the account's runs. */
function standInWorker() {
  const w = pool.addWorker(`stand-in-${++n}`);
  const lanes = allLanes(loadIndex(), sha);
  pool.patchWorker(w.id, { paused: false, hours: { always: true }, allow: Object.fromEntries(lanes.map((l) => [l.lane, { delayMs: 0 }])), claimAfterMs: 0 });
  db()
    .prepare("UPDATE relay_workers SET lanes_json = ?, facts_json = ?, catalog_version = ?, protocol = 3 WHERE id = ?")
    .run(JSON.stringify({ lanes: lanes.map((l) => l.lane), workflows: loadManifest().workflows.map((x) => x.id) }), JSON.stringify({ vramBytes: 96 * 2 ** 30 }), catalogVersion(), w.id);
  db().prepare("UPDATE relay_workers SET seen_at = ?, paused_local = 0 WHERE id = ?").run(Date.now(), w.id);
  return w;
}

const tick = () => globalThis.__fuobeRunner?.tick();
async function settled(id: string): Promise<Generation> {
  const end = Date.now() + 30_000;
  for (;;) {
    await tick();
    const g = getGeneration(id)!;
    if (["succeeded", "failed", "canceled"].includes(g.status)) return g;
    if (Date.now() > end) throw new Error(`${id} is still ${g.status}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** The jobs the GPUs were sent (the workers' side is stood in for: each job answers at its first look). */
let sent: { model: string; id: string; tile: Generation; going: number; hourly: number }[] = [];
let ideogram: Buffer[][] = [];
const submit = comfyProvider.submit;
const poll = comfyProvider.poll;
const answers = new Map<string, Buffer[]>();
let accountId = "";

const admitted = (id: string) => db().prepare("SELECT COUNT(*) FROM pool_admissions WHERE account = ?").pluck().get(id) as number;
const rowsOf = (id: string) => db().prepare("SELECT COUNT(*) FROM generations WHERE json_extract(request_json, '$.account') = ?").pluck().get(id) as number;

beforeAll(async () => {
  fake = await startFakeBilling();
  allowed = [fake.url];
  auth.setPassword("install password");
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  globalThis.__fuobeTestDiskFree = undefined;
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_HOSTED_FREE", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN"]) delete process.env[k];
  await fake.close();
});
beforeEach(() => {
  resetRates();
  billing.resetBillingCache();
  process.env.FUOBE_HOSTED_RUNS = "1";
  process.env.FUOBE_HOSTED_FREE = "1";
  delete process.env.FUOBE_BILLING_URL;
  delete process.env.FUOBE_BILLING_TOKEN;
  fake.policy = { ...FAKE_POLICY };
  setSetting("comfyWhere", "workers");
  setSetting("comfyUrl", "");
  setSetting("engineMode", "open");
  setSetting("demoMode", "off");
  setSetting("enhanceProvider", "none");
  db().prepare("DELETE FROM relay_workers").run();
  standInWorker();
  sent = [];
  ideogram = [];
  answers.clear();
  comfyProvider.submit = async (ctx) => {
    sent.push({ model: ctx.model.id, id: ctx.generationId, tile: getGeneration(ctx.generationId)!, going: limits.accountActiveRuns(accountId), hourly: admitted(accountId) });
    return { externalId: `job-${crypto.randomUUID()}`, meta: {} };
  };
  comfyProvider.poll = async (ctx) => {
    let pics = answers.get(ctx.externalId);
    if (!pics) answers.set(ctx.externalId, (pics = ctx.model.id === "oss-ideogram-4" ? (ideogram.shift() ?? [gradient]) : [gradient]));
    return { state: "succeeded", outputs: pics.map((p) => ({ url: dataUri(p), kind: "image" as const })) };
  };
});
afterEach(() => {
  comfyProvider.submit = submit;
  comfyProvider.poll = poll;
});

describe("an account's free Ideogram 4 run on this install's GPUs that comes back as the card", () => {
  it("is made again there, then by Qwen-Image 2.1, and counts as one run", async () => {
    const a = account();
    accountId = a.id;
    ideogram = [[card], [card]];
    const r = await post({ feature: "image", modelId: "oss-ideogram-4", prompt: "a red fox in deep snow", params: { aspectRatio: "4:5" } }, a.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.items![0].id;
    const g = await settled(id);
    expect(g.status, g.error ?? "").toBe("succeeded");
    expect(g.place).toBe("pool");
    expect(g.modelId).toBe("oss-qwen-image-21");
    expect(g.request.notice).toBe(DECLINED_NOTICE);
    expect(g.outputs).toHaveLength(1);
    // Three jobs, all for the one run, on the same GPUs.
    expect(sent.map((s) => [s.model, s.id])).toEqual([
      ["oss-ideogram-4", id],
      ["oss-ideogram-4", id],
      ["oss-qwen-image-21", id],
    ]);
    // While it was made again, its tile said Working in plain words, and it was still one run going, let in once.
    expect(sent[1].tile.status).toBe("running");
    expect(sent[1].tile.message).toBe(DECLINED_WORDS.retry);
    expect(sent[1].tile.queue).toBeUndefined();
    expect(sent[2].tile.message).toBe(DECLINED_WORDS.fallback);
    expect(sent.map((s) => s.going)).toEqual([1, 1, 1]);
    expect(sent.map((s) => s.hourly)).toEqual([1, 1, 1]);
    expect(admitted(a.id)).toBe(1);
    expect(rowsOf(a.id)).toBe(1);
    // The account never sees what Ideogram 4 returned; the owner does, in Accounts' runs.
    expect(g.declinedCards).toBeUndefined();
    const listed = listAccountRuns({ account: a.id }).items.find((x) => x.id === id)!;
    expect(listed.declinedCards).toHaveLength(2);
  });

  it("with a billing service: one hold, and one report for the run", async () => {
    process.env.FUOBE_BILLING_URL = fake.url;
    process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
    billing.resetBillingCache();
    const a = account();
    accountId = a.id;
    ideogram = [[card], [gradient]];
    const reserves = fake.calls_of("/v1/reserve").length;
    const r = await post({ feature: "image", modelId: "oss-ideogram-4", prompt: "a lighthouse at dusk", shown: { amount: 7, priceVersion: "v7" } }, a.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.items![0].id;
    const g = await settled(id);
    expect(g.status, g.error ?? "").toBe("succeeded");
    expect(g.modelId).toBe("oss-ideogram-4");
    expect(sent.map((s) => s.model)).toEqual(["oss-ideogram-4", "oss-ideogram-4"]);
    expect(fake.calls_of("/v1/reserve").length - reserves).toBe(1);
    expect(admitted(a.id)).toBe(1);
    queueReports();
    const reports = db().prepare("SELECT kind FROM billing_outbox WHERE key = ?").pluck().all(id) as string[];
    expect(reports).toEqual(["settle"]);
    expect(db().prepare("SELECT COUNT(*) FROM billing_outbox WHERE hold_id = (SELECT json_extract(request_json, '$.hold') FROM generations WHERE id = ?)").pluck().get(id)).toBe(1);
  });
});
