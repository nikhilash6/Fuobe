import "server-only";
import { createHash } from "node:crypto";
import net from "node:net";
import type { AssistEffort } from "@/lib/assist";
import { getLlmProvider, LLM_PROVIDERS, type LlmModelDef, type LlmProviderDef, type Quirks } from "@/lib/catalog/llm-providers";
import { isPrivateAddress } from "../remote-fetch";
import { getSetting, type SettingName } from "../settings";
import { tenant } from "../tenant";
import { ContextError, FreeLimitError, freeLimit, hostedError, HostedError, keyRefused, retryAfter, scrubKey, tooLongText } from "./hosted-errors";
import { FITS_ID } from "./hosted-messages";
import { healToolCalls } from "./messages";
import { chatResponses } from "./responses";
import { readChatStream, StreamError, type StreamUsage } from "./sse";
import type { ChatMessage, ChatTool, ChatToolCall, Replay } from "./types";
import { newToolId, stripThink, toolInput } from "./wire";

/*
 * Assist on the owner's hosted LLM providers (src/lib/catalog/llm-providers.ts): OpenAI, Gemini, xAI,
 * DeepSeek, Kimi, GLM, Qwen, OpenRouter… Each provider's address comes from the registry's official
 * hosts only, its key from Settings. Calls are streamed (a long think never meets a gateway timeout),
 * never follow a redirect (a 3xx can't carry the key elsewhere), and never run for an account or a
 * guest: their work never uses the studio's keys.
 */

export interface Endpoint {
  provider: LlmProviderDef;
  /** No trailing slash. */
  baseUrl: string;
  key: string;
  /** A China region: prices in CNY. */
  cny: boolean;
}

export interface HostedRequest {
  messages: ChatMessage[];
  tools?: ChatTool[];
  effort?: AssistEffort | null;
  /** Output room; by default 32K tokens (64K at Extra and Max), within the model's own limit. */
  maxTokens?: number;
  /** The chat, for providers that cache by conversation (xAI): sent as a hash. */
  threadKey?: string;
  signal?: AbortSignal;
}

export interface HostedResult {
  text: string;
  /** Ids fit Anthropic's pattern (the chat can move back to Claude); the provider's own is in replay.toolIds. */
  toolCalls: ChatToolCall[];
  stop: "end" | "tool_use" | "length";
  model: string;
  thought: boolean;
  /** What this provider needs back on this turn later (stored on the assistant message). */
  replay: Replay;
  usage: StreamUsage | null;
  finish: string | null;
}

export const NOT_FOR_ACCOUNTS = "Accounts and guests can't use the studio's own LLM keys.";

/** Hosted providers Fuobe calls with a key (not Anthropic, which has its own SDK path, and not the local servers). */
export const HOSTED_PROVIDERS = LLM_PROVIDERS.filter((p) => p.adapter === "openai-chat" || p.adapter === "openai-responses");

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * FUOBE_LLM_TEST_BASE ("deepseek=http://127.0.0.1:3399/v1,…"): a stand-in provider on this machine,
 * for tests and local checks. Only addresses on this machine are taken; anything else is ignored.
 */
function testBase(id: string): string | null {
  for (const part of (process.env.FUOBE_LLM_TEST_BASE ?? "").split(",")) {
    const [name, url] = part.split("=").map((s) => s?.trim());
    if (name !== id || !url) continue;
    try {
      const u = new URL(url);
      if ((u.protocol === "http:" || u.protocol === "https:") && LOOPBACK.has(u.hostname) && !u.username && !u.password) return url.replace(/\/+$/, "");
    } catch {}
  }
  return null;
}

/** The key's setting, region and workspace in effect. */
const setting = (name: string | undefined) => (name ? getSetting(name as SettingName) : "");

/** A provider's free plan is ticked in Settings (Fuobe can't see it from the key). */
export const freePlanOn = (p: LlmProviderDef): boolean => p.freePlan?.kind === "plan" && !!p.freePlan.setting && setting(p.freePlan.setting) === "1";

/** A model that costs nothing on this account: free on any key, or free on the plan the owner ticked. */
export const isFree = (p: LlmProviderDef, m: LlmModelDef): boolean => m.free === "model" || (m.free === "plan" && freePlanOn(p));

