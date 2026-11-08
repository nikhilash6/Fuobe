/**
 * The Fuobe tab's side of "Use the ComfyUI on this computer" (DESIGN.md): it beats to the server, takes the person's
 * jobs one at a time, sends each one's inputs and exact graph to the ComfyUI on 127.0.0.1, follows it (the live socket
 * for steps and previews, the job and history reads for where it is), reports back, and uploads the results the server
 * asks for. It decides nothing about the result. Every address it uses on the person's computer comes from
 * lib/local-comfy.ts, which allows only what a run needs, and it refuses a graph that would read files the run didn't
 * send. No React and no browser-only API is needed: the page (src/components/gpu/computer-runner.tsx) gives it fetch,
 * a socket and a clock, and the tests drive it from Node against a stand-in ComfyUI.
 */
import { isGuard } from "./comfy-guard";
import { entryReason, refusalReason } from "./comfy-reason";
import { withoutLocalPaths } from "./engine-error";
import { FINISH_RUN_MS, finishProblem, type FinishResult, type FinishStats } from "./finish-ticket";
import { fetchWithin } from "./fetch-within";
import { parseComfyBinary, parseComfyText } from "./comfy-ws";
import { NodeClock } from "./node-times";
import { graphProblem, localBase, mayDownload, readPath, statsFacts, viewPath, writePath, type SystemStats } from "./local-comfy";
import {
  DONE_SHOWN_MS,
  META_BATCH_HISTORY,
  PREVIEW_LIMITS,
  RELAY_LIMITS,
  RELAY_TIMES,
  type BeatAnswer,
  type ClaimedTask,
  type ComputerFacts,
  type GiveBackWhy,
  type HistoryEntryLike,
  type RelayState,
  type ReportEvent,
  type TabFailure,
  type TaskInput,
  type WantedFile,
} from "./relay";

/** A file's bytes as an ArrayBuffer of exactly its length. */
const toArrayBuffer = (d: ArrayBuffer | Uint8Array): ArrayBuffer => (d instanceof Uint8Array ? (d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer) : d);

/** The parts of a WebSocket the runner uses (the browser's, or Node's). */
export interface SocketLike {
  binaryType: string;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e?: unknown) => void) | null;
  onerror: ((e?: unknown) => void) | null;
  onopen: ((e?: unknown) => void) | null;
  close(): void;
}

