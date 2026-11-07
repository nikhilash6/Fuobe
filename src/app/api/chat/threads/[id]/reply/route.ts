import { z } from "zod";
import { CHAT_LIMITS } from "@/lib/chat/catalog";
import { systemPrompt, type ChatTurn } from "@/lib/chat/prompt";
import type { ChatEvent } from "@/lib/chat/types";
import { chatReply, CHAT_WORDS, summarize } from "@/server/chat/backend";
import { ownPicture, readPicture } from "@/server/chat/files";
import { body, chatViewer, gone, refused, signUp } from "@/server/chat/http";
import { addMessage, chatKey, dropLastReply, getPrefs, getThread, rewindTo, setSummary, threadMemory, threadTurns } from "@/server/chat/store";
import { enter, hit } from "@/server/rate";

const Post = z.object({
  /** A new message. Without one, the chat's last message (the person's) is answered: a new chat's first, or Try again. */
  text: z.string().max(CHAT_LIMITS.messageChars).nullish(),
  image: z.string().max(400).nullish(),
  /** Try again: the last reply goes and is written again. */
  retry: z.boolean().optional(),
  /** Change one of the person's messages: it and everything after it go, and `text` takes its place. */
  edit: z.string().max(60).nullish(),
});

const TEMPERATURE = { chat: 0.7, ideas: 0.95, write: 0.7, character: 1.0, play: 1.0 } as const;

/** A summary is brought up to date once this many turns have fallen out of what the model sees. */
const SUMMARY_EVERY = 6;

/**
 * Answer in a chat. The answer streams as one JSON object per line (ChatEvent): the person's message as saved, the
 * reply as it is written, then the saved reply, or what went wrong. The person's message stays when a reply fails, so
 * Try again answers it.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/chat/threads/[id]/reply">) {
  const v = chatViewer(request);
  if (!v) return signUp();
  const { id } = await ctx.params;
  const p = Post.safeParse(await body(request));
  if (!p.success) return Response.json({ error: `Messages can be up to ${CHAT_LIMITS.messageChars.toLocaleString("en")} characters.` }, { status: 400 });
  const thread = getThread(v.who, id);
  if (!thread) return gone();
  const prefs = getPrefs(v.who);
  if (thread.mature && !prefs.mature) return Response.json({ error: "This chat is in Mango Chilli mode. Turn it on to carry on.", code: "mature-off" }, { status: 403 });

  // Replies a minute per person, on any engine (the free helper counts its own use too).
  if (v.who !== "owner") {
    const r = hit(`chat-reply:${v.who}`, 20, 60_000);
    if (!r.ok) return Response.json({ error: CHAT_WORDS.limit, code: "limit" }, { status: 429, headers: { "Retry-After": String(r.retryAfterS) } });
  }
  // One reply at a time per person.
  const leave = v.who === "owner" ? () => {} : enter(`chat-replying:${v.who}`, 1);
  if (!leave) return Response.json({ error: "A reply is still being written. Wait for it, then send again.", code: "busy" }, { status: 409 });

  let userMessage = null;
  try {
    const text = p.data.text?.trim() ?? "";
    const image = p.data.image ? ownPicture(v.who, p.data.image) : null;
    if (p.data.image && !image) throw Object.assign(new Error("That picture couldn't be read. Add it again."), { status: 400 });
    if (p.data.edit) {
      if (!text) throw Object.assign(new Error("Write the new message first."), { status: 400 });
      if (!rewindTo(v.who, id, p.data.edit)) throw Object.assign(new Error("That message can't be changed."), { status: 409 });
    } else if (p.data.retry) dropLastReply(v.who, id);
    if (text || image) userMessage = addMessage(v.who, id, "user", text, image);
  } catch (e) {
    leave();
    const status = (e as { status?: number }).status;
    return status ? Response.json({ error: (e as Error).message }, { status }) : refused(e);
  }

  const turns = threadTurns(v.who, id);
  const last = turns.at(-1);
  if (!last || last.role !== "user") {
    leave();
    return Response.json({ error: "There's nothing to answer yet.", code: "nothing" }, { status: 409 });
  }
  const memory = threadMemory(v.who, id);
  const character = thread.characterCard;
  const speaker = character?.name ?? "You";
  const system = systemPrompt({ kind: thread.kind, character, tool: thread.tool, play: thread.play, mature: prefs.mature, summary: memory?.summary });
  // What the model reads: the summary covers turns up to summary_upto; a picture-only turn says so in words.
  const asTurn = (m: (typeof turns)[number]): ChatTurn => ({ role: m.role, content: m.content || (m.image ? "(sent a picture)" : "") });
  const visible = turns.filter((m) => m.seq > (memory?.upto ?? 0)).map(asTurn);
  const picture = last.image ? await readPicture(v.who, last.image) : null;
  const key = prefs.engine === "key" ? chatKey(v.who) : null;

  const enc = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  let released = false;
  const release = () => {
    if (!released) leave();
    released = true;
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const close = () => {
        open = false;
        try {
          controller.close();
        } catch {
          // Already closed: the person left.
        }
      };
      const send = (e: ChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
        } catch {
          open = false;
        }
      };
      // Text as it's written, at most every 60 ms (the last always goes).
      let pending: string | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        timer = null;
        if (pending !== null) send({ type: "text", text: pending });
        pending = null;
      };
      try {
        if (userMessage) send({ type: "user", message: userMessage });
        const answer = await chatReply(
          prefs.engine,
          {
            who: v.who,
            system,
            turns: visible,
            speaker,
            image: picture,
            temperature: TEMPERATURE[thread.kind],
            signal: abort.signal,
            onText: (t) => {
              pending = t;
              timer ??= setTimeout(flush, 60);
            },
            onQueue: (position) => send({ type: "queue", position }),
          },
          key,
        );
        if (timer) clearTimeout(timer);
        flush();
        if ("error" in answer) {
          send({ type: "error", code: answer.error, message: answer.message, ...(answer.retryAfterS && { retryAfterS: answer.retryAfterS }) });
          return;
        }
        const saved = addMessage(v.who, id, "assistant", answer.text);
        send({ type: "done", message: saved, title: getThread(v.who, id)?.title ?? thread.title });
        release();
        close();
        // Keep a long chat coherent: once enough turns have fallen out of view, fold them into the summary (after
        // the reply is out, so the person can carry on meanwhile).
        if (answer.dropped >= SUMMARY_EVERY) {
          const fold = threadTurns(v.who, id)
            .filter((m) => m.seq > (memory?.upto ?? 0))
            .slice(0, answer.dropped);
          const upto = fold.at(-1)?.seq;
          if (upto) {
            const s = await summarize(v.who, memory?.summary ?? null, fold.map(asTurn), speaker, key).catch(() => null);
            if (s) setSummary(v.who, id, s, upto);
          }
        }
      } catch {
        send({ type: "error", code: "failed", message: CHAT_WORDS.failed });
      } finally {
        release();
        close();
      }
    },
    cancel() {
      // The person left: the reply stops; what was sent before stays.
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
