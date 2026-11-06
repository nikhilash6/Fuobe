import { listWords } from "@/lib/unavailable";
import { isCloudProvider, type CloudProvider } from "@/lib/your-keys";
import { fittedSettings, tierWords, type SettingChange } from "./fitted";
import { framedLength } from "./payload";
import { routesFor } from "./plan";
import { routeTakes } from "./route-takes";
import type { GenParams, ModelDef, ModelRoute, Operation, ProviderId } from "./types";

// Pre-run notice for a route that can't take a setting another route of the model takes (built on fittedSettings).

type Model = Pick<ModelDef, "id" | "name" | "kind" | "engine" | "routes" | "defaults">;

const SETTINGS = new Set<SettingChange["setting"]>(["aspectRatio", "resolution", "duration", "seed", "negativePrompt", "generateAudio"]);

const PROVIDER_LABEL: Partial<Record<ProviderId, string>> = { fal: "fal.ai", replicate: "Replicate" };

/** "fal.ai", "Replicate". */
export const routeLabel = (p: ProviderId) => PROVIDER_LABEL[p] ?? p;

/** The model's name without a trailing "(hosted)". */
const shortName = (m: Pick<ModelDef, "name">) => m.name.replace(/\s*\([^)]*\)\s*$/, "") || m.name;

const listOr = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`);

/** `can`: words before the run; `did`: words for the run's notice. */
export interface Shortfall {
  setting: SettingChange["setting"];
  asked: string;
  made: string;
  /** "makes 16:9 or 9:16 clips only", "ignores a negative prompt". */
  can: string;
  /** "at 16:9 in place of 1:1", "without the negative prompt". */
  did: string;
}

export interface RunRequest {
  params?: GenParams;
  negativePrompt?: string;
}

const changesOn = (model: Model, op: Operation, provider: ProviderId, req: RunRequest) =>
  fittedSettings(model, op, req.params, { provider, negativePrompt: req.negativePrompt }).changes.filter((c) => SETTINGS.has(c.setting));

const providersFor = (model: Model, op: Operation, params?: GenParams) => [...new Set(routesFor(model as ModelDef, op, params).map((r) => r.provider))];

/** Changes on `provider`'s route that some other route of the op doesn't make. */
export function routeShortfalls(model: Model, op: Operation, provider: ProviderId, req: RunRequest): Shortfall[] {
  if (model.engine === "open") return [];
  const others = providersFor(model, op, req.params).filter((p) => p !== provider);
  if (!others.length) return [];
  const mine = changesOn(model, op, provider, req);
  if (!mine.length) return [];
  const theirs = others.map((p) => changesOn(model, op, p, req));
  const route = routesFor(model as ModelDef, op, req.params).find((r) => r.provider === provider);
  return mine.filter((c) => theirs.some((t) => !t.some((x) => x.setting === c.setting))).map((c) => shortfall(model, route, c));
}

function shortfall(model: Model, route: ModelRoute | undefined, c: SettingChange): Shortfall {
  const takes = route && routeTakes(route, model.id);
  const noun = model.kind === "video" ? "clips" : model.kind === "image" ? "pictures" : "results";
  const base = { setting: c.setting, asked: c.asked, made: c.made };
  const same = (list: readonly string[]) => list.some((a) => a.toLowerCase() === c.made.toLowerCase());
  switch (c.setting) {
    case "aspectRatio": {
      const list = Array.isArray(takes?.aspectRatios) ? takes.aspectRatios.filter((a) => a.toLowerCase() !== "auto") : [];
      const own = c.made.toLowerCase();
      const can = list.length ? `makes ${listOr(list)} ${noun} only` : own.startsWith("its own") ? "sets its own shape" : `keeps ${own}`;
      return { ...base, can, did: same(list) ? `at ${c.made} in place of ${c.asked}` : `in ${own}` };
    }
    case "resolution": {
      const list = Array.isArray(takes?.resolutions) ? takes.resolutions.map(tierWords) : [];
      return { ...base, can: list.length ? `makes ${listOr(list)} ${noun} only` : "sets its own quality", did: same(list) ? `at ${c.made} in place of ${c.asked}` : "at its own quality" };
    }
    case "duration": {
      if (takes?.durations === false) return { ...base, can: "keeps the clip's length", did: "at the clip's length" };
      const n = Number.parseFloat(c.made);
      const made = Number.isFinite(n) ? `${Math.round(n * 2) / 2}s` : c.made;
      return { ...base, made, can: `makes this ${made} long, not ${c.asked}`, did: `${made} long in place of ${c.asked}` };
    }
    case "seed":
      return { ...base, can: "takes no seed", did: "without the seed" };
    case "negativePrompt":
      return { ...base, can: "ignores a negative prompt", did: "without the negative prompt" };
    default:
      return { ...base, can: "makes its own sound", did: "with its own sound" };
  }
}

/** "Replicate's Wan 2.2 A14B makes 16:9 or 9:16 clips only and ignores a negative prompt." */
export const shortfallWords = (model: Pick<ModelDef, "name">, provider: ProviderId, s: readonly Shortfall[]) =>
  `${routeLabel(provider)}'s ${shortName(model)} ${listWords(s.map((x) => x.can))}.`;

