/**
 * Access protection. Off until a password is set (Settings → Security, or FUOBE_PASSWORD).
 * Then every page and API call needs a session cookie (from /login) or an API token
 * (`Authorization: Bearer fuobe_…`).
 *
 * Public sign-up (publicSignup: FUOBE_PUBLIC_SIGNUP=1, Settings → Security, or fuobe.com itself)
 * opens a password-protected studio a little: guests may browse it read-only, and anyone may make
 * an account (email + password, no verification) whose session works across the app. An account
 * never runs on the owner's cloud keys or GPU (only on its own GPU, or its own fal.ai or Replicate key),
 * and install-wide settings, keys and tokens stay the owner's (the install password's session, or an
 * API token): src/proxy.ts, src/lib/guest-access.ts.
 *
 * Kept in the studio's SQLite database (AUTH_TABLES in src/server/db.ts; an older install's data/auth.json moves in on
 * the first start: src/server/auth-store.ts). Every check is a lookup by primary key or by the unique email, so the
 * proxy's sign-in check stays quick with any number of accounts.
 */
import crypto from "node:crypto";
import net from "node:net";
import os from "node:os";
import { LOCAL_SUFFIXES } from "@/lib/page-place";
import { markApiCaller } from "./api-caller";
import { accountFrom, authStoreClosed, authStoreVersion, authWrite, sql, type AccountRow, type GpuRow, type KeyRow } from "./auth-store";

export const SESSION_COOKIE = "fuobe_session";
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 86_400_000;

export interface ApiToken {
  id: string;
  name: string;
  /** sha256 of the token; the token itself is shown once. */
  hash: string;
  prefix: string;
  createdAt: number;
  lastUsedAt?: number;
}

/**
 * An account's own ComfyUI ("Your GPU"): where its runs go, never the install's. A public address (a tunnel), or the
 * ComfyUI on the person's own computer, which only their Fuobe tab reaches (src/server/computer).
 */
export type AccountGpu = { mode?: "link"; url: string; token?: string } | { mode: "computer" };

/** A GPU reached at a public address (a link), not the person's own computer. */
export const gpuLink = (gpu: AccountGpu | null | undefined): { url: string; token?: string } | null => (gpu && gpu.mode !== "computer" ? gpu : null);

/** fal.ai or Replicate: the providers an account may bring its own key for (src/lib/your-keys.ts). */
export type CloudProvider = "fal" | "replicate";

/** An account's own fal.ai key or Replicate token, sealed (src/server/secret-box.ts): never the key itself. */
export interface StoredKey {
  sealed: string;
  last4: string;
  addedAt: number;
  /** The provider refused it in a run. */
  rejectedAt?: number;
}

/** A signed-up visitor (public sign-up). */
export interface Account {
  id: string;
  /** Lower-cased. */
  email: string;
  /** scrypt hash of the password ("salt:hash", hex), as the install password's. */
  hash: string;
  createdAt: number;
  /** When the account last changed its password (Settings → Account): its sign-ins from before then were ended. */
  passwordChangedAt?: number;
  /** The last sign-up or log-in. */
  lastLoginAt?: number;
  /** Switched off by the owner (Settings → Accounts): signed out, and can't log in. */
  disabled?: boolean;
  /** Signed out everywhere by the owner at this time (the admin API): its sign-ins from before then were ended. */
  sessionsAfter?: number;
  gpu?: AccountGpu;
  /** Its own keys ("Your keys"), sealed: src/server/account-keys.ts opens them. */
  keys?: Partial<Record<CloudProvider, StoredKey>>;
}

/** The install's own row: the cookie secret, the Settings password and the public sign-up switch. */
interface Install {
  /** scrypt hash of the UI-set password ("salt:hash", hex). */
  password?: string;
  /**
   * Signs session cookies (an owner's with the password's fingerprint too: keyFor). Replaced when the Settings password
   * changes and by Settings → Security → Sign everyone out, which both sign every browser out.
   */
  secret: string;
  /** Settings → Security: guests may browse and anyone may sign up (FUOBE_PUBLIC_SIGNUP overrides it). */
  publicSignup: boolean;
  /** The sign-in data can't be read (src/server/auth-store.ts). Sign-in stays on, nobody is signed in, nothing is written. */
  unreadable?: true;
}

/** The install's row. Sign-in data that can't be read fails closed: sign-in stays on with nobody signed in. */
function install(): Install {
  if (authStoreClosed()) return { secret: "", publicSignup: false, unreadable: true };
  const r = sql("SELECT secret, password_hash, public_signup FROM auth_install WHERE id = 1").get() as
    | { secret: string; password_hash: string | null; public_signup: number }
    | undefined;
  return { secret: r?.secret ?? "", ...(r?.password_hash != null && { password: r.password_hash }), publicSignup: !!r?.public_signup };
}

/** Inside authWrite: give the install a cookie secret when it has none yet. */
function ensureSecret(): void {
  sql("UPDATE auth_install SET secret = ? WHERE id = 1 AND secret = ''").run(crypto.randomBytes(32).toString("hex"));
}

