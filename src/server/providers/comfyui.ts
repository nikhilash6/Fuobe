import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { ComposeError, composeWorkflow, withoutSaveMetadata, type ComposedPrompt, type ComposeRequest } from "@/lib/comfy-compose";
// The composer's helpers, where the server and its tests have always found them.
export { mediaKeys, TILED_SONG_SECONDS, viewSlots, withoutAnchor, withoutSaveMetadata } from "@/lib/comfy-compose";
import { nanoid } from "nanoid";
import { alphaBBox, explainComfyError, parseCueLines, randomSeed, type ComfyWorkflow, type Manifest, type ManifestOutput, type ManifestWorkflow } from "@/lib/comfy";
import { IDOL_PACK, IDOL_PACK_CLASS, IDOL_WORKFLOWS, idolKept } from "@/lib/av/model3d";
import { IDOL_VIEWS_WORKFLOW, idolViewMeta } from "@/lib/av/idol-views";
import { mergeScanReports, qualityOf } from "@/lib/watermark";
import { H3_LATENT_DRAFT_WORKFLOW, REGEN_COPY, REGEN_LATENT_WORKFLOW, REGEN_WORKFLOW } from "@/lib/catalog/regenerate";
import { fixFromPromptError } from "@/lib/gpu/fix-codes";
import { loadIndex } from "../gpu/index-file";
import type { FileNeed } from "@/lib/lanes";
import { graphLoraNames, runtimeNeeds } from "@/lib/runtime-files";
import { installedDbs, type DbsModel } from "@/lib/av/split";
import { installedReuse, type ReuseModel } from "@/lib/av/clean-voice";
import { RTX_FRAMEGEN_WORKFLOW, RTX_HDR_WORKFLOW, RTX_MISSING } from "@/lib/catalog/rtx-video";
import { RTX_UPSCALE_WORKFLOW } from "@/lib/av/video-finish";
import { guessKind } from "@/lib/catalog/payload";
import { loraByFile, needsToken } from "@/lib/catalog/loras";
import { CONTEXT_LOOP_IDS, runName } from "@/lib/openjutsu-graphs";
import { reuseOf, reviewOfRun } from "@/lib/catalog/remove-object";
import { H3_REMOVAL_WORKFLOW } from "@/lib/catalog/character-swap";
import type { GenInput, MediaKind, ModelRoute, Operation } from "@/lib/catalog/types";
import { imageSize, orientedImageSize } from "@/lib/image-size";
import { probeMedia, type MediaInfo } from "@/lib/media-probe";
import { ocrText, parseOcrFrame, parseOcrLines, type OcrFrame } from "@/lib/ocr";
import { getSetting, isCandidate, savedSetting } from "../settings";
import { decodePng } from "../png";
import { pictureWithoutMetadata } from "../media-clean";
import { probeAvi } from "../avi-probe";
import { probeWebm } from "../webm-probe";
import { adoptFile, contentTypeFor, readRef, saveFile, scratchDir } from "../storage";
import { CONNECT_GPU_MESSAGE } from "@/lib/guest-access";
import { addressKind } from "@/lib/page-place";
import { graphProblem } from "@/lib/local-comfy";
import { runStamp } from "../run-stamp";
import { discardBody, fetchPublic, peekText, RemoteFetchError } from "../remote-fetch";
import { zipToFile } from "../zip";
import { ACCOUNT_LIMITS, ACCOUNT_MESSAGES, accountTotalBytes, accountUsage, diskFloorBytes, diskFreeBytes, diskHasRoom, filesFullMessage } from "../account-files";
import { accountSend } from "../account-send";
import { redactKey } from "../provider-keys";
import { outsideTenant, runAsTenant, tenantAccount } from "../tenant";
import { ask, checkReach, reachSync, sharedCheck, type Reach } from "./reach";
import { ProviderError, type PollResult, type ProviderAdapter, type RemoteOutput } from "./types";
import { isOutOfMemory } from "@/lib/gpu/fix-codes";
import { diagnoseGpu, diagnoseGpuJob, diagnoseRefusal, isLoaderNode, loaderFiles, MODEL_FILE, modelFileProblem, type Diagnosis, type GpuFailure, type GpuJobTrouble, type GpuPlace, type GpuStage } from "@/lib/diagnose";
import { hfPage } from "@/lib/gpu/plan";
import { fileTitle } from "@/lib/gpu/readiness";
import { formatBytes } from "@/lib/gpu/requirements";
import type { FileKey } from "@/lib/gpu/types";
import {
  makingWords,
  META_BATCH_HISTORY,
  POOL_WORDS,
  queueWords,
  RELAY_TIMES,
  RELAY_WORDS,
  savingWords,
  sendingWords,
  tabFailureWords,
  type ComputerFacts,
  type HistoryEntryLike,
  type TabFailure,
  type WantedFile,
} from "@/lib/relay";
import type { GenerationFix } from "@/lib/catalog/types";
import {
  checkClocks,
  createTask,
  extraOf,
  inputKinds,
  ownTask,
  receivedFile,
  freeInputs,
  receivedOf,
  refusalOf,
  pairedRunner,
  requestStop,
  resultOf,
  runnerFacts,
  stageInput,
  stagedInput,
  taskProgress,
  type FinishedPlan,
  type Principal,
  type TaskRow,
} from "../computer/tasks";
import { attemptDeadline, poolFacts, poolFields, poolLane, poolWaitMs, poolWaitWords, runPlaceOf, workersCanRun } from "../computer/pool";
import { catalogVersion } from "../computer/catalog-version";
import { ticketProblem, type JobTicket } from "@/lib/job-ticket";
import { catalogKnows, ticketFor } from "@/lib/ticket-compose";
import { ownerWaitMs } from "../queue-settings";
import { worldcastBase, worldcastHealth } from "../worldcast";

export const WORKFLOW_DIR = path.join(process.cwd(), "workflows", "comfyui");

let manifestCache: { mtime: number; manifest: Manifest } | null = null;

export function loadManifest(): Manifest {
  const file = path.join(WORKFLOW_DIR, "manifest.json");
  if (!fs.existsSync(file)) return { version: 1, generatedAt: "", workflows: [] };
  const mtime = fs.statSync(file).mtimeMs;
  if (!manifestCache || manifestCache.mtime !== mtime) {
    manifestCache = { mtime, manifest: JSON.parse(fs.readFileSync(file, "utf8")) as Manifest };
  }
  return manifestCache.manifest;
}

export function getWorkflow(id: string): { manifest: ManifestWorkflow; workflow: ComfyWorkflow } {
  const manifest = loadManifest().workflows.find((w) => w.id === id);
  if (!manifest) throw new ProviderError(`Workflow "${id}" is not in workflows/comfyui/manifest.json`);
  const workflow = JSON.parse(fs.readFileSync(path.join(WORKFLOW_DIR, manifest.file), "utf8")) as ComfyWorkflow;
  return { manifest, workflow };
}

/**
 * Which ComfyUI runs a workflow: the main server, or the isolated worker — a second ComfyUI with its own
 * code copy and virtualenv for node packs that change process-wide state or pin old packages (LatentSync
 * 1.6, ThinkSound; manifest `worker: "isolated"`, scripts/comfy/README.md). Both take the same token.
 */
export type ComfyWorker = "main" | "isolated";

/** Where the isolated worker's address is set, for messages. */
export const ISOLATED_SETTING = "Settings → Open-source engine · ComfyUI → Isolated worker URL";

// ---------------------------------------------------------------------------
// An account's own ComfyUI (public sign-up, "Your GPU")

/**
 * Where an account's run goes: its own ComfyUI at a public address (a link: a tunnel), with its own token; or the
 * ComfyUI on the person's own computer ("computer"), which only their Fuobe tab reaches (src/server/computer).
 */
export type OwnGpu = { kind?: "link"; url: string; token?: string } | { kind: "computer"; principal: `acct:${string}` };

const ownGpuStore = new AsyncLocalStorage<OwnGpu>();

/**
 * Run `fn` on an account's own ComfyUI: every ComfyUI call inside (uploads, the prompt, polls, outputs)
 * goes to `gpu` through fetchPublic, which connects only to public addresses, so it can't reach the
 * install's own ComfyUI, even when the account's name is re-pointed at this machine. The install's
 * address and token are never used. Without a socket: progress comes from polling. On the account's own
 * computer, every ComfyUI job becomes a task its Fuobe tab runs, and nothing is fetched from here.
 */
export function onOwnGpu<T>(gpu: OwnGpu, fn: () => T): T {
  return ownGpuStore.run(gpu.kind === "computer" ? { kind: "computer", principal: gpu.principal } : { url: gpu.url.replace(/\/+$/, ""), token: gpu.token }, fn);
}

/** Inside onOwnGpu: the account's ComfyUI. */
export const ownGpu = (): OwnGpu | undefined => ownGpuStore.getStore();

/** Run `fn` outside any account's ComfyUI (the install's own again). */
export const outsideOwnGpu = <T,>(fn: () => T): T => ownGpuStore.exit(fn);

/**
 * The ComfyUI in scope runs on someone's own computer, reached only through their Fuobe tab: whose (an account's
 * "acct:<id>", or the owner's when Settings says ComfyUI runs on the owner's computer), else undefined.
 */
export function computerScope(): Principal | undefined {
  const own = ownGpu();
  if (own) return own.kind === "computer" ? own.principal : undefined;
  // An account's run on this install's workers: its jobs are tasks for the workers, as the account's own.
  if (poolScope.getStore()) {
    const account = tenantAccount();
    return account ? `acct:${account}` : undefined;
  }
  if (serverScope.getStore()) return undefined;
  const where = getSetting("comfyWhere");
  // Workers (docs/gpu-workers.md) take the owner's jobs the way the owner's own computer would: staged here, run there.
  return where === "computer" || where === "workers" ? "owner" : undefined;
}

/**
 * The jobs of this principal go to the workers: the owner's while Settings says ComfyUI runs on "workers", and an
 * account's run on this install's GPUs then (never one computer's tab).
 */
const onWorkers = (computer: Principal | undefined) => {
  if (!computer || ownGpu()) return false;
  if (computer === "owner") return getSetting("comfyWhere") === "workers";
  return !!poolScope.getStore() && computer.startsWith("acct:");
};

/**
 * What a computer's jobs are shaped by (its VRAM, RAM, device, LoRA files): what its tab last said. An account's run on
 * the workers reads theirs instead (those allowed the workflow's lane), never the account's own computer.
 */
function factsOf(computer: Principal, endpoint?: string): ComputerFacts | null {
  if (computer !== "owner" && onWorkers(computer)) return poolFacts(endpoint && !endpoint.includes("{") ? poolLane(endpoint) : null);
  return runnerFacts(computer);
}

/** Inside a run on this install's GPUs (hosted runs): the account's jobs are tasks for the workers. */
export const onPoolWorkers = (): boolean => !!poolScope.getStore();

/**
 * Which ComfyUI a job in this scope runs on, as a name two runs are compared by (MiniMax H3's 2K finish loads the latent
 * its draft saved only on the ComfyUI that saved it): an account's link or computer, the owner's computer, or this
 * install's server. null where nothing stays between jobs: the owner's workers empty their output folder after each one.
 */
export function comfyPlace(): string | null {
  const own = ownGpu();
  if (own) return own.kind === "computer" ? `computer:${own.principal}` : own.url ? `link:${own.url}` : null;
  const computer = computerScope();
  if (computer) return onWorkers(computer) ? null : `computer:${computer}`;
  const url = getSetting("comfyUrl").replace(/\/+$/, "");
  return url ? `server:${url}` : null;
}

/**
 * FUOBE_POOL_MEDIA_INPUTS: what a job for workers may send them ("image" unless set; "image,video,audio" for all).
 * Pictures are always made again from their pixels first (no EXIF, no GPS, nothing a decoder on that PC could trip on).
 */
const poolMedia = () => new Set((process.env.FUOBE_POOL_MEDIA_INPUTS ?? "image").split(",").map((s) => s.trim()).filter(Boolean));

/** May a job for workers send them files of this kind ("image", "video", "audio")? */
export const workersTake = (kind: "image" | "video" | "audio"): boolean => poolMedia().has(kind);

/**
 * A file for a job on the workers: refused when they don't take its kind. A picture is made again from its pixels here
 * (no EXIF, no GPS), unless `o.onWorker`: then the worker makes it again itself before its ComfyUI reads it, and this
 * server only checks that it is a picture it can size, blanks what it carries besides its pixels (EXIF and GPS, XMP,
 * comments, thumbnails, text) without decoding it, and cuts off anything after the picture's end (a second picture, a
 * motion photo's clip): none of that ever leaves for a worker. A JPEG keeps its orientation. A kind of picture whose
 * such parts this server can't blank that way (a GIF, an SVG, an animated WebP, say) is made again from its pixels here.
 */
export async function forWorkers(data: Buffer, contentType: string, name: string, o: { onWorker?: boolean } = {}): Promise<{ data: Buffer; contentType: string; name: string }> {
  const kind = contentType.split("/")[0];
  if (!poolMedia().has(kind)) throw new ProviderError(kind === "video" ? "The shared GPUs don't take clips yet." : kind === "audio" ? "The shared GPUs don't take sound yet." : "The shared GPUs don't take this kind of file.");
  if (kind !== "image") return { data, contentType, name };
  const refused = () => new ProviderError("The shared GPUs don't take this kind of file.");
  if (o.onWorker) {
    if (!imageSize(data)) throw refused();
    const clean = pictureWithoutMetadata(data);
    if (clean) return { data: clean, contentType, name };
  }
  const sharp = (await import("sharp")).default;
  const png = await sharp(data, { failOn: "error", limitInputPixels: 64 * 2 ** 20 })
    .rotate()
    .png()
    .toBuffer()
    .catch((e: unknown) => {
      if (o.onWorker) throw refused();
      throw e;
    });
  return { data: png, contentType: "image/png", name: name.replace(/\.[^.]*$/, "") + ".png" };
}

/**
 * A run on this install's own ComfyUI server (an account's run on this install's GPUs, or one the owner sent there
 * before Settings moved ComfyUI): the names of the files this run uploaded there, so its graph is checked to read
 * only those (never another run's leftovers in the same input folder).
 */
const serverScope = new AsyncLocalStorage<{ uploads: Set<string> }>();

/** An account's run on this install's workers (hosted runs while Settings says ComfyUI runs on "workers"). */
const poolScope = new AsyncLocalStorage<true>();

/**
 * Run `fn` on this install's own ComfyUI server, whatever Settings says now: a run sent there before ComfyUI moved (to a
 * computer, or to the workers) is followed and stopped there.
 */
const onInstallServer = <T,>(fn: () => T): T => poolScope.exit(() => serverScope.run({ uploads: new Set() }, fn));

/**
 * Run `fn` as a run on this install's GPUs (hosted runs, src/server/hosted.ts), never an account's own GPU and never a
 * computer's tab. While Settings says ComfyUI runs on "workers", each job is a task for the workers that belongs to the
 * account (staged here, run there, as the owner's jobs are). Otherwise the install's own ComfyUI server, which then must
 * be on this machine (installComfyLocal).
 */
export const onInstallComfy = <T,>(fn: () => T): T => outsideOwnGpu(() => (getSetting("comfyWhere") === "workers" ? serverScope.exit(() => poolScope.run(true, fn)) : onInstallServer(fn)));

/**
 * The install's own ComfyUI address is on this machine (loopback). Runs of accounts on this install's GPUs go straight
 * to it only then: an address elsewhere would send accounts' files and prompts over a network to a ComfyUI nothing
 * cleans, and its errors would name it.
 */
export function installComfyLocal(worker: ComfyWorker = "main"): boolean {
  const url = getSetting(worker === "isolated" ? "comfyIsolatedUrl" : "comfyUrl").trim();
  return !!url && addressKind(url) === "loopback";
}

/** Said when a run on this install's GPUs can't go where it was planned (its row's own words then say it plainly). */
export const POOL_NOT_LOCAL = "This install's ComfyUI address isn't on this machine, so runs of accounts don't go to it.";

/**
 * Where an account's job waits in line on the workers, in its run's class (paid before free). Its run's first job: at
 * the time it came (with the billing service's head start), with the run's wait limit. A later job of the same run (a
 * chain's next step, sent once the steps before it are done): at the run's place (pool.ts runPlaceOf), and with no wait
 * limit (the run was taken in line once; the wait limit applies only before its first start). The run's wait limit is
 * the one stamped on it (0: as long as it takes), else the install's own (FUOBE_POOL_WAIT_MIN).
 */
