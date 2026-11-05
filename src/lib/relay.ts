/**
 * "Use the ComfyUI on this computer": what the server and the person's own Fuobe tab say to each other. The server plans
 * every run as it always has; each ComfyUI job of a run on someone's computer becomes a task the server stores (the
 * graph exactly as it built it, the input files under names it chose, a prompt id it minted). One tab at a time takes
 * the tasks of that person (src/lib/computer-runner.ts), sends them to the ComfyUI on 127.0.0.1, follows them, and
 * hands back what ComfyUI said and the files the server then asks for. The tab decides nothing about the result.
 * Pure (no I/O): the server's checks and the tab's script share it. None of these words reach the UI.
 */

import type { FinishTicket } from "./finish-ticket";
import type { Ceiling, JobTicket } from "./job-ticket";

/** Where a task is. */
export type RelayState = "waiting" | "sending" | "queued" | "running" | "collecting" | "done" | "failed" | "canceled";

export const ACTIVE_STATES: readonly RelayState[] = ["waiting", "sending", "queued", "running", "collecting"];
/** States a computer is working on (it took the task). */
export const SENT_STATES: readonly RelayState[] = ["sending", "queued", "running", "collecting"];

export const isActive = (s: string): s is RelayState => (ACTIVE_STATES as readonly string[]).includes(s);

/** A ComfyUI /history entry, as the tab reports it. */
export interface HistoryEntryLike {
  prompt?: unknown[];
  status?: { status_str?: string; completed?: boolean; messages?: [string, Record<string, unknown>][] };
  outputs?: Record<string, Record<string, unknown>>;
}

/**
 * Why the tab gave up on a task by itself (the server says it in plain words). A worker adds three: its ComfyUI stopped
 * twice while running the task ("input-crashed"), a clip or a sound that couldn't be made again ("input-unreadable"),
 * and a job ticket it refused (src/lib/job-ticket.ts), or a graph where a ticket belongs ("bad-ticket"). A finishing job
 * (src/lib/finish-ticket.ts) adds two: a 3D model that isn't a self-contained binary glTF ("unsafe-model"), and a finish
 * that couldn't be made ("finish-failed").
 */
export const TAB_FAILURES = ["input-too-big", "input-changed", "unsafe-graph", "output-missing", "comfy-error", "save-failed", "unknown-node", "unsafe-path", "model-unverified", "input-crashed", "input-unreadable", "bad-ticket", "unsafe-model", "finish-failed"] as const;
export type TabFailure = (typeof TAB_FAILURES)[number];

/**
 * Why a worker gives a task back to the line (another worker, or this one later, runs it): it made no progress for too
 * long ("stalled"), it ran past its run limit ("run-limit"), or it takes clips or sound and this worker can't make them
 * again ("media"). Two more cost the task nothing (it never ran there): its job ticket was made for another catalog
 * than the worker's ("update-worker"), or the job is more than its PC allows ("outside-ceiling").
 */
export const GIVE_BACK = ["stalled", "run-limit", "media", "update-worker", "outside-ceiling"] as const;
export type GiveBackWhy = (typeof GIVE_BACK)[number];

/** What the tab reports about one task. */
export type ReportEvent =
  /**
   * ComfyUI took the prompt (`promptId`: the id it answered, the server's own unless an older ComfyUI minted one).
   * `kept`: a worker sends results it kept from an earlier try instead (nothing new runs, so it isn't another attempt).
   */
  | { event: "sent"; promptId: string; number?: number; kept?: boolean }
  /** ComfyUI's /prompt refused it (its answer, as it was). */
  | { event: "refused"; status: number; body: unknown }
  /** Waiting in ComfyUI's queue: how many prompts are before it. */
  | { event: "queued"; position: number }
  /**
   * Running: the sampler's steps, and the node. A worker may add its ComfyUI's latest preview (`preview`: a JPEG as
   * base64, at most PREVIEW_LIMITS.maxBytes, at most one every PREVIEW_LIMITS.everyMs). A larger one is dropped.
   */
  | { event: "running"; value?: number; max?: number; node?: string; nodesDone?: number; preview?: string }
  /**
   * Finished: its /history entry. A worker adds the most VRAM it took (for the benchmarks), how long its ComfyUI spent
   * executing the job (`execMs`: execution only, no waits, no uploads), its GPU's name (`device`), and `kept` when the
   * results are ones it kept from an earlier try (their time doesn't count toward the lane's times).
   */
  | { event: "finished"; entry: HistoryEntryLike; peakVramBytes?: number; execMs?: number; device?: string; kept?: boolean }
  /**
   * A meta-batch job (VHS re-queues it pass by pass): whether a pass is still queued, and the passes' entries so far. The
   * last one (not running) is the job's end: a worker adds `execMs`, `device` and `kept` as for "finished".
   */
  | { event: "passes"; running: boolean; entries: HistoryEntryLike[]; execMs?: number; device?: string; kept?: boolean }
  /** A worker gives the task back to the line (it counts as an attempt). */
  | { event: "give-back"; why: GiveBackWhy }
  /** ComfyUI has no trace of it (restarted): the server sends it again once. */
  | { event: "gone" }
  /** The tab can't use ComfyUI: it doesn't answer, or (`why: "setting"`) it answers without Fuobe's setting. */
  | { event: "comfy-down"; why?: "setting" }
  /** A stop the server asked for is done. */
  | { event: "stopped" }
  /** The tab gave up for one of its own reasons. */
  | { event: "failed"; reason: TabFailure; status?: number };

