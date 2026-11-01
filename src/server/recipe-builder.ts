import "server-only";
import fs from "node:fs";
import { getModel } from "@/lib/catalog";
import { inferOperation } from "@/lib/catalog/plan";
import { OPERATION_LABELS, type ChainSlot, type Generation, type GenerationRequest, type OutputFile } from "@/lib/catalog/types";
import { dubLanguageFor } from "@/lib/assist-studios";
import { isHelperFeature } from "@/lib/library";
import { probeMedia } from "@/lib/media-probe";
import { videoPoster } from "@/lib/output-actions";
import { isMediaRef, leafKeys, RECIPE_LIMITS, today, type ParamType, type Recipe, type RecipeCheck, type RecipeStep } from "@/lib/recipe";
import {
  DEMO_NOTE,
  isExpansionLabel,
  notSupported,
  paramIdFrom,
  parseNaming,
  skillBody,
  slugify,
  STEPS_REFUSAL,
  studioOf,
  type DraftCandidate,
  type DraftRefusal,
  type DraftStep,
  type Naming,
  type SettingId,
  type SkillDraft,
} from "@/lib/recipe-builder";
import { db } from "./db";
import { llmText, llmTextBackend, type LlmImage } from "./enhance";
import { listElements } from "./elements";
import { currentRequest, getGeneration, unfilledRequest } from "./generations";
import { getSkill } from "./skills";
import { absolutePath, readRef } from "./storage";

/**
 * Make a skill from results already made (package W2): walk the picked results back through `depends_on` to the
 * requests that made them, and turn them into a recipe (src/lib/recipe.ts) whose every input is still Fixed, with
 * the candidate inputs, proposed checks and a SKILL.md body. No recording, no LLM: Fuobe's records are the exact
 * requests. An optional naming pass (nameDraft) asks Claude or Ollama for names, slots in the words and prose.
 *
 * What changes shape with its input is never replayed as the steps it became: a request that expanded into several
 * rows (src/server/chains.ts) comes back as the request it was asked as (GenerationRequest.asked), a studio's work as
 * its Assist tool when its record holds that tool's input (Translate & dub, Katana, Captions), and everything else
 * that planned its own steps is refused with the studio's name.
 */

class Refused extends Error {}

const depIds = (v: string | null | undefined): string[] => (!v ? [] : v.startsWith("[") ? (JSON.parse(v) as string[]) : [v]);

/** The row a generation is stored as: its dependencies and batch (the Generation object leaves `depends_on` out). */
function rowOf(id: string): { depends_on: string | null; batch_id: string | null } | undefined {
  return db().prepare("SELECT depends_on, batch_id FROM generations WHERE id = ?").get(id) as { depends_on: string | null; batch_id: string | null } | undefined;
}

/** Rows of a batch, as generations (the Trash included: a step of a kept result may be trashed). */
function batchRows(batch: string | null): Generation[] {
  if (!batch) return [];
  const ids = (db().prepare("SELECT id FROM generations WHERE batch_id = ?").all(batch) as { id: string }[]).map((r) => r.id);
  return ids.map((id) => getGeneration(id, { includeDeleted: true })).filter((g): g is Generation => !!g);
}

/**
 * The other rows of the request a row was made by, when the run split it into jobs (a route that can't batch, such as a
 * ComfyUI graph or Replicate without num_outputs, makes one row per result; a count over a route's maximum makes
 * several): the same batch, the same stored request and the same dependencies. Oldest first.
 */
function jobsOf(id: string): string[] {
  const r = db().prepare("SELECT batch_id, request_json, depends_on FROM generations WHERE id = ?").get(id) as { batch_id: string | null; request_json: string; depends_on: string | null } | undefined;
  if (!r?.batch_id) return [];
  const rows = db()
    .prepare("SELECT id FROM generations WHERE batch_id = ? AND request_json = ? AND depends_on IS ? AND id != ? ORDER BY created_at, id")
    .all(r.batch_id, r.request_json, r.depends_on, id) as { id: string }[];
  return rows.map((x) => x.id);
}

/** A request with what differs between the pictures of one PixeletedFace run (createMosaicRun) left out. */
function mosaicShape(req: GenerationRequest): string {
  const rest: GenerationRequest = { ...req };
  delete rest.step;
  const params = { ...rest.params };
  delete params.seed;
  delete params.numOutputs;
  return JSON.stringify({ ...rest, params });
}

/** Request fields a step keeps (GenerationRequestSchema's, less the server's own): everything else is dropped. */
const KEEP: (keyof GenerationRequest)[] = ["feature", "presetId", "modelId", "op", "prompt", "negativePrompt", "inputs", "params", "presetOptions", "presetStrength", "mix", "loras", "engine", "signature"];

function stepRequest(req: GenerationRequest): Record<string, unknown> {
  const out = Object.fromEntries(KEEP.flatMap((k) => (req[k] === undefined ? [] : [[k, JSON.parse(JSON.stringify(req[k]))]]))) as Record<string, unknown> & GenerationRequest;
  // A draft render's handle belongs to that run (its finalize), not to a new one.
  if (out.params?.draftId) {
    const params = { ...out.params };
    delete params.draftId;
    out.params = params;
  }
  if (out.inputs && !Object.keys(out.inputs).length) delete out.inputs;
  return out;
}

// ---------------------------------------------------------------------------
// The graph behind the picks

interface Node {
  key: string;
  /** The result the step stands for (its thumbnail, its checks). */
  gen: Generation;
  /** Every row the step covers (an expansion's rows, a face mosaic's picture, the jobs of one request). */
  rows: string[];
  /** The request ran as this many jobs (a route that can't batch makes one row per result): no count is checked. */
  jobs?: number;
  step: RecipeStep;
  label: string;
  modelName: string;
  notes: string[];
  /** A tool step: its studio, the record it was rebuilt from, and where its media inputs are. */
  tool?: { studio: string; record: string; inputs: { path: (string | number)[]; type: ParamType; label: string }[]; texts: { path: (string | number)[]; label: string }[] };
}

