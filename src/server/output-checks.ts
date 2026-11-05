import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import type { OutputFile } from "@/lib/catalog/types";
import { db } from "./db";
import { checkOutput, moderationMaxWaitMs } from "./moderation";
import { absolutePath, deleteAsset, getAsset } from "./storage";

/**
 * Output checks (moderation.ts): a run whose check-run answer asked to see its outputs (`checkOutputs`) doesn't
 * succeed when its files are saved. Its files are held (never served to the account), its row stays running with the
 * stage "checking", and each file goes to check-output:
 *
 * - every file "show": the files are served and the row succeeds;
 * - any file "hide": that file is removed, and the row fails with the service's words (a hold is refunded as "hidden");
 * - "wait", or no answer: asked again later; past FUOBE_MODERATION_MAX_WAIT_H (24 h) the row fails and its files are
 *   removed (a hold is refunded as "unchecked").
 */

export const HIDDEN_WORDS = "This result was removed by the studio's checks. Not charged.";
export const UNCHECKED_WORDS = "This result couldn't be checked in time, so it was removed. Not charged.";
export const CHECKING_WORDS = "Checking";

/**
 * Hold a finished run's files for their check (the runner calls it instead of marking the row succeeded). `live`: only
 * while the run still goes (queued or running, not already held for its check), as the runner saves it: a run stopped
 * meanwhile stays stopped, nothing of it is held, and the caller removes its files. `turn`: the app process saving it
 * (generations.ts claimFinish); while another process holds the turn, that process saves the run, and nothing is held
 * here either. Returns whether the files were held.
 */
export function holdForCheck(generationId: string, outputs: OutputFile[], o: { live?: boolean; turn?: string; now?: number } = {}): boolean {
  const now = o.now ?? Date.now();
  const d = db();
  const ids = outputs.map((o) => o.assetId).filter((x): x is string => !!x);
  const live = o.live ? " AND status IN ('queued', 'running') AND stage IS NULL" : "";
  const turn = o.turn ? " AND NOT EXISTS (SELECT 1 FROM generation_runs WHERE id = @id AND finish_by IS NOT NULL AND finish_by != @turn AND finish_until >= @now)" : "";
  return d.transaction((): boolean => {
    const held =
      d
        .prepare(`UPDATE generations SET status = 'running', stage = 'checking', progress = 0.99, message = @message, outputs_json = @outputs, updated_at = @now WHERE id = @id${live}${turn}`)
        .run({ message: CHECKING_WORDS, outputs: JSON.stringify(outputs), now, id: generationId, ...(o.turn && { turn: o.turn }) }).changes > 0;
    if (!held) return false;
    for (const id of ids) {
      d.prepare("UPDATE assets SET held = 1 WHERE id = ?").run(id);
      d.prepare("INSERT OR IGNORE INTO output_checks (asset_id, generation_id, state, asked_at, tries, next_at) VALUES (?, ?, 'waiting', ?, 0, ?)").run(id, generationId, now, now);
    }
    // A run with no saved file (words only) has nothing to check: it succeeds as it is.
    if (!ids.length) d.prepare("UPDATE generations SET status = 'succeeded', stage = NULL, progress = 1, message = NULL, completed_at = ?, updated_at = ? WHERE id = ?").run(now, now, generationId);
    return true;
  })();
}

type Kind = "image" | "video" | "audio";
const kindOf = (contentType: string): Kind => (contentType.startsWith("video/") ? "video" : contentType.startsWith("audio/") ? "audio" : "image");

interface CheckRow {
  asset_id: string;
  generation_id: string;
  asked_at: number;
  tries: number;
}

