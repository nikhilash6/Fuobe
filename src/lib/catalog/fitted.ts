import { listWords } from "@/lib/unavailable";
import { fitLength, fitValue, framedLength, inRange, seedValue } from "./payload";
import { MAX_RESULTS, routesFor } from "./plan";
import { OPERATION_PLACE, routeDrops, routeTakes } from "./route-takes";
import { tierWords, type MadeSettings, type SettingChange } from "./made";
import type { GenParams, ModelDef, ModelRoute, Operation, ProviderId } from "./types";

export { changeLine, shownSettings, tierWords, type FittedSetting, type MadeSettings, type SettingChange } from "./made";

/*
 * What a run is actually made at. A hosted route sends only the fields its map names and fits a value it doesn't take to
 * the closest one it does (buildPayload: a 2K run on MiniMax H3 Max Turbo goes as 1080P). This says so, from the same
 * rules, for every surface: before a run (a note with a one-tap fix) and after it (the made value, and "Asked for 2K ·
 * made at 1080p"). It reads a route's field map on the server and its summary (route.takes) in the browser.
 */

/** Operations whose result keeps the shape of what goes in (a start frame, the clip extended). */
const SHAPE_FROM_INPUT: Partial<Record<Operation, string>> = { i2v: "the start frame's shape", flf2v: "the start frame's shape", extend: "the clip's shape" };

const QUIET_PLACE = new Set<Operation>(["t2i", "t2v", "edit"]);

const secs = (n: number) => `${Math.round(n * 100) / 100}s`;

/** "720p" → 720, "2K" → 2000 (the same order fitValue sorts tiers in). */
function tierSize(v: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*([pk])$/i.exec(v.trim());
  return m ? Number(m[1]) * (m[2].toLowerCase() === "k" ? 1000 : 1) : NaN;
}

/** The route a run goes to: the one its provider names (a finished run), else the first (where a run goes first). */
export function runRoute(model: Pick<ModelDef, "routes">, op: Operation, params?: GenParams, provider?: ProviderId): ModelRoute | undefined {
  const routes = routesFor(model as ModelDef, op, params);
  return (provider && routes.find((r) => r.provider === provider)) || routes[0];
}

/**
 * The settings a run on `model` is made at, from what it asks (`params`, as stored or about to be sent), and each change in
 * plain words. Nothing changes on the open engine or on routes that take every setting (a GPU graph, Fuobe's own routes).
 */
