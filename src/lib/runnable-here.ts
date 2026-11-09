import type { GenParams, ModelDef, Operation } from "./catalog/types";
import { keyName, ownSetupLabel, type OwnSetup } from "./own-setup";
import { modelOwnSetup, runsGoHere, type PoolRules } from "./pool-rules";

/**
 * "Runs here": the models a viewer's open runs on this install's GPUs (Fuobe Cloud) take right now, from the same
 * sources the run's own check reads (src/server/hosted-run.ts poolGate): the static own-setup items (own-setup.ts), the
 * policy's model lists and kinds, and the open models no worker can run now (src/server/pool-own-setup.ts
 * poolOwnModels: poolTakes, poolCardRefuses). GET /api/status sends those rules (visitors: `viewer.pool`; the owner, while
 * his ComfyUI runs on the workers: `pool`), so a picker's order, its default, its tags and Run all agree with the run.
 *
 * Pure (client and server). One shared check for every surface that asks "does this run here?" (pickers, the composer's
 * default and free alternative, Assist's plans): import it from here rather than writing a second one.
 */

/** Where a viewer's open runs go to this install's GPUs, with the rules that say what they take now. */
export interface Here {
  rules: PoolRules | undefined;
  /** The pool's owner: his runs go to the workers; what they lack now is a worker's files, never his own GPU or key. */
  owner: boolean;
  /** The longest video clip a visitor's run here makes, in seconds (the owner's setting; absent: no limit). */
  clipS?: number;
}

/** The parts of GET /api/status this reads. */
export interface HereStatus {
  viewer?: { hosted?: boolean; prefer?: "pool"; runOn?: string; gpu: { connected: boolean }; pool?: PoolRules; clipS?: number };
  /** The owner's view of the workers (sent only while his ComfyUI runs on them): the open models they can't run now. */
  pool?: PoolRules;
}

/**
 * The place a viewer's open runs go to this install's GPUs, or null when they don't (hosted runs off, a visitor whose
 * runs go to its own GPU, the owner's ComfyUI on his server or computer): then nothing is reordered or tagged here.
 */
export function hereOf(s: HereStatus | undefined, owner: boolean): Here | null {
  if (!s) return null;
  if (owner) return s.pool ? { rules: s.pool, owner: true } : null;
  const v = s.viewer;
  return v && runsGoHere(v) ? { rules: v.pool, owner: false, ...(v.clipS ? { clipS: v.clipS } : {}) } : null;
}

/**
 * Where an untouched clip length starts for a run here (`current`: the length the run would make with nothing picked),
 * or undefined when it stays: within the longest clip here (Here.clipS), the longest of the picker's own lengths
 * (`lengths`, each one the model takes, so a model's own grid stays whole), else nothing (no length here fits: the
 * price check's label says how to run it). A length the person picks is never changed: it keeps its label instead.
 */
export function hereClipStart(here: Here | null | undefined, lengths: readonly number[] | null | undefined, current: number | undefined): number | undefined {
  const limit = here?.clipS;
  if (!limit || !lengths?.length || current === undefined || current <= limit + 0.05) return undefined;
  const fits = lengths.filter((l) => l <= limit + 0.05);
  return fits.length ? Math.max(...fits) : undefined;
}

/**
 * What a model needs instead of this install's GPUs (a visitor: its own GPU or key; the owner: a worker with its files),
 * or null when it runs here now. Cloud models are the keys' business (their own rows say), never the pool's.
 */
export function hereSetup(here: Here | null | undefined, m: Pick<ModelDef, "id" | "kind" | "engine">): OwnSetup | null {
  if (!here || m.engine !== "open") return null;
  if (here.owner) return here.rules?.own?.[m.id] ?? null;
  return modelOwnSetup(here.rules, m);
}

/** Does this install's GPUs run this model for the viewer now (no place: yes, nothing here has a say)? */
export const runsHere = (here: Here | null | undefined, m: Pick<ModelDef, "id" | "kind" | "engine">): boolean => !hereSetup(here, m);

/**
 * The short positive tag on a "More models" row: the own-setup label ("Self-hosted", "Self-hosted · your fal.ai key");
 * the owner's "Add to a worker".
 */
export function hereTag(o: OwnSetup, owner = false): string {
  return owner ? "Add to a worker" : ownSetupLabel(o);
}

/** The link under the free alternative, to the model's own setup (Connect your GPU, Add your key, a guest's sign-up). */
export const HERE_SET_UP = "Set it up";

/**
 * The primary button's words for the free alternative: "Run free on Fuobe Cloud with MiniMax H3" (the owner's runs are
 * his: "Run with MiniMax H3").
 */
export const hereRunLabel = (alt: Pick<ModelDef, "name">, place: string, owner = false): string => (owner ? `Run with ${alt.name}` : `Run free on ${place} with ${alt.name}`);

/**
 * The line under it: "LTX-2.5 runs self-hosted for now — on your own GPU or with your own key." (what runs it: a GPU, a
 * key, or either); the owner's: add its files to a worker.
 */