/** Decide every run whose files all have an answer (or whose wait ran out). */
function settleRuns(now: number): void {
  const d = db();
  const runs = d
    .prepare(
      `SELECT g.id, g.outputs_json, g.status FROM generations g
       WHERE g.stage = 'checking' AND (
         NOT EXISTS (SELECT 1 FROM output_checks c WHERE c.generation_id = g.id AND c.state = 'waiting')
         OR EXISTS (SELECT 1 FROM output_checks c WHERE c.generation_id = g.id AND c.state = 'hidden'))`,
    )
    .all() as { id: string; outputs_json: string; status: string }[];
  for (const r of runs) {
    const states = d.prepare("SELECT asset_id, state, text FROM output_checks WHERE generation_id = ?").all(r.id) as { asset_id: string; state: string; text: string | null }[];
    const hidden = states.filter((s) => s.state === "hidden");
    const unchecked = states.some((s) => s.state === "unchecked");
    if (r.status !== "running") {
      // Stopped meanwhile: its held files stay held (never served); the row says what it says.
      d.prepare("UPDATE generations SET stage = NULL WHERE id = ?").run(r.id);
      continue;
    }
    if (hidden.length || unchecked) {
      // Hidden or never checked: every held file of the run goes, and the row fails.
      for (const s of states) if (s.state !== "hidden") removeHeld(s.asset_id);
      const words = hidden.length ? hidden.find((h) => h.text)?.text || HIDDEN_WORDS : UNCHECKED_WORDS;
      d.prepare("UPDATE output_checks SET state = CASE WHEN state = 'waiting' THEN 'unchecked' ELSE state END, decided_at = COALESCE(decided_at, ?) WHERE generation_id = ?").run(now, r.id);
      d.prepare("UPDATE generations SET status = 'failed', stage = NULL, error = ?, message = NULL, outputs_json = '[]', completed_at = ?, updated_at = ? WHERE id = ?").run(words, now, now, r.id);
      continue;
    }
    d.transaction(() => {
      for (const s of states) d.prepare("UPDATE assets SET held = 0 WHERE id = ?").run(s.asset_id);
      d.prepare("UPDATE generations SET status = 'succeeded', stage = NULL, progress = 1, message = NULL, completed_at = ?, updated_at = ? WHERE id = ?").run(now, now, r.id);
    })();
  }
}

/** A held file goes for good. */
function removeHeld(assetId: string): void {
  try {
    deleteAsset(assetId);
  } catch (e) {
    console.warn(`[fuobe] couldn't remove a held file ${assetId}: ${(e as Error).message}`);
  }
}

declare global {
  var __fuobeOutputChecks: boolean | undefined;
}

/** One sweep (the runner's tick): ask about each file that is due, then decide the runs that can be decided. */
export async function sweepOutputChecks(now = Date.now(), limit = 20): Promise<void> {
  if (globalThis.__fuobeOutputChecks) return;
  globalThis.__fuobeOutputChecks = true;
  try {
    const d = db();
    const maxWait = moderationMaxWaitMs();
    // Past the wait: never checked.
    d.prepare("UPDATE output_checks SET state = 'unchecked', decided_at = ? WHERE state = 'waiting' AND asked_at <= ?").run(now, now - maxWait);
    const due = d.prepare("SELECT asset_id, generation_id, asked_at, tries FROM output_checks WHERE state = 'waiting' AND next_at <= ? ORDER BY next_at LIMIT ?").all(now, limit) as CheckRow[];
    for (const c of due) {
      const asset = getAsset(c.asset_id);
      if (!asset) {
        d.prepare("UPDATE output_checks SET state = 'unchecked', decided_at = ? WHERE asset_id = ?").run(now, c.asset_id);
        continue;
      }
      let bytes: Buffer;
      try {
        bytes = fs.readFileSync(absolutePath(asset.relPath));
      } catch {
        d.prepare("UPDATE output_checks SET state = 'unchecked', decided_at = ? WHERE asset_id = ?").run(now, c.asset_id);
        continue;
      }
      const account = (d.prepare("SELECT json_extract(request_json, '$.account') AS a FROM generations WHERE id = ?").get(c.generation_id) as { a: string | null } | undefined)?.a ?? null;
      const answer = await checkOutput({
        bytes,
        contentType: asset.contentType,
        generationId: c.generation_id,
        account,
        assetId: c.asset_id,
        kind: kindOf(asset.contentType),
        sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      });
      if (answer.decision === "show") d.prepare("UPDATE output_checks SET state = 'shown', decided_at = ?, tries = tries + 1 WHERE asset_id = ?").run(now, c.asset_id);
      else if (answer.decision === "hide") {
        d.prepare("UPDATE output_checks SET state = 'hidden', decided_at = ?, tries = tries + 1, text = ? WHERE asset_id = ?").run(now, answer.text || null, c.asset_id);
        removeHeld(c.asset_id);
      } else d.prepare("UPDATE output_checks SET tries = tries + 1, next_at = ? WHERE asset_id = ?").run(now + answer.retryAfterS * 1000, c.asset_id);
    }
    settleRuns(now);
  } catch (e) {
    console.warn(`[fuobe] output checks: ${(e as Error).message}`);
  } finally {
    globalThis.__fuobeOutputChecks = false;
  }
}

/** How many files wait for their check, and since when (the admin queue view). */
export function checksDepth(): { waiting: number; oldestAt: number | null } {
  const r = db().prepare("SELECT COUNT(*) AS n, MIN(asked_at) AS oldest FROM output_checks WHERE state = 'waiting'").get() as { n: number; oldest: number | null };
  return { waiting: r.n, oldestAt: r.oldest };
}
