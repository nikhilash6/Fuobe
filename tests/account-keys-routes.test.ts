import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { keysSeen, startFakeFal, startFakeReplicate, type FakeCloud } from "./helpers/fake-cloud";

/**
 * Settings → Your keys, the routes: an account adds, checks, replaces and removes its own fal.ai key or Replicate token.
 * A key is checked with the provider (the typed key only, never another) before it is saved, and no answer, list or
 * export ever holds a key or its sealed value. Removing or replacing a key that runs are going on asks first, then
 * stops them with the old key.
 */
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("next/headers", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/headers")>()), cookies: async () => ({ delete: () => {}, get: () => undefined }) }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-keys-routes-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ENGINE_MODE;
process.env.FAL_KEY = "owner-fal-env";
process.env.REPLICATE_API_TOKEN = "owner-rep-env";
globalThis.__fuobeTestDiskFree = 1e13;

const auth = await import("@/server/auth");
const keysRoute = await import("@/app/api/account/keys/route");
const keyRoute = await import("@/app/api/account/keys/[provider]/route");
const generationsRoute = await import("@/app/api/generations/route");
const adminRoute = await import("@/app/api/admin/accounts/route");
const meRoute = await import("@/app/api/auth/me/route");
const statusRoute = await import("@/app/api/status/route");
const modelsRoute = await import("@/app/api/models/route");
const { proxy } = await import("@/proxy");
const { setSetting } = await import("@/server/settings");
const { resetRates } = await import("@/server/rate");
const { db } = await import("@/server/db");
const { accountMayChange, accountOwnRead } = await import("@/lib/guest-access");

const GOOD_FAL = "acct-key-id-7d1e:acct-key-secret-3f9a";
const NEW_FAL = "acct-key-id-8e2f:acct-key-secret-4c0b";
const BAD_FAL = "wrong-key-id-0000:wrong-key-secret-0000";
const GOOD_REP = "r8_accountReplicateToken5c21";

let fal: FakeCloud;
let rep: FakeCloud;
let A = "";
let cookie = "";
beforeAll(async () => {
  fal = await startFakeFal();
  rep = await startFakeReplicate();
  globalThis.__fuobeTestFalUrl = fal.url;
  globalThis.__fuobeTestReplicateUrl = rep.url;
  for (const k of [GOOD_FAL, NEW_FAL, "owner-fal-db", "owner-fal-env"]) fal.keys[k] = "good";
  for (const k of [GOOD_REP, "owner-rep-db", "owner-rep-env"]) rep.keys[k] = "good";
  fal.keys["outage-key-id-1111:outage-secret-1111"] = "outage";
  setSetting("falKey", "owner-fal-db");
  setSetting("replicateToken", "owner-rep-db");
  auth.setPassword("install password");
  A = auth.createAccount("routes-a@example.com", "long enough").id;
  cookie = `${auth.SESSION_COOKIE}=${auth.createSession(A).value}`;
});
afterAll(async () => {
  globalThis.__fuobeTestFalUrl = undefined;
  globalThis.__fuobeTestReplicateUrl = undefined;
  globalThis.__fuobeTestDiskFree = undefined;
  await fal.close();
  await rep.close();
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});
beforeEach(() => {
  resetRates();
  fal.log.length = 0;
  rep.log.length = 0;
  fal.pollsToFinish = 2;
});

const ctx = (provider: string) => ({ params: Promise.resolve({ provider }) });
const req = (url: string, method: string, body?: unknown, who = cookie) =>
  new Request(`http://localhost:3000${url}`, { method, headers: { cookie: who, host: "localhost:3000", "content-type": "application/json" }, ...(body !== undefined && { body: JSON.stringify(body) }) });
const put = (provider: string, body: unknown, q = "", who = cookie) => keyRoute.PUT(req(`/api/account/keys/${provider}${q}`, "PUT", body, who), ctx(provider));
const del = (provider: string, body?: unknown) => keyRoute.DELETE(req(`/api/account/keys/${provider}`, "DELETE", body), ctx(provider));
const get = async () => (await keysRoute.GET(req("/api/account/keys", "GET"))).json();
const ownerCookie = () => `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
/** Everything the account, the owner and their browsers can read, as text. */
async function everythingReadable(): Promise<string> {
  const texts = [
    JSON.stringify(await get()),
    await (await meRoute.GET(req("/api/auth/me", "GET"))).text(),
    await (await statusRoute.GET(req("/api/status", "GET"))).text(),
    await (await modelsRoute.GET(req("/api/models?kind=image", "GET"))).text(),
    await (await adminRoute.GET(req("/api/admin/accounts", "GET", undefined, ownerCookie()))).text(),
    await (await adminRoute.GET(req("/api/admin/accounts?format=csv", "GET", undefined, ownerCookie()))).text(),
    JSON.stringify(auth.listAccounts()),
  ];
  return texts.join("\n");
}
const dataFiles = () =>
  fs
    .readdirSync(dir, { recursive: true })
    .map((f) => path.join(dir, String(f)))
    .filter((f) => fs.statSync(f).isFile())
    .map((f) => ({ f, text: fs.readFileSync(f).toString("latin1") }));

describe("adding a key", () => {
  it("refuses a key the provider rejects, says how to fix it, saves nothing and never repeats the key", async () => {
    const r = await put("fal", { key: BAD_FAL });
    expect(r.status).toBe(422);
    const text = await r.text();
    expect(JSON.parse(text).error).toBe("fal.ai didn't accept this key. Copy it again from fal.ai's API keys page.");
    expect(text).not.toContain("wrong-key");
    // A key that doesn't look like one gets the format hint too.
    const half = await put("fal", { key: "fal_only_one_half" });
    expect((await half.json()).error).toMatch(/key_id:key_secret/);
    // The check sent the typed key, and only that key, to fal.ai.
    expect(keysSeen(fal.log)).toEqual([`Key ${BAD_FAL}`, "Key fal_only_one_half"]);
    expect((await get()).keys.fal).toBeNull();
  });

  it("says when the provider can't be reached or answers oddly", async () => {
    const odd = await put("fal", { key: "outage-key-id-1111:outage-secret-1111" });
    // 503, not 502: a proxy in front (Cloudflare) swaps an origin's 502 for its own page, and the words are lost.
    expect(odd.status).toBe(503);
    expect((await odd.json()).error).toBe("fal.ai answered 503, so the key couldn't be checked. Try again in a moment.");
    globalThis.__fuobeTestFalUrl = "http://127.0.0.1:9";
    try {
      const down = await put("fal", { key: GOOD_FAL });
      expect(down.status).toBe(503);
      expect((await down.json()).error).toBe("Couldn't reach fal.ai to check the key, so it wasn't saved. Try again in a moment.");
    } finally {
      globalThis.__fuobeTestFalUrl = fal.url;
    }
    expect((await get()).keys.fal).toBeNull();
  });

  it("checks only, with ?test=1", async () => {
    const r = await put("fal", { key: GOOD_FAL }, "?test=1");
    expect(await r.json()).toEqual({ provider: "fal", ok: true, detail: "Key accepted" });
    // fal.ai's status path without the endpoint's sub-path (with it, fal.ai answers 405 to every key).
    expect(fal.log.at(-1)?.path).toBe("/fal-ai/flux/requests/00000000-0000-0000-0000-000000000000/status");
    expect((await get()).keys.fal).toBeNull();
  });

  it("saves a key the provider accepts, answers with its last 4 characters only", async () => {
    const r = await put("fal", { key: `  ${GOOD_FAL} ` });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(JSON.parse(text)).toEqual({ provider: "fal", last4: "3f9a", addedAt: expect.any(Number), readable: true, detail: "Key accepted" });
    expect(text).not.toContain("acct-key");
    const rr = await put("replicate", { key: GOOD_REP });
    expect(await rr.json()).toMatchObject({ provider: "replicate", last4: "5c21", detail: "Signed in as alice" });
    expect(await get()).toEqual({
      keys: { fal: { last4: "3f9a", addedAt: expect.any(Number), readable: true }, replicate: { last4: "5c21", addedAt: expect.any(Number), readable: true } },
      engineMode: "both",
      paidAllowed: true,
      // A new account keeps 1 GB in its first week: the line says so (never "3 GB" alone).
      limits: "4 runs at once, 60 an hour, up to 4 pictures a run, 1 GB of files in your first week, then 3 GB",
    });
  });

  it("never shows the key or its sealed value anywhere: answers, lists, exports, status, models, files", async () => {
    const sealed = auth.accountKeyRecord(A, "fal")!.sealed;
    const all = await everythingReadable();
    for (const secret of [GOOD_FAL, "acct-key-id-7d1e", "acct-key-secret-3f9a", GOOD_REP, sealed, "owner-fal-db", "owner-rep-db"]) expect(all).not.toContain(secret);
    expect(all).toContain('"keys":["fal","replicate"]');
    expect(all).toMatch(/routes-a@example\.com,[^,]+,[^,]+,false,true,true,false/);
    for (const { f, text } of dataFiles()) for (const secret of [GOOD_FAL, "acct-key-secret-3f9a", GOOD_REP]) expect(text.includes(secret), f).toBe(false);
  });

  it("allows 10 checks a minute per account", async () => {
    resetRates();
    for (let i = 0; i < 10; i++) await put("fal", { key: GOOD_FAL }, "?test=1");
    const r = await put("fal", { key: GOOD_FAL }, "?test=1");
    expect(r.status).toBe(429);
    expect((await r.json()).error).toBe("Too many checks. Wait a minute.");
  });
});

describe("who may use the routes", () => {
  it("the owner is told where the studio's keys are; an unknown provider is 404", async () => {
    const owner = await put("fal", { key: GOOD_FAL }, "", ownerCookie());
    expect(owner.status).toBe(400);
    expect((await owner.json()).error).toMatch(/Settings → Paid API configuration/);
    expect((await put("openai", { key: GOOD_FAL })).status).toBe(404);
  });

  it("the proxy lets an account reach its own keys, and keeps guests out", async () => {
    expect(accountOwnRead("/api/account/keys")).toBe(true);
    for (const m of ["PUT", "DELETE"]) {
      expect(accountMayChange(m, "/api/account/keys/fal", "")).toBe(true);
      expect(accountMayChange(m, "/api/account/keys/replicate", "")).toBe(true);
      expect(accountMayChange(m, "/api/account/keys/openai", "")).toBe(false);
    }
    expect(accountMayChange("POST", "/api/account/keys/fal", "")).toBe(false);
    const at = (url: string, method: string, who?: string) => proxy(new NextRequest(`http://localhost:3000${url}`, { method, headers: who ? { cookie: who } : {}, ...(method !== "GET" && { body: "{}" }) }));
    const passed = (r: Response) => r.headers.get("x-middleware-next") === "1";
    expect(passed(at("/api/account/keys", "GET", cookie))).toBe(true);
    expect(passed(at("/api/account/keys/fal", "PUT", cookie))).toBe(true);
    expect(passed(at("/api/account/keys/fal", "DELETE", cookie))).toBe(true);
    expect(at("/api/account/keys/fal", "PUT").status).toBe(401);
    expect(at("/api/account/keys", "GET").status).toBe(401);
    // The studio's own key settings stay the owner's.
    expect(at("/api/settings", "PUT", cookie).status).toBe(403);
    expect(at("/api/providers/test", "POST", cookie).status).toBe(403);
  });
});

