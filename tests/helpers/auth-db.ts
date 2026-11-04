/**
 * Sign-in data in the test's database (src/server/auth-store.ts), for tests that look at what is stored or change it
 * behind the auth module's back. The database is the one the auth module opened: call an auth function first.
 */
import type Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

/** The database the server opened. */
export function authDb(): Database.Database {
  const d = globalThis.__fuobeDb;
  if (!d) throw new Error("Open the database first (call an auth function)");
  return d;
}

/** The install's cookie secret. */
export const authSecret = () => (authDb().prepare("SELECT secret FROM auth_install WHERE id = 1").get() as { secret: string } | undefined)?.secret ?? "";

/** Make an account older (or newer) than it is. */
export function setAccountCreatedAt(id: string, at: number): void {
  if (!authDb().prepare("UPDATE auth_accounts SET created_at = ? WHERE id = ?").run(at, id).changes) throw new Error(`No account ${id}`);
}

/** Rows of a sign-in table for one account. */
export const accountRows = (table: "auth_account_gpu" | "auth_account_keys", id: string) => authDb().prepare(`SELECT * FROM ${table} WHERE account_id = ?`).all(id) as Record<string, unknown>[];

/** Every byte of the database file, with the write-ahead log folded in: for "never stored as it is" checks. */
export function dbBytes(dir: string): string {
  authDb().pragma("wal_checkpoint(TRUNCATE)");
  return ["fuobe.db", "fuobe.db-wal"].map((f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f)).toString("latin1") : "")).join("\n");
}

/** Run `fn` while the accounts table is empty (their GPU and key rows stay), then put every account back. */
export async function withoutAccounts<T>(fn: () => T | Promise<T>): Promise<T> {
  const d = authDb();
  const rows = d.prepare("SELECT * FROM auth_accounts ORDER BY rowid").all() as Record<string, unknown>[];
  d.pragma("foreign_keys = OFF");
  d.prepare("DELETE FROM auth_accounts").run();
  try {
    return await fn();
  } finally {
    for (const r of rows) {
      const cols = Object.keys(r);
      d.prepare(`INSERT INTO auth_accounts (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...cols.map((c) => r[c]));
    }
    d.pragma("foreign_keys = ON");
  }
}