function accountPoolFields(workflowId: string, account: string, generationId: string | undefined, o: { size: NonNullable<Parameters<typeof poolFields>[1]>["size"]; catalogVersion?: string; runtime?: FileNeed[] }) {
  const stamp = runStamp();
  const run = generationId ? runPlaceOf(generationId) : null;
  // A run that waited to enter the line (pool-holds.ts) enters where its release says (stamp.rankAt): for the system's
  // reasons (the day's GPU time, a quiet service) at its press, behind its own runs at the time it is sent; with its
  // head start. Only while no job of its run has a place yet.
  const pressed = !run?.placed && stamp?.rankAt !== undefined ? stamp.rankAt - Math.max(0, Math.min(stamp.boostMs ?? 0, 24 * 60 * 60_000)) : undefined;
  return poolFields(workflowId, {
    account,
    class: stamp?.class ?? "free",
    boostMs: stamp?.boostMs,
    ...(run?.rankAt != null && { rankAt: run.rankAt }),
    ...(pressed !== undefined && { rankAt: pressed }),
    waitMs: run?.started || run?.later ? undefined : (stamp?.waitMs ?? poolWaitMs()),
    size: o.size,
    catalogVersion: o.catalogVersion,
    runtime: o.runtime,
  });
}

/** Said to the owner when a job is larger than every worker's PC may ever run (its ceiling: `fuobe worker setup`). */
export const NO_WORKER_FOR_SIZE = "No worker may run a job this large: each PC's limits, set with fuobe worker setup, are lower. Pick a smaller size, a shorter clip or fewer results.";

/** Said to an account when its run is larger than this install's GPUs ever make (refused before it is queued). */
export const POOL_TOO_BIG = "This size isn't offered here yet. Pick a smaller size, a shorter clip or fewer results.";

/**
 * Said to the owner when no worker that may run the job's workflow verified a file the job adds at run time (a look's or
 * a motion's LoRA), naming the files.
 */
export const noWorkerForFiles = (files: readonly string[]): string =>
  `No worker has ${files.length > 1 ? "these files" : "this file"} yet: ${files.join(", ")}. Put ${files.length > 1 ? "them" : "it"} in a worker's loras folder (a library LoRA is verified by its pinned size and SHA-256), then run it again.`;

/** Said to an account when its run adds a file no GPU here verified (refused before it is queued; the price check said so first). */
export const POOL_NO_FILES = "This style runs on your own GPU. Connect your GPU to use it, or pick another one.";

/** Said to the owner when no worker is allowed the lane of a job sent to the workers. */
export const NO_WORKER_FOR_LANE = "No worker can run this model yet. Allow its lane for a worker that has its model files, in Settings → Open-source engine · ComfyUI → Workers.";


/**
 * Whose computer a run sent there belongs to, whatever ComfyUI's place is now: the account's (as its tenant), or the
 * owner's.
 */
function relayPrincipal(): Principal {
  const account = tenantAccount();
  return account ? `acct:${account}` : "owner";
}

/**
 * Said when a workflow for the isolated worker (LatentSync 1.6, ThinkSound) would go to someone's computer: it needs a
 * second ComfyUI beside the first, which the tab doesn't reach yet. Refused before anything is staged or queued.
 */
export const ISOLATED_ON_COMPUTER = "This one needs its own ComfyUI, so it can't run from your computer next to your other add-ons.";

/** Said when something would call a ComfyUI that only the person's own tab may reach. */
export const ON_COMPUTER_ONLY = "This ComfyUI is on your own computer: only your Fuobe tab there talks to it.";

/** The most an account's ComfyUI may send back for one output file, and how long it may take. */
export const OWN_OUTPUT_LIMITS = { maxBytes: 2 ** 30, deadlineMs: 15 * 60_000 };

/**
 * A result a computer sent in (relay:<task>/view?…&n=…): the file its task received, for that task's principal only:
 * whose run this is (an account, as its tenant; else the owner), whatever ComfyUI's place is now, as poll and cancel.
 */
export function relayFile(url: string): { path: string; contentType?: string } | null {
  const principal = relayPrincipal();
  const m = /^relay:([A-Za-z0-9_-]{16})\/view\?(.*)$/.exec(url);
  const n = m ? Number(new URLSearchParams(m[2]).get("n")) : NaN;
  return principal && m && Number.isInteger(n) ? receivedFile(principal, m[1], n) : null;
}

/** A computer's result as a fetch() answer (bundleFrames and the layer boxes read results this way). */
function relayResponse(url: string): Response {
  const file = relayFile(url);
  if (!file) return new Response("Not found", { status: 404 });
  const stream = Readable.toWeb(fs.createReadStream(file.path)) as ReadableStream<Uint8Array>;
  return new Response(stream, { headers: { "content-type": file.contentType ?? "application/octet-stream", "content-length": String(fs.statSync(file.path).size) } });
}

/** fetch() for a provider's file: through fetchPublic on an account's own ComfyUI (1 GB and 15 minutes at most, or less). */
export function outputFetch(url: string, init: RequestInit = {}, o: { maxBytes?: number } = {}): Promise<Response> {
  if (url.startsWith("relay:")) return Promise.resolve(relayResponse(url));
  if (!ownGpu()) return fetch(url, init);
  const maxBytes = Math.max(1, Math.min(OWN_OUTPUT_LIMITS.maxBytes, o.maxBytes ?? Infinity));
  return fetchPublic(url, init, { timeoutMs: 120_000, ...OWN_OUTPUT_LIMITS, maxBytes });
}

/** An account's ComfyUI: one EXR frame, at most. */
export const OWN_FRAME_MAX_BYTES = 100 * 2 ** 20;

/**
 * What an account's ComfyUI may answer, by path: a file (/view) up to 1 GB in 15 minutes; an upload's answer 1 MB, in
 * the time sending its file takes at a slow 128 KB/s plus a minute (5 to 30 minutes: the time covers sending the file);
 * the node list (/object_info) 64 MB in 2 minutes; anything else 8 MB in 60 seconds. A slow or endless answer can't
 * hold the server.
 */
export function ownGpuLimits(p: string, bytes = 0): { maxBytes: number; deadlineMs: number } {
  const at = p.split("?")[0];
  if (at.startsWith("/view")) return OWN_OUTPUT_LIMITS;
  if (at.startsWith("/upload/")) return { maxBytes: 2 ** 20, deadlineMs: uploadDeadlineMs(bytes) };
  if (at.startsWith("/object_info")) return { maxBytes: 64 * 2 ** 20, deadlineMs: 2 * 60_000 };
  return { maxBytes: 8 * 2 ** 20, deadlineMs: 60_000 };
}

/** How long sending a file of `bytes` to an account's ComfyUI may take: 128 KB/s plus a minute, between 5 and 30 minutes. */
export function uploadDeadlineMs(bytes: number): number {
  return Math.min(30 * 60_000, Math.max(5 * 60_000, Math.ceil((Math.max(0, bytes) / (128 * 1024)) * 1000) + 60_000));
}

/** A job id as ComfyUI gives it (a UUID): anything else from an account's ComfyUI is refused, never put in a path. */
export const PROMPT_ID = /^[\w-]{1,64}$/;

function baseUrl(worker: ComfyWorker = "main"): string {
  const own = ownGpu();
  if (own) return own.kind === "computer" ? "" : own.url;
  // A run on this install's workers never has an address of its own (its jobs are tasks for the workers).
  if (computerScope() || onPoolWorkers()) return "";
  return getSetting(worker === "isolated" ? "comfyIsolatedUrl" : "comfyUrl").replace(/\/+$/, "");
}

/** The worker a workflow runs on. */
export function workerFor(endpoint: string | undefined): ComfyWorker {
  return endpoint && loadManifest().workflows.find((w) => w.id === endpoint)?.worker === "isolated" ? "isolated" : "main";
}

/** A ComfyUI address as compared: no trailing slash. */
const sameAddress = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

function authHeaders(worker: ComfyWorker = "main"): Record<string, string> {
  const own = ownGpu();
  if (own) return own.kind !== "computer" && own.token ? { Authorization: `Bearer ${own.token}` } : {};
  if (computerScope()) return {};
  // Save & test of an address that isn't the saved one: the saved token stays with the server it
  // was saved for. Only a token typed for this test goes to the new address.
  const address = worker === "isolated" ? "comfyIsolatedUrl" : "comfyUrl";
  if (isCandidate(address) && !isCandidate("comfyToken") && !sameAddress(getSetting(address), savedSetting(address))) return {};
  const t = getSetting("comfyToken");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** An account's saved address in scope (its own GPU at a web address), as diagnose.ts reads it; null anywhere else. */
export function ownLink(): { kind: "link"; url: string; hasToken: boolean } | null {
  const own = ownGpu();
  return own && own.kind !== "computer" && own.url ? { kind: "link", url: own.url, hasToken: !!own.token } : null;
}

/** Which step of a run asked the account's GPU, by path. */
const stageOf = (p: string): GpuStage => {
  const at = p.split("?")[0];
  return at.startsWith("/upload/") ? "upload" : at === "/prompt" ? "prompt" : at.startsWith("/view") ? "result" : at === "/system_stats" ? "status" : "poll";
};

/**
 * An account's GPU that didn't answer as ComfyUI: the run's error in plain words, with what helps (`trouble`), which the
 * runner keeps with the run (generations.ts) and uses to wait out a GPU that is off or starting up. `failure`: what came
 * back, so the status strip can say the same in its own words.
 */
export function troubleError(d: Diagnosis, status?: number, failure?: GpuFailure): ProviderError & { trouble: Diagnosis; failure?: GpuFailure } {
  return Object.assign(new ProviderError(d.words, status), { trouble: d, ...(failure && { failure }) });
}

/** What came back from an account's link, read for the person (diagnose.ts), as the run's error. Its token never in it. */
const gpuTrouble = (f: GpuFailure, place: Parameters<typeof diagnoseGpu>[1]) => {
  const own = ownGpu();
  const token = own && own.kind !== "computer" ? own.token : undefined;
  const clean = token ? withoutToken(f, token) : f;
  return troubleError(diagnoseGpu(clean, place), clean.status, clean);
};

/** What came back, with a token it echoed taken out (a page that repeats the request's headers). */
export function withoutToken(f: GpuFailure, token: string): GpuFailure {
  const out = (t: string | undefined) => (t === undefined ? t : redactKey(t, token));
  return { ...f, body: out(f.body), error: out(f.error), location: out(f.location) };
}

/** An answer from an account's link that isn't what was asked: read for the person (its body's first KB, for details). */
async function linkAnswer(res: Response, f: Omit<GpuFailure, "status" | "body" | "contentType" | "location" | "retryAfterS">, link: NonNullable<ReturnType<typeof ownLink>>): Promise<ProviderError> {
  // The start of an error page only, briefly: a body that never ends can't hold the run (its connection is let go).
  const body = res.status >= 300 && res.status < 400 ? "" : await peekText(res);
  discardBody(res);
  return gpuTrouble(
    {
      ...f,
      status: res.status,
      body,
      contentType: res.headers.get("content-type") ?? undefined,
      location: res.headers.get("location") ?? undefined,
      retryAfterS: Number(res.headers.get("retry-after")) || undefined,
    },
    link,
  );
}

async function comfyFetch(p: string, init: RequestInit = {}, worker: ComfyWorker = "main", o: { bytes?: number } = {}): Promise<Response> {
  // A ComfyUI on someone's own computer is never called from here: not the install's, not a link (every caller in that
  // scope goes through its task instead; this is the last guard). Nor is any from a run on this install's workers.
  if (computerScope() || onPoolWorkers()) throw new ProviderError(ON_COMPUTER_ONLY);
  const base = baseUrl(worker);
  if (ownGpu()) {
    // A visitor without a GPU of its own (a price check): nothing to reach, and never the install's.
    if (!base) throw new ProviderError(CONNECT_GPU_MESSAGE);
    try {
      // A connection that doesn't open in 15 s is a GPU that doesn't answer (the idle time, 2 minutes, is for a slow one).
      return await fetchPublic(`${base}${p}`, { ...init, headers: { "ngrok-skip-browser-warning": "1", ...authHeaders(worker), ...(init.headers ?? {}) } }, { timeoutMs: 120_000, connectTimeoutMs: 15_000, ...ownGpuLimits(p, o.bytes) });
    } catch (e) {
      // The account's words (a stopped pod, a GPU that doesn't answer…); the reason itself goes in the details line.
      throw gpuTrouble({ stage: stageOf(p), error: (e as Error).message, bytes: o.bytes }, ownLink() ?? { kind: "link", url: base });
    }
  }
  if (worker === "isolated" && !base) {
    throw new ProviderError(`This model runs on the isolated ComfyUI worker, which isn't set up yet: add its address in ${ISOLATED_SETTING} (or COMFYUI_ISOLATED_URL). scripts/comfy/README.md shows how to start one, usually on port 8189`);
  }
  try {
    return await fetch(`${base}${p}`, { ...init, headers: { ...authHeaders(worker), ...(init.headers ?? {}) } });
  } catch (e) {
    if (worker === "isolated") throw new ProviderError(`The isolated ComfyUI worker at ${base} doesn't answer (${(e as Error).message}). Start it (scripts/comfy/README.md) or check ${ISOLATED_SETTING}`);
    throw new ProviderError(`Can't reach ComfyUI at ${base} (${(e as Error).message}). Is it running?`);
  }
}

/**
 * A raw request to the ComfyUI in scope: the install's (its address and token), or an account's inside onOwnGpu.
 * The GPU pre-flight's reads go through it (src/server/gpu/target.ts).
 */
export function comfyRequest(p: string, init: RequestInit = {}, worker: ComfyWorker = "main"): Promise<Response> {
  return comfyFetch(p, init, worker);
}

/**
 * The isolated worker answered, but not with what was asked (an HTTP error, or a proxy's error page
 * when the worker behind it is down): say it's that server and where its address is set, so it doesn't
 * read like the main ComfyUI failed.
 */
function isolatedAnswer(what: string, status?: number, detail?: string): ProviderError {
  const said = status ? `HTTP ${status}` : "something that isn't JSON";
  return new ProviderError(
    `The isolated ComfyUI worker at ${baseUrl("isolated")} answered ${said} to ${what}${detail ? ` (${detail})` : ""} — check that it's running (scripts/comfy/README.md) and its address in ${ISOLATED_SETTING}`,
    status,
  );
}

/** A short reason from an error body: its text, unless it's an HTML error page. */
const reasonOf = (text: string) => (/^\s*</.test(text) ? "" : text.trim().slice(0, 200));

/** GET a ComfyUI JSON endpoint. A non-2xx answer or a body that isn't JSON (a proxy's error page) throws, so the runner retries. */
async function comfyJson<T>(p: string, worker: ComfyWorker = "main"): Promise<T> {
  const res = await comfyFetch(p, {}, worker);
  const path = p.split("?")[0];
  const link = ownLink();
  if (!res.ok) {
    // An account's link: what the answer means for the person (a stopped pod, a GPU starting up), not its status code.
    if (link) throw await linkAnswer(res, { stage: stageOf(p) }, link);
    discardBody(res);
    throw worker === "isolated" ? isolatedAnswer(path, res.status) : new ProviderError(`ComfyUI ${path} answered HTTP ${res.status}`, res.status);
  }
  const text = await res.text().catch(() => "");
  try {
    return JSON.parse(text) as T;
  } catch {
    if (link) throw gpuTrouble({ stage: stageOf(p), status: res.status, body: text.slice(0, 4096), contentType: res.headers.get("content-type") ?? undefined }, link);
    throw worker === "isolated" ? isolatedAnswer(path) : new ProviderError(`ComfyUI ${path} sent something that isn't JSON (a proxy error page?)`);
  }
}

// ---------------------------------------------------------------------------
// Live progress over the ComfyUI websocket (one connection per worker, reopened when its URL changes).

interface Progress {
  value: number;
  max: number;
  node?: string;
  nodesDone: number;
}

type ComfySocket = { url: string; ws: WebSocket; clientId: string; progress: Map<string, Progress> };

declare global {
  var __fuobeComfyWs: ComfySocket | undefined;
  /** The isolated worker's socket. */
  var __fuobeComfyWsIsolated: ComfySocket | undefined;
  /** Consecutive polls that found a prompt in neither the queue nor the history. */
  var __fuobeComfyMisses: Map<string, number> | undefined;
}

const socketOf = (worker: ComfyWorker) => (worker === "isolated" ? globalThis.__fuobeComfyWsIsolated : globalThis.__fuobeComfyWs);
function setSocket(worker: ComfyWorker, s: ComfySocket | undefined) {
  if (worker === "isolated") globalThis.__fuobeComfyWsIsolated = s;
  else globalThis.__fuobeComfyWs = s;
}

function ensureSocket(worker: ComfyWorker = "main"): { clientId: string; progress: Map<string, Progress> } {
  // An account's own ComfyUI: no socket (the install's stays as it is); its progress comes from polling, or from its tab.
  // Nor for a run on this install's workers (its jobs are tasks for them).
  if (ownGpu() || computerScope() || onPoolWorkers()) return { clientId: "fuobe-account", progress: new Map() };
  const url = baseUrl(worker);
  const cur = socketOf(worker);
  if (cur && cur.url === url && cur.ws.readyState <= 1) return cur;
  const clientId = cur?.clientId ?? `fuobe-${nanoid(8)}`;
  // Same server: keep the progress of prompts in flight. Another server: those prompt ids mean nothing there.
  const progress = cur && cur.url === url ? cur.progress : new Map<string, Progress>();
  if (cur) {
    // A new URL (or a dead socket): close the old connection so it stops writing into the progress map.
    cur.ws.onmessage = null;
    cur.ws.onerror = null;
    try {
      cur.ws.close();
    } catch {}
  }
  try {
    const ws = new WebSocket(`${url.replace(/^http/, "ws")}/ws?clientId=${clientId}`);
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return; // binary preview frames
      try {
        const msg = JSON.parse(ev.data) as { type: string; data: Record<string, unknown> };
        const pid = msg.data?.prompt_id as string | undefined;
        if (!pid) return;
        const p = progress.get(pid) ?? { value: 0, max: 0, nodesDone: 0 };
        if (msg.type === "progress") {
          p.value = Number(msg.data.value);
          p.max = Number(msg.data.max);
          p.node = String(msg.data.node ?? p.node ?? "");
        } else if (msg.type === "executing") {
          if (msg.data.node) {
            p.node = String(msg.data.node);
            p.nodesDone += 1;
            p.value = 0;
            p.max = 0;
          }
        }
        progress.set(pid, p);
      } catch {}
    };
    ws.onerror = () => {};
    setSocket(worker, { url, ws, clientId, progress });
  } catch {
    setSocket(worker, undefined);
  }
  return { clientId, progress };
}