/** The single image a step without `chain` takes from each earlier step (createGenerations' slotsFor). */
const chainOf = (req: GenerationRequest, n: number): ChainSlot[] => Array.from({ length: n }, (_, i) => req.chain?.[i] ?? { slot: "images" as const, position: req.chainFrom ?? "last" });

const opLabel = (op: string | undefined) => (op ? (OPERATION_LABELS[op as keyof typeof OPERATION_LABELS] ?? op) : "Generate");

class Walk {
  nodes = new Map<string, Node>();
  /** Generation id → the node that covers it. */
  covered = new Map<string, Node>();
  keys = new Set<string>();
  notes: string[] = [];

  key(base: string): string {
    const clean = base.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "step";
    let k = /^[a-z0-9]/.test(clean) ? clean : `s${clean}`;
    for (let i = 2; this.keys.has(k); i++) k = `${clean}-${i}`;
    this.keys.add(k);
    return k;
  }

  /** A model that moved (REPLACED_BY): said on its step and once on the review screen. */
  moved(note: string | undefined): string[] {
    if (!note) return [];
    if (!this.notes.includes(note)) this.notes.push(note);
    return [note];
  }

  /** The node for a generation: built once, its dependencies first. Throws Refused with the reason. */
  visit(g: Generation, path: Set<string> = new Set()): Node {
    const known = this.covered.get(g.id);
    if (known) return known;
    if (path.has(g.id)) throw new Refused("Its steps wait for each other in a loop");
    path.add(g.id);
    const req = g.request;
    const helper = isHelperFeature(g.feature);
    const studio = studioOf(g.feature);
    // 1. A studio that plans its own steps from its input (Cinema, Storyboard, Genjutsu…): never replayed step by step.
    if (studio && !helper) throw new Refused(notSupported(studio.name));
    // 2. A request that expanded into several rows: the request as asked, its rows covered. A row of an expansion other
    //    than the one it returned first (a film's shot, a text-to-3D's still) stands for the same request.
    if (req.asked) return this.fromAsked(g);
    const row = rowOf(g.id);
    const batch = row?.batch_id ? batchRows(row.batch_id) : [];
    const head = batch.find((b) => b.request.asked && b.id !== g.id);
    if (head) return this.fromAsked(head);
    // 3. Made in steps before the request as asked was kept (a heuristic on the labels the expansions gave their rows).
    if (!req.skill && batch.length > 1 && isExpansionLabel(req.step?.label)) throw new Refused(STEPS_REFUSAL);
    // 4. Work whose shape follows its input: a storyboard frame, a frame-by-frame step, a helper of a studio.
    if (req.frame) throw new Refused(notSupported(studio?.name ?? "Storyboard"));
    if (req.chain?.some((c) => c.index !== undefined)) throw new Refused(`Made frame by frame${studio ? ` in ${studio.name}` : ""}: making a skill from it isn't supported yet`);
    if (helper) throw new Refused(notSupported(studio?.name ?? "another studio"));
    // 5. A plain request: its dependencies first.
    const deps = depIds(row?.depends_on).map((id) => getGeneration(id, { includeDeleted: true }));
    // Fuobe Soul's PixeletedFace look: the picture and its face mosaic are one request (createMosaicRun).
    const picture = deps.length === 1 && deps[0]?.request.postMade ? deps[0] : null;
    if (picture) return this.plain(g, picture, path);
    return this.plain(g, null, path, deps);
  }

  /** One step from the request a run of rows was asked as. */
  fromAsked(head: Generation): Node {
    const known = this.covered.get(head.id);
    if (known) return known;
    const moved = currentRequest(head.request.asked!);
    const rows = [head.id, ...this.batchAncestors(head)];
    // The step is named by what was asked (a multi-shot film asked without an operation is text to video, not the
    // join its first row is).
    const m = getModel(moved.request.modelId);
    const op = moved.request.op ?? (m ? inferOperation(m, moved.request) : undefined);
    const node = this.add(head, rows, { request: moved.request, op }, this.moved(moved.note));
    node.notes.push(`Rebuilt as the one request it was asked as (it ran as ${rows.length} steps)`);
    return node;
  }

  /** Rows of an expansion behind its head: its ancestors in its own batch (an expansion's batch is its own). */
  batchAncestors(head: Generation): string[] {
    const batch = rowOf(head.id)?.batch_id;
    const out: string[] = [];
    const todo = depIds(rowOf(head.id)?.depends_on);
    while (todo.length) {
      const id = todo.pop()!;
      const r = rowOf(id);
      if (!r || r.batch_id !== batch || out.includes(id)) continue;
      out.push(id);
      todo.push(...depIds(r.depends_on));
    }
    return out;
  }

