import "server-only";
import type { Generation } from "@/lib/catalog/types";
import { accountsMaxBytes, accountTotalBytes } from "./account-files";
import { listAccounts, type AccountInfo } from "./auth";
import { db } from "./db";
import { listGenerations, type ListOptions } from "./generations";
import { cursorFrom, HELPER_SQL, KINDS } from "./library";

/**
 * Settings → Accounts (the owner only): what accounts make. Their numbers (runs, space) and their runs, newest first,
 * one account's or every account's. Never the owner's own runs, and nothing here reaches the owner's Library or live
 * feed (they leave accounts out: L-13). Read from the indexes (generations_account, assets_account), two grouped
 * queries for every account at once; an account's runs and files go after 30 days, so these stay small.
 */

const DAY = 86_400_000;

export interface AccountStats {
  /** Runs (helper steps left out, as the lists leave them out): all time, the last 24 hours, the last 7 days. */
  runs: number;
  runsDay: number;
  runsWeek: number;
  /** Runs going now (queued or running), as the account's run limit counts them: a batch or a chain is one run. */
  running: number;
  /** Failed in the last 7 days (a run the account canceled isn't counted). */
  failedWeek: number;
  lastRunAt: number | null;
  /** Its files on this server (uploads and results), and what it may keep (accountTotalBytes). */
  bytes: number;
  capBytes: number;
}

export interface AccountTotals {
  accounts: number;
  runsDay: number;
  runsWeek: number;
  running: number;
  /** Every account's files together, and the share of the disk they may take (null when the disk can't be read). */
  bytes: number;
  shareBytes: number | null;
}

export type AccountListing = AccountInfo & AccountStats;

/**
 * Every account's runs in one pass over generations_account (a range search: only accounts' entries). Helper steps
 * count only in `running`, which counts as POST /api/generations does (activeRuns): one per batch or chain.
 */
export const STATS_SQL = `SELECT account, SUM(NOT step) AS runs, SUM(NOT step AND created_at >= @day) AS runsDay,
  SUM(NOT step AND created_at >= @week) AS runsWeek, COUNT(DISTINCT CASE WHEN status IN ('queued', 'running') THEN COALESCE(batch_id, id) END) AS running,
  SUM(NOT step AND status = 'failed' AND created_at >= @week) AS failedWeek, MAX(CASE WHEN NOT step THEN created_at END) AS lastRunAt
  FROM (SELECT json_extract(g.request_json, '$.account') AS account, ${HELPER_SQL} AS step, g.id, g.batch_id, g.status, g.created_at
    FROM generations g WHERE json_extract(g.request_json, '$.account') > '')
  GROUP BY account`;

/** What each account's files weigh (what accountUsage counts), over assets_account. */
export const SPACE_SQL = "SELECT account_id AS account, SUM(size) AS bytes FROM assets WHERE account_id > '' GROUP BY account_id";

type StatsRow = { account: string; runs: number; runsDay: number; runsWeek: number; running: number; failedWeek: number; lastRunAt: number | null };

/** Each account with its numbers, and the totals over every account's runs and files on this server. */
export function accountsWithStats(items: AccountInfo[] = listAccounts(), now = Date.now()): { items: AccountListing[]; totals: AccountTotals } {
  const runs = db().prepare(STATS_SQL).all({ day: now - DAY, week: now - 7 * DAY }) as StatsRow[];
  const space = db().prepare(SPACE_SQL).all() as { account: string; bytes: number }[];
  const runsOf = new Map(runs.map((r) => [r.account, r]));
  const bytesOf = new Map(space.map((r) => [r.account, Number(r.bytes)]));
  const sum = (key: "runsDay" | "runsWeek" | "running") => runs.reduce((n, r) => n + Number(r[key]), 0);
  const share = accountsMaxBytes();
  return {
    items: items.map((a) => {
      const r = runsOf.get(a.id);
      return {
        ...a,
        runs: Number(r?.runs ?? 0),
        runsDay: Number(r?.runsDay ?? 0),
        runsWeek: Number(r?.runsWeek ?? 0),
        running: Number(r?.running ?? 0),
        failedWeek: Number(r?.failedWeek ?? 0),
        lastRunAt: r?.lastRunAt != null ? Number(r.lastRunAt) : null,
        bytes: bytesOf.get(a.id) ?? 0,
        capBytes: accountTotalBytes(a.id, a.createdAt),
      };
    }),
    // Every account's runs and files the server holds (what diskHasRoom weighs against the share).
    totals: {
      accounts: items.length,
      runsDay: sum("runsDay"),
      runsWeek: sum("runsWeek"),
      running: sum("running"),
      bytes: space.reduce((n, r) => n + Number(r.bytes), 0),
      shareBytes: Number.isFinite(share) ? share : null,
    },
  };
}

/** The status filter's choices: a canceled run shows under "any status" only. */
const STATUSES = new Map<string, Generation["status"][]>([
  ["finished", ["succeeded"]],
  ["running", ["queued", "running"]],
  ["failed", ["failed"]],
]);

export const RUNS_PAGE = 30;
const MAX_RUNS_PAGE = 100;

/**
 * GET /api/admin/generations query → listGenerations options: `account` (one account, else every account's), `status`
 * (finished, running, failed), `kind`, `before=<createdAt>:<id>` and `limit` (≤ 100). Unknown statuses and kinds are
 * ignored, as the Library's list ignores them.
 */
export function accountRunOptions(sp: URLSearchParams): ListOptions | { error: string } {
  const account = sp.get("account")?.trim();
  if (account && !/^[\w-]{1,40}$/.test(account)) return { error: "Pick an account" };
  const kind = sp.get("kind") ?? "";
  const asked = Math.trunc(Number(sp.get("limit")));
  return {
    ...(account ? { account } : { accounts: true }),
    statuses: STATUSES.get(sp.get("status") ?? ""),
    kind: KINDS.has(kind) ? kind : undefined,
    ...cursorFrom(sp.get("before")),
    limit: sp.get("limit") && Number.isFinite(asked) ? Math.max(1, Math.min(asked, MAX_RUNS_PAGE)) : RUNS_PAGE,
  };
}

/** An account's run as the owner sees it: whose it is (null email: the account was deleted). */
export type AccountRun = Generation & { account: { id: string; email: string | null } };

/** One page of accounts' runs, newest first, and the cursor of the next (null on the last page). Never the owner's. */
export function listAccountRuns(o: ListOptions): { items: AccountRun[]; next: string | null } {
  const limit = o.limit ?? RUNS_PAGE;
  const opts: ListOptions = o.account ? { ...o, accounts: undefined, limit } : { ...o, account: undefined, accounts: true, limit };
  const emails = new Map(listAccounts().map((a) => [a.id, a.email]));
  // The WHERE already leaves the owner's runs out; this keeps them out whatever a caller passes.
  const found = listGenerations(opts).filter((g) => g.request.account);
  const last = found.at(-1);
  return {
    items: found.map((g) => ({ ...g, account: { id: g.request.account!, email: emails.get(g.request.account!) ?? null } })),
    next: last && found.length === limit ? `${last.createdAt}:${last.id}` : null,
  };
}
