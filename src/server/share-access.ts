import "server-only";
/**
 * Who may open a share link: token creation and lookup, and the guess limiter. Kept apart from
 * src/server/shares.ts (which builds the pages) because the sign-in proxy imports it: SQLite and
 * `crypto` only, no catalog or providers.
 *
 * A token is 44 base64url characters: a 12-character id (9 random bytes, the row's primary key)
 * and a 32-character secret (24 random bytes). Only the SHA-256 of the whole token is stored. A
 * lookup finds the row by its id, then compares the hashes with timingSafeEqual — also when no row
 * matched, against a dummy, so a miss takes as long as a wrong secret.
 */
import crypto from "node:crypto";
import { isShareToken, SHARE_ID_LENGTH, type ShareInfo, type ShareKind, type ShareLayout } from "@/lib/share";
import { db } from "./db";

export interface ShareRow {
  id: string;
  token_hash: string;
  kind: ShareKind;
  target_id: string | null;
  title: string;
  description: string;
  tags_json: string;
  layout: ShareLayout;
  items_json: string;
  cover_id: string | null;
  cover_index: number;
  show_prompts: number;
  expires_at: number | null;
  views: number;
  last_viewed_at: number | null;
  created_at: number;
  updated_at: number;
}

const parse = <T,>(s: string | null, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

export function toShareInfo(r: ShareRow): ShareInfo {
  return {
    id: r.id,
    kind: r.kind,
    targetId: r.target_id,
    title: r.title,
    description: r.description,
    tags: parse<string[]>(r.tags_json, []),
    layout: r.layout,
    items: parse<string[]>(r.items_json, []),
    cover: r.cover_id ? { generationId: r.cover_id, index: r.cover_index } : null,
    showPrompts: !!r.show_prompts,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    views: r.views,
    lastViewedAt: r.last_viewed_at,
  };
}

const sha256 = (token: string) => crypto.createHash("sha256").update(token).digest();

/** A fresh token: shown to the owner once; the row keeps `id` and `hash`. */
export function newToken(): { id: string; token: string; hash: string } {
  const id = crypto.randomBytes(9).toString("base64url");
  const token = id + crypto.randomBytes(24).toString("base64url");
  return { id, token, hash: sha256(token).toString("hex") };
}

const DUMMY = Buffer.alloc(32);

/**
 * The share a token opens, or null: an unknown token, a wrong secret, an expired link (a revoked
 * one is deleted). The hash comparison is constant-time and runs for every well-formed token.
 */
export function findShare(token: string, now = Date.now()): ShareRow | null {
  if (!isShareToken(token)) return null;
  let row: ShareRow | undefined;
  try {
    row = db().prepare("SELECT * FROM shares WHERE id = ?").get(token.slice(0, SHARE_ID_LENGTH)) as ShareRow | undefined;
  } catch {
    row = undefined; // no shares table yet (an install the migration hasn't reached): nothing is shared
  }
  const stored = row && /^[0-9a-f]{64}$/.test(row.token_hash) ? Buffer.from(row.token_hash, "hex") : DUMMY;
  const same = crypto.timingSafeEqual(sha256(token), stored);
  if (!row || !same) return null;
  if (row.expires_at !== null && row.expires_at <= now) return null;
  return row;
}

/** The SQL test for "in the Trash" (generation_trash) on `g`. */
export const NOT_TRASHED = "NOT EXISTS (SELECT 1 FROM generation_trash t WHERE t.generation_id = g.id)";

const TARGET: Record<ShareKind, string | null> = {
  // The owner's own results only: an account's run is never shared, whoever asks.
  result: `SELECT 1 FROM generations g WHERE g.id = ? AND g.status = 'succeeded' AND ${NOT_TRASHED} AND json_extract(g.request_json, '$.account') IS NULL`,
  folder: "SELECT 1 FROM folders WHERE id = ?",
  cinema: "SELECT 1 FROM cinema_projects WHERE id = ?",
  publish: null,
};

/**
 * Whether what a link shares still exists (one primary-key lookup): the result (not in the Trash),
 * the folder or the project. A published selection always does (its page shows what is left).
 * The proxy answers 404 when it doesn't.
 */
export function shareTargetExists(row: Pick<ShareRow, "kind" | "target_id">): boolean {
  const sql: string | null | undefined = TARGET[row.kind];
  if (sql === undefined) return false;
  if (sql === null) return true;
  return !!row.target_id && !!db().prepare(sql).get(row.target_id);
}

// ---------------------------------------------------------------------------
// Guesses

/**
 * Limits wrong share tokens without letting anyone switch working links off. A live link is looked
 * up first and always opens: other people's misses never block it. A miss (an unknown, wrong or
 * expired token) counts once per token per window, so a page left open after its link was revoked
 * (one miss per lazy-loaded file) counts as one. Past the global budget, misses answer 429 instead
 * of 404. A client the server can tell apart (the last X-Forwarded-For hop behind a trusted reverse
 * proxy, FUOBE_TRUST_PROXY=1, see LoginGuard.clientKey) that misses too often is locked out of
 * share links for a minute, its own working ones included, so it can't tell a hit from a miss
 * meanwhile. Without a trusted proxy every visitor shares one key, which is never locked (a lock
 * would let anyone take every link down). Tokens carry 192 random bits, so this is about load and
 * noise more than about odds. A signed-in owner is never limited.
 */
export class ShareGuard {
  private misses = new Map<string, { n: number; first: number; until: number }>();
  private recent = new Map<string, number>(); // missed token → when it first missed in this window
  private globalMisses: number[] = []; // the times of the last `global` misses, oldest first (a flood can't grow it)

  constructor(private readonly o = { perClient: 20, global: 100, windowMs: 60_000, lockMs: 60_000, maxClients: 5000 }) {}

  /** Milliseconds until this client's share requests are looked up again (0 = now). Only a told-apart client is ever locked. */
  blockedFor(key: string, now = Date.now()): number {
    const own = this.misses.get(key);
    return own && own.until > now ? own.until - now : 0;
  }

  /** Whether misses are over the global budget (they then answer 429; working links still open). */
  saturated(now = Date.now()): boolean {
    return this.globalMisses.length >= this.o.global && now - this.globalMisses[0] < this.o.windowMs;
  }

  /** A wrong token. `shared`: the key is everyone's (no trusted proxy), so only the global budget counts. */
  miss(key: string, token: string, shared: boolean, now = Date.now()): void {
    for (const [t, at] of this.recent) {
      if (now - at < this.o.windowMs && this.recent.size <= this.o.maxClients * 4) break;
      this.recent.delete(t);
    }
    // The same dead token again (a page's files, a reload) is one miss.
    const seen = `${key}\0${token}`;
    if (this.recent.has(seen)) return;
    this.recent.set(seen, now);
    this.globalMisses.push(now);
    if (this.globalMisses.length > this.o.global) this.globalMisses.shift();
    if (shared) return;
    const m = this.misses.get(key);
    const fresh = !m || now - m.first > this.o.windowMs;
    const n = fresh ? 1 : m.n + 1;
    this.misses.delete(key);
    this.misses.set(key, { n, first: fresh ? now : m.first, until: n >= this.o.perClient ? now + this.o.lockMs : (m?.until ?? 0) });
    for (const [k, v] of this.misses) {
      if (this.misses.size <= this.o.maxClients && now - v.first < this.o.windowMs * 10) break;
      if (v.until < now || this.misses.size > this.o.maxClients) this.misses.delete(k);
    }
  }
}

declare global {
  var __fuobeShareGuard: ShareGuard | undefined;
}

/** The process's guard (kept across hot reloads). */
export function shareGuard(): ShareGuard {
  globalThis.__fuobeShareGuard ??= new ShareGuard();
  return globalThis.__fuobeShareGuard;
}
