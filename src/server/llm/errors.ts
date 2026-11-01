import "server-only";
import { cap, llmContext } from "./servers";
import type { ChatResult, LocalKind, LocalServer } from "./types";

/*
 * What went wrong with a local server, in words that say how to fix it: start the server, add a key,
 * load or download a model, or give it more context.
 */

/** How to get each server answering. */
export const START_HINT: Record<LocalKind, string> = {
  ollama: "Start it with `ollama serve` (or open the Ollama app).",
  lmstudio: "Start LM Studio's local server and load a model: in LM Studio, Developer → Start server (or run `lms server start`).",
  unsloth: "Start Unsloth Studio (the desktop app, or `unsloth studio -p 8888`) and load a model on its Chat page.",
  custom: "Start it, or check its URL in Settings → AI helper.",
};

/** Why a fetch failed: ECONNREFUSED, ENOTFOUND… */
function reason(e: unknown): string {
  const err = e as { message?: string; cause?: { code?: string; message?: string } } | undefined;
  return err?.cause?.code || err?.cause?.message || err?.message || "no answer";
}

export function unreachableError(s: LocalServer, e: unknown): Error {
  if ((e as Error | undefined)?.name === "TimeoutError") return new Error(`${cap(s.label)} took too long to answer. Try again, or pick a smaller model.`);
  return new Error(`Couldn't reach ${s.label} at ${s.url || "(no URL set)"} (${reason(e)}). ${START_HINT[s.kind]}`);
}

/**
 * The message inside an error body: OpenAI's {error: {message}}, {error: "…"}, FastAPI's {detail: "…"}
 * or {detail: {error: {message}}} (Unsloth Studio's context and pass-through errors), or the text.
 */
export function errorDetail(body: string): string {
  const text = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
  type Err = { error?: string | { message?: unknown }; message?: unknown };
  const of = (j: Err | undefined): string | null => {
    const e = j?.error;
    return text(e) ?? (e && typeof e === "object" ? text(e.message) : null) ?? text(j?.message);
  };
  try {
    const j = JSON.parse(body) as Err & { detail?: unknown };
    const d = j?.detail;
    const msg = of(j) ?? text(d) ?? (d && typeof d === "object" ? of(d as Err) : null);
    if (msg) return msg.replace(/\s+/g, " ").trim().slice(0, 300);
  } catch {}
  return body.replace(/\s+/g, " ").trim().slice(0, 200);
}

/** A server that can't do structured output says so; the call is then made again without it. */
export const rejectsJson = (kind: LocalKind, status: number, body: string) =>
  status >= 400 && (/response_format|json_schema|json_object|grammar|structured output/i.test(body) || (kind === "ollama" && status === 400 && /\bformat\b/i.test(body)));

export function keyMessage(s: LocalServer): string {
  if (s.kind === "lmstudio") {
    return s.key
      ? "LM Studio rejected the API token. Check it in Settings → AI helper (LM Studio makes them under Developer → Server Settings → Manage Tokens)."
      : "LM Studio wants an API token (its Require Authentication setting is on): in LM Studio, Developer → Server Settings → Manage Tokens, then paste the token in Settings → AI helper.";
  }
  if (s.kind === "unsloth") {
    return s.key
      ? "Unsloth Studio rejected the API key. Create a new one in Unsloth Studio (avatar → Settings → API) and paste it in Settings → AI helper."
      : "Unsloth Studio needs an API key: in Unsloth Studio, avatar → Settings → API → Create, then paste the sk-unsloth-… key in Settings → AI helper.";
  }
  return s.key ? `${cap(s.label)} rejected the API key. Check it in Settings → AI helper.` : `${cap(s.label)} wants an API key. Add it in Settings → AI helper.`;
}

