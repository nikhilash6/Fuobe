import "server-only";
import crypto from "node:crypto";
import { authEnabled, hasAdminBearer, isOwnerRequest, LoginGuard, sessionCookieOf, validSession } from "./auth";
import { READ_ONLY_SCOPES as PRESET_READ_ONLY } from "@/lib/admin-scopes";
import { db } from "./db";
import { hit } from "./rate";

/**
 * Admin tokens: an install can be managed from your own tools with an admin API token (docs/admin-api.md).
 *
 * A token (`fuobe_adm_` + 43 characters) works only on /api/admin (src/proxy.ts refuses it everywhere else), and only for
 * the scopes the owner ticked when making it in Settings → Security. It is never the owner: it can't sign in, open a
 * page, change settings or make tokens. A request that carries one is checked by the token alone (a session cookie beside
 * it is ignored). Only its SHA-256 is stored; the token itself is in the answer that made it and nowhere else.
 *
 * Every change made through the admin API (by the owner or a token) is written to admin_audit, and so are a token's
 * reads of people's data (coalesced), each file it views, and the refusals of a valid token. Never a token, a password,
 * a prompt or an IP address.
 */

export const SCOPES = [
  "accounts:read",
  "accounts:write",
  "accounts:delete",
  "runs:read",
  "runs:delete",
  "outputs:view",
  "outputs:hide",
  "outputs:moderate",
  "reports:read",
  "workers:read",
  "workers:write",
  "workers:tokens",
  "queue:read",
  "queue:write",
  "site:read",
  "site:write",
  "audit:read",
] as const;

export type Scope = (typeof SCOPES)[number];

/** What each scope lets a token do, in the words Settings shows. */
export const SCOPE_LABELS: Record<Scope, string> = {
  "accounts:read": "See accounts",
  "accounts:write": "Switch accounts off and on, sign them out",
  "accounts:delete": "Delete accounts",
  "runs:read": "See accounts' runs: when, which model and how they ended (their prompts and results need Open accounts' files; emails need See accounts)",
  "runs:delete": "Delete accounts' runs",
  "outputs:view": "Open accounts' files, and read their runs' prompts and results",
  "outputs:hide": "Hide results",
  "outputs:moderate": "Hide, show again and remove results",
  "reports:read": "See reports (reporters' emails need See accounts)",
  "workers:read": "See workers",
  "workers:write": "Pause, resume, change and revoke workers",
  "workers:tokens": "Add workers and give them new tokens (a worker runs accounts' queued jobs, with their files)",
  "queue:read": "See the queue and its settings",
  "queue:write": "Change the queue's settings: the run ceiling, the owner's wait limit, fair share, the pick allowance and the paused budget",
  "site:read": "See the site's switches: the upload fitting steps",
  "site:write": "Switch the upload fitting steps off and on: convert, offer a part, offer a crop",
  "audit:read": "See the admin log",
};

/** The Settings preset that only reads: no emails, no prompts and no results (those need their own scopes). */
export const READ_ONLY_SCOPES: readonly Scope[] = PRESET_READ_ONLY;

export const ADMIN_TOKEN_PREFIX = "fuobe_adm_";
const SHAPE = /^fuobe_adm_[A-Za-z0-9_-]{43}$/;
/** Live (not revoked, not expired) tokens an install may hold at once. */
export const MAX_LIVE_TOKENS = 20;
const NAME_MAX = 60;

/** What a token may send a minute: reads, changes and file views, each counted on its own. */
export const TOKEN_PER_MINUTE = 120;
export const TOKEN_CHANGES_PER_MINUTE = 30;
export const FILE_VIEWS_PER_MINUTE = 600;
/** Wrong tokens a client may send a minute (or every client together, when they can't be told apart). */
const MISSES_PER_MINUTE = 10;
const SHARED_MISSES_PER_MINUTE = 60;

const MINUTE = 60_000;
const DAY = 86_400_000;
const AUDIT_KEEP_MS = 365 * DAY;

