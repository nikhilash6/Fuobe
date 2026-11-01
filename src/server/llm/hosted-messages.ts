import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { GEMINI_DUMMY_SIGNATURE, type LlmModelDef, type LlmProviderDef } from "@/lib/catalog/llm-providers";
import { CONTEXT_UPDATE_LABEL, wireId } from "./messages";
import type { ChatMessage, ChatToolCall, Replay } from "./types";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type Block = Exclude<MessageParam["content"], string>[number];
type Stored = MessageParam & { replay?: Replay };

/*
 * Assist's history (Claude's shape) as chat messages for a hosted provider. Each provider gets back
 * only what it made: its own reasoning (for the same model), its own tool ids and Gemini's signatures.
 * Turns other models made go without them, which the providers' docs allow, except where they don't:
 * Gemini wants a signature on the first call of every step (the documented dummy stands in), DeepSeek
 * wants reasoning on every turn and refuses calls it didn't make (those become text).
 */

export interface HostedTarget {
  provider: LlmProviderDef;
  model: LlmModelDef;
}

/** Anthropic's tool-id pattern: a provider id that fits is kept, so the chat can move back to Claude. */
export const FITS_ID = /^[A-Za-z0-9_-]{1,64}$/;

const isImage = (b: { type: string }): b is Anthropic.Beta.BetaImageBlockParam => b.type === "image";

function picture(b: Anthropic.Beta.BetaImageBlockParam): { data: string; contentType: string } | null {
  return b.source.type === "base64" ? { data: b.source.data, contentType: b.source.media_type } : null;
}

const pictureNote = (b: Anthropic.Beta.BetaImageBlockParam) => (b.source.type === "url" ? `[picture: ${b.source.url}]` : "[picture]");

const NO_SIGHT = "This model can't see pictures; judge from the prompts.";

/**
 * The history as chat messages for one provider and model. `history` has its latest pictures read
 * already (base64); older ones are left as [picture] notes, so a long chat doesn't resend every picture.
 */