export function hereReason(m: Pick<ModelDef, "name">, o: OwnSetup, owner = false): string {
  const how = owner ? "add its files to a worker" : o.need === "key" ? `with your own ${keyName(o.provider)} key` : o.orKey ? "on your own GPU or with your own key" : "on your own GPU";
  return `${m.name} runs self-hosted for now — ${how}.`;
}

/** What the draft asks for that a stand-in should keep: its operation, settings and how many pictures it sends. */
export interface HereAsk {
  op?: Operation;
  params?: Partial<GenParams>;
  /** Reference pictures sent (a start frame counts). */
  images?: number;
  /** An end frame is set. */
  endFrame?: boolean;
}

/**
 * How many of the draft's key settings a model can't keep (lower is closer): its aspect, length, sound, references and end
 * frame. A size it doesn't make is never a reason to pass over a better model (carryParams picks its own).
 */
function misses(m: ModelDef, ask: HereAsk): number {
  const o = m.options;
  const p = ask.params ?? {};
  let n = 0;
  if (p.aspectRatio && o.aspectRatios?.length && !o.aspectRatios.includes(p.aspectRatio)) n++;
  if (p.duration && o.durations?.length && !o.durations.includes(p.duration)) n++;
  if (p.generateAudio && !o.audio) n++;
  if ((ask.images ?? 0) > (o.maxImages ?? 1)) n++;
  if (ask.endFrame && !o.endFrame) n++;
  return n;
}

/** The catalog's own quality order: its top picks, then what's new, then the rest (in catalog order after). */
const rank = (m: ModelDef): number => (m.badges?.includes("top") ? 0 : m.badges?.includes("pro") ? 1 : m.badges?.includes("new") ? 2 : 3);

/**
 * The closest model that runs here now for one that doesn't (the free alternative): the same kind and operation (the
 * draft's, else the model's first), open, then the one that keeps most of the draft's settings (aspect, length,
 * sound, references, end frame), the catalog's top picks first (then its newest), its own family, and the
 * catalog's order.
 * Undefined when none runs here.
 */
export function closestHere(from: ModelDef, models: readonly ModelDef[], here: Here | null | undefined, ask: HereAsk = {}): ModelDef | undefined {
  const op = ask.op && from.routes.some((r) => r.op === ask.op) ? ask.op : from.routes[0]?.op;
  const fits = models
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.id !== from.id && !m.hidden && m.engine === "open" && m.kind === from.kind && (!op || m.routes.some((r) => r.op === op)) && runsHere(here, m));
  fits.sort((a, b) => misses(a.m, ask) - misses(b.m, ask) || rank(a.m) - rank(b.m) || Number(b.m.family === from.family) - Number(a.m.family === from.family) || a.i - b.i);
  return fits[0]?.m;
}

/**
 * The draft's settings as the stand-in takes them: every setting it keeps, and its own default (else its nearest
 * length) for one it can't, so the prompt, inputs and choices carry over to the one press.
 */
export function carryParams<P extends Partial<GenParams>>(params: P, to: ModelDef): P {
  const o = to.options;
  const out: Partial<GenParams> = { ...params };
  const d = to.defaults ?? {};
  if (out.aspectRatio && o.aspectRatios?.length && !o.aspectRatios.includes(out.aspectRatio)) out.aspectRatio = d.aspectRatio ?? o.aspectRatios[0];
  if (out.resolution && o.resolutions?.length && !o.resolutions.includes(out.resolution)) out.resolution = d.resolution ?? o.resolutions[0];
  if (out.duration && o.durations?.length && !o.durations.includes(out.duration)) {
    const want = out.duration;
    out.duration = o.durations.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
  }
  if (out.generateAudio && !o.audio) out.generateAudio = false;
  if (out.numOutputs && o.maxOutputs && out.numOutputs > o.maxOutputs) out.numOutputs = o.maxOutputs;
  return out as P;
}

/** A picker's two parts: what runs here now (first), and "More models" (each with what runs it). */
export function splitHere<M extends Pick<ModelDef, "id" | "kind" | "engine">>(models: readonly M[], here: Here | null | undefined): { now: M[]; more: M[] } {
  const now: M[] = [];
  const more: M[] = [];
  for (const m of models) (runsHere(here, m) ? now : more).push(m);
  return { now, more };
}

/**
 * Where a studio's untouched default moves when it doesn't run here now: the studio's other default (`defaultId`) when
 * that runs, else the closest model that does (closestHere). Undefined when it runs here, or nothing does.
 */
export function hereDefault(current: ModelDef, defaultId: string | undefined, models: readonly ModelDef[], here: Here | null | undefined, ask: HereAsk = {}): ModelDef | undefined {
  if (runsHere(here, current)) return undefined;
  const d = models.find((m) => m.id === defaultId);
  return d && d.id !== current.id && runsHere(here, d) ? d : closestHere(current, models, here, ask);
}