export interface AdminTokenInfo {
  id: string;
  name: string;
  /** The first 14 characters ("fuobe_adm_Xy3k"), shown with an ellipsis. */
  prefix: string;
  scopes: Scope[];
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export type Actor = { kind: "owner" } | { kind: "token"; id: string; name: string; scopes: Scope[] };

export class AdminTokenError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface TokenRow {
  id: string;
  name: string;
  hash: string;
  prefix: string;
  scopes_json: string;
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
}

const NO_STORE = { "Cache-Control": "no-store" };

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

const isScope = (s: unknown): s is Scope => typeof s === "string" && (SCOPES as readonly string[]).includes(s);

function scopesOf(json: string): Scope[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v) ? v.filter(isScope) : [];
  } catch {
    return [];
  }
}

const info = (r: TokenRow): AdminTokenInfo => ({
  id: r.id,
  name: r.name,
  prefix: r.prefix,
  scopes: scopesOf(r.scopes_json),
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  lastUsedAt: r.last_used_at,
  revokedAt: r.revoked_at,
});

const LIVE_SQL = "revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)";

const liveRows = (now = Date.now()) => db().prepare(`SELECT * FROM admin_tokens WHERE ${LIVE_SQL}`).all(now) as TokenRow[];

/** The tokens Settings lists: every one not revoked (an expired one too, marked so), newest first. */
export function listAdminTokens(): AdminTokenInfo[] {
  return (db().prepare("SELECT * FROM admin_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC").all() as TokenRow[]).map(info);
}

/** Live tokens: not revoked and not expired. */
export const liveAdminTokenCount = (now = Date.now()) => (db().prepare(`SELECT COUNT(*) AS n FROM admin_tokens WHERE ${LIVE_SQL}`).get(now) as { n: number }).n;

