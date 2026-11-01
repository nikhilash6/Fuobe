import type { AssistEffort } from "../assist";

/**
 * The LLM providers Assist can plan with: their official hosts, how their wire differs from
 * OpenAI's, and the models worth offering, with prices, context, tools, vision, open weights and
 * free status. Pure data (no secrets, safe in the browser); src/lib/assist-models.ts ranks it and
 * src/server/llm/hosted.ts calls it. Facts come from each provider's own docs, model and pricing pages
 * (the `sources` of each entry), read on LLM_REGISTRY_CHECKED. Ids and prices change monthly:
 * update this file (a data-only change) rather than code.
 */
export const LLM_REGISTRY_CHECKED = "2026-10-31";

export type LlmAdapter = "anthropic" | "openai-chat" | "openai-responses" | "local";
export type ProviderGroup = "labs" | "china" | "hosts" | "local";

/** USD (or CNY) per 1M tokens. `until`: the last day this price applies (a dated change follows it). */
export interface PriceStep {
  until?: string;
  in: number;
  out: number;
}

/** A Fuobe effort → the value this model's API takes; null: the model doesn't offer that level. */
export type EffortMap = Partial<Record<AssistEffort, string | null>>;

export interface LlmModelDef {
  /** The wire id, exactly as the provider's docs give it. */
  id: string;
  name: string;
  /** 1: each maker's flagship reasoning model; 2: other flagships and strong mid models; 3: fast or cheap; 4: small. */
  tier: 1 | 2 | 3 | 4;
  speed: "fast" | "normal" | "slow";
  /** Why Smart and Free never pick it (Manual still lists it). */
  manualOnly?: string;
  /** Tokens. */
  context: number;
  maxOut: number;
  /** Tokens in at most, where the docs give a limit apart from the context (GPT-5.4 Mini: 400K context, 272K in). */
  maxIn?: number;
  /** "unverified": the docs don't say it calls tools on this API, so Smart and Free skip it. */
  tools: true | "unverified";
  vision: boolean;
  /** Pictures per request, where the provider caps it. */
  maxImages?: number;
  /** Open weights, with the licence the maker gives. Absent: closed, or the docs don't confirm it. */
  open?: { licence: string; nonCommercial?: true };
  price?: PriceStep[];
  /** China regions are billed in CNY. */
  priceCny?: PriceStep[];
  /** Why there is no price (Cohere's page doesn't list one). */
  priceNote?: string;
  /** A price step inside a long chat. */
  longContext?: { above: number; text: string };
  /** "model": $0 on any key; "plan": free only while the provider's free-plan tick is on. */
  free?: "model" | "plan";
  efforts?: EffortMap;
  status?: "preview";
  /** The last day a free model is offered. */
  expires?: string;
  /** Assist has been run with it for real. */
  tested?: true;
  /** A host's copy of another provider's model ("zai/glm-5.3"): the maker's own API comes first. */
  same?: string;
  /** OpenRouter's Free Models Router: picks a random free model each time, so it always comes last. */
  router?: true;
  /** A longer wait than the provider's usual one (Gemini 4 Argon can think for minutes). */
  timeoutMs?: number;
  note?: string;
}

/** How a provider's Chat Completions wire differs from OpenAI's (read by src/server/llm/hosted.ts). */
export interface Quirks {
  /** Default max_completion_tokens. */
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  /** "omit": the provider documents no tool_choice (MiniMax, Cohere). Default "auto". */
  toolChoice?: "auto" | "omit";
  /** "developer": the system prompt goes as role developer (Cohere). */
  systemRole?: "system" | "developer";
  /** Where the effort goes. Default reasoning_effort. */
  effortField?: "reasoning_effort" | "reasoning.effort" | "thinking_budget" | "none";
  /**
   * "required": every earlier turn of this provider carries its reasoning back, or a request with tools is
   * refused (DeepSeek). "preserve": sent back when there is some. Default: none sent back.
   */
  replayReasoning?: "required" | "preserve";
  /** The key reasoning goes back under (Together answers with either, and wants the same one back). */
  reasoningKey?: "reasoning_content" | "reasoning";
  /** "flatten": tool calls other models made are sent as text (DeepSeek refuses calls it didn't make). */
  foreignToolCalls?: "flatten";
  /** Gemini's thought signatures on tool calls (extra_content). */
  signatures?: "gemini";
  /** "nine": tool-call ids of nine letters and digits (Mistral). */
  toolIds?: "nine";
  /** The image_url part as a plain string (Mistral's examples); default {url}. */
  imageUrl?: "string";
  /** Picture types the provider takes; others are sent as PNG. Default png, jpeg, webp and gif. */
  imageTypes?: string[];
  /** Fields every request carries. */
  extraBody?: Record<string, unknown>;
  headers?: Record<string, string>;
  /** xAI: a header naming the chat, for cache hits. */
  chatHeader?: string;
  /** MiniMax answers some errors with HTTP 200 and base_resp.status_code. */
  errorEnvelope?: "minimax";
  /** Ask for usage on the stream (stream_options.include_usage). */
  streamUsage?: true;
  /** Output room cap: requests are charged their max tokens up front (Cerebras). */
  maxOutCap?: number;
  timeoutMs?: number;
}

export interface FreePlan {
  /** "plan": free while the account is on the provider's free plan (the owner ticks it). "trial": credits that run out; never counted as free. */
  kind: "plan" | "trial";
  /** The tick, for plans. */
  setting?: string;
  limits: string;
  caveat?: string;
  /** Why the free plan can't run Assist (Groq: 8,000 tokens a minute). */
  tooSmall?: string;
}

export interface Region {
  id: string;
  label: string;
  /** Qwen's hosts carry the workspace id: {workspace}. */
  baseUrl: string;
  note?: string;
  /** Prices here are in CNY. */
  cny?: true;
}

export interface LlmProviderDef {
  id: string;
  label: string;
  /** The provider's name in a sentence: "Google", "DeepSeek". */
  short: string;
  group: ProviderGroup;
  adapter: LlmAdapter;
  /** Official hosts only; the first is the default. */
  regions?: Region[];
  baseUrl?: string;
  /** The Settings entry that holds the key (src/server/settings.ts). */
  keySetting?: string;
  regionSetting?: string;
  workspaceSetting?: string;
  /** What a key looks like, for Settings' hint. */
  keyHint?: { pattern: string; text: string };
  keysUrl?: string;
  billingUrl?: string;
  /** Lists its models at {base}/models with the key (a free call: Settings' Test). */
  modelsPath?: string;
  quirks: Quirks;
  freePlan?: FreePlan;
  /** Free models' account-wide limits (OpenRouter's :free cap covers every free model on the key). */
  freeLimits?: { text: string; caveat?: string; shared?: true };
  /** The time zone whose midnight resets the free daily limits (Gemini: Pacific). Default UTC (OpenRouter's day). */
  freeDayZone?: string;
  /** Not wired yet: shown greyed with this line. */
  soon?: string;
  models: LlmModelDef[];
  sources: string[];
}

