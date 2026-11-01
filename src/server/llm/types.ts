/**
 * Local LLM servers: Ollama (its own API), LM Studio, Unsloth Studio, and any other
 * OpenAI-compatible server (llama.cpp's llama-server, vLLM, Jan…). One layer serves text steps,
 * llmText() and the Assist agent; the request and response shapes here are neutral (OpenAI-like).
 */

export type LocalKind = "ollama" | "lmstudio" | "unsloth" | "custom";

/** The order Automatic tries them in: Ollama first, so installs that had it keep it. */
export const LOCAL_KINDS: LocalKind[] = ["ollama", "lmstudio", "unsloth", "custom"];

export interface LocalServer {
  kind: LocalKind;
  /** "Ollama", "LM Studio", "Unsloth Studio", or "your local server" for the custom one. */
  label: string;
  /** No trailing slash. Ollama, LM Studio and Unsloth: the server root (a pasted /v1 is dropped). Custom: as given. */
  url: string;
  /** The model picked in Settings ("" = Fuobe picks). */
  model: string;
  /** Bearer token; never leaves the server. */
  key: string;
}

export interface LocalModel {
  id: string;
  name?: string;
  /** In memory now (LM Studio, Unsloth). */
  loaded?: boolean;
  /** LM Studio: trained for tool calling. */
  tools?: boolean;
  /** LM Studio: thinks before answering by default. */
  reasoning?: boolean;
  /** Context of the loaded copy, in tokens. */
  context?: number | null;
  maxContext?: number | null;
  /** LM Studio: ids of its loaded copies (to unload before a reload). */
  instances?: string[];
}

export interface LocalStatus {
  kind: LocalKind;
  label: string;
  url: string;
  /** Something answered at the URL (for Unsloth: Unsloth Studio itself). */
  up: boolean;
  auth: "none" | "ok" | "missing" | "rejected";
  /** Chat models only (no embedding, speech or image models). */
  models: LocalModel[];
  /** The model a call uses now (Unsloth: the loaded one; null: none to use). */
  model: string | null;
  /** Whether that model is in memory (null: the server doesn't say). */
  loaded: boolean | null;
  /** Its context window in tokens, when known. */
  context: number | null;
  /** Why it can't run, in the user's words (null = ready). */
  problem: string | null;
  /** Ready, but worth knowing: a small context, a model that thinks first, a model that may be missing. */
  warning: string | null;
  /** LM Studio's own API answered, so Fuobe can load a model with the context it needs. */
  native?: boolean;
  at: number;
}

export interface ChatToolCall {
  id: string;
  name: string;
  input: unknown;
  /** Gemini's thought signature on the call (tool_calls[i].extra_content), sent back as received. */
  extra?: unknown;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ChatToolCall[];
  /** Tool results: the call they answer (OpenAI). */
  toolCallId?: string;
  /** Tool results: the tool's name (Ollama). */
  toolName?: string;
  /** User turns: pictures for a model that can see (base64, JPEG, PNG, GIF or WebP); a text-only model answers from the words. */
  images?: { data: string; contentType: string }[];
  /** Assistant turns (hosted providers): the reasoning to send back, under the field it came in. */
  reasoning?: { field: string; text: string };
  /** Assistant turns on OpenRouter: reasoning_details, sent back as received. */
  details?: unknown[];
  /** Assistant turns on OpenAI's Responses API: the turn's output items (encrypted reasoning included), sent back unchanged. */
  items?: unknown[];
}

/**
 * What a hosted provider needs back on its own earlier turns, kept on the stored assistant message as
 * `replay`. It goes back only to the provider that made it (reasoning only to the same model), and
 * never to Anthropic (src/server/assist/agent.ts forAnthropic).
 */
export interface Replay {
  provider: string;
  model: string;
  reasoning?: { field: string; text: string };
  /** OpenRouter's reasoning_details. */
  details?: unknown[];
  /** OpenAI Responses: the turn's output items (encrypted reasoning included), replayed unchanged. */
  items?: unknown[];
  /** Stored tool_use id → the provider's own id, when its id didn't fit the stored pattern. */
  toolIds?: Record<string, string>;
  /** Stored tool_use id → Gemini's extra_content (its thought signature). */
  extra?: Record<string, unknown>;
}

/** A JSON Schema the answer must follow (root object or array), or "object" for any JSON object. */
export type JsonSpec = { name: string; schema: Record<string, unknown> } | "object";

export interface ChatTool {
  name: string;
  description?: string;
  parameters: unknown;
}

export interface ChatRequest {
  messages: ChatMessage[];
  /** Overrides the server's model for this call (Assist's Manual mode). */
  model?: string | null;
  tools?: ChatTool[];
  json?: JsonSpec;
  /** false: ask the server not to think (one-shot text). Undefined: the server's default (Assist). */
  think?: boolean;
  maxTokens?: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface ChatResult {
  /** The answer, with <think> blocks removed (reasoning fields are ignored). */
  text: string;
  toolCalls: ChatToolCall[];
  stop: "end" | "tool_use" | "length";
  model: string;
  /** The reply carried reasoning (thinking) besides the answer. */
  thought: boolean;
}