  plain(g: Generation, picture: Generation | null, path: Set<string>, given?: (Generation | null)[]): Node {
    const source = picture ?? g;
    const deps = given ?? depIds(rowOf(source.id)?.depends_on).map((id) => getGeneration(id, { includeDeleted: true }));
    const moved = currentRequest(source.request);
    const notes = this.moved(moved.note);
    let rows = picture ? [g.id, picture.id] : [g.id];
    let jobs = 1;
    if (picture) {
      const req = { ...moved.request };
      delete req.postMade;
      // The other pictures of the same PixeletedFace run, each with its mosaic: one request for that many.
      const shape = mosaicShape(picture.request);
      const pictures = batchRows(rowOf(picture.id)?.batch_id ?? null)
        .filter((b) => b.request.postMade && mosaicShape(b.request) === shape)
        .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
      if (pictures.length > 1) {
        const ids = new Set(pictures.map((p) => p.id));
        const mosaics = batchRows(rowOf(picture.id)?.batch_id ?? null).filter((b) => depIds(rowOf(b.id)?.depends_on).some((d) => ids.has(d)));
        rows = [...new Set([g.id, picture.id, ...pictures.map((p) => p.id), ...mosaics.map((x) => x.id)])];
        jobs = pictures.length;
        const seeds = pictures.map((p) => p.request.params?.seed);
        const seed = seeds.every((x): x is number => typeof x === "number") ? Math.min(...seeds) : undefined;
        req.params = { ...req.params, numOutputs: pictures.length, ...(seed !== undefined && { seed }) };
        if (seed === undefined && req.params) delete req.params.seed;
        notes.push(`Rebuilt as the one request it was asked as (${pictures.length} pictures, each with its face mosaic)`);
      }
      moved.request = req;
    } else {
      // A Library stack whose request ran as one job per result: one step, as it was asked.
      const others = jobsOf(g.id);
      if (others.length) {
        rows = [g.id, ...others];
        jobs = rows.length;
        notes.push(`Ran as ${jobs} jobs of one request: one step here`);
      }
    }
    const node = (() => {
      if (!deps.length) return this.add(g, rows, { request: moved.request }, notes);
      if (deps.some((d) => !d)) {
        // A step it waited for is gone: what it gave this one stays as a fixed input.
        notes.push("A step before it is gone, so what it gave this step is used as it is");
        const filled = { ...moved.request };
        delete filled.chain;
        delete filled.chainFrom;
        return this.add(g, rows, { request: filled }, notes);
      }
      const before = deps.map((d) => this.visit(d!, new Set(path)));
      const chain = chainOf(moved.request, deps.length);
      const request = unfilledRequest(moved.request, deps.length);
      return this.add(g, rows, { request, after: before.map((n) => n.key), chain }, notes);
    })();
    if (jobs > 1) node.jobs = jobs;
    return node;
  }

  add(gen: Generation, rows: string[], s: { request: GenerationRequest; after?: string[]; chain?: ChainSlot[]; op?: string }, notes: string[]): Node {
    const req = s.request;
    const m = getModel(req.modelId);
    const op = s.op ?? req.op ?? gen.op;
    const label = opLabel(op);
    const step: RecipeStep = {
      key: this.key(op ?? "step"),
      kind: "generate",
      label,
      ...(s.after?.length && { after: s.after.length === 1 ? s.after[0] : s.after }),
      ...(s.after?.length && s.chain && { chain: s.chain }),
      request: stepRequest(req) as never,
    };
    const node: Node = { key: step.key, gen, rows, step, label, modelName: m?.name ?? gen.modelName ?? req.modelId, notes };
    this.nodes.set(node.key, node);
    for (const id of rows) this.covered.set(id, node);
    return node;
  }
}

// ---------------------------------------------------------------------------
// Results handed on by hand (the composer's Animate, Edit, Use as reference…)

/** Input fields that take one file, and the chain slot that fills each. */
const SINGLE_SLOTS: Partial<Record<keyof NonNullable<GenerationRequest["inputs"]>, ChainSlot["slot"]>> = { endImage: "endImage", video: "video", audio: "audio", audio2: "audio2", voiceAudio: "voiceAudio" };

/**
 * A picked result whose input is another picked step's result (a picture animated from the composer, a clip extended
 * from the Library) waits for that step instead: the file becomes a chain slot, so a new run feeds the new result on.
 * Only to a step made before it; a step that feeds another then makes one result.
 */
function linkByFile(walk: Walk): void {
  const nodes = [...walk.nodes.values()].filter((n) => n.step.kind === "generate");
  const made = new Map<string, Node>();
  for (const n of nodes) for (const o of n.gen.outputs) if (o.url && !made.has(o.url)) made.set(o.url, n);
  for (const n of nodes) {
    const step = n.step as Extract<RecipeStep, { kind: "generate" }>;
    const inputs = { ...((step.request.inputs ?? {}) as NonNullable<GenerationRequest["inputs"]>) };
    const after = Array.isArray(step.after) ? [...step.after] : step.after ? [step.after] : [];
    const chain = [...(step.chain ?? [])];
    const from = (url: unknown) => {
      const src = typeof url === "string" ? made.get(url) : undefined;
      return src && src !== n && src.gen.createdAt <= n.gen.createdAt && !after.includes(src.key) ? src : undefined;
    };
    const link = (src: Node, slot: ChainSlot, at = chain.length) => {
      after.splice(at, 0, src.key);
      chain.splice(at, 0, slot);
      const p = (src.step as Extract<RecipeStep, { kind: "generate" }>).request.params as Record<string, unknown> | undefined;
      if (typeof p?.numOutputs === "number" && p.numOutputs > 1) {
        p.numOutputs = 1;
        src.notes.push("Makes one result here: the next step takes it");
      }
    };
    for (const k of ["images", "videos", "audios"] as const) {
      const list = inputs[k];
      if (!list?.length) continue;
      // Which items another picked step made (each step once: a second use of the same file stays a file).
      const taken = new Set<string>();
      const srcs = list.map((url) => {
        const src = from(url);
        if (!src || taken.has(src.key)) return undefined;
        taken.add(src.key);
        return src;
      });
      if (!taken.size) continue;
      // A run puts the chained items before ("first") or after ("last") the step's own, in chain order
      // (withChainInputs): the ones before its first own item go first, the rest last, and a new "last" goes ahead of
      // the step's earlier "last" slots, which came after every item it has here. An item between two of its own
      // can't stay there: it goes last, and the step says so.
      const own = srcs.flatMap((src, i) => (src ? [] : [i]));
      const firstOwn = own[0] ?? list.length;
      const lastOwn = own.at(-1) ?? -1;
      srcs.forEach((src, i) => src && i < firstOwn && link(src, { slot: k, position: "first" }));
      let lastAt = chain.findIndex((c) => c.slot === k && (c.position ?? "last") === "last");
      if (lastAt < 0) lastAt = chain.length;
      let moved = false;
      srcs.forEach((src, i) => {
        if (!src || i < firstOwn) return;
        if (i < lastOwn) moved = true;
        link(src, { slot: k, position: "last" }, lastAt++);
      });
      if (moved) n.notes.push(`Its ${k === "images" ? "pictures" : k === "videos" ? "clips" : "audio files"} come in another order: the ones earlier steps make go after yours`);
      const keep = list.filter((_, i) => !srcs[i]);
      if (keep.length) inputs[k] = keep;
      else delete inputs[k];
    }
    for (const [k, slot] of Object.entries(SINGLE_SLOTS) as [keyof typeof SINGLE_SLOTS, ChainSlot["slot"]][]) {
      const src = from(inputs[k]);
      if (!src) continue;
      link(src, { slot });
      delete inputs[k];
    }
    if (after.length === (Array.isArray(step.after) ? step.after.length : step.after ? 1 : 0)) continue;
    const request = { ...step.request } as Record<string, unknown>;
    if (Object.keys(inputs).length) request.inputs = inputs;
    else delete request.inputs;
    n.step = { ...step, request: request as typeof step.request, after: after.length === 1 ? after[0] : after, chain };
  }
}

