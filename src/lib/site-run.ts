import { getModel, getPreset } from "@/lib/catalog";
import { dualEngine } from "@/lib/catalog/engines";
import { presetRoutes } from "@/lib/catalog/preset-recipe-routes";
import type { Generation } from "@/lib/catalog/types";
import type { TroubleAction } from "./diagnose";
import { CLOUD_KEY, isCloudProvider, type CloudProvider } from "./your-keys";
import { modelOwnSetup, poolRunsModel, poolRunsPreset, type PoolRules } from "./pool-rules";

type FailedRun = Pick<Generation, "place" | "engine" | "status" | "modelId" | "op" | "presetId" | "kind" | "trouble">;

/**
 * "Run on {Place}" on a run that failed on the person's own GPU or key (hosted runs): the open version this studio's GPUs
 * would run, once, named there; the account's pick stays as it was. A run on its own GPU: the same model. A run on its
 * key: the item's open version (a Fuobe Original on Open source, an app's open route). Null when they don't take it (a
 * model or app their rules keep off, one that runs on an own setup only), or there is no open version.
 */
export function siteRunOf(g: FailedRun, hosted: boolean, rules: PoolRules | undefined): { modelId: string; op?: string; engine?: "open" } | null {
  if (!hosted || g.place === "pool" || g.status !== "failed" || !g.trouble) return null;
  if (g.presetId && !poolRunsPreset(rules, g.presetId)) return null;
  const takes = (id: string): boolean => {
    const m = getModel(id);
    if (!m) return false;
    const open = { id: m.id, kind: m.kind, engine: "open" };
    return poolRunsModel(rules, open) && !modelOwnSetup(rules, open);
  };
  if (g.engine === "open") return takes(g.modelId) ? { modelId: g.modelId } : null;
  // On its key: the item's open version.
  const preset = g.presetId ? getPreset(g.presetId) : undefined;
  if (preset) {
    const route = presetRoutes(preset as Parameters<typeof presetRoutes>[0], "open", (id) => !!getModel(id))[0];
    return route && takes(route.modelId) ? { modelId: route.modelId, ...(route.op && { op: route.op }), engine: "open" } : null;
  }
  const m = getModel(g.modelId);
  return m && dualEngine(m) && takes(m.id) ? { modelId: m.id, engine: "open" } : null;
}

/**
 * A failed run's buttons as its tile shows them: while hosted runs are on, a key is never offered without its price (a
 * run whose offer was kept before prices were added to it says none: the offer goes).
 */
export const shownTroubleActions = (actions: TroubleAction[], hosted: boolean): TroubleAction[] =>
  hosted ? actions.filter((a) => a.kind !== "run-with-key" || / · /.test(a.label)) : actions;

const KEY_REFUSED = new Set(["key-balance", "key-rejected", "key-permission"]);

type KeyRun = Pick<Generation, "id" | "createdAt" | "engine" | "place" | "provider" | "status" | "trouble">;

/**
 * The account's last run, when its key turned it down (out of credit, not accepted, not allowed): the run, and the
 * provider whose key it was. Null when the newest run is anything else, so the line before the next press goes once a
 * run gets through.
 */
export function keyTurnedDown<G extends KeyRun>(runs: readonly G[]): { run: G; provider: CloudProvider } | null {
  let last: G | undefined;
  for (const g of runs) if (!last || g.createdAt > last.createdAt) last = g;
  if (!last || last.status !== "failed" || last.engine !== "cloud" || last.place === "pool" || !last.trouble || !KEY_REFUSED.has(last.trouble.cause)) return null;
  return isCloudProvider(last.provider) ? { run: last, provider: last.provider } : null;
}

/** The line before the next press on the key that turned the last run down. */
export const keyTurnedDownWords = (provider: CloudProvider): string => `Your ${CLOUD_KEY[provider].label} key was turned down last time.`;

/** The run sent once on {Place}: the failed run's request on the open version siteRunOf names, the place named. */
export function siteRunRequest(g: Pick<Generation, "request">, run: NonNullable<ReturnType<typeof siteRunOf>>): Generation["request"] {
  return { ...g.request, modelId: run.modelId, ...(run.op && { op: run.op }), ...(run.engine && { engine: run.engine }), place: "pool" } as Generation["request"];
}