/** Make a token. Its value is in this answer only; the database keeps its SHA-256. */
export function createAdminToken(input: { name: unknown; scopes: unknown; expiresInDays?: unknown }, now = Date.now()): { token: string; info: AdminTokenInfo } {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > NAME_MAX) throw new AdminTokenError(`Name the token (up to ${NAME_MAX} characters)`, 400);
  if (!Array.isArray(input.scopes) || !input.scopes.length || !input.scopes.every(isScope)) throw new AdminTokenError("Pick what the token may do", 400);
  const scopes = [...new Set(input.scopes as Scope[])].sort();
  const days = input.expiresInDays ?? null;
  if (days !== null && !(typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= 365)) throw new AdminTokenError("An expiry is 1 to 365 days, or never", 400);
  const live = liveRows(now);
  if (live.length >= MAX_LIVE_TOKENS) throw new AdminTokenError(`An install keeps at most ${MAX_LIVE_TOKENS} admin tokens. Revoke one first.`, 409);
  if (live.some((r) => r.name.toLowerCase() === name.toLowerCase())) throw new AdminTokenError("An admin token with that name exists", 409);
  const token = `${ADMIN_TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  const row: TokenRow = {
    id: crypto.randomBytes(6).toString("hex"),
    name,
    hash: sha256(token),
    prefix: token.slice(0, 14),
    scopes_json: JSON.stringify(scopes),
    created_at: now,
    expires_at: days === null ? null : now + days * DAY,
    last_used_at: null,
    revoked_at: null,
  };
  db()
    .prepare("INSERT INTO admin_tokens (id, name, hash, prefix, scopes_json, created_at, expires_at) VALUES (@id, @name, @hash, @prefix, @scopes_json, @created_at, @expires_at)")
    .run(row);
  return { token, info: info(row) };
}

/** Revoke a token: it stops working at once. Its row stays, so the log can still name it. Null when there is no such token, or it was revoked already. */
export function revokeAdminToken(id: string, now = Date.now()): AdminTokenInfo | null {
  const row = db().prepare("SELECT * FROM admin_tokens WHERE id = ? AND revoked_at IS NULL").get(id) as TokenRow | undefined;
  if (!row) return null;
  db().prepare("UPDATE admin_tokens SET revoked_at = ? WHERE id = ?").run(now, id);
  return info({ ...row, revoked_at: now });
}

/** Settings → Security → Sign everyone out, with every API token revoked: admin tokens go too. How many were revoked. */
export function revokeAllAdminTokens(now = Date.now()): number {
  return db().prepare("UPDATE admin_tokens SET revoked_at = ? WHERE revoked_at IS NULL").run(now).changes;
}

// ---------------------------------------------------------------------------
// Checking a request

declare global {
  var __fuobeAdminTouched: Map<string, number> | undefined;
  var __fuobeAdminAuditSeen: Map<string, number> | undefined;
  var __fuobeAdminAuditPruned: number | undefined;
}

/**
 * The live token this value is, or null. Its SHA-256 is compared with every live token's in constant time (no lookup
 * by hash, no early exit), so the answer's timing says nothing about how close a guess came.
 */
function findToken(value: string, now: number): TokenRow | null {
  const h = Buffer.from(sha256(value), "hex");
  let found: TokenRow | null = null;
  for (const row of liveRows(now)) {
    const other = Buffer.from(row.hash, "hex");
    if (other.length === h.length && crypto.timingSafeEqual(other, h) && !found) found = row;
  }
  return SHAPE.test(value) ? found : null;
}

const json = (body: Record<string, unknown>, status: number, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { ...NO_STORE, ...headers } });

const invalid = () => json({ error: "This admin token isn't valid.", code: "token" }, 401, { "WWW-Authenticate": 'Bearer realm="fuobe", error="invalid_token"' });
const tooMany = (seconds: number) => json({ error: "Too many requests. Try again in a minute.", code: "rate" }, 429, { "Retry-After": String(seconds) });

/** Write a token's last use at most once a minute (not a write per request). */
function touch(id: string, now: number): void {
  const touched = (globalThis.__fuobeAdminTouched ??= new Map());
  if (now - (touched.get(id) ?? 0) < MINUTE) return;
  touched.set(id, now);
  db().prepare("UPDATE admin_tokens SET last_used_at = ? WHERE id = ?").run(now, id);
}

const isChange = (method: string) => !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());

/**
 * The admin token this request carries, checked: its actor, or the answer to send (401 unknown, revoked or expired;
 * 429 past a limit). Null when the request carries no admin token. Misses count against the client's own budget,
 * checked only after the token was found wrong, so someone else's misses never slow down a valid token.
 */
export function tokenActor(request: Request, now = Date.now()): Extract<Actor, { kind: "token" }> | Response | null {
  if (!hasAdminBearer(request)) return null;
  const value = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const row = findToken(value, now);
  if (!row) {
    const client = LoginGuard.clientKey(request.headers);
    const shared = client === LoginGuard.DIRECT;
    const r = hit(`admin-miss:${client}`, shared ? SHARED_MISSES_PER_MINUTE : MISSES_PER_MINUTE, MINUTE, now);
    return r.ok ? invalid() : tooMany(r.retryAfterS);
  }
  const actor = { kind: "token" as const, id: row.id, name: row.name, scopes: scopesOf(row.scopes_json) };
  // Reads, changes and file views each have their own budget: a page of previews never uses up the next change.
  const kind = isChange(request.method) ? "change" : new URL(request.url).pathname.startsWith("/api/admin/files/") ? "file" : "read";
  const budget = { change: TOKEN_CHANGES_PER_MINUTE, file: FILE_VIEWS_PER_MINUTE, read: TOKEN_PER_MINUTE }[kind];
  const r = hit(`admin-${kind}:${row.id}`, budget, MINUTE, now);
  if (!r.ok) {
    auditOnce(`rate:${row.id}:${kind}`, MINUTE, actor, "rate.limited", null, { kind }, 429, now);
    return tooMany(r.retryAfterS);
  }
  touch(row.id, now);
  return actor;
}

/**
 * Who may use an admin route: a token with one of `scopes`, or (with no admin token on the request) the owner, as
 * before. `denied` is the route's own answer for anyone else. Returns the actor, or the answer to send.
 */
export function adminAccess(request: Request, scopes: Scope | Scope[], denied: string): { actor: Actor } | Response {
  const t = tokenActor(request);
  if (t instanceof Response) return t;
  if (t) {
    return lacksScope(t, scopes, request) ?? { actor: t };
  }
  if (isOwnerRequest(request, sessionCookieOf(request))) return { actor: { kind: "owner" } };
  return json({ error: denied }, 403);
}

/**
 * The 403 for a token that has none of `scopes` (logged once a minute per token, scope and method), or null when it has
 * one. The owner always may. For a need that depends on the body (a worker's new token), call it after adminAccess.
 */
export function lacksScope(actor: Actor, scopes: Scope | Scope[], request: Request): Response | null {
  if (actor.kind !== "token") return null;
  const wanted = Array.isArray(scopes) ? scopes : [scopes];
  if (wanted.some((s) => actor.scopes.includes(s))) return null;
  auditOnce(`scope:${actor.id}:${wanted[0]}:${request.method}`, MINUTE, actor, "scope.denied", null, { scope: wanted[0], method: request.method }, 403);
  return json({ error: "This admin token can't do that.", code: "scope", scope: wanted[0] }, 403);
}

/**
 * The owner's signed-in browser (or anyone while no password is set): the only one who may make, list or revoke admin
 * tokens. An owner API token or an admin token can't.
 */
export function ownerBrowser(request: Request): boolean {
  if (hasAdminBearer(request)) return false;
  return !authEnabled() || validSession(sessionCookieOf(request));
}

// ---------------------------------------------------------------------------
// The log

export interface AuditRow {
  id: number;
  at: number;
  /** "system": the studio itself (an alert about a worker's token). */
  actor: "owner" | "token" | "system";
  token: { id: string; name: string } | null;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
  status: number;
}

const DETAIL_MAX = 2000;

function prune(now: number): void {
  if (now - (globalThis.__fuobeAdminAuditPruned ?? 0) < DAY) return;
  globalThis.__fuobeAdminAuditPruned = now;
  db().prepare("DELETE FROM admin_audit WHERE at < ?").run(now - AUDIT_KEEP_MS);
}

/** Write one row: who (the owner, or a token by id and its name at the time), what, on what, and the status answered. */
export function audit(actor: Actor, action: string, target: string | null, detail: Record<string, unknown> | null, status: number, now = Date.now()): void {
  let d = detail ? JSON.stringify(detail) : null;
  if (d && d.length > DETAIL_MAX) d = JSON.stringify({ truncated: true });
  try {
    db()
      .prepare("INSERT INTO admin_audit (at, actor, token_id, token_name, action, target, detail_json, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run(now, actor.kind, actor.kind === "token" ? actor.id : null, actor.kind === "token" ? actor.name : null, action, target ? target.slice(0, 300) : null, d, status);
    prune(now);
  } catch (e) {
    console.warn(`[fuobe] Couldn't write the admin log: ${(e as Error).message}`);
  }
}

