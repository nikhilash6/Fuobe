import "server-only";
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { ChatMessage, ChatToolCall, LocalKind } from "./types";
import { newToolId, toolInput } from "./wire";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

/*
 * Assist keeps its history in Claude's shape. These turn it into chat messages a local model's chat
 * template accepts, and read tool calls a model wrote as text.
 */

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** A stored tool_use id as nine letters and digits, the same every time, so a call and its result still match. */
export function wireId(id: string): string {
  if (/^[A-Za-z0-9]{9}$/.test(id)) return id;
  const h = createHash("sha256").update(id).digest();
  let out = "";
  for (let i = 0; i < 9; i++) out += B62[h[i] % 62];
  return out;
}

const blockText = (c: ToolResult["content"]): string =>
  typeof c === "string" ? c : (c ?? []).map((b) => (b.type === "text" ? b.text : b.type === "image" ? "[image omitted]" : "")).join("\n");

/** How a mid-chat context update reads when it can't be a system message. */
export const CONTEXT_UPDATE_LABEL = "Context update from Fuobe (not the user):";

/**
 * The stored history as chat messages: one system message first, then the turns. Images stay out
 * (the user's text lists their URLs). Tool results follow the call they answer.
 *
 * Ollama gets the history as before: mid-chat context updates stay system messages and results carry
 * the tool's name. The OpenAI-compatible servers get it shaped for strict chat templates (Gemma,
 * Mistral, some Qwen ones), which reject a system message after the first and turns that don't
 * alternate: a context update joins the user's turn (or follows the tool results as one), user turns
 * in a row are merged, and tool-call ids are nine letters and digits.
 */
export function toChatMessages(system: { stable: string; turn: string }, history: MessageParam[], kind: LocalKind): ChatMessage[] {
  const ollama = kind === "ollama";
  const id = (x: string) => (ollama ? x : wireId(x));
  const names = new Map<string, string>();
  const out: ChatMessage[] = [{ role: "system", content: `${system.stable}\n\n${system.turn}` }];
  for (const m of history) {
    // Context updates are stored as role "system", which Claude's own message type doesn't name.
    const role = m.role as "user" | "assistant" | "system";
    const texts = typeof m.content === "string" ? [m.content] : m.content.flatMap((b) => (b.type === "text" ? [b.text] : []));
    if (role === "system") {
      const text = texts.join("\n");
      out.push(ollama ? { role: "system", content: text } : { role: "user", content: `${CONTEXT_UPDATE_LABEL}\n${text}` });
      continue;
    }
    if (role === "assistant") {
      const calls: ChatToolCall[] =
        typeof m.content === "string"
          ? []
          : m.content.flatMap((b) => {
              if (b.type !== "tool_use") return [];
              names.set(b.id, b.name);
              return [{ id: id(b.id), name: b.name, input: b.input }];
            });
      out.push({ role: "assistant", content: texts.join("\n"), ...(calls.length && { toolCalls: calls }) });
      continue;
    }
    if (typeof m.content !== "string") {
      for (const b of m.content) {
        if (b.type === "tool_result") out.push({ role: "tool", toolCallId: id(b.tool_use_id), toolName: names.get(b.tool_use_id), content: `${b.is_error ? "Error: " : ""}${blockText(b.content)}` });
      }
    }
    const text = texts.join("\n");
    if (text) out.push({ role: "user", content: text });
  }
  if (ollama) return out;
  const merged: ChatMessage[] = [];
  for (const m of out) {
    const last = merged.at(-1);
    if (m.role === "user" && last?.role === "user") last.content = `${last.content}\n\n${m.content}`;
    else merged.push({ ...m });
  }
  return merged;
}

const MARKUP = [/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi, /\[TOOL_REQUEST\]\s*([\s\S]*?)\s*\[END_TOOL_REQUEST\]/gi];

/** {"name": …, "arguments" or "parameters": {…}}, naming one of the tools offered. */
function asCall(body: string, names: Set<string>): ChatToolCall | null {
  let j: unknown;
  try {
    j = JSON.parse(body.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const o = j as { name?: unknown; arguments?: unknown; parameters?: unknown; function?: { name?: unknown; arguments?: unknown } };
  const name = typeof o.name === "string" ? o.name : typeof o.function?.name === "string" ? o.function.name : null;
  if (!name || !names.has(name)) return null;
  return { id: newToolId(), name, input: toolInput(o.arguments ?? o.parameters ?? o.function?.arguments ?? {}) };
}

/**
 * Tool calls a model wrote as text instead of through the API: Hermes and Qwen's
 * <tool_call>{…}</tool_call>, LM Studio's default [TOOL_REQUEST]{…}[END_TOOL_REQUEST], or a reply
 * that is nothing but the call's JSON. Only the offered tools' names count; the markup leaves the text.
 */
export function healToolCalls(text: string, names: Set<string>): { text: string; calls: ChatToolCall[] } {
  const calls: ChatToolCall[] = [];
  let rest = text;
  for (const re of MARKUP) {
    rest = rest.replace(re, (whole, body: string) => {
      const c = asCall(body, names);
      if (!c) return whole;
      calls.push(c);
      return "";
    });
  }
  if (!calls.length) {
    const c = asCall(rest, names);
    if (c) return { text: "", calls: [c] };
  }
  return { text: rest.trim(), calls };
}