export type ReportEventName = ReportEvent["event"];

/** Which state each report is taken in. Anything else is refused (409). */
const ALLOWED: Record<ReportEventName, readonly RelayState[]> = {
  sent: ["sending"],
  refused: ["sending"],
  queued: ["queued", "running"],
  running: ["queued", "running"],
  finished: ["queued", "running"],
  passes: ["queued", "running"],
  gone: ["sending", "queued", "running"],
  "give-back": ["sending", "queued", "running"],
  "comfy-down": ["sending", "queued", "running", "collecting"],
  stopped: ["sending", "queued", "running", "collecting", "done", "failed", "canceled"],
  failed: ["sending", "queued", "running", "collecting"],
};

export function reportAllowed(event: ReportEventName, state: RelayState): boolean {
  return ALLOWED[event]?.includes(state) ?? false;
}

/** A file the server wants from ComfyUI's output folder (n: its place in the task's list). */
export interface WantedFile {
  n: number;
  filename: string;
  subfolder: string;
  type: "output" | "temp";
  kind: "image" | "video" | "audio" | "text" | "model3d" | "frame";
  maxBytes: number;
}

/** An input the tab uploads to ComfyUI under exactly this name. */
export interface TaskInput {
  n: number;
  name: string;
  size: number;
  sha256: string;
  contentType: string;
}

/** What a claim hands the tab. */
export interface ClaimedTask {
  id: string;
  /** The run it is for (the person's own), so the tab can show its progress there. */
  generationId: string;
  /** The claim's token: every call about this task carries it. */
  lease: string;
  /**
   * The graph exactly as the server built it: a person's own computer's tasks, and the owner's own jobs on the workers.
   * An account's run on the workers carries a job ticket instead (`ticket`), and the worker composes the graph itself.
   */
  graph?: Record<string, { class_type: string; inputs: Record<string, unknown> }>;
  ticket?: JobTicket;
  promptId: string;
  /** Ask ComfyUI for live previews of this prompt. */
  preview: boolean;
  /** VHS meta-batch: the filename prefix its passes share. */
  prefix?: string;
  metaBatch?: boolean;
  inputs: TaskInput[];
  /** A task this computer started before (a reload): where it was. */
  resume?: "sending" | "queued" | "running" | "collecting";
  /** Collecting: the files still to upload, and how far each got. */
  wanted?: WantedFile[];
  received?: { n: number; bytes: number; done: boolean }[];
  /**
   * A worker's task (docs/gpu-workers.md): its lane, how long it should take there, when to stop it (`runLimitMs`: running
   * past it; `stallMs`: no progress for that long), and its files.
   */
  lane?: string;
  estMs?: number | null;
  runLimitMs?: number;
  stallMs?: number;
  notAfter?: number | null;
  attempt?: number;
  models?: { folder: string; name: string; size: number; sha256: string | null }[];
  /** A worker's task: its class in the line ("owner": the owner's own job), and its workflow. */
  class?: "paid" | "free" | "owner";
  workflowId?: string;
  /** A worker's task for its CPU slot (light CPU work, or a finishing job): "cpu". Absent: its GPU's. */
  slot?: "cpu";
  /** A finishing job (src/lib/finish-ticket.ts), in place of a graph or a job ticket: the worker runs it with its own code. */
  finish?: FinishTicket;
  /**
   * A worker's task whose run shows a live preview: the worker may send its ComfyUI's latest preview with its progress
   * (PREVIEW_LIMITS). Absent: it sends none (a run whose results are checked before anyone sees them never has it).
   */
  reportPreview?: true;
}

