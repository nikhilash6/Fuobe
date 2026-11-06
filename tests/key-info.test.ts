import fs from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi, type MockInstance } from "vitest";
import { NextRequest } from "next/server";
import { keysSeen, startFakeFal, startFakeReplicate, type FakeCloud } from "./helpers/fake-cloud";
import { tempDir } from "./helpers/temp-dir";

/**
 * Connected accounts (GET /api/key-info, src/server/provider-account-info.ts): what a saved fal.ai key or Replicate
 * token tells about its provider account. The owner gets the studio's keys, an account only its own, a guest nothing
 * and no provider is asked. The key never shows in an answer, a log line or an error, the provider is asked once a
 * minute at most (a refresh once every 10 s), and every answer the providers document maps to plain words. The provider
 * answers are their documented samples and recorded refusals (tests/fixtures/key-info).
 */
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-key-info-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_ENGINE_MODE;
delete process.env.FAL_KEY;
delete process.env.REPLICATE_API_TOKEN;

const auth = await import("@/server/auth");
const route = await import("@/app/api/key-info/route");
const { proxy } = await import("@/proxy");
const { setSetting } = await import("@/server/settings");
const { saveAccountKey, removeAccountKey, accountKeyInfo } = await import("@/server/account-keys");
const { KEY_INFO, clearKeyInfo, accountInfo } = await import("@/server/provider-account-info");
const { accountOwnRead } = await import("@/lib/guest-access");

const fixture = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/key-info", name), "utf8"));

const OWNER_FAL = "owner-key-id-1a2b:owner-key-secret-3c4d";
const OWNER_REP = "r8_ownerReplicateToken9f8e";
const A_FAL = "acct-a-key-id-5e6f:acct-a-key-secret-7a8b";
const A_REP = "r8_accountAReplicateToken1c2d";
const B_FAL = "acct-b-key-id-9c0d:acct-b-key-secret-1e2f";

let fal: FakeCloud;
let rep: FakeCloud;
let A = "";
let B = "";
let C = "";
let cookieA = "";
let cookieB = "";
let cookieC = "";
let ownerCookie = "";
beforeAll(async () => {
  fal = await startFakeFal();
  rep = await startFakeReplicate();
  globalThis.__fuobeTestFalUrl = fal.url;
  globalThis.__fuobeTestReplicateUrl = rep.url;
  fal.keys[OWNER_FAL] = "billing";
  fal.keys[A_FAL] = "good";
  fal.keys[B_FAL] = "good";
  rep.keys[OWNER_REP] = "good";
  rep.keys[A_REP] = "good";
  setSetting("falKey", OWNER_FAL);
  setSetting("replicateToken", OWNER_REP);
  auth.setPassword("install password");
  A = auth.createAccount("info-a@example.com", "long enough").id;
  B = auth.createAccount("info-b@example.com", "long enough").id;
  C = auth.createAccount("info-c@example.com", "long enough").id;
  saveAccountKey(A, "fal", A_FAL);
  saveAccountKey(A, "replicate", A_REP);
  saveAccountKey(B, "fal", B_FAL);
  cookieA = `${auth.SESSION_COOKIE}=${auth.createSession(A).value}`;
  cookieB = `${auth.SESSION_COOKIE}=${auth.createSession(B).value}`;
  cookieC = `${auth.SESSION_COOKIE}=${auth.createSession(C).value}`;
  ownerCookie = `${auth.SESSION_COOKIE}=${auth.createSession().value}`;
});
afterAll(async () => {
  globalThis.__fuobeTestFalUrl = undefined;
  globalThis.__fuobeTestReplicateUrl = undefined;
  await fal.close();
  await rep.close();
});
let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  clearKeyInfo();
  fal.log.length = 0;
  rep.log.length = 0;
  fal.script = null;
  rep.script = null;
  fal.hang = null;
  rep.hang = null;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  vi.useRealTimers();
});

const req = (who: string | null, q = "") =>
  new Request(`http://localhost:3000/api/key-info${q}`, { headers: { host: "localhost:3000", ...(who && { cookie: who }) } });
