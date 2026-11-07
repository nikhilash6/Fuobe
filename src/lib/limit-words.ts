import { aboutWords, clockWords, freeLimitSentence } from "./pool-line";

/**
 * What a person reads when a limit stops a press: friendly, never "try again later", and when it refreshes, from the
 * limit itself. The server says the wait ("in about 40 min", the same on every clock) and sends when it ends
 * (`refreshAt`); the page says it on the viewer's own clock ("at 14:20", limitWordsAt). Past a limit on free runs here,
 * the next step is one press away: run it self-hosted (an account), or a free account for more free runs (a guest).
 * The sentences for free runs and free replies are the service's display copy when it sends some (src/lib/service-copy.ts).
 */
export type LimitKind = "free-today" | "free-hour" | "network" | "runs" | "pictures" | "files" | "reports" | "steps" | "replies";

export const LIMIT_KINDS: readonly LimitKind[] = ["free-today", "free-hour", "network", "runs", "pictures", "files", "reports", "steps", "replies"];

export const isLimitKind = (v: unknown): v is LimitKind => typeof v === "string" && (LIMIT_KINDS as readonly string[]).includes(v);

/** The sentence for a limit, with when it refreshes ("in about 40 min", "at 14:20"). */
function sentence(kind: LimitKind, when: string): string {
  switch (kind) {
    case "free-today":
    case "free-hour":
    case "network":
    case "replies":
      return freeLimitSentence(kind, when);
    case "runs":
      return `You've made a lot this hour — you can run again ${when}.`;
    case "pictures":
      return `You've finished a lot of pictures this hour — you can finish more ${when}.`;
    case "files":
      return `You've added a lot of files this hour — you can add more ${when}.`;
    case "reports":
      return `Thanks — we have your reports. You can send more ${when}.`;
    case "steps":
      return `You've kept a lot of steps this hour — download them now, and you can keep more ${when}.`;
  }
}

/** "in about 12 min", or "in a moment" when it is under a minute away (or unknown). */
export function readyInWords(retryAfterS: number | undefined): string {
  return retryAfterS && retryAfterS >= 60 ? `in ${aboutWords(retryAfterS)}` : "in a moment";
}

/** The server's words: the wait until it refreshes. */
export function limitWords(kind: LimitKind, retryAfterS?: number): string {
  return sentence(kind, readyInWords(retryAfterS));
}

/** The page's words: the time it refreshes on the viewer's clock ("at 14:20"), or "in a moment" when that is now. */
export function limitWordsAt(kind: LimitKind, refreshAt: number, now = Date.now()): string {
  return sentence(kind, refreshAt - now > 60_000 ? `at ${clockWords(refreshAt, now)}` : "in a moment");
}

/** The limits on free runs here: past them, the next step is offered (limitNext). */
export const FREE_LIMITS: readonly LimitKind[] = ["free-today", "free-hour", "network"];

/** What to do now, past a limit on free runs: run it self-hosted (an account), or a free account (a guest). */
export function limitNext(kind: LimitKind, guest: boolean): { label: string; to: "self-hosted" | "sign-up" } | undefined {
  if (!FREE_LIMITS.includes(kind)) return undefined;
  return guest ? { label: "Create a free account for more free runs", to: "sign-up" } : { label: "Want to keep going now? Run it self-hosted →", to: "self-hosted" };
}

/** The fields a limit's refusal carries for the page (its kind, when it refreshes, epoch ms). */
export function limitFields(kind: LimitKind, retryAfterS: number, now = Date.now()): { limit: LimitKind; refreshAt: number } {
  return { limit: kind, refreshAt: now + Math.max(0, retryAfterS) * 1000 };
}
