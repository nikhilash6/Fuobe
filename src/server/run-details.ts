import "server-only";
import fs from "node:fs";
import { getModel, getPreset } from "@/lib/catalog";
import { presetRoutes } from "@/lib/catalog/preset-recipe-routes";
import type { Engine, GenerationRequest, MediaKind } from "@/lib/catalog/types";
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
  model: { id: string; name: string; state: "default" | "changed" | "unknown"; default?: string; defaultName?: string };
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
}

interface RawRow {
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
function modelChoice(run: AccountRun): RunDetails["model"] {
  const name = run.modelName ?? run.modelId;
  const preset = run.presetId ? getPreset(run.presetId) : undefined;
  const has = (id: string) => !!getModel(id);
  if (preset) {
    const first = presetRoutes(preset, run.engine, has)[0]?.modelId;
    if (!first) return { id: run.modelId, name, state: "unknown" };
    const others = new Set(presetRoutes(preset, run.engine, has).map((r) => r.modelId));
    return {
      id: run.modelId,
      name,
      // An app's other routes are its own models too (the composer offers only those).
      state: first === run.modelId || (preset.type === "app" && others.has(run.modelId)) ? "default" : "changed",
      default: first,
      defaultName: getModel(first)?.name ?? first,
    };
  }
  const studio = studioOf(run.feature);
  if (!studio) return { id: run.modelId, name, state: "unknown" };
  const d = studio.defaultModels[run.engine];
  const stand = viewerDefaults(studio.defaultModels, studio.uncaptioned, false)[run.engine];
  return { id: run.modelId, name, state: run.modelId === d || run.modelId === stand ? "default" : "changed", default: stand, defaultName: getModel(stand)?.name ?? stand };
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

/** The owner's view of one account's run, or null: no such run, or it is the owner's own (the Library has those). */
export function runDetails(id: string, o: { emails?: boolean } = {}): RunDetails | null {
  const run = accountRunById(id, o.emails ?? true);
  if (!run) return null;
  const account = run.account.id;
  const raw = db().prepare("SELECT message, error, external_id, external_meta_json, provider_input_json, fix_json FROM generations WHERE id = ?").get(id) as RawRow | undefined;
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
    model: modelChoice(run),
    preset: preset ? { id: preset.id, name: preset.name, type: preset.type } : run.presetId ? { id: run.presetId, name: run.presetName ?? run.presetId, type: "unknown" } : null,
    studio: studio ? { title: studio.title, feature: studio.feature } : null,
    prompt: asked.prompt ?? run.prompt ?? null,
    negativePrompt: asked.negativePrompt ?? null,
    asked: !!req.asked,
    settings: compareSettings(req, { model: getModel(run.modelId), preset, route }).map((s) => ({
      ...s,
      ...(s.value !== undefined && { value: SECRET_KEY.test(s.key.split(".").pop() ?? "") ? "••••" : redactValue(s.value, { url: gpu.url }) }),
    })),
    inputs: inputsOf(asked),
    batch,
    near,
    sent: redactValue(parse(raw.provider_input_json), { url: gpu.url }),
  };
}

