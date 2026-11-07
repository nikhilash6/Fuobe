import type { Generation } from "./catalog/types";
import { lineWords } from "./pool-line";
import { POOL_WORDS } from "./relay";
import { copyLine } from "./service-copy";

/** Words that already say a run's place ("Waiting for a GPU · 1 ahead", "Next for a GPU", "In ComfyUI's queue"). */
const SAYS_PLACE = /\bahead\b|\bnext\b|\bin line\b|queue/i;

/** How long a run on this studio's GPUs waits before its tile says it is saved and starts by itself. */
export const LONG_WAIT_MS = 10 * 60_000;

/**
 * A run on this studio's GPUs that has waited long: it is kept, and starts by itself (never ended for a wait). The
 * service's display copy (`queueLong`, src/lib/service-copy.ts) when it sends some.
 */
export const longWaitWords = (): string => copyLine("queueLong", {}, "Your run is saved and starts automatically; it'll appear here when it's ready.");

/**
 * What a run on its way says on its tile or cover: its words (never empty: a blank or missing message reads "Queued" or
 * "Generating…"), and, for a run waiting for the workers whose words don't say it already, its place in their line
 * ("You're next", "2 ahead of you · about 2 min"). `local`: the words of its job on the ComfyUI on this computer, when
 * it runs there. On this studio's GPUs (hosted runs) only its place in line, then "Working"; after a long wait in line,
 * that it is saved and starts by itself, with its place under it.
 */
export function pendingWords(g: Pick<Generation, "status" | "message" | "place" | "queue"> & { createdAt?: number }, local?: string | null, now = Date.now()): { label: string; place: string | null } {
  const message = g.message?.trim() || null;
  if (g.place === "pool") {
    if (g.status === "queued") {
      const line = g.queue ? lineWords(g.queue, now) : POOL_WORDS.inLine;
      const long = !g.queue?.held && g.createdAt !== undefined && now - g.createdAt >= LONG_WAIT_MS;
      return long ? { label: longWaitWords(), place: line } : { label: line, place: null };
    }
    return { label: message ?? POOL_WORDS.working, place: null };
  }
  if (local) return { label: local, place: null };
  const label = message ?? (g.status === "queued" ? "Queued" : "Generating…");
  const place = g.status === "queued" && g.queue && !SAYS_PLACE.test(label) ? lineWords(g.queue, now) : null;
  return { label, place };
}