const SEEN_MAX = 5000;
const SEEN_KEEP = 4000;

/** One row per key in `windowMs`: a token's repeated reads or refusals don't fill the log. */
function auditOnce(key: string, windowMs: number, actor: Actor, action: string, target: string | null, detail: Record<string, unknown> | null, status: number, now = Date.now()): void {
  const seen = (globalThis.__fuobeAdminAuditSeen ??= new Map());
  if (now - (seen.get(key) ?? 0) < windowMs) return;
  // In the order last written: past SEEN_MAX keys, the oldest go (a key that comes back only writes one more row).
  seen.delete(key);
  seen.set(key, now);
  if (seen.size > SEEN_MAX) for (const k of [...seen.keys()].slice(0, seen.size - SEEN_KEEP)) seen.delete(k);
  audit(actor, action, target, detail, status, now);
}

/** Actions that change nothing: a token's reads, its file views and refusals (the log's "only changes" leaves them out). */
export const READ_ACTIONS = ["accounts.list", "accounts.csv", "account.read", "runs.list", "runs.content", "reports.list", "audit.read", "file.view", "scope.denied", "rate.limited"];

/** A token's read of people's data: one row per token and action every 10 minutes. The owner's own reads aren't logged. */
export function auditRead(actor: Actor, action: string, detail: Record<string, unknown> | null = null, target: string | null = null): void {
  if (actor.kind !== "token") return;
  auditOnce(`read:${actor.id}:${action}:${target ?? ""}`, 10 * MINUTE, actor, action, target, detail, 200);
}