describe("replacing and removing a key with runs going on it", () => {
  const startRun = async () => {
    fal.pollsToFinish = Infinity;
    const text = JSON.stringify({ feature: "image", modelId: "nano-banana-pro", engine: "cloud", prompt: "a quiet harbour" });
    const r = await generationsRoute.POST(new Request("http://localhost:3000/api/generations", { method: "POST", headers: { cookie, host: "localhost:3000", "content-type": "application/json", "content-length": String(text.length) }, body: text }));
    expect(r.status).toBe(201);
    const id = (await r.json()).items[0].id as string;
    for (let i = 0; i < 100 && !db().prepare("SELECT external_id FROM generations WHERE id = ?").pluck().get(id); i++) await new Promise((r) => setTimeout(r, 10));
    return id;
  };
  const status = (id: string) => db().prepare("SELECT status FROM generations WHERE id = ?").pluck().get(id);

  it("replace: asks first, then stops the runs with the old key and saves the new one", async () => {
    const id = await startRun();
    const ask = await put("fal", { key: NEW_FAL });
    expect(ask.status).toBe(409);
    expect(await ask.json()).toEqual({ code: "runs-going", count: 1, error: "1 run is using this key now. Replacing it stops it." });
    expect(["queued", "running"]).toContain(status(id));
    fal.log.length = 0;
    const r = await put("fal", { key: NEW_FAL, stopRuns: true });
    expect(r.status).toBe(200);
    expect((await r.json()).last4).toBe("4c0b");
    expect(status(id)).toBe("canceled");
    const cancel = fal.log.find((x) => x.path.endsWith("/cancel"));
    expect(cancel?.authorization).toBe(`Key ${GOOD_FAL}`);
    expect(fal.log.indexOf(cancel!)).toBeGreaterThan(fal.log.findIndex((x) => x.authorization === `Key ${NEW_FAL}`));
  });

  it("remove: asks first, then stops the runs with the key, and the key is gone", async () => {
    const id = await startRun();
    const ask = await del("fal");
    expect(ask.status).toBe(409);
    expect((await ask.json()).error).toBe("1 run is using this key now. Removing it stops it.");
    fal.log.length = 0;
    const r = await del("fal", { stopRuns: true });
    expect(r.status).toBe(200);
    expect((await r.json()).keys.fal).toBeNull();
    expect(status(id)).toBe("canceled");
    expect(keysSeen(fal.log)).toEqual([`Key ${NEW_FAL}`]);
    expect(auth.accountKeyRecord(A, "fal")).toBeNull();
    // Nothing more reaches fal.ai for the account, and a paid run asks for the key again.
    fal.log.length = 0;
    await globalThis.__fuobeRunner?.tick();
    expect(fal.log).toEqual([]);
    const again = await generationsRoute.POST(req("/api/generations", "POST", { feature: "image", modelId: "nano-banana-2", engine: "cloud", prompt: "x" }));
    expect(again.status).toBe(403);
    expect(again.headers.get("x-fuobe-add-key")).toBe("fal");
  });
});

