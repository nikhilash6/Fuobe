/**
 * Where sign-in data lives: tables in the studio's SQLite database (AUTH_TABLES in src/server/db.ts): the install's
 * cookie secret and Settings password, API tokens, accounts with their GPU links and sealed keys, and signed-out
 * cookies. src/server/auth.ts reads and writes them; this file decides whether they can be used, and moves an older
 * install's data/auth.json in.
 *
 * Moving auth.json in, once, on the first start of this build:
 * - Everything goes in inside one transaction that first takes the database's write lock. Inside it the rows are
 *   counted and every account, token and setting is read back and compared with the file. The marker row
 *   (auth_migration) is written in the same transaction, so a crash leaves either nothing (the next start moves it again)
 *   or everything. A second server starting at the same time waits for the lock, then finds the marker.
 * - A file that can't be read or parsed keeps today's safety: sign-in stays on, nobody is signed in, nothing is written.
 * - A file whose data can't go in (two accounts with one email…) changes nothing either; sign-in fails closed and the
 *   proxy answers 503, so a new release that can't start cleanly is never switched to.
 *
 * A server of an older build may still be running on the same data folder for a while (a deploy that starts the new
 * server before it stops the old one). Taking auth.json away at once would leave that server with no password at all.
 * So for 10 minutes ("bridge") the database leads and auth.json is kept as an exact copy of it: each change here is
 * also written to the file, and a change the older server makes to the file is read back in. Once the file has been
 * quiet for 3 minutes after that, it is put aside as auth.json.migrated-<UTC time> (kept, never deleted) and a note
 * takes its place (TOMBSTONE): JSON that every older build reads as "sign-in on, nobody can sign in", so an older build
 * pointed at this folder later never opens the studio. A new install gets the note with its first sign-in change.
 *
 * Going back to an older build: scripts/auth-export.mjs writes auth.json from the database again and marks the store
 * "exported". The next start of this build moves that file back in (with what the older build changed in it) and
 * bridges again. Any other auth.json found beside a store that was already moved (a backup copied back) is never read
 * on its own: sign-in fails closed (503) until it is removed, or FUOBE_AUTH_REIMPORT=1 says to move it in.
 */
import "server-only";
import type Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Account, AccountGpu, ApiToken, StoredKey } from "./auth";
import { DATA_DIR, db } from "./db";

export const AUTH_FILE = path.join(DATA_DIR, "auth.json");

/** The file an older build keeps sign-in data in: what is moved in, and what is kept in step during the bridge. */
export interface AuthJson {
  password?: string;
  secret: string;
  tokens: ApiToken[];
  accounts?: Account[];
  publicSignup?: boolean;
  signedOut?: { hash: string; exp: number }[];
  [extra: string]: unknown;
}

/**
 * - fresh: nothing yet (a new install): no password, no accounts; the first change sets the store up.
 * - bridge / done: the database is the store (see above).
 * - unreadable: an auth.json that can't be read or parsed is waiting to be moved in.
 * - failed: the database or the move failed. unreadable and failed both fail closed.
 */
export type AuthStoreMode = "fresh" | "bridge" | "done" | "unreadable" | "failed";

interface Marker {
  source: "auth.json" | "new";
  state: "bridge" | "done" | "exported";
  started_at: number;
  synced_at: number | null;
  json_stat: string | null;
  json_sha256: string | null;
  counts_json: string | null;
  backup_file: string | null;
  retired_at: number | null;
  /** exported: auth_install.version when scripts/auth-export.mjs wrote auth.json. */
  exported_version: number | null;
}

interface Counts {
  accounts: number;
  tokens: number;
  keys: number;
  gpus: number;
  signedOut: number;
}

/** auth.json's data can't be moved in as it is (never says which account: no email or secret goes in a log). */
class DataError extends Error {}

const envMs = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return process.env[name]?.trim() && Number.isFinite(v) && v >= 0 ? v : fallback;
};
/** How long auth.json is kept in step after it was moved in (FUOBE_AUTH_BRIDGE_MS, for tests). */
const bridgeMs = () => envMs("FUOBE_AUTH_BRIDGE_MS", 10 * 60_000);
/** How long auth.json must have gone unchanged by anyone else before it is put aside. */
const quietMs = () => Math.min(3 * 60_000, bridgeMs());

declare global {
  /** Tests: the store's clock. */
  var __fuobeAuthClock: (() => number) | undefined;
  /** Tests: called while moving auth.json in, after half the accounts (a crash in the middle). */
  var __fuobeAuthImportFault: (() => void) | undefined;
  var __fuobeAuthStoreTimer: NodeJS.Timeout | undefined;
}

const now = () => globalThis.__fuobeAuthClock?.() ?? Date.now();

/** How often a server whose store was moved looks at auth.json again (for a file put back, or an unfinished rename). */
const FILE_CHECK_MS = 60_000;

