import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loraEndpointFor } from "@/lib/catalog/loras";
import { buildPayload, extractOutputs, noOutputsError } from "@/lib/catalog/payload";
import { resultExpired } from "@/lib/diagnose";
import { accountKeyError, balanceRefusal, cloudKey, missingKeyError, originOf, redactKey, standIn } from "../provider-keys";
import { toDataUri } from "../storage";
import { tenant } from "../tenant";
import { falProvider, type KeyCheck } from "./fal";
import { ProviderError, type ProviderAdapter } from "./types";

/**
 * Replicate predictions API.
 *   POST /v1/models/{owner}/{name}/predictions  { input }   (official models)
 *   POST /v1/predictions { version, input }                  (endpoint "owner/name:version")
 *   GET  /v1/predictions/{id}  → { status: starting|processing|succeeded|failed|canceled, output, error, logs }
 *   POST /v1/predictions/{id}/cancel
 *
 * The token is the run's own (provider-keys.ts cloudKey: an account's run sends its own token, never the studio's), and
 * it goes to Replicate's API only.
 */
const HOST = "https://api.replicate.com";

/** Replicate's API: the real one, or a stand-in on this machine in tests and `next dev` (provider-keys.ts standIn). */
const api = () => `${standIn("replicate") ?? HOST}/v1`;

function token(): string {
  return cloudKey("replicate");
}

/**
 * Replicate's own deadline for a prediction (the Cancel-After header, counted from when it is created): the longest
 * Fuobe waits for it to start (4 hours; an account's run 30 minutes, account-files.ts ACCOUNT_LIMITS.queueMs) plus the
 * longest it may run (45 minutes), as generations.ts pollOne counts them. A cancel that never reaches Replicate (a
 * restart, a network error, a hand-over that lost its race) can't leave a job running: past the deadline Replicate stops
 * it, as "aborted" when it never started (not billed). https://replicate.com/docs/topics/predictions/create-a-prediction#prediction-deadlines
 */
const cancelAfter = () => `${(tenant() ? 30 : 4 * 60) * 60 + 45 * 60}s`;

/** Replicate deletes an API prediction's output an hour after it is made: what a run says when it was too late. */
export const RESULT_REMOVED = "Replicate deleted this result an hour after it was made, before Fuobe could save it. Press Retry to make it again.";

/**
 * How long Replicate asks to wait after a 429: its Retry-After header (seconds or a date), else its words ("Expected
 * available in 30 seconds", "Your rate limit resets in ~30s"). https://replicate.com/docs/topics/predictions/rate-limits
 */
export function retryAfterOf(header: string | null, detail: unknown): number | undefined {
  if (header) {
    const s = Number(header);
    if (Number.isFinite(s) && s > 0) return Math.ceil(s);
    const at = Date.parse(header);
    if (!Number.isNaN(at)) return Math.max(1, Math.ceil((at - Date.now()) / 1000));
  }
  const m = typeof detail === "string" ? /(?:available in|resets in)\s*~?\s*(\d+)\s*s/i.exec(detail) : null;
  return m ? Number(m[1]) : undefined;
}

async function rFetch(url: string, init: RequestInit = {}): Promise<unknown> {
  const t = token();
  if (!t && tenant()) throw missingKeyError("replicate");
  const origin = originOf(url);
  if (origin !== HOST && origin !== standIn("replicate")) throw new ProviderError("That address is outside Replicate, so Fuobe didn't send the token there");
  // A hung call fails in time (a submit or a file 60 s; a status or a cancel 20 s), never holding a run for minutes.
  const short = !init.method || init.method === "GET" || /\/cancel$/.test(url);
  const res = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(short ? 20_000 : 60_000),
    headers: { Authorization: `Bearer ${t}`, ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const b = body as { detail?: string; title?: string };
    // A provider's error may echo the request: the token never reaches a message, a row or a log.
    const said = redactKey(`replicate ${res.status}: ${b?.detail ?? b?.title ?? String(text).slice(0, 300)}`, t);
    const err = accountKeyError("replicate", res.status, said, t) ?? new ProviderError(said, res.status);
    // A throttled call keeps how long Replicate asked to wait (generations.ts waits that long before it asks again).
    const after = res.status === 429 || res.status >= 500 ? retryAfterOf(res.headers.get("retry-after"), b?.detail) : undefined;
    throw after ? Object.assign(err, { retryAfterS: after }) : err;
  }
  return body;
}