/**
 * Changes when sign-in data changes (a sign-out of everyone, a new password, a token revoked…), here or on another
 * server using the same database: a request that stays open, like the live feed, checks who is asking again then.
 */
export const authVersion = () => authStoreVersion();

const envPassword = () => process.env.FUOBE_PASSWORD || "";

export function authStatus(): { enabled: boolean; fromEnv: boolean; tokens: Omit<ApiToken, "hash">[] } {
  const d = install();
  const tokens = d.unreadable
    ? []
    : (sql("SELECT id, name, prefix, created_at, last_used_at FROM auth_tokens ORDER BY rowid").all() as TokenListRow[]).map((t) => ({
        id: t.id,
        name: t.name,
        prefix: t.prefix,
        createdAt: t.created_at,
        lastUsedAt: t.last_used_at ?? undefined,
      }));
  return { enabled: !!(envPassword() || d.password || d.unreadable), fromEnv: !!envPassword(), tokens };
}

interface TokenListRow {
  id: string;
  name: string;
  prefix: string;
  created_at: number;
  last_used_at: number | null;
}

const publicToken = (t: ApiToken): Omit<ApiToken, "hash"> => ({ id: t.id, name: t.name, prefix: t.prefix, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt });

/** Sign-in is on: a password is set (FUOBE_PASSWORD or Settings), or the auth file can't be read (fail closed). */
export const authEnabled = () => {
  if (envPassword()) return true;
  const d = install();
  return !!(d.password || d.unreadable);
};

// ---------------------------------------------------------------------------
// Passwords

function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  return `${salt.toString("hex")}:${crypto.scryptSync(pw, salt, 32).toString("hex")}`;
}

const same = (a: Buffer, b: Buffer) => a.length === b.length && crypto.timingSafeEqual(a, b);

function verifyHash(pw: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  return same(crypto.scryptSync(pw, Buffer.from(salt, "hex"), 32), Buffer.from(hash, "hex"));
}

/** scrypt off the main thread: the server keeps answering everyone else while a password is checked. */
const scrypt = (pw: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) => crypto.scrypt(pw, salt, 32, (e, key) => (e ? reject(e) : resolve(key))));

async function verifyHashAsync(pw: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  return same(await scrypt(pw, Buffer.from(salt, "hex")), Buffer.from(hash, "hex"));
}

export function checkPassword(pw: string): boolean {
  const env = envPassword();
  if (env) return same(crypto.createHash("sha256").update(pw).digest(), crypto.createHash("sha256").update(env).digest());
  const stored = install().password;
  if (!stored) return false;
  return verifyHash(pw, stored);
}

/** {@link checkPassword} for a request: the Settings password's scrypt runs off the main thread. */
export async function verifyPassword(pw: string): Promise<boolean> {
  if (envPassword()) return checkPassword(pw);
  const stored = install().password;
  return !!stored && (await verifyHashAsync(pw, stored));
}

/** Set, change or (with null) remove the UI password. Signs every browser out. */
export function setPassword(pw: string | null): void {
  if (envPassword()) throw new Error("The password is set by FUOBE_PASSWORD on the server");
  if (pw !== null && pw.length < 8) throw new Error("Use at least 8 characters");
  const hash = pw === null ? null : hashPassword(pw);
  authWrite(() => sql("UPDATE auth_install SET password_hash = ?, secret = ? WHERE id = 1").run(hash, crypto.randomBytes(32).toString("hex")));
}

// ---------------------------------------------------------------------------
// Sessions

const sign = (secret: string, payload: string) => crypto.createHmac("sha256", secret).update(payload).digest("base64url");

const fingerprint = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

/**
 * The key a session is signed with: the secret and a password's fingerprint. The owner's password (FUOBE_PASSWORD, or
 * the Settings one): a new one (after a restart, or in Settings) ends every owner sign-in at once, and the secret alone
 * (in the database) can't make an owner cookie. An account's own password hash: its new password ends its other sign-ins.
 * A new FUOBE_PASSWORD signs no account out; a password set in Settings makes a new secret, which signs out everyone.
 */
function keyFor(d: Install, who: "owner" | Pick<Account, "hash">): string {
  return `${d.secret}.${fingerprint(who === "owner" ? envPassword() || d.password || "" : who.hash)}`;
}

/**
 * A session cookie: "<expiry>.<mac>" for the owner, "<expiry>.<account id>.<mac>" for an account.
 * The two sign different text with different keys, so neither can be turned into the other.
 */
export function createSession(accountId?: string): { value: string; maxAge: number } {
  let d = install();
  if (!d.secret) {
    authWrite(ensureSecret);
    d = install();
  }
  const exp = Date.now() + SESSION_MS;
  const payload = accountId ? `${exp}.${accountId}` : String(exp);
  // An account that isn't there gets a cookie nothing takes (sessionViewer finds no account for it).
  const who = accountId ? { hash: (sql("SELECT password_hash FROM auth_accounts WHERE id = ?").get(accountId) as { password_hash: string } | undefined)?.password_hash ?? "" } : "owner";
  return { value: `${payload}.${sign(keyFor(d, who), payload)}`, maxAge: SESSION_DAYS * 86_400 };
}