const s = {
  /** The store was moved (done or exported) and auth.json was looked at, at fileCheckedAt. */
  done: false,
  fileCheckedAt: 0,
  /** What that look found that keeps sign-in closed (an auth.json put back, or one that can't go in). */
  held: null as { mode: "unreadable" | "failed"; message: string } | null,
  /** The auth.json (by its stat) last found unreadable, or whose data couldn't go in, and when. */
  bad: null as { key: string; mode: "unreadable" | "failed"; at: number; data: boolean } | null,
  /** The database couldn't be used: try again after a moment. */
  dbFailedAt: 0,
  /** In the bridge: an auth.json (by its stat) that couldn't be read back in. */
  bridgeBad: null as string | null,
  retireCheckedAt: 0,
  warned: { unreadable: 0, failed: 0 },
  writes: 0,
};

const HOUR = 60 * 60_000;

function warnOnce(kind: keyof typeof s.warned, message: string, error = false): void {
  if (Date.now() - s.warned[kind] < HOUR) return;
  s.warned[kind] = Date.now();
  if (error) console.error(`[fuobe] ${message}`);
  else console.warn(`[fuobe] ${message}`);
}

// ---------------------------------------------------------------------------
// Prepared statements

const statements = new WeakMap<Database.Database, Map<string, Database.Statement>>();

/** A prepared statement on the database, made once. */
export function sql(text: string): Database.Statement {
  const d = db();
  let m = statements.get(d);
  if (!m) statements.set(d, (m = new Map()));
  let st = m.get(text);
  if (!st) m.set(text, (st = d.prepare(text)));
  return st;
}

const marker = () => sql("SELECT * FROM auth_migration WHERE id = 1").get() as Marker | undefined;

const hasRows = () =>
  !!(sql("SELECT EXISTS(SELECT 1 FROM auth_install) OR EXISTS(SELECT 1 FROM auth_accounts) OR EXISTS(SELECT 1 FROM auth_tokens) OR EXISTS(SELECT 1 FROM auth_signed_out) AS n").get() as { n: number }).n;

