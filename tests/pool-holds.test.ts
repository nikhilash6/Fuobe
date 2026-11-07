import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { lineWords, noteWords } from "@/lib/pool-line";
import { startFakeBilling, FAKE_POLICY, type FakeBilling } from "./helpers/fake-billing";
import { tempDir } from "./helpers/temp-dir";

/**
 * Runs on this install's GPUs that are made but wait to enter the line (src/server/pool-holds.ts, pool-release.ts): one
 * press makes one run, always. A press past the account's runs at once is taken and enters at the back when one of them
 * ends (so ten fast presses never pass another account); the day's GPU time used up keeps runs back until it renews,
 * then they enter in press order; a press while the billing service doesn't answer is taken and reserves once it is
 * back, at its press-time place; a run cut off between its row and its GPU task is sent again in its place (and ends
 * instead when a task was made for it); only a press past the cap on runs waiting is refused. Leases keep two app
 * processes from releasing one run twice.
 */

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.setConfig({ testTimeout: 60_000 });

const dir = tempDir("fuobe-pool-holds-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:7";
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_HOSTED_RUNS;
delete process.env.FUOBE_HOSTED_FREE;
delete process.env.FUOBE_BILLING_URL;
delete process.env.FUOBE_MODERATION_URL;
delete process.env.FUOBE_TRUST_PROXY;
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
const limits = await import("@/server/pool-limits");
const holds = await import("@/server/pool-holds");
const release = await import("@/server/pool-release");
const { loadManifest } = await import("@/server/providers/comfyui");
const { loadIndex } = await import("@/server/gpu/index-file");
const { allLanes } = await import("@/lib/lanes");
const { cancelGeneration, getGeneration } = await import("@/server/generations");
const { ACCOUNT_LIMITS, ACCOUNT_MESSAGES } = await import("@/server/account-files");

const HOST = "localhost:3000";
const SITE_HEADERS = { host: HOST, "sec-fetch-site": "same-origin", origin: `http://${HOST}` };
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const IMAGE = { feature: "image", modelId: "oss-z-image-turbo", prompt: "a lighthouse" };
const SHOWN = { shown: { amount: 7, priceVersion: "v7" } };

let fake: FakeBilling;
let n = 0;

function account() {
  const a = auth.createAccount(`holds-${++n}@example.com`, "long enough");
  return { id: a.id, cookie: `${auth.SESSION_COOKIE}=${auth.createSession(a.id).value}` };
}

type Answer = { status: number; body: { items?: { id: string; place?: string; queue?: Record<string, unknown> }[]; code?: string; error?: string; held?: { reason: string }; quote?: Record<string, unknown>; line?: Record<string, unknown> } };

const send = async (url: string, body: Record<string, unknown>, cookie: string): Promise<Answer> => {
  const text = JSON.stringify(body);
  const r = await generationsRoute.POST(
    new Request(url, { method: "POST", headers: { ...SITE_HEADERS, cookie, "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }, body: text }),
  );
  return { status: r.status, body: (await r.json()) as Answer["body"] };
};
const press = (cookie: string, extra: Record<string, unknown> = {}) => send(`http://${HOST}/api/generations`, { ...IMAGE, ...SHOWN, requestId: `p-${crypto.randomUUID()}`, ...extra }, cookie);
const check = (cookie: string) => send(`http://${HOST}/api/generations?preview=1`, { ...IMAGE }, cookie);

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

/** Runs wait instead of being refused: a policy with `limits.held` (8 waiting behind 2 at once, as at launch). */
const withHolds = (lim: Record<string, unknown> = {}) => {
  process.env.FUOBE_BILLING_URL = fake.url;
  process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
  fake.policy = { ...FAKE_POLICY, limits: { ...FAKE_POLICY.limits, activeRuns: 2, waiting: 0, runsPerHour: 0, outputsPerRun: 4, held: 8, ...lim }, ttlS: 0 };
  billing.resetBillingCache();
};

beforeAll(async () => {
  fake = await startFakeBilling();
  allowed = [fake.url];
  auth.setPassword("install password");
});
afterAll(async () => {
  globalThis.fetch = realFetch;
  globalThis.__fuobeTestDiskFree = undefined;
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_HOSTED_FREE", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN", "FUOBE_TRUST_PROXY"]) delete process.env[k];
  await fake.close();
});
beforeEach(() => {
  resetRates();
  billing.resetBillingCache();
  process.env.FUOBE_HOSTED_RUNS = "1";
  process.env.FUOBE_HOSTED_FREE = "1";
  delete process.env.FUOBE_BILLING_URL;
  delete process.env.FUOBE_BILLING_TOKEN;
  fake.down = false;
  fake.refuse = null;
  fake.reserveExtra = {};
  fake.quoteAnswer = null;
  fake.price = { amount: 7, version: "v7" };
  setSetting("comfyWhere", "workers");
  setSetting("comfyUrl", "");
  setSetting("engineMode", "open");
  setSetting("demoMode", "off");
  db().prepare("DELETE FROM relay_workers").run();
  db().prepare("UPDATE relay_tasks SET state = 'canceled' WHERE state IN ('waiting','sending','queued','running','collecting')").run();
  db().prepare("DELETE FROM pool_holds").run();
  standInWorker();
  withHolds();
});

const tick = () => globalThis.__fuobeRunner?.tick();
async function until<T>(fn: () => T | Promise<T>, tries = 200, everyMs = 25): Promise<T> {
  let v = await fn();
  for (let i = 0; i < tries && !v; i++) {
    await tick();
    await new Promise((r) => setTimeout(r, everyMs));
    v = await fn();
  }
  return v;
}
const taskOf = (generationId: string) =>
  db().prepare("SELECT id, state, rank_at, created_at FROM relay_tasks WHERE generation_id = ? AND pools IS NOT NULL ORDER BY created_at DESC").get(generationId) as
    | { id: string; state: string; rank_at: number; created_at: number }
    | undefined;
const heldOf = (generationId: string) => holds.holdOf(generationId);
const idOf = (r: Answer) => r.body.items![0].id;
const tile = (id: string) => {
  const g = getGeneration(id)!;
  return g.queue ? lineWords(g.queue) : null;
};
/** The account's runs going stop (the first ends): room opens for a run that waits behind them. */
async function stop(ids: string[]) {
  for (const id of ids) await cancelGeneration(id);
}

describe("the third press (behind the account's own runs)", () => {
  it("A2: three fast presses make three runs; the third waits after the others and enters at the back when the first ends", async () => {
    const a = account();
    const b = account();
    const [one, two, three] = [await press(a.cookie), await press(a.cookie), await press(a.cookie)];
    for (const r of [one, two, three]) expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(one.body.held).toBeUndefined();
    expect(two.body.held).toBeUndefined();
    // The third: made at once, its tile "In line", and no GPU task yet.
    expect(three.body.held).toEqual({ reason: "mine" });
    expect(three.body.items![0].queue).toMatchObject({ held: "mine" });
    expect(taskOf(idOf(three))).toBeUndefined();
    expect(tile(idOf(three))).toMatch(/^After your other runs/);
    // A reload changes nothing: the same tile, and still no task.
    await tick();
    expect(tile(idOf(three))).toMatch(/^After your other runs/);
    expect(taskOf(idOf(three))).toBeUndefined();
    // Another account's press meanwhile goes into line now.
    const other = await press(b.cookie);
    expect(other.body.held).toBeUndefined();
    const otherTask = await until(() => taskOf(idOf(other)));
    // The first ends: the third enters, at the back (behind the other account's run, pressed after it).
    await stop([idOf(one)]);
    const t = await until(() => taskOf(idOf(three)));
    expect(t, "the third entered the line").toBeTruthy();
    expect(t!.rank_at).toBeGreaterThan(otherTask!.rank_at);
    expect(heldOf(idOf(three))).toBeUndefined();
    // One run per press: three rows for three presses, each with one hold at the service.
    const reserves = fake.calls_of("/v1/reserve").map((c) => (c.body as { requestId: string }).requestId);
    expect(new Set(reserves).size).toBe(reserves.length);
  });

  it("ten presses never pass another account: the held ones enter behind a run pressed after them", async () => {
    const a = account();
    const b = account();
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await press(a.cookie);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      ids.push(idOf(r));
    }
    expect(holds.heldRuns(a.id)).toBe(8);
    const other = await press(b.cookie);
    const otherTask = await until(() => taskOf(idOf(other)));
    await stop(ids.slice(0, 2));
    await until(() => taskOf(ids[2]) && taskOf(ids[3]));
    for (const id of ids.slice(2, 4)) expect(taskOf(id)!.rank_at).toBeGreaterThan(otherTask!.rank_at);
    // Its presses enter in the order they were made, two at a time: the next ones still wait.
    expect(taskOf(ids[4])).toBeUndefined();
    expect(holds.heldRuns(a.id)).toBe(6);
  });

  it("the held cap: the 11th press (10 on the way) is the only one turned down, before Run and when pressed", async () => {
    const a = account();
    for (let i = 0; i < 10; i++) expect((await press(a.cookie)).status).toBe(201);
    const p = await check(a.cookie);
    expect(p.body.quote).toMatchObject({ allowed: false, code: "limit", text: limits.POOL_LIMIT_WORDS.heldCap(10) });
    const eleventh = await press(a.cookie);
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.error).toBe("You have 10 runs on the way. Add more when one is done.");
    expect(limits.POOL_LIMIT_WORDS.heldCap(10)).toBe(eleventh.body.error);
  });

  it("before Run: 'Starts after your other runs' while two go, and Run stays on", async () => {
    const a = account();
    await press(a.cookie);
    await press(a.cookie);
    const p = await check(a.cookie);
    expect(p.body.quote).toMatchObject({ allowed: true });
    expect(p.body.line).toMatchObject({ held: "mine" });
    expect(noteWords(p.body.line as never)).toBe("Starts after your other runs");
  });

  it("A19: six presses meet no 'You have 4 runs going' and no hourly refusal of the studio's own; the 11th meets the held cap only", async () => {
    const a = account();
    // The studio's own hourly count, made small: runs on this install's GPUs never meet it.
    const lim = ACCOUNT_LIMITS as unknown as { runsPerHour: number };
    const was = lim.runsPerHour;
    try {
      lim.runsPerHour = 3;
      for (let i = 0; i < 10; i++) {
        const r = await press(a.cookie);
        expect(r.status, JSON.stringify(r.body)).toBe(201);
        expect(r.body.error).not.toBe(ACCOUNT_MESSAGES.activeRuns);
      }
      expect((await press(a.cookie)).body.error).toBe(limits.POOL_LIMIT_WORDS.heldCap(10));
    } finally {
      lim.runsPerHour = was;
    }
  });

  it("an hourly limit holds a run until the hour's oldest run is an hour old, and it enters at the back then", async () => {
    withHolds({ activeRuns: 0, runsPerHour: 2 });
    const a = account();
    await press(a.cookie);
    await press(a.cookie);
    const third = await press(a.cookie);
    expect(third.body.held).toEqual({ reason: "hour" });
    const h = heldOf(idOf(third))!;
    expect(h.start_at! - Date.now()).toBeGreaterThan(59 * 60_000);
    expect(tile(idOf(third))).toMatch(/^Free runs refresh (at .+|in a moment) · this one starts then$/);
    // Not before its time; then it enters.
    expect(await release.releaseHeldRuns()).toBe(0);
    expect(await release.releaseHeldRuns(h.start_at! + 1)).toBe(1);
    expect(await until(() => taskOf(idOf(third)))).toBeTruthy();
  });

  it("cancel: a held run stops like any other, its hold goes, and nothing is ever sent for it", async () => {
    const a = account();
    const [one] = [await press(a.cookie), await press(a.cookie)];
    const third = await press(a.cookie);
    await cancelGeneration(idOf(third));
    expect(getGeneration(idOf(third))!.status).toBe("canceled");
    expect(heldOf(idOf(third))).toBeUndefined();
    await stop([idOf(one)]);
    await tick();
    expect(taskOf(idOf(third))).toBeUndefined();
  });

  it("C17: the owner sees held runs by why (counts only), and a deleted account leaves no holds", async () => {
    const a = account();
    for (let i = 0; i < 4; i++) await press(a.cookie);
    const v = pool.queueView();
    expect(v.held.mine).toBe(2);
    expect(v.held.oldestAt).toBeTypeOf("number");
    expect(JSON.stringify(v.held)).not.toContain(a.id);
    holds.clearHolds(a.id);
    expect(holds.heldRuns(a.id)).toBe(0);
  });
});