/**
 * An account cookie made before account keys held the password's fingerprint was signed with the secret alone. It is
 * still taken (it ends with its 30 days, so a deploy signs nobody out) until the account first changes its password.
 */
const legacyAccountMac = (d: Install, account: Account, payload: string, mac: string) =>
  !account.passwordChangedAt && same(Buffer.from(mac), Buffer.from(sign(d.secret, payload)));

/** Who a session cookie belongs to: the owner, an account that still exists, or nobody. */
export type Viewer = { kind: "owner" } | { kind: "account"; account: Account };

/**
 * A cookie's expiry: the digits createSession wrote, not past and no further ahead than a session lasts. Whoever got hold
 * of the secret could sign any expiry; a far one is refused, so such a cookie ends with the session lifetime too.
 */
function liveExpiry(exp: string, now = Date.now()): boolean {
  if (!/^\d{1,16}$/.test(exp)) return false;
  const t = Number(exp);
  return t >= now && t <= now + SESSION_MS;
}

export function sessionViewer(value: string | undefined): Viewer | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 2 && parts.length !== 3) return null;
  const exp = parts[0];
  const mac = parts[parts.length - 1];
  const d = install();
  if (!d.secret || !mac || !liveExpiry(exp)) return null;
  const payload = parts.slice(0, -1).join(".");
  // An account's key holds its password's fingerprint: the account comes first.
  const account = parts.length === 3 ? accountById(parts[1]) : undefined;
  if (parts.length === 3 && !account) return null;
  const signed = same(Buffer.from(mac), Buffer.from(sign(keyFor(d, account ?? "owner"), payload)));
  if (!signed && !(account && legacyAccountMac(d, account, payload, mac))) return null;
  // Signed out with Sign out: a copy of the cookie (another tab's, a stolen one) is refused too.
  if (sql("SELECT 1 FROM auth_signed_out WHERE hash = ?").get(cookieHash(value))) return null;
  if (!account) return { kind: "owner" };
  // Signed out everywhere (signOutAccount): a cookie issued at or before then is refused.
  if (account.sessionsAfter && Number(exp) - SESSION_MS <= account.sessionsAfter) return null;
  return account.disabled ? null : { kind: "account", account };
}

const cookieHash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

/**
 * Sign out: the server stops taking this session cookie (deleting it from the browser alone would leave a copy working
 * until it expires). Kept until the cookie would have expired anyway, so the list stays short.
 */
export function endSession(value: string | undefined): void {
  if (!value || !sessionViewer(value)) return;
  authWrite(() => {
    sql("DELETE FROM auth_signed_out WHERE exp <= ?").run(Date.now());
    sql("INSERT OR REPLACE INTO auth_signed_out (hash, exp) VALUES (?, ?)").run(cookieHash(value), Number(value.split(".")[0]));
  });
}

/**
 * Settings → Security → Sign everyone out: a new secret, so every session cookie (the owner's and every account's,
 * this browser's too) stops working at once. Works while FUOBE_PASSWORD is set, which the Settings password change
 * can't. With `tokens`, every API token is revoked as well. The password stays as it is.
 */
export function signOutEveryone(opts: { tokens?: boolean } = {}): void {
  authWrite(() => {
    sql("UPDATE auth_install SET secret = ? WHERE id = 1").run(crypto.randomBytes(32).toString("hex"));
    if (opts.tokens) sql("DELETE FROM auth_tokens").run();
  });
}

/** The owner's session (the install password's): what Settings → Security and the tokens need. */
export function validSession(value: string | undefined): boolean {
  return sessionViewer(value)?.kind === "owner";
}

// ---------------------------------------------------------------------------
// Public sign-up: accounts

export class AccountError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Lower-cased, or null when it doesn't look like an email address. */
export function normalizeEmail(email: string): string | null {
  const e = email.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(e) ? e : null;
}

