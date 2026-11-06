import type { GenerationRequest, GenParams, ModelDef, Preset, PresetRoute } from "./catalog/types";
import { routeParams } from "./composer";
import { gpuHostOf, withoutAddress, withoutSecrets } from "./diagnose";

/**
 * The owner's Run details (Settings → Accounts' runs → a run): each of a run's settings beside the value the composer
 * would have started it with, so the owner sees what the account changed. Also the helpers that keep secrets out of
 * what the page shows (keys, tokens, a GPU's address).
 */

/**
 * `default`: what the composer starts with (sent or not); `changed`: the account picked another value; `unknown`: no
 * default is known for it here; `input`: the account's own content (shots, lines of dialogue, points), not a setting.
 */
export type SettingState = "default" | "changed" | "unknown" | "input";

/** Where a default comes from: the composer itself, the model's defaults, the preset's or app's route, a model control, an app option. */
export type DefaultSource = "composer" | "model" | "preset" | "app" | "control" | "option";

export interface SettingRow {
  /** "params.duration", "params.extra.quality", "presetOptions.angle", "presetStrength", "mix", "loras", "prefer". */
  key: string;
  label: string;
  /** What the run asked for (undefined: not sent, so the default applied). */
  value?: unknown;
  /** The value's words where it has them (an app option's choice label). */
  valueLabel?: string;
  /** The default, when known (`hasDefault`). */
  default?: unknown;
  defaultLabel?: string;
  hasDefault: boolean;
  from?: DefaultSource;
  state: SettingState;
  /** The request carried it (false: left out, so its default applied). */
  sent: boolean;
  /** The model makes it differently: what it is made at, what was asked (in words), and why. */
  made?: { value: string; asked: string; reason: string };
}

/** What a run's defaults come from: its model, its preset (or app) and the preset's route on that model. */
export interface DefaultsContext {
  model?: Pick<ModelDef, "defaults" | "options">;
  preset?: Pick<Preset, "type" | "options">;
  /** The preset's route on the run's model and engine (presetRoutes), when it has one. */
  route?: Pick<PresetRoute, "params">;
}

const LABELS: Record<string, string> = {
  aspectRatio: "Aspect ratio",
  resolution: "Resolution",
  duration: "Length (s)",
  numOutputs: "How many",
  seed: "Seed",
  generateAudio: "Sound",
  enhancePrompt: "Enhance prompt",
  voice: "Voice",
  voiceDescription: "Voice description",
  voiceTranscript: "Voice transcript",
  targetFps: "Frame rate",
  format: "Format",
  targetLanguage: "Language",
  sourceLanguage: "Source language",
  shots: "Shots",
  dialogue: "Dialogue",
  clipSeconds: "Clip length (s)",
  multiShot: "Multi-shot",
  draft: "Draft",
  fps: "FPS",
  palette: "Palette",
  styleId: "Style",
  numLayers: "Layers",
  points: "Points",
  keyframeTimes: "Keyframe times",
  startTime: "Start (s)",
  endTime: "End (s)",
  quality: "Quality",
};

/** The composer's own starting values, under every model's (src/components/studio/composer.tsx, settings-panel.tsx). */
const COMPOSER: GenParams = { numOutputs: 1, enhancePrompt: false };

/** Settings whose composer start is "none" (a seed is random until the person sets one). */
const NONE_BY_DEFAULT = new Set(["seed"]);

/** The account's own content, not a setting with a default (its shots, lines, points, the file's own size). */
const CONTENT = new Set([
  "shots",
  "dialogue",
  "points",
  "keyframeTimes",
  "elements",
  "palette",
  "voiceTranscript",
  "voiceDescription",
  "sourceSize",
  "sourceFps",
  "draftId",
  "drawnRefs",
  "startTime",
  "endTime",
  "zoomFrom",
  "zoomTo",
  "panFrom",
  "panTo",
]);

/** A camelCase key as words ("targetFps" → "Target fps"), for a key with no label of its own. */
export function settingLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const words = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/** Two settings are the same value: primitives by their words (a control's 3 and "3"), the rest by their JSON. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  const prim = (v: unknown) => typeof v === "string" || typeof v === "number" || typeof v === "boolean";
  if (prim(a) && prim(b)) return String(a) === String(b);
  return stableJson(a) === stableJson(b);
}

/** JSON with object keys in order, so two equal values give the same text. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** A stored file's address, an example input or an inline file: input content, not a setting. */
const isFileRef = (v: unknown) => typeof v === "string" && /^(\/api\/files\/|\/examples\/|\/samples\/|data:|https?:\/\/)/i.test(v.trim());

type Known = { v: unknown; from: DefaultSource };

