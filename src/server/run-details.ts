import "server-only";
import fs from "node:fs";
import { getModel, getPreset } from "@/lib/catalog";
import { presetRoutes } from "@/lib/catalog/preset-recipe-routes";
import { AUTO_IMAGE } from "@/lib/auto-image";
import type { AutoWhy, Engine, GenerationRequest, MediaKind } from "@/lib/catalog/types";
import { madeOfRun } from "@/lib/catalog/fitted";
import type { SettingChange } from "@/lib/catalog/made";
import type { RunTrouble } from "@/lib/diagnose";
import { compareSettings, LINK_WORDS, SECRET_KEY, linkKind, redactText, redactValue, runMatch, type LinkKind, type RunMatch, type SettingRow } from "@/lib/run-settings";
import * as STUDIOS from "@/lib/studios";
import { viewerDefaults } from "@/lib/composer";
import { accountRunById, type AccountRun } from "./account-admin";
import { fileAccount } from "./account-library";
import { accountGpu } from "./auth";
import { db } from "./db";
import { exampleRel } from "./example-files";
import { listGenerations } from "./generations";
import type { OwnRunNote } from "./run-events";
import { absolutePath, contentTypeFor, filesRel } from "./storage";

/**
 * The owner's Run details (GET /api/admin/generations/<id>, Settings → Accounts' runs → a run): everything about one
 * account's run in one answer. What it asked for (each setting beside its default), its files, where it ran, what came
 * back, what the account was shown, and the account's other runs of the same batch and around it (a Retry is the same
 * request sent again). Never a key, a token, a GPU's address, a cookie or a password: links are said by their kind, and
 * what was sent and the job's handles go through redactValue.
 */

/** Where a run ran, by kind: the account's own GPU, its own key, this install's GPUs, or (an older run) not known. */
export type RunPlaceKind = "own-gpu" | "own-key" | "site-gpus" | "unknown";

/** How the account's GPU is reached: a RunPod pod, a tunnel, a LAN or web address, the ComfyUI on its computer, or Fuobe Connect. */
export type GpuHostKind = LinkKind | "computer" | "connect";

export const HOST_WORDS: Record<GpuHostKind, string> = {
  runpod: "RunPod pod",
  tunnel: "Tunnel (Cloudflare, ngrok…)",
  lan: "LAN address",
  web: "Web address",
  computer: "ComfyUI on its own computer",
  connect: "Paired with a code (Fuobe Connect)",
};

export interface RunWhere {
  kind: RunPlaceKind;
  /** In words: "Its own GPU", "Its own fal.ai key", "This site's GPUs". */
  label: string;
  provider: string;
  engine: Engine;
  /** Where the job went, as the failure's note recorded it (its kind only). */
  hostKind?: GpuHostKind;
  /** How the account's GPU is set up now (Settings → Your GPU), by kind: it may have changed since the run. */
  hostKindNow?: GpuHostKind | "none";
  /** The ComfyUI graph it ran (its id in the library). */
  workflowId?: string;
  /** The job reached the GPU or provider (it has a job id there). */
  handedOver: boolean;
  /** Which job of its batch it is. */
  jobIndex?: number;
  /** Sent again once, after its GPU lost it. */
  resent?: boolean;
  /** Ran through this install's workers (hosted runs). */
  workers?: boolean;
  /** Waited for its GPU or key to come back: tries so far, since when, until when (a run still waiting). */
  wait?: { tries: number; since?: number; until?: number; words?: string };
  /** The failure as the server noted it for the owner (src/server/run-events.ts): the step, an answer's status or network code, the GPU's or provider's own words. */
  note?: { at: number; cause?: string; stage?: string; code?: string; said?: string };
}

export interface RunInput {
  /** "Image 1", "End frame", "Clip", "Voice"…, or the setting's name for a file in params.extra. */
  slot: string;
  kind: MediaKind | "file";
  /**
   * `kept`: the stored file is there (`url` opens it, for the owner only); `removed`: gone (uploads clear after 14 days,
   * or it was deleted); `example`: one of Fuobe's published example inputs; `inline`: a file sent inside the request;
   * `link`: a web link (said by its kind only).
   */
  state: "kept" | "removed" | "example" | "inline" | "link";
  url?: string;
  /** For a link: where it points, in words. */
  words?: string;
}

/** Another run of the same batch, or one of the account's runs near this one, and how it relates to it. */
export interface NearRun {
  id: string;
  status: string;
  createdAt: number;
  modelId: string;
  modelName?: string;
  presetName?: string | null;
  feature: string;
  /** Its error as the account read it (a failed run). */
  error?: string | null;
  match: RunMatch;
  /** Its job index in the batch. */
  step?: string;
}

