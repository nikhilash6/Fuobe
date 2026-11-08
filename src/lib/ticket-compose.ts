/**
 * Job tickets on both sides (src/lib/job-ticket.ts says what a ticket is): the studio makes one from the request its
 * composer used (ticketFor), and the worker composes the graph from it with the same composer and its own copy of the
 * catalog (composeTicket). Both check the ticket the same way before anything else.
 *
 * Pure: the server, the worker program (scripts/build-worker.mjs builds this file and everything it imports into the
 * worker) and the tests share it.
 */
import crypto from "node:crypto";
import { installedReuse, type ReuseModel } from "./av/clean-voice";
import { IDOL_PACK_CLASS } from "./av/model3d";
import { installedDbs, type DbsModel } from "./av/split";
import type { GenInput, Operation } from "./catalog/types";
import type { ComfyWorkflow } from "./comfy";
import { ComposeError, composeWorkflow, withoutSaveMetadata, type ComposeCatalog, type ComposedSize, type ComposeRequest } from "./comfy-compose";
import { ceilingProblem, FILE_SETTINGS, ticketProblem, TICKET_VERSION, type Ceiling, type JobTicket, type TicketFacts, type TicketInput, type TicketInputKind } from "./job-ticket";
import type { MediaInfo } from "./media-probe";

export type { ComposeRequest };

/** The kind of an input file, from its content type. */
export function inputKind(contentType: string, name = ""): TicketInputKind {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("model/") || /\.(glb|gltf|ply|spz|splat)$/i.test(name)) return "model3d";
  return "file";
}

const FACT_KEYS = ["container", "duration", "videoDuration", "width", "height", "fps", "frames", "hasVideo", "hasAudio", "channels"] as const;

/** An upload's header facts as a ticket carries them. */
export function ticketFacts(m: MediaInfo | undefined): TicketFacts | undefined {
  if (!m) return undefined;
  const out: Record<string, unknown> = {};
  for (const k of FACT_KEYS) {
    const v = (m as unknown as Record<string, unknown>)[k];
    if (typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) || (k === "container" && typeof v === "string")) out[k] = v;
  }
  return Object.keys(out).length ? (out as TicketFacts) : undefined;
}

/** Where each file of a request goes, as [slot, name]. */
function fileSlots(input: GenInput, sentExtra: string[]): [string, string][] {
  const out: [string, string][] = [];
  const one = (slot: string, v: unknown) => {
    if (typeof v === "string" && v) out.push([slot, v]);
  };
  const many = (slot: string, v: unknown) => (Array.isArray(v) ? v : []).forEach((x, i) => one(`${slot}.${i}`, x));
  many("images", input.images);
  one("endImage", input.endImage);
  one("mask", input.mask);
  one("video", input.video);
  many("videos", input.videos);
  one("audio", input.audio);
  one("audio2", (input as GenInput & { audio2?: unknown }).audio2);
  one("voiceAudio", input.voiceAudio);
  one("voiceAudio2", input.voiceAudio2);
  many("audios", input.audios);
  one("model3d", input.model3d);
  for (const k of sentExtra) one(`extra.${k}`, input.extra?.[k]);
  return out;
}

/**
 * The ticket for a request (the studio's side). `file` gives each staged input's SHA-256 and content type (null: not one
 * the run sent, which refuses the ticket); `facts` its header facts; `sent`: the params.extra keys whose files the run
 * sent. Settings are the request's, without its files (they go as inputs) and without a cloud voice's embedding.
 */