/** The tab's facts about its ComfyUI (never its command line: that holds paths and user names). */
export interface ComputerFacts {
  device?: string;
  vramBytes?: number;
  ramBytes?: number;
  version?: string;
  os?: string;
  /** Python embedded in the install: Windows portable or Easy-Install. */
  portable?: boolean;
  /** Its --enable-cors-header: this site exactly, every site ("any"), or something else. */
  cors?: "exact" | "any" | "other";
  /** Fuobe's guard is in its custom nodes (it turns away every other website while the setting is on). */
  guard?: boolean;
  /** Its LoRA files (sent now and then, not on every beat). */
  loras?: string[];
  /** A worker's GPU generation (its compute capability, "8.9"). */
  gpuGen?: string;
}

export const FACT_LIMITS = { loras: 20_000, loraName: 256, text: 120 };

/** The beat's answer. */
export interface BeatAnswer {
  /** This computer runs the person's waiting tasks. */
  runner: boolean;
  /** Another computer does (it beat in the last minute). */
  heldElsewhere: boolean;
  /** Tasks waiting for a computer. */
  waiting: number;
  /** A worker's own: people's tasks it may claim right now (its lanes, files, VRAM and hours), its own pause aside. */
  claimableNow?: number;
  /** Prompts to take off this computer's ComfyUI. */
  stops: { task: string; promptId: string; prefix?: string }[];
  /** A worker's own (docs/gpu-workers.md): what the studio says about it now. */
  worker?: WorkerAnswer;
}

/** The beat's answer for a worker. */
export interface WorkerAnswer {
  /** Paused on the website. */
  paused: boolean;
  /** Stop the current job now (it went back in line). */
  pauseNow: boolean;
  /** Finish the current job, then take nothing new. */
  drain: boolean;
  /** The automatic resume after a busy GPU, as the owner set it; null: the worker's own setting. */
  autoResume: boolean | null;
  insideHours: boolean;
  /** When its hours start or end next. */
  nextChangeAt: number | null;
  /** Lanes the owner allows it. */
  lanes: string[];
  minProtocol: number;
  /** Its inventory is unknown or changed: send it (PUT /api/gpu/computer/inventory). */
  sendInventory: boolean;
  /**
   * Its next token (to a worker that says `canRotateToken`), when its token has a lifetime and half of it is gone: save it and use it from the next
   * call on. The old token stops at the new one's first use. Given again after 10 minutes if it was never used.
   */
  token?: { value: string; expiresAt: number };
  /**
   * When its token stops working, for a token with a lifetime (absent: it never expires). A worker that can't save a next
   * token (one given in its environment) says so before then.
   */
  tokenExpiresAt?: number;
  /** The catalog version the studio makes job tickets for (src/lib/job-ticket.ts): a worker with another one is told to update. */
  catalogVersion?: string;
  /** The lanes it may take now: the owner's allowed lanes (`lanes`), narrowed to its PC's ceiling. */
  lanesInside?: string[];
}

/** What a worker says in its beat, on top of a browser's. */
export interface WorkerBeat {
  device: string;
  protocol: number;
  version: string;
  /** It saves the next token a beat answer gives it (`worker.token`) and uses it from its next call on. */
  canRotateToken?: boolean;
  ready: boolean;
  why: string | null;
  /**
   * Its own pause switch: by hand ("here", "here-until:<ms>", "here-now"), by itself ("gpu-busy:<process>",
   * "comfy-crashes", "port-busy", "models-not-ready": a model folder isn't there yet). Not paused, `why` may say that it
   * waits for local ComfyUI work to make room ("waiting-for-yield", "waiting-for-yield:no-answer").
   */
  local: { paused: boolean; why: string | null; until: number | null };
  gpu: { otherApps: { pid: number; name: string; vramBytes: number }[]; tempC: number | null };
  facts?: ComputerFacts;
  inventoryHash: string | null;
  warmLane: string | null;
  running: { task: string; position?: number; value?: number; max?: number; node?: string; nodesDone?: number }[];
  stopped: string[];
  /** The tasks whose finished results the worker keeps on its disk (a stop-now leaves them its own, to send them up). */
  held?: string[];
  /** The catalog version its build composes job tickets for (absent: an older worker, which takes no ticket). */
  catalogVersion?: string | null;
  /** What its PC may ever run (worker.json `ceiling`, src/lib/job-ticket.ts Ceiling). The studio only narrows inside it. */
  ceiling?: Ceiling;
  /**
   * How long its PC slept (ms) since its last beat that the studio answered. A job the studio took back from it for
   * going quiet during that sleep goes on with no blame: no attempt counted, and this worker may take it again.
   */
  slept?: number;
  /**
   * Its CPU slot (docs/gpu-workers.md, "The CPU slot"), when it has one: the finishing jobs it runs. Absent or null: no
   * CPU slot, and its GPU's slot takes light CPU work as before.
   */
  cpuSlot?: CpuSlot | null;
  /** The tasks its CPU slot works on, with where each is (as `running` for its GPU's). */
  cpuRunning?: { task: string; position?: number; value?: number; max?: number; node?: string; nodesDone?: number }[];
}

