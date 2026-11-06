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

/** The waits before the free check is asked again when the provider was busy, down or out of reach. Tests make them shorter. */
export const KEY_CHECK = { waitsMs: [1_000, 3_000] };

/** A check that says nothing about the key (the provider busy, down, or out of reach): worth asking again in a moment. */
const passing = (c: KeyCheck) => !c.ok && (c.reason === "unreachable" || (c.reason === "odd" && (c.status === 429 || (c.status ?? 0) >= 500)));

/** The provider's free check of a key, asked again (twice, with a growing wait) while the provider is busy or down. */
export async function testKey(p: CloudProvider, key: string): Promise<KeyCheck> {
  let check: KeyCheck = p === "fal" ? await testFalKey(key) : await testReplicateKey(key);
  for (const ms of KEY_CHECK.waitsMs) {
    if (!passing(check)) break;
    await new Promise((r) => setTimeout(r, ms));
    check = p === "fal" ? await testFalKey(key) : await testReplicateKey(key);
  }
  return check;
}

/** What a check that couldn't tell said: plain words, the provider's status in `details`. */
function unclear(p: CloudProvider, check: KeyCheck & { ok: false }): { ok: false; error: string; status: number; details?: string } {
  const { label } = CLOUD_KEY[p];
  return check.reason === "unreachable"
    ? { ok: false, status: 503, error: `We couldn't reach ${label} to check your key. Try again in a minute.` }
    : { ok: false, status: 503, error: `${label} is busy right now, so we couldn't check your key. Try again in a minute.`, ...(check.status && { details: `${label} answered ${check.status}` }) };
}

/**
 * A key checked with its provider before it is saved: a free call that runs nothing, with the typed key only. A key that
 * works on a provider account with no balance left is saved too, with a note that says to top it up (`balance`).
 */
export async function checkKey(p: CloudProvider, key: string): Promise<{ ok: true; detail: string; note?: string; balance?: true } | { ok: false; error: string; status: number; details?: string }> {
  const { label } = CLOUD_KEY[p];
  const check = await testKey(p, key);
  if (check.ok) return { ok: true, detail: check.detail };
  if (check.reason === "balance") return { ok: true, detail: "Key accepted", note: emptyBalanceNote(p), balance: true };
  if (check.reason === "rejected") {
    const hint = settingProblem(CLOUD_KEY[p].setting, key);
    return { ok: false, status: 422, error: `${label} didn't accept this key. ${hint ? `${hint}.` : `Copy it again from ${label}.`}` };
  }
  // 503, not 502: a proxy in front (Cloudflare) answers an origin's 502 with its own page, and these words would be lost.
  return unclear(p, check);
}

/** The saved key checked again (Settings' "Check again"): what the provider says of it now. */
export async function recheckKey(p: CloudProvider, key: string): Promise<{ ok: true; balance?: true } | { ok: false; rejected?: true; error: string; status: number; details?: string }> {
  const { label } = CLOUD_KEY[p];
  const check = await testKey(p, key);
  if (check.ok) return { ok: true };
  if (check.reason === "balance") return { ok: true, balance: true };
  if (check.reason === "rejected") return { ok: false, rejected: true, status: 422, error: `${label} still doesn't accept this key. Replace it with a new one from ${label}.` };
  return unclear(p, check);
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