/** Forget a finished prompt's progress and missed-poll count. */
function forget(promptId: string) {
  globalThis.__fuobeComfyWs?.progress.delete(promptId);
  globalThis.__fuobeComfyWsIsolated?.progress.delete(promptId);
  globalThis.__fuobeComfyMisses?.delete(promptId);
}

/**
 * A job's place in ComfyUI's queue (`/queue` queue_pending): how many jobs go before it (0: next), or -1 when it isn't
 * there. The list is ComfyUI's heap, not in order: the jobs before it are the ones with a lower number.
 */
export function queuePlace(pending: unknown[][], promptId: string): number {
  const mine = pending.find((q) => q[1] === promptId);
  if (!mine) return -1;
  const n = mine[0];
  if (typeof n !== "number") return pending.indexOf(mine);
  return pending.filter((q) => typeof q[0] === "number" && q[0] < n).length;
}

/**
 * A running job's progress (0 to 0.99), or undefined when nothing says yet: the share of the graph's nodes run so far
 * (`nodesDone` of `total`, the running node counting as part done by its steps), and never less than the running
 * node's own steps (`value` of `max`). The sampler takes most of a job's time while it is one node of many, so step 3
 * of 8 shows as 3/8, not 3/8 of one node's share.
 */
export function runProgress(p: { nodesDone?: number; value?: number; max?: number } | undefined, total: number): number | undefined {
  const stepFrac = p?.max ? Math.min(1, Math.max(0, (p.value ?? 0) / p.max)) : 0;
  const nodeFrac = total > 0 ? (Math.max(1, p?.nodesDone ?? 1) - 1 + stepFrac) / total : 0;
  const v = Math.min(0.99, Math.max(stepFrac, nodeFrac));
  return v > 0 ? v : undefined;
}

// ---------------------------------------------------------------------------
// Outputs

type HistoryFile = { filename: string; subfolder: string; type: string };
export type HistoryEntry = {
  prompt?: [number, string, ComfyWorkflow, ...unknown[]];
  status?: { status_str?: string; completed?: boolean; messages?: [string, Record<string, unknown>][] };
  outputs?: Record<string, Record<string, unknown>>;
};

/** A provider output that can also carry text (transcripts) and structured extras (cues, layer z/bbox, stems). */
export type ComfyOutput = RemoteOutput & { text?: string; meta?: Record<string, unknown> };

const isFile = (f: unknown): f is HistoryFile =>
  !!f && typeof f === "object" && typeof (f as HistoryFile).filename === "string" && typeof (f as HistoryFile).type === "string";

const MODEL3D_EXT = /\.(glb|gltf|obj|fbx|stl|usdz|ply)$/i;
const TEXT_EXT = /\.(txt|srt|vtt|json|md|csv)$/i;

function kindFor(filename: string, key: string, declared?: MediaKind): MediaKind {
  if (declared) return declared;
  if (MODEL3D_EXT.test(filename) || key === "3d") return "model3d";
  if (TEXT_EXT.test(filename)) return "text";
  return guessKind(filename, undefined, key === "gifs" || key === "videos" ? "video" : key);
}

const CONTENT_TYPES: Record<string, string> = {
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  // Gaussian splats: ComfyUI's /view serves them as application/octet-stream.
  ply: "model/ply",
  spz: "model/x-spz",
  ksplat: "model/x-ksplat",
  txt: "text/plain",
  srt: "application/x-subrip",
  vtt: "text/vtt",
  json: "application/json",
};

function textsOf(ui: Record<string, unknown> | undefined): string[] {
  return Array.isArray(ui?.text) ? (ui.text as unknown[]).filter((t): t is string => typeof t === "string") : [];
}

const dataUrl = (data: Buffer, contentType: string) => `data:${contentType};base64,${data.toString("base64")}`;

/**
 * Every file the prompt saved, declared output nodes first (in manifest order). Text outputs carry their
 * words (`text`) and parsed caption cues (`meta.cues`); a "language" output (PreviewAny) is folded into the
 * text outputs' meta; stems, roles and layer order (`meta.z`, `meta.name`) come from the manifest.
 */
export function collectOutputs(entry: HistoryEntry, manifest: ManifestWorkflow | undefined, base = "", headers: Record<string, string> = {}): ComfyOutput[] {
  const outputs = entry.outputs ?? {};
  const declared = manifest?.outputs ?? [];
  const declaredIds = declared.map((o) => o.node);
  const order = [...declaredIds.filter((id) => outputs[id]), ...Object.keys(outputs).filter((id) => !declaredIds.includes(id))];
  const language = declared
    .filter((o) => o.role === "language")
    .map((o) => textsOf(outputs[o.node])[0]?.trim())
    .find(Boolean);
  // Idol 3D: the clean graph's count of the Gaussians its prune kept (a PreviewAny "report") goes on the splat; the core
  // graph's splat says it wasn't pruned.
  const idolClean = manifest?.id === IDOL_WORKFLOWS.clean;
  const kept = idolClean ? declared.filter((o) => o.role === "report").map((o) => idolKept(textsOf(outputs[o.node])[0])).find((n) => n !== undefined) : undefined;
  const idolSplat = idolClean ? { pruned: true, ...(kept !== undefined && { kept }) } : manifest?.id === IDOL_WORKFLOWS.core ? { pruned: false } : undefined;
  // OCR: the size the model saw (a PreviewAny "frame") goes with the lines it read.
  const frame = declared
    .filter((o) => o.role === "frame")
    .map((o) => parseOcrFrame(textsOf(outputs[o.node]).join("\n")))
    .find(Boolean);
  // The Watermark Remover's verdict (QWMFinal's report, a PreviewAny): kept on the picture's meta, never a result of its own.
  const quality = declared
    .filter((o) => o.role === "quality")
    .map((o) => qualityOf(textsOf(outputs[o.node]).join("\n")))
    .find(Boolean);
  // The Watermark Remover's tile scans (the photo's four quarters): merged into the whole photo's report, never results.
  const tileSpecs = declared.filter((o) => o.role === "scan-tile");
  const tileReports = tileSpecs.map((o) => textsOf(outputs[o.node]).join("\n") || null);
  const files: ComfyOutput[] = [];
  const pick = (type: string) => {
    for (const nodeId of order) {
      const spec: ManifestOutput | undefined = declared.find((o) => o.node === nodeId);
      if (spec?.role === "language" || spec?.role === "frame" || spec?.role === "quality" || spec?.role === "scan-tile" || (idolClean && spec?.role === "report")) continue;
      const ui = outputs[nodeId] ?? {};
      const texts = textsOf(ui);
      const found: { key: string; f: HistoryFile }[] = [];
      for (const [key, val] of Object.entries(ui)) {
        if (!Array.isArray(val)) continue;
        for (const f of val) if (isFile(f) && f.type === type) found.push({ key, f });
      }
      // OCR lines (SaveText .json): the model's answer, read into lines with boxes.
      if (spec?.role === "lines" && texts.length) {
        if (type === "output") files.push(ocrOutput(texts.join("\n"), frame));
        continue;
      }
      // A text output with no file (PreviewAny): keep the words.
      if (!found.length && type === "output" && spec?.kind === "text" && texts.length) {
        const joined = texts.join("\n");
        const text = spec.role === "report" && tileSpecs.length ? (mergeScanReports(joined, tileReports) ?? joined) : joined;
        files.push(textOutput({ url: dataUrl(Buffer.from(text), "text/plain"), kind: "text", contentType: "text/plain" }, text, spec, language));
        continue;
      }
      found.forEach(({ key, f }, i) => {
        const kind = kindFor(f.filename, key, spec?.kind);
        const qs = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder ?? "", type: f.type });
        const ext = f.filename.split(".").pop()?.toLowerCase() ?? "";
        const o: ComfyOutput = { url: `${base}/view?${qs}`, kind, headers, ...(CONTENT_TYPES[ext] && kind !== "image" ? { contentType: CONTENT_TYPES[ext] } : {}) };
        if (kind === "text") {
          files.push(textOutput(o, texts[i] ?? (found.length === 1 ? texts.join("\n") : undefined), spec, language));
          return;
        }
        const meta: Record<string, unknown> = {};
        if (spec?.stem) meta.stem = spec.stem;
        if (spec?.role) meta.role = spec.role;
        // A splat says what it is (the viewer and the download name go by it): spz, ply or ksplat.
        if (spec?.role === "splat" && ext) meta.format = ext;
        if (spec?.role === "splat" && idolSplat) Object.assign(meta, idolSplat);
        // Qwen-Image-Layered saves its layers back to front.
        if (spec?.role === "layers") Object.assign(meta, { z: i, name: i === 0 ? "Background" : `Layer ${i}` });
        // Idol 3D's four views: one batch, front first, then the object's left, back and right (src/lib/av/idol-views.ts).
        if (spec?.role === "tiles" && manifest?.id === IDOL_VIEWS_WORKFLOW) Object.assign(meta, idolViewMeta(i));
        if (quality && kind === "image") meta.quality = quality;
        if (Object.keys(meta).length) o.meta = meta;
        files.push(o);
      });
    }
  };
  pick("output");
  if (!files.length) pick("temp");
  return files;
}

function textOutput(o: ComfyOutput, text: string | undefined, spec: ManifestOutput | undefined, language: string | undefined): ComfyOutput {
  const meta: Record<string, unknown> = {};
  if (spec?.role) meta.role = spec.role;
  if (text !== undefined) {
    const cues = parseCueLines(text);
    if (cues.length) meta.cues = cues;
  }
  if (language) meta.language = language;
  return { ...o, kind: "text", ...(text !== undefined ? { text } : {}), ...(Object.keys(meta).length ? { meta } : {}) };
}

/**
 * An OCR answer as Fuobe's OCR output (the shape Florence-2's cloud route gives): the lines as plain
 * text, `meta.lines` [{text, bbox: [x, y, w, h] 0–1}] and `meta.size`, the picture the model read. An
 * answer with no list in it keeps its words, with no lines and `meta.unreadable`.
 */
function ocrOutput(answer: string, frame: OcrFrame | undefined): ComfyOutput {
  const { lines, ok } = parseOcrLines(answer, frame);
  const text = ok ? ocrText(lines) : answer.trim();
  const size = frame?.width && frame.height ? [frame.width, frame.height] : undefined;
  return { url: dataUrl(Buffer.from(text), "text/plain"), kind: "text", contentType: "text/plain", text, meta: { lines, ...(size ? { size } : {}), ...(ok ? {} : { unreadable: true }) } };
}

/**
 * Layers: download each RGBA layer once, add its bounding box (from alpha) and hand the bytes on as a data URL. On an
 * account's ComfyUI nothing is downloaded or decoded here: decoding a big layer holds up the whole server (over a second
 * for 40 megapixels), so its layers stay links, saved later straight to disk (16 at most), without a box, as a cloud
 * provider's layers often are.
 */
async function withLayerBoxes(outputs: ComfyOutput[]): Promise<ComfyOutput[]> {
  if (ownGpu()) return outputs;
  const isLayer = (o: ComfyOutput) => o.kind === "image" && typeof o.meta?.z === "number" && !o.url.startsWith("data:");
  const box = async (o: ComfyOutput): Promise<ComfyOutput> => {
    try {
      const res = await outputFetch(o.url, { headers: o.headers });
      if (!res.ok) {
        discardBody(res);
        return o;
      }
      const data = Buffer.from(await res.arrayBuffer());
      const png = decodePng(data);
      const bbox = alphaBBox(png.data, png.width, png.height);
      const meta = { ...o.meta, bbox: bbox ?? [0, 0, 0, 0], width: png.width, height: png.height };
      return { ...o, url: dataUrl(data, "image/png"), contentType: "image/png", headers: undefined, meta };
    } catch {
      return o; // keep the layer without a box rather than failing the job
    }
  };
  return Promise.all(outputs.map((o) => (isLayer(o) ? box(o) : o)));
}

/**
 * An EXR export's frames (role "frames", one file per frame) are zipped into one stored file, one frame
 * in memory at a time, and ride along on the preview clip as meta.artifacts.exr (as LTX HDR's EXR zip
 * does on the cloud). Other outputs pass through.
 */
async function bundleFrames(outputs: ComfyOutput[], generationId: string): Promise<ComfyOutput[]> {
  const frames = outputs.filter((o) => o.meta?.role === "frames");
  if (!frames.length) return outputs;
  const rest = outputs.filter((o) => o.meta?.role !== "frames");
  const preview = rest.find((o) => o.kind === "video");
  if (!preview) throw new ProviderError("The EXR export finished without its preview clip");
  // An account's ComfyUI: a frame count that fits a clip, room on the server, 100 MB a frame, and no more in all than
  // the account's files have room for (3 GB).
  const account = ownGpu() ? tenantAccount() : undefined;
  let budget = Infinity;
  if (account) {
    if (frames.length > ACCOUNT_LIMITS.framesPerJob) throw new ProviderError(`Your ComfyUI made ${frames.length} EXR frames. A run on your GPU keeps up to ${ACCOUNT_LIMITS.framesPerJob}: export a shorter clip.`);
    if (!diskHasRoom()) throw new ProviderError(ACCOUNT_MESSAGES.diskLow);
    budget = accountTotalBytes(account) - accountUsage(account).total;
    if (budget <= 0) throw new ProviderError(filesFullMessage(account));
  }
  const dest = path.join(scratchDir(), `${generationId || nanoid(8)}-${nanoid(6)}.zip`);
  let total = 0;
  // Past what the account's files have room for: say that, not the size of one answer.
  const full = (e: unknown) => (account && budget - total < OWN_FRAME_MAX_BYTES && e instanceof RemoteFetchError && /^The answer was over/.test(e.message) ? new ProviderError(filesFullMessage(account)) : e);
  async function* files() {
    for (const [i, f] of frames.entries()) {
      let data: Buffer;
      try {
        const res = await outputFetch(f.url, { headers: f.headers }, account ? { maxBytes: Math.min(OWN_FRAME_MAX_BYTES, budget - total) } : {});
        if (!res.ok) {
          discardBody(res);
          throw new ProviderError(`ComfyUI answered HTTP ${res.status} for EXR frame ${i + 1}`);
        }
        data = Buffer.from(await res.arrayBuffer());
      } catch (e) {
        throw full(e);
      }
      total += data.length;
      yield { name: `frame_${String(i + 1).padStart(5, "0")}.exr`, data };
    }
  }
  try {
    await zipToFile(files(), dest);
  } catch (e) {
    fs.rmSync(dest, { force: true });
    throw e;
  }
  const zip = adoptFile({ from: dest, contentType: "application/zip", name: "exr-frames.zip", source: "generation", generationId: generationId || undefined });
  return rest.map((o) => (o === preview ? { ...o, meta: { ...o.meta, artifacts: { exr: zip.url }, frames: frames.length } } : o));
}