export function toHostedMessages(system: { stable: string; turn: string }, history: Stored[], { provider, model }: HostedTarget): ChatMessage[] {
  const q = provider.quirks;
  const nine = q.toolIds === "nine";
  // The last turn that carries the user's words or tool results: only its pictures are sent.
  const lastUser = history.findLastIndex((m) => m.role === "user");
  const out: ChatMessage[] = [{ role: "system", content: `${system.stable}\n\n${system.turn}` }];
  // Tool ids by stored id, for the results that follow; null: the call went out as text.
  const ids = new Map<string, string | null>();
  const names = new Map<string, string>();

  history.forEach((m, i) => {
    const role = m.role as "user" | "assistant" | "system";
    const blocks: Block[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    const texts = blocks.flatMap((b) => (b.type === "text" ? [b.text] : []));
    if (role === "system") {
      out.push({ role: "user", content: `${CONTEXT_UPDATE_LABEL}\n${texts.join("\n")}` });
      return;
    }
    if (role === "assistant") {
      const r = m.replay;
      const own = r?.provider === provider.id;
      const sameModel = own && r?.model === model.id;
      const uses = blocks.filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === "tool_use");
      if (!own && uses.length && q.foreignToolCalls === "flatten") {
        // DeepSeek refuses calls it didn't make: say what ran, in words.
        for (const u of uses) {
          ids.set(u.id, null);
          names.set(u.id, u.name);
        }
        const ran = uses.map((u) => `${u.name} ${JSON.stringify(u.input ?? {})}`).join("; ");
        out.push({ role: "assistant", content: [...texts, `(Earlier in this chat another model ran: ${ran})`].join("\n").trim(), ...(q.replayReasoning === "required" && { reasoning: { field: "reasoning_content", text: "" } }) });
        return;
      }
      const calls: ChatToolCall[] = uses.map((u, n) => {
        const wire = nine ? wireId(u.id) : own ? (r?.toolIds?.[u.id] ?? u.id) : u.id;
        ids.set(u.id, wire);
        names.set(u.id, u.name);
        const sig = q.signatures === "gemini" && n === 0 ? ((own && r?.extra?.[u.id]) || { google: { thought_signature: GEMINI_DUMMY_SIGNATURE } }) : own ? r?.extra?.[u.id] : undefined;
        return { id: wire, name: u.name, input: u.input, ...(sig !== undefined && { extra: sig }) };
      });
      const reasoning = sameModel && q.replayReasoning && r?.reasoning?.text ? { field: q.reasoningKey ?? r.reasoning.field, text: r.reasoning.text } : q.replayReasoning === "required" ? { field: "reasoning_content", text: "" } : undefined;
      out.push({
        role: "assistant",
        content: texts.join("\n"),
        ...(calls.length && { toolCalls: calls }),
        ...(reasoning && { reasoning: reasoning.field === "thinking" ? { ...reasoning, field: "reasoning_content" } : reasoning }),
        ...(sameModel && r?.details?.length && { details: r.details }),
        // OpenAI's Responses API: the turn as it came, encrypted reasoning included.
        ...(sameModel && r?.items?.length && { items: r.items }),
      });
      return;
    }
    // A user turn: tool results first (they answer the turn before), then the words.
    const latest = i === lastUser;
    const shown: { data: string; contentType: string }[] = [];
    const flat: string[] = [];
    const from: string[] = [];
    for (const b of blocks) {
      if (b.type !== "tool_result") continue;
      const parts = typeof b.content === "string" ? [{ type: "text" as const, text: b.content }] : (b.content ?? []);
      const words: string[] = [];
      for (const c of parts) {
        if (c.type === "text") words.push(c.text);
        else if (isImage(c)) {
          const pic = latest && model.vision ? picture(c) : null;
          if (pic) shown.push(pic);
          else words.push(model.vision ? pictureNote(c) : NO_SIGHT);
        }
      }
      const text = `${b.is_error ? "Error: " : ""}${[...new Set(words)].join("\n")}`;
      const wire = ids.get(b.tool_use_id);
      const name = names.get(b.tool_use_id) ?? "a tool";
      if (wire === null) flat.push(`Result of ${name}: ${text}`);
      else out.push({ role: "tool", toolCallId: wire ?? (nine ? wireId(b.tool_use_id) : b.tool_use_id), toolName: name, content: text });
      if (shown.length && !from.includes(name)) from.push(name);
    }
    if (flat.length) out.push({ role: "user", content: flat.join("\n\n") });
    // A tool message takes text only: its pictures follow in a user turn.
    if (shown.length) out.push({ role: "user", content: `Pictures from ${from.join(" and ")}:`, images: shown });
    // The user's own pictures: their words already list the files by URL, so older ones need no note.
    const attached = blocks.filter((b) => b.type === "image").flatMap((b) => (isImage(b) ? [b] : []));
    const pics = latest && model.vision ? attached.flatMap((b) => picture(b) ?? []) : [];
    const words = texts.join("\n");
    if (words || pics.length) out.push({ role: "user", content: words, ...(pics.length && { images: pics }) });
  });

  // Strict providers want turns that alternate: user turns in a row become one.
  const merged: ChatMessage[] = [];
  for (const m of out) {
    const last = merged.at(-1);
    if (m.role === "user" && last?.role === "user") {
      last.content = [last.content, m.content].filter(Boolean).join("\n\n");
      if (m.images?.length) last.images = [...(last.images ?? []), ...m.images];
    } else merged.push({ ...m });
  }
  // At most the provider's picture count per request (Groq 3), the newest kept.
  const cap = model.maxImages;
  if (cap) {
    let left = cap;
    for (const m of [...merged].reverse()) {
      if (!m.images?.length) continue;
      m.images = m.images.slice(Math.max(0, m.images.length - left));
      left -= m.images.length;
    }
  }
  return merged;
}
