import "server-only";
import { enter } from "../rate";
import { answerThread } from "./answer";

/**
 * Chats waiting for the free model to come up: the person's message is kept, and this answers it as soon as the model
 * takes turns again (the page shows it when it arrives). One retry per chat, in this server; after a restart the chat
 * page asks again when it's opened, since its last message is still the person's.
 */

const RETRY_EVERY_MS = Number(process.env.FUOBE_CHAT_RETRY_MS) || 10_000;
const KEEP_TRYING_MS = 6 * 60 * 60_000;
const loops = new Map<string, AbortController>();
const keyOf = (who: string, id: string) => `${who}:${id}`;

export const isPending = (who: string, id: string): boolean => loops.has(keyOf(who, id));

/** Stop waiting for one chat (the person answers with their own key, or deletes the chat). */
export function cancelPending(who: string, id: string): void {
  const k = keyOf(who, id);
  loops.get(k)?.abort();
  loops.delete(k);
}

const nap = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

/** Answer this chat's last message once the free model is up (at most one retry per chat). */
export function answerLater(who: string, id: string): void {
  const k = keyOf(who, id);
  if (loops.has(k)) return;
  const ac = new AbortController();
  loops.set(k, ac);
  void (async () => {
    const end = Date.now() + KEEP_TRYING_MS;
    try {
      while (!ac.signal.aborted && Date.now() < end) {
        await nap(RETRY_EVERY_MS, ac.signal);
        if (ac.signal.aborted) return;
        // One reply at a time per person: a reply the person asked for goes first.
        const leave = who === "owner" ? () => {} : enter(`chat-replying:${who}`, 1);
        if (!leave) continue;
        try {
          const r = await answerThread(who, id, { signal: ac.signal, waitMs: 45_000 });
          if (!("pending" in r)) return;
        } catch {
          // A failure this time: the next round tries again.
        } finally {
          leave();
        }
      }
    } finally {
      if (loops.get(k) === ac) loops.delete(k);
    }
  })();
}