// ---------------------------------------------------------------------------
// Reachability: GET /system_stats by the busy-vs-down rules in ./reach (a late answer is busy when the server
// answered lately; else the longer look when its port takes a connection). A busy server keeps the RAM it last said.

declare global {
  /** Reachability of the ComfyUI server, its RAM (bytes) when /system_stats said, when it last answered, and when a longer look last went unanswered. */
  var __fuobeComfyReach: (Reach & { ram?: number }) | undefined;
}

/** What GET /system_stats got: an answer (with the RAM it says), a no (an HTTP error, a refused connection), or nothing in time. */
function askComfy(url: string, timeoutMs: number) {
  return ask<number>(`${url}/system_stats`, timeoutMs, {
    headers: authHeaders(),
    read: async (r) => {
      const total = ((await r.json()) as { system?: { ram_total?: unknown } } | null)?.system?.ram_total;
      return typeof total === "number" && total > 0 ? total : undefined;
    },
  });
}

async function checkComfy(url: string): Promise<boolean> {
  const prev = globalThis.__fuobeComfyReach?.url === url ? globalThis.__fuobeComfyReach : undefined;
  const { reach, asked } = await checkReach(url, prev, (ms) => askComfy(url, ms));
  const ram = (asked.answer === "yes" ? asked.value : undefined) ?? prev?.ram;
  // The address may have changed while this ran: the new one's check speaks for it.
  if (url === baseUrl()) globalThis.__fuobeComfyReach = reach.ok && ram ? { ...reach, ram } : reach;
  return reach.ok;
}

/** Is the ComfyUI server reachable? Cached for 10 s (`force` checks now); one check runs at a time. */
export async function probeComfy(force = false): Promise<boolean> {
  // An account's own ComfyUI is taken as there: its run says so when it isn't (the install's state stays its own). So is
  // one on a computer: its runs wait for a tab there.
  if (ownGpu() || computerScope() || onPoolWorkers()) return true;
  const url = baseUrl();
  const cur = globalThis.__fuobeComfyReach;
  if (!force && cur && cur.url === url && Date.now() - cur.at < 10_000) return cur.ok;
  return sharedCheck("comfy", url, () => checkComfy(url));
}

declare global {
  /** comfyDevice's and comfyDbsModels' requests on their way, by path and address. */
  var __fuobeComfyAsks: Map<string, Promise<unknown>> | undefined;
}

/** One request at a time per path and address: callers that arrive while it is on its way share its answer. */
function oneAsk<T>(key: string, ask: () => Promise<T>): Promise<T> {
  const asks = (globalThis.__fuobeComfyAsks ??= new Map());
  const going = asks.get(key);
  if (going) return going as Promise<T>;
  const p = ask().finally(() => asks.delete(key));
  asks.set(key, p);
  return p;
}

declare global {
  /** The torch device each ComfyUI address reported last (GET /system_stats devices[0].type), and when. */
  var __fuobeComfyDevice: Map<string, { type?: string; at: number }> | undefined;
}

/**
 * The connected ComfyUI's first torch device type ("cuda" for NVIDIA and ROCm, "cpu", "mps"…), from GET /system_stats
 * (devices[0], as Settings' test reads it), kept for a minute; undefined when the server doesn't say or can't be reached.
 */
export async function comfyDevice(worker: ComfyWorker = "main"): Promise<string | undefined> {
  // On someone's computer: what its Fuobe tab last said ("cuda:0 NVIDIA …").
  const computer = computerScope();
  if (computer) return /^[a-z]+/i.exec(factsOf(computer)?.device ?? "")?.[0].toLowerCase();
  const url = baseUrl(worker);
  if (!url) return undefined;
  const cache = (globalThis.__fuobeComfyDevice ??= new Map());
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 60_000) return hit.type;
  return oneAsk(`/system_stats ${url}`, async () => {
    const s = await comfyJson<{ devices?: { type?: unknown }[] }>("/system_stats", worker).catch(() => undefined);
    const type = typeof s?.devices?.[0]?.type === "string" ? (s.devices[0].type as string) : undefined;
    if (s) cache.set(url, { type, at: Date.now() });
    return type;
  });
}

/** A ComfyUI's model folders (GET /experiment/models) and the files of the ones asked about, and when. */
type ModelRoots = { roots?: Record<string, string[]>; files: Map<string, { name: string; pathIndex: number }[] | undefined>; at: number };

declare global {
  /** Each ComfyUI address's model folders and files (comfyModelPath). */
  var __fuobeComfyRoots: Map<string, ModelRoots> | undefined;
}

/**
 * Where a file under one of the connected ComfyUI's model folders is on its disk (GET /experiment/models for the folders,
 * /experiment/models/{folder} for the file and which folder holds it), kept for a minute: undefined when it isn't there or
 * the server can't say (an older ComfyUI, someone's computer, which the server never reads). `name` may be in a subfolder.
 */
export async function comfyModelPath(folder: string, name: string, worker: ComfyWorker = "main"): Promise<string | undefined> {
  if (computerScope()) return undefined;
  const url = baseUrl(worker);
  if (!url) return undefined;
  const cache = (globalThis.__fuobeComfyRoots ??= new Map());
  let hit: ModelRoots | undefined = cache.get(url);
  if (!hit || Date.now() - hit.at > 60_000) {
    const list = await comfyJson<unknown>("/experiment/models", worker).catch(() => undefined);
    const roots: Record<string, string[]> = {};
    for (const x of Array.isArray(list) ? list : []) {
      const f = x as { name?: unknown; folders?: unknown };
      if (typeof f?.name === "string" && Array.isArray(f.folders)) roots[f.name] = f.folders.filter((d): d is string => typeof d === "string");
    }
    hit = { roots: Array.isArray(list) ? roots : undefined, files: new Map<string, { name: string; pathIndex: number }[] | undefined>(), at: Date.now() };
    cache.set(url, hit);
  }
  const dirs = hit.roots?.[folder];
  if (!dirs?.length) return undefined;
  if (!hit.files.has(folder)) {
    const items = await comfyJson<unknown>(`/experiment/models/${encodeURIComponent(folder)}`, worker).catch(() => undefined);
    hit.files.set(
      folder,
      Array.isArray(items)
        ? items.flatMap((x: { name?: unknown; pathIndex?: unknown }) => (typeof x?.name === "string" && typeof x.pathIndex === "number" ? [{ name: x.name, pathIndex: x.pathIndex }] : []))
        : undefined,
    );
  }
  const want = name.replace(/\\/g, "/");
  const found = hit.files.get(folder)?.find((f) => f.name.replace(/\\/g, "/") === want);
  const root = found && dirs[found.pathIndex];
  if (!root) return undefined;
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${sep}${found.name}`;
}

declare global {
  /** The DBS models each ComfyUI address listed last (GET /models/dbs), and when. */
  var __fuobeComfyDbs: Map<string, { models?: DbsModel[]; at: number }> | undefined;
}

/**
 * The DBS models the connected ComfyUI has on disk (GET /models/dbs, which ComfyUI-DBS registers: both files of a
 * model, or it isn't there), at most `maxAgeMs` old; undefined when the server can't say (unreachable, or the pack
 * isn't loaded, so there is no dbs folder).
 */
export async function comfyDbsModels(worker: ComfyWorker = "main", maxAgeMs = 10_000): Promise<DbsModel[] | undefined> {
  const url = baseUrl(worker);
  if (!url) return undefined;
  const cache = (globalThis.__fuobeComfyDbs ??= new Map());
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.models;
  return oneAsk(`/models/dbs ${url}`, async () => {
    const files = await comfyJson<unknown>("/models/dbs", worker).catch(() => undefined);
    const models = Array.isArray(files) ? installedDbs(files.filter((f): f is string => typeof f === "string")) : undefined;
    cache.set(url, { models, at: Date.now() });
    return models;
  });
}

declare global {
  /** Whether each ComfyUI address had a node class (GET /object_info/<class>), by address and class, and when. */
  var __fuobeComfyClasses: Map<string, { has: boolean; at: number }> | undefined;
}

/**
 * Whether the connected ComfyUI has a node class (GET /object_info/<class> answers it; a ComfyUI without it answers
 * {}), kept for a minute; undefined when the server can't say (unreachable: asked again next time), and on someone's
 * computer, which the server never asks. forgetComfyClass drops the answer (a run refused for a missing node).
 */
export async function comfyHasClass(cls: string, worker: ComfyWorker = "main", maxAgeMs = 60_000): Promise<boolean | undefined> {
  if (computerScope()) return undefined;
  const url = baseUrl(worker);
  if (!url) return undefined;
  const cache = (globalThis.__fuobeComfyClasses ??= new Map());
  const key = `${url} ${cls}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.has;
  return oneAsk(`/object_info/${cls} ${url}`, async () => {
    const info = await comfyJson<unknown>(`/object_info/${encodeURIComponent(cls)}`, worker).catch(() => undefined);
    if (!info || typeof info !== "object" || Array.isArray(info)) {
      cache.delete(key);
      return undefined;
    }
    const has = cls in info;
    cache.set(key, { has, at: Date.now() });
    return has;
  });
}

/** Forget what a ComfyUI said about a node class (comfyHasClass asks again). */
export function forgetComfyClass(cls: string, worker: ComfyWorker = "main"): void {
  const url = baseUrl(worker);
  if (url) globalThis.__fuobeComfyClasses?.delete(`${url} ${cls}`);
}

declare global {
  /** The RE-USE files each ComfyUI address listed last (GET /models/reuse; null: no reuse folder, so no ComfyUI-RE-USE), and when. */
  var __fuobeComfyReuse: Map<string, { models?: ReuseModel[] | null; at: number }> | undefined;
}

/**
 * The RE-USE models the connected ComfyUI has on disk (GET /models/reuse, which ComfyUI-RE-USE registers), at most
 * `maxAgeMs` old: null when the server answers but has no reuse folder (the pack isn't installed), undefined when it can't
 * say (unreachable).
 */
export async function comfyReuseModels(worker: ComfyWorker = "main", maxAgeMs = 10_000): Promise<ReuseModel[] | null | undefined> {
  const url = baseUrl(worker);
  if (!url) return undefined;
  const cache = (globalThis.__fuobeComfyReuse ??= new Map());
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.models;
  return oneAsk(`/models/reuse ${url}`, async () => {
    let models: ReuseModel[] | null | undefined;
    try {
      const files = await comfyJson<unknown>("/models/reuse", worker);
      models = Array.isArray(files) ? installedReuse(files.filter((f): f is string => typeof f === "string")) : undefined;
    } catch (e) {
      // ComfyUI answers 404 for a model folder nobody registered: no ComfyUI-RE-USE.
      models = e instanceof ProviderError && e.status === 404 ? null : undefined;
    }
    cache.set(url, { models, at: Date.now() });
    return models;
  });
}

/** The connected ComfyUI's RAM in bytes, as the last reachability check read it (whole-clip tools' budget). */
export function comfyRam(): number | undefined {
  const computer = computerScope();
  if (computer) return factsOf(computer)?.ramBytes;
  if (ownGpu()) return undefined;
  const cur = globalThis.__fuobeComfyReach;
  return cur?.ok && cur.url === baseUrl() ? cur.ram : undefined;
}

/**
 * Blocking reachability check (reachSync): a few ms for a server that answers or a refused port, at most `timeoutMs`
 * otherwise; a server that takes the connection but doesn't answer in time is busy for now, and probeComfy goes on in
 * the background to say for sure.
 */
export function probeComfySync(timeoutMs = 1500): boolean {
  if (ownGpu() || computerScope() || onPoolWorkers()) return true;
  const url = baseUrl();
  const { reach, sure } = reachSync(url, `${url}/system_stats`, timeoutMs, authHeaders());
  globalThis.__fuobeComfyReach = reach;
  if (!sure) void probeComfy(true).catch(() => false);
  return reach.ok;
}

// ---------------------------------------------------------------------------
// Building the prompt

// What we learned about each uploaded clip / track from its header (duration, size, fps, audio), by ComfyUI file name.
declare global {
  var __fuobeComfyMedia: Map<string, MediaInfo> | undefined;
}
const MEDIA_FILE = /^(video|audio)\//;
const MEDIA_EXT = /\.(mp4|m4v|mov|m4a|wav|flac|mp3)$/i;

/** A file name as remembered: an account's ComfyUI names its own files, so they are kept apart by its address (or whose computer). */
const mediaKey = (name: string) => {
  const own = ownGpu();
  const computer = computerScope();
  if (computer) return `${computer}|${name}`;
  return own && own.kind !== "computer" ? `${own.url}|${name}` : name;
};

/** What the server reads from a file it sends to ComfyUI (a clip's length and size, a picture's size), by its name there. */
function rememberSent(uploaded: string, data: Buffer, contentType: string, name: string, oriented = false) {
  if (MEDIA_FILE.test(contentType) || MEDIA_EXT.test(name) || /\.(webm|mkv|avi)$/i.test(name)) {
    const info = probeMedia(data) ?? webmInfo(data) ?? aviInfo(data);
    if (info) rememberMedia(uploaded, info);
  } else if (/^image\//.test(contentType)) {
    // A start frame's size: "auto" makes an image-to-video clip in the picture's own shape. `oriented`: an account's
    // picture that a worker makes again upright (turned by its EXIF orientation) is sized as it shows; any other is sized
    // by its pixels, as the ComfyUI that gets it reads them.
    const size = oriented ? orientedImageSize(data) : imageSize(data);
    if (size) rememberMedia(uploaded, { container: "image", ...size, hasVideo: false, hasAudio: false });
  }
}

function rememberMedia(name: string, info: MediaInfo) {
  const seen = (globalThis.__fuobeComfyMedia ??= new Map());
  seen.set(mediaKey(name), info);
  if (seen.size > 256) seen.delete(seen.keys().next().value!);
}

/** A WebM / Matroska clip's header facts in MediaInfo's shape (src/server/webm-probe.ts). */
function webmInfo(data: Buffer): MediaInfo | null {
  const w = probeWebm(data);
  if (!w) return null;
  const frames = w.duration && w.fps ? Math.round(w.duration * w.fps) : undefined;
  return { container: "webm", duration: w.duration, videoDuration: w.hasVideo ? w.duration : undefined, width: w.width, height: w.height, fps: w.fps, frames, hasVideo: w.hasVideo, hasAudio: w.hasAudio, ...(w.channels && { channels: w.channels }) };
}

/** An AVI clip's header facts in MediaInfo's shape (src/server/avi-probe.ts; Character Swap Studio takes AVI). */
function aviInfo(data: Buffer): MediaInfo | null {
  const a = probeAvi(data);
  if (!a) return null;
  const frames = a.duration && a.fps ? Math.round(a.duration * a.fps) : undefined;
  return { container: "avi", duration: a.duration, videoDuration: a.hasVideo ? a.duration : undefined, width: a.width, height: a.height, fps: a.fps, frames, hasVideo: a.hasVideo, hasAudio: a.hasAudio };
}

/** The header facts of a file this server uploaded to ComfyUI (a still has only its size; undefined for unreadable containers). */
export function mediaInfoFor(name: unknown): MediaInfo | undefined {
  return typeof name === "string" ? globalThis.__fuobeComfyMedia?.get(mediaKey(name)) : undefined;
}

const isMediaRef = (v: unknown): v is string => typeof v === "string" && (v.startsWith("/api/files/") || v.startsWith("data:"));

export interface PrepareContext {
  generationId: string;
  op: Operation;
  /** Upload a file to ComfyUI's input folder; returns the name LoadImage/LoadAudio/LoadVideo take. */
  upload: (data: Buffer, contentType: string, name: string) => Promise<string>;
  /** Header facts (duration, size, fps, audio track) of an uploaded clip or track, by its ComfyUI name. */
  media?: (name: string) => MediaInfo | undefined;
  /** The ComfyUI server's RAM in bytes, for graphs that hold a whole clip in memory. */
  serverRam?: () => Promise<number | undefined>;
  /** The server's first torch device type ("cuda", "cpu", "mps"…; GET /system_stats devices[0].type): DBS picks its model by it. */
  device?: () => Promise<string | undefined>;
  /** Where a model file is on the server's disk (comfyModelPath), undefined when it can't say: Zen Image Edit's loader reads paths. */
  modelPath?: (folder: string, name: string) => Promise<string | undefined>;
  /** The first device's memory in bytes (GET /system_stats devices[0].vram_total): the Watermark Remover's repair size. */
  vram?: () => Promise<number | undefined>;
  /** The DBS models on the server's disk (GET /models/dbs), undefined when it can't say: a run never gets one that isn't there. */
  dbsModels?: () => Promise<DbsModel[] | undefined>;
  /** The RE-USE files on the server's disk (GET /models/reuse): null without ComfyUI-RE-USE, undefined when it can't say. */
  reuseModels?: () => Promise<ReuseModel[] | null | undefined>;
  /** Whether the server has the ComfyUI-Idol pack (GET /object_info/IdolPruneSplat): Idol 3D then runs its clean graph. */
  idolPack?: () => Promise<boolean | undefined>;
  /**
   * The route puts the run's one LoRA in the graph's own LoRA slot (ModelRoute.loraSlot: Fuobe Speak's FusioniX on kijai's
   * InfiniteTalk graph, with the settings it goes with). Without it a graph with no model loader refuses a LoRA.
   */
  loraSlot?: boolean;
}