export interface RunDetails {
  /** The run as the account's own feed has it (its words, trouble, buttons), with whose it is and each result's state. */
  run: AccountRun;
  /** The stored status words and error (the account may have read a plainer sentence: a hosted run's), without addresses or credentials. */
  stored: { message: string | null; error: string | null };
  /** What a failed run's GPU was missing, and what its GPU or key ran into (stored even where the account wasn't shown it). */
  fix: { code?: string; workflowId?: string; items?: { folder?: string; file?: string; class?: string; pack?: string }[] } | null;
  trouble: RunTrouble | null;
  where: RunWhere;
  /** The model the account chose (Auto, or the one it named), beside the composer's default; `ranOn`: the model that made it, when another. */
  model: { id: string; name: string; state: "default" | "changed" | "unknown"; default?: string; defaultName?: string; ranOn?: { id: string; name: string } };
  preset: { id: string; name: string; type: string } | null;
  studio: { title: string; feature: string } | null;
  prompt: string | null;
  negativePrompt: string | null;
  /** Made by a request that became several steps: the settings are those it was asked with. */
  asked: boolean;
  settings: SettingRow[];
  inputs: RunInput[];
  /** The other runs of its batch, in order (this one included, `match` "same" for itself). */
  batch: NearRun[];
  /** The account's other runs from 2 hours before to 6 hours after it, oldest first (helper steps left out). */
  near: NearRun[];
  /** What was sent to the GPU or provider (the graph or the request), redacted; null when nothing was sent. */
  sent: unknown;
  /** When it was pressed, sent, started and ended, and how long it waited and ran. */
  timing: RunTiming;
  /** Its jobs on this site's GPUs or the account's computer, oldest first: each one's worker, times and tries. */
  jobs: RunJob[];
  /** The workers' log for this run, oldest first: who took each job, gave it back or finished it. */
  workerLog: WorkerEvent[];
  /** What it cost and whether it was charged. */
  money: RunMoney;
  /** How it was made: Auto's pick, a model that made it after another declined, and what changed while it ran. */
  madeBy: RunMadeBy;
  /** Where it was made: the studio or tool, and whether a tool made it for one of the account's projects. */
  surface: RunSurface;
  /** The job's id at the GPU or provider, when it reached one (addresses and credentials left out). */
  providerId: string | null;
  /** Its progress now (a run still going): the share done and the step the GPU is on. */
  progress: { share: number | null; step?: { value?: number; max?: number; node?: string; loading?: boolean; at?: number } } | null;
  /** Each result's check before it shows, when results are checked first. */
  checks: { state: string; askedAt: number; decidedAt: number | null; tries: number }[];
}

export interface RunTiming {
  /** Run was pressed (the row was made). */
  pressedAt: number;
  /** Still waiting to enter the line: why, and when it may (hosted runs). */
  held?: { reason: string; startAt: number | null; tries: number };
  /** Its job was handed to the GPU or provider. */
  sentAt?: number;
  /** The GPU or provider began working on it. */
  startedAt?: number;
  endedAt?: number;
  /** From the press to the start of work. */
  waitedMs?: number;
  /** From the start of work to the end. */
  ranMs?: number;
  /** The GPU's own measured time, as its worker said it. */
  gpuMs?: number;
  /** From the press to the end. */
  totalMs?: number;
}

export interface RunJob {
  state: string;
  /** "gpu", or "cpu" for a finishing job (joins, trims). */
  slot: "gpu" | "cpu";
  lane?: string;
  /** Its class in the line: paid, free or owner. */
  lineClass?: string;
  worker?: string;
  device?: string;
  workflowId?: string;
  attempts: number;
  /** Times a worker gave it back and it went back in line (a worker that stopped or crashed). */
  requeues: number;
  /** Workers that tried it before. */
  triedBy: number;
  estMs?: number;
  execMs?: number;
  createdAt: number;
  claimedAt?: number;
  sentAt?: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  note?: string;
  /** Its computer's ComfyUI didn't answer, since when (and why, when it said). */
  down?: { at: number; why?: string };
}

export interface WorkerEvent {
  at: number;
  event: string;
  worker?: string;
  lane?: string;
  execMs?: number;
  device?: string;
}

export interface RunMoney {
  costUsd: number | null;
  /** Its class in the line on this site's GPUs. */
  lineClass?: "paid" | "free";
  /** The words for what it cost on this site's GPUs ("7 units"). */
  charge?: string;
  /** An amount was set aside for it when it was pressed. */
  setAside: boolean;
  /** It failed or was stopped after an amount was set aside: nothing was charged. */
  notCharged: boolean;
  /** It failed or stopped before the paid provider took the job. */
  notBilled: boolean;
  /** Light work only (joins, trims): free and never counted. */
  light: boolean;
  /** How long it may wait in line, and its head start in line (ms). */
  waitMs?: number;
  boostMs?: number;
  /** Its charge, refund or release report and where it stands. */
  report?: { kind: string; state: "sent" | "waiting" | "gave-up"; tries: number };
}