export function fittedSettings(
  model: Pick<ModelDef, "id" | "name" | "engine" | "routes" | "defaults">,
  op: Operation,
  params: GenParams | undefined,
  opts: { provider?: ProviderId; negativePrompt?: string } = {},
): MadeSettings {
  const p = params ?? {};
  const made: MadeSettings = {
    ...(p.aspectRatio !== undefined && { aspectRatio: p.aspectRatio }),
    ...(p.resolution !== undefined && { resolution: p.resolution }),
    ...(p.duration !== undefined && { duration: p.duration }),
    ...(p.seed !== undefined && p.seed >= 0 && { seed: p.seed }),
    ...(p.numOutputs !== undefined && { numOutputs: p.numOutputs }),
    changes: [],
  };
  const changes = made.changes;
  const name = model.name;
  // A request for more results than a run makes (an API call, Assist) makes the most it does.
  if (p.numOutputs !== undefined && p.numOutputs > MAX_RESULTS) {
    made.numOutputs = MAX_RESULTS;
    changes.push({ setting: "numOutputs", label: "Results", asked: String(p.numOutputs), made: String(MAX_RESULTS), reason: `the most one run makes`, note: `A run makes up to ${MAX_RESULTS} results, so this one makes ${MAX_RESULTS}`, use: MAX_RESULTS });
  }
  const route = model.engine === "open" ? undefined : runRoute(model, op, p, opts.provider);
  const takes = route && routeTakes(route, model.id);
  // The parts of the field map that fit numbers (the server's map, or what the browser keeps of it).
  const limits = route?.map ?? route?.preview;
  if (!route || (!takes && !limits)) return made;
  // Where its own limits apply, for modes with limits of their own ("from a start frame"); none for words alone or an edit.
  const place = !QUIET_PLACE.has(op) && OPERATION_PLACE[op] ? ` ${OPERATION_PLACE[op]}` : "";
  // A default every studio fills in (a shape for a start frame) that the route doesn't send isn't a choice: it is left out
  // of the made settings without a word.
  const filled = (k: "aspectRatio" | "resolution" | "duration", v: unknown) => v === "auto" || (model.defaults as Record<string, unknown> | undefined)?.[k] === v;

  // Quality.
  const res = p.resolution;
  if (res !== undefined && takes?.resolutions === false) {
    delete made.resolution;
    if (!filled("resolution", res)) changes.push({ setting: "resolution", label: "Quality", asked: tierWords(res), made: "Its own", reason: `this model sets its own quality${place}`, note: `${name} sets its own quality${place}, so ${tierWords(res)} isn't sent` });
  } else if (res !== undefined && Array.isArray(takes?.resolutions)) {
    const list = takes.resolutions;
    const fit = fitValue(list, res, "tier");
    if (fit === undefined) {
      delete made.resolution;
      if (!filled("resolution", res)) changes.push({ setting: "resolution", label: "Quality", asked: tierWords(res), made: "Its own", reason: `this model makes ${listWords(list.map(tierWords))}`, note: `${name} makes ${listWords(list.map(tierWords))}${place}, so it picks its own quality` });
    } else if (fit.toLowerCase() === res.toLowerCase()) made.resolution = fit;
    else {
      made.resolution = fit;
      const sizes = list.map(tierSize).filter((n) => Number.isFinite(n));
      const most = tierSize(fit) === Math.max(...sizes) && tierSize(res) > tierSize(fit);
      const least = tierSize(fit) === Math.min(...sizes) && tierSize(res) < tierSize(fit);
      const reason = most ? "the most this model makes" : least ? "the least this model makes" : `this model makes ${listWords(list.map(tierWords))}`;
      const note = most
        ? `${name} makes up to ${tierWords(fit)}${place}, so this is made at ${tierWords(fit)}`
        : least
          ? `${name} makes ${tierWords(fit)} or more${place}, so this is made at ${tierWords(fit)}`
          : `${name} makes ${listWords(list.map(tierWords))}${place}, so this is made at ${tierWords(fit)}`;
      changes.push({ setting: "resolution", label: "Quality", asked: tierWords(res), made: tierWords(fit), reason, note, use: fit });
    }
  }

  // Shape.
  const ar = p.aspectRatio;
  if (ar !== undefined && takes?.aspectRatios === false) {
    delete made.aspectRatio;
    const own = SHAPE_FROM_INPUT[op] ?? "its own shape";
    if (!filled("aspectRatio", ar)) changes.push({ setting: "aspectRatio", label: "Aspect ratio", asked: ar, made: own[0].toUpperCase() + own.slice(1), reason: SHAPE_FROM_INPUT[op] ? `this model keeps ${own}` : "this model sets its own shape", note: `${name} keeps ${own}${place}, so ${ar} isn't sent` });
  } else if (ar !== undefined && Array.isArray(takes?.aspectRatios)) {
    const list = takes.aspectRatios;
    const fit = fitValue(list, ar, "ratio");
    if (fit === undefined) {
      delete made.aspectRatio;
      const own = SHAPE_FROM_INPUT[op] ?? "its own shape";
      if (!filled("aspectRatio", ar)) changes.push({ setting: "aspectRatio", label: "Aspect ratio", asked: ar, made: own[0].toUpperCase() + own.slice(1), reason: `this model makes ${listWords(list)}`, note: `${name} makes ${listWords(list)}${place}, so it keeps ${own}`, use: list[0] });
    } else if (fit.toLowerCase() === ar.toLowerCase()) made.aspectRatio = fit;
    else {
      made.aspectRatio = fit;
      changes.push({ setting: "aspectRatio", label: "Aspect ratio", asked: ar, made: fit, reason: "the closest shape this model makes", note: `${name} doesn't make ${ar}${place}, so this is made at ${fit}, the closest shape it makes`, use: fit });
    }
  }

  // Length (one take: shots set their own).
  const d = p.duration;
  if (d !== undefined && !p.shots?.length) {
    if (takes?.durations === false) {
      delete made.duration;
      if (!filled("duration", d)) changes.push({ setting: "duration", label: "Duration", asked: secs(d), made: "The clip's", reason: "this model keeps the clip's length", note: `${name} keeps the clip's length${place}, so ${secs(d)} isn't sent` });
    } else {
      let fit = Array.isArray(takes?.durations) ? fitLength(takes.durations, d) : d;
      // A frame-count route (Wan 2.2 fast: 81–121 frames) makes the length its frames come to.
      const framed = framedLength(limits?.numFrames, fit, p.fps);
      if (framed !== undefined) fit = framed;
      // A length field the API limits (FieldMap.ranges), on the server's map.
      const key = route.map?.duration?.key;
      const range = key ? route.map?.ranges?.[key] : undefined;
      if (range && (route.map?.duration?.multiplier ?? 1) === 1) fit = inRange(fit, range);
      if (Math.abs(fit - d) > 1e-6) {
        made.duration = fit;
        const lengths = Array.isArray(takes?.durations) ? [...takes.durations].sort((a, b) => a - b) : undefined;
        const most = lengths ? fit === lengths[lengths.length - 1] && d > fit : range?.max !== undefined && fit === range.max && d > fit;
        const reason = most ? "the longest this model makes" : lengths ? `this model makes ${listWords(lengths.map(secs))} clips` : "the closest length this model makes";
        const note = most
          ? `${name} makes up to ${secs(fit)}${place}, so this is ${secs(fit)}`
          : lengths
            ? `${name} makes ${listWords(lengths.map(secs))} clips${place}, so this is ${secs(fit)}`
            : `${name} makes ${secs(fit)} clips for this length${place}`;
        changes.push({ setting: "duration", label: "Duration", asked: secs(d), made: secs(fit), reason, note, use: fit });
      }
    }
  }

  // Each shot's words, cut where the API takes fewer (Kling 4.0: 512 characters a shot).
  const shotMax = route.map?.multiShot?.maxPrompt;
  if (shotMax && p.shots?.length) {
    const long = p.shots.map((s, i) => ({ i, n: s.prompt.length })).filter((s) => s.n > shotMax);
    if (long.length) {
      const which = listWords(long.map((s) => String(s.i + 1)));
      changes.push({
        setting: "shots",
        label: long.length === 1 ? `Shot ${which}` : `Shots ${which}`,
        asked: `${Math.max(...long.map((s) => s.n)).toLocaleString("en-US")} characters`,
        made: `${shotMax.toLocaleString("en-US")} characters`,
        reason: "the most this model reads a shot",
        note: `${name} reads up to ${shotMax.toLocaleString("en-US")} characters a shot, so the words of shot ${which} are cut there`,
      });
    }
  }

  // Seed.
  const seed = p.seed;
  if (seed !== undefined && seed >= 0) {
    const range = route.map?.seedRange;
    if (takes?.seed === false) {
      delete made.seed;
      changes.push({ setting: "seed", label: "Seed", asked: String(seed), made: "Random", reason: "this model takes no seed here", note: `${name} takes no seed${place}, so each run is new` });
    } else if (range && seedValue(range, seed) !== seed) {
      const sent = seedValue(range, seed);
      made.seed = sent;
      changes.push({ setting: "seed", label: "Seed", asked: String(seed), made: String(sent), reason: `this model takes seeds up to ${range[1].toLocaleString("en-US")}`, note: `${name} takes seeds from ${range[0]} to ${range[1].toLocaleString("en-US")}, so seed ${seed} is sent as ${sent}`, use: sent });
    }
  }

  // Settings the route has no field for (the run's note names them: routeDrops).
  const drops = routeDrops(route, model.id, { negativePrompt: opts.negativePrompt, params: p });
  if (drops.includes("a negative prompt")) {
    changes.push({ setting: "negativePrompt", label: "Negative prompt", asked: "Yours", made: "Not sent", reason: "this model reads no negative prompt here", note: `${name} reads no negative prompt${place}, so it isn't sent` });
  }
  if (drops.includes("the sound switch")) {
    changes.push({ setting: "generateAudio", label: "Sound", asked: "Off", made: "Its own", reason: "this model has no sound switch here", note: `${name} has no sound switch${place}: it makes its own sound` });
  }
  return made;
}

/** The made settings a finished run carries (Generation.made): only when something differs from what it asked. */
export function madeOfRun(
  model: Pick<ModelDef, "id" | "name" | "engine" | "routes" | "defaults"> | undefined,
  run: { op: Operation; provider?: ProviderId; request: { params?: GenParams; negativePrompt?: string } },
): MadeSettings | undefined {
  if (!model) return undefined;
  const made = fittedSettings(model, run.op, run.request.params, { provider: run.provider, negativePrompt: run.request.negativePrompt });
  return made.changes.length ? made : undefined;
}

/** The change one value of a setting makes on this mode (a picker's option), or undefined when it is made as picked. */
export function settingChange(
  model: Pick<ModelDef, "id" | "name" | "engine" | "routes" | "defaults">,
  op: Operation,
  setting: "aspectRatio" | "resolution" | "duration",
  value: string | number,
): SettingChange | undefined {
  return fittedSettings(model, op, { [setting]: value }).changes.find((c) => c.setting === setting);
}
