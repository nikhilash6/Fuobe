/**
 * What a person sees of a run on this install's GPUs, as the recovery tests check it: every look at the run (a refresh,
 * a session, the list, another app process) is written down, and checked against the rule that the run shows only
 * "In line" (with its place), "Working" (with its progress) and then its result. A recovery shows "In line" again with
 * the place it had. No error, no word about the machines, no pause. A look that can't find the run (an error answer, a
 * run gone from the list) breaks the rule too, and so does the run showing to anyone but its own account.
 */
import { POOL_WORDS } from "@/lib/relay";

/** A run as the studio answers it (GET /api/generations/<id>, a list item, getGeneration). */
export interface RunLike {
  id?: string;
  status: string;
  message?: string | null;
  error?: string | null;
  progress?: number | null;
  queue?: { place: number; etaSeconds: number | null; unknown?: true } | null;
  outputs?: unknown[];
  notCharged?: boolean;
  fix?: unknown;
}

export interface Seen {
  where: string;
  status: string;
  message: string | null;
  error: string | null;
  place: number | null;
  progress: number | null;
  outputs: number;
}

export const seenOf = (where: string, g: RunLike): Seen => ({
  where,
  status: g.status,
  message: g.message ?? null,
  error: g.error ?? null,
  place: g.queue?.place ?? null,
  progress: typeof g.progress === "number" ? g.progress : null,
  outputs: g.outputs?.length ?? 0,
});

/** Words a person never reads on a run on this install's GPUs. */
const MACHINE_WORDS = /comfy|gpu|worker|pause|paused|error|crash|restart|computer|\bpc\b|server|timed out|lost|busy/i;

/** A read of the run from one place: the run, or null when it isn't there. It may throw (an error answer). */
export type View = () => RunLike | null | Promise<RunLike | null>;
/** A read from a place that must never show the run (another account): the HTTP status it answered. */
export type HiddenView = () => number | Promise<number>;

export class RunWatch {
  readonly seen: Seen[] = [];
  /** Looks that broke the rule on their own: the run missing from a view, or showing where it must not. */
  readonly misses: string[] = [];

  /**
   * `views`: each place the run's account can look from (where → a read of the run). `hidden`: places that must never
   * show it (where → the status they answered, which must be a refusal: 403 or 404).
   */
  constructor(
    private views: Record<string, View>,
    private hidden: Record<string, HiddenView> = {},
  ) {}

  /** Look from every view now. */
  async look(): Promise<Seen[]> {
    const now: Seen[] = [];
    for (const [where, read] of Object.entries(this.views)) {
      let g: RunLike | null = null;
      try {
        g = await read();
      } catch (e) {
        this.misses.push(`the run is missing from ${where} (${(e as Error).message})`);
        continue;
      }
      if (g) now.push(seenOf(where, g));
      else this.misses.push(`the run is missing from ${where}`);
    }
    for (const [where, read] of Object.entries(this.hidden)) {
      const status = await read();
      if (status !== 403 && status !== 404) this.misses.push(`the run answered ${status} to ${where}, not a refusal`);
    }
    this.seen.push(...now);
    return now;
  }

  /** Everything seen that breaks the rule (empty: seamless). `place`: the place the run had when it was made. */
  problems(o: { place?: number } = {}): string[] {
    const out: string[] = [...this.misses];
    let best = o.place ?? Infinity;
    for (const s of this.seen) {
      const at = `${s.where}: ${JSON.stringify(s)}`;
      if (!["queued", "running", "succeeded"].includes(s.status)) out.push(`a state that isn't In line, Working or the result (${at})`);
      if (s.status === "queued" && s.message !== POOL_WORDS.inLine) out.push(`a waiting run that doesn't say In line (${at})`);
      if (s.status === "queued" && s.place === null) out.push(`a waiting run with no place in line (${at})`);
      if (s.status === "running" && s.message !== POOL_WORDS.working && s.message !== POOL_WORDS.gettingReady) out.push(`a started run that doesn't say Working (${at})`);
      if (s.status === "succeeded" && s.outputs < 1) out.push(`a result with nothing in it (${at})`);
      if (s.error) out.push(`an error (${at})`);
      for (const w of [s.message, s.error]) if (w && MACHINE_WORDS.test(w)) out.push(`words about the machines (${at})`);
      if (s.status === "queued" && s.place !== null) {
        if (s.place > best) out.push(`its place went back from ${best} to ${s.place} (${at})`);
        best = Math.min(best, s.place);
      }
    }
    return out;
  }

  /** The states seen, without repeats in a row ("queued", "running", "queued", "running", "succeeded"). */
  path(where?: string): string[] {
    const out: string[] = [];
    for (const s of this.seen) if (!where || s.where === where) if (out[out.length - 1] !== s.status) out.push(s.status);
    return out;
  }
}

/**
 * A run that truly can't finish: one plain sentence (`words`: the failure sentence, or one about the person's own files),
 * nothing about the machines, and "Not charged" only when its hold set something aside (`charged`). A free run says
 * nothing about a charge.
 */
export function plainFailure(g: RunLike, o: { charged: boolean; words?: string }): string[] {
  const out: string[] = [];
  if (g.status !== "failed") out.push(`it is ${g.status}, not failed`);
  if (g.error !== (o.words ?? POOL_WORDS.failed)) out.push(`its words are ${JSON.stringify(g.error)}`);
  if (g.fix) out.push("it offers a fix");
  if (o.charged && !g.notCharged) out.push("it doesn't say Not charged");
  if (!o.charged && g.notCharged) out.push("it says Not charged, but nothing was set aside");
  return out;
}
