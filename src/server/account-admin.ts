import "server-only";
import path from "node:path";
import type { Generation, OutputFile, RunSource } from "@/lib/catalog/types";
import { accountsMaxBytes, accountTotalBytes } from "./account-files";
import { listAccounts, type AccountInfo } from "./auth";
import { db } from "./db";
import { declinedCardsIn, getGeneration, listGenerations, type ListOptions } from "./generations";
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

/**
 * The status filter's choices: `finished` (or `done`), `failed`, `canceled`, `waiting` (in line, not started),
 * `started` (working now) and `running` (both of those, as before).
 */
const STATUSES = new Map<string, Generation["status"][]>([
  ["finished", ["succeeded"]],
  ["done", ["succeeded"]],
  ["running", ["queued", "running"]],
  ["waiting", ["queued"]],
  ["started", ["running"]],
  ["failed", ["failed"]],
  ["canceled", ["canceled"]],
]);

export const RUNS_PAGE = 30;
const MAX_RUNS_PAGE = 100;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whose runs a list holds: `people` (accounts' and guests'), `ours` (the owner's own) or `everyone` (both). */
export type RunsWhose = "people" | "ours" | "everyone";

/** A yyyy-mm-dd day's start in UTC (ms), or undefined for anything else. */
function dayStart(v: string | null): number | undefined {
  if (!v || !DATE.test(v)) return undefined;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) ? t : undefined;
}

/**
 * GET /api/admin/generations query → listGenerations options: `account` (one account), else `whose` (`people`: every
 * account's and guest's, the default; `ours`: the owner's own; `everyone`), `source` (the owner's runs only: `hands-on`
 * or `batch`), `where` (`pool`, `provider`, `own`), `status` (STATUSES), `kind`, `model` (letters of the model id), `from`
 * and `to` (yyyy-mm-dd in UTC, both days included), `q` (words of the prompt, or a run id), `before=<createdAt>:<id>` and
 * `limit` (≤ 100). Unknown values are ignored, as the Library's list ignores them.
 */
export function accountRunOptions(sp: URLSearchParams): (ListOptions & { whose: RunsWhose }) | { error: string } {
  const account = sp.get("account")?.trim();
  if (account && !/^[\w-]{1,40}$/.test(account)) return { error: "Pick an account" };
  const kind = sp.get("kind") ?? "";
  const asked = Math.trunc(Number(sp.get("limit")));
  const source = sp.get("source");
  const askedWhose = sp.get("whose");
  // A source names the owner's runs, so it means Ours.
  const whose: RunsWhose = account ? "people" : source === "hands-on" || source === "batch" ? "ours" : askedWhose === "ours" || askedWhose === "everyone" ? askedWhose : "people";
  const where = sp.get("where");
  const model = sp.get("model")?.trim().slice(0, 80);
  const q = sp.get("q")?.trim().slice(0, 200);
  const from = dayStart(sp.get("from"));
  const to = dayStart(sp.get("to"));
  return {
    ...(account ? { account } : whose === "people" ? { accounts: true } : whose === "everyone" ? { everyone: true } : {}),
    whose,
    ...((source === "hands-on" || source === "batch") && { source }),
    ...((where === "pool" || where === "provider" || where === "own") && { where }),
    statuses: STATUSES.get(sp.get("status") ?? ""),
    kind: KINDS.has(kind) ? kind : undefined,
    ...(model && { modelLike: model }),
    ...(q && { q }),
    ...(from !== undefined && { since: from }),
    ...(to !== undefined && { until: to + DAY }),
    ...cursorFrom(sp.get("before")),
    limit: sp.get("limit") && Number.isFinite(asked) ? Math.max(1, Math.min(asked, MAX_RUNS_PAGE)) : RUNS_PAGE,
  };
}

/**
 * Where a result stands: `shown` (served as usual), `held` (hidden, or waiting for its check: served to no account and
 * by no link) or `removed` (its file is gone).
 */
export type OutputState = "shown" | "held" | "removed";

/**
 * An account's run as the owner sees it: whose it is (null email: the account was deleted; no `email` and
 * `emailHidden: true`: a reader that may not see emails), and each result's state. A run on this install's GPUs also
 * carries `detail`: the technical reason it failed, which the account never sees (its own page shows one plain sentence).
 * `whose`: an account's, a guest's (an account id that starts with "guest") or, in AdminRun, the owner's own.
 */