export interface PreparedPrompt extends ComposedPrompt {
  /** What the composer was given: the request after its media refs were sent, the files it made, and which extra keys were sent. */
  request: ComposeRequest & { sent: string[] };
}

/**
 * Turn a canonical request into the exact ComfyUI prompt (src/lib/comfy-compose.ts composeWorkflow does it). Here, around
 * it: media refs in params.extra (a background stem for "audio2") are uploaded first like regular inputs, the seed is
 * picked when the run names none (so a job ticket carries the one the graph draws with), and the catalog, the scope
 * (an account's run on this install's GPUs, the studio's own ComfyUI) and the uploads' header facts are passed in. The
 * result says what the composer was given (`request`), for a job ticket (src/lib/ticket-compose.ts).
 */
export async function prepareWorkflow(endpointTemplate: string, input: GenInput, ctx: PrepareContext): Promise<PreparedPrompt> {
  const extra: Record<string, unknown> = { ...(input.extra ?? {}) };
  // The second audio track given as the canonical input wins over params.extra.audio2 (which then isn't sent).
  const given2 = (input as GenInput & { audio2?: unknown }).audio2;
  const audio2 = typeof given2 === "string" && given2 ? given2 : undefined;
  const sent: string[] = [];
  for (const [k, v] of Object.entries(extra)) {
    if (!isMediaRef(v) || (k === "audio2" && audio2)) continue;
    sent.push(k);
    // An account's file is read and sent when it may send (account-send.ts), as the run's other inputs are.
    const send = async () => {
      const f = await readRef(v);
      return ctx.upload(f.data, f.contentType, f.name);
    };
    const account = ownGpu() ? tenantAccount() : undefined;
    extra[k] = await (account ? accountSend(account, send) : send());
  }
  const request: GenInput = { ...input, ...(input.extra !== undefined || sent.length ? { extra } : {}), seed: input.seed !== undefined && input.seed >= 0 ? input.seed : randomSeed() };
  const made: string[] = [];
  try {
    const out = await composeWorkflow(endpointTemplate, request, {
      ...ctx,
      catalog: { has: (id) => loadManifest().workflows.some((w) => w.id === id), get: getWorkflow },
      made: async (data, contentType, name) => {
        const n = await ctx.upload(data, contentType, name);
        made.push(n);
        return n;
      },
      sent,
      accountOnInstall: !!tenantAccount() && !!(poolScope.getStore() || serverScope.getStore()),
      // (Asked only for the graph it is about, H3 Person Removal's review: no other run reads the settings for it.)
      ownStudio: endpointTemplate === H3_REMOVAL_WORKFLOW && !ownGpu() && !computerScope() && !tenantAccount(),
    });
    // What the composer used: the request without the files it dropped (an account's file it didn't send).
    const used = out.dropped.length && request.extra ? { ...request, extra: Object.fromEntries(Object.entries(request.extra).filter(([k]) => !out.dropped.includes(k))) } : request;
    return { ...out, request: { endpoint: endpointTemplate, op: ctx.op, input: used, made, sent, ...(ctx.loraSlot && { loraSlot: true }) } };
  } catch (e) {
    if (e instanceof ComposeError) throw new ProviderError(e.message, e.status);
    throw e;
  }
}


/** Said when an account's run can't be put into a job ticket (its settings are outside the ticket's rules). */
export const TICKET_REFUSED = "This run couldn't be made with these settings.";

/**
 * An account's run on the workers goes as a job ticket (src/lib/job-ticket.ts), never as a graph: the workflow, this
 * studio's catalog version, the typed settings the composer was given, each input file by its slot and SHA-256, and how
 * many results it makes. The ticket is checked here as the worker checks it before composing (ticketProblem).
 */
export function accountTicket(p: PreparedPrompt, principal: Principal, o: { outputs: number; kind?: MediaKind }): JobTicket {
  const version = catalogVersion();
  if (!version) throw new ProviderError(TICKET_REFUSED);
  let ticket: JobTicket;
  try {
    ticket = ticketFor(p.request, { catalogVersion: version, sent: p.request.sent, file: (name) => stagedInput(principal, name), facts: mediaInfoFor, outputs: { count: o.outputs, kind: o.kind ?? "file" }, size: p.size });
  } catch {
    throw new ProviderError(TICKET_REFUSED);
  }
  const staged = ticket.inputs.map((i) => ({ name: i.name, sha256: stagedInput(principal, i.name)?.sha256 ?? "" }));
  const catalog = { has: (id: string) => loadManifest().workflows.some((w) => w.id === id), get: getWorkflow };
  if (ticketProblem(ticket, { catalogVersion: version, known: (id) => catalogKnows(catalog, id), inputs: staged })) throw new ProviderError(TICKET_REFUSED);
  return ticket;
}

/** What ComfyUI's /prompt answers when it refuses a graph. */
export type PromptRefusalBody = { error?: { type?: string; message?: string; extra_info?: { class_type?: string } }; node_errors?: unknown };

/** A 2K finish refused because the latent file it loads isn't on that ComfyUI (Load Refined Latent's list of files). */
export function latentGone(body: PromptRefusalBody, manifest: Pick<ManifestWorkflow, "id">): boolean {
  if (manifest.id !== REGEN_LATENT_WORKFLOW || !body.node_errors || typeof body.node_errors !== "object") return false;
  return Object.values(body.node_errors as Record<string, { class_type?: unknown }>).some((n) => n?.class_type === "OpenH3LoadRefinedLatent");
}

/**
 * A /prompt refusal in words, with what was missing as a code its failed tile turns into "Fix it" (the GPU pre-flight's
 * guided fix). The same for the server's own ComfyUI, a link, and one on someone's computer (its tab reports the answer).
 */
export function promptRefusal(
  body: PromptRefusalBody,
  status: number,
  manifest: ManifestWorkflow,
  loras: { file: string; url?: string }[],
  worker: ComfyWorker = "main",
): { message?: string; fix?: ReturnType<typeof fixFromPromptError>; details?: string; plain?: true } {
  // The index names the pack a missing class comes from, so the message names that pack, not every pack the workflow uses.
  let packOf: (cls: string) => string | undefined = () => undefined;
  let idx: ReturnType<typeof loadIndex> | undefined;
  try {
    const index = loadIndex();
    idx = index;
    packOf = (cls) => Object.entries(index.packs).find(([, p]) => p.classes.includes(cls))?.[0];
  } catch {}
  const fix = fixFromPromptError(body, manifest.id, manifest.models, packOf);
  const missingClass = fix?.code === "comfy_missing_node" ? fix.items[0] : undefined;
  // A node class the server doesn't have: name the pack to install (opt-in packs like ComfyUI-Whisper).
  const packs = missingClass?.pack ? [missingClass.pack] : manifest.customNodes.map((c) => c.name);
  const where = worker === "isolated" ? "the isolated ComfyUI worker" : "your ComfyUI";
  // An account's run (on its own GPU, or on this install's GPUs as a hosted run) gets the visitor's words, never the owner's.
  const visitorRun = !!ownGpu() || !!tenantAccount();
  const missingPack =
    body.error?.type === "missing_node_type" && [REGEN_WORKFLOW, REGEN_LATENT_WORKFLOW, H3_LATENT_DRAFT_WORKFLOW].includes(manifest.id) && worker === "main"
      ? visitorRun
        ? REGEN_COPY.missingVisitor
        : REGEN_COPY.missing
      : body.error?.type === "missing_node_type" && RTX_WORKFLOWS.has(manifest.id) && worker === "main"
        ? visitorRun
          ? RTX_MISSING.visitor
          : RTX_MISSING.owner
      : body.error?.type === "missing_node_type" && packs.length
        ? `This workflow needs the ${packs.join(" + ")} node pack${packs.length > 1 ? "s" : ""} on ${where} (see scripts/comfy/README.md)`
        : undefined;
  // A LoRA it lacks: point at its model card (a civitai download URL answers 401 without the key) and the LoRA folder setting.
  // A 2K finish whose draft's saved latent is gone (someone's computer: its tab reports the refusal): plain words, no file.
  if (latentGone(body, manifest)) return { message: REGEN_COPY.latentGone, plain: true };
  const loraModels = loras.map((l) => ({ file: l.file, folder: "loras", url: loraByFile(l.file)?.page ?? (l.url && !needsToken(l.url) ? l.url : undefined) }));
  let detail = body.node_errors && Object.keys(body.node_errors as object).length ? explainComfyError(body.node_errors, { ...manifest, models: [...manifest.models, ...loraModels] }) : (missingPack ?? (typeof body.error?.message === "string" ? body.error.message.slice(0, 1024) : undefined));
  // (Settings → LoRAs is the owner's page, for the server's own ComfyUI: an account's, or one on a computer, gets its LoRAs by hand.)
  if (detail && !ownGpu() && !computerScope() && loraModels.some((l) => detail!.includes(`"${l.file}"`))) detail = `${detail}\nSet the LoRA folder in Settings → LoRAs and Fuobe downloads LoRAs before a run`;
  void status;
  // An account's own GPU (a link or this computer): what is missing in plain words, with "Fix it"; ComfyUI's own words
  // (and the file's folder and download) go in the details line.
  if (ownGpu() && fix && (fix.code === "comfy_missing_node" || fix.code === "comfy_missing_model") && missingPack !== REGEN_COPY.missingVisitor && missingPack !== RTX_MISSING.visitor) {
    const first = fix.items[0];
    const name = fix.code === "comfy_missing_node" ? (first?.pack ?? first?.class) : first?.file;
    if (name) {
      const words =
        fix.code === "comfy_missing_node"
          ? `Your ComfyUI needs one add-on for this: ${name}. Press Fix it to add it.`
          : (() => {
              // The file as the index knows it: its title, size and folder.
              const f = first?.folder && first.file ? idx?.files[`${first.folder}/${first.file}` as FileKey] : undefined;
              const what = f ? `the ${fileTitle(f.folder, f.file)} (${f.file}, ${formatBytes(f.sizeBytes)})` : name;
              return `Your GPU needs ${what} in ComfyUI/models/${f?.folder ?? first?.folder ?? ""}. Press Fix it to get it, then Check again.`;
            })();
      return { message: words, fix, plain: true, ...(detail && detail !== words && { details: detail.replace(/\s*\(see scripts\/comfy\/README\.md\)/, "") }) };
    }
  }
  const plain = !!detail && (detail === REGEN_COPY.missingVisitor || detail === RTX_MISSING.visitor);
  return { message: detail, ...(fix && { fix }), ...(plain && { plain: true as const }) };
}

/** The NVIDIA RTX Video graphs (their pack is installed only on an NVIDIA RTX host). */
const RTX_WORKFLOWS: ReadonlySet<string> = new Set([RTX_UPSCALE_WORKFLOW, RTX_FRAMEGEN_WORKFLOW, RTX_HDR_WORKFLOW]);

/** Friendlier words for errors that a workflow's nodes report in their own terms. */
function explainExecutionError(err: { exception_message?: string; node_type?: string } | undefined, manifest?: ManifestWorkflow): string {
  if (!err) return "Execution error";
  const msg = (err.exception_message ?? "").trim();
  // On someone's own computer the words are theirs: their GPU ran out (the server's own runs keep ComfyUI's words).
  if (computerScope() && isOutOfMemory(msg)) return RELAY_WORDS.outOfMemory;
  const outOfClip = /division by zero|failed to slice video|failed to trim video|no frames exist/i.test(msg);
  if (manifest?.expand === "captions" && outOfClip) return "A caption starts after the end of the video — check the cue times";
  if (manifest?.capability === "trim" && outOfClip) return "The start time is past the end of the clip";
  if (/no audio stream/i.test(msg)) return "That file has no sound to work with";
  return `${err.node_type}: ${msg}`;
}

type ExecutionError = { exception_message?: string; node_type?: string; node_id?: string; current_inputs?: unknown };
const executionError = (entry: HistoryEntry) => entry.status?.messages?.find(([t]) => t === "execution_error")?.[1] as ExecutionError | undefined;

/**
 * Where a model file downloads from, for an account whose GPU has it damaged or lacks it: the requirement index's
 * (pinned to its revision), the workflow's own list, or a LoRA's page. A gated file: its Hugging Face page (its licence
 * first). Only an https link.
 */
