import "server-only";
import type { CloudProvider } from "@/lib/your-keys";
import { db } from "./db";

/**
 * What a run last learnt of an account's own key that its sealed record doesn't hold: that the provider account's balance
 * ran out (Settings → Your keys then says "Add credit" instead of "Ready"). Tied to the key it was learnt for (its
 * added_at), so a key replaced since reads as new. Kept in a table of its own, made here when first used (no numbered
 * migration). Never the key.
 */

/** Databases the table was made in (once each). */
const ready = new WeakSet<object>();

function table() {
  const d = db();
  if (!ready.has(d)) {
    d.exec(`CREATE TABLE IF NOT EXISTS account_key_notes (
      account_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      added_at INTEGER NOT NULL,
      balance_empty_at INTEGER,
      PRIMARY KEY (account_id, provider)
    )`);
    ready.add(d);
  }
  return d;
}

/** The key (added at `addedAt`) works, but the provider account's balance ran out. */
export function markBalanceEmpty(id: string, p: CloudProvider, addedAt: number, at = Date.now()): void {
  table()
    .prepare(
      `INSERT INTO account_key_notes (account_id, provider, added_at, balance_empty_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (account_id, provider) DO UPDATE SET added_at = excluded.added_at, balance_empty_at = excluded.balance_empty_at`,
    )
    .run(id, p, addedAt, at);
}

/** The provider took a run (or the free check passed) on the key: its balance is fine again. */
export function clearBalanceEmpty(id: string, p: CloudProvider): void {
  table().prepare("DELETE FROM account_key_notes WHERE account_id = ? AND provider = ?").run(id, p);
}

/** When the balance of the key added at `addedAt` was found empty, if it was. */
export function balanceEmptyAt(id: string, p: CloudProvider, addedAt: number): number | undefined {
  const r = table().prepare("SELECT added_at, balance_empty_at FROM account_key_notes WHERE account_id = ? AND provider = ?").get(id, p) as { added_at: number; balance_empty_at: number | null } | undefined;
  return r && r.added_at === addedAt && r.balance_empty_at ? r.balance_empty_at : undefined;
}

/** Everything noted for an account (its account is deleted). */
export function forgetKeyNotes(id: string): void {
  table().prepare("DELETE FROM account_key_notes WHERE account_id = ?").run(id);
}
