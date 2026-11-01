import "server-only";
import type { LlmModelDef, LlmProviderDef } from "@/lib/catalog/llm-providers";
import { mask } from "../settings";
import { errorDetail } from "./errors";

/*
 * What went wrong with a hosted provider, in words that say what to do: check the key, add credit,
 * pick another model, wait for a limit. The provider's own words are kept, with the key taken out
 * (some echo part of it back).
 */

/** The key out of a text: the whole key masked, and any long run of its characters too. */
export function scrubKey(text: string, key: string): string {
  if (!key || key.length < 8) return text;
  let out = text.split(key).join(mask(key));
  // "Incorrect API key provided: sk-abc1…wxyz" and friends quote a piece of it.
  for (let i = 0; i + 12 <= key.length; i++) {
    const piece = key.slice(i, i + 12);
    if (out.includes(piece)) out = out.split(piece).join("••••");
  }
  return out;
}

/** A free model's limit ran out: Free moves the chat to its next free choice (P3), or says when it comes back. */
export class FreeLimitError extends Error {
  constructor(
    message: string,
    /** "day": the provider's free requests are gone until tomorrow; "minute": wait a little. */
    readonly span: "day" | "minute",
    readonly provider: string,
  ) {
    super(message);
  }
}

/** The chat no longer fits the model's context. */
export class ContextError extends Error {}

export class HostedError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly provider: string,
  ) {
    super(message);
  }
}

const CONTEXT = /context_length_exceeded|context (?:length|window|size)|maximum context|prompt is too long|too many tokens|input is too long|exceeds? the (?:model'?s? )?(?:context|maximum)/i;
const NO_MODEL = /model[^.]{0,80}(?:not found|does not exist|doesn't exist|is not available|unknown|no such|invalid|not supported)|unknown model|model_not_found|no such model|invalid model/i;
/** A free limit for the whole day: "per day", "daily", RPD, Gemini's quota_exceeded. Anything else is a minute's (OpenRouter's free-models-per-min). */
const DAY_CAP = /per[- ]?day|daily|today|\brpd\b|quota_exceeded/i;
/** A 403 that is about the key itself. Others are about one model or request (Qwen's free quota for a model, Gemini's permission_denied). */
const KEY_REFUSED = /invalid[ _-]?(?:api[ _-]?)?(?:key|token)|incorrect api key|api[ _-]?key (?:is )?(?:not valid|invalid|expired)|unauthenticated|invalid_authentication|(?:key|token) (?:has )?expired/i;

/** The provider refused the key (401, or a 403 that names the key): Assist skips its models until the key works again. */
export const keyRefused = (status: number, body: string): boolean => status === 401 || (status === 403 && KEY_REFUSED.test(body));

/** A free limit that ran out: for the day, or for the moment. */
export const freeLimit = (p: Pick<LlmProviderDef, "id" | "label">, span: "day" | "minute"): FreeLimitError =>
  new FreeLimitError(span === "day" ? `${p.label}'s free requests for today are used up` : `${p.label}'s free requests are used up for the moment`, span, p.id);

/** "This chat is too long for GPT-6.1 Sol (about 1.1M tokens)…" */
export function tooLongText(model: Pick<LlmModelDef, "name">, tokens?: number): string {
  const n = tokens ? ` (about ${tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M` : `${Math.round(tokens / 1000)}K`} tokens)` : "";
  return `This chat is too long for ${model.name}${n}. Start a new chat, or pick a model with a longer context in Manual.`;
}

/** Seconds to wait, from Retry-After (seconds, or an HTTP date). */
export function retryAfter(h: string | null): number | null {
  if (!h) return null;
  const s = Number(h);
  if (Number.isFinite(s)) return Math.max(0, s);
  const at = Date.parse(h);
  return Number.isNaN(at) ? null : Math.max(0, Math.round((at - Date.now()) / 1000));
}

/**
 * A non-2xx answer (or an error inside a stream) as an error to show. `free`: the model was a free one, so a
 * 429 means its free limit ran out.
 */
export function hostedError(p: LlmProviderDef, status: number, body: string, model: LlmModelDef | null, key: string, opts: { free?: boolean; wait?: number | null } = {}): Error {
  const detail = scrubKey(errorDetail(body), key);
  const label = p.label;
  const where = `Settings → AI helper → ${label}`;
  const said = detail ? ` (${detail})` : "";
  const hint = p.id === "zai" ? " Z.ai's Standard and Coding Plan keys are separate." : p.id === "qwen" ? " Model Studio keys only work in the region they were made in." : p.id === "huggingface" ? " It needs a fine-grained token with Inference Providers on." : "";
  if (keyRefused(status, body)) return new HostedError(`${label} rejected the key${said}. Check it in ${where}.${hint}`, status, p.id);
  if (status === 403) {
    // Free Quota Only on, and this model's free quota used up (Model Studio's free quota is per model).
    if (/AllocationQuota\.FreeTierOnly/.test(body)) {
      return new HostedError(`${p.short}'s free quota for ${model?.name ?? "this model"} is used up, and Free Quota Only is on in Model Studio. Pick another model in Manual, or turn Free Quota Only off for it.`, 403, p.id);
    }
    return new HostedError(`${label} refused this request${said}.${model ? " Pick another model in Manual, or check" : " Check"} your account's access on ${p.short}'s site.${p.id === "huggingface" ? hint : ""}`, 403, p.id);
  }
  if (status === 402 || /billing_not_configured|insufficient[_ ]balance|insufficient credits|no credit/i.test(body)) {
    const billing = p.billingUrl ?? p.keysUrl;
    const or = p.id === "openrouter" ? " A negative balance also blocks free models." : "";
    return new HostedError(`${label} says the account has no credit${said}.${billing ? ` Add credit at ${billing}.` : ""}${or}`, 402, p.id);
  }
  if (CONTEXT.test(detail) || /"context_length_exceeded"/.test(body)) return new ContextError(tooLongText(model ?? { name: "this model" }));
  if (p.id === "openrouter" && status === 404 && /data policy|no endpoints/i.test(detail)) {
    return new HostedError(`No OpenRouter provider serves ${model?.name ?? "that model"} with your privacy settings. Allow it in the privacy settings on OpenRouter's site, or pick another free model.`, 404, p.id);
  }
  if (status === 404 || NO_MODEL.test(detail)) return new HostedError(`${label} has no model ${model?.id ?? "by that name"} today (it may have been retired). Pick another in Manual.`, status, p.id);
  if (status === 429) {
    // OpenRouter's body is the same for its minute and day caps: hosted.ts asks its key check which it was.
    if (opts.free) return freeLimit(p, DAY_CAP.test(detail) || DAY_CAP.test(body) ? "day" : "minute");
    const wait = opts.wait ? ` Try again in ${opts.wait} s.` : " Try again in a minute.";
    return new HostedError(`${label} is rate-limited right now.${wait}`, 429, p.id);
  }
  if (status >= 500) return new HostedError(`${label} had a problem on its side (${status})${said}. Try again in a moment.`, status, p.id);
  return new HostedError(`${label} returned an error (${status})${said}`, status, p.id);
}