export interface RunnerDeps {
  /** Fuobe's own API on this site (the session cookie goes with it). */
  api: (path: string, init?: RequestInit) => Promise<Response>;
  /** The ComfyUI on this computer: no headers of Fuobe's own, no cookies. */
  local: (url: string, init?: RequestInit) => Promise<Response>;
  /** A socket to the ComfyUI on this computer (null: none, progress comes from reading the job). */
  socket?: (url: string) => SocketLike | null;
  sha256: (data: ArrayBuffer) => Promise<string>;
  /** This site's address, as ComfyUI's setting must name it. */
  origin: string;
  /**
   * ComfyUI stopped answering where the runner looks: is it on another port now? (The page looks on ComfyUI's usual
   * ports, only when the browser already lets Fuobe reach this computer.) The port and host, or null.
   */
  find?: (except: number) => Promise<{ port: number; host?: string } | null>;
  /** The runner moved to another port (the page remembers it). */
  moved?: (port: number, host: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * A worker program's own checks (docs/gpu-workers.md) before a graph goes to its ComfyUI: its node allowlist, path
   * strings, verified models, and its own self-checks. The failure, a give-back (the job goes back in line: the worker
   * can't run it now), or null. (A browser tab has none: graphProblem is its check.)
   */
  vet?: (t: ClaimedTask) => VetAnswer | Promise<VetAnswer>;
  /**
   * A job ended here, done or not: a worker deletes its files. `why`: a failed job's reason in one short line (ComfyUI's
   * own, src/lib/comfy-reason.ts, or why it stopped here), for the worker's log.
   */
  ended?: (t: ClaimedTask, phase: LocalJob["phase"], why?: string) => void | Promise<void>;
  /**
   * A worker program's composer (src/lib/ticket-compose.ts): the graph of a job ticket (src/lib/job-ticket.ts), built
   * from its own copy of the catalog, with the small files the graph makes itself; or why it refuses the ticket. A
   * browser tab has none: it never gets a ticket.
   */
  compose?: (t: ClaimedTask) => Promise<ComposedJob | { refused: TicketRefused }>;
  /** More facts to send with its ComfyUI's (a worker's GPU generation). */
  factsExtra?: () => Partial<ComputerFacts>;
  /** More to say in each beat (a worker's pause, its GPU, its inventory), and what the studio answered. */
  beatExtra?: () => Record<string, unknown>;
  onBeat?: (a: BeatAnswer) => void;
  /** What only a worker program does (docs/gpu-workers.md). A browser tab has none of it. */
  worker?: WorkerHooks;
  /**
   * A worker's CPU slot runs finishing jobs (src/lib/finish-ticket.ts) with its own code: the inputs by slot in, the
   * files it made by role out (with what it measured), or why it refuses the job. A runner without it gives a finishing
   * job back. A browser tab never gets one.
   */
  finish?: (t: ClaimedTask, inputs: Record<string, ArrayBuffer>, o: { signal: AbortSignal; progress: (fraction: number) => void }) => Promise<FinishMade | { refused: "unsafe-model" | "finish-failed" }>;
}

/** The files a finishing job made, by role, and what it measured. */
export interface FinishMade {
  files: { role: string; name: string; data: ArrayBuffer | Uint8Array; contentType: string }[];
  stats?: FinishStats;
  turntable?: string;
}

/**
 * A worker's live preview for a progress report: the latest preview of its job as base64, when it is a JPEG of at most
 * PREVIEW_LIMITS.maxBytes and the last one went at least PREVIEW_LIMITS.everyMs ago (else undefined: none is sent).
 */
export async function previewForReport(preview: Blob | undefined, lastSentAt: number, now: number, shrink?: (b: Blob) => Promise<Blob | null>): Promise<string | undefined> {
  if (!preview || preview.size === 0 || now - lastSentAt < PREVIEW_LIMITS.everyMs) return undefined;
  const isJpeg = async (b: Blob) => {
    if (b.size === 0 || b.size > PREVIEW_LIMITS.maxBytes || (b.type && b.type !== "image/jpeg")) return null;
    const bytes = new Uint8Array(await b.arrayBuffer());
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? bytes : null;
  };
  // A PNG or a big JPEG is made again as a small JPEG first, when the worker can.
  let bytes = await isJpeg(preview);
  if (!bytes && shrink) {
    const small = await shrink(preview).catch(() => null);
    bytes = small ? await isJpeg(small) : null;
  }
  if (!bytes) return undefined;
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A worker's own checks of a job: why it fails it, why it gives it back, or null when it may run. */
export type VetAnswer = TabFailure | { giveBack: GiveBackWhy } | null;

/** Why a worker refuses a job ticket: another catalog, more than its PC allows, or a ticket it can't use (or a graph where a ticket belongs). */
export type TicketRefused = "update-worker" | "outside-ceiling" | "bad-ticket";

/** A job ticket composed on the worker: its graph, and the files the graph makes itself (sent to its ComfyUI with the inputs). */
export interface ComposedJob {
  graph: NonNullable<ClaimedTask["graph"]>;
  made: { name: string; data: ArrayBuffer | Uint8Array; contentType: string }[];
}

/** A finished job's results as a worker keeps them on its own disk: its entries (one, or a meta-batch's passes). */
export interface HeldResults {
  kind: "finished" | "passes";
  entries: HistoryEntryLike[];
  /** Its ComfyUI's execution time for the job (ms), when known. */
  execMs?: number;
}

/** A file a job's entries name in ComfyUI's output or temp folder. */
export type ResultFile = Pick<WantedFile, "filename" | "subfolder" | "type">;

/**
 * A worker program's part in a job (docs/gpu-workers.md): it keeps finished results until the studio has them, keeps
 * inputs by their SHA-256 and makes clips and sound again before its ComfyUI reads them, gives back a job that stalls
 * or runs past its run limit, retries once after running out of memory, and fails a job its ComfyUI stopped on twice.
 */
export interface WorkerHooks {
  hold: {
    /** Keep every file the entries name (`read` fetches one from its ComfyUI), before the studio hears of them. */
    keep(t: ClaimedTask, held: HeldResults, read: (f: ResultFile) => Promise<Response | null>): Promise<void>;
    /** The results kept for this task's prompt, or null. */
    get(t: ClaimedTask): Promise<HeldResults | null>;
    /** One kept file, or null. */
    file(t: ClaimedTask, w: ResultFile): Promise<Blob | null>;
    has(taskId: string): boolean;
    /** Let go of one task's kept results. */
    drop(taskId: string): void;
  };
  /**
   * An input as its ComfyUI gets it. `read` fetches it from the studio (or says why it couldn't); the worker may keep a
   * copy by its SHA-256, so a job sent again reads nothing twice. A clip or a sound is made again first, or, when the
   * worker can't, the job goes back to the line ("give-back").
   */
  input(t: ClaimedTask, i: TaskInput, read: () => Promise<ArrayBuffer | TabFailure>): Promise<ArrayBuffer | TabFailure | "give-back">;
  /**
   * A job with no progress for this long (ms) goes back to the line: the claim's `stallMs` (the studio's limit), else
   * this. `stallLocalMs`, when the PC sets one, wins over both.
   */
  stallMs: number;
  stallLocalMs?: number | null;
  /** Free its ComfyUI's memory (before the one retry after it ran out). */
  free(): Promise<void>;
  /**
   * It takes full graphs from the studio for the owner's own jobs (false: job tickets only). A graph for anyone else's
   * job is refused whatever this says: an account's run comes as a ticket.
   */
  graphs?: boolean;
  /**
   * The studio is older than job tickets (its last beat answer named no catalog version): its claims name no class, and
   * every graph it sends is the owner's own job (it sends no account's run to the workers).
   */
  olderStudio?(): boolean;
  /** Is a graph job (the owner's own) inside its PC's ceiling, by its lane or workflow? A ticket's are the composer's to check. */
  inside?(t: ClaimedTask): boolean;
  /** How many times its ComfyUI stopped while it ran this task. */
  crashes(t: ClaimedTask): number;
  /** Its ComfyUI won't let go of a prompt: stop it (the worker starts it again). */
  stuck(): Promise<void>;
  /**
   * What a claim answered, before the job runs: a task, or null (none was this worker's or waiting for it).
   * `onlyHeld`: the claim was made only to send kept results (the worker may not take other work now).
   */
  claimed(t: ClaimedTask | null, o: { onlyHeld: boolean }): void | Promise<void>;
  /**
   * A live preview its ComfyUI made that isn't a JPEG small enough to send (a PNG, or a big JPEG): made again as a small
   * JPEG (at most 512 pixels on its long side), or null when it can't. Without it, only a small JPEG is sent.
   */
  shrinkPreview?(preview: Blob): Promise<Blob | null>;
}

/** ComfyUI's words for running out of memory (lib/gpu/fix-codes.ts says the same). */
const OUT_OF_MEMORY = /out of memory|OutOfMemoryError|allocation on device/i;

/** The prompt ran out of memory (its entry's execution error says so). */
export function outOfMemory(e: HistoryEntryLike): boolean {
  if (e.status?.status_str !== "error") return false;
  return (e.status.messages ?? []).some(([name, d]) => name === "execution_error" && OUT_OF_MEMORY.test(`${d?.exception_type ?? ""} ${d?.exception_message ?? ""}`));
}

/** How long ComfyUI spent executing these entries (ms), from its own timestamps; null when they don't say. */
export function execTime(entries: HistoryEntryLike[]): number | null {
  let total = 0;
  let known = false;
  for (const e of entries) {
    const messages = e?.status?.messages ?? [];
    const at = (names: string[]) => messages.find(([n]) => names.includes(n))?.[1]?.timestamp;
    const start = at(["execution_start"]);
    const end = at(["execution_success", "execution_error", "execution_interrupted"]);
    if (typeof start === "number" && typeof end === "number" && end >= start) {
      total += end - start;
      known = true;
    }
  }
  return known ? total : null;
}

/** A GPU's name as ComfyUI gives it ("cuda:0 <name> : cudaMallocAsync"), without the device number or the allocator. */
export const deviceName = (raw: string | undefined): string | undefined =>
  raw
    ?.replace(/^\s*cuda:\d+\s*/i, "")
    .replace(/\s*:\s*[A-Za-z]+\s*$/, "")
    .trim()
    .slice(0, 120) || undefined;

/** What the page shows about one job this tab runs. */
export interface LocalJob {
  taskId: string;
  generationId: string;
  phase: "sending" | "queued" | "running" | "saving" | "done" | "failed";
  value?: number;
  max?: number;
  position?: number;
  /** The latest live preview (an image the page shows under the tile's shimmer). */
  preview?: Blob;
  saved?: number;
  /** Saving waits for the studio (it is busy saving other results). */
  waiting?: boolean;
  /** When it was saved, or failed (this tab's clock). */
  endedAt?: number;
}

export interface RunnerView {
  /** This computer runs the waiting jobs. */
  runner: boolean;
  /** Another computer does. */
  heldElsewhere: boolean;
  waiting: number;
  /** ComfyUI here: answering, not answering, or answering without Fuobe's setting. */
  comfy: "ok" | "down" | "no-setting";
  /**
   * This browser may not reach apps on this computer yet: it would ask first ("ask"), or it was told no ("blocked").
   * Then the runner only listens (how many wait) and never touches ComfyUI.
   */
  access?: "ask" | "blocked";
  /** Where it looks for ComfyUI. */
  port: number;
  /** The session ended, or the person disconnected: the runner stopped. */
  stopped?: "signed-out" | "disconnected";
  jobs: LocalJob[];
  facts?: ComputerFacts;
}

/** The job stops here. `gone`: the studio no longer has it for this principal (404), so nothing of it is worth keeping. */
class Stopped extends Error {
  constructor(readonly gone = false) {
    super(gone ? "The studio no longer has this job" : "Stopped");
  }
}

/**
 * The shortest run limit a worker obeys: a claim's runLimitMs below this (an older studio's 5-minute floor for a lane
 * it has no times for) is ignored, and the stall rule and the studio's own clocks still apply.
 */
export const MIN_RUN_LIMIT_MS = 10 * 60_000;
/** The shortest stall limit a worker takes from a claim (a shorter one would give back jobs between two looks). */
export const MIN_STALL_MS = 60_000;

const PROGRESS_EVERY_MS = 500;
/** A finishing job tells the studio it still runs at least this often (and hears a stop in the answer). */
const FINISH_BEAT_MS = 10_000;
const POLL_MS = 1000;
/** How often a ComfyUI that stopped answering is looked for on the other ports. */
const FIND_EVERY_MS = 20_000;
/** Ended jobs the view keeps (a tile shows the last preview until its run moves on). */
const KEEP_ENDED = 6;
/**
 * How long a look at ComfyUI here (its facts, a job's state) and a beat to the studio wait for an answer. A ComfyUI busy
 * at full load, or a studio that is restarting, can take a request and not answer: the beat then counts it as not
 * answering and the next one tries again, instead of waiting for good and never beating again.
 */
const LOOK_MS = 15_000;
const BEAT_MS = 20_000;
/** How long a result may wait for a busy studio before the run gives up. */
const SAVE_WAIT_MS = 60 * 60_000;

/** Retry-After in ms (1 to 30 s; 2 s when it doesn't say). */
const retryAfter = (res: Response) => Math.min(30, Math.max(1, Number(res.headers.get("retry-after")) || 2)) * 1000;

/** The prompts of a meta-batch job: their entries name the job's filename prefix. */
const hasPrefix = (prompt: unknown, prefix: string) =>
  !!prompt && typeof prompt === "object" && Object.values(prompt as Record<string, { inputs?: Record<string, unknown> }>).some((n) => n?.inputs?.filename_prefix === prefix);

/** Every string inside a value with its absolute paths as base names (engine-error.ts). */
function pathsOut<T>(v: T, depth = 0): T {
  if (typeof v === "string") return withoutLocalPaths(v) as T;
  if (!v || typeof v !== "object" || depth > 24) return v;
  if (Array.isArray(v)) return v.map((x) => pathsOut(x, depth + 1)) as T;
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, pathsOut(x, depth + 1)])) as T;
}

/**
 * A worker's report as it leaves the worker: ComfyUI's words (each entry's status messages, a refusal's answer) never
 * name a folder of the worker's PC (its work folder, its ComfyUI, its models): each path goes as its file's name only.
 * Results (outputs) and progress go as they are.
 */
export function withoutWorkerPaths(e: ReportEvent): ReportEvent {
  const entry = (x: HistoryEntryLike): HistoryEntryLike => (x.status ? { ...x, status: pathsOut(x.status) } : x);
  if (e.event === "finished") return { ...e, entry: entry(e.entry) };
  if (e.event === "passes") return { ...e, entries: e.entries.map(entry) };
  if (e.event === "refused") return { ...e, body: pathsOut(e.body) };
  return e;
}

/** A history entry as the server needs it: status and outputs (not the whole graph again). */
const slim = (e: HistoryEntryLike & { prompt?: unknown[] }): HistoryEntryLike => ({ prompt: e.prompt ? [e.prompt[0], e.prompt[1]] : undefined, status: e.status, outputs: e.outputs });

export class ComputerRunner {
  readonly view: RunnerView;
  private listeners = new Set<(v: RunnerView) => void>();
  private busy = false;
  private stopping = new Set<string>();
  private ws: SocketLike | null = null;
  private wsOpen = false;
  private events = new Map<string, { value?: number; max?: number; node?: string; nodesDone: number; done?: boolean }>();
  /** Each prompt's node times from the socket (a worker sends them with its "finished" report); the latest few. */
  private clocks = new Map<string, NodeClock>();
  private factsSentAt = 0;
  private factsWithLoras = 0;
  private foundAt = 0;
  private guard: boolean | undefined;
  private jobsApi: boolean | undefined;
  private alive = true;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private base: string;