/** May this actor do what `scope` allows (the owner may do everything)? */
export const actorHas = (actor: Actor, scope: Scope): boolean => actor.kind === "owner" || actor.scopes.includes(scope);

/**
 * A read of accounts' content (their runs' prompts and results), by the owner or a token: one row per reader, action and
 * account every 10 minutes, with the account as the row's target, so the log says whose content was read.
 */
export function auditContentRead(actor: Actor, action: string, accounts: Iterable<string>, detail: Record<string, unknown> | null = null): void {
  const who = actor.kind === "token" ? actor.id : "owner";
  for (const account of new Set(accounts)) auditOnce(`content:${who}:${action}:${account}`, 10 * MINUTE, actor, action, account, detail, 200);
}

/** A stored file of an account's was opened (by a token or the owner): one row per reader and file every hour. */
export function auditFileView(actor: Actor, path: string, account: string, held = false): void {
  const who = actor.kind === "token" ? actor.id : "owner";
  auditOnce(`file:${who}:${path}`, 60 * MINUTE, actor, "file.view", path, { account, ...(held && { held: true }) }, 200);
}

export interface AuditQuery {
  before?: number;
  limit: number;
  actor?: "owner" | "token" | "system";
  token?: string;
  action?: string;
  /** Changes only: no reads, file views or refusals. */
  changes?: boolean;
}

/** GET /api/admin/audit's query, or the reason it's wrong. */
export function auditQueryFrom(sp: URLSearchParams): AuditQuery | { error: string } {
  const before = sp.get("before");
  if (before !== null && !/^\d{1,15}$/.test(before)) return { error: "before is a row id" };
  const limitRaw = sp.get("limit");
  const limit = limitRaw === null ? 50 : Math.trunc(Number(limitRaw));
  if (!Number.isFinite(limit) || limit < 1 || limit > 200) return { error: "limit is 1 to 200" };
  const actor = sp.get("actor");
  if (actor !== null && actor !== "owner" && actor !== "token" && actor !== "system") return { error: "actor is owner, token or system" };
  const token = sp.get("token");
  if (token !== null && !/^[0-9a-f]{12}$/.test(token)) return { error: "token is a token id" };
  const action = sp.get("action");
  if (action !== null && !/^[a-z_.]{1,40}$/.test(action)) return { error: "Unknown action" };
  const changes = sp.get("changes");
  if (changes !== null && changes !== "1") return { error: "changes is 1" };
  return { limit, ...(before !== null && { before: Number(before) }), ...(actor && { actor }), ...(token && { token }), ...(action && { action }), ...(changes && { changes: true }) };
}

/** The log, newest first; `next` is the last row's id (pass it as `before`), null on the last page. */
export function listAudit(q: AuditQuery): { items: AuditRow[]; next: string | null } {
  const filters: [string, string | number | undefined][] = [
    ["id < ?", q.before],
    ["actor = ?", q.actor],
    ["token_id = ?", q.token],
    ["action = ?", q.action],
  ];
  const used = filters.filter((f): f is [string, string | number] => f[1] !== undefined);
  const where = used.map((f) => f[0]);
  const args: (string | number)[] = used.map((f) => f[1]);
  if (q.changes) {
    where.push(`action NOT IN (${READ_ACTIONS.map(() => "?").join(", ")})`);
    args.push(...READ_ACTIONS);
  }
  const rows = db()
    .prepare(`SELECT * FROM admin_audit ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`)
    .all(...args, q.limit) as { id: number; at: number; actor: string; token_id: string | null; token_name: string | null; action: string; target: string | null; detail_json: string | null; status: number }[];
  const items = rows.map((r) => ({
    id: r.id,
    at: r.at,
    actor: r.actor === "token" ? ("token" as const) : r.actor === "system" ? ("system" as const) : ("owner" as const),
    token: r.token_id ? { id: r.token_id, name: r.token_name ?? "" } : null,
    action: r.action,
    target: r.target,
    detail: parseDetail(r.detail_json),
    status: r.status,
  }));
  return { items, next: items.length === q.limit ? String(items[items.length - 1].id) : null };
}

function parseDetail(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
