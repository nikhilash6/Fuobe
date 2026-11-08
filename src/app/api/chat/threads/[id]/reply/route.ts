import { z } from "zod";
import { CHAT_LIMITS } from "@/lib/chat/catalog";
import type { ChatEvent, ChatMessage } from "@/lib/chat/types";
import { answerThread } from "@/server/chat/answer";
import { CHAT_WORDS } from "@/server/chat/backend";
import { ownPicture } from "@/server/chat/files";
import { body, chatViewer, gone, refused, signUp } from "@/server/chat/http";
import { wantsToMake } from "@/lib/chat/make-intent";
import { planMake } from "@/server/chat/make";
import { isLive, join, startLive, stopLive } from "@/server/chat/live";
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

  // The page opened (or reloaded) while its reply is being written: it joins that reply, never starts a second one.
  const plain = !p.data.text?.trim() && !p.data.image && !p.data.retry && !p.data.edit;
  if (plain && isLive(v.who, id)) return watch(request, v.who, id, null);

  // Replies a minute per person, on any engine (the free helper counts its own use too).
  if (v.who !== "owner") {
    const r = hit(`chat-reply:${v.who}`, 20, 60_000);
    if (!r.ok) return Response.json({ error: CHAT_WORDS.limit, code: "limit" }, { status: 429, headers: { "Retry-After": String(r.retryAfterS) } });
  }
  // One reply at a time per person.
  const leave = v.who === "owner" ? () => {} : enter(`chat-replying:${v.who}`, 1);
  if (!leave) return Response.json({ error: "A reply is still being written. Wait for it, then send again.", code: "busy" }, { status: 409 });
  // A reply for this chat is on its way (asked from another tab a moment ago): join it.
  if (plain && isLive(v.who, id)) {
    leave();
    return watch(request, v.who, id, null);
  }

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
  // Asked to make something (a picture, a clip, a song): a plan to approve, priced as the studio would, not a reply.
  if (userMessage && thread.kind !== "character" && wantsToMake(userMessage.content, !!userMessage.image)) {
    const made = await planMake(request, v.who, userMessage.content, userMessage.image).catch(() => null);
    if (made) {
      const saved = addMessage(v.who, id, "assistant", made.say, null, made.plan);
      leave();
      const lines: ChatEvent[] = [
        { type: "user", message: userMessage },
        { type: "done", message: saved, title: getThread(v.who, id)?.title ?? thread.title },
      ];
      return new Response(lines.map((l) => JSON.stringify(l)).join("\n") + "\n", {
        headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
  }
  // Their own key answers now: it doesn't wait with the free model.
  if (prefs.engine === "key") cancelPending(v.who, id);

  // Already waiting for the free model: that answer comes here when it's ready (with this message too).
  if (prefs.engine !== "key" && isPending(v.who, id)) {
    leave();
    const lines: ChatEvent[] = [...(userMessage ? [{ type: "user", message: userMessage } as const] : []), { type: "pending" }];
    return new Response(lines.map((l) => JSON.stringify(l)).join("\n") + "\n", {
      headers: NDJSON,
    });
  }

  // The reply is written apart from this request: a reload or a closed tab doesn't stop it, and it is saved.
  startLive(v.who, id, async (signal, emit) => {
    // Text as it's written, at most every 60 ms (the last always goes).
    let text: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      if (text !== null) emit({ type: "text", text });
      text = null;
    };
    try {
      const answer = await answerThread(v.who, id, {
        from: request,
        signal,
        onText: (t) => {
          text = t;
          timer ??= setTimeout(flush, 60);
        },
        onQueue: (position) => emit({ type: "queue", position }),
        onStatus: (status) => emit({ type: "status", status }),
      });
      if (timer) clearTimeout(timer);
      flush();
      if (signal.aborted) emit({ type: "error", code: "failed", message: "Stopped." });
      else if ("pending" in answer) {
        // Kept: answered as soon as the free model is up, even if the person has left.
        answerLater(v.who, id);
        emit({ type: "pending" });
      } else if ("nothing" in answer) emit({ type: "pending" });
      else if ("error" in answer)
        emit({
          type: "error",
          code: answer.error,
          message: answer.message,
          ...(answer.retryAfterS && { retryAfterS: answer.retryAfterS }),
        });
      else emit({ type: "done", message: answer.message, title: answer.title });
    } catch {
      emit({ type: "error", code: "failed", message: CHAT_WORDS.failed });
    } finally {
      if (timer) clearTimeout(timer);
      leave();
    }
  });
  return watch(request, v.who, id, userMessage);
}

/** Stop: the reply being written ends now and isn't saved; the person's message stays. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/chat/threads/[id]/reply">) {
  const v = chatViewer(request);
  if (!v) return signUp();
  const { id } = await ctx.params;
  if (!getThread(v.who, id)) return gone();
  return Response.json({ stopped: stopLive(v.who, id) });
}

const NDJSON = {
  "Content-Type": "application/x-ndjson; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Accel-Buffering": "no",
};

/**
 * This page's view of the chat's reply, one JSON object per line: the person's message as saved (when this request
 * added one), what has happened so far, then each event until the reply ends. The page leaving stops only the view.
 */
function watch(request: Request, who: string, id: string, userMessage: ChatMessage | null): Response {
  const enc = new TextEncoder();
  let unwatch: (() => void) | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const close = () => {
        if (!open) return;
        open = false;
        unwatch?.();
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
        if (e.type === "done" || e.type === "pending" || e.type === "error") queueMicrotask(close);
      };
      if (userMessage) send({ type: "user", message: userMessage });
      unwatch = join(who, id, send);
      // Ended before this page joined: the saved reply, or (still waiting for the free model) the kept message.
      if (!unwatch) {
        const th = getThread(who, id);
        const last = th?.messages.at(-1);
        send(th && last?.role === "assistant" ? { type: "done", message: last, title: th.title } : { type: "pending" });
      }
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      unwatch?.();
    },
  });
  return new Response(stream, { headers: NDJSON });
}
