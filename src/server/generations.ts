import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import { getModel, getPreset } from "@/lib/catalog";
import { ANY_ANGLE } from "@/lib/catalog/any-angle";
import { NO_SUBJECT_MESSAGE, withFrontView } from "./any-angle";
import { applyMentions } from "@/lib/catalog/elements";
import { madeOfRun } from "@/lib/catalog/fitted";
import { routeDrops } from "@/lib/catalog/route-takes";
import { pickRoute, routeShortfalls, shortfallNote } from "@/lib/catalog/route-notice";
import { listWords } from "@/lib/unavailable";
import { migrateRequest, replacedBy } from "@/lib/catalog/replaced";
import { directorFieldWords } from "@/lib/catalog/cinema";
import { withSignatureWords } from "@/lib/catalog/palettes";
import { applySketch, stripMotionPaths } from "@/lib/catalog/sketch";
import { cueText, type Cue } from "@/lib/cues";
import { HELPER_FEATURES, HELPER_SUFFIX, isReviewStatus, type AssetUse, type ReviewFilter } from "@/lib/library";
import { checkWatermarkBoxes, COPY as WATERMARK_COPY, parseScanReport, rejectedRepair, type WatermarkQuality } from "@/lib/watermark";
import { sideMultipleProblem, upscaleTier } from "@/lib/av/upscale";
import { chainedWaitMessage, framesWait, keyframeChain } from "@/lib/catalog/keyframes";
import { clipBytesProblem, clipFileProblem, clipFpsProblem, clipSizeProblem, clipTotalProblem, clipWindowProblem, elementClipProblem, hasReferenceVoiceWindow, insertRangeProblem, portraitShapeProblem, referenceClipsProblem, referenceSeconds, referenceVoiceProblem, sourceFrames, voiceWindowProblem } from "@/lib/catalog/clip-windows";
import { avatarSeconds, clipEditSeconds, estimateCost, inferOperation, movedAppRequest, planGeneration, presetRoute, routeLoras, routesFor, sourceLengthProblem, withoutTriggers } from "@/lib/catalog/plan";
import { formatCost } from "@/lib/format";
import { framedLength, keepMatte, sizeValue } from "@/lib/catalog/payload";
import { fitLoras, loraName, lorasFit } from "@/lib/catalog/loras";
import { dualEngine, onEngine, pickEngine } from "@/lib/catalog/engines";
import { promptWithLoras, SOUL_MODELS, soulKind, soulLook, soulPostStep, soulPostSteps } from "@/lib/catalog/soul";
import { isDop } from "@/lib/catalog/dop";
import { postStepCost } from "@/lib/composer";
import { MIXED_ORIGINAL, originalFrameSize } from "@/lib/catalog/mixed-media";
import { imageSize } from "@/lib/image-size";
import { finishSteps, mosaicPixels, unionMasks } from "@/lib/soul-post";
import { ANGLES_ORIGINAL, MOSAIC_SCALE } from "@/lib/catalog/open-tools";
import { computeDimensions } from "@/lib/comfy";
import { captionFromWords, captionWords, parseCaption } from "@/lib/ideogram-caption";
import { AUTO_IMAGE, AUTO_MODELS, autoCandidates, autoPatterns, nextAutoFallback } from "@/lib/auto-image";
import { h3Frames, h3Prompt, inH3Layout } from "@/lib/h3-prompt";
import { h3ReferenceTags, h3TalkPrompt } from "@/lib/h3-references";
import {
  CHAIN_LIST_SLACK,
  LAST_FRAME_CHAIN,
  operationOutput,
  type ChainSlot,
  type DeclinedCard,
  type Engine,
  type Generation,
  type GenerationFix,
  type GenerationRequest,
  type MediaKind,
  type GenInput,
  type LoraRef,
  type ModelDef,
  type ModelRoute,
  type Operation,
  type OutputFile,
  type Preset,
  type ProviderId,
} from "@/lib/catalog/types";
import { DATA_DIR, db } from "./db";
import { keepVoiceEmbedding, savedVoiceFor } from "./voices";
import { listElements } from "./elements";
import { markStale } from "./gpu/snapshots";
import { loadIndex } from "./gpu/index-file";
import { qwen21Gpu } from "./qwen21-gpu";
import { h3Gpu } from "./h3-gpu";
import { H3_TIER_PARAM, H3_UNET_PARAM } from "@/lib/gpu/h3-tier";
import { DETAILS_MAX_IMAGES, GPU_PARAM, QWEN21_SPEED, speedLora } from "@/lib/qwen21-speed";
import { BLOCKED_CARD_MESSAGE, blockedMeasures, declinedNotice, LEGACY_DECLINED } from "./safety-card";
import { pollTrainings } from "./training";
import { createEndFrameClip, createExtendChain, createKeyframeFilm, createMosaicRun, createRefinedModel, createRelitClip, createShotFilm, createStillTo3d, createVoiceFirst, joinClips } from "./chains";
import { chainedRefine } from "@/lib/av/hi3d";
import { wantsVoiceFirst } from "@/lib/av/voice-first";
import { createH3TwoKRun, createRegenerateRun, keepsH3Latent, regenHeld, regenSwitchedOff } from "./regenerate";
import { H3_2K_STEPS_NOTE, h3TwoKRequests, REGEN_COPY, REGEN_MODEL, regenerateGraphLoras, wantsH3TwoK } from "@/lib/catalog/regenerate";
import { enhancePrompt, enhanceSoulWords, ideogramCaption } from "./enhance";
import { kandinskyPrompt } from "@/lib/kandinsky-prompt";
import { carriesLayout } from "@/lib/layout-prompt";
import { setResolver, watchGenerations, type LiveEvent } from "./live";
import { provider, PROVIDERS, RETIRED_PROVIDER_ERROR } from "./providers";
import { comfyLoraFiles, comfyPlace, computerScope, onOwnGpu, onPoolWorkers, outputFetch, outsideOwnGpu, OWN_OUTPUT_LIMITS, ownGpu, ownLink, probeComfy, relayFile, troubleError, type OwnGpu } from "./providers/comfyui";
import { accountById, accountGpu, gpuLink, type AccountGpu } from "./auth";
import { accountEngineMode, accountKey, markKeyGood, paidAllowed, usableProviders } from "./account-keys";
import { addKeyMessage, CLOUD_KEY, CLOUD_PROVIDERS, isCloudProvider, keyRemovedMessage, type CloudProvider } from "@/lib/your-keys";
import { cachedGpuState, GpuError, noteGpuState, testGpu } from "./account-gpu";
import { presetRoutes } from "@/lib/catalog/preset-recipe-routes";
import {
  backoffMs,
  cleanDetails,
  diagnoseGpu,
  diagnoseGpuJob,
  diagnoseKey,
  diagnoseKeyJob,
  gpuHostOf,
  HEAL_CAP_MS,
  resultExpired,
  retryPlan,
  troubleOf,
  waitingWords,
  withKeyAction,
  withOfferAfterFirst,
  type Diagnosis,
  type GpuFailure,
  type KeyStage,
  type RunTrouble,
  type TroubleAction,
  type TroubleCause,
} from "@/lib/diagnose";
import { draining } from "./shutdown";
import { keptText, networkCode, recordOwnRun, recordRunEvent, type HostKind } from "./run-events";
import { cleanEngineText, ENGINE_WORDS, isEngineWords, storedErrorText, withoutFolders } from "@/lib/engine-error";
import { CONNECT_GPU_MESSAGE, GUEST_RUN_MESSAGE, OWN_GPU_TOOL_MESSAGE } from "@/lib/guest-access";
import { MODEL3D_SETUP, ownSetupLabel } from "@/lib/own-setup";
import { outsideTenant, runAsTenant, tenant, tenantAccount } from "./tenant";
import { generationAccount } from "./account-library";
import { ACCOUNT_LIMITS, ACCOUNT_MESSAGES, accountTotalBytes, accountUsage, diskHasRoom, filesFullMessage } from "./account-files";
import { prunePoolAdmissions } from "./pool-limits";
import { checkAccountLoras } from "./account-loras";
import { missingFilesMessage, type MissingFiles } from "@/lib/missing-files";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { graphLoras as h3GraphLoras } from "@/lib/catalog/character-swap";
import { PIKA_FLEX_REF_WORKFLOW, pikaFlexGraphLoras } from "@/lib/catalog/pika-flex";
import { restoreGraphLoras } from "@/lib/restore-graph";
import { ensureLorasOnComfy, prepareCloudLoras, withoutUnreachableCivitai } from "./loras";
import { ACCESS_PLACE } from "@/lib/model-access";
import { offeredLoras, offeredRoutes, requireOffered } from "./model-access";
import { llmBackends, llmLabel, llmMissing, llmUsesClaude, probeLocal } from "./providers/llm";
import type { PollContext, PollResult, ProviderAdapter, RemoteOutput } from "./providers/types";
import { mediaFacts } from "./media-facts";
import { fitStill } from "./fit-still";
import { renderPathVideo } from "./path-render";
import { songFormat, songToolProblem } from "@/lib/lyrics";
import { hostedUntested } from "@/lib/catalog/hosted-untested";
import { appliesOwnStyle } from "@/lib/catalog/applied-style";
import { modelToFinish, startModelFinish, startTurntable, stopModelFinish, type OutputStore } from "./model3d-finish";
import { finishTask, pathOnWorker, poolFinishes3d, startWorkerModelFinish, stopWorkerFinish } from "./computer/finish";
import { PATH_FPS, PATH_FRAMES } from "@/lib/camera-path";
import { cropPicture, isCropWindow } from "./crop-picture";
import { convertMask, decodePng, encodePng } from "./png";
import { engineMode, getSetting, withCandidates, withoutCandidates } from "./settings";
import { blockedForAccounts, discardBody, fetchRemoteToFile, RemoteFetchError } from "./remote-fetch";
import { accountSend } from "./account-send";
import { stamped, stampOf, withoutStamp, withRunStamp, type RunStamp } from "./run-stamp";
import { anyHeld, dropGone, dropHold, HELD, NOT_HELD } from "./pool-holds";
import { FILE_TROUBLE_WORDS, POOL_WORDS, RELAY_WORDS } from "@/lib/relay";
import { heldLine, placeInLine, poolOnWorkers, poolRunsProvider, poolWaitMs, requestFileKinds, runOnPool, type FileKind } from "./hosted";
import { hostedRunsOn } from "./hosted-switch";
import { catalogVersion } from "./computer/catalog-version";
import { gettingReady, poolLane, queueOfGeneration, type LinePlace } from "./computer/pool";
import { ownerGpuMiss } from "./runs-here";
import { noteCatalogProcess, processStart } from "./computer/ticket-refresh";
import { hasJobFor, runPreviewAt, stopJobsOf } from "./computer/tasks";
import { runCeilingMs } from "./queue-settings";
import { sweepBilling } from "./billing-outbox";
import { inDemoScope, outsideDemo } from "./demo-scope";
import { moderationConfigured } from "./moderation";
import { holdForCheck, sweepOutputChecks } from "./output-checks";
import { absolutePath, adoptFile, contentTypeFor, deleteAsset, localHead, readRef, saveFile, scratchDir, scratchOutputFile } from "./storage";

interface Row {
  id: string;
  batch_id: string | null;
  feature: string;
  preset_id: string | null;
  model_id: string;
  engine: Generation["engine"];
  provider: ProviderId;
  op: Generation["op"];
  kind: Generation["kind"];
  status: Generation["status"];
  progress: number | null;
  message: string | null;
  prompt: string | null;
  request_json: string;
  provider_input_json: string | null;
  external_id: string | null;
  external_meta_json: string | null;
  outputs_json: string;
  error: string | null;
  cost_usd: number | null;
  favorite: number;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  depends_on: string | null;
  /** Library pin and review status (NULL until set; inserts leave them out). */
  pinned_at?: number | null;
  review?: string | null;
  /** Joined by the library readers (generation_trash, folder_items); looked up when absent. */
  deleted_at?: number | null;
  folder_id?: string | null;
  /** What a failed ComfyUI run was missing (GenerationFix as JSON). */
  fix_json?: string | null;
  /** NULL, or "checking": its outputs wait for the moderation service (output-checks.ts). */
  stage?: string | null;
  /**
   * A failed run's technical detail, for the owner only (the engine's own words, cleaned: src/lib/engine-error.ts), when
   * the person read a plain sentence in `error` instead. Never part of a Generation.
   */
  detail?: string | null;
}

/** Trash and folder columns, joined onto every library read. */
const LIBRARY_COLUMNS = "g.*, t.deleted_at AS deleted_at, fi.folder_id AS folder_id";
const LIBRARY_JOINS = "LEFT JOIN generation_trash t ON t.generation_id = g.id LEFT JOIN folder_items fi ON fi.generation_id = g.id";
const LIBRARY_JOIN = `generations g ${LIBRARY_JOINS}`;

export function toGeneration(r: Row): Generation {
  const stored = JSON.parse(r.request_json) as GenerationRequest;
  // The run's stamp is the server's (its place, the billing hold, its class in the line): never sent to a browser or a
  // script, so a retry that sends the request back never says where the last attempt ran.
  const hold = stored.hold;
  // Its hold set an amount aside: only then does a run that can't finish say it wasn't charged.
  const charged = !!hold && !!stored.charged;
  const request = withoutStamp(stored);
  // A run on this install's GPUs shows the account only where it is (in line, working) and its result, or one plain
  // sentence when it can't finish: never the technical reason, which the owner reads in the accounts' runs.
  const pool = stored.place === "pool";
  const checking = r.stage === "checking";
  // Working on the workers with its model still loading (taken by a worker that had another model loaded): "getting
  // ready", with no progress yet.
  const ready = pool && r.status === "running" && !checking && gettingReady(r.id);
  const model = getModel(r.model_id);
  // What it is made at where that differs from what it asked (a 2K run on a model that makes up to 1080P), worked out from
  // its model, mode and request, so older runs carry it too (src/lib/catalog/fitted.ts).
  const made = madeOfRun(model, { op: r.op, provider: r.provider, request });
  const ar = (made ? made.aspectRatio : request.params?.aspectRatio) ?? model?.defaults?.aspectRatio;
  // Rows read without the library join (the runner's own SELECTs) look the trash and folder up.
  const lib =
    r.deleted_at !== undefined && r.folder_id !== undefined
      ? { deleted_at: r.deleted_at, folder_id: r.folder_id }
      : (db()
          .prepare(
            "SELECT (SELECT deleted_at FROM generation_trash WHERE generation_id = ?) AS deleted_at, (SELECT folder_id FROM folder_items WHERE generation_id = ?) AS folder_id",
          )
          .get(r.id, r.id) as { deleted_at: number | null; folder_id: string | null });
  // An Ideogram 4 run that returned its "blocked" card (declinedAgain), made again in its place: Working, saying which model
  // makes it (never In line: nobody pressed Run again). One that waits for the account's own GPU to come back shows that.
  const meta = r.external_meta_json?.includes('"declined"') ? readMeta(r.external_meta_json) : undefined;
  const again = (r.status === "queued" || r.status === "running") && !(r.status === "queued" && !r.external_id && meta?.heal) ? declinedWords(meta ?? {}) : undefined;
  return {
    id: r.id,
    batchId: r.batch_id,
    feature: r.feature,
    presetId: r.preset_id,
    modelId: r.model_id,
    engine: r.engine,
    provider: r.provider,
    op: r.op,
    kind: r.kind,
    status: again ? "running" : r.status,
    // In line on this install's GPUs (again, after an attempt): no progress.
    progress: (pool && r.status === "queued") || ready ? null : r.progress,
    message: again ?? (pool ? poolMessage(r, ready) : r.message),
    prompt: r.prompt,
    request,
    // Held for the moderation service's check: nothing of it is shown until it passes.
    outputs: checking ? [] : shownOutputs(JSON.parse(r.outputs_json) as OutputFile[], pool),
    error: pool ? poolError(r.id, r.error, charged) : r.error,
    costUsd: r.cost_usd,
    favorite: !!r.favorite,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedAt: r.completed_at,
    // A run on a model Fuobe retired keeps the name it ran under (replaced.ts `was`); Reuse moves it to the replacement.
    modelName: model?.name ?? replacedBy(r.model_id)?.was ?? r.model_id,
    // A Fuobe Soul look is named like a preset ("Look · Y2K" in the viewer).
    presetName: r.preset_id ? (getPreset(r.preset_id)?.name ?? (soulKind(r.model_id) ? (soulLook(r.preset_id)?.name ?? null) : null)) : null,
    aspectRatio: ar && ar !== "auto" ? ar : null,
    deletedAt: lib.deleted_at ?? null,
    folderId: lib.folder_id ?? null,
    pinnedAt: r.pinned_at ?? null,
    review: isReviewStatus(r.review) ? r.review : null,
    ...(made && { made }),
    ...(r.status === "failed" && r.fix_json && !pool && { fix: parseFix(r.fix_json) }),
    ...(r.status === "failed" && r.fix_json && !pool && parseTrouble(r.fix_json)),
    // Waiting for its own GPU or key to come back: why, the buttons that help, and until when (never the owner's note).
    ...(r.status === "queued" && !r.external_id && r.external_meta_json && !pool && waitingOf(r)),
    // Failed or stopped before a paid provider took the job (a refused key, an empty balance): nothing was billed. Not
    // said of a run whose send was under way when it stopped: the provider may have the job.
    ...((r.status === "failed" || r.status === "canceled") && !r.external_id && (r.provider === "fal" || r.provider === "replicate") && !maybeSent(r) && { notBilled: true as const }),
    // On this install's GPUs (hosted runs): what it cost, or that it cost nothing.
    ...(stored.place === "pool" && { place: "pool" as const }),
    ...(stored.charge && r.status === "succeeded" && { charge: stored.charge }),
    // (Only when its hold set an amount aside: a free run's hold has nothing to give back, so nothing is said.)
    ...(charged && (r.status === "failed" || r.status === "canceled") && { notCharged: true as const }),
    // On this install's GPUs the output check is part of "Working": no word of its own.
    ...(checking && !pool && { stage: "checking" as const }),
    // Waiting in line on this install's GPUs: its place and the wait, about.
    ...(stored.place === "pool" && (r.status === "queued" || r.status === "running") && !checking && !again && poolQueue(r.id)),
    // The owner's own job on the workers, waiting: its place in their line (in the list as after a refresh).
    ...(stored.place !== "pool" && r.status === "queued" && r.provider === "comfyui" && !again && workerQueue(r.id)),
    // Working on this install's GPUs: the address of its latest preview picture, while there is one. None for a run
    // whose outputs the moderation service sees first (a preview would show what its check holds back).
    ...(r.status === "running" && r.provider === "comfyui" && !checking && !stored.checkOutputs && livePreview(r.id)),
    // The owner's own run: what Ideogram 4 returned in place of a picture (an account's run shows it in Accounts' runs).
    ...(!stored.account && declinedCardsOf(meta)),
  };
}

/** What Ideogram 4 returned in place of a picture, kept with the run for the owner (Generation.declinedCards). */
export function declinedCardsOf(meta: { declined?: unknown } | undefined): { declinedCards: DeclinedCard[] } | Record<string, never> {
  const cards = (meta?.declined as DeclinedMeta | undefined)?.cards;
  return Array.isArray(cards) && cards.length ? { declinedCards: cards } : {};
}

/** declinedCardsOf for a stored row (Accounts' runs). */
export function declinedCardsIn(id: string): { declinedCards: DeclinedCard[] } | Record<string, never> {
  const json = db().prepare("SELECT external_meta_json FROM generations WHERE id = ?").pluck().get(id) as string | null | undefined;
  return json?.includes('"declined"') ? declinedCardsOf(readMeta(json)) : {};
}

/** The owner's job waiting for the workers: its place in their line, as the Generation field. */
function workerQueue(id: string): { queue: LinePlace } | Record<string, never> {
  const q = queueOfGeneration(id);
  return q ? { queue: q } : {};
}

/** A run's latest preview picture from the workers, as the address its tile loads (it changes with each picture). */
function livePreview(id: string): { preview: string } | Record<string, never> {
  // (Only with hosted runs on: computer/tasks.ts previewShown.)
  const at = hostedRunsOn() ? runPreviewAt(id) : null;
  return at ? { preview: `/api/generations/${encodeURIComponent(id)}/preview?at=${at}` } : {};
}

/**
 * A row's outputs as its viewer reads them. On this install's GPUs, a finish step's own trouble (the server's words about
 * the web copy of a 3D model) stays on the server: the owner reads it in the log, the account gets the model as it is.
 */
function shownOutputs(outputs: OutputFile[], pool: boolean): OutputFile[] {
  if (!pool) return outputs;
  return outputs.map((o) => {
    const finish = o.meta?.finish;
    if (!finish || typeof finish !== "object" || !("error" in finish)) return o;
    const { error: _error, ...rest } = finish as Record<string, unknown>;
    void _error;
    return { ...o, meta: { ...o.meta, finish: rest } };
  });
}

/**
 * A row's failure as its viewer reads it, by its id: a run on this install's GPUs in the words its tile says (poolError:
 * one plain sentence for anything technical), any other as it was stored. For pages that read a step's failure from the
 * table itself (a Mixed Media render's frames).
 */
export function shownError(id: string, raw: string | null): string | null {
  const r = db().prepare("SELECT request_json FROM generations WHERE id = ?").get(id) as { request_json: string } | undefined;
  if (!r) return raw;
  const stored = JSON.parse(r.request_json) as GenerationRequest;
  return stored.place === "pool" ? poolError(id, raw, !!stored.hold && !!stored.charged) : raw;
}

/** A pool row's words while it goes: in line, or working on it (`ready`: still getting ready, its model loading). */
function poolMessage(r: Pick<Row, "status" | "message">, ready = false): string | null {
  if (r.status === "queued") return POOL_WORDS.inLine;
  if (r.status === "running") return ready ? POOL_WORDS.gettingReady : POOL_WORDS.working;
  return null;
}

/**
 * A pool row's failure as the account reads it: Fuobe's own plain words about the account's side (its files are full, a
 * picture it can't use, it stopped the run) and the output check's words (a result it removed) as they are; anything
 * else (whatever the GPUs, ComfyUI, a worker or the server's own state said) one plain sentence. "Not charged" stays only
 * on a run that had something set aside (`charged`).
 */
function poolError(id: string, error: string | null, charged: boolean): string | null {
  if (!error) return error;
  if (PLAIN_POOL_ERRORS().has(error) || isEngineWords(error) || /^Your files have reached \d+ GB\b/.test(error)) return error;
  const checked = db().prepare("SELECT 1 FROM output_checks WHERE generation_id = ? AND state IN ('hidden', 'unchecked') LIMIT 1").get(id);
  if (!checked) return POOL_WORDS.failed;
  return charged ? error : error.replace(/\s*Not charged\.$/, "");
}

/**
 * The words a pool row's failure keeps as they are: about the account's own side only (a file it sent, its files full,
 * it stopped the run) and the safety and output checks. Words about the server's own state (its disk, its upload or
 * finish limits) become the one plain sentence.
 */
const PLAIN_POOL_ERRORS = (() => {
  let set: Set<string> | undefined;
  const m = ACCOUNT_MESSAGES;
  return () =>
    (set ??= new Set<string>([
      m.imageTooBig,
      m.imageTooManyPixels,
      m.audioTooBig,
      m.videoTooBig,
      m.fileTooBig,
      m.wrongType,
      m.uploadsFull,
      m.filesFull,
      RELAY_WORDS.stopped,
      POOL_WORDS.failed,
      // About the person's own files: what to change, so kept (the GPU couldn't read or finish with them).
      FILE_TROUBLE_WORDS.crashed,
      FILE_TROUBLE_WORDS.unreadable,
      BLOCKED_CARD_MESSAGE,
      NO_SUBJECT_MESSAGE,
      WATERMARK_COPY.rejected,
      WATERMARK_COPY.scanFailed,
    ]));
})();

/** A pool row's place in line, as the Generation field (none once it has started). */
function poolQueue(id: string): { queue: LinePlace } | Record<string, never> {
  // A run made but waiting to enter the line (pool-holds.ts): why, and where it stands as its tile says it.
  const q = heldLine(id) ?? placeInLine(id);
  return q ? { queue: q } : {};
}

function parseFix(json: string): GenerationFix | null {
  try {
    const { trouble: _trouble, ...f } = JSON.parse(json) as GenerationFix & { trouble?: unknown };
    void _trouble;
    return f && typeof f.code === "string" && Array.isArray(f.items) ? f : null;
  } catch {
    return null;
  }
}

/** What an account's GPU or key ran into (fix_json `trouble`), as the Generation field. */
function parseTrouble(json: string): { trouble: RunTrouble } | Record<string, never> {
  try {
    const t = (JSON.parse(json) as { trouble?: RunTrouble }).trouble;
    return t && typeof t.cause === "string" && Array.isArray(t.actions) ? { trouble: t } : {};
  } catch {
    return {};
  }
}

/**
 * A waiting run's diagnosis (external_meta_json `heal`), as the Generation field. A run Run with your key can't move on
 * its own (keyMoveBlock: a step of a longer run, or a tool's run for one of the account's projects) never offers it,
 * also when its wait was kept before.
 */
function waitingOf(r: Pick<Row, "id" | "depends_on" | "batch_id" | "request_json" | "external_meta_json">): { waiting: RunTrouble & { until?: number } } | Record<string, never> {
  const h = readMeta(r.external_meta_json).heal;
  if (!h?.trouble || typeof h.trouble.cause !== "string" || !Array.isArray(h.trouble.actions)) return {};
  const t = h.trouble.actions.some((a) => a.kind === "run-with-key") && keyMoveBlock(r) ? withoutKeyOffer(h.trouble) : h.trouble;
  return { waiting: { ...t, ...(h.deadline && { until: h.deadline }) } };
}

/** A run whose job was being sent when it stopped (a server cut off in the middle of the send): its provider may have it. */
const maybeSent = (r: Pick<Row, "error" | "external_meta_json">): boolean => r.error === CUT_OFF_SENDING || typeof readMeta(r.external_meta_json).heal?.sending === "number";

/**
 * A run that is one step of a longer one: it waits for an earlier step, or a later step (queued or running) waits for it.
 * Run with your key can't move such a step alone (the route answers 409 CHAINED_RUN, and its tile doesn't offer it).
 */
function inChain(r: string | Pick<Row, "id" | "depends_on">): boolean {
  const id = typeof r === "string" ? r : r.id;
  const dependsOn = typeof r === "string" ? (db().prepare("SELECT depends_on FROM generations WHERE id = ?").pluck().get(id) as string | null | undefined) : r.depends_on;
  if (dependsOn) return true;
  return !!db().prepare(`SELECT 1 FROM generations WHERE status IN ('queued', 'running') AND ${DEPENDENTS_OF} LIMIT 1`).get({ id, quoted: JSON.stringify(id) });
}

/** Why Run with your key can't take a waiting run's place on its own: a step of a longer run, or a run of a project. */
export type KeyMoveBlock = "chained" | "project";

/**
 * Whether Run with your key can take this waiting run's place on its own (null), and why not. One check for its tile,
 * its next try's words and the route (POST /api/generations with `replaces`), so a button that shows can always act.
 *
 * - "chained": a step of a longer run (it waits for an earlier step, or a later step waits for it), or a job of a batch
 *   whose other waiting job a later step waits for (the press moves the whole batch). Moved alone, the rest of the run
 *   would go without it.
 * - "project": a run a tool made for one of the account's projects (a Cinema take, a storyboard, a short), even a take of
 *   one step. The project keeps the run it made: a run made in its place would be outside it, and the take would show
 *   Canceled. Only a run made on its own in a studio (stamped `standalone`, run-stamp.ts) moves.
 */
export function keyMoveBlock(r: string | Pick<Row, "id" | "depends_on" | "batch_id" | "request_json">): KeyMoveBlock | null {
  const row =
    typeof r === "string" ? (db().prepare("SELECT id, depends_on, batch_id, request_json FROM generations WHERE id = ?").get(r) as Pick<Row, "id" | "depends_on" | "batch_id" | "request_json"> | undefined) : r;
  if (!row) return null;
  if (inChain(row)) return "chained";
  if (row.batch_id) {
    // The batch's other jobs the press would stop with it (the same request, not handed over yet).
    const jobs = db()
      .prepare("SELECT id FROM generations WHERE batch_id = ? AND request_json = ? AND depends_on IS NULL AND status = 'queued' AND external_id IS NULL AND id != ?")
      .pluck()
      .all(row.batch_id, row.request_json, row.id) as string[];
    if (jobs.some((j) => inChain(j))) return "chained";
  }
  let standalone = false;
  try {
    standalone = (JSON.parse(row.request_json) as GenerationRequest).standalone === true;
  } catch {}
  return standalone ? null : "project";
}

/** What a step of a longer run that can't move to a key alone says (POST /api/generations with `replaces` on it). */
export const CHAINED_RUN = "This step is part of a longer run, so it can't move to your key on its own. It goes on by itself, or cancel it and run the tool again with your key.";

/** What a run of one of the account's projects says the same way (a Cinema take, a storyboard, a short). */
export const PROJECT_RUN = "This run is part of one of your projects, so it can't move to your key on its own. It goes on by itself, or cancel it and run it again in its project with your key.";

/** A trouble's buttons without Run with your key (a run that can't move to a key on its own). */
const withoutKeyOffer = <T extends { actions: TroubleAction[] }>(t: T): T => ({ ...t, actions: t.actions.filter((a) => a.kind !== "run-with-key") });

/**
 * What a run keeps in external_meta_json before its provider has it (external_id NULL): while it waits for its own GPU
 * or key, how the wait goes (`heal`), so another app process (a restart, a deploy) goes on with it instead of failing it.
 * Which process is handing it over or waiting on it is its turn (submit_turns). Once handed over the column holds the
 * provider's meta.
 */
interface PendingMeta {
  heal?: HealState;
  /** Sent again after its GPU lost it (once). */
  resent?: boolean;
  /** Which of its batch's jobs it is (its seed is the batch's + this). */
  jobIndex?: number;
  /**
   * A step of an account's longer run on its first try (nothing waited, so no `heal`): when its job began to be sent.
   * Cleared when the try fails and the step waits; gone once it is handed over (markSending).
   */
  sending?: number;
  /**
   * With `sending`: that send's job is a task of this database (a step of a run on this install's workers), so whether
   * the send made it is known (hasJobFor). Without it the job went to a ComfyUI or a provider that may have it.
   */
  sendingTask?: boolean;
  /** Who holds the run as the release before this one marked it (OLD_LEASE), and until when. */
  lease?: { by?: unknown; until?: unknown };
  /**
   * An Ideogram 4 run that returned only its "blocked" card (declinedAgain): the fallback that makes it now, and the
   * cards it returned (kept for the owner). Kept through every hand-over.
   */
  declined?: DeclinedMeta;
}

/** What an Ideogram 4 run that returned its "blocked" card keeps (PendingMeta.declined). */
interface DeclinedMeta {
  /** "fallback": a fallback makes it now. "retry": only on runs declined before (LEGACY_DECLINED). */
  stage?: "retry" | "fallback";
  /** The fallback model that makes it now (src/lib/auto-image.ts AUTO_FALLBACKS); none on a legacy Qwen-Image 2.1 run. */
  model?: string;
  cards?: DeclinedCard[];
  /** The run as Ideogram 4's, put back when every fallback fails (declinedFails). */
  was?: DeclinedRun;
}

/** The columns of a run that a fallback changes when it makes a run Ideogram 4 declined. */
type DeclinedRun = Pick<Row, "request_json" | "model_id" | "engine" | "op" | "kind" | "prompt" | "cost_usd">;
const declinedRun = (r: Row): DeclinedRun => ({ request_json: r.request_json, model_id: r.model_id, engine: r.engine, op: r.op, kind: r.kind, prompt: r.prompt, cost_usd: r.cost_usd });

/** A run's wait for its own GPU or key, kept with it (survives a restart). */
interface HealState {
  since: number;
  /** When it stops waiting (per cause, never past HEAL_CAP_MS from `since`). */
  deadline: number;
  /** When each cause was first seen: a change of cause (off, then starting up) gets that cause's whole budget. */
  firstSeen: Partial<Record<TroubleCause, number>>;
  tries: number;
  /** When it tries again. */
  next: number;
  index: number;
  rechecked?: boolean;
  /** The words of the last try (the run fails in them when the wait is over), and what helps meanwhile. */
  words?: string;
  trouble?: RunTrouble;
  /**
   * When a try began sending the job itself (markSending): an instance that takes the wait over later (this one cut off
   * in the middle of that send) doesn't send it again. Cleared when the try fails and the run waits again (markWaiting).
   */
  sending?: number;
}

