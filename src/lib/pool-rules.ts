import type { MediaKind } from "./catalog/types";
import { ownSetupOnly, type OwnSetup } from "./own-setup";

/**
 * What this studio's GPUs run for a visitor with no GPU of its own (hosted runs): the policy's model and app lists and
 * its kinds, and the open models they can't run right now, as GET /api/status sends them (`viewer.pool`). Pickers show
 * what these rules keep off with its "own setup" label (src/lib/own-setup.ts), and pressing Run on it opens that setup,
 * so a run never fails at Run for it. The server checks the same rules on every run (src/server/hosted.ts poolAllows,
 * src/server/hosted-run.ts poolGate).
 *
 * - `allow`: only these models (absent: every model); `deny`: never these.
 * - `apps`: the same for apps, camera motions and effects (by preset id). A preset whose open model (or the kind it
 *   makes) the rules keep off is kept off here too, so its card never says "Try free" for a run that would be refused.
 * - `kinds`: a kind set to false runs on the visitor's own GPU only (absent: every kind).
 * - `own`: open models this studio's GPUs can't run right now (none of them holds the model, serves its kind of work,
 *   or has the card it needs), each with what the visitor needs to run it on its own setup.
 */
export interface PoolRules {
  allow?: string[];
  deny?: string[];
  apps?: { allow?: string[]; deny?: string[] };
  kinds?: Partial<Record<MediaKind, boolean>>;
  own?: Record<string, OwnSetup>;
}

/** A preset as the rules see it: its id, and the open model it runs on with the kind it makes (none: no open route). */
export interface PresetModel {
  id: string;
  model?: { id: string; kind: MediaKind };
}

/**
 * The rules a policy's pool lists and kinds make, or undefined when they keep nothing off. `presets`: the catalog's
 * presets with their open models, so a preset is kept off with its model (by id, in the app lists: the shorter of the
 * two lists when the policy has no app allow list of its own), and with a model that runs on a visitor's own setup only.
 * `own`: the open models this studio's GPUs can't run right now (src/server/pool-own-setup.ts poolOwnSetups).
 */
export function poolRulesOf(
  p: { pool?: { allow?: string[]; deny?: string[]; apps?: { allow?: string[]; deny?: string[] } }; kinds?: Partial<Record<MediaKind, boolean>> },
  presets: readonly PresetModel[] = [],
  own: Record<string, OwnSetup> = {},
): PoolRules | undefined {
  const list = (xs: unknown) => (Array.isArray(xs) ? xs.filter((x): x is string => typeof x === "string") : undefined);
  const lists = p.pool ?? {};
  const out: PoolRules = {};
  const allow = list(lists.allow);
  const deny = list(lists.deny);
  if (allow) out.allow = allow;
  if (deny?.length) out.deny = deny;
  const off = Object.entries(p.kinds ?? {}).filter(([, v]) => v === false);
  if (off.length) out.kinds = Object.fromEntries(off) as PoolRules["kinds"];
  if (Object.keys(own).length) out.own = own;
  let appsAllow = list(lists.apps?.allow);
  let appsDeny = list(lists.apps?.deny);
  const modelOff = new Set(presets.filter((x) => x.model && (!poolRunsModel(out, { ...x.model, engine: "open" }) || ownSetupOnly(x.model.id, "open"))).map((x) => x.id));
  if (modelOff.size) {
    if (appsAllow) appsAllow = appsAllow.filter((id) => !modelOff.has(id));
    // Most presets kept off: the presets still on make the shorter list.
    else if (modelOff.size * 2 > presets.length) appsAllow = presets.filter((x) => !modelOff.has(x.id)).map((x) => x.id);
    else appsDeny = [...new Set([...(appsDeny ?? []), ...modelOff])];
  }
  if (appsAllow || appsDeny?.length) out.apps = { ...(appsAllow && { allow: appsAllow }), ...(appsDeny?.length && { deny: appsDeny }) };
  return Object.keys(out).length ? out : undefined;
}

/** Does this studio's GPUs run this open model under the rules (no rules: yes)? Cloud models are never left out here. */
export function poolRunsModel(rules: PoolRules | undefined, m: { id: string; kind: MediaKind; engine: string }): boolean {
  if (!rules || m.engine !== "open") return true;
  if (rules.deny?.includes(m.id)) return false;
  if (rules.allow && !rules.allow.includes(m.id)) return false;
  if (rules.own?.[m.id]) return false;
  return rules.kinds?.[m.kind] !== false;
}

