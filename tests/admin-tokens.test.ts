import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { TINY_PNG } from "./helpers/fake-comfy-runner";
import { tempDir } from "./helpers/temp-dir";

// Route handlers are called directly, outside a Next request: connection() has nothing to wait for.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const dir = tempDir("fuobe-admin-tokens-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PUBLIC_SIGNUP = "1";
process.env.COMFYUI_URL = "http://127.0.0.1:9";
delete process.env.FUOBE_PASSWORD;
delete process.env.FUOBE_TRUST_PROXY;
const auth = await import("@/server/auth");
const admin = await import("@/server/admin-tokens");
const { db } = await import("@/server/db");
const { resetRates } = await import("@/server/rate");
const { saveFile } = await import("@/server/storage");
const { proxy } = await import("@/proxy");
const workers = await import("@/server/computer/workers");
const routes = {
  accounts: await import("@/app/api/admin/accounts/route"),
  account: await import("@/app/api/admin/accounts/[id]/route"),
  runs: await import("@/app/api/admin/generations/route"),
  run: await import("@/app/api/admin/generations/[id]/route"),
  outputs: await import("@/app/api/admin/outputs/[action]/route"),
  queue: await import("@/app/api/admin/queue/route"),
  queueSettings: await import("@/app/api/admin/queue/settings/route"),
  workers: await import("@/app/api/admin/workers/route"),
  worker: await import("@/app/api/admin/workers/[id]/route"),
  download: await import("@/app/api/admin/workers/download/route"),
  reports: await import("@/app/api/admin/reports/route"),
  audit: await import("@/app/api/admin/audit/route"),
  files: await import("@/app/api/admin/files/[...path]/route"),
  tokens: await import("@/app/api/admin/tokens/route"),
  self: await import("@/app/api/admin/tokens/self/route"),
  sessions: await import("@/app/api/auth/sessions/route"),
};
afterAll(() => {
  delete process.env.FUOBE_PUBLIC_SIGNUP;
});

type Scope = (typeof admin.SCOPES)[number];

