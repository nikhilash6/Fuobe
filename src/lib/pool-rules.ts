import type { MediaKind } from "./catalog/types";

/**
 * What this studio's GPUs run for a visitor with no GPU of its own (hosted runs): the policy's model and app lists and
 * its kinds, as GET /api/status sends them (`viewer.pool`). Pickers leave out what these rules keep off, so a run never
 * fails at Run for it. The server checks the same rules on every run (src/server/hosted.ts poolAllows).
 *
 * - `allow`: only these models (absent: every model); `deny`: never these.
 * - `apps`: the same for apps, camera motions and effects (by preset id).
 * - `kinds`: a kind set to false runs on the visitor's own GPU only (absent: every kind).
 */
export interface PoolRules {
  allow?: string[];
  deny?: string[];
  apps?: { allow?: string[]; deny?: string[] };
  kinds?: Partial<Record<MediaKind, boolean>>;
}

/** The rules a policy's pool lists and kinds make, or undefined when they keep nothing off. */
export function poolRulesOf(p: { pool?: { allow?: string[]; deny?: string[]; apps?: { allow?: string[]; deny?: string[] } }; kinds?: Partial<Record<MediaKind, boolean>> }): PoolRules | undefined {
  const list = (xs: unknown) => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === "string") : undefined);
  const lists = p.pool ?? {};
  const out: PoolRules = {};
  const allow = list(lists.allow);
  const deny = list(lists.deny);
  if (allow) out.allow = allow;
  if (deny?.length) out.deny = deny;
  const appsAllow = list(lists.apps?.allow);
  const appsDeny = list(lists.apps?.deny);
  if (appsAllow || appsDeny?.length) out.apps = { ...(appsAllow && { allow: appsAllow }), ...(appsDeny?.length && { deny: appsDeny }) };
  const off = Object.entries(p.kinds ?? {}).filter(([, v]) => v === false);
  if (off.length) out.kinds = Object.fromEntries(off) as PoolRules["kinds"];
  return Object.keys(out).length ? out : undefined;
}

/** Does this studio's GPUs run this open model under the rules (no rules: yes)? Cloud models are never left out here. */
export function poolRunsModel(rules: PoolRules | undefined, m: { id: string; kind: MediaKind; engine: string }): boolean {
  if (!rules || m.engine !== "open") return true;
  if (rules.deny?.includes(m.id)) return false;
  if (rules.allow && !rules.allow.includes(m.id)) return false;
  return rules.kinds?.[m.kind] !== false;
}

/** Does this studio's GPUs run this app, camera motion or effect under the rules (no rules: yes)? */
export function poolRunsPreset(rules: PoolRules | undefined, presetId: string): boolean {
  const apps = rules?.apps;
  if (!apps) return true;
  if (apps.deny?.includes(presetId)) return false;
  return !apps.allow || apps.allow.includes(presetId);
}

/**
 * "Try free" on preset cards: with hosted runs on, a card whose preset runs on this studio's GPUs for this viewer (a
 * guest, an account with no GPU of its own, or one whose runs go to this studio's GPUs first) says it can be tried there.
 * Null (no card says it) with hosted runs off, for a viewer whose runs go to its own GPU, and with cloud models only.
 */
export function tryFreeFor(
  viewer: { hosted?: boolean; prefer?: "pool"; gpu: { connected: boolean }; pool?: PoolRules } | undefined,
  engineMode: "cloud" | "open" | "both",
): ((p: { id: string; open: boolean }) => boolean) | null {
  if (!viewer?.hosted || engineMode === "cloud") return null;
  if (viewer.gpu.connected && viewer.prefer !== "pool") return null;
  const rules = viewer.gpu.connected ? undefined : viewer.pool;
  return (p) => p.open && poolRunsPreset(rules, p.id);
}