describe("the daily cap (H2)", () => {
  /** The next UTC midnight: the time the billing service says the day's GPU time renews. */
  const midnight = () => (Math.floor(Date.now() / 86_400_000) + 1) * 86_400_000;

  it("A4: past the day's GPU time a press makes a held run; before Run the free-runs line; at the renewal they enter in press order", async () => {
    const at = midnight();
    fake.reserveExtra = { startAt: at };
    fake.quoteAnswer = { allowed: true, amount: 7, priceVersion: "v7", text: "7 units", startAt: at };
    const a = account();
    const b = account();
    const p = await check(a.cookie);
    expect(p.body.quote).toMatchObject({ allowed: true });
    expect(p.body.line).toMatchObject({ held: "today", startAt: at, long: true });
    expect(noteWords(p.body.line as never)).toMatch(/^Free runs refresh at .+\.$/);
    const first = await press(b.cookie);
    await new Promise((r) => setTimeout(r, 5));
    const second = await press(a.cookie);
    for (const r of [first, second]) {
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.held).toEqual({ reason: "today" });
    }
    expect(tile(idOf(second))).toMatch(/^Free runs refresh (at .+|in a moment) · this one starts then$/);
    // Its hold is made at the press (the service keeps it until then).
    expect(heldOf(idOf(second))!.reserved).toBe(1);
    expect(await release.releaseHeldRuns()).toBe(0);
    // A run pressed now, after the renewal, by a third account.
    fake.reserveExtra = {};
    const c = account();
    const later = await press(c.cookie);
    const laterTask = await until(() => taskOf(idOf(later)));
    expect(await release.releaseHeldRuns(at + 1)).toBe(2);
    const t1 = await until(() => taskOf(idOf(first)));
    const t2 = await until(() => taskOf(idOf(second)));
    // Press order, at their press-time places (ahead of the run pressed after them).
    expect(t1!.rank_at).toBeLessThan(t2!.rank_at);
    expect(t2!.rank_at).toBeLessThan(laterTask!.rank_at);
  });

  it("H6: no free generations left (credits on): the press is taken, waits for the renewal, and reserves then", async () => {
    const at = midnight();
    // The reserve turns it down for credit; the quote says the free generations that renew then pay for it.
    fake.refuse = { code: "top-up", text: "This needs 7 units. You have 0." };
    fake.quoteAnswer = { allowed: true, amount: 7, priceVersion: "v7", text: "7 units", startAt: at };
    const a = account();
    const r = await press(a.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.held).toEqual({ reason: "credits" });
    const id = idOf(r);
    expect(tile(id)).toMatch(/^Starts (at .+|in a moment), when your free generations renew$/);
    const h = heldOf(id)!;
    expect(h).toMatchObject({ reserved: 0, rank_rule: "release", start_at: at });
    expect(await release.releaseHeldRuns()).toBe(0);
    // Renewed: it reserves under its press's request id and enters the line.
    fake.refuse = null;
    expect(await release.releaseHeldRuns(at + 1)).toBe(1);
    expect(await until(() => taskOf(id))).toBeTruthy();
    expect([...fake.holds.values()].filter((x) => x.requestId === h.request_id).length).toBe(1);
  });

  it("a refusal for credit with nothing that renews in time stays a refusal, as before", async () => {
    fake.refuse = { code: "top-up", text: "This needs 7 units. You have 0." };
    fake.quoteAnswer = { allowed: false, amount: 7, priceVersion: "v7", text: "This needs 7 units. You have 0.", code: "top-up" };
    const a = account();
    const r = await press(a.cookie);
    expect(r.status).toBe(402);
    expect(r.body.held).toBeUndefined();
  });
});