function row(key: string, label: string, value: unknown, d: Known | undefined, o: { content?: boolean; valueLabel?: string; defaultLabel?: string } = {}): SettingRow {
  const sent = value !== undefined;
  const base = { key, label, ...(sent && { value }), ...(o.valueLabel && { valueLabel: o.valueLabel }), sent };
  if (o.content) return { ...base, hasDefault: false, state: "input" };
  if (!d) return { ...base, hasDefault: false, state: "unknown" };
  const known = { hasDefault: true, ...(d.v !== undefined && { default: d.v }), ...(o.defaultLabel && { defaultLabel: o.defaultLabel }), from: d.from };
  if (!sent) return { ...base, ...known, state: "default" };
  return { ...base, ...known, state: sameValue(value, d.v) ? "default" : "changed" };
}

/**
 * Each setting of a run beside the value the composer would have started it with, in this order: the composer's own
 * (how many, Enhance prompt), the model's defaults, the preset's or app's route on that model (an app's route as it is,
 * a camera motion's plain settings and its Quality: routeParams), the model's controls and sliders (params.extra), the
 * app's options (each its `default`, else its first choice), the preset's strength (1), a Mix, LoRAs and a provider
 * preference (none). A setting with no known default says so (`unknown`), never a guess. A run made from a request that
 * expanded into steps is compared as it was asked (`asked`).
 */
export function compareSettings(req: GenerationRequest, ctx: DefaultsContext = {}): SettingRow[] {
  const r = req.asked ?? req;
  const params = (r.params ?? {}) as Record<string, unknown>;
  const extra = (params.extra ?? {}) as Record<string, unknown>;
  const fromRoute: DefaultSource = ctx.preset?.type === "app" ? "app" : "preset";
  const route = ctx.route && ctx.preset ? (routeParams(ctx.route, ctx.preset.type) as Record<string, unknown>) : {};

  const plain = new Map<string, Known>();
  for (const [k, v] of Object.entries(COMPOSER)) plain.set(k, { v, from: "composer" });
  for (const k of NONE_BY_DEFAULT) plain.set(k, { v: undefined, from: "composer" });
  for (const [k, v] of Object.entries(ctx.model?.defaults ?? {})) if (v !== undefined) plain.set(k, { v, from: "model" });
  for (const [k, v] of Object.entries(route)) if (k !== "extra" && v !== undefined) plain.set(k, { v, from: fromRoute });

  const extras = new Map<string, Known>();
  const labels = new Map<string, string>();
  for (const c of ctx.model?.options?.controls ?? []) {
    labels.set(c.param, c.label);
    // A control left on its "auto" (no default) runs the model's own choice: unset is its default.
    extras.set(c.param, { v: c.default, from: "control" });
  }
  for (const s of ctx.model?.options?.sliders ?? []) {
    labels.set(s.param, s.label);
    extras.set(s.param, { v: s.default, from: "control" });
  }
  for (const [k, v] of Object.entries((route.extra ?? {}) as Record<string, unknown>)) if (v !== undefined) extras.set(k, { v, from: fromRoute });

  const rows: SettingRow[] = [];
  const plainKeys = [...new Set([...Object.keys(params).filter((k) => k !== "extra" && params[k] !== undefined), ...[...plain.entries()].filter(([, d]) => d.v !== undefined).map(([k]) => k)])];
  for (const k of plainKeys) rows.push(row(`params.${k}`, settingLabel(k), params[k], plain.get(k), { content: CONTENT.has(k) }));

  const extraKeys = [...new Set([...Object.keys(extra).filter((k) => extra[k] !== undefined), ...[...extras.entries()].filter(([, d]) => d.v !== undefined).map(([k]) => k)])];
  for (const k of extraKeys) {
    const v = extra[k];
    rows.push(row(`params.extra.${k}`, labels.get(k) ?? settingLabel(k), v, extras.get(k), { content: isFileRef(v) || (Array.isArray(v) && v.some(isFileRef)) }));
  }

  const options = ctx.preset?.options ?? [];
  const picked = r.presetOptions ?? {};
  for (const o of options) {
    const d = o.default ?? o.choices[0]?.value;
    const name = (v: unknown) => o.choices.find((c) => c.value === v)?.label;
    rows.push(
      row(`presetOptions.${o.key}`, o.label, picked[o.key], d === undefined ? undefined : { v: d, from: "option" }, {
        valueLabel: picked[o.key] !== undefined ? name(picked[o.key]) : undefined,
        defaultLabel: name(d),
      }),
    );
  }
  for (const [k, v] of Object.entries(picked)) if (!options.some((o) => o.key === k)) rows.push(row(`presetOptions.${k}`, settingLabel(k), v, undefined));

  if (r.presetStrength !== undefined || (ctx.preset && ctx.preset.type !== "app")) {
    rows.push(row("presetStrength", "Strength", r.presetStrength, ctx.preset && ctx.preset.type !== "app" ? { v: 1, from: "composer" } : undefined));
  }
  if (r.mix) rows.push(row("mix", "Mix", r.mix, { v: undefined, from: "composer" }));
  if (r.loras?.length) rows.push(row("loras", "LoRAs", r.loras.map((l) => `${l.file}${l.strength !== undefined ? ` × ${l.strength}` : ""}`), { v: undefined, from: "composer" }));
  if (r.prefer) rows.push(row("prefer", "Ran on its key at", r.prefer, { v: undefined, from: "composer" }));
  return rows;
}

