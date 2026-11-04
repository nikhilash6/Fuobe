/**
 * What a person sees of a run on this install's GPUs, as the recovery tests check it: every look at the run (a refresh,
 * a second session, the list, another app process) is written down, and checked against the rule that the run shows
 * only "In line" (with its place), "Working" (with its progress) and then its result. A recovery shows "In line" again
 * with the place it had. No error, no word about the machines, no pause.
 */
import { POOL_WORDS } from "@/lib/relay";

/** A run as the studio answers it (GET /api/generations/<id>, a list item, getGeneration). */
export interface RunLike {
  id?: string;
  status: string;
  message?: string | null;
  error?: string | null;
  progress?: number | null;
  queue?: { place: number; etaSeconds: number | null } | null;
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

export class RunWatch {
  readonly seen: Seen[] = [];

  /** `views`: each place the person can look from (where → a read of the run). */
  constructor(private views: Record<string, () => RunLike | null | Promise<RunLike | null>>) {}

  /** Look from every view now. */
  async look(): Promise<Seen[]> {
    const now: Seen[] = [];
    for (const [where, read] of Object.entries(this.views)) {
      const g = await read();
      if (g) now.push(seenOf(where, g));
    }
    this.seen.push(...now);
    return now;
  }

  /** Everything seen that breaks the rule (empty: seamless). `place`: the place the run had when it was made. */
  problems(o: { place?: number } = {}): string[] {
    const out: string[] = [];
    let best = o.place ?? Infinity;
    for (const s of this.seen) {
      const at = `${s.where}: ${JSON.stringify(s)}`;
      if (!["queued", "running", "succeeded"].includes(s.status)) out.push(`a state that isn't In line, Working or the result (${at})`);
      if (s.status === "queued" && s.message !== POOL_WORDS.inLine) out.push(`a waiting run that doesn't say In line (${at})`);
      if (s.status === "running" && s.message !== POOL_WORDS.working) out.push(`a started run that doesn't say Working (${at})`);
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

/** A run that truly can't finish: one plain sentence, nothing about the machines, and not charged when it had a hold. */
export function plainFailure(g: RunLike, o: { held: boolean }): string[] {
  const out: string[] = [];
  if (g.status !== "failed") out.push(`it is ${g.status}, not failed`);
  if (g.error !== POOL_WORDS.failed) out.push(`its words are ${JSON.stringify(g.error)}`);
  if (g.fix) out.push("it offers a fix");
  if (o.held && !g.notCharged) out.push("it doesn't say Not charged");
  return out;
}
