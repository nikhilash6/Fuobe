import "server-only";
import { nanoid } from "nanoid";
import { db } from "./db";

/**
 * Leases on rows that one app process works on at a time: two app processes (a deploy's overlap) never take the same row
 * twice, and a process that stops mid-way leaves it to another once its lease ends. A leased table has `holder` (the
 * process's token) and `lease_until` (epoch ms) columns, and is named here with the column its rows are leased by:
 * - `pool_holds` by `run_id`: runs waiting to enter the line on this install's GPUs (pool-holds.ts, pool-release.ts).
 */
const LEASED = { pool_holds: "run_id" } as const;

export type LeasedTable = keyof typeof LEASED;

declare global {
  var __fuobeLeaseToken: string | undefined;
}

/** This app process's name on its leases (new after a restart). */
export const leaseToken = (): string => (globalThis.__fuobeLeaseToken ??= `${process.pid}:${nanoid(10)}`);

/** Take the lease on `key`'s rows for `ms` (false: another process holds it now). Taking it again extends it. */
export function takeLease(table: LeasedTable, key: string, ms: number, now = Date.now()): boolean {
  const col = LEASED[table];
  return (
    db()
      .prepare(`UPDATE ${table} SET holder = @me, lease_until = @until WHERE ${col} = @key AND (holder IS NULL OR holder = @me OR lease_until IS NULL OR lease_until < @now)`)
      .run({ me: leaseToken(), until: now + ms, key, now }).changes > 0
  );
}

/** Give the lease on `key`'s rows back (they stay, for any process to take). */
export function endLease(table: LeasedTable, key: string): void {
  db().prepare(`UPDATE ${table} SET holder = NULL, lease_until = NULL WHERE ${LEASED[table]} = ? AND holder = ?`).run(key, leaseToken());
}

/** SQL: a row of a leased table this process holds the lease on now (parameters: leaseToken(), now). */
export const MINE_NOW = "holder = ? AND lease_until >= ?";