const CONTEXT = /context_length_exceeded|context (?:length|window|size)|n_ctx|tokens to keep|context the overflows|exceeds? (?:the )?(?:context|maximum)|maximum context|prompt is too long|too many tokens/i;
const NOT_LOADED = /no models? (?:is |are )?loaded|not loaded|no model is running/i;
const NO_MODEL = /model[^.]{0,80}(?:not found|does not exist|doesn't exist|unknown|no such|invalid)|unknown model|model_not_found|no such model/i;
const LOAD_FAILED = /failed to load|out of memory|insufficient (?:memory|vram)|not enough (?:memory|vram)|cuda error/i;

function contextMessage(s: LocalServer, model: string | null, detail: string): string {
  const n = /(?:context length of (?:only )?|n_ctx(?:_slot)?\s*[=:]?\s*)(\d[\d,]*)/i.exec(detail)?.[1];
  const who = model ? `${model}'s context` : "the model's context";
  const fix: Record<LocalKind, string> = {
    ollama: "Raise the context in Settings → AI helper (FUOBE_LLM_CONTEXT)",
    lmstudio: `Reload it with ${Math.round((llmContext() || 16384) / 1024)}k context (Settings → AI helper) or a larger one in LM Studio`,
    unsloth: "Load it in Unsloth Studio with a larger context",
    custom: "Start the server with a larger context",
  };
  return `This is longer than ${who}${n ? ` (${n} tokens)` : ""} on ${s.label}. ${fix[s.kind]}, or use shorter text.`;
}

function modelMessage(s: LocalServer, model: string | null, detail: string): string {
  const m = model ?? "that model";
  if (s.kind === "ollama") return `Ollama doesn't have ${m} yet — run \`ollama pull ${m}\``;
  if (s.kind === "unsloth") {
    return NOT_LOADED.test(detail) || !model
      ? "Unsloth Studio has no model loaded — load one on its Chat page (Select model), or turn on Model auto-switch (avatar → Settings → API) so the model picked in Fuobe loads by itself."
      : `Unsloth Studio has no model called ${m} — pick one it lists in Settings → AI helper, or leave the model empty to use the one loaded in Unsloth.`;
  }
  if (s.kind === "lmstudio") {
    return NOT_LOADED.test(detail) && !NO_MODEL.test(detail)
      ? `LM Studio has no model loaded — load one in LM Studio (or run \`lms load ${model ?? "<model>"}\`), or pick one in Settings → AI helper.`
      : `LM Studio has no model called ${m} — download it in LM Studio (or run \`lms get ${m}\`), or pick another in Settings → AI helper.`;
  }
  return `${cap(s.label)} has no model called ${m} — pick one it lists in Settings → AI helper.`;
}

/** A non-2xx answer from a chat call. */
export function httpError(s: LocalServer, status: number, body: string, model: string | null): Error {
  const detail = errorDetail(body);
  if (status === 401 || status === 403) return new Error(keyMessage(s));
  // The OpenAI code may be all that says so: {error: {message: "…", code: "context_length_exceeded"}}.
  if (CONTEXT.test(detail) || /"context_length_exceeded"/.test(body)) return new Error(contextMessage(s, model, detail));
  if (LOAD_FAILED.test(detail)) return new Error(`${cap(s.label)} couldn't load ${model ?? "the model"}: ${detail}. Free some GPU memory (ComfyUI shares it) or pick a smaller model.`);
  if (NOT_LOADED.test(detail) || NO_MODEL.test(detail) || (status === 404 && s.kind === "ollama")) return new Error(modelMessage(s, model, detail));
  if (status === 404) return new Error(`${cap(s.label)} has no chat endpoint at ${s.url} (404${detail ? `: ${detail}` : ""}). Check its URL in Settings → AI helper.`);
  return new Error(`${cap(s.label)} returned ${status}: ${detail}`);
}

/** A reply with no words in it. */
export function emptyReply(s: LocalServer, r: ChatResult): Error {
  if (r.stop === "length" && r.thought) return new Error(`${r.model} on ${s.label} spent its whole reply thinking. Turn thinking off for it, or pick a model that doesn't think first.`);
  if (r.stop === "length") return new Error(`${r.model} on ${s.label} ran out of room before it answered. Give it more context, or use shorter text.`);
  return new Error(`${cap(s.label)} returned no text`);
}
