import "server-only";
import { SKILL_CHECK_FEATURE, type SkillUse } from "@/lib/recipe";
import { db } from "./db";

/**
 * How each saved skill is used, from the skill stamp on the owner's generations (request_json `skill.name`; a skill's
 * own dry runs, skill-check rows or a studio step's rows stamped skill.check, and an account's runs don't count).
 * Assist ranks its skills index and list_skills by it (rankSkills).
 */

declare global {
  var __fuobeSkillUse: { at: number; uses: Map<string, SkillUse> } | undefined;
}

/** How each skill is used (runs and the last one), from the owner's runs; read again at most once a minute. */
export function skillUses(now = Date.now()): Map<string, SkillUse> {
  const cached = globalThis.__fuobeSkillUse;
  if (cached && now - cached.at < 60_000 && cached.at <= now) return cached.uses;
  const rows = db()
    .prepare(
      `SELECT json_extract(request_json, '$.skill.name') AS name, COUNT(DISTINCT COALESCE(json_extract(request_json, '$.skill.run'), batch_id, id)) AS runs, MAX(created_at) AS last
       FROM generations WHERE json_extract(request_json, '$.skill.name') IS NOT NULL AND feature != ? AND json_extract(request_json, '$.skill.check') IS NULL
         AND json_extract(request_json, '$.account') IS NULL
       GROUP BY name`,
    )
    .all(SKILL_CHECK_FEATURE) as { name: string; runs: number; last: number }[];
  const uses = new Map(rows.map((r) => [r.name, { runs: r.runs, last: r.last }]));
  globalThis.__fuobeSkillUse = { at: now, uses };
  return uses;
}

/** Forget the cached use counts (a test, or right after a run). */
export const forgetSkillUses = () => void (globalThis.__fuobeSkillUse = undefined);