/**
 * Where a provider's calls go, with its key: the registry's host for the region in Settings (Qwen's with the
 * workspace id), never a free URL. Null: no key (or Qwen without its workspace). Throws for an account or a guest.
 */
export function endpointFor(id: string): Endpoint | null {
  if (tenant()) throw new Error(NOT_FOR_ACCOUNTS);
  const provider = getLlmProvider(id);
  if (!provider || (provider.adapter !== "openai-chat" && provider.adapter !== "openai-responses") || !provider.keySetting) return null;
  const key = setting(provider.keySetting);
  if (!key) return null;
  const region = provider.regions ? (provider.regions.find((r) => r.id === setting(provider.regionSetting)) ?? provider.regions[0]) : undefined;
  let base = region?.baseUrl ?? provider.baseUrl;
  if (!base) return null;
  if (base.includes("{workspace}")) {
    const ws = setting(provider.workspaceSetting);
    if (!/^[a-z0-9-]{1,64}$/.test(ws)) return null;
    base = base.replace("{workspace}", ws);
  }
  return { provider, baseUrl: testBase(id) ?? base, key, cny: !!region?.cny };
}

/** The hosted providers with a key set (no calls made). */
export function connectedHosted(): Endpoint[] {
  if (tenant()) return [];
  return HOSTED_PROVIDERS.flatMap((p) => endpointFor(p.id) ?? []);
}

/** https, or plain http only to this machine or the LAN (the owner's own servers). Never a key over http to a public host. */
export function checkBase(ep: Endpoint): string {
  let u: URL;
  try {
    u = new URL(ep.baseUrl);
  } catch {
    throw new HostedError(`${ep.provider.label}'s address isn't a valid URL`, 0, ep.provider.id);
  }
  if (u.username || u.password) throw new HostedError(`${ep.provider.label}'s address can't carry a user name or password`, 0, ep.provider.id);
  if (u.protocol === "https:") return ep.baseUrl.replace(/\/+$/, "");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (u.protocol === "http:" && (host === "localhost" || (net.isIP(host) !== 0 && isPrivateAddress(host)))) return ep.baseUrl.replace(/\/+$/, "");
  throw new HostedError(`Fuobe never sends ${ep.provider.label}'s key over plain http to a public address`, 0, ep.provider.id);
}

// ---------------------------------------------------------------------------
// Request body (Chat Completions)

/** Output room: 32K tokens, 64K at Extra and Max (as Claude gets), within the model's limit and the provider's cap. */
export function outputRoom(p: LlmProviderDef, m: LlmModelDef, effort: AssistEffort | null | undefined, asked?: number): number {
  const want = asked ?? (effort === "xhigh" || effort === "max" ? 64_000 : 32_000);
  return Math.min(want, m.maxOut, p.quirks.maxOutCap ?? Infinity);
}

/** The effort as this provider takes it, from the model's map (nothing for a model without levels, or a level it doesn't offer). */
function effortFields(q: Quirks, m: LlmModelDef, effort: AssistEffort | null | undefined): Record<string, unknown> {
  const v = m.efforts?.[effort ?? "medium"];
  if (v === undefined || v === null || v === "") return {};
  switch (q.effortField ?? "reasoning_effort") {
    case "reasoning.effort":
      return { reasoning: { effort: v } };
    case "thinking_budget":
      return Number.isFinite(Number(v)) ? { thinking_budget: Number(v) } : {};
    case "none":
      return {};
    default:
      return { reasoning_effort: v };
  }
}

type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } | string };

function wireMessage(m: ChatMessage, q: Quirks): Record<string, unknown> {
  if (m.role === "system") return { role: q.systemRole ?? "system", content: m.content };
  if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId ?? "", content: m.content };
  if (m.role === "assistant") {
    const calls = m.toolCalls ?? [];
    return {
      role: "assistant",
      content: m.content || (calls.length ? null : ""),
      ...(calls.length && {
        tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) }, ...(c.extra !== undefined && { extra_content: c.extra }) })),
      }),
      ...(m.reasoning && { [m.reasoning.field]: m.reasoning.text }),
      ...(m.details?.length && { reasoning_details: m.details }),
    };
  }
  if (m.images?.length) {
    const parts: Part[] = m.images.map((i) => {
      const url = `data:${i.contentType};base64,${i.data}`;
      return { type: "image_url", image_url: q.imageUrl === "string" ? url : { url } };
    });
    return { role: "user", content: [...parts, ...(m.content ? [{ type: "text", text: m.content } as Part] : [])] };
  }
  return { role: "user", content: m.content };
}