async function ask(who: string | null, q = "") {
  const res = await route.GET(req(who, q));
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text), cache: res.headers.get("cache-control") };
}
const billingCalls = (log: FakeCloud["log"]) => log.filter((r) => r.path.startsWith("/v1/account/billing")).length;
const everyKey = [OWNER_FAL, OWNER_REP, A_FAL, A_REP, B_FAL];
/** No key, and no half of a fal.ai key_id:key_secret, anywhere in `text`. */
function noKeyIn(text: string) {
  for (const k of everyKey) {
    expect(text).not.toContain(k);
    for (const half of k.split(":")) expect(text).not.toContain(half);
    expect(text).not.toContain(k.slice(-4));
  }
}
/** What was logged, one line per call, sorted (fal.ai and Replicate are asked side by side). */
const logged = () =>
  warn.mock.calls
    .map((c) => c.join(" "))
    .sort()
    .join("\n");

describe("who may ask", () => {
  it("refuses a guest before any key is read: the route and the proxy, and no provider is asked", async () => {
    const r = await ask(null);
    expect(r.status).toBe(401);
    expect(r.cache).toBe("no-store");
    expect(r.body.providers).toBeUndefined();
    const at = proxy(new NextRequest("http://localhost:3000/api/key-info", { headers: { host: "localhost:3000" } }));
    expect(at.status).toBe(401);
    expect(fal.log).toEqual([]);
    expect(rep.log).toEqual([]);
  });

  it("lets an account's read through the proxy (its own keys only, the route checks who)", () => {
    expect(accountOwnRead("/api/key-info")).toBe(true);
    const at = proxy(new NextRequest("http://localhost:3000/api/key-info", { headers: { host: "localhost:3000", cookie: cookieA } }));
    expect(at.headers.get("x-middleware-next")).toBe("1");
  });

  it("gives the owner the studio's keys: the balance and the account fal.ai's billing call returns", async () => {
    const r = await ask(ownerCookie);
    expect(r.status).toBe(200);
    expect(r.cache).toBe("no-store");
    const [f, p] = r.body.providers;
    expect(f).toMatchObject({ provider: "fal", state: "ok", balance: { amount: 24.5, currency: "USD" }, account: { name: "my-team" }, billingUrl: "https://fal.ai/dashboard/billing" });
    expect(f.spentThisMonth).toBeUndefined();
    expect(p).toMatchObject({ provider: "replicate", state: "link", account: { name: "alice", kind: "user" }, billingUrl: "https://replicate.com/account/billing" });
    expect(keysSeen(fal.log)).toEqual([`Key ${OWNER_FAL}`]);
    expect(keysSeen(rep.log)).toEqual([`Bearer ${OWNER_REP}`]);
    // A GET with the key in the header only: never in the address.
    for (const call of [...fal.log, ...rep.log]) {
      expect(call.method).toBe("GET");
      noKeyIn(call.path);
    }
    noKeyIn(r.text);
  });

  it("adds this month's spend for Settings (?detail=1), from fal.ai's usage summary", async () => {
    const r = await ask(ownerCookie, "?detail=1");
    expect(r.body.providers[0].spentThisMonth).toEqual({ amount: 0.32, currency: "USD" });
    const usage = fal.log.find((x) => x.path.startsWith("/v1/models/usage"))!;
    const q = new URL(usage.path, fal.url).searchParams;
    expect(q.get("expand")).toBe("summary");
    expect(q.get("start")).toMatch(/^\d{4}-\d{2}-01$/);
    // The menu's view never asks for it.
    fal.log.length = 0;
    await ask(ownerCookie);
    expect(fal.log.filter((x) => x.path.startsWith("/v1/models/usage"))).toEqual([]);
  });

  it("gives an account its own keys only, never the studio's or another account's", async () => {
    const a = await ask(cookieA);
    expect(a.status).toBe(200);
    // fal.ai's default API key may not read billing (403): the billing page link. Replicate: the account.
    expect(a.body.providers.map((x: { provider: string; state: string }) => [x.provider, x.state])).toEqual([
      ["fal", "link"],
      ["replicate", "link"],
    ]);
    expect(a.body.providers[0].balance).toBeUndefined();
    expect(keysSeen(fal.log)).toEqual([`Key ${A_FAL}`]);
    expect(keysSeen(rep.log)).toEqual([`Bearer ${A_REP}`]);
    noKeyIn(a.text);

    fal.log.length = 0;
    rep.log.length = 0;
    const b = await ask(cookieB);
    expect(b.body.providers.map((x: { provider: string }) => x.provider)).toEqual(["fal"]);
    expect(keysSeen(fal.log)).toEqual([`Key ${B_FAL}`]);
    expect(rep.log).toEqual([]);
    // Even though the studio's fal.ai key may read its balance, no account's answer ever holds it.
    expect(b.text).not.toContain("24.5");
    expect(b.text).not.toContain("my-team");
  });

  it("asks nothing for an account with no key, and nothing when the studio has paid models off", async () => {
    const c = await ask(cookieC);
    expect(c.body).toEqual({ providers: [] });
    expect(fal.log).toEqual([]);
    expect(rep.log).toEqual([]);
    setSetting("engineMode", "open");
    onTestFinished(() => setSetting("engineMode", "both"));
    const a = await ask(cookieA);
    expect(a.body).toEqual({ providers: [] });
    expect(fal.log).toEqual([]);
  });

  it("never sends the studio's key when an account's own key can't be opened or was removed", async () => {
    const D = auth.createAccount("info-d@example.com", "long enough").id;
    saveAccountKey(D, "fal", "acct-d-key-id-0000:acct-d-key-secret-0000");
    removeAccountKey(D, "fal");
    expect(accountKeyInfo(D).fal).toBeNull();
    expect(await accountInfo({ kind: "account", id: D }, "fal")).toBeNull();
    expect(fal.log).toEqual([]);
  });
});

