import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { OutputFile } from "@/lib/catalog/types";
import { DATA_DIR, db } from "./db";
import { absolutePath, deleteAsset, getAsset } from "./storage";

/**
 * Take a result down (the owner, POST /api/admin/outputs/{hide,unhide,remove}): by asset id or by run. Hidden files are
 * held (account-library.ts): served to no account and by no link, kept for the owner. Removed files are deleted, or,
 * with `evidence`, moved to a locked folder only the server's user can read (`<data>/evidence`, mode 0600).
 */

export interface Targets {
  assetIds?: string[];
  generationIds?: string[];
}

const ID = /^[\w-]{1,64}$/;

/** The asset ids a request names (its own, and every saved output of the runs it names). */
export function targetAssets(t: Targets): string[] {
  const ids = new Set((t.assetIds ?? []).filter((x) => ID.test(x)));
  for (const g of (t.generationIds ?? []).filter((x) => ID.test(x))) {
    const rows = db().prepare("SELECT id FROM assets WHERE generation_id = ?").all(g) as { id: string }[];
    for (const r of rows) ids.add(r.id);
  }
  return [...ids].slice(0, 500);
}

export function hideOutputs(t: Targets): number {
  let n = 0;
  for (const id of targetAssets(t)) n += db().prepare("UPDATE assets SET held = 1 WHERE id = ? AND held = 0").run(id).changes;
  return n;
}

export function unhideOutputs(t: Targets): number {
  let n = 0;
  // A file still waiting for its check stays held.
  for (const id of targetAssets(t)) n += db().prepare("UPDATE assets SET held = 0 WHERE id = ? AND held = 1 AND NOT EXISTS (SELECT 1 FROM output_checks WHERE asset_id = ? AND state = 'waiting')").run(id, id).changes;
  return n;
}

/** The locked folder for evidence. */
export const evidenceDir = () => path.join(DATA_DIR, "evidence");

export function removeOutputs(t: Targets, evidence: boolean): number {
  let n = 0;
  for (const id of targetAssets(t)) {
    const a = getAsset(id);
    if (!a) continue;
    if (evidence) {
      const dir = evidenceDir();
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const dest = path.join(dir, `${id}${path.extname(a.relPath)}`);
      try {
        fs.renameSync(absolutePath(a.relPath), dest);
      } catch {
        fs.copyFileSync(absolutePath(a.relPath), dest);
      }
      try {
        fs.chmodSync(dest, 0o600);
      } catch {}
    }
    deleteAsset(id);
    // The run's result no longer lists it.
    if (a.generationId) {
      const r = db().prepare("SELECT outputs_json FROM generations WHERE id = ?").get(a.generationId) as { outputs_json: string } | undefined;
      if (r) {
        const left = (JSON.parse(r.outputs_json) as OutputFile[]).filter((o) => o.assetId !== id && o.url !== a.url);
        db().prepare("UPDATE generations SET outputs_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(left), Date.now(), a.generationId);
      }
    }
    n++;
  }
  return n;
}
