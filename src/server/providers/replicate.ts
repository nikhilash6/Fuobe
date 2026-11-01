import "server-only";
import { loraEndpointFor } from "@/lib/catalog/loras";
import { buildPayload, extractOutputs, noOutputsError } from "@/lib/catalog/payload";
import { accountKeyError, balanceRefusal, cloudKey, missingKeyError, originOf, redactKey, standIn } from "../provider-keys";
import { toDataUri } from "../storage";
import { tenant } from "../tenant";
import type { KeyCheck } from "./fal";
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

async function rFetch(url: string, init: RequestInit = {}): Promise<unknown> {
  const t = token();
  if (!t && tenant()) throw missingKeyError("replicate");
  const origin = originOf(url);
  if (origin !== HOST && origin !== standIn("replicate")) throw new ProviderError("That address is outside Replicate, so Fuobe didn't send the token there");
  const res = await fetch(url, {
    ...init,
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
    throw accountKeyError("replicate", res.status, said, t) ?? new ProviderError(said, res.status);
  }
  return body;
}

export const replicateProvider: ProviderAdapter = {
  id: "replicate",
  label: "Replicate",
  isConfigured: () => !!token(),

  async prepareFile(data, contentType, name) {
    if (data.length < 1_000_000) return toDataUri(data, contentType);
    const form = new FormData();
    form.append("content", new Blob([new Uint8Array(data)], { type: contentType }), name);
    const file = (await rFetch(`${api()}/files`, { method: "POST", body: form })) as { urls: { get: string } };
    return file.urls.get;
  },

  async submit({ route, input }) {
    const payload = buildPayload(route.map ?? {}, input);
    // LoRAs go in the route's own fields (lora_weights[] / one per Wan 2.2 expert) or its LoRA model.
    let endpoint: string;
    try {
      endpoint = loraEndpointFor(route, input.loras);
    } catch (e) {
      throw new ProviderError((e as Error).message);
    }
    const [slug, version] = endpoint.split(":");
    const res = (await (version
      ? rFetch(`${api()}/predictions`, { method: "POST", body: JSON.stringify({ version, input: payload }) })
      : rFetch(`${api()}/models/${slug}/predictions`, { method: "POST", body: JSON.stringify({ input: payload }) }))) as {
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
    };
    if (p.status === "starting") return { state: "queued", message: "Starting" };
    if (p.status === "processing") {
      const last = p.logs?.trim().split("\n").at(-1);
      const pct = last ? /(\d{1,3})%/.exec(last)?.[1] : undefined;
      return { state: "running", progress: pct ? Number(pct) / 100 : undefined, message: last ?? "Processing" };
    }
    if (p.status === "succeeded") {
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