export type AccountRun = Omit<Generation, "outputs"> & { outputs: (OutputFile & { state: OutputState })[]; account: AccountOfRun; whose: RunWhose; detail?: string };

/** Whose a run is. */
export type RunWhose = "account" | "guest" | "owner";

/**
 * A run in the owner's admin list: an account's or a guest's (as AccountRun), or the owner's own (`account` null, `whose`
 * "owner", and `source`: what made it, "hands-on" when its runner said nothing).
 */
export type AdminRun = Omit<AccountRun, "account"> & { account: AccountOfRun | null; source?: RunSource };

/** Whose a run is: its email (null: the account was deleted), or no email and `emailHidden` for a reader that may not see emails. */
export type AccountOfRun = { id: string; email?: string | null; emailHidden?: true };

/** Each result's state, read from its stored file (its asset row; none: removed). An output that isn't a stored file is shown. */
function withStates(outputs: OutputFile[]): (OutputFile & { state: OutputState })[] {
  const byId = db().prepare("SELECT held FROM assets WHERE id = ?");
  const byPath = db().prepare("SELECT held FROM assets WHERE rel_path IN (?, ?) LIMIT 1");
  return outputs.map((o) => {
    const rel = o.url.startsWith("/api/files/") ? o.url.slice("/api/files/".length) : null;
    if (!o.assetId && !rel) return { ...o, state: "shown" };
    const row = (o.assetId ? byId.get(o.assetId) : byPath.get(rel, rel!.split("/").join(path.sep))) as { held: number } | undefined;
    return { ...o, state: !row ? "removed" : row.held ? "held" : "shown" };
  });
}

/**
 * A run with its content left out (what a reader without outputs:view gets): when, which model and app, how it ended and
 * how many results, never its prompt, its inputs, its results' files or words, or its technical reason.
 */
export type AccountRunFacts = Pick<
  AdminRun,
  "id" | "batchId" | "feature" | "presetId" | "presetName" | "modelId" | "modelName" | "engine" | "provider" | "op" | "kind" | "status" | "progress" | "costUsd" | "createdAt" | "updatedAt" | "completedAt" | "place" | "account" | "whose" | "source"
> & { outputs: { kind: OutputFile["kind"]; state: OutputState }[] };

function factsOnly(r: AdminRun): AccountRunFacts {
  return {
    id: r.id,
    batchId: r.batchId,
    feature: r.feature,
    presetId: r.presetId,
    presetName: r.presetName,
    modelId: r.modelId,
    modelName: r.modelName,
    engine: r.engine,
    provider: r.provider,
    op: r.op,
    kind: r.kind,
    status: r.status,
    progress: r.progress,
    costUsd: r.costUsd,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    completedAt: r.completedAt,
    ...(r.place && { place: r.place }),
    account: r.account,
    whose: r.whose,
    ...(r.source && { source: r.source }),
    outputs: r.outputs.map((x) => ({ kind: x.kind, state: x.state })),
  };
}

/**
 * One page of accounts' runs, newest first, and the cursor of the next (null on the last page). Never the owner's.
 * `show.content` false: each run's facts only (factsOnly); `show.emails` false: no account's email.
 */
export function listAccountRuns(o: ListOptions): { items: AccountRun[]; next: string | null } {
  const limit = o.limit ?? RUNS_PAGE;
  const opts: ListOptions = o.account ? { ...o, accounts: undefined, everyone: undefined, source: undefined, limit } : { ...o, account: undefined, accounts: true, everyone: undefined, source: undefined, limit };
  const emails = new Map(listAccounts().map((a) => [a.id, a.email]));
  // The WHERE already leaves the owner's runs out; this keeps them out whatever a caller passes.
  const found = listGenerations(opts).filter((g) => g.request.account);
  const last = found.at(-1);
  return { items: found.map((g) => asAccountRun(g, emails, true)), next: last && found.length === limit ? `${last.createdAt}:${last.id}` : null };
}

/**
 * One page of the owner's admin list of runs (GET /api/admin/generations), newest first, and the cursor of the next:
 * accounts' and guests' runs, the owner's own, or both (`whose`). `show.content` false: each run's facts only
 * (factsOnly); `show.emails` false: no account's email.
 */