  constructor(
    private deps: RunnerDeps,
    private o: { device: string; port: number; host?: string; clientId: string; access?: "ask" | "blocked"; slot?: "cpu" },
  ) {
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.base = localBase(o.port, o.host);
    this.view = { runner: false, heldElsewhere: false, waiting: 0, comfy: "ok", port: o.port, ...(o.access && { access: o.access }), jobs: [] };
  }

  onChange(fn: (v: RunnerView) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.view);
  }

  private job(t: Pick<ClaimedTask, "id" | "generationId">, patch: Partial<LocalJob>) {
    const at = this.view.jobs.findIndex((j) => j.taskId === t.id);
    const was: LocalJob = at >= 0 ? this.view.jobs[at] : { taskId: t.id, generationId: t.generationId, phase: "sending" };
    const ends = (patch.phase === "done" || patch.phase === "failed") && patch.phase !== was.phase;
    const next = { ...was, ...patch, ...(ends && { endedAt: this.now() }) };
    let jobs = at >= 0 ? this.view.jobs.map((j, i) => (i === at ? next : j)) : [...this.view.jobs, next];
    // Ended jobs stay a while (their tile keeps the last preview until the run moves on), the newest few.
    const ended = jobs.filter((j) => j.phase === "done" || j.phase === "failed");
    if (ended.length > KEEP_ENDED) {
      const drop = new Set(ended.slice(0, ended.length - KEEP_ENDED));
      jobs = jobs.filter((j) => !drop.has(j));
    }
    this.view.jobs = jobs;
    this.emit();
  }

  /** Stop for good (the page closes, the person disconnects, the session ended). */
  stop(reason?: RunnerView["stopped"]) {
    this.alive = false;
    if (reason) this.view.stopped = reason;
    try {
      this.ws?.close();
    } catch {}
    this.emit();
  }

  // -------------------------------------------------------------------------
  // The ComfyUI here

  private async read<T>(path: string): Promise<T> {
    const res = await fetchWithin(`${this.base}${readPath(path)}`, LOOK_MS, { credentials: "omit", cache: "no-store" }, this.deps.local);
    if (!res.ok) throw Object.assign(new Error(`ComfyUI ${path.split("?")[0]} answered HTTP ${res.status}`), { status: res.status });
    return (await res.json()) as T;
  }

  private async send(path: string, check: unknown, own: { promptIds: string[]; names?: string[] }, init: RequestInit): Promise<Response> {
    return this.deps.local(`${this.base}${writePath(path, check, own)}`, { ...init, method: "POST", credentials: "omit", cache: "no-store" });
  }

  /**
   * ComfyUI here, as every caller sees it: readable (its facts), answering but not to this site (it runs without Fuobe's
   * setting: a no-cors look sees that something answers), or not answering. One look, so the page never hears two
   * stories. Not answering where it was, it is looked for on the other ports now and then (the page's `find`).
   */
  private async look(): Promise<{ comfy: "ok"; stats: SystemStats } | { comfy: "down" | "no-setting" }> {
    let l: { comfy: "ok"; stats: SystemStats } | { comfy: "down" | "no-setting" };
    try {
      l = { comfy: "ok", stats: await this.read<SystemStats>("/system_stats") };
    } catch (e) {
      const answers = (e as { status?: number }).status === 403 || (await fetchWithin(`${this.base}/system_stats`, LOOK_MS, { mode: "no-cors", credentials: "omit", cache: "no-store" }, this.deps.local).then(() => true, () => false));
      l = { comfy: answers ? "no-setting" : "down" };
      if (!answers && (await this.findElsewhere())) return this.look();
    }
    if (this.view.comfy !== l.comfy) {
      this.view.comfy = l.comfy;
      this.emit();
    }
    return l;
  }

  /** ComfyUI isn't where the runner looks: when it answers on another port, the runner goes there. True when it moved. */
  private async findElsewhere(): Promise<boolean> {
    if (!this.deps.find || this.now() - this.foundAt < FIND_EVERY_MS) return false;
    this.foundAt = this.now();
    const there = await this.deps.find(this.o.port).catch(() => null);
    if (!there || there.port === this.o.port) return false;
    const host = there.host ?? "127.0.0.1";
    this.base = localBase(there.port, host);
    Object.assign(this.o, { port: there.port, host });
    this.view.port = there.port;
    this.guard = undefined;
    this.jobsApi = undefined;
    // The live socket was to the old port.
    try {
      this.ws?.close();
    } catch {}
    this.deps.moved?.(there.port, host);
    this.emit();
    return true;
  }

  /** What ComfyUI here is, for the server (its GPU, memory, version, Fuobe's guard; its LoRA names now and then). */
  async facts(o: { loras?: boolean; guard?: boolean } = {}): Promise<ComputerFacts | null> {
    const l = await this.look();
    if (l.comfy !== "ok") return null;
    if (o.guard || this.guard === undefined) this.guard = await this.read<unknown>("/fuobe/guard").then(isGuard, () => false);
    const f: ComputerFacts = { ...statsFacts(l.stats, this.deps.origin, this.guard), ...this.deps.factsExtra?.() };
    if (o.loras) {
      const loras = await this.read<unknown>("/models/loras").catch(() => null);
      if (Array.isArray(loras)) f.loras = loras.filter((x): x is string => typeof x === "string");
    }
    this.view.facts = f;
    return f;
  }

  private socket() {
    if (this.wsOpen || this.ws || !this.deps.socket) return;
    let ws: SocketLike | null;
    try {
      ws = this.deps.socket(`${this.base.replace(/^http/, "ws")}${readPath(`/ws?clientId=${this.o.clientId}`)}`);
    } catch {
      ws = null;
    }
    if (!ws) return;
    this.ws = ws;
    ws.binaryType = "arraybuffer";
    ws.onopen = () => (this.wsOpen = true);
    ws.onclose = ws.onerror = () => {
      this.wsOpen = false;
      if (this.ws === ws) this.ws = null;
    };
    ws.onmessage = (m) => {
      if (typeof m.data === "string") {
        const e = parseComfyText(m.data);
        if (!e || !("promptId" in e) || !e.promptId) return;
        const cur = this.events.get(e.promptId) ?? { nodesDone: 0 };
        if (e.type === "progress") Object.assign(cur, { value: e.value, max: e.max, node: e.node });
        else if (e.type === "executing" && e.node) Object.assign(cur, { node: e.node, nodesDone: cur.nodesDone + 1, value: undefined, max: undefined });
        else if (e.type === "success" || e.type === "error" || e.type === "interrupted" || (e.type === "executing" && !e.node)) cur.done = true;
        this.events.set(e.promptId, cur);
        this.clockEvent(e);
        return;
      }
      const p = parseComfyBinary(m.data as ArrayBuffer);
      if (!p) return;
      // A preview goes only to the prompt's own client: this tab's job (a newer ComfyUI also names the prompt).
      const job = this.view.jobs.find((j) => j.phase === "running" && (!p.promptId || this.events.has(p.promptId)));
      if (!job) return;
      this.job({ id: job.taskId, generationId: job.generationId }, { preview: new Blob([p.data as BlobPart], { type: p.type }) });
    };
  }

  /** A socket event on its prompt's node clock (the newest 32 prompts keep theirs). */
  private clockEvent(e: ReturnType<typeof parseComfyText>) {
    if (!e || !("promptId" in e) || !e.promptId) return;
    const now = this.now();
    let clock = this.clocks.get(e.promptId);
    if (!clock) {
      if (e.type !== "execution_start" && e.type !== "executing") return;
      clock = new NodeClock();
      this.clocks.set(e.promptId, clock);
      while (this.clocks.size > 32) this.clocks.delete(this.clocks.keys().next().value!);
    }
    if (e.type === "executing") clock.executing(e.node, now);
    else if (e.type === "progress") clock.progress(e.node, e.max, now);
    else if (e.type === "success" || e.type === "error" || e.type === "interrupted") clock.end(now);
  }

  /** The slowest nodes of a prompt as its socket timed them (a worker's "finished" report carries them), then forgotten. */
  private nodeTimes(promptId: string, entry: HistoryEntryLike) {
    const clock = this.clocks.get(promptId);
    this.clocks.delete(promptId);
    const nodes = clock?.times(entry.prompt?.[2]);
    return nodes?.length ? { nodes } : {};
  }

  /** Where a prompt is on ComfyUI here. */
  private async where(promptId: string, prefix?: string): Promise<{ s: "pending"; ahead: number } | { s: "running" } | { s: "done"; entry: HistoryEntryLike } | { s: "absent" }> {
    if (this.jobsApi === undefined) this.jobsApi = await this.read("/api/jobs").then(() => true, () => false);
    const history = async () => (await this.read<Record<string, HistoryEntryLike>>(`/history/${promptId}`))[promptId];
    if (this.jobsApi) {
      const res = await fetchWithin(`${this.base}${readPath(`/api/jobs/${promptId}`)}`, LOOK_MS, { credentials: "omit", cache: "no-store" }, this.deps.local);
      if (res.status === 404) return prefix ? this.whereByQueue(promptId) : { s: "absent" };
      if (!res.ok) throw Object.assign(new Error(`ComfyUI answered HTTP ${res.status}`), { status: res.status });
      const j = (await res.json()) as { status?: string };
      if (j.status === "in_progress") return { s: "running" };
      if (j.status === "pending") return this.whereByQueue(promptId);
      const entry = await history();
      return entry ? { s: "done", entry } : { s: "absent" };
    }
    const entry = await history();
    if (entry && (entry.status?.completed || entry.status?.status_str)) return { s: "done", entry };
    return this.whereByQueue(promptId);
  }

  private async whereByQueue(promptId: string): Promise<{ s: "pending"; ahead: number } | { s: "running" } | { s: "done"; entry: HistoryEntryLike } | { s: "absent" }> {
    const q = await this.read<{ queue_running?: unknown[][]; queue_pending?: unknown[][] }>("/queue");
    if ((q.queue_running ?? []).some((r) => r[1] === promptId)) return { s: "running" };
    const pending = [...(q.queue_pending ?? [])].sort((a, b) => Number(a[0]) - Number(b[0]));
    const at = pending.findIndex((r) => r[1] === promptId);
    if (at >= 0) return { s: "pending", ahead: at + (q.queue_running?.length ?? 0) };
    // It may have finished between the two reads.
    const entry = (await this.read<Record<string, HistoryEntryLike>>(`/history/${promptId}`))[promptId];
    return entry ? { s: "done", entry } : { s: "absent" };
  }

  // -------------------------------------------------------------------------
  // The server

  /** A report about a job (its token in a header, so the studio checks it before it reads the report). */
  private async report(t: ClaimedTask, e: ReportEvent): Promise<{ wanted?: WantedFile[]; follow?: string; stop?: boolean; state?: RelayState }> {
    // A worker program never sends its own folders (a browser tab is the person's own computer: its words stay its own).
    if (this.deps.worker) e = withoutWorkerPaths(e);
    this.noteWhy(t, e);
    // A busy studio (429) is waited out, for a while; other failures are tried a few times.
    const until = this.now() + 2 * 60_000;
    for (let i = 0; ; ) {
      const res = await this.deps.api(`/api/gpu/computer/tasks/${t.id}/report`, { method: "POST", headers: { "Content-Type": "application/json", "X-Fuobe-Lease": t.lease }, body: JSON.stringify(e) });
      if (res.ok) return (await res.json()) as { wanted?: WantedFile[]; follow?: string; stop?: boolean; state?: RelayState };
      if (res.status === 401) {
        this.stop("signed-out");
        throw new Stopped();
      }
      // The job ended or another tab has it: this tab lets go.
      if (res.status === 404 || res.status === 409) throw new Stopped(res.status === 404);
      if (res.status === 429 && this.now() < until) {
        await this.sleep(retryAfter(res));
        continue;
      }
      if (++i > 4) throw new Error(`The studio answered HTTP ${res.status}`);
      await this.sleep(1000 * i);
    }
  }

  /** Why a job fails, as a report says it: ComfyUI's reason, or what stopped it here. */
  private noteWhy(t: ClaimedTask, e: ReportEvent) {
    const said = "why" in e && typeof e.why === "string" && e.why ? e.why : null;
    if (said && e.event !== "give-back") this.whyOf.set(t.id, said);
    else if (e.event === "failed") this.whyOf.set(t.id, `stopped here: ${e.reason}${e.status ? ` (HTTP ${e.status})` : ""}`);
    else if (e.event === "refused") this.whyOf.set(t.id, `ComfyUI refused the job (HTTP ${e.status})`);
    else if (e.event === "give-back") this.whyOf.set(t.id, `given back to the line: ${e.why}`);
  }

  /** One beat: say this computer is here, keep its jobs alive, and stop what the server says to stop. */
  async beat(takeover = false): Promise<BeatAnswer | null> {
    if (!this.alive) return null;
    const t = this.now();
    // A browser that may not reach this computer yet only hears how many jobs wait (never ComfyUI, never the jobs).
    if (this.o.access) return this.beatWith({ device: this.o.device, ready: false, listen: true, running: [] });
    // A look at ComfyUI here every beat (only a computer whose ComfyUI answers takes the jobs); its facts go to the
    // server every minute, the LoRA names every 5 minutes.
    const due = t - this.factsSentAt > 60_000;
    const loras = due && t - this.factsWithLoras > 5 * 60_000;
    const read = await this.facts({ loras, guard: due });
    const facts = due ? read : null;
    if (facts) {
      this.factsSentAt = t;
      if (loras) this.factsWithLoras = t;
    }
    const running = this.view.jobs
      .filter((j) => j.phase !== "done" && j.phase !== "failed")
      .map((j) => {
        const ev = this.events.get(this.promptOf.get(j.taskId) ?? "");
        return { task: j.taskId, ...(j.position !== undefined && { position: j.position }), ...(j.phase === "running" && ev && { value: ev.value, max: ev.max, nodesDone: ev.nodesDone }) };
      });
    const stopped = [...this.stoppedDone];
    return this.beatWith(
      {
        ...this.deps.beatExtra?.(),
        device: this.o.device,
        port: this.o.port,
        ready: !!read,
        ...(this.view.comfy === "no-setting" && { why: "setting" }),
        ...(facts && { facts }),
        running,
        ...(stopped.length && { stopped }),
        ...(takeover && { takeover: true }),
      },
      stopped,
    );
  }

  private async beatWith(body: Record<string, unknown>, stopped: string[] = []): Promise<BeatAnswer | null> {
    const res = await fetchWithin("/api/gpu/computer/beat", BEAT_MS, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, this.deps.api);
    if (res.ok) for (const s of stopped) this.stoppedDone.delete(s);
    if (res.status === 401) {
      this.stop("signed-out");
      return null;
    }
    if (res.status === 403 || res.status === 409) {
      this.stop("disconnected");
      return null;
    }
    if (!res.ok) return null;
    const a = (await res.json()) as BeatAnswer;
    Object.assign(this.view, { runner: a.runner, heldElsewhere: a.heldElsewhere, waiting: a.waiting });
    this.emit();
    this.deps.onBeat?.(a);
    if (!this.o.access) for (const s of a.stops) void this.takeOff(s);
    return a;
  }

  /** Take a job's prompt (and a meta-batch's later passes) off ComfyUI here, then tell the server. */
  private async takeOff(s: BeatAnswer["stops"][number]) {
    if (this.stopping.has(s.task)) return;
    this.stopping.add(s.task);
    try {
      const own = { promptIds: [s.promptId] };
      if (this.jobsApi !== false) {
        const res = await this.send(`/api/jobs/${s.promptId}/cancel`, {}, own, {}).catch(() => null);
        if (res?.status === 404) this.jobsApi = false;
      }
      if (this.jobsApi === false) {
        await this.send("/queue", { delete: [s.promptId] }, own, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: [s.promptId] }) }).catch(() => null);
        const q = await this.read<{ queue_running?: unknown[][] }>("/queue").catch(() => null);
        if (q?.queue_running?.some((r) => r[1] === s.promptId)) {
          await this.send("/interrupt", { prompt_id: s.promptId }, own, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt_id: s.promptId }) }).catch(() => null);
        }
      }
      // A meta-batch queues its next pass under a new id: sweep its prefix a few times.
      if (s.prefix) {
        for (let i = 0; i < 5; i++) {
          const q = await this.read<{ queue_running?: unknown[][]; queue_pending?: unknown[][] }>("/queue").catch(() => null);
          const ids = [...(q?.queue_running ?? []), ...(q?.queue_pending ?? [])].filter((r) => hasPrefix(r[2], s.prefix!)).map((r) => String(r[1]));
          if (!ids.length) break;
          for (const id of ids) await this.send(`/api/jobs/${id}/cancel`, {}, { promptIds: ids }, {}).catch(() => null);
          await this.sleep(1000);
        }
      }
      // Said at the next beat (a stop can be for a job an earlier tab took: this one has no token for it).
      this.stoppedDone.add(s.task);
    } finally {
      this.stopping.delete(s.task);
      const j = this.view.jobs.find((x) => x.taskId === s.task);
      if (j && j.phase !== "done") this.job({ id: j.taskId, generationId: j.generationId }, { phase: "failed" });
    }
  }

  private leases = new Map<string, string>();
  private promptOf = new Map<string, string>();
  /** The files a composed job ticket's graph makes, by task and name: sent from here, never read from the studio. */
  private madeOf = new Map<string, Map<string, { data: ArrayBuffer | Uint8Array; contentType: string }>>();
  private stoppedDone = new Set<string>();
  /** The files a finishing job made, by task and name: uploaded from here, never read from ComfyUI. */
  private finishMade = new Map<string, Map<string, Blob>>();
  /** Why each job failed here, as its reports said (for `ended`). */
  private whyOf = new Map<string, string>();

  /**
   * Ask for a job and run it (one at a time). True when there was one. Only while ComfyUI here answers to this site: a
   * computer whose ComfyUI is closed, or runs without Fuobe's setting, keeps its place but takes nothing.
   */
  async claimAndRun(o: { onlyHeld?: boolean } = {}): Promise<boolean> {
    if (!this.alive || this.busy || this.o.access) return false;
    this.busy = true;
    try {
      // A worker's kept results go up without its ComfyUI (`onlyHeld`); anything else needs ComfyUI answering.
      if (!o.onlyHeld && (await this.look()).comfy !== "ok") return false;
      const running = this.view.jobs.filter((j) => j.phase !== "done" && j.phase !== "failed").map((j) => j.taskId);
      // A worker's CPU slot claims for itself (`slot`): its work never waits for its GPU's job, nor holds it up.
      const res = await this.deps.api("/api/gpu/computer/claim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ device: this.o.device, running, ...(this.o.slot && { slot: this.o.slot }) }) });
      if (res.status !== 200) {
        if (res.status === 401) this.stop("signed-out");
        if (res.status === 204) await this.deps.worker?.claimed(null, { onlyHeld: !!o.onlyHeld });
        return false;
      }
      const { task } = (await res.json()) as { task: ClaimedTask };
      this.leases.set(task.id, task.lease);
      const worker = this.deps.worker;
      if (worker) {
        await worker.claimed(task, { onlyHeld: !!o.onlyHeld });
        // Only kept results now: any other job waits for its ComfyUI (one never sent goes back to the line at once).
        if (o.onlyHeld && !worker.hold.has(task.id)) {
          await this.deps.api(`/api/gpu/computer/tasks/${task.id}/release`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lease: task.lease }) }).catch(() => null);
          return false;
        }
      }
      try {
        await this.run(task);
      } catch (e) {
        // Something broke mid-job (the studio or the connection): forget it here, so the next claim picks it up again
        // from where it got to (the job stays this computer's on the server).
        this.view.jobs = this.view.jobs.filter((j) => j.taskId !== task.id);
        this.emit();
        throw e;
      }
      return true;
    } finally {
      this.busy = false;
    }
  }

  /** A whole job, from wherever it was. */
  async run(t: ClaimedTask): Promise<void> {
    try {
      await this.runJob(t);
    } finally {
      this.madeOf.delete(t.id);
      this.finishMade.delete(t.id);
      const why = this.whyOf.get(t.id);
      this.whyOf.delete(t.id);
      const phase = this.view.jobs.find((j) => j.taskId === t.id)?.phase;
      if (this.deps.ended && (phase === "done" || phase === "failed")) await Promise.resolve(this.deps.ended(t, phase, phase === "failed" ? why : undefined)).catch(() => {});
    }
  }

  private async runJob(t: ClaimedTask): Promise<void> {
    // A finishing job runs with the worker's own code, never on ComfyUI.
    if (t.finish !== undefined) return this.runFinish(t);
    this.promptOf.set(t.id, t.promptId);
    this.job(t, { phase: t.resume === "collecting" ? "saving" : t.resume === "running" ? "running" : t.resume === "queued" ? "queued" : "sending" });
    try {
      const worker = this.deps.worker;
      // A worker names its GPU with each finished job: its facts, if no beat read them yet.
      if (worker && !this.view.facts) await this.facts().catch(() => null);
      // A worker's results kept from before (it stopped after its ComfyUI finished): they go up, the job doesn't run again.
      const held = worker ? await worker.hold.get(t).catch(() => null) : null;
      if (!held) {
        // A job ticket becomes its graph here (a worker's composer); a graph comes only for the owner's own jobs.
        const notMine = await this.graphOf(t);
        if (notMine === "update-worker" || notMine === "outside-ceiling") {
          await this.giveBack(t, notMine);
          return this.job(t, { phase: "failed" });
        }
        if (notMine) {
          await this.report(t, { event: "failed", reason: "bad-ticket" });
          return this.job(t, { phase: "failed" });
        }
        const problem = graphProblem(t.graph!, t.inputs.map((i) => i.name));
        if (problem) {
          await this.report(t, { event: "failed", reason: "unsafe-graph" });
          return this.job(t, { phase: "failed" });
        }
        const refused = await this.deps.vet?.(t);
        if (refused && typeof refused === "object") {
          await this.giveBack(t, refused.giveBack);
          return this.job(t, { phase: "failed" });
        }
        if (refused) {
          await this.report(t, { event: "failed", reason: refused });
          return this.job(t, { phase: "failed" });
        }
      }
      let entries: HistoryEntryLike[] | null = held?.entries ?? null;
      let wanted = t.wanted;
      let phase = t.resume ?? "sending";
      if (held && phase !== "collecting") {
        // The studio hasn't heard that it finished (or it went back in line since, and came back here). Nothing runs
        // again: the reports say so, so this isn't another attempt and its time isn't a new one for the lane.
        if (phase === "sending") await this.report(t, { event: "sent", promptId: t.promptId, kept: true });
        const a = await this.report(t, this.endReport(held, true));
        if (a.stop) throw new Stopped();
        if (!a.wanted) return this.job(t, { phase: a.state === "done" ? "done" : "failed" });
        wanted = a.wanted;
        phase = "collecting";
      }
      for (let attempt = 0; phase !== "collecting" && attempt < 3; attempt++) {
        if (phase === "sending") {
          const sent = await this.sendJob(t);
          if (sent === "give-back") {
            await this.giveBack(t, "media");
            return this.job(t, { phase: "failed" });
          }
          if (!sent) return;
        }
        this.socket();
        const done = await this.follow(t);
        if (done === "gone") {
          // A worker's ComfyUI that stopped twice on this job: the job fails, not the worker.
          if (worker && worker.crashes(t) >= 2) {
            await this.report(t, { event: "failed", reason: "input-crashed" });
            return this.job(t, { phase: "failed" });
          }
          const a = await this.report(t, { event: "gone" });
          if (a.state !== "sending") return this.job(t, { phase: "failed" });
          phase = "sending";
          continue;
        }
        if ("giveBack" in done) {
          await this.giveBack(t, done.giveBack);
          return this.job(t, { phase: "failed" });
        }
        entries = done.entries;
        if (!done.answer.wanted) return this.job(t, { phase: done.answer.state === "done" ? "done" : "failed" });
        wanted = done.answer.wanted;
        phase = "collecting";
      }
      if (phase !== "collecting" || !wanted) return;
      if (!entries) entries = await this.ownEntries(t);
      await this.collect(t, wanted, entries, t.received ?? []);
    } catch (e) {
      if (e instanceof Stopped) {
        // The studio has no such job any more: a worker's kept results of it are of no use.
        if (e.gone) this.deps.worker?.hold.drop(t.id);
        if (!this.whyOf.has(t.id)) this.whyOf.set(t.id, e.gone ? "the studio no longer has this job" : "the studio stopped it");
        return this.job(t, { phase: "failed" });
      }
      throw e;
    }
  }

  /**
   * A finishing job (src/lib/finish-ticket.ts) on a worker's CPU slot: its ticket checked, its inputs read (each checked
   * against its SHA-256, a picture made again first), the worker's own code run on them within the run limit, its files
   * kept before the studio hears of them, then the files the studio asks for uploaded. Results kept from an earlier try
   * go up without running it again. No ComfyUI is used.
   */
  private async runFinish(t: ClaimedTask): Promise<void> {
    const worker = this.deps.worker;
    try {
      const held = worker ? await worker.hold.get(t).catch(() => null) : null;
      let wanted = t.wanted;
      let entries: HistoryEntryLike[] | null = held?.entries ?? null;
      let phase = t.resume ?? "sending";
      if (held && phase !== "collecting") {
        if (phase === "sending") await this.report(t, { event: "sent", promptId: t.promptId, kept: true });
        const a = await this.report(t, this.endReport(held, true));
        if (a.stop) throw new Stopped();
        if (!a.wanted) return this.job(t, { phase: a.state === "done" ? "done" : "failed" });
        wanted = a.wanted;
        phase = "collecting";
      }
      if (phase !== "collecting") {
        if (!this.deps.finish || !worker) {
          if (worker) await this.giveBack(t, "update-worker");
          else await this.report(t, { event: "failed", reason: "bad-ticket" });
          return this.job(t, { phase: "failed" });
        }
        if (finishProblem(t.finish, { inputs: t.inputs })) {
          await this.report(t, { event: "failed", reason: "bad-ticket" });
          return this.job(t, { phase: "failed" });
        }
        this.job(t, { phase: "sending" });
        // Its inputs, by slot: from the studio, checked against their SHA-256 (a picture made again first).
        const inputs: Record<string, ArrayBuffer> = {};
        for (const i of t.finish!.inputs) {
          const input = t.inputs.find((x) => x.name === i.name);
          if (!input) {
            await this.report(t, { event: "failed", reason: "bad-ticket" });
            return this.job(t, { phase: "failed" });
          }
          const read = async (): Promise<ArrayBuffer | TabFailure> => {
            const res = await this.deps.api("/api/gpu/computer/tasks/" + t.id + "/inputs/" + input.n, { headers: { "X-Fuobe-Lease": t.lease } });
            if (res.status === 404 || res.status === 409) throw new Stopped();
            if (res.status === 429) return "input-changed";
            if (!res.ok) throw new Error("The studio answered HTTP " + res.status + " for a file");
            const data = await res.arrayBuffer();
            return (await this.deps.sha256(data)) === input.sha256 ? data : "input-changed";
          };
          const got = await worker.input(t, input, read);
          if (got === "give-back") {
            await this.giveBack(t, "media");
            return this.job(t, { phase: "failed" });
          }
          if (typeof got === "string") {
            await this.report(t, { event: "failed", reason: got });
            return this.job(t, { phase: "failed" });
          }
          inputs[i.slot] = got;
        }
        if (phase === "sending") await this.report(t, { event: "sent", promptId: t.promptId });
        await this.report(t, { event: "running", value: 0, max: 100 });
        this.job(t, { phase: "running", value: 0, max: 100 });
        // Its run limit: past it, the job goes back in line (the next try has the whole limit again).
        const ctrl = new AbortController();
        const limit = t.runLimitMs && t.runLimitMs > 0 ? t.runLimitMs : FINISH_RUN_MS;
        const started = this.now();
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          ctrl.abort();
        }, limit);
        // A stop from the studio (the run was canceled or deleted): the answer to a progress report says so, or the studio
        // no longer has the job. Its processes stop at once. A progress report goes at least every FINISH_BEAT_MS, so a
        // stop is heard even while a step of it says nothing for minutes.
        let stopped = false;
        const stopNow = () => {
          stopped = true;
          ctrl.abort();
        };
        let lastAt = 0;
        let value = 0;
        const tell = () => {
          if (stopped) return;
          lastAt = this.now();
          void this.report(t, { event: "running", value, max: 100 }).then(
            (a) => {
              if (a.stop) stopNow();
            },
            (e) => {
              if (e instanceof Stopped) stopNow();
            },
          );
        };
        const progress = (fraction: number) => {
          value = Math.max(0, Math.min(99, Math.round(fraction * 100)));
          this.job(t, { phase: "running", value, max: 100 });
          if (this.now() - lastAt >= PROGRESS_EVERY_MS * 4) tell();
        };
        const beat = setInterval(() => {
          if (this.now() - lastAt >= FINISH_BEAT_MS) tell();
        }, FINISH_BEAT_MS);
        let made: FinishMade | { refused: "unsafe-model" | "finish-failed" };
        try {
          made = await this.deps.finish(t, inputs, { signal: ctrl.signal, progress }).catch((): { refused: "finish-failed" } => ({ refused: "finish-failed" }));
        } finally {
          clearTimeout(timer);
          clearInterval(beat);
        }
        if (!this.alive || stopped) throw new Stopped();
        if (timedOut) {
          await this.giveBack(t, "run-limit");
          return this.job(t, { phase: "failed" });
        }
        if ("refused" in made) {
          await this.report(t, { event: "failed", reason: made.refused });
          return this.job(t, { phase: "failed" });
        }
        const results: FinishResult[] = made.files.map((f) => ({ filename: f.name, subfolder: "", type: "output", role: f.role }));
        const entry: HistoryEntryLike = {
          status: { status_str: "success", completed: true },
          outputs: { finish: { results, ...(made.stats && { stats: [made.stats] }), ...(made.turntable && { turntable: [made.turntable] }) } },
        };
        const files = new Map(made.files.map((f) => [f.name, new Blob([toArrayBuffer(f.data)], { type: f.contentType })]));
        this.finishMade.set(t.id, files);
        const execMs = this.now() - started;
        // Kept on its disk first: a stop from here on uploads them instead of running the job again.
        await worker.hold
          .keep(t, { kind: "finished", entries: [entry], execMs }, async (f) => {
            const b = files.get(f.filename);
            return b ? new Response(b) : null;
          })
          .catch(() => {});
        const a = await this.report(t, { event: "finished", entry, execMs: Math.round(execMs) });
        if (a.stop) throw new Stopped();
        if (!a.wanted) return this.job(t, { phase: a.state === "done" ? "done" : "failed" });
        wanted = a.wanted;
        entries = [entry];
      }
      if (!wanted) return;
      await this.collect(t, wanted, entries ?? [], t.received ?? []);
    } catch (e) {
      if (e instanceof Stopped) {
        if (e.gone) worker?.hold.drop(t.id);
        return this.job(t, { phase: "failed" });
      }
      throw e;
    }
  }

  /**
   * The job's graph, or why it is refused. A ticket is composed by the worker's own composer (a runner without one gives
   * it back to a worker that has one, or refuses it in a browser). A graph is taken as it is by a browser tab; a worker
   * takes one only for the owner's own job, and only while it takes graphs at all.
   */
  private async graphOf(t: ClaimedTask): Promise<TicketRefused | null> {
    const worker = this.deps.worker;
    if (t.ticket !== undefined) {
      if (!this.deps.compose) return worker ? "update-worker" : "bad-ticket";
      const c = await this.deps.compose(t).catch((): { refused: TicketRefused } => ({ refused: "bad-ticket" }));
      if ("refused" in c) return c.refused;
      t.graph = c.graph;
      this.madeOf.set(t.id, new Map(c.made.map((m) => [m.name, { data: m.data, contentType: m.contentType }])));
      return null;
    }
    if (!t.graph || typeof t.graph !== "object") return "bad-ticket";
    // A studio names the owner's own job "owner"; a graph for any other job is refused, and so is one that names no class,
    // unless the studio is older than job tickets (its every graph job is the owner's own, and names no class).
    const cls = t.class ?? (worker?.olderStudio?.() ? "owner" : undefined);
    if (worker && (cls !== "owner" || worker.graphs === false)) return "bad-ticket";
    if (worker?.inside && !worker.inside(t)) return "outside-ceiling";
    return null;
  }

  /**
   * A worker's report of a finished job: its entries, its ComfyUI's execution time and its GPU's name (`kept`: results
   * kept from an earlier try).
   */
  private endReport(held: HeldResults, kept = false): ReportEvent {
    const device = deviceName(this.view.facts?.device);
    const exec = { ...(held.execMs !== undefined && { execMs: Math.round(held.execMs) }), ...(device && { device }), ...(kept && { kept }) };
    return held.kind === "passes" ? { event: "passes", running: false, entries: held.entries.map(slim), ...exec } : { event: "finished", entry: slim(held.entries[0] ?? {}), ...exec };
  }

  /** A worker keeps a finished job's files before the studio hears of them (a failure to keep only loses the copy). */
  private async keep(t: ClaimedTask, held: HeldResults) {
    const read = (f: ResultFile) => {
      try {
        return this.deps.local(`${this.base}${readPath(viewPath(f))}`, { credentials: "omit", cache: "no-store" }).catch(() => null);
      } catch {
        return Promise.resolve(null);
      }
    };
    await this.deps.worker?.hold.keep(t, held, read).catch(() => {});
  }

  /** A worker gives a job back to the line, after taking its prompt off its ComfyUI. */
  private async giveBack(t: ClaimedTask, why: GiveBackWhy) {
    await this.cancelHere(t);
    await this.report(t, { event: "give-back", why }).catch((e) => {
      if (!(e instanceof Stopped)) throw e;
    });
  }

  /** Take a worker's prompt off its ComfyUI; one that won't go within 15 s stops its ComfyUI. */
  private async cancelHere(t: ClaimedTask) {
    const own = { promptIds: [t.promptId] };
    const json = (body: unknown) => ({ headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await this.send(`/api/jobs/${t.promptId}/cancel`, {}, own, {}).catch(() => null);
    await this.send("/queue", { delete: [t.promptId] }, own, json({ delete: [t.promptId] })).catch(() => null);
    await this.send("/interrupt", { prompt_id: t.promptId }, own, json({ prompt_id: t.promptId })).catch(() => null);
    for (let i = 0; i < 15; i++) {
      const w = await this.where(t.promptId).catch(() => null);
      if (w && (w.s === "done" || w.s === "absent")) {
        // Its entry goes too: the job may come back here under the same prompt id, and must run again then.
        await this.send("/history", { delete: [t.promptId] }, own, json({ delete: [t.promptId] })).catch(() => null);
        return;
      }
      await this.sleep(1000);
    }
    await this.deps.worker?.stuck().catch(() => {});
  }

  /** Send a worker's prompt again (the one retry after its ComfyUI ran out of memory). True when ComfyUI took it. */
  private async resend(t: ClaimedTask): Promise<boolean> {
    const own = { promptIds: [t.promptId] };
    await this.send("/history", { delete: [t.promptId] }, own, { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: [t.promptId] }) }).catch(() => null);
    const body = { prompt: t.graph!, prompt_id: t.promptId, client_id: this.o.clientId, ...(t.preview && { extra_data: { preview_method: "auto" } }) };
    const res = await this.send("/prompt", body, own, { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const answer = (await res?.json().catch(() => ({}))) as { prompt_id?: string } | undefined;
    if (!res?.ok || typeof answer?.prompt_id !== "string") return false;
    if (answer.prompt_id !== t.promptId) {
      t.promptId = answer.prompt_id;
      this.promptOf.set(t.id, t.promptId);
    }
    return true;
  }

  /** The job's own entries on ComfyUI here, to check a resumed upload against. */
  private async ownEntries(t: ClaimedTask): Promise<HistoryEntryLike[]> {
    const own = (await this.read<Record<string, HistoryEntryLike>>(`/history/${t.promptId}`).catch(() => ({}) as Record<string, HistoryEntryLike>))[t.promptId];
    const passes = t.prefix ? Object.values(await this.read<Record<string, HistoryEntryLike>>(`/history?max_items=${META_BATCH_HISTORY}`).catch(() => ({}))).filter((e) => hasPrefix(e.prompt?.[2], t.prefix!)) : [];
    return [...(own ? [own] : []), ...passes];
  }

  /**
   * Send the inputs and the prompt, unless ComfyUI has it already (a resumed job). False when the job ended;
   * "give-back" when a worker can't take one of its inputs.
   */
  private async sendJob(t: ClaimedTask): Promise<boolean | "give-back"> {
    this.job(t, { phase: "sending" });
    const there = await this.where(t.promptId).catch(() => null);
    if (there && there.s !== "absent") {
      await this.report(t, { event: "sent", promptId: t.promptId });
      return true;
    }
    if (!there) await this.waitForComfy(t);
    const names = t.inputs.map((i) => i.name);
    const worker = this.deps.worker;
    const made = this.madeOf.get(t.id);
    for (const input of t.inputs) {
      // From the studio, checked against its SHA-256. A worker reads it at most once a job (it keeps a copy), so a
      // studio that says it was read enough times (429) means it failed. A file a composed ticket's graph makes itself
      // is the worker's own (its composer checked it against the ticket): the studio's copy is never read.
      const own = made?.get(input.name);
      const read = async (): Promise<ArrayBuffer | TabFailure> => {
        const res = await this.deps.api(`/api/gpu/computer/tasks/${t.id}/inputs/${input.n}`, { headers: { "X-Fuobe-Lease": t.lease } });
        if (res.status === 404 || res.status === 409) throw new Stopped();
        if (worker && res.status === 429) return "input-changed";
        if (!res.ok) throw new Error(`The studio answered HTTP ${res.status} for a file`);
        const data = await res.arrayBuffer();
        return (await this.deps.sha256(data)) === input.sha256 ? data : "input-changed";
      };
      const got = own ? toArrayBuffer(own.data) : worker ? await worker.input(t, input, read) : await read();
      if (got === "give-back") return got;
      if (typeof got === "string") {
        await this.report(t, { event: "failed", reason: got });
        this.job(t, { phase: "failed" });
        return false;
      }
      const data = got;
      const form = new FormData();
      form.append("image", new Blob([data], { type: input.contentType }), input.name);
      form.append("type", "input");
      form.append("overwrite", "true");
      const up = await this.send("/upload/image", { name: input.name, type: "input", overwrite: "true" }, { promptIds: [], names }, { body: form }).catch(() => null);
      if (!up) {
        await this.waitForComfy(t);
        return this.sendJob(t);
      }
      if (!up.ok) {
        await this.report(t, { event: "failed", reason: up.status === 413 ? "input-too-big" : "comfy-error", status: up.status, why: `ComfyUI answered HTTP ${up.status} to one of the job's files` });
        this.job(t, { phase: "failed" });
        return false;
      }
    }
    const body = { prompt: t.graph!, prompt_id: t.promptId, client_id: this.o.clientId, ...(t.preview && { extra_data: { preview_method: "auto" } }) };
    const res = await this.send("/prompt", body, { promptIds: [t.promptId] }, { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (!res) {
      await this.waitForComfy(t);
      return this.sendJob(t);
    }
    const answer = (await res.json().catch(() => ({}))) as { prompt_id?: string; number?: number };
    if (res.status === 400) {
      const why = refusalReason(answer, { graph: t.graph });
      await this.report(t, { event: "refused", status: 400, body: answer, ...(why && { why }) });
      this.job(t, { phase: "failed" });
      return false;
    }
    if (!res.ok || typeof answer.prompt_id !== "string") {
      const why = (!res.ok && refusalReason(answer, { graph: t.graph })) || `ComfyUI answered HTTP ${res.status} to the job${res.ok ? " without its id" : ""}`;
      await this.report(t, { event: "failed", reason: "comfy-error", status: res.status, why });
      this.job(t, { phase: "failed" });
      return false;
    }
    // An older ComfyUI mints its own id: that is the one to follow.
    if (answer.prompt_id !== t.promptId) {
      t.promptId = answer.prompt_id;
      this.promptOf.set(t.id, t.promptId);
    }
    await this.report(t, { event: "sent", promptId: answer.prompt_id, number: answer.number });
    return true;
  }

  /**
   * ComfyUI here stopped answering, or answers without Fuobe's setting: say which (again when that changes), then wait
   * until it answers to this site again.
   */
  private async waitForComfy(t: ClaimedTask) {
    let told: string | undefined;
    for (;;) {
      if (!this.alive) throw new Stopped();
      const l = await this.look();
      if (l.comfy === "ok") return;
      if (told !== l.comfy) {
        const a = await this.report(t, { event: "comfy-down", ...(l.comfy === "no-setting" && { why: "setting" as const }) });
        if (a.stop) throw new Stopped();
        told = l.comfy;
      }
      await this.sleep(3000);
    }
  }

  /**
   * Follow a sent prompt until it finishes (its entry reported, the server's answer back), or ComfyUI lost it. A worker
   * also keeps the results before it reports them, gives the job back when it stalls or runs past its run limit, and
   * sends it again once when its ComfyUI ran out of memory.
   */
  private async follow(t: ClaimedTask): Promise<"gone" | { giveBack: GiveBackWhy } | { entries: HistoryEntryLike[]; answer: { wanted?: WantedFile[]; state?: RelayState } }> {
    const worker = this.deps.worker;
    let lastSent = 0;
    let lastKey = "";
    let lastPreview: Blob | undefined;
    let lastPreviewAt = -Infinity;
    let following: string | undefined;
    // A worker's watchdog: when the job last moved (a step, a node, its place, a pass).
    let movedAt = this.now();
    let moveKey = "";
    const moved = (key: string) => {
      if (key !== moveKey) {
        moveKey = key;
        movedAt = this.now();
      }
    };
    // The run limit counts from when its ComfyUI first runs the job (its wait in ComfyUI's own queue doesn't count). A
    // limit under MIN_RUN_LIMIT_MS (an older studio's floor for a lane it has no times for) isn't one to obey.
    const runLimit = t.runLimitMs && t.runLimitMs >= MIN_RUN_LIMIT_MS ? t.runLimitMs : null;
    // The stall limit: the PC's own when it sets one, else the claim's (at least MIN_STALL_MS), else the worker's default.
    const stallMs = worker ? (worker.stallLocalMs ?? (t.stallMs && t.stallMs >= MIN_STALL_MS ? t.stallMs : worker.stallMs)) : Infinity;
    // Execution time: what ComfyUI's entries say, else the time it was seen running here. After the retry for running
    // out of memory, only the retry's own time counts (the first try was this worker's, not the run's).
    let runningSince: number | null = null;
    let oomRetried = false;
    const execOf = (entries: HistoryEntryLike[]) => execTime(entries) ?? (runningSince !== null ? this.now() - runningSince : 0);
    const exec = (ms: number) => {
      const device = deviceName(this.view.facts?.device);
      return worker ? { execMs: Math.round(ms), ...(device && { device }) } : {};
    };
    for (;;) {
      if (!this.alive) throw new Stopped();
      if (worker) {
        if (runLimit && runningSince !== null && this.now() - runningSince > runLimit) return { giveBack: "run-limit" };
        if (this.now() - movedAt > stallMs) return { giveBack: "stalled" };
      }
      if (following) {
        // A meta-batch: its passes run under new ids, all with its prefix.
        const q = await this.read<{ queue_running?: unknown[][]; queue_pending?: unknown[][] }>("/queue").catch(() => null);
        if (!q) {
          await this.waitForComfy(t);
          moved(`back:${this.now()}`);
          continue;
        }
        const queued = [...(q.queue_running ?? []), ...(q.queue_pending ?? [])].filter((r) => hasPrefix(r[2], following!));
        const running = queued.length > 0;
        if (running) runningSince ??= this.now();
        // Every pass once the last is done (an EXR export saves frames in each one).
        const passes = running ? [] : Object.values(await this.read<Record<string, HistoryEntryLike>>(`/history?max_items=${META_BATCH_HISTORY}`).catch(() => ({}))).filter((e) => hasPrefix(e.prompt?.[2], following!));
        const ev = this.events.get(String(queued[0]?.[1] ?? ""));
        moved(JSON.stringify([queued.map((r) => r[1]), passes.length, ev?.value, ev?.node, ev?.nodesDone]));
        if (!running && worker) await this.keep(t, { kind: "passes", entries: passes, execMs: execOf(passes) });
        const passWhy = running ? null : entryReason(passes, { graph: t.graph });
        const a = await this.report(t, { event: "passes", running, entries: running ? [] : passes.map(slim), ...(!running && exec(execOf(passes))), ...(passWhy && { why: passWhy }) });
        if (a.stop) throw new Stopped();
        if (!running) return { entries: passes, answer: a };
        this.job(t, { phase: "running" });
        await this.sleep(POLL_MS * 2);
        continue;
      }
      const w = await this.where(t.promptId).catch(() => null);
      if (!w) {
        await this.waitForComfy(t);
        moved(`back:${this.now()}`);
        continue;
      }
      if (w.s === "absent") return "gone";
      if (w.s === "done") {
        // A worker's ComfyUI ran out of memory: free it, and send the prompt once more before saying anything.
        if (worker && !oomRetried && outOfMemory(w.entry)) {
          oomRetried = true;
          runningSince = null;
          await worker.free().catch(() => {});
          if (await this.resend(t)) {
            moved(`retry:${this.now()}`);
            continue;
          }
        }
        const ms = execOf([w.entry]);
        // A worker keeps the results first: a stop from here on uploads them again instead of running the job again.
        if (worker && !t.metaBatch && w.entry.status?.status_str !== "error") await this.keep(t, { kind: "finished", entries: [w.entry], execMs: ms });
        const why = w.entry.status?.status_str === "error" ? entryReason(w.entry, { graph: t.graph }) : null;
        const a = await this.report(t, { event: "finished", entry: slim(w.entry), ...exec(ms), ...(worker && this.nodeTimes(t.promptId, w.entry)), ...(why && { why }) });
        if (a.stop) throw new Stopped();
        if (a.follow) {
          following = a.follow;
          continue;
        }
        return { entries: [w.entry], answer: a };
      }
      if (w.s === "running") runningSince ??= this.now();
      const ev = this.events.get(t.promptId);
      moved(JSON.stringify([w.s, w.s === "pending" ? w.ahead : null, ev?.value, ev?.max, ev?.node, ev?.nodesDone]));
      const report: ReportEvent = w.s === "pending" ? { event: "queued", position: w.ahead } : { event: "running", value: ev?.value, max: ev?.max, node: ev?.node, nodesDone: ev?.nodesDone };
      const key = JSON.stringify(report);
      // A worker sends its ComfyUI's latest preview with its progress, when the claim asks for one: a small JPEG, at most
      // one every 2 s.
      const shown = worker && t.reportPreview && w.s === "running" ? this.view.jobs.find((j) => j.taskId === t.id)?.preview : undefined;
      // Each preview is tried once (one that can't be sent is never made again).
      const due = !!shown && shown !== lastPreview && this.now() - lastPreviewAt >= PREVIEW_LIMITS.everyMs && this.now() - lastSent >= PROGRESS_EVERY_MS;
      const preview = due ? await previewForReport(shown, lastPreviewAt, this.now(), worker?.shrinkPreview?.bind(worker)) : undefined;
      if (due) lastPreview = shown;
      if ((key !== lastKey || preview) && this.now() - lastSent >= PROGRESS_EVERY_MS) {
        const a = await this.report(t, preview && report.event === "running" ? { ...report, preview } : report);
        if (a.stop) throw new Stopped();
        lastKey = key;
        lastSent = this.now();
        if (preview) lastPreviewAt = this.now();
      }
      this.job(t, w.s === "pending" ? { phase: "queued", position: w.ahead } : { phase: "running", value: ev?.value, max: ev?.max });
      // The socket says when steps move; without it, a read a second.
      await this.sleep(this.wsOpen ? PROGRESS_EVERY_MS : POLL_MS);
    }
  }

  /** Upload the results the server asked for, each in parts, from where each got to. */
  private async collect(t: ClaimedTask, wanted: WantedFile[], entries: HistoryEntryLike[], received: { n: number; bytes: number; done: boolean }[]) {
    this.job(t, { phase: "saving", saved: 0 });
    for (const w of wanted) {
      const got = received.find((r) => r.n === w.n);
      if (got?.done) continue;
      // Only a file this job's own prompt saved (a wrong answer from the server can't reach any other).
      if (!mayDownload(w, entries)) {
        await this.report(t, { event: "failed", reason: "output-missing" });
        return this.job(t, { phase: "failed" });
      }
      // A finishing job's own file, then a worker's kept copy (its ComfyUI may have restarted since), else ComfyUI's own file.
      const made = this.finishMade.get(t.id)?.get(w.filename);
      const kept = made ?? (this.deps.worker ? await this.deps.worker.hold.file(t, w).catch(() => null) : null);
      const res = kept ? null : await this.deps.local(`${this.base}${readPath(viewPath(w))}`, { credentials: "omit", cache: "no-store" }).catch(() => null);
      if (!kept && !res?.ok) {
        await this.report(t, { event: "failed", reason: "output-missing" });
        return this.job(t, { phase: "failed" });
      }
      const blob = kept ?? (await res!.blob());
      if (blob.size > w.maxBytes) {
        // The server says why (too big, or the account's files are full) when it refuses the size.
        await this.upload(t, w, blob, 0);
        return this.job(t, { phase: "failed" });
      }
      let offset = got?.bytes ?? 0;
      if (offset > 0) {
        const s = await this.deps.api(`/api/gpu/computer/tasks/${t.id}/outputs/${w.n}`, { headers: { "X-Fuobe-Lease": t.lease } });
        offset = s.ok ? ((await s.json()) as { received: number }).received : 0;
      }
      if (!(await this.upload(t, w, blob, offset))) return this.job(t, { phase: "failed" });
    }
    // Saved: the tile says so (over the last preview) until the run itself moves on.
    this.job(t, { phase: "done", saved: 1, waiting: false });
  }

  /**
   * One file in parts of 16 MB; a failed part is tried again (three times in a row at most). A busy studio (429) isn't a
   * failure: the part waits as long as it says, up to an hour in all.
   */
  private async upload(t: ClaimedTask, w: WantedFile, blob: Blob, from: number): Promise<boolean> {
    let offset = from;
    let fails = 0;
    const until = this.now() + SAVE_WAIT_MS;
    while (offset < blob.size || blob.size === 0) {
      if (!this.alive) throw new Stopped();
      const part = blob.slice(offset, Math.min(blob.size, offset + RELAY_LIMITS.partBytes));
      const res = await this.deps
        .api(`/api/gpu/computer/tasks/${t.id}/outputs/${w.n}?offset=${offset}&total=${blob.size}`, {
          method: "PUT",
          headers: { "X-Fuobe-Lease": t.lease, "Content-Type": "application/octet-stream" },
          body: part,
        })
        .catch(() => null);
      if (res?.ok) {
        const r = (await res.json()) as { received: number; done: boolean };
        offset = r.received;
        fails = 0;
        this.job(t, { saved: offset / Math.max(1, blob.size), waiting: false });
        if (r.done) return true;
        continue;
      }
      if (res?.status === 429 && this.now() < until) {
        this.job(t, { waiting: true });
        await this.sleep(retryAfter(res));
        continue;
      }
      if (res && (res.status === 404 || res.status === 413 || res.status === 415)) return false;
      if (res?.status === 409) {
        // Out of step (a part arrived twice): go on from what the server has.
        const s = await this.deps.api(`/api/gpu/computer/tasks/${t.id}/outputs/${w.n}`, { headers: { "X-Fuobe-Lease": t.lease } });
        if (!s.ok) return false;
        const r = (await s.json()) as { received: number; done: boolean };
        if (r.done) return true;
        offset = r.received;
      }
      if (++fails >= 3) {
        await this.report(t, { event: "failed", reason: "save-failed" }).catch(() => null);
        return false;
      }
      await this.sleep(1500 * fails);
    }
    return true;
  }

  /** Let go of the jobs not sent yet (the tab closes): another tab or computer can take them at once. */
  releaseAll(send: (path: string, body: string) => void) {
    for (const j of this.view.jobs) {
      const lease = this.leases.get(j.taskId);
      if (lease && j.phase === "sending") send(`/api/gpu/computer/tasks/${j.taskId}/release`, JSON.stringify({ lease }));
    }
  }
}

/**
 * The job a run's tile shows: the run's latest one. A saved one only for a short while (its tile says it is saving over
 * the last preview until the run itself moves on), so a run's next step, or a run sent again, never shows an old job.
 */
export function tileJob(jobs: readonly LocalJob[], generationId: string, now: number): LocalJob | undefined {
  const job = jobs.findLast((j) => j.generationId === generationId);
  if (!job || (job.phase === "done" && now - (job.endedAt ?? 0) > DONE_SHOWN_MS)) return undefined;
  return job;
}

/** How often the runner beats: faster while it has work. */
export const beatEvery = (busy: boolean) => (busy ? RELAY_TIMES.busyBeatMs : RELAY_TIMES.beatMs);
