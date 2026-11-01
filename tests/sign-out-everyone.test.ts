import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-signout-"));
process.env.FUOBE_DATA_DIR = dir;
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_PUBLIC_SIGNUP;
const auth = await import("@/server/auth");
const { proxy } = await import("@/proxy");
const route = await import("@/app/api/auth/sessions/route");
afterAll(() => {
  delete process.env.FUOBE_PASSWORD;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
});

const DAY = 86_400_000;
const secret = () => (JSON.parse(fs.readFileSync(path.join(dir, "auth.json"), "utf8")) as { secret: string }).secret;
const hmac = (key: string, payload: string) => crypto.createHmac("sha256", key).update(payload).digest("base64url");
const passwordTag = () => crypto.createHash("sha256").update(process.env.FUOBE_PASSWORD ?? "").digest("hex");
/**
 * A cookie signed as the server signs it, as someone who read auth.json and also knew the password could make one: an
 * owner's ("<expiry>") with the secret and the password, an account's ("<expiry>.<id>") with the secret alone.
 */
const forge = (payload: string) => `${payload}.${hmac(payload.includes(".") ? secret() : `${secret()}.${passwordTag()}`, payload)}`;

function req(method: string, init: { cookie?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...init.headers };
  if (init.cookie) headers.cookie = `${auth.SESSION_COOKIE}=${init.cookie}`;
  return new NextRequest("http://localhost:3000/api/auth/sessions", { method, headers });
}

beforeAll(() => {
  // fuobe.com: the password comes from the server's environment, so Settings can't change it.
  process.env.FUOBE_PASSWORD = "from the environment";
});
afterEach(() => delete process.env.FUOBE_PUBLIC_SIGNUP);

describe("H-1: a cookie's expiry is capped at the session lifetime", () => {
  it("refuses a forged owner cookie that expires far in the future, and keeps a real one", () => {
    const real = auth.createSession().value;
    expect(auth.validSession(real)).toBe(true);
    expect(auth.validSession(forge("9999999999999"))).toBe(false);
    expect(auth.validSession(forge(String(Date.now() + 31 * DAY)))).toBe(false);
    // Signed just now for the full 30 days: still fine.
    expect(auth.validSession(forge(String(Date.now() + 30 * DAY - 1000)))).toBe(true);
  });

  it("refuses a forged account cookie that expires far in the future", () => {
    const a = auth.createAccount("far@example.com", "long enough");
    expect(auth.sessionViewer(auth.createSession(a.id).value)?.kind).toBe("account");
    expect(auth.sessionViewer(forge(`9999999999999.${a.id}`))).toBeNull();
  });

  it("refuses an expiry that isn't plain digits", () => {
    // Both read as a time a day from now by Number(), but no real cookie looks like this.
    expect(auth.validSession(forge(`0x${(Date.now() + DAY).toString(16)}`))).toBe(false);
    expect(auth.validSession(forge(`${String(Date.now() + DAY).slice(0, -3)}e3`))).toBe(false);
  });
});

describe("H-1: owner sign-ins are tied to the password", () => {
  it("a new FUOBE_PASSWORD ends every owner sign-in at the restart, and no account's", () => {
    const owner = auth.createSession().value;
    const a = auth.createAccount("tied@example.com", "long enough");
    const account = auth.createSession(a.id).value;
    process.env.FUOBE_PASSWORD = "a brand new password";
    try {
      expect(auth.validSession(owner)).toBe(false);
      expect(auth.sessionViewer(account)?.kind).toBe("account");
      expect(auth.validSession(auth.createSession().value)).toBe(true);
    } finally {
      process.env.FUOBE_PASSWORD = "from the environment";
    }
  });

  it("the secret alone (someone who read auth.json, not the password) can't make an owner cookie", () => {
    const exp = String(Date.now() + DAY);
    expect(auth.validSession(`${exp}.${hmac(secret(), exp)}`)).toBe(false);
    expect(auth.validSession(forge(exp))).toBe(true);
  });
});