/** The Chat Completions body for one call: streamed, tools on every request, the provider's fields and nothing it refuses. */
export function chatBody(p: LlmProviderDef, m: LlmModelDef, req: HostedRequest): Record<string, unknown> {
  const q = p.quirks;
  const tools = req.tools?.map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.parameters } }));
  return {
    model: m.id,
    messages: req.messages.map((x) => wireMessage(x, q)),
    stream: true,
    ...(q.streamUsage && { stream_options: { include_usage: true } }),
    ...(tools?.length && { tools, ...(q.toolChoice !== "omit" && { tool_choice: "auto" }) }),
    [q.maxTokensField ?? "max_completion_tokens"]: outputRoom(p, m, req.effort, req.maxTokens),
    ...effortFields(q, m, req.effort),
    ...q.extraBody,
  };
}

/** Rough tokens of a request (characters ÷ 4; a picture as about 1,500), to stop before a call the model can't take. */
export function estimateTokens(messages: ChatMessage[], tools: ChatTool[] = []): number {
  let chars = JSON.stringify(tools).length;
  let pictures = 0;
  for (const m of messages) {
    chars += m.content.length + JSON.stringify(m.toolCalls ?? []).length + (m.reasoning?.text.length ?? 0) + 16;
    pictures += m.images?.length ?? 0;
  }
  return Math.ceil(chars / 4) + pictures * 1500;
}

const PICTURE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Pictures in a type the provider takes: others go as PNG. */
async function fitPictures(messages: ChatMessage[], types: string[] = PICTURE_TYPES): Promise<ChatMessage[]> {
  if (!messages.some((m) => m.images?.some((i) => !types.includes(i.contentType)))) return messages;
  const sharp = (await import("sharp")).default;
  return Promise.all(
    messages.map(async (m) =>
      m.images?.some((i) => !types.includes(i.contentType))
        ? {
            ...m,
            images: await Promise.all(
              m.images.map(async (i) => (types.includes(i.contentType) ? i : { data: (await sharp(Buffer.from(i.data, "base64")).png().toBuffer()).toString("base64"), contentType: "image/png" })),
            ),
          }
        : m,
    ),
  );
}

// ---------------------------------------------------------------------------
// One call

const RETRY = new Set([429, 500, 502, 503, 529]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Why a fetch failed (ECONNREFUSED, a redirect it refused…), without the key. */
function reason(e: unknown, key: string): string {
  const err = e as { message?: string; cause?: { code?: string; message?: string } } | undefined;
  return scrubKey(err?.cause?.code || err?.cause?.message || err?.message || "no answer", key);
}

/**
 * POST with the key, never following a redirect. 429 and 5xx are tried once more after Retry-After (when it is
 * 30 s or less); other failures become hostedError's plain words.
 */
export async function postHosted(ep: Endpoint, path: string, body: unknown, opts: { model: LlmModelDef | null; free?: boolean; headers?: Record<string, string>; signal?: AbortSignal; timeoutMs: number }): Promise<Response> {
  const p = ep.provider;
  const url = `${checkBase(ep)}${path}`;
  const signal = opts.signal ? AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs)]) : AbortSignal.timeout(opts.timeoutMs);
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream", authorization: `Bearer ${ep.key}`, ...p.quirks.headers, ...opts.headers },
        body: JSON.stringify(body),
        redirect: "error",
        signal,
      });
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      if ((e as Error)?.name === "TimeoutError") throw new HostedError(`${p.label} took too long to answer. Try again, or pick a faster model.`, 504, p.id);
      throw new HostedError(`Couldn't reach ${p.label} (${reason(e, ep.key)})`, 0, p.id);
    }
    if (res.ok) {
      rejected().delete(keyName(ep));
      return res;
    }
    const text = await res.text().catch(() => "");
    // Only a refusal of the key itself: a 403 about one model or request (Qwen's free quota, Gemini's permission_denied) isn't.
    if (keyRefused(res.status, text)) rejected().add(keyName(ep));
    const wait = retryAfter(res.headers.get("retry-after"));
    if (attempt === 0 && RETRY.has(res.status) && (wait ?? 2) <= 30) {
      await sleep((wait ?? 2) * 1000);
      continue;
    }
    throw hostedError(p, res.status, text, opts.model, ep.key, { free: opts.free, wait });
  }
}