export function createAccount(email: string, password: string): Account {
  const e = normalizeEmail(email);
  if (!e) throw new AccountError("Enter a valid email address", 400);
  if (password.length < 8) throw new AccountError("Use at least 8 characters", 400);
  const taken = () => new AccountError("An account with this email already exists. Log in instead.", 409);
  if (sql("SELECT 1 FROM auth_accounts WHERE email = ?").get(e)) throw taken();
  const account: Account = { id: crypto.randomBytes(9).toString("hex"), email: e, hash: hashPassword(password), createdAt: Date.now(), lastLoginAt: Date.now() };
  try {
    authWrite(() => {
      ensureSecret();
      sql("INSERT INTO auth_accounts (id, email, password_hash, created_at, last_login_at) VALUES (?, ?, ?, ?, ?)").run(
        account.id,
        account.email,
        account.hash,
        account.createdAt,
        account.lastLoginAt,
      );
    });
  } catch (err) {
    // Two sign-ups with one email at the same moment: the unique email lets one in.
    if ((err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE" && /auth_accounts\.email/.test((err as Error).message)) throw taken();
    throw err;
  }
  return account;
}

/** The account with this (normalised) email, or undefined: one lookup on the unique email. */
function accountByEmail(e: string): Account | undefined {
  if (authStoreClosed()) return undefined;
  const r = sql("SELECT * FROM auth_accounts WHERE email = ?").get(e) as AccountRow | undefined;
  return r && withRows(r);
}

/** An account's row with its GPU and keys rows. */
function withRows(r: AccountRow): Account {
  const gpu = sql("SELECT * FROM auth_account_gpu WHERE account_id = ?").get(r.id) as GpuRow | undefined;
  const keys = sql("SELECT * FROM auth_account_keys WHERE account_id = ? ORDER BY rowid").all(r.id) as KeyRow[];
  return accountFrom(r, gpu, keys);
}

let dummy: string | undefined;

/** The account for this email and password, or null. An unknown email costs the same scrypt as a known one. */
export function checkAccount(email: string, password: string): Account | null {
  const e = normalizeEmail(email);
  const account = e ? accountByEmail(e) : undefined;
  const ok = verifyHash(password, account?.hash ?? (dummy ??= hashPassword(crypto.randomBytes(12).toString("hex"))));
  return account && ok ? account : null;
}

let dummyAsync: Promise<string> | undefined;

/** {@link checkAccount} for a request: scrypt runs off the main thread, and an unknown email costs the same as a known one. */
export async function verifyAccount(email: string, password: string): Promise<Account | null> {
  const e = normalizeEmail(email);
  const account = e ? accountByEmail(e) : undefined;
  const stored =
    account?.hash ??
    (await (dummyAsync ??= (async () => {
      const salt = crypto.randomBytes(16);
      return `${salt.toString("hex")}:${(await scrypt(crypto.randomBytes(12).toString("hex"), salt)).toString("hex")}`;
    })()));
  const ok = await verifyHashAsync(password, stored);
  return account && ok ? account : null;
}

/**
 * An account changes its own password (Settings → Account): the current one first. A new hash changes the account's
 * session key (keyFor), so every sign-in it had ends, this browser's too: the caller gives this browser a new cookie.
 */
export async function setAccountPassword(id: string, current: string, next: string): Promise<Account> {
  if (next.length < 8) throw new AccountError("Use at least 8 characters", 400);
  const account = accountById(id);
  if (!account) throw new AccountError("No such account", 404);
  if (!(await verifyAccount(account.email, current))) throw new AccountError("The current password is wrong", 403);
  const salt = crypto.randomBytes(16);
  const hash = `${salt.toString("hex")}:${(await scrypt(next, salt)).toString("hex")}`;
  // The account may have gone while the passwords were hashed.
  const changed = { hash, passwordChangedAt: Date.now() };
  authWrite(() => {
    const r = sql("UPDATE auth_accounts SET password_hash = ?, password_changed_at = ? WHERE id = ?").run(changed.hash, changed.passwordChangedAt, id);
    if (!r.changes) throw new AccountError("No such account", 404);
  });
  return { ...account, ...changed };
}

/** How often a log-in is written down. */
const LOGIN_RECORD_MS = 60 * 60_000;

/** Remember a log-in (Settings → Accounts shows it), at most once an hour per account. */
export function recordLogin(id: string): void {
  if (authStoreClosed()) return;
  const r = sql("SELECT last_login_at FROM auth_accounts WHERE id = ?").get(id) as { last_login_at: number | null } | undefined;
  if (!r || Date.now() - (r.last_login_at ?? 0) < LOGIN_RECORD_MS) return;
  const t = Date.now();
  authWrite(() => sql("UPDATE auth_accounts SET last_login_at = ? WHERE id = ? AND COALESCE(last_login_at, 0) < ?").run(t, id, t - LOGIN_RECORD_MS));
}

/** What the owner sees of an account (Settings → Accounts): never the password hash. */
export interface AccountInfo {
  id: string;
  email: string;
  createdAt: number;
  lastLoginAt: number | null;
  disabled: boolean;
  /** Its own ComfyUI is connected ("Your GPU"). */
  gpu: boolean;
  /** The providers it saved its own key for ("Your keys"): never a key. */
  keys: CloudProvider[];
}

/** The accounts as the owner sees them, newest first: one indexed read, with each account's GPU and key providers. */
const INFO_SQL = `SELECT a.id, a.email, a.created_at, a.last_login_at, a.disabled,
    EXISTS (SELECT 1 FROM auth_account_gpu g WHERE g.account_id = a.id) AS gpu,
    (SELECT group_concat(k.provider) FROM auth_account_keys k WHERE k.account_id = a.id) AS keys
  FROM auth_accounts a`;

interface InfoRow {
  id: string;
  email: string;
  created_at: number;
  last_login_at: number | null;
  disabled: number;
  gpu: number;
  keys: string | null;
}

const infoFrom = (r: InfoRow): AccountInfo => {
  const has = new Set(r.keys?.split(",") ?? []);
  return {
    id: r.id,
    email: r.email,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at ?? null,
    disabled: !!r.disabled,
    gpu: !!r.gpu,
    keys: (["fal", "replicate"] as const).filter((p) => has.has(p)),
  };
};

export function listAccounts(): AccountInfo[] {
  if (authStoreClosed()) return [];
  return (sql(`${INFO_SQL} ORDER BY a.created_at DESC, a.rowid`).all() as InfoRow[]).map(infoFrom);
}

/** One account as the owner sees it (Settings → Accounts, the admin API), or undefined. */
export function accountInfo(id: string): AccountInfo | undefined {
  if (authStoreClosed()) return undefined;
  const r = sql(`${INFO_SQL} WHERE a.id = ?`).get(id) as InfoRow | undefined;
  return r && infoFrom(r);
}

/**
 * The ids of the accounts: throws when the sign-in data can't be read, or the install has no secret yet (every install
 * that ever held an account has one). The account sweep removes the files of accounts missing from it, so a read
 * that failed for a moment must never look like "no accounts".
 */
export function readAccountIds(): Set<string> {
  if (authStoreClosed() || !install().secret) throw new Error("The sign-in data can't be read");
  return new Set((sql("SELECT id FROM auth_accounts").all() as { id: string }[]).map((r) => r.id));
}

/** Change one account's row: 404 when there is no such account. */
function updateAccount(id: string, set: string, ...values: unknown[]): void {
  authWrite(() => {
    if (!sql(`UPDATE auth_accounts SET ${set} WHERE id = ?`).run(...values, id).changes) throw new AccountError("No such account", 404);
  });
}

/** Switch an account off (it is signed out at once) or on again. */
export function setAccountDisabled(id: string, disabled: boolean): void {
  updateAccount(id, "disabled = ?", disabled ? 1 : 0);
}

/** End every sign-in of an account at once, without switching it off: it can log in again. */
export function signOutAccount(id: string): void {
  updateAccount(id, "sessions_after = ?", Date.now());
}

/** Delete an account with its GPU link and keys (its sessions stop working at once). */
export function deleteAccount(id: string): void {
  authWrite(() => {
    sql("DELETE FROM auth_account_keys WHERE account_id = ?").run(id);
    sql("DELETE FROM auth_account_gpu WHERE account_id = ?").run(id);
    if (!sql("DELETE FROM auth_accounts WHERE id = ?").run(id).changes) throw new AccountError("No such account", 404);
  });
}

/** The owner: the install password's session or an API token (everyone while no password is set). */
export function isOwnerRequest(request: Request, cookie: string | undefined): boolean {
  return !authEnabled() || validSession(cookie) || validToken(request.headers.get("authorization"));
}

/** A CSV cell: quoted when it needs to be, and never read as a formula by a spreadsheet. */
function csvCell(v: string | number | boolean | null): string {
  let s = v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function accountsCsv(items = listAccounts()): string {
  const iso = (t: number | null) => (t ? new Date(t).toISOString() : null);
  const rows = [
    ["email", "created", "last_login", "gpu_connected", "fal_key", "replicate_key", "disabled"],
    ...items.map((a) => [a.email, iso(a.createdAt), iso(a.lastLoginAt), a.gpu, a.keys.includes("fal"), a.keys.includes("replicate"), a.disabled]),
  ];
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export const accountById = (id: string): Account | undefined => {
  if (authStoreClosed()) return undefined;
  const r = sql("SELECT * FROM auth_accounts WHERE id = ?").get(id) as AccountRow | undefined;
  return r && withRows(r);
};

/** The account's own ComfyUI, or null when it hasn't connected one or the owner switched the account off. */
export const accountGpu = (id: string): AccountGpu | null => {
  const a = accountById(id);
  return a && !a.disabled ? (a.gpu ?? null) : null;
};

/** Inside authWrite: 404 when there is no such account. */
function mustExist(id: string): void {
  if (!sql("SELECT 1 FROM auth_accounts WHERE id = ?").get(id)) throw new AccountError("No such account", 404);
}

/** Save (or with null, forget) the account's own ComfyUI. The caller checks the address first (src/server/account-gpu.ts). */
export function setAccountGpu(id: string, gpu: AccountGpu | null): void {
  authWrite(() => {
    mustExist(id);
    if (!gpu) sql("DELETE FROM auth_account_gpu WHERE account_id = ?").run(id);
    else if (gpu.mode === "computer") sql("INSERT OR REPLACE INTO auth_account_gpu (account_id, mode, url, token) VALUES (?, 'computer', NULL, NULL)").run(id);
    else sql("INSERT OR REPLACE INTO auth_account_gpu (account_id, mode, url, token) VALUES (?, NULL, ?, ?)").run(id, gpu.url, gpu.token || null);
  });
}

/** It saved a key of its own for fal.ai or Replicate (whether this server can still open it is account-keys.ts's to say). */
export const hasCloudKey = (a: Pick<Account, "keys">): boolean => !!(a.keys?.fal || a.keys?.replicate);

/** The account's sealed key for a provider, switched off or not (its runs still finish or stop on it), or null. */
export const accountKeyRecord = (id: string, p: CloudProvider): StoredKey | null => accountById(id)?.keys?.[p] ?? null;

/** Save (or with null, forget) the account's own key for a provider, sealed by the caller (src/server/account-keys.ts). */
export function setAccountKey(id: string, p: CloudProvider, key: StoredKey | null): void {
  authWrite(() => {
    mustExist(id);
    if (!key) sql("DELETE FROM auth_account_keys WHERE account_id = ? AND provider = ?").run(id, p);
    else {
      sql(
        `INSERT INTO auth_account_keys (account_id, provider, sealed, last4, added_at, rejected_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (account_id, provider) DO UPDATE SET sealed = excluded.sealed, last4 = excluded.last4, added_at = excluded.added_at, rejected_at = excluded.rejected_at`,
      ).run(id, p, key.sealed, key.last4, key.addedAt, key.rejectedAt || null);
    }
  });
}

/** Who is asking: the owner (also everyone while no password is set), an account (public sign-up on), or a guest. */
export type RequestViewer = { kind: "owner" } | { kind: "account"; account: Account } | { kind: "guest" };

/**
 * The session cookie in a Cookie header: the one reading the proxy and every route use, so they always agree on who is
 * asking. Exactly one fuobe_session pair whose value is a plain token (letters, digits, "_", "-", "."). Two pairs, or an
 * encoded value, mean no session: parsers that pick a different pair (Next keeps the last and decodes it) would
 * otherwise let the proxy check one viewer while a route acts for another.
 */
export function sessionCookieFrom(header: string | null | undefined): string | undefined {
  let found: string | undefined;
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0 || part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    if (found !== undefined) return undefined;
    found = part.slice(eq + 1).trim();
  }
  return found && /^[\w.-]+$/.test(found) ? found : undefined;
}

/** The session cookie a request carries (read from its Cookie header: works outside Next's request scope too). */
export function sessionCookieOf(request: Request): string | undefined {
  return sessionCookieFrom(request.headers.get("cookie"));
}

/** An admin token (src/server/admin-tokens.ts): only the admin API takes it, and it is never the owner or an account. */
export const ADMIN_BEARER = /^Bearer\s+fuobe_adm_/i;
export const hasAdminBearer = (request: Request) => ADMIN_BEARER.test(request.headers.get("authorization") ?? "");

export function requestViewer(request: Request, cookie = sessionCookieOf(request)): RequestViewer {
  if (hasAdminBearer(request)) return { kind: "guest" };
  if (!authEnabled() || validToken(request.headers.get("authorization"))) return { kind: "owner" };
  const v = sessionViewer(cookie);
  if (v?.kind === "owner") return v;
  if (v?.kind === "account" && publicSignup(request.headers.get("host"))) return v;
  return { kind: "guest" };
}

/** The account behind this request's session, while public sign-up is on for its address (null: the owner, a guest, or off). */
export function requestAccount(request: Request, cookie = sessionCookieOf(request)): Account | null {
  if (hasAdminBearer(request) || validToken(request.headers.get("authorization"))) return null;
  const v = sessionViewer(cookie);
  return v?.kind === "account" && publicSignup(request.headers.get("host")) ? v.account : null;
}

// ---------------------------------------------------------------------------
// Public sign-up: the switch

const FUOBE_COM = new Set(["fuobe.com", "www.fuobe.com"]);

/** FUOBE_PUBLIC_SIGNUP: "1" on, "0" off (Settings can't change either), else null. */
export function publicSignupFromEnv(): boolean | null {
  const v = process.env.FUOBE_PUBLIC_SIGNUP?.trim();
  return v === "1" ? true : v === "0" ? false : null;
}

/** The Settings → Security switch (ignored while FUOBE_PUBLIC_SIGNUP is set). */
export const publicSignupSetting = () => install().publicSignup;

export function setPublicSignup(on: boolean): void {
  if (publicSignupFromEnv() !== null) throw new Error("Public sign-up is set by FUOBE_PUBLIC_SIGNUP on the server");
  authWrite(() => {
    ensureSecret();
    sql("UPDATE auth_install SET public_signup = ? WHERE id = 1").run(on ? 1 : 0);
  });
}

/**
 * Are guests and sign-ups let in for a request to this host? Only on a studio with a password
 * (without one everyone is the owner already). FUOBE_PUBLIC_SIGNUP=1 or 0 decides; unset, the
 * Settings switch, or the public demo at fuobe.com. The Host header is the client's word, so a
 * self-hosted studio reached by its IP can't be opened with "Host: fuobe.com": the name counts
 * only on an install that lists it in FUOBE_ALLOWED_ORIGINS, as fuobe.com's own server does.
 */
export function publicSignup(host: string | null | undefined): boolean {
  if (!authEnabled()) return false;
  const env = publicSignupFromEnv();
  if (env !== null) return env;
  if (publicSignupSetting()) return true;
  return !!host && FUOBE_COM.has(hostName(host)) && allowedHosts().some((a) => FUOBE_COM.has(hostName(a)));
}

// ---------------------------------------------------------------------------
// Cross-site requests

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Extra addresses this studio is reached at (FUOBE_ALLOWED_ORIGINS="https://fuobe.example.com,studio.lan:3000", or "*" for any). */
function allowedHosts(): string[] {
  return (process.env.FUOBE_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      try {
        return s.includes("://") ? new URL(s).host : s;
      } catch {
        return s;
      }
    });
}

/**
 * Changes must come from Fuobe's own pages, or from a client that isn't a browser (those send no
 * Origin). Without this check any web page could post to a password-less local install — set its
 * password, start paid generations — with a "simple" text/plain request that needs no preflight.
 */
export function crossSite(request: Request, ownHost: string): boolean {
  if (SAFE_METHODS.has(request.method)) return false;
  if (request.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return true; // "null" (sandboxed frames, file://) or garbage
  }
  if (!host) return true;
  const own = [request.headers.get("host"), request.headers.get("x-forwarded-host")?.split(",")[0].trim(), ownHost, ...allowedHosts()];
  return !own.includes(host);
}

// ---------------------------------------------------------------------------
// DNS rebinding

/** Host header → lower-case name without port or trailing dot ("[::1]:3000" → "::1"). */
function hostName(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(1, h.indexOf("]") >>> 0);
  const colon = h.indexOf(":");
  return (colon >= 0 && colon === h.lastIndexOf(":") ? h.slice(0, colon) : h).replace(/\.$/, "");
}


/**
 * Is this a name the studio may be reached at without a password? A page on attacker.example can
 * re-point its own DNS name at 127.0.0.1 (DNS rebinding); the browser then treats the local studio
 * as attacker.example and lets the page read and change it. Such a request carries the attacker's
 * name in Host, so only addresses that can't be rebound pass: IP literals, localhost, single-label
 * and LAN names (.local, .lan, .home.arpa, .internal), this machine's hostname, and
 * FUOBE_ALLOWED_ORIGINS. X-Forwarded-Host is not trusted here: a rebound page can set it.
 */
export function hostAllowed(host: string | null): boolean {
  if (!host) return true; // HTTP/1.0 clients and tools; browsers always send Host
  const name = hostName(host);
  if (!name || net.isIP(name) || !name.includes(".") || LOCAL_SUFFIXES.some((s) => name.endsWith(s))) return true;
  const self = os.hostname().toLowerCase();
  if (name === self || name === self.split(".")[0]) return true;
  return allowedHosts().some((a) => {
    const entry = a.toLowerCase();
    return entry === "*" || entry === host.trim().toLowerCase() || (!entry.includes(":") && entry === name);
  });
}

// ---------------------------------------------------------------------------
// Sign-in attempts

/** A visitor's key from its address: IPv4 as it is, IPv6 by its first 64 bits ("2001:db8:1:2::/64"). */
function clientOf(address: string): string {
  const a = address.replace(/^\[(.*)\]$/, "$1").toLowerCase();
  if (!net.isIPv6(a)) return a;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(a);
  if (mapped) return mapped[1];
  // A trailing dotted IPv4 part is two groups.
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  const hex = v4 ? a.slice(0, v4.index) + [((+v4[1] << 8) | +v4[2]).toString(16), ((+v4[3] << 8) | +v4[4]).toString(16)].join(":") : a;
  const [head, tail] = hex.split("::");
  const left = head ? head.split(":") : [];
  const right = tail !== undefined && tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  return `${groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(":")}::/64`;
}

/**
 * Wrong-password limits. Route handlers can't see the socket address, and Next keeps any
 * X-Forwarded-For a client sends, so that header only identifies a client behind a reverse proxy
 * you trust (FUOBE_TRUST_PROXY=1; the proxy's own entry is the last one): such a client is locked
 * out for a minute after 5 misses. Otherwise every client shares the "direct" key, and a lock
 * would let anyone keep the owner out, so a spent budget slows sign-in down to one attempt every
 * few seconds instead (about 15 guesses a minute). Past the global budget the same throttle
 * applies to everyone, however the key is spoofed.
 */
export class LoginGuard {
  static readonly DIRECT = "direct";
  private failures = new Map<string, { n: number; first: number; until: number }>();
  private recent: number[] = [];

  /**
   * `shared`: keys that stand for every visitor at once (no trusted proxy), which are slowed down past their budget,
   * never locked. By default the shared key itself.
   */
  constructor(
    private readonly o = { perClient: 5, global: 20, windowMs: 60_000, lockMs: 60_000, throttleMs: 4_000, maxClients: 5000 },
    private readonly shared: (key: string) => boolean = (key) => key === LoginGuard.DIRECT,
  ) {}

  /** This key's misses in its window (0 once the window has passed). */
  misses(key: string, now = Date.now()): number {
    const f = this.failures.get(key);
    return f && now - f.first <= this.o.windowMs ? f.n : 0;
  }

  /**
   * Who is signing in: the last X-Forwarded-For hop when a trusted proxy sets it, else one shared key. An IPv6 address
   * counts by its /64 (one home or one server gets a whole /64, so the rest of the address is free to change), and an
   * IPv4 address written as IPv6 (::ffff:a.b.c.d) as that IPv4 address.
   */
  static clientKey(headers: Headers, trustProxy = process.env.FUOBE_TRUST_PROXY === "1"): string {
    if (!trustProxy) return LoginGuard.DIRECT;
    const hops = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const last = hops.at(-1);
    return last ? clientOf(last) : LoginGuard.DIRECT;
  }

  /** Milliseconds until this client may try again (0 = now). */
  blockedFor(key: string, now = Date.now()): number {
    this.recent = this.recent.filter((t) => now - t < this.o.windowMs);
    const f = this.failures.get(key);
    const own = f && f.until > now ? f.until - now : 0;
    const shared = this.shared(key) && !!f && now - f.first <= this.o.windowMs && f.n >= this.o.perClient;
    const last = this.recent.at(-1);
    const throttle = (shared || this.recent.length >= this.o.global) && last !== undefined ? Math.max(0, last + this.o.throttleMs - now) : 0;
    return Math.max(own, throttle);
  }

  fail(key: string, now = Date.now()): void {
    this.recent.push(now);
    const f = this.failures.get(key);
    const fresh = !f || now - f.first > this.o.windowMs;
    const n = fresh ? 1 : f.n + 1;
    this.failures.delete(key);
    // The shared key is throttled (blockedFor), never locked.
    const locks = !this.shared(key) && n >= this.o.perClient;
    this.failures.set(key, { n, first: fresh ? now : f.first, until: locks ? now + this.o.lockMs : 0 });
    // Forget old entries; never let the map grow without bound.
    for (const [k, v] of this.failures) {
      if (this.failures.size <= this.o.maxClients && now - v.first < this.o.windowMs * 10) break;
      if (v.until < now) this.failures.delete(k);
      else if (this.failures.size > this.o.maxClients) this.failures.delete(k);
    }
  }

  succeed(key: string): void {
    this.failures.delete(key);
  }

  get size() {
    return this.failures.size;
  }
}

// ---------------------------------------------------------------------------
// API tokens

const tokenHash = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

export function createToken(name: string): { token: string; info: Omit<ApiToken, "hash"> } {
  // A random part that starts like a worker's or an admin token's would never work as the owner's (validToken): roll again.
  let token: string;
  do token = `fuobe_${crypto.randomBytes(24).toString("base64url")}`;
  while (/^fuobe_(wkr|adm)_/i.test(token));
  const t: ApiToken = { id: crypto.randomBytes(6).toString("hex"), name: name.trim() || "API token", hash: tokenHash(token), prefix: token.slice(0, 12), createdAt: Date.now() };
  authWrite(() => {
    ensureSecret();
    sql("INSERT INTO auth_tokens (id, name, hash, prefix, created_at) VALUES (?, ?, ?, ?, ?)").run(t.id, t.name, t.hash, t.prefix, t.createdAt);
  });
  return { token, info: publicToken(t) };
}

export function revokeToken(id: string): void {
  authWrite(() => sql("DELETE FROM auth_tokens WHERE id = ?").run(id));
}

const touched = new Map<string, number>();

export function validToken(header: string | null): boolean {
  const m = /^Bearer\s+(fuobe_[\w-]+)$/i.exec(header ?? "");
  // A worker's token (src/server/computer/workers.ts) or a scoped admin token is never the owner.
  if (!m || /^fuobe_(wkr|adm)_/i.test(m[1])) return false;
  if (authStoreClosed()) return false;
  // Found by its SHA-256 (unique): what is looked up is a hash, never the token.
  const hit = sql("SELECT id FROM auth_tokens WHERE hash = ?").get(tokenHash(m[1])) as { id: string } | undefined;
  if (!hit) return false;
  // Record use at most once an hour per token (avoids a write per request).
  if (Date.now() - (touched.get(hit.id) ?? 0) > 3_600_000) {
    touched.set(hit.id, Date.now());
    try {
      authWrite(() => sql("UPDATE auth_tokens SET last_used_at = ? WHERE id = ?").run(Date.now(), hit.id));
    } catch (e) {
      console.warn(`[fuobe] Couldn't note an API token's use: ${(e as Error).message}`);
    }
  }
  // The rest of this request's work was asked for with a token: an owner's run it makes says so (api-caller.ts).
  markApiCaller();
  return true;
}