describe("service blips (H3)", () => {
  it("A3: the service stops across a press: the run is made (no card, no toast), and reserves and enters at its press-time place once it is back", async () => {
    const was = { ...billing.RESERVE_INLINE };
    try {
      billing.RESERVE_INLINE.ms = 300;
      const a = account();
      // The policy is known (the service answered a moment ago).
      expect((await check(a.cookie)).status).toBe(200);
      fake.down = "error";
      const before = Date.now();
      const r = await press(a.cookie);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.held).toEqual({ reason: "service" });
      const id = idOf(r);
      // "In line" with its place as if in line, never a bare "In line".
      expect(tile(id)).toMatch(/^(You're next|\d+ ahead of you)/);
      // Before Run, while the service is quiet: the last price it gave, and Run stays on.
      const quiet = await check(a.cookie);
      expect(quiet.body.quote).toMatchObject({ allowed: true, text: "7 units" });
      await tick();
      expect(taskOf(id)).toBeUndefined();
      const requestId = heldOf(id)!.request_id;
      expect(requestId).toBeTruthy();
      // Back, a while after the press: it reserves under its press's request id (one hold for the press) and enters the
      // line at its press-time place, never at the time it was let in.
      await new Promise((r) => setTimeout(r, 40));
      const backAt = Date.now();
      fake.down = false;
      const t = await until(() => taskOf(id));
      expect(t).toBeTruthy();
      expect(t!.created_at).toBeGreaterThanOrEqual(backAt);
      expect(t!.rank_at).toBeLessThanOrEqual(before);
      expect(t!.rank_at).toBeLessThan(backAt);
      const made = [...fake.holds.values()].filter((h) => h.requestId === requestId);
      expect(made.length).toBe(1);
      const g = db().prepare("SELECT json_extract(request_json, '$.hold') AS hold FROM generations WHERE id = ?").get(id) as { hold: string | null };
      expect(g.hold).toBeTruthy();
    } finally {
      Object.assign(billing.RESERVE_INLINE, was);
    }
  });

  it("the cap counts runs waiting for any reason: while the service is quiet, ten presses are taken and the 11th is turned down", async () => {
    const was = { ...billing.RESERVE_INLINE };
    try {
      billing.RESERVE_INLINE.ms = 100;
      const a = account();
      await check(a.cookie);
      fake.down = "error";
      for (let i = 0; i < 10; i++) {
        const r = await press(a.cookie);
        expect(r.status, JSON.stringify(r.body)).toBe(201);
        expect(r.body.held).toEqual({ reason: "service" });
      }
      const eleventh = await press(a.cookie);
      expect(eleventh.status).toBe(429);
      expect(eleventh.body.error).toBe(limits.POOL_LIMIT_WORDS.heldCap(10));
    } finally {
      Object.assign(billing.RESERVE_INLINE, was);
    }
  });

  it("a run cancelled while it waits for the service gives back any hold a try at the press made, by its request id", async () => {
    const was = { ...billing.RESERVE_INLINE };
    try {
      billing.RESERVE_INLINE.ms = 100;
      const a = account();
      await check(a.cookie);
      fake.down = "error";
      const r = await press(a.cookie);
      expect(r.body.held).toEqual({ reason: "service" });
      const requestId = heldOf(idOf(r))!.request_id!;
      await cancelGeneration(idOf(r));
      expect(heldOf(idOf(r))).toBeUndefined();
      const out = db().prepare("SELECT kind, payload_json FROM billing_outbox WHERE key = ?").get(`release:request:${requestId}`) as { kind: string; payload_json: string } | undefined;
      expect(out?.kind).toBe("release");
      expect(JSON.parse(out!.payload_json)).toEqual({ requestId, reason: "not-created" });
    } finally {
      Object.assign(billing.RESERVE_INLINE, was);
    }
  });

  it("the owner's admin log says when runs have waited over 5 minutes for the service (counts only, one row for every app process); a wait for a time or a pause doesn't count", async () => {
    const was = { ...billing.RESERVE_INLINE };
    try {
      billing.RESERVE_INLINE.ms = 100;
      db().prepare("DELETE FROM admin_audit WHERE action = ?").run(release.SERVICE_WAIT_ACTION);
      const said = () => db().prepare("SELECT actor, target, detail_json FROM admin_audit WHERE action = ?").all(release.SERVICE_WAIT_ACTION) as { actor: string; target: string | null; detail_json: string }[];
      const a = account();
      await check(a.cookie);
      fake.down = "error";
      const r = await press(a.cookie);
      expect(r.body.held).toEqual({ reason: "service" });
      const run = heldOf(idOf(r))!.run_id;
      // Pressed six minutes ago, but waiting for a time (free generations that renew in an hour): not a quiet service.
      db().prepare("UPDATE pool_holds SET pressed_at = ?, start_at = ? WHERE run_id = ?").run(Date.now() - 6 * 60_000, Date.now() + 60 * 60_000, run);
      globalThis.__fuobeHoldServiceSaid = undefined;
      await release.releaseHeldRuns();
      expect(said()).toEqual([]);
      // Waiting because the service said runs are paused (the owner's own switch): not counted either.
      db().prepare("UPDATE pool_holds SET start_at = NULL, paused = 1 WHERE run_id = ?").run(run);
      await release.releaseHeldRuns();
      expect(said()).toEqual([]);
      // Six minutes with no answer from the billing service: one row, counts only.
      db().prepare("UPDATE pool_holds SET paused = 0, next_at = NULL WHERE run_id = ?").run(run);
      await release.releaseHeldRuns();
      const rows = said();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actor: "system", target: null });
      expect(JSON.parse(rows[0].detail_json)).toEqual({ waiting: 1, billing: 1, moderation: 0, oldestMin: 6 });
      expect(rows[0].detail_json).not.toContain(a.id);
      expect(rows[0].detail_json).not.toContain(IMAGE.prompt);
      // A second app process says it in its own server log, but the admin log keeps the one row.
      globalThis.__fuobeHoldServiceSaid = undefined;
      await release.releaseHeldRuns();
      expect(said()).toHaveLength(1);
    } finally {
      Object.assign(billing.RESERVE_INLINE, was);
    }
  });

  it("H3p: while the service says runs here are paused, a press is taken and waits ('starts automatically')", async () => {
    fake.refuse = { code: "paused", text: "Runs on our GPUs are paused for now. Your own GPU or key still works." };
    const a = account();
    const r = await press(a.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.held).toEqual({ reason: "service" });
    expect(tile(idOf(r))).toBe("Warming up · starts automatically");
    fake.refuse = null;
    expect(await until(() => taskOf(idOf(r)))).toBeTruthy();
  });

  it("a refusal once the service answers ends the run in plain words", async () => {
    const was = { ...billing.RESERVE_INLINE };
    try {
      billing.RESERVE_INLINE.ms = 200;
      const a = account();
      await check(a.cookie);
      fake.down = "error";
      const r = await press(a.cookie);
      expect(r.body.held).toEqual({ reason: "service" });
      fake.down = false;
      fake.refuse = { code: "closed", text: "Your account can't run on our GPUs right now. Your own GPU or key still works." };
      await until(() => getGeneration(idOf(r))!.status === "failed");
      expect(getGeneration(idOf(r))!.error).toBe("That one didn't come out right — try again, or try a similar model.");
      expect(heldOf(idOf(r))).toBeUndefined();
    } finally {
      Object.assign(billing.RESERVE_INLINE, was);
    }
  });

  it("a policy without `held` (an older service): the press while it is down is refused as before", async () => {
    process.env.FUOBE_BILLING_URL = fake.url;
    process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
    fake.policy = { ...FAKE_POLICY, ttlS: 0 };
    billing.resetBillingCache();
    const wasRetry = { ...billing.RESERVE_RETRY };
    try {
      Object.assign(billing.RESERVE_RETRY, { forMs: 600, firstMs: 100 });
      const a = account();
      await check(a.cookie);
      fake.down = "error";
      const r = await press(a.cookie);
      expect(r.status).toBe(503);
      expect(r.body.error).toBe(billing.BILLING_WAIT.run);
    } finally {
      Object.assign(billing.RESERVE_RETRY, wasRetry);
    }
  });
});