const req = (url: string, o: { method?: string; token?: string; cookie?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost:3000${url}`, {
    method: o.method ?? "GET",
    headers: {
      ...(o.token && { authorization: `Bearer ${o.token}` }),
      ...(o.cookie && { cookie: `${auth.SESSION_COOKIE}=${o.cookie}` }),
      ...(o.body !== undefined && { "content-type": "application/json" }),
      ...o.headers,
    },
    ...(o.body !== undefined && { body: JSON.stringify(o.body) }),
  });

const ctx = <P>(params: P) => ({ params: Promise.resolve(params) }) as never;

let n = 0;
const make = (scopes: Scope[], o: { expiresInDays?: number | null; now?: number } = {}) =>
  admin.createAdminToken({ name: `token ${++n}`, scopes, expiresInDays: o.expiresInDays ?? null }, o.now);

const auditRows = () => db().prepare("SELECT * FROM admin_audit ORDER BY id").all() as { actor: string; token_id: string | null; token_name: string | null; action: string; target: string | null; detail_json: string | null; status: number }[];

let ownerCookie = "";
beforeAll(() => {
  auth.setPassword("install password");
  ownerCookie = auth.createSession().value;
});
beforeEach(() => resetRates());

describe("admin tokens: making, storing, revoking", () => {
  it("makes a fuobe_adm_ token shown once and keeps only its SHA-256", () => {
    const { token, info } = make(["queue:read", "accounts:read"]);
    expect(token).toMatch(/^fuobe_adm_[A-Za-z0-9_-]{43}$/);
    expect(info.prefix).toBe(token.slice(0, 14));
    expect(info.scopes).toEqual(["accounts:read", "queue:read"]);
    const row = db().prepare("SELECT * FROM admin_tokens WHERE id = ?").get(info.id) as Record<string, unknown>;
    expect(row.hash).toBe(crypto.createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(db().prepare("SELECT * FROM admin_tokens").all())).not.toContain(token);
    expect(JSON.stringify(admin.listAdminTokens())).not.toContain(row.hash as string);
  });

  it("refuses a bad name, unknown scopes, a wrong expiry and a 21st live token", () => {
    expect(() => admin.createAdminToken({ name: " ", scopes: ["queue:read"] })).toThrow(/Name the token/);
    expect(() => admin.createAdminToken({ name: "x".repeat(61), scopes: ["queue:read"] })).toThrow(/Name the token/);
    expect(() => admin.createAdminToken({ name: "a", scopes: [] })).toThrow(/Pick/);
    expect(() => admin.createAdminToken({ name: "a", scopes: ["everything"] })).toThrow(/Pick/);
    expect(() => admin.createAdminToken({ name: "a", scopes: ["queue:read"], expiresInDays: 0 })).toThrow(/expiry/);
    expect(() => admin.createAdminToken({ name: "a", scopes: ["queue:read"], expiresInDays: 366 })).toThrow(/expiry/);
    const dup = make(["queue:read"]);
    expect(() => admin.createAdminToken({ name: dup.info.name.toUpperCase(), scopes: ["queue:read"] })).toThrow(/exists/);
    while (admin.liveAdminTokenCount() < admin.MAX_LIVE_TOKENS) make(["queue:read"]);
    let err: unknown;
    try {
      make(["queue:read"]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(admin.AdminTokenError);
    expect((err as InstanceType<typeof admin.AdminTokenError>).status).toBe(409);
    // A revoked token frees its place.
    expect(admin.revokeAdminToken(dup.info.id)?.revokedAt).toBeGreaterThan(0);
    expect(admin.revokeAdminToken(dup.info.id)).toBeNull();
    expect(() => make(["queue:read"])).not.toThrow();
    admin.revokeAllAdminTokens();
    expect(admin.liveAdminTokenCount()).toBe(0);
  });

  it("checks a token: valid, wrong, revoked and expired (401 at once)", () => {
    const now = Date.now();
    const { token, info } = make(["queue:read"], { expiresInDays: 1, now });
    const ok = admin.tokenActor(req("/api/admin/queue", { token }), now);
    expect(ok).toMatchObject({ kind: "token", id: info.id, name: info.name, scopes: ["queue:read"] });
    const wrong = admin.tokenActor(req("/api/admin/queue", { token: `fuobe_adm_${"x".repeat(43)}` }), now) as Response;
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("www-authenticate")).toContain("invalid_token");
    const expired = admin.tokenActor(req("/api/admin/queue", { token }), now + 86_400_000 + 1) as Response;
    expect(expired.status).toBe(401);
    admin.revokeAdminToken(info.id);
    expect((admin.tokenActor(req("/api/admin/queue", { token }), now) as Response).status).toBe(401);
    // No admin token: not this check's business.
    expect(admin.tokenActor(req("/api/admin/queue"), now)).toBeNull();
  });

  it("compares against every live token in constant time, with no early exit", () => {
    admin.revokeAllAdminTokens();
    const a = make(["queue:read"]);
    make(["queue:read"]);
    make(["queue:read"]);
    const spy = vi.spyOn(crypto, "timingSafeEqual");
    try {
      admin.tokenActor(req("/api/admin/queue", { token: a.token }));
      expect(spy).toHaveBeenCalledTimes(3);
      spy.mockClear();
      admin.tokenActor(req("/api/admin/queue", { token: `fuobe_adm_${"y".repeat(43)}` }));
      expect(spy).toHaveBeenCalledTimes(3);
    } finally {
      spy.mockRestore();
    }
  });

  it("an owner API token is never rolled with a worker's or an admin token's prefix", () => {
    const spy = vi.spyOn(crypto, "randomBytes").mockImplementationOnce(() => Buffer.from(`adm_${"A".repeat(28)}`, "base64url"));
    try {
      const { token } = auth.createToken("script");
      expect(token).toMatch(/^fuobe_/);
      expect(token).not.toMatch(/^fuobe_(adm|wkr)_/i);
      expect(auth.validToken(`Bearer ${token}`)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("admin tokens: never the owner, only the admin API", () => {
  it("is refused by the proxy everywhere but /api/admin, a session cookie beside it or not", () => {
    const { token } = make(["queue:read"]);
    const refused = ["/", "/settings", "/library", "/api/settings", "/api/auth/tokens", "/api/auth/password", "/api/auth/sessions", "/api/reports", "/api/files/outputs/x.png", "/api/generations", "/api/mcp", "/api/gpu/computer/claim", "/api/admin", "/api/admin/tokens", "/api/admin/tokens/x", "/api/admin/%74okens"];
    for (const p of refused) {
      for (const cookie of [undefined, ownerCookie]) {
        const res = proxy(req(p, { token, cookie }));
        expect(res.status, p).toBe(403);
        expect(res.headers.get("x-middleware-next"), p).toBeNull();
      }
    }
    expect(proxy(req("/api/admin/tokens", { token, method: "POST", body: {} })).status).toBe(403);
    for (const p of ["/api/admin/queue", "/api/admin/accounts", "/api/admin/tokens/self", "/api/admin/files/outputs/x.png"]) {
      expect(proxy(req(p, { token })).headers.get("x-middleware-next"), p).toBe("1");
    }
    // Even a made-up one: the route checks it.
    expect(proxy(req("/api/admin/queue", { token: `fuobe_adm_${"x".repeat(43)}` })).headers.get("x-middleware-next")).toBe("1");
  });

  it("is never the owner, an account or a worker", () => {
    const { token } = make(["accounts:read"]);
    const r = req("/api/admin/accounts", { token, cookie: ownerCookie });
    expect(auth.validToken(`Bearer ${token}`)).toBe(false);
    expect(auth.requestViewer(r).kind).toBe("guest");
    expect(auth.requestAccount(r)).toBeNull();
    expect(auth.isOwnerRequest(req("/api/admin/accounts", { token }), undefined)).toBe(false);
    // A worker's route refuses it too (only fuobe_wkr_ reaches those).
    expect(proxy(req("/api/gpu/computer/tasks", { token })).status).toBe(403);
  });

  it("leaves owner and worker tokens as they were", () => {
    const owner = auth.createToken("owner script").token;
    expect(proxy(req("/api/settings", { token: owner })).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(req("/api/admin/queue", { token: owner })).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(req("/api/settings", { token: `fuobe_wkr_${"x".repeat(43)}` })).status).toBe(403);
  });

  it("can't make, list or revoke admin tokens; the owner's signed-in browser can", async () => {
    const { token, info } = make(["audit:read"]);
    const owner = auth.createToken("owner script 2").token;
    for (const o of [{ token }, { token, cookie: ownerCookie }, { token: owner }, {}]) {
      expect((await routes.tokens.GET(req("/api/admin/tokens", o))).status).toBe(403);
      expect((await routes.tokens.POST(req("/api/admin/tokens", { ...o, method: "POST", body: { name: "x", scopes: ["queue:read"] } }))).status).toBe(403);
      expect((await routes.tokens.DELETE(req(`/api/admin/tokens?id=${info.id}`, { ...o, method: "DELETE" }))).status).toBe(403);
    }
    const list = await routes.tokens.GET(req("/api/admin/tokens", { cookie: ownerCookie }));
    expect(list.status).toBe(200);
    const body = (await list.json()) as { tokens: { id: string }[]; scopes: { id: string; label: string }[] };
    expect(body.tokens.some((t) => t.id === info.id)).toBe(true);
    expect(body.scopes.map((s) => s.id)).toEqual([...admin.SCOPES]);
    expect(JSON.stringify(body)).not.toContain("hash");
    const made = await routes.tokens.POST(req("/api/admin/tokens", { cookie: ownerCookie, method: "POST", body: { name: "Tool", scopes: [...admin.SCOPES], expiresInDays: 90 } }));
    expect(made.status).toBe(201);
    const fresh = (await made.json()) as { token: string; info: { id: string; expiresAt: number } };
    expect(fresh.token).toMatch(/^fuobe_adm_/);
    expect(fresh.info.expiresAt).toBeGreaterThan(Date.now() + 89 * 86_400_000);
    expect((await routes.tokens.POST(req("/api/admin/tokens", { cookie: ownerCookie, method: "POST", body: { name: "", scopes: [] } }))).status).toBe(400);
    expect((await routes.tokens.DELETE(req(`/api/admin/tokens?id=${fresh.info.id}`, { cookie: ownerCookie, method: "DELETE" }))).status).toBe(204);
    expect((await routes.queue.GET(req("/api/admin/queue", { token: fresh.token }))).status).toBe(401);
    const logged = auditRows().filter((r) => r.target === fresh.info.id);
    expect(logged.map((r) => r.action)).toEqual(["token.create", "token.revoke"]);
    expect(JSON.stringify(auditRows())).not.toContain(fresh.token);
  });

  it("tells a token its own name and scopes at /tokens/self", async () => {
    const { token, info } = make(["queue:read", "runs:read"]);
    const res = await routes.self.GET(req("/api/admin/tokens/self", { token }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ id: info.id, name: info.name, prefix: info.prefix, scopes: ["queue:read", "runs:read"], expiresAt: null, createdAt: info.createdAt });
    expect((await routes.self.GET(req("/api/admin/tokens/self", { cookie: ownerCookie }))).status).toBe(401);
    expect((await routes.self.GET(req("/api/admin/tokens/self", { token: `fuobe_adm_${"z".repeat(43)}` }))).status).toBe(401);
  });
});

describe("admin tokens: every admin route asks for its scope", () => {
  type Call = { name: string; scope: Scope; run: (o: { token?: string; cookie?: string }) => Promise<Response> };
  const calls: Call[] = [
    { name: "GET accounts", scope: "accounts:read", run: (o) => routes.accounts.GET(req("/api/admin/accounts", o)) },
    { name: "GET accounts csv", scope: "accounts:read", run: (o) => routes.accounts.GET(req("/api/admin/accounts?format=csv", o)) },
    { name: "GET account", scope: "accounts:read", run: (o) => routes.account.GET(req("/api/admin/accounts/nope", o), ctx({ id: "nope" })) },
    { name: "PATCH account", scope: "accounts:write", run: (o) => routes.account.PATCH(req("/api/admin/accounts/nope", { ...o, method: "PATCH", body: { disabled: true } }), ctx({ id: "nope" })) },
    { name: "DELETE account", scope: "accounts:delete", run: (o) => routes.account.DELETE(req("/api/admin/accounts/nope", { ...o, method: "DELETE" }), ctx({ id: "nope" })) },
    { name: "GET runs", scope: "runs:read", run: (o) => routes.runs.GET(req("/api/admin/generations", o)) },
    { name: "DELETE run", scope: "runs:delete", run: (o) => routes.run.DELETE(req("/api/admin/generations/nope", { ...o, method: "DELETE" }), ctx({ id: "nope" })) },
    { name: "POST hide", scope: "outputs:hide", run: (o) => routes.outputs.POST(req("/api/admin/outputs/hide", { ...o, method: "POST", body: { assetIds: ["nope"] } }), ctx({ action: "hide" })) },
    { name: "POST unhide", scope: "outputs:moderate", run: (o) => routes.outputs.POST(req("/api/admin/outputs/unhide", { ...o, method: "POST", body: { assetIds: ["nope"] } }), ctx({ action: "unhide" })) },
    { name: "POST remove", scope: "outputs:moderate", run: (o) => routes.outputs.POST(req("/api/admin/outputs/remove", { ...o, method: "POST", body: { assetIds: ["nope"] } }), ctx({ action: "remove" })) },
    { name: "GET files", scope: "outputs:view", run: (o) => routes.files.GET(req("/api/admin/files/outputs/nope.png", o), ctx({ path: ["outputs", "nope.png"] })) },
    { name: "GET queue", scope: "queue:read", run: (o) => routes.queue.GET(req("/api/admin/queue", o)) },
    { name: "GET queue settings", scope: "queue:read", run: (o) => routes.queueSettings.GET(req("/api/admin/queue/settings", o)) },
    { name: "PATCH queue settings", scope: "queue:write", run: (o) => routes.queueSettings.PATCH(req("/api/admin/queue/settings", { ...o, method: "PATCH", body: { fairShare: false } })) },
    { name: "GET workers", scope: "workers:read", run: (o) => routes.workers.GET(req("/api/admin/workers", o)) },
    { name: "GET download", scope: "workers:read", run: (o) => routes.download.GET(req("/api/admin/workers/download", o)) },
    { name: "POST workers", scope: "workers:tokens", run: (o) => routes.workers.POST(req("/api/admin/workers", { ...o, method: "POST", body: { name: `w${++n}` } })) },
    { name: "PATCH worker", scope: "workers:write", run: (o) => routes.worker.PATCH(req("/api/admin/workers/nope", { ...o, method: "PATCH", body: { paused: true } }), ctx({ id: "nope" })) },
    { name: "PATCH worker rotate", scope: "workers:tokens", run: (o) => routes.worker.PATCH(req("/api/admin/workers/nope", { ...o, method: "PATCH", body: { rotate: true } }), ctx({ id: "nope" })) },
    { name: "GET reports", scope: "reports:read", run: (o) => routes.reports.GET(req("/api/admin/reports", o)) },
    { name: "GET audit", scope: "audit:read", run: (o) => routes.audit.GET(req("/api/admin/audit", o)) },
  ];

  it("refuses no token (the route's own 403), a wrong token (401) and an expired one (401)", async () => {
    const now = Date.now();
    const old = make([...admin.SCOPES], { expiresInDays: 1, now: now - 2 * 86_400_000 });
    for (const c of calls) {
      const none = await c.run({});
      expect(none.status, c.name).toBe(403);
      expect(((await none.json()) as { code?: string }).code, c.name).toBeUndefined();
      expect((await c.run({ token: `fuobe_adm_${"q".repeat(43)}` })).status, c.name).toBe(401);
      expect((await c.run({ token: old.token })).status, c.name).toBe(401);
      resetRates();
    }
  });

  it("refuses a token without the scope (403 scope) and takes one with it", async () => {
    for (const c of calls) {
      const other = make(admin.SCOPES.filter((s) => s !== c.scope && !(c.scope === "outputs:hide" && s === "outputs:moderate")));
      const res = await c.run({ token: other.token });
      expect(res.status, c.name).toBe(403);
      expect(await res.json(), c.name).toMatchObject({ code: "scope", scope: c.scope });
      const own = make(c.name === "PATCH worker rotate" ? ["workers:write", c.scope] : [c.scope]);
      const ok = await c.run({ token: own.token });
      expect([200, 201, 204, 404], c.name).toContain(ok.status);
      admin.revokeAllAdminTokens();
      resetRates();
    }
    expect(auditRows().filter((r) => r.action === "scope.denied").length).toBeGreaterThanOrEqual(calls.length - 1);
  });

  it("outputs:hide can hide but not show again or remove", async () => {
    const { token } = make(["outputs:hide"]);
    const body = { assetIds: ["nope"] };
    expect((await routes.outputs.POST(req("/api/admin/outputs/hide", { token, method: "POST", body }), ctx({ action: "hide" }))).status).toBe(200);
    for (const action of ["unhide", "remove"]) {
      const res = await routes.outputs.POST(req(`/api/admin/outputs/${action}`, { token, method: "POST", body }), ctx({ action }));
      expect(res.status, action).toBe(403);
      expect(await res.json()).toMatchObject({ code: "scope", scope: "outputs:moderate" });
    }
    // outputs:moderate hides too.
    const mod = make(["outputs:moderate"]);
    expect((await routes.outputs.POST(req("/api/admin/outputs/hide", { token: mod.token, method: "POST", body }), ctx({ action: "hide" }))).status).toBe(200);
  });

  it("checks a request by its token alone: an owner session beside it doesn't help", async () => {
    const { token } = make(["queue:read"]);
    expect((await routes.accounts.GET(req("/api/admin/accounts", { token, cookie: ownerCookie }))).status).toBe(403);
    expect((await routes.accounts.GET(req("/api/admin/accounts", { token: `fuobe_adm_${"w".repeat(43)}`, cookie: ownerCookie }))).status).toBe(401);
  });

  it("answers the owner's session exactly as before", async () => {
    const a = auth.createAccount(`owner-view-${++n}@example.com`, "long enough");
    const res = await routes.accounts.GET(req("/api/admin/accounts", { cookie: ownerCookie }));
    expect(res.status).toBe(200);
    expect(Object.keys((await res.json()) as object).sort()).toEqual(["items", "total", "totals"]);
    const off = await routes.account.PATCH(req(`/api/admin/accounts/${a.id}`, { cookie: ownerCookie, method: "PATCH", body: { disabled: true } }), ctx({ id: a.id }));
    expect(await off.json()).toMatchObject({ id: a.id, disabled: true });
    const denied = await routes.accounts.GET(req("/api/admin/accounts"));
    expect(await denied.json()).toEqual({ error: "You can't open this." });
    const queue = await routes.queue.GET(req("/api/admin/queue"));
    expect(await queue.json()).toEqual({ error: "Only the studio's owner sees the queue" });
    // The owner's change is logged as the owner's; the owner's reads aren't logged.
    const last = auditRows().at(-1)!;
    expect(last).toMatchObject({ actor: "owner", action: "account.disable", target: a.id, token_id: null, status: 200 });
    expect(auditRows().some((r) => r.actor === "owner" && r.action === "accounts.list")).toBe(false);
  });
});

describe("admin tokens: limits", () => {
  it("counts a token's reads (120), changes (30) and file views (600) a minute, each on its own", () => {
    const { token, info } = make(["workers:write"]);
    const now = Date.now();
    const ok = (r: Request) => expect(admin.tokenActor(r, now)).toMatchObject({ kind: "token" });
    const limited = (r: Request) => {
      const res = admin.tokenActor(r, now) as Response;
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBeTruthy();
    };
    // A page of previews: file views don't touch the reads or the changes.
    for (let i = 0; i < admin.FILE_VIEWS_PER_MINUTE; i++) ok(req(`/api/admin/files/outputs/${i}.png`, { token }));
    limited(req("/api/admin/files/outputs/more.png", { token }));
    for (let i = 0; i < admin.TOKEN_PER_MINUTE; i++) ok(req("/api/admin/workers", { token }));
    limited(req("/api/admin/workers", { token }));
    // Reads used up: a change still goes through.
    for (let i = 0; i < admin.TOKEN_CHANGES_PER_MINUTE; i++) ok(req("/api/admin/workers/x", { token, method: "PATCH" }));
    limited(req("/api/admin/workers/x", { token, method: "PATCH" }));
    const rows = auditRows().filter((r) => r.action === "rate.limited" && r.token_id === info.id);
    expect(rows.map((r) => JSON.parse(r.detail_json!).kind).sort()).toEqual(["change", "file", "read"]);
    // A minute later each works again.
    expect(admin.tokenActor(req("/api/admin/workers", { token }), now + 61_000)).toMatchObject({ kind: "token" });
  });

  it("logs a token's refusals once per scope and method, whatever the path", async () => {
    const { token, info } = make(["queue:read"]);
    for (let i = 0; i < 50; i++) await routes.account.GET(req(`/api/admin/accounts/x${i}`, { token }), ctx({ id: `x${i}` }));
    expect(auditRows().filter((r) => r.action === "scope.denied" && r.token_id === info.id)).toHaveLength(1);
  });

  it("slows down wrong tokens without ever blocking a valid one", async () => {
    const { token } = make(["queue:read"]);
    const statuses: number[] = [];
    for (let i = 0; i < 70; i++) statuses.push((admin.tokenActor(req("/api/admin/queue", { token: `fuobe_adm_${String(i).padStart(43, "0")}` })) as Response).status);
    expect(statuses.slice(0, 60).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(60).every((s) => s === 429)).toBe(true);
    expect((await routes.queue.GET(req("/api/admin/queue", { token }))).status).toBe(200);
  });
});

describe("admin tokens: the log", () => {
  it("writes a token's changes with its name, never its value; coalesces its reads", async () => {
    const { token, info } = make(["accounts:read", "accounts:write"]);
    const a = auth.createAccount(`logged-${++n}@example.com`, "long enough");
    const before = auditRows().length;
    await routes.account.PATCH(req(`/api/admin/accounts/${a.id}`, { token, method: "PATCH", body: { disabled: true } }), ctx({ id: a.id }));
    await routes.account.PATCH(req("/api/admin/accounts/nope", { token, method: "PATCH", body: { disabled: false } }), ctx({ id: "nope" }));
    await routes.accounts.GET(req("/api/admin/accounts", { token }));
    await routes.accounts.GET(req("/api/admin/accounts?q=logged", { token }));
    const rows = auditRows().slice(before);
    expect(rows.map((r) => [r.action, r.status])).toEqual([
      ["account.disable", 200],
      ["account.enable", 404],
      ["accounts.list", 200],
    ]);
    expect(rows[0]).toMatchObject({ actor: "token", token_id: info.id, token_name: info.name, target: a.id });
    const all = JSON.stringify(db().prepare("SELECT * FROM admin_audit").all());
    expect(all).not.toContain(token);
    expect(all).not.toContain("logged-");
  });

  it("reads the log in pages, filtered", async () => {
    const { token } = make(["audit:read"]);
    const first = (await (await routes.audit.GET(req("/api/admin/audit?limit=2", { token }))).json()) as { items: { id: number }[]; next: string | null };
    expect(first.items).toHaveLength(2);
    expect(first.items[0].id).toBeGreaterThan(first.items[1].id);
    expect(first.next).toBe(String(first.items[1].id));
    const second = (await (await routes.audit.GET(req(`/api/admin/audit?limit=2&before=${first.next}`, { token }))).json()) as { items: { id: number }[] };
    expect(second.items[0].id).toBeLessThan(first.items[1].id);
    const owner = (await (await routes.audit.GET(req("/api/admin/audit?actor=owner&limit=200", { token }))).json()) as { items: { actor: string }[] };
    expect(owner.items.every((r) => r.actor === "owner")).toBe(true);
    expect((await routes.audit.GET(req("/api/admin/audit?limit=500", { token }))).status).toBe(400);
    expect((await routes.audit.GET(req("/api/admin/audit?before=x", { token }))).status).toBe(400);
  });
});

describe("admin tokens: accounts and files", () => {
  it("finds accounts by part of the email or the exact email; totals still cover everyone", async () => {
    const { token } = make(["accounts:read"]);
    const a = auth.createAccount(`findme-${++n}@example.com`, "long enough");
    const all = (await (await routes.accounts.GET(req("/api/admin/accounts", { token }))).json()) as { total: number };
    const q = (await (await routes.accounts.GET(req("/api/admin/accounts?q=FINDME", { token }))).json()) as { total: number; matched: number; items: { id: string }[]; totals: { accounts: number } };
    expect(q.items.map((x) => x.id)).toEqual([a.id]);
    expect(q.matched).toBe(1);
    expect(q.total).toBe(all.total);
    expect(q.totals.accounts).toBe(all.total);
    const e = (await (await routes.accounts.GET(req(`/api/admin/accounts?email=${encodeURIComponent(a.email.toUpperCase())}`, { token }))).json()) as { items: { id: string }[] };
    expect(e.items.map((x) => x.id)).toEqual([a.id]);
    expect((await routes.accounts.GET(req("/api/admin/accounts?email=not-an-email", { token }))).status).toBe(400);
    expect((await routes.accounts.GET(req(`/api/admin/accounts?q=${"x".repeat(101)}`, { token }))).status).toBe(400);
    const one = await routes.account.GET(req(`/api/admin/accounts/${a.id}`, { token }), ctx({ id: a.id }));
    expect(await one.json()).toMatchObject({ id: a.id, email: a.email, runs: 0, bytes: 0 });
  });

  it("signs an account out everywhere and keeps it on", async () => {
    const { token } = make(["accounts:write"]);
    const a = auth.createAccount(`signout-${++n}@example.com`, "long enough");
    const s = auth.createSession(a.id).value;
    expect(auth.sessionViewer(s)?.kind).toBe("account");
    const paired = workers.createWorker({ name: "Studio PC", kind: "personal", principal: `acct:${a.id}` });
    expect(workers.workerFromAuth(`Bearer ${paired.token}`)?.id).toBe(paired.id);
    const res = await routes.account.PATCH(req(`/api/admin/accounts/${a.id}`, { token, method: "PATCH", body: { signOut: true } }), ctx({ id: a.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: a.id, disabled: false });
    expect(auth.sessionViewer(s)).toBeNull();
    // Its paired ComfyUI stops too: a worker token is no sign-in, so it is revoked.
    expect(workers.workerFromAuth(`Bearer ${paired.token}`)).toBeNull();
    expect(workers.pairedOf(`acct:${a.id}`)).toEqual([]);
    expect(JSON.parse(auditRows().at(-1)!.detail_json!)).toEqual({ computers: 1 });
    await new Promise((r) => setTimeout(r, 5));
    expect(auth.sessionViewer(auth.createSession(a.id).value)?.kind).toBe("account");
    expect(auditRows().at(-1)).toMatchObject({ action: "account.signout", target: a.id });
    expect((await routes.account.PATCH(req(`/api/admin/accounts/${a.id}`, { token, method: "PATCH", body: { signOut: true, disabled: true } }), ctx({ id: a.id }))).status).toBe(400);
    expect((await routes.account.PATCH(req("/api/admin/accounts/nope", { token, method: "PATCH", body: { signOut: true } }), ctx({ id: "nope" }))).status).toBe(404);
  });

  it("serves accounts' and held files to outputs:view, never the owner's, and logs each view", async () => {
    const { token, info } = make(["outputs:view"]);
    const a = auth.createAccount(`files-${++n}@example.com`, "long enough");
    const mine = saveFile({ data: TINY_PNG, contentType: "image/png", source: "upload" });
    const theirs = saveFile({ data: TINY_PNG, contentType: "image/png", source: "upload", accountId: a.id });
    const held = saveFile({ data: TINY_PNG, contentType: "image/png", source: "upload", accountId: a.id });
    const mineHeld = saveFile({ data: TINY_PNG, contentType: "image/png", source: "upload" });
    db().prepare("UPDATE assets SET held = 1 WHERE id IN (?, ?)").run(held.id, mineHeld.id);
    const get = (url: string) => {
      const rel = url.replace(/^\/api\/files\//, "");
      return routes.files.GET(req(`/api/admin/files/${rel}`, { token }), ctx({ path: rel.split("/") }));
    };
    const ok = await get(theirs.url);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(Buffer.from(await ok.arrayBuffer()).equals(TINY_PNG)).toBe(true);
    expect((await get(held.url)).status).toBe(200);
    expect((await get(mine.url)).status).toBe(404);
    expect((await get(mineHeld.url)).status).toBe(404);
    expect((await get("/api/files/outputs/none.png")).status).toBe(404);
    const views = auditRows().filter((r) => r.action === "file.view" && r.token_id === info.id);
    expect(views.map((v) => JSON.parse(v.detail_json!))).toEqual([{ account: a.id }, { account: a.id, held: true }]);
    // One row per file an hour.
    await get(theirs.url);
    expect(auditRows().filter((r) => r.action === "file.view" && r.token_id === info.id)).toHaveLength(2);
  });

  it("Sign everyone out with every API token revokes admin tokens too", async () => {
    const { token } = make(["queue:read"]);
    expect((await routes.queue.GET(req("/api/admin/queue", { token }))).status).toBe(200);
    const res = await routes.sessions.POST(req("/api/auth/sessions", { cookie: ownerCookie, method: "POST", body: { tokens: true } }));
    expect(res.status).toBe(200);
    expect((await routes.queue.GET(req("/api/admin/queue", { token }))).status).toBe(401);
    expect(admin.liveAdminTokenCount()).toBe(0);
    expect(auditRows().at(-1)).toMatchObject({ actor: "owner", action: "token.revoke_all", status: 200 });
    expect(JSON.parse(auditRows().at(-1)!.detail_json!).count).toBeGreaterThanOrEqual(1);
    ownerCookie = auth.createSession().value;
  });
});

describe("admin tokens: runs, the log's changes and every admin route", () => {
  it("says whether each of an account's results is shown, held or removed", async () => {
    const { token } = make(["runs:read", "outputs:moderate"]);
    const a = auth.createAccount(`runs-${++n}@example.com`, "long enough");
    const id = `run-state-${++n}`;
    db()
      .prepare("INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at) VALUES (?, 'image', 'm', 'open', 'comfyui', 't2i', 'image', 'succeeded', ?, '[]', ?, ?)")
      .run(id, JSON.stringify({ feature: "image", modelId: "m", prompt: "p", account: a.id }), Date.now(), Date.now());
    const files = [0, 1, 2].map(() => saveFile({ data: TINY_PNG, contentType: "image/png", source: "generation", generationId: id }));
    // The last one is listed by its url only.
    db()
      .prepare("UPDATE generations SET outputs_json = ? WHERE id = ?")
      .run(JSON.stringify(files.map((f, i) => ({ url: f.url, kind: "image", ...(i < 2 && { assetId: f.id }) }))), id);
    const states = async () => {
      const page = (await (await routes.runs.GET(req(`/api/admin/generations?account=${a.id}`, { token }))).json()) as { items: { id: string; outputs: { url: string; state: string }[] }[] };
      return page.items.find((r) => r.id === id)!.outputs.map((o) => o.state);
    };
    expect(await states()).toEqual(["shown", "shown", "shown"]);
    const body = (assetIds: string[]) => ({ token, method: "POST", body: { assetIds } });
    await routes.outputs.POST(req("/api/admin/outputs/hide", body([files[1].id])), ctx({ action: "hide" }));
    expect(await states()).toEqual(["shown", "held", "shown"]);
    // Removing a result listed by url only takes it off the run too.
    await routes.outputs.POST(req("/api/admin/outputs/remove", body([files[2].id])), ctx({ action: "remove" }));
    expect(await states()).toEqual(["shown", "held"]);
    db().prepare("DELETE FROM assets WHERE id = ?").run(files[0].id);
    expect(await states()).toEqual(["removed", "held"]);
  });

  it("filters the log to changes", async () => {
    const { token } = make(["audit:read", "queue:read"]);
    await routes.accounts.GET(req("/api/admin/accounts", { token }));
    const page = (await (await routes.audit.GET(req("/api/admin/audit?changes=1&limit=200", { token }))).json()) as { items: { action: string }[] };
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.some((r) => admin.READ_ACTIONS.includes(r.action))).toBe(false);
    expect((await routes.audit.GET(req("/api/admin/audit?changes=yes", { token }))).status).toBe(400);
  });

  it("every admin route checks who asks itself (the proxy lets any admin token through to them)", () => {
    const root = path.join(process.cwd(), "src", "app", "api", "admin");
    const found: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === "route.ts") found.push(p);
      }
    };
    walk(root);
    expect(found.length).toBeGreaterThanOrEqual(14);
    for (const f of found) {
      const src = fs.readFileSync(f, "utf8");
      const handlers = src.match(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g) ?? [];
      const checks = src.match(/\b(adminAccess|ownerBrowser|tokenActor)\(/g) ?? [];
      expect(handlers.length, f).toBeGreaterThan(0);
      expect(checks.length, f).toBeGreaterThanOrEqual(handlers.length);
    }
  });
});

describe("admin tokens: accounts' content needs its own scopes", () => {
  /** An account's finished run with a prompt and a stored result, and a report from it. */
  function accountRun() {
    const a = auth.createAccount(`content-${++n}@example.com`, "long enough");
    const file = saveFile({ data: TINY_PNG, contentType: "image/png", source: "generation", accountId: a.id });
    const id = `content-run-${n}`;
    const now = Date.now();
    db()
      .prepare(
        "INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, prompt, request_json, outputs_json, created_at, updated_at, completed_at) VALUES (?, 'image', 'oss-z-image-turbo', 'open', 'comfyui', 't2i', 'image', 'succeeded', ?, ?, ?, ?, ?, ?)",
      )
      .run(id, "a private prompt", JSON.stringify({ account: a.id, feature: "image", modelId: "oss-z-image-turbo", prompt: "a private prompt" }), JSON.stringify([{ url: file.url, kind: "image", contentType: "image/png" }]), now, now, now);
    return { account: a, id };
  }
  type Page = { items: { id: string; prompt?: string; request?: unknown; outputs: { url?: string; state: string }[]; account: { id: string; email: string | null } }[] };
  const runsOf = async (token?: string, cookie?: string) => (await (await routes.runs.GET(req("/api/admin/generations?limit=100", { token, cookie }))).json()) as Page;

  it("runs:read alone gets each run's facts: no prompt, no request, no result file, no email", async () => {
    const r = accountRun();
    const page = await runsOf(make(["runs:read"]).token);
    const run = page.items.find((x) => x.id === r.id)!;
    expect(run).toBeDefined();
    expect(run.prompt).toBeUndefined();
    expect(run.request).toBeUndefined();
    expect(run.outputs).toEqual([{ kind: "image", state: "shown" }]);
    expect(run.account).toEqual({ id: r.account.id, email: null });
    expect(JSON.stringify(page)).not.toContain("a private prompt");
  });

  it("outputs:view adds the content and accounts:read the email; the owner sees both", async () => {
    const r = accountRun();
    const withContent = (await runsOf(make(["runs:read", "outputs:view"]).token)).items.find((x) => x.id === r.id)!;
    expect(withContent.prompt).toBe("a private prompt");
    expect(withContent.outputs[0].url).toMatch(/^\/api\/files\//);
    expect(withContent.account.email).toBeNull();
    const withEmail = (await runsOf(make(["runs:read", "accounts:read"]).token)).items.find((x) => x.id === r.id)!;
    expect(withEmail.account.email).toBe(r.account.email);
    expect(withEmail.prompt).toBeUndefined();
    const owner = (await runsOf(undefined, ownerCookie)).items.find((x) => x.id === r.id)!;
    expect(owner.prompt).toBe("a private prompt");
    expect(owner.account.email).toBe(r.account.email);
  });

  it("every read of an account's content is logged with the account as its target, the owner's reads too", async () => {
    const r = accountRun();
    const before = auditRows().length;
    await runsOf(undefined, ownerCookie);
    const rows = auditRows().slice(before);
    expect(rows.some((x) => x.action === "runs.content" && x.actor === "owner" && x.target === r.account.id)).toBe(true);
    // Facts only: no content read to log.
    const facts = make(["runs:read"]);
    const mark = auditRows().length;
    await runsOf(facts.token);
    expect(auditRows().slice(mark).some((x) => x.action === "runs.content")).toBe(false);
    // The owner opening an account's file is logged too.
    const file = saveFile({ data: TINY_PNG, contentType: "image/png", source: "upload", accountId: r.account.id });
    const rel = file.url.replace(/^\/api\/files\//, "");
    const res = await routes.files.GET(req(`/api/admin/files/${rel}`, { cookie: ownerCookie }), ctx({ path: rel.split("/") }));
    expect(res.status).toBe(200);
    await res.arrayBuffer();
    expect(auditRows().some((x) => x.action === "file.view" && x.actor === "owner" && JSON.parse(x.detail_json!).account === r.account.id)).toBe(true);
  });

  it("reporters' emails need accounts:read, and the read-only preset holds no email or content scope", async () => {
    db()
      .prepare("INSERT INTO reports_inbox (id, target_json, category, text, reporter, created_at) VALUES (?, ?, 'other', 'words', ?, ?)")
      .run(`rep-${++n}`, JSON.stringify({ kind: "share", id: "x" }), JSON.stringify({ account: "acct-x", email: "reporter@example.com" }), Date.now());
    const plain = (await (await routes.reports.GET(req("/api/admin/reports", { token: make(["reports:read"]).token }))).json()) as { items: { reporter: { email: string | null } }[] };
    expect(plain.items[0].reporter.email).toBeNull();
    const withEmail = (await (await routes.reports.GET(req("/api/admin/reports", { token: make(["reports:read", "accounts:read"]).token }))).json()) as { items: { reporter: { email: string | null } }[] };
    expect(withEmail.items[0].reporter.email).toBe("reporter@example.com");
    expect(admin.READ_ONLY_SCOPES).not.toContain("accounts:read");
    expect(admin.READ_ONLY_SCOPES).not.toContain("outputs:view");
  });
});