export function ticketFor(
  req: ComposeRequest,
  o: {
    catalogVersion: string;
    sent: string[];
    file: (name: string) => { sha256: string; contentType: string } | null;
    facts: (name: string) => MediaInfo | undefined;
    outputs: { count: number; kind: string };
    size: ComposedSize;
  },
): JobTicket {
  const inputs: TicketInput[] = [];
  const add = (slot: string, name: string) => {
    const f = o.file(name);
    if (!f) throw new Error(`${slot} isn't a file this run sent`);
    const facts = ticketFacts(o.facts(name));
    inputs.push({ slot, name, kind: inputKind(f.contentType, name), sha256: f.sha256, ...(facts && { facts }) });
  };
  for (const [slot, name] of fileSlots(req.input, o.sent)) add(slot, name);
  req.made.forEach((name, i) => add(`made.${i}`, name));
  const settings: Record<string, unknown> = { ...req.input };
  for (const k of [...FILE_SETTINGS, "voiceEmbedding"]) delete settings[k];
  if (req.input.extra) {
    const extra = { ...req.input.extra };
    for (const k of o.sent) delete extra[k];
    settings.extra = extra;
  }
  // A LoRA travels by its file name and how it's mixed (never an address to fetch it from).
  if (Array.isArray(req.input.loras)) settings.loras = req.input.loras.map((l) => ({ file: l.file, ...(l.strength !== undefined && { strength: l.strength }), ...(l.trigger && { trigger: l.trigger }), ...(l.target && { target: l.target }) }));
  for (const [k, v] of Object.entries(settings)) if (v === undefined) delete settings[k];
  return {
    v: TICKET_VERSION,
    workflowId: req.endpoint,
    catalogVersion: o.catalogVersion,
    op: req.op,
    settings,
    inputs,
    outputs: o.outputs,
    size: o.size,
    ...(req.loraSlot && { loraSlot: true }),
  };
}

/** What a worker's PC says of itself for the choices that depend on it (comfy-compose.ts ComposeContext). */
export interface WorkerFacts {
  device?: string;
  ramBytes?: number;
  vramBytes?: number;
  dbsModels?: DbsModel[];
  reuseModels?: ReuseModel[] | null;
  idolPack?: boolean;
}

/**
 * A worker's facts from its own ComfyUI's answers: GET /system_stats (`stats`), GET /models/dbs and /models/reuse (a
 * list of files; `null` for a folder its ComfyUI doesn't have, undefined when it couldn't say) and GET
 * /object_info/<the Idol pack's class> (`idol`). Anything it couldn't read stays unknown, and the composer then picks as the
 * studio would without the answer.
 */
export function workerFactsFrom(a: { stats?: unknown; dbs?: unknown; reuse?: unknown; idol?: unknown }): WorkerFacts {
  const out: WorkerFacts = {};
  const stats = (a.stats && typeof a.stats === "object" ? a.stats : {}) as { system?: { ram_total?: unknown }; devices?: { type?: unknown; vram_total?: unknown }[] };
  const dev = Array.isArray(stats.devices) ? stats.devices[0] : undefined;
  const pos = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
  if (typeof dev?.type === "string" && /^[a-z]{2,16}$/.test(dev.type)) out.device = dev.type;
  const vram = pos(dev?.vram_total);
  const ram = pos(stats.system?.ram_total);
  if (vram) out.vramBytes = vram;
  if (ram) out.ramBytes = ram;
  const names = (v: unknown) => (Array.isArray(v) ? v.filter((f): f is string => typeof f === "string") : undefined);
  const dbs = names(a.dbs);
  if (dbs) out.dbsModels = installedDbs(dbs);
  if (a.reuse === null) out.reuseModels = null;
  else if (names(a.reuse)) out.reuseModels = installedReuse(names(a.reuse));
  if (a.idol && typeof a.idol === "object" && !Array.isArray(a.idol)) out.idolPack = IDOL_PACK_CLASS in a.idol;
  return out;
}

export type TicketOutcome =
  | { ok: true; graph: ComfyWorkflow; workflowId: string; size: ComposedSize; made: { name: string; data: Buffer; contentType: string }[] }
  | { ok: false; reason: "update-worker" | "bad-ticket" | "outside-ceiling"; detail: string; graphChanged?: true };

/** A value in canonical form: object keys sorted, at every depth. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = canonical(x);
    }
    return out;
  }
  return v;
}

/**
 * A composed graph's fingerprint (a job ticket's `graphSha`): the SHA-256 of "fuobe-graph-1\n" and the canonical JSON of
 * { graph, made }. `graph`: each node's class and inputs (a node's `_meta`, its title only, is left out); keys sorted at
 * every depth. `made`: the SHA-256 of each file the composer makes, in order. Two composers that make the same graph and
 * the same files from a ticket give the same fingerprint, whatever else differs between their builds.
 */
