import "server-only";
import { alternate, fitHistory, summaryAsk, tidyReply, transcript, type ChatTurn } from "@/lib/chat/prompt";
import type { ChatEngine, ChatErrorCode } from "@/lib/chat/types";
import { readSse } from "../llm/sse";
import { runAsTenant } from "../tenant";
import { askHelper, freeHelperOn, freeHelperState, helperKnown, HELPER_LIMITS, helperMessagesProblem, type HelperAnswer } from "../text-helper";

/**
 * Where Fuobe Chat's replies come from:
 * - "site": the install's free text helper (src/server/text-helper.ts), the open model in the workers' text slots. It
 *   takes one message today, so the history goes as a transcript that fits its limit.
 * - "key": the person's own OpenRouter key, streamed, with the history as real turns.
 * Nothing here throws for a model's trouble: the answer says what went wrong, in words for the person.
 */

export interface ReplyAsk {
  /** An account's id, or "owner". */
  who: string;
  system: string;
  turns: ChatTurn[];
  /** Who replies, for a transcript ("Sienna Vale"; "You" for the assistant). */
  speaker: string;
  /** A picture sent with the newest turn. */
  image?: { data: Buffer; contentType: string } | null;
  temperature?: number;
  signal?: AbortSignal;
  /** The reply so far, as it is written (a model that doesn't stream says nothing until the end). */
  onText?: (soFar: string) => void;
  /** The place in line while the free model is busy with others (1: next). */
  onQueue?: (position: number) => void;
  /** The free model is starting up (or every slot is taken): the reply is still coming. */
  onStatus?: (status: "starting") => void;
  /** How long to wait for the free model before keeping the message for later (SITE_WAIT_MS). */
  waitMs?: number;
}

export type ReplyAnswer =
  | { text: string; dropped: number }
  /** The free model didn't come up in time: the message is kept and answered later. */
  | { pending: true }
  | { error: ChatErrorCode; message: string; retryAfterS?: number };

export const CHAT_WORDS: Record<ChatErrorCode, string> = {
  busy: "Your message is saved — we'll answer here as soon as it's ready.",
  limit: "You've chatted a lot in a short while — more free replies in a minute or two.",
  blocked: "This one can't be answered here. Say it another way and it'll go through.",
  failed: "The reply stopped part way. Tap Write it again for a fresh one.",
  "sign-in": "Create a free account to chat.",
  "no-model": "Your message is saved — we'll answer here as soon as it's ready.",
  "key-refused": "OpenRouter didn't accept your key. Update it in chat settings.",
  "too-long": "This chat is full. Start a new one to keep going.",
};

const asTenant = <T,>(who: string, fn: () => T): T => (who === "owner" ? fn() : runAsTenant({ kind: "account", id: who }, fn));

/** Can the free model answer this person now (and is there one at all)? */
export function siteStatus(who: string): { on: boolean; known: boolean } {
  return asTenant(who, () => ({ on: freeHelperState(Date.now(), { chat: true }) !== "absent" || freeHelperOn(Date.now(), {}), known: helperKnown() }));
}

/** History room for the free helper: its message limit, less the transcript's own words. */
const SITE_BUDGET = HELPER_LIMITS.userChars - 600;
/** History room for chat turns on the free helper (its own limit for all turns, with room for joining them). */
const CHAT_BUDGET = HELPER_LIMITS.chatChars - 800;
/** History room for a hosted model through the person's key (its context is far larger). */
const KEY_BUDGET = 24_000;

function fromHelper(a: Exclude<HelperAnswer, { text: string }>): ReplyAnswer {
  const code: ChatErrorCode = a.error === "sign-in" ? "sign-in" : a.error === "limit" ? "limit" : a.error === "blocked" ? "blocked" : a.error === "busy" ? "busy" : "failed";
  const message = code === "limit" ? CHAT_WORDS.limit : a.error === "blocked" && a.message ? a.message : CHAT_WORDS[code];
  return { error: code, message, ...(a.retryAfterS ? { retryAfterS: a.retryAfterS } : {}) };
}