describe("the key never shows", () => {
  it("not in the answer, a log line or an error, even when the provider's error repeats it", async () => {
    fal.script = (r) => (r.path.startsWith("/v1/account/billing") ? { status: 500, body: { detail: `upstream failed for ${r.authorization}` } } : null);
    rep.script = (r) => (r.path === "/v1/account" ? { status: 503, body: { detail: `bad gateway: ${r.authorization}` } } : null);
    const r = await ask(ownerCookie);
    expect(r.status).toBe(200);
    expect(r.body.providers.map((x: { state: string }) => x.state)).toEqual(["link", "link"]);
    noKeyIn(r.text);
    // The log says the provider and the status, nothing else.
    expect(logged()).toBe("[fuobe] key-info fal: 500\n[fuobe] key-info replicate: 503");
    noKeyIn(logged());
  });

  it("keeps no key in what it caches or answers for a provider that echoes it with 401", async () => {
    fal.keys["echo-key-id-1234:echo-key-secret-5678"] = "echo";
    const E = auth.createAccount("info-e@example.com", "long enough").id;
    saveAccountKey(E, "fal", "echo-key-id-1234:echo-key-secret-5678");
    const info = await accountInfo({ kind: "account", id: E }, "fal");
    expect(info?.state).toBe("check-key");
    const text = JSON.stringify(info);
    expect(text).not.toContain("echo-key");
    expect(logged()).toBe("");
  });

  it("answers only the documented fields of the provider's account, never its other text", async () => {
    rep.script = (r) =>
      r.path === "/v1/account"
        ? { status: 200, body: { ...(fixture("replicate-account-200-user.json") as object), username: "alice\u0007", api_token: OWNER_REP, extra: "never shown" } }
        : null;
    const r = await ask(ownerCookie);
    const p = r.body.providers[1];
    expect(Object.keys(p).sort()).toEqual(["account", "billingUrl", "checkedAt", "provider", "state"]);
    expect(p.account).toEqual({ name: "alice", kind: "user", fullName: "Alice" });
    expect(r.text).not.toContain("never shown");
    expect(r.text).not.toContain("github");
    noKeyIn(r.text);
  });
});

