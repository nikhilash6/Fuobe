import "server-only";
import { settingProblem } from "@/lib/connections";
import { CLOUD_KEY, emptyBalanceNote, type CloudProvider } from "@/lib/your-keys";
import { db } from "./db";
import { cancelGeneration, handOversDone } from "./generations";
import { testFalKey, type KeyCheck } from "./providers/fal";
import { testReplicateKey } from "./providers/replicate";

/**
 * Settings → Your keys (src/app/api/account/keys): checking a key an account typed, and the runs going on a key it
 * removes or replaces. The key itself is only ever sent to its provider; nothing here logs it or answers with it.
 */

/**
 * A key checked with its provider before it is saved: a free call that runs nothing, with the typed key only. A key that
 * works on a provider account with no balance left is saved too, with a note that says to top it up.
 */
export async function checkKey(p: CloudProvider, key: string): Promise<{ ok: true; detail: string; note?: string } | { ok: false; error: string; status: number }> {
  const { label } = CLOUD_KEY[p];
  const check: KeyCheck = p === "fal" ? await testFalKey(key) : await testReplicateKey(key);
  if (check.ok) return { ok: true, detail: check.detail };
  if (check.reason === "balance") return { ok: true, detail: "Key accepted", note: emptyBalanceNote(p) };
  if (check.reason === "rejected") {
    const hint = settingProblem(CLOUD_KEY[p].setting, key);
    return { ok: false, status: 422, error: `${label} didn't accept this key. Copy it again from ${label}'s API keys page.${hint ? ` (${hint}.)` : ""}` };
  }
  // 503, not 502: a proxy in front (Cloudflare) answers an origin's 502 with its own page, and these words would be lost.
  if (check.reason === "unreachable") return { ok: false, status: 503, error: `Couldn't reach ${label} to check the key, so it wasn't saved. Try again in a moment.` };
  return { ok: false, status: 503, error: `${label} answered ${check.status ?? "oddly"}, so the key couldn't be checked. Try again in a moment.` };
}

/** The account's runs going on a provider now (queued, running, or a step waiting to be sent there). */
export function runsOnKey(accountId: string, p: CloudProvider): string[] {
  return db()
    .prepare("SELECT id FROM generations WHERE status IN ('queued', 'running') AND provider = ? AND json_extract(request_json, '$.account') = ?")
    .pluck()
    .all(p, accountId) as string[];
}

/**
 * Stop the account's runs on a provider, at the provider, with the key still saved (before it is removed or replaced).
 * A run still being handed over is stopped there when its submit lands: that waits too.
 */
export async function stopRunsOnKey(accountId: string, p: CloudProvider): Promise<number> {
  const ids = runsOnKey(accountId, p);
  for (const id of ids) await cancelGeneration(id);
  if (!(await handOversDone(ids))) console.warn(`[fuobe] Your keys: a run was still being handed to ${CLOUD_KEY[p].label} after a minute; the key changes anyway`);
  return ids.length;
}

/** What the 409 says when runs are going on the key. */
export const runsGoingMessage = (n: number, replacing: boolean) =>
  `${n === 1 ? "1 run is" : `${n} runs are`} using this key now. ${replacing ? "Replacing" : "Removing"} it stops ${n === 1 ? "it" : "them"}.`;