/** "Replicate's Wan 2.2 A14B made this at 16:9 in place of 1:1 and without the negative prompt." */
export const shortfallNote = (model: Pick<ModelDef, "name">, provider: ProviderId, s: readonly Shortfall[]) =>
  `${routeLabel(provider)}'s ${shortName(model)} made this ${listWords(s.map((x) => x.did))}.`;

/** Route pick shared by chooseRoute and the composer: `prefer` if ready, then LoRA fit + length, then first ready. */
export function pickRoute<R extends Pick<ModelRoute, "provider" | "map" | "preview">>(
  candidates: readonly R[],
  o: { ok: (r: R) => boolean; fits?: (r: R) => boolean; seconds?: number; preferred?: string; prefer?: CloudProvider },
): R | undefined {
  let routes = !o.preferred || o.preferred === "auto" ? [...candidates] : [...candidates].sort((a, b) => Number(b.provider === o.preferred) - Number(a.provider === o.preferred));
  if (o.prefer && routes.some((r) => r.provider === o.prefer && o.ok(r))) routes = routes.filter((r) => r.provider === o.prefer);
  const fits = o.fits ?? (() => true);
  const long = (r: R) => framedLength(r.map?.numFrames ?? r.preview?.numFrames, o.seconds) === undefined;
  return routes.find((r) => o.ok(r) && fits(r) && long(r)) ?? routes.find((r) => o.ok(r) && fits(r)) ?? routes.find((r) => o.ok(r) && long(r)) ?? routes.find(o.ok);
}

/** Same as generations.ts MADE_LENGTH_OPS. */
const MADE_LENGTH = new Set<Operation>(["t2v", "i2v", "flf2v", "ref2v", "extend", "keyframes"]);

/** Client-side guess of the route chooseRoute picks (no LoRA or image-count checks). */
export function likelyProvider(
  model: Model | undefined,
  op: Operation | undefined,
  req: RunRequest & { prefer?: CloudProvider },
  o: { ready: (p: ProviderId) => boolean; preferred?: string },
): ProviderId | undefined {
  if (!model || !op || model.engine === "open") return undefined;
  const routes = routesFor(model as ModelDef, op, req.params);
  const seconds = MADE_LENGTH.has(op) ? req.params?.duration : undefined;
  return pickRoute(routes, { ok: (r) => o.ready(r.provider), seconds, preferred: o.preferred, prefer: req.prefer })?.provider;
}

export interface RouteNotice {
  words: string;
  provider: ProviderId;
  shortfalls: Shortfall[];
  /** A usable route with no shortfalls. */
  instead?: CloudProvider;
}

export function routeNotice(model: Model | undefined, op: Operation | undefined, provider: ProviderId | undefined, req: RunRequest, usable: (p: CloudProvider) => boolean): RouteNotice | null {
  if (!model || !op || !provider) return null;
  const shortfalls = routeShortfalls(model, op, provider, req);
  if (!shortfalls.length) return null;
  const instead = providersFor(model, op, req.params).find((p): p is CloudProvider => p !== provider && isCloudProvider(p) && usable(p) && routeShortfalls(model, op, p, req).length === 0);
  return { words: shortfallWords(model, provider, shortfalls), provider, shortfalls, ...(instead && { instead }) };
}

/** Session keys for "Run anyway". */
export const anywayKeys = (modelId: string, op: Operation, n: Pick<RouteNotice, "provider" | "shortfalls">) => n.shortfalls.map((s) => `${modelId}|${op}|${n.provider}|${s.setting}`);

export const anywaySaid = (said: readonly string[], modelId: string, op: Operation, n: Pick<RouteNotice, "provider" | "shortfalls">) =>
  anywayKeys(modelId, op, n).every((k) => said.includes(k));
