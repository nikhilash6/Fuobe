import { z } from "zod";
import { CHAT_LIMITS } from "@/lib/chat/catalog";
import type { ChatEvent, ChatMessage } from "@/lib/chat/types";
import { answerThread } from "@/server/chat/answer";
import { CHAT_WORDS } from "@/server/chat/backend";
import { ownPicture } from "@/server/chat/files";
import { body, chatViewer, gone, refused, signUp } from "@/server/chat/http";
import { answerLater, cancelPending, isPending } from "@/server/chat/pending";
import { addMessage, dropLastReply, getPrefs, getThread, rewindTo, threadTurns } from "@/server/chat/store";
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

/**
 * Answer in a chat. The answer streams as one JSON object per line (ChatEvent): the person's message as saved, how the
 * wait goes (starting up, the place in line), the reply as it is written, then the saved reply. When the free model
 * isn't up in time, the person's message stays and is answered later ("pending"): never an error for that.
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

  let userMessage: ChatMessage | null = null;
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
  if (threadTurns(v.who, id).at(-1)?.role !== "user") {
    leave();
    return Response.json({ error: "There's nothing to answer yet.", code: "nothing" }, { status: 409 });
  }
  // Their own key answers now: it doesn't wait with the free model.
  if (prefs.engine === "key") cancelPending(v.who, id);

  const enc = new TextEncoder();
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (e: ChatEvent) => {
        if (!open) return;
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(e)}\n`));
        } catch {
          open = false;
        }
      };
      // Text as it's written, at most every 60 ms (the last always goes).
      let text: string | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const flush = () => {
        timer = null;
        if (text !== null) send({ type: "text", text });
        text = null;
      };
      try {
        if (userMessage) send({ type: "user", message: userMessage });
        // Already waiting for the free model: that answer comes here when it's ready (with this message too).
        if (prefs.engine !== "key" && isPending(v.who, id)) {
          send({ type: "pending" });
          return;
        }
        const answer = await answerThread(v.who, id, {
          signal: abort.signal,
          onText: (t) => {
            text = t;
            timer ??= setTimeout(flush, 60);
          },
          onQueue: (position) => send({ type: "queue", position }),
          onStatus: (status) => send({ type: "status", status }),
        });
        if (timer) clearTimeout(timer);
        flush();
        if ("pending" in answer) {
          // Kept: answered as soon as the free model is up, even if the person has left.
          answerLater(v.who, id);
          send({ type: "pending" });
        } else if ("nothing" in answer) {
          send({ type: "pending" });
        } else if ("error" in answer) {
          send({ type: "error", code: answer.error, message: answer.message, ...(answer.retryAfterS && { retryAfterS: answer.retryAfterS }) });
        } else send({ type: "done", message: answer.message, title: answer.title });
      } catch {
        send({ type: "error", code: "failed", message: CHAT_WORDS.failed });
      } finally {
        leave();
        open = false;
        try {
          controller.close();
        } catch {
          // Already closed: the person left.
        }
      }
    },
    cancel() {
      // The person left: the reply stops; their message stays (and is answered when they come back).
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