declare global {
  /** Keys a provider rejected on a real call (by hash): "Key rejected" until the key changes or works again. */
  var __fuobeRejectedKeys: Set<string> | undefined;
  /** Providers whose free requests are used up, until when (ms). */
  var __fuobeFreeSpent: Map<string, number> | undefined;
}
const rejected = () => (globalThis.__fuobeRejectedKeys ??= new Set());
const spent = () => (globalThis.__fuobeFreeSpent ??= new Map());
const keyName = (ep: Endpoint) => createHash("sha256").update(`${ep.provider.id}|${ep.key}`).digest("hex");

/** The provider rejected this key on a real call (and it hasn't worked since). */
export const isRejected = (ep: Endpoint): boolean => rejected().has(keyName(ep));

/** Midnight after `now` in a time zone, in ms. */
function nextMidnight(zone: string, now: number): number {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  const parts = (t: number) => Object.fromEntries(fmt.formatToParts(t).map((p) => [p.type, Number(p.value)])) as Record<string, number>;
  // The zone's offset at an instant: its wall clock read as UTC, less the instant.
  const offset = (t: number) => {
    const p = parts(t);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(t / 1000) * 1000;
  };
  const p = parts(now);
  const wall = Date.UTC(p.year, p.month - 1, p.day + 1);
  return wall - offset(wall - offset(now));
}

/** When a free limit that ran out comes back: a minute later, or at the provider's midnight (UTC; Gemini's is Pacific). */
export function freeResetAt(provider: string, span: "day" | "minute", now = Date.now()): number {
  return span === "minute" ? now + 60_000 : nextMidnight(getLlmProvider(provider)?.freeDayZone ?? "UTC", now);
}

/** A free limit ran out: the provider's free models are skipped until it resets. */
export function markFreeSpent(provider: string, span: "day" | "minute"): void {
  spent().set(provider, freeResetAt(provider, span));
}

/**
 * OpenRouter answers its per-minute and per-day free caps with the same 429 body: its key check (GET /key, free)
 * says which. The day's only when no free request is left today; without an answer, the error's words stand.
 */
async function freeSpan(ep: Endpoint, e: unknown): Promise<unknown> {
  if (!(e instanceof FreeLimitError) || ep.provider.id !== "openrouter") return e;
  const left = (await openRouterKey(true).catch(() => null))?.left;
  if (typeof left !== "number") return e;
  const span = left <= 0 ? "day" : "minute";
  return span === e.span ? e : freeLimit(ep.provider, span);
}

/** Providers whose free requests are used up right now. */
export function freeSpent(): string[] {
  const now = Date.now();
  return [...spent()].flatMap(([p, until]) => (until > now ? [p] : []));
}

/** A short, stable name for a chat (xAI caches by it): never the chat's own id. */
const chatName = (key: string) => createHash("sha256").update(`fuobe:${key}`).digest("hex").slice(0, 32);

/**
 * One Assist step on a hosted model: the history (already shaped by toHostedMessages) with the tools, streamed,
 * joined into one reply. Throws plain-English errors (hosted-errors.ts); never runs for an account or a guest.
 */