/** The parts of a request that make it the same run again (a Retry sends the request back as it was). */
export function runFingerprint(req: GenerationRequest): string {
  const r = req.asked ?? req;
  return stableJson({
    feature: r.feature,
    presetId: r.presetId,
    modelId: r.modelId,
    op: r.op,
    prompt: r.prompt?.trim(),
    negativePrompt: r.negativePrompt?.trim(),
    inputs: r.inputs,
    params: r.params,
    presetOptions: r.presetOptions,
    presetStrength: r.presetStrength,
    mix: r.mix,
    loras: r.loras?.map((l) => [l.file, l.strength]),
    engine: r.engine,
  });
}

/** The same words and files with any model or settings (Pick another model, then Run). */
function contentFingerprint(req: GenerationRequest): string {
  const r = req.asked ?? req;
  return stableJson({ feature: r.feature, presetId: r.presetId, prompt: r.prompt?.trim(), inputs: r.inputs });
}

/**
 * How another of the account's runs relates to this one: `same` (the same request again: Retry, or Run pressed again
 * with nothing changed; they can't be told apart), `other-model` (the same words, files and app on another model or
 * other settings: Pick another model, or a setting changed) or `other`.
 */
export type RunMatch = "same" | "other-model" | "other";

export function runMatch(a: GenerationRequest, b: GenerationRequest): RunMatch {
  if (runFingerprint(a) === runFingerprint(b)) return "same";
  return contentFingerprint(a) === contentFingerprint(b) ? "other-model" : "other";
}

// ---------------------------------------------------------------------------
// Keeping secrets out

/** Where a link points, by kind only: a RunPod pod, a tunnel, a LAN address, or another web address. */
export type LinkKind = "runpod" | "tunnel" | "lan" | "web";

const PRIVATE_HOST = /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[?(::1|f[cd][0-9a-f]{2}:[^\]]*|fe80:[^\]]*)\]?|[^.]+|.+\.(local|lan|home|internal))$/i;

export function linkKind(url: string): LinkKind {
  const k = gpuHostOf(url).kind;
  if (k !== "web") return k;
  try {
    return PRIVATE_HOST.test(new URL(url).hostname) ? "lan" : "web";
  } catch {
    return "web";
  }
}

export const LINK_WORDS: Record<LinkKind, string> = { runpod: "a RunPod address", tunnel: "a tunnel address", lan: "a LAN address", web: "a web address" };

/** A key that holds a credential (api_key, hfToken, Authorization, cookie, password…): its value is never shown. */
export const SECRET_KEY = /(api.?key|access.?key|secret|token|passw(or)?d|authorization|^auth$|cookie|session|signature|^sig$|credential|bearer|^key$|private.?key)/i;

const URL_IN_TEXT = /\b(?:https?|wss?):\/\/[^\s"'<>\]\)}]+/gi;

/**
 * A text as the page may show it: every link said by its kind ("[a RunPod address]"), any IP address and port taken out,
 * an address the caller names taken out, and credentials a text echoes (Bearer …, api_key=…) masked.
 */
export function redactText(text: string, o: { url?: string } = {}): string {
  const t = String(text).replace(URL_IN_TEXT, (u) => `[${LINK_WORDS[linkKind(u)]}]`);
  return withoutSecrets(withoutAddress(t, o.url));
}

/** The longest text the page shows of one value. */
const MAX_TEXT = 4000;

/**
 * A stored JSON value (what was sent to the GPU or provider, the job's handles) as the page may show it: credentials'
 * values masked by their key, links said by their kind, inline files (data:) by their type and size, long texts cut.
 * At most `depth` levels, 300 keys and 200 items a level.
 */
export function redactValue(v: unknown, o: { url?: string; depth?: number } = {}): unknown {
  const depth = o.depth ?? 12;
  if (typeof v === "string") {
    const data = /^data:([^;,]+)?[;,]/i.exec(v);
    if (data) return `[inline ${data[1] ?? "file"}, ${Math.round((v.length * 3) / 4 / 1024)} KB]`;
    const t = redactText(v, o);
    return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}… [${t.length - MAX_TEXT} more characters]` : t;
  }
  if (v === null || typeof v !== "object") return v;
  if (depth <= 0) return "[…]";
  if (Array.isArray(v)) {
    const items = v.slice(0, 200).map((x) => redactValue(x, { ...o, depth: depth - 1 }));
    return v.length > 200 ? [...items, `[${v.length - 200} more]`] : items;
  }
  const out: Record<string, unknown> = {};
  const entries = Object.entries(v as Record<string, unknown>);
  for (const [k, x] of entries.slice(0, 300)) out[k] = SECRET_KEY.test(k) && ((typeof x === "string" && x !== "") || (x !== null && typeof x === "object")) ? "••••" : redactValue(x, { ...o, depth: depth - 1 });
  if (entries.length > 300) out["…"] = `${entries.length - 300} more keys`;
  return out;
}
