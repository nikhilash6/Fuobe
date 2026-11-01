import "server-only";
import { createFalClient } from "@fal-ai/client";
import { loraEndpointFor, routeLoraField } from "@/lib/catalog/loras";
import { buildPayload, extractOutputs, noOutputsError } from "@/lib/catalog/payload";
import { accountKeyError, balanceRefusal, cloudKey, missingKeyError, originOf, redactKey, standIn } from "../provider-keys";
import { tenant } from "../tenant";
import { ProviderError, type ProviderAdapter } from "./types";

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

/** fal.ai's queue: the real one, or a stand-in on this machine in tests and `next dev` (provider-keys.ts standIn). */
export const falQueue = () => standIn("fal") ?? QUEUE;

/** Where a fal.ai key may go: the queue and the REST API (storage uploads), or the stand-in. */
function keyOrigin(url: string): boolean {
  const o = originOf(url);
  return o === QUEUE || o === REST || (!!o && o === standIn("fal"));
}

function key(): string {
  return cloudKey("fal");
}

export async function falFetch(url: string, init: RequestInit = {}): Promise<unknown> {
  const k = key();
  if (!k && tenant()) throw missingKeyError("fal");
  // A status, result or cancel address is the one fal.ai gave at submit: the key goes to fal.ai's own hosts only.
  if (!keyOrigin(url)) throw new ProviderError("fal.ai gave an address outside fal.ai, so Fuobe didn't send the key there");
  const res = await fetch(url, {
    ...init,
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
    throw accountKeyError("fal", res.status, said, k) ?? new ProviderError(said, res.status);
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
  const b = body as { detail?: unknown; error?: unknown; message?: unknown };
  const d = b.detail ?? b.error ?? b.message ?? body;
  if (Array.isArray(d)) {
    return d
      .map((e: { loc?: unknown[]; msg?: string }) => `${(e.loc ?? []).join(".")}: ${e.msg ?? JSON.stringify(e)}`)
      .join("; ");
  }
  return typeof d === "string" ? d : JSON.stringify(d).slice(0, 500);
}

/** A plain file name with an extension to upload under ("x.safetensors", "dataset.zip"), or undefined. */
function fileName(name: string | undefined): string | undefined {
  const base = name?.split(/[\\/]/).pop()?.trim();
  return base && /^[\w.\-()[\] ]{1,200}\.[A-Za-z0-9]{1,12}$/.test(base) && !base.startsWith(".") ? base : undefined;
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
      return await client.storage.upload(blob);
    } catch (e) {
      const status = (e as { status?: number }).status ?? 0;
      const said = redactKey(`fal ${status || "upload"}: ${(e as Error).message}`, k);
      throw accountKeyError("fal", status, said, k) ?? new ProviderError(said, status || undefined);
    }
  },

  async submit({ route, input }) {
    // LoRAs (trained identities, a recipe's looks and motions) go in the route's LoRA field (FieldMap.loras:
    // `transformer` per file on Wan 2.2, `weight_name`, at most the API's maximum) and switch to its LoRA endpoint.
    const map = { ...route.map, loras: routeLoraField(route) };
    const payload = buildPayload(map, input);
    let endpoint: string;
    try {
      endpoint = loraEndpointFor({ ...route, map }, input.loras);
    } catch (e) {
      throw new ProviderError((e as Error).message);
    }
    const res = (await falFetch(`${falQueue()}/${endpoint}`, {
      method: "POST",
      body: JSON.stringify(payload),
    })) as { request_id: string; status_url: string; response_url: string; cancel_url: string };
    return {
      externalId: res.request_id,
      meta: { statusUrl: res.status_url, responseUrl: res.response_url, cancelUrl: res.cancel_url },
      payload,
    };
  },

  async poll({ meta, route }) {
    const status = (await falFetch(`${meta.statusUrl as string}?logs=1`)) as {
      status: string;
      queue_position?: number;
      logs?: { message: string }[];
      error?: string;
    };
    if (status.status === "IN_QUEUE") {
      return { state: "queued", message: status.queue_position != null ? `In queue · position ${status.queue_position + 1}` : "In queue" };
    }
    if (status.status === "IN_PROGRESS") {
      const last = status.logs?.at(-1)?.message;
      const pct = last ? /(\d{1,3})%/.exec(last)?.[1] : undefined;
      return { state: "running", progress: pct ? Number(pct) / 100 : undefined, message: last ?? "Generating" };
    }
    if (status.status === "COMPLETED") {
      if (status.error) return { state: "failed", error: status.error };
      try {
        const result = await falFetch(meta.responseUrl as string);
        // Layers, text blocks, transcripts, 3D models and stems keep their structure (OutputFile.meta / text).
        const outputs = extractOutputs(result, route?.op);
        if (!outputs.length) return { state: "failed", error: noOutputsError(result) };
        // Seedance draft mode: keep the id that finishes this take at 1080p.
        const draftId = /"draft_id"\s*:\s*"([^"]+)"/.exec(JSON.stringify(result))?.[1];
        return { state: "succeeded", outputs: draftId ? outputs.map((o) => ({ ...o, draftId })) : outputs };
      } catch (e) {
        return { state: "failed", error: (e as Error).message };
      }
    }
    return { state: "running", message: status.status };
  },

  async cancel({ meta }) {
    if (meta.cancelUrl) await falFetch(meta.cancelUrl as string, { method: "PUT" }).catch(() => {});
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