export function modelFileUrl(file: string, manifest?: Pick<ManifestWorkflow, "models">): string | undefined {
  const name = (file.split(/[\\/]/).pop() ?? file).toLowerCase();
  const https = (u: string | undefined) => (u && /^https:\/\/[^\s"'<>]+$/i.test(u) ? u : undefined);
  let indexed: { url: string; pinnedUrl?: string; gated?: boolean } | undefined;
  try {
    indexed = Object.values(loadIndex().files).find((f) => f.file.toLowerCase() === name);
  } catch {}
  if (indexed) return https(indexed.gated ? hfPage(indexed.url) : indexed.pinnedUrl || indexed.url);
  const listed = manifest?.models.find((m) => (m.file.split(/[\\/]/).pop() ?? m.file).toLowerCase() === name);
  if (listed?.url) return https(listed.gated ? hfPage(listed.url) : needsToken(listed.url) ? undefined : listed.url);
  return https(loraByFile(file.split(/[\\/]/).pop() ?? file)?.page);
}

/**
 * A job's error as diagnose.ts reads it. A loader that can't read its model file, or doesn't have it: the file it was
 * loading (from the graph that was sent, by the error's node id) and where it downloads from.
 */
function jobErrorOf(err: ExecutionError | undefined, graph: unknown, manifest: ManifestWorkflow | undefined): Extract<GpuJobTrouble, { kind: "error" }> {
  const base = { kind: "error" as const, nodeType: err?.node_type, message: err?.exception_message };
  if (!err || !modelFileProblem(err.node_type, err.exception_message)) return base;
  const files = loaderFiles(err, graph);
  const fileUrl = files.length === 1 ? modelFileUrl(files[0], manifest) : undefined;
  return { ...base, files, ...(fileUrl && { fileUrl }) };
}

/**
 * A job that failed on an account's own GPU at a web address, said plainly with what helps: stopped there, out of memory,
 * a model file its loader can't read or doesn't have (named, with where to get it again), or an add-on's exception.
 * ComfyUI's own words go in the details line.
 */
function ownJobFailed(entry: HistoryEntry, manifest: ManifestWorkflow | undefined, link: GpuPlace): { state: "failed"; error: string; trouble: Diagnosis } {
  const err = executionError(entry);
  const said = explainExecutionError(err, manifest);
  const interrupted = !err && entry.status?.messages?.some(([type]) => type === "execution_interrupted");
  const d: Diagnosis = interrupted
    ? diagnoseGpuJob({ kind: "interrupted" }, link)
    : err && !modelFileProblem(err.node_type, err.exception_message) && said !== `${err.node_type}: ${(err.exception_message ?? "").trim()}`
      ? { cause: "gpu-job-error", words: said, actions: [{ kind: "retry", label: "Retry" }], retryable: false }
      : diagnoseGpuJob(jobErrorOf(err, entry.prompt?.[2], manifest), link);
  return { state: "failed", error: d.words, trouble: d };
}

/**
 * A /prompt refusal on an account's own GPU for a model file a loader doesn't list, one no "Fix it" knows (a file outside
 * the workflow's list): the file named, with where to get it.
 */
function unlistedModelFile(body: PromptRefusalBody, manifest: ManifestWorkflow, place: GpuPlace): Diagnosis | null {
  const errs = body.node_errors && typeof body.node_errors === "object" ? Object.values(body.node_errors as Record<string, unknown>) : [];
  for (const raw of errs.slice(0, 64)) {
    const ne = raw as { class_type?: unknown; errors?: unknown } | null;
    const cls = typeof ne?.class_type === "string" ? ne.class_type : undefined;
    if (!isLoaderNode(cls) || !Array.isArray(ne?.errors)) continue;
    for (const e of ne.errors.slice(0, 16) as { message?: unknown; details?: unknown; extra_info?: { received_value?: unknown } }[]) {
      const file = e?.extra_info?.received_value;
      if (typeof file !== "string" || !MODEL_FILE.test(file.trim()) || !/not in list/i.test(`${e.message ?? ""} ${e.details ?? ""}`)) continue;
      const details = String(e.details ?? "").slice(0, 600);
      const message = `${String(e.message ?? "Value not in list")}: ${details.includes(file.trim()) ? details : file.trim()}`;
      const fileUrl = modelFileUrl(file.trim(), manifest);
      return diagnoseGpuJob({ kind: "error", nodeType: cls, message, files: [file.trim()], ...(fileUrl && { fileUrl }) }, place);
    }
  }
  return null;
}

const promptHasPrefix = (prompt: unknown, prefix: string) =>
  !!prompt && typeof prompt === "object" && Object.values(prompt as ComfyWorkflow).some((n) => n?.inputs?.filename_prefix === prefix);

/** An EXR export's per-frame files (bundleFrames zips them); everything else is a finished result. */
const isFrame = (o: ComfyOutput) => o.meta?.role === "frames";

/**
 * A meta-batch pass's place in its job. ComfyUI numbers the first pass as queued (0 or more); VHS re-queues each later
 * pass under the negated, growing server count (-k, -k-1, …), so a later pass has a more negative number.
 */
const passOrder = (e: { prompt?: unknown[] }) => {
  const n = Number(e.prompt?.[0] ?? 0);
  return n >= 0 ? 0 : -n;
};

/**
 * A meta-batch job's results from its passes (in any order): the clips the last pass saved (only the last pass saves
 * a video), then every pass's EXR frames in pass order (a frame saver writes in each pass). Empty while no pass saved a
 * finished result. `collect` reads one pass's files.
 */
export function metaBatchResults<E extends { prompt?: unknown[] }>(passes: E[], collect: (e: E) => ComfyOutput[]): ComfyOutput[] {
  const files = [...passes].sort((a, c) => passOrder(a) - passOrder(c)).map(collect);
  const last = files.findLastIndex((f) => f.some((o) => !isFrame(o)));
  if (last < 0) return [];
  return [...files[last].filter((o) => !isFrame(o)), ...files.flatMap((f) => f.filter(isFrame))];
}

/**
 * VHS meta-batching re-queues the prompt (new prompt ids) until every frame is done; only the last pass
 * saves the video. Follow the passes by their shared filename prefix.
 */
async function followMetaBatch(prefix: string, manifest: ManifestWorkflow | undefined, worker: ComfyWorker): Promise<ComfyOutput[] | "running" | { error: string; failed: HistoryEntry } | null> {
  const queue = await comfyJson<{ queue_running?: unknown[][]; queue_pending?: unknown[][] }>("/queue", worker);
  if ([...(queue.queue_running ?? []), ...(queue.queue_pending ?? [])].some((q) => promptHasPrefix(q[2], prefix))) return "running";
  const read = async (n: number) => Object.values(await comfyJson<Record<string, HistoryEntry>>(`/history?max_items=${n}`, worker)).filter((e) => promptHasPrefix(e.prompt?.[2], prefix));
  const collect = (e: HistoryEntry) => collectOutputs(e, manifest, baseUrl(worker), authHeaders(worker));
  let passes = await read(64);
  // Frames in each pass: every pass is needed, so look further back.
  if (passes.some((e) => collect(e).some(isFrame))) passes = await read(META_BATCH_HISTORY);
  // A pass that failed (out of memory, a node exception) ends the job: say why instead of "no output".
  const failed = passes.find((e) => e.status?.status_str === "error");
  if (failed) return { error: explainExecutionError(executionError(failed), manifest), failed };
  const files = metaBatchResults(passes, collect);
  return files.length ? files : null;
}

/** A window preview H3 Relay writes (a 512 px clip or still): anything bigger isn't kept. */
const WINDOW_PREVIEW_MAX_BYTES = 64 * 2 ** 20;

/**
 * H3 Person Removal: H3 Relay's review of the run (each window's checkpoint, seed and preview) on the video it made, as
 * meta.review plus the previews as meta.artifacts. The previews are copied from ComfyUI here, with its token, into the
 * generation's files (a local or LAN ComfyUI isn't fetched by link later, and raw ComfyUI links never reach a page). A
 * preview that can't be copied is left out; the window can still be redone. Nothing when the Relay didn't report a run
 * (an older pack), the inputs can't be sent again, or the run wasn't on the studio's own ComfyUI.
 */
export async function withRemovalReview(entry: HistoryEntry, outputs: ComfyOutput[], reuseMeta: unknown, worker: ComfyWorker, generationId: string): Promise<ComfyOutput[]> {
  if (ownGpu() || computerScope() || tenantAccount()) return outputs;
  const reuse = reuseOf(reuseMeta);
  const runs = Object.values(entry.outputs ?? {}).flatMap((ui) => (Array.isArray(ui?.h3_removal_run) ? ui.h3_removal_run : []));
  const runId = runs.find((r): r is string => typeof r === "string" && /^[0-9a-f]{32}$/.test(r));
  const at = outputs.findIndex((o) => o.kind === "video");
  if (!reuse || !runId || at < 0) return outputs;
  try {
    const run = await comfyJson<unknown>(`/h3_relay/removal/previews?${new URLSearchParams({ workflow_id: "", node_id: "review", run_id: runId })}`, worker);
    const read = reviewOfRun(run, reuse, (f) => `/view?${new URLSearchParams(f)}`);
    if (!read) return outputs;
    const kept: Record<string, string> = {};
    for (const [key, view] of Object.entries(read.artifacts)) {
      try {
        const res = await comfyFetch(view, {}, worker);
        const size = Number(res.headers.get("content-length") ?? 0);
        if (!res.ok || size > WINDOW_PREVIEW_MAX_BYTES) {
          discardBody(res);
          continue;
        }
        const data = Buffer.from(await res.arrayBuffer());
        if (!data.length || data.length > WINDOW_PREVIEW_MAX_BYTES) continue;
        const name = new URLSearchParams(view.split("?")[1]).get("filename") ?? undefined;
        const type = res.headers.get("content-type");
        const contentType = type && type !== "application/octet-stream" ? type.split(";")[0] : contentTypeFor(name ?? "", "application/octet-stream");
        kept[key] = saveFile({ data, contentType, name, source: "generation", generationId: generationId || undefined }).url;
      } catch {
        // this window shows no preview
      }
    }
    const review = { ...read.review, windows: read.review.windows.map((w) => ({ ...w, video: w.video && kept[w.video] ? w.video : undefined, poster: w.poster && kept[w.poster] ? w.poster : undefined })) };
    const o = outputs[at];
    const artifacts = { ...((o.meta?.artifacts as Record<string, string> | undefined) ?? {}), ...kept };
    return outputs.map((x, i) => (i === at ? { ...x, meta: { ...x.meta, review, artifacts } } : x));
  } catch {
    return outputs;
  }
}

/** Upload a file to a worker's input folder; returns the name LoadImage / LoadAudio / LoadVideo take there. */
async function uploadTo(worker: ComfyWorker, data: Buffer, contentType: string, name: string): Promise<string> {
  // On someone's computer: kept here for the run's task, under the name ComfyUI will get from their tab.
  const computer = computerScope();
  if (computer) {
    if (worker === "isolated") throw new ProviderError(ISOLATED_ON_COMPUTER);
    // An account's run on the workers sends its pictures as they came: the worker makes each one again from its pixels
    // before its ComfyUI reads it (bin/lib/worker/picture.mjs), so this server never decodes them. The owner's own jobs
    // are made again here, as before.
    const sent = onWorkers(computer) ? await forWorkers(data, contentType, name, { onWorker: computer !== "owner" }) : { data, contentType, name };
    const staged = stageInput(computer, sent.data, sent.contentType, sent.name);
    rememberSent(staged, sent.data, sent.contentType, sent.name, onWorkers(computer) && computer !== "owner");
    return staged;
  }
  // A run on this install's workers with no account behind it (a guest's price check) never sends anything.
  if (onPoolWorkers()) throw new ProviderError(ON_COMPUTER_ONLY);
  // An account's run on this install's own ComfyUI server: only one on this machine, and its pictures made again from
  // their pixels (no EXIF, no GPS), as for the workers.
  const server = serverScope.getStore();
  const account = server ? tenantAccount() : undefined;
  if (account) {
    if (!installComfyLocal(worker)) throw new ProviderError(POOL_NOT_LOCAL);
    if (contentType.startsWith("image/")) ({ data, contentType, name } = await forWorkers(data, contentType, name));
  }
  const form = new FormData();
  const ext = name.includes(".") ? name.split(".").pop() : contentType.split("/")[1];
  form.append("image", new Blob([new Uint8Array(data)], { type: contentType }), `fuobe_${nanoid(8)}.${ext}`);
  form.append("type", "input");
  form.append("overwrite", "true");
  const res = await comfyFetch("/upload/image", { method: "POST", body: form }, worker, { bytes: data.length });
  // An account's link: its answer read for the person (a stopped pod, the address's own size limit…).
  const link = ownLink();
  if (link && !res.ok) throw await linkAnswer(res, { stage: "upload", bytes: data.length }, link);
  if (res.status === 413) {
    discardBody(res);
    // ComfyUI's own limit (--max-upload-size, 100 MB unless it was started with more).
    const mb = Math.ceil(data.length / 2 ** 20);
    throw new ProviderError(`ComfyUI refused a ${mb} MB upload as too large (its --max-upload-size, 100 MB unless set) — start ComfyUI with a higher --max-upload-size, or send a smaller file`);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 500);
    throw worker === "isolated" ? isolatedAnswer("an upload", res.status, reasonOf(text)) : new ProviderError(`ComfyUI upload failed: ${res.status} ${text}`);
  }
  let j: { name: string; subfolder?: string };
  if (link) {
    // A web page instead of ComfyUI's answer (a proxy's or a tunnel's page): said as such, never a parser's words.
    const text = await res.text().catch(() => "");
    try {
      j = JSON.parse(text);
    } catch {
      throw gpuTrouble({ stage: "upload", status: res.status, body: text.slice(0, 4096), contentType: res.headers.get("content-type") ?? undefined }, link);
    }
  } else j = (await res.json()) as { name: string; subfolder?: string };
  const uploaded = j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
  // Remember a clip's / track's header facts (length, size, fps, audio) for prepareWorkflow.
  rememberSent(uploaded, data, contentType, name);
  server?.uploads.add(uploaded);
  return uploaded;
}

/**
 * Deletes a finished Context Loop job's run folder (output/h3_chains/<run>) through the pack's own routes: a preview gives
 * the folder's snapshot, the delete names it and the run again. A failure is logged and the run goes on.
 */
export async function deleteRunFolder(run: string, worker: ComfyWorker = "main"): Promise<boolean> {
  try {
    const preview = await comfyFetch("/minimax_h3_context_loop/run-folder/delete-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_name: run }) }, worker);
    const p = (await preview.json().catch(() => ({}))) as { snapshot?: string };
    if (!preview.ok || !p.snapshot) return false;
    const done = await comfyFetch(
      "/minimax_h3_context_loop/run-folder/delete",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_name: run, snapshot: p.snapshot, confirmation: run }) },
      worker,
    );
    discardBody(done);
    if (!done.ok) console.warn(`Couldn't delete the H3 run folder ${run} (HTTP ${done.status})`);
    return done.ok;
  } catch (e) {
    console.warn(`Couldn't delete the H3 run folder ${run}: ${(e as Error).message}`);
    return false;
  }
}

type QueueEntry = unknown[];
const postJson = (p: string, body: unknown, worker: ComfyWorker = "main") =>
  comfyFetch(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, worker).catch(() => undefined);

/**
 * Take a job off ComfyUI: delete its pending prompts and interrupt the one running. A meta-batch job is
 * every prompt carrying its filename prefix (VHS re-queues each pass under a new id with a negative queue
 * number, so the pending pass would run first). Returns whether any prompt of the job was still there.
 */
async function stopPrompts(externalId: string | undefined, prefix: string | undefined, worker: ComfyWorker = "main"): Promise<boolean> {
  const ours = (q: QueueEntry) => (!!externalId && q[1] === externalId) || (!!prefix && promptHasPrefix(q[2], prefix));
  // Always delete the job's own id, even when the queue can't be read.
  if (externalId) await postJson("/queue", { delete: [externalId] }, worker);
  const queue = await comfyJson<{ queue_running?: QueueEntry[]; queue_pending?: QueueEntry[] }>("/queue", worker).catch(() => undefined);
  if (!queue) return false;
  const pending = (queue.queue_pending ?? []).filter(ours).map((q) => String(q[1]));
  if (pending.length) await postJson("/queue", { delete: pending }, worker);
  const running = (queue.queue_running ?? []).filter(ours);
  for (const q of running) await postJson("/interrupt", { prompt_id: String(q[1]) }, worker);
  return pending.length + running.length > 0;
}

/** Cancel tries for a meta-batch job after the first: a pass that was already saving when interrupted can still queue the next one. */
export const CANCEL_SWEEPS = { tries: 5, everyMs: 1000 };

async function sweepPasses(prefix: string, worker: ComfyWorker = "main"): Promise<void> {
  for (let i = 0; i < CANCEL_SWEEPS.tries; i++) {
    await new Promise((r) => setTimeout(r, CANCEL_SWEEPS.everyMs));
    if (!(await stopPrompts(undefined, prefix, worker).catch(() => false))) return;
  }
}

// ---------------------------------------------------------------------------
// A ComfyUI on someone's own computer: its runs are tasks their Fuobe tab does (src/server/computer)

/** Run `fn` as a principal's work on its own computer: an account's (as that account), or the owner's. */
export function onComputer<T>(principal: Principal, fn: () => T): T {
  if (principal === "owner") return outsideTenant(() => outsideOwnGpu(fn));
  // A task always belongs to the owner or an account; a pool only takes it (callers pass the task's own principal).
  if (!principal.startsWith("acct:")) throw new Error("Not a task's principal");
  return runAsTenant({ kind: "account", id: principal.slice(5) }, () => onOwnGpu({ kind: "computer", principal: principal as `acct:${string}` }, fn));
}

/** The most one result may weigh when it comes from a computer: an account's 1 GB (less when its files are fuller); the owner's 8 GB. */
const OWNER_RESULT_BYTES = 8 * 2 ** 30;
/** The free space the owner's results never use (less than accounts keep free: the owner's own work goes on longer). */
const OWNER_DISK_FLOOR_BYTES = 2 * 2 ** 30;
/** A text result (a transcript, captions). */
const TEXT_RESULT_BYTES = 8 * 2 ** 20;

/**
 * A computer's finished prompt (its /history entry, or a meta-batch's passes): the results to collect, as the server's
 * own run would collect them (collectOutputs), each one a file the tab uploads under its number. An account keeps up to
 * 16 results and 1,800 EXR frames, never more than its files have room for. Call it as the task's principal (onComputer).
 */