/** Replicate's Files API takes files under 100 MB (POST /v1/files answers 413 "Files must be less than 100MB in size"). */
export const REPLICATE_FILE_MAX = 100 * 1000 * 1000;

/** A file sent through Replicate's Files API (multipart field `content`): its `urls.get` is the input. */
async function upload(data: Buffer, contentType: string, name: string): Promise<string> {
  const form = new FormData();
  form.append("content", new Blob([new Uint8Array(data)], { type: contentType }), name);
  const file = (await rFetch(`${api()}/files`, { method: "POST", body: form })) as { urls: { get: string } };
  return file.urls.get;
}

/**
 * The speech of a recording or clip as a small mono Opus file (16 kHz, 32 kbps: about 15 MB an hour), for a transcript
 * whose file is too big for Replicate's Files API. Null when ffmpeg can't make one.
 */
function speechCopy(data: Buffer): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let dir: string;
    try {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-speech-"));
      fs.writeFileSync(path.join(dir, "in"), data);
    } catch {
      return resolve(null);
    }
    const out = path.join(dir, "speech.ogg");
    const done = (ok: boolean) => {
      let copy: Buffer | null = null;
      try {
        if (ok) copy = fs.readFileSync(out);
      } catch {}
      fs.rmSync(dir, { recursive: true, force: true });
      resolve(copy);
    };
    const args = ["-hide_banner", "-loglevel", "error", "-y", "-threads", "2", "-i", path.join(dir, "in"), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "32k", out];
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(process.env.FFMPEG_PATH || "ffmpeg", args, { stdio: ["ignore", "ignore", "ignore"] });
    } catch {
      return done(false);
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), 10 * 60_000);
    child.on("error", () => {
      clearTimeout(timer);
      done(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      done(code === 0);
    });
  });
}

/**
 * The most file data one create request carries inline, as data URIs. Replicate's own client refuses more ("Combined
 * filesize of prediction ... exceeds 10mb limit for inline encoding, please provide URLs instead", MAX_DATA_URI_SIZE in
 * https://github.com/replicate/replicate-javascript/blob/main/lib/util.js), and the docs recommend a data URI only for a
 * file under 1 MB (https://replicate.com/docs/topics/predictions/input-files). Many references (14 pictures, 24 H3
 * references) can each be under 1 MB but not together: past the cap, the largest go through the Files API instead.
 */
export const INLINE_MAX_BYTES = 10_000_000;

async function capInline(payload: Record<string, unknown>): Promise<void> {
  const inline: { at: Record<string | number, unknown>; key: string | number; uri: string }[] = [];
  const walk = (v: unknown): void => {
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === "string" && x.startsWith("data:")) inline.push({ at: v as Record<string | number, unknown>, key: Array.isArray(v) ? Number(k) : k, uri: x });
      else walk(x);
    }
  };
  walk(payload);
  const bytes = (uri: string) => Math.floor(((uri.length - uri.indexOf(",") - 1) * 3) / 4);
  let total = inline.reduce((n, f) => n + bytes(f.uri), 0);
  for (const f of inline.sort((a, b) => b.uri.length - a.uri.length)) {
    if (total <= INLINE_MAX_BYTES) break;
    const head = /^data:([^;,]*)[^,]*;base64,/.exec(f.uri);
    if (!head) continue;
    const type = head[1] || "application/octet-stream";
    f.at[f.key] = await upload(Buffer.from(f.uri.slice(head[0].length), "base64"), type, `input.${type.split("/")[1]?.split("+")[0] || "bin"}`);
    total -= bytes(f.uri);
  }
}