export async function chatHosted(ep: Endpoint, model: LlmModelDef, req: HostedRequest): Promise<HostedResult> {
  if (tenant()) throw new Error(NOT_FOR_ACCOUNTS);
  const p = ep.provider;
  const room = outputRoom(p, model, req.effort, req.maxTokens);
  const tokens = estimateTokens(req.messages, req.tools);
  if (tokens > Math.min(model.context - room, model.maxIn ?? Infinity)) throw new ContextError(tooLongText(model, tokens));
  if (p.adapter === "openai-responses") return chatResponses(ep, model, { ...req, maxTokens: room });
  const q = p.quirks;
  const free = isFree(p, model);
  const messages = await fitPictures(req.messages, q.imageTypes);
  const timeoutMs = model.timeoutMs ?? q.timeoutMs ?? 600_000;
  const res = await postHosted(ep, "/chat/completions", chatBody(p, model, { ...req, messages }), {
    model,
    free,
    timeoutMs,
    signal: req.signal,
    headers: q.chatHeader && req.threadKey ? { [q.chatHeader]: chatName(req.threadKey) } : undefined,
  }).catch(async (e) => {
    throw await freeSpan(ep, e);
  });
  if (!res.body) throw new HostedError(`${p.label} sent an empty answer`, 502, p.id);
  let out;
  try {
    out = await readChatStream(res.body, { errorEnvelope: q.errorEnvelope });
  } catch (e) {
    if (e instanceof StreamError) throw await freeSpan(ep, hostedError(p, e.status ?? 502, JSON.stringify({ error: { message: e.message, code: e.code } }), model, ep.key, { free }));
    throw e;
  }
  const toolIds: Record<string, string> = {};
  const extra: Record<string, unknown> = {};
  let toolCalls: ChatToolCall[] = out.toolCalls.map((c) => {
    const id = FITS_ID.test(c.id) ? c.id : newToolId();
    if (id !== c.id) toolIds[id] = c.id;
    if (c.extra !== undefined) extra[id] = c.extra;
    return { id, name: c.name, input: toolInput(c.arguments) };
  });
  let text = stripThink(out.text);
  // A call written as text (<tool_call>{…}</tool_call>) instead of through the API.
  if (req.tools?.length && !toolCalls.length && text) {
    const healed = healToolCalls(text, new Set(req.tools.map((t) => t.name)));
    if (healed.calls.length) ({ text, calls: toolCalls } = { text: healed.text, calls: healed.calls });
  }
  const reasoning = q.replayReasoning && out.reasoning?.text ? { field: out.reasoning.field === "thinking" ? "reasoning_content" : out.reasoning.field, text: out.reasoning.text } : undefined;
  return {
    text,
    toolCalls,
    stop: toolCalls.length ? "tool_use" : out.finish === "length" ? "length" : "end",
    model: out.model ?? model.id,
    thought: !!out.reasoning?.text,
    replay: {
      provider: p.id,
      model: model.id,
      ...(reasoning && { reasoning }),
      ...(out.details?.length && { details: out.details }),
      ...(Object.keys(toolIds).length && { toolIds }),
      ...(Object.keys(extra).length && { extra }),
    },
    usage: out.usage,
    finish: out.finish,
  };
}

// ---------------------------------------------------------------------------
// Settings: Test and Try a reply

/** GET with the key (a free call), never following a redirect. A key that works here isn't "rejected" any more; a 401 is. */
async function getHosted(ep: Endpoint, path: string): Promise<Response> {
  const url = `${checkBase(ep)}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { authorization: `Bearer ${ep.key}`, ...ep.provider.quirks.headers }, redirect: "error", signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new HostedError(`Couldn't reach ${ep.provider.label} (${reason(e, ep.key)})`, 0, ep.provider.id);
  }
  if (res.ok) rejected().delete(keyName(ep));
  else if (res.status === 401) rejected().add(keyName(ep));
  return res;
}

export interface OpenRouterKey {
  /** No credits bought yet: only the free models are offered. */
  freeTier: boolean;
  /** Free-model requests left today, and the day's limit. */
  left: number | null;
  limit: number | null;
}

declare global {
  var __fuobeOpenRouterKey: { hash: string; at: number; info: OpenRouterKey | null } | undefined;
}

/**
 * OpenRouter's GET /api/v1/key (a free call): whether credits were ever bought, and the free requests left today.
 * Kept 60 s. `waitMs`: how long a person's question (Assist's panel) waits; an older answer is used meanwhile.
 */
export async function openRouterKey(force = false, waitMs?: number): Promise<OpenRouterKey | null> {
  const ep = endpointFor("openrouter");
  if (!ep) return null;
  const hash = createHash("sha256").update(`${ep.baseUrl}|${ep.key}`).digest("hex");
  const c = globalThis.__fuobeOpenRouterKey;
  if (!force && c?.hash === hash && Date.now() - c.at < 60_000) return c.info;
  const fresh = readOpenRouterKey(ep, hash);
  if (waitMs === undefined) return fresh;
  const late = new Promise<"late">((r) => setTimeout(() => r("late"), waitMs).unref?.());
  const first = await Promise.race([fresh, late]);
  return first === "late" ? (c?.hash === hash ? c.info : null) : first;
}