export function planRelayOutputs(t: Pick<TaskRow, "id" | "workflow_id" | "meta_batch" | "prefix"> & Partial<Pick<TaskRow, "extra_json" | "pools">>, entries: HistoryEntryLike[], passes: boolean): FinishedPlan {
  let manifest: ManifestWorkflow | undefined;
  try {
    manifest = t.workflow_id ? getWorkflow(t.workflow_id).manifest : undefined;
  } catch {}
  const list = (passes ? entries : entries.slice(0, 1)) as HistoryEntry[];
  // A pass that failed (out of memory, a node exception) ends the job: say why instead of "no output".
  const failed = list.find((e) => e?.status?.status_str === "error");
  if (failed) {
    const interrupted = failed.status?.messages?.some(([type]) => type === "execution_interrupted");
    if (interrupted) return { error: RELAY_WORDS.stopped };
    // An account's own computer or paired ComfyUI (never the workers): a model file its loader can't read, or doesn't
    // have, is kept as what it is, and said plainly with where to get it when the run is read (relayFailure).
    const err = executionError(failed);
    if (tenantAccount() && !t.pools && err && modelFileProblem(err.node_type, err.exception_message)) return { error: modelFileTaskError(jobErrorOf(err, failed.prompt?.[2], manifest)) };
    return { error: explainExecutionError(err, manifest) };
  }
  const collect = (e: HistoryEntry) => collectOutputs(e, manifest, `relay:${t.id}`);
  let outputs: ComfyOutput[] = passes ? metaBatchResults(list, collect) : list[0] ? collect(list[0]) : [];
  // A meta-batch's first pass may have saved only its EXR frames: the clip comes with the last pass.
  if (t.meta_batch && !passes && t.prefix && !outputs.some((o) => !isFrame(o))) return { follow: t.prefix };
  if (!outputs.length) return { error: "This run finished without a result. Press Retry." };
  const account = tenantAccount();
  let budget = Infinity;
  if (account) {
    const frames = outputs.filter((o) => o.meta?.role === "frames");
    if (frames.length > ACCOUNT_LIMITS.framesPerJob) return { error: `Your ComfyUI made ${frames.length} EXR frames. A run on your GPU keeps up to ${ACCOUNT_LIMITS.framesPerJob}: export a shorter clip.` };
    outputs = [...outputs.filter((o) => o.meta?.role !== "frames").slice(0, ACCOUNT_LIMITS.outputsPerJob), ...frames];
    if (!diskHasRoom()) return { error: ACCOUNT_MESSAGES.diskLow };
    budget = accountTotalBytes(account) - accountUsage(account).total;
    if (budget <= 0) return { error: filesFullMessage(account) };
    // On the workers, never past the disk's free floor either: a worker token that reports a made-up history can't fill
    // the server's disk. (A run on the account's own GPU keeps the room its files have, as before.)
    if (t.pools) {
      const disk = diskFreeBytes() - diskFloorBytes();
      if (disk <= 0) return { error: ACCOUNT_MESSAGES.diskLow };
      budget = Math.min(budget, disk);
    }
  } else if (t.pools) {
    // The owner's job on the workers: never past the disk's free floor, never more results than its workflow says it
    // makes (at least 16), and EXR frames up to the same number as an account's: a worker token that reports a made-up
    // history can't fill the server's disk. (The owner's own computer keeps every result, as before.)
    const frames = outputs.filter((o) => o.meta?.role === "frames");
    if (frames.length > ACCOUNT_LIMITS.framesPerJob) return { error: `ComfyUI made ${frames.length} EXR frames. A run keeps up to ${ACCOUNT_LIMITS.framesPerJob}: export a shorter clip.` };
    const declared = extraOf(t).outputs ?? 0;
    outputs = [...outputs.filter((o) => o.meta?.role !== "frames").slice(0, Math.max(ACCOUNT_LIMITS.outputsPerJob, declared)), ...frames];
    budget = diskFreeBytes() - Math.min(diskFloorBytes(), OWNER_DISK_FLOOR_BYTES);
    if (budget <= 0) return { error: "There's no room on this server's disk to keep this result. Free some space, then press Retry." };
  }
  const wanted: WantedFile[] = [];
  outputs = outputs.map((o) => {
    if (!o.url.startsWith("relay:")) return o;
    const q = new URLSearchParams(o.url.split("?")[1] ?? "");
    const n = wanted.length;
    const frame = o.meta?.role === "frames";
    const kind: WantedFile["kind"] = frame ? "frame" : o.kind === "image" || o.kind === "video" || o.kind === "audio" || o.kind === "text" || o.kind === "model3d" ? o.kind : "image";
    const cap = frame ? OWN_FRAME_MAX_BYTES : kind === "text" ? TEXT_RESULT_BYTES : account ? OWN_OUTPUT_LIMITS.maxBytes : OWNER_RESULT_BYTES;
    wanted.push({ n, filename: q.get("filename") ?? "", subfolder: q.get("subfolder") ?? "", type: q.get("type") === "temp" ? "temp" : "output", kind, maxBytes: Math.max(1, Math.min(cap, budget)) });
    return { ...o, url: `${o.url}&n=${n}`, headers: undefined };
  });
  return { wanted, outputs, budget: Number.isFinite(budget) ? budget : Number.MAX_SAFE_INTEGER };
}

/** An account's ComfyUI that refused a job without saying why: plain words (the owner's keep the status). */
const REFUSED_PLAIN = "Your ComfyUI couldn't start this run. Update your add-ons, then press Retry.";

/** A relay task's error for a model file an account's loader can't read or doesn't have: what diagnose.ts reads, as JSON. */
const MODEL_FILE_TASK = "model-file:";

function modelFileTaskError(e: Extract<GpuJobTrouble, { kind: "error" }>): string {
  return MODEL_FILE_TASK + JSON.stringify({ node: e.nodeType?.slice(0, 128), said: e.message?.slice(0, 1024), files: e.files, url: e.fileUrl });
}

/** That error, as the run's plain words with what helps (on the account's own computer or paired ComfyUI). */
function modelFileTaskFailure(e: string): { error: string; trouble: Diagnosis } | null {
  if (!e.startsWith(MODEL_FILE_TASK)) return null;
  let j: { node?: unknown; said?: unknown; files?: unknown; url?: unknown } = {};
  try {
    j = (JSON.parse(e.slice(MODEL_FILE_TASK.length)) ?? {}) as typeof j;
  } catch {}
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const files = Array.isArray(j.files) ? j.files.filter((f): f is string => typeof f === "string") : [];
  const fileUrl = str(j.url);
  const d = diagnoseGpuJob({ kind: "error", nodeType: str(j.node), message: str(j.said), files, ...(fileUrl && { fileUrl }) }, { kind: "computer" });
  return { error: d.words, trouble: d };
}

/** A task's error as the run's words (and what was missing, for "Fix it"; for a model file, what helps). */
export function relayFailure(t: TaskRow, manifest: ManifestWorkflow | undefined): { error: string; fix?: GenerationFix; trouble?: Diagnosis } {
  const refusal = refusalOf(t);
  if (refusal && manifest) {
    const r = promptRefusal((refusal.body ?? {}) as PromptRefusalBody, refusal.status, manifest, extraOf(t).loras ?? []);
    // An account's own computer or paired ComfyUI: a model file outside the workflow's list ("Fix it" doesn't know it), named.
    const file = tenantAccount() && !t.pools && !r.fix && !r.plain ? unlistedModelFile((refusal.body ?? {}) as PromptRefusalBody, manifest, { kind: "computer" }) : null;
    if (file) return { error: file.words, trouble: file };
    return { error: r.message ?? (tenantAccount() ? REFUSED_PLAIN : `Your ComfyUI refused the job (HTTP ${refusal.status})`), ...(r.fix && { fix: r.fix }) };
  }
  if (refusal) return { error: tenantAccount() ? REFUSED_PLAIN : `Your ComfyUI refused the job (HTTP ${refusal.status})` };
  const e = t.error ?? "";
  const tab = /^tab:([a-z-]+)(?::(\d+))?$/.exec(e);
  if (tab) return { error: tabFailureWords(tab[1] as TabFailure, tab[2] ? Number(tab[2]) : undefined, !!tenantAccount()) };
  const file = modelFileTaskFailure(e);
  if (file) return file;
  const words: Record<string, string> = { lost: RELAY_WORDS.lost, silent: RELAY_WORDS.computerSilent, down: RELAY_WORDS.comfyDownTooLong, tooBig: RELAY_WORDS.tooBig };
  if (e === "full") {
    const account = tenantAccount();
    return { error: account ? filesFullMessage(account) : "There's no room to keep this result." };
  }
  return { error: words[e] ?? (e || "Your ComfyUI couldn't finish this run") };
}

/** A run on someone's computer: where its task is, in the words its tile shows. */
async function pollComputer(principal: Principal, meta: Record<string, unknown>, manifest: ManifestWorkflow | undefined, made: string | undefined): Promise<PollResult> {
  const found = typeof meta.relay === "string" ? ownTask(principal, meta.relay) : null;
  if (!found) return { state: "failed", error: "This run was lost. Press Retry." };
  const t = checkClocks(found);
  if (!t.pools) return pollTask(principal, t, meta, manifest, made);
  // A run on the workers: while it waits, its place in line; once a worker has it, that worker's reports (a worker that
  // goes quiet gives it back to the line, pool.ts, so no "open Fuobe on your computer"). It keeps its task's clocks
  // (pool.ts): its wait limit until a worker first takes it, then the deadline of each attempt from its claim. Back in
  // line after an attempt (a worker paused, went quiet, gave it back), it shows its kept place as any waiting run does,
  // and once a worker has it again, the usual words: never a restart.
  const res: PollResult = t.state === "waiting" ? { state: "queued", message: poolWaitWords(t) } : await pollTask(principal, t, meta, manifest, made);
  if (res.state !== "queued" && res.state !== "running") return res;
  const deadline = attemptDeadline(t);
  const clocks = { ownClocks: true as const, ...(deadline && { deadline }) };
  // An account's run says only where it is: in line, or working on it (the owner's own runs keep the workers' words).
  if (!tenantAccount()) return { state: res.state, progress: res.progress, message: res.message, ...clocks };
  return t.state === "waiting" ? { state: "queued", message: POOL_WORDS.inLine, ...clocks } : { state: "running", progress: res.progress, message: POOL_WORDS.working, ...clocks };
}

/** Where a task is (on someone's computer, or with a worker), in the words its tile shows. */
async function pollTask(principal: Principal, t: TaskRow, meta: Record<string, unknown>, manifest: ManifestWorkflow | undefined, made: string | undefined): Promise<PollResult> {
  const p = taskProgress(t);
  const kind = extraOf(t).made ?? made ?? "image";
  const waitMs = tenantAccount() ? ACCOUNT_LIMITS.queueMs : 4 * 3_600_000;
  const sentAt = t.sent_at ?? undefined;
  // Sent, and the computer's tab stopped answering (closed, asleep): not a run that looks alive for half an hour.
  const r = t.state === "waiting" || t.pools ? null : runnerFacts(principal);
  const away = !t.pools && t.state !== "waiting" && (!r || Date.now() - r.seenAt >= RELAY_TIMES.onlineMs);
  // A ComfyUI paired with a code runs the jobs itself (no Fuobe tab): one that is off is waited for in its own words.
  const paired = !t.pools && pairedRunner(principal);
  const down = t.down_at ? (t.down_why === "setting" ? RELAY_WORDS.comfyNoSetting : RELAY_WORDS.comfyDown) : away ? (paired ? RELAY_WORDS.pairedAway : RELAY_WORDS.computerAway) : undefined;
  const waitedTooLong = paired ? RELAY_WORDS.pairedWaitedTooLong(waitMs) : RELAY_WORDS.waitedTooLong(waitMs);
  switch (t.state) {
    case "waiting": {
      // The computer's tab is open, but its ComfyUI is closed or runs without Fuobe's setting: say that, not "open Fuobe".
      const f = runnerFacts(principal);
      const message = f?.online
        ? RELAY_WORDS.starting
        : f?.comfy === "no-setting"
          ? RELAY_WORDS.comfyNoSetting
          : f?.comfy === "down"
            ? RELAY_WORDS.comfyDown
            : paired
              ? RELAY_WORDS.pairedAway
              : RELAY_WORDS.noComputer;
      return { state: "queued", message, timeoutError: waitedTooLong };
    }
    case "sending":
      return { state: "queued", message: down ?? (t.note === "resent" && !t.pools ? RELAY_WORDS.resent : sendingWords(inputKinds(t))), timeoutError: waitedTooLong, ...(sentAt && { sentAt }) };
    case "queued":
      return { state: "queued", message: down ?? queueWords(p?.position), ...(sentAt && { sentAt }) };
    case "running": {
      return { state: "running", progress: runProgress(p, Number(meta.nodeCount ?? 0)), message: down ?? makingWords(kind, p?.value, p?.max), ...(sentAt && { sentAt }) };
    }
    case "collecting": {
      const got = receivedOf(t);
      const total = got.reduce((s, r) => s + r.total, 0);
      return { state: "running", progress: 0.99, message: down ?? savingWords(total ? got.reduce((s, r) => s + r.bytes, 0) / total : undefined), ...(sentAt && { sentAt }) };
    }
    case "done": {
      const types = new Map(receivedOf(t).map((r) => [r.n, r.contentType]));
      let outputs = resultOf<ComfyOutput>(t).map((o) => {
        const n = Number(new URLSearchParams(o.url.split("?")[1] ?? "").get("n"));
        const type = o.url.startsWith("relay:") ? types.get(n) : undefined;
        return type ? { ...o, contentType: type } : o;
      });
      if (!outputs.length) return { state: "failed", error: "This run finished without a result. Press Retry." };
      try {
        outputs = await bundleFrames(outputs, String(meta.generationId ?? ""));
      } catch (e) {
        return { state: "failed", error: (e as Error).message };
      }
      return { state: "succeeded", outputs: await withLayerBoxes(outputs) };
    }
    case "canceled":
      return { state: "failed", error: t.error === "switched" ? RELAY_WORDS.switched : t.error === "disconnected" ? RELAY_WORDS.disconnected : RELAY_WORDS.stopped };
    default:
      return { state: "failed", ...relayFailure(t, manifest) };
  }
}