/** A worker's CPU slot: it takes light CPU work (catalog workflows marked cpu) and these finishing jobs. */
export interface CpuSlot {
  finishes: string[];
}

/**
 * A worker's live preview in a progress report: a JPEG, at most this big, at most one this often. A larger one is
 * dropped (the report itself is kept).
 */
export const PREVIEW_LIMITS = { maxBytes: 64 * 1024, everyMs: 2000 };

/** A report's preview as kept: base64 of a JPEG of at most PREVIEW_LIMITS.maxBytes, else undefined. */
export function previewOf(v: unknown): string | undefined {
  if (typeof v !== "string" || !v || v.length % 4 !== 0 || v.length > Math.ceil(PREVIEW_LIMITS.maxBytes / 3) * 4) return undefined;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return undefined;
  const pad = v.endsWith("==") ? 2 : v.endsWith("=") ? 1 : 0;
  if ((v.length / 4) * 3 - pad > PREVIEW_LIMITS.maxBytes) return undefined;
  // A JPEG starts FF D8 FF ("/9j/" in base64).
  return v.startsWith("/9j/") ? v : undefined;
}

/** Task timings (DESIGN 5.5): the runner lease, how often the tab beats, when a computer counts as gone. */
export const RELAY_TIMES = {
  leaseMs: 60_000,
  beatMs: 10_000,
  busyBeatMs: 5_000,
  /** A computer that beat this recently is online. */
  onlineMs: 30_000,
  /** A computer silent this long gives up the tasks it took. */
  silentMs: 30 * 60_000,
  /** ComfyUI not answering this long fails the task. */
  comfyDownMs: 30 * 60_000,
  /** Ended tasks (and their files) are kept this long. */
  keepMs: 24 * 60 * 60_000,
  /** An input staged for a task that never came. */
  stagedMs: 60 * 60_000,
  /** A worker silent this long (no beat) gives its task back to the line. */
  poolSilentMs: 2 * 60_000,
  /** A worker's ComfyUI down this long gives its task back to the line. */
  poolComfyDownMs: 2 * 60_000,
};

/**
 * The largest part of an output the tab sends at once; the largest report (a finished entry, while ComfyUI has the job),
 * a refusal's (while it sends) and any other's; how much of a refusal is kept.
 */
export const RELAY_LIMITS = { partBytes: 16 * 2 ** 20, reportBytes: 8 * 2 ** 20, refusalBytes: 256 * 1024, smallReportBytes: 8 * 1024, keptRefusalBytes: 16 * 1024, inputReads: 6 };

/**
 * How many recent ComfyUI /history entries are read for a meta-batch job's passes: an EXR export saves frames in every
 * pass, so all of them are needed (1,800 frames is 57 passes of 32).
 */
export const META_BATCH_HISTORY = 512;

/** A ComfyUI prompt id the server mints, and what the tab may name in a URL. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A task id (nanoid 16) and a lease (32 random bytes, hex). */
export const TASK_ID = /^[A-Za-z0-9_-]{16}$/;
export const LEASE = /^[0-9a-f]{64}$/;
/** A browser's device id: a routing label, not a secret. */
export const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** The name an input gets in ComfyUI's input folder: chosen by the server, unguessable. */
export const INPUT_NAME = /^fuobe_[A-Za-z0-9_-]{8,24}\.[a-z0-9]{1,5}$/;