export function graphFingerprint(graph: ComfyWorkflow, made: { data: Uint8Array }[] = []): string {
  const nodes: Record<string, unknown> = {};
  for (const [id, node] of Object.entries(graph)) {
    const { _meta: _title, ...rest } = node as unknown as Record<string, unknown>;
    void _title;
    nodes[id] = rest;
  }
  const body = JSON.stringify(canonical({ graph: nodes, made: made.map((m) => crypto.createHash("sha256").update(m.data).digest("hex")) }));
  return crypto.createHash("sha256").update(`fuobe-graph-1\n${body}`).digest("hex");
}

/**
 * The fingerprint the studio puts on a ticket (`graphSha`): the graph its own composer makes from the ticket with its own
 * catalog and no facts of any PC, as a worker checks it (composeTicket). Null when the ticket doesn't compose.
 */
export async function ticketGraphSha(job: { ticket: JobTicket; generationId: string; inputs: { name: string; sha256: string }[] }, env: { catalog: ComposeCatalog; catalogVersion: string }): Promise<string | null> {
  const { graphSha: _old, runLimitMs: _run, stallMs: _stall, ...ticket } = job.ticket;
  void _old;
  void _run;
  void _stall;
  const r = await composeOne({ ...job, ticket: { ...ticket, catalogVersion: env.catalogVersion } }, { catalog: env.catalog, catalogVersion: env.catalogVersion }, false).catch(() => null);
  return r?.ok ? graphFingerprint(r.graph, r.made) : null;
}

/** A run's id as the studio makes them. */
const GENERATION_ID = /^[\w-]{1,64}$/;

/** Does the catalog have this workflow, or the template's variants (video-concat-{n})? */
export const catalogKnows = (catalog: ComposeCatalog, id: string) => catalog.has(id) || (id.includes("{n}") && [1, 2, 3, 4].some((n) => catalog.has(id.replace("{n}", String(n)))));

/**
 * The worker's side: check the ticket (its catalog version, its settings, its inputs against the files the job sends,
 * the PC's ceiling), then compose the graph with the composer and the worker's own catalog and facts. The files the
 * composer makes itself (made.<i>) are made here again: their copies on the studio are never read.
 *
 * `remake`: the studio's side when it makes a waiting ticket again for its catalog after an update (ticket-refresh.ts):
 * the files the graph makes may come out other than the ticket's (the composer that makes them changed), so they are
 * given back as they came out, for the studio to stage in place of the old ones, never checked against them.
 */
export async function composeTicket(job: TicketJob, env: ComposeEnv): Promise<TicketOutcome> {
  const t = job.ticket as Partial<JobTicket> | null;
  const other = !env.remake && !!t && typeof t === "object" && t.catalogVersion !== env.catalogVersion && typeof t.graphSha === "string" && /^[0-9a-f]{64}$/.test(t.graphSha);
  if (!other) return composeOne(job, env, false);
  // A ticket made for another catalog: first the graph as the studio made it (no facts of this PC, no ceiling), checked
  // against its fingerprint. Anything but the same graph (another graph, a ticket this build can't read or compose) is
  // the catalog's change, never the ticket's fault: the job goes back in line for an updated worker.
  const changed = (detail: string): TicketOutcome => ({ ok: false, reason: "update-worker", detail, graphChanged: true });
  if (!GENERATION_ID.test(String(job.generationId))) return { ok: false, reason: "bad-ticket", detail: "not a run id" };
  const plain = await composeOne(job, { catalog: env.catalog, catalogVersion: env.catalogVersion }, true).catch(() => null);
  if (!plain?.ok) return changed("the ticket doesn't compose with this build");
  if (graphFingerprint(plain.graph, plain.made) !== t!.graphSha) return changed("the graph changed in the studio's catalog");
  // The same graph: the job runs here, composed as always with this PC's facts and inside its ceiling.
  const r = await composeOne(job, env, true);
  return r.ok || r.reason === "outside-ceiling" ? r : changed("the ticket doesn't compose with this build");
}

type TicketJob = { ticket: unknown; generationId: string; inputs: { name: string; sha256: string }[] };
type ComposeEnv = { catalog: ComposeCatalog; catalogVersion: string; ceiling?: Ceiling | null; laneOf?: (workflowId: string) => string | null; facts?: WorkerFacts; remake?: boolean };

