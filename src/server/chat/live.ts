import "server-only";
import type { ChatEvent } from "@/lib/chat/types";

/**
 * Replies being written now, one per chat. A reply belongs to the chat, not to the page that asked for it: when the
 * person reloads or leaves, it carries on and is saved. A page that opens the chat meanwhile joins it: it gets the
 * reply so far at once, then the rest as it's written. Only Stop (or a deleted chat) ends a reply early.
 */

type Listener = (e: ChatEvent) => void;

type Live = {
  abort: AbortController;
  listeners: Set<Listener>;
  /** What a page that joins now needs to catch up: the wait (place in line, warming up) and the text so far. */
  position?: number;
  starting?: boolean;
  text?: string;
  /** The last event (done, pending or error): set once the reply has ended. */
  end?: ChatEvent;
};

const lives = new Map<string, Live>();
const keyOf = (who: string, id: string) => `${who}:${id}`;

export const isLive = (who: string, id: string): boolean => {
  const l = lives.get(keyOf(who, id));
  return !!l && !l.end;
};

/**
 * Write a reply for this chat, apart from any one page. `run` gets the reply's signal and `emit`; whatever it emits
 * goes to every page that is watching. The returned function joins the reply, as `join` does.
 */
export function startLive(who: string, id: string, run: (signal: AbortSignal, emit: (e: ChatEvent) => void) => Promise<void>): void {
  const k = keyOf(who, id);
  const live: Live = { abort: new AbortController(), listeners: new Set() };
  lives.set(k, live);
  const emit = (e: ChatEvent) => {
    if (e.type === "queue") live.position = e.position;
    else if (e.type === "status") live.starting = true;
    else if (e.type === "text") {
      // Writing now: the wait is over, and a page that joins shows only the words.
      live.text = e.text;
      live.position = undefined;
      live.starting = undefined;
    } else if (e.type === "done" || e.type === "pending" || e.type === "error") live.end = e;
    for (const l of live.listeners) {
      try {
        l(e);
      } catch {
        live.listeners.delete(l);
      }
    }
  };
  void run(live.abort.signal, emit)
    .catch(() =>
      emit({
        type: "error",
        code: "failed",
        message: "The reply didn't finish. Tap Write it again.",
      }),
    )
    .finally(() => {
      if (!live.end)
        emit({
          type: "error",
          code: "failed",
          message: "The reply didn't finish. Tap Write it again.",
        });
      live.listeners.clear();
      if (lives.get(k) === live) lives.delete(k);
    });
}

/**
 * Watch this chat's reply: first what has happened so far, then each event as it comes. Returns the function that
 * stops watching (the reply carries on), or null when no reply is being written.
 */
export function join(who: string, id: string, listener: Listener): (() => void) | null {
  const live = lives.get(keyOf(who, id));
  if (!live) return null;
  if (live.end) {
    listener(live.end);
    return () => {};
  }
  if (live.position) listener({ type: "queue", position: live.position });
  if (live.starting) listener({ type: "status", status: "starting" });
  if (live.text) listener({ type: "text", text: live.text });
  live.listeners.add(listener);
  return () => live.listeners.delete(listener);
}

/** Stop: the reply ends now and isn't saved. The person's message stays. */
export function stopLive(who: string, id: string): boolean {
  const live = lives.get(keyOf(who, id));
  if (!live || live.end) return false;
  live.abort.abort();
  return true;
}