describe("a deploy or crash between a run's row and its GPU task (C5, A18)", () => {
  it("the row waits in line again at its press-time place instead of failing, and its GPU task is made", async () => {
    const a = account();
    const made = await press(a.cookie);
    const src = db().prepare("SELECT * FROM generations WHERE id = ?").get(idOf(made)) as Record<string, unknown>;
    await cancelGeneration(idOf(made));
    // A row made three minutes ago whose GPU task never came (the app stopped in between).
    const id = `cut-${++n}`;
    const at = Date.now() - 3 * 60_000;
    db()
      .prepare(
        `INSERT INTO generations (id, batch_id, feature, preset_id, model_id, engine, provider, op, kind, status, progress, message, prompt, request_json, outputs_json, cost_usd, favorite, created_at, updated_at)
         VALUES (@id, NULL, @feature, NULL, @model_id, @engine, @provider, @op, @kind, 'queued', NULL, 'Submitting', @prompt, @request_json, '[]', NULL, 0, @at, @at)`,
      )
      .run({ ...src, id, at });
    const t = await until(() => taskOf(id));
    expect(t, JSON.stringify(getGeneration(id))).toBeTruthy();
    expect(getGeneration(id)!.status).not.toBe("failed");
    expect(t!.rank_at).toBeLessThanOrEqual(at);
  });

  it("a GPU task made for the row whose id never reached it is never sent twice: the row ends, and that task stops", async () => {
    const a = account();
    const made = await press(a.cookie);
    const first = await until(() => taskOf(idOf(made)));
    const src = db().prepare("SELECT * FROM generations WHERE id = ?").get(idOf(made)) as Record<string, unknown>;
    await cancelGeneration(idOf(made));
    const id = `cut-${++n}`;
    const at = Date.now() - 3 * 60_000;
    // Its row and a waiting GPU task for it, but the row never got the task's id (the app stopped in between).
    const orphan = `orphan${String(++n).padStart(10, "0")}`;
    const d = db();
    d.transaction(() => {
      d.prepare(
        `INSERT INTO generations (id, batch_id, feature, preset_id, model_id, engine, provider, op, kind, status, progress, message, prompt, request_json, outputs_json, cost_usd, favorite, created_at, updated_at)
         VALUES (@id, NULL, @feature, NULL, @model_id, @engine, @provider, @op, @kind, 'queued', NULL, 'Submitting', @prompt, @request_json, '[]', NULL, 0, @at, @at)`,
      ).run({ ...src, id, at });
      d.exec("CREATE TEMP TABLE orphan_task AS SELECT * FROM relay_tasks WHERE 0");
      d.prepare("INSERT INTO orphan_task SELECT * FROM relay_tasks WHERE id = ?").run(first!.id);
      d.prepare("UPDATE orphan_task SET id = ?, generation_id = ?, state = 'waiting', created_at = ?, rank_at = ?").run(orphan, id, at, at);
      d.exec("INSERT INTO relay_tasks SELECT * FROM orphan_task; DROP TABLE orphan_task");
    })();
    // (A worker may have taken that task already: the row is never sent again, as for any run on the workers.)
    const status = () => (d.prepare("SELECT status FROM generations WHERE id = ?").get(id) as { status: string }).status;
    expect(await until(() => status() === "failed"), "the row ends").toBe(true);
    expect((d.prepare("SELECT state FROM relay_tasks WHERE id = ?").get(orphan) as { state: string }).state).toBe("canceled");
    const fresh = d.prepare("SELECT id FROM relay_tasks WHERE generation_id = ? AND id != ?").get(id, orphan) as { id: string } | undefined;
    expect(fresh, "no second GPU task for the row").toBeUndefined();
  });
});