/** Steps in an order where each comes after the ones it waits for (Kahn's algorithm, stable). */
function ordered(nodes: Node[]): Node[] {
  const keys = new Set(nodes.map((n) => n.key));
  const waits = (n: Node) => (n.step.kind === "generate" ? (Array.isArray(n.step.after) ? n.step.after : n.step.after ? [n.step.after] : []).filter((a) => keys.has(a)) : []);
  const out: Node[] = [];
  const done = new Set<string>();
  while (out.length < nodes.length) {
    const next = nodes.find((n) => !done.has(n.key) && waits(n).every((a) => done.has(a)));
    if (!next) return [...out, ...nodes.filter((n) => !done.has(n.key))];
    out.push(next);
    done.add(next.key);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Studio work rebuilt as its Assist tool's call

/** A studio record that names a generation (the instr lookup assetRefSql uses), as its id and data. */
function recordNaming(table: "dub_sessions" | "katana_jobs", id: string): { id: string; data: Record<string, unknown> } | null {
  try {
    const r = db().prepare(`SELECT id, data_json FROM ${table} WHERE instr(data_json, ?) > 0 ORDER BY updated_at DESC LIMIT 1`).get(JSON.stringify(id)) as { id: string; data_json: string } | undefined;
    return r ? { id: r.id, data: JSON.parse(r.data_json) as Record<string, unknown> } : null;
  } catch {
    return null;
  }
}

const langName = (code: unknown) => (typeof code === "string" && code && code !== "auto" ? (dubLanguageFor(code)?.name ?? code) : undefined);

interface Lifted {
  tool: string;
  studio: string;
  record: string;
  input: Record<string, unknown>;
  inputs: { path: (string | number)[]; type: ParamType; label: string }[];
  texts: { path: (string | number)[]; label: string }[];
}

/** A studio's result as one call of its Assist tool, when the studio's record holds that tool's input. */
function liftStudio(g: Generation, tool: string, studio: string): Lifted | null {
  if (tool === "dub_video") {
    const rec = recordNaming("dub_sessions", g.id);
    if (!rec) return null;
    const d = rec.data as { video?: string; source?: string; targets?: string[]; mode?: string; model?: string; voiceSplit?: string; voices?: Record<string, { lipsync?: boolean }[]> };
    if (!d.video || !d.targets?.length) return null;
    const runs = Object.values(d.voices ?? {}).flat();
    const lipsync = d.mode === "oneshot" ? d.model !== "elevenlabs-dubbing" : (runs.at(-1)?.lipsync ?? true);
    const input = {
      video: d.video,
      languages: d.targets.map((c) => langName(c) ?? c),
      ...(langName(d.source) && { source_language: langName(d.source) }),
      lipsync,
      review: d.mode !== "oneshot",
      // The open engine's voice split, when the dub picked one (DBS or MelBand RoFormer).
      ...((d.voiceSplit === "dbs" || d.voiceSplit === "melband") && { voice_split: d.voiceSplit }),
    };
    return { tool, studio, record: `dub:${rec.id}`, input, inputs: [{ path: ["video"], type: "video", label: "Video to dub" }], texts: [] };
  }
  if (tool === "katana") {
    const rec = recordNaming("katana_jobs", g.id);
    if (!rec) return null;
    const j = rec.data as { reference?: string; photos?: string[]; instructions?: string; motionModel?: string; keepAudio?: boolean; segments?: { start: number; end: number }[] };
    if (!j.reference || !j.photos?.length) return null;
    const seg = j.segments && j.segments.length > 1 ? Math.round((j.segments[0].end - j.segments[0].start) * 10) / 10 : undefined;
    const input = {
      reference: j.reference,
      photos: j.photos,
      ...(j.instructions?.trim() && { instructions: j.instructions }),
      ...(seg && { segment_seconds: seg }),
      ...(j.motionModel && { motion_model: j.motionModel }),
      keep_audio: j.keepAudio !== false,
    };
    return {
      tool,
      studio,
      record: `katana:${rec.id}`,
      input,
      inputs: [{ path: ["reference"], type: "video", label: "Reference edit" }, ...j.photos.map((_, i) => ({ path: ["photos", i], type: "image" as const, label: j.photos!.length > 1 ? `Subject photo ${i + 1}` : "Subject photo" }))],
      texts: j.instructions?.trim() ? [{ path: ["instructions"], label: "What to keep in mind" }] : [],
    };
  }
  if (tool === "add_captions") {
    // The Captions editor keeps no session: its captioned video's own request holds the input.
    const burn = g.op === "captions" ? g : batchRows(rowOf(g.id)?.batch_id ?? null).find((b) => b.op === "captions" && b.feature === g.feature);
    const video = burn?.request.inputs?.video;
    if (!burn || !video) return null;
    // The languages: on the burn itself (VEED transcribes and translates in one job), else on the steps it waited for
    // (the open engine's transcript, then its translation).
    let { sourceLanguage: spoken, targetLanguage: target } = burn.request.params ?? {};
    const todo = depIds(rowOf(burn.id)?.depends_on);
    const seen = new Set<string>();
    while (todo.length && seen.size < 8) {
      const id = todo.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const d = getGeneration(id, { includeDeleted: true });
      if (!d) continue;
      const dp = d.request.params ?? {};
      if (target === undefined && d.op === "translate" && dp.targetLanguage) target = dp.targetLanguage;
      if (spoken === undefined && dp.sourceLanguage) spoken = dp.sourceLanguage;
      todo.push(...depIds(rowOf(id)?.depends_on));
    }
    const input = { video, ...(langName(spoken) && { spoken_language: langName(spoken) }), ...(target && { translate_to: langName(target) ?? target }) };
    return { tool, studio, record: `captions:${burn.id}`, input, inputs: [{ path: ["video"], type: "video", label: "Video to caption" }], texts: [] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Candidates

const MEDIA_SLOTS: { key: keyof NonNullable<GenerationRequest["inputs"]>; type: "image" | "video" | "audio"; label: (op?: string) => string }[] = [
  { key: "images", type: "image", label: (op) => (op === "i2v" || op === "flf2v" ? "Start frame" : "Image") },
  { key: "endImage", type: "image", label: () => "End frame" },
  { key: "video", type: "video", label: () => "Video" },
  { key: "videos", type: "video", label: () => "Clip" },
  { key: "audio", type: "audio", label: () => "Audio" },
  { key: "audio2", type: "audio", label: () => "Background audio" },
  { key: "voiceAudio", type: "audio", label: () => "Voice sample" },
  { key: "voiceAudio2", type: "audio", label: () => "Second voice sample" },
  { key: "audios", type: "audio", label: () => "Reference audio" },
];

const SETTING_LABELS: Record<SettingId, string> = { numOutputs: "Takes", aspectRatio: "Shape", duration: "Length (seconds)", resolution: "Quality" };

function candidates(nodes: Node[], leaves: Set<string>): DraftCandidate[] {
  const out: DraftCandidate[] = [];
  const taken = new Set<string>();
  const labelsUsed = new Map<string, number>();
  const uniqueLabel = (label: string) => {
    const n = (labelsUsed.get(label) ?? 0) + 1;
    labelsUsed.set(label, n);
    return n === 1 ? label : `${label} ${n}`;
  };
  const add = (c: Omit<DraftCandidate, "id"> & { id?: string }) => {
    const id = paramIdFrom(c.id ?? c.label, taken);
    taken.add(id);
    out.push({ ...c, id } as DraftCandidate);
  };
  // Files: uploads, Library picks and earlier results that aren't a step here. The same file in several steps is one input.
  const media = new Map<string, DraftCandidate & { id?: string }>();
  for (const n of nodes) {
    if (n.tool) {
      for (const i of n.tool.inputs) {
        const v = getAtPath((n.step as Extract<RecipeStep, { kind: "tool" }>).input, i.path);
        if (typeof v !== "string" || !isMediaRef(v)) continue;
        const hit = media.get(v);
        if (hit) hit.at.push({ step: n.key, path: i.path });
        else media.set(v, { id: "", label: i.label, type: i.type, kind: "media", example: v, at: [{ step: n.key, path: i.path }] });
      }
      continue;
    }
    const r = (n.step as Extract<RecipeStep, { kind: "generate" }>).request;
    const inputs = (r.inputs ?? {}) as Record<string, unknown>;
    for (const slot of MEDIA_SLOTS) {
      const v = inputs[slot.key];
      const list = Array.isArray(v) ? v.map((x, i) => [x, ["inputs", slot.key, i]] as const) : v === undefined ? [] : [[v, ["inputs", slot.key]] as const];
      for (const [value, path] of list) {
        if (typeof value !== "string" || !isMediaRef(value)) continue;
        const hit = media.get(value);
        if (hit) hit.at.push({ step: n.key, path: [...path] });
        else media.set(value, { id: "", label: slot.label(r.op), type: slot.type, kind: "media", example: value, at: [{ step: n.key, path: [...path] }] });
      }
    }
  }
  for (const c of media.values()) add({ ...c, id: undefined, label: uniqueLabel(c.label) });
  // Elements: @handles of saved elements named in the words.
  const elements = listElements();
  const named = new Map<string, DraftCandidate>();
  for (const n of nodes) {
    if (n.tool) continue;
    const words = (n.step as Extract<RecipeStep, { kind: "generate" }>).request.prompt;
    if (typeof words !== "string") continue;
    for (const m of words.matchAll(/@([\p{L}\p{N}_-]{1,40})/gu)) {
      const el = elements.find((e) => e.handle.toLowerCase() === m[1].toLowerCase());
      if (!el) continue;
      const handle = `@${m[1]}`;
      const hit = named.get(handle);
      if (hit) {
        if (!hit.at.some((a) => a.step === n.key)) hit.at.push({ step: n.key, path: ["prompt"] });
      } else named.set(handle, { id: "", label: el.name.slice(0, 60), type: "element", kind: "element", example: handle, at: [{ step: n.key, path: ["prompt"] }] });
    }
  }
  for (const c of named.values()) add({ ...c, id: c.label });
  // Words: each step's prompt as a whole (a slot inside it is chosen on the review screen).
  const several = nodes.length > 1;
  for (const n of nodes) {
    if (n.tool) {
      for (const t of n.tool.texts) {
        const v = getAtPath((n.step as Extract<RecipeStep, { kind: "tool" }>).input, t.path);
        if (typeof v === "string" && v.trim()) add({ label: t.label, type: "text", kind: "text", example: v, at: [{ step: n.key, path: t.path }], max: RECIPE_LIMITS.text, ...(v.length > RECIPE_LIMITS.text && { locked: `Too long to change in a form (over ${RECIPE_LIMITS.text} characters)` }) });
      }
      continue;
    }
    const step = n.step as Extract<RecipeStep, { kind: "generate" }>;
    const words = step.request.prompt;
    // Words an earlier step writes (a "prompt" chain slot) come from that step on every run.
    if (typeof words !== "string" || !words.trim() || step.chain?.some((c) => c.slot === "prompt")) continue;
    add({
      id: several ? `prompt_${n.key}` : "prompt",
      label: several ? `Words for “${n.label}”` : "Prompt",
      type: "text",
      kind: "text",
      example: words,
      at: [{ step: n.key, path: ["prompt"] }],
      max: RECIPE_LIMITS.text,
      ...(words.length > RECIPE_LIMITS.text && { locked: `Too long to change in a form (over ${RECIPE_LIMITS.text} characters)` }),
    });
  }
  // Settings: the count of a result you keep, its shape, length and quality (optional, the original as the default).
  const settings = new Map<string, DraftCandidate>();
  for (const n of nodes) {
    if (n.tool) continue;
    const r = (n.step as Extract<RecipeStep, { kind: "generate" }>).request;
    const m = getModel(r.modelId);
    const p = (r.params ?? {}) as Record<string, unknown>;
    const o = m?.options;
    const found: { id: SettingId; value: string | number; extra: Partial<DraftCandidate> }[] = [];
    if (leaves.has(n.key) && n.gen.kind !== "text") {
      const max = Math.min(8, o?.maxOutputs ?? 4);
      if (max > 1) found.push({ id: "numOutputs", value: typeof p.numOutputs === "number" ? p.numOutputs : 1, extra: { type: "number", min: 1, max, step: 1 } });
    }
    if (typeof p.aspectRatio === "string" && o?.aspectRatios && o.aspectRatios.length > 1 && o.aspectRatios.includes(p.aspectRatio)) found.push({ id: "aspectRatio", value: p.aspectRatio, extra: { type: "choice", options: o.aspectRatios.slice(0, RECIPE_LIMITS.options) } });
    if (typeof p.duration === "number" && o?.durations && o.durations.length > 1) found.push({ id: "duration", value: p.duration, extra: { type: "number", min: Math.min(...o.durations), max: Math.max(...o.durations), step: 1 } });
    if (typeof p.resolution === "string" && o?.resolutions && o.resolutions.length > 1 && o.resolutions.includes(p.resolution)) found.push({ id: "resolution", value: p.resolution, extra: { type: "choice", options: o.resolutions.slice(0, RECIPE_LIMITS.options) } });
    for (const f of found) {
      const k = `${f.id}:${f.value}`;
      const hit = settings.get(k);
      if (hit) {
        hit.at.push({ step: n.key, path: ["params", f.id] });
        // Choices every step's model takes.
        if (hit.options && f.extra.options) hit.options = hit.options.filter((x) => f.extra.options!.includes(x));
        continue;
      }
      settings.set(k, { id: "", label: SETTING_LABELS[f.id], kind: "setting", setting: f.id, optional: true, example: f.value, at: [{ step: n.key, path: ["params", f.id] }], type: "number", ...f.extra });
    }
  }
  for (const c of settings.values()) {
    if (c.type === "choice" && (c.options?.length ?? 0) < 2) continue;
    add({ ...c, id: c.setting === "numOutputs" ? "takes" : c.setting === "aspectRatio" ? "shape" : c.setting === "duration" ? "seconds" : "quality", label: uniqueLabel(c.label) });
  }
  return out;
}

function getAtPath(obj: unknown, path: (string | number)[]): unknown {
  let cur = obj;
  for (const k of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Checks from the results

const RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "4:5", "5:4", "21:9", "9:21"];
const ratioOf = (a: string) => {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(a);
  return m ? Number(m[1]) / Number(m[2]) : NaN;
};

/** The shape of a width and height as "16:9" (the one asked for when it matches), within 2%. */
function aspectOf(w: number, h: number, asked?: unknown): string | undefined {
  const r = w / h;
  const fits = (a: string) => Math.abs(r - ratioOf(a)) / ratioOf(a) <= 0.02;
  if (typeof asked === "string" && Number.isFinite(ratioOf(asked)) && fits(asked)) return asked;
  return RATIOS.find(fits);
}

/** A stored file's header facts (duration, sound), read from disk; null for anything else. */
function probeStored(url: string): ReturnType<typeof probeMedia> {
  if (!url.startsWith("/api/files/")) return null;
  try {
    const abs = absolutePath(decodeURIComponent(url.slice("/api/files/".length).split("?")[0]));
    const st = fs.statSync(abs);
    // A header is near the start (or the end for some MP4s); a very large file is skipped rather than read whole.
    if (st.size > 256 * 1024 * 1024) return null;
    return probeMedia(new Uint8Array(fs.readFileSync(abs)));
  } catch {
    return null;
  }
}

/** What a finished run of a step should look like, from the result it was made from (kind, count, shape, length, sound). */
function proposeCheck(n: Node): RecipeCheck {
  const g = n.gen;
  const main = g.outputs.filter((o) => o.kind === g.kind);
  const check: RecipeCheck = { kind: g.kind as RecipeCheck["kind"] };
  // A request that ran as several jobs makes as many rows as its route splits it into: its count isn't checked.
  if (main.length && !(n.jobs && n.jobs > 1)) check.count = main.length;
  const asked = (n.step.kind === "generate" ? (n.step.request.params as Record<string, unknown> | undefined)?.aspectRatio : undefined) ?? undefined;
  // The demo provider's stand-ins say nothing about a real result's shape or length: only what was asked.
  if (g.provider === "mock") {
    if (typeof asked === "string" && Number.isFinite(ratioOf(asked)) && (g.kind === "image" || g.kind === "video")) check.aspect = asked;
    return check;
  }
  const first = main[0] as OutputFile | undefined;
  if (!first) return check;
  const info = g.kind === "video" || g.kind === "audio" ? probeStored(first.url) : null;
  const w = first.width ?? info?.width;
  const h = first.height ?? info?.height;
  if ((g.kind === "image" || g.kind === "video") && w && h) {
    const a = aspectOf(w, h, asked);
    if (a) check.aspect = a;
  }
  if (info?.duration && info.duration > 0) check.seconds = Math.round(info.duration * 10) / 10;
  if (info && g.kind === "video") check.sound = info.hasAudio;
  return check;
}

// ---------------------------------------------------------------------------
// The draft

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A short title from the result: its batch's name, else the first words of its prompt, else what it is. */
function titleFor(g: Generation, label: string): string {
  const named = g.request.batchTitle?.trim() || g.request.title?.trim();
  if (named) return cut(named, 60);
  const words = (g.request.prompt ?? "").replace(/@\S+/g, "").replace(/\s+/g, " ").trim();
  if (words) return cut(capital(words.split(" ").slice(0, 6).join(" ").replace(/[,.;:]+$/, "")), 60);
  return `${label} skill`;
}

/** A free skill name like the title: "lamp-turntable", "lamp-turntable-2"… */
function freeName(title: string): string {
  const base = slugify(title).slice(0, 56).replace(/-+$/, "") || "my-skill";
  let name = base;
  for (let i = 2; getSkill(name) || ["upload", "new", "draft"].includes(name); i++) name = `${base}-${i}`;
  return name;
}

const dayOf = (ts: number) => new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export interface DraftResult {
  draft: SkillDraft | null;
  refusals: DraftRefusal[];
}

/**
 * The draft of a skill from picked results (Library ids): walk `depends_on` back from each to its roots (the picks are
 * the leaves; unrelated picks become parallel steps), rebuild each generation as a generate step (its request as it
 * runs now, chain-filled inputs taken out, server fields dropped), or a studio's result as its tool step, and propose
 * the inputs that could vary (all Fixed) and the checks. A pick that can't be used is a refusal with the reason.
 */
export function draftFromGenerations(ids: string[]): DraftResult {
  const refusals: DraftRefusal[] = [];
  const walk = new Walk();
  const tools: { node: Node; pick: Generation }[] = [];
  const generated: Generation[] = [];
  const unique = [...new Set(ids)].slice(0, 200);
  for (const id of unique) {
    const g = getGeneration(id);
    const title = g ? cut(g.request.title || g.request.prompt || g.modelName || opLabel(g.op), 80) : id;
    if (!g) {
      refusals.push({ id, title, reason: "It's gone (deleted, or in the Trash)" });
      continue;
    }
    if (g.status !== "succeeded") {
      refusals.push({ id, title, reason: g.status === "failed" || g.status === "canceled" ? "It didn't finish, so there's nothing to repeat" : "It's still running: make the skill once it's done" });
      continue;
    }
    if (g.feature === "upload") {
      refusals.push({ id, title, reason: "It's an upload: pick a result made from it" });
      continue;
    }
    const studio = studioOf(g.feature);
    if (studio?.tool && !g.request.frame) {
      const lifted = liftStudio(g, studio.tool, studio.name);
      if (!lifted) {
        refusals.push({ id, title, reason: notSupported(studio.name) });
        continue;
      }
      if (tools.some((t) => t.node.tool?.record === lifted.record)) continue;
      const key = walk.key(lifted.tool.replace(/_/g, "-"));
      const node: Node = {
        key,
        gen: g,
        rows: [g.id],
        step: { key, kind: "tool", label: lifted.studio, tool: lifted.tool, input: lifted.input },
        label: lifted.studio,
        modelName: lifted.studio,
        notes: [`Runs ${lifted.studio} again with the same settings`],
        tool: { studio: lifted.studio, record: lifted.record, inputs: lifted.inputs, texts: lifted.texts },
      };
      tools.push({ node, pick: g });
      continue;
    }
    // A plain result: its graph, all or nothing (a refused step refuses the result that needs it).
    const before = new Map(walk.nodes);
    const covered = new Map(walk.covered);
    const keys = new Set(walk.keys);
    const notes = [...walk.notes];
    try {
      walk.visit(g);
      generated.push(g);
    } catch (e) {
      walk.nodes = before;
      walk.covered = covered;
      walk.keys = keys;
      walk.notes = notes;
      if (!(e instanceof Refused)) throw e;
      refusals.push({ id, title, reason: e.message });
    }
  }
  // Version 1 runs a graph of generate steps or one studio tool, not both (a tool feeding later steps is W7).
  if (tools.length && (walk.nodes.size || tools.length > 1)) {
    const keep = walk.nodes.size ? [] : tools.slice(0, 1);
    for (const t of tools.filter((x) => !keep.includes(x))) {
      refusals.push({ id: t.pick.id, title: cut(t.pick.request.title || t.pick.request.prompt || t.node.label, 80), reason: walk.nodes.size ? "A studio step can't be in a skill with other steps yet: make a skill from it on its own" : "One studio step per skill for now: make a skill from each" });
    }
    tools.splice(0, tools.length, ...keep);
  }
  if (tools.length) walk.nodes.set(tools[0].node.key, tools[0].node);
  linkByFile(walk);
  const nodes = ordered([...walk.nodes.values()]);
  if (!nodes.length) return { draft: null, refusals };
  if (nodes.length > RECIPE_LIMITS.steps) return { draft: null, refusals: [...refusals, { id: ids[0], title: "These results", reason: `They take ${nodes.length} steps; a skill has at most ${RECIPE_LIMITS.steps}` }] };

  // Steps in an order where every step comes after the ones it waits for (the walk added dependencies first).
  const steps = nodes.map((n) => n.step);
  const recipe: Recipe = { fuobeRecipe: 1, params: [], steps };
  const leaves = leafKeys(recipe);
  const checks: Record<string, RecipeCheck> = {};
  for (const n of nodes) if (leaves.has(n.key) && n.step.kind === "generate") checks[n.key] = proposeCheck(n);
  if (Object.keys(checks).length) recipe.checks = checks;
  const all = nodes.flatMap((n) => n.rows.map((id) => getGeneration(id, { includeDeleted: true }))).filter((g): g is Generation => !!g);
  const demo = all.length > 0 && all.every((g) => g.provider === "mock");
  recipe.source = { from: "library", generations: unique.filter((id) => !refusals.some((r) => r.id === id)), at: today(), ...(demo && { demo: true }) };

  const labelOf = new Map(nodes.map((n) => [n.key, n.label]));
  const draftSteps: DraftStep[] = nodes.map((n) => {
    const after = n.step.kind === "generate" ? (Array.isArray(n.step.after) ? n.step.after : n.step.after ? [n.step.after] : []) : [];
    const o = n.gen.outputs.find((x) => x.kind === n.gen.kind) ?? n.gen.outputs[0];
    return {
      key: n.key,
      kind: n.step.kind,
      label: n.label,
      modelName: n.modelName,
      ...(n.gen.engine && { engine: n.gen.engine }),
      generation: n.gen.id,
      ...(o && { thumb: { url: o.url, kind: o.kind, ...(videoPoster(n.gen, o) && { poster: videoPoster(n.gen, o) }) } }),
      waits: after.map((a) => labelOf.get(a) ?? a),
      leaf: leaves.has(n.key),
      notes: n.notes,
    };
  });
  const lead = nodes.find((n) => leaves.has(n.key)) ?? nodes[0];
  const title = titleFor(lead.gen, lead.label);
  const flow = nodes.map((n) => n.label).join(" → ");
  const models = [...new Set(nodes.map((n) => n.modelName))];
  const kinds = [...new Set(nodes.filter((n) => leaves.has(n.key)).map((n) => n.gen.kind))];
  const description = cut(`${nodes.length === 1 ? flow : `${nodes.length} steps: ${flow}`}, with ${models.join(", ")}. Made from results in the Library and run again with new inputs.`, 1000);
  const whenToUse = cut(`When you want another ${kinds.join(" and ")} made the way “${title}” was (${dayOf(lead.gen.createdAt)}), with new inputs.`, 1000);
  const draft: SkillDraft = {
    recipe,
    steps: draftSteps,
    candidates: candidates(nodes, leaves),
    name: freeName(title),
    title,
    description,
    whenToUse,
    demo,
    notes: [...(demo ? [DEMO_NOTE] : []), ...walk.notes],
    llm: llmTextBackend(),
  };
  return { draft, refusals };
}

/** The deterministic SKILL.md body of a draft as it stands (every input Fixed). */
export const draftBody = (draft: SkillDraft) => skillBody(draft.recipe, draft, { title: draft.title, description: draft.description, name: draft.name });

// ---------------------------------------------------------------------------
// The optional naming pass

/**
 * Adapted from Work2Skill's skill-creator policy (AgenticSkillInduction/skills/skill-creator/SKILL.md, MIT licence,
 * © the Work2Skill authors): separate the procedure from the trace, generalise without losing what relates values,
 * keep only completion checks that can be observed, never invent one.
 */
const NAMING_SYSTEM = `You turn a record of media generation steps that a person liked into a reusable skill for Fuobe, an AI image, video and audio studio. You only name things and suggest what could change; Fuobe runs the steps itself.
Rules:
- Separate the procedure from the trace: the models, settings, step order, the prompt's craft words (light, lens, style, camera) are the procedure; the subject, product names, people and places are the trace and may become inputs.
- Generalise a value only when the next run would really change it, and never lose counts, order, relationships between steps or selection rules. If the same words appear in several prompts, they are one input.
- Suggest a slot only for words that appear verbatim in a step's prompt. Prefer few inputs: a skill with fewer inputs is easier to run.
- Keep observable completion checks only (what kind of result, how many, its shape, length, sound). Never invent a success condition the record doesn't show.
- Prefer Fuobe's own tools in the body (run_skill, generate, the studio tools) over describing other software.
Answer with one JSON object and nothing else:
{"name": "kebab-case-name", "title": "Short Title", "description": "One sentence on what it makes and from what.", "when_to_use": "When to pick it.", "inputs": [{"candidate": "<candidate id>", "id": "snake_case_id", "label": "Form label"}], "slots": [{"step": "<step key>", "text": "exact words from that step's prompt", "id": "snake_case_id", "label": "Form label"}], "body": "A SKILL.md body in Markdown: a # title, what it makes, ## Inputs, ## Steps, ## Using Fuobe from an agent."}`;

/** Up to 4 stills of the results a skill keeps (pictures, a clip's poster frame), as an LLM that sees reads them. */
async function leafStills(draft: SkillDraft): Promise<LlmImage[]> {
  const out: LlmImage[] = [];
  for (const s of draft.steps.filter((x) => x.leaf)) {
    if (out.length >= 4) break;
    const url = s.thumb?.kind === "image" ? s.thumb.url : s.thumb?.poster;
    if (!url?.startsWith("/api/files/")) continue;
    try {
      const f = await readRef(url);
      if (/^image\/(jpeg|png|gif|webp)$/.test(f.contentType)) out.push({ data: f.data, contentType: f.contentType });
    } catch {
      // A file that is gone: the words alone.
    }
  }
  return out;
}

/**
 * The optional naming pass: Claude or Ollama (whichever this install allows; none, no pass) names the inputs, suggests
 * slots in the prompts, a title, a description, when to use it and a SKILL.md body. Malformed output is ignored (null).
 */
export async function nameDraft(draft: SkillDraft): Promise<Naming | null> {
  if (!llmTextBackend()) return null;
  const record = {
    steps: draft.recipe.steps.map((s) => {
      const d = draft.steps.find((x) => x.key === s.key);
      return s.kind === "tool"
        ? { key: s.key, studio_tool: s.tool, input: s.input }
        : { key: s.key, does: d?.label, model: d?.modelName, prompt: s.request.prompt, waits_for: d?.waits, keeps_result: d?.leaf };
    }),
    candidates: draft.candidates.filter((c) => !c.locked).map((c) => ({ candidate: c.id, kind: c.kind, type: c.type, label: c.label, example: typeof c.example === "string" && c.kind === "media" ? `(a ${c.type} file)` : c.example })),
    checks: draft.recipe.checks ?? {},
    current: { name: draft.name, title: draft.title, description: draft.description },
  };
  const images = await leafStills(draft);
  const text = await llmText(NAMING_SYSTEM, `${images.length ? "The pictures are the results the person kept.\n" : ""}The record:\n${JSON.stringify(record, null, 2)}`, images);
  return parseNaming(text, draft);
}
