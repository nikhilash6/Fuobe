import "server-only";
import fs from "node:fs";
import { createFalClient } from "@fal-ai/client";
import { loraEndpointFor, routeLoraField } from "@/lib/catalog/loras";
import { buildPayload, extractOutputs, noOutputsError } from "@/lib/catalog/payload";
import { accountKeyError, balanceRefusal, cloudKey, missingKeyError, originOf, redactKey, standIn } from "../provider-keys";
import { tenant, tenantAccount } from "../tenant";
import { unzip } from "../unzip";
import { ACCOUNT_MESSAGES, accountTotalBytes, accountUsage, diskHasRoom, filesFullMessage, RETENTION_MS } from "../account-files";
import { discardBody, fetchPublic, RemoteFetchError } from "../remote-fetch";
import { newScratchOutput } from "../storage";
import type { FieldMap } from "@/lib/catalog/types";
import { resultExpired } from "@/lib/diagnose";
import { ProviderError, type CancelOutcome, type ProviderAdapter } from "./types";

/**
 * fal.ai queue API.
 *   submit: POST https://queue.fal.run/<endpoint>            → { request_id, status_url, response_url, cancel_url }
 *   status: GET  <status_url>?logs=1                          → { status: IN_QUEUE | IN_PROGRESS | COMPLETED, logs }
 *   result: GET  <response_url>                               → model output (or { detail } on failure)
 *   cancel: PUT  <cancel_url>
 * We always use the URLs returned at submit time: for nested endpoint ids
 * (fal-ai/kling-video/v2.5-turbo/pro/image-to-video) the status/result paths drop the sub-path.
 *
 * The key is the run's own (provider-keys.ts cloudKey: an account's run sends its own key, never the studio's), and it
 * goes to fal.ai's own hosts only.
 */
const QUEUE = "https://queue.fal.run";
const REST = "https://rest.fal.ai";
/** fal.ai's synchronous runs: a song tool's song sent first through the provider's files/upload (Mureka's), which answers at once. */
const RUN = "https://fal.run";

/** fal.ai's queue: the real one, or a stand-in on this machine in tests and `next dev` (provider-keys.ts standIn). */
export const falQueue = () => standIn("fal") ?? QUEUE;

/** Where a fal.ai key may go: the queue and the REST API (storage uploads), or the stand-in. */
function keyOrigin(url: string): boolean {
  const o = originOf(url);
  return o === QUEUE || o === REST || o === RUN || (!!o && o === standIn("fal"));
}

/** A synchronous fal.ai run: the real one, or the stand-in in tests and `next dev`. */
const falRun = () => standIn("fal") ?? RUN;

/**
 * A song tool's song that isn't one of the provider's own, sent first through its files/upload (FieldMap.songSource: Mureka's,
 * $0.01, priced as Pricing.uploadUsd): the id the tool then takes.
 */
async function uploadSong(upload: { endpoint: string; purpose: string }, fileUrl: string): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    let res: { id?: unknown };
    try {
      res = (await falFetch(`${falRun()}/${upload.endpoint}`, { method: "POST", body: JSON.stringify({ file_url: fileUrl, purpose: upload.purpose }) })) as { id?: unknown };
    } catch (e) {
      // fal.ai never retries a synchronous run: one it marks temporary (X-Fal-Needs-Retry: 1, its sync API reference: a busy
      // runner, a concurrency limit, a timeout before it started) is sent again, twice at most.
      if ((e as { needsRetry?: boolean } | null)?.needsRetry && attempt < UPLOAD_RETRY_MS.length) {
        await new Promise((r) => setTimeout(r, UPLOAD_RETRY_MS[attempt]));
        continue;
      }
      throw e;
    }
    if (typeof res?.id !== "string" || !res.id) throw Object.assign(new ProviderError("We couldn't send the song. Press Retry."), { said: "Mureka gave no file id" });
    return res.id;
  }
}