describe("how often a provider is asked", () => {
  it("once a minute: a second look within 60 s is the kept answer", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T10:00:00Z"));
    const first = await ask(ownerCookie);
    vi.setSystemTime(new Date("2026-11-06T10:00:59Z"));
    const second = await ask(ownerCookie);
    expect(second.body).toEqual(first.body);
    expect(billingCalls(fal.log)).toBe(1);
    expect(rep.log).toHaveLength(1);
    vi.setSystemTime(new Date("2026-11-06T10:01:01Z"));
    await ask(ownerCookie);
    expect(billingCalls(fal.log)).toBe(2);
    expect(rep.log).toHaveLength(2);
  });

  it("a refresh asks again, but never twice in 10 s for the same key", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T10:00:00Z"));
    await ask(cookieA);
    vi.setSystemTime(new Date("2026-11-06T10:00:05Z"));
    await ask(cookieA, "?refresh=1");
    expect(billingCalls(fal.log)).toBe(1);
    vi.setSystemTime(new Date("2026-11-06T10:00:11Z"));
    await ask(cookieA, "?refresh=1");
    expect(billingCalls(fal.log)).toBe(2);
    expect(rep.log).toHaveLength(2);
  });

  it("asks once for many looks at the same moment", async () => {
    const all = await Promise.all([ask(cookieA), ask(cookieA), ask(cookieA, "?refresh=1")]);
    expect(new Set(all.map((x) => JSON.stringify(x.body))).size).toBe(1);
    expect(billingCalls(fal.log)).toBe(1);
    expect(rep.log).toHaveLength(1);
  });

  it("keeps a busy provider's answer 15 s only", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T10:00:00Z"));
    fal.script = (r) => (r.path.startsWith("/v1/account/billing") ? { status: 429, body: fixture("fal-429.json") } : null);
    expect((await ask(ownerCookie)).body.providers[0].state).toBe("link");
    vi.setSystemTime(new Date("2026-11-06T10:00:14Z"));
    await ask(ownerCookie);
    expect(billingCalls(fal.log)).toBe(1);
    fal.script = null;
    vi.setSystemTime(new Date("2026-11-06T10:00:16Z"));
    expect((await ask(ownerCookie)).body.providers[0].state).toBe("ok");
    expect(billingCalls(fal.log)).toBe(2);
  });

  it("stops waiting after a short time, and shows the billing link", async () => {
    KEY_INFO.timeoutMs = 300;
    onTestFinished(() => {
      KEY_INFO.timeoutMs = 5_000;
    });
    fal.hang = (r) => r.path.startsWith("/v1/account/billing");
    rep.hang = (r) => r.path === "/v1/account";
    const t = Date.now();
    const r = await ask(ownerCookie);
    expect(Date.now() - t).toBeLessThan(3_000);
    expect(r.body.providers.map((x: { state: string }) => x.state)).toEqual(["link", "link"]);
    expect(logged()).toBe("[fuobe] key-info fal: timeout\n[fuobe] key-info replicate: timeout");
  });

  it("waits no longer for fal.ai's key check after a 401: no answer in time is the billing link", async () => {
    KEY_INFO.timeoutMs = 300;
    onTestFinished(() => {
      KEY_INFO.timeoutMs = 5_000;
    });
    fal.script = (r) => (r.path.startsWith("/v1/account/billing") ? { status: 401, body: fixture("fal-401-bad-key.recorded.json") } : null);
    fal.hang = (r) => r.path.endsWith("/status");
    const t = Date.now();
    const r = await ask(ownerCookie);
    expect(Date.now() - t).toBeLessThan(3_000);
    expect(r.body.providers[0]).toMatchObject({ provider: "fal", state: "link" });
    noKeyIn(r.text);
  });
});

