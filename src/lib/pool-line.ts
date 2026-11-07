/**
 * The words for a run's place in line on this install's GPUs (hosted runs). Before Run, the line under the toolbar says
 * when the result would be ready ("Ready in about 2 min", "Warming up · starts automatically", "Ready in seconds"); a
 * run's tile says where it is and when ("You're next · ready in about 40 s", "2 ahead of you · about 3 min"). A run shows
 * only its place, "Working", then its result: it is taken whatever the line, and never ends for a wait.
 *
 * A run can also be made and wait to enter the line (`held`): behind the account's other runs ("After your other runs"),
 * until a time ("Free runs refresh at 14:20." before Run, "Free runs refresh at 14:20 · this one starts then" on its
 * tile), or while runs there are paused ("Warming up · starts automatically").
 *
 * The words are friendly and say what happens next: never the machinery (a GPU, a worker, a queue), never "busy", never
 * "try again later" (tests/hosted-words.test.ts). They are made in the browser, so a time is the viewer's own clock.
 * A few of them are the service's display copy when it sends some (src/lib/service-copy.ts), else the plain ones here.
 */

import { copyLine } from "./service-copy";

/** Why a run made now waits to enter the line (server: pool-holds.ts). */
export type HeldReason = "mine" | "today" | "service" | "hour" | "list" | "credits";

/**
 * A place in line (1: next) and the wait, about (`etaSeconds`, until the result; null: unknown). `unknown`: no GPU that
 * could run it can take it now, so it starts when one is free; `returnAt` (epoch ms): when the first of them is due
 * back, when one says. `light`: light work only (joins, trims), which needs no GPU. `held`: it waits to enter the line
 * (until `startAt`, epoch ms, when it has one; `paused`: runs there are paused, with the words to say before Run in
 * `note`).
 */
export interface LineFacts {
  place: number;
  etaSeconds: number | null;
  unknown?: boolean;
  returnAt?: number;
  light?: boolean;
  held?: HeldReason;
  startAt?: number;
  paused?: boolean;
  note?: string;
}