const readMeta = (json: string | null | undefined): PendingMeta & Record<string, unknown> => {
  if (!json) return {};
  try {
    const m = JSON.parse(json) as unknown;
    return m && typeof m === "object" && !Array.isArray(m) ? (m as PendingMeta & Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/**
 * Who hands a run over: the app process that holds its turn (submit_turns, takeSubmitTurn), from the moment it begins to
 * send the run until it is handed over or stops, the wait for an account's own GPU or key included. Every app process
 * says every few seconds that it still runs (keepBeating), so a turn whose process stopped (a restart, a deploy's old
 * instance) is free once that process has gone quiet, and one it gave back (it exits, or it stops waiting on a run while
 * it drains) is free at once. One mechanism for every run: the owner's, an account's on its own GPU or key, and one on
 * this install's GPUs.
 */

/**
 * The release before this one marked the runs an instance held with a lease in external_meta_json (`lease`: {by, until},
 * renewed every 15 s, good for 60 s), not with a turn. For the first deploy of this release its old instance still runs
 * next to the new one for a moment, on the same database, so both marks count: a live lease whose holder isn't an app
 * process of this release (none in app_processes) holds a run as a turn of another process does, and while this process
 * holds a run's turn, the run carries a lease of this process too (takeSubmitTurn, renewed by the beat, gone with the
 * turn), which the release before reads as held. Neither then sends, fails or takes over a run the other holds.
 */
export const OLD_LEASE = { ms: 60_000, renewMs: 15_000 };

/** A lease field of a row's external_meta_json, in SQL (NULL when the column isn't JSON). */
const leaseField = (table: string, field: "by" | "until") =>
  `(CASE WHEN json_valid(${table}.external_meta_json) THEN json_extract(${table}.external_meta_json, '$.lease.${field}') END)`;

/**
 * SQL: a live lease of the release before (OLD_LEASE) holds the run in `table` (1, else 0: never NULL); this process's
 * own lease never does. Named parameters: @__now and @__me.
 */
const OLD_LEASE_HELD = (table: string) =>
  `(COALESCE(${leaseField(table, "until")} > @__now, 0) AND ${leaseField(table, "by")} IS NOT @__me
    AND NOT EXISTS (SELECT 1 FROM app_processes lp WHERE lp.token = ${leaseField(table, "by")}))`;

/** A live lease of the release before (OLD_LEASE) holds this run: an instance of that release is sending it or waiting on it. */
function oldLeaseHolds(json: string | null | undefined, now = Date.now()): boolean {
  const lease = readMeta(json).lease;
  if (!lease || typeof lease !== "object" || typeof lease.until !== "number" || lease.until <= now) return false;
  if (lease.by === runnerToken()) return false;
  return !(typeof lease.by === "string" && db().prepare("SELECT 1 FROM app_processes WHERE token = ?").get(lease.by));
}

/** This process's lease on a run whose turn it holds (OLD_LEASE), as SQL sets it (@lease: leaseOf). */
const LEASE_SET = `json_set(CASE WHEN json_valid(external_meta_json) THEN external_meta_json ELSE '{}' END, '$.lease', json(@lease))`;
const leaseOf = (now: number) => JSON.stringify({ by: runnerToken(), until: now + OLD_LEASE.ms });

/**
 * Another app process took this run's turn (this one went quiet meanwhile), or an instance of the release before holds it
 * (OLD_LEASE): it is that process's to send now.
 */
function turnTaken(id: string): boolean {
  const r = db().prepare("SELECT s.held_by, g.external_meta_json FROM generations g LEFT JOIN submit_turns s ON s.id = g.id WHERE g.id = ?").get(id) as
    | { held_by: string | null; external_meta_json: string | null }
    | undefined;
  if (!r) return false;
  return (r.held_by !== null && r.held_by !== runnerToken()) || oldLeaseHolds(r.external_meta_json);
}

/** A row still waiting for its hand-over (queued or running, no job yet): only then is it changed. */
const PENDING = "status IN ('queued', 'running') AND external_id IS NULL";

/**
 * Fields as they are written: a run's error never keeps a machine's path, a tool's banner or a stack trace, and its
 * owner-only detail is cleaned the same way (src/lib/engine-error.ts).
 */
function storedFields(fields: Partial<Row>): Partial<Row> {
  if (typeof fields.error !== "string" && typeof fields.detail !== "string") return fields;
  return {
    ...fields,
    ...(typeof fields.error === "string" && { error: storedErrorText(fields.error) }),
    ...(typeof fields.detail === "string" && { detail: cleanEngineText(fields.detail) || null }),
  };
}

function update(id: string, given: Partial<Row>): void {
  const fields = storedFields(given);
  const keys = Object.keys(fields);
  if (!keys.length) return;
  db()
    .prepare(`UPDATE generations SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = @__now WHERE id = @__id`)
    .run({ ...fields, __now: Date.now(), __id: id });
}

/**
 * Set server fields on rows a studio tool made, after it made them (a skill recipe's tool run: the `skill` stamp and the
 * skill's `batchTitle`), and on every row of their batches (the tool's helper steps). Returns those batches.
 */
export function stampRequests(ids: string[], fields: (batches: string[]) => Pick<GenerationRequest, "skill" | "batchTitle">): string[] {
  if (!ids.length) return [];
  const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");
  const batches = (db().prepare(`SELECT DISTINCT batch_id FROM generations WHERE id IN (${marks(ids.length)}) AND batch_id IS NOT NULL`).all(...ids) as { batch_id: string }[]).map((r) => r.batch_id);
  const rows = db()
    .prepare(`SELECT id, request_json FROM generations WHERE id IN (${marks(ids.length)})${batches.length ? ` OR batch_id IN (${marks(batches.length)})` : ""}`)
    .all(...ids, ...batches) as Pick<Row, "id" | "request_json">[];
  const set = fields(batches);
  db().transaction(() => {
    for (const r of rows) update(r.id, { request_json: JSON.stringify({ ...(JSON.parse(r.request_json) as GenerationRequest), ...set }) });
  })();
  return batches;
}

/** One generation; a row in the Trash reads as missing unless `includeDeleted`. */
export function getGeneration(id: string, opts: { includeDeleted?: boolean } = {}): Generation | null {
  ensureRunner();
  const r = db().prepare(`SELECT ${LIBRARY_COLUMNS} FROM ${LIBRARY_JOIN} WHERE g.id = ?`).get(id) as Row | undefined;
  if (!r || (r.deleted_at && !opts.includeDeleted)) return null;
  return toGeneration(r);
}

export interface ListOptions {
  batchId?: string;
  feature?: string;
  features?: string[];
  kind?: string;
  kinds?: string[];
  models?: string[];
  favorites?: boolean;
  status?: string;
  statuses?: string[];
  /** Only clips saved from this Marketing template (a Kinetic Motion recipe that names it). */
  template?: string;
  /** Only the Trash, newest deletion first (`before` is then a deletedAt cursor). Otherwise the Trash is left out. */
  trashed?: boolean;
  folderId?: string;
  /** In any of these folders (a folder and its subfolders). */
  folderIds?: string[];
  /** Only pinned ones, most recently pinned first (`before` is then a pinnedAt cursor); false: only the others. */
  pinned?: boolean;
  /** Review statuses ("none": no status). */
  reviews?: ReviewFilter[];
  /**
   * Also list helper steps (chain steps and helper jobs: isHelperFeature in src/lib/library.ts). A list
   * that names its features or its batch always gets them; others (the Library, the home feed,
   * Assist's list_recent) leave them out unless this is set.
   */
  steps?: boolean;
  limit?: number;
  /**
   * Paging cursor: made before this (deleted before, in the Trash). With `beforeId` it is the last
   * row of the previous page, so rows sharing its timestamp (a bulk trash, a batch made in one
   * millisecond) are paged by id instead of skipped.
   */
  before?: number;
  beforeId?: string;
  /**
   * Public sign-up: only this account's runs. Without it, only the owner's (an account's runs are its
   * own: they stay out of the owner's lists).
   */
  account?: string;
  /** Every account's runs, never the owner's: the owner's view of what accounts make (src/server/account-admin.ts). */
  accounts?: boolean;
  /** Everyone's runs, the owner's and every account's (the owner's admin view); `account` and `accounts` win over it. */
  everyone?: boolean;
  /**
   * Where it ran: "pool" (this install's GPUs: hosted runs, and the owner's runs on the install's ComfyUI), "provider" (a
   * cloud provider: fal, Replicate…), "own" (an account's own GPU).
   */
  where?: "pool" | "provider" | "own";
  /** A model id that holds these letters. */
  modelLike?: string;
  /** The owner's runs only, by `request.source`: "hands-on" (none set, or "hands-on") or "batch" (any other source). */
  source?: "hands-on" | "batch";
  /** Date range on createdAt: since ≤ t < until. */
  since?: number;
  until?: number;
  q?: string;
}

const featureLike = (f: string) => (f.endsWith("*") ? `${f.slice(0, -1)}%` : f);

export function listGenerations(o: ListOptions = {}): Generation[] {
  const where: string[] = [o.trashed ? "t.deleted_at IS NOT NULL" : "t.deleted_at IS NULL"];
  const args: unknown[] = [];
  const add = (sql: string, ...values: unknown[]) => {
    where.push(sql);
    args.push(...values);
  };
  const oneOf = (col: string, values: unknown[]) => add(`${col} IN (${values.map(() => "?").join(", ")})`, ...values);
  if (o.account) add("json_extract(g.request_json, '$.account') = ?", o.account);
  // A range rather than IS NOT NULL: SQLite can search the generations_account index for a range (it scans it whole for IS NOT NULL).
  else if (o.accounts) add("json_extract(g.request_json, '$.account') > ''");
  else if (!o.everyone) add("json_extract(g.request_json, '$.account') IS NULL");
  if (o.source) {
    add("json_extract(g.request_json, '$.account') IS NULL");
    add(`COALESCE(json_extract(g.request_json, '$.source'), 'hands-on') ${o.source === "hands-on" ? "=" : "<>"} 'hands-on'`);
  }
  const place = "COALESCE(json_extract(g.request_json, '$.place'), '')";
  if (o.where === "pool") add(`(${place} = 'pool' OR (json_extract(g.request_json, '$.account') IS NULL AND g.provider = 'comfyui'))`);
  else if (o.where === "provider") add(`${place} <> 'pool' AND g.provider NOT IN ('comfyui', 'mock')`);
  else if (o.where === "own") add(`${place} <> 'pool' AND g.provider = 'comfyui' AND json_extract(g.request_json, '$.account') > ''`);
  if (o.modelLike) add("g.model_id LIKE ? ESCAPE '!'", `%${o.modelLike.replace(/[!%_]/g, (c) => `!${c}`)}%`);
  if (o.batchId) add("g.batch_id = ?", o.batchId);
  if (o.feature) add("g.feature = ?", o.feature);
  if (o.features?.length) add(`(${o.features.map(() => "g.feature LIKE ?").join(" OR ")})`, ...o.features.map(featureLike));
  if (o.kind) add("g.kind = ?", o.kind);
  if (o.kinds?.length) oneOf("g.kind", o.kinds);
  if (o.models?.length) oneOf("g.model_id", o.models);
  if (o.favorites) add("g.favorite = 1");
  if (o.status) add("g.status = ?", o.status);
  if (o.statuses?.length) oneOf("g.status", o.statuses);
  if (o.template) add("json_extract(g.request_json, '$.params.extra.motion.controls.template') = ?", o.template);
  if (o.folderId) add("fi.folder_id = ?", o.folderId);
  if (o.folderIds?.length) oneOf("fi.folder_id", o.folderIds);
  if (o.pinned !== undefined) add(o.pinned ? "g.pinned_at IS NOT NULL" : "g.pinned_at IS NULL");
  if (o.reviews?.length) {
    const set = o.reviews.filter((r) => r !== "none");
    const any = [set.length ? `g.review IN (${set.map(() => "?").join(", ")})` : "", o.reviews.includes("none") ? "g.review IS NULL" : ""].filter(Boolean);
    add(`(${any.join(" OR ")})`, ...set);
  }
  if (!o.steps && !o.feature && !o.features?.length && !o.batchId) {
    add(`g.feature NOT LIKE ? AND g.feature NOT IN (${HELPER_FEATURES.map(() => "?").join(", ")})`, `%${HELPER_SUFFIX}`, ...HELPER_FEATURES);
  }
  // The cursor's order: the Trash by deletion, a pinned list by pin, the rest by creation (then id, all descending).
  const col = o.trashed ? "t.deleted_at" : o.pinned ? "g.pinned_at" : "g.created_at";
  if (o.before) {
    if (o.beforeId) add(`(${col} < ? OR (${col} = ? AND g.id < ?))`, o.before, o.before, o.beforeId);
    else add(`${col} < ?`, o.before);
  }
  if (o.since) add("g.created_at >= ?", o.since);
  if (o.until) add("g.created_at < ?", o.until);
  const q = o.q?.trim();
  // The user's own words (request.prompt) and what the model got (prompt, with suffixes and templates).
  // A run's own id finds it too.
  if (q) add("(g.id = ? OR g.prompt LIKE ? OR json_extract(g.request_json, '$.prompt') LIKE ?)", q, `%${q}%`, `%${q}%`);
  // Every account's runs: from the accounts' entries in generations_account, then sorted (they go after 30 days, so they
  // stay few). Left to its own plan, SQLite walks every run newest first (or every run of a status), the owner's too,
  // until the page is full: the whole table when accounts' runs are few or none match. Without the index (db.ts goes
  // on when it can't make it), the plain plan.
  const from = !o.account && o.accounts && accountIndexed() ? `generations g INDEXED BY generations_account ${LIBRARY_JOINS}` : LIBRARY_JOIN;
  const sql = `SELECT ${LIBRARY_COLUMNS} FROM ${from} WHERE ${where.join(" AND ")} ORDER BY ${col} DESC, g.id DESC LIMIT ?`;
  return (db().prepare(sql).all(...args, Math.max(1, Math.min(o.limit ?? 60, 200))) as Row[]).map(toGeneration);
}

/** Whether the runs-by-account index exists (db.ts makes it outside the migrations, and goes on without it on a failure). */
const accountIndexed = () => !!db().prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'generations_account'").get();

export function setFavorite(id: string, favorite: boolean): void {
  update(id, { favorite: favorite ? 1 : 0 });
}

export interface AssetRef {
  table: string;
  cols: string[];
  /** A column whose row belongs to the generation being purged (its own row and Cinema membership don't keep its files). */
  except?: string;
  /** What a row is, for "where is it used" ("element", "Cinema project"). */
  what: string;
  /** SQL that names the row, and the key that tells rows apart (default `id`; a Cinema take and its project are one project). */
  name?: string;
  key?: string;
  /**
   * The column naming the account a row belongs to (an account's own board or project). Such a row keeps only that
   * account's own files: what a board names is checked when the file is read, not when the board is saved, and a
   * project's free text is never checked, so a row naming the owner's or another account's file must never keep it.
   */
  account?: string;
}

/**
 * Everywhere a stored file can still be in use, by URL (which ends in the asset id, …/<id>.png) or
 * by id: other jobs' inputs and outputs (an upload a request still names keeps Retry and Reuse
 * working), elements, Assist chats and projects, every studio's sessions, projects and presets.
 * When a table starts storing file URLs, add it here (tests/library.test.ts checks every `_json` /
 * `_url` column is either here or in ASSET_FREE).
 */
export const ASSET_REFS: AssetRef[] = [
  { table: "generations", cols: ["request_json", "outputs_json"], except: "id", what: "result" },
  { table: "characters", cols: ["reference_asset_ids_json", "loras_json", "lora_file", "voice_json"], what: "element", name: "name" },
  { table: "trainings", cols: ["meta_json"], what: "element", key: "element_id", name: "(SELECT name FROM characters WHERE id = element_id)" },
  { table: "assist_threads", cols: ["messages_json", "items_json", "pending_json"], what: "Assist chat", name: "title" },
  // A chat's frozen context names its project's sources; a project's file sources are uploads.
  { table: "assist_thread_state", cols: ["context", "sent_json"], what: "Assist chat", key: "thread_id", name: "(SELECT title FROM assist_threads WHERE id = thread_id)" },
  { table: "assist_project_sources", cols: ["url", "content"], what: "Assist project", key: "project_id", name: "(SELECT name FROM assist_projects WHERE id = project_id)" },
  { table: "cinema_projects", cols: ["cover_url", "palettes_json", "director_json", "chat_json", "brief_body"], what: "Cinema project", name: "name" },
  { table: "cinema_items", cols: ["meta_json"], except: "generation_id", what: "Cinema project", key: "project_id", name: "(SELECT name FROM cinema_projects WHERE id = project_id)" },
  { table: "canvases", cols: ["graph_json", "runs_json"], what: "canvas", name: "name" },
  // A Layers project's source, cover, its tools' inputs (a picked image) and every saved version.
  { table: "layer_projects", cols: ["source_url", "cover_url", "jobs_json"], what: "Layers project", name: "name" },
  { table: "layer_versions", cols: ["doc_json"], what: "Layers project", key: "project_id", name: "(SELECT name FROM layer_projects WHERE id = project_id)" },
  { table: "shorts_sessions", cols: ["source_json", "look_json"], what: "Shorts session", name: "title" },
  { table: "shorts_presets", cols: ["references_json"], what: "Shorts preset", name: "name" },
  { table: "brand_kits", cols: ["kit_json", "chat_json"], what: "brand kit", name: "name" },
  { table: "products", cols: ["images_json"], what: "product", name: "name" },
  { table: "ad_creatives", cols: ["meta_json"], what: "ad", name: "headline" },
  { table: "marketing_runs", cols: ["meta_json"], what: "marketing run", name: "title" },
  // Image studios: a palette's thumbnail, a moodboard's images, collages and cover, an Instadump pack's photos.
  { table: "palettes", cols: ["thumb_url"], what: "palette", name: "name" },
  { table: "moodboards", cols: ["images_json", "collages_json", "cover_url"], what: "moodboard", name: "name" },
  { table: "photodump_packs", cols: ["refs_json"], what: "photo pack", name: "name" },
  // Faceless / Explainer: a channel's avatar, style references and voice samples; an episode's sources, script and picture edits.
  { table: "faceless_channels", cols: ["avatar_url", "reference_json", "settings_json"], what: "Faceless channel", name: "name" },
  { table: "faceless_episodes", cols: ["settings_json", "sources_json", "script_json", "plan_json"], what: "episode", name: "title" },
  // Translate & dub sessions and Katana jobs: the source video, the subject picture and each step's files.
  { table: "dub_sessions", cols: ["data_json"], what: "dub", name: "json_extract(data_json, '$.title')" },
  { table: "katana_jobs", cols: ["data_json"], what: "Katana job", name: "json_extract(data_json, '$.title')" },
  // Content Factory: a series' reference clip and its thumbnail.
  { table: "content_series", cols: ["data_json"], what: "Content Factory series", name: "COALESCE(json_extract(data_json, '$.name'), json_extract(data_json, '$.reference.title'))" },
  // Assist's scheduled tasks: the files the prompt runs with, and the files a skill task's inputs name.
  { table: "assist_schedules", cols: ["attachments_json", "skill_json"], what: "scheduled task", name: "title" },
  // A skill run that waits across studios: its input values and each step's results.
  { table: "skill_runs", cols: ["values_json", "state_json"], what: "skill run", name: "skill" },
  // Character Swap Studio: the character picture, each clip and its 24 fps copy, masks, anchors, takes and their masters.
  { table: "swap_projects", cols: ["data_json"], what: "Character Swap project", name: "name" },
  // A user skill's bundled text files: its recipe.json names the files a run starts from (an example, a fixed logo).
  { table: "skills", cols: ["files_json"], what: "skill", key: "name", name: "title" },
  // An account's own boards and projects (public sign-up): a board's pages (its nodes' pictures and clips), and a
  // project's data (a Shorts session or preset, a Cinema project, a Character Swap project…) and its list line (a
  // short's final video, a swap's character picture). `key` is set so an owner's dry run never deletes these rows
  // (skill-runs.ts STUDIO_TABLES). `account` lets a row keep only its own account's files.
  { table: "account_canvases", cols: ["pages_json"], what: "account canvas", key: "id", name: "name", account: "account_id" },
  { table: "account_projects", cols: ["data_json", "summary_json"], what: "account project", key: "id", name: "name", account: "account_id" },
  // Fuobe Chat: a picture sent in a chat, a character's portrait, and a shared chat's portrait.
  { table: "account_chat_messages", cols: ["image_url", "data_json"], what: "chat", key: "thread_id", name: "(SELECT title FROM account_chat_threads WHERE id = thread_id)", account: "account_id" },
  { table: "account_chat_characters", cols: ["portrait_url"], what: "chat character", key: "id", name: "name", account: "account_id" },
  { table: "account_chat_shares", cols: ["portrait_url"], what: "shared chat", key: "token", name: "json_extract(snapshot_json, '$.title')", account: "account_id" },
];

/**
 * Columns that look like they could hold a file (`_json`, `_url`) but never hold one of Fuobe's
 * stored files, with the reason. The ASSET_REFS coverage test reads this list.
 */
export const ASSET_FREE: Record<string, string> = {
  "generations.provider_input_json": "what a provider was sent: its own upload URLs or file names, never ours",
  "generations.fix_json":
    "what a failed ComfyUI run was missing (model file names, node classes and packs), and what an account's GPU or key ran into: a cause, a details line and its buttons' links",
  "gpu_snapshots.inventory_json": "what a GPU's ComfyUI has (class names, model file names and sizes), never a Fuobe file",
  "gpu_snapshots.report_json": "readiness built from that inventory",
  "generations.external_meta_json": "the provider's job handles, and the run's own held files (Ideogram 4's declined cards), which go with the run",
  "billing_outbox.payload_json": "reports for the billing service: hold and run ids, counts and words, never a file",
  "run_requests.ids_json": "the ids of the runs one press of Run made, never a file",
  "run_requests.answer_json": "a copy of the answer one press of a tool's Run got, for a resend of it: its runs' own rows keep their files",
  "reports_inbox.target_json": "what a report is about: a run, asset or share id, never a file",
  "admin_tokens.scopes_json": "an admin token's scope names",
  "admin_audit.detail_json": "small facts about an admin action: counts, ids and names, never a file's URL",
  "auth_install.extra_json": "sign-in settings an older auth.json held that this build doesn't know",
  "auth_migration.counts_json": "how many accounts, tokens and keys moved in from auth.json",
  "auth_migration.backup_file": "the name auth.json was kept under in the data folder, never a served file",
  "auth_tokens.extra_json": "an API token's fields this build doesn't know",
  "auth_accounts.extra_json": "an account's fields this build doesn't know",
  "auth_account_gpu.url": "the address of an account's own ComfyUI, never a Fuobe file",
  "auth_stray_files.counts_json": "how many accounts and tokens a set-aside auth.json lists",
  "auth_stray_files.account_ids_json": "ids of the accounts a set-aside auth.json lists that the database doesn't have",
  "shorts_sessions.range_json": "start and end times",
  "shorts_sessions.settings_json": "ratio, language, model and resolution",
  "shorts_sessions.segments_json": "generation ids of each take",
  "shorts_sessions.stitches_json": "generation ids of each stitch",
  "brand_kits.progress_json": "research progress labels",
  "products.selling_points_json": "words",
  "products.url": "the product's own web page",
  "marketing_runs.final_ids_json": "generation ids",
  "palettes.colors_json": "hex colours",
  "assist_projects.skills_json": "skill names",
  "assist_thread_state.skills_json": "skill names",
  "skills.meta_json": "SKILL.md front matter",
  "lora_mirrors.source_url": "where a LoRA file downloads from (civitai, Hugging Face), without the key",
  "lora_mirrors.hosted_url": "the provider's copy of a LoRA file (fal or Replicate storage), never ours",
  "shares.tags_json": "words",
  "shares.items_json": "generation ids: a share link shows what still exists and keeps no file alive",
  "lora_mirrors.licence_json": "the licence and civitai permissions a LoRA copy was made under",
  "assist_schedules.rule_json": "when a scheduled task runs",
  "assist_schedules.mode_json": "the Assist mode a scheduled run starts in",
  "assist_connectors.url": "a remote MCP server Claude connects to, never one of ours",
  "assist_connectors.tools_json": "the tool names a connector is limited to",
  "relay_runners.facts_json": "what a person's computer said about its ComfyUI: its GPU, memory, version and LoRA names",
  "relay_tasks.graph_json": "the graph a person's computer runs: file names on that computer's ComfyUI, never a Fuobe file",
  "relay_tasks.extra_json": "the run's LoRA names and where they download from, as its generation's request has them (which keeps them); a finished camera path's clip, which the next step's request keeps too",
  "relay_tasks.wanted_json": "the results asked of a person's computer: file names on its ComfyUI",
  "relay_tasks.received_json": "how much of each result has arrived",
  "relay_tasks.result_json": "the finished entry a person's ComfyUI reported: its own file names",
  "relay_tasks.refusal_json": "a ComfyUI refusal: node classes and model names",
  "relay_tasks.needs_json": "what a job for the workers needs: workflow, model file names and sizes, node packs, VRAM",
  "relay_tasks.tried_json": "the ids of the workers that lost or failed this job",
  "relay_tasks.ticket_json": "an account's job ticket for the workers: settings, and the names and SHA-256 of the job's own staged inputs",
  "relay_tasks.finish_json": "a finishing job's ticket for a worker's CPU slot: settings, and the names and SHA-256 of the job's own staged inputs",
  "relay_tasks.progress_json": "a job's live step, node name and place in its ComfyUI's queue (its preview picture is a file in the task's folder, never a Fuobe file)",
  "relay_workers.facts_json": "what a worker said about its ComfyUI: its GPU, memory and version",
  "relay_workers.inventory_json": "a worker's model files and node packs: names, sizes and hashes on that PC",
  "relay_workers.lanes_json": "the lanes a worker can run: hashes of model file names",
  "relay_workers.bench_json": "a worker's job times in each lane",
  "relay_workers.hours_json": "a worker's hours: a time zone and windows",
  "relay_workers.allow_json": "the lanes the owner lets a worker run, with their delays",
  "relay_workers.seen_json": "the countries and network hashes a worker's token was used from",
  "relay_workers.ceiling_json": "the most a worker's PC may run: lanes, workflow ids and sizes",
  "relay_workers.cpu_slot_json": "the kinds of finishing job a worker's CPU slot runs",
  "relay_workers.holding_json": "why a worker doesn't start the line's work now: a short reason, since when and a task id",
  "relay_pairings.facts_json": "what a paired ComfyUI said about itself: its name, GPU and version",
  "account_canvases.summary_json": "an account board's list line: node and page counts, and its outline (node types, places and short labels)",
  "account_chat_shares.snapshot_json": "a shared chat's words and its character's name and colours; its portrait is the row's portrait_url",
};

/** The query that finds the rows of one ASSET_REFS table naming a file (@id), except the purged generation's own (@g). */
export function assetRefSql(r: AssetRef): string {
  const where = r.cols.map((c) => `instr(COALESCE(${c}, ''), @id) > 0`).join(" OR ");
  const except = r.except ? ` AND ${r.except} != @g` : "";
  // A row of the file's own account only (the owner's files have no account, so no account's row keeps them).
  const own = r.account ? ` AND ${r.account} = (SELECT account_id FROM assets WHERE id = @id)` : "";
  const trashed = r.table === "generations" ? ", EXISTS (SELECT 1 FROM generation_trash t WHERE t.generation_id = generations.id) AS trashed" : "";
  return `SELECT ${r.key ?? "id"} AS k, ${r.name ?? "NULL"} AS n${trashed} FROM ${r.table} WHERE (${where})${except}${own} LIMIT @max`;
}

/**
 * Where a stored file is still used (see ASSET_REFS), at most `max` rows: enough to say where
 * ("2 results and the element “Maya”", describeUses in src/lib/library.ts) or, with max 1, whether.
 */
export function assetUses(assetId: string, opts: { exceptGeneration?: string; max?: number } = {}): AssetUse[] {
  const max = opts.max ?? 50;
  const out: AssetUse[] = [];
  for (const r of ASSET_REFS) {
    try {
      const rows = db()
        .prepare(assetRefSql(r))
        .all({ id: assetId, g: opts.exceptGeneration ?? "", max: max - out.length }) as { k: string; n: string | null; trashed?: number }[];
      for (const row of rows) out.push({ what: r.what, key: String(row.k), name: row.n ?? null, ...(row.trashed ? { trashed: true } : {}) });
    } catch {
      // A table or column this install doesn't have yet: nothing there to keep the file for.
    }
    if (out.length >= max) break;
  }
  return out;
}

/** Whether anything still refers to this stored file (see ASSET_REFS). */
export function assetInUse(assetId: string, exceptGeneration = ""): boolean {
  return assetUses(assetId, { exceptGeneration, max: 1 }).length > 0;
}

/**
 * Delete for good (Trash → Delete forever, Empty trash, the 30-day purge): the row, its trash and
 * folder entries, and the output files nothing else still points at (assetInUse). Dependents still
 * waiting on it fail ("An earlier step didn't finish"). Use deleteForever / emptyTrash in
 * src/server/library.ts (they cancel running jobs first); moving to the Trash is trashGenerations.
 */
export function deleteGeneration(id: string): void {
  // A 3D job's finish or turntable render stops with it.
  stopModelFinish(id);
  stopWorkerFinish(id);
  const assets = db().prepare("SELECT id FROM assets WHERE generation_id = ?").all(id) as { id: string }[];
  db().transaction(() => {
    db().prepare("DELETE FROM generations WHERE id = ?").run(id);
    db().prepare("DELETE FROM generation_trash WHERE generation_id = ?").run(id);
    db().prepare("DELETE FROM folder_items WHERE generation_id = ?").run(id);
  })();
  for (const a of assets) if (!assetInUse(a.id, id)) deleteAsset(a.id);
}

// ---------------------------------------------------------------------------
// Routing

/**
 * Pick the provider for a run: a configured real provider, or the demo provider when placeholder results are on
 * (Settings, demoMode "on") or the request asks for one. With neither and nothing connected, the run is refused.
 * `images` is how many images the run sends: a route whose list takes fewer (FieldMap.maxImages: Grok
 * Imagine Image takes 5 on fal) gives way to one that takes them all, or says so.
 * `loras` and `seconds` (the clip length asked for) prefer a route that carries every LoRA and makes that
 * length (Replicate's Wan 2.2 fast renders only 81–121 frames, fal's 17–161).
 * `prefer` (GenerationRequest.prefer) is the provider the request names: its route runs while it is ready.
 */
export function chooseRoute(candidates: ModelRoute[], images = 0, loras: LoraRef[] = [], seconds?: number, forceDemo = false, prefer?: CloudProvider): { route: ModelRoute; demo: boolean } {
  // Honour the preferred cloud aggregator (Settings → API configuration) when a model is on several.
  const preferred = getSetting("cloudProvider");
  let routes = preferred === "auto" ? candidates : [...candidates].sort((a, b) => Number(b.provider === preferred) - Number(a.provider === preferred));
  // An account's "Run with your Replicate key": that provider's routes first, on its own key (none: it asks for one).
  const account = tenantAccount();
  if (prefer && account && routes.some((r) => r.provider === prefer)) {
    if (accountKey(account, prefer) === null) throw new AccountRunError(paidAllowed() ? { error: addKeyMessage(prefer), code: "add-key", provider: prefer } : { error: OPEN_ONLY_RUN, code: "open-only" });
    routes = [...routes].sort((a, b) => Number(b.provider === prefer) - Number(a.provider === prefer));
  }
  const demo = getSetting("demoMode");
  // A request marked demo (a skill recipe's free dry run) runs on the demo provider whatever Settings says, as does
  // anything a studio starts inside runAsDemo (a skill's dry run of a studio step, src/server/demo-scope.ts).
  if (demo === "on" || forceDemo || inDemoScope()) return { route: routes[0], demo: true };
  const takes = (r: ModelRoute) => !r.map?.maxImages || images <= r.map.maxImages;
  // A route that carries every LoRA wins (Replicate's Wan 2.2 takes one per expert, fal's takes a Mix), then one
  // that makes the length asked; otherwise the first ready one runs and the plan's notes say what it changes.
  const ok = (r: ModelRoute) => routeReady(r) && takes(r);
  const real = pickRoute(routes, { ok, fits: (r) => lorasFit(r, loras), seconds, prefer });
  if (real) return { route: real, demo: false };
  const short = routes.find(routeReady);
  if (short) {
    const others = [...new Set(routes.filter((r) => takes(r) && r.provider !== short.provider).map((r) => provider(r.provider).label))];
    throw new Error(`This model takes up to ${short.map!.maxImages} images on ${provider(short.provider).label} — remove some${others.length ? `, or connect ${others.join(" or ")} for more` : ""}`);
  }
  // "auto", which only code in this process sets (settings.ts): a placeholder where nothing connected runs the model.
  if (demo === "auto") return { route: routes[0], demo: true };
  // Nothing connected runs it, and placeholders are off (the default): never a silent placeholder.
  // An account's paid model with no key of its own for any of the model's providers: "Add your key" (fal.ai first).
  const cloud = tenantAccount() ? routes.map((r) => r.provider).find(isCloudProvider) : undefined;
  if (cloud) throw new AccountRunError(paidAllowed() ? { error: addKeyMessage(cloud), code: "add-key", provider: cloud } : { error: OPEN_ONLY_RUN, code: "open-only" });
  if (routes.every((r) => r.provider === "llm")) throw new Error(llmMissing(routes[0]));
  const names = [...new Set(routes.map((r) => provider(r.provider).label))].join(" or ");
  const message = `Connect ${names} in Settings to run this model`;
  // ComfyUI, or a fal.ai or Replicate key, could run it: the owner's own browser opens the connect card for it
  // (generations/route.ts), with the way or ways that would.
  const gpu = routes.some((r) => r.provider === "comfyui");
  const key = !tenantAccount() && routes.some((r) => isCloudProvider(r.provider));
  throw gpu || key ? new ConnectComfyError(message, gpu && key ? "any" : gpu ? "gpu" : "key") : new Error(message);
}

/** What would run a refused model: a GPU (ComfyUI), a fal.ai or Replicate key, or either. */
export type ConnectNeeds = "gpu" | "key" | "any";

/** A run nothing connected can make, and ComfyUI or a key could: connecting one is the way (same words as before). */
export class ConnectComfyError extends Error {
  constructor(
    message: string,
    readonly needs: ConnectNeeds = "gpu",
  ) {
    super(message);
  }
}

/** Text steps depend on which LLM the route may use (the open model never calls Claude). */
const routeReady = (r: ModelRoute) => (r.provider === "llm" ? llmBackends(r).length > 0 : provider(r.provider).isConfigured());

/** What a run produces (operationOutput: some operations follow the model's kind). */
export function outputKind(op: Generation["op"], model: { kind: MediaKind }): MediaKind {
  return operationOutput(op, model.kind);
}

// Live updates: every write to the table becomes an event (src/server/live.ts). A trashed row
// (soft delete, when the table has one) leaves the feeds like a deleted one.
// The live feed is the owner's (accounts don't get it): an account's runs are never sent on it.
setResolver((ids) =>
  ids.flatMap((id): LiveEvent[] => {
    const r = db().prepare("SELECT * FROM generations WHERE id = ?").get(id) as (Row & { deleted_at?: number | null; trashed_at?: number | null }) | undefined;
    if (r && accountOf(r)) return [];
    const g = r && (toGeneration(r) as Generation & { deletedAt?: number | null; trashedAt?: number | null });
    if (!r || !g || r.deleted_at || r.trashed_at || g.deletedAt || g.trashedAt) return [{ type: "deleted", id, json: JSON.stringify({ id }) }];
    return [{ type: "generation", id, json: JSON.stringify(g) }];
  }),
);

// ---------------------------------------------------------------------------
// Create

/**
 * A request as it runs now: one that names a model (or an operation) Fuobe retired when it stopped calling Higgsfield moves
 * to what replaced it (src/lib/catalog/replaced.ts), with Cinema Studio's Director fields in words; an app run on the model
 * its app ran on before moves to the app's model now (movedAppRequest). Every way in goes through it (the API, a retry, a
 * waiting step, a saved project's run); `note` says what changed.
 */
export function currentRequest(req: GenerationRequest): { request: GenerationRequest; note?: string } {
  const moved = migrateRequest(req, { directorWords: directorFieldWords });
  const app = movedAppRequest(moved.request, getModel, getPreset);
  const note = [moved.note, app.note].filter(Boolean).join("; ");
  return { request: app.request, ...(note && { note }) };
}

/**
 * The engine a model runs a request on: a Fuobe Original runs on the engine asked for (the composer's switch), else
 * the engine mode, else the first one connected; any other model on its own.
 */
export function engineFor(m: ModelDef, asked: Engine | undefined): Engine {
  return dualEngine(m) ? pickEngine(m, asked, engineMode(), (e) => onEngine(m, e).routes.some(routeReady)) : m.engine;
}

/**
 * Fuobe DoP's relight effects (Silhouette, Window…) on their own model: the step that relights the start frame on the
 * engine the clip runs on. None for any other request (the effect on a partner model runs on its words).
 */
export function relightStep(req: GenerationRequest, model: ModelDef): { engine: Engine; step: NonNullable<Preset["prestep"]>["open"] } | undefined {
  const preset = req.presetId ? getPreset(req.presetId) : undefined;
  if (!preset?.prestep || !req.inputs?.images?.length) return undefined;
  const engine = engineFor(model, req.engine);
  if (presetRoute(preset, engine)?.modelId !== model.id) return undefined;
  return { engine, step: preset.prestep[engine] };
}

/**
 * The engine an app runs an Original on when only one of its routes names it (the AI Influencer app: Fuobe Soul in the
 * cloud, the Soul Cast sheet graph on your GPU); undefined otherwise.
 */
export function appEngine(req: Pick<GenerationRequest, "presetId">, m: ModelDef): Engine | undefined {
  const preset = req.presetId ? getPreset(req.presetId) : undefined;
  if (preset?.type !== "app") return undefined;
  const sides = (["cloud", "open"] as const).filter((e) => presetRoute(preset, e)?.modelId === m.id);
  return sides.length === 1 ? sides[0] : undefined;
}

/**
 * The model a request may run, as Settings → Models & licences offers it (only its routes that are on). Engine mode
 * refuses an Original's engine it rules out first; then a model that is off is refused naming the switch, and so is
 * an Original's engine that is off when it is the one asked for, or the one the install's engine mode runs it on.
 * Every run and every chain (createGenerations, before any step is queued) goes through it.
 */
export function offeredFor(m: ModelDef, asked: Engine | undefined): ModelDef {
  const mode = engineMode();
  if (dualEngine(m)) pickEngine(m, asked, mode, () => true);
  return requireOffered(m, asked ?? (mode === "both" ? undefined : mode));
}

/**
 * Fuobe Mixed Media's single picture in the cloud (DoP's Mixed Media stills, an API caller's edit), and Fuobe Angles' other
 * camera, drawn at about 1 megapixel in its picture's shape, as it's priced (and as the GPU graphs scale it): without a
 * size, fal keeps the upload's own (a 12-megapixel photo costs 12 times as much). The studio sends each Mixed Media frame's
 * size itself; a picture that isn't a file in Fuobe keeps fal's.
 */
const SIZED_EDITS = new Set([MIXED_ORIGINAL, ANGLES_ORIGINAL]);
function sizedMixedFrame(plan: ReturnType<typeof planGeneration>, req: GenerationRequest): ReturnType<typeof planGeneration> {
  if (!SIZED_EDITS.has(plan.model.id) || plan.model.engine !== "cloud" || plan.op !== "edit" || plan.params.extra?.image_size) return plan;
  const first = req.inputs?.images?.[0];
  const head = first ? localHead(first) : null;
  const size = head ? imageSize(head) : null;
  const fit = size ? originalFrameSize(size, "1K") : undefined;
  return fit ? { ...plan, params: { ...plan.params, extra: { ...plan.params.extra, image_size: fit } } } : plan;
}

/**
 * A cloud edit that follows image 1's shape (ModelRoute.followsImage: fal's FLUX 3 Klein, whose GPU edit keeps reference 1's
 * shape): image 1's shape on the chosen tier's square, on the route's grid and within its limits, as its size field. Without
 * it the size would be the default aspect ratio's (a 16:9 photo back as a square). The tier, and so the price, stays the one
 * picked. A size the request gives itself wins; a picture that isn't a file in Fuobe keeps the aspect ratio's size.
 */
function sizedEdit(plan: ReturnType<typeof planGeneration>, req: GenerationRequest): ReturnType<typeof planGeneration> {
  if (plan.model.engine !== "cloud" || plan.op !== "edit") return plan;
  const field = plan.model.routes.find((r) => r.op === "edit" && r.followsImage)?.map?.size;
  if (!field?.key || plan.params.extra?.[field.key] !== undefined) return plan;
  const first = req.inputs?.images?.[0];
  const head = first ? localHead(first) : null;
  const shape = head ? imageSize(head) : null;
  if (!shape) return plan;
  const fit = sizeValue(field, `${shape.width}:${shape.height}`, plan.params.resolution ?? plan.model.defaults?.resolution);
  return { ...plan, params: { ...plan.params, extra: { ...plan.params.extra, [field.key]: fit } } };
}

/**
 * A talking avatar's picture held to the shape the hosted model takes (fal's H3 Max lip sync: 0.4 to 2.5 wide), read from the
 * file's header before the run is paid for. A picture that isn't a file in Fuobe (or isn't the run's own) goes as it is.
 */
function portraitProblem(plan: ReturnType<typeof planGeneration>, req: GenerationRequest): string | null {
  if (plan.op !== "avatar" || plan.model.engine === "open") return null;
  const first = req.inputs?.images?.[0];
  const head = first ? localHead(first) : null;
  const size = head ? imageSize(head) : null;
  return size ? portraitShapeProblem(plan.model, size.width, size.height) : null;
}

/**
 * The elements "@Name" can mention: the owner's. An account's run or a visitor's price check has none, so "@Name" stays
 * words there (an owner's element photo or LoRA never reaches someone else's run).
 */
export const mentionElements = () => (tenant() ? [] : listElements());

/**
 * A guest's or an account's candidates without the hosted routes no live call has passed yet (hosted-untested.ts): those
 * run for the owner only. With nothing else to run on, the run is refused as a tool that isn't available here.
 */
function triedRoutes(m: ModelDef, routes: ModelRoute[]): ModelRoute[] {
  if (!tenant()) return routes;
  const tried = routes.filter((r) => !hostedUntested(m.id, r));
  if (routes.length && !tried.length) throw new AccountRunError({ error: OWN_GPU_TOOL_MESSAGE, code: "own-gpu-tool" });
  return tried;
}

/** Resolve mentions and drawings, plan, enforce the engine mode and pick a provider route. */
function prepare(original: GenerationRequest) {
  // Auto runs on the model it picks (autoRouted); the stored request keeps Auto, with its pick.
  const routed = autoRouted(original);
  // @element mentions become reference images / LoRAs; the stored request keeps the mentions for "Reuse".
  // A style signature's sentences (palette, look) join the prompt here; the stored request keeps the user's words.
  const worded = withSignatureWords(routed);
  const mode = engineMode();
  // Settings → Models & licences: a model (or the engine of an Original asked for) that is switched off is refused,
  // naming the switch; an Original otherwise runs on an engine that is still on, with the routes that are on.
  const found = getModel(worded.modelId);
  const onSide = worded.engine ?? (found && appEngine(worded, found));
  const allowed = found && offeredFor(found, onSide);
  const model = allowed && dualEngine(allowed) ? onEngine(allowed, engineFor(allowed, onSide)) : allowed;
  const lookup = (id: string) => (model && id === model.id ? model : getModel(id));
  const req = model ? stripMotionPaths(applySketch(applyMentions(worded, model, mentionElements()).request, model).request, model) : worded;
  let plan = sizedEdit(sizedMixedFrame(planGeneration(req, lookup, getPreset), req), req);
  const portrait = portraitProblem(plan, req);
  if (portrait) throw new Error(portrait);
  if (mode !== "both" && plan.model.engine !== mode) {
    // An account on the open engine has no key of its own that opens (Your keys), or the studio is open-source only.
    const cloud = mode === "open" && tenantAccount() ? plan.model.routes.map((r) => r.provider).find(isCloudProvider) : undefined;
    if (cloud) throw new AccountRunError(paidAllowed() ? { error: addKeyMessage(cloud), code: "add-key", provider: cloud } : { error: OPEN_ONLY_RUN, code: "open-only" });
    throw new Error(
      mode === "open"
        ? `${plan.model.name} is a cloud model, which isn't available here. Pick an open-source model`
        : `${plan.model.name} is an open-source model, which isn't available here. Pick a cloud model`,
    );
  }
  // Checks planGeneration can't make without knowing the model's kind or the text ops' needs.
  if (plan.op === "color-match" && plan.model.kind === "video" && !req.inputs?.video) throw new Error("Add the video and a reference image");
  if (plan.op === "translate" && !plan.params.targetLanguage) throw new Error("Pick a language to translate into");
  // The length asked of a clip that is made (not one that follows its input video's length).
  const seconds = MADE_LENGTH_OPS.has(plan.op) ? plan.params.duration : undefined;
  // LoRAs switched off (by file or licence class) are left out, their trigger words with them; with "keep GPU-only
  // LoRAs on your GPU" on, the rest are marked so a cloud route leaves those out (fitLoras).
  const access = offeredLoras(plan.loras);
  // A LoRA the model's recipe can't run without (Fuobe Try-On's try-on LoRA) switched off: the model can't run.
  const needed = access.dropped.find((d) => plan.model.options.loras?.some((l) => l.file === d.file));
  if (needed) throw new Error(`${plan.model.name} runs with the LoRA “${loraName(needed)}”, which is switched off in ${ACCESS_PLACE}. Turn it back on there, or pick another model`);
  if (access.dropped.length) plan = { ...plan, loras: access.loras, prompt: withoutTriggers(plan.prompt, plan.loras.filter((l) => !access.loras.some((k) => k.file === l.file)), access.loras) };
  else if (access.loras.some((l, i) => l !== plan.loras[i])) plan = { ...plan, loras: access.loras };
  // A preset can route to another model than the one asked for: its routes that are on (or the switch that's off).
  const prefer = isCloudProvider(worded.prefer) ? worded.prefer : undefined;
  const { route, demo } = chooseRoute(triedRoutes(plan.model, offeredRoutes(plan.model, routesFor(plan.model, plan.op, plan.params))), req.inputs?.images?.length ?? 0, plan.loras, seconds, !!worded.demo, prefer);
  // The owner's run on their own GPUs (the workers): one that none of them can take is refused when it is planned and
  // priced (runs-here.ts), as a visitor's is, never after an earlier step of its chain ran.
  const notOnGpus = demo ? null : ownerGpuMiss(route, plan.model, plan.op);
  if (notOnGpus) throw notOnGpus;
  // Qwen-Image 2.1's Options → Speed loads its speed's LoRA in the graph: that LoRA switched off holds the speed.
  const tier = route.provider === "comfyui" ? speedLora(route.endpoint, plan.params.extra) : undefined;
  if (tier && offeredLoras([{ file: tier.file }]).dropped.length) {
    const speed = QWEN21_SPEED.labels?.[tier.speed] ?? tier.speed;
    throw new Error(
      tenantAccount() ? `${speed} isn't available here. Pick another speed` : `${speed} runs with the LoRA “${loraName({ file: tier.file })}”, which is switched off in ${ACCESS_PLACE}. Pick another speed, or turn it back on there`,
    );
  }
  // Pika H3 Flex (MiniMax H3's Fast · Pika Flex, References and Talk from a voice clip) loads Pika's adapter in the graph:
  // that adapter switched off holds the run.
  const flexOff = route.provider === "comfyui" ? offeredLoras(pikaFlexGraphLoras(route.endpoint, plan.params.extra)).dropped[0] : undefined;
  if (flexOff) {
    const refs = route.endpoint === PIKA_FLEX_REF_WORKFLOW;
    const what = refs ? (plan.op === "avatar" ? "Talk from a voice clip" : "References") : "Fast · Pika Flex";
    const instead = refs ? "Use one start frame, or pick another model" : "Pick Standard or Sharper";
    throw new Error(
      tenantAccount() ? `${what} isn't available here. ${instead}` : `${what} runs with “${loraName(flexOff)}”, which is switched off in ${ACCESS_PLACE}. ${instead}, or turn it back on there`,
    );
  }
  // "Fast · writes the details" edits with at most 3 pictures (its LoRA's card).
  if (tier?.speed === "details" && (req.inputs?.images?.length ?? 0) > DETAILS_MAX_IMAGES) {
    throw new Error(`${QWEN21_SPEED.labels?.details ?? "Fast · writes the details"} edits with up to ${DETAILS_MAX_IMAGES} pictures. Remove one, or pick another speed`);
  }
  // Qwen-Image 2.1's Options → GPU, decided once here (src/server/qwen21-gpu.ts): the pre-flight and the run read the choice.
  const gpu = route.provider === "comfyui" && !demo ? qwen21Gpu(route.endpoint, plan.params.extra ?? {}, (id) => !!loadIndex().workflows[id]) : undefined;
  if (gpu) plan = { ...plan, params: { ...plan.params, extra: { ...plan.params.extra, [GPU_PARAM]: gpu.gpu } }, notes: [...(plan.notes ?? []), ...(gpu.note ? [gpu.note] : [])] };
  // MiniMax H3's Options → GPU tier, decided once here too (src/server/h3-gpu.ts): FastH3 V2 or Trim on a smaller card, with its file.
  const h3 = route.provider === "comfyui" && !demo ? h3Gpu(route.endpoint, plan.params.extra ?? {}, (id) => !!loadIndex().workflows[id]) : undefined;
  if (h3) {
    // The file is the plan's alone (never one a request names).
    const extra: Record<string, unknown> = { ...plan.params.extra, [H3_TIER_PARAM]: h3.gpuTier };
    if (h3.unet) extra[H3_UNET_PARAM] = h3.unet;
    else delete extra[H3_UNET_PARAM];
    plan = { ...plan, params: { ...plan.params, extra }, notes: [...(plan.notes ?? []), ...(h3.note ? [h3.note] : [])] };
  }
  // What the cloud run can carry: a LoRA whose licence doesn't allow hosting stays on the GPU, and an API
  // takes at most so many (the plan's notes say which were left out). Open runs carry them all. Without a
  // civitai key a look's civitai LoRA the run can't get is left out (and said), rather than failing at the
  // download: the look's words still carry it. Looks are Fuobe Soul's and Fuobe Mixed Media's (the studio's frames,
  // Smooth's first frame, DoP's Mixed Media stills). Any other run (a motion, whose LoRA is the point) still stops there.
  const asked = plan.loras;
  const look = !!plan.soul || plan.model.id === MIXED_ORIGINAL;
  const reachable =
    demo || !look ? { loras: asked, notes: [] } : withoutUnreachableCivitai(asked, route.provider === "comfyui" ? "comfyui" : route.provider === "replicate" ? "replicate" : "fal");
  const fitted = fitLoras(reachable.loras, route);
  // A LoRA the recipe can't run without that this route leaves out for any reason (its cap, a GPU-only licence, no
  // cloud path): the model can't run here, rather than running without it.
  const lost = demo ? undefined : plan.model.options.loras?.find((l) => asked.some((a) => a.file === l.file) && !fitted.loras.some((k) => k.file === l.file));
  if (lost) {
    const why = [...reachable.notes, ...fitted.notes].join("; ");
    throw new Error(`${plan.model.name} runs with the LoRA “${loraName(lost)}”, which this run leaves out${why ? ` (${why})` : ""}. Pick another model or engine`);
  }
  // A look's triggers lead the prompt: a LoRA left out takes its trigger with it.
  const prompt = plan.soul
    ? promptWithLoras(plan.prompt, plan.soul.triggers, fitted.loras)
    : look
      ? withoutTriggers(plan.prompt, asked.filter((l) => !reachable.loras.includes(l)), reachable.loras)
      : plan.prompt;
  plan = { ...plan, prompt, loras: fitted.loras };
  const notes = [...(plan.notes ?? []), ...access.notes, ...reachable.notes, ...fitted.notes];
  // A frame-count API that can't make the length asked (Replicate's Wan 2.2 fast: 81–121 frames) says what it makes.
  const made = demo ? undefined : framedLength(route.map?.numFrames, seconds, plan.params.fps);
  if (made !== undefined && route.map?.numFrames) {
    const f = route.map.numFrames;
    const fps = plan.params.fps && plan.params.fps > 0 ? plan.params.fps : f.fps;
    const half = (x: number) => Math.round(x * 2) / 2;
    const span = f.min !== undefined && f.max !== undefined ? ` makes ${half(f.min / fps)}–${half(f.max / fps)} s clips,` : "";
    notes.push(`${plan.model.name} on ${provider(route.provider).label}${span} so this one is about ${half(made)} s, not ${seconds} s`);
  }
  // A talking avatar is as long as its voice, up to what a frame-count route makes a call (fal's InfiniteTalk about 29 s, Wan
  // 2.2 S2V 7.5 s): a longer voice is cut there, and said.
  const voice = !demo && plan.op === "avatar" && route.map?.numFrames ? plan.params.sourceDuration : undefined;
  if (voice && voice > 0) {
    const reach = avatarSeconds({ routes: [route] }, voice, plan.params.fps);
    const half = (x: number) => Math.round(x * 2) / 2;
    if (reach < voice - 0.25) notes.push(`${plan.model.name} on ${provider(route.provider).label} makes up to ${half(reach)} s a call, so this one stops ${half(reach)} s into the ${half(voice)} s voice`);
  }
  // A route that can't batch (Replicate's Nano Banana Pro beside fal's num_images; a ComfyUI graph, which makes
  // one picture a run: Fuobe Soul on the open engine) runs one job per output.
  if (!demo && !route.map?.numOutputs && plan.perJobOutputs > 1) {
    plan = { ...plan, jobs: plan.jobs * plan.perJobOutputs, perJobOutputs: 1, params: { ...plan.params, numOutputs: 1 } };
  }
  // A setting the composer offers because another route of the model reads it (Nano Banana Pro's seed on fal), dropped by the
  // route this run goes to (Replicate's): said in the run's notes, never dropped without a word. (A count it can't take was
  // split into one job per result just above, so it isn't one.)
  const drops = demo ? [] : routeDrops(route, plan.model.id, { negativePrompt: req.negativePrompt, params: plan.params });
  if (drops.length) notes.push(`${plan.model.name} on ${provider(route.provider).label} doesn't take ${listWords(drops)}: this run goes without`);
  // Settings another route of the model would honour: fitted shape/size noted here, all kept as the run's notice.
  const shortfalls = demo ? [] : routeShortfalls(plan.model, plan.op, route.provider, { params: req.params, negativePrompt: req.negativePrompt });
  for (const s of shortfalls)
    if ((s.setting === "aspectRatio" || s.setting === "resolution") && s.did.includes(" in place of "))
      notes.push(`${plan.model.name} on ${provider(route.provider).label} doesn't make ${s.asked}: this run is made at ${s.made}`);
  const notice = shortfalls.length ? shortfallNote(plan.model, route.provider, shortfalls) : undefined;
  const providerId: ProviderId = demo ? "mock" : route.provider;
  // A text step that runs on a local model is free; only Claude costs money.
  const free = demo || (route.provider === "llm" && !llmUsesClaude(route));
  const withLoras = fitted.loras.length > 0 && !!route.loraEndpoint;
  const unreachable = asked.filter((l) => !reachable.loras.includes(l));
  // Priced for the clip the route makes: Replicate's Wan 2.2 fast makes 5 s when 3 s was asked.
  const priced = made !== undefined && plan.params.duration !== undefined ? { ...plan.params, duration: Math.round(made * 2) / 2 } : plan.params;
  return {
    req,
    plan,
    route,
    demo,
    providerId,
    notes,
    asked,
    unreachable,
    switchedOff: access.dropped,
    gpu: gpu?.gpu,
    h3: h3 && { gpuTier: h3.gpuTier, ...(h3.unet && { unet: h3.unet }) },
    cost: free ? 0 : estimateCost(plan.model, priced, 1, plan.op, withLoras),
    notice,
    // Auto's pick, which the stored request keeps.
    ...(routed.auto && { auto: routed.auto }),
  };
}

/** Auto's patterns as last read from Settings (the text they were read from, and the patterns). */
let autoPatternCache: { text: string; patterns: ReturnType<typeof autoPatterns> } | undefined;
function autoPatternsNow(): ReturnType<typeof autoPatterns> {
  const text = getSetting("autoImagePatterns");
  if (autoPatternCache?.text !== text) autoPatternCache = { text, patterns: autoPatterns(text) };
  return autoPatternCache.patterns;
}

/**
 * A run of Auto (src/lib/auto-image.ts) as the model it picks runs it: the pick it carries (a run planned again: a resend,
 * a run that waited to enter the line, a fallback after Ideogram 4 declined), else the first of its picks for these words
 * and pictures that is switched on and runs the operation (Settings → Models & licences). A picture to work from makes it
 * an edit. Any other request as it is.
 */
function autoRouted(req: GenerationRequest): GenerationRequest {
  if (req.modelId !== AUTO_IMAGE) return req;
  const images = req.inputs?.images?.length ?? 0;
  if (req.auto && AUTO_MODELS.has(req.auto.model)) {
    const m = getModel(req.auto.model);
    const op = req.op && m?.routes.some((r) => r.op === req.op) ? req.op : undefined;
    return { ...req, modelId: req.auto.model, op: op ?? (images ? "edit" : "t2i") };
  }
  const c = autoCandidates({ prompt: req.prompt, op: req.op, images, account: !!req.account }, autoPatternsNow());
  const op: Operation = c.why === "edit" ? (req.op && req.op !== "t2i" ? req.op : "edit") : "t2i";
  const runs = (id: string) => {
    const m = getModel(id);
    if (!m?.routes.some((r) => r.op === op)) return false;
    try {
      return offeredRoutes(offeredFor(m, "open"), routesFor(m, op)).length > 0;
    } catch {
      return false;
    }
  };
  const model = c.models.find(runs);
  if (!model) throw new Error(op === "t2i" ? "Auto has no image model switched on here. Pick a model" : "Auto has no edit model switched on here. Pick a model");
  return { ...req, modelId: model, op, auto: { model, why: c.why } };
}

/** The LoRA files a graph loads itself (not injected), so a run downloads the ones ComfyUI lacks before it starts. */
const graphLoras = (endpoint: string, extra: Record<string, unknown> | undefined) => [
  ...h3GraphLoras(endpoint, extra),
  ...restoreGraphLoras(endpoint, extra),
  ...regenerateGraphLoras(endpoint, extra),
  ...pikaFlexGraphLoras(endpoint, extra),
];

/**
 * The LoRA files a planned ComfyUI run loads (by name, once each): the ones its plan adds (a look's, a motion's, a
 * recipe's, the person's own) and the ones its graph picks by option. Whatever of them is a workflow's own file its lane
 * covers; the rest are its run-time files (src/lib/runtime-files.ts). None off ComfyUI.
 */
export function runLoraFiles(p: { route: { provider: string; endpoint: string }; loras: { applied: LoraRef[] } }, extra: Record<string, unknown> | undefined): string[] {
  if (p.route.provider !== "comfyui") return [];
  return [...new Set([...p.loras.applied, ...graphLoras(p.route.endpoint, extra)].map((l) => l.file).filter(Boolean))];
}

/** Operations whose clip length is the duration picked (made, or added by extend), not an input video's. */
const MADE_LENGTH_OPS = new Set<Operation>(["t2v", "i2v", "flf2v", "ref2v", "extend", "keyframes"]);


/** What a request would run as — model, operation, job count and cost — without starting it. */
export function previewGeneration(asked: GenerationRequest) {
  const moved = currentRequest(asked);
  // Open-H3 Regenerate while it is held (REGEN_OFFERED), and MiniMax H3's 2K on your GPU that finishes with it: priced as refused.
  const held = regenHeld(moved.request);
  if (held) throw new Error(held);
  const prepared = prepare(moved.request);
  const { plan, route, demo, providerId, cost, asked: askedLoras, unreachable, switchedOff, gpu, h3 } = prepared;
  const notes = moved.note ? [moved.note, ...prepared.notes] : prepared.notes;
  const fitted = routeLoras(route, askedLoras.filter((l) => !unreachable.includes(l)));
  const loras = {
    ...fitted,
    dropped: [...switchedOff, ...unreachable.map((l) => ({ file: l.file, reason: "it downloads from civitai, which needs your civitai key (Settings → LoRAs)" })), ...fitted.dropped],
  };
  // PixeletedFace pixelates each picture's faces afterwards (createMosaicRun): fal's SAM 3.1 per picture in the cloud.
  let post = demo || moved.request.postMade ? 0 : postStepCost(plan.model.id, moved.request.presetId, plan.model.engine, plan.jobs * plan.perJobOutputs, getModel);
  // MiniMax H3 at 2K on your GPU: each take's Open-H3 Regenerate finish is planned and priced beside its draft.
  const twoK = h3TwoKExtra(moved.request, plan.model, plan.op);
  if (twoK) {
    if (twoK.costUsd !== null) post += twoK.costUsd;
    notes.push(...twoK.notes);
  }
  // A finish whose price isn't known leaves the run's price unknown too, never the main step's alone.
  const priceUnknown = cost === null || twoK?.costUsd === null;
  return {
    model: plan.model,
    op: plan.op,
    jobs: plan.jobs,
    outputs: plan.jobs * plan.perJobOutputs,
    demo,
    providerId,
    costUsd: priceUnknown || cost === null ? null : post ? Math.round((cost * plan.jobs + post) * 1000) / 1000 : cost * plan.jobs,
    // The other steps the run makes beside its own model (a 2K take's finish), so a policy and a price see them all.
    ...(twoK?.steps.length && { steps: twoK.steps }),
    // The engine it runs on (a Fuobe Original picks one per request).
    engine: plan.model.engine,
    // What the route runs (the evaluation harness records it): the provider endpoint, the final prompt and the LoRAs it loads.
    route: { provider: route.provider, endpoint: loras.applied.length && route.provider !== "comfyui" && route.loraEndpoint ? route.loraEndpoint : route.endpoint },
    prompt: plan.prompt,
    loras,
    ...(notes.length && { notes }),
    // Qwen-Image 2.1's Options → GPU as decided for this run: the GPU pre-flight checks the graph it picks.
    ...(gpu && { gpu }),
    // MiniMax H3's GPU tier and the card's file as decided for this run: the GPU pre-flight checks the graph and file it picks.
    ...(h3 && { h3 }),
    plan: { end: plan.end },
  };
}

/**
 * The finishes MiniMax H3's 2K tier adds on your GPU (createH3TwoKRun): one Open-H3 Regenerate pass per take, checked
 * (the refiner LoRA's switch, the finish's own plan) and priced as the run makes them.
 */
function h3TwoKExtra(req: GenerationRequest, model: ModelDef, op: Operation): { costUsd: number | null; notes: string[]; steps: { model: string; op: string }[] } | null {
  if (!wantsH3TwoK(model.id, req.params?.resolution)) return null;
  const off = regenSwitchedOff();
  if (off) throw new Error(off);
  const takes = Math.max(1, Math.min(4, Math.round(req.params?.numOutputs ?? 1)));
  const { finish } = h3TwoKRequests(req, op, { keepLatent: keepsH3Latent() });
  const p = previewChained(finish, 1);
  return {
    costUsd: p.costUsd === null ? null : Math.round(p.costUsd * takes * 10000) / 10000,
    notes: [H3_2K_STEPS_NOTE],
    steps: Array.from({ length: takes }, () => ({ model: p.model.id, op: p.op })),
  };
}

/** Preview a step that will wait for `deps` earlier steps: validated with placeholders in its chain slots, as createGenerations does. */
export function previewChained(req: GenerationRequest, deps: number) {
  if (!deps) return previewGeneration(req);
  // A waiting step always runs as one job (createGenerations doesn't batch dependents).
  const p = previewGeneration(withChainInputs(req, slotsFor(req, deps).map(placeholderFor)));
  // Refused before anything starts, as createGenerations refuses it.
  // A keyframe film waits for frames earlier steps make (framesWait): its clips are created then, each waiting for its own.
  if (routesFor(p.model, p.op).some((r) => r.chained) && !(p.op === "keyframes" && framesWait(req))) throw new Error(chainedWaitMessage(p.model.name, p.op));
  const jobs = Math.max(1, p.jobs);
  return { ...p, jobs: 1, outputs: p.outputs / jobs, costUsd: p.costUsd === null ? null : p.costUsd / jobs };
}

export interface CreateOptions {
  /** Group several requests (storyboard frames, the shots of a film) into one batch. */
  batchId?: string;
  /**
   * Wait for these generations, then feed their first outputs in as inputs: where each goes is
   * `request.chain` (one slot per id), or `request.chainFrom` for a single image dependency.
   */
  dependsOn?: string | string[];
}

const depIds = (v: string | null): string[] => (!v ? [] : v.startsWith("[") ? (JSON.parse(v) as string[]) : [v]);

/**
 * Public sign-up: inside an account's run (accountRun) every request it makes, and every step its chains queue, is
 * stamped as the account's own: on the open engine, or the engine it asked for while it may use paid models on its own
 * keys (account-keys.ts accountEngineMode). A request stamped for another account, a step that waits for someone
 * else's run, a run on an account's GPU outside its account, and a guest's run are refused.
 */
function stampTenant(asked: GenerationRequest, opts: CreateOptions): GenerationRequest {
  if (tenant()?.kind === "guest") throw new Error(GUEST_RUN_MESSAGE);
  const who = tenantAccount();
  if (!who) {
    if (ownGpu()) throw new Error("We can't find that run.");
    // The owner's runs carry no place, hold or check of an account's run (run-stamp.ts).
    return withRunStamp({}, () => stamped(asked));
  }
  if (asked.account && asked.account !== who) throw new Error("We can't find that run.");
  const deps = opts.dependsOn === undefined ? [] : Array.isArray(opts.dependsOn) ? opts.dependsOn : [opts.dependsOn];
  if (deps.some((d) => generationAccount(d) !== who)) throw new Error("We can't find that run.");
  // Where the run goes and its billing hold are the route's decision for this run (run-stamp.ts), never a stored request's.
  return { ...stamped(asked), account: who, engine: accountEngineMode(who) === "open" ? "open" : asked.engine };
}

export function createGenerations(sent: GenerationRequest, opts: CreateOptions = {}): Generation[] {
  // Inside a skill's dry run of a studio step every row is a demo row, as the check's own rows are.
  const given: GenerationRequest = inDemoScope() && !sent.demo ? { ...sent, demo: true } : sent;
  const asked = stampTenant(given, opts);
  // A retired model or operation (a retry, an old script, a saved project) runs on what replaced it, and says so.
  const moved = currentRequest(asked);
  const original = withFinishOf(moved.request, opts.dependsOn);
  // Open-H3 Regenerate is held until it has run on a card that fits it (REGEN_OFFERED): a run of it, or of MiniMax H3's 2K on
  // your GPU that finishes with it, is refused here before any step is made, whichever way it was asked for.
  const held = regenHeld(original);
  if (held) throw new Error(held);
  // Open models make multi-shot films shot by shot, then join the clips. A Fuobe Original is taken on the engine it runs
  // on (Fuobe DoP's Frames mode is a GPU chain).
  // A model (or an Original's engine asked for) switched off in Settings → Models & licences is refused here, before a
  // chain queues any step; an Original otherwise runs on an engine still on.
  const catalogModel = getModel(original.modelId);
  const found = catalogModel && offeredFor(catalogModel, original.engine);
  const shotModel = found && dualEngine(found) ? onEngine(found, engineFor(found, original.engine)) : found;
  // An account's 3D model is finished on this server under its own limits (model3d-finish.ts). On this install's GPUs it
  // is finished on a worker's CPU slot (computer/finish.ts): offered only for a model whose GLB gets that finish, while a
  // worker runs it (poolFinishes3d). Any Angle's 3D view is the exception: a splat and its turntable, nothing to finish.
  if (original.account && original.place === "pool" && shotModel?.kind === "model3d" && shotModel.id !== ANY_ANGLE.buildModel) {
    const ops = original.op ? [original.op] : shotModel.routes.filter((r) => r.provider === "comfyui").map((r) => r.op);
    // (The gate says this before Run as a label: hosted-run.ts poolGate. This is its last guard, in the same words.)
    if (!ops.length || !ops.every((op) => poolFinishes3d({ provider: "comfyui", op }))) throw new Error(ownSetupLabel(MODEL3D_SETUP));
  }
  if (!opts.dependsOn && shotModel?.options.multiShot?.mode === "concat" && (original.params?.shots?.filter((x) => x.prompt.trim()).length ?? 0) > 1) {
    return createShotFilm(original, shotModel);
  }
  if (!opts.dependsOn && original.op === "extend" && shotModel && routesFor(shotModel, "extend").some((r) => r.endpoint === LAST_FRAME_CHAIN)) {
    return createExtendChain(original, shotModel);
  }
  // Frames mode on an open model: one start/end-frame clip per pair of frames, then joined.
  const filmRoute = shotModel && keyframeChain(shotModel);
  // Its frames can come from earlier steps (framesWait): each clip then waits for the frames it starts and ends on.
  if (filmRoute && inferOperation(shotModel, original) === "keyframes" && (!opts.dependsOn || framesWait(original))) {
    return createKeyframeFilm(original, shotModel, filmRoute, { batchId: opts.batchId, dependsOn: opts.dependsOn });
  }
  // Image to 3D's "Refine detail" (open engine): the model, then Hi3D's refine of its mesh with the same photo.
  // Its photo may come from an earlier step (a Canvas image node, an Assist plan's still): the refine then waits for it too.
  if (shotModel && shotModel.kind === "model3d" && original.op !== "refine-3d" && chainedRefine(original) !== null) {
    return createRefinedModel(original, shotModel, { batchId: opts.batchId, dependsOn: opts.dependsOn });
  }
  // Text to 3D on the open engine: a still first, then the 3D model of it. The operation is read as the planner
  // reads it (Assist, MCP and API clients usually leave op out).
  const stillTo3d = !opts.dependsOn && shotModel && inferOperation(shotModel, original) === "text-to-3d" ? routesFor(shotModel, "text-to-3d").find((r) => r.chained) : undefined;
  if (shotModel && stillTo3d) return createStillTo3d(original, shotModel, stillTo3d);
  // Fuobe DoP's relight effects: the start frame is relit first, then animated.
  const relight = !opts.dependsOn && shotModel ? relightStep(original, shotModel) : undefined;
  if (relight) return createRelitClip(original, relight);
  // "Clean the voice first": the speech apart from the music and effects before a transcriber or a lip sync hears it.
  if (!opts.dependsOn && shotModel && wantsVoiceFirst(original)) return createVoiceFirst(original, shotModel.engine, { batchId: opts.batchId });
  // Fuobe Soul's PixeletedFace look: the picture, then its faces pixelated (SAM 3.1 + a mosaic), also as a pipeline step or a
  // Canvas node (it waits for what they wait for). The picture made inside that run (postMade) runs as it is.
  if (!original.postMade && shotModel && soulPostStep(shotModel.id, original.presetId) === "face-mosaic") {
    const waitsFor = opts.dependsOn === undefined ? undefined : Array.isArray(opts.dependsOn) ? opts.dependsOn : [opts.dependsOn];
    return createMosaicRun(original, shotModel, { batchId: opts.batchId, dependsOn: waitsFor });
  }
  // Open-H3 Regenerate: the draft preset from the clip's maker, and a clip over 15 s in 15 s parts joined (regenerate.ts).
  if (shotModel?.id === REGEN_MODEL) {
    const run = createRegenerateRun(original, shotModel, opts, createGenerations, joinClips, (id) => void cancelGeneration(id));
    if (run) return run;
  }
  // MiniMax H3 at 2K on your GPU (n7-10): a 768p draft, then Open-H3 Regenerate at 2K from it (from its latent for text to video).
  if (shotModel && wantsH3TwoK(shotModel.id, original.params?.resolution)) {
    return createH3TwoKRun(original, inferOperation(shotModel, original), opts, createGenerations, (id) => void cancelGeneration(id));
  }
  const deps = opts.dependsOn === undefined ? [] : Array.isArray(opts.dependsOn) ? opts.dependsOn : [opts.dependsOn];
  const waits = deps.length > 0;
  // A dependent job can't be planned until its inputs exist; it's validated with placeholders, then launched by the runner.
  const p = waits ? prepare(withChainInputs(original, slotsFor(original, deps.length).map(placeholderFor))) : prepare(original);
  const { req, plan, route, demo, providerId, cost } = p;
  // Auto keeps its pick with the run: planned again, the run goes to the same model, and its tile names it.
  const picked = p.auto ? { ...original, auto: p.auto } : original;
  const kept = p.notice && !picked.notice?.includes(p.notice) ? { ...picked, notice: [picked.notice, p.notice].filter(Boolean).join(" · ") } : picked;
  // A preset whose recipe edited the start frame into an end frame first: two steps (the edit, then the clip).
  if (!opts.dependsOn && plan.end) return createEndFrameClip(original, plan.end);
  const notes = moved.note ? [moved.note, ...p.notes] : p.notes;
  // A chained route is built from its inputs when it's created; it can't wait for another step's output.
  if (waits && route.chained) throw new Error(chainedWaitMessage(plan.model.name, plan.op));
  const jobs = waits ? 1 : plan.jobs;
  const batchId = opts.batchId ?? (jobs > 1 ? nanoid(10) : null);
  const now = Date.now();
  const created: Generation[] = [];
  for (let i = 0; i < jobs; i++) {
    const id = nanoid(12);
    const row: Row = {
      id,
      batch_id: batchId,
      feature: req.feature,
      preset_id: req.presetId ?? null,
      model_id: plan.model.id,
      engine: plan.model.engine,
      provider: providerId,
      op: plan.op,
      kind: outputKind(plan.op, plan.model),
      status: "queued",
      progress: null,
      message: waits ? (original.frame ? "Waits for the previous frame" : "Waits for the earlier steps") : demo ? "Demo mode — no provider connected" : "Submitting",
      // A step whose prompt comes from an earlier step shows its own words (not the placeholder) until then.
      prompt: waits && req.chain?.some((s) => s.slot === "prompt") ? original.prompt?.replaceAll("{text}", "…").trim() || null : plan.prompt,
      // An Original remembers the engine it ran on, so a retry or a chained step runs there too.
      request_json: JSON.stringify(dualEngine(plan.model) ? { ...kept, engine: plan.model.engine } : kept),
      provider_input_json: null,
      external_id: null,
      external_meta_json: null,
      outputs_json: "[]",
      error: null,
      cost_usd: cost,
      favorite: 0,
      created_at: now + i,
      updated_at: now + i,
      completed_at: null,
      depends_on: !waits ? null : deps.length === 1 ? deps[0] : JSON.stringify(deps),
    };
    db()
      .prepare(
        `INSERT INTO generations (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row)
          .map((k) => `@${k}`)
          .join(", ")})`,
      )
      .run(row);
    // What the run leaves out or changes (LoRAs a cloud run can't carry, a length the API rounds) goes back
    // with it, so the composer and API clients can say so; it isn't stored.
    created.push(notes.length ? { ...toGeneration(row), notes } : toGeneration(row));
    const capture = captureStore().getStore();
    capture?.ids.push(id);
    // A later step made inside a capture waits for the capture's start too: one whose earlier steps finished in an
    // earlier run (a film's shots after its board) is otherwise sent before its run is kept or made to wait.
    if (capture && waits) parked().set(id, Date.now() + PARK_MS);
    if (!waits) {
      const start = () => void submit(id, route, providerId, plan, req, i);
      if (capture) {
        capture.submits.push(start);
        capture.jobs.set(id, i);
      } else start();
    }
  }
  ensureRunner();
  return created;
}

interface RunCapture {
  ids: string[];
  submits: (() => void)[];
  /** The rows whose submit is held, by id: their job index (a later step, which waits for its earlier steps, has none). */
  jobs: Map<string, number>;
}

declare global {
  var __fuobeRunCapture: AsyncLocalStorage<RunCapture> | undefined;
}

const captureStore = () => (globalThis.__fuobeRunCapture ??= new AsyncLocalStorage<RunCapture>());

/**
 * Run `fn` (createGenerations, and every step its chains queue) with the rows it makes noted and their submits held:
 * `ids` are the rows, in the order they were made, and `start()` sends the held submits. Lets a caller make a run's rows
 * inside a transaction and send nothing until it commits. `rows`: each row with its job index when `start()` would send
 * it (null: a later step, sent once its earlier steps are done), for a run that waits to enter the line instead
 * (pool-holds.ts): its rows are sent later from what is stored (sendHeld). (An awaiting `fn` adds rows as it goes.)
 */
export function captureRun<T>(fn: () => T): { value: T; ids: string[]; readonly rows: { id: string; job: number | null }[]; start: () => void; settle: () => void } {
  const cap: RunCapture = { ids: [], submits: [], jobs: new Map() };
  const value = captureStore().run(cap, fn);
  const settle = () => cap.ids.forEach((id) => parked().delete(id));
  return {
    value,
    ids: cap.ids,
    get rows() {
      return cap.ids.map((id) => ({ id, job: cap.jobs.get(id) ?? null }));
    },
    start: () => {
      settle();
      cap.submits.splice(0).forEach((s) => s());
    },
    settle,
  };
}

declare global {
  var __fuobeParkedSteps: Map<string, number> | undefined;
}
/**
 * Later steps made inside a capture that is not started or settled yet (captureRun), with when they stop waiting for it
 * at the latest (a caller that never settles leaves nothing parked for long). advanceDependents leaves them alone.
 */
const parked = (): Map<string, number> => (globalThis.__fuobeParkedSteps ??= new Map<string, number>());
const PARK_MS = 10 * 60_000;

/** Is this later step still waiting for its capture (captureRun) to start or settle? */
function isParked(id: string, now = Date.now()): boolean {
  const until = parked().get(id);
  if (until === undefined) return false;
  if (until > now) return true;
  parked().delete(id);
  return false;
}

/**
 * One row a run would make: its model, operation, provider, kind and app, and the earlier steps it waits for. `loras`:
 * the LoRA files a planned ComfyUI row loads (runLoraFiles), when plannedSteps could plan it.
 */
export interface PlannedStep {
  id: string;
  modelId: string;
  op: string;
  provider: string;
  kind: string;
  presetId: string | null;
  waits: boolean;
  loras?: string[];
  /** The kinds of file a ComfyUI row reads: its own (`files`), and those its earlier steps hand it (`made`). */
  files?: FileKind[];
  made?: FileKind[];
}

const ROLLED_BACK = Symbol("rolled back");

/**
 * Every row `fn` (createGenerations) would make, made and thrown away inside one transaction: nothing is kept and
 * nothing is sent. A chain's later steps are planned exactly as the real run plans them, each ComfyUI row with the LoRA
 * files it loads (a look's, a motion's, a relit start frame's), so a gate checks them all.
 */
export function plannedSteps(fn: () => unknown): PlannedStep[] {
  const d = db();
  let steps: PlannedStep[] = [];
  try {
    d.transaction(() => {
      const run = captureRun(fn);
      run.settle();
      steps = stepsOf(run.ids).map(withRowLoras);
      throw ROLLED_BACK;
    })();
  } catch (e) {
    if (e !== ROLLED_BACK) throw e;
  }
  return steps;
}

/**
 * A ComfyUI row with the LoRA files it loads, planned from its request as createGenerations planned it (else as it was),
 * and the kinds of file it reads.
 */
function withRowLoras(s: PlannedStep): PlannedStep {
  if (s.provider !== "comfyui") return s;
  const r = db().prepare("SELECT request_json, depends_on FROM generations WHERE id = ?").get(s.id) as { request_json: string; depends_on: string | null } | undefined;
  if (!r) return s;
  try {
    const req = JSON.parse(r.request_json) as GenerationRequest;
    const deps = !r.depends_on ? 0 : r.depends_on.startsWith("[") ? (JSON.parse(r.depends_on) as unknown[]).length : 1;
    const made = chainFileKinds(req, deps);
    const facts = { ...s, files: requestFileKinds(req), ...(made.length && { made }) };
    const loras = runLoraFiles(previewChained(req, deps), req.params?.extra);
    return loras.length ? { ...facts, loras } : facts;
  } catch {
    return s;
  }
}

/** The kinds of file a step's earlier steps hand it, by the slots they go to (words for its prompt are no file). */
export function chainFileKinds(req: GenerationRequest, deps: number): FileKind[] {
  const kinds = new Set<FileKind>();
  for (const c of slotsFor(req, deps)) {
    const k = SLOT_KIND[c.slot];
    if (k !== "text") kinds.add(k);
  }
  return [...kinds];
}

/** The rows of a run (by id) as steps. */
export function stepsOf(ids: string[]): PlannedStep[] {
  const q = db().prepare("SELECT id, model_id, op, provider, kind, preset_id, depends_on FROM generations WHERE id = ?");
  return ids.flatMap((id) => {
    const r = q.get(id) as { id: string; model_id: string; op: string; provider: string; kind: string; preset_id: string | null; depends_on: string | null } | undefined;
    return r ? [{ id: r.id, modelId: r.model_id, op: r.op, provider: r.provider, kind: r.kind, presetId: r.preset_id, waits: !!r.depends_on }] : [];
  });
}

/** Where each dependency's output goes: `chain`, or the single-image `chainFrom`. */
function slotsFor(req: GenerationRequest, n: number): ChainSlot[] {
  // Dependencies beyond the listed slots are images (a chain shorter than dependsOn used to crash the launch).
  return Array.from({ length: n }, (_, i) => req.chain?.[i] ?? { slot: "images" as const, position: req.chainFrom ?? "last" });
}

const SLOT_KIND: Record<ChainSlot["slot"], MediaKind> = {
  images: "image",
  endImage: "image",
  video: "video",
  videos: "video",
  audio: "audio",
  voiceAudio: "audio",
  audio2: "audio",
  audios: "audio",
  model3d: "model3d",
  mask: "video",
  prompt: "text",
};

/** Names providers give the same stem (ComfyUI: voice/background, DBS also music/effects; Demucs: vocals…; SAM Audio: target/residual). */
const STEM_ALIASES: Record<string, string[]> = {
  voice: ["voice", "vocals", "speech", "target"],
  background: ["background", "accompaniment", "instrumental", "residual", "no_vocals"],
  music: ["music"],
  effects: ["effects", "sfx"],
};

/**
 * Soundtrack slots a video can fill: a step that made only a clip hands over the clip itself, and the
 * mux reads its sound (ComfyUI's LoadAudio and fal's FFmpeg take a video file as the audio input).
 * Shorts and Mixed Media put the trimmed source's own sound back under the restyled picture this way.
 */
const SOUNDTRACK_SLOTS = new Set<ChainSlot["slot"]>(["audio", "audio2"]);

/** The dependency output a slot takes: the first of the slot's kind, or the one with the slot's `stem`. */
export function pickOutput(outputs: OutputFile[], s: ChainSlot): OutputFile | undefined {
  // A mask: the output made as one (meta.role "mask": a painted window's last tracked frame), else a mask video, else a still.
  if (s.slot === "mask") return outputs.find((o) => o.meta?.role === "mask") ?? outputs.find((o) => o.kind === "video") ?? outputs.find((o) => o.kind === "image");
  // A path render (ChainSlot.render "path") is drawn from the depth picture the scene step made (MoGe 2: a GLB and a depth PNG).
  if (s.render === "path") return outputs.find((o) => o.kind === "image");
  const ofKind = outputs.filter((o) => o.kind === SLOT_KIND[s.slot]);
  if (s.index !== undefined) {
    if (!ofKind.length) return undefined;
    const at = (o: OutputFile, i: number) => (typeof o.meta?.index === "number" ? o.meta.index : i);
    const ordered = ofKind.map((o, i) => ({ o, i: at(o, i) })).sort((a, b) => a.i - b.i);
    return (ordered.find((x) => x.i === s.index) ?? ordered[Math.min(s.index, ordered.length - 1)]).o;
  }
  if (!s.stem) return ofKind[0] ?? (SOUNDTRACK_SLOTS.has(s.slot) ? outputs.find((o) => o.kind === "video") : undefined);
  const want = STEM_ALIASES[s.stem.toLowerCase()] ?? [s.stem.toLowerCase()];
  return ofKind.find((o) => typeof o.meta?.stem === "string" && want.includes(o.meta.stem.toLowerCase()));
}

const slotNoun = (s: ChainSlot) => (s.stem ? `${s.stem} stem` : s.slot === "mask" ? "mask" : SLOT_KIND[s.slot]);

/**
 * A planned list (ChainSlot `index` + `of`) that came back too short to read: a frame or two missing at
 * the end is held (pickOutput takes the last one), more fails the step before it is paid for.
 */
export function listShortfall(outputs: OutputFile[], s: ChainSlot): string | null {
  if (s.index === undefined || s.of === undefined) return null;
  const made = outputs.filter((o) => o.kind === SLOT_KIND[s.slot]).length;
  if (made >= s.of - CHAIN_LIST_SLACK) return null;
  const noun = slotNoun(s);
  return `made ${made} ${noun}${made === 1 ? "" : "s"} where ${s.of} were planned`;
}

function placeholderFor(s: ChainSlot): string {
  const kind = SLOT_KIND[s.slot];
  if (kind === "text") return "Placeholder text from an earlier step";
  if (kind === "model3d") return "/api/files/placeholder.glb";
  return kind === "image" ? "/api/files/placeholder.png" : kind === "video" ? "/api/files/placeholder.mp4" : "/api/files/placeholder.wav";
}

/**
 * What a chained step takes from a dependency's output: the file URL, or the text for "prompt".
 * A translation of timed text gets the cue list (so the timing survives); text saved only as a
 * file, or cut short inline (meta.truncated), is read back from it.
 */
export async function chainValue(o: OutputFile | undefined, s: ChainSlot, op?: Generation["op"]): Promise<string | undefined> {
  if (!o) return undefined;
  // The picture as it was made, before a Soul finish replaced it (a look board's next frame: its own grade comes after).
  if (s.raw && typeof o.meta?.original === "string" && o.meta.original) return o.meta.original;
  if (s.slot !== "prompt") return o.url;
  const cues = Array.isArray(o.meta?.cues) && o.meta.cues.length ? (o.meta.cues as Cue[]) : null;
  if (op === "translate" && cues) return JSON.stringify(cues);
  if (typeof o.text === "string" && !o.meta?.truncated) return o.text;
  // Timed text is saved as subtitles: its words come from the cues, not the .srt file.
  if (cues) return cueText(cues);
  if (!o.url) return undefined;
  return readRef(o.url)
    .then((f) => f.data.toString("utf8"))
    .catch(() => undefined);
}

/** A list slot with its own place in the list (ChainSlot.at). */
const placed = (s: ChainSlot) => s.at !== undefined && s.at >= 0;

/**
 * Put the dependencies' outputs into the request's inputs, slot by slot (lists keep dependency order).
 * A "prompt" slot gets the dependency's text: it fills "{text}" in the prompt, or becomes the prompt.
 */
export function withChainInputs(req: GenerationRequest, urls: string[]): GenerationRequest {
  const inputs = { ...req.inputs };
  let prompt = req.prompt;
  const slots = slotsFor(req, urls.length);
  for (const k of ["images", "videos", "audios"] as const) {
    const at = (pos: "first" | "last") => slots.flatMap((s, i) => (s.slot === k && !placed(s) && (s.position ?? "last") === pos ? [urls[i]] : []));
    const first = at("first");
    const last = at("last");
    // Slots with a place go in last, in order of it, so each lands where it says (a film's frames made by earlier steps).
    const inserts = slots.flatMap((s, i) => (s.slot === k && placed(s) ? [{ at: s.at!, url: urls[i] }] : [])).sort((a, b) => a.at - b.at);
    if (first.length || last.length || inserts.length) {
      const list = [...first, ...(inputs[k] ?? []), ...last];
      for (const x of inserts) list.splice(Math.min(x.at, list.length), 0, x.url);
      inputs[k] = list;
    }
  }
  slots.forEach((s, i) => {
    if (s.slot === "prompt") prompt = prompt?.includes("{text}") ? prompt.replaceAll("{text}", urls[i]) : urls[i];
    else if (s.slot !== "images" && s.slot !== "videos" && s.slot !== "audios") inputs[s.slot] = urls[i];
  });
  return { ...req, prompt, inputs };
}

/**
 * A stored step as it was before the runner filled its chain slots (`chainFilled`): the chained list
 * items come out from the front ("first") and the back ("last"), single slots are emptied, and the
 * step's own items stay. A retry rebuilds the step from new dependencies this way. Text that filled a
 * "prompt" slot can't be told from the prompt, so it stays.
 */
export function unfilledRequest(req: GenerationRequest, deps: number): GenerationRequest {
  const { chainFilled, chainSkipped, ...rest } = req;
  // A fallback's notice belongs to the run that fell back, not to a retry.
  delete rest.notice;
  if (!chainFilled) return chainSkipped ? { ...rest, ...(chainSkipped.prompt !== undefined ? { prompt: chainSkipped.prompt } : {}) } : rest;
  // Optional slots left out filled nothing; the fallback's prompt goes back to the one planned.
  if (chainSkipped?.prompt !== undefined) rest.prompt = chainSkipped.prompt;
  const slots = filledSlots({ ...rest, chainSkipped }, deps);
  const inputs = { ...rest.inputs };
  for (const k of ["images", "videos", "audios"] as const) {
    const count = (pos: "first" | "last") => slots.filter((s) => s.slot === k && !placed(s) && (s.position ?? "last") === pos).length;
    const list = [...(inputs[k] ?? [])];
    // Placed items come out first, the last placed first, as they went in.
    for (const at of slots.filter((s) => s.slot === k && placed(s)).map((s) => s.at!).sort((a, b) => b - a)) if (at < list.length) list.splice(at, 1);
    const own = list.slice(count("first"), list.length - count("last"));
    if (own.length) inputs[k] = own;
    else delete inputs[k];
  }
  for (const s of slots) if (s.slot !== "images" && s.slot !== "videos" && s.slot !== "audios" && s.slot !== "prompt") delete inputs[s.slot];
  return { ...rest, inputs: Object.keys(inputs).length ? inputs : undefined };
}

/** Generations this process is handing to a provider right now (shared across hot reloads and bundles). */
declare global {
  var __fuobeSubmitting: Set<string> | undefined;
}
const submitting = (): Set<string> => (globalThis.__fuobeSubmitting ??= new Set<string>());

/**
 * Wait (at most `ms`) until none of these runs is still being handed to its provider. A run cancelled during its
 * hand-over is stopped there as soon as its submit lands (submitNow), with the key it was sent with: removing or
 * replacing that key, or deleting the account, waits for this first. False when one is still going at the end.
 */
export async function handOversDone(ids: readonly string[], ms = 60_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (ids.some((id) => submitting().has(id))) {
    if (Date.now() >= end) return false;
    await new Promise((r) => setTimeout(r, 25));
  }
  return true;
}

/**
 * A chain runs all for real or all as a demo (a demo join of paid clips, or a paid step fed a demo
 * placeholder, helps nobody). Returns the error for a step that can't match its dependencies, and
 * whether it should run as a demo because they did.
 */
function chainMode(p: { demo: boolean; plan: { model: { name: string } }; route: ModelRoute }, deps: Pick<Row, "provider">[], asked?: Pick<GenerationRequest, "demo">): { error?: string; forceDemo?: boolean } {
  const demoDeps = deps.filter((d) => d.provider === "mock").length;
  if (p.demo && demoDeps < deps.length) {
    const needs = p.route.provider === "llm" ? llmLabel(p.route) : provider(p.route.provider).label;
    return { error: `${p.plan.model.name} needs ${needs} to continue what the earlier steps made for real — connect it in Settings, then retry` };
  }
  if (!p.demo && demoDeps > 0) {
    // A dry run (GenerationRequest.demo) stays a demo even with Settings → Demo mode off.
    if (getSetting("demoMode") === "off" && !asked?.demo) return { error: "An earlier step made a placeholder. Retry it once a model is connected." };
    return { forceDemo: true };
  }
  return {};
}

/** A waiting row's dependency ids as a json_each source (depends_on is one id, or a JSON list). */
const DEP_IDS = "json_each(CASE WHEN substr(g.depends_on, 1, 1) = '[' AND json_valid(g.depends_on) THEN g.depends_on ELSE json_array(g.depends_on) END) d";

/**
 * SQL: an app process that still runs holds the turn to hand the run in `table` to its provider (takeSubmitTurn: it is
 * sending it, or waiting on its own GPU or key for it); `others`: a process other than this one. An instance of the
 * release before that holds it with a live lease (OLD_LEASE) holds it too. Named parameters: @__me (this process's
 * name), @__quiet (since when a process that still runs has said so) and @__now.
 */
const TURN_HELD = (table: string, others: boolean) =>
  `(EXISTS (SELECT 1 FROM submit_turns s JOIN app_processes p ON p.token = s.held_by WHERE s.id = ${table}.id${others ? " AND s.held_by != @__me" : ""} AND p.seen_at >= @__quiet) OR ${OLD_LEASE_HELD(table)})`;

/**
 * Waiting steps that can move: none of their dependencies is still queued or running (so they launch), or one
 * failed, was canceled or is gone (so they fail now, not after the others finish). A per-frame render keeps
 * hundreds of steps waiting for its lanes, and a plain "oldest 50 waiting" would hold every chain started after
 * it until its backlog drained. The steps this process is handing to a provider right now are still "queued":
 * the limit makes room for them. A step another app process is handing over is left to it, and so is a step of a run
 * that waits to enter the line (pool-holds.ts): it moves once its run is released.
 */
const READY_DEPENDENTS = `SELECT g.* FROM generations g
  WHERE g.status = 'queued' AND g.external_id IS NULL AND g.depends_on IS NOT NULL
    AND (
      NOT EXISTS (SELECT 1 FROM ${DEP_IDS} JOIN generations dep ON dep.id = d.value WHERE dep.status IN ('queued', 'running'))
      OR EXISTS (SELECT 1 FROM ${DEP_IDS} LEFT JOIN generations dep ON dep.id = d.value WHERE dep.id IS NULL OR dep.status IN ('failed', 'canceled'))
    )
    AND NOT ${TURN_HELD("g", true)} AND ${NOT_HELD("g")}
  ORDER BY g.created_at ASC LIMIT @limit`;

/** The error a waiting step gets when an input failed (framesProgress tells these from a step's own failure). */
export const waitedOnFailure = (frame?: boolean) => `${frame ? "The previous frame" : "An earlier step"} didn't finish`;
/** Both of waitedOnFailure's sentences: a step that stopped only because an earlier one did. */
const WAITED_ON_FAILURE = new Set([waitedOnFailure(false), waitedOnFailure(true)]);
/** What a step dropped by dropUnused says (canceled, not by anyone: the steps it was for failed). */
export const DROPPED_UNUSED = "Stopped before it ran: the steps it was for failed";

/** Ids in a depends_on column that name `id` (one id, or a JSON list). */
const DEPENDENTS_OF = "(depends_on = @id OR (substr(depends_on, 1, 1) = '[' AND instr(depends_on, @quoted) > 0))";

/**
 * A waiting step marked dropWhenUnused whose every dependent has failed or been canceled can no longer be
 * used: cancel it (nothing was spent on it) and look again at the steps it waited for. `ids` are the inputs
 * of a step that just failed. A step being handed to its provider right now is left alone.
 */
function dropUnused(ids: string[]): void {
  const todo = [...ids];
  // Settled: dropped, or not a waiting dropWhenUnused step. One still used is looked at again when a step using it is dropped.
  const settled = new Set<string>();
  const live = db().prepare(`SELECT 1 FROM generations WHERE status IN ('queued', 'running') AND ${DEPENDENTS_OF} LIMIT 1`);
  while (todo.length) {
    const id = todo.pop()!;
    if (settled.has(id) || submitting().has(id)) continue;
    const r = db().prepare("SELECT status, external_id, depends_on, request_json FROM generations WHERE id = ?").get(id) as Pick<Row, "status" | "external_id" | "depends_on" | "request_json"> | undefined;
    if (!r || r.status !== "queued" || r.external_id || !r.depends_on || !(JSON.parse(r.request_json) as GenerationRequest).dropWhenUnused) {
      settled.add(id);
      continue;
    }
    if (live.get({ id, quoted: JSON.stringify(id) })) continue;
    settled.add(id);
    const now = Date.now();
    db()
      .prepare("UPDATE generations SET status = 'canceled', error = ?, message = NULL, completed_at = ?, updated_at = ? WHERE id = ? AND status = 'queued' AND external_id IS NULL")
      .run(DROPPED_UNUSED, now, now, id);
    todo.push(...depIds(r.depends_on));
  }
}

/**
 * A step with optional inputs whose steps failed (ChainSlot.optional): its chain without those slots, the fallback's
 * prompt and notice, and what was left out (so a retry can put the request back as it was: unfilledRequest).
 */
export function withoutSkipped(req: GenerationRequest, slots: ChainSlot[], skipped: number[]): GenerationRequest {
  const left = skipped.map((i) => slots[i]);
  const prompt = left.map((s) => s.optional?.prompt).find((p) => p !== undefined);
  const notice = [req.notice, ...left.map((s) => s.optional?.notice)].filter(Boolean).join(" · ");
  return {
    ...req,
    chainSkipped: { slots: skipped, ...(prompt !== undefined && req.prompt !== undefined ? { prompt: req.prompt } : {}) },
    ...(prompt !== undefined ? { prompt } : {}),
    ...(notice ? { notice } : {}),
  };
}

/** The chain slots a step fills: its own, less the optional ones left out (chainSkipped). */
const filledSlots = (req: GenerationRequest, n: number): ChainSlot[] => slotsFor(req, n).filter((_, i) => !req.chainSkipped?.slots.includes(i));

/** When a step after real ComfyUI steps first found ComfyUI not answering, by step id (shared across hot reloads). */
declare global {
  var __fuobeComfyWaits: Map<string, number> | undefined;
}
const comfyWaits = (): Map<string, number> => (globalThis.__fuobeComfyWaits ??= new Map<string, number>());
/** How long such a step waits for ComfyUI to answer again before chainMode fails it. */
export const COMFY_WAIT = { ms: 60_000 };

/**
 * A chain's last step made before it kept its run's stamp (chains.ts withAsked wrote it back without one): the stamp it
 * was asked with, so a step of a run on this install's GPUs runs there too, never on the account's own GPU.
 */
function withAskedStamp(req: GenerationRequest): GenerationRequest {
  if (!req.account || req.place || req.asked?.place !== "pool") return req;
  return { ...req, ...stampOf(req.asked), asked: withoutStamp(req.asked) };
}

/** Launch dependent jobs whose inputs finished; fail the ones whose inputs failed. Never waits for an upload. */
async function advanceDependents(): Promise<void> {
  // A server that is stopping launches no step (the app process that goes on does), and leaves the steps it looked at.
  if (draining()) return;
  const now = Date.now();
  const rows = db()
    .prepare(READY_DEPENDENTS)
    .all({ limit: 50 + submitting().size + parked().size, __me: runnerToken(), __quiet: now - QUIET_MS, __now: now }) as Row[];
  // A forced look at ComfyUI, at most one a sweep, for the steps that found it not answering.
  let lookedAgain: Promise<boolean> | undefined;
  for (const r of rows) {
    if (submitting().has(r.id) || isParked(r.id)) continue;
    // A step queued before its model was retired runs on what replaced it (and its row says so).
    const moved = currentRequest(JSON.parse(r.request_json) as GenerationRequest);
    const stored = withAskedStamp(moved.request);
    const allIds = depIds(r.depends_on);
    const allSlots = slotsFor(stored, allIds.length);
    const allDeps = allIds.map(
      (id) =>
        db().prepare("SELECT status, provider, outputs_json, request_json, error FROM generations WHERE id = ?").get(id) as Pick<Row, "status" | "provider" | "outputs_json" | "request_json" | "error"> | undefined,
    );
    const earlier = stored.frame ? "The previous frame" : "An earlier step";
    const fail = (error: string, cause = "earlier-step", logged = true) => {
      update(r.id, { status: "failed", error, message: null, completed_at: Date.now() });
      // An account's own step: the owner's log line and note, as for any of its runs.
      if (logged) ownFailed(r.id, ownAccountOf(stored), factsOf(r, { stage: "chain" }), cause);
      // Steps waiting only to feed this one (the other lanes of a per-frame render) are dropped before they are paid for.
      dropUnused(allIds);
    };
    const broken = (d: (typeof allDeps)[number]) => !d || d.status === "failed" || d.status === "canceled";
    // An optional input whose step failed is left out (Genjutsu's anchor frame): the step runs without it.
    const skipped = allSlots.flatMap((s, i) => (s.optional && broken(allDeps[i]) ? [i] : []));
    const failedDeps = allDeps.filter((d, i) => broken(d) && !skipped.includes(i));
    if (failedDeps.length) {
      // The owner's line goes with the first step after the failure: a step whose earlier steps all stopped only because
      // theirs did (a frame-by-frame chain broken at frame 3) writes none of its own.
      const knockOn = failedDeps.every((d) => d?.status === "failed" && WAITED_ON_FAILURE.has(d.error ?? ""));
      fail(waitedOnFailure(!!stored.frame), "earlier-step", !knockOn);
      continue;
    }
    const keep = (_: unknown, i: number) => !skipped.includes(i);
    const deps = allDeps.filter(keep);
    const slots = allSlots.filter(keep);
    if (deps.some((d) => d!.status !== "succeeded")) continue;
    const request = skipped.length ? withoutSkipped(stored, allSlots, skipped) : stored;
    // What changed upstream (an earlier fallback) is said on this step too, down to the finished result.
    const notices = [request.notice, ...deps.map((d) => (JSON.parse(d!.request_json) as GenerationRequest).notice)].filter((x): x is string => !!x);
    if (notices.length) request.notice = [...new Set(notices)].join(" · ");
    const outputs = deps.map((d) => JSON.parse(d!.outputs_json) as OutputFile[]);
    const short = slots.map((s, i) => listShortfall(outputs[i], s)).find(Boolean);
    if (short) {
      fail(`${earlier} ${short}`);
      continue;
    }
    // Every app process looks at the same waiting steps (a deploy runs two for a moment): only the one that takes the
    // step's turn sends it, so it is sent once. A server that began to stop meanwhile leaves it to the one that goes on.
    if (draining()) return;
    if (!takeSubmitTurn(r.id, { waiting: true })) continue;
    // A step that waited for its own GPU or key, taken over after a restart or a deploy (its wait is kept with it, as a
    // run's is: takeOver). One cut off in the middle of its send, on a later try or its first (markSending), may have
    // reached its GPU or provider: never sent twice. A step of a run on this install's workers whose send was to make a
    // task here (`sendingTask`) is known: with no task made, nothing was sent and the step is sent now (in its run's
    // place); with one made, it stops with the step instead of running for nothing. One sent to this install's own
    // ComfyUI (no task: its job may be there) stops as an account's own does.
    const pending = readMeta(db().prepare("SELECT external_meta_json FROM generations WHERE id = ?").pluck().get(r.id) as string | null);
    const heal = pending.heal;
    if ((heal && typeof heal.sending === "number") || typeof pending.sending === "number") {
      if (stored.place === "pool" && pending.sendingTask === true && !hasJobFor(r.id)) notSending(r.id);
      else {
        fail(CUT_OFF_SENDING, "interrupted-sending");
        if (stored.place === "pool") stopJobsOf(r.id);
        handOverEnds(r.id);
        continue;
      }
    }
    submitting().add(r.id);
    let handedOff = false;
    // An account's step reads its inputs, and is planned, as its run was: as that account, on its own ComfyUI and its own
    // keys. submit() then checks the step's own provider (its GPU, or its key for that provider).
    const account = stored.account;
    // A step of a run on this install's GPUs is planned there too, with the run's stamp (its place and hold).
    const asRun = <T,>(fn: () => T): T => (account ? (stored.place === "pool" ? runOnPool(account, () => withRunStamp(stampOf(stored), fn)) : asAccount(account, fn)) : fn());
    try {
      // The planned op (r.op), not request.op: a translate whose op was inferred still gets the cue list.
      const values = await asRun(() => Promise.all(outputs.map((o, i) => chainValue(pickOutput(o, slots[i]), slots[i], r.op))));
      const missing = values.findIndex((u) => !u);
      if (missing >= 0) {
        fail(`${earlier} has no ${slots[missing].render ? "depth picture" : slotNoun(slots[missing])} to use`);
        continue;
      }
      // Routing reads cached reachability: make sure it's fresh for local engines. An Original counts with the routes of
      // the engine it runs on, ComfyUI taken as answering: one on the cloud doesn't use it, so doesn't wait for it.
      const model = getModel(request.modelId);
      const runs = model && dualEngine(model) ? onEngine(model, pickEngine(model, request.engine, engineMode(), () => true)) : model;
      // (An account's step looks at its own ComfyUI, never the install's: inside its run, probeComfy says yes and the run finds out.)
      if (runs?.routes.some((x) => x.provider === "comfyui") && !(await asRun(() => probeComfy())) && deps.some((d) => d!.provider === "comfyui")) {
        // The earlier steps ran for real on ComfyUI: one missed check (a server busy finishing them, or restarting)
        // mustn't make this one a demo, which chainMode fails. Look again at once (one forced look a sweep), then wait
        // for the next sweeps (COMFY_WAIT from the first miss) before chainMode has its say.
        const first = comfyWaits().get(r.id);
        const back = first === undefined && (await (lookedAgain ??= probeComfy(true)));
        if (!back && first === undefined) {
          comfyWaits().set(r.id, Date.now());
          update(r.id, { message: "Waits for ComfyUI to answer" });
          continue;
        }
        if (!back && Date.now() - first! < COMFY_WAIT.ms) continue;
      }
      comfyWaits().delete(r.id);
      // A camera path drawn through the still's depth on this server (Uni3C's guide where no browser drew one); a demo
      // depth step hands on a demo render. Only once ComfyUI answers: a sweep that waits for it renders nothing.
      let pathWaits = false;
      for (let i = 0; i < slots.length; i++) {
        if (slots[i].render !== "path") continue;
        // The still, once the other slots are in (it can come from an earlier step too: a Canvas node's picture).
        const photo = withChainInputs({ ...request, chain: slots }, values as string[]).inputs?.images?.[0];
        const keys = request.params?.cameraPath ?? [];
        if (deps[i]!.provider === "mock" || !photo) values[i] = placeholderFor(slots[i]);
        else if (account && stored.place === "pool" && (poolOnWorkers() || finishTask(r.id, "path", i))) {
          // A run on this install's GPUs (the workers): the path is drawn on a worker's CPU slot (computer/finish.ts),
          // never here, whether or not one is about right now. The step waits for it, sweep by sweep, in the run's place
          // in line; one no CPU slot took within the run's wait fails in plain words. (A run on this install's own
          // ComfyUI, on this machine, has its path drawn here, as the install's own runs do.)
          const depth = values[i]!;
          const got = await asRun(() => pathOnWorker(r.id, i, { photo, depth, keys, frames: PATH_FRAMES, fps: PATH_FPS }));
          if (got.state === "failed") throw new Error(got.error);
          if (got.state === "waiting") {
            pathWaits = true;
            continue;
          }
          values[i] = got.url;
        } else {
          update(r.id, { message: "Rendering the camera path" });
          values[i] = await asRun(() => renderPathVideo({ photo, depth: values[i]!, keys }, r.id));
        }
      }
      if (pathWaits) continue;
      if (model?.routes.some((x) => x.provider === "llm")) await probeLocal();
      // Filled with the slots that have an input; stored with its whole chain (and what was skipped) for a retry.
      const filled = withChainInputs({ ...request, chain: slots }, values as string[]);
      // A 2K finish names the draft it waits for as the latent to load (never an id stored before: a retried draft is new).
      const original: GenerationRequest = latentFromDependency({ ...filled, chain: request.chain, chainFilled: true }, allIds.filter(keep), slots, deps);
      const prepared = asRun(() => prepare(original));
      const mode = chainMode(prepared, deps as Pick<Row, "provider">[], original);
      if (mode.error) throw new Error(mode.error);
      const p = mode.forceDemo ? { ...prepared, demo: true, providerId: "mock" as const, cost: 0 } : prepared;
      // A step that waited, planned for another provider now (its GPU disconnected or moved, its keys changed): its wait
      // was for the one it was made for, and nobody asked for the other, so it stops as a waiting run taken over does.
      const own = ownAccountOf(stored);
      if (heal && own && p.providerId !== r.provider) {
        stopReplanned(r.id, r.provider, own, p, "chain");
        dropUnused(allIds);
        continue;
      }
      // Its wait goes on with what is left of it (its tries and its time), where it still goes; its tile keeps its words.
      const resume = heal && !mode.forceDemo && p.providerId === r.provider ? heal : undefined;
      update(r.id, {
        ...(moved.note && { model_id: p.plan.model.id, engine: p.plan.model.engine }),
        provider: p.providerId,
        op: p.plan.op,
        kind: outputKind(p.plan.op, p.plan.model),
        prompt: p.plan.prompt,
        cost_usd: p.cost,
        request_json: JSON.stringify(original),
        ...(!resume && { message: mode.forceDemo ? "Demo — an earlier step ran as a demo" : p.demo ? "Demo mode — no provider connected" : "Submitting" }),
      });
      // In the background: an upload must not hold up the runner's other polls.
      handedOff = true;
      void submit(r.id, p.route, p.providerId, p.plan, p.req, 0, resume);
    } catch (e) {
      fail((e as Error).message, e instanceof AccountRunError ? e.refusal.code : "chain");
    } finally {
      if (!handedOff) handOverEnds(r.id);
    }
  }
}

/** A chained 2K finish finishes the run its clip comes from (a retried draft is a new run: read again when it is created). */
function withFinishOf(req: GenerationRequest, dependsOn: string | string[] | undefined): GenerationRequest {
  if (!req.finishOf || dependsOn === undefined) return req;
  const deps = Array.isArray(dependsOn) ? dependsOn : [dependsOn];
  const at = slotsFor(req, deps.length).findIndex((s) => s.slot === "video");
  return at >= 0 && deps[at] !== req.finishOf ? { ...req, finishOf: deps[at] } : req;
}

/**
 * MiniMax H3's 2K finish (Open-H3 Regenerate chained after its 768p draft): the draft it waits for, when that draft kept
 * its latent, is the latent it may load (latentHandOff checks it again when it starts). Any other latentFrom is dropped.
 */
function latentFromDependency(req: GenerationRequest, ids: string[], slots: ChainSlot[], deps: (Pick<Row, "request_json"> | undefined)[]): GenerationRequest {
  if (req.modelId !== REGEN_MODEL) return req;
  const at = slots.findIndex((s) => s.slot === "video");
  let draft: GenerationRequest | undefined;
  try {
    draft = at >= 0 && deps[at] ? (JSON.parse(deps[at]!.request_json) as GenerationRequest) : undefined;
  } catch {}
  const { latentFrom: _stored, ...extra } = req.params?.extra ?? {};
  void _stored;
  const latentFrom = draft?.params?.extra?.latentDraft === true ? ids[at] : undefined;
  if (!latentFrom && _stored === undefined) return req;
  return { ...req, params: { ...req.params, extra: { ...extra, ...(latentFrom && { latentFrom }) } } };
}

/**
 * The 2K hand-off as the run starts, on the ComfyUI it runs on (never trusted from the request; package n7-10). A draft
 * keeps its latent only where one stays between jobs (not the owner's workers) and while its Turbo 4-step LoRA is on. A
 * finish loads a latent only from a run of the same account (or the owner's own) that kept one on this same ComfyUI,
 * and that no earlier finish found gone; otherwise it redraws its clip.
 */
export function latentHandOff(extra: Record<string, unknown> | undefined, account: string | undefined): Record<string, unknown> | undefined {
  if (!extra || (extra.latentDraft === undefined && extra.latentFrom === undefined)) return extra;
  const out = { ...extra };
  const place = comfyPlace();
  if (out.latentDraft !== undefined && !(out.latentDraft === true && place && keepsH3Latent())) delete out.latentDraft;
  if (out.latentFrom !== undefined && !(typeof out.latentFrom === "string" && place && keptLatent(out.latentFrom, account, place))) delete out.latentFrom;
  return out;
}

/** Whether run `id` kept its 768p latent on `place` for this account (the owner: undefined), and it is still there. */
function keptLatent(id: string, account: string | undefined, place: string): boolean {
  const row = db().prepare("SELECT status, request_json, external_meta_json FROM generations WHERE id = ?").get(id) as Pick<Row, "status" | "request_json" | "external_meta_json"> | undefined;
  if (!row || row.status !== "succeeded" || accountOf(row) !== account) return false;
  try {
    const req = JSON.parse(row.request_json) as GenerationRequest;
    const meta = JSON.parse(row.external_meta_json ?? "{}") as { latentAt?: unknown };
    if (req.params?.extra?.latentDraft !== true || meta.latentAt !== place) return false;
  } catch {
    return false;
  }
  // A finish that found it gone (someone's computer reports that after the fact): the next one redraws the clip.
  const gone = db()
    .prepare("SELECT 1 FROM generations WHERE status = 'failed' AND error = ? AND json_extract(request_json, '$.params.extra.latentFrom') = ? LIMIT 1")
    .get(REGEN_COPY.latentGone, id);
  return !gone;
}

const statusOf = (id: string) => (db().prepare("SELECT status FROM generations WHERE id = ?").get(id) as Pick<Row, "status"> | undefined)?.status;

/** Start the timeout clock: the job has reached its provider. */
function recordSubmission(id: string, at: number): void {
  db()
    .prepare("INSERT INTO generation_runs (id, submitted_at, started_at) VALUES (?, ?, NULL) ON CONFLICT(id) DO UPDATE SET submitted_at = excluded.submitted_at, started_at = NULL")
    .run(id, at);
}

// ---------------------------------------------------------------------------
// Public sign-up: an account's runs go to its own ComfyUI ("Your GPU") or its own fal.ai or Replicate key ("Your
// keys"), never the install's providers

export const OWN_GPU_ONLY = "Pick an open-source model to run it on your GPU.";
export const OPEN_ONLY_RUN = "Pick an open-source model to run this on your GPU.";
export const SWITCHED_OFF_RUN = "This account is closed, so its runs stopped.";
/** A run on this install's GPUs that waited past its limit (hosted runs). */
/** A run on this install's GPUs that waited past the limit set for it (a billing service's; none by default). */
export const POOL_WAITED = ENGINE_WORDS["long-wait"];

/**
 * Everything an account's work runs inside: as the account (tenant.ts: only its own files and runs), on its own ComfyUI
 * (none yet: an address that reaches nothing), with its own fal.ai and Replicate keys (provider-keys.ts), its engine
 * mode, fal.ai before Replicate among the keys it has, and no demo outputs.
 */
export function asAccount<T>(id: string, fn: () => T): T {
  const mode = accountEngineMode(id);
  const gpu = accountGpu(id);
  return runAsTenant({ kind: "account", id }, () =>
    onOwnGpu(gpu ? ownGpuOf(id, gpu) : { url: "" }, () => withCandidates({ engineMode: mode, demoMode: "off", cloudProvider: "auto" }, fn)),
  );
}

export type AccountRunRefusal = { error: string; code: "connect-gpu" | "add-key" | "own-gpu-tool" | "open-only" | "switched-off"; provider?: CloudProvider };

/**
 * How an account's job reaches a provider, inside asAccount, or not at all. ComfyUI needs its own GPU; fal.ai and
 * Replicate need its own key for that provider. Anything else (the install's local LLM, demo outputs) is refused. A
 * "submit" also needs a live account and a studio that isn't open-source only; a "poll" or "cancel" works for a
 * switched-off account too, so a job going on its key finishes or stops, never runs on. An unreachable GPU or a refused
 * key fails the job: it never falls back to the install's.
 */
export function accountRun(accountId: string, providerId: string, purpose: "submit" | "poll" | "cancel" = "submit"): { run: <T>(fn: () => T) => T } | AccountRunRefusal {
  const run = <T,>(fn: () => T): T => asAccount(accountId, fn);
  if (providerId === "comfyui") return accountGpu(accountId) ? { run } : { error: CONNECT_GPU_MESSAGE, code: "connect-gpu" };
  if (!isCloudProvider(providerId)) return { error: OWN_GPU_ONLY, code: "own-gpu-tool" };
  const p = providerId;
  if (purpose === "submit") {
    const a = accountById(accountId);
    if (!a || a.disabled) return { error: SWITCHED_OFF_RUN, code: "switched-off" };
    if (!paidAllowed()) return { error: OPEN_ONLY_RUN, code: "open-only" };
  }
  if (accountKey(accountId, p) === null) return { error: purpose === "submit" ? addKeyMessage(p) : keyRemovedMessage(p), code: "add-key", provider: p };
  return { run };
}

/** The account's answer to "who may run this": the route turns it into a 403 the client acts on (Connect your GPU, Add your key). */
export class AccountRunError extends Error {
  constructor(readonly refusal: AccountRunRefusal) {
    super(refusal.error);
  }
}

/**
 * The adapter for a run's provider, only inside its own account's work (none: the owner's). A run that lost its scope
 * fails here: it never falls into the owner's keys (provider-keys.ts).
 */
export function adapterFor(providerId: ProviderId, account: string | undefined): ProviderAdapter {
  if ((tenantAccount() ?? undefined) !== (account ?? undefined)) throw new Error("We can't find that run.");
  return provider(providerId);
}

/** Where an account's ComfyUI is, as the provider takes it: a link, or the person's own computer (its tab runs the jobs). */
function ownGpuOf(accountId: string, gpu: AccountGpu): OwnGpu {
  return gpu.mode === "computer" ? { kind: "computer", principal: `acct:${accountId}` } : { url: gpu.url, token: gpu.token };
}

/**
 * The LoRA files an account's run needs that its own ComfyUI doesn't have (call it inside accountRun): the run's own,
 * and those of the step that makes its start frame first (a Fuobe DoP relight or Mixed Media effect, which
 * createRelitClip queues as a step of its own). Null when nothing is missing, or the list couldn't be read.
 */
export async function accountLoraFix(req: GenerationRequest): Promise<MissingFiles | null> {
  const p = previewGeneration(req);
  const asks: { loras: LoraRef[]; endpoint: string }[] = [];
  if (p.route.provider === "comfyui") asks.push({ loras: [...p.loras.applied, ...graphLoras(p.route.endpoint, req.params?.extra)], endpoint: p.route.endpoint });
  const pre = relightStep(req, p.model);
  if (pre) {
    try {
      const { step } = pre;
      const s = previewGeneration({
        feature: req.feature,
        account: req.account,
        engine: pre.engine,
        modelId: step.modelId,
        op: step.op,
        prompt: step.prompt,
        inputs: { images: (req.inputs?.images ?? []).slice(0, 1) },
        ...(step.loras?.length && { loras: step.loras }),
        ...(step.params && { params: step.params }),
      });
      if (s.route.provider === "comfyui") asks.push({ loras: [...s.loras.applied, ...graphLoras(s.route.endpoint, step.params?.extra)], endpoint: s.route.endpoint });
    } catch {
      // The step says what's wrong when it is created.
    }
  }
  // An end-frame step (Qwen-Image 2.1 edit that makes the clip's end frame) runs on the GPU too.
  if (p.plan.end) {
    try {
      const step = p.plan.end;
      const s = previewGeneration({
        feature: req.feature,
        account: req.account,
        engine: "open",
        modelId: step.modelId,
        op: step.op,
        prompt: step.promptTemplate,
        inputs: { images: (req.inputs?.images ?? []).slice(0, 1) },
        ...(step.params && { params: step.params }),
      });
      if (s.route.provider === "comfyui") asks.push({ loras: [...s.loras.applied, ...graphLoras(s.route.endpoint, step.params?.extra)], endpoint: s.route.endpoint });
    } catch {
      // The step says what's wrong when it is created.
    }
  }
  const items: MissingFiles["items"] = [];
  let workflowId: string | undefined;
  for (const a of asks) {
    const f = await checkAccountLoras(a.loras, a.endpoint);
    if (!f) continue;
    workflowId ??= f.workflowId;
    for (const i of f.items) if (!items.some((x) => x.file === i.file)) items.push(i);
  }
  return items.length ? { code: "comfy_missing_model", ...(workflowId && { workflowId }), items } : null;
}

/**
 * Plan (and price) as a visitor's run would go: as that visitor (an account, or a guest), on its own ComfyUI (none
 * yet: an empty address that reaches nothing), the open engine, no demo outputs. For previews; a run goes through
 * accountRun.
 */
export function asVisitor<T>(gpu: AccountGpu | null, fn: () => T, accountId?: string): T {
  return runAsTenant(accountId ? { kind: "account", id: accountId } : { kind: "guest" }, () =>
    onOwnGpu(gpu && accountId ? ownGpuOf(accountId, gpu) : { url: gpuLink(gpu)?.url ?? "" }, () => withCandidates({ engineMode: "open", demoMode: "off" }, fn)),
  );
}

/** A row whose request can't be read: whose it is is unknown, so it is never taken for the owner's (accountOf). */
const UNREADABLE = "\u0000unreadable";

/** The account a row's run is for; undefined: the owner's. A request that can't be read counts as nobody's (UNREADABLE). */
const accountOf = (r: Pick<Row, "request_json">): string | undefined => {
  try {
    return (JSON.parse(r.request_json) as GenerationRequest).account;
  } catch {
    return UNREADABLE;
  }
};

/** A row of a run on this install's GPUs (hosted runs). */
const poolOf = (r: Pick<Row, "request_json">): boolean => {
  try {
    return (JSON.parse(r.request_json) as GenerationRequest).place === "pool";
  } catch {
    return false;
  }
};

function submit(id: string, route: ModelRoute, providerId: ProviderId, plan: ReturnType<typeof planGeneration>, req: GenerationRequest, index: number, resume?: HealState, rankAt?: number): Promise<void> {
  if (!req.account) return submitNow(id, route, providerId, plan, req, index);
  // On this install's GPUs (hosted runs): as the account, on this install's ComfyUI server only.
  if (req.place === "pool") {
    // (A run is checked against the same table before it is made: hosted-run.ts stepsProblem.)
    if (!poolRunsProvider(providerId)) {
      updateLive(id, { status: "failed", error: OWN_GPU_ONLY, completed_at: Date.now(), message: null });
      handOverEnds(id);
      return Promise.resolve();
    }
    // (`rankAt`: a run that waited to enter the line takes its place at its press: pool-holds.ts.)
    const stamp = { ...stampOf(req), ...(rankAt !== undefined && { rankAt }) };
    return runOnPool(req.account, () => withRunStamp(stamp, () => submitNow(id, route, providerId, plan, req, index)));
  }
  const own = accountRun(req.account, providerId, "submit");
  if ("error" in own) {
    if (updateLive(id, { status: "failed", error: own.error, completed_at: Date.now(), message: null })) {
      ownFailed(id, req.account, { provider: providerId, model: plan.model.id, op: plan.op, stage: "submit" }, own.code);
    }
    // A chained step advanceDependents marked as being handed over isn't any more.
    handOverEnds(id);
    return Promise.resolve();
  }
  return own.run(() => submitNow(id, route, providerId, plan, req, index, resume));
}

/** A song's cloud tools (Mureka): the song's length and format are read before it's sent. */
const SONG_TOOL_OPS = new Set<Operation>(["song-extend", "song-remix", "song-stems"]);

/** What an earlier try of a hand-over already sent (an input's name or link at the provider, a voice it cloned): reused. */
type HandOverCache = Map<string, string>;

/** What a run's log line and its owner's note say of it (src/server/run-events.ts). */
interface RunFacts {
  provider: string;
  model: string;
  op?: string;
  stage?: string;
  attempt?: number;
  waitedMs?: number;
}

const factsOf = (r: Pick<Row, "provider" | "model_id" | "op">, more: Omit<RunFacts, "provider" | "model" | "op"> = {}): RunFacts => ({ provider: r.provider, model: r.model_id, op: r.op, ...more });

async function submitNow(
  id: string,
  route: ModelRoute,
  providerId: ProviderId,
  plan: ReturnType<typeof planGeneration>,
  req: GenerationRequest,
  index: number,
  resume?: HealState,
): Promise<void> {
  // Another app process that still runs is handing this run over, or waiting on it, right now (a deploy's overlap): it is
  // left to that process. So is a run that was cancelled, failed or handed over meanwhile.
  if (!takeSubmitTurn(id)) {
    submitting().delete(id);
    return;
  }
  submitting().add(id);
  // MiniMax H3's 2K hand-off, decided here, on the ComfyUI this run goes to.
  if (providerId === "comfyui") {
    const extra = latentHandOff(plan.params.extra, req.account);
    if (extra !== plan.params.extra) plan = { ...plan, params: { ...plan.params, extra } };
  }
  // An account's run on its own GPU or key (not on this install's GPUs): a passing problem (a GPU that is off or starting
  // up, a busy or down provider) is waited out within a budget, the tile saying what it waits for and what helps; the
  // wait is kept with the run, so a restart or a deploy goes on with it. Anything else fails in plain words, with what
  // helps (src/lib/diagnose.ts). The owner's runs and runs on this install's GPUs fail at once, in their own words.
  const account = req.account && req.place !== "pool" ? req.account : undefined;
  // The GPU this run was planned for (its scope read it when it began).
  const gpu = account && providerId === "comfyui" ? accountGpu(account) : null;
  const link = gpuLink(gpu);
  const pod = !!link && gpuHostOf(link.url).kind === "runpod";
  const started = Date.now();
  const heal: HealState = resume ? { ...resume, firstSeen: { ...resume.firstSeen } } : { since: started, deadline: started, firstSeen: {}, tries: 0, next: 0, index };
  const facts = (more: Omit<RunFacts, "provider" | "model" | "op"> = {}): RunFacts => ({ provider: providerId, model: plan.model.id, op: plan.op, stage: "submit", ...more });
  const sent: HandOverCache = new Map();
  try {
    // Taken over (a restart, another instance): what is left of its wait first, then a look at its GPU.
    if (resume && resume.next > Date.now() && !(await pause(id, resume.next - Date.now()))) return;
    let lookFirst = !!resume && !!link;
    // The first try reads the GPU's last status check (never asked again here): one that is off waits at once,
    // instead of sending files to an address that answers nothing.
    const known = link && !resume ? cachedGpuState(account!, link.url) : undefined;
    for (;;) {
      // A try again (its wait kept with the run) while this server stops: nothing more is sent from here, and the run
      // is left as it is, for the next instance to go on with.
      if ((heal.tries > 0 || resume) && draining()) return;
      let error: unknown;
      if (heal.tries === 0 && !resume && known && !known.online && known.trouble?.retryable) error = troubleError(known.trouble);
      else if (link && (heal.tries > 0 || lookFirst)) {
        lookFirst = false;
        // Tried again: first a look at the GPU (its /system_stats, no files, outside the send line). Files go once it answers.
        const look = await probeGpu(account!, link);
        if (look !== "online") error = look;
      }
      if (!error) {
        try {
          await handOver(id, route, providerId, plan, req, index, sent);
          if (link && statusOf(id) !== "failed") noteHandedOver(account!, link.url);
          if (account && heal.tries > 0) recordOwnRun({ run: id, account, ...facts({ attempt: heal.tries, waitedMs: Date.now() - heal.since }), hostKind: hostKindOf(gpu), outcome: "healed" });
          return;
        } catch (e) {
          // Another instance holds the run now, or this server is stopping: left as it is, for the instance that goes on.
          if (e instanceof LetGo) return;
          error = e;
          // A voice the provider cloned for this run (a billed step) is kept for the next try.
          const voice = (e as { voiceEmbedding?: unknown } | null)?.voiceEmbedding;
          if (typeof voice === "string") sent.set("voiceEmbedding", voice);
        }
      }
      // Cancelled, failed or taken by another instance, deleted, or handed over meanwhile: nothing more to do here.
      const status = statusOf(id);
      if (status !== "queued" && status !== "running") return;
      let trouble = account ? accountTrouble(error, account, providerId, "submit", req) : undefined;
      const budget = trouble?.retryable ? retryPlan(trouble.cause) : null;
      if (budget && trouble) {
        heal.tries++;
        const now = Date.now();
        // Each cause has its own budget from when it was first seen (a GPU that was off and is starting up now gets the
        // whole of starting up's), never past the cap from the first try.
        const first = (heal.firstSeen[trouble.cause] ??= now);
        heal.deadline = Math.min(heal.since + HEAL_CAP_MS * SELF_HEAL.scale, Math.max(heal.deadline, first + budget.budgetMs * SELF_HEAL.scale));
        const wait = backoffMs(heal.tries, budget, trouble.retryAfterMs) * SELF_HEAL.scale;
        if (now + wait <= heal.deadline) {
          if (link) noteGpuState(account!, link.url, false, { trouble: asStatus(error, trouble, link) });
          // Kept with the run (another instance goes on with it after a restart or a deploy), the tile saying what it
          // waits for and showing what helps. A step of a longer run, or a run of one of the account's projects, doesn't
          // offer Run with your key: moved alone, it would leave its run or its project (keyMoveBlock).
          const shown = trouble.actions.some((a) => a.kind === "run-with-key") && keyMoveBlock(id) ? withoutKeyOffer(trouble) : trouble;
          if (!markWaiting(id, heal, shown, now + wait, waitingWords(shown, isCloudProvider(providerId) ? providerId : undefined, pod))) return;
          if (heal.tries === 1 || heal.firstSeen[trouble.cause] === now) ownEvent(id, account!, error, trouble, facts({ attempt: heal.tries, waitedMs: now - heal.since }), "waiting");
          if (!(await pause(id, wait))) return;
          // The account changed its GPU meanwhile (a new address or password, this computer, or none): this run goes there.
          if (providerId === "comfyui" && account && gpuChanged(account, gpu)) {
            if (!accountGpu(account)) {
              failRun(id, error, diagnoseGpuJob({ kind: "disconnected" }, { kind: "link", url: link?.url ?? "" }), account, facts({ attempt: heal.tries }));
              return;
            }
            const p = replan(id, account);
            if (!p || p.providerId !== providerId) {
              failRun(id, error, diagnoseGpuJob({ kind: "moved" }, { kind: "link", url: link?.url ?? "" }), account, facts({ attempt: heal.tries }));
              return;
            }
            if (!updateLive(id, { message: "Your GPU has a new address, so this run goes there" }, " AND external_id IS NULL")) return;
            return await submit(id, p.route, p.providerId, p.plan, p.req, index, { ...heal, tries: 0, rechecked: false, next: 0 });
          }
          continue;
        }
        // Out of time: a GPU that seemed off is asked once more before the run fails (it may be back by now).
        if (link && !heal.rechecked) {
          heal.rechecked = true;
          const again = await recheckGpu(account!, link);
          if (again === "online") continue;
          trouble = { ...again, actions: withKeyOffer(again.actions, account!, req) };
        }
      }
      // The provider turned the job down as it was sent (a refused key, an empty balance, a model gone): it never had it,
      // so its card says Not billed again, as on a first try (not after a voice the provider cloned for it: that was billed).
      if (refusedAtSend(error) && !sent.has("voiceEmbedding")) notSending(id);
      failRun(id, error, trouble, req.account, account ? facts({ attempt: heal.tries, waitedMs: Date.now() - heal.since }) : undefined, !!account);
      return;
    }
  } finally {
    // Its turn goes, whatever happened: sent, failed, cancelled, or left waiting while this server stops (the next
    // process takes the wait over at once, instead of after this one has gone quiet).
    handOverEnds(id);
  }
}

/** handOver stopped before the send: another app process took the run, or this server is stopping while the run waited. */
class LetGo extends Error {}

/**
 * Just before a run's job is sent. A run that waited (its `heal` kept with it) is marked as being sent: a process that
 * takes the wait over later (this one cut off in the middle of the send, by a restart or a deploy) then doesn't send it
 * a second time. So is a step of an account's longer run on its first try (`step`: on its own GPU or key, or on this
 * install's GPUs): the process that launches it after this one was cut off never sends it again (advanceDependents).
 * `task`: the job this send makes is a task of this database (a run on this install's workers), noted with the mark.
 *
 * The look at the turn and the mark are one step (an immediate transaction): a process that stalled past its turn (20 s
 * with no beat) and another took it meanwhile never marks or sends the run, and one that takes the turn after the mark
 * sees it (takeOver, advanceDependents). Throws LetGo when this process doesn't hold the run's turn (another took it, or
 * an instance of the release before holds it: OLD_LEASE), when this server is stopping and the run waited (the next
 * process goes on with its wait, and sends it), and for a step's first try while this server is stopping (the next
 * process launches it, instead of finding it cut off in the middle of its send; the owner's steps too).
 */
function markSending(id: string, step: boolean, task = false): void {
  const d = db();
  const out = d
    .transaction((): "gone" | "taken" | "stopping" | "marked" => {
      const r = d
        .prepare(`SELECT g.external_meta_json, g.depends_on, s.held_by FROM generations g LEFT JOIN submit_turns s ON s.id = g.id WHERE g.id = ? AND g.status IN ('queued', 'running') AND g.external_id IS NULL`)
        .get(id) as (Pick<Row, "external_meta_json" | "depends_on"> & { held_by: string | null }) | undefined;
      if (!r) return "gone";
      if (r.held_by !== runnerToken() || oldLeaseHolds(r.external_meta_json)) return "taken";
      const now = Date.now();
      if (!readMeta(r.external_meta_json).heal) {
        // A first try (nothing waited): a run's send cut off here fails at the next process's look (sweepInterrupted).
        if (!r.depends_on) return "marked";
        if (draining()) return "stopping";
        if (!step) return "marked";
        d.prepare(
          `UPDATE generations SET external_meta_json = json_set(CASE WHEN json_valid(external_meta_json) THEN external_meta_json ELSE '{}' END, '$.sending', @now${task ? ", '$.sendingTask', json('true')" : ""})
           WHERE id = @id AND ${PENDING}`,
        ).run({ id, now });
        return "marked";
      }
      if (draining()) return "stopping";
      d.prepare(`UPDATE generations SET external_meta_json = json_set(external_meta_json, '$.heal.sending', @now) WHERE id = @id AND ${PENDING} AND json_type(external_meta_json, '$.heal') = 'object'`).run({ id, now });
      return "marked";
    })
    .immediate();
  if (out === "gone") throw new Error("Stopped");
  if (out === "taken") throw new LetGo("Taken by another app process");
  if (out === "stopping") throw new LetGo("Stopping");
}

/** A send its provider answered with a refusal (a 4xx): the job was never taken. */
function refusedAtSend(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500;
}

/** A send that is over without a job: the run's mark of being sent goes (it was never handed over). */
function notSending(id: string): void {
  db()
    .prepare(`UPDATE generations SET external_meta_json = json_remove(external_meta_json, '$.heal.sending', '$.sending', '$.sendingTask') WHERE id = ? AND ${PENDING} AND json_valid(external_meta_json)`)
    .run(id);
}

/** Self-healing's clock: tests make it faster (0.001: a 30-minute wait takes 1.8 s). */
export const SELF_HEAL = { scale: 1 };

/** An account's job waiting in its own GPU's (or provider's) queue: how long without moving. Tests make it shorter. */
export const OWN_QUEUE = { scale: 1 };
/** The longest an account's job waits in its own GPU's (or provider's) queue, however it moves. */
const OWN_QUEUE_CAP_MS = 2 * 60 * 60_000;

/**
 * Whether another of the account's runs on this provider has started there. fal.ai starts a key's jobs a few at a time
 * (its concurrency limit: 2 on a new account, more as it buys credit) and keeps the others IN_QUEUE until one of those
 * ends (fal.ai docs: Concurrency Limits): their place doesn't move meanwhile, but their queue does.
 */
function ownRunStarted(id: string, account: string, provider: string): boolean {
  return !!db()
    .prepare(
      "SELECT 1 FROM generations g JOIN generation_runs t ON t.id = g.id WHERE g.id != ? AND g.provider = ? AND g.status = 'running' AND t.started_at IS NOT NULL AND json_extract(g.request_json, '$.account') = ? LIMIT 1",
    )
    .get(id, provider, account);
}

/**
 * The words a waiting run's tile shows, its wait kept with it (external_meta_json `heal`). False: it isn't waiting any more,
 * or this process no longer holds its turn (it stalled, and another took the wait over: that one's wait, and its mark of
 * a send, stay as they are).
 */
function markWaiting(id: string, heal: HealState, trouble: Diagnosis, next: number, message: string): boolean {
  heal.next = next;
  heal.words = trouble.words;
  heal.trouble = troubleOf(trouble);
  // The try that was sending failed: the next one may send.
  delete heal.sending;
  return (
    db()
      .prepare(
        `UPDATE generations SET status = 'queued', message = @message, updated_at = @now,
           external_meta_json = json_set(json_remove(CASE WHEN json_valid(external_meta_json) THEN external_meta_json ELSE '{}' END, '$.sending', '$.sendingTask'), '$.heal', json(@heal))
         WHERE id = @id AND ${PENDING} AND EXISTS (SELECT 1 FROM submit_turns s WHERE s.id = @id AND s.held_by = @me)`,
      )
      .run({ id, message, now: Date.now(), heal: JSON.stringify(heal), me: runnerToken() }).changes > 0
  );
}

/**
 * Wait `ms`, looking every second whether the run still waits here. False: it was cancelled, failed, deleted or handed
 * over meanwhile, another app process took its turn, or this server is stopping (the next one goes on with it).
 */
async function pause(id: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    if (draining()) return false;
    const left = end - Date.now();
    if (left <= 0) return true;
    await new Promise((r) => setTimeout(r, Math.min(1000, left)));
    const r = db().prepare("SELECT status, external_id FROM generations WHERE id = ?").get(id) as Pick<Row, "status" | "external_id"> | undefined;
    if (!r || (r.status !== "queued" && r.status !== "running") || r.external_id || turnTaken(id)) return false;
  }
}

/**
 * A failed run in its words: an account's plain sentence (the owner's own detail as before), with what helps and "Fix it".
 * Only while the run is still going: a Cancel (or another instance's failure) written meanwhile stays. `facts`: an
 * account's own run, logged and noted for the owner (run-events.ts).
 */
function failRun(id: string, e: unknown, trouble: Diagnosis | undefined, account: string | undefined, facts?: RunFacts, own = !!facts): boolean {
  // A fallback making a run Ideogram 4 declined: the next one, or it fails as the declined run.
  const declined = declinedFails(id, trouble?.words ?? String((e as Error | null)?.message ?? e));
  if (declined !== null) return declined;
  const fix = (e as { fix?: GenerationFix } | null)?.fix;
  const kept = keptFix(fix, trouble);
  // What the GPU was missing (a model, a node class) is kept, so the tile offers "Fix it", and its GPU check counts as stale.
  // (Only while the run still goes: a Cancel, or a result another app process saved meanwhile, stays.)
  const done = updateLive(id, { status: "failed", error: trouble?.words ?? String((e as Error | null)?.message ?? e), completed_at: Date.now(), message: null, ...(kept && { fix_json: kept }) });
  if (!done) return false;
  if (fix) markStale(account ? `acct:${account}` : "install");
  if (own && account && facts) ownEvent(id, account, e, trouble, facts, "failed");
  return true;
}

/** An account's own run (its GPU or key), never one on this install's GPUs: its account, else undefined. */
const ownAccountOf = (req: Pick<GenerationRequest, "account" | "place"> | null | undefined): string | undefined => (req?.account && req.place !== "pool" ? req.account : undefined);

/** ownAccountOf for a stored request (unreadable: none). */
const ownAccountIn = (requestJson: string): string | undefined => {
  try {
    return ownAccountOf(JSON.parse(requestJson) as GenerationRequest);
  } catch {
    return undefined;
  }
};

/**
 * An account's own run that failed in this server's own words (cut off by a restart, refused as its account runs now, an
 * earlier step that didn't finish): the owner's log line and note, as failRun writes them for a GPU's or key's failure.
 * `cause` says which. Nothing for the owner's runs or runs on this install's GPUs (`account` undefined).
 */
function ownFailed(id: string, account: string | undefined, f: RunFacts, cause: string): void {
  if (!account) return;
  try {
    const hostKind = f.provider === "comfyui" ? hostKindOf(accountGpu(account)) : undefined;
    recordOwnRun({ run: id, account, ...f, hostKind, cause, outcome: "failed" });
  } catch {
    // A log line never stops a run.
  }
}

/** This server's own folders: never named in a run's details line (src/lib/engine-error.ts withoutFolders). */
const serverFolders = () => [DATA_DIR, process.cwd(), os.tmpdir(), os.homedir()];

/**
 * generations.fix_json: what the GPU was missing (GenerationFix) and, for an account, what its GPU or key ran into. Its
 * details line keeps the person's own GPU's words, without this server's folders.
 */
const keptFix = (fix: GenerationFix | undefined, trouble: Diagnosis | undefined): string | undefined =>
  fix || trouble
    ? JSON.stringify({ ...(fix ?? {}), ...(trouble && { trouble: troubleOf(trouble.details ? { ...trouble, details: withoutFolders(trouble.details, serverFolders()) } : trouble) }) })
    : undefined;

/** Where an account's GPU is, as the log says it: a RunPod pod, a tunnel, a web address, or the person's own computer. */
function hostKindOf(gpu: AccountGpu | null | undefined): HostKind | undefined {
  if (!gpu) return undefined;
  if (gpu.mode === "computer") return "computer";
  return gpuHostOf(gpu.url).kind;
}

/**
 * An account's run on its own GPU or key that waits, healed or failed: one log line, and (failed) the note the owner
 * reads. Its stage and code from what came back, the provider's own words without the GPU's address, a token or a key.
 */
function ownEvent(id: string, account: string, e: unknown, trouble: Diagnosis | undefined, f: RunFacts, outcome: "failed" | "waiting"): void {
  try {
    const failure = (e as { failure?: GpuFailure } | null)?.failure;
    const status = failure?.status ?? (e as { status?: unknown } | null)?.status;
    const net = failure?.error ?? networkReason(e);
    const code = typeof status === "number" && status > 0 ? String(status) : net ? networkCode(net) : undefined;
    const own = f.provider === "comfyui" ? ownGpu() : undefined;
    const link = own && own.kind !== "computer" ? own : undefined;
    const hostKind: HostKind | undefined = f.provider !== "comfyui" ? undefined : own?.kind === "computer" ? "computer" : link?.url ? gpuHostOf(link.url).kind : undefined;
    const said = keptText(failure?.body || failure?.error || failure?.location || ((e as { said?: unknown } | null)?.said as string | undefined) || (e as Error | null)?.message, { url: link?.url, secret: link?.token });
    recordOwnRun({ run: id, account, ...f, stage: failure?.stage ?? f.stage, code, hostKind, cause: trouble?.cause, outcome }, said);
  } catch {
    // A log line never stops a run.
  }
}

/** A network failure (no answer at all) as its words, or undefined for any other error. */
function networkReason(e: unknown): string | undefined {
  const err = e as { message?: unknown; name?: unknown; cause?: { code?: unknown } } | null;
  const code = typeof err?.cause?.code === "string" ? err.cause.code : undefined;
  const msg = String(err?.message ?? "");
  const aborted = err?.name === "TimeoutError" || err?.name === "AbortError";
  if (!code && !aborted && !/fetch failed|ECONNREFUSED|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|UND_ERR|aborted due to timeout|operation was aborted/i.test(msg)) return undefined;
  return [msg || String(err?.name ?? ""), code && !msg.includes(code) ? code : undefined].filter(Boolean).join(" ");
}

/** Another key of the account that runs the same model (Replicate for fal.ai, or the other way round), and would take it now. */
function otherKeyFor(account: string, p: CloudProvider, modelId: string | undefined): CloudProvider | undefined {
  const m = modelId ? getModel(modelId) : undefined;
  return m ? usableProviders(account).find((k) => k !== p && m.routes.some((r) => r.provider === k)) : undefined;
}

/**
 * The cloud version of a run on the account's GPU that one of its keys runs: a preset's first cloud route, or the same
 * Fuobe Original on the cloud engine. Null without a key that would take it (one the provider refused, or whose balance
 * ran out, isn't offered), or when the studio is open-source only.
 */
export function cloudTwin(req: Pick<GenerationRequest, "presetId" | "modelId">, account: string): { modelId: string; provider: CloudProvider; op?: string } | null {
  if (!paidAllowed()) return null;
  const keys = usableProviders(account);
  if (!keys.length) return null;
  const has = (id: string) => !!getModel(id);
  const preset = req.presetId ? getPreset(req.presetId) : undefined;
  const asked = getModel(req.modelId);
  const routes: { modelId: string; op?: string }[] = preset ? presetRoutes(preset as Parameters<typeof presetRoutes>[0], "cloud", has) : asked && dualEngine(asked) ? [{ modelId: asked.id }] : [];
  for (const { modelId: id, op } of routes) {
    const m = getModel(id);
    if (!m) continue;
    const cloud = dualEngine(m) ? onEngine(m, "cloud") : m;
    if (cloud.engine === "open") continue;
    const p = CLOUD_PROVIDERS.find((k) => keys.includes(k) && cloud.routes.some((r) => r.provider === k));
    // Another model: its operation there goes with it (the same model keeps the run's own).
    if (p) return { modelId: id, provider: p, ...(op && id !== req.modelId && { op }) };
  }
  return null;
}

/**
 * A GPU trouble's buttons, with "Run with your … key" when one of the account's keys runs this tool's cloud version: right
 * after the first (the one that fixes the GPU), so a tile that shows only a few keeps it. While hosted runs are on, only
 * with its price (a key is never billed by a press that showed none).
 */
function withKeyOffer(actions: TroubleAction[], account: string, req: Pick<GenerationRequest, "presetId" | "modelId" | "params" | "op">): TroubleAction[] {
  if (actions.some((a) => a.kind === "run-with-key")) return actions;
  const twin = cloudTwin(req, account);
  if (!twin) return actions;
  if (!hostedRunsOn()) return withOfferAfterFirst(actions, withKeyAction(twin.provider, twin.modelId, twin.op));
  const price = keyRunPrice(twin, req);
  return price ? withOfferAfterFirst(actions, withKeyAction(twin.provider, twin.modelId, twin.op, price)) : actions;
}

/** A run's price on its cloud version (one run, at the request's settings), as a key offer says it ("≈ $0.04"), or null. */
function keyRunPrice(twin: { modelId: string; op?: string }, req: Pick<GenerationRequest, "params" | "op">): string | null {
  const m = getModel(twin.modelId);
  if (!m) return null;
  try {
    const usd = estimateCost(dualEngine(m) ? onEngine(m, "cloud") : m, req.params ?? {}, 1, (twin.op ?? req.op) as Operation | undefined, false);
    return usd != null && usd > 0 ? `≈ ${formatCost(usd)}` : null;
  } catch {
    return null;
  }
}

/**
 * What an account's run ran into, as diagnose.ts reads it: its own GPU's words (comfyui.ts troubleError), or its key's
 * provider's status and words. Undefined for anything else (a request's own problem, already in plain words).
 */
function accountTrouble(e: unknown, account: string, providerId: string, stage: KeyStage, req?: Pick<GenerationRequest, "presetId" | "modelId" | "params" | "op">): Diagnosis | undefined {
  const own = (e as { trouble?: Diagnosis } | null)?.trouble;
  if (own) return providerId === "comfyui" && req && own.cause.startsWith("gpu-") ? { ...own, actions: withKeyOffer(own.actions, account, req) } : own;
  if (!isCloudProvider(providerId)) return undefined;
  const ctx = { provider: providerId, other: otherKeyFor(account, providerId, req?.modelId) };
  const message = String((e as Error | null)?.message ?? "");
  // No key to send (removed, or one this server can't open any more): its own words, and where to add one.
  if (message === addKeyMessage(providerId) || message === keyRemovedMessage(providerId)) {
    return { cause: "key-rejected", words: message, actions: [{ kind: "key-settings", label: "Add your key", target: "/settings#your-keys" }], retryable: false };
  }
  const status = (e as { status?: unknown } | null)?.status;
  // The provider's own words (provider-keys.ts accountKeyError keeps them, without the key) tell a refused key from a
  // model the key may not run.
  const said = (e as { said?: unknown } | null)?.said;
  // How long the provider asked to wait (a 429's Retry-After, kept by the adapter): the next try waits that long.
  const retryAfterS = (e as { retryAfterS?: unknown } | null)?.retryAfterS;
  if (typeof status === "number" && status > 0) return diagnoseKey({ stage, status, text: typeof said === "string" ? said : message, ...(typeof retryAfterS === "number" && retryAfterS > 0 && { retryAfterS }) }, ctx);
  const net = networkReason(e);
  if (net) return diagnoseKey({ stage, error: net }, ctx);
  // A step at the provider that failed in words of its own (a voice it couldn't clone): plain words already, its own in details.
  if (typeof said === "string" && said) return { cause: "provider-failed", words: message, details: cleanDetails(said, 200) || undefined, actions: [{ kind: "retry", label: "Retry" }], retryable: false };
  return undefined;
}

/** A short, stable name for the address a run was sent to (kept with the run, never the address itself). */
const addressKey = (url: string) => crypto.createHash("sha256").update(url.replace(/\/+$/, "")).digest("hex").slice(0, 16);

/** A run reached the account's GPU: the status strip and the next run take it as online (without asking it). */
function noteHandedOver(account: string, url: string): void {
  const known = cachedGpuState(account, url);
  if (known && !known.online) noteGpuState(account, url, true);
}

declare global {
  /** A look at an account's GPU on its way (one per account and address: runs that wait share it). */
  var __fuobeGpuLooks: Map<string, Promise<"online" | (Error & { trouble: Diagnosis })>> | undefined;
}

/**
 * A look at the account's GPU before a waiting run tries again: its /system_stats only (no files, outside the send line),
 * shared by the account's runs that wait. "online", or the run's error, in a run's words (what came back kept for the
 * details). The status strip learns the answer too.
 */
function probeGpu(account: string, link: { url: string; token?: string }): Promise<"online" | (Error & { trouble: Diagnosis })> {
  const probes = (globalThis.__fuobeGpuLooks ??= new Map());
  const key = `${account} ${link.url}`;
  const going = probes.get(key);
  if (going) return going;
  const place = { kind: "link" as const, url: link.url, hasToken: !!link.token };
  const p = testGpu(link, { timeoutMs: 8000, stage: "status" })
    .then(
      ({ url: _moved, ...info }) => {
        void _moved;
        noteGpuState(account, link.url, true, { info });
        return "online" as const;
      },
      (e: unknown) => {
        const f: GpuFailure = (e instanceof GpuError && e.failure) || { stage: "status", error: (e as Error).message };
        // The status strip keeps the check's words; the run says the same in a run's words.
        noteGpuState(account, link.url, false, { trouble: e instanceof GpuError && !e.failure ? e.trouble : diagnoseGpu(f, place) });
        return troubleError(e instanceof GpuError && !e.failure ? e.trouble : diagnoseGpu({ ...f, stage: "poll" }, place), f.status, f);
      },
    )
    .finally(() => probes.delete(key));
  probes.set(key, p);
  return p;
}

/** The account's GPU asked once more, before a run that couldn't reach it fails: "online", or why not (the run's words). */
async function recheckGpu(account: string, link: { url: string; token?: string }): Promise<"online" | Diagnosis> {
  const r = await probeGpu(account, link);
  return r === "online" ? "online" : r.trouble;
}

/** A run's GPU trouble as the status strip says it (in a check's words) when what came back is known; else as it is. */
function asStatus(error: unknown, trouble: Diagnosis, link: { url: string; token?: string }): Diagnosis {
  const f = (error as { failure?: GpuFailure } | null)?.failure;
  return f ? diagnoseGpu({ ...f, stage: "status" }, { kind: "link", url: link.url, hasToken: !!link.token }) : trouble;
}

/** The account's GPU isn't the one a run was planned for any more: another address or password, this computer, or none. */
function gpuChanged(account: string, was: AccountGpu | null): boolean {
  const now = accountGpu(account);
  if (!now || !was) return now !== was;
  if (now.mode === "computer" || was.mode === "computer") return now.mode !== was.mode;
  return now.url !== was.url || (now.token ?? "") !== (was.token ?? "");
}

/** A run planned again, as its account runs now (its GPU, its keys): when the GPU changed, or another instance takes it. */
function replan(id: string, account: string): ReturnType<typeof prepare> | null {
  const r = db().prepare("SELECT request_json FROM generations WHERE id = ?").get(id) as Pick<Row, "request_json"> | undefined;
  if (!r) return null;
  try {
    return asAccount(account, () => prepare(JSON.parse(r.request_json) as GenerationRequest));
  } catch {
    return null;
  }
}

declare global {
  /** Account runs whose polls keep failing: since when, how many in a row, and when to ask again (self-healing). */
  var __fuobePollHeals: Map<string, { first: number; n: number; next: number }> | undefined;
  /** Account runs already sent again once after their GPU restarted and lost them. */
  var __fuobeResent: Set<string> | undefined;
}
const pollHeals = () => (globalThis.__fuobePollHeals ??= new Map());
/** A run its GPU lost, sent again (diagnose.ts diagnoseGpuJob "lost"). */
const RESENT_WORDS = "Your GPU restarted, so we sent this run again";
const resentRuns = () => (globalThis.__fuobeResent ??= new Set());

/** What a poll can't wait out: a key refused, credit gone, no access; a GPU that wants a password or a sign-in. */
const FINAL_AT_POLL: ReadonlySet<string> = new Set(["key-rejected", "key-balance", "key-permission", "provider-stopped", "gpu-password", "gpu-password-wrong", "gpu-sign-in", "address-local"]);

/** How long an account's run's polls on its own GPU may keep failing before it stops (its key's provider: the run's own clock). */
const POLL_HEAL_MS = { comfyui: 15 * 60_000 };
/** The growing wait between an account's polls that keep failing. */
const POLL_BACKOFF = { budgetMs: 0, firstMs: 5_000, maxMs: 60_000 };
/** Polls that fail in a row before the tile says it is waiting. */
const POLL_MISSES_SAID = 3;
/** How long a made result's copy is tried again (a GPU or provider that dropped the connection for a while). */
const SAVE_HEAL_MS = 15 * 60_000;

/** Which of its batch's jobs a run is (its seed is the batch's + this): kept at hand-over, else read from its batch. */
function jobIndexOf(r: Pick<Row, "batch_id" | "created_at">, meta: PendingMeta): number {
  if (typeof meta.jobIndex === "number" && meta.jobIndex >= 0) return meta.jobIndex;
  if (!r.batch_id) return 0;
  // createGenerations stamps a batch's jobs created_at = now + i.
  const first = db().prepare("SELECT MIN(created_at) FROM generations WHERE batch_id = ?").pluck().get(r.batch_id) as number | null;
  const i = first === null ? 0 : r.created_at - first;
  return i >= 0 && i < 64 ? i : 0;
}

/**
 * A run its GPU lost (ComfyUI restarted): sent again once, planned as it was (inputs uploaded again), as the same job of
 * its batch (its own seed). False when it can't be (sent again before, or its plan doesn't go to the same place any more).
 */
function resend(r: Row, account: string, words: string): boolean {
  const was = readMeta(r.external_meta_json);
  if (resentRuns().has(r.id) || was.resent) return false;
  try {
    const stored = JSON.parse(r.request_json) as GenerationRequest;
    const p = asAccount(account, () => prepare(stored));
    if (p.providerId !== r.provider) return false;
    const index = jobIndexOf(r, was);
    resentRuns().add(r.id);
    if (resentRuns().size > 5000) resentRuns().delete(resentRuns().values().next().value!);
    // (Only while the run still goes and is still the job that was lost: one another app process saved, ended or sent
    // again meanwhile is left as it is.) It takes its turn to be sent in the same step: a run waiting to be sent again is
    // never sent by another app process too.
    const again = db().transaction((): boolean => {
      const meta = JSON.stringify({ resent: true, jobIndex: index, ...(was.declined && { declined: was.declined }) });
      if (!updateLive(r.id, { external_id: null, external_meta_json: meta, status: "queued", progress: null, message: words }, " AND external_id = @__ext", { __ext: r.external_id })) return false;
      db().prepare("DELETE FROM generation_runs WHERE id = ?").run(r.id);
      noteSubmitTurn(r.id);
      return true;
    })();
    // (Saved, ended or sent again by another app process meanwhile: nothing more to do here, and nothing to fail.)
    if (!again) return true;
    submitting().add(r.id);
    void submit(r.id, p.route, p.providerId, p.plan, p.req, index);
    return true;
  } catch {
    return false;
  }
}

/** The words an Ideogram 4 run made again after it declined shows while it works; undefined for any other run. */
function declinedWords(meta: PendingMeta | Record<string, unknown>): string | undefined {
  const d = (meta as PendingMeta).declined;
  if (d?.stage === "retry") return LEGACY_DECLINED.retryWords;
  if (d?.stage !== "fallback") return undefined;
  const m = d.model ?? LEGACY_DECLINED.model;
  return `Making it with ${getModel(m)?.name ?? m}`;
}

/**
 * Files a run returned that are none of its results (Ideogram 4's "blocked" card): held, so no account and no link
 * serves them (only the owner opens them), never in a Library or the account's space, and deleted with the run (its
 * generation_id stays).
 */
function keepForOwner(assetIds: readonly string[]): void {
  const hold = db().prepare("UPDATE assets SET held = 1, account_id = NULL, source = 'derived' WHERE id = ?");
  for (const id of assetIds) hold.run(id);
}

/**
 * What one of Auto's fallbacks is asked when it makes a run Ideogram 4 declined: the same words in plain text (a caption
 * given as the prompt becomes its words), the same pictures, aspect ratio, size and count, and the model's own settings.
 */
function declinedFallback(stored: GenerationRequest, modelId: string): GenerationRequest {
  const p = stored.params ?? {};
  return {
    ...stored,
    modelId,
    op: stored.inputs?.images?.length ? "edit" : "t2i",
    ...(stored.prompt && { prompt: captionWords(stored.prompt) }),
    params: {
      ...(p.aspectRatio && { aspectRatio: p.aspectRatio }),
      ...(p.resolution && { resolution: p.resolution }),
      ...(p.numOutputs && { numOutputs: p.numOutputs }),
    },
    negativePrompt: undefined,
  };
}

/**
 * An Ideogram 4 run whose every picture was its "blocked" card is made again in its place: the same run (its id, its
 * place, its turn in the line, its billing hold), as the same job of its batch, through the same submit as every run
 * (this install's workers, the owner's ComfyUI, an account's own GPU), never by Ideogram 4 again: Auto's fallbacks in
 * order (src/lib/auto-image.ts: Krea 2 Realism, FIBO 2 Dev, MOSS-Image), the next one switched on that goes where the run
 * went, each only when the one before fails (declinedFails). A run of Auto keeps Auto, its pick saying why
 * (`why: "declined"`); Ideogram 4 picked by name names the model that made it (its model and its request's notice).
 * None is a new press of Run: no limit counts it again, and no new row or hold is made. The run's tile says which model
 * makes it. False when none is left: the run fails as before. `later`: sent once the caller (a submit that failed) has
 * let go of the run.
 */
function declinedAgain(r: Row, declined: DeclinedMeta, later = false): boolean {
  try {
    const stored = JSON.parse(r.request_json) as GenerationRequest;
    const auto = stored.modelId === AUTO_IMAGE;
    const account = stored.account;
    // Planned where the run went: this install's GPUs (its stamp: place, class, hold), the account's own, or the owner's.
    const planned = (req: GenerationRequest) =>
      account && stored.place === "pool"
        ? runOnPool(account, () => withRunStamp(stampOf(stored), () => prepare(req)))
        : account
          ? asAccount(account, () => prepare(req))
          : prepare(req);
    let asked = stored;
    let model: string | undefined;
    let p: ReturnType<typeof prepare> | undefined;
    // A legacy "retry" stage has no model: it starts at the first fallback.
    for (let m = nextAutoFallback(declined.model); m && !p; m = nextAutoFallback(m)) {
      let ask: GenerationRequest = auto ? { ...declinedFallback(stored, m), modelId: AUTO_IMAGE, auto: { model: m, why: "declined" } } : declinedFallback(stored, m);
      let q: ReturnType<typeof prepare> | undefined;
      try {
        q = planned(ask);
      } catch {
        // A preset with no version for this model: its words as they were planned, without the preset.
        if (stored.presetId) {
          try {
            ask = { ...ask, presetId: undefined, presetOptions: undefined, signature: undefined, prompt: captionWords(planned(stored).plan.prompt) };
            q = planned(ask);
          } catch {
            // Switched off, or it can't make this run: the next one.
          }
        }
      }
      if (q && q.providerId === r.provider) [p, asked, model] = [q, ask, m];
    }
    if (!p || !model) return false;
    const go = p;
    const index = jobIndexOf(r, readMeta(r.external_meta_json));
    // The run as Ideogram 4's stays kept from the first fallback on (declinedFails puts it back).
    const was = declined.was ?? declinedRun(r);
    const now: DeclinedMeta = { ...declined, stage: "fallback", model, was };
    const notice = (JSON.parse(was.request_json) as GenerationRequest).notice;
    const fields: Partial<Row> = {
      external_id: null,
      external_meta_json: JSON.stringify({ jobIndex: index, declined: now }),
      // (Working, as it was: not a new run in line.)
      status: "running",
      progress: null,
      message: declinedWords({ declined: now }) ?? null,
      model_id: go.plan.model.id,
      engine: go.plan.model.engine,
      op: go.plan.op,
      kind: outputKind(go.plan.op, go.plan.model),
      prompt: go.plan.prompt,
      cost_usd: go.cost,
      // Auto's own line says what made it (autoLine); Ideogram 4 picked by name carries the notice.
      request_json: JSON.stringify(auto ? asked : { ...asked, notice: [notice, declinedNotice(go.plan.model.name)].filter(Boolean).join(" · ") }),
    };
    // (Only while the run still goes and is still the job that declined or failed: one another app process saved, ended or
    // sent again meanwhile is left as it is.) It takes its turn to be sent in the same step, and its finish turn goes.
    const again = db().transaction((): boolean => {
      if (!updateLive(r.id, fields, " AND external_id IS @__ext", { __ext: r.external_id })) return false;
      db().prepare("DELETE FROM generation_runs WHERE id = ?").run(r.id);
      noteSubmitTurn(r.id);
      return true;
    })();
    if (!again) return true;
    const send = () => {
      submitting().add(r.id);
      void submit(r.id, go.route, go.providerId, go.plan, go.req, index);
    };
    if (later) setImmediate(send);
    else send();
    return true;
  } catch {
    return false;
  }
}

/**
 * The model that made a run Ideogram 4 declined couldn't make it either. The run goes on to its next fallback
 * (declinedAgain) while there is one. Otherwise the run fails as Ideogram 4's (its model, request and words put back, so
 * Retry runs what was asked), saying what to try, whether its job failed or couldn't be sent. What the model said goes
 * to the log. Null: not such a run; else whether the run was failed here (false: it still went, or goes on).
 */
function declinedFails(id: string, said: string, metaJson?: string | null): boolean | null {
  const json = metaJson !== undefined ? metaJson : (db().prepare("SELECT external_meta_json FROM generations WHERE id = ?").pluck().get(id) as string | null | undefined);
  const was = readMeta(json).declined;
  if (was?.stage !== "fallback") return null;
  const tried = was.model ?? LEGACY_DECLINED.model;
  console.warn(`[generations] ${id}: ${getModel(tried)?.name ?? tried} after Ideogram 4 declined: ${said.slice(0, 500)}`);
  if (was.model && nextAutoFallback(was.model)) {
    const r = db().prepare("SELECT * FROM generations WHERE id = ?").get(id) as Row | undefined;
    if (r && (r.status === "queued" || r.status === "running") && declinedAgain(r, was, true)) return false;
  }
  return updateLive(id, { ...(was.was ?? {}), status: "failed", error: BLOCKED_CARD_MESSAGE, completed_at: Date.now(), message: null });
}

/**
 * An account's poll that failed: a key that won't work (refused, no credit, no access) fails the run at once; a passing
 * problem (its GPU off, its provider busy) is asked again with a growing wait, the tile saying so. A run on its own GPU
 * stops when that has lasted its budget (its GPU asked once more first); one on its key is never cut short here (the
 * job is accepted, and paid): the run's own clock in pollOne ends it. True when the poll was handled here.
 */
async function healPoll(r: Row, ctx: PollContext, account: string, pollError: unknown): Promise<boolean> {
  const stored = JSON.parse(r.request_json) as GenerationRequest;
  const d = accountTrouble(pollError, account, r.provider, "poll", stored);
  const cancel = () =>
    adapterFor(r.provider, account)
      .cancel?.(ctx)
      .catch(() => {});
  if (d && !d.retryable && FINAL_AT_POLL.has(d.cause)) {
    pollHeals().delete(r.id);
    if (failRun(r.id, pollError, d, account, factsOf(r, { stage: "poll" }))) await cancel();
    return true;
  }
  if (!d) return false;
  const now = Date.now();
  const h = pollHeals().get(r.id) ?? { first: now, n: 0, next: 0 };
  h.n++;
  // What the other side asked for (Retry-After) is kept to, up to twice the longest wait: a run's own clocks (its GPU's
  // budget below, a run's time in pollOne) are read at each poll, so a day-long Retry-After can't hold the run.
  const ask = Math.min(backoffMs(h.n, POLL_BACKOFF, d.retryAfterMs), POLL_BACKOFF.maxMs * 2) * SELF_HEAL.scale;
  // A run on its own GPU asks once more when its budget ends, whatever the wait said.
  const budgetLeft = r.provider === "comfyui" ? Math.max(0, h.first + POLL_HEAL_MS.comfyui * SELF_HEAL.scale - now) : Infinity;
  h.next = now + Math.min(ask, budgetLeft);
  pollHeals().set(r.id, h);
  if (h.n === 1) ownEvent(r.id, account, pollError, d, factsOf(r, { stage: "poll", attempt: 1 }), "waiting");
  if (r.provider === "comfyui" && now - h.first >= POLL_HEAL_MS.comfyui * SELF_HEAL.scale) {
    const link = gpuLink(accountGpu(account));
    // Its GPU asked once more: back, it is polled again at once (and collected, or found lost and sent again).
    if (link && (await recheckGpu(account, link)) === "online") {
      pollHeals().delete(r.id);
      return true;
    }
    pollHeals().delete(r.id);
    const minutes = Math.max(1, Math.round((now - h.first) / 60_000));
    const end = link ? diagnoseGpuJob({ kind: "gone", minutes }, { kind: "link", url: link.url }) : d;
    if (failRun(r.id, pollError, { ...end, actions: link ? withKeyOffer(end.actions, account, stored) : end.actions }, account, factsOf(r, { stage: "poll", attempt: h.n, waitedMs: now - h.first }))) await cancel();
    return true;
  }
  if (h.n >= POLL_MISSES_SAID) {
    const words = r.provider === "comfyui" ? "Your GPU stopped answering. Waiting for it to come back" : waitingWords(d, isCloudProvider(r.provider) ? r.provider : undefined);
    if (r.message !== words) updateLive(r.id, { message: words });
  }
  return true;
}

/**
 * A copy of a made result that broke off for a passing reason: the connection refused, reset or idle, or a 5xx, 429 or
 * 408 answer. Never the whole copy's time limit, nor a file over its size: trying again can't change those.
 */
function passingSave(e: unknown): boolean {
  if (e instanceof AccountFilesFull) return false;
  const msg = (e as Error | null)?.message ?? "";
  if (msg === ACCOUNT_MESSAGES.diskLow || /^The answer was over/.test(msg) || /took over \d+ s to answer/.test(msg)) return false;
  if (/^download (5\d\d|429|408)$/.test(msg)) return true;
  if (e instanceof RemoteFetchError) return /stopped answering|Timed out reaching|Couldn't reach/.test(msg);
  return !!networkReason(e);
}

/** Copy one result of an account's run, trying again once at once when the copy breaks off for a passing reason. */
async function persistWithRetry(o: RichOutput, id: string, linked: Record<string, unknown> | undefined): Promise<OutputFile> {
  for (let n = 1; ; n++) {
    try {
      return await persistOutput(o, id, { linked });
    } catch (e) {
      if (!passingSave(e) || n >= 2) throw e;
      await new Promise((r) => setTimeout(r, 2_000 * SELF_HEAL.scale));
    }
  }
}

/** Why an account's result couldn't be saved, in its words: too big, an expired link, or a GPU that stopped answering. */
function saveTrouble(e: unknown, provider: string): Diagnosis | undefined {
  const msg = (e as Error).message ?? "";
  if (msg === ACCOUNT_MESSAGES.diskLow) return undefined;
  // (An account's saved address is in scope for its runs on its keys too: only a run on its GPU was copied from there.)
  const link = provider === "comfyui" ? ownLink() : null;
  const over = /^The answer was over (.+)$/.exec(msg)?.[1];
  if (link) return diagnoseGpuJob({ kind: "save", ...(over && { over }) }, link);
  if (isCloudProvider(provider) && /^download (403|404|410)$/.test(msg)) return resultExpired();
  return undefined;
}

/**
 * Hand a run over to its provider once: its files, then the job. Throws what went wrong (submitNow decides whether to wait
 * and try again, or to fail the run).
 */
async function handOver(id: string, route: ModelRoute, providerId: ProviderId, plan: ReturnType<typeof planGeneration>, req: GenerationRequest, index: number, sent?: HandOverCache): Promise<void> {
  /** Why the run failed, once it has: its files still waiting to be sent are not sent. */
  let failed: { error: unknown } | undefined;
  /** Still this run's to hand over: queued or running, no job yet (a cancel, a failure or another instance stops it). */
  const going = () => {
    const s = statusOf(id);
    return s === "queued" || s === "running";
  };
  try {
    // An account's run on its own ComfyUI and keys only (asAccount): outside it, nothing is sent.
    const adapter = adapterFor(providerId, req.account);
    // An account's run on its own ComfyUI: every LoRA it adds must be there first (nothing is sent before this check).
    if (req.account && req.place !== "pool" && providerId === "comfyui") {
      const fix = await checkAccountLoras([...plan.loras, ...graphLoras(route.endpoint, plan.params.extra)], route.endpoint, route);
      if (fix) throw Object.assign(new Error(missingFilesMessage(fix)), { fix });
    }
    // An account's files go to its ComfyUI one at a time, a few across the server (account-send.ts). A file whose turn
    // comes after another input failed, or after a cancel, isn't read or sent.
    const gate = <T,>(fn: () => Promise<T>): Promise<T> => {
      if (!req.account) return fn();
      return accountSend(req.account, async () => {
        if (failed) throw failed.error;
        if (!going()) throw new Error("Stopped");
        try {
          return await fn();
        } catch (e) {
          failed ??= { error: e };
          throw e;
        }
      });
    };
    // An input an earlier try of this hand-over already sent is used as it was sent (its name or link at the provider):
    // a run that waits and tries again never sends a file twice.
    const upload = async (key: string, data: Buffer, contentType: string, name: string) => {
      const was = sent?.get(key);
      if (was) return was;
      const at = await adapter.prepareFile(data, contentType, name, route);
      sent?.set(key, at);
      return at;
    };
    const prep = async (ref?: string) => {
      if (!ref) return undefined;
      const was = sent?.get(`file:${ref}`);
      if (was) return was;
      return gate(async () => {
        const f = await readRef(ref);
        // A picture outside the limits its endpoint documents (Qwen Image 3 edit: 384-2048 px, 10 MB, PNG without alpha;
        // Recraft Crisp: PNG only) goes as a fitted copy, or is refused here before it is queued and paid for. Anything that
        // isn't a picture, and endpoints with no stated limits, pass through unchanged.
        const g = providerId === "mock" || plan.model.engine === "open" ? f : await fitStill(route.endpoint, f);
        return upload(`file:${ref}`, g.data, g.contentType, g.name);
      });
    };
    // An end-frame step crops the start frame before the edit (the recipe's crop of the subject).
    const cropWindow = isCropWindow(plan.params.extra?.crop) ? plan.params.extra.crop : undefined;
    const prepCropped = async (ref?: string) => {
      if (!ref || !cropWindow) return prep(ref);
      const was = sent?.get(`crop:${ref}`);
      if (was) return was;
      return gate(async () => {
        const f = await readRef(ref);
        const data = cropPicture(f.data, cropWindow);
        return upload(`crop:${ref}`, data, "image/png", f.name.replace(/\.[^.]+$/, ".png"));
      });
    };
    // The input clip's header (size, frame rate, length): upscalers that take a factor and frame-count routes read it.
    let source: Pick<GenInput, "sourceSize" | "sourceFps" | "sourceDuration"> = {};
    /** The input clip's file size (fal's H3 Max Turbo extend takes up to 50 MB: clipBytesProblem). */
    let sourceBytes: number | undefined;
    // A clip or voice in a container or of a size the endpoint documents it refuses (Kling O3 edit: .mp4/.mov up to 200 MB;
    // FLUX.3 edit: MP4 under 50 MB; OmniHuman 2: a WAV or MP3 voice up to 15 MB) is refused here, in Fuobe's words, before
    // it is uploaded and sent.
    const fileProblem = (kind: "video" | "audio", f: { contentType: string; data: Buffer }) =>
      providerId === "mock" || plan.model.engine === "open" ? null : clipFileProblem(plan.model, plan.op, kind, f.contentType, f.data.length);
    const prepVideo = async (ref?: string) => {
      if (!ref) return undefined;
      return gate(async () => {
        const f = await readRef(ref);
        const kind = fileProblem("video", f);
        if (kind) throw new Error(kind);
        const facts = mediaFacts(f.data);
        sourceBytes = f.data.length;
        source = {
          ...(facts.width && facts.height ? { sourceSize: { width: facts.width, height: facts.height } } : {}),
          ...(facts.fps ? { sourceFps: facts.fps } : {}),
          ...(facts.duration ? { sourceDuration: facts.duration } : {}),
        };
        return upload(`file:${ref}`, f.data, f.contentType, f.name);
      });
    };
    // A talking avatar is as long as its voice (fal's InfiniteTalk and Wan 2.2 S2V take a frame count): the voice's header.
    const prepVoice = async (ref?: string) => {
      if (!ref) return undefined;
      return gate(async () => {
        const f = await readRef(ref);
        const kind = fileProblem("audio", f);
        if (kind) throw new Error(kind);
        const facts = mediaFacts(f.data);
        if (facts.duration && !source.sourceDuration) source = { ...source, sourceDuration: facts.duration };
        return upload(`file:${ref}`, f.data, f.contentType, f.name);
      });
    };
    // A song tool's song (Mureka): its length read as a voice's is, and one Mureka refuses (Stems: MP3 or M4A, 10 MB; Remix:
    // 10 to 350 seconds; Extend and Remix of a song Mureka didn't make, which goes through its files/upload first: MP3 or M4A,
    // and 10 MB for Extend) refused here, before it's sent to Mureka or paid for. One of Mureka's own goes by its id.
    const songById = typeof plan.params.extra?.songId === "string" && plan.params.extra.songId.trim() !== "";
    const prepSong = async (ref?: string) => {
      if (!ref) return undefined;
      return gate(async () => {
        const f = await readRef(ref);
        const facts = mediaFacts(f.data);
        if (facts.duration && !source.sourceDuration) source = { ...source, sourceDuration: facts.duration };
        const problem = providerId === "mock" ? null : songToolProblem(plan.op, { format: songFormat(f.contentType, f.name), bytes: f.data.length, seconds: facts.duration }, songById);
        if (problem) throw new Error(problem);
        return upload(`file:${ref}`, f.data, f.contentType, f.name);
      });
    };
    // Reference clips and clip elements a model bills with the output (Kling 4.0, Pricing.clipInput): their headers' lengths.
    // By the clip's place in inputs.videos, so a clip element (params.elements' video) finds its own length.
    const clipLengths: (number | undefined)[] = [];
    const billsClips = !!plan.model.pricing?.clipInput;
    // Reference voices a model holds to a length (fal's Vidu Q4: 3 to 12 s each): one outside it is refused here, from its
    // header, before it's sent or paid for. A header that says no length goes as it is.
    const checksVoices = plan.op === "ref2v" && hasReferenceVoiceWindow(plan.model) && providerId !== "mock" && plan.model.engine !== "open";
    // Reference clips and sound a hosted route holds to a window (fal's MiniMax H3 and H3 Max Turbo: 2–15 s each, 15 s of each
    // kind together): their headers' lengths too, by their place in inputs.videos and inputs.audios.
    const refWindow = providerId !== "mock" && plan.model.engine !== "open" ? referenceSeconds(plan.model.id) : undefined;
    const audioLengths: (number | undefined)[] = [];
    const prepRefVoice = async (ref: string | undefined, i: number) => {
      if (!ref || !(checksVoices || refWindow?.kinds.includes("audios"))) return prep(ref);
      const was = sent?.get(`file:${ref}`);
      if (was) return was;
      return gate(async () => {
        const f = await readRef(ref);
        const seconds = mediaFacts(f.data).duration;
        if (seconds) audioLengths[i] = seconds;
        const problem = seconds && checksVoices ? referenceVoiceProblem(plan.model, seconds, i + 1) : null;
        if (problem) throw new Error(problem);
        return upload(`file:${ref}`, f.data, f.contentType, f.name);
      });
    };
    const prepClip = async (ref: string | undefined, i: number) => {
      if (!ref || !(billsClips || refWindow?.kinds.includes("videos"))) return prep(ref);
      return gate(async () => {
        const f = await readRef(ref);
        const facts = mediaFacts(f.data);
        if (facts.duration) clipLengths[i] = facts.duration;
        return upload(`file:${ref}`, f.data, f.contentType, f.name);
      });
    };
    const prepMask = async (ref?: string) => {
      if (!ref) return undefined;
      const was = sent?.get(`mask:${ref}`);
      if (was) return was;
      return gate(async () => {
        const f = await readRef(ref);
        const fmt = route.map?.maskFormat;
        const data = fmt && fmt !== "white" && f.contentType === "image/png" ? convertMask(f.data, fmt) : f.data;
        return upload(`mask:${ref}`, data, f.contentType, f.name);
      });
    };
    let prompt = plan.prompt;
    const captioned = plan.model.options.promptFormat === "ideogram4";
    // A layout's prompt is compiled boxes (plan.layout): the enhancer would rewrite them, so it never runs on one.
    const laidOut = !!plan.layout || carriesLayout(req.params?.extra);
    if (req.params?.enhancePrompt && prompt && !captioned && !laidOut) {
      update(id, { message: "Enhancing prompt" });
      const words = plan.soul?.words;
      const at = words ? prompt.indexOf(words) : -1;
      if (words && at >= 0) {
        // Soul: only the user's words are expanded (60–120 words of subject, wardrobe, place, light); the look stays as it is.
        const longer = await enhanceSoulWords(words).catch(() => words);
        prompt = prompt.slice(0, at) + longer + prompt.slice(at + words.length);
      } else prompt = await enhancePrompt(prompt, plan.model.kind, plan.op, { ownStyle: appliesOwnStyle(route) }).catch(() => prompt);
      update(id, { prompt });
    }
    // Ideogram 4 reads a JSON caption (src/lib/ideogram-caption.ts): one given as the prompt (a reused run) is kept, plain
    // words get one written. It becomes the run's prompt, as Enhance's rewrite does, so Reuse makes the same picture. A
    // layout's words are never rewritten by the helper: they get the fixed wrapper.
    if (captioned && prompt) {
      update(id, { message: "Writing the caption" });
      const words = prompt;
      prompt =
        parseCaption(words) ??
        (laidOut ? captionFromWords(words) : await ideogramCaption(words, computeDimensions(plan.params.aspectRatio, plan.params.resolution, {})).catch(() => captionFromWords(words)));
      update(id, { prompt });
    }
    // MiniMax H3 on your GPU reads its own layout (src/lib/h3-prompt.ts): the words (after any Enhance) go into it, with the
    // start (and end) frame's alignment line for the clip's length on H3's frame grid. It becomes the run's prompt, so Reuse
    // makes the same clip. An orbit keeps its words as they are: the Orbit LoRA reads its own caption style.
    const h3Op = plan.op === "t2v" || plan.op === "i2v" || plan.op === "flf2v" ? plan.op : undefined;
    const orbit = h3Op === "i2v" && plan.params.extra?.orbit === true;
    if (plan.model.options.promptFormat === "minimax-h3" && h3Op && prompt && !orbit) {
      const wrapped = h3Prompt(prompt, h3Op, h3Frames(plan.params.duration ?? plan.model.defaults?.duration ?? 5), plan.sound?.soundscape, plan.sound?.music);
      if (wrapped !== prompt) {
        prompt = wrapped;
        update(id, { prompt });
      }
    }
    // H3 with references (Pika H3 Flex Ref2VA): the studio's names (Image 1, Clip 1, Voice 1) become H3's tags (<Picture 1>,
    // <Video 1>, <Audio 1>) in the same layout, with no alignment line (src/lib/h3-references.ts).
    // Talk from a voice clip (avatar on H3): the portrait speaks the voice clip, with the words saying how.
    if (plan.model.options.promptFormat === "minimax-h3" && plan.op === "avatar" && !inH3Layout(prompt ?? "")) {
      const wrapped = h3Prompt(h3TalkPrompt(prompt ?? ""), "t2v", h3Frames(plan.params.duration ?? plan.model.defaults?.duration ?? 5), plan.sound?.soundscape ?? "Only the voice of <Audio 1>, clear and close.", plan.sound?.music);
      prompt = wrapped;
      update(id, { prompt });
    } else if (plan.model.options.promptFormat === "minimax-h3" && plan.op === "ref2v" && prompt) {
      const wrapped = h3Prompt(h3ReferenceTags(prompt), "t2v", h3Frames(plan.params.duration ?? plan.model.defaults?.duration ?? 5), plan.sound?.soundscape, plan.sound?.music);
      if (wrapped !== prompt) {
        prompt = wrapped;
        update(id, { prompt });
      }
    }
    // Kandinsky 6.0 (both engines) reads spoken lines and the sound in tags of its own (src/lib/kandinsky-prompt.ts): quoted
    // words and a "Sound:" line become them for this run; the run keeps the words as typed, so Reuse shows them.
    if (plan.model.options.promptFormat === "kandinsky6" && prompt) prompt = kandinskyPrompt(prompt);
    const input: GenInput = {
      ...plan.params,
      // The clip's size is only ever its header's (below): a size the request states (params.sourceSize) prices the run
      // before it starts, never what an upscaler's factor is made from.
      sourceSize: undefined,
      prompt,
      negativePrompt: req.negativePrompt,
      images: (await Promise.all((req.inputs?.images ?? []).map((ref, i) => (i === 0 ? prepCropped(ref) : prep(ref))))).filter(Boolean) as string[],
      endImage: await prep(req.inputs?.endImage),
      mask: await prepMask(req.inputs?.mask),
      video: await prepVideo(req.inputs?.video),
      audio: await (plan.op === "avatar" ? prepVoice : SONG_TOOL_OPS.has(plan.op) ? prepSong : prep)(req.inputs?.audio),
      audio2: await prep(req.inputs?.audio2),
      voiceAudio: await prep(req.inputs?.voiceAudio),
      voiceAudio2: await prep(req.inputs?.voiceAudio2),
      videos: (await Promise.all((req.inputs?.videos ?? []).map((ref, i) => prepClip(ref, i)))).filter(Boolean) as string[],
      audios: (await Promise.all((req.inputs?.audios ?? []).map((ref, i) => prepRefVoice(ref, i)))).filter(Boolean) as string[],
      model3d: await prep(req.inputs?.model3d),
      loras: plan.loras,
      // Vary seeds across a batch so N jobs don't return N identical results.
      seed: plan.params.seed !== undefined && plan.params.seed >= 0 ? plan.params.seed + index : undefined,
    };
    // A saved voice (Design a voice; src/server/voices.ts): what its clip says makes a closer clone, and a cloud route that
    // speaks with an embedding gets the one fal made from it before, so the clip isn't cloned again.
    const savedVoice = req.account ? null : savedVoiceFor(req.inputs?.voiceAudio);
    if (savedVoice) {
      if (!input.voiceTranscript?.trim() && savedVoice.voice.transcript) input.voiceTranscript = savedVoice.voice.transcript;
      if (route.map?.voiceEmbedding && savedVoice.voice.embedding) input.voiceEmbedding = await prep(savedVoice.voice.embedding);
    }
    // What the caller said about the clip's length wins; the header fills the rest.
    Object.assign(input, { ...source, ...(plan.params.sourceDuration !== undefined && { sourceDuration: plan.params.sourceDuration }) });
    // Extending a song (Mureka): the new part starts at its end (or, before its start, at 0) unless the run says where.
    if (plan.op === "song-extend" && input.startTime === undefined) {
      const head = input.extra?.extend_type === "head";
      if (!head && !(input.sourceDuration && input.sourceDuration > 0)) throw new Error("The song's length couldn't be read: add it again as an MP3 or M4A file");
      input.startTime = head ? 0 : input.sourceDuration;
    }
    // A talking avatar renders as long as its voice: priced for it once its header is read (an API call that didn't say).
    if (plan.op === "avatar" && plan.params.sourceDuration === undefined && input.sourceDuration && providerId !== "mock" && plan.model.engine !== "open") {
      update(id, { cost_usd: estimateCost(plan.model, { ...plan.params, sourceDuration: input.sourceDuration }, 1, plan.op, plan.loras.length > 0 && !!route.loraEndpoint) });
    }
    // A clip edit of a clip sent as it is (Edit video, an API call; the studios that cut clips keep to the windows
    // themselves): one outside the model's window is refused before it's paid for (Happy Horse bills 60 s and returns
    // 15; fal's Wan 2.2 Fun VACE takes at most 241 frames), and one that keeps the clip's length is priced for it once
    // the header is read (a call that didn't say). A route billed by frames is priced on the header's rate as well.
    if (plan.op === "v2v" && input.sourceDuration && !req.chain?.length && req.params?.duration === undefined && providerId !== "mock" && plan.model.engine !== "open") {
      const problem = clipWindowProblem(plan.model, input.sourceDuration, input.sourceFps) ?? (input.sourceSize ? clipSizeProblem(plan.model, input.sourceSize.width, input.sourceSize.height) : null);
      if (problem) throw new Error(problem);
      const byFrames = !!sourceFrames(plan.model.id, plan.model.engine) && source.sourceFps !== undefined && source.sourceFps !== plan.params.sourceFps;
      if ((plan.params.sourceDuration === undefined || byFrames) && clipEditSeconds(plan.model, input, plan.op) !== undefined) {
        update(id, { cost_usd: estimateCost(plan.model, { ...plan.params, sourceDuration: input.sourceDuration, sourceFps: input.sourceFps }, 1, plan.op, plan.loras.length > 0 && !!route.loraEndpoint) });
      }
    }
    // A clip relit, extended or given a new moment, or a voice made into a talking video, held to the hosted model's window once
    // its header is read (fal's H3 Max relight: up to 15 s; insert and Turbo extend: up to 60 s; lip sync: 5 s to 15 min).
    if (input.sourceDuration && !req.chain?.length && providerId !== "mock" && plan.model.engine !== "open") {
      const problem =
        plan.op === "avatar"
          ? voiceWindowProblem(plan.model, input.sourceDuration, input.resolution)
          : plan.op === "relight-video" || plan.op === "extend" || plan.op === "reframe" || plan.op === "remove-object" || plan.op === "motion-transfer"
            ? (clipWindowProblem(plan.model, input.sourceDuration, input.sourceFps) ??
              (input.sourceSize ? clipSizeProblem(plan.model, input.sourceSize.width, input.sourceSize.height) : null) ??
              clipBytesProblem(plan.model, sourceBytes))
            : plan.op === "insert-moment"
              ? (clipWindowProblem(plan.model, input.sourceDuration, input.sourceFps) ?? insertRangeProblem(input.startTime, input.endTime, input.sourceDuration))
              : null;
      if (problem) throw new Error(problem);
      // A relight is billed on the clip's length: priced for it once the header is read (an API call that didn't say).
      if (plan.op === "relight-video" && plan.params.sourceDuration === undefined) update(id, { cost_usd: estimateCost(plan.model, { ...plan.params, sourceDuration: input.sourceDuration }, 1, plan.op) });
    }
    // Reference clips and sound outside the hosted route's window (fal's H3 and H3 Max Turbo: 2–15 s each, 15 s of each kind
    // together) are refused once their headers are read, before the run is paid for.
    if (refWindow) {
      const problem =
        referenceClipsProblem(plan.model, "videos", clipLengths.slice(0, req.inputs?.videos?.length ?? 0)) ??
        referenceClipsProblem(plan.model, "audios", audioLengths.slice(0, req.inputs?.audios?.length ?? 0));
      if (problem) throw new Error(problem);
    }
    const edits = plan.op === "v2v" || plan.op === "video-swap" || plan.op === "video-insert";
    // An edit whose route sends no length keeps the clip's own (Kling 4.0's edit, swap and insert), whatever the request
    // said: the clip is held to the model's window, sides, shape and frame rate before it's paid for. Frame-billed routes
    // (fal's Wan 2.2 Fun VACE) keep the rule above: their studios cut the pieces and say the length.
    if (edits && !route.map?.duration && !req.chain?.length && providerId !== "mock" && plan.model.engine !== "open" && !sourceFrames(plan.model.id, plan.model.engine)) {
      const problem =
        (input.sourceDuration ? clipWindowProblem(plan.model, input.sourceDuration, input.sourceFps) : null) ??
        (input.sourceSize ? clipSizeProblem(plan.model, input.sourceSize.width, input.sourceSize.height) : null) ??
        (input.sourceFps ? clipFpsProblem(plan.model, input.sourceFps) : null);
      if (problem) throw new Error(problem);
    }
    // Reference clips (and clip elements) billed with the output: refused past the most the model takes in all (with the
    // clip edited), or a clip element outside its own window, before it's paid for, and priced on their seconds once read
    // (the plan priced the least they bill). An edit of a clip whose length the caller didn't say is priced on it (in and
    // out) once its header is read.
    const read = clipLengths.filter((n): n is number => n !== undefined);
    const unpricedEdit = edits && !!input.sourceDuration && plan.params.sourceDuration === undefined;
    if (billsClips && (read.length || unpricedEdit) && providerId !== "mock" && plan.model.engine !== "open") {
      for (const g of plan.params.elements ?? []) {
        const seconds = g.video !== undefined ? clipLengths[g.video] : undefined;
        const problem = seconds !== undefined ? elementClipProblem(plan.model, seconds) : null;
        if (problem) throw new Error(problem);
      }
      const seconds = read.reduce((a, b) => a + b, 0);
      const problem = clipTotalProblem(plan.model, (edits ? (input.sourceDuration ?? 0) : 0) + seconds);
      if (problem) throw new Error(problem);
      if (read.length) input.clipSeconds = seconds;
      const priced = { ...plan.params, ...(input.sourceDuration !== undefined && { sourceDuration: input.sourceDuration }), ...(read.length && { clipSeconds: seconds }) };
      update(id, { cost_usd: estimateCost(plan.model, priced, 1, plan.op) });
    }
    // An upscale that wouldn't enlarge the clip (a 1080p clip at a default 1080p; a 4K clip would even shrink):
    // a tier the model only defaulted to moves up to the next one it offers, one the caller picked is refused.
    // A clip longer than the model takes (Kandinsky VSR: about 5 s) is refused, never cut short; one billed per output frame is
    // priced again on its size and length.
    if (plan.op === "upscale-video") {
      const long = sourceLengthProblem(plan.model, input.sourceDuration);
      if (long) throw new Error(long);
      if (plan.model.pricing?.outputFrames && input.sourceSize && providerId !== "mock" && plan.model.engine !== "open") {
        update(id, { cost_usd: estimateCost(plan.model, { ...plan.params, sourceSize: input.sourceSize, sourceDuration: input.sourceDuration }, 1, plan.op) });
      }
    }
    if (plan.op === "upscale-video" && input.sourceSize) {
      const tier = upscaleTier(input.resolution, plan.model.options.resolutions, input.sourceSize, req.params?.resolution !== undefined);
      if ("error" in tier) throw new Error(tier.error);
      if (tier.resolution !== input.resolution) {
        input.resolution = tier.resolution;
        if (providerId !== "mock" && plan.model.engine !== "open") update(id, { cost_usd: estimateCost(plan.model, { ...plan.params, resolution: tier.resolution }, 1, plan.op) });
      }
      const sides = sideMultipleProblem(plan.model.name, plan.model.options.sideMultiple, plan.model.options.resolutions, input.resolution, input.sourceSize);
      if (sides) throw new Error(sides);
    }
    // LoRA files: ComfyUI gets the ones it lacks downloaded into its loras folder; a cloud run gets a civitai
    // file mirrored once to the provider's storage (the civitai key never leaves this server).
    if (input.loras?.length && (providerId === "fal" || providerId === "replicate")) {
      input.loras = await prepareCloudLoras(input.loras, providerId, (data, name) => adapter.prepareFile(data, "application/octet-stream", name, route), (message) => update(id, { message }));
    } else if (providerId === "comfyui" && !req.account && !computerScope() && (input.loras?.length || graphLoras(route.endpoint, input.extra).length)) {
      // (Not for an account's own ComfyUI, nor one on the owner's computer: the download writes to the install's LoRA folder.)
      // A graph that loads its own LoRAs (Genjutsu's Character swap: the Turbo and swap LoRAs; Restore & colourise: the
      // gated Restore or Detail Refine IC-LoRA) gets them downloaded too.
      await ensureLorasOnComfy([...(input.loras ?? []), ...graphLoras(route.endpoint, input.extra)], await comfyLoraFiles(route), (message) => update(id, { message }));
    }
    // A voice an earlier try had the provider clone (a billed step) is used again, not cloned twice.
    const cloned = sent?.get("voiceEmbedding");
    if (cloned && route.map?.cloneFirst && !input.voiceEmbedding) input.voiceEmbedding = cloned;
    // Nothing is sent once the run stopped being this one's to send (cancelled, failed, or taken by another instance).
    if (!going()) throw new Error("Stopped");
    // (Every account's step on its first try: on its own GPU or key, and on this install's GPUs. On the workers its job is
    // a task of this database, made by this send: the mark says so.)
    markSending(id, !!req.account, providerId === "comfyui" && onPoolWorkers());
    const res = await adapter.submit({ generationId: id, model: plan.model, route, input });
    // A talking video as long as its voice: the time its render may take (runningLimitMs).
    const runLimitMs = plan.op === "avatar" && isCloudProvider(providerId) && input.sourceDuration ? Math.round(input.sourceDuration * LONG_RENDER_MS_PER_SECOND) : 0;
    // A saved voice the cloud just cloned keeps the embedding (the owner's runs only), so its next line skips the clone.
    if (typeof res.meta?.voiceEmbedding === "string" && !req.account) void keepVoiceEmbedding(req.inputs?.voiceAudio, res.meta.voiceEmbedding).catch(() => {});
    const now = Date.now();
    // An account's link: which address the job went to (its name, never the address), so a run whose account moved to
    // another address meanwhile says so instead of asking the new one about it.
    const sentTo = req.account && req.place !== "pool" && providerId === "comfyui" ? ownLink()?.url : undefined;
    const before = readMeta((db().prepare("SELECT external_meta_json FROM generations WHERE id = ?").get(id) as Pick<Row, "external_meta_json"> | undefined)?.external_meta_json);
    // Only onto a run still waiting for its job (never one cancelled, failed or handed over by another instance meanwhile).
    const handed = db().transaction(() => {
      const changed = db()
        .prepare(
          `UPDATE generations SET external_id = @external_id, external_meta_json = @meta, provider_input_json = @payload, message = @message, updated_at = @now
           WHERE id = @id AND ${PENDING}`,
        )
        .run({
          id,
          now,
          external_id: res.externalId,
          meta: JSON.stringify({
            ...(res.meta ?? {}),
            ...(sentTo && { sentTo: addressKey(sentTo) }),
            jobIndex: index,
            ...(before.resent && { resent: true }),
            ...(before.declined && { declined: before.declined }),
            ...(runLimitMs > 0 && { runLimitMs }),
          }),
          payload: res.payload ? JSON.stringify(res.payload).slice(0, 200_000) : null,
          // A run sent again after its GPU lost it says so until its GPU reports on it; an Ideogram 4 run made again after
          // it declined says that while it works.
          message: declinedWords(before) ?? (before.resent || resentRuns().has(id) ? RESENT_WORDS : "Queued"),
        }).changes;
      if (changed) recordSubmission(id, now);
      return changed > 0;
    })();
    if (!handed) {
      // Cancelled, failed or deleted while it was being handed over (or another instance sent it): its job stops too.
      await adapter.cancel?.({ externalId: res.externalId, meta: res.meta ?? {}, route, model: plan.model, createdAt: now }).catch(() => {});
      // A cancelled row keeps the job's id (as before), so what was stopped can be found.
      db()
        .prepare("UPDATE generations SET external_id = ?, external_meta_json = ?, message = NULL, updated_at = ? WHERE id = ? AND status = 'canceled' AND external_id IS NULL")
        .run(res.externalId, JSON.stringify(res.meta ?? {}), now, id);
      return;
    }
    // The provider took a run on the account's key: a refusal or an empty balance noted before is over.
    if (req.account && req.place !== "pool" && isCloudProvider(providerId)) markKeyGood(req.account, providerId);
  } catch (e) {
    failed ??= { error: e };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Polling loop

const POLL_MS = 1500;
/** Jobs about to finish (progress ≥ 0.9) are polled this often, so results land sooner. */
const FAST_POLL_MS = 500;
/**
 * How long a job may run once its provider has started it… (A job on this install's own GPUs: its lane's run ceiling,
 * which the owner sets, 45 minutes by default: runningLimitMs.)
 */
const TIMEOUT_MS = 45 * 60 * 1000;
/** …except on the WorldCast worker (N7-9): 50 steps at CFG 5 on a 14B model, tens of minutes a clip (its time is unpublished). */
const WORLDCAST_TIMEOUT_MS = 3 * 60 * 60 * 1000;
/** …and how long it may wait in the provider's queue first (a busy local GPU works through jobs one by one). */
const QUEUE_TIMEOUT_MS = 4 * 60 * 60 * 1000;
/**
 * A cloud talking video renders as long as its voice (fal's H3 Max lip sync: 5 s to 15 min, made in windows), and a cancel of a
 * job in progress only signals fal's runner ("the request can still complete", and is billed): such a job may run this long
 * for each second of its voice (meta.runLimitMs), never less than TIMEOUT_MS. A starting value, to be set from a live run's
 * timings.
 */
const LONG_RENDER_MS_PER_SECOND = 10_000;
/**
 * A row this old with no external id whose turn no app process that still runs holds (takeSubmitTurn) was cut off by a
 * restart: a wait goes on, a hand-over fails. Tests make it shorter.
 */
export const STALE_SUBMIT = { ms: 2 * 60 * 1000 };

interface RunnerState {
  timer: NodeJS.Timeout;
  busy: boolean;
  tick: () => Promise<void>;
  fastTimer?: NodeJS.Timeout;
  fastBusy?: boolean;
  fast?: () => Promise<void>;
  /** Rows being polled right now (the fast lane and the tick never poll one row twice at once). */
  polling?: Set<string>;
}

declare global {
  var __fuobeRunner: RunnerState | undefined;
}

/**
 * Run `fn` as the owner's background work: outside a skill check's demo scope and any account's run (its tenant, its ComfyUI, the open-engine settings
 * it runs with). Timers started inside inherit where they were started, so the runner, often first started by a run, is
 * started this way: every tick then polls each row in that row's own context.
 */
export function outsideRuns<T>(fn: () => T): T {
  return outsideDemo(() => outsideTenant(() => outsideOwnGpu(() => withoutCandidates(fn))));
}

/**
 * Start the background runner (once per process; started at boot by src/instrumentation.ts).
 * Also installs the live-update hooks and primes the reachability probes routing reads.
 */
export function ensureRunner(): void {
  outsideRuns(startRunner);
}

function startRunner(): void {
  watchGenerations(db());
  keepBeating();
  const cur = globalThis.__fuobeRunner;
  if (cur) {
    // After a dev hot-reload, point the existing timers at this module's (fresh) code.
    cur.tick = tick;
    cur.fast = fastTick;
    cur.polling ??= new Set();
    if (!cur.fastTimer) {
      cur.fastTimer = setInterval(() => void globalThis.__fuobeRunner?.fast?.(), FAST_POLL_MS);
      cur.fastTimer.unref?.();
    }
    return;
  }
  const state: RunnerState = {
    busy: false,
    tick,
    fast: fastTick,
    polling: new Set(),
    timer: setInterval(() => void globalThis.__fuobeRunner?.tick(), POLL_MS),
    fastTimer: setInterval(() => void globalThis.__fuobeRunner?.fast?.(), FAST_POLL_MS),
  };
  state.timer.unref?.();
  state.fastTimer?.unref?.();
  globalThis.__fuobeRunner = state;
  void probeComfy().catch(() => false);
  void probeLocal().catch(() => false);
  sweepInterrupted();
  resumeTurntables();
}

/**
 * Runs with no job yet that no app process that still runs is handing over (takeSubmitTurn: its process stopped, by a
 * restart, or a deploy's old instance gone). One waiting for its own GPU or key goes on here, with what is left of its
 * wait (one process takes it); so does one on this install's workers whose job was never made (sendAgainOnWorkers). One
 * cut off in the middle of its hand-over can't be recovered, and fails. A run a process that still runs is sending or
 * waiting on (this one, or another in a deploy's overlap) is left to it, and so is a run made to wait to enter the line
 * (pool-holds.ts). Runs at start and every tick; not while this
 * server stops (the app process that goes on looks).
 */
function sweepInterrupted(): void {
  if (draining()) return;
  const now = Date.now();
  const rows = db()
    .prepare(
      `SELECT g.id, g.provider, g.model_id, g.op, g.request_json, g.external_meta_json, g.batch_id, g.created_at FROM generations g
         WHERE g.status IN ('queued','running') AND g.external_id IS NULL AND g.depends_on IS NULL AND g.created_at < @before AND NOT ${TURN_HELD("g", false)}
         AND ${NOT_HELD("g")}`,
    )
    .all({ before: now - STALE_SUBMIT.ms, __me: runnerToken(), __quiet: now - QUIET_MS, __now: now }) as Pick<
    Row,
    "id" | "provider" | "model_id" | "op" | "request_json" | "external_meta_json" | "batch_id" | "created_at"
  >[];
  const busy = submitting();
  for (const r of rows) {
    if (busy.has(r.id)) continue;
    let meta = readMeta(r.external_meta_json);
    if (meta.heal) {
      if (takeOver(r, meta.heal)) continue;
      // (As it is now: the process it was taken from may have marked it as being sent since this look.)
      meta = readMeta(db().prepare("SELECT external_meta_json FROM generations WHERE id = ?").pluck().get(r.id) as string | null);
    } else if (sendAgainOnWorkers(r)) continue;
    // A run that waited and was cut off in the middle of its send may have reached its GPU or provider: never sent twice.
    const cutOff = !!meta.heal && typeof meta.heal.sending === "number";
    const words = cutOff ? CUT_OFF_SENDING : "This run stopped before it started. Press Retry.";
    // (Not one a process that still runs took meanwhile.)
    if (updateLive(r.id, { status: "failed", error: words, completed_at: Date.now(), message: null }, ` AND external_id IS NULL AND NOT ${TURN_HELD("generations", false)}`)) {
      ownFailed(r.id, ownAccountIn(r.request_json), factsOf(r, { stage: "submit" }), cutOff ? "interrupted-sending" : "interrupted");
      // On this install's GPUs, a job the cut-off send made stops with it (it would run for nothing).
      if (poolOf(r)) stopJobsOf(r.id);
    }
  }
}

/** A waiting run whose app process was cut off while it sent the job (its GPU or provider may have it): not sent again. */
const CUT_OFF_SENDING = "This run was interrupted while it was being sent. Press Retry.";

/**
 * A run on this install's workers whose hand-over was cut off before its job was made (a restart or a deploy while its
 * inputs were being made ready): its job would be a task of this database, and there is none, so nothing reached a
 * worker. It is taken by this process (one process takes it) and sent now as it was decided (its stamp: its place in
 * line, its class, its hold), as the same job of its batch, instead of failing. Its job waits from the time the run was
 * made (pool.ts runPlaceOf), so it keeps its place. False: not one of those, and it fails as before (one on the install's
 * own ComfyUI may be in that ComfyUI's queue already; one whose job was made may run, and stops with it).
 */
function sendAgainOnWorkers(r: Pick<Row, "id" | "provider" | "request_json" | "external_meta_json" | "batch_id" | "created_at">): boolean {
  if (r.provider !== "comfyui" || !poolOnWorkers() || hasJobFor(r.id)) return false;
  let stored: GenerationRequest;
  try {
    stored = JSON.parse(r.request_json) as GenerationRequest;
  } catch {
    return false;
  }
  const account = stored.account;
  if (!account || stored.place !== "pool") return false;
  // Another app process took it first.
  if (!takeSubmitTurn(r.id)) return true;
  try {
    // Looked at again under the turn: a job the process that held it made meanwhile (it stalled rather than stopped).
    if (hasJobFor(r.id)) throw new LetGo("Its job was made");
    const p = runOnPool(account, () => withRunStamp(stampOf(stored), () => prepare(stored)));
    if (p.providerId !== r.provider) throw new LetGo("Planned elsewhere now");
    submitting().add(r.id);
    void submit(r.id, p.route, p.providerId, p.plan, p.req, jobIndexOf(r, readMeta(r.external_meta_json)));
    return true;
  } catch {
    // It fails as before (the sweep's look, once this process has given its turn back).
    handOverEnds(r.id);
    return false;
  }
}

/**
 * A waiting run whose turn no app process that still runs holds: taken by this one, planned again as its account runs now
 * (its GPU, its keys), and its wait goes on where it was (its budget and its tries kept). False: it isn't one this can
 * take (one cut off in the middle of its send among them: it fails, rather than being sent twice).
 */
function takeOver(r: Pick<Row, "id" | "provider" | "model_id" | "op" | "request_json">, h: HealState): boolean {
  if (typeof h.sending === "number") return false;
  let stored: GenerationRequest;
  try {
    stored = JSON.parse(r.request_json) as GenerationRequest;
  } catch {
    return false;
  }
  const account = stored.account;
  if (!account || stored.place === "pool") return false;
  // Another app process took it first.
  if (!takeSubmitTurn(r.id)) return true;
  // Read again under the turn: the process that held it may have marked it as being sent after the sweep's look, before
  // it went quiet (markSending marks only under its turn). Then it may have reached its GPU or provider: never sent twice.
  const now = readMeta(db().prepare("SELECT external_meta_json FROM generations WHERE id = ?").pluck().get(r.id) as string | null).heal;
  if (!now || typeof now.sending === "number") {
    handOverEnds(r.id);
    return false;
  }
  h = now;
  let p: ReturnType<typeof prepare>;
  try {
    p = asAccount(account, () => prepare(stored));
  } catch (e) {
    // It can't run as the account runs now (its key removed, its model switched off): said in its own words.
    const refusal = e instanceof AccountRunError ? e.refusal.error : (e as Error).message;
    if (updateLive(r.id, { status: "failed", error: refusal, completed_at: Date.now(), message: null }, " AND external_id IS NULL")) {
      ownFailed(r.id, account, factsOf(r, { stage: "submit" }), e instanceof AccountRunError ? e.refusal.code : "refused");
    }
    handOverEnds(r.id);
    return true;
  }
  // Planned for another provider now (its GPU disconnected, another key): its polls would ask the provider it was made
  // for, so it stops, as a run whose GPU changed while it waited does.
  if (p.providerId !== r.provider) {
    stopReplanned(r.id, r.provider, account, p, "submit");
    handOverEnds(r.id);
    return true;
  }
  submitting().add(r.id);
  void submit(r.id, p.route, p.providerId, p.plan, p.req, typeof h.index === "number" ? h.index : 0, h);
  return true;
}

/**
 * A run that waited for its own GPU or key, planned again after a restart or a deploy (takeOver, or advanceDependents for
 * a step of a longer run), that would now go to another provider than the one it waited for: it stops in plain words and
 * is never sent there, since nobody pressed Run there. `was`: the provider it was made for.
 */
function stopReplanned(id: string, was: string, account: string, p: { plan: { model: { id: string }; op: string } }, stage: "submit" | "chain"): void {
  const facts: RunFacts = { provider: was, model: p.plan.model.id, op: p.plan.op, stage };
  if (was === "comfyui") {
    const gpu = accountGpu(account);
    const end = diagnoseGpuJob({ kind: gpu ? "moved" : "disconnected" }, { kind: "link", url: gpuLink(gpu)?.url ?? "" });
    failRun(id, new Error("moved"), end, account, facts);
  } else if (updateLive(id, { status: "failed", error: "This run stopped because your keys changed while it waited. Press Retry.", completed_at: Date.now(), message: null }, " AND external_id IS NULL")) {
    ownFailed(id, account, facts, "keys-changed");
  }
}

/**
 * Hosted runs were switched off while runs waited to enter the line: nothing will release them, so they end as a run cut
 * off before it started does (the sweep's words), and their holds go. What the billing service set aside for them goes
 * back (each ended row's report closes its hold; a run whose reserve was never answered is released by its request id).
 */
function endHeldRuns(): void {
  const rows = db()
    .prepare(`SELECT g.id FROM generations g WHERE g.status = 'queued' AND g.external_id IS NULL AND ${HELD("g")}`)
    .all() as { id: string }[];
  for (const r of rows) updateLive(r.id, { status: "failed", error: "This run stopped before it started. Press Retry.", completed_at: Date.now(), message: null });
  dropGone();
}

/**
 * Send a row of a run that waited to enter the line (pool-release.ts): planned again from its stored request, as its
 * run's place and stamp say, as job `job` of its run, taking its place at `rankAt` (its press) or now. False when it
 * doesn't wait to be sent any more (stopped meanwhile), or its plan can't be made (it fails in its words then).
 */
export function sendHeld(id: string, job: number, rankAt?: number): boolean {
  const r = db().prepare("SELECT * FROM generations WHERE id = ?").get(id) as Row | undefined;
  if (!r || r.status !== "queued" || r.external_id) return false;
  let stored: GenerationRequest;
  try {
    stored = JSON.parse(r.request_json) as GenerationRequest;
  } catch {
    return false;
  }
  const account = stored.account;
  if (!account || stored.place !== "pool") return false;
  let p: ReturnType<typeof prepare>;
  try {
    p = runOnPool(account, () => withRunStamp(stampOf(stored), () => prepare(stored)));
  } catch (e) {
    updateLive(id, { status: "failed", error: (e as Error).message, completed_at: Date.now(), message: null });
    return false;
  }
  submitting().add(id);
  // (Its place: its press, or now, at the back; never the time its row was made, which pool.ts runPlaceOf gives a run.)
  void submit(id, p.route, p.providerId, p.plan, p.req, job, undefined, rankAt ?? Date.now());
  return true;
}

/** End the rows of a run that waited to enter the line, in words (a service refused it once it answered). */
export function failWaiting(ids: string[], error: string): void {
  for (const id of ids) {
    const r = db().prepare("SELECT status, external_id FROM generations WHERE id = ?").get(id) as Pick<Row, "status" | "external_id"> | undefined;
    if (r?.status === "queued" && !r.external_id) updateLive(id, { status: "failed", error, completed_at: Date.now(), message: null });
  }
}

/**
 * Add to the stamp of a run's rows (a run that waited for the billing service: its hold, once made; the moderation
 * service's ask to see its outputs). The rest of each row's stamp stays.
 */
export function restampRows(ids: string[], add: RunStamp): void {
  for (const id of ids) {
    const r = db().prepare("SELECT request_json FROM generations WHERE id = ?").get(id) as Pick<Row, "request_json"> | undefined;
    if (!r) continue;
    const stored = JSON.parse(r.request_json) as GenerationRequest;
    const next = withRunStamp({ ...stampOf(stored), ...add }, () => stamped(stored));
    update(id, { request_json: JSON.stringify(next) });
  }
}

async function pollGuarded(r: Row): Promise<void> {
  const polling = (globalThis.__fuobeRunner!.polling ??= new Set());
  if (polling.has(r.id)) return;
  polling.add(r.id);
  try {
    const account = accountOf(r);
    // Whose run it is can't be read: never polled as the owner's (with the owner's keys).
    if (account === UNREADABLE) {
      update(r.id, { status: "failed", error: "This run's details can't be read, so it was stopped.", completed_at: Date.now(), message: null });
      return;
    }
    const onPool = account ? poolOf(r) : false;
    const own = account && !onPool ? accountRun(account, r.provider, "poll") : undefined;
    if (onPool) await runOnPool(account!, () => pollOne(r));
    else if (own && "error" in own) {
      update(r.id, { status: "failed", error: own.error, completed_at: Date.now(), message: null });
      ownFailed(r.id, account!, factsOf(r, { stage: "poll" }), own.code);
    }
    else if (own) await own.run(() => pollOne(r));
    else await pollOne(r);
  } catch (e) {
    console.warn(`[generations] ${r.id}: ${(e as Error).message}`);
  } finally {
    polling.delete(r.id);
  }
}

/**
 * The jobs one tick polls (100 at most): the owner's first, then every account's in turn (each account's oldest job,
 * then each one's second, and so on), so one account's long queue never hides another account's jobs.
 */
export function rowsToPoll(limit = 100): Row[] {
  return db()
    .prepare(
      `SELECT g.* FROM generations g
       JOIN (SELECT id, ROW_NUMBER() OVER (PARTITION BY json_extract(request_json, '$.account') ORDER BY created_at) AS turn
             FROM generations WHERE status IN ('queued','running') AND external_id IS NOT NULL AND stage IS NULL) t ON t.id = g.id
       ORDER BY ${ACCOUNT_LAST.replace("request_json", "g.request_json")}, t.turn, g.created_at ASC LIMIT ?`,
    )
    .all(limit) as Row[];
}

async function tick(): Promise<void> {
  const state = globalThis.__fuobeRunner;
  if (!state || state.busy) return;
  state.busy = true;
  try {
    sweepInterrupted();
    // Runs made but waiting to enter the line (hosted runs): those whose reason cleared enter it now (pool-release.ts).
    if (hostedRunsOn() && anyHeld()) {
      try {
        await (await import("./pool-release")).releaseHeldRuns();
      } catch (e) {
        console.warn(`[generations] runs waiting to enter the line: ${(e as Error).message}`);
      }
    } else if (anyHeld()) {
      try {
        endHeldRuns();
      } catch (e) {
        console.warn(`[generations] runs waiting to enter the line: ${(e as Error).message}`);
      }
    }
    // The owner's jobs first, then the accounts' in turn. An account's ComfyUI may be slow to answer: its polls run on
    // their own, so they never hold up the owner's (pollGuarded never polls one row twice at once).
    const active = rowsToPoll();
    for (const r of active) if (accountOf(r)) void pollGuarded(r);
    await Promise.all([...active.filter((r) => !accountOf(r)).map(pollGuarded), pollTrainings().catch(() => {}), advanceDependents().catch(() => {})]);
    // The optional services (billing.ts, moderation.ts): outputs waiting for their check, then reports for the billing
    // service. Neither does anything while no service is set.
    if (moderationConfigured()) await sweepOutputChecks();
    void sweepBilling();
    // The hourly run counts forget a run (and the client address it came from) two hours on, whether more runs come.
    try {
      prunePoolAdmissions();
    } catch (e) {
      console.warn(`[generations] run counts: ${(e as Error).message}`);
    }
  } finally {
    state.busy = false;
  }
}

async function fastTick(): Promise<void> {
  const state = globalThis.__fuobeRunner;
  if (!state || state.fastBusy) return;
  state.fastBusy = true;
  try {
    const rows = db()
      .prepare(
        `SELECT g.*, r.started_at AS run_started_at FROM generations g LEFT JOIN generation_runs r ON r.id = g.id WHERE g.status = 'running' AND g.external_id IS NOT NULL AND g.progress IS NOT NULL AND g.stage IS NULL ORDER BY ${ACCOUNT_LAST.replace("request_json", "g.request_json")}, g.created_at ASC LIMIT 50`,
      )
      .all() as (Row & { run_started_at: number | null })[];
    const now = Date.now();
    // At 90% (or on course to be there by now, at the pace it has reported since it started).
    const nearlyDone = rows.filter((r) => {
      const p = r.progress ?? 0;
      if (p >= 0.9) return true;
      const ran = r.run_started_at ? r.updated_at - r.run_started_at : 0;
      return ran > 0 && p > 0 && (p * (now - r.run_started_at!)) / ran >= 0.9;
    });
    const soon = nearlyDone.slice(0, 20);
    for (const r of soon) if (accountOf(r)) void pollGuarded(r);
    await Promise.all(soon.filter((r) => !accountOf(r)).map(pollGuarded));
  } finally {
    state.fastBusy = false;
  }
}

/**
 * How long a started job may run: on this install's own GPUs (an account's run there, or the owner's ComfyUI job), its
 * lane's run ceiling (queue-settings.ts); on the WorldCast worker 3 hours; anywhere else (an account's own GPU or key, a
 * cloud provider) 45 minutes, as always.
 */
function runningLimitMs(r: Pick<Row, "provider">, meta: Record<string, unknown>, account: string | undefined, onPool: boolean): number {
  if (r.provider === "worldcast") return WORLDCAST_TIMEOUT_MS;
  // (A cloud talking video as long as its voice may take longer: meta.runLimitMs, set when it was sent.)
  if (r.provider !== "comfyui" || (account && !onPool)) return Math.max(TIMEOUT_MS, typeof meta.runLimitMs === "number" ? meta.runLimitMs : 0);
  const wf = typeof meta.workflowId === "string" && !meta.workflowId.includes("{") ? meta.workflowId : null;
  return runCeilingMs(wf ? poolLane(wf) : null);
}

/**
 * Is the run's job a task for the workers? An account's run on this install's GPUs that went to the workers, or one the
 * provider marked so when it handed the job over (the owner's jobs on the workers too).
 */
function workersTask(meta: Record<string, unknown>, onPool: boolean): boolean {
  return typeof meta.relay === "string" && (onPool || meta.workers === true);
}

/** Order by: the owner's rows (no account in the request) before accounts'. */
const ACCOUNT_LAST = "(json_extract(request_json, '$.account') IS NOT NULL)";

function runRoute(model: NonNullable<ReturnType<typeof getModel>>, r: Pick<Row, "op" | "provider">): ModelRoute {
  return model.routes.find((x) => x.op === r.op && (x.provider === r.provider || r.provider === "mock")) ?? model.routes[0];
}

function pollContext(r: Row, model: NonNullable<ReturnType<typeof getModel>>): PollContext {
  return { externalId: r.external_id!, meta: JSON.parse(r.external_meta_json ?? "{}") as Record<string, unknown>, route: runRoute(model, r), model, createdAt: r.created_at };
}

async function pollOne(r: Row): Promise<void> {
  const model = getModel(r.model_id);
  if (!model) {
    // A job on a model Fuobe retired with its provider (replaced.ts) can't be collected: Reuse runs it on the replacement.
    const retired = !!replacedBy(r.model_id) || !Object.hasOwn(PROVIDERS, r.provider);
    update(r.id, { status: "failed", error: retired ? RETIRED_PROVIDER_ERROR : "This model isn't available any more. Pick another.", completed_at: Date.now(), message: null });
    return;
  }
  // The clock runs from when the provider got the job (and from when it started it), not from creation:
  // a chained step created at the start of a long pipeline gets its full time once it's submitted.
  const now = Date.now();
  let run = db().prepare("SELECT submitted_at, started_at FROM generation_runs WHERE id = ?").get(r.id) as { submitted_at: number; started_at: number | null } | undefined;
  if (!run) {
    // Submitted before this was recorded (an upgrade mid-job): start counting now.
    recordSubmission(r.id, now);
    run = { submitted_at: now, started_at: null };
  }
  const ctx = pollContext(r, model);
  // Its outputs are saved and the 3D finish runs (or ran until a restart): nothing more to ask the provider.
  // (Only the app process whose turn it is: two processes on one database never run its finish twice.)
  if (ctx.meta.finishing) {
    if (claimFinish(r.id)) resumeFinish(r);
    return;
  }
  // Poll first: a job that finished while the server was asleep or down is collected, not timed out.
  let res: PollResult | undefined;
  let pollError: unknown;
  const account = accountOf(r);
  // An account's own GPU or key (not this install's GPUs): its polls heal (healPoll), and its failures say what helps.
  const own = account && !poolOf(r) ? account : undefined;
  if (own && r.provider === "comfyui" && typeof ctx.meta.sentTo === "string") {
    // Sent to a link the account has since replaced with another: the new one knows nothing of it.
    const now = gpuLink(accountGpu(own));
    if (now && addressKey(now.url) !== ctx.meta.sentTo) {
      pollHeals().delete(r.id);
      failRun(r.id, new Error("moved"), diagnoseGpuJob({ kind: "moved" }, { kind: "link", url: now.url }), own, factsOf(r, { stage: "poll" }));
      return;
    }
  }
  // A poll that failed a moment ago waits its turn (a growing wait), instead of asking every 1.5 s; so does a made result
  // whose copy broke off (it is copied again at the next poll).
  const healing = own ? pollHeals().get(r.id) : undefined;
  if (healing && Date.now() < healing.next) return;
  // (The owner's Replicate run too: Replicate deletes the file an hour after it is made, so its copy is tried again.)
  const copyHeals = !!own || (!account && r.provider === "replicate");
  if (copyHeals && typeof ctx.meta.saveNext === "number" && Date.now() < ctx.meta.saveNext) return;
  try {
    res = await adapterFor(r.provider, account).poll(ctx);
  } catch (e) {
    pollError = e;
  }
  if (own && pollError && (await healPoll(r, ctx, own, pollError))) {
    if (statusOf(r.id) !== "queued" && statusOf(r.id) !== "running") return;
  } else if (own && !pollError) {
    const was = pollHeals().get(r.id);
    pollHeals().delete(r.id);
    if (was) recordOwnRun({ run: r.id, account: own, ...factsOf(r, { stage: "poll", attempt: was.n, waitedMs: Date.now() - was.first }), outcome: "healed" });
    // Its GPU answered: the status strip and the next run take it as online (one slow status check doesn't say otherwise).
    const link = r.provider === "comfyui" ? ownLink() : null;
    if (link) noteHandedOver(own, link.url);
  }
  // An account's job waits at most 30 minutes in its own ComfyUI's queue (or its provider's).
  const stored = JSON.parse(r.request_json) as GenerationRequest;
  const onPool = !!account && stored.place === "pool";
  // On this install's GPUs: the wait the billing service set for the run, else FUOBE_POOL_WAIT_MIN.
  const queueMs = onPool ? poolWaitMs(stored.waitMs) : account ? ACCOUNT_LIMITS.queueMs : QUEUE_TIMEOUT_MS;
  if (!res || res.state === "queued" || res.state === "running") {
    // A job on someone's own computer reached their ComfyUI later than it was handed over (it waited for their tab): its
    // queue clock starts then.
    if (res?.sentAt && res.sentAt > run.submitted_at) {
      recordSubmission(r.id, res.sentAt);
      run = { submitted_at: res.sentAt, started_at: null };
    }
    // A job for the workers keeps its task's own clocks (pool.ts): its wait limit until a worker first takes it, then
    // the deadline of the attempt a worker holds, from its claim (the worker's own run limit and stall rule end an
    // attempt first). No clock of the runner's ends it, even when a poll of it fails (a busy database in a deploy's
    // overlap): the next tick asks again.
    const ownClocks = workersTask(ctx.meta, onPool) || (!!res && (res.state === "queued" || res.state === "running") && !!res.ownClocks);
    if (ownClocks && res?.state === "queued" && run.started_at) {
      db().prepare("UPDATE generation_runs SET started_at = NULL WHERE id = ?").run(r.id);
      run = { ...run, started_at: null };
    }
    // A job that has just left the queue gets its full running time from now.
    const startsNow = res?.state === "running" && !run.started_at;
    // An account's own GPU (or its provider) whose queue keeps moving: the job waits on. Only a queue that hasn't moved
    // for the limit, or one waited in for 2 hours, ends it.
    const ownQueue = !!own && !onPool;
    let movedAt = typeof ctx.meta.queueMovedAt === "number" ? ctx.meta.queueMovedAt : run.submitted_at;
    const pos = res?.state === "queued" && typeof res.position === "number" ? res.position : undefined;
    // The job its GPU runs now (another one): a new one there is a queue that moves too.
    const busyWith = res?.state === "queued" && typeof res.busyWith === "string" ? res.busyWith : undefined;
    const wasBusyWith = typeof ctx.meta.busyWith === "string" ? ctx.meta.busyWith : undefined;
    const nearer = pos !== undefined && (typeof ctx.meta.queuePos !== "number" || pos < ctx.meta.queuePos);
    if (ownQueue && pos !== undefined && (nearer || busyWith !== wasBusyWith)) {
      // Its place first seen is where it starts; a place nearer the front, or another job running ahead of it, is a
      // queue that moves.
      if (typeof ctx.meta.queuePos === "number" && (nearer || (busyWith !== undefined && wasBusyWith !== undefined))) movedAt = now;
      const place = nearer ? pos : ctx.meta.queuePos;
      db()
        .prepare(
          "UPDATE generations SET external_meta_json = json_set(CASE WHEN json_valid(external_meta_json) THEN external_meta_json ELSE '{}' END, '$.queuePos', @place, '$.queueMovedAt', @movedAt, '$.busyWith', @busyWith) WHERE id = @id AND external_id IS NOT NULL",
        )
        .run({ id: r.id, place, movedAt, busyWith: busyWith ?? null });
    }
    // A job on the account's fal.ai key behind its own started jobs there waits for one of them to end, its place
    // unmoved (ownRunStarted).
    const ownAhead = ownQueue && !busyWith && r.provider === "fal" && res?.state === "queued" && ownRunStarted(r.id, own!, r.provider);
    // While a job runs ahead of it, that one job may take its own time (45 minutes) before the queue counts as stuck.
    const stillMs = ownQueue && (busyWith || ownAhead) ? Math.max(queueMs, TIMEOUT_MS) : queueMs;
    const queueOver = ownQueue
      ? now - Math.max(run.submitted_at, movedAt) > stillMs * OWN_QUEUE.scale || now - run.submitted_at > OWN_QUEUE_CAP_MS * OWN_QUEUE.scale
      : now - run.submitted_at > queueMs;
    const deadline = ownClocks && (res?.state === "queued" || res?.state === "running") ? res.deadline : undefined;
    // (Worked out only for a started job: a queued one never reads it.)
    const limitMs = ownClocks ? (deadline?.ms ?? 0) : run.started_at ? runningLimitMs(r, ctx.meta, account, onPool) : 0;
    const overdue = ownClocks ? !!deadline && now > deadline.at : run.started_at ? now - run.started_at > limitMs : !startsNow && queueOver;
    if (overdue) {
      // Stop the provider's job too, so it doesn't keep rendering (or billing) for nothing.
      const cancel = () =>
        adapterFor(r.provider, account)
          .cancel?.(ctx)
          .catch(() => {});
      const words =
        run.started_at || deadline
          ? onPool
            ? ENGINE_WORDS.timeout
            : `Timed out after ${Math.round(limitMs / 60_000)} minutes`
          : res?.state === "queued" && res.timeoutError
            ? res.timeoutError
            : onPool
              ? POOL_WAITED
              : account
                ? `This waited over ${queueMs / 60_000} minutes to start. Press Retry.`
                : "This took too long to start. Press Retry.";
      if (ownQueue) {
        // An account's own GPU or key: why, in plain words, with what helps.
        const waited = Math.max(1, Math.round((now - run.submitted_at) / 60_000));
        const ran = Math.round(limitMs / 60_000);
        const link = r.provider === "comfyui" ? ownLink() : null;
        const ctxKey = isCloudProvider(r.provider) ? { provider: r.provider, other: otherKeyFor(own!, r.provider, r.model_id) } : null;
        const d: Diagnosis | undefined =
          res?.state === "queued" && res.timeoutError
            ? { cause: "gpu-offline", words: res.timeoutError, actions: [{ kind: "retry", label: "Retry" }, ...(/paired/i.test(res.timeoutError) ? [{ kind: "pair" as const, label: "Pair with a code", target: "/connect" }] : [])], retryable: false }
            : ctxKey
              ? diagnoseKeyJob(run.started_at ? { kind: "too-long", minutes: ran } : { kind: "busy", minutes: waited }, ctxKey)
              : r.provider === "comfyui"
                ? diagnoseGpuJob(run.started_at ? { kind: "too-long", minutes: ran } : { kind: "busy", minutes: waited }, link ?? { kind: "computer" })
                : undefined;
        if (failRun(r.id, new Error(words), d, own, factsOf(r, { stage: "poll", waitedMs: now - run.submitted_at }))) await cancel();
        return;
      }
      await cancel();
      updateLive(r.id, { status: "failed", error: words, completed_at: now, message: null });
      return;
    }
    if (!res) {
      // An account's poll that healPoll took (waiting with a growing wait): nothing more to do this turn.
      if (own && pollHeals().has(r.id)) return;
      throw pollError;
    }
    if (startsNow) db().prepare("UPDATE generation_runs SET started_at = ? WHERE id = ?").run(Date.now(), r.id);
    // Back in line (a worker paused, went quiet or gave it back): no progress of the attempt before is kept.
    // (An Ideogram 4 run made again after it declined says so while it works.)
    updateLive(r.id, { status: res.state, progress: ownClocks && res.state === "queued" ? null : (res.progress ?? r.progress), message: declinedWords(ctx.meta) ?? res.message ?? null });
    return;
  }
  if (res.state === "failed") {
    // Its GPU restarted and lost the job: an account's run is sent again once, as a computer's tab does.
    if (own && res.lost && resend(r, own, RESENT_WORDS)) return;
    // A fallback making a run Ideogram 4 declined: the next one, or it fails as the declined run.
    if (declinedFails(r.id, res.error, r.external_meta_json) !== null) return;
    // An account's run: its own GPU's words (comfyui.ts), or its key's provider's read plainly; the provider's own words
    // go in the details line. The owner's runs keep the provider's words.
    const trouble =
      res.trouble ??
      (own && isCloudProvider(r.provider)
        ? diagnoseKey(
            { stage: "poll", failed: true, text: res.error, canceled: r.provider === "replicate" && /^(canceled|aborted)$/i.test(res.error.trim()) },
            { provider: r.provider, other: otherKeyFor(own, r.provider, r.model_id) },
          )
        : undefined);
    // What the GPU was missing (a model, a node class): the tile offers "Fix it", and the GPU's check counts as stale.
    if (own) {
      failRun(r.id, Object.assign(new Error(res.error), { said: res.error, ...(res.fix && { fix: res.fix }) }), trouble, own, factsOf(r, { stage: "poll" }));
      return;
    }
    const kept = keptFix(res.fix, undefined);
    // On this install's GPUs the person reads a plain sentence; the engine's own words are the owner's (the column and the log).
    const saved = updateLive(r.id, { status: "failed", error: res.error, completed_at: Date.now(), message: null, ...(kept && { fix_json: kept }), ...(res.detail && { detail: res.detail }) });
    if (saved && res.detail) recordRunEvent("gpu-run-failed", { run: r.id, ...(account && { account }), provider: r.provider, model: r.model_id, op: r.op ?? undefined, words: res.error, detail: cleanEngineText(res.detail) }, "warn");
    // (A run on this install's GPUs says nothing about the account's own GPU.)
    if (res.fix && !onPool) markStale(account ? `acct:${account}` : "install");
    return;
  }
  // The Watermark Remover gave the original back (no clean repair was possible): no new result, the run says what to try.
  if (r.op === "watermark-remove" && (res.outputs as RichOutput[]).some((o) => rejectedRepair(o.meta?.quality as WatermarkQuality | undefined))) {
    updateLive(r.id, { status: "failed", error: WATERMARK_COPY.rejected, completed_at: Date.now(), message: null });
    return;
  }
  // A Watermark Remover scan with no report the page can read fails in words (never a page that waits for marks forever).
  if (r.op === "watermark-scan" && !(res.outputs as RichOutput[]).some((o) => parseScanReport(o.text))) {
    updateLive(r.id, { status: "failed", error: WATERMARK_COPY.scanFailed, completed_at: Date.now(), message: null });
    return;
  }
  // A Watermark Remover result keeps how it was asked, next to the repair's verdict: the marks removed (as checked) and how.
  if (r.op === "watermark-remove") {
    const req = JSON.parse(r.request_json) as GenerationRequest;
    const asked = req.params?.extra?.boxes;
    const mode = req.inputs?.mask ? "manual_mask" : asked !== undefined ? "manual_boxes" : "auto_qwen";
    let marks: unknown[] | undefined;
    try {
      marks = mode === "manual_boxes" ? (JSON.parse(checkWatermarkBoxes(asked).json) as { boxes: unknown[] }).boxes : undefined;
    } catch {
      marks = undefined;
    }
    res = { ...res, outputs: (res.outputs as RichOutput[]).map((o) => (o.kind === "image" ? { ...o, meta: { ...o.meta, watermark: { mode, ...(marks && { marks }) } } } : o)) };
  }
  // One app process saves a finished run's results: the one that takes the turn (two processes on one database during a
  // deploy's overlap never both save them, and the second never ends a saved run as failed).
  if (!claimFinish(r.id)) return;
  // Mark first so a slow download isn't polled twice.
  updateLive(r.id, { status: "running", progress: 0.99, message: "Saving results" });
  const outputs: OutputFile[] = [];
  // An account's job keeps at most 16 outputs, and a result it can't save fails the job (never a link to its ComfyUI).
  const dropped = account && res.outputs.length > ACCOUNT_LIMITS.outputsPerJob ? res.outputs.length - ACCOUNT_LIMITS.outputsPerJob : 0;
  if (dropped) res = { ...res, outputs: res.outputs.slice(0, ACCOUNT_LIMITS.outputsPerJob) };
  // Remove background: of a cut-out and its mask (BiRefNet's answer), the one asked for (params.matteOutput).
  const matte = r.op === "bg-remove-video" ? (JSON.parse(r.request_json) as GenerationRequest).params?.matteOutput : undefined;
  // The face mosaic's cloud step answers with the faces' masks: the result is the picture, pixelated under them.
  const faceMasks = r.op === "face-mosaic" && res.outputs.length > 0 && (res.outputs as RichOutput[]).every((o) => o.meta?.role === "mask" && Array.isArray(o.meta.masks));
  if (faceMasks) {
    try {
      outputs.push(await mosaicOutput(r, res.outputs as RichOutput[]));
    } catch (e) {
      updateLive(r.id, { status: "failed", error: (e as Error).message, completed_at: Date.now(), message: null });
      return;
    }
  } else {
    for (const o of keepMatte(res.outputs as RichOutput[], matte)) {
      try {
        // An account's own GPU or key: a copy that breaks off is tried again (the result is made, and paid). The files a
        // result links to are kept once, before (never fetched again with each try of the main file).
        const linked = copyHeals ? await persistArtifacts(o.meta, r.id, o.url) : undefined;
        outputs.push(await (copyHeals ? persistWithRetry(o, r.id, linked) : persistOutput(o, r.id)));
        // Still saving: the turn is still this process's.
        claimFinish(r.id);
      } catch (e) {
        if (account) {
          for (const kept of outputs) if (kept.assetId) deleteAsset(kept.assetId);
          // Stems unpacked to the scratch folder and not saved go now, not at the next sweep.
          for (const rest of res.outputs as RichOutput[]) {
            const left = rest.url ? scratchOutputFile(rest.url) : null;
            if (left) fs.rmSync(left, { force: true });
          }
          // Its own GPU or key, a copy that broke off for a passing reason (the GPU or the provider dropped it for a
          // while): copied again at a later poll, with a growing wait, for some minutes. The tile says so.
          if (own && passingSave(e)) {
            const at = Date.now();
            const since = typeof ctx.meta.saveSince === "number" ? ctx.meta.saveSince : at;
            const tries = (typeof ctx.meta.saveTries === "number" ? ctx.meta.saveTries : 0) + 1;
            if (at - since < SAVE_HEAL_MS * SELF_HEAL.scale) {
              const next = at + backoffMs(tries, { budgetMs: 0, firstMs: 5_000, maxMs: 60_000 }) * SELF_HEAL.scale;
              const words = r.provider === "comfyui" ? "Your result is made. Copying it from your GPU" : `Your result is made. Copying it from ${isCloudProvider(r.provider) ? CLOUD_KEY[r.provider].label : "the provider"}`;
              db()
                .prepare(
                  `UPDATE generations SET message = @words, updated_at = @at,
                     external_meta_json = json_set(CASE WHEN json_valid(external_meta_json) THEN external_meta_json ELSE '{}' END, '$.saveSince', @since, '$.saveTries', @tries, '$.saveNext', @next)
                   WHERE id = @id AND status = 'running'`,
                )
                .run({ id: r.id, words, at, since, tries, next });
              if (tries === 1) ownEvent(r.id, own, e, saveTrouble(e, r.provider), factsOf(r, { stage: "result", attempt: 1 }), "waiting");
              return;
            }
          }
          // Its own GPU or key: why, and what helps (a file over the cap, an expired link, a GPU that went away).
          const trouble = own && !(e instanceof AccountFilesFull) ? saveTrouble(e, r.provider) : undefined;
          const why = e instanceof AccountFilesFull ? e.message : (trouble?.words ?? "We couldn't save this result. Press Retry.");
          if (own) failRun(r.id, Object.assign(new Error(why), { said: (e as Error).message }), trouble, own, factsOf(r, { stage: "result" }));
          else {
            const kept = keptFix(undefined, trouble);
            updateLive(r.id, { status: "failed", error: why, completed_at: Date.now(), message: null, ...(kept && { fix_json: kept }) });
          }
          return;
        }
        // The owner's Replicate run: a link to Replicate's file is no result to keep (Replicate deletes it an hour after it
        // is made). A copy that broke off for a passing reason is tried again at a later poll, with a growing wait, for 15
        // minutes; one that can't be saved fails the run in words.
        // https://replicate.com/docs/topics/predictions/data-retention
        if (copyHeals && /^https?:\/\//.test(o.url ?? "")) {
          for (const kept of outputs) if (kept.assetId) deleteAsset(kept.assetId);
          const at = Date.now();
          const since = typeof ctx.meta.saveSince === "number" ? ctx.meta.saveSince : at;
          const tries = (typeof ctx.meta.saveTries === "number" ? ctx.meta.saveTries : 0) + 1;
          if (passingSave(e) && at - since < SAVE_HEAL_MS * SELF_HEAL.scale) {
            const next = at + backoffMs(tries, { budgetMs: 0, firstMs: 5_000, maxMs: 60_000 }) * SELF_HEAL.scale;
            db()
              .prepare(
                `UPDATE generations SET message = @words, updated_at = @at,
                   external_meta_json = json_set(CASE WHEN json_valid(external_meta_json) THEN external_meta_json ELSE '{}' END, '$.saveSince', @since, '$.saveTries', @tries, '$.saveNext', @next)
                 WHERE id = @id AND status = 'running'`,
              )
              .run({ id: r.id, words: "Your result is made. Copying it from Replicate", at, since, tries, next });
            return;
          }
          const expired = /^download (403|404|410)$/.test((e as Error).message ?? "");
          updateLive(r.id, { status: "failed", error: expired ? resultExpired().words : "We couldn't save this result. Press Retry.", completed_at: Date.now(), message: null });
          return;
        }
        outputs.push({ url: o.url, kind: o.kind ?? r.kind, ...inlineText(o.text, o.meta), ...(o.draftId ? { draftId: o.draftId } : {}) });
        console.warn(`[fuobe] could not save output for ${r.id}: ${(e as Error).message}`);
      }
    }
  }
  // Ideogram 4's grey "blocked by safety filter" card is no picture (src/server/safety-card.ts): it is left out of the
  // results and kept for the owner only (keepForOwner), with its measures. A run that got some real pictures keeps them.
  // A run whose every picture was the card is made again in its place (declinedAgain: Auto's fallbacks in order);
  // only when it can't be does it fail, saying what to try.
  if (model.options.promptFormat === "ideogram4") {
    const cards = new Map<OutputFile, DeclinedCard>();
    for (const o of outputs) {
      const png = o.kind === "image" && o.assetId ? await readRef(o.url).catch(() => null) : null;
      const m = png ? blockedMeasures(png.data) : null;
      if (m?.blocked) cards.set(o, { url: o.url, spread: m.spread, grey: m.grey });
    }
    const was = readMeta(r.external_meta_json).declined;
    const declined: DeclinedMeta = { ...was, cards: [...(was?.cards ?? []), ...cards.values()].slice(-8) };
    if (cards.size) {
      keepForOwner([...cards.keys()].map((o) => o.assetId!));
      db()
        .prepare(`UPDATE generations SET external_meta_json = json_set(CASE WHEN json_valid(external_meta_json) THEN external_meta_json ELSE '{}' END, '$.declined', json(?)) WHERE id = ?`)
        .run(JSON.stringify(declined), r.id);
    }
    if (cards.size && cards.size === outputs.length) {
      if (declinedAgain(r, declined)) return;
      updateLive(r.id, { status: "failed", error: BLOCKED_CARD_MESSAGE, completed_at: Date.now(), message: null });
      return;
    }
    if (cards.size) outputs.splice(0, outputs.length, ...outputs.filter((o) => !cards.has(o)));
  }
  // Any Angle's 3D view: its front view is measured on the turntable it rendered, and kept on the splat (meta.front).
  if (r.model_id === ANY_ANGLE.buildModel) {
    const measured = await withFrontView(JSON.parse(r.request_json) as GenerationRequest, outputs);
    if (!measured) {
      // Nothing of a failed build is kept, the owner's included.
      for (const kept of outputs) if (kept.assetId) deleteAsset(kept.assetId);
      updateLive(r.id, { status: "failed", error: NO_SUBJECT_MESSAGE, completed_at: Date.now(), message: null });
      return;
    }
    outputs.splice(0, outputs.length, ...measured);
  }
  // Fuobe Soul: what follows in the browser (the look's grade, an overlay, Soul Cinema's 21:9 crop), on each image;
  // API clients read it as meta.
  // A storyboard frame with a look gets the look's finish whatever model made it (a 21:9 board is cropped after).
  const board = (JSON.parse(r.request_json) as GenerationRequest).frame;
  const boardPost = board?.look ? soulPostSteps(SOUL_MODELS.soul, board.look) : undefined;
  const post = boardPost ? { ...boardPost, ...(board?.crop && { crop: board.crop }) } : soulPostSteps(r.model_id, r.preset_id, soulKind(r.model_id) ? requestAspect(r.request_json) : undefined);
  if (post) for (const [i, o] of outputs.entries()) if (o.kind === "image") outputs[i] = { ...o, meta: { ...o.meta, ...post } };
  // Fuobe DoP's colour-grade effects: the grade the browser applies to the clip (the result's "Apply the grade" step).
  const grade = isDop(r.model_id) && r.preset_id ? getPreset(r.preset_id)?.grade : undefined;
  if (grade) for (const [i, o] of outputs.entries()) if (o.kind === "video") outputs[i] = { ...o, meta: { ...o.meta, grade } };
  // An image-to-3D GLB from ComfyUI gets the server's finish first (the web GLB, seconds): the outputs are
  // stored now and the row stays running until it's done, so a restart resumes it from them. The turntable
  // is rendered after the job has succeeded (src/server/model3d-finish.ts).
  // Stopped (or taken over by another app process) while its results were saved: the files saved here belong to no run,
  // so they go now instead of filling the account's space.
  const dropSaved = () => {
    for (const kept of outputs) if (kept.assetId) deleteAsset(kept.assetId);
  };
  if (modelToFinish(r, outputs) >= 0) {
    if (!updateLive(r.id, { outputs_json: JSON.stringify(outputs), external_meta_json: JSON.stringify({ ...ctx.meta, finishing: true }), message: "Finishing the 3D model" })) return dropSaved();
    resumeFinish({ ...r, outputs_json: JSON.stringify(outputs) });
    return;
  }
  // The moderation service asked to see this run's outputs first: they are held, and the row waits ("Checking").
  if (stored.checkOutputs && moderationConfigured()) {
    if (!holdForCheck(r.id, outputs, { live: true, turn: runnerToken() })) dropSaved();
    return;
  }
  const saved = updateLive(r.id, {
    status: "succeeded",
    outputs_json: JSON.stringify(outputs),
    progress: 1,
    message: dropped ? `Kept ${ACCOUNT_LIMITS.outputsPerJob} of ${ACCOUNT_LIMITS.outputsPerJob + dropped} results` : null,
    completed_at: Date.now(),
  });
  if (!saved) dropSaved();
}

/**
 * Change a run the runner looked at, only while it still goes (queued or running, and not held for its output check) and
 * no other app process that still runs holds its turn to save its results. A look that took a while (a slow poll, a
 * deploy's overlap, a wait for an account's own GPU) never takes a run another process saved, failed or canceled (or a
 * person canceled) meanwhile back to an earlier state, and never fails a run another process is saving. `extra`: more of
 * the WHERE clause (it may read @__me, @__quiet and @__now, and its own `params`). Returns whether the change was made.
 */
export function updateLive(id: string, given: Partial<Row>, extra = "", params: Record<string, unknown> = {}): boolean {
  const fields = storedFields(given);
  const keys = Object.keys(fields);
  if (!keys.length) return false;
  const now = Date.now();
  return (
    db()
      .prepare(
        `UPDATE generations SET ${keys.map((k) => `${k} = @${k}`).join(", ")}, updated_at = @__now WHERE id = @__id AND status IN ('queued', 'running') AND stage IS NULL
           AND NOT EXISTS (SELECT 1 FROM generation_runs t WHERE t.id = @__id AND t.finish_by IS NOT NULL AND t.finish_by != @__me AND t.finish_until >= @__now
             AND NOT ${HOLDER_QUIET})${extra}`,
      )
      .run({ ...params, ...fields, __now: now, __id: id, __me: runnerToken(), __quiet: now - QUIET_MS }).changes > 0
  );
}

/** How long an app process holds the turn to save a finished run's results (it renews it as it goes). */
const FINISH_TURN_MS = 5 * 60_000;
/** How often an app process says it still runs (keepBeating)… */
const BEAT_MS = 5_000;
/** …and how long after its last word it counts as stopped (killed, or crashed): its turns are free then, before they run out. */
export const QUIET_MS = 20_000;
/** A process quiet this long is forgotten. */
const FORGET_MS = 24 * 60 * 60_000;

/** SQL: the process holding turn `t` has been quiet since before @__quiet. A turn whose process has no row waits to run out. */
const HOLDER_QUIET = "EXISTS (SELECT 1 FROM app_processes p WHERE p.token = t.finish_by AND p.seen_at < @__quiet)";

declare global {
  /** This app process, as the runs whose results it saves name it. */
  var __fuobeRunnerToken: string | undefined;
  /** This app process's beat (keepBeating). */
  var __fuobeBeat: ReturnType<typeof setInterval> | undefined;
}

const runnerToken = () => (globalThis.__fuobeRunnerToken ??= `${process.pid}:${nanoid(12)}`);

/**
 * Say that this app process still runs, and which catalog version it makes job tickets for (ticket-refresh.ts: a newer
 * process is known from its start, before it serves any worker's claim).
 */
function beat(now = Date.now()): void {
  db()
    .prepare("INSERT INTO app_processes (token, started_at, seen_at) VALUES (?, ?, ?) ON CONFLICT(token) DO UPDATE SET seen_at = excluded.seen_at")
    .run(runnerToken(), now, now);
  noteCatalogProcess(catalogVersion(), processStart(), now);
  renewLeases(now);
}

/**
 * The leases of the runs whose turn this process holds (OLD_LEASE), renewed once less than OLD_LEASE.ms - renewMs is left
 * (each renewal is a change of the run that its live updates send). Never over a live lease of the release before.
 */
function renewLeases(now: number): void {
  const by = leaseField("generations", "by");
  const until = leaseField("generations", "until");
  db()
    .prepare(
      `UPDATE generations SET external_meta_json = ${LEASE_SET}
       WHERE id IN (SELECT id FROM submit_turns WHERE held_by = @me) AND ${PENDING}
         AND (${until} IS NULL OR ${until} <= @now OR ${by} = @me) AND (${by} IS NOT @me OR ${until} IS NULL OR ${until} < @fresh)`,
    )
    .run({ me: runnerToken(), now, fresh: now + OLD_LEASE.ms - OLD_LEASE.renewMs, lease: leaseOf(now) });
}

/**
 * From now on, this app process says every 5 s that it still runs (in the database, so every process on it reads that,
 * wherever it runs), and another process takes a turn this one holds only once this one has been quiet for 20 s. When it
 * exits, it gives its turns back at once, so the app that starts next saves those runs straight away. Once per process:
 * the runner starts it, and so does the first turn it takes.
 */
function keepBeating(): void {
  if (globalThis.__fuobeBeat) return;
  const now = Date.now();
  try {
    beat(now);
    db().prepare("DELETE FROM app_processes WHERE seen_at < ?").run(now - FORGET_MS);
    // Turns to send a run that a process forgotten here held (it stopped part way): nobody holds them.
    db().prepare("DELETE FROM submit_turns WHERE held_by NOT IN (SELECT token FROM app_processes)").run();
  } catch (e) {
    console.warn(`[generations] app process: ${(e as Error).message}`);
  }
  // Started inside a caller's transaction (the runner, first started by a run being made): that first word goes if the
  // transaction is rolled back, so it is said again as soon as the transaction is over, not 5 s later.
  if (db().inTransaction)
    setImmediate(() => {
      try {
        beat();
      } catch {
        // The next beat says it.
      }
    });
  const timer = setInterval(() => {
    try {
      beat();
    } catch {
      // A busy or closed database: the next beat says it.
    }
  }, BEAT_MS);
  timer.unref?.();
  globalThis.__fuobeBeat = timer;
  process.once("exit", giveTurnsBack);
}

/** This app process exits (it saves nothing more): its turns go back now, and its row with them. */
function giveTurnsBack(): void {
  try {
    const d = db();
    const me = runnerToken();
    d.transaction(() => {
      d.prepare("UPDATE generation_runs SET finish_by = NULL, finish_until = NULL WHERE finish_by = ? AND finish_until >= ?").run(me, Date.now());
      // (Its leases first, while its turns still name the runs: OLD_LEASE.)
      d.prepare(`UPDATE generations SET external_meta_json = json_remove(external_meta_json, '$.lease') WHERE id IN (SELECT id FROM submit_turns WHERE held_by = @me) AND ${leaseField("generations", "by")} = @me`).run({ me });
      d.prepare("DELETE FROM submit_turns WHERE held_by = ?").run(me);
      d.prepare("DELETE FROM app_processes WHERE token = ?").run(me);
    })();
  } catch {
    // The database closed first: its turns are free once this process has been quiet for 20 s.
  }
}

/**
 * Take (or renew) this app process's turn to save a run's results: only while the run still goes, and only when no other
 * process holds the turn, or the one that holds it stopped part way (its turn ran out, or it has been quiet for 20 s:
 * killed, or crashed), so this one takes over. Two processes on one database (a deploy's overlap) never both save a
 * run, so a run is finished once.
 */
export function claimFinish(id: string, now = Date.now()): boolean {
  keepBeating();
  const d = db();
  return d
    .transaction((): boolean => {
      const g = d.prepare("SELECT status, stage FROM generations WHERE id = ?").get(id) as Pick<Row, "status" | "stage"> | undefined;
      // A run held for its output check was saved already.
      if (!g || (g.status !== "queued" && g.status !== "running") || g.stage) return false;
      const me = runnerToken();
      d.prepare("INSERT OR IGNORE INTO generation_runs (id, submitted_at, started_at) VALUES (?, ?, NULL)").run(id, now);
      return (
        d
          .prepare(
            `UPDATE generation_runs AS t SET finish_by = @__me, finish_until = @until WHERE t.id = @__id
               AND (t.finish_by IS NULL OR t.finish_by = @__me OR t.finish_until IS NULL OR t.finish_until < @__now OR ${HOLDER_QUIET})`,
          )
          .run({ __me: me, until: now + FINISH_TURN_MS, __id: id, __now: now, __quiet: now - QUIET_MS }).changes > 0
      );
    })
    .immediate();
}

/**
 * Take this app process's turn to hand a run to its provider: only while the run still waits for its hand-over (queued
 * or running, with no job at its provider yet), and only when no other app process that still runs holds the turn (one
 * quiet for 20 s, or gone, holds nothing any more). The turn is held from the first look until the run is handed over or
 * stops, its wait for an account's own GPU or key included (submitNow). `waiting`: only while the run is queued, as a
 * chain's next step is, which every app process looks at (advanceDependents). Two processes on one database (a deploy's
 * overlap) never both send a run, neither fails one the other is still sending or waiting on (sweepInterrupted), and a
 * wait whose process stopped is taken over by one of them only (takeOver). handOverEnds gives the turn back.
 */
function takeSubmitTurn(id: string, o: { waiting?: boolean } = {}, now = Date.now()): boolean {
  keepBeating();
  const d = db();
  return d
    .transaction((): boolean => {
      const g = d.prepare("SELECT status, external_id, external_meta_json FROM generations WHERE id = ?").get(id) as Pick<Row, "status" | "external_id" | "external_meta_json"> | undefined;
      if (!g || g.external_id || (g.status !== "queued" && (o.waiting || g.status !== "running"))) return false;
      // An instance of the release before holds it (its lease: OLD_LEASE).
      if (oldLeaseHolds(g.external_meta_json, now)) return false;
      const took =
        d
          .prepare(
            `INSERT INTO submit_turns (id, held_by, held_at) VALUES (@id, @me, @now)
             ON CONFLICT(id) DO UPDATE SET held_by = excluded.held_by, held_at = excluded.held_at
             WHERE submit_turns.held_by = @me OR NOT EXISTS (SELECT 1 FROM app_processes p WHERE p.token = submit_turns.held_by AND p.seen_at >= @quiet)`,
          )
          .run({ id, me: runnerToken(), now, quiet: now - QUIET_MS }).changes > 0;
      // The lease the release before reads as held, while this process holds the turn (renewed by the beat).
      if (took) d.prepare(`UPDATE generations SET external_meta_json = ${LEASE_SET} WHERE id = @id AND ${PENDING}`).run({ id, lease: leaseOf(now) });
      return took;
    })
    .immediate();
}

/** This app process holds the turn to send a run (inside a step that made the run wait to be sent again). */
function noteSubmitTurn(id: string): void {
  keepBeating();
  db()
    .prepare("INSERT INTO submit_turns (id, held_by, held_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET held_by = excluded.held_by, held_at = excluded.held_at")
    .run(id, runnerToken(), Date.now());
}

/** This app process has sent the run, or stopped trying: it is no longer being handed over here, and its turn goes. */
function handOverEnds(id: string): void {
  submitting().delete(id);
  try {
    const d = db();
    const me = runnerToken();
    d.transaction(() => {
      d.prepare("DELETE FROM submit_turns WHERE id = ? AND held_by = ?").run(id, me);
      // Its lease goes with the turn (OLD_LEASE): an instance of the release before may take a run left waiting at once.
      d.prepare(`UPDATE generations SET external_meta_json = json_remove(external_meta_json, '$.lease') WHERE id = ? AND ${leaseField("generations", "by")} = ?`).run(id, me);
    })();
  } catch {
    // A closed database: the turn is free once this process has been quiet for 20 s.
  }
}

/** Start (or keep running) the 3D finish of a job whose outputs are stored; it marks the job done when it ends. */
function resumeFinish(r: Row): void {
  const outputs = JSON.parse(r.outputs_json || "[]") as OutputFile[];
  // An account's model: one account finish at a time, and no turntable on the server (its browser records one).
  const account = accountOf(r);
  // An account's run on this install's GPUs is finished on a worker's CPU slot, never here (computer/finish.ts): queued
  // there even while no CPU slot is about (it waits in line, and past its wait the model is kept as it is).
  const stored = JSON.parse(r.request_json) as GenerationRequest;
  const onWorker = !!account && stored.place === "pool" && poolOnWorkers();
  (onWorker ? startWorkerModelFinish : startModelFinish)(r.id, outputs, {
    op: r.op,
    provider: r.provider,
    account: account!,
    onMessage: (message) => update(r.id, { message }),
    done: (finished) => {
      const now = db().prepare("SELECT status, external_meta_json FROM generations WHERE id = ?").get(r.id) as Pick<Row, "status" | "external_meta_json"> | undefined;
      // Canceled or deleted meanwhile: leave it be.
      if (!now || now.status !== "running") return;
      const meta = JSON.parse(now.external_meta_json ?? "{}") as Record<string, unknown>;
      delete meta.finishing;
      // The moderation service asked to see this run's outputs first: the finished model and its turntable are held, and
      // the row waits ("Checking"), as any run's outputs are.
      if (stored.checkOutputs && moderationConfigured()) {
        update(r.id, { external_meta_json: JSON.stringify(meta) });
        holdForCheck(r.id, finished);
        return;
      }
      update(r.id, { status: "succeeded", outputs_json: JSON.stringify(finished), external_meta_json: JSON.stringify(meta), progress: 1, message: null, completed_at: Date.now() });
      // The model can be opened and downloaded now; its turntable is rendered after and added to the result.
      if (!account) startTurntable(r.id, outputStore(r.id));
    },
  });
}

/** A finished job's outputs, for the turntable render that adds to them later. */
function outputStore(id: string): OutputStore {
  return {
    read: () => {
      const row = db().prepare("SELECT outputs_json FROM generations WHERE id = ?").get(id) as Pick<Row, "outputs_json"> | undefined;
      return row ? (JSON.parse(row.outputs_json || "[]") as OutputFile[]) : null;
    },
    write: (outputs) => update(id, { outputs_json: JSON.stringify(outputs) }),
  };
}

/** Turntables the server stopped before rendering (meta.finish.turntable queued or rendering): render them now. */
function resumeTurntables(): void {
  const rows = db()
    .prepare(
      `SELECT id FROM generations WHERE status = 'succeeded' AND op = 'image-to-3d' AND provider = 'comfyui' AND (outputs_json LIKE '%"turntable":"queued"%' OR outputs_json LIKE '%"turntable":"rendering"%') ORDER BY created_at ASC`,
    )
    .all() as Pick<Row, "id">[];
  for (const r of rows) startTurntable(r.id, outputStore(r.id));
}

/**
 * The face mosaic's cloud step (fal's SAM 3.1 answered with the faces' masks): the picture it looked at, pixelated under
 * every mask, made here when the picture and the masks are PNGs (fal's Soul pictures are), so the Library, share links,
 * Canvas and API clients get the finished picture. A picture the server can't decode is kept as it is with the masks
 * (meta.mosaic) for the browser to pixelate (src/components/studio/soul-finish.ts). No face found: the picture as it is, as
 * the GPU graph returns it. The masks are kept as files of the generation (meta.masks).
 */
async function mosaicOutput(r: Row, given: RichOutput[]): Promise<OutputFile> {
  const req = JSON.parse(r.request_json) as GenerationRequest;
  const source = req.inputs?.images?.[0];
  if (!source) throw new Error("The face mosaic has no picture to pixelate");
  const asked = req.params?.extra?.mosaicScale;
  const scale = typeof asked === "number" && asked > 0 && asked < 1 ? asked : MOSAIC_SCALE;
  const links = given.flatMap((o) => (o.meta?.masks as unknown[]).filter((u): u is string => typeof u === "string" && !!u));
  const masks: string[] = [];
  for (const [i, url] of [...new Set(links)].entries()) masks.push(String(await keepLink(url, `mask-${i}`, r.id)));
  const picture = await readRef(source);
  let data = picture.data;
  let contentType = picture.contentType;
  let done = !masks.length;
  if (masks.length) {
    try {
      const img = decodePng(picture.data);
      const layers = await Promise.all(masks.map(async (m) => decodePng((await readRef(m)).data)));
      if (layers.some((l) => l.width !== img.width || l.height !== img.height)) throw new Error("The masks aren't the picture's size");
      const view = (b: Buffer) => new Uint8ClampedArray(b.buffer, b.byteOffset, b.byteLength);
      mosaicPixels(view(img.data), unionMasks(layers.map((l) => view(l.data))), img.width, img.height, scale);
      data = encodePng(img);
      contentType = "image/png";
      done = true;
    } catch (e) {
      console.warn(`[fuobe] face mosaic ${r.id} is left to the browser: ${(e as Error).message}`);
    }
  }
  const asset = saveFile({ data, contentType, source: "generation", generationId: r.id });
  return {
    url: asset.url,
    kind: "image",
    contentType: asset.contentType,
    assetId: asset.id,
    meta: { masks, faces: masks.length, ...(!done && { mosaic: { source: asset.url, masks, scale } }) },
  };
}

/** Outputs may carry text (transcripts, translations, scripts) and structured extras (layer boxes, cues, stems). */
type RichOutput = RemoteOutput & { text?: string; meta?: Record<string, unknown> };

/**
 * Text kept inline on the generation. Every list page and live event carries it, so longer text
 * (long transcripts, scripts) is cut there, marked `meta.truncated`, and read in full from its file.
 */
export const MAX_INLINE_TEXT = 64_000;

function inlineText(text: string | undefined, meta: Record<string, unknown> | undefined): Pick<OutputFile, "text" | "meta"> {
  if (text === undefined) return meta ? { meta } : {};
  if (text.length <= MAX_INLINE_TEXT) return { text, ...(meta && { meta }) };
  return { text: text.slice(0, MAX_INLINE_TEXT), meta: { ...meta, truncated: true } };
}

/**
 * Extra files a result carries as links are kept too, so the Library never depends on a provider's expiring URL:
 * meta.artifacts (LTX HDR's EXR zip, Higgsfield's fbx / zip), meta.formats (a 3D model's other formats, a rig's FBX
 * and its walk and run cycles, SAM 3D's splat) and meta.preview (a 3D model's render, the cut-out a splat was
 * made from). Links are streamed to disk (an EXR zip runs to gigabytes); one that can't be fetched stays as it
 * was (the result's actions still offer it). A link to the main file itself (`main`) is left for persistOutput.
 */
export async function persistArtifacts(meta: Record<string, unknown> | undefined, generationId: string, main?: string): Promise<Record<string, unknown> | undefined> {
  if (!meta) return meta;
  let out = meta;
  for (const key of LINK_MAPS) {
    const links = meta[key];
    if (!links || typeof links !== "object" || Array.isArray(links)) continue;
    const kept: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(links as Record<string, unknown>)) kept[k] = v === main ? v : await keepLink(v, key === "artifacts" ? k : `${key}-${k}`, generationId);
    out = { ...out, [key]: kept };
  }
  for (const key of LINKS) if (typeof meta[key] === "string" && meta[key] !== main) out = { ...out, [key]: await keepLink(meta[key], key, generationId) };
  return out;
}

/** Maps of extra files by name, and single extra files, that a result links to (see persistArtifacts). */
const LINK_MAPS = ["artifacts", "formats"] as const;
const LINKS = ["preview"] as const;

/** A provider's link stored as a file of the generation (its local URL), or the link as it was when it can't be fetched. */
async function keepLink(v: unknown, label: string, generationId: string): Promise<unknown> {
  if (typeof v !== "string" || !/^(https?:|data:)/.test(v)) return v;
  try {
    if (v.startsWith("data:")) {
      const f = await readRef(v);
      return saveFile({ data: f.data, contentType: f.contentType, source: "generation", generationId }).url;
    }
    const dest = path.join(scratchDir(), `${generationId}-${label}-${nanoid(6)}`);
    // An account's run: 1 GB at most, and never this machine or its networks.
    const res = await fetchRemoteToFile(v, dest, tenantAccount() ? { maxBytes: ACCOUNT_LIMITS_FILE_BYTES, blocked: blockedForAccounts } : {});
    const name = new URL(res.url).pathname.split("/").pop() || undefined;
    const header = res.contentType && res.contentType !== "application/octet-stream" ? res.contentType : null;
    return adoptFile({ from: dest, contentType: header ?? contentTypeFor(name ?? "", "application/octet-stream"), name, source: "generation", generationId }).url;
  } catch (e) {
    console.warn(`[fuobe] could not keep the ${label} file of ${generationId}: ${(e as Error).message}`);
    return v;
  }
}

/** The extra links that pointed at the main file point at its stored copy. */
function relinkMain(meta: Record<string, unknown> | undefined, from: string, to: string): Record<string, unknown> | undefined {
  if (!meta || !from) return meta;
  let out = meta;
  for (const key of LINK_MAPS) {
    const links = meta[key];
    if (!links || typeof links !== "object" || Array.isArray(links) || !Object.values(links).includes(from)) continue;
    out = { ...out, [key]: Object.fromEntries(Object.entries(links as Record<string, unknown>).map(([k, v]) => [k, v === from ? to : v])) };
  }
  for (const key of LINKS) if (meta[key] === from) out = { ...out, [key]: to };
  return out;
}

/** The most one file of an account's run may weigh (a result, or a file it links to). */
const ACCOUNT_LIMITS_FILE_BYTES = 2 ** 30;

/** An account's files are full (accountTotalBytes): the job fails with this message. */
class AccountFilesFull extends Error {}

/** Types an account's result is stored as; any other is stored as application/octet-stream (.bin), never served as a page. */
const ACCOUNT_OUTPUT_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/ogg",
  "audio/flac",
  "audio/mp4",
  "audio/aac",
  "audio/webm",
  "model/gltf-binary",
  "text/plain",
  "application/x-subrip",
  "text/vtt",
]);

const accountType = (t: string) => {
  const bare = t.split(";")[0].trim().toLowerCase();
  return ACCOUNT_OUTPUT_TYPES.has(bare) ? bare : "application/octet-stream";
};

/** Before an account's file is kept: refuse it (and remove `file`, when given) when its files would pass its total (3 GB; 1 GB while new). */
function roomFor(account: string, bytes: number, file?: string): void {
  if (accountUsage(account).total + bytes <= accountTotalBytes(account)) return;
  if (file) fs.rmSync(file, { force: true });
  throw new AccountFilesFull(filesFullMessage(account));
}

/**
 * An account's result from its own ComfyUI: streamed to disk (1 GB at most, outputFetch, and never more than its files
 * have room for), checked against its storage, stored as a type from the allowlist. Nothing is fetched while the
 * server is short of space. A download that fails leaves no file behind.
 */
async function persistAccountOutput(o: RichOutput, generationId: string, account: string, linked: Record<string, unknown> | undefined): Promise<OutputFile> {
  const left = accountTotalBytes(account) - accountUsage(account).total;
  if (left <= 0) throw new AccountFilesFull(filesFullMessage(account));
  if (!diskHasRoom()) throw new Error(ACCOUNT_MESSAGES.diskLow);
  const quotaCapped = left < OWN_OUTPUT_LIMITS.maxBytes;
  // A result over what the account has room for says so, not the size of one answer.
  const full = (e: unknown) => (quotaCapped && e instanceof RemoteFetchError && /^The answer was over/.test(e.message) ? new AccountFilesFull(filesFullMessage(account)) : e);
  let res: Response;
  try {
    res = await outputFetch(o.url, { headers: o.headers }, { maxBytes: left });
  } catch (e) {
    throw full(e);
  }
  if (!res.ok || !res.body) {
    discardBody(res);
    throw new Error(`download ${res.status}`);
  }
  const dest = path.join(scratchDir(), `${generationId}-out-${nanoid(8)}`);
  try {
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>), fs.createWriteStream(dest));
  } catch (e) {
    fs.rmSync(dest, { force: true });
    throw full(e);
  }
  roomFor(account, fs.statSync(dest).size, dest);
  const header = res.headers.get("content-type")?.split(";")[0];
  const given = o.contentType ?? (header && header !== "application/octet-stream" ? header : contentTypeFor(new URL(o.url).searchParams.get("filename") ?? o.url));
  const asset = adoptFile({ from: dest, contentType: accountType(given), source: "generation", generationId, accountId: account });
  const meta = relinkMain(linked, o.url, asset.url);
  const text = o.text ?? (asset.kind === "text" && asset.size <= MAX_INLINE_TEXT * 4 ? fs.readFileSync(absolutePath(asset.relPath), "utf8") : undefined);
  return {
    url: asset.url,
    kind: asset.contentType === "application/octet-stream" ? (o.kind ?? asset.kind) : asset.kind,
    contentType: asset.contentType,
    assetId: asset.id,
    ...inlineText(text, meta),
    ...(o.draftId ? { draftId: o.draftId } : {}),
  };
}