/** The waits before a song's upload is sent again after fal.ai marks it temporary (X-Fal-Needs-Retry: 1). */
const UPLOAD_RETRY_MS = [1000, 3000];

/** The most a stems download may be, and how long it may take: past either, it stops and the run fails. */
const STEMS_MAX_BYTES = 256 * 1024 * 1024;
const STEMS_WAIT_MS = 3 * 60 * 1000;

/** A download read with a byte count: past `max` bytes (declared or streamed) it stops at once, never held whole. */
async function bytesWithin(res: Response, max: number): Promise<Buffer> {
  const tooBig = () => new Error("The stems download is larger than Fuobe keeps from one result");
  if (Number(res.headers.get("content-length")) > max) {
    res.body?.cancel().catch(() => {});
    throw tooBig();
  }
  const reader = res.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      reader.cancel().catch(() => {});
      throw tooBig();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

/** An account's stems: a smaller zip and less unpacked than the owner's, and never more than its files have room for. */
const ACCOUNT_STEMS_MAX_BYTES = 128 * 1024 * 1024;
const ACCOUNT_STEMS_UNPACKED_BYTES = 256 * 1024 * 1024;

/**
 * The stems a song tool answers with in one zip (Mureka's zip_url), one result each, named by their file (meta.stem).
 * Each stem is written to the scratch folder as it is unpacked (a `scratch:` result, moved into the run's files when it
 * is saved), never held as a data: URL. An account's zip comes from public addresses only (fetchPublic), within what its
 * files have room for.
 */
export async function stemsFromZip(
  zipUrl: string,
  limits: { maxBytes?: number; waitMs?: number } = {},
): Promise<{ url: string; kind: "audio"; contentType: string; meta: { stem: string } }[]> {
  const account = tenantAccount();
  let maxBytes = limits.maxBytes ?? (account ? ACCOUNT_STEMS_MAX_BYTES : STEMS_MAX_BYTES);
  let unpacked = account ? ACCOUNT_STEMS_UNPACKED_BYTES : 2 * maxBytes;
  let left = Infinity;
  if (account) {
    left = accountTotalBytes(account) - accountUsage(account).total;
    if (left <= 0) throw new Error(filesFullMessage(account));
    if (!diskHasRoom()) throw new Error(ACCOUNT_MESSAGES.diskLow);
    maxBytes = Math.min(maxBytes, left);
    unpacked = Math.min(unpacked, left);
  }
  const waitMs = limits.waitMs ?? STEMS_WAIT_MS;
  const tooBig = () => new Error(account && left <= maxBytes ? filesFullMessage(account) : "The stems download is larger than Fuobe keeps from one result");
  let zipped: Buffer;
  try {
    // The stand-in fal.ai (tests and `next dev`) is on this machine: only it skips the public-address check.
    const res =
      account && originOf(zipUrl) !== standIn("fal")
        ? await fetchPublic(zipUrl, {}, { maxBytes, deadlineMs: waitMs, timeoutMs: Math.min(waitMs, 60_000) })
        : await fetch(zipUrl, { signal: AbortSignal.timeout(waitMs) });
    if (!res.ok) {
      discardBody(res);
      throw new Error(`The stems couldn't be downloaded (${res.status})`);
    }
    zipped = await bytesWithin(res, maxBytes);
  } catch (e) {
    const err = e as Error;
    if (err.name === "TimeoutError" || err.name === "AbortError") throw new Error("The stems took too long to download. Try again.");
    if (err instanceof RemoteFetchError && /took over|Timed out/.test(err.message)) throw new Error("The stems took too long to download. Try again.");
    if (err instanceof RemoteFetchError && /^The answer was over/.test(err.message)) throw tooBig();
    if (/^The stems download is larger/.test(err.message)) throw tooBig();
    throw e;
  }
  const outputs: { url: string; kind: "audio"; contentType: string; meta: { stem: string } }[] = [];
  const written: string[] = [];
  try {
    await unzip(zipped, {
      maxBytes: unpacked,
      only: (name) => AUDIO_FILE.test(name),
      onEntry: (name, data) => {
        const ext = AUDIO_FILE.exec(name)![1].toLowerCase();
        const contentType = AUDIO_TYPES[ext] ?? "audio/mpeg";
        const stem = name.split("/").pop()!.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().toLowerCase();
        const out = newScratchOutput(ext);
        written.push(out.file);
        fs.writeFileSync(out.file, data);
        outputs.push({ url: out.url, kind: "audio", contentType, meta: { stem } });
      },
    });
  } catch (e) {
    for (const f of written) fs.rmSync(f, { force: true });
    if (account && left <= unpacked && /more than Fuobe keeps/.test((e as Error).message)) throw new Error(filesFullMessage(account));
    throw e;
  }
  if (!outputs.length) throw new Error("The stems archive held no audio");
  return outputs;
}

const AUDIO_FILE = /\.(mp3|wav|flac|m4a|ogg)$/i;
const AUDIO_TYPES: Record<string, string> = { mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", m4a: "audio/mp4", ogg: "audio/ogg" };

function key(): string {
  return cloudKey("fal");
}

/**
 * How long a call to fal.ai may take: a submit or a result 60 s, a status or a cancel 20 s. A hung call fails (a status is
 * asked again later; a submit isn't sent twice by itself, as its job may exist) instead of holding the run for minutes.
 */
export const FAL_CALL_MS = { long: 60_000, short: 20_000 };

/**
 * How long fal.ai keeps the files Fuobe puts on its CDN, in seconds: an upload as long as Fuobe keeps an upload, the files
 * a job makes as long as Fuobe keeps a run (account-files.ts RETENTION_MS, as the Privacy page says). Unset, fal.ai keeps
 * them public to anyone with the link, with no end (its default; fal.ai docs: Platform Headers,
 * X-Fal-Object-Lifecycle-Preference). Fuobe copies a result as soon as it is made, and sends a mirrored LoRA again well
 * inside both (loras.ts MIRROR_TTL_MS). A training's LoRA gets none (training.ts): fal's copy may be the only one.
 */
export const FAL_KEEP_S = { upload: RETENTION_MS.upload / 1000, result: RETENTION_MS.run / 1000 };
/** The queue submit's header that sets it for the files the job makes. */
const RESULT_LIFECYCLE = { "X-Fal-Object-Lifecycle-Preference": JSON.stringify({ expiration_duration_seconds: FAL_KEEP_S.result }) };

export async function falFetch(url: string, init: RequestInit = {}): Promise<unknown> {
  const k = key();
  if (!k && tenant()) throw missingKeyError("fal");
  // A status, result or cancel address is the one fal.ai gave at submit: the key goes to fal.ai's own hosts only.
  if (!keyOrigin(url)) throw new ProviderError("fal.ai gave an address outside fal.ai, so Fuobe didn't send the key there");
  const short = /\/(status|cancel)(\?|$)/.test(url) || init.method === "PUT";
  const res = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(short ? FAL_CALL_MS.short : FAL_CALL_MS.long),
    headers: { Authorization: `Key ${k}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    // A provider's error may echo the request: the key never reaches a message, a row or a log.
    const said = redactKey(`fal ${res.status}: ${describeError(body)}`, k);
    const err = accountKeyError("fal", res.status, said, k) ?? new ProviderError(said, res.status);
    // fal.ai's mark of a temporary failure that a retry can get past (X-Fal-Needs-Retry: 1): read by the synchronous upload.
    if (res.headers.get("x-fal-needs-retry") === "1") Object.assign(err, { needsRetry: true });
    throw err;
  }
  return body;
}

/**
 * The fal client's requests. The client adds the key on calls to fal.ai's REST API only (a file's upload address gets
 * none); this keeps it so. In tests and `next dev` the REST API is the stand-in.
 */
const clientFetch: typeof fetch = (input, init) => {
  const url = input instanceof Request ? input.url : String(input);
  const local = standIn("fal");
  const target = local && url.startsWith(REST) ? local + url.slice(REST.length) : url;
  const headers = new Headers(init?.headers);
  if (!keyOrigin(target)) headers.delete("authorization");
  return fetch(target, { ...init, headers });
};

function describeError(body: unknown): string {
  if (typeof body === "string") return body.slice(0, 500);
  const b = body as { detail?: unknown; error?: unknown; message?: unknown; type?: unknown; error_type?: unknown };
  const d = b.detail ?? b.error ?? b.message ?? body;
  if (Array.isArray(d)) {
    return d
      // Each error's `type` too (fal.ai Model Errors: content_policy_violation, image_too_large...): fal.ai says to rely on it,
      // never on `msg`, whose words change from model to model.
      .map((e: { loc?: unknown[]; msg?: string; type?: unknown }) => `${(e.loc ?? []).join(".")}: ${e.msg ?? JSON.stringify(e)}${errorKind(e.type)}`)
      .join("; ");
  }
  // fal.ai's machine-readable reason, when it gives one (DetailError.type: rejected_key, permission_denied,
  // resource_restricted; RequestError.error_type: startup_timeout, runner_disconnected...): it tells a refused key from a key
  // that may not run this model, and a passing failure from one to fix (src/lib/diagnose.ts).
  return (typeof d === "string" ? d : JSON.stringify(d).slice(0, 500)) + errorKind(b.type ?? b.error_type);
}

/** fal.ai's category of an error, as " (content_policy_violation)", or "" when it gives none that reads as one. */
function errorKind(kind: unknown): string {
  return typeof kind === "string" && /^[a-z_.]{3,60}$/.test(kind) ? ` (${kind})` : "";
}

/**
 * Why a job fal.ai finished as failed (status COMPLETED with `error`): its result, which fal.ai answers with the job's own
 * error (a model's 422 detail[]: a content flag, an image too large; a timeout's detail). The status's `error` is only
 * "Invalid status code: 422" for those. The status's words when the result says nothing more or can't be read.
 */
async function failedJobWords(responseUrl: unknown, statusError: string): Promise<string> {
  if (typeof responseUrl !== "string" || !responseUrl) return statusError;
  try {
    await falFetch(responseUrl);
  } catch (e) {
    // The job's own error, not a passing one (the key, busy, a gateway) nor no answer: those keep the status's words.
    if (e instanceof ProviderError && typeof e.status === "number" && ![401, 402, 403, 404, 429, 502, 503].includes(e.status)) return e.message;
  }
  return statusError;
}

/** A plain file name with an extension to upload under ("x.safetensors", "dataset.zip"), or undefined. */
function fileName(name: string | undefined): string | undefined {
  const base = name?.split(/[\\/]/).pop()?.trim();
  return base && /^[\w.\-()[\] ]{1,200}\.[A-Za-z0-9]{1,12}$/.test(base) && !base.startsWith(".") ? base : undefined;
}

/** How long the clone step of a two-step voice may take (it is a few seconds of work on fal). */
const CLONE_WAIT_MS = 3 * 60 * 1000;

/**
 * Step 1 of a two-step voice (FieldMap.cloneFirst): the sample (and what it says) to the clone endpoint, waited for on its
 * queue, and the URL of the file it returns (Qwen3-TTS's speaker_embedding safetensors).
 */
export async function cloneVoice(cf: NonNullable<FieldMap["cloneFirst"]>, audio: string, transcript?: string, waitMs = CLONE_WAIT_MS): Promise<string> {
  const body = { [cf.audio]: audio, ...(cf.text && transcript?.trim() && { [cf.text]: transcript.trim() }) };
  const job = (await falFetch(`${falQueue()}/${cf.endpoint}`, { method: "POST", body: JSON.stringify(body), headers: RESULT_LIFECYCLE })) as {
    status_url: string;
    response_url: string;
    cancel_url?: string;
  };
  const until = Date.now() + waitMs;
  for (let wait = 500; ; wait = Math.min(wait * 1.5, 3000)) {
    const st = (await falFetch(job.status_url)) as { status?: string; error?: string };
    if (st.status === "COMPLETED") {
      // fal.ai's own words go to the run's details line (the job's result holds the model's own); the sentence is plain.
      if (st.error) throw Object.assign(new ProviderError("We couldn't copy this voice. Try a longer, clearer sample, or press Retry."), { said: await failedJobWords(job.response_url, st.error) });
      break;
    }
    if (Date.now() + wait > until) {
      // Still queued or running: cancelled on fal.ai (its queue API: PUT cancel_url), so it isn't billed while the run fails
      // and a retry clones the sample again.
      if (job.cancel_url) await falFetch(job.cancel_url, { method: "PUT" }).catch(() => {});
      throw new ProviderError("Cloning the voice took too long. Try again.");
    }
    await new Promise((r) => setTimeout(r, wait));
  }
  const result = (await falFetch(job.response_url)) as Record<string, unknown>;
  const file = result?.[cf.output] as { url?: unknown } | string | undefined;
  const url = typeof file === "string" ? file : typeof file?.url === "string" ? file.url : undefined;
  if (!url) throw new ProviderError("Couldn't clone the voice: the sample gave no voice back. Try a longer, cleaner sample.");
  return url;
}

export const falProvider: ProviderAdapter = {
  id: "fal",
  label: "fal.ai",
  isConfigured: () => !!key(),

  async prepareFile(data, contentType, name) {
    // Always a key as a string ("" too): left out, the fal client would take FAL_KEY from the environment.
    const k = key();
    if (!k && tenant()) throw missingKeyError("fal");
    const client = createFalClient({ credentials: k, fetch: clientFetch, suppressLocalCredentialsWarning: true });
    // The file keeps its name (and so its extension): an unnamed blob is stored as "<time>.<subtype>", and
    // a LoRA mirrored as application/octet-stream would land at ….octet, which loaders that go by the
    // extension (fal's LTX-2.3 quality takes only .safetensors URLs) refuse.
    const blob = fileName(name) ? new File([new Uint8Array(data)], fileName(name)!, { type: contentType }) : new Blob([new Uint8Array(data)], { type: contentType });
    try {
      // Kept on fal.ai's CDN as long as Fuobe keeps an upload, not for ever (the client sends it with the upload's start).
      return await client.storage.upload(blob, { lifecycle: { expiresIn: FAL_KEEP_S.upload } });
    } catch (e) {
      const status = (e as { status?: number }).status ?? 0;
      // fal.ai's reason is in the error body's `detail`; the client's message is only `message` or the status text.
      const body = (e as { body?: unknown }).body;
      const said = redactKey(`fal ${status || "upload"}: ${body != null && typeof body === "object" ? describeError(body) : (e as Error).message}`, k);
      throw accountKeyError("fal", status, said, k) ?? new ProviderError(said, status || undefined);
    }
  },

  async submit({ route, input }) {
    // A voice sample the endpoint can't take is cloned first (Qwen3-TTS: clone-voice makes an embedding file, which the
    // text-to-speech call speaks with). A saved voice that already has its file skips the clone (src/server/voices.ts).
    const cf = route.map?.cloneFirst;
    let embedding: string | undefined;
    if (cf && input.voiceAudio && !input.voiceEmbedding) {
      embedding = await cloneVoice(cf, input.voiceAudio, input.voiceTranscript);
      input = { ...input, voiceEmbedding: embedding };
    }
    // LoRAs (trained identities, a recipe's looks and motions) go in the route's LoRA field (FieldMap.loras:
    // `transformer` per file on Wan 2.2, `weight_name`, at most the API's maximum) and switch to its LoRA endpoint.
    const map = { ...route.map, loras: routeLoraField(route) };
    const payload = buildPayload(map, input);
    // A song tool's song that isn't one of the provider's own goes up first (Mureka's files/upload).
    const song = map.songSource;
    if (song && payload[song.songId] === undefined) {
      if (!input.audio) throw new ProviderError("Add the song");
      try {
        payload[song.uploadId] = await uploadSong(song.upload, input.audio);
      } catch (e) {
        throw embedding && e && typeof e === "object" ? Object.assign(e, { voiceEmbedding: embedding }) : e;
      }
    }
    let endpoint: string;
    try {
      endpoint = loraEndpointFor({ ...route, map }, input.loras);
    } catch (e) {
      throw new ProviderError((e as Error).message);
    }
    let res: { request_id: string; status_url: string; response_url: string; cancel_url: string };
    try {
      res = (await falFetch(`${falQueue()}/${endpoint}`, { method: "POST", body: JSON.stringify(payload), headers: RESULT_LIFECYCLE })) as typeof res;
    } catch (e) {
      // The voice it cloned (a billed step) goes with the error: a try again of this run uses it, never clones twice.
      throw embedding && e && typeof e === "object" ? Object.assign(e, { voiceEmbedding: embedding }) : e;
    }
    return {
      externalId: res.request_id,
      meta: { statusUrl: res.status_url, responseUrl: res.response_url, cancelUrl: res.cancel_url, ...(embedding && { voiceEmbedding: embedding }) },
      payload,
    };
  },

  async poll({ meta, route }) {
    const status = (await falFetch(`${meta.statusUrl as string}?logs=1`)) as {
      status: string;
      queue_position?: number;
      logs?: { message: string }[];
      error?: string;
      error_type?: string;
    };
    if (status.status === "IN_QUEUE") {
      return { state: "queued", ...(status.queue_position != null && { position: status.queue_position }), message: status.queue_position != null ? `In queue · position ${status.queue_position + 1}` : "In queue" };
    }
    if (status.status === "IN_PROGRESS") {
      const last = status.logs?.at(-1)?.message;
      const pct = last ? /(\d{1,3})%/.exec(last)?.[1] : undefined;
      return { state: "running", progress: pct ? Number(pct) / 100 : undefined, message: last ?? "Generating" };
    }
    if (status.status === "COMPLETED") {
      // A failed or cancelled job is COMPLETED too, with `error` and `error_type`, its category (fal.ai docs: Request Error
      // Types). Its result holds fal.ai's words for it (never asked again: the job won't change).
      if (status.error) return { state: "failed", error: await failedJobWords(meta.responseUrl, status.error + errorKind(status.error_type)) };
      try {
        const result = await falFetch(meta.responseUrl as string);
        // A song's stems come back as one zip (Mureka): each track becomes a result of its own.
        const zipUrl = route?.op === "song-stems" ? (result as { zip_url?: unknown })?.zip_url : undefined;
        if (typeof zipUrl === "string" && zipUrl) return { state: "succeeded", outputs: await stemsFromZip(zipUrl) };
        // Layers, text blocks, transcripts, 3D models and stems keep their structure (OutputFile.meta / text).
        const outputs = extractOutputs(result, route?.op);
        if (!outputs.length) return { state: "failed", error: noOutputsError(result) };
        // Seedance draft mode: keep the id that finishes this take at 1080p.
        const draftId = /"draft_id"\s*:\s*"([^"]+)"/.exec(JSON.stringify(result))?.[1];
        return { state: "succeeded", outputs: draftId ? outputs.map((o) => ({ ...o, draftId })) : outputs };
      } catch (e) {
        // A finished job whose result fal.ai no longer has: 404, kept 1 hour after it ends (6 minutes from 10 KB) when the
        // fal.ai account doesn't store payloads, or the job is another fal.ai account's (the key was replaced meanwhile).
        // Made, maybe paid, and gone: asking again can't bring it back (fal.ai docs: Queue API, Get request result).
        if (e instanceof ProviderError && e.status === 404) return { state: "failed", error: e.message, trouble: resultExpired() };
        // An account's finished (and paid) job isn't failed for a passing problem collecting it (busy, down, no answer):
        // the runner asks again with a growing wait (generations.ts healPoll).
        const s = (e as { status?: number }).status;
        if (tenantAccount() && e instanceof ProviderError && (s === 429 || (s !== undefined && s >= 500) || (s === undefined && /fetch failed|ECONN|ETIMEDOUT|ENOTFOUND/i.test(e.message)))) throw e;
        if (tenantAccount() && e instanceof TypeError && /fetch failed/i.test(e.message)) throw e;
        // A result call that hung past its time: asked again too.
        if (tenantAccount() && (e as Error | null)?.name === "TimeoutError") throw e;
        return { state: "failed", error: (e as Error).message };
      }
    }
    return { state: "running", message: status.status };
  },

  async cancel({ meta }): Promise<CancelOutcome | void> {
    if (!meta.cancelUrl) return;
    // fal.ai's answer says what happened (fal.ai docs: Queue, "Cancel a Request"): 200 OK took it off the queue (it never
    // runs); 202 CANCELLATION_REQUESTED sent a stop to a running job, which may still finish (and be charged); 400
    // ALREADY_COMPLETED: it finished before the cancel came, so its result is there to collect; 404 NOT_FOUND: no such job
    // for this key.
    try {
      const said = (await falFetch(meta.cancelUrl as string, { method: "PUT" })) as { status?: unknown } | null;
      return said?.status === "OK" ? "removed" : "requested";
    } catch (e) {
      const status = (e as { status?: unknown } | null)?.status;
      if (status === 400 && /ALREADY_COMPLETED/.test(String((e as Error).message))) return "finished";
      if (status === 404) return "gone";
      return "unknown";
    }
  },

  async test() {
    const { ok, detail } = await testFalKey(key());
    return { ok, detail };
  },
};

/**
 * What a key check found: accepted, refused by the provider, a key that works on an account with no balance left, the
 * provider out of reach, or an answer that says nothing.
 */
export type KeyCheck = { ok: true; detail: string } | { ok: false; detail: string; reason: "rejected" | "balance" | "unreachable" | "odd"; status?: number };

/**
 * Check a fal.ai key, and only that key (Settings' "Save & test", an account's Your keys): the status of a request that
 * doesn't exist. Free, and nothing runs: 401/403 means a bad key (or, saying so, an empty balance), 404/422 a key that
 * works. The path is the app's (fal-ai/flux), as fal.ai's status paths are: with an endpoint's sub-path
 * (fal-ai/flux/dev) fal.ai answers 405 to every key.
 */
export async function testFalKey(k: string): Promise<KeyCheck> {
  if (!k) return { ok: false, detail: "No key set", reason: "rejected" };
  let res: Response;
  try {
    res = await fetch(`${falQueue()}/fal-ai/flux/requests/00000000-0000-0000-0000-000000000000/status`, {
      headers: { Authorization: `Key ${k}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return { ok: false, detail: redactKey(`Can't reach fal.ai (${(e as Error).message})`, k), reason: "unreachable" };
  }
  if (res.status === 401 || res.status === 402 || res.status === 403) {
    const text = await res.text().catch(() => "");
    if (balanceRefusal(res.status, text)) return { ok: false, detail: "Key works, but the fal.ai balance is empty: top it up on fal.ai", reason: "balance", status: res.status };
    return { ok: false, detail: `Key rejected (${res.status})`, reason: "rejected", status: res.status };
  }
  if (res.ok || [400, 404, 422].includes(res.status)) return { ok: true, detail: "Key accepted" };
  // A proxy or an outage (405, 407, 5xx) says nothing about the key: don't call it accepted.
  return { ok: false, detail: `Couldn't check the key: fal.ai answered ${res.status}. Try again in a moment`, reason: "odd", status: res.status };
}
