import "server-only";
import { customAlphabet } from "nanoid";
import type { ChatMessage, ChatRequest, ChatResult, ChatToolCall, JsonSpec, LocalKind } from "./types";

/*
 * Request bodies and answers for the two wires, as pure functions: Ollama's own /api/chat (it has
 * num_ctx, think and a schema in `format`), and OpenAI's /v1/chat/completions for LM Studio,
 * Unsloth Studio and any other OpenAI-compatible server, with small differences per server.
 */

/** Tool-call ids as strict chat templates (Mistral's) want them: nine letters and digits. */
export const newToolId = customAlphabet("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", 9);

/** The answer without its thinking: <think>…</think>, a closing tag whose opening one was in the prompt, a thought cut off. */
export function stripThink(s: string): string {
  let t = s.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const close = t.search(/<\/think>/i);
  if (close >= 0) t = t.slice(close + "</think>".length);
  return t.replace(/<think>[\s\S]*$/i, "").trim();
}

/** Tool arguments: an object, or a JSON string (a broken one reaches the tool as INVALID_JSON, which tells the model what to fix). */
export function toolInput(args: unknown): unknown {
  if (typeof args !== "string") return args ?? {};
  if (!args.trim()) return {};
  try {
    return JSON.parse(args);
  } catch {
    return { INVALID_JSON: args };
  }
}

const toolList = (req: ChatRequest) => req.tools?.map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.parameters } }));

// ---------------------------------------------------------------------------
// Ollama: POST {url}/api/chat

export function ollamaBody(req: ChatRequest, model: string, context: number, withJson = true): Record<string, unknown> {
  const tools = toolList(req);
  return {
    model,
    stream: false,
    ...(req.think === false && { think: false }),
    messages: req.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.toolCalls?.length && { tool_calls: m.toolCalls.map((c) => ({ function: { name: c.name, arguments: c.input } })) }),
      ...(m.toolName && { tool_name: m.toolName }),
      ...(m.images?.length && { images: m.images.map((i) => i.data) }),
    })),
    ...(tools?.length && { tools }),
    ...(withJson && req.json && { format: req.json === "object" ? "json" : req.json.schema }),
    ...((context > 0 || req.maxTokens) && { options: { ...(context > 0 && { num_ctx: context }), ...(req.maxTokens && { num_predict: req.maxTokens }) } }),
  };
}

interface OllamaReply {
  model?: string;
  message?: { content?: string; thinking?: string; tool_calls?: { function?: { name?: string; arguments?: unknown } }[] };
  done_reason?: string;
}

export function parseOllama(j: OllamaReply, model: string): ChatResult {
  const raw = j.message?.content ?? "";
  const toolCalls: ChatToolCall[] = (j.message?.tool_calls ?? []).flatMap((c) => (c.function?.name ? [{ id: newToolId(), name: c.function.name, input: toolInput(c.function.arguments) }] : []));
  return {
    text: stripThink(raw),
    toolCalls,
    stop: toolCalls.length ? "tool_use" : j.done_reason === "length" ? "length" : "end",
    model: j.model || model,
    thought: !!j.message?.thinking || /<\/think>/i.test(raw),
  };
}

// ---------------------------------------------------------------------------
// OpenAI-compatible: POST {base}/chat/completions

type WirePart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

type WireMessage =
  | { role: "system" | "user"; content: string | WirePart[] }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

function wireMessage(m: ChatMessage): WireMessage {
  if (m.role === "assistant") {
    const calls = m.toolCalls ?? [];
    return calls.length
      ? { role: "assistant", content: m.content || null, tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) } })) }
      : { role: "assistant", content: m.content };
  }
  if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId ?? "", content: m.content };
  // Pictures as data URLs before the words (OpenAI's vision format, which LM Studio and llama-server read).
  if (m.role === "user" && m.images?.length) {
    return { role: "user", content: [...m.images.map((i): WirePart => ({ type: "image_url", image_url: { url: `data:${i.contentType};base64,${i.data}` } })), { type: "text", text: m.content }] };
  }
  return { role: m.role, content: m.content };
}

/**
 * `response_format` per server. A schema goes as json_schema everywhere, with `strict` except on
 * LM Studio (its docs send `"strict": "true"`, a string; LM Studio builds a grammar from the schema
 * either way, so it's left out); "any object" is json_object, except on LM Studio, which only documents
 * json_schema, so it gets the schema of any object.
 */
export function responseFormat(kind: LocalKind, json: JsonSpec): Record<string, unknown> {
  if (json === "object") return kind === "lmstudio" ? { type: "json_schema", json_schema: { name: "answer", schema: { type: "object" } } } : { type: "json_object" };
  return { type: "json_schema", json_schema: { name: json.name, ...(kind !== "lmstudio" && { strict: true }), schema: json.schema } };
}

/**
 * The request body. `model` null leaves the field out: Unsloth Studio then answers with the model
 * loaded in it. Unsloth also gets enable_tools:false on every call, so a prompt never runs its
 * server-side Python, shell or web search (Fuobe's prompts carry text from the web).
 */
export function openaiBody(kind: LocalKind, req: ChatRequest, model: string | null, withJson = true): Record<string, unknown> {
  const tools = toolList(req);
  return {
    ...(model && { model }),
    messages: req.messages.map(wireMessage),
    stream: false,
    ...(tools?.length && { tools, tool_choice: "auto" }),
    ...(withJson && req.json && { response_format: responseFormat(kind, req.json) }),
    ...(req.maxTokens && { max_tokens: req.maxTokens }),
    ...(kind === "unsloth" && { enable_tools: false, ...(req.think === false && { enable_thinking: false }) }),
  };
}

interface OpenAiReply {
  model?: string;
  choices?: {
    finish_reason?: string | null;
    message?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: unknown } }[] | null };
  }[];
}

export function parseOpenai(j: OpenAiReply, model: string): ChatResult {
  const choice = j.choices?.[0];
  const msg = choice?.message;
  const raw = typeof msg?.content === "string" ? msg.content : "";
  // Fuobe makes its own ids: the server's may be any shape ("call_…", digits, or none).
  const toolCalls: ChatToolCall[] = (msg?.tool_calls ?? []).flatMap((c) => (c?.function?.name ? [{ id: newToolId(), name: c.function.name, input: toolInput(c.function.arguments) }] : []));
  return {
    text: stripThink(raw),
    toolCalls,
    stop: toolCalls.length ? "tool_use" : choice?.finish_reason === "length" ? "length" : "end",
    model: j.model || model,
    thought: !!(msg?.reasoning_content || msg?.reasoning) || /<\/think>/i.test(raw),
  };
}