describe("two app processes and a restart", () => {
  it("a run another process is releasing is left to it until its lease ends; holds survive a restart", async () => {
    const a = account();
    const [one] = [await press(a.cookie), await press(a.cookie)];
    const third = await press(a.cookie);
    const run = heldOf(idOf(third))!.run_id;
    db().prepare("UPDATE pool_holds SET holder = 'other:1', lease_until = ? WHERE run_id = ?").run(Date.now() + 60_000, run);
    await stop([idOf(one)]);
    expect(await release.releaseHeldRuns()).toBe(0);
    expect(taskOf(idOf(third))).toBeUndefined();
    // That process stopped: its lease ends, and this one (a new process after a restart) releases it.
    db().prepare("UPDATE pool_holds SET lease_until = ? WHERE run_id = ?").run(Date.now() - 1, run);
    globalThis.__fuobeLeaseToken = undefined;
    expect(await release.releaseHeldRuns()).toBe(1);
    expect(await until(() => taskOf(idOf(third)))).toBeTruthy();
    // Released once: a second turn finds nothing to release.
    expect(await release.releaseHeldRuns()).toBe(0);
  });
});

describe("the studio's own limit of runs at once, while hosted runs are on (C6)", () => {
  it("counts runs on the account's own GPU or key and its light work, never its other runs on this install's GPUs", () => {
    const a = account();
    const row = (id: string, extra: Record<string, unknown>) =>
      db()
        .prepare(
          `INSERT INTO generations (id, batch_id, feature, preset_id, model_id, engine, provider, op, kind, status, progress, message, prompt, request_json, outputs_json, cost_usd, favorite, created_at, updated_at)
           VALUES (?, NULL, 'image', NULL, 'oss-z-image-turbo', 'open', 'comfyui', 'generate', 'image', 'queued', NULL, NULL, 'a fox', ?, '[]', NULL, 0, ?, ?)`,
        )
        .run(id, JSON.stringify({ ...IMAGE, account: a.id, ...extra }), Date.now(), Date.now());
    row(`own-${++n}`, {});
    row(`site-${++n}`, { place: "pool" });
    row(`site-${++n}`, { place: "pool" });
    row(`light-${++n}`, { place: "pool", light: true });
    expect(limits.ownActiveRuns(a.id)).toBe(2);
    expect(limits.accountActiveRuns(a.id)).toBe(4);
  });
});

