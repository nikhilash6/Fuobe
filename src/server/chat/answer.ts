import "server-only";
import { systemPrompt, type ChatTurn } from "@/lib/chat/prompt";
import type { ChatErrorCode, ChatMessage } from "@/lib/chat/types";
import { chatReply, summarize, type MakeCall } from "./backend";
import { readPicture } from "./files";
import { planMake } from "./make";
import { addMessage, chatKey, getPrefs, getThread, setSummary, threadMemory, threadTurns } from "./store";

/**
 * Write the reply to a chat's last message (the person's) and save it. Used by the reply route, which streams it, and
 * by the retry that answers later when the free model was starting up (src/server/chat/pending.ts).
 */

const TEMPERATURE = { chat: 0.7, ideas: 0.95, write: 0.7, character: 1.0, play: 1.0 } as const;

/** A summary is brought up to date once this many turns have fallen out of what the model sees. */
const SUMMARY_EVERY = 6;

export type AnswerResult =
  | { message: ChatMessage; title: string }
  /** The free model didn't come up in time: the message waits, and is answered later. */
  | { pending: true }
  /** Nothing to answer: the last message isn't the person's (answered meanwhile, or none). */
  | { nothing: true }
  | { error: ChatErrorCode; message: string; retryAfterS?: number };

export interface AnswerOptions {
  signal?: AbortSignal;
  /** How long the free model may take to come up and take the turn. */
  waitMs?: number;
  onText?: (soFar: string) => void;
  onQueue?: (position: number) => void;
  onStatus?: (status: "starting") => void;
  /**
   * The person's own request, when they are here: the model may then ask to make something, and the plan is priced
   * and later run as them (src/server/chat/make.ts). A retry that answers later has none: it answers in words.
   */
  from?: Request;
}

/** The make tool's ask as words the planner reads for that kind. */
const askFor = (m: MakeCall): string =>
  m.kind === "video" ? `A video: ${m.what}` : m.kind === "music" ? `A music track: ${m.what}` : m.kind === "voice" ? `A voice-over: "${m.what}"` : m.what;

export async function answerThread(who: string, id: string, o: AnswerOptions = {}): Promise<AnswerResult> {
  const thread = getThread(who, id);
  if (!thread) return { error: "failed", message: "That chat is gone." };
  const prefs = getPrefs(who);
  if (thread.mature && !prefs.mature) return { error: "blocked", message: "This chat is in Mango Chilli mode. Turn it on to carry on." };
  const turns = threadTurns(who, id);
  const last = turns.at(-1);
  if (!last || last.role !== "user") return { nothing: true };
  const memory = threadMemory(who, id);
  const character = thread.characterCard;
  const speaker = character?.name ?? "You";
  const system = systemPrompt({ kind: thread.kind, character, tool: thread.tool, play: thread.play, mature: prefs.mature, summary: memory?.summary });
  // What the model reads: the summary covers turns up to summary_upto; a picture-only turn says so in words.
  const asTurn = (m: (typeof turns)[number]): ChatTurn => ({ role: m.role, content: m.content || (m.image ? "(sent a picture)" : "") });
  const visible = turns.filter((m) => m.seq > (memory?.upto ?? 0)).map(asTurn);
  const picture = last.image ? await readPicture(who, last.image) : null;
  const key = prefs.engine === "key" ? chatKey(who) : null;

  const answer = await chatReply(
    prefs.engine,
    {
      who,
      system,
      turns: visible,
      speaker,
      image: picture,
      temperature: TEMPERATURE[thread.kind],
      signal: o.signal,
      waitMs: o.waitMs,
      onText: o.onText,
      onQueue: o.onQueue,
      onStatus: o.onStatus,
      makeTool: !!o.from && thread.kind !== "character",
    },
    key,
  );
  if ("pending" in answer) return { pending: true };
  if ("error" in answer) return answer;
  // Answered meanwhile (a retry and the person's own visit): keep the first answer only.
  const now = threadTurns(who, id).at(-1);
  if (!now || now.role !== "user") return { nothing: true };
  // The model asked to make something: a plan to approve, priced as the person (else its words, or a short ask).
  if (answer.make && o.from) {
    const made = await planMake(o.from, who, askFor(answer.make), last.image).catch(() => null);
    if (made) {
      const plan = addMessage(who, id, "assistant", made.say, null, made.plan);
      return { message: plan, title: getThread(who, id)?.title ?? thread.title };
    }
    if (!answer.text) {
      const ask = addMessage(who, id, "assistant", "I can make that. Tell me a little more about what you'd like to see, and I'll put the plan together.");
      return { message: ask, title: getThread(who, id)?.title ?? thread.title };
    }
  }
  const saved = addMessage(who, id, "assistant", answer.text);

  // Keep a long chat coherent: once enough turns have fallen out of view, fold them into the summary (after the reply
  // is saved, so the person can carry on meanwhile).
  if (answer.dropped >= SUMMARY_EVERY) {
    const fold = threadTurns(who, id)
      .filter((m) => m.seq > (memory?.upto ?? 0))
      .slice(0, answer.dropped);
    const upto = fold.at(-1)?.seq;
    if (upto) {
      void summarize(who, memory?.summary ?? null, fold.map(asTurn), speaker, key)
        .then((s) => s && setSummary(who, id, s, upto))
        .catch(() => {});
    }
  }
  return { message: saved, title: getThread(who, id)?.title ?? thread.title };
}