export function listAdminRuns(o: ListOptions & { whose?: RunsWhose }, show: { content: boolean; emails: boolean } = { content: true, emails: true }): { items: (AdminRun | AccountRunFacts)[]; next: string | null } {
  const limit = o.limit ?? RUNS_PAGE;
  const whose = o.account ? "people" : (o.whose ?? "people");
  const rest: ListOptions = { ...o };
  delete (rest as { whose?: RunsWhose }).whose;
  const opts: ListOptions =
    whose === "people"
      ? { ...rest, ...(o.account ? { accounts: undefined } : { accounts: true }), everyone: undefined, source: undefined, limit }
      : whose === "ours"
        ? { ...rest, account: undefined, accounts: undefined, everyone: undefined, limit }
        : { ...rest, account: undefined, accounts: undefined, everyone: true, source: undefined, limit };
  const emails = new Map(listAccounts().map((a) => [a.id, a.email]));
  const found = listGenerations(opts).filter((g) => (whose === "people" ? !!g.request.account : whose === "ours" ? !g.request.account : true));
  const last = found.at(-1);
  return {
    items: found.map((g) => {
      const run = asAdminRun(g, emails, show.emails);
      return show.content ? run : factsOnly(run);
    }),
    next: last && found.length === limit ? `${last.createdAt}:${last.id}` : null,
  };
}

/** Whose a run is, from its stamped account (none: the owner's own; a "guest…" id: a guest's). */
export const runWhose = (account: string | null | undefined): RunWhose => (!account ? "owner" : account.startsWith("guest") ? "guest" : "account");

/** An account's run (`g.request.account` set) as the owner sees it: whose, each result's state, and a hosted run's technical reason. */
function asAccountRun(g: Generation, emails: Map<string, string>, showEmails: boolean): AccountRun {
  const id = g.request.account!;
  const account: AccountOfRun = showEmails ? { id, email: emails.get(id) ?? null } : { id, emailHidden: true };
  return { ...g, outputs: withStates(g.outputs), account, whose: runWhose(id), ...poolDetail(g), ...declinedCardsIn(g.id) };
}

/** Any run as the owner's admin list has it: an account's (asAccountRun), or the owner's own with its source. */
function asAdminRun(g: Generation, emails: Map<string, string>, showEmails: boolean): AdminRun {
  if (g.request.account) return asAccountRun(g, emails, showEmails);
  return { ...g, outputs: withStates(g.outputs), account: null, whose: "owner", source: g.request.source ?? "hands-on", ...ownDetail(g), ...declinedCardsIn(g.id) };
}

/**
 * A failed run on this install's GPUs: its technical detail (the engine's words, cleaned), else the stored reason when it
 * isn't the plain sentence the account reads.
 */
function poolDetail(g: Generation): { detail?: string } {
  if (g.place !== "pool" || !g.error) return {};
  const row = db().prepare("SELECT error, detail FROM generations WHERE id = ?").get(g.id) as { error: string | null; detail: string | null } | undefined;
  if (row?.detail) return { detail: row.detail };
  return row?.error && row.error !== g.error ? { detail: row.error } : {};
}

/** The owner's own failed run: its stored technical detail, when it has one. */
function ownDetail(g: Generation): { detail?: string } {
  if (!g.error) return {};
  const row = db().prepare("SELECT detail FROM generations WHERE id = ?").get(g.id) as { detail: string | null } | undefined;
  return row?.detail ? { detail: row.detail } : {};
}

/** One account's run as the list gives it (null: no such run, or it is the owner's own). */
export function accountRunById(id: string, showEmails = true): AccountRun | null {
  const g = getGeneration(id, { includeDeleted: true });
  if (!g?.request.account) return null;
  return asAccountRun(g, new Map(listAccounts().map((a) => [a.id, a.email])), showEmails);
}

/** Any run as the owner's admin list gives it, the owner's own too (null: no such run). */
export function adminRunById(id: string, showEmails = true): AdminRun | null {
  const g = getGeneration(id, { includeDeleted: true });
  if (!g) return null;
  return asAdminRun(g, new Map(listAccounts().map((a) => [a.id, a.email])), showEmails);
}
