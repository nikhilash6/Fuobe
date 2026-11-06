import type { FieldMap, ModelDef, ModelRoute, Operation, RouteTakes } from "./types";

/*
 * What a run's settings reach: a hosted route sends only the fields its map names, and fits an aspect ratio, a size or a
 * length to the list it takes (EnumField.accepts, DurationField.accepts). The composer's pickers read this so a choice the
 * route would drop or change looks unavailable, and says so, before the run (src/lib/unavailable.ts).
 *
 * The browser's catalog has no field maps (slimModel): it keeps this summary as route.takes. ComfyUI graphs and the
 * routes Fuobe builds itself (Soul, Cinema, Mixed Media, Animation: their sizes are written by the plan) take everything.
 */

/** Operations whose result keeps the clip it is given: its shape, size and length are the clip's. */
const FOLLOWS_CLIP = new Set<Operation>(["extend", "v2v", "video-swap", "video-insert", "remove-object", "finalize"]);

const listOf = (f: FieldMap["aspectRatio"]): string[] | undefined => (f && typeof f !== "string" && f.accepts?.length ? [...f.accepts] : undefined);

/** A route's summary from its field map; undefined when it takes every setting (no map, or a size the plan writes). */
export function takesFromMap(route: Pick<ModelRoute, "op" | "provider" | "map">, modelId: string): RouteTakes | undefined {
  const m = route.map;
  if (!m || route.provider === "comfyui" || modelId.startsWith("fuobe-")) return undefined;
  const lengths = (m.duration as { accepts?: number[] } | undefined)?.accepts;
  const follows = FOLLOWS_CLIP.has(route.op);
  const out: RouteTakes = {};
  if (!m.aspectRatio && !m.size) out.aspectRatios = false;
  else if (!m.size && listOf(m.aspectRatio)) out.aspectRatios = listOf(m.aspectRatio);
  if (!m.resolution && !m.size && !m.upscaleFactor) out.resolutions = false;
  else if (!m.size && !m.upscaleFactor && listOf(m.resolution)) out.resolutions = listOf(m.resolution);
  if (!m.duration && !m.numFrames && !m.multiShot && follows) out.durations = false;
  else if (lengths?.length) out.durations = [...lengths];
  if (!m.seed) out.seed = false;
  if (!m.negativePrompt) out.negativePrompt = false;
  if (!m.generateAudio) out.audio = false;
  if (!m.numOutputs) out.outputs = false;
  return Object.keys(out).length ? out : undefined;
}

/** A route's summary on the server (its map) or in the browser (route.takes). */
export function routeTakes(route: ModelRoute, modelId: string): RouteTakes | undefined {
  return route.map ? takesFromMap(route, modelId) : route.takes;
}

/** Whether every route of the operation makes one result a call (no count field): several results are several jobs. */
export function oneEachCall(model: Pick<ModelDef, "id" | "routes">, op: Operation): boolean {
  const routes = model.routes.filter((r) => r.op === op);
  return routes.length > 0 && routes.every((r) => routeTakes(r, model.id)?.outputs === false);
}

/** What an operation's routes take together (a run goes to one of them): a value any of them takes counts. */
export interface OpTakes {
  /** The ratios / sizes / lengths they take; undefined = any. */
  aspectRatios?: string[];
  resolutions?: string[];
  durations?: number[];
  /** False when none of them sends the setting at all. */
  aspect: boolean;
  resolution: boolean;
  duration: boolean;
  seed: boolean;
  negativePrompt: boolean;
  audio: boolean;
}

const ALL: OpTakes = { aspect: true, resolution: true, duration: true, seed: true, negativePrompt: true, audio: true };

