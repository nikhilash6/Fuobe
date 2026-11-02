import "server-only";
import { db } from "./db";

/**
 * How often and how lately each skill ran (package W6): its stamped generations (`request.skill`) grouped by run, the
 * owner's own and not in the Trash. Assist ranks skills by it, so the ones people use stay in its context.
 */
export function skillUsage(): Map<string, { runs: number; last: number }> {
  try {
    const rows = db()
      .prepare(
        `SELECT json_extract(request_json, '$.skill.name') AS name, COUNT(DISTINCT COALESCE(json_extract(request_json, '$.skill.run'), batch_id, id)) AS runs, MAX(created_at) AS last
         FROM generations WHERE json_valid(request_json) AND json_extract(request_json, '$.skill.name') IS NOT NULL AND json_extract(request_json, '$.account') IS NULL
           AND feature != 'skill-check' AND COALESCE(json_extract(request_json, '$.skill.run'), '') NOT LIKE 'check-%' AND NOT EXISTS (SELECT 1 FROM generation_trash t WHERE t.generation_id = generations.id)
         GROUP BY name`,
      )
      .all() as { name: string; runs: number; last: number }[];
    return new Map(rows.map((r) => [r.name, { runs: r.runs, last: r.last }]));
  } catch {
    return new Map();
  }
}

const RECENT_MS = 30 * 86_400_000;

/**
 * Skills in the order Assist offers them: those matching more of the words first (when there are words), then those used
 * in the last 30 days, then by how often and how lately they ran; the rest keep their order. A skill that matches none of
 * the words is left out when some match.
 */
export function rankSkills<T extends { name: string; title: string; description: string; whenToUse?: string }>(list: T[], o: { words?: string; usage?: Map<string, { runs: number; last: number }>; now?: number } = {}): T[] {
  const usage = o.usage ?? skillUsage();
  const now = o.now ?? Date.now();
  const words = (o.words ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const scored = list.map((s, i) => {
    const hay = `${s.name} ${s.title} ${s.description} ${s.whenToUse ?? ""}`.toLowerCase();
    const u = usage.get(s.name);
    return { s, i, match: words.filter((w) => hay.includes(w)).length, recent: u && now - u.last < RECENT_MS ? 1 : 0, runs: u?.runs ?? 0, last: u?.last ?? 0 };
  });
  const kept = words.length && scored.some((x) => x.match) ? scored.filter((x) => x.match) : scored;
  return kept.sort((a, b) => b.match - a.match || b.recent - a.recent || b.runs - a.runs || b.last - a.last || a.i - b.i).map((x) => x.s);
}
