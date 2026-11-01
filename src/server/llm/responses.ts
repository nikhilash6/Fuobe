import "server-only";
import type { LlmModelDef } from "@/lib/catalog/llm-providers";
import { hostedError, HostedError } from "./hosted-errors";
import type { Endpoint, HostedRequest, HostedResult } from "./hosted";
import { postHosted } from "./hosted";
import { FITS_ID } from "./hosted-messages";
import { healToolCalls } from "./messages";
import { readSse, StreamError, type StreamUsage } from "./sse";
import type { ChatMessage, ChatToolCall } from "./types";
import { newToolId, stripThink, toolInput } from "./wire";

/*
 * OpenAI's Responses API, which OpenAI's GPT-6.x models need for tool calls ("Starting with GPT-5.4, Chat
 * Completions does not support tool calling with reasoning_effort values other than none"). Stateless
 * (store: false): Fuobe's chat is the record, and a turn OpenAI made goes back as the output items it
 * came as, encrypted reasoning included, so the model keeps its thinking across tool calls. The stream's
 * typed events are read for the finished response only.
 */

type Item = Record<string, unknown> & { type?: string };

/** The history as Responses input items; the system message becomes `instructions`. */
export function responsesInput(messages: ChatMessage[]): { instructions: string; input: Item[] } {
  const instructions = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const input: Item[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      input.push({ type: "function_call_output", call_id: m.toolCallId ?? "", output: m.content });
      continue;
    }
    if (m.role === "assistant") {
      // OpenAI's own turn, as it came (reasoning items with encrypted_content, then messages and calls).
      if (m.items?.length) {
        input.push(...(m.items as Item[]));
        continue;
      }
      if (m.content) input.push({ role: "assistant", content: [{ type: "output_text", text: m.content }] });
      for (const c of m.toolCalls ?? []) input.push({ type: "function_call", call_id: c.id, name: c.name, arguments: JSON.stringify(c.input ?? {}) });
      continue;
    }
    const parts: Item[] = [...(m.images ?? []).map((i) => ({ type: "input_image", image_url: `data:${i.contentType};base64,${i.data}` })), ...(m.content ? [{ type: "input_text", text: m.content }] : [])];
    if (parts.length) input.push({ role: "user", content: parts });
  }
  return { instructions, input };
}

/** The request body: stateless, streamed, tools flat and not strict (Fuobe's schemas have optional fields). */
export function responsesBody(model: LlmModelDef, req: HostedRequest & { maxTokens: number }): Record<string, unknown> {
  const { instructions, input } = responsesInput(req.messages);
  const effort = model.efforts?.[req.effort ?? "medium"];
  return {
    model: model.id,
    instructions,
    input,
    ...(req.tools?.length && {
      tools: req.tools.map((t) => ({ type: "function", name: t.name, description: t.description ?? "", parameters: t.parameters, strict: false })),
      tool_choice: "auto",
      parallel_tool_calls: true,
    }),
    ...(effort && { reasoning: { effort } }),
    max_output_tokens: req.maxTokens,
    store: false,
    stream: true,
  };
}

interface Response {
  status?: string;
  model?: string;
  output?: Item[];
  usage?: { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number } };
  incomplete_details?: { reason?: string };
  error?: { code?: string; message?: string };
}

/** One Assist step on OpenAI's Responses API. */
export async function chatResponses(ep: Endpoint, model: LlmModelDef, req: HostedRequest & { maxTokens: number }): Promise<HostedResult> {
  const p = ep.provider;
  const res = await postHosted(ep, "/responses", responsesBody(model, req), { model, timeoutMs: model.timeoutMs ?? p.quirks.timeoutMs ?? 600_000, signal: req.signal });
  if (!res.body) throw new HostedError(`${p.label} sent an empty answer`, 502, p.id);
  let done: Response | null = null;
  let failed: { status: number; message: string } | null = null;
  try {
    await readSse(res.body, (payload) => {
      let e: { type?: string; response?: Response; code?: string; message?: string };
      try {
        e = JSON.parse(payload);
      } catch {
        return;
      }
      if (e.type === "response.completed" || e.type === "response.incomplete") {
        done = e.response ?? null;
        return "done";
      }
      if (e.type === "response.failed") {
        failed = { status: 500, message: e.response?.error?.message ?? "The response failed" };
        return "done";
      }
      if (e.type === "error") {
        failed = { status: /rate_limit/.test(e.code ?? "") ? 429 : /context_length/.test(e.code ?? "") ? 400 : 500, message: e.message ?? "OpenAI reported an error" };
        return "done";
      }
    });
  } catch (e) {
    if (e instanceof StreamError) throw hostedError(p, 502, JSON.stringify({ error: { message: e.message } }), model, ep.key);
    throw e;
  }
  const fail = failed as { status: number; message: string } | null;
  if (fail) throw hostedError(p, fail.status, JSON.stringify({ error: { message: fail.message } }), model, ep.key);
  const r = done as Response | null;
  if (!r) throw new HostedError(`${p.label}'s answer ended before it was complete`, 502, p.id);
  const output = r.output ?? [];
  const toolIds: Record<string, string> = {};
  let toolCalls: ChatToolCall[] = output.flatMap((i) => {
    if (i.type !== "function_call" || typeof i.name !== "string") return [];
    const callId = String(i.call_id ?? "");
    const id = FITS_ID.test(callId) ? callId : newToolId();
    if (id !== callId) toolIds[id] = callId;
    return [{ id, name: i.name, input: toolInput(i.arguments) }];
  });
  let text = stripThink(
    output
      .flatMap((i) => (i.type === "message" && Array.isArray(i.content) ? (i.content as { type?: string; text?: string }[]).flatMap((c) => (c.type === "output_text" && c.text ? [c.text] : [])) : []))
      .join("\n"),
  );
  if (req.tools?.length && !toolCalls.length && text) {
    const healed = healToolCalls(text, new Set(req.tools.map((t) => t.name)));
    if (healed.calls.length) ({ text, calls: toolCalls } = { text: healed.text, calls: healed.calls });
  }
  const u = r.usage;
  const usage: StreamUsage | null = u ? { input: u.input_tokens, output: u.output_tokens, cached: u.input_tokens_details?.cached_tokens, reasoning: u.output_tokens_details?.reasoning_tokens } : null;
  const length = r.status === "incomplete" && r.incomplete_details?.reason === "max_output_tokens";
  return {
    text,
    toolCalls,
    stop: toolCalls.length ? "tool_use" : length ? "length" : "end",
    model: r.model ?? model.id,
    thought: output.some((i) => i.type === "reasoning"),
    // The turn goes back as it came: its call ids are the ones in these items (stored ids map to them).
    replay: { provider: p.id, model: model.id, items: output, ...(Object.keys(toolIds).length && { toolIds }) },
    usage,
    finish: r.status ?? null,
  };
}