/** A transaction that takes the write lock first. Another server holding it longer than the busy timeout: try again. */
function immediate<T>(fn: () => T): T {
  const d = db();
  for (let i = 0; ; i++) {
    try {
      return d.transaction(fn).immediate();
    } catch (e) {
      if ((e as { code?: string }).code === "SQLITE_BUSY" && i < 5 && !d.inTransaction) continue;
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// auth.json on disk

/** Its stat as "mtime:size:inode", null when there is none, "error:<code>" when it can't even be looked at. */
function statKey(): string | null {
  try {
    const st = fs.statSync(AUTH_FILE);
    return `${st.mtimeMs}:${st.size}:${st.ino}`;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === "ENOENT" ? null : `error:${code}`;
  }
}

type FileRead = { data: AuthJson; key: string | null; sha: string } | { error: string };

function readFile(): FileRead {
  try {
    const key = statKey();
    const raw = fs.readFileSync(AUTH_FILE);
    let data: AuthJson | null;
    try {
      data = JSON.parse(raw.toString("utf8")) as AuthJson | null;
    } catch {
      // Never the parser's message: it quotes the file.
      return { error: raw.toString("utf8").startsWith(TEXT_TOMBSTONE_HEAD) ? "tombstone" : "not valid JSON" };
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return { error: "not an object" };
    if (isTombstone(data)) return { error: "tombstone" };
    return { data, key, sha: crypto.createHash("sha256").update(raw).digest("hex") };
  } catch (e) {
    return { error: (e as NodeJS.ErrnoException).code ?? "can't be read" };
  }
}

/**
 * The note left in place of auth.json once it was moved: JSON that every older build reads as "sign-in on, nobody can
 * sign in". Builds from 2026-10-31 on read `unreadable: true` as a file they can't read: they fail closed and never
 * write over it. Older ones see a password whose hash (1 byte) no scrypt result (32 bytes) can match, no secret (no
 * cookie is valid) and no tokens. Each of them, and the account sweep, finds no accounts, and a missing secret makes
 * the sweep stop instead of removing anyone's files.
 */
const TOMBSTONE_KEY = "fuobeSignInMovedTo";
const TOMBSTONE = `${JSON.stringify(
  {
    [TOMBSTONE_KEY]: "fuobe.db",
    note: 'Sign-in data (the password, accounts and API tokens) is in the database, fuobe.db, in this folder. This file signs nobody in. To go back to an older Fuobe build, see "Sign-in data" in docs/SELF-HOSTING.md.',
    password: "00:00",
    secret: "",
    tokens: [],
    unreadable: true,
  },
  null,
  2,
)}\n`;
/** The first form of the note (plain text), from test builds of this change. */
const TEXT_TOMBSTONE_HEAD = "This is not Fuobe's sign-in file any more.";

/**
 * The note, also after an older build that let its owner in (FUOBE_PASSWORD) wrote it again: it holds no accounts, no
 * tokens and no public sign-up. One that does is sign-in data an older build added, which is never ignored.
 */
function isTombstone(data: AuthJson): boolean {
  const some = (v: unknown) => Array.isArray(v) && v.length > 0;
  return data[TOMBSTONE_KEY] !== undefined && !some(data.accounts) && !some(data.tokens) && !data.publicSignup;
}

/**
 * Write a file the way auth.json was always written: a temporary file (a name no other server or container uses),
 * then a rename, readable by this user only. Gives the file's stat key as written: the rename keeps it, and a stat
 * after the rename could already see another server's file.
 */
function writeAtomic(file: string, text: string): string {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  const st = fs.statSync(tmp);
  fs.renameSync(tmp, file);
  return `${st.mtimeMs}:${st.size}:${st.ino}`;
}

function writeTombstone(): void {
  try {
    if (fs.existsSync(AUTH_FILE) && fs.readFileSync(AUTH_FILE, "utf8") === TOMBSTONE) return;
    writeAtomic(AUTH_FILE, TOMBSTONE);
  } catch (e) {
    console.warn(`[fuobe] Couldn't write the note in place of auth.json (${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`);
  }
}

// ---------------------------------------------------------------------------
// Rows <-> today's shapes

export interface AccountRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: number;
  password_changed_at: number | null;
  last_login_at: number | null;
  disabled: number;
  sessions_after: number | null;
  extra_json: string | null;
}
export interface GpuRow {
  account_id: string;
  mode: "link" | "computer" | null;
  url: string | null;
  token: string | null;
}
export interface KeyRow {
  account_id: string;
  provider: string;
  sealed: string;
  last4: string;
  added_at: number;
  rejected_at: number | null;
}
interface TokenRow {
  id: string;
  name: string;
  hash: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
  extra_json: string | null;
}

const extraOf = (json: string | null): Record<string, unknown> => (json ? (JSON.parse(json) as Record<string, unknown>) : {});

export function gpuFrom(g: GpuRow): AccountGpu {
  if (g.mode === "computer") return { mode: "computer" };
  return { ...(g.mode === "link" && { mode: "link" as const }), url: g.url ?? "", ...(g.token !== null && { token: g.token }) };
}

export function keyFrom(k: KeyRow): StoredKey {
  return { sealed: k.sealed, last4: k.last4, addedAt: k.added_at, ...(k.rejected_at !== null && { rejectedAt: k.rejected_at }) };
}

/** An account as auth.json had it: optional fields only when set, `gpu` and `keys` only when there are some. */
export function accountFrom(r: AccountRow, gpu?: GpuRow, keys?: KeyRow[]): Account {
  const a = { ...extraOf(r.extra_json), id: r.id, email: r.email, hash: r.password_hash, createdAt: r.created_at } as Account;
  if (r.password_changed_at !== null) a.passwordChangedAt = r.password_changed_at;
  if (r.last_login_at !== null) a.lastLoginAt = r.last_login_at;
  if (r.disabled) a.disabled = true;
  if (r.sessions_after !== null) a.sessionsAfter = r.sessions_after;
  if (gpu) a.gpu = gpuFrom(gpu);
  if (keys?.length) a.keys = Object.fromEntries(keys.map((k) => [k.provider, keyFrom(k)]));
  return a;
}

const tokenFrom = (t: TokenRow): ApiToken => ({
  ...extraOf(t.extra_json),
  id: t.id,
  name: t.name,
  hash: t.hash,
  prefix: t.prefix,
  createdAt: t.created_at,
  ...(t.last_used_at !== null && { lastUsedAt: t.last_used_at }),
});

const TOP_KNOWN = ["password", "secret", "tokens", "accounts", "publicSignup", "signedOut"];
const ACCOUNT_KNOWN = ["id", "email", "hash", "createdAt", "passwordChangedAt", "lastLoginAt", "disabled", "sessionsAfter", "gpu", "keys"];
const TOKEN_KNOWN = ["id", "name", "hash", "prefix", "createdAt", "lastUsedAt"];

function extraJson(o: object, known: string[]): string | null {
  const rest = Object.fromEntries(Object.entries(o).filter(([k]) => !known.includes(k)));
  return Object.keys(rest).length ? JSON.stringify(rest) : null;
}

/** Everything in the store, as auth.json holds it (accounts and tokens in the order they were added). */
export function exportJson(): AuthJson {
  const inst = sql("SELECT secret, password_hash, public_signup, extra_json FROM auth_install WHERE id = 1").get() as
    | { secret: string; password_hash: string | null; public_signup: number; extra_json: string | null }
    | undefined;
  const gpus = new Map((sql("SELECT * FROM auth_account_gpu").all() as GpuRow[]).map((g) => [g.account_id, g]));
  const keys = new Map<string, KeyRow[]>();
  for (const k of sql("SELECT * FROM auth_account_keys ORDER BY rowid").all() as KeyRow[]) keys.set(k.account_id, [...(keys.get(k.account_id) ?? []), k]);
  const accounts = (sql("SELECT * FROM auth_accounts ORDER BY rowid").all() as AccountRow[]).map((r) => accountFrom(r, gpus.get(r.id), keys.get(r.id)));
  const tokens = (sql("SELECT * FROM auth_tokens ORDER BY rowid").all() as TokenRow[]).map(tokenFrom);
  const signedOut = sql("SELECT hash, exp FROM auth_signed_out ORDER BY rowid").all() as { hash: string; exp: number }[];
  return {
    ...extraOf(inst?.extra_json ?? null),
    ...(inst?.password_hash != null && { password: inst.password_hash }),
    secret: inst?.secret ?? "",
    tokens,
    ...(accounts.length && { accounts }),
    ...(inst?.public_signup && { publicSignup: true }),
    ...(signedOut.length && { signedOut }),
  };
}

/** Signed-out cookies that haven't expired, one per cookie (the latest expiry). */
function liveSignedOut(list: unknown, at: number): { hash: string; exp: number }[] {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new DataError("signedOut is not a list");
  const by = new Map<string, number>();
  for (const e of list as { hash?: unknown; exp?: unknown }[]) {
    if (!e || typeof e.hash !== "string" || typeof e.exp !== "number" || !Number.isFinite(e.exp)) throw new DataError("a signed-out entry is malformed");
    if (e.exp > at) by.set(e.hash, Math.max(e.exp, by.get(e.hash) ?? 0));
  }
  return [...by].map(([hash, exp]) => ({ hash, exp }));
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const optNum = (v: unknown, what: string): number | null => {
  if (v === undefined || v === null) return null;
  if (!isNum(v)) throw new DataError(`${what} is not a number`);
  return v;
};

/** Put a parsed auth.json in the (empty) tables, checking each value's type. */
function insertAll(data: AuthJson, at: number, version: number): Counts {
  if (data.secret !== undefined && !isStr(data.secret)) throw new DataError("the secret is not text");
  if (data.password !== undefined && data.password !== null && !isStr(data.password)) throw new DataError("the password hash is not text");
  sql("INSERT INTO auth_install (id, secret, password_hash, public_signup, extra_json, version, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?)").run(
    data.secret ?? "",
    data.password ?? null,
    data.publicSignup ? 1 : 0,
    extraJson(data, TOP_KNOWN),
    version,
    at,
  );
  const counts: Counts = { accounts: 0, tokens: 0, keys: 0, gpus: 0, signedOut: 0 };
  const tokens = data.tokens ?? [];
  if (!Array.isArray(tokens)) throw new DataError("tokens is not a list");
  const addToken = sql("INSERT INTO auth_tokens (id, name, hash, prefix, created_at, last_used_at, extra_json) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const t of tokens) {
    if (!t || !isStr(t.id) || !isStr(t.name) || !isStr(t.hash) || !isStr(t.prefix) || !isNum(t.createdAt)) throw new DataError("an API token is malformed");
    constrained(() => addToken.run(t.id, t.name, t.hash, t.prefix, t.createdAt, optNum(t.lastUsedAt, "a token's last use"), extraJson(t, TOKEN_KNOWN)), "two API tokens are the same");
    counts.tokens++;
  }
  const accounts = data.accounts ?? [];
  if (!Array.isArray(accounts)) throw new DataError("accounts is not a list");
  const addAccount = sql(
    "INSERT INTO auth_accounts (id, email, password_hash, created_at, password_changed_at, last_login_at, disabled, sessions_after, extra_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  const addGpu = sql("INSERT INTO auth_account_gpu (account_id, mode, url, token) VALUES (?, ?, ?, ?)");
  const addKey = sql("INSERT INTO auth_account_keys (account_id, provider, sealed, last4, added_at, rejected_at) VALUES (?, ?, ?, ?, ?, ?)");
  const half = Math.floor(accounts.length / 2);
  accounts.forEach((a, i) => {
    if (i === half) globalThis.__fuobeAuthImportFault?.();
    if (!a || typeof a !== "object" || !isStr(a.id) || !a.id || !isStr(a.hash) || !isNum(a.createdAt)) throw new DataError(`account ${i + 1} is malformed`);
    if (!isStr(a.email) || !a.email || a.email !== a.email.toLowerCase()) throw new DataError(`account ${i + 1} has an email that isn't lower-case`);
    if (a.disabled !== undefined && a.disabled !== null && typeof a.disabled !== "boolean") throw new DataError(`account ${i + 1}'s disabled is not true or false`);
    constrained(
      () =>
        addAccount.run(
          a.id,
          a.email,
          a.hash,
          a.createdAt,
          optNum(a.passwordChangedAt, "a password change time"),
          optNum(a.lastLoginAt, "a log-in time"),
          a.disabled ? 1 : 0,
          optNum(a.sessionsAfter, "a sign-out time"),
          extraJson(a, ACCOUNT_KNOWN),
        ),
      `account ${i + 1} has the id or the email of an account before it`,
    );
    counts.accounts++;
    const g = a.gpu as AccountGpu | null | undefined;
    if (g !== undefined && g !== null) {
      if (typeof g !== "object") throw new DataError(`account ${i + 1}'s GPU is malformed`);
      if (g.mode === "computer") addGpu.run(a.id, "computer", null, null);
      else if ((g.mode === undefined || g.mode === "link") && isStr(g.url) && (g.token === undefined || isStr(g.token))) addGpu.run(a.id, g.mode ?? null, g.url, g.token ?? null);
      else throw new DataError(`account ${i + 1}'s GPU is malformed`);
      counts.gpus++;
    }
    if (a.keys !== undefined && a.keys !== null) {
      if (typeof a.keys !== "object" || Array.isArray(a.keys)) throw new DataError(`account ${i + 1}'s keys are malformed`);
      for (const [p, k] of Object.entries(a.keys as Record<string, StoredKey | null | undefined>)) {
        if (k === undefined || k === null) continue;
        if (!isStr(k.sealed) || !isStr(k.last4) || !isNum(k.addedAt)) throw new DataError(`account ${i + 1}'s ${p} key is malformed`);
        addKey.run(a.id, p, k.sealed, k.last4, k.addedAt, optNum(k.rejectedAt, "a key's refusal time"));
        counts.keys++;
      }
    }
  });
  const addSignedOut = sql("INSERT INTO auth_signed_out (hash, exp) VALUES (?, ?)");
  for (const e of liveSignedOut(data.signedOut, at)) {
    addSignedOut.run(e.hash, e.exp);
    counts.signedOut++;
  }
  return counts;
}

function constrained(fn: () => unknown, what: string): void {
  try {
    fn();
  } catch (e) {
    if (String((e as { code?: string }).code).startsWith("SQLITE_CONSTRAINT")) throw new DataError(what);
    throw e;
  }
}

/** Sorted keys all the way down, so two values compare as text. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x,
  );
}

/** What must be the same after a round trip: a missing field and null, false or an empty list mean the same. */
function canon(data: AuthJson, at: number): string {
  const rest = (o: object, known: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !known.includes(k)));
  const gpu = (g: AccountGpu | null | undefined) => (!g ? null : g.mode === "computer" ? { mode: "computer" } : { mode: g.mode ?? null, url: g.url, token: g.token ?? null });
  const keys = (k: Account["keys"] | null | undefined) =>
    Object.entries(k ?? {})
      .filter(([, v]) => !!v)
      .map(([p, v]) => ({ p, sealed: v!.sealed, last4: v!.last4, addedAt: v!.addedAt, rejectedAt: v!.rejectedAt ?? null }))
      .sort((a, b) => (a.p < b.p ? -1 : 1));
  return stable({
    extra: rest(data, TOP_KNOWN),
    password: data.password ?? null,
    secret: data.secret ?? "",
    publicSignup: !!data.publicSignup,
    tokens: (data.tokens ?? []).map((t) => ({ ...rest(t, TOKEN_KNOWN), id: t.id, name: t.name, hash: t.hash, prefix: t.prefix, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt ?? null })),
    accounts: (data.accounts ?? []).map((a) => ({
      extra: rest(a, ACCOUNT_KNOWN),
      id: a.id,
      email: a.email,
      hash: a.hash,
      createdAt: a.createdAt,
      passwordChangedAt: a.passwordChangedAt ?? null,
      lastLoginAt: a.lastLoginAt ?? null,
      disabled: !!a.disabled,
      sessionsAfter: a.sessionsAfter ?? null,
      gpu: gpu(a.gpu),
      keys: keys(a.keys),
    })),
    signedOut: liveSignedOut(data.signedOut, at).sort((a, b) => (a.hash < b.hash ? -1 : 1)),
  });
}

/** Inside the transaction: the rows are what the file says, counted and read back. */
function verify(data: AuthJson, counts: Counts, at: number): void {
  const n = (table: string) => (sql(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const have: Counts = { accounts: n("auth_accounts"), tokens: n("auth_tokens"), keys: n("auth_account_keys"), gpus: n("auth_account_gpu"), signedOut: n("auth_signed_out") };
  if (stable(have) !== stable(counts) || counts.accounts !== (data.accounts ?? []).length || counts.tokens !== (data.tokens ?? []).length) {
    throw new DataError("the rows counted after the move differ from the file");
  }
  if (canon(exportJson(), at) !== canon(data, at)) throw new DataError("the data read back differs from the file");
}

function clearAll(): void {
  for (const t of ["auth_account_keys", "auth_account_gpu", "auth_signed_out", "auth_accounts", "auth_tokens", "auth_install"]) sql(`DELETE FROM ${t}`).run();
}

// ---------------------------------------------------------------------------
// Moving auth.json in

function importFile(file: { data: AuthJson; key: string | null; sha: string }): void {
  let counts: Counts | null = null;
  immediate(() => {
    if (marker()) return; // another server moved it in while this one waited for the lock
    if (hasRows()) throw new DataError("the sign-in tables already hold rows, without a record of how they got there");
    const at = now();
    counts = insertAll(file.data, at, 1);
    verify(file.data, counts, at);
    sql(
      "INSERT INTO auth_migration (id, source, state, started_at, synced_at, json_stat, json_sha256, counts_json) VALUES (1, 'auth.json', 'bridge', ?, ?, ?, ?, ?)",
    ).run(at, at, file.key, file.sha, JSON.stringify(counts));
  });
  if (counts) {
    const c = counts as Counts;
    console.info(
      `[fuobe] Sign-in data moved from auth.json into the database: ${c.accounts} accounts, ${c.tokens} API tokens, ${c.keys} saved keys, ${c.gpus} GPU links. auth.json is kept in step for ${Math.round(bridgeMs() / 60_000)} minutes, then kept as auth.json.migrated-<time>.`,
    );
  }
}

/** Write the store to auth.json in its usual format (bridge only), and remember the file as this server left it. */
function exportFile(): void {
  const text = JSON.stringify(exportJson(), null, 2);
  const key = writeAtomic(AUTH_FILE, text);
  sql("UPDATE auth_migration SET json_stat = ?, json_sha256 = ? WHERE id = 1").run(key, crypto.createHash("sha256").update(text).digest("hex"));
}

/**
 * Bridge, inside a write transaction: auth.json is not as this store left it. An older server changed it: read it all
 * back in. It is gone: write it again (that server would otherwise see no password). It can't be read: leave both.
 */
function syncFromFile(m: Marker): void {
  const key = statKey();
  if (key === m.json_stat || (key !== null && key === s.bridgeBad)) return;
  if (key === null) {
    exportFile();
    return;
  }
  const file = readFile();
  if ("error" in file) {
    s.bridgeBad = key;
    console.warn(`[fuobe] auth.json changed and can't be read back in (${file.error}): the database keeps sign-in as it was.`);
    return;
  }
  if (file.sha === m.json_sha256) {
    sql("UPDATE auth_migration SET json_stat = ? WHERE id = 1").run(key);
    return;
  }
  const at = now();
  const version = (sql("SELECT version FROM auth_install WHERE id = 1").get() as { version: number } | undefined)?.version ?? 0;
  try {
    // A savepoint: data that can't go in leaves the rows as they were, and the change that brought us here goes on.
    db().transaction(() => {
      clearAll();
      const counts = insertAll(file.data, at, version + 1);
      verify(file.data, counts, at);
    })();
  } catch (e) {
    if (!(e instanceof DataError)) throw e;
    s.bridgeBad = key;
    console.warn(`[fuobe] auth.json changed but can't be read back in (${e.message}): the database keeps sign-in as it was.`);
    return;
  }
  sql("UPDATE auth_migration SET synced_at = ?, json_stat = ?, json_sha256 = ? WHERE id = 1").run(at, key, file.sha);
}

/** Bridge: catch up with auth.json when it changed, and put it aside once its time is up. */
function bridgeTick(m: Marker): AuthStoreMode {
  const key = statKey();
  if (key !== m.json_stat && (key === null || key !== s.bridgeBad)) {
    try {
      immediate(() => {
        const inner = marker();
        if (inner?.state === "bridge") syncFromFile(inner);
      });
    } catch (e) {
      if (!(e instanceof DataError)) console.warn(`[fuobe] Couldn't catch up with auth.json: ${(e as Error).message}`);
    }
  }
  const t = now();
  if (t - s.retireCheckedAt >= Math.min(60_000, bridgeMs())) {
    s.retireCheckedAt = t;
    const fresh = marker();
    if (fresh?.state === "bridge" && t - fresh.started_at >= bridgeMs() && t - (fresh.synced_at ?? fresh.started_at) >= quietMs()) retire();
  }
  return s.done ? (s.held?.mode ?? "done") : "bridge";
}

/** "auth.json.migrated-20261104T101500Z", or with -2, -3… when that is taken. */
function backupName(at: number): string {
  const stamp = new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  for (let i = 1; ; i++) {
    const name = `auth.json.migrated-${stamp}${i > 1 ? `-${i}` : ""}`;
    if (!fs.existsSync(path.join(DATA_DIR, name))) return name;
  }
}

function retire(): void {
  try {
    immediate(() => {
      const m = marker();
      if (m?.state !== "bridge") return;
      // Changed since the last look: read it in, and wait for another quiet spell.
      if (statKey() !== m.json_stat) {
        syncFromFile(m);
        if (marker()?.synced_at !== m.synced_at) return;
      }
      const at = now();
      sql("UPDATE auth_migration SET state = 'done', backup_file = ?, retired_at = ? WHERE id = 1").run(backupName(at), at);
    });
  } catch (e) {
    console.warn(`[fuobe] Couldn't put auth.json aside yet: ${(e as Error).message}`);
    return;
  }
  const m = marker();
  if (m?.state === "done") afterMove(m);
}

const reimportAsked = () => process.env.FUOBE_AUTH_REIMPORT?.trim() === "1";

const PUT_BACK =
  "auth.json is back in the data folder, but sign-in data was already moved into the database (fuobe.db), so it is not read. Remove it to keep the database's sign-in data, or start once with FUOBE_AUTH_REIMPORT=1 to replace the database's sign-in data with it. See \"Sign-in data\" in docs/SELF-HOSTING.md.";

/** Keep sign-in closed for what afterMove found, until the next look. */
function hold(mode: "unreadable" | "failed", message: string): AuthStoreMode {
  s.held = { mode, message };
  return failClosed(mode, message);
}

/**
 * The store was moved (done), or written out for an older build (exported): look at auth.json, at most once a minute.
 * - The note, or no file: as it should be (the note is written again when it is missing).
 * - The file as the bridge last left it: put aside under its backup name (a crash between the database's change and
 *   that, or a copy put back that holds nothing new), and the note put in its place.
 * - exported: the file scripts/auth-export.mjs wrote, maybe changed by the older build since: moved back in.
 * - Any other JSON auth.json (a backup copied back, a file from elsewhere) is never read on its own: an older build may
 *   have run on it, and ignoring it would lose its accounts (and the sweep would remove their files), while reading it
 *   could bring back a revoked token or an old password. Sign-in fails closed until it is removed, or until a start
 *   with FUOBE_AUTH_REIMPORT=1 moves it in.
 */
function afterMove(m: Marker): AuthStoreMode {
  s.done = true;
  s.fileCheckedAt = now();
  s.held = null;
  const key = statKey();
  const file = key === null ? null : readFile();
  const note = file === null || ("error" in file && file.error === "tombstone");
  if (m.state === "exported") {
    if (note) {
      immediate(() => {
        if (marker()?.state === "exported") sql("UPDATE auth_migration SET state = 'done', exported_version = NULL WHERE id = 1").run();
      });
      writeTombstone();
      return "done";
    }
    if ("error" in file!) return hold("unreadable", `${AUTH_FILE} can't be read (${file.error}).`);
    return reimport(file!, "exported");
  }
  if (note) {
    if (file === null) writeTombstone();
    return "done";
  }
  // A broken file (an older build fails closed on it too): not read, and not written over.
  if ("error" in file!) return "done";
  if (m.source === "auth.json" && file.sha === m.json_sha256) {
    putAside(m);
    return "done";
  }
  if (reimportAsked()) return reimport(file, "asked");
  return hold("failed", PUT_BACK);
}

/** auth.json as the bridge last left it: kept under the backup name (never written over), and the note in its place. */
function putAside(m: Marker): void {
  try {
    if (m.backup_file) {
      const backup = path.join(DATA_DIR, m.backup_file);
      let made = true;
      try {
        // A link can't replace a file already there, so a second server finishing at the same moment can't put the
        // note over the backup.
        fs.linkSync(AUTH_FILE, backup);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === "EEXIST") made = false;
        else fs.copyFileSync(AUTH_FILE, backup, fs.constants.COPYFILE_EXCL); // a file system without links
      }
      if (made) {
        if (process.platform !== "win32") fs.chmodSync(backup, 0o600);
        console.info(
          `[fuobe] auth.json was kept as ${m.backup_file}: sign-in data is in the database now. That file still holds the accounts, password hashes and sealed keys as they were at the move, including accounts deleted since: delete it once you won't go back to an older version.`,
        );
      }
    }
    writeTombstone();
  } catch (e) {
    console.warn(`[fuobe] Couldn't put auth.json aside: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`);
  }
}

/**
 * Move auth.json in again over the store's rows, in one transaction, checked as the first move is. From an export, only
 * when nothing changed in the database since (else the database's changes would be lost): sign-in fails closed instead.
 * Then the bridge starts again (an older build may still run on the file), and puts the file aside under a new name.
 */
function reimport(file: { data: AuthJson; key: string | null; sha: string }, why: "exported" | "asked"): AuthStoreMode {
  let counts: Counts | null = null;
  try {
    immediate(() => {
      const m = marker();
      if (m?.state !== "done" && m?.state !== "exported") return; // another server did it
      const version = (sql("SELECT version FROM auth_install WHERE id = 1").get() as { version: number } | undefined)?.version ?? 0;
      if (why === "exported" && m.exported_version !== version && !reimportAsked()) {
        throw new DataError("sign-in data changed in the database after auth.json was exported");
      }
      const at = now();
      clearAll();
      counts = insertAll(file.data, at, version + 1);
      verify(file.data, counts, at);
      sql(
        "UPDATE auth_migration SET source = 'auth.json', state = 'bridge', started_at = ?, synced_at = ?, json_stat = ?, json_sha256 = ?, counts_json = ?, backup_file = NULL, retired_at = NULL, exported_version = NULL WHERE id = 1",
      ).run(at, at, file.key, file.sha, JSON.stringify(counts));
    });
  } catch (e) {
    const how = e instanceof DataError ? e.message : `the database said: ${(e as Error).message}`;
    return hold("failed", `auth.json couldn't be moved back into the database (${how}); nothing was changed. ${PUT_BACK}`);
  }
  if (counts) {
    const c = counts as Counts;
    console.info(
      `[fuobe] Sign-in data moved back in from auth.json (${why === "exported" ? "written for an older version" : "FUOBE_AUTH_REIMPORT=1"}): ${c.accounts} accounts, ${c.tokens} API tokens, ${c.keys} saved keys, ${c.gpus} GPU links. auth.json is kept in step for ${Math.round(bridgeMs() / 60_000)} minutes, then kept as auth.json.migrated-<time>.`,
    );
  }
  s.done = false;
  s.retireCheckedAt = 0;
  const m = marker();
  return m?.state === "bridge" ? bridgeTick(m) : m ? afterMove(m) : "fresh";
}

// ---------------------------------------------------------------------------
// The mode

function failClosed(kind: "unreadable" | "failed", message: string): AuthStoreMode {
  warnOnce(kind, `${message} Sign-in stays on and nobody can sign in until it is fixed.`, kind === "failed");
  return kind;
}

/** Where sign-in data stands now. Moves auth.json in when it is waiting, and keeps the bridge going. */
export function authStoreMode(): AuthStoreMode {
  if (globalThis.__fuobeAuthTablesError) return failClosed("failed", `The sign-in tables in the database can't be used (${globalThis.__fuobeAuthTablesError}).`);
  if (s.done && now() - s.fileCheckedAt < FILE_CHECK_MS) return s.held ? failClosed(s.held.mode, s.held.message) : "done";
  if (s.dbFailedAt && Date.now() - s.dbFailedAt < 5_000) return "failed";
  try {
    db();
    if (globalThis.__fuobeAuthTablesError) return authStoreMode();
    const m = marker();
    if (m?.state === "done" || m?.state === "exported") return afterMove(m);
    s.done = false;
    s.held = null;
    if (m?.state === "bridge") return bridgeTick(m);
    return beforeMove();
  } catch (e) {
    s.done = false;
    s.dbFailedAt = Date.now();
    return failClosed("failed", `The sign-in data in the database can't be read (${(e as Error).message}).`);
  }
}

/** No marker yet: a new install, or an auth.json to move in. */
function beforeMove(): AuthStoreMode {
  const key = statKey();
  if (key === null) {
    if (hasRows()) return failClosed("failed", "The database holds sign-in rows without a record of where they came from.");
    return "fresh";
  }
  if (s.bad?.key === key && (s.bad.mode === "unreadable" || s.bad.data)) return s.bad.mode;
  if (s.bad?.key === key && Date.now() - s.bad.at < 5_000) return s.bad.mode;
  const file = readFile();
  if ("error" in file) {
    // Another server set the store up a moment ago (and left the note in place of auth.json).
    const set = marker();
    if (set) return set.state === "bridge" ? bridgeTick(set) : afterMove(set);
    s.bad = { key, mode: "unreadable", at: Date.now(), data: false };
    return failClosed(
      "unreadable",
      file.error === "tombstone"
        ? `${AUTH_FILE} says sign-in data is in the database, but the database has none: restore fuobe.db, or copy auth.json.migrated-<time> back to auth.json.`
        : `${AUTH_FILE} can't be read (${file.error}).`,
    );
  }
  try {
    importFile(file);
    s.bad = null;
  } catch (e) {
    const data = e instanceof DataError;
    s.bad = { key, mode: "failed", at: Date.now(), data };
    return failClosed("failed", `auth.json couldn't be moved into the database (${(e as Error).message}); nothing was changed.`);
  }
  const m = marker();
  if (!m) return "fresh";
  return m.state === "bridge" ? bridgeTick(m) : afterMove(m);
}

/** Sign-in can't be used (the database, or auth.json waiting to move in, can't be read): fail closed. */
export const authStoreClosed = (mode = authStoreMode()) => mode === "unreadable" || mode === "failed";

/** The store failed (not just an unreadable auth.json waiting): the proxy answers 503 to everything. */
export const authStoreFailed = () => authStoreMode() === "failed";

const UNREADABLE = "The sign-in file (auth.json) can't be read. Fix or restore it: Fuobe won't write over it.";
const FAILED = "The sign-in data can't be read. Fix or restore it: Fuobe won't write over it.";

/** An older server changed auth.json while a change here was being made: the change is made again on top of it. */
class FileMoved extends Error {}

/**
 * Change sign-in data: `fn` runs inside a transaction that holds the write lock. A new install is set up first; during
 * the bridge auth.json is caught up with first and written after, in the same transaction. When an older server
 * changes the file in between, the transaction is undone and run again on top of that change (up to 3 times).
 */
export function authWrite<T>(fn: () => T): T {
  const mode = authStoreMode();
  if (mode === "unreadable") throw new Error(UNREADABLE);
  if (mode === "failed") throw new Error(FAILED);
  let fresh = false;
  let out!: T;
  for (let attempt = 1; ; attempt++) {
    try {
      out = immediate(() => {
        const m = marker();
        const at = now();
        if (!m) {
          if (statKey() !== null || hasRows()) throw new Error("The sign-in data changed while saving: try again.");
          sql("INSERT INTO auth_migration (id, source, state, started_at) VALUES (1, 'new', 'done', ?)").run(at);
          fresh = true;
        } else if (m.state === "bridge") {
          syncFromFile(m);
        } else if (m.state === "exported") {
          throw new Error("The sign-in data changed while saving: try again.");
        }
        sql("INSERT OR IGNORE INTO auth_install (id, secret, updated_at) VALUES (1, '', ?)").run(at);
        const r = fn();
        sql("UPDATE auth_install SET version = version + 1, updated_at = ? WHERE id = 1").run(at);
        const after = marker();
        if (after?.state === "bridge") {
          if (attempt < 3 && statKey() !== after.json_stat) throw new FileMoved();
          exportFile();
        }
        return r;
      });
      break;
    } catch (e) {
      if (e instanceof FileMoved) continue;
      throw e;
    }
  }
  if (fresh) {
    s.done = true;
    s.fileCheckedAt = now();
    s.held = null;
    writeTombstone();
  }
  s.writes++;
  return out;
}

/** Changes with every change to sign-in data, by this server or another one on the same database. */
export function authStoreVersion(): number {
  try {
    if (authStoreClosed()) return -1 - s.writes;
    return (sql("SELECT version FROM auth_install WHERE id = 1").get() as { version: number } | undefined)?.version ?? 0;
  } catch {
    return -1 - s.writes;
  }
}

/** On start: move auth.json in now (not on the first request), and keep checking the bridge once a minute. */
export function ensureAuthStore(): AuthStoreMode {
  const mode = authStoreMode();
  if (!globalThis.__fuobeAuthStoreTimer) {
    globalThis.__fuobeAuthStoreTimer = setInterval(() => {
      try {
        authStoreMode();
      } catch {}
    }, 60_000);
    globalThis.__fuobeAuthStoreTimer.unref?.();
  }
  return mode;
}