describe("hold shapes", () => {
  it("the account's own limits enter at the back; the system's keep the press; the service reserves later", () => {
    expect(holds.holdShape({})).toBeNull();
    expect(holds.holdShape({ limit: { reason: "mine" } })).toMatchObject({ reason: "mine", rankRule: "release", reserved: true, checked: true });
    expect(holds.holdShape({ wait: { reason: "today", startAt: 86_400_000 } })).toMatchObject({ reason: "today", rankRule: "press", reserved: true, startAt: 86_400_000 });
    expect(holds.holdShape({ wait: { reason: "service", requestId: "r_1" } })).toMatchObject({ reason: "service", rankRule: "press", reserved: false, requestId: "r_1" });
    expect(holds.holdShape({ limit: { reason: "mine" }, wait: { reason: "today", startAt: 86_400_000 } })).toMatchObject({ reason: "today", rankRule: "release" });
    expect(holds.holdShape({ unchecked: true })).toMatchObject({ reason: "service", checked: false, reserved: true });
    expect(holds.startReason(2 * 86_400_000)).toBe("today");
    expect(holds.startReason(2 * 86_400_000 + 60_000)).toBe("hour");
  });
});

describe("review fixes: holds that stay held, a cold service, and hosted runs switched off", () => {
  it("a held run whose row waits on an earlier result stays unsent until it is released", async () => {
    const a = account();
    const [one, two] = [await press(a.cookie), await press(a.cookie)];
    const third = await press(a.cookie);
    expect(third.body.held).toEqual({ reason: "mine" });
    const id = idOf(third);
    // An earlier result it waits on, already done (a film's shots after its board).
    const done = `done-${++n}`;
    db()
      .prepare(
        `INSERT INTO generations (id, batch_id, feature, preset_id, model_id, engine, provider, op, kind, status, progress, message, prompt, request_json, outputs_json, cost_usd, favorite, created_at, updated_at)
         SELECT ?, NULL, feature, preset_id, model_id, engine, provider, op, kind, 'succeeded', NULL, NULL, prompt, request_json, '[]', NULL, 0, created_at, updated_at FROM generations WHERE id = ?`,
      )
      .run(done, idOf(one));
    db().prepare("UPDATE generations SET depends_on = ? WHERE id = ?").run(JSON.stringify([done]), id);
    for (let i = 0; i < 5; i++) await tick();
    expect(taskOf(id)).toBeUndefined();
    expect(getGeneration(id)!.status).toBe("queued");
    expect(heldOf(id)).toBeTruthy();
    // Room opens: it enters the line then.
    await stop([idOf(one), idOf(two)]);
    expect(await until(() => taskOf(id))).toBeTruthy();
  });

  it("the step that takes a run counts the account's room again: no room, it stays held", async () => {
    const a = account();
    await press(a.cookie);
    await press(a.cookie);
    const third = await press(a.cookie);
    const run = heldOf(idOf(third))!.run_id;
    expect(holds.leaseRun(run)).toBe(true);
    try {
      expect(holds.takeRun(run, Date.now(), () => false)).toBeNull();
      expect(heldOf(idOf(third))).toBeTruthy();
    } finally {
      holds.endRunLease(run);
    }
  });

  it("A3 cold: after a restart while the service is down, a press is held for it (its last answer kept), and Run stays on", async () => {
    const a = account();
    // The service answered once; then the app restarts (nothing in memory) and the service stops.
    expect((await check(a.cookie)).status).toBe(200);
    billing.resetBillingCache();
    fake.down = "error";
    const quiet = await check(a.cookie);
    expect(quiet.body.quote?.allowed, JSON.stringify(quiet.body)).not.toBe(false);
    const r = await press(a.cookie);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.held).toEqual({ reason: "service" });
    fake.down = false;
    expect(await until(() => taskOf(idOf(r)))).toBeTruthy();
  });

  it("hosted runs switched off while runs wait: they end in today's words and their holds go", async () => {
    const a = account();
    await press(a.cookie);
    await press(a.cookie);
    const third = await press(a.cookie);
    const id = idOf(third);
    expect(heldOf(id)).toBeTruthy();
    delete process.env.FUOBE_HOSTED_RUNS;
    try {
      await tick();
      const g = db().prepare("SELECT status, error FROM generations WHERE id = ?").get(id);
      expect(g).toEqual({ status: "failed", error: "This run stopped before it started. Press Retry." });
      expect(heldOf(id)).toBeUndefined();
      expect(holds.anyHeld()).toBe(false);
    } finally {
      process.env.FUOBE_HOSTED_RUNS = "1";
    }
  });
});
