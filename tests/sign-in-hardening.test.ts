import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Route handlers set the session cookie through cookies() (no request scope in a test): a jar that only records.
const jar = { set: vi.fn(), delete: vi.fn(), get: vi.fn() };
vi.mock("next/headers", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/headers")>()), cookies: async () => jar }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-sign-in-"));
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
process.env.FUOBE_TRUST_PROXY = "1";
delete process.env.FUOBE_PASSWORD;

const auth = await import("@/server/auth");
const { safeNext } = await import("@/lib/safe-redirect");
const { resetRates } = await import("@/server/rate");
const login = await import("@/app/api/auth/login/route");
const signup = await import("@/app/api/auth/signup/route");
const me = await import("@/app/api/auth/me/route");

const globals = globalThis as Record<string, unknown>;
/** A fresh start for every limit: guards live on globalThis so a dev server's reloads keep them. */
function resetGuards() {
  for (const k of Object.keys(globals)) if (/^__fuobe\w*Guard$/.test(k)) delete globals[k];
  resetRates();
}

let ip = 0;
/** A visitor's address, as a trusted reverse proxy passes it on (the last X-Forwarded-For hop). */
const nextIp = () => `198.51.100.${++ip % 250}`;
const post = (url: string, body: unknown, from = nextIp(), cookie?: string, method = "POST") =>
  new Request(`http://localhost:3000${url}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": from, ...(cookie && { cookie: `${auth.SESSION_COOKIE}=${cookie}` }) },
    body: JSON.stringify(body),
  });

beforeAll(() => {
  auth.setPassword("install password");
  auth.createAccount("member@example.com", "member password");
  auth.createAccount("other@example.com", "other password");
});
afterEach(() => {
  resetGuards();
  vi.restoreAllMocks();
});
afterAll(() => {
  delete process.env.FUOBE_PUBLIC_SIGNUP;
  delete process.env.FUOBE_TRUST_PROXY;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

describe("M-1: after sign-in, only pages on this site", () => {
  const origin = "http://localhost:3000";
  it("refuses a path that resolves to another host", () => {
    for (const bad of ["/.//evil.example", "/a/..//evil.example", "/%2e//evil.example", "/./\\evil.example", "http://localhost:3000//evil.example/login?owner=1", "/..//evil.example"]) {
      expect(safeNext(bad, origin), bad).toBe("/");
    }
  });

  it("keeps ordinary paths", () => {
    expect(safeNext("/video?model=kling-3#x", origin)).toBe("/video?model=kling-3#x");
    expect(safeNext("/a//b", origin)).toBe("/a//b");
    expect(safeNext("/library/../settings", origin)).toBe("/settings");
  });
});

describe("M-2: password checks are counted and never hold up the server", () => {
  it("counts a right password too: one address gets 10 log-ins a minute to one email", async () => {
    const from = nextIp();
    for (let i = 0; i < 10; i++) expect((await login.POST(post("/api/auth/login", { email: "member@example.com", password: "member password" }, from))).status, `log-in ${i}`).toBe(200);
    const r = await login.POST(post("/api/auth/login", { email: "member@example.com", password: "member password" }, from));
    expect(r.status).toBe(429);
    expect(r.headers.get("retry-after")).toBeTruthy();
    // Another email, and the same email from another address, are not affected.
    expect((await login.POST(post("/api/auth/login", { email: "other@example.com", password: "other password" }, from))).status).toBe(200);
    expect((await login.POST(post("/api/auth/login", { email: "member@example.com", password: "member password" }))).status).toBe(200);
  });

  it("one address gets 30 account log-ins a minute in all", async () => {
    const from = nextIp();
    for (let i = 0; i < 30; i++) await login.POST(post("/api/auth/login", { email: i % 2 ? "member@example.com" : "other@example.com", password: i % 2 ? "member password" : "other password" }, from));
    expect((await login.POST(post("/api/auth/login", { email: "member@example.com", password: "member password" }, from))).status).toBe(429);
  });

  it("checks a password without the synchronous scrypt", async () => {
    const sync = vi.spyOn(crypto, "scryptSync");
    expect((await login.POST(post("/api/auth/login", { email: "member@example.com", password: "member password" }))).status).toBe(200);
    expect((await login.POST(post("/api/auth/login", { email: "member@example.com", password: "wrong password" }))).status).toBe(401);
    expect((await login.POST(post("/api/auth/login", { email: "nobody@example.com", password: "wrong password" }))).status).toBe(401);
    expect((await login.POST(post("/api/auth/login", { password: "install password" }))).status).toBe(200);
    expect(sync).not.toHaveBeenCalled();
    await expect(auth.verifyAccount("member@example.com", "member password")).resolves.toMatchObject({ email: "member@example.com" });
    await expect(auth.verifyAccount("member@example.com", "nope nope")).resolves.toBeNull();
    await expect(auth.verifyPassword("install password")).resolves.toBe(true);
    await expect(auth.verifyPassword("nope nope")).resolves.toBe(false);
  });

  it("records a log-in at most once an hour, so log-ins don't rewrite the accounts file", async () => {
    const file = path.join(dir, "auth.json");
    expect((await login.POST(post("/api/auth/login", { email: "member@example.com", password: "member password" }))).status).toBe(200);
    const before = fs.readFileSync(file, "utf8");
    for (let i = 0; i < 3; i++) expect((await login.POST(post("/api/auth/login", { email: "member@example.com", password: "member password" }))).status).toBe(200);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
  });

  it("an account deleting itself gets 5 password checks a minute", async () => {
    const a = auth.createAccount("deleter@example.com", "deleter password");
    const cookie = auth.createSession(a.id).value;
    for (let i = 0; i < 5; i++) expect((await me.DELETE(post("/api/auth/me", { password: "wrong password" }, nextIp(), cookie, "DELETE"))).status).toBe(403);
    expect((await me.DELETE(post("/api/auth/me", { password: "deleter password" }, nextIp(), cookie, "DELETE"))).status).toBe(429);
    expect(auth.accountById(a.id)).toBeDefined();
  });
});

describe("guests can't grow the rate limiter's memory", () => {
  it("a log-in refused by the visitor's own budget, or with a made-up email, adds no key", async () => {
    const { rateKeyCount } = await import("@/server/rate");
    const from = nextIp();
    for (let i = 0; i < 30; i++) await login.POST(post("/api/auth/login", { email: `spent${i}@example.com`, password: "wrong password" }, from));
    const before = rateKeyCount();
    for (let i = 0; i < 50; i++) expect((await login.POST(post("/api/auth/login", { email: `random${i}-${"a".repeat(200)}@example.com`, password: "x" }, from))).status).toBe(429);
    expect(rateKeyCount()).toBe(before);
    // Text that isn't an email address: no key for it, only the visitor's own.
    const other = nextIp();
    expect((await login.POST(post("/api/auth/login", { email: "z".repeat(250), password: "x" }, other))).status).toBe(401);
    expect(rateKeyCount()).toBe(before + 1);
  });

  it("drops a key once its window has passed, and never keeps more than its cap", async () => {
    const { hit, rateKeyCount, MAX_RATE_KEYS } = await import("@/server/rate");
    const t = Date.now();
    for (let i = 0; i < 1000; i++) hit(`short:${i}`, 5, 1000, t);
    expect(rateKeyCount()).toBe(1000);
    hit("later", 5, 1000, t + 10_000);
    expect(rateKeyCount()).toBe(1);
    for (let i = 0; i < MAX_RATE_KEYS + 50; i++) hit(`long:${i}`, 5, 60 * 60_000, t + 20_000);
    expect(rateKeyCount()).toBeLessThanOrEqual(MAX_RATE_KEYS);
    // The newest keys are the ones kept.
    expect(hit(`long:${MAX_RATE_KEYS + 49}`, 1, 60 * 60_000, t + 20_001).ok).toBe(false);
  });
});

describe("M-4: one visitor's wrong guesses don't lock everyone out", () => {
  it("treats an IPv6 /64 as one visitor, and an IPv4-mapped address as IPv4", () => {
    const key = (xff: string) => auth.LoginGuard.clientKey(new Headers({ "x-forwarded-for": xff }), true);
    expect(key("2001:db8:1:2::1")).toBe(key("2001:db8:1:2:ffff:ffff:ffff:ffff"));
    expect(key("2001:db8:1:2::1")).toBe(key("2001:0DB8:0001:0002:0000:0000:0000:0042"));
    expect(key("2001:db8:1:2::1")).not.toBe(key("2001:db8:1:3::1"));
    expect(key("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(key("203.0.113.9")).toBe("203.0.113.9");
  });

  it("wrong account passwords from many addresses don't slow the owner's sign-in", async () => {
    for (let i = 0; i < 30; i++) await login.POST(post("/api/auth/login", { email: `guess${i}@example.com`, password: "wrong password" }));
    expect((await login.POST(post("/api/auth/login", { password: "install password" }))).status).toBe(200);
  });

  it("wrong owner passwords from many addresses don't stop accounts from logging in", async () => {
    for (let i = 0; i < 30; i++) await login.POST(post("/api/auth/login", { password: `wrong ${i}` }));
    expect((await login.POST(post("/api/auth/login", { email: "member@example.com", password: "member password" }))).status).toBe(200);
  });

  it("after 10 wrong passwords to one email from many addresses, only the addresses that got it wrong are locked out of it", async () => {
    const guesser = nextIp();
    for (let i = 0; i < 2; i++) expect((await login.POST(post("/api/auth/login", { email: "other@example.com", password: `wrong ${i}` }, guesser))).status).toBe(401);
    for (let i = 2; i < 10; i++) expect((await login.POST(post("/api/auth/login", { email: "other@example.com", password: `wrong ${i}` }))).status).toBe(401);
    // An address that guessed wrong twice: locked out of this email, even with the right password.
    const r = await login.POST(post("/api/auth/login", { email: "other@example.com", password: "other password" }, guesser));
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(60);
    // The person whose account it is, from any other address: in at once, so nobody can lock them out on purpose.
    expect((await login.POST(post("/api/auth/login", { email: "other@example.com", password: "other password" }))).status).toBe(200);
    expect((await login.POST(post("/api/auth/login", { email: "member@example.com", password: "member password" }, guesser))).status).toBe(200);
  });

  it("an address gets 2 tries at an email many addresses got wrong", async () => {
    for (let i = 0; i < 10; i++) await login.POST(post("/api/auth/login", { email: "other@example.com", password: `wrong ${i}` }));
    const late = nextIp();
    expect((await login.POST(post("/api/auth/login", { email: "other@example.com", password: "wrong again" }, late))).status).toBe(401);
    expect((await login.POST(post("/api/auth/login", { email: "other@example.com", password: "wrong once more" }, late))).status).toBe(401);
    expect((await login.POST(post("/api/auth/login", { email: "other@example.com", password: "other password" }, late))).status).toBe(429);
  });

  it("counts owner guesses sent all at once before any is checked (a Settings password's check takes a while)", async () => {
    const from = nextIp();
    const answers = await Promise.all(Array.from({ length: 40 }, (_, i) => login.POST(post("/api/auth/login", { password: `wrong ${i}` }, from))));
    const statuses = answers.map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(5);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(35);
  });

  it("checks at most a few owner passwords at once", async () => {
    const { enter } = await import("@/server/rate");
    const held = [enter("owner-login", 2), enter("owner-login", 2)];
    try {
      expect((await login.POST(post("/api/auth/login", { password: "install password" }))).status).toBe(429);
    } finally {
      for (const release of held) release?.();
    }
    expect((await login.POST(post("/api/auth/login", { password: "install password" }))).status).toBe(200);
  });

  it("counts only sign-ups that could make an account: empty bodies don't slow sign-up for everyone", async () => {
    for (let i = 0; i < 30; i++) expect((await signup.POST(post("/api/auth/signup", {}))).status).toBe(400);
    expect((await signup.POST(post("/api/auth/signup", { email: "newcomer@example.com", password: "newcomer password" }))).status).toBe(201);
  });
});

describe("Sign out ends the session on the server", () => {
  it("refuses a copy of a signed-out cookie, the account's and the owner's, and keeps other sessions", async () => {
    const logout = await import("@/app/api/auth/logout/route");
    const account = auth.createAccount("leaving@example.com", "leaving password");
    const copy = auth.createSession(account.id).value;
    // Another browser's sign-in, a moment later (a cookie is its expiry, its account and their signature).
    await new Promise((r) => setTimeout(r, 5));
    const other = auth.createSession(account.id).value;
    expect(other).not.toBe(copy);
    const owner = auth.createSession().value;
    expect(auth.sessionViewer(copy)?.kind).toBe("account");
    for (const cookie of [copy, owner]) {
      jar.get.mockReturnValueOnce({ value: cookie });
      expect((await logout.POST()).status).toBe(200);
      expect(auth.sessionViewer(cookie)).toBeNull();
    }
    expect(jar.delete).toHaveBeenCalledWith(auth.SESSION_COOKIE);
    // Another browser's session of the same account isn't signed out.
    expect(auth.sessionViewer(other)?.kind).toBe("account");
    // Signing out again (or with no cookie) changes nothing.
    jar.get.mockReturnValueOnce({ value: copy });
    expect((await logout.POST()).status).toBe(200);
    jar.get.mockReturnValueOnce(undefined);
    expect((await logout.POST()).status).toBe(200);
  });
});