async function composeOne(job: TicketJob, env: ComposeEnv, otherCatalog: boolean): Promise<TicketOutcome> {
  if (!GENERATION_ID.test(String(job.generationId))) return { ok: false, reason: "bad-ticket", detail: "not a run id" };
  const refused = ticketProblem(job.ticket, { catalogVersion: env.catalogVersion, known: (id) => catalogKnows(env.catalog, id), inputs: job.inputs, otherCatalog });
  if (refused) return { ok: false, ...refused };
  const t = job.ticket as JobTicket;
  const lane = (id: string) => env.laneOf?.(id) ?? null;
  // A workflow that picks its graph at run time (`video-concat-{n}`) has no lane or name in the ceiling until it is
  // composed: before, only its sizes are checked; after, the graph it came out as, as the studio checked it.
  const templated = t.workflowId.includes("{");
  const ceiling = templated && env.ceiling ? { ...env.ceiling, lanes: undefined, workflows: undefined } : env.ceiling;
  const before = ceilingProblem(ceiling, { workflowId: templated ? null : t.workflowId, lane: templated ? null : lane(t.workflowId), size: t.size });
  if (before) return { ok: false, reason: "outside-ceiling", detail: before };
  // The request, with each file in its slot.
  const input = { ...t.settings } as GenInput & Record<string, unknown>;
  const extra: Record<string, unknown> = { ...((t.settings.extra as Record<string, unknown> | undefined) ?? {}) };
  const facts = new Map<string, TicketFacts | undefined>();
  const made: TicketInput[] = [];
  const sent: string[] = [];
  for (const i of t.inputs) {
    facts.set(i.name, i.facts);
    const [slot, at] = i.slot.split(/\.(.*)/s);
    if (slot === "made") made[Number(at)] = i;
    else if (slot === "extra") {
      extra[at] = i.name;
      sent.push(at);
    } else if (at !== undefined) ((input[slot] as string[] | undefined) ?? (input[slot] = []) as string[])[Number(at)] = i.name;
    else input[slot] = i.name;
  }
  if (t.settings.extra !== undefined || sent.length) input.extra = extra;
  const madeHere: { name: string; data: Buffer; contentType: string }[] = [];
  const f = env.facts ?? {};
  try {
    const out = await composeWorkflow(t.workflowId, input, {
      generationId: job.generationId,
      op: t.op as Operation,
      catalog: env.catalog,
      loraSlot: t.loraSlot === true,
      sent,
      accountOnInstall: true,
      made: async (data, contentType) => {
        const slot = made[madeHere.length];
        if (!slot && !env.remake) throw new ComposeError("The ticket has no place for a file the graph makes");
        const name = slot?.name ?? `made-${madeHere.length}`;
        madeHere.push({ name, data: Buffer.from(data), contentType });
        return name;
      },
      media: (name) => {
        const m = facts.get(name);
        return m ? ({ hasVideo: false, hasAudio: false, ...m } as MediaInfo) : undefined;
      },
      serverRam: async () => f.ramBytes,
      vram: async () => f.vramBytes,
      device: async () => f.device,
      dbsModels: async () => f.dbsModels,
      reuseModels: async () => f.reuseModels,
      idolPack: async () => f.idolPack,
    });
    if (!env.remake && madeHere.length !== made.length) return { ok: false, reason: "bad-ticket", detail: "the ticket names files the graph doesn't make" };
    // A file made here is the studio's to the byte, or the ticket wasn't made for this graph.
    for (const [i, m] of madeHere.entries()) {
      if (!env.remake && crypto.createHash("sha256").update(m.data).digest("hex") !== made[i].sha256) return { ok: false, reason: "bad-ticket", detail: "a file the graph makes isn't the ticket's" };
    }
    const after = ceilingProblem(env.ceiling, { workflowId: out.manifest.id, lane: lane(out.manifest.id), size: out.size });
    if (after) return { ok: false, reason: "outside-ceiling", detail: after };
    return { ok: true, graph: withoutSaveMetadata(out.workflow), workflowId: out.manifest.id, size: out.size, made: madeHere };
  } catch (e) {
    return { ok: false, reason: "bad-ticket", detail: (e as Error).message?.slice(0, 200) || "the graph couldn't be made" };
  }
}