/** "about 40 s", "about 2 min", "about 3 h". */
export function aboutWords(seconds: number): string {
  if (seconds < 60) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} s`;
  if (seconds < 90 * 60) return `about ${Math.max(1, Math.round(seconds / 60))} min`;
  return `about ${Math.round(seconds / 3600)} h`;
}

/** A time on the viewer's clock ("14:20"), or "tomorrow at 09:05" when it is on another day. */
export function clockWords(at: number, now = Date.now()): string {
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(at);
  return new Date(at).toDateString() === new Date(now).toDateString() ? time : `tomorrow at ${time}`;
}

/** The display copy key for each limit on free runs and free replies (src/lib/service-copy.ts). */
const FREE_COPY = { "free-today": "limitDaily", "free-hour": "limitHour", network: "limitNetwork", replies: "limitReplies" } as const;

/** The plain sentences for those limits, when no display copy is sent. */
const FREE_FALLBACK: Record<keyof typeof FREE_COPY, string> = {
  "free-today": "Free runs refresh {when}.",
  "free-hour": "Free runs refresh {when}.",
  network: "Free runs on your network refresh {when}.",
  replies: "More free replies {when}.",
};

/**
 * The sentence for a limit on free runs or free replies (src/lib/limit-words.ts), `when` it refreshes ("at 14:20", "in
 * about 40 min", "in a moment").
 */
export function freeLimitSentence(kind: keyof typeof FREE_COPY, when: string): string {
  return copyLine(FREE_COPY[kind], { when }, FREE_FALLBACK[kind]);
}

/** When a run waiting for a time starts: "at 14:20" (or "in a moment" when that time has come). */
const atWords = (startAt: number | undefined, now: number): string => (startAt && startAt - now > 60_000 ? `at ${clockWords(startAt, now)}` : "in a moment");

/** A wait for a GPU that isn't on yet: when it is due back, else it starts by itself. */
function warmingWords(q: LineFacts, now: number): string {
  const ms = q.returnAt ? q.returnAt - now : 0;
  if (ms <= 0) return "starts automatically";
  return ms <= 2 * 60_000 ? "starting in a moment" : `starts in ${aboutWords(ms / 1000)}`;
}

/**
 * When the run would be done, or start, in words inside a sentence: "ready in about 40 s", "ready in seconds", "starts
 * automatically", "starts in about 3 h", "starts at 14:20", "starts after your other runs". Null when nothing is known
 * (no estimate yet): nothing is guessed.
 */
export function waitWords(q: LineFacts, now = Date.now()): string | null {
  if (q.light) return "ready in seconds";
  if (q.held === "mine") return "starts after your other runs";
  if (q.held === "list") return "starts as soon as you're in";
  if (q.held === "today" || q.held === "hour" || q.held === "credits") return `starts ${atWords(q.startAt, now)}`;
  if (q.held === "service" && q.paused) return "starts automatically";
  if (q.unknown) return warmingWords(q, now);
  const s = q.etaSeconds;
  return s === null || !Number.isFinite(s) || s < 0 ? null : `ready in ${aboutWords(s)}`;
}

/** The same words opening a line of their own ("Ready in about 2 min"). */
export const capitalFirst = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The line under the toolbar before Run, as a sentence of its own: "Ready in about 2 min", "Starts after your other
 * runs", "Free runs refresh at 14:20.", "Starts at 14:20, when your free generations renew", the service's own words
 * while runs there are paused. Null when nothing is known.
 */
export function noteWords(q: LineFacts, now = Date.now()): string | null {
  if (q.held === "service" && q.paused && q.note) return q.note;
  if (q.held === "list") return "You're on the waiting list. Your runs start as soon as you're in.";
  // (The same sentences as a limit's refusal, src/lib/limit-words.ts.)
  if (q.held === "today") return freeLimitSentence("free-today", atWords(q.startAt, now));
  if (q.held === "hour") return freeLimitSentence("free-hour", atWords(q.startAt, now));
  const wait = waitWords(q, now);
  if (!wait) return null;
  if (q.held === "credits") return `${capitalFirst(wait)}, when your free generations renew`;
  if (q.unknown || (q.held === "service" && q.paused)) return `Warming up · ${wait}`;
  return capitalFirst(wait);
}

/** How many ahead of a place in line make the display copy's longer line worth showing (`queueBusy`). */
const MANY_AHEAD = 5;

/**
 * A run's place on this install's GPUs (1: next) and its wait: "You're next · ready in about 40 s", "2 ahead of you ·
 * about 3 min" (with many ahead, the display copy's `queueBusy` line around it when the service sends one). A run
 * waiting for a GPU to come on: "Warming up · starting in a moment". A run waiting to enter the line: "After your
 * other runs · ready in about 2 min", "Free runs refresh at 14:20 · this one starts then", "You're on the waiting
 * list"; one waiting for the service, as warming up.
 */
export function lineWords(q: LineFacts, now = Date.now()): string {
  if (q.held === "mine") {
    const s = q.etaSeconds;
    return s !== null && Number.isFinite(s) && s >= 0 ? `After your other runs · ready in ${aboutWords(s)}` : "After your other runs";
  }
  if (q.held === "list") return "You're on the waiting list · starts as soon as you're in";
  if (q.held === "today" || q.held === "hour") return `Free runs refresh ${atWords(q.startAt, now)} · this one starts then`;
  if (q.held === "credits") return `Starts ${atWords(q.startAt, now)}, when your free generations renew`;
  if ((q.held === "service" && q.paused) || q.unknown) return `Warming up · ${warmingWords(q, now)}`;
  const ahead = Math.max(0, Math.floor(q.place) - 1);
  const s = q.etaSeconds;
  const eta = q.light ? "seconds" : s !== null && Number.isFinite(s) && s >= 0 ? aboutWords(s) : null;
  if (ahead === 0) return eta ? `You're next · ready in ${eta}` : "You're next";
  const head = `${ahead} ahead of you`;
  const line = eta ? `${head} · ${q.light ? "ready in seconds" : eta}` : head;
  // (The place and the wait first: a tile shows two lines.)
  return ahead >= MANY_AHEAD ? copyLine("queueBusy", { line, n: ahead }, "{line}") : line;
}