const EVERY: EffortMap = { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" };
const LOW_MED_HIGH: EffortMap = { low: "low", medium: "medium", high: "high", xhigh: "high", max: "high" };
/** Kimi K3 and GLM-5.3 take low, high and max. */
const LOW_HIGH_MAX: EffortMap = { low: "low", medium: "high", high: "high", xhigh: "max", max: "max" };
/** Mistral Small and Cohere's reasoning: thinking off or on. */
const NONE_HIGH: EffortMap = { low: "none", medium: "high", high: "high", xhigh: "high", max: "high" };
const usd = (inp: number, out: number, until?: string): PriceStep => ({ in: inp, out, ...(until && { until }) });

const M = 1_000_000;
/** OpenAI's price step: GPT-5.4 and later cost more for the whole message past 272K tokens. */
const OPENAI_LONG = { above: 272_000, text: "Over 272K tokens: twice the input price and 1.5× the output price for the whole message" };
/** Qwen takes a thinking budget in tokens; "" sends none (no limit). Fuobe's numbers: the docs set no levels. */
const QWEN_BUDGET: EffortMap = { low: "2048", medium: "8192", high: "16384", xhigh: "32768", max: "" };
/** The dummy thought signature Gemini's docs allow for tool calls another model made. */
export const GEMINI_DUMMY_SIGNATURE = "skip_thought_signature_validator";

export const LLM_PROVIDERS: LlmProviderDef[] = [
  // -------------------------------------------------------------------------
  // Big labs
  {
    id: "anthropic",
    label: "Anthropic",
    short: "Anthropic",
    group: "labs",
    adapter: "anthropic",
    keySetting: "anthropicKey",
    keyHint: { pattern: "^sk-ant-\\S+$", text: "Anthropic keys start with sk-ant-" },
    keysUrl: "https://console.anthropic.com/settings/keys",
    quirks: {},
    // Opus's price is the repo's own note (src/lib/catalog/llm-models.ts); Sonnet, Haiku and Fable are OpenRouter's catalog figures.
    models: [
      { id: "claude-opus-5-5", name: "Claude Opus 5.5", tier: 1, speed: "normal", context: M, maxOut: 64_000, tools: true, vision: true, price: [usd(4, 20)], efforts: EVERY, tested: true },
      { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", tier: 2, speed: "normal", context: M, maxOut: 64_000, tools: true, vision: true, price: [usd(2, 10)], efforts: EVERY, tested: true },
      { id: "claude-haiku-5-5", name: "Claude Haiku 5.5", tier: 3, speed: "fast", context: M, maxOut: 64_000, tools: true, vision: true, price: [usd(0.1, 0.5)], efforts: EVERY, tested: true },
      { id: "claude-fable-5-1", name: "Claude Fable 5.1", tier: 1, speed: "slow", manualOnly: "Most capable, slowest, priciest", context: M, maxOut: 64_000, tools: true, vision: true, price: [usd(10, 50)], efforts: EVERY, tested: true },
    ],
    sources: ["https://openrouter.ai/api/v1/models"],
  },
  {
    id: "openai",
    label: "OpenAI",
    short: "OpenAI",
    group: "labs",
    adapter: "openai-responses",
    regions: [
      { id: "global", label: "Global", baseUrl: "https://api.openai.com/v1" },
      { id: "us", label: "United States", baseUrl: "https://us.api.openai.com/v1", note: "Data stays in the US: 10% more on models from 5 March 2026 on" },
      { id: "eu", label: "Europe", baseUrl: "https://eu.api.openai.com/v1", note: "Data stays in the EU (needs an EU project): 10% more on models from 5 March 2026 on" },
    ],
    keySetting: "openaiKey",
    regionSetting: "openaiRegion",
    keyHint: { pattern: "^sk-\\S+$", text: "OpenAI keys start with sk-" },
    keysUrl: "https://platform.openai.com/api-keys",
    billingUrl: "https://platform.openai.com/settings/organization/billing",
    modelsPath: "/models",
    quirks: { timeoutMs: 1_200_000 },
    models: [
      { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", tier: 1, speed: "normal", context: 1_050_000, maxOut: 128_000, tools: true, vision: true, price: [usd(2, 10)], efforts: EVERY, longContext: OPENAI_LONG },
      { id: "gpt-6.1-terra", name: "GPT-6.1 Terra", tier: 3, speed: "fast", context: 1_050_000, maxOut: 128_000, tools: true, vision: true, price: [usd(1, 5)], efforts: EVERY, longContext: OPENAI_LONG, note: "Fast, with strong visual reasoning" },
      { id: "gpt-6-luna", name: "GPT-6 Luna", tier: 3, speed: "fast", context: 1_050_000, maxOut: 128_000, tools: true, vision: true, price: [usd(0.1, 0.5)], efforts: LOW_MED_HIGH, longContext: OPENAI_LONG, note: "OpenAI's cheapest" },
      { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", tier: 3, speed: "fast", context: 400_000, maxIn: 272_000, maxOut: 128_000, tools: true, vision: true, price: [usd(0.75, 4.5)], efforts: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: null } },
      { id: "gpt-6-astra", name: "GPT-6 Astra", tier: 1, speed: "slow", manualOnly: "Flagship; slowest and priciest", context: 1_050_000, maxOut: 128_000, tools: true, vision: true, price: [usd(10, 50)], efforts: EVERY, longContext: OPENAI_LONG },
    ],
    sources: [
      "https://developers.openai.com/api/docs/models.md",
      "https://developers.openai.com/api/docs/pricing.md",
      "https://developers.openai.com/api/docs/guides/migrate-to-responses.md",
      "https://developers.openai.com/api/docs/guides/reasoning.md",
      "https://developers.openai.com/api/docs/guides/streaming-responses.md",
    ],
  },
  {
    id: "google",
    label: "Google Gemini",
    short: "Google",
    group: "labs",
    adapter: "openai-chat",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keySetting: "googleKey",
    keyHint: { pattern: "^AIza[\\w-]{20,}$", text: "Gemini API keys start with AIza" },
    keysUrl: "https://aistudio.google.com/apikey",
    billingUrl: "https://aistudio.google.com/usage",
    modelsPath: "/models",
    // Signatures on tool calls; never temperature; reasoning_effort only (never with thinking_config).
    quirks: { maxTokensField: "max_tokens", signatures: "gemini", timeoutMs: 600_000 },
    freePlan: {
      kind: "plan",
      setting: "googleFreeTier",
      limits: "Limits per project, shown only in Google AI Studio; daily limits reset at midnight Pacific",
      caveat: "Google uses free-tier prompts to improve its products.",
    },
    freeDayZone: "America/Los_Angeles",
    models: [
      {
        id: "gemini-4-argon",
        name: "Gemini 4 Argon",
        tier: 1,
        speed: "slow",
        context: 1_048_576,
        maxOut: 65_536,
        tools: true,
        vision: true,
        price: [usd(2, 10, "2026-11-30"), usd(4, 20)],
        efforts: LOW_MED_HIGH,
        timeoutMs: 1_200_000,
        note: "Can take several minutes to answer",
      },
      { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", tier: 3, speed: "fast", context: 1_048_576, maxOut: 65_536, tools: true, vision: true, price: [usd(0.75, 3.75, "2026-12-31"), usd(1.5, 7.5)], free: "plan", efforts: LOW_MED_HIGH },
      { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", tier: 3, speed: "fast", context: 1_048_576, maxOut: 65_536, tools: true, vision: true, price: [usd(0.75, 3.75, "2026-12-31"), usd(1.5, 7.5)], free: "plan", efforts: LOW_MED_HIGH },
      { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite", tier: 3, speed: "fast", context: 1_048_576, maxOut: 65_536, tools: true, vision: true, price: [usd(0.3, 2.5)], free: "plan", efforts: LOW_MED_HIGH },
      { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite", tier: 3, speed: "fast", context: 1_048_576, maxOut: 65_536, tools: true, vision: true, price: [usd(0.25, 1.5)], free: "plan", efforts: LOW_MED_HIGH, note: "Shuts down 7 May 2027" },
      {
        id: "gemini-3.1-pro-preview",
        name: "Gemini 3.1 Pro (preview)",
        tier: 2,
        speed: "normal",
        context: 1_048_576,
        maxOut: 65_536,
        tools: true,
        vision: true,
        price: [usd(2, 12)],
        efforts: LOW_MED_HIGH,
        status: "preview",
        longContext: { above: 200_000, text: "Over 200K tokens: $4 in, $18 out per million tokens" },
      },
      { id: "gemma-4-31b-it", name: "Gemma 4 31B", tier: 3, speed: "normal", context: 262_144, maxOut: 32_768, tools: "unverified", vision: true, open: { licence: "Apache-2.0" }, free: "plan", note: "Free tier only; Google's docs don't say it calls tools here" },
    ],
    sources: [
      "https://ai.google.dev/gemini-api/docs/openai",
      "https://ai.google.dev/gemini-api/docs/pricing",
      "https://ai.google.dev/gemini-api/docs/rate-limits",
      "https://ai.google.dev/gemini-api/docs/thought-signatures",
      "https://ai.google.dev/gemini-api/docs/models",
    ],
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    short: "xAI",
    group: "labs",
    adapter: "openai-chat",
    regions: [
      { id: "global", label: "Global", baseUrl: "https://api.x.ai/v1" },
      { id: "us", label: "United States", baseUrl: "https://us.api.x.ai/v1", note: "US only: 10% more, and only Grok 4.7 and 4.6" },
    ],
    keySetting: "xaiKey",
    regionSetting: "xaiRegion",
    keyHint: { pattern: "^xai-\\S+$", text: "xAI keys start with xai-" },
    keysUrl: "https://console.x.ai",
    modelsPath: "/models",
    quirks: { imageTypes: ["image/jpeg", "image/png"], chatHeader: "x-grok-conv-id", timeoutMs: 1_200_000 },
    models: [
      {
        id: "grok-4.7",
        name: "Grok 4.7",
        tier: 1,
        speed: "normal",
        context: 500_000,
        maxOut: 128_000,
        tools: true,
        vision: true,
        price: [usd(2, 6)],
        efforts: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "xhigh" },
        longContext: { above: 200_000, text: "From 200K tokens on, every token costs twice as much ($4 in, $12 out per million)" },
      },
      { id: "grok-4.6", name: "Grok 4.6", tier: 2, speed: "normal", context: 500_000, maxOut: 128_000, tools: true, vision: true, price: [usd(2, 6)], efforts: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "xhigh" } },
      {
        id: "grok-4.3",
        name: "Grok 4.3",
        tier: 3,
        speed: "fast",
        context: M,
        maxOut: 128_000,
        tools: true,
        vision: true,
        price: [usd(1.25, 2.5)],
        efforts: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "xhigh" },
        longContext: { above: 200_000, text: "From 200K tokens on, every token costs twice as much" },
      },
      { id: "grok-4.20-0309-non-reasoning", name: "Grok 4.20 (no reasoning)", tier: 3, speed: "fast", context: M, maxOut: 128_000, tools: true, vision: true, price: [usd(1.25, 2.5)] },
    ],
    sources: ["https://docs.x.ai/docs/models", "https://docs.x.ai/docs/guides/function-calling", "https://docs.x.ai/docs/guides/reasoning"],
  },
  {
    id: "meta",
    label: "Meta (Muse)",
    short: "Meta",
    group: "labs",
    adapter: "openai-chat",
    baseUrl: "https://api.meta.ai/v1",
    keySetting: "metaKey",
    keyHint: { pattern: "^LLM_\\d+_\\S+$", text: "Meta Model API keys look like LLM_<number>_<secret>" },
    keysUrl: "https://dev.meta.ai",
    modelsPath: "/models",
    quirks: { timeoutMs: 1_200_000 },
    models: [
      { id: "muse-spark-1.3", name: "Muse Spark 1.3", tier: 2, speed: "normal", context: 1_048_576, maxOut: 131_072, tools: true, vision: true, price: [usd(1.25, 4.25)], efforts: EVERY },
      {
        id: "muse-spark-1.3-contributor",
        name: "Muse Spark 1.3 (contributor)",
        tier: 3,
        speed: "normal",
        context: 1_048_576,
        maxOut: 131_072,
        tools: true,
        vision: true,
        price: [usd(0.1, 0.2)],
        efforts: { ...EVERY, max: "xhigh" },
        note: "Meta may train on these chats",
      },
      { id: "muse-wonder-1.0", name: "Muse Wonder", tier: 1, speed: "normal", manualOnly: "Preview", context: 1_048_576, maxOut: 131_072, tools: true, vision: true, price: [usd(4, 20)], efforts: EVERY, status: "preview" },
    ],
    sources: ["https://dev.meta.ai/docs/models", "https://dev.meta.ai/docs/protocols/chat-completions", "https://dev.meta.ai/docs/pricing-rate-limits"],
  },
  {
    id: "mistral",
    label: "Mistral",
    short: "Mistral",
    group: "labs",
    adapter: "openai-chat",
    baseUrl: "https://api.mistral.ai/v1",
    keySetting: "mistralKey",
    keysUrl: "https://admin.mistral.ai/organization/api-keys",
    modelsPath: "/models",
    quirks: { maxTokensField: "max_tokens", toolIds: "nine", imageUrl: "string", streamUsage: true },
    freePlan: {
      kind: "plan",
      setting: "mistralFreePlan",
      limits: "Monthly usage included; Mistral doesn't publish how much",
      caveat: "Stops when it's used up (or bills, if pay-as-you-go is on).",
    },
    models: [
      { id: "mistral-large-4", name: "Mistral Large 4", tier: 2, speed: "normal", context: M, maxOut: 32_768, tools: true, vision: true, open: { licence: "Mistral Ecosystem Open Weight Licence" }, price: [usd(0.7, 2.1)], free: "plan", efforts: LOW_MED_HIGH, status: "preview" },
      { id: "mistral-small-2603", name: "Mistral Small 4", tier: 3, speed: "fast", context: 256_000, maxOut: 32_768, tools: true, vision: true, open: { licence: "Apache-2.0" }, price: [usd(0.15, 0.6)], free: "plan", efforts: NONE_HIGH },
      { id: "ministral-14b-2512", name: "Ministral 3 14B", tier: 4, speed: "fast", context: 256_000, maxOut: 32_768, tools: true, vision: true, open: { licence: "Apache-2.0" }, price: [usd(0.2, 0.2)], free: "plan" },
      { id: "zai-glm-5-3", name: "GLM-5.3 (on Mistral)", tier: 2, speed: "normal", context: M, maxOut: 128_000, tools: true, vision: false, open: { licence: "MIT" }, price: [usd(1.4, 4.4)], free: "plan", efforts: LOW_HIGH_MAX, same: "zai/glm-5.3" },
      { id: "zai-glm-5-3-flash", name: "GLM-5.3 Flash (on Mistral)", tier: 3, speed: "fast", context: M, maxOut: 128_000, tools: true, vision: true, open: { licence: "MIT" }, price: [usd(0.15, 0.5)], free: "plan", same: "zai/glm-5.3-flash" },
      { id: "deepseek-v4-1-flash-1017", name: "DeepSeek V4.1 Flash (on Mistral)", tier: 3, speed: "fast", context: M, maxOut: 128_000, tools: true, vision: true, open: { licence: "MIT" }, price: [usd(0.3, 1.2)], free: "plan", status: "preview", same: "deepseek/deepseek-flash" },
    ],
    sources: ["https://docs.mistral.ai/getting-started/models/", "https://mistral.ai/pricing", "https://docs.mistral.ai/capabilities/function_calling/", "https://docs.mistral.ai/deployment/laplateforme/tier/"],
  },
  {
    id: "cohere",
    label: "Cohere",
    short: "Cohere",
    group: "labs",
    adapter: "openai-chat",
    baseUrl: "https://api.cohere.ai/compatibility/v1",
    keySetting: "cohereKey",
    keysUrl: "https://dashboard.cohere.com/api-keys",
    quirks: { maxTokensField: "max_tokens", toolChoice: "omit", systemRole: "developer" },
    freePlan: { kind: "plan", setting: "cohereTrialKey", limits: "1,000 calls a month, 20 a minute", caveat: "Not for commercial use (Cohere's terms for trial keys)." },
    models: [
      {
        id: "command-a-plus-05-2026",
        name: "Command A+",
        tier: 2,
        speed: "normal",
        context: 128_000,
        maxOut: 64_000,
        tools: true,
        vision: true,
        open: { licence: "Apache-2.0" },
        price: [usd(2.5, 10)],
        free: "plan",
        efforts: NONE_HIGH,
        note: "Self-serve keys are trial-limited (Cohere: contact sales)",
      },
      { id: "command-a-03-2025", name: "Command A", tier: 3, speed: "normal", context: 256_000, maxOut: 8_000, tools: true, vision: false, priceNote: "Cohere's price page doesn't list it", free: "plan" },
      { id: "command-r7b-12-2024", name: "Command R7B", tier: 4, speed: "fast", context: 128_000, maxOut: 4_000, tools: true, vision: false, open: { licence: "CC-BY-NC-4.0", nonCommercial: true }, price: [usd(0.0375, 0.15)], free: "plan" },
    ],
    sources: ["https://docs.cohere.com/v2/docs/models.md", "https://docs.cohere.com/v2/docs/compatibility-api.md", "https://docs.cohere.com/v2/docs/rate-limits.md", "https://cohere.com/pricing"],
  },
  // -------------------------------------------------------------------------
  // China
  {
    id: "deepseek",
    label: "DeepSeek",
    short: "DeepSeek",
    group: "china",
    adapter: "openai-chat",
    baseUrl: "https://api.deepseek.com",
    keySetting: "deepseekKey",
    keyHint: { pattern: "^sk-\\S+$", text: "DeepSeek keys start with sk-" },
    keysUrl: "https://platform.deepseek.com/api_keys",
    billingUrl: "https://platform.deepseek.com/top_up",
    modelsPath: "/models",
    quirks: { maxTokensField: "max_tokens", replayReasoning: "required", foreignToolCalls: "flatten", extraBody: { thinking: { type: "enabled" } } },
    models: [
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        tier: 2,
        speed: "normal",
        context: M,
        maxOut: 384_000,
        tools: true,
        vision: false,
        open: { licence: "MIT" },
        price: [usd(1.32, 3.96)],
        efforts: { low: "low", medium: "high", high: "high", xhigh: "high", max: "max" },
        // Open weights: V4's (MIT); DeepSeek's docs don't say whether the 0813 update's weights are out.
        note: "Half price off-peak",
      },
      { id: "deepseek-flash", name: "DeepSeek V4.1 Flash", tier: 3, speed: "fast", context: M, maxOut: 384_000, tools: true, vision: true, open: { licence: "MIT" }, price: [usd(0.3, 1.2)], efforts: { low: "low", medium: "high", high: "high", xhigh: "high", max: "max" }, note: "Half price off-peak" },
    ],
    sources: ["https://api-docs.deepseek.com/quick_start/pricing", "https://api-docs.deepseek.com/guides/thinking_mode", "https://api-docs.deepseek.com/guides/function_calling"],
  },
  {
    id: "moonshot",
    label: "Kimi (Moonshot)",
    short: "Kimi",
    group: "china",
    adapter: "openai-chat",
    regions: [
      { id: "international", label: "International", baseUrl: "https://api.moonshot.ai/v1" },
      { id: "china", label: "China", baseUrl: "https://api.moonshot.cn/v1", cny: true, note: "Keys belong to the platform they were made on" },
    ],
    keySetting: "moonshotKey",
    regionSetting: "moonshotRegion",
    keyHint: { pattern: "^sk-\\S+$", text: "Kimi keys start with sk-" },
    keysUrl: "https://platform.kimi.ai/console/api-keys",
    modelsPath: "/models",
    // Temperature, top_p, n and the penalties are fixed: Fuobe never sends them.
    quirks: { replayReasoning: "preserve" },
    models: [
      { id: "kimi-k3.1-pro", name: "Kimi K3.1 Pro", tier: 1, speed: "normal", context: 1_048_576, maxOut: 131_072, tools: true, vision: true, price: [usd(2, 10)], priceCny: [usd(13, 68)], efforts: LOW_HIGH_MAX, note: "Open weights promised by 4 Nov" },
      {
        id: "kimi-k3.1-pro-highspeed",
        name: "Kimi K3.1 Pro Highspeed",
        tier: 1,
        speed: "fast",
        manualOnly: "The same model as K3.1 Pro, 2–3× faster, at twice the price",
        context: 1_048_576,
        maxOut: 131_072,
        tools: true,
        vision: true,
        price: [usd(4, 20)],
        priceCny: [usd(26, 136)],
        efforts: LOW_HIGH_MAX,
      },
      { id: "kimi-k3", name: "Kimi K3", tier: 2, speed: "normal", context: 1_048_576, maxOut: 131_072, tools: true, vision: true, open: { licence: "Kimi licence (other)" }, price: [usd(3, 15)], priceCny: [usd(20, 100)], efforts: LOW_HIGH_MAX },
    ],
    sources: ["https://platform.kimi.ai/docs/models", "https://platform.kimi.ai/docs/pricing/chat", "https://platform.kimi.ai/docs/guide/use-reasoning-effort", "https://platform.kimi.com/docs/pricing/chat"],
  },
  {
    id: "zai",
    label: "Z.ai (GLM)",
    short: "Z.ai",
    group: "china",
    adapter: "openai-chat",
    regions: [
      { id: "international", label: "International (Z.ai)", baseUrl: "https://api.z.ai/api/paas/v4" },
      { id: "china", label: "China (BigModel)", baseUrl: "https://open.bigmodel.cn/api/paas/v4", cny: true },
    ],
    keySetting: "zaiKey",
    regionSetting: "zaiRegion",
    keysUrl: "https://z.ai/manage-apikey/apikey-list",
    quirks: { maxTokensField: "max_tokens", replayReasoning: "preserve" },
    freeLimits: { text: "Free per token; limits only in Z.ai's console" },
    models: [
      { id: "glm-5.3", name: "GLM-5.3", tier: 2, speed: "normal", context: M, maxOut: 128_000, tools: true, vision: false, open: { licence: "GLM licence (other)" }, price: [usd(1.4, 4.4)], priceCny: [usd(8, 28)], efforts: LOW_HIGH_MAX },
      { id: "glm-5.3-flash", name: "GLM-5.3 Flash", tier: 3, speed: "fast", context: M, maxOut: 128_000, tools: true, vision: true, open: { licence: "MIT" }, price: [usd(0.15, 0.5)], priceCny: [usd(0.8, 2.8)], efforts: LOW_HIGH_MAX },
      { id: "glm-5.3-flashx", name: "GLM-5.3 FlashX", tier: 3, speed: "fast", context: M, maxOut: 128_000, tools: true, vision: true, price: [usd(0.37, 1.25)], priceCny: [usd(2, 7)], efforts: LOW_HIGH_MAX },
      { id: "glm-4.7-flash", name: "GLM-4.7 Flash", tier: 4, speed: "fast", context: 200_000, maxOut: 128_000, tools: true, vision: false, open: { licence: "MIT" }, free: "model" },
      { id: "glm-4.6v-flash", name: "GLM-4.6V Flash", tier: 4, speed: "fast", context: 128_000, maxOut: 32_000, tools: true, vision: true, open: { licence: "MIT" }, free: "model" },
    ],
    sources: ["https://docs.z.ai/guides/overview/pricing", "https://docs.z.ai/api-reference/llm/chat-completion", "https://docs.bigmodel.cn/cn/guide/start/model-overview"],
  },
  {
    id: "qwen",
    label: "Qwen (Alibaba Model Studio)",
    short: "Qwen",
    group: "china",
    adapter: "openai-chat",
    regions: [
      { id: "singapore", label: "Singapore (International)", baseUrl: "https://{workspace}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1" },
      { id: "virginia", label: "US (Virginia)", baseUrl: "https://{workspace}.us-east-1.maas.aliyuncs.com/compatible-mode/v1" },
      { id: "beijing", label: "China (Beijing)", baseUrl: "https://{workspace}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", cny: true },
      { id: "hongkong", label: "Hong Kong", baseUrl: "https://{workspace}.cn-hongkong.maas.aliyuncs.com/compatible-mode/v1" },
      { id: "tokyo", label: "Tokyo", baseUrl: "https://{workspace}.ap-northeast-1.maas.aliyuncs.com/compatible-mode/v1" },
    ],
    keySetting: "qwenKey",
    regionSetting: "qwenRegion",
    workspaceSetting: "qwenWorkspace",
    keyHint: { pattern: "^sk-\\S+$", text: "Model Studio keys start with sk-" },
    keysUrl: "https://modelstudio.console.alibabacloud.com/?tab=globalset#/efm/api_key",
    modelsPath: "/models",
    // The effort is a thinking budget (Fuobe's numbers: the docs set no levels).
    quirks: { maxTokensField: "max_tokens", effortField: "thinking_budget", extraBody: { enable_thinking: true }, streamUsage: true },
    freePlan: { kind: "trial", limits: "1M tokens per model for 90 days (Singapore only), then billed unless Free Quota Only is on" },
    models: [
      { id: "qwen3.8-max", name: "Qwen3.8-Max", tier: 1, speed: "normal", context: 991_808, maxOut: 131_072, tools: true, vision: true, price: [usd(2, 6)], efforts: QWEN_BUDGET },
      { id: "qwen3.8-2.4t-a95b", name: "Qwen3.8 2.4T-A95B", tier: 2, speed: "normal", context: 991_808, maxOut: 131_072, tools: true, vision: false, open: { licence: "Qwen licence (other)" }, price: [usd(2, 6)], efforts: QWEN_BUDGET },
      {
        id: "qwen3.7-plus",
        name: "Qwen3.7-Plus",
        tier: 3,
        speed: "normal",
        context: 991_808,
        maxOut: 131_072,
        tools: true,
        vision: true,
        price: [usd(0.4, 1.6)],
        efforts: QWEN_BUDGET,
        longContext: { above: 256_000, text: "Over 256K tokens: $1.20 in, $4.80 out per million tokens" },
      },
      { id: "qwen3.8-flash", name: "Qwen3.8-Flash", tier: 3, speed: "fast", context: 991_808, maxOut: 131_072, tools: true, vision: true, price: [usd(0.15, 0.47)], efforts: QWEN_BUDGET },
      { id: "qwen3.8-27b", name: "Qwen3.8 27B", tier: 3, speed: "normal", context: 991_808, maxOut: 131_072, tools: true, vision: true, open: { licence: "Apache-2.0" }, price: [usd(0.5, 3)], efforts: QWEN_BUDGET },
    ],
    sources: ["https://www.alibabacloud.com/help/en/model-studio/models", "https://www.alibabacloud.com/help/en/model-studio/model-pricing", "https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope", "https://www.alibabacloud.com/help/en/model-studio/new-free-quota"],
  },
  {
    id: "minimax",
    label: "MiniMax",
    short: "MiniMax",
    group: "china",
    adapter: "openai-chat",
    regions: [
      { id: "international", label: "International", baseUrl: "https://api.minimax.io/v1" },
      { id: "china", label: "China", baseUrl: "https://api.minimax.cn/v1", cny: true },
    ],
    keySetting: "minimaxKey",
    regionSetting: "minimaxRegion",
    keysUrl: "https://platform.minimax.io/user-center/basic-information/interface-key",
    quirks: { toolChoice: "omit", replayReasoning: "preserve", errorEnvelope: "minimax", streamUsage: true },
    models: [
      {
        id: "MiniMax-M3",
        name: "MiniMax M3",
        tier: 2,
        speed: "normal",
        context: M,
        maxOut: 131_072,
        tools: true,
        vision: true,
        open: { licence: "MiniMax licence (other)" },
        price: [usd(0.3, 1.2)],
        priceCny: [usd(2.1, 8.4)],
        longContext: { above: 512_000, text: "Over 512K tokens: $0.60 in, $2.40 out per million tokens" },
      },
      { id: "MiniMax-M3.1-Flash", name: "MiniMax M3.1 Flash", tier: 3, speed: "fast", context: M, maxOut: 131_072, tools: true, vision: true, open: { licence: "MiniMax licence (other)" }, price: [usd(0.15, 0.6)], priceCny: [usd(1, 4)], efforts: EVERY },
    ],
    sources: ["https://platform.minimax.io/docs/guides/models-intro", "https://platform.minimax.io/docs/api-reference/text-chat-openai", "https://platform.minimax.io/docs/pricing/overview"],
  },
  // -------------------------------------------------------------------------
  // Hosts and routers
  {
    id: "openrouter",
    label: "OpenRouter",
    short: "OpenRouter",
    group: "hosts",
    adapter: "openai-chat",
    baseUrl: "https://openrouter.ai/api/v1",
    keySetting: "openrouterKey",
    keyHint: { pattern: "^sk-or-\\S+$", text: "OpenRouter keys start with sk-or-" },
    keysUrl: "https://openrouter.ai/settings/keys",
    billingUrl: "https://openrouter.ai/settings/credits",
    modelsPath: "/models",
    // Its name only: never HTTP-Referer, which would name this install's address.
    quirks: { effortField: "reasoning.effort", replayReasoning: "preserve", headers: { "X-OpenRouter-Title": "Fuobe" } },
    freeLimits: {
      text: "20 a minute, 50 a day (1,000 a day once you've bought 10 credits)",
      caveat: "Some free models' providers may log prompts (see the privacy settings on OpenRouter's site).",
      shared: true,
    },
    models: [
      { id: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "Nemotron 3 Ultra", tier: 2, speed: "normal", context: 1_000_000, maxOut: 65_536, tools: true, vision: false, open: { licence: "licence not stated" }, free: "model" },
      { id: "thinkingmachines/inkling:free", name: "Inkling", tier: 3, speed: "normal", context: 1_048_576, maxOut: 262_144, tools: true, vision: true, open: { licence: "licence not stated" }, free: "model" },
      { id: "nvidia/nemotron-3.5-super-vl:free", name: "Nemotron 3.5 Super VL", tier: 3, speed: "normal", context: 1_000_000, maxOut: 131_072, tools: true, vision: true, open: { licence: "licence not stated" }, free: "model" },
      { id: "google/gemma-4-31b-it:free", name: "Gemma 4 31B", tier: 3, speed: "normal", context: 262_144, maxOut: 32_768, tools: true, vision: true, open: { licence: "Apache-2.0" }, free: "model" },
      { id: "nvidia/nemotron-3.5-lightning:free", name: "Nemotron 3.5 Lightning", tier: 4, speed: "fast", context: 1_000_000, maxOut: 65_536, tools: true, vision: false, open: { licence: "OpenMDW-1.1" }, free: "model" },
      { id: "thinkingmachines/inkling-small:free", name: "Inkling Small", tier: 4, speed: "fast", context: 1_048_576, maxOut: 262_144, tools: true, vision: true, open: { licence: "licence not stated" }, free: "model" },
      { id: "xingchen-agi/xing4.0-29b-a4b:free", name: "Xing4.0 29B", tier: 4, speed: "fast", context: 262_144, maxOut: 235_929, tools: true, vision: false, open: { licence: "licence not stated" }, free: "model" },
      { id: "recursive/flint-v1.0:free", name: "Flint", tier: 4, speed: "normal", context: 262_144, maxOut: 235_929, tools: true, vision: false, open: { licence: "licence not stated" }, free: "model" },
      { id: "cohere/north-mini-code:free", name: "North Mini Code", tier: 4, speed: "fast", context: 256_000, maxOut: 64_000, tools: true, vision: false, open: { licence: "Apache-2.0" }, free: "model", note: "Made for coding" },
      { id: "openrouter/free", name: "Free Models Router", tier: 4, speed: "normal", context: 200_000, maxOut: 32_768, tools: true, vision: false, free: "model", router: true, note: "A random free model each time" },
      { id: "anthropic/claude-opus-5.5", name: "Claude Opus 5.5", tier: 1, speed: "normal", context: M, maxOut: 64_000, tools: true, vision: true, price: [usd(4, 20)], efforts: EVERY, same: "anthropic/claude-opus-5-5" },
      { id: "openai/gpt-6.1-sol", name: "GPT-6.1 Sol", tier: 1, speed: "normal", context: 1_050_000, maxOut: 128_000, tools: true, vision: true, price: [usd(2, 10)], efforts: EVERY, same: "openai/gpt-6.1-sol" },
      { id: "google/gemini-4-argon", name: "Gemini 4 Argon", tier: 1, speed: "slow", context: 1_048_576, maxOut: 65_536, tools: true, vision: true, price: [usd(2, 10)], efforts: LOW_MED_HIGH, same: "google/gemini-4-argon", timeoutMs: 1_200_000 },
      { id: "x-ai/grok-4.7", name: "Grok 4.7", tier: 1, speed: "normal", context: 500_000, maxOut: 128_000, tools: true, vision: true, price: [usd(2, 6)], efforts: { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "xhigh" }, same: "xai/grok-4.7" },
      { id: "moonshotai/kimi-k3.1-pro", name: "Kimi K3.1 Pro", tier: 1, speed: "normal", context: 1_048_576, maxOut: 131_072, tools: true, vision: true, price: [usd(2, 10)], efforts: LOW_HIGH_MAX, same: "moonshot/kimi-k3.1-pro" },
      { id: "qwen/qwen3.8-max-0902", name: "Qwen3.8-Max", tier: 1, speed: "normal", context: M, maxOut: 131_072, tools: true, vision: true, price: [usd(2, 6)], same: "qwen/qwen3.8-max" },
      { id: "z-ai/glm-5.3", name: "GLM-5.3", tier: 2, speed: "normal", context: 1_048_576, maxOut: 128_000, tools: true, vision: false, open: { licence: "GLM licence (other)" }, price: [usd(0.0699, 1.4)], efforts: LOW_HIGH_MAX, same: "zai/glm-5.3" },
      { id: "mistralai/mistral-large-4-0", name: "Mistral Large 4", tier: 2, speed: "normal", context: 1_048_576, maxOut: 32_768, tools: true, vision: true, open: { licence: "Mistral Ecosystem Open Weight Licence" }, price: [usd(0.7, 2.1)], same: "mistral/mistral-large-4" },
      { id: "deepseek/deepseek-v4.1-flash-1017", name: "DeepSeek V4.1 Flash", tier: 3, speed: "fast", context: 1_048_576, maxOut: 131_072, tools: true, vision: true, open: { licence: "MIT" }, price: [usd(0.15, 0.6)], same: "deepseek/deepseek-flash" },
      { id: "minimax/minimax-m3.1-flash", name: "MiniMax M3.1 Flash", tier: 3, speed: "fast", context: 1_048_576, maxOut: 131_072, tools: true, vision: true, open: { licence: "MiniMax licence (other)" }, price: [usd(0.15, 0.6)], same: "minimax/MiniMax-M3.1-Flash" },
    ],
    sources: [
      "https://openrouter.ai/docs/api_reference/limits.md",
      "https://openrouter.ai/docs/api_reference/streaming.md",
      "https://openrouter.ai/docs/guides/features/tool-calling.md",
      "https://openrouter.ai/docs/guides/best-practices/reasoning-tokens.md",
      "https://openrouter.ai/api/v1/models?supported_parameters=tools",
    ],
  },
  {
    id: "groq",
    label: "Groq",
    short: "Groq",
    group: "hosts",
    adapter: "openai-chat",
    baseUrl: "https://api.groq.com/openai/v1",
    keySetting: "groqKey",
    keyHint: { pattern: "^gsk_\\S+$", text: "Groq keys start with gsk_" },
    keysUrl: "https://console.groq.com/keys",
    modelsPath: "/models",
    quirks: { extraBody: { reasoning_format: "parsed" } },
    freePlan: {
      kind: "plan",
      setting: "groqFreePlan",
      limits: "30 a minute, 1,000 a day, 8,000 tokens a minute",
      tooSmall: "Too small for Assist: one Assist step is about 9,000 tokens",
    },
    models: [
      { id: "openai/gpt-oss-120b", name: "gpt-oss-120b", tier: 3, speed: "fast", context: 131_072, maxOut: 65_536, tools: true, vision: false, open: { licence: "Apache-2.0" }, price: [usd(0.15, 0.6)], free: "plan", efforts: LOW_MED_HIGH },
      { id: "openai/gpt-oss-20b", name: "gpt-oss-20b", tier: 4, speed: "fast", context: 131_072, maxOut: 65_536, tools: true, vision: false, open: { licence: "Apache-2.0" }, price: [usd(0.075, 0.3)], free: "plan", efforts: LOW_MED_HIGH },
      { id: "qwen/qwen3.8-27b", name: "Qwen3.8 27B", tier: 3, speed: "fast", context: 131_072, maxOut: 16_384, tools: true, vision: true, maxImages: 3, open: { licence: "Apache-2.0" }, price: [usd(0.8, 4)], free: "plan", efforts: LOW_MED_HIGH, status: "preview" },
    ],
    sources: ["https://console.groq.com/docs/models", "https://console.groq.com/docs/rate-limits", "https://console.groq.com/docs/openai.md", "https://console.groq.com/docs/reasoning.md"],
  },
  {
    id: "cerebras",
    label: "Cerebras",
    short: "Cerebras",
    group: "hosts",
    adapter: "openai-chat",
    baseUrl: "https://api.cerebras.ai/v1",
    keySetting: "cerebrasKey",
    keyHint: { pattern: "^csk-\\S+$", text: "Cerebras keys start with csk-" },
    keysUrl: "https://cloud.cerebras.ai",
    modelsPath: "/models",
    quirks: { imageTypes: ["image/png", "image/jpeg"], maxOutCap: 16_384 },
    freePlan: { kind: "trial", limits: "$5 of credits for 30 days, after adding a card" },
    models: [
      { id: "gpt-oss-120b", name: "gpt-oss-120b", tier: 3, speed: "fast", context: 131_072, maxOut: 40_000, tools: true, vision: false, open: { licence: "Apache-2.0" }, price: [usd(0.35, 0.75)], efforts: LOW_MED_HIGH, note: "About 3,000 tokens a second" },
      { id: "qwen-3.8-27b", name: "Qwen3.8 27B", tier: 3, speed: "fast", context: 128_000, maxOut: 40_000, tools: true, vision: true, maxImages: 10, open: { licence: "Apache-2.0" }, price: [usd(0.99, 1.49)], efforts: LOW_MED_HIGH },
    ],
    sources: ["https://inference-docs.cerebras.ai/models/overview", "https://inference-docs.cerebras.ai/support/rate-limits.md", "https://inference-docs.cerebras.ai/resources/openai.md"],
  },
  {
    id: "together",
    label: "Together AI",
    short: "Together",
    group: "hosts",
    adapter: "openai-chat",
    regions: [
      { id: "global", label: "Global", baseUrl: "https://api.together.ai/v1" },
      { id: "us", label: "United States", baseUrl: "https://us-api.together.ai/v1", note: "US-only processing, 1.25× the price, on some models" },
    ],
    keySetting: "togetherKey",
    regionSetting: "togetherRegion",
    keysUrl: "https://api.together.ai/settings/api-keys",
    modelsPath: "/models",
    quirks: { maxTokensField: "max_tokens", replayReasoning: "preserve", streamUsage: true },
    models: [
      { id: "moonshotai/Kimi-K3", name: "Kimi K3", tier: 2, speed: "normal", context: 1_048_576, maxOut: 131_072, tools: true, vision: true, open: { licence: "Kimi licence (other)" }, price: [usd(3, 15)], same: "moonshot/kimi-k3" },
      { id: "zai-org/GLM-5.3", name: "GLM-5.3", tier: 2, speed: "normal", context: 1_048_575, maxOut: 128_000, tools: true, vision: false, open: { licence: "GLM licence (other)" }, price: [usd(1.4, 4.4)], same: "zai/glm-5.3" },
      { id: "deepseek-ai/DeepSeek-V4-Pro-0813", name: "DeepSeek V4 Pro", tier: 2, speed: "normal", context: 1_048_576, maxOut: 131_072, tools: true, vision: false, open: { licence: "MIT" }, price: [usd(1.32, 3.96)], same: "deepseek/deepseek-v4-pro" },
      { id: "meta-models/Muse-Spark-Open-816B-A42B", name: "Muse Spark Open", tier: 2, speed: "normal", context: 1_048_576, maxOut: 131_072, tools: true, vision: false, open: { licence: "Muse Model Licence" }, price: [usd(1.25, 4.25)] },
      { id: "zai-org/GLM-5.3-Flash", name: "GLM-5.3 Flash", tier: 3, speed: "fast", context: 1_048_575, maxOut: 128_000, tools: true, vision: false, open: { licence: "MIT" }, price: [usd(0.15, 0.5)], same: "zai/glm-5.3-flash" },
      { id: "deepseek-ai/DeepSeek-V4.1-Flash-1017", name: "DeepSeek V4.1 Flash", tier: 3, speed: "fast", context: M, maxOut: 131_072, tools: true, vision: false, open: { licence: "MIT" }, price: [usd(0.3, 1.2)], same: "deepseek/deepseek-flash" },
      { id: "MiniMaxAI/MiniMax-M3.1-Flash", name: "MiniMax M3.1 Flash", tier: 3, speed: "fast", context: 1_048_576, maxOut: 131_072, tools: true, vision: false, open: { licence: "MiniMax licence (other)" }, price: [usd(0.15, 0.6)], same: "minimax/MiniMax-M3.1-Flash" },
      { id: "nvidia/NVIDIA-Nemotron-3.5-Super-VL", name: "Nemotron 3.5 Super VL", tier: 3, speed: "fast", context: 262_144, maxOut: 65_536, tools: true, vision: true, open: { licence: "licence not stated" }, price: [usd(0.15, 0.5)] },
      { id: "openai/gpt-oss-120b", name: "gpt-oss-120b", tier: 3, speed: "fast", context: 131_072, maxOut: 65_536, tools: true, vision: false, open: { licence: "Apache-2.0" }, price: [usd(0.15, 0.6)], efforts: LOW_MED_HIGH },
      { id: "Qwen/Qwen3.8-Flash", name: "Qwen3.8 Flash", tier: 3, speed: "fast", context: M, maxOut: 131_072, tools: true, vision: false, price: [usd(0.15, 0.47)], same: "qwen/qwen3.8-flash" },
      { id: "Qwen/Qwen3.5-9B", name: "Qwen3.5 9B", tier: 4, speed: "fast", context: 262_144, maxOut: 32_768, tools: true, vision: true, open: { licence: "Apache-2.0" }, price: [usd(0.17, 0.25)] },
    ],
    sources: ["https://docs.together.ai/docs/serverless/models.md", "https://docs.together.ai/docs/billing.md", "https://docs.together.ai/docs/inference/chat/reasoning.md"],
  },
  {
    id: "fireworks",
    label: "Fireworks AI",
    short: "Fireworks",
    group: "hosts",
    adapter: "openai-chat",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    keySetting: "fireworksKey",
    keyHint: { pattern: "^fw_\\S+$", text: "Fireworks keys start with fw_" },
    keysUrl: "https://app.fireworks.ai/settings/users/api-keys",
    modelsPath: "/models",
    // Without "error", Fireworks quietly lowers max_tokens when a chat is long.
    quirks: { maxTokensField: "max_tokens", replayReasoning: "preserve", extraBody: { context_length_exceeded_behavior: "error" } },
    models: [
      { id: "accounts/fireworks/models/kimi-k3", name: "Kimi K3", tier: 2, speed: "normal", context: 1_048_576, maxOut: 131_072, tools: true, vision: true, open: { licence: "Kimi licence (other)" }, price: [usd(3, 15)], same: "moonshot/kimi-k3" },
      { id: "accounts/fireworks/models/glm-5p3", name: "GLM-5.3", tier: 2, speed: "normal", context: 1_048_576, maxOut: 128_000, tools: true, vision: false, open: { licence: "GLM licence (other)" }, price: [usd(1.4, 4.4)], same: "zai/glm-5.3" },
      { id: "accounts/fireworks/models/minimax-m3", name: "MiniMax M3", tier: 2, speed: "normal", context: 512_000, maxOut: 131_072, tools: true, vision: false, open: { licence: "MiniMax licence (other)" }, price: [usd(0.3, 1.2)], same: "minimax/MiniMax-M3" },
      { id: "accounts/fireworks/models/muse-spark-open", name: "Muse Spark Open", tier: 2, speed: "normal", context: 1_048_576, maxOut: 131_072, tools: true, vision: true, open: { licence: "Muse Model Licence" }, price: [usd(1.25, 4.25)] },
      { id: "accounts/fireworks/models/qwen3p8-max", name: "Qwen3.8 2.4T-A95B", tier: 2, speed: "normal", context: 991_808, maxOut: 131_072, tools: true, vision: true, open: { licence: "Qwen licence (other)" }, price: [usd(2, 6)], note: "Fireworks calls it Qwen 3.8 Max; it is the open 2.4T model", same: "qwen/qwen3.8-2.4t-a95b" },
      { id: "accounts/fireworks/models/nemotron-3-ultra-nvfp4", name: "Nemotron 3 Ultra", tier: 2, speed: "normal", context: 262_144, maxOut: 65_536, tools: true, vision: false, open: { licence: "licence not stated" }, price: [usd(0.6, 2.4)], status: "preview" },
      { id: "accounts/fireworks/models/glm-5p3-flash", name: "GLM-5.3 Flash", tier: 3, speed: "fast", context: 1_048_576, maxOut: 128_000, tools: true, vision: true, open: { licence: "MIT" }, price: [usd(0.15, 0.5)], same: "zai/glm-5.3-flash" },
      { id: "accounts/fireworks/models/deepseek-v4p1-flash-1017", name: "DeepSeek V4.1 Flash", tier: 3, speed: "fast", context: 1_048_576, maxOut: 131_072, tools: true, vision: true, open: { licence: "MIT" }, price: [usd(0.3, 1.2)], same: "deepseek/deepseek-flash" },
      { id: "accounts/fireworks/models/gpt-oss-120b", name: "gpt-oss-120b", tier: 3, speed: "fast", context: 131_072, maxOut: 65_536, tools: true, vision: false, open: { licence: "Apache-2.0" }, price: [usd(0.15, 0.6)], efforts: LOW_MED_HIGH },
      { id: "accounts/fireworks/models/nemotron-lightning-3p5-30b-a3b", name: "Nemotron 3.5 Lightning", tier: 4, speed: "fast", context: 262_144, maxOut: 65_536, tools: true, vision: false, open: { licence: "OpenMDW-1.1" }, price: [usd(0.05, 0.2)] },
    ],
    sources: ["https://docs.fireworks.ai/serverless/pricing.md", "https://docs.fireworks.ai/tools-sdks/openai-compatibility.md", "https://docs.fireworks.ai/guides/reasoning.md"],
  },
  {
    id: "huggingface",
    label: "Hugging Face",
    short: "Hugging Face",
    group: "hosts",
    adapter: "openai-chat",
    baseUrl: "https://router.huggingface.co/v1",
    keySetting: "huggingfaceToken",
    keyHint: { pattern: "^hf_\\S+$", text: "Hugging Face tokens start with hf_ (a fine-grained one, with Inference Providers on)" },
    keysUrl: "https://huggingface.co/settings/tokens",
    modelsPath: "/models",
    quirks: { maxTokensField: "max_tokens", streamUsage: true },
    freePlan: { kind: "trial", limits: "PRO accounts get $2 of credits a month; others pay per use" },
    // Each id names the cheapest provider that calls tools (Hugging Face's router list, 31 Oct 2026).
    models: [
      { id: "zai-org/GLM-5.3:deepinfra", name: "GLM-5.3", tier: 2, speed: "normal", context: 1_048_576, maxOut: 128_000, tools: true, vision: false, open: { licence: "GLM licence (other)" }, price: [usd(0.9, 4)], same: "zai/glm-5.3" },
      { id: "moonshotai/Kimi-K3:deepinfra", name: "Kimi K3", tier: 2, speed: "normal", context: 1_048_576, maxOut: 131_072, tools: true, vision: true, open: { licence: "Kimi licence (other)" }, price: [usd(2.85, 14.25)], same: "moonshot/kimi-k3" },
      { id: "meta-models/Muse-Spark-Open-816B-A42B:baseten", name: "Muse Spark Open", tier: 2, speed: "normal", context: 1_048_576, maxOut: 131_072, tools: true, vision: true, open: { licence: "Muse Model Licence" }, price: [usd(1.25, 4.25)] },
      { id: "deepseek-ai/DeepSeek-V4.1-Flash-1017:novita", name: "DeepSeek V4.1 Flash", tier: 3, speed: "fast", context: 1_048_576, maxOut: 131_072, tools: true, vision: true, open: { licence: "MIT" }, price: [usd(0.3, 1.2)], same: "deepseek/deepseek-flash" },
      { id: "zai-org/GLM-5.3-Flash:novita", name: "GLM-5.3 Flash", tier: 3, speed: "fast", context: 1_048_576, maxOut: 128_000, tools: true, vision: true, open: { licence: "MIT" }, price: [usd(0.15, 0.5)], same: "zai/glm-5.3-flash" },
      { id: "MiniMaxAI/MiniMax-M3.1-Flash:novita", name: "MiniMax M3.1 Flash", tier: 3, speed: "fast", context: M, maxOut: 131_072, tools: true, vision: true, open: { licence: "MiniMax licence (other)" }, price: [usd(0.15, 0.6)], same: "minimax/MiniMax-M3.1-Flash" },
      { id: "Qwen/Qwen3.8-27B:cerebras", name: "Qwen3.8 27B", tier: 3, speed: "fast", context: 65_536, maxOut: 32_768, tools: true, vision: true, open: { licence: "Apache-2.0" }, price: [usd(0.99, 1.49)] },
      { id: "google/gemma-4-31B-it:novita", name: "Gemma 4 31B", tier: 3, speed: "normal", context: 262_144, maxOut: 32_768, tools: true, vision: true, open: { licence: "Apache-2.0" }, price: [usd(0.14, 0.4)] },
      { id: "nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-NVFP4:baseten", name: "Nemotron 3.5 Super VL", tier: 3, speed: "fast", context: 1_048_576, maxOut: 65_536, tools: true, vision: true, open: { licence: "licence not stated" }, price: [usd(0.2, 0.5)] },
      { id: "openai/gpt-oss-120b:deepinfra", name: "gpt-oss-120b", tier: 3, speed: "fast", context: 131_072, maxOut: 65_536, tools: true, vision: false, open: { licence: "Apache-2.0" }, price: [usd(0.037, 0.17)], efforts: LOW_MED_HIGH },
    ],
    sources: ["https://huggingface.co/docs/inference-providers/index.md", "https://huggingface.co/docs/inference-providers/pricing.md", "https://router.huggingface.co/v1/models"],
  },
  // -------------------------------------------------------------------------
  // On this machine: models come from the server (src/server/llm/servers.ts).
  { id: "ollama", label: "Ollama", short: "Ollama", group: "local", adapter: "local", quirks: {}, models: [], sources: ["https://docs.ollama.com/api"] },
  { id: "lmstudio", label: "LM Studio", short: "LM Studio", group: "local", adapter: "local", quirks: {}, models: [], sources: ["https://lmstudio.ai/docs/developer"] },
  { id: "unsloth", label: "Unsloth Studio", short: "Unsloth Studio", group: "local", adapter: "local", quirks: {}, models: [], sources: ["https://unsloth.ai/docs/basics/api"] },
  { id: "custom", label: "Other OpenAI-compatible server", short: "your local server", group: "local", adapter: "local", quirks: {}, models: [], sources: [] },
];



/**
 * Local models Fuobe knows by name (the 32 GB picks), for ranking and the open-weights label. A model
 * that isn't here is tier 4 and sees pictures only when its server says so.
 */
export const KNOWN_LOCAL_MODELS: { match: RegExp; name: string; vision: boolean; licence: string }[] = [
  { match: /qwen3\.8.*27b/i, name: "Qwen3.8 27B", vision: true, licence: "Apache-2.0" },
  { match: /muse-glimmer/i, name: "Muse Glimmer 30B", vision: true, licence: "Apache-2.0" },
  { match: /gemma-?4.*31b/i, name: "Gemma 4 31B", vision: true, licence: "Apache-2.0" },
  { match: /gemma-?4.*26b/i, name: "Gemma 4 26B", vision: true, licence: "Apache-2.0" },
  { match: /qwen3\.6.*(27|35)b/i, name: "Qwen3.6", vision: true, licence: "Apache-2.0" },
  { match: /glm-4\.7-flash/i, name: "GLM-4.7 Flash", vision: false, licence: "MIT" },
  { match: /gpt-oss.*20b/i, name: "gpt-oss-20b", vision: false, licence: "Apache-2.0" },
  { match: /nemotron-3\.5-lightning/i, name: "Nemotron 3.5 Lightning", vision: false, licence: "OpenMDW-1.1" },
];

export const getLlmProvider = (id: string | null | undefined): LlmProviderDef | undefined => LLM_PROVIDERS.find((p) => p.id === id);

export const getLlmModel = (provider: string | null | undefined, model: string | null | undefined): LlmModelDef | undefined => getLlmProvider(provider)?.models.find((m) => m.id === model);

/**
 * Settings' Free tag: free models on any key, or a free plan the owner can tick that is big enough for Assist
 * (Groq's isn't: 8,000 tokens a minute). Trials run out, so they never count.
 */
export const offersFree = (p: LlmProviderDef): boolean => p.models.some((m) => m.free === "model") || (p.freePlan?.kind === "plan" && !p.freePlan.tooSmall);

/** The price in effect on a day (YYYY-MM-DD): the first step whose `until` hasn't passed. */
export function priceOn(steps: PriceStep[] | undefined, day: string): PriceStep | undefined {
  return steps?.find((s) => !s.until || day <= s.until) ?? steps?.at(-1);
}

/** The key of a provider's own model ("zai/glm-5.3"), as hosts' `same` names it. */
export const modelKey = (provider: string, model: string) => `${provider}/${model}`;