/** A result the provider already wrote to the scratch folder (a song's stems): the file, as the type the provider gave. */
function scratchOutput(o: RichOutput): { path: string; contentType?: string } | null {
  const file = scratchOutputFile(o.url);
  return file ? { path: file, contentType: o.contentType } : null;
}

/**
 * A result a computer sent in (its task received and checked it, src/server/computer), or one the provider wrote to the
 * scratch folder: moved into the files folder as it is, no second copy, as the type its bytes said. An account's counts
 * against its files first (a result over its room is removed).
 */
async function persistRelayOutput(o: RichOutput, generationId: string, account: string | undefined, linked: Record<string, unknown> | undefined): Promise<OutputFile> {
  const file = o.url.startsWith("scratch:") ? scratchOutput(o) : relayFile(o.url);
  if (!file) throw new Error("The result isn't here any more");
  const from = file.path;
  const contentType = o.contentType ?? file.contentType ?? "application/octet-stream";
  const size = fs.statSync(from).size;
  if (account) roomFor(account, size, o.url.startsWith("scratch:") ? from : undefined);
  const asset = adoptFile({ from, contentType: account ? accountType(contentType) : contentType, source: "generation", generationId, ...(account && { accountId: account }) });
  const meta = relinkMain(linked, o.url, asset.url);
  const text = o.text ?? (asset.kind === "text" && asset.size <= MAX_INLINE_TEXT * 4 ? fs.readFileSync(absolutePath(asset.relPath), "utf8") : undefined);
  return {
    url: asset.url,
    kind: asset.contentType === "application/octet-stream" ? (o.kind ?? asset.kind) : asset.kind,
    contentType: asset.contentType,
    assetId: asset.id,
    ...inlineText(text, meta),
    ...(o.draftId ? { draftId: o.draftId } : {}),
  };
}