describe("a key that works on an empty balance", () => {
  it("is saved, with a note to top it up (fal.ai's 403 lock, Replicate's 402), never 'copy it again'", async () => {
    const id = auth.createAccount("routes-broke@example.com", "long enough").id;
    const who = `${auth.SESSION_COOKIE}=${auth.createSession(id).value}`;
    fal.keys["broke-key-id-5555:broke-key-secret-6a7b"] = "broke";
    rep.keys["r8_brokeToken8c9d"] = "broke";
    const f = await put("fal", { key: "broke-key-id-5555:broke-key-secret-6a7b" }, "", who);
    expect(f.status).toBe(200);
    expect(await f.json()).toMatchObject({
      provider: "fal",
      last4: "6a7b",
      note: "Your fal.ai key works, but your fal.ai balance is empty. Top it up on fal.ai before you run.",
    });
    const r = await put("replicate", { key: "r8_brokeToken8c9d" }, "", who);
    expect(r.status).toBe(200);
    expect((await r.json()).note).toBe("Your Replicate key works, but your Replicate balance is empty. Top it up on Replicate before you run.");
    const test = await put("fal", { key: "broke-key-id-5555:broke-key-secret-6a7b" }, "?test=1", who);
    expect(await test.json()).toMatchObject({ ok: true, note: expect.stringMatching(/balance is empty/) });
    const saved = (await keysRoute.GET(req("/api/account/keys", "GET", undefined, who)).then((x) => x.json())).keys;
    expect(saved.fal).toMatchObject({ last4: "6a7b", readable: true });
    expect(saved.replicate).toMatchObject({ last4: "8c9d", readable: true });
  });
});