export interface RunMadeBy {
  /** A run of Auto: the model it picked, and why. */
  auto?: { model: string; name: string; why: AutoWhy; words: string };
  /** Ideogram 4 declined it: its stage, and the model that made it in its place. */
  declined?: { stage?: string; words: string; model?: string; modelName?: string; askedModel?: string; askedModelName?: string };
  /** What changed while it ran (an optional input left out, another model made it), said on the result. */
  notices: string[];
  /** Settings the model makes differently from what was asked (the account sees the made value only). */
  changes: SettingChange[];
}

export interface RunSurface {
  /** "Image", "Canvas", "Cinema Studio"… */
  label: string;
  /** Made on its own in a studio (true), or by a tool for one of the account's projects (false). Unknown on older runs. */
  standalone?: boolean;
  /** Made by a skill's recipe: the skill's name. */
  skill?: string;
  /** A step of a longer run: its label and place. */
  step?: string;
}

interface RawRow {
  request_json: string;
  message: string | null;
  error: string | null;
  external_id: string | null;
  external_meta_json: string | null;
  provider_input_json: string | null;
  fix_json: string | null;
}

const parse = (json: string | null | undefined): unknown => {
  if (!json) return null;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);

const HOST_KINDS = new Set<GpuHostKind>(["runpod", "tunnel", "lan", "web", "computer", "connect"]);

/** The account's GPU now (Settings → Your GPU), by kind; its address is never part of the answer. */
function gpuNow(account: string): { kind: GpuHostKind | "none"; url?: string } {
  const gpu = accountGpu(account);
  if (!gpu) return { kind: "none" };
  if (gpu.mode === "computer") return { kind: "computer" };
  return { kind: linkKind(gpu.url), url: gpu.url };
}

function whereOf(run: AccountRun, raw: RawRow, gpu: ReturnType<typeof gpuNow>): RunWhere {
  const meta = obj(parse(raw.external_meta_json));
  const note = obj(meta.ownRun) as Partial<OwnRunNote>;
  const heal = obj(meta.heal);
  const pool = run.place === "pool";
  const own = !pool && run.provider === "comfyui";
  const key = !pool && (run.provider === "fal" || run.provider === "replicate");
  const kind: RunPlaceKind = pool ? "site-gpus" : own ? "own-gpu" : key ? "own-key" : "unknown";
  const label = pool ? "This site's GPUs" : own ? "Its own GPU" : key ? `Its own ${run.provider === "fal" ? "fal.ai key" : "Replicate token"}` : run.provider;
  const hostKind = typeof note.hostKind === "string" && HOST_KINDS.has(note.hostKind as GpuHostKind) ? (note.hostKind as GpuHostKind) : undefined;
  const said = str(note.said);
  return {
    kind,
    label,
    provider: run.provider,
    engine: run.engine,
    ...(hostKind && own && { hostKind }),
    ...(own && { hostKindNow: gpu.kind }),
    ...(str(meta.workflowId) && { workflowId: str(meta.workflowId) }),
    handedOver: !!raw.external_id,
    ...(num(meta.jobIndex) !== undefined && { jobIndex: num(meta.jobIndex) }),
    ...(meta.resent === true && { resent: true }),
    ...(meta.workers === true && { workers: true }),
    ...(num(heal.tries) !== undefined && {
      wait: {
        tries: num(heal.tries)!,
        ...(num(heal.since) !== undefined && { since: num(heal.since) }),
        ...(num(heal.deadline) !== undefined && { until: num(heal.deadline) }),
        ...(str(heal.words) && { words: redactText(str(heal.words)!, { url: gpu.url }) }),
      },
    }),
    ...(typeof note.at === "number" && {
      note: {
        at: note.at,
        ...(str(note.cause) && { cause: str(note.cause) }),
        ...(str(note.stage) && { stage: str(note.stage) }),
        ...(str(note.code) && { code: str(note.code) }),
        ...(said && { said: redactText(said, { url: gpu.url }) }),
      },
    }),
  };
}

/** What each input slot is called on the page. */
const SLOT_WORDS: Record<string, string> = {
  images: "Image",
  endImage: "End frame",
  mask: "Mask",
  sketch: "Sketch",
  video: "Clip",
  videos: "Clip",
  audio: "Sound",
  audio2: "Second sound",
  audios: "Sound",
  voiceAudio: "Voice",
  voiceAudio2: "Second voice",
  model3d: "3D model",
};