export const replicateProvider: ProviderAdapter = {
  id: "replicate",
  label: "Replicate",
  isConfigured: () => !!token(),

  async prepareFile(data, contentType, name, route) {
    // A file list the model reads as plain text ("Public URLs": H3 Lite's and HighSpeed's reference_*_urls, FieldMap.publicLinks):
    // Replicate passes it on as it is, so neither a data: URI nor a Files API link (which needs the token) can be read there.
    // The file goes to fal.ai's storage, a public https link, when a fal.ai key is set; otherwise the run stops before its job.
    if (route?.map?.publicLinks) {
      if (!falProvider.isConfigured()) {
        throw new ProviderError("This model on Replicate reads reference files only as public web links: add a fal.ai key in Settings, and Fuobe hosts them there");
      }
      return falProvider.prepareFile(data, contentType, name);
    }
    if (data.length < 1_000_000) return toDataUri(data, contentType);
    let [body, type, fileName] = [data, contentType, name];
    // A transcript needs only the speech (Scribe v2 takes Ogg Opus): a recording or clip of 100 MB or more goes as a small copy.
    if (data.length >= REPLICATE_FILE_MAX && route?.op === "transcribe" && /^(audio|video)\//.test(contentType)) {
      const speech = await speechCopy(data);
      if (speech?.length) [body, type, fileName] = [speech, "audio/ogg", `${name.replace(/\.[^.]+$/, "")}.ogg`];
    }
    // Sent anyway, a file this big only comes back as Replicate's 413, after the whole upload.
    if (body.length >= REPLICATE_FILE_MAX)
      throw new ProviderError(`Replicate takes files under 100 MB, and this one is ${Math.round(body.length / 1e6)} MB. Run it with a fal key, or pick a shorter or smaller file.`, 413);
    return upload(body, type, fileName);
  },

  async submit({ route, input }) {
    const payload = buildPayload(route.map ?? {}, input);
    // Many small files together go through the Files API past Replicate's inline cap (the rest stay data URIs).
    await capInline(payload);
    // LoRAs go in the route's own fields (lora_weights[] / one per Wan 2.2 expert) or its LoRA model.
    let endpoint: string;
    try {
      endpoint = loraEndpointFor(route, input.loras);
    } catch (e) {
      throw new ProviderError((e as Error).message);
    }
    const [slug, version] = endpoint.split(":");
    const res = (await (version
      ? rFetch(`${api()}/predictions`, { method: "POST", headers: { "Cancel-After": cancelAfter() }, body: JSON.stringify({ version, input: payload }) })
      : rFetch(`${api()}/models/${slug}/predictions`, { method: "POST", headers: { "Cancel-After": cancelAfter() }, body: JSON.stringify({ input: payload }) }))) as {
      id: string;
    };
    return { externalId: res.id, payload };
  },

  async poll({ externalId, route }) {
    const p = (await rFetch(`${api()}/predictions/${externalId}`)) as {
      status: string;
      output: unknown;
      error?: string;
      logs?: string;
      data_removed?: boolean;
    };
    if (p.status === "starting") return { state: "queued", message: "Starting" };
    if (p.status === "processing") {
      const last = p.logs?.trim().split("\n").at(-1);
      const pct = last ? /(\d{1,3})%/.exec(last)?.[1] : undefined;
      return { state: "running", progress: pct ? Number(pct) / 100 : undefined, message: last ?? "Processing" };
    }
    if (p.status === "succeeded") {
      // Collected over an hour after it was made (a server that was down that long): Replicate has deleted the output.
      if (p.data_removed && (p.output === null || p.output === undefined)) return { state: "failed", error: RESULT_REMOVED, trouble: resultExpired() };
      // Object outputs (Scribe's {text, words}) are read as the result itself; URL lists keep their order (layers).
      const outputs = extractOutputs({ output: p.output }, route?.op);
      if (!outputs.length) return { state: "failed", error: noOutputsError({ output: p.output }) };
      return { state: "succeeded", outputs };
    }
    return { state: "failed", error: p.error ?? p.status };
  },

  async cancel({ externalId }) {
    await rFetch(`${api()}/predictions/${externalId}/cancel`, { method: "POST" }).catch(() => {});
  },

  async test() {
    const { ok, detail } = await testReplicateKey(token());
    return { ok, detail };
  },
};

/** Check a Replicate token, and only that token (Settings' "Save & test", an account's Your keys): who it signs in as. Free. */
export async function testReplicateKey(t: string): Promise<KeyCheck> {
  if (!t) return { ok: false, detail: "No token set", reason: "rejected" };
  let res: Response;
  try {
    res = await fetch(`${api()}/account`, { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    return { ok: false, detail: redactKey(`Can't reach Replicate (${(e as Error).message})`, t), reason: "unreachable" };
  }
  const text = await res.text().catch(() => "");
  let body: { username?: string; detail?: string; title?: string } = {};
  try {
    body = JSON.parse(text);
  } catch {}
  if (res.ok) return { ok: true, detail: `Signed in as ${body.username ?? "unknown"}` };
  const said = redactKey(`replicate ${res.status}: ${body.detail ?? body.title ?? text.slice(0, 300)}`, t);
  // No credit left (402): the token works.
  const reason = balanceRefusal(res.status, text) ? "balance" : res.status === 401 || res.status === 403 ? "rejected" : "odd";
  return { ok: false, detail: said, reason, status: res.status };
}