describe("what each documented answer shows", () => {
  const falAnswer = async (status: number, body: unknown) => {
    fal.script = (r) => (r.path.startsWith("/v1/account/billing") ? { status, body } : null);
    clearKeyInfo();
    return (await ask(ownerCookie)).body.providers[0];
  };
  const repAnswer = async (status: number, body: unknown) => {
    rep.script = (r) => (r.path === "/v1/account" ? { status, body } : null);
    clearKeyInfo();
    return (await ask(ownerCookie)).body.providers[1];
  };

  it("fal.ai: the balance, an empty balance, no credits, no permission, a locked account", async () => {
    expect(await falAnswer(200, fixture("fal-billing-200-credits.json"))).toMatchObject({ state: "ok", balance: { amount: 24.5, currency: "USD" }, account: { name: "my-team" } });
    expect(await falAnswer(200, { username: "my-team", credits: { current_balance: 0, currency: "USD" } })).toMatchObject({ state: "empty", balance: { amount: 0, currency: "USD" } });
    // Without credits (expand not honoured), or a currency that isn't a code: no figure, the link.
    expect(await falAnswer(200, fixture("fal-billing-200-plain.json"))).toMatchObject({ state: "link", account: { name: "my-team" } });
    expect((await falAnswer(200, { username: "x", credits: { current_balance: 5, currency: "<b>" } })).balance).toBeUndefined();
    expect(await falAnswer(403, fixture("fal-billing-403-no-permission.json"))).toMatchObject({ state: "link" });
    expect((await falAnswer(403, fixture("fal-billing-403-no-permission.json"))).account).toBeUndefined();
    expect(await falAnswer(403, fixture("fal-403-locked.queue-shape.json"))).toMatchObject({ state: "empty" });
  });

  it("fal.ai 401: 'Check key' only when fal.ai's key check refuses the key too", async () => {
    // The studio's key works for runs (its key check passes): a 401 here says nothing about it.
    expect(await falAnswer(401, fixture("fal-401-bad-key.recorded.json"))).toMatchObject({ state: "link" });
    // A key fal.ai refuses everywhere.
    fal.keys[OWNER_FAL] = "echo";
    onTestFinished(() => {
      fal.keys[OWNER_FAL] = "billing";
    });
    fal.script = null;
    clearKeyInfo();
    expect((await ask(ownerCookie)).body.providers[0]).toMatchObject({ state: "check-key" });
    expect(fal.log.some((r) => r.path.endsWith("/status"))).toBe(true);
  });

  it("Replicate: the account (a user or an organization), credit gone, a refused token, a busy API", async () => {
    expect(await repAnswer(200, fixture("replicate-account-200-org.json"))).toMatchObject({ state: "link", account: { name: "acme", kind: "organization", fullName: "Acme Corp, Inc." } });
    expect(await repAnswer(200, fixture("replicate-account-200-user.json"))).toMatchObject({ state: "link", account: { name: "alice", kind: "user", fullName: "Alice" } });
    expect(await repAnswer(402, { detail: "You have insufficient credit to run this model. Go to https://replicate.com/account/billing to purchase credit." })).toMatchObject({ state: "empty" });
    expect(await repAnswer(401, fixture("replicate-401-bad-key.recorded.json"))).toMatchObject({ state: "check-key" });
    expect(await repAnswer(429, fixture("replicate-429.json"))).toMatchObject({ state: "link" });
    expect((await repAnswer(429, fixture("replicate-429.json"))).account).toBeUndefined();
  });

  it("spend: summed in one currency over its pages, and left out when it can't be whole", async () => {
    const usage = async (pages: unknown[]) => {
      let n = 0;
      fal.script = (r) => (r.path.startsWith("/v1/models/usage") ? { status: 200, body: pages[Math.min(n++, pages.length - 1)] } : null);
      clearKeyInfo();
      return (await ask(ownerCookie, "?detail=1")).body.providers[0].spentThisMonth;
    };
    const row = (cost: number, currency = "USD") => ({ endpoint_id: "fal-ai/flux/dev", unit: "image", quantity: 1, cost_total: cost, cost, currency });
    expect(await usage([fixture("fal-usage-200-summary.json")])).toEqual({ amount: 0.32, currency: "USD" });
    expect(await usage([{ summary: [row(1.25)], has_more: true, next_cursor: "Mg==" }, { summary: [row(2)], has_more: false, next_cursor: null }])).toEqual({ amount: 3.25, currency: "USD" });
    expect(await usage([{ summary: [row(1), row(2, "EUR")], has_more: false }])).toBeUndefined();
    expect(await usage([{ summary: [row(1)], has_more: true, next_cursor: "Mg==" }])).toBeUndefined();
    fal.script = (r) => (r.path.startsWith("/v1/models/usage") ? { status: 403, body: fixture("fal-billing-403-no-permission.json") } : null);
    clearKeyInfo();
    const r = await ask(ownerCookie, "?detail=1");
    expect(r.body.providers[0].spentThisMonth).toBeUndefined();
    expect(r.body.providers[0].balance).toEqual({ amount: 24.5, currency: "USD" });
  });
});
