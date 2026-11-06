import type { Generation } from "./catalog/types";
import { lineWords } from "./pool-line";
import { POOL_WORDS } from "./relay";

/** Words that already say a run's place ("Waiting for a GPU · 1 ahead", "Next for a GPU", "In ComfyUI's queue"). */
const SAYS_PLACE = /\bahead\b|\bnext\b|\bin line\b|queue/i;

/**
 * What a run on its way says on its tile or cover: its words (never empty: a blank or missing message reads "Queued" or
 * "Generating…"), and, for a run waiting for the workers whose words don't say it already, its place in their line
 * ("Next in line", "In line · 3rd · ready in about 2 min"). `local`: the words of its job on the ComfyUI on this
 * computer, when it runs there. On this studio's GPUs (hosted runs) only "In line" with its place, then "Working".
 */
export function pendingWords(g: Pick<Generation, "status" | "message" | "place" | "queue">, local?: string | null): { label: string; place: string | null } {
  const message = g.message?.trim() || null;
  if (g.place === "pool") {
    if (g.status === "queued") return { label: g.queue ? lineWords(g.queue) : POOL_WORDS.inLine, place: null };
    return { label: message ?? POOL_WORDS.working, place: null };
  }
  if (local) return { label: local, place: null };
  const label = message ?? (g.status === "queued" ? "Queued" : "Generating…");
  const place = g.status === "queued" && g.queue && !SAYS_PLACE.test(label) ? lineWords(g.queue) : null;
  return { label, place };
}