async function readOpenRouterKey(ep: Endpoint, hash: string): Promise<OpenRouterKey | null> {
  let info: OpenRouterKey | null = null;
  try {
    const res = await getHosted(ep, "/key");
    if (res.ok) {
      const d = ((await res.json()) as { data?: { is_free_tier?: unknown; free_model_daily_requests?: { remaining?: unknown; limit?: unknown } } }).data;
      const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      info = { freeTier: d?.is_free_tier === true, left: n(d?.free_model_daily_requests?.remaining), limit: n(d?.free_model_daily_requests?.limit) };
    }
  } catch {}
  globalThis.__fuobeOpenRouterKey = { hash, at: Date.now(), info };
  return info;
}

/** Settings → Test: the provider's model list with the key (free), or OpenRouter's key check. */
export async function testHosted(id: string): Promise<{ ok: boolean; detail: string }> {
  const p = getLlmProvider(id);
  if (!p) return { ok: false, detail: "Unknown provider" };
  let ep: Endpoint | null;
  try {
    ep = endpointFor(id);
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
  if (!ep) return { ok: false, detail: p.workspaceSetting && setting(p.keySetting) ? `Add your workspace id from ${p.label}` : `No ${p.label} key set` };
  try {
    if (p.id === "openrouter") {
      const res = await getHosted(ep, "/key");
      if (!res.ok) return { ok: false, detail: hostedError(p, res.status, await res.text().catch(() => ""), null, ep.key).message };
      const info = await openRouterKey(true);
      const left = info?.left !== null && info?.limit !== null && info ? ` · ${info.left} of ${info.limit} free requests left today` : "";
      return { ok: true, detail: `Key works${left}${info?.freeTier ? " · no credits bought yet, so Assist uses the free models" : ""}` };
    }
    if (!p.modelsPath) return tryHosted(id);
    const res = await getHosted(ep, p.modelsPath);
    if (!res.ok) return { ok: false, detail: hostedError(p, res.status, await res.text().catch(() => ""), null, ep.key).message };
    const j = (await res.json().catch(() => ({}))) as { data?: unknown[]; models?: unknown[] };
    const n = (j.data ?? j.models ?? []).length;
    return { ok: true, detail: `Key works · ${n} model${n === 1 ? "" : "s"} listed${freePlanOn(p) ? " · free plan" : ""}` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

/** The cheapest model a provider offers here, for Try a reply. */
function cheapest(p: LlmProviderDef): LlmModelDef | undefined {
  const usable = p.models.filter((m) => m.tools === true && !m.router);
  const cost = (m: LlmModelDef) => (isFree(p, m) ? 0 : m.price?.[0] ? (3 * m.price[0].in + m.price[0].out) / 4 : Infinity);
  return [...usable].sort((a, b) => cost(a) - cost(b))[0];
}

/** Settings → Try a reply: one tiny chat call, timed ("Answered in 1.2 s with gpt-6.1-sol"). Costs a fraction of a cent on a paid model. */
export async function tryHosted(id: string, modelId?: string | null): Promise<{ ok: boolean; detail: string; ms?: number; model?: string }> {
  let ep: Endpoint | null;
  try {
    ep = endpointFor(id);
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
  if (!ep) return { ok: false, detail: `No ${getLlmProvider(id)?.label ?? id} key set` };
  const model = (modelId && ep.provider.models.find((m) => m.id === modelId)) || cheapest(ep.provider);
  if (!model) return { ok: false, detail: `${ep.provider.label} has no model Fuobe can try` };
  const t0 = Date.now();
  try {
    const r = await chatHosted(ep, model, { messages: [{ role: "user", content: "Reply with the word OK." }], effort: "low", maxTokens: 1024 });
    const ms = Date.now() - t0;
    return { ok: true, ms, model: model.id, detail: `Answered in ${(ms / 1000).toFixed(1)} s with ${model.id}${r.text ? "" : " (it was still thinking)"}` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}