// ---------------------------------------------------------------------------
// The words a run's tile shows

export type MadeKind = "image" | "video" | "audio" | string;

const MADE: Record<string, string> = { image: "picture", video: "clip", audio: "sound", text: "text", model3d: "3D model" };
const SENT: Record<string, string> = { image: "photo", video: "clip", audio: "sound" };

/** "Sending your photo to ComfyUI" (several kinds: "files"). */
export function sendingWords(inputKinds: string[]): string {
  const kinds = [...new Set(inputKinds.map((k) => k.split("/")[0]))];
  if (!kinds.length) return "Starting on your computer";
  const one = kinds.length === 1 && inputKinds.length === 1 ? SENT[kinds[0]] : undefined;
  const many = kinds.length === 1 && SENT[kinds[0]] ? `${SENT[kinds[0]]}s` : "files";
  return `Sending your ${one ?? many} to ComfyUI`;
}

/** "In ComfyUI's queue · 2 ahead", or "Next in ComfyUI's queue". */
export function queueWords(position: number | undefined): string {
  if (position === undefined || position < 0) return "In ComfyUI's queue";
  return position === 0 ? "Next in ComfyUI's queue" : `In ComfyUI's queue · ${position} ahead`;
}

/** "picture", "clip", "sound": what a run of this kind makes. */
export const madeNoun = (kind: MadeKind | undefined): string => (kind && MADE[kind]) || "picture";

/** "Making your picture · step 12 of 30". */
export function makingWords(kind: MadeKind, value?: number, max?: number): string {
  const noun = MADE[kind] ?? "result";
  return max && max > 1 && value !== undefined ? `Making your ${noun} · step ${Math.min(value, max)} of ${max}` : `Making your ${noun}`;
}

/**
 * How far a job on this computer is, from its own steps (so the tile's % and time left agree with "step 9 of 12"), or
 * null when its steps don't say.
 */
export function jobFraction(job: { phase: string; value?: number; max?: number }): number | null {
  if (job.phase !== "running" || !job.max || job.max < 2 || job.value === undefined) return null;
  return Math.min(0.99, Math.max(0, job.value / job.max));
}

/** How long a saved job's tile says it is saving, at most, when its run doesn't move on first. */
export const DONE_SHOWN_MS = 20_000;

export const savingWords = (fraction: number | undefined, waiting = false) =>
  waiting ? "Saving to Fuobe · waiting for the studio" : fraction !== undefined && fraction > 0 ? `Saving to Fuobe · ${Math.min(100, Math.floor(fraction * 100))}%` : "Saving to Fuobe";

/** The server's words that say something is wrong (the tab shows them over its own). */
const PROBLEM = (server: string | undefined) =>
  !!server && [RELAY_WORDS.comfyDown, RELAY_WORDS.comfyNoSetting, RELAY_WORDS.resent, RELAY_WORDS.noComputer].includes(server as never);

/**
 * A run's words in the tab that runs its job (lib/computer-runner.ts's LocalJob), at once: the server's own say the same
 * a poll later. ComfyUI here not answering, or answering without Fuobe's setting (`comfy`), says so whatever the job's
 * phase until its results are saving. Sending keeps the server's words when they name what is sent or what is wrong;
 * done says it is saving until the run's own status moves on; failed leaves the last word to the server.
 */
export function jobWords(
  job: { phase: "sending" | "queued" | "running" | "saving" | "done" | "failed"; position?: number; value?: number; max?: number; saved?: number; waiting?: boolean },
  kind: MadeKind,
  server: string | undefined,
  comfy: "ok" | "down" | "no-setting" = "ok",
): string | undefined {
  if (comfy !== "ok" && job.phase !== "saving" && job.phase !== "done" && job.phase !== "failed") return comfy === "down" ? RELAY_WORDS.comfyDown : RELAY_WORDS.comfyNoSetting;
  switch (job.phase) {
    case "sending":
      return server?.startsWith("Sending your") || PROBLEM(server) ? server : RELAY_WORDS.starting;
    case "queued":
      return queueWords(job.position);
    case "running":
      return makingWords(kind, job.value, job.max);
    case "saving":
      return savingWords(job.saved, job.waiting);
    case "done":
      return savingWords(1);
    default:
      return server;
  }
}