/** How long a reply waits for the free model to come up before the message is kept for later. */
export const SITE_WAIT_MS = Number(process.env.FUOBE_CHAT_WAIT_MS) || 120_000;

const nap = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

/** One try on the free model: chat turns on a worker that takes them, else the history as one transcript. */
async function siteTry(ask: ReplyAsk, waitMs: number): Promise<ReplyAnswer | "busy"> {
  const vision = !!ask.image;
  // A slot that takes chat turns is ready, in line or coming back: askHelper waits for it and says how it goes.
  if (freeHelperState(Date.now(), { chat: true, vision }) !== "absent") {
    const fit = fitHistory(ask.turns, CHAT_BUDGET);
    const messages = alternate(fit.turns);
    if (helperMessagesProblem(messages)) return { error: "failed", message: CHAT_WORDS.failed };
    const a = await askHelper({
      task: "chat",
      system: ask.system,
      messages,
      sampling: ask.temperature === undefined ? undefined : { temperature: ask.temperature },
      ...(ask.image && { images: [ask.image] }),
      signal: ask.signal,
      waitMs,
      onText: (t) => {
        const tidy = tidyReply(t, ask.speaker);
        if (tidy) ask.onText?.(tidy);
      },
      onQueue: ask.onQueue,
      onState: (s) => {
        if (s === "starting") ask.onStatus?.("starting");
      },
    });
    if ("error" in a) return a.error === "busy" ? "busy" : fromHelper(a);
    const text = tidyReply(a.text, ask.speaker);
    return text ? { text, dropped: fit.dropped } : { error: "failed", message: CHAT_WORDS.failed };
  }
  if (!freeHelperOn(Date.now(), { vision })) return "busy";
  const fit = fitHistory(ask.turns, SITE_BUDGET);
  const a = await askHelper({ task: "write", system: ask.system, user: transcript(fit.turns, ask.speaker), ...(ask.image && { images: [ask.image] }), signal: ask.signal, waitMs });
  if ("error" in a) return a.error === "busy" ? "busy" : fromHelper(a);
  const text = tidyReply(a.text, ask.speaker);
  // Whole, with no text on the way: the browser shows it as if written.
  return text ? { text, dropped: fit.dropped } : { error: "failed", message: CHAT_WORDS.failed };
}

/**
 * A reply from the free model. While it starts up (a worker restarting for an update) or every slot is taken, this
 * keeps waiting and asking again, saying "starting" meanwhile; past `waitMs` the message is kept for later (pending),
 * never shown as an error.
 */
async function siteReply(ask: ReplyAsk): Promise<ReplyAnswer> {
  return asTenant(ask.who, async () => {
    const deadline = Date.now() + (ask.waitMs ?? SITE_WAIT_MS);
    for (;;) {
      if (ask.signal?.aborted) return { error: "failed", message: CHAT_WORDS.failed } as ReplyAnswer;
      const left = deadline - Date.now();
      if (left <= 0) return { pending: true } as ReplyAnswer;
      const r = await siteTry(ask, Math.max(5_000, left));
      if (r !== "busy") return r;
      if (Date.now() >= deadline) return { pending: true } as ReplyAnswer;
      ask.onStatus?.("starting");
      await nap(2_500, ask.signal);
    }
  });
}

const OPENROUTER = "https://openrouter.ai/api/v1";

/** Their key, checked with OpenRouter (a free call that runs nothing). */
export async function checkOpenRouterKey(key: string, signal?: AbortSignal): Promise<"ok" | "refused" | "unreachable"> {
  try {
    const r = await fetch(`${OPENROUTER}/key`, { headers: { Authorization: `Bearer ${key}` }, redirect: "error", signal: signal ?? AbortSignal.timeout(10_000) });
    return r.ok ? "ok" : r.status === 401 || r.status === 403 ? "refused" : "unreachable";
  } catch {
    return "unreachable";
  }
}