/** Save one result. `pre`: the files it links to, kept already (persistArtifacts runs once for a copy tried again). */
async function persistOutput(o: RichOutput, generationId: string, pre?: { linked: Record<string, unknown> | undefined }): Promise<OutputFile> {
  const linked = pre ? pre.linked : await persistArtifacts(o.meta, generationId, o.url);
  const account = tenantAccount();
  if (o.url?.startsWith("relay:") || o.url?.startsWith("scratch:")) return persistRelayOutput(o, generationId, account, linked);
  if (account && o.url && /^https?:\/\//.test(o.url)) return persistAccountOutput(o, generationId, account, linked);
  let data: Buffer;
  let contentType = o.contentType;
  if (!o.url && o.text !== undefined) {
    data = Buffer.from(o.text);
    contentType ??= "text/plain";
  } else if (o.url.startsWith("sample:")) {
    const file = path.join(process.cwd(), "public", "samples", path.basename(o.url.slice(7)));
    data = fs.readFileSync(file);
    contentType ??= contentTypeFor(file);
  } else if (o.url.startsWith("data:")) {
    const f = await readRef(o.url);
    data = f.data;
    contentType ??= f.contentType;
  } else {
    const res = await outputFetch(o.url, { headers: o.headers });
    if (!res.ok) throw new Error(`download ${res.status}`);
    data = Buffer.from(await res.arrayBuffer());
    const header = res.headers.get("content-type")?.split(";")[0];
    contentType ??= header && header !== "application/octet-stream" ? header : contentTypeFor(new URL(o.url).searchParams.get("filename") ?? o.url);
  }
  if (account) {
    roomFor(account, data.length);
    contentType = accountType(contentType!);
  }
  const asset = saveFile({ data, contentType: contentType!, source: "generation", generationId });
  const meta = relinkMain(linked, o.url, asset.url);
  // A text file's words travel with the generation, so feeds and the next chained step can use them.
  const text = o.text ?? (asset.kind === "text" ? data.toString("utf8") : undefined);
  return {
    url: asset.url,
    kind: asset.kind,
    contentType: asset.contentType,
    assetId: asset.id,
    ...inlineText(text, meta),
    ...(o.draftId ? { draftId: o.draftId } : {}),
  };
}

export async function cancelGeneration(id: string): Promise<void> {
  const r = db().prepare("SELECT * FROM generations WHERE id = ?").get(id) as Row | undefined;
  if (!r || (r.status !== "queued" && r.status !== "running")) return;
  // Its outputs are in and the 3D finish runs: the provider's job is over. Stop the finish before anything
  // awaits, so it can't mark the job done in between.
  if ((JSON.parse(r.external_meta_json ?? "{}") as Record<string, unknown>).finishing) {
    stopModelFinish(id);
    stopWorkerFinish(id);
    markCanceled(id);
    return;
  }
  const model = getModel(r.model_id);
  // Without an external id the job is still being handed over: submit() cancels it as soon as it lands, with the key it
  // was sent with (removing that key, or deleting the account, waits for it: handOversDone).
  if (r.external_id && model) {
    const account = accountOf(r);
    // An account's job is stopped with its own key, also when the account is switched off or about to be deleted.
    const own = account ? accountRun(account, r.provider, "cancel") : undefined;
    // A run on this install's GPUs is stopped there, as the account.
    const onPool = !!account && poolOf(r);
    const cancel = () =>
      Promise.resolve()
        .then(() => adapterFor(r.provider, account).cancel?.(pollContext(r, model)))
        .catch(() => {});
    if (onPool) await runOnPool(account!, cancel);
    else if (!own) await cancel();
    else if ("run" in own) await own.run(cancel);
  }
  stopModelFinish(id);
  stopWorkerFinish(id);
  // Saved meanwhile (here, or by another app process while the provider was asked to stop): it stays as it is.
  if (!markCanceled(id)) return;
  // A run waiting to enter the line leaves it (pool-holds.ts).
  dropHold(id);
  // Steps waiting only to feed this one are dropped too (nothing was spent on them).
  dropUnused(depIds(r.depends_on));
}

/**
 * End a run as canceled, only while it still goes (queued or running: a run held for its output check too). A run that
 * was saved, failed or canceled since the cancel looked at it stays as it is, with its result and its report. A save
 * still under way doesn't stop it: the cancel wins, and that save ends with nothing kept (updateLive). Returns whether
 * the run was canceled.
 */
function markCanceled(id: string): boolean {
  const now = Date.now();
  return db().prepare("UPDATE generations SET status = 'canceled', completed_at = ?, message = NULL, updated_at = ? WHERE id = ? AND status IN ('queued', 'running')").run(now, now, id).changes > 0;
}

/**
 * Stop the runs a new one takes the place of (Run with your key on a waiting run), in the same step that makes the new
 * run (POST /api/generations, inside admitRun's transaction): each one not handed over yet is canceled at once, so a press
 * on another of its batch's tiles, in this app process or another, finds nothing left to take. Its wait sees it at its
 * next look and gives its turn back; a send under way stops its job as it lands (handOver). A failed one stays as it is.
 */
export function stopReplaced(ids: readonly string[]): void {
  const pending = db().prepare("SELECT depends_on FROM generations WHERE id = ? AND status = 'queued' AND external_id IS NULL");
  for (const id of ids) {
    const r = pending.get(id) as Pick<Row, "depends_on"> | undefined;
    if (r && markCanceled(id)) dropUnused(depIds(r.depends_on));
  }
}

// ---------------------------------------------------------------------------
// Fuobe Soul's post steps (the look's grade and overlay), made in the browser when the result arrives.

/** The aspect ratio a stored request asked for (Soul Cinema's 21:9 is made at 16:9 and cropped). */
function requestAspect(json: string): string | undefined {
  try {
    return (JSON.parse(json) as GenerationRequest).params?.aspectRatio;
  } catch {
    return undefined;
  }
}

export class FinishError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Keep the finished picture of a Soul result in place of the raw one: the raw one stays as meta.original (its
 * file is still the generation's), meta.finished marks it done. The first finished copy wins: another tab's
 * answer is 409, and an output with nothing left to do is refused.
 */
export function finishOutput(id: string, index: number, png: Buffer): Generation {
  const r = db().prepare("SELECT * FROM generations WHERE id = ?").get(id) as Row | undefined;
  if (!r) throw new FinishError("Not found", 404);
  if (r.status !== "succeeded") throw new FinishError("The result isn't ready yet", 409);
  const outputs = JSON.parse(r.outputs_json) as OutputFile[];
  const o = outputs[index];
  if (!o || !Number.isInteger(index)) throw new FinishError("No such output", 404);
  if (o.meta?.finished) throw new FinishError("Already finished", 409);
  if (!finishSteps(o)) throw new FinishError("This output has no grade or overlay to apply", 400);
  const asset = saveFile({ data: png, contentType: "image/png", name: `${id}-${index}-finished.png`, source: "generation", generationId: id });
  outputs[index] = { ...o, url: asset.url, assetId: asset.id, contentType: "image/png", meta: { ...o.meta, finished: true, original: o.url } };
  update(id, { outputs_json: JSON.stringify(outputs) });
  return getGeneration(id, { includeDeleted: true })!;
}

// ---------------------------------------------------------------------------
// Results made in the browser (colour grading): stored as finished generations.

/**
 * A live edit saved to the Library (the owner's): the kept master as the result, the steps that made it in
 * params.liveSteps, the joined step texts as the prompt. It ran on the owner's GPU already, so nothing is queued.
 */
export function recordLiveEdit(input: { master: string; original?: string; steps: { text: string; seed: number }[]; from?: string }): Generation {
  const model = getModel("oss-qwen-image-21-live");
  if (!model) throw new Error("Live edit's model is missing");
  const now = Date.now();
  const prompt = input.steps.map((s) => s.text).filter(Boolean).join(" · ").slice(0, 2000) || "Live edit";
  const op: Generation["op"] = input.original ? "edit" : "t2i";
  const req: GenerationRequest = {
    feature: "live-edit",
    modelId: model.id,
    op,
    prompt,
    inputs: input.original ? { images: [input.original] } : {},
    params: { extra: { liveSteps: input.steps, ...(input.from && { from: input.from }) } },
  };
  const row: Row = {
    id: nanoid(12),
    batch_id: null,
    feature: "live-edit",
    preset_id: null,
    model_id: model.id,
    engine: model.engine,
    provider: "comfyui",
    op,
    kind: "image",
    status: "succeeded",
    progress: 1,
    message: null,
    prompt,
    request_json: JSON.stringify(req),
    provider_input_json: null,
    external_id: "live",
    external_meta_json: null,
    outputs_json: JSON.stringify([{ url: input.master, kind: "image", contentType: "image/png" }]),
    error: null,
    cost_usd: 0,
    favorite: 0,
    created_at: now,
    updated_at: now,
    completed_at: now,
    depends_on: null,
  };
  db()
    .prepare(`INSERT INTO generations (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map((k) => `@${k}`).join(", ")})`)
    .run(row);
  return toGeneration(row);
}

export function recordLocalGeneration(input: {
  feature: string;
  modelId: string;
  op: Generation["op"];
  prompt: string;
  /** What the tool calls its result, shown instead of the prompt. */
  title?: string;
  inputs: GenerationRequest["inputs"];
  params?: GenerationRequest["params"];
  output: { url: string; kind: OutputFile["kind"]; contentType?: string; meta?: { poster: string }; width?: number; height?: number };
}): Generation {
  const model = getModel(input.modelId);
  // A browser tool's own result: the model's local route for this very step (a grade is not recorded as a Relight blend).
  if (!model || !model.routes.some((r) => r.provider === "local" && r.op === input.op)) throw new Error("Not a browser tool");
  const now = Date.now();
  // Inside an account's work (the route's runAsTenant) the result is the account's own, as its runs are (stampTenant).
  const account = tenantAccount();
  const req: GenerationRequest = { feature: input.feature, modelId: input.modelId, op: input.op, prompt: input.prompt, ...(input.title && { title: input.title }), inputs: input.inputs, params: input.params, ...(account && { account }) };
  const row: Row = {
    id: nanoid(12),
    batch_id: null,
    feature: input.feature,
    preset_id: null,
    model_id: model.id,
    engine: model.engine,
    provider: "local",
    op: input.op,
    kind: input.output.kind,
    status: "succeeded",
    progress: 1,
    message: null,
    prompt: input.prompt,
    request_json: JSON.stringify(req),
    provider_input_json: null,
    external_id: "local",
    external_meta_json: null,
    outputs_json: JSON.stringify([input.output]),
    error: null,
    cost_usd: 0,
    favorite: 0,
    created_at: now,
    updated_at: now,
    completed_at: now,
    depends_on: null,
  };
  db()
    .prepare(`INSERT INTO generations (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map((k) => `@${k}`).join(", ")})`)
    .run(row);
  return toGeneration(row);
}