export function opTakes(model: Pick<ModelDef, "id" | "routes"> | undefined, op: Operation | undefined): OpTakes {
  if (!model || !op) return ALL;
  const routes = model.routes.filter((r) => r.op === op);
  if (!routes.length) return ALL;
  const each = routes.map((r) => routeTakes(r, model.id));
  // One route that takes everything (a GPU graph, a route with no limits) takes everything for the operation.
  if (each.some((t) => !t)) return ALL;
  const ts = each as RouteTakes[];
  const any = <K extends "aspectRatios" | "resolutions" | "durations">(k: K) => ts.some((t) => t[k] !== false);
  const list = <T extends string | number>(k: "aspectRatios" | "resolutions" | "durations"): T[] | undefined => {
    const sent = ts.filter((t) => t[k] !== false);
    if (!sent.length || sent.some((t) => t[k] === undefined)) return undefined;
    return [...new Set(sent.flatMap((t) => t[k] as T[]))];
  };
  return {
    aspect: any("aspectRatios"),
    resolution: any("resolutions"),
    duration: any("durations"),
    aspectRatios: list<string>("aspectRatios"),
    resolutions: list<string>("resolutions"),
    durations: list<number>("durations"),
    seed: ts.some((t) => t.seed !== false),
    negativePrompt: ts.some((t) => t.negativePrompt !== false),
    audio: ts.some((t) => t.audio !== false),
  };
}

/** Whether a route list takes a value (in any case: "1K" and "1k"). */
export function takesValue(list: readonly (string | number)[] | undefined, v: string | number): boolean {
  return !list || list.some((x) => String(x).toLowerCase() === String(v).toLowerCase());
}

/** Where an operation's own limits apply, after the model's name ("from words alone", "when it extends a clip"). */
export const OPERATION_PLACE: Partial<Record<Operation, string>> = {
  t2i: "from words alone",
  t2v: "from words alone",
  edit: "in an edit",
  i2v: "from a start frame",
  flf2v: "from start and end frames",
  ref2v: "from references",
  extend: "when it extends a clip",
  finalize: "when it finishes a draft",
};

const secs = (n: number) => `${n}s`;

/**
 * Why a ratio, size or length isn't made on this operation, and the closest one it is (picked by the note's Use button):
 * undefined when the routes take it (or take any).
 */
export function settingUnavailable(
  model: Pick<ModelDef, "name">,
  op: Operation | undefined,
  setting: "aspect" | "resolution" | "duration",
  value: string | number,
  takes: OpTakes,
): { why: string; instead?: string | number } | undefined {
  const list = setting === "aspect" ? takes.aspectRatios : setting === "resolution" ? takes.resolutions : takes.durations;
  if (!list?.length || takesValue(list, value)) return undefined;
  const place = (op && OPERATION_PLACE[op]) ?? "here";
  if (setting === "duration") {
    const lengths = (list as number[]).slice().sort((a, b) => a - b);
    const below = lengths.filter((l) => l <= Number(value));
    const instead = below.length ? below[below.length - 1] : lengths[0];
    return { why: `${model.name} makes ${listOr(lengths.map(secs))} clips ${place}`, instead };
  }
  if (setting === "aspect" && String(value).toLowerCase() === "auto") {
    return { why: `Auto keeps a start frame's shape: ${model.name} needs a shape ${place}`, instead: list[0] };
  }
  const named = (list as string[]).filter((v) => v.toLowerCase() !== "auto");
  const instead = nearest(named, String(value), setting);
  return { why: `${model.name} doesn't make ${value} ${place}`, instead };
}

function listOr(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

const ratio = (v: string) => {
  const [w, h] = v.split(":").map(Number);
  return w > 0 && h > 0 ? w / h : undefined;
};
const tier = (v: string) => {
  const m = /^(\d+(?:\.\d+)?)\s*([kp])$/i.exec(v.trim());
  if (!m) return undefined;
  return m[2].toLowerCase() === "k" ? Number(m[1]) * 1000 : Number(m[1]) * 1.6;
};

/** The listed ratio closest in shape, or the largest size not above the one asked (else the smallest). */
function nearest(list: string[], value: string, setting: "aspect" | "resolution"): string | undefined {
  if (!list.length) return undefined;
  const size = setting === "aspect" ? ratio : tier;
  const want = size(value);
  const sized = list.flatMap((a) => {
    const n = size(a);
    return n === undefined ? [] : [{ a, n }];
  });
  if (want === undefined || !sized.length) return list[0];
  if (setting === "aspect") return sized.reduce((b, c) => (Math.abs(Math.log(c.n / want)) < Math.abs(Math.log(b.n / want)) ? c : b)).a;
  const below = sized.filter((c) => c.n <= want);
  return (below.length ? below.reduce((b, c) => (c.n > b.n ? c : b)) : sized.reduce((b, c) => (c.n < b.n ? c : b))).a;
}
