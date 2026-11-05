import "server-only";
import { isCloudProvider, type CloudProvider } from "@/lib/your-keys";
import { accountProviders } from "./account-keys";
import { accountGpu } from "./auth";
import { db } from "./db";

/**
 * Where an account's runs go, as it picked (hosted runs: the Run on list, Settings → Your GPU, the one-time note):
 * "site" this install's GPUs, "gpu" its own GPU, "key" its own fal.ai or Replicate key for what has a cloud version
 * (the rest on this install's GPUs). No row: the install's default (the billing service's policy). A table of its own,
 * made in db.ts (RUN_ON_TABLES), read only while hosted runs are on, and empty on every install where they are off.
 *
 * The pick names a place the account has: a pick of its GPU or key is dropped once that GPU is forgotten or that key is
 * removed (clearRunOnFor; runOnOf drops one left behind), and its runs go to this install's GPUs again.
 */

export type RunOn = "site" | "gpu" | "key";

export interface RunOnPick {
  runOn: RunOn;
  /** With "key": the provider whose key runs it. */
  runKey?: CloudProvider;
}

export const isRunOn = (v: unknown): v is RunOn => v === "site" || v === "gpu" || v === "key";

/** The pick as kept, or null (none kept). */
export function getRunOn(accountId: string): RunOnPick | null {
  const r = db().prepare("SELECT run_on, run_key FROM account_run_on WHERE account_id = ?").get(accountId) as
    { run_on: string; run_key: string | null } | undefined;
  if (!r || !isRunOn(r.run_on)) return null;
  return {
    runOn: r.run_on,
    ...(r.run_on === "key" && isCloudProvider(r.run_key) && { runKey: r.run_key }),
  };
}

/** Keep the account's pick (one row per account: a new pick replaces the old one). */
export function setRunOn(accountId: string, pick: RunOnPick): void {
  db()
    .prepare(
      `INSERT INTO account_run_on (account_id, run_on, run_key, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET run_on = excluded.run_on, run_key = excluded.run_key, updated_at = excluded.updated_at`,
    )
    .run(accountId, pick.runOn, pick.runOn === "key" ? (pick.runKey ?? null) : null, Date.now());
}

/** Forget the account's pick (a deleted account; nothing kept means the install's default). */
export function clearRunOn(accountId: string): void {
  db().prepare("DELETE FROM account_run_on WHERE account_id = ?").run(accountId);
}

/**
 * The account's GPU was forgotten, or one of its keys removed: a pick of that place is dropped (its runs go to this
 * install's GPUs again). True when it was dropped, so the page says where runs go now.
 */
export function clearRunOnFor(accountId: string, gone: { gpu: true } | { key: CloudProvider }): boolean {
  const pick = getRunOn(accountId);
  if (!pick) return false;
  const drop = "gpu" in gone ? pick.runOn === "gpu" : pick.runOn === "key" && (!pick.runKey || pick.runKey === gone.key || !accountProviders(accountId).length);
  if (drop) clearRunOn(accountId);
  return drop;
}

/**
 * The pick the account's runs follow: its kept pick while the place it names is still there (a GPU connected; a key
 * this server can open), else none (and a pick left behind is dropped). `keys`: the providers it has a key for, when
 * the caller has them already.
 */
export function runOnOf(accountId: string, keys?: CloudProvider[]): RunOnPick | null {
  const pick = getRunOn(accountId);
  if (!pick) return null;
  if (pick.runOn === "gpu" && !accountGpu(accountId)) {
    clearRunOn(accountId);
    return null;
  }
  if (pick.runOn === "key") {
    const has = keys ?? accountProviders(accountId);
    if (!has.length) {
      clearRunOn(accountId);
      return null;
    }
    // The provider it named is gone but another key is there: that one runs it.
    if (!pick.runKey || !has.includes(pick.runKey)) return { runOn: "key", runKey: has.includes("fal") ? "fal" : has[0] };
  }
  return pick;
}

/**
 * Where the remembered pick sends a run that names no place of its own (hosted-run.ts): "own" for the account's GPU;
 * "pool" for this install's GPUs (a pick of the key is carried by the page as the Cloud engine, so a run that comes
 * here open runs on this install's GPUs); undefined with no pick (the install's default).
 */
export function rememberedPlace(accountId: string): "own" | "pool" | undefined {
  const r = db().prepare("SELECT run_on FROM account_run_on WHERE account_id = ?").get(accountId) as { run_on: string } | undefined;
  if (!r) return undefined;
  if (r.run_on === "gpu") return accountGpu(accountId) ? "own" : undefined;
  return r.run_on === "site" || r.run_on === "key" ? "pool" : undefined;
}

/**
 * Has the account run on its own GPU or key before it ever ran on this install's GPUs (its own history: a run with no
 * place "pool", older than its first run there)? Then hosted runs going on moved its runs, and the one-time note says
 * so. An account that connected its GPU or saved its key after its first run here never ran elsewhere first.
 */
export function ranOwnFirst(accountId: string): boolean {
  const r = db()
    .prepare(
      `SELECT MIN(CASE WHEN json_extract(request_json, '$.place') = 'pool' THEN created_at END) AS site,
              MIN(CASE WHEN COALESCE(json_extract(request_json, '$.place'), '') <> 'pool' AND provider IN ('comfyui', 'fal', 'replicate') THEN created_at END) AS own
         FROM generations WHERE json_extract(request_json, '$.account') = ?`,
    )
    .get(accountId) as { site: number | null; own: number | null } | undefined;
  if (!r?.own) return false;
  return r.site === null || r.own < r.site;
}