describe("H-1: Sign everyone out also ends an open live feed", () => {
  const stream = () => import("@/app/api/generations/stream/route");
  /** A read left waiting when the time ran out: the next call takes it over, so no chunk is lost. */
  const waiting = new WeakMap<object, Promise<ReadableStreamReadResult<Uint8Array>>>();
  /** What a stream sends within `ms`, and whether it ended. */
  async function readFor(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number): Promise<{ text: string; done: boolean }> {
    const dec = new TextDecoder();
    let text = "";
    const until = Date.now() + ms;
    for (;;) {
      const left = until - Date.now();
      if (left <= 0) return { text, done: false };
      const read = waiting.get(reader) ?? reader.read();
      waiting.set(reader, read);
      const r = await Promise.race([read, new Promise<null>((resolve) => setTimeout(() => resolve(null), left))]);
      if (r === null) return { text, done: false };
      waiting.delete(reader);
      if (r.done) return { text, done: true };
      text += dec.decode(r.value);
    }
  }
  let n = 0;
  /** A new run in the owner's library (a row change is what the feed sends). */
  async function aRun(): Promise<string> {
    const { db } = await import("@/server/db");
    const id = `live-${++n}-${Date.now()}`;
    db()
      .prepare(
        "INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, prompt, request_json, created_at, updated_at) VALUES (?, 'image', 'mock-image', 'cloud', 'mock', 'text-to-image', 'image', 'queued', ?, '{}', ?, ?)",
      )
      .run(id, `prompt ${id}`, Date.now(), Date.now());
    return id;
  }

  it("a stream opened before Sign everyone out sends nothing after it, and closes", async () => {
    const owner = auth.createSession().value;
    const ac = new AbortController();
    const res = await (await stream()).GET(new NextRequest("http://localhost:3000/api/generations/stream", { headers: { cookie: `${auth.SESSION_COOKIE}=${owner}` }, signal: ac.signal }));
    const reader = res.body!.getReader();
    try {
      expect((await readFor(reader, 200)).text).toMatch(/^retry: 2000/);
      const before = await aRun();
      expect((await readFor(reader, 300)).text).toContain(`"id":"${before}"`);
      auth.signOutEveryone();
      const after = await aRun();
      const rest = await readFor(reader, 500);
      expect(rest.text).not.toContain(after);
      expect(rest.done).toBe(true);
    } finally {
      ac.abort();
    }
  });

  it("the same for a stream opened with an API token that is then revoked", async () => {
    const { token, info } = auth.createToken("feed");
    const ac = new AbortController();
    const res = await (await stream()).GET(new NextRequest("http://localhost:3000/api/generations/stream", { headers: { authorization: `Bearer ${token}` }, signal: ac.signal }));
    const reader = res.body!.getReader();
    try {
      await readFor(reader, 100);
      auth.revokeToken(info.id);
      const after = await aRun();
      const rest = await readFor(reader, 500);
      expect(rest.text).not.toContain(after);
      expect(rest.done).toBe(true);
    } finally {
      ac.abort();
    }
  });
});

describe("H-1: Sign everyone out", () => {
  it("replaces the secret even while FUOBE_PASSWORD is set: every owner and account session ends, the password still works", () => {
    const owner = auth.createSession().value;
    const a = auth.createAccount("everyone@example.com", "long enough");
    const account = auth.createSession(a.id).value;
    const before = secret();
    auth.signOutEveryone();
    expect(secret()).not.toBe(before);
    expect(secret()).toMatch(/^[0-9a-f]{64}$/);
    expect(auth.validSession(owner)).toBe(false);
    expect(auth.sessionViewer(account)).toBeNull();
    expect(auth.checkPassword("from the environment")).toBe(true);
    expect(auth.validSession(auth.createSession().value)).toBe(true);
    expect(auth.checkAccount("everyone@example.com", "long enough")?.id).toBe(a.id);
  });

  it("keeps API tokens unless asked to revoke them too", () => {
    const { token } = auth.createToken("CI");
    auth.signOutEveryone();
    expect(auth.validToken(`Bearer ${token}`)).toBe(true);
    auth.signOutEveryone({ tokens: true });
    expect(auth.validToken(`Bearer ${token}`)).toBe(false);
    expect(auth.authStatus().tokens).toEqual([]);
  });

  it("is a POST the owner's signed-in browser makes, and signs that browser out too", async () => {
    const owner = auth.createSession().value;
    const other = auth.createSession().value;
    const { token } = auth.createToken("kept");
    const res = await route.POST(req("POST", { cookie: owner, headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tokensRevoked: false });
    // The cookie of the browser that pressed it is cleared, and it no longer works anywhere.
    expect(res.headers.get("set-cookie")).toMatch(/^fuobe_session=;.*Max-Age=0/i);
    expect(auth.validSession(owner)).toBe(false);
    expect(auth.validSession(other)).toBe(false);
    expect(auth.validToken(`Bearer ${token}`)).toBe(true);
  });

  it("revokes every API token when the owner asks", async () => {
    const owner = auth.createSession().value;
    const { token } = auth.createToken("gone");
    const res = await route.POST(new NextRequest("http://localhost:3000/api/auth/sessions", { method: "POST", headers: { cookie: `${auth.SESSION_COOKIE}=${owner}`, "content-type": "application/json" }, body: JSON.stringify({ tokens: true }) }));
    expect(res.status).toBe(200);
    expect((await res.json()).tokensRevoked).toBe(true);
    expect(auth.validToken(`Bearer ${token}`)).toBe(false);
  });

  it("refuses an API token, an account and a guest", async () => {
    const before = secret();
    const { token } = auth.createToken("script");
    expect((await route.POST(req("POST", { headers: { authorization: `Bearer ${token}` } }))).status).toBe(403);
    const a = auth.createAccount("not-owner@example.com", "long enough");
    expect((await route.POST(req("POST", { cookie: auth.createSession(a.id).value }))).status).toBe(403);
    expect((await route.POST(req("POST"))).status).toBe(403);
    expect(secret()).toBe(before);
  });

  it("is the owner's only in the proxy too", async () => {
    process.env.FUOBE_PUBLIC_SIGNUP = "1";
    const a = auth.createAccount("proxy-signout@example.com", "long enough");
    const r = proxy(req("POST", { cookie: auth.createSession(a.id).value }));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/owner/);
    expect(proxy(req("POST")).status).toBe(401);
  });
});