async function keyReply(ask: ReplyAsk, key: { key: string; model: string }): Promise<ReplyAnswer> {
  const fit = fitHistory(ask.turns, KEY_BUDGET);
  const messages: unknown[] = [{ role: "system", content: ask.system }];
  const turns = alternate(fit.turns);
  turns.forEach((t, i) => {
    const last = i === turns.length - 1;
    if (last && t.role === "user" && ask.image) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: t.content },
          { type: "image_url", image_url: { url: `data:${ask.image.contentType};base64,${ask.image.data.toString("base64")}` } },
        ],
      });
    } else messages.push({ role: t.role, content: t.content });
  });
  let res: Response;
  try {
    res = await fetch(`${OPENROUTER}/chat/completions`, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: `Bearer ${key.key}`, "Content-Type": "application/json", "HTTP-Referer": "https://fuobe.com", "X-Title": "Fuobe Chat" },
      body: JSON.stringify({ model: key.model, messages, stream: true, max_tokens: 1200, ...(ask.temperature !== undefined && { temperature: ask.temperature }) }),
      signal: ask.signal,
    });
  } catch {
    return { error: "failed", message: "OpenRouter didn't pick up. Tap Write it again, or switch to Fuobe's free model in chat settings." };
  }
  if (!res.ok || !res.body) {
    if (res.status === 401 || res.status === 403) return { error: "key-refused", message: CHAT_WORDS["key-refused"] };
    if (res.status === 402) return { error: "failed", message: "Your OpenRouter account is out of credits for this model. Top it up, or pick a free model in chat settings." };
    if (res.status === 429) return { error: "limit", message: "This OpenRouter model has reached its limit for now. Pick another model in chat settings, or switch to Fuobe's free model." };
    if (res.status === 404 || res.status === 400) return { error: "failed", message: `OpenRouter couldn't run "${key.model}". Pick another model in chat settings.` };
    return { error: "failed", message: "OpenRouter didn't answer this time. Tap Write it again, or switch to Fuobe's free model in chat settings." };
  }
  let text = "";
  let problem: string | null = null;
  try {
    await readSse(
      res.body,
      (payload) => {
        if (payload === "[DONE]") return "done";
        try {
          const j = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[]; error?: { message?: string } };
          if (j.error) {
            problem = typeof j.error.message === "string" ? j.error.message.slice(0, 200) : "OpenRouter stopped the reply.";
            return "done";
          }
          const d = j.choices?.[0]?.delta?.content;
          if (typeof d === "string" && d) {
            text += d;
            ask.onText?.(text);
          }
        } catch {
          // A line that isn't JSON (a keep-alive): skip it.
        }
      },
      60_000,
    );
  } catch {
    if (!text) return { error: "failed", message: CHAT_WORDS.failed };
  }
  const tidy = tidyReply(text, ask.speaker);
  if (!tidy) return { error: "failed", message: problem ? `OpenRouter: ${problem}` : CHAT_WORDS.failed };
  return { text: tidy, dropped: fit.dropped };
}

/** A reply from the engine the person picked. */
export async function chatReply(engine: ChatEngine, ask: ReplyAsk, key: { key: string; model: string } | null): Promise<ReplyAnswer> {
  if (engine === "key") {
    if (!key) return { error: "key-refused", message: "Your saved key can't be opened any more. Add it again in chat settings." };
    return keyReply(ask, key);
  }
  return siteReply(ask);
}

/** Fold older turns into the chat's summary, on the free model (not counted against the person: it's housekeeping). Null on any trouble. */
export async function summarize(who: string, previous: string | null, turns: ChatTurn[], speaker: string, key: { key: string; model: string } | null): Promise<string | null> {
  const s = summaryAsk(previous, turns, speaker);
  if (key) {
    const a = await keyReply({ who, system: s.system, turns: [{ role: "user", content: s.user.slice(-KEY_BUDGET) }], speaker: "Notes", temperature: 0.3 }, key);
    return "text" in a ? a.text.slice(0, 2000) : null;
  }
  return asTenant(who, async () => {
    if (!freeHelperOn()) return null;
    const a = await askHelper({ task: "write", system: s.system, user: s.user.slice(-HELPER_LIMITS.userChars), counted: false });
    return "text" in a ? tidyReply(a.text).slice(0, 2000) : null;
  });
}
