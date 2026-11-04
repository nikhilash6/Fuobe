import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * Pool worker tokens: a lifetime (FUOBE_WORKER_TOKEN_DAYS, off by default) with the next token in the beat answer, the
 * old token stopping at the new one's first use; and alerts in the admin log when a token is used from a new country, a
 * new network, or two networks at once. The admin log and the worker's row never hold an address.
 */

const dir = tempDir("fuobe-worker-tokens-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://127.0.0.1:7";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_WORKER_TOKEN_DAYS;
delete process.env.FUOBE_TRUST_PROXY;

const { db } = await import("@/server/db");
const { setSetting } = await import("@/server/settings");
const pool = await import("@/server/computer/pool");
const workers = await import("@/server/computer/workers");
const { callNetwork } = await import("@/server/computer/http");

const DAY = 24 * 60 * 60_000;
const MIN = 60_000;
let n = 0;

beforeAll(() => setSetting("comfyWhere", "workers"));
afterEach(() => {
  delete process.env.FUOBE_WORKER_TOKEN_DAYS;
  delete process.env.FUOBE_TRUST_PROXY;
});

const row = (id: string) => workers.getWorker(id)!;
const bearer = (token: string) => `Bearer ${token}`;
const beat = (id: string, protocol: number, now: number) =>
  pool.workerBeat(row(id), pool.cleanBeat({ device: `wkr-${id}`, protocol, version: "2.0.0", local: { paused: true, why: "here", until: null }, gpu: {}, inventoryHash: null, running: [], stopped: [] }), now);
const alerts = (id: string) =>
  (db().prepare("SELECT actor, target, detail_json FROM admin_audit WHERE action = 'worker.alert' AND target = ? ORDER BY id").all(id) as { actor: string; target: string; detail_json: string }[]).map(
    (r) => ({ actor: r.actor, ...(JSON.parse(r.detail_json) as { kind: string } & Record<string, unknown>) }),
  );

describe("a pool worker's token lifetime", () => {
  it("off by default: no expiry, and no next token in any beat answer", () => {
    const w = pool.addWorker(`no-expiry-${++n}`);
    expect(row(w.id).expires_at).toBeNull();
    expect(beat(w.id, 2, Date.now() + 400 * DAY).worker.token).toBeUndefined();
  });

  it("with a lifetime: the next token once half is gone, to a worker that speaks protocol 2; the old one stops at its first use", () => {
    process.env.FUOBE_WORKER_TOKEN_DAYS = "10";
    const t0 = Date.now();
    const w = workers.createWorker({ name: `expiring-${++n}`, kind: "pool" }, t0);
    expect(row(w.id).expires_at).toBe(t0 + 10 * DAY);
    // More than half left: nothing yet. A worker on protocol 1 never gets one.
    expect(beat(w.id, 2, t0 + 4 * DAY).worker.token).toBeUndefined();
    expect(beat(w.id, 1, t0 + 6 * DAY).worker.token).toBeUndefined();
    const offered = beat(w.id, 2, t0 + 6 * DAY).worker.token!;
    expect(offered.value).toMatch(/^fuobe_wkr_[A-Za-z0-9_-]{43}$/);
    expect(offered.expiresAt).toBe(t0 + 16 * DAY);
    expect(JSON.stringify(row(w.id))).not.toContain(offered.value);
    // Not offered again while it waits for its first use (within 10 minutes).
    expect(beat(w.id, 2, t0 + 6 * DAY + MIN).worker.token).toBeUndefined();
    // The old token still works until the new one is used.
    expect(workers.workerFromAuth(bearer(w.token), null, t0 + 6 * DAY + 2 * MIN)?.id).toBe(w.id);
    expect(workers.workerFromAuth(bearer(offered.value), null, t0 + 6 * DAY + 3 * MIN)?.id).toBe(w.id);
    expect(workers.workerFromAuth(bearer(w.token), null, t0 + 6 * DAY + 4 * MIN)).toBeNull();
    expect(row(w.id).expires_at).toBe(t0 + 16 * DAY);
    expect(row(w.id).next_token_hash).toBeNull();
    // Past its expiry a token stops.
    expect(workers.workerFromAuth(bearer(offered.value), null, t0 + 16 * DAY + 1)).toBeNull();
  });

  it("a next token never used is offered again after 10 minutes, and the first one then doesn't work", () => {
    process.env.FUOBE_WORKER_TOKEN_DAYS = "2";
    const t0 = Date.now();
    const w = workers.createWorker({ name: `lost-answer-${++n}`, kind: "pool" }, t0);
    const first = beat(w.id, 2, t0 + 1.5 * DAY).worker.token!;
    const second = beat(w.id, 2, t0 + 1.5 * DAY + 11 * MIN).worker.token!;
    expect(second.value).not.toBe(first.value);
    expect(workers.workerFromAuth(bearer(first.value), null, t0 + 1.5 * DAY + 12 * MIN)).toBeNull();
    expect(workers.workerFromAuth(bearer(second.value), null, t0 + 1.5 * DAY + 12 * MIN)?.id).toBe(w.id);
  });

  it("the owner's new token for a worker drops a next token waiting, and starts a new lifetime", () => {
    process.env.FUOBE_WORKER_TOKEN_DAYS = "2";
    const t0 = Date.now();
    const w = workers.createWorker({ name: `rotated-${++n}`, kind: "pool" }, t0);
    const waiting = beat(w.id, 2, t0 + 1.5 * DAY).worker.token!;
    const fresh = workers.rotateWorker(w.id, t0 + 1.5 * DAY + MIN)!;
    expect(workers.workerFromAuth(bearer(waiting.value), null, t0 + 1.5 * DAY + 2 * MIN)).toBeNull();
    expect(workers.workerFromAuth(bearer(fresh), null, t0 + 1.5 * DAY + 2 * MIN)?.id).toBe(w.id);
    expect(row(w.id).expires_at).toBe(t0 + 1.5 * DAY + MIN + 2 * DAY);
  });

  it("a person's paired ComfyUI keeps its token as before", () => {
    process.env.FUOBE_WORKER_TOKEN_DAYS = "1";
    const p = workers.createWorker({ name: `paired-${++n}`, kind: "personal", principal: "owner" });
    expect(row(p.id).expires_at).toBeNull();
    expect(workers.offerNextToken(row(p.id), Date.now() + 400 * DAY)).toBeNull();
  });
});

describe("where a pool worker's token is used from", () => {
  it("a new country and a new network are alerts; the first use and the same place again are not", () => {
    const w = pool.addWorker(`places-${++n}`);
    const t0 = Date.now();
    workers.workerFromAuth(bearer(w.token), { country: "IN", network: "203.0.113.0/24" }, t0);
    workers.workerFromAuth(bearer(w.token), { country: "IN", network: "203.0.113.0/24" }, t0 + 60 * MIN);
    expect(alerts(w.id)).toEqual([]);
    workers.workerFromAuth(bearer(w.token), { country: "US", network: "203.0.113.0/24" }, t0 + 120 * MIN);
    workers.workerFromAuth(bearer(w.token), { country: "US", network: "198.51.100.0/24" }, t0 + 180 * MIN);
    const got = alerts(w.id);
    expect(got.map((a) => a.kind)).toEqual(["new-country", "new-network"]);
    expect(got.every((a) => a.actor === "system")).toBe(true);
    expect(got[0]).toMatchObject({ country: "US", known: ["IN"] });
    // Never an address: networks are short hashes, in the log and on the worker's row.
    const kept = JSON.stringify(got) + JSON.stringify(row(w.id));
    expect(kept).not.toContain("203.0.113");
    expect(kept).not.toContain("198.51.100");
  });

  it("two networks within minutes of each other are an alert, once an hour", () => {
    const w = pool.addWorker(`two-${++n}`);
    const t0 = Date.now();
    workers.workerFromAuth(bearer(w.token), { network: "192.0.2.0/24" }, t0);
    workers.workerFromAuth(bearer(w.token), { network: "198.18.0.0/24" }, t0 + MIN);
    workers.workerFromAuth(bearer(w.token), { network: "192.0.2.0/24" }, t0 + 2 * MIN);
    workers.workerFromAuth(bearer(w.token), { network: "198.18.0.0/24" }, t0 + 3 * MIN);
    expect(alerts(w.id).filter((a) => a.kind === "two-sources")).toHaveLength(1);
  });

  it("the network is read only behind a trusted proxy: an IPv4 address's /24", () => {
    const req = new Request("http://localhost/api/gpu/computer/beat", { headers: { "x-forwarded-for": "203.0.113.9" } });
    expect(callNetwork(req)).toBeNull();
    process.env.FUOBE_TRUST_PROXY = "1";
    expect(callNetwork(req)).toBe("203.0.113.0/24");
    expect(callNetwork(new Request("http://localhost/", { headers: { "x-forwarded-for": "2001:db8:1:2:3:4:5:6" } }))).toBe("2001:db8:1:2::/64");
  });
});