/** What any GPU of the visitor's own runs (no memory or files named). */
const ANY_GPU: OwnSetup = { need: "gpu" };

/**
 * The label a picker shows on an open model these rules keep off (null: they run it, or have no say): what a visitor
 * needs to run it on its own setup. Shown, never left out: pressing Run on it opens that setup.
 */
export function poolOwnSetup(rules: PoolRules | undefined, m: { id: string; kind: MediaKind; engine: string }): OwnSetup | null {
  if (!rules || m.engine !== "open") return null;
  return rules.own?.[m.id] ?? (poolRunsModel(rules, m) ? null : ANY_GPU);
}

/**
 * A model's label in a picker for a visitor: the static items (ownSetupOnly), then what the rules keep off. Null for the
 * models that run as any other.
 */
export function modelOwnSetup(rules: PoolRules | undefined, m: { id: string; kind: MediaKind; engine: string }): OwnSetup | null {
  return ownSetupOnly(m.id, m.engine === "cloud" ? "cloud" : "open") ?? poolOwnSetup(rules, m);
}

/** Does this studio's GPUs run this app, camera motion or effect under the rules (no rules: yes)? */
export function poolRunsPreset(rules: PoolRules | undefined, presetId: string): boolean {
  const apps = rules?.apps;
  if (!apps) return true;
  if (apps.deny?.includes(presetId)) return false;
  return !apps.allow || apps.allow.includes(presetId);
}

/**
 * Does a picker or gallery offer this preset to a viewer under the rules (no rules: every preset)? A preset with no open
 * route, or with a cloud route while the picker's engine isn't the open one (`engine` undefined: either engine), never
 * needs this studio's GPUs, so the rules don't leave it out; one only they could run is offered when they run it.
 */
export function presetOffered(rules: PoolRules | undefined, p: { id: string; open: unknown; cloud: unknown }, engine?: "open" | "cloud"): boolean {
  if (!rules || !p.open) return true;
  if (p.cloud && engine !== "open") return true;
  return poolRunsPreset(rules, p.id);
}

/**
 * The label a picker or gallery shows on a preset the rules keep off (presetOffered false), instead of leaving it out:
 * what its open model needs on the visitor's own setup (the rules' `own`, the static items), else any GPU of its own.
 */
export function presetOwnSetup(rules: PoolRules | undefined, p: { id: string; open: unknown; cloud: unknown }, engine?: "open" | "cloud"): OwnSetup | null {
  if (presetOffered(rules, p, engine)) return null;
  // A catalog preset names its open model; a gallery card only says it has an open route.
  const open = p.open && typeof p.open === "object" ? (p.open as { modelId?: unknown }) : null;
  const model = typeof open?.modelId === "string" ? open.modelId : undefined;
  return (model && (rules?.own?.[model] ?? ownSetupOnly(model, "open"))) || ANY_GPU;
}

/**
 * The words on preset cards ("Try free"): with hosted runs on, a card whose preset runs on this studio's GPUs for this
 * viewer (a guest, an account with no GPU of its own, or one whose runs go to this studio's GPUs first) says the words
 * the server gives (`viewer.cardText`: the billing service's, or "Try free" when those runs are free with no service).
 * The rules hold presets whose model or kind is kept off too (poolRulesOf). Null (no card says anything) with hosted
 * runs off, with no words from the server, for a viewer whose runs go to its own GPU, and with cloud models only.
 */
export function tryFreeFor(
  viewer: { hosted?: boolean; prefer?: "pool"; cardText?: string; gpu: { connected: boolean }; pool?: PoolRules } | undefined,
  engineMode: "cloud" | "open" | "both",
): { text: string; runs: (p: { id: string; open: boolean }) => boolean } | null {
  if (!viewer?.hosted || !viewer.cardText || engineMode === "cloud") return null;
  if (viewer.gpu.connected && viewer.prefer !== "pool") return null;
  const rules = viewer.gpu.connected ? undefined : viewer.pool;
  return { text: viewer.cardText, runs: (p) => p.open && poolRunsPreset(rules, p.id) };
}