export const comfyProvider: ProviderAdapter = {
  id: "comfyui",
  label: "ComfyUI",
  isConfigured: () => {
    if (ownGpu() || computerScope() || onPoolWorkers()) return true;
    const cur = globalThis.__fuobeComfyReach;
    // First check for this server: wait for the answer, so a request right after start isn't sent to demo.
    if (!cur || cur.url !== baseUrl()) return probeComfySync();
    if (Date.now() - cur.at > 10_000) void probeComfy().catch(() => false);
    return cur.ok;
  },

  // Inputs go to the server that runs the route's workflow (the isolated worker has its own input folder).
  async prepareFile(data, contentType, name, route?: ModelRoute) {
    return uploadTo(workerFor(route?.endpoint), data, contentType, name);
  },

  async submit({ route, input, generationId, model }) {
    const worker = workerFor(route.endpoint);
    if (worker === "isolated" && computerScope()) throw new ProviderError(ISOLATED_ON_COMPUTER);
    // A route's own graph settings (Fuobe Speak's InfiniteTalk recipe) go in unless the run sets them.
    const asked = route.extra ? { ...input, extra: { ...route.extra, ...input.extra } } : input;
    const prepared = await prepareWorkflow(route.endpoint, asked, {
      generationId,
      op: route.op,
      loraSlot: route.loraSlot === true,
      upload: (data, contentType, name) => uploadTo(worker, data, contentType, name),
      media: mediaInfoFor,
      serverRam: async () => {
        const computer = computerScope();
        if (computer) return factsOf(computer, route.endpoint)?.ramBytes;
        return (await comfyJson<{ system?: { ram_total?: number } }>("/system_stats", worker).catch(() => undefined))?.system?.ram_total;
      },
      device: () => comfyDevice(worker),
      modelPath: (folder, name) => comfyModelPath(folder, name, worker),
      vram: async () => {
        const computer = computerScope();
        if (computer) return factsOf(computer, route.endpoint)?.vramBytes;
        const s = await comfyJson<{ devices?: { vram_total?: unknown }[] }>("/system_stats", worker).catch(() => undefined);
        const v = s?.devices?.[0]?.vram_total;
        return typeof v === "number" && v > 0 ? v : undefined;
      },
      // Fresh: a model installed a moment ago runs. (On someone's computer, nothing to ask: its ComfyUI has the last word.)
      dbsModels: () => comfyDbsModels(worker, 0),
      reuseModels: () => comfyReuseModels(worker, 0),
      // The pack switched off in Settings → Models & licences: Idol 3D runs its core graph, as without the pack.
      idolPack: async () => ((await import("@/server/model-access")).readAccess().packs.includes(IDOL_PACK) ? false : comfyHasClass(IDOL_PACK_CLASS, worker)),
    });
    const { manifest, workflow: wf, meta } = prepared;
    // MiniMax H3's 2K draft that kept its latent says where (the finish loads it only there: generations.ts latentHandOff).
    const latentAt = manifest.id === H3_LATENT_DRAFT_WORKFLOW ? comfyPlace() : null;
    if (latentAt) meta.latentAt = latentAt;
    // On someone's computer: the job waits for their Fuobe tab, which sends exactly this graph under the prompt id minted
    // here. A refusal comes back in its report, and the poll explains it as below.
    const computer = computerScope();
    // An account's run on this install's GPUs: its graph reads only the files this run sent, checked here before it is
    // queued or sent (the workers check again; this install's own ComfyUI doesn't).
    const server = serverScope.getStore();
    const account = tenantAccount();
    if (account && (onPoolWorkers() || server)) {
      if (!computer && !installComfyLocal(worker)) throw new ProviderError(POOL_NOT_LOCAL);
      const problem = graphProblem(wf, computer ? freeInputs(computer) : [...(server?.uploads ?? [])]);
      if (problem) throw new ProviderError(problem);
    }
    if (computer) {
      const metaBatch = !!meta.metaBatch;
      const forPool = onWorkers(computer);
      // The owner's job that no worker is allowed and able to run would wait with no end (the owner's jobs have no wait
      // limit unless the owner sets one): it is refused now, as an account's run is.
      if (forPool && computer === "owner" && !workersCanRun(manifest.id)) throw new ProviderError(NO_WORKER_FOR_LANE);
      // A job larger than every PC that could run it may ever make (its ceiling) would never be taken: refused now, the
      // owner's and an account's alike, before it waits in line.
      if (forPool && workersCanRun(manifest.id) && !workersCanRun(manifest.id, { size: prepared.size })) throw new ProviderError(computer === "owner" ? NO_WORKER_FOR_SIZE : POOL_TOO_BIG);
      // The files the graph loads beyond its workflow's own (a look's, a motion's or a recipe's LoRAs): only a worker that
      // verified each one takes the task, and a job no worker could take is refused now, never left to wait for nothing
      // (or refused by a worker for a file it hasn't verified).
      const runtime = forPool ? runtimeNeeds(graphLoraNames(wf), loadIndex(), manifest.id) : null;
      if (runtime && workersCanRun(manifest.id) && (runtime.unknown.length || !workersCanRun(manifest.id, { files: runtime.files }))) {
        const lacking = [...runtime.unknown, ...runtime.files.filter((f) => !workersCanRun(manifest.id, { files: [f] })).map((f) => f.name)];
        throw new ProviderError(computer === "owner" ? noWorkerForFiles(lacking.length ? lacking : runtime.files.map((f) => f.name)) : POOL_NO_FILES);
      }
      const outputs = Math.max(1, manifest.outputs.length) * Math.max(1, Math.round(Number(input.numOutputs) || 1));
      // An account's run on the workers: a job ticket, and the worker composes the graph (the owner's own jobs keep theirs).
      const ticket = forPool && computer !== "owner" ? accountTicket(prepared, computer, { outputs, kind: model?.kind }) : undefined;
      const task = createTask({
        principal: computer,
        generationId,
        graph: forPool ? withoutSaveMetadata(wf) : wf,
        ...(ticket && { ticket }),
        prefix: typeof meta.prefix === "string" ? meta.prefix : undefined,
        metaBatch,
        // On the workers, a run whose outputs the moderation service sees first shows no preview while it works (its
        // ComfyUI makes none). A person's own computer shows its own previews in its tab, as before.
        preview: !(forPool && runStamp()?.checkOutputs),
        // (The task keeps the stamp too: showsPreview never keeps a preview picture for such a run.)
        ...(forPool && runStamp()?.checkOutputs && { extra: { checkOutputs: true } }),
        workflowId: manifest.id,
        made: model?.kind,
        loras: (input.loras ?? []).map((l) => ({ file: l.file, ...(l.url && { url: l.url }) })),
        outputs,
        ...(forPool && {
          pool:
            computer === "owner"
              ? // The owner's jobs on the workers: the lane and files they need, after every person's run (the owner's
                // class), with the owner's own wait limit (none unless the owner sets one: queue-settings.ts).
                poolFields(manifest.id, { class: "owner", waitMs: ownerWaitMs(), size: prepared.size, runtime: runtime?.files })
              : // An account's: the lane and files they need, in its class (paid before free), in the order they came
                // (with the billing service's head start inside the class), with the wait set for the run.
                // A ticket's task goes only to a worker built for its catalog, and inside that PC's ceiling.
                accountPoolFields(manifest.id, computer.slice(5), generationId, { size: prepared.size, catalogVersion: ticket?.catalogVersion, runtime: runtime?.files }),
        }),
      });
      // (`workers`: the run keeps its task's clocks, pool.ts, even when a poll of it fails.)
      return { externalId: task.promptId, meta: { ...meta, generationId, relay: task.id, ...(forPool && { workers: true }) }, payload: wf };
    }
    // A run on this install's workers with no account behind it is never sent anywhere.
    if (onPoolWorkers()) throw new ProviderError(ON_COMPUTER_ONLY);
    const { clientId } = ensureSocket(worker);
    const res = await comfyFetch(
      "/prompt",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: wf, client_id: clientId }),
      },
      worker,
    );
    const answer = await res.text().catch(() => "");
    let body: PromptRefusalBody & { prompt_id?: string } = {};
    try {
      body = (JSON.parse(answer) ?? {}) as typeof body;
    } catch {}
    // A 2K finish whose draft's latent isn't on this ComfyUI any more (its output folder was cleaned): the draft's clip,
    // chained into the same run, is redrawn instead.
    if (!res.ok && latentGone(body, manifest) && typeof input.extra?.latentFrom === "string") {
      const { latentFrom: _gone, ...extra } = input.extra;
      void _gone;
      return comfyProvider.submit({ route, input: { ...input, extra }, generationId, model });
    }
    if (!res.ok || !body.prompt_id) {
      // The pack may have gone since the server said it had it: the next run asks again (and runs the core graph without it).
      if (manifest.id === IDOL_WORKFLOWS.clean || manifest.id === IDOL_VIEWS_WORKFLOW) forgetComfyClass(IDOL_PACK_CLASS, worker);
      const refusal = promptRefusal(body, res.status, manifest, input.loras ?? [], worker);
      if (!refusal.message && !res.ok && worker === "isolated") throw isolatedAnswer("the prompt", res.status);
      // An account's link: no words from ComfyUI (a stopped pod's or a proxy's page) is read for what it means; ComfyUI's
      // own refusal is said plainly, its words in the details line.
      const link = ownLink();
      if (link) {
        if (!refusal.message) throw gpuTrouble({ stage: "prompt", status: res.status, body: answer.slice(0, 4096), contentType: res.headers.get("content-type") ?? undefined }, link);
        const d: Diagnosis = refusal.plain
          ? { cause: "gpu-refused", words: refusal.message, ...(refusal.details && { details: refusal.details }), actions: [{ kind: "retry", label: "Retry" }], retryable: false }
          : ((!refusal.fix && unlistedModelFile(body, manifest, link)) || diagnoseRefusal(refusal.message));
        throw Object.assign(troubleError(d, res.status), refusal.fix ? { fix: refusal.fix } : {});
      }
      throw Object.assign(new ProviderError(refusal.message ?? `ComfyUI /prompt failed (${res.status})`, res.status), refusal.fix ? { fix: refusal.fix } : {});
    }
    if (!PROMPT_ID.test(body.prompt_id)) {
      // Stop it there: an id Fuobe can't use would never be collected.
      throw new ProviderError(ownGpu() ? "Your ComfyUI couldn't take this run. Press Retry." : "ComfyUI couldn't take this run. Press Retry.");
    }
    return { externalId: body.prompt_id, meta: { ...meta, generationId, ...(worker === "isolated" && { worker }) }, payload: wf };
  },

  async poll({ externalId, meta, model, ...rest }) {
    if (!PROMPT_ID.test(externalId)) return { state: "failed", error: "ComfyUI couldn't take this run. Press Retry." };
    const worker: ComfyWorker = meta.worker === "isolated" ? "isolated" : "main";
    let manifest: ManifestWorkflow | undefined;
    try {
      manifest = getWorkflow(String(meta.workflowId)).manifest;
    } catch {}
    // A run is followed where it was sent (Settings, or the account's GPU, may have moved since).
    if (typeof meta.relay === "string") return pollComputer(relayPrincipal(), meta, manifest, model?.kind);
    if (computerScope()) {
      // Sent to a link before the account chose this computer: that link is gone.
      if (ownGpu()) return { state: "failed", error: RELAY_WORDS.switched };
      return onInstallServer(() => comfyProvider.poll({ externalId, meta, model, ...rest }));
    }
    const finished = async (entry: HistoryEntry) => {
      // A Context Loop job (Group swap, Scene edit): its clips and checkpoints under output/h3_chains go once it ends (the
      // final video is copied out of that folder first).
      if (manifest && CONTEXT_LOOP_IDS.has(manifest.id) && typeof meta.generationId === "string") void deleteRunFolder(runName(meta.generationId), worker);
      if (entry.status?.status_str === "error") {
        forget(externalId);
        // An account's link: stopped there, out of memory, a model file it can't read, or an add-on's exception, said
        // plainly (its words go in details).
        const link = ownLink();
        if (link) return ownJobFailed(entry, manifest, link);
        return { state: "failed" as const, error: explainExecutionError(executionError(entry), manifest) };
      }
      let outputs = collectOutputs(entry, manifest, baseUrl(worker), authHeaders(worker));
      // A meta-batch's first pass may have saved only its EXR frames: the clip comes with the last pass.
      if (meta.metaBatch && typeof meta.prefix === "string" && !outputs.some((o) => !isFrame(o))) {
        const next = await followMetaBatch(meta.prefix, manifest, worker);
        if (next === "running") return { state: "running" as const, message: "Rendering the next batch of frames" };
        if (next && "error" in next) {
          forget(externalId);
          const link = ownLink();
          return link ? ownJobFailed(next.failed, manifest, link) : { state: "failed" as const, error: next.error };
        }
        outputs = next ?? [];
      }
      forget(externalId);
      if (!outputs.length) return { state: "failed" as const, error: "This run finished without a result. Press Retry." };
      try {
        outputs = await bundleFrames(outputs, String(meta.generationId ?? String(meta.prefix ?? "").replace(/^fuobe\//, "")));
      } catch (e) {
        return { state: "failed" as const, error: (e as Error).message };
      }
      const seed = typeof meta.seed === "number" ? meta.seed : undefined;
      if (seed !== undefined) outputs = outputs.map((o) => (o.kind === "image" ? { ...o, meta: { ...o.meta, seed } } : o));
      if (manifest?.id === H3_REMOVAL_WORKFLOW) outputs = await withRemovalReview(entry, outputs, meta.reviewInputs, worker, String(meta.generationId ?? String(meta.prefix ?? "").replace(/^fuobe\//, "")));
      return { state: "succeeded" as const, outputs: await withLayerBoxes(outputs) };
    };
    const isDone = (e: HistoryEntry | undefined): e is HistoryEntry => !!e && (!!e.status?.completed || e.status?.status_str === "success" || e.status?.status_str === "error");

    const entry = (await comfyJson<Record<string, HistoryEntry>>(`/history/${encodeURIComponent(externalId)}`, worker))[externalId];
    if (isDone(entry)) return finished(entry);

    // Still queued or running?
    const { progress } = ensureSocket(worker);
    const p = progress.get(externalId);
    const queue = await comfyJson<{ queue_running?: unknown[][]; queue_pending?: unknown[][] }>("/queue", worker);
    const running = queue.queue_running?.some((q) => q[1] === externalId);
    const pendingIdx = queuePlace(queue.queue_pending ?? [], externalId);
    if (!running && pendingIdx < 0 && !entry) {
      // It may have finished between the two requests (ComfyUI moves it from the queue to the history at once).
      const again = (await comfyJson<Record<string, HistoryEntry>>(`/history/${encodeURIComponent(externalId)}`, worker))[externalId];
      if (isDone(again)) return finished(again);
      const misses = globalThis.__fuobeComfyMisses ?? (globalThis.__fuobeComfyMisses = new Map());
      const n = (misses.get(externalId) ?? 0) + 1;
      misses.set(externalId, n);
      const link = ownLink();
      if (n < 3) return { state: "running", message: link ? "Checking on your GPU" : "Checking on ComfyUI" };
      forget(externalId);
      // An account's link: the runner may send it once more (generations.ts), as a computer's tab does.
      if (link) {
        const d = diagnoseGpuJob({ kind: "lost" }, link);
        return { state: "failed", error: d.words, trouble: d, lost: true };
      }
      return { state: "failed", error: "ComfyUI restarted and lost this run. Press Retry." };
    }
    globalThis.__fuobeComfyMisses?.delete(externalId);
    if (pendingIdx >= 0) {
      // The job the GPU runs now (another one), by its name there: a new one is a queue that moves.
      const busy = queue.queue_running?.[0]?.[1];
      return { state: "queued", position: pendingIdx, ...(typeof busy === "string" && { busyWith: busy.slice(0, 64) }), message: pendingIdx === 0 ? "Next in ComfyUI's queue" : `In ComfyUI's queue · ${pendingIdx} ahead` };
    }
    return {
      state: "running",
      progress: runProgress(p, Number(meta.nodeCount ?? 0)),
      message: p?.max ? `Sampling ${p.value}/${p.max}` : worker === "isolated" ? "Running on the isolated ComfyUI worker" : "Running on ComfyUI",
    };
  },

  async cancel(ctx) {
    const { externalId, meta } = ctx;
    // On someone's computer: the task ends now, and its prompt comes off their ComfyUI at their tab's next beat.
    if (typeof meta?.relay === "string") return requestStop(relayPrincipal(), meta.relay);
    if (computerScope()) {
      // Sent before ComfyUI moved to a computer: the owner's goes off the studio's own ComfyUI (a link is gone).
      if (!ownGpu()) await onInstallServer(() => comfyProvider.cancel!(ctx));
      return;
    }
    const worker: ComfyWorker = meta?.worker === "isolated" ? "isolated" : "main";
    forget(externalId);
    // A meta-batch job's later passes have prompt ids of their own (and jump the queue): find them by prefix.
    const prefix = meta?.metaBatch && typeof meta.prefix === "string" ? meta.prefix : undefined;
    const found = await stopPrompts(externalId, prefix, worker);
    if (prefix && found) void sweepPasses(prefix, worker);
  },

  async test(opts) {
    // The WorldCast worker's address (Settings → Open-source engine, beside the isolated worker): that worker answers.
    if (opts?.focus === "worldcastUrl") {
      const h = await worldcastHealth(10_000);
      if (h.ok) globalThis.__fuobeWorldcast = { base: worldcastBase(), at: Date.now(), ok: true, depth: h.depth ?? [] };
      return { ok: h.ok, detail: h.detail };
    }
    // On someone's computer: what its tab last said about it.
    const computer = computerScope();
    if (computer) {
      const f = runnerFacts(computer);
      if (!f?.online) return { ok: false, detail: RELAY_WORDS.noComputer };
      return { ok: true, detail: `ComfyUI ${f.version ?? ""} · ${f.device ?? "unknown device"}${f.vramBytes ? ` · ${(f.vramBytes / 2 ** 30).toFixed(0)} GB` : ""} · on your computer`.replace(/\s+/g, " ") };
    }
    const describe = async (worker: ComfyWorker) => {
      const res = await comfyFetch("/system_stats", {}, worker);
      if (!res.ok) {
        discardBody(res);
        throw new ProviderError(`HTTP ${res.status}`);
      }
      const s = (await res.json()) as { system?: { comfyui_version?: string }; devices?: { name?: string; vram_total?: number }[] };
      const dev = s.devices?.[0];
      return `ComfyUI ${s.system?.comfyui_version ?? ""} · ${dev?.name ?? "unknown device"}${dev?.vram_total ? ` · ${(dev.vram_total / 2 ** 30).toFixed(0)} GB` : ""}`;
    };
    // Checking the isolated worker's address: that worker answers, or it isn't connected (the main
    // server's state is the main address's test).
    if (opts?.focus === "comfyIsolatedUrl") {
      if (!baseUrl("isolated")) return { ok: false, detail: "No isolated worker address set" };
      return describe("isolated").then(
        (d) => ({ ok: true, detail: `isolated worker: ${d}` }),
        (e: Error) => ({ ok: false, detail: /^HTTP \d/.test(e.message) ? `The isolated worker at ${baseUrl("isolated")} answered ${e.message}` : e.message }),
      );
    }
    let detail: string;
    try {
      detail = await describe("main");
    } catch (e) {
      return { ok: false, detail: (e as Error).message };
    }
    // The isolated worker is optional: say whether it answers, without failing the main server's test.
    if (baseUrl("isolated")) {
      const iso = await describe("isolated").then(
        (d) => `isolated worker: ${d}`,
        () => `the isolated worker at ${baseUrl("isolated")} doesn't answer`,
      );
      detail = `${detail} · ${iso}`;
    }
    return { ok: true, detail };
  },
};

/** The LoRA files the ComfyUI server that runs `route` has (GET /models/loras), or null when it can't say. */
export async function comfyLoraFiles(route?: ModelRoute): Promise<string[] | null> {
  // On someone's computer: the list its tab last sent (null: it can't say, and ComfyUI's own check has the last word).
  const computer = computerScope();
  if (computer) return factsOf(computer)?.loras ?? null;
  try {
    const res = await comfyFetch("/models/loras", {}, workerFor(route?.endpoint));
    if (!res.ok) discardBody(res);
    return res.ok ? ((await res.json()) as string[]) : null;
  } catch {
    return null;
  }
}

/** Which manifest models are present on the connected ComfyUI server. */
export async function modelInventory(): Promise<Record<string, string[]> | null> {
  if (computerScope()) return null;
  try {
    const listed = await comfyFetch("/models");
    const folders = listed.ok ? ((await listed.json()) as string[]) : ["diffusion_models", "checkpoints", "text_encoders", "vae", "loras"];
    const out: Record<string, string[]> = {};
    await Promise.all(
      folders.map(async (f) => {
        const r = await comfyFetch(`/models/${f}`);
        out[f] = r.ok ? ((await r.json()) as string[]) : [];
      }),
    );
    return out;
  } catch {
    return null;
  }
}