/** "30 minutes", "4 hours", "1 hour". */
export function duration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes % 60 === 0) return minutes === 60 ? "1 hour" : `${minutes / 60} hours`;
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export const RELAY_WORDS = {
  noComputer: "Open Fuobe on the computer with your ComfyUI to run this",
  starting: "Starting on your computer",
  waitedTooLong: (ms: number) => `Fuobe couldn't reach your computer for ${duration(ms)}. Open Fuobe there, then press Retry.`,
  computerSilent: "Your computer stopped answering. If ComfyUI finished, open Fuobe there and press Retry.",
  comfyDown: "ComfyUI isn't answering. Start it again, and Fuobe goes on by itself.",
  comfyNoSetting: "ComfyUI is running, but Fuobe can't use it yet. Install Fuobe Connect in ComfyUI, and Fuobe goes on by itself.",
  comfyDownTooLong: "ComfyUI didn't come back within 30 minutes. Start it, then press Retry.",
  resent: "ComfyUI restarted, so Fuobe sent it again",
  lost: "ComfyUI restarted and lost this run. Press Retry.",
  outOfMemory: "Your GPU ran out of memory. Try a smaller size or a shorter clip.",
  tooBig: "Your ComfyUI made a file over 1 GB. Try a shorter clip or a lower size.",
  stopped: "Stopped",
  switched: "This run stopped because ComfyUI now runs somewhere else. Press Retry.",
  disconnected: "You disconnected your computer, so this run stopped. Press Retry.",
  /** A run sent to the computer whose Fuobe tab stopped answering (closed, asleep): it goes on once that tab is back. */
  computerAway: "Waiting for your computer. Open Fuobe there to finish this run.",
  /** A run waiting for a ComfyUI paired with a code (Fuobe Connect runs inside it, no tab needed) that is off. */
  pairedAway: "Waiting for your paired ComfyUI. Start ComfyUI there (or start your pod), and this run goes on by itself.",
  pairedWaitedTooLong: (ms: number) => `Your paired ComfyUI didn't come online for ${duration(ms)}. Start it, then press Retry.`,
} as const;

/**
 * What a run on this install's GPUs (hosted runs) shows an account: in line (with its place and wait, the row's queue
 * block), working on it, then its result. Every recovery (a worker that paused, went quiet or restarted, a retry) is
 * "in line" again in the same place. A run that can't finish says one plain sentence; the technical reason is kept for
 * the owner only.
 */
export const POOL_WORDS = {
  inLine: "In line",
  working: "Working",
  failed: "This one couldn't be made.",
} as const;

/** A script's open-source run (an API token) while the owner's ComfyUI is on the owner's computer. */
export const RUNS_ON_COMPUTER_NOTE = "Runs when Fuobe is open on your computer.";

/** The words for a tab's own failure. */
export function tabFailureWords(reason: TabFailure, status?: number, plain = false): string {
  switch (reason) {
    case "input-too-big":
      return "Your ComfyUI refused a file as too large. Start ComfyUI with a higher --max-upload-size, or use a smaller file.";
    case "input-changed":
      return "A file for this run didn't arrive whole. Press Retry.";
    case "unsafe-graph":
      return "Your browser stopped this run: it asked ComfyUI for files Fuobe didn't send. Press Retry.";
    case "output-missing":
      return "Your ComfyUI no longer has this run's result. Press Retry.";
    case "save-failed":
      return "Saving the result to Fuobe failed three times. Check your connection, then press Retry.";
    case "unknown-node":
      return "The GPU that took this run refused it: it uses a node that GPU doesn't allow.";
    case "unsafe-path":
      return "The GPU that took this run refused it: it names a file path.";
    case "model-unverified":
      return "The GPU that took this run refused it: it needs a model file that GPU couldn't verify.";
    case "input-crashed":
      return "This run couldn't finish with these files or settings.";
    case "input-unreadable":
      return "A clip or sound in this run couldn't be read.";
    case "bad-ticket":
      return "This run couldn't be made with these settings.";
    case "unsafe-model":
      return "This 3D model couldn't be opened for the web, so it is kept as it is.";
    case "finish-failed":
      return "This run couldn't finish.";
    default:
      // An account reads no status code: its ComfyUI couldn't take the run, and what helps.
      return plain ? "Your ComfyUI couldn't take this run. Restart ComfyUI, then press Retry." : `Your ComfyUI answered HTTP ${Number.isInteger(status) ? status : "?"}. Check that it's running, then press Retry.`;
  }
}