describe("the check budget", () => {
  it("counts only checks that reach the provider: accounts sending junk never block another account's key", async () => {
    resetRates();
    const junkers = Array.from({ length: 13 }, (_, i) => `${auth.SESSION_COOKIE}=${auth.createSession(auth.createAccount(`junk-${i}@example.com`, "long enough").id).value}`);
    for (const who of junkers) for (let i = 0; i < 10; i++) expect((await put("fal", { key: "x" }, "", who)).status).toBe(400);
    expect(fal.log).toEqual([]);
    const r = await put("fal", { key: GOOD_FAL }, "?test=1");
    expect(r.status).toBe(200);
  });

  it("behind a trusted proxy, one address with many accounts can't use up every account's checks", async () => {
    resetRates();
    process.env.FUOBE_TRUST_PROXY = "1";
    try {
      const from = (ip: string, who: string) =>
        keyRoute.PUT(
          new Request("http://localhost:3000/api/account/keys/fal?test=1", { method: "PUT", headers: { cookie: who, host: "localhost:3000", "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify({ key: BAD_FAL }) }),
          ctx("fal"),
        );
      const many = Array.from({ length: 3 }, (_, i) => `${auth.SESSION_COOKIE}=${auth.createSession(auth.createAccount(`one-address-${i}@example.com`, "long enough").id).value}`);
      const answers: number[] = [];
      for (const who of many) for (let i = 0; i < 10; i++) answers.push((await from("203.0.113.7", who)).status);
      expect(answers.filter((s) => s === 422)).toHaveLength(20);
      expect(answers.filter((s) => s === 429)).toHaveLength(10);
      // Someone else, from another address, still gets their check.
      const other = await keyRoute.PUT(
        new Request("http://localhost:3000/api/account/keys/fal?test=1", { method: "PUT", headers: { cookie, host: "localhost:3000", "content-type": "application/json", "x-forwarded-for": "198.51.100.4" }, body: JSON.stringify({ key: GOOD_FAL }) }),
        ctx("fal"),
      );
      expect(other.status).toBe(200);
    } finally {
      delete process.env.FUOBE_TRUST_PROXY;
    }
  });
});

describe("a run still being handed over when its key goes", () => {
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 300 && !ok(); i++) await new Promise((r) => setTimeout(r, 10));
  };
  /** An account with a fal.ai key, and a paid run whose submit fal.ai holds (it has no external id yet). */
  const heldRun = async (email: string, k: string) => {
    const id = auth.createAccount(email, "long enough").id;
    const who = `${auth.SESSION_COOKIE}=${auth.createSession(id).value}`;
    fal.keys[k] = "good";
    expect((await put("fal", { key: k }, "", who)).status).toBe(200);
    fal.pollsToFinish = Infinity;
    fal.log.length = 0;
    fal.canceled.length = 0;
    let release!: () => void;
    fal.holdSubmits = new Promise<void>((r) => (release = r));
    const r = await generationsRoute.POST(req("/api/generations", "POST", { feature: "image", modelId: "nano-banana-pro", engine: "cloud", prompt: "a quiet harbour" }, who));
    expect(r.status).toBe(201);
    const run = (await r.json()).items[0].id as string;
    await until(() => fal.log.some((x) => x.method === "POST" && !x.path.startsWith("/storage")));
    expect(db().prepare("SELECT external_id FROM generations WHERE id = ?").pluck().get(run)).toBeNull();
    return { id, who, run, release };
  };
  const statusOf = (id: string) => db().prepare("SELECT status FROM generations WHERE id = ?").pluck().get(id);
  const cancelAuth = () => fal.log.filter((x) => x.path.endsWith("/cancel")).map((x) => x.authorization);

  it("removing it stops the job at fal.ai, with that key, when the submit lands", async () => {
    const k = "held-key-id-1111:held-key-secret-a1a1";
    const { id, who, run, release } = await heldRun("held-remove@example.com", k);
    const pending = keyRoute.DELETE(req("/api/account/keys/fal", "DELETE", { stopRuns: true }, who), ctx("fal"));
    await until(() => statusOf(run) === "canceled");
    // The key stays until the hand-over is over.
    await new Promise((r) => setTimeout(r, 50));
    expect(auth.accountKeyRecord(id, "fal")).not.toBeNull();
    release();
    fal.holdSubmits = null;
    expect((await pending).status).toBe(200);
    expect(fal.canceled).toHaveLength(1);
    expect(cancelAuth()).toEqual([`Key ${k}`]);
    expect(auth.accountKeyRecord(id, "fal")).toBeNull();
  });

  it("replacing it stops the job with the old key, never the new one", async () => {
    const k = "held-key-id-2222:held-key-secret-b2b2";
    const next = "held-key-id-3333:held-key-secret-c3c3";
    fal.keys[next] = "good";
    const { id, who, run, release } = await heldRun("held-replace@example.com", k);
    const pending = put("fal", { key: next, stopRuns: true }, "", who);
    await until(() => statusOf(run) === "canceled");
    release();
    fal.holdSubmits = null;
    const r = await pending;
    expect(r.status).toBe(200);
    expect((await r.json()).last4).toBe("c3c3");
    expect(fal.canceled).toHaveLength(1);
    expect(cancelAuth()).toEqual([`Key ${k}`]);
    expect(keysSeen(fal.log.filter((x) => x.path.endsWith("/cancel") || (x.method === "POST" && !x.path.startsWith("/storage"))))).toEqual([`Key ${k}`]);
    expect(auth.accountKeyRecord(id, "fal")?.last4).toBe("c3c3");
  });

  it("deleting the account stops the job with its key before the account and its keys go", async () => {
    const k = "held-key-id-4444:held-key-secret-d4d4";
    const { id, who, run, release } = await heldRun("held-delete@example.com", k);
    const pending = meRoute.DELETE(req("/api/auth/me", "DELETE", { password: "long enough" }, who));
    await until(() => statusOf(run) === undefined);
    await new Promise((r) => setTimeout(r, 50));
    expect(auth.accountById(id)).toBeDefined();
    release();
    fal.holdSubmits = null;
    expect((await pending).status).toBe(204);
    expect(fal.canceled).toHaveLength(1);
    expect(cancelAuth()).toEqual([`Key ${k}`]);
    expect(auth.accountById(id)).toBeUndefined();
  });
});