const kindOfType = (type: string): RunInput["kind"] =>
  type.startsWith("image/") ? "image" : type.startsWith("video/") ? "video" : type.startsWith("audio/") ? "audio" : /gltf|glb/.test(type) ? "model3d" : "file";

/** One file a run named, as the owner may open it: a stored file that is still there, else what it was. */
export function inputOf(slot: string, ref: string): RunInput {
  const r = ref.trim();
  if (r.startsWith("data:")) return { slot, kind: kindOfType(/^data:([^;,]+)/.exec(r)?.[1] ?? ""), state: "inline" };
  if (/^(https?|wss?):\/\//i.test(r)) return { slot, kind: "file", state: "link", words: LINK_WORDS[linkKind(r)] };
  if (exampleRel(r)) return { slot, kind: kindOfType(contentTypeFor(r)), state: "example", url: r };
  const rel = r.startsWith("/api/files/") ? filesRel(r) : null;
  if (rel === null) return { slot, kind: "file", state: "removed" };
  const kind = kindOfType(contentTypeFor(rel));
  let there = false;
  try {
    there = fileAccount(rel) !== undefined && fs.statSync(absolutePath(rel)).isFile();
  } catch {
    there = false;
  }
  return there ? { slot, kind, state: "kept", url: r } : { slot, kind, state: "removed" };
}

/** Every file a request names: its inputs (in slot order), then any file a setting in params.extra names. */
export function inputsOf(req: GenerationRequest): RunInput[] {
  const out: RunInput[] = [];
  for (const [slot, v] of Object.entries(req.inputs ?? {})) {
    const words = SLOT_WORDS[slot] ?? slot;
    if (Array.isArray(v)) v.forEach((ref, i) => typeof ref === "string" && out.push(inputOf(v.length > 1 ? `${words} ${i + 1}` : words, ref)));
    else if (typeof v === "string") out.push(inputOf(words, v));
  }
  for (const [k, v] of Object.entries(req.params?.extra ?? {})) {
    const refs = (Array.isArray(v) ? v : [v]).filter((x): x is string => typeof x === "string" && /^(\/api\/files\/|data:)/.test(x));
    refs.forEach((ref, i) => out.push(inputOf(refs.length > 1 ? `${k} ${i + 1}` : k, ref)));
  }
  return out;
}

/** The studio a feature belongs to (its config), for its default model. */
function studioOf(feature: string): { title: string; feature: string; defaultModels: { cloud: string; open: string }; uncaptioned?: Partial<{ cloud: string; open: string }> } | undefined {
  for (const v of Object.values(STUDIOS)) {
    const c = v as { feature?: unknown; title?: unknown; defaultModels?: { cloud: string; open: string }; uncaptioned?: Partial<{ cloud: string; open: string }> };
    if (c && typeof c === "object" && c.feature === feature && typeof c.title === "string" && c.defaultModels) return c as never;
  }
  return undefined;
}

/**
 * The model the composer would have opened on for this run: an app's or a camera motion's first route on its engine,
 * else its studio's default (or the stand-in it names where the server writes no caption). Unknown otherwise.
 */
function modelChoice(run: AccountRun, chosen: string = run.modelId): RunDetails["model"] {
  const picked = modelPicked(run, chosen);
  return { ...picked, ...(chosen !== run.modelId && { ranOn: { id: run.modelId, name: run.modelName ?? run.modelId } }) };
}

function modelPicked(run: AccountRun, chosen: string): RunDetails["model"] {
  const name = chosen === run.modelId ? (run.modelName ?? run.modelId) : (getModel(chosen)?.name ?? chosen);
  const preset = run.presetId ? getPreset(run.presetId) : undefined;
  const has = (id: string) => !!getModel(id);
  if (preset) {
    const first = presetRoutes(preset, run.engine, has)[0]?.modelId;
    if (!first) return { id: chosen, name, state: "unknown" };
    const others = new Set(presetRoutes(preset, run.engine, has).map((r) => r.modelId));
    return {
      id: chosen,
      name,
      // An app's other routes are its own models too (the composer offers only those).
      state: first === chosen || (preset.type === "app" && others.has(chosen)) ? "default" : "changed",
      default: first,
      defaultName: getModel(first)?.name ?? first,
    };
  }
  const studio = studioOf(run.feature);
  if (!studio) return { id: chosen, name, state: "unknown" };
  const d = studio.defaultModels[run.engine];
  const stand = viewerDefaults(studio.defaultModels, studio.uncaptioned, false)[run.engine];
  return { id: chosen, name, state: chosen === d || chosen === stand ? "default" : "changed", default: stand, defaultName: getModel(stand)?.name ?? stand };
}

function nearOf(g: { id: string; status: string; createdAt: number; modelId: string; modelName?: string; presetName?: string | null; feature: string; error: string | null; request: GenerationRequest }, req: GenerationRequest): NearRun {
  return {
    id: g.id,
    status: g.status,
    createdAt: g.createdAt,
    modelId: g.modelId,
    ...(g.modelName && { modelName: g.modelName }),
    presetName: g.presetName ?? null,
    feature: g.feature,
    ...(g.status === "failed" && { error: g.error ? redactText(g.error) : null }),
    match: runMatch(req, g.request),
    ...(g.request.step && { step: `${g.request.step.label} (${g.request.step.index + 1} of ${g.request.step.of})` }),
  };
}

const HOUR = 3_600_000;

/** A link a button opens, without its query or fragment (a console page's pod id, a signed download's token). Settings links stay. */
export function safeTarget(target: string): string {
  if (!/^https?:\/\//i.test(target)) return target;
  try {
    const u = new URL(target);
    const kind = linkKind(target);
    return kind === "web" ? `${u.origin}${u.pathname}` : `[${LINK_WORDS[kind]}]`;
  } catch {
    return "";
  }
}

/** A trouble as the page shows it: its details line without an address or a credential, its buttons' links without a query. */
export function safeTrouble<T extends RunTrouble>(t: T, url?: string): T {
  return {
    ...t,
    ...(t.details && { details: redactText(t.details, { url }) }),
    actions: t.actions.map((a) => ({ ...a, ...(a.target && { target: safeTarget(a.target) }) })),
  };
}

/** Tools and studios whose names aren't their feature's ("cinema-scene" is Cinema Studio's). */
const TOOL_NAMES: [RegExp, string][] = [
  [/^canvas$/, "Canvas"],
  [/^assist$/, "Assist"],
  [/^cinema(-|$)/, "Cinema Studio"],
  [/^storyboard(-|$)/, "Storyboard"],
  [/^content-factory$/, "Content Factory"],
  [/^faceless(-|$)/, "Faceless Studio"],
  [/^ad-multiplier$/, "Ad Multiplier"],
  [/^click-to-ad$/, "Click to Ad"],
  [/^(marketing|ads)$/, "Marketing Studio"],
  [/^photodump$/, "Photodump"],
  [/^genjutsu$/, "Genjutsu"],
  [/^moodboard$/, "Moodboards"],
  [/^layers$/, "Layers"],
  [/^explainer$/, "Explainer"],
  [/^influencer$/, "AI Influencer"],
];

const featureWords = (f: string) => f.charAt(0).toUpperCase() + f.slice(1).replaceAll("-", " ");

/** Where a run was made: its tool or studio, whether a tool made it for a project, and the skill or step it belongs to. */
export function surfaceOf(feature: string, stamp: GenerationRequest): RunSurface {
  const tool = TOOL_NAMES.find(([re]) => re.test(feature))?.[1];
  return {
    label: tool ?? studioOf(feature)?.title ?? featureWords(feature),
    standalone: stamp.standalone === true,
    ...(stamp.skill?.name && { skill: stamp.skill.name }),
    ...(stamp.step && { step: `${stamp.step.label} (${stamp.step.index + 1} of ${stamp.step.of})` }),
  };
}

/** Why Auto picked its model, in words. */
export const AUTO_WHY_WORDS: Record<AutoWhy, string> = {
  edit: "It had a picture to work from, so it went to the edit model",
  text: "Its words ask for lettering, so it went to Ideogram 4",
  trigger: "Its words match a pattern in Settings → Auto image model",
  plain: "A plain prompt: the usual first model",
  declined: "Ideogram 4 declined it, so this model made it instead",
};

const DECLINED_STAGE_WORDS: Record<string, string> = {
  retry: "Ideogram 4 declined it and was asked again with a new seed",
  fallback: "Ideogram 4 declined it, so another model made it",
};

/** How a run was made: Auto's pick, Ideogram 4's declines and the model after them, and the notices it carries. */
export function madeByOf(run: AccountRun, meta: Record<string, unknown>): RunMadeBy {
  const req = run.request;
  const pick = req.modelId === AUTO_IMAGE && req.auto ? req.auto : undefined;
  const d = obj(meta.declined);
  const was = obj(d.was);
  const stage = str(d.stage);
  const askedModel = str(was.model_id);
  const fallback = str(d.model);
  const declined =
    stage || run.declinedCards?.length
      ? {
          ...(stage && { stage }),
          words: (stage && DECLINED_STAGE_WORDS[stage]) || "Ideogram 4 returned its grey card for a picture",
          ...(fallback && { model: fallback, modelName: getModel(fallback)?.name ?? fallback }),
          ...(askedModel && { askedModel, askedModelName: getModel(askedModel)?.name ?? askedModel }),
        }
      : undefined;
  const skipped = req.chainSkipped?.slots.length ?? 0;
  const notices = [req.notice, skipped ? `Left out ${skipped} optional input${skipped > 1 ? "s" : ""} whose steps failed` : undefined]
    .map((n) => n?.trim())
    .filter((n): n is string => !!n);
  return {
    ...(pick && { auto: { model: pick.model, name: getModel(pick.model)?.name ?? pick.model, why: pick.why, words: AUTO_WHY_WORDS[pick.why] ?? pick.why } }),
    ...(declined && { declined }),
    notices,
    // Worked out here when the run doesn't carry it: the same rules the studios use before a run.
    changes: (run.made ?? madeOfRun(getModel(run.modelId), { op: run.op, provider: run.provider, request: run.request }))?.changes ?? [],
  };
}

interface TaskFacts {
  id: string;
  state: string;
  slot: string | null;
  lane: string | null;
  class: string | null;
  workflow_id: string | null;
  attempts: number;
  requeues: number | null;
  tried_json: string | null;
  est_ms: number | null;
  error: string | null;
  note: string | null;
  down_at: number | null;
  down_why: string | null;
  progress_json: string | null;
  created_at: number;
  claimed_at: number | null;
  sent_at: number | null;
  started_at: number | null;
  finished_at: number | null;
}

interface LogRow {
  at: number;
  event: string;
  task_id: string;
  worker_name: string | null;
  lane: string | null;
  exec_ms: number | null;
  device: string | null;
}

/** The columns a table has (empty: no such table), so an install from before a column reads what it has. */
function columnsOf(table: string): Set<string> {
  return new Set((db().prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as { name: string }[]).map((c) => c.name));
}

/** A column when the table has it, else NULL under its name. */
const col = (have: Set<string>, name: string) => (have.has(name) ? name : `NULL AS ${name}`);

/** A run's jobs on this site's workers or the account's computer, and the workers' log of them, oldest first. */
function jobsOf(id: string, url?: string): { jobs: RunJob[]; log: WorkerEvent[]; tasks: TaskFacts[] } {
  const have = columnsOf("relay_tasks");
  if (!have.size) return { jobs: [], log: [], tasks: [] };
  const cols = ["slot", "lane", "class", "requeues", "tried_json", "est_ms", "progress_json"].map((c) => col(have, c)).join(", ");
  const tasks = db()
    .prepare(
      `SELECT id, state, workflow_id, attempts, error, note, down_at, down_why, created_at, claimed_at, sent_at, started_at, finished_at, ${cols}
       FROM relay_tasks WHERE generation_id = ? ORDER BY created_at, id`,
    )
    .all(id) as TaskFacts[];
  const log = columnsOf("worker_jobs").size
    ? (db().prepare("SELECT at, event, task_id, worker_name, lane, exec_ms, device FROM worker_jobs WHERE generation_id = ? ORDER BY id").all(id) as LogRow[])
    : [];
  const scrub = (t: string | null) => (t ? redactText(t, { url }) : undefined);
  const jobs = tasks.map((t): RunJob => {
    const mine = log.filter((l) => l.task_id === t.id);
    const finished = mine.filter((l) => l.event === "finished").at(-1);
    const taker = mine.filter((l) => l.event === "claimed").at(-1);
    const worker = finished?.worker_name ?? taker?.worker_name;
    const device = finished?.device ?? taker?.device;
    const tried = parse(t.tried_json);
    return {
      state: t.state,
      slot: t.slot === "cpu" ? "cpu" : "gpu",
      ...(t.lane && { lane: t.lane }),
      ...(t.class && { lineClass: t.class }),
      ...(worker && { worker }),
      ...(device && { device }),
      ...(t.workflow_id && { workflowId: t.workflow_id }),
      attempts: t.attempts,
      requeues: t.requeues ?? 0,
      triedBy: Array.isArray(tried) ? tried.length : 0,
      ...(t.est_ms != null && { estMs: t.est_ms }),
      ...(finished?.exec_ms != null && { execMs: finished.exec_ms }),
      createdAt: t.created_at,
      ...(t.claimed_at != null && { claimedAt: t.claimed_at }),
      ...(t.sent_at != null && { sentAt: t.sent_at }),
      ...(t.started_at != null && { startedAt: t.started_at }),
      ...(t.finished_at != null && { finishedAt: t.finished_at }),
      ...(t.error && { error: scrub(t.error) }),
      ...(t.note && { note: scrub(t.note) }),
      ...(t.down_at != null && { down: { at: t.down_at, ...(t.down_why && { why: t.down_why }) } }),
    };
  });
  return {
    jobs,
    tasks,
    log: log.map((l) => ({
      at: l.at,
      event: l.event,
      ...(l.worker_name && { worker: l.worker_name }),
      ...(l.lane && { lane: l.lane }),
      ...(l.exec_ms != null && { execMs: l.exec_ms }),
      ...(l.device && { device: l.device }),
    })),
  };
}

const earliest = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => typeof x === "number").sort((a, b) => a - b)[0];

/** When the run was pressed, sent, started and ended, and the waits between. */
function timingOf(run: AccountRun, tasks: TaskFacts[], log: WorkerEvent[]): RunTiming {
  const times = columnsOf("generation_runs").size
    ? (db().prepare("SELECT submitted_at, started_at FROM generation_runs WHERE id = ?").get(run.id) as { submitted_at: number | null; started_at: number | null } | undefined)
    : undefined;
  const hold = columnsOf("pool_holds").size
    ? (db().prepare("SELECT reason, start_at, tries FROM pool_holds WHERE generation_id = ?").get(run.id) as { reason: string; start_at: number | null; tries: number } | undefined)
    : undefined;
  const sentAt = earliest([times?.submitted_at, ...tasks.map((t) => t.sent_at)]);
  const startedAt = earliest([times?.started_at, ...tasks.map((t) => t.started_at)]);
  const endedAt = run.completedAt ?? undefined;
  const gpuMs = log.filter((l) => l.event === "finished").reduce((n, l) => n + (l.execMs ?? 0), 0);
  return {
    pressedAt: run.createdAt,
    ...(hold && { held: { reason: hold.reason, startAt: hold.start_at, tries: hold.tries } }),
    ...(sentAt !== undefined && { sentAt }),
    ...(startedAt !== undefined && { startedAt, waitedMs: Math.max(0, startedAt - run.createdAt) }),
    ...(endedAt && { endedAt, totalMs: Math.max(0, endedAt - run.createdAt) }),
    ...(endedAt && startedAt !== undefined && { ranMs: Math.max(0, endedAt - startedAt) }),
    ...(gpuMs > 0 && { gpuMs }),
  };
}

/** What a run cost, whether an amount was set aside and charged, and where its report stands. */
function moneyOf(run: AccountRun, stamp: GenerationRequest): RunMoney {
  const report = columnsOf("billing_outbox").size
    ? (db().prepare("SELECT kind, done_at, gave_up, tries FROM billing_outbox WHERE key = ?").get(run.id) as { kind: string; done_at: number | null; gave_up: number; tries: number } | undefined)
    : undefined;
  return {
    costUsd: run.costUsd,
    ...((stamp.class === "paid" || stamp.class === "free") && { lineClass: stamp.class }),
    ...(stamp.charge && { charge: stamp.charge }),
    setAside: !!stamp.hold && !!stamp.charged,
    notCharged: !!run.notCharged,
    notBilled: !!run.notBilled,
    light: stamp.light === true,
    ...(typeof stamp.waitMs === "number" && { waitMs: stamp.waitMs }),
    ...(typeof stamp.boostMs === "number" && { boostMs: stamp.boostMs }),
    ...(report && { report: { kind: report.kind, state: report.gave_up ? "gave-up" : report.done_at ? "sent" : "waiting", tries: report.tries } }),
  };
}

/** Its results' checks before they show, oldest first. */
function checksOf(id: string): RunDetails["checks"] {
  if (!columnsOf("output_checks").size) return [];
  const rows = db().prepare("SELECT state, asked_at, decided_at, tries FROM output_checks WHERE generation_id = ? ORDER BY asked_at").all(id) as {
    state: string;
    asked_at: number;
    decided_at: number | null;
    tries: number;
  }[];
  return rows.map((c) => ({ state: c.state, askedAt: c.asked_at, decidedAt: c.decided_at, tries: c.tries }));
}

/** A run still going: the share done, and the step its GPU last said. */
function progressOf(run: AccountRun, tasks: TaskFacts[]): RunDetails["progress"] {
  if (run.status !== "queued" && run.status !== "running") return null;
  const live = [...tasks].reverse().find((t) => t.progress_json);
  const p = obj(parse(live?.progress_json));
  const step = {
    ...(num(p.value) !== undefined && { value: num(p.value) }),
    ...(num(p.max) !== undefined && { max: num(p.max) }),
    ...(str(p.node) && { node: str(p.node) }),
    ...(p.cold === true && { loading: true }),
    ...(num(p.at) !== undefined && { at: num(p.at) }),
  };
  return { share: run.progress, ...(Object.keys(step).length > 0 && { step }) };
}

/** The owner's view of one account's run, or null: no such run, or it is the owner's own (the Library has those). */
export function runDetails(id: string, o: { emails?: boolean } = {}): RunDetails | null {
  const run = accountRunById(id, o.emails ?? true);
  if (!run) return null;
  const account = run.account.id;
  const raw = db().prepare("SELECT request_json, message, error, external_id, external_meta_json, provider_input_json, fix_json FROM generations WHERE id = ?").get(id) as RawRow | undefined;
  if (!raw) return null;
  const gpu = gpuNow(account);
  const scrub = (t: string | null) => (t ? redactText(t, { url: gpu.url }) : t);
  const req = run.request;
  const asked = req.asked ?? req;
  const preset = run.presetId ? getPreset(run.presetId) : undefined;
  const has = (m: string) => !!getModel(m);
  const route = preset ? presetRoutes(preset, run.engine, has).find((r) => r.modelId === run.modelId) : undefined;
  const fixRaw = obj(parse(raw.fix_json));
  const { trouble: troubleRaw, ...fixRest } = fixRaw;
  const t = obj(troubleRaw);
  const trouble: RunTrouble | null = typeof t.cause === "string" && Array.isArray(t.actions) ? safeTrouble(t as unknown as RunTrouble, gpu.url) : null;
  const studio = preset ? null : studioOf(run.feature);
  // The stored request with its stamp (place, class, charge): the run as read leaves the stamp out.
  const stamp = obj(parse(raw.request_json)) as unknown as GenerationRequest;
  const meta = obj(parse(raw.external_meta_json));
  const { jobs, log, tasks } = jobsOf(id, gpu.url);
  const madeBy = madeByOf(run, meta);
  const chosen = req.modelId === AUTO_IMAGE ? AUTO_IMAGE : (madeBy.declined?.askedModel ?? run.modelId);

  // The same batch, in the order its jobs were made; and the account's runs around this one (a Retry is a new run).
  const batch = run.batchId
    ? listGenerations({ batchId: run.batchId, account, steps: true, limit: 200 })
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
        .map((g) => nearOf(g, req))
    : [];
  const inBatch = new Set(batch.map((b) => b.id));
  const near = listGenerations({ account, since: run.createdAt - 2 * HOUR, until: run.createdAt + 6 * HOUR, limit: 60 })
    .filter((g) => g.id !== run.id && !inBatch.has(g.id))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((g) => nearOf(g, req));

  return {
    run: {
      ...run,
      request: redactValue(run.request, { url: gpu.url }) as GenerationRequest,
      error: scrub(run.error),
      message: scrub(run.message),
      ...(run.detail && { detail: scrub(run.detail) ?? undefined }),
      ...(run.trouble && { trouble: safeTrouble(run.trouble, gpu.url) }),
      ...(run.waiting && { waiting: safeTrouble(run.waiting, gpu.url) }),
    },
    stored: { message: scrub(raw.message), error: scrub(raw.error) },
    fix: Object.keys(fixRest).length ? (redactValue(fixRest, { url: gpu.url }) as RunDetails["fix"]) : null,
    trouble,
    where: whereOf(run, raw, gpu),
    model: modelChoice(run, chosen),
    preset: preset ? { id: preset.id, name: preset.name, type: preset.type } : run.presetId ? { id: run.presetId, name: run.presetName ?? run.presetId, type: "unknown" } : null,
    studio: studio ? { title: studio.title, feature: studio.feature } : null,
    prompt: asked.prompt ?? run.prompt ?? null,
    negativePrompt: asked.negativePrompt ?? null,
    asked: !!req.asked,
    settings: withMade(
      compareSettings(req, { model: getModel(run.modelId), preset, route }).map((s) => ({
        ...s,
        ...(s.value !== undefined && { value: SECRET_KEY.test(s.key.split(".").pop() ?? "") ? "••••" : redactValue(s.value, { url: gpu.url }) }),
      })),
      madeBy.changes,
    ),
    inputs: inputsOf(asked),
    batch,
    near,
    sent: redactValue(parse(raw.provider_input_json), { url: gpu.url }),
    timing: timingOf(run, tasks, log),
    jobs,
    workerLog: log,
    money: moneyOf(run, stamp),
    madeBy,
    surface: surfaceOf(run.feature, stamp),
    providerId: raw.external_id ? redactText(raw.external_id, { url: gpu.url }) : null,
    progress: progressOf(run, tasks),
    checks: checksOf(id),
  };
}

/**
 * Each setting the model makes differently gets what it is made at, beside what was asked (the account sees the made
 * value only; the owner sees both). A change for a setting the request left out gets a row of its own.
 */
export function withMade(rows: SettingRow[], changes: SettingChange[]): SettingRow[] {
  const out = rows.map((r) => ({ ...r }));
  for (const c of changes) {
    const key = `params.${c.setting}`;
    const made = { value: c.made, asked: c.asked, reason: c.reason };
    const row = out.find((r) => r.key === key);
    if (row) row.made = made;
    else out.push({ key, label: c.label, hasDefault: false, state: "unknown", sent: false, made });
  }
  return out;
}

