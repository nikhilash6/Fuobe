import "server-only";
import path from "node:path";
import { db } from "./db";

/**
 * An account's own runs and files (public sign-up, "Your GPU"): a generation an account started carries its id in the
 * stored request (`account`, set by the server only); a stored file carries it in `assets.account_id` (its upload, or a
 * file of its run). Everything else is the owner's. The proxy lets an account read, cancel and delete only its own
 * (src/proxy.ts), and its runs read only its own files (storage.ts guardRef).
 */

/** Who made this generation: an account id, null for the owner, undefined when there is no such generation. */
export function generationAccount(id: string): string | null | undefined {
  const row = db().prepare("SELECT json_extract(request_json, '$.account') AS account FROM generations WHERE id = ?").get(id) as { account: string | null } | undefined;
  return row ? (row.account ?? null) : undefined;
}

/**
 * Whose stored file this is (`rel`: its path under the files folder, with / or the platform's separator): an account id,
 * null for the owner, undefined when no file is stored there. A file stamped before the account column existed goes by
 * the run that made it.
 */
export function fileAccount(rel: string): string | null | undefined {
  // Rows store the platform's separator (backslashes on Windows); a URL always has /.
  const native = rel.split("/").join(path.sep);
  const row = db()
    .prepare(
      `SELECT COALESCE(a.account_id, CASE WHEN json_valid(g.request_json) THEN json_extract(g.request_json, '$.account') END) AS account
       FROM assets a LEFT JOIN generations g ON g.id = a.generation_id WHERE a.rel_path IN (?, ?) LIMIT 1`,
    )
    .get(rel, native) as { account: string | null } | undefined;
  return row ? (row.account ?? null) : undefined;
}

/** Whose stored file this asset id is (as fileAccount; undefined when there is no such asset). */
export function assetAccount(id: string): string | null | undefined {
  const row = db()
    .prepare(
      `SELECT COALESCE(a.account_id, CASE WHEN json_valid(g.request_json) THEN json_extract(g.request_json, '$.account') END) AS account
       FROM assets a LEFT JOIN generations g ON g.id = a.generation_id WHERE a.id = ? LIMIT 1`,
    )
    .get(id) as { account: string | null } | undefined;
  return row ? (row.account ?? null) : undefined;
}
