/**
 * Live edit's scheduler (pure: the transport is injected). One render of ours is in ComfyUI at a time, and nothing
 * piles up behind the typing:
 *
 * - `keep` renders (the picture a person chose to keep) go first, in order, and typing never cancels them;
 * - `live` keeps only the newest request: a newer one drops the waiting one ("replaced");
 * - `settle` (the full-quality render of the text on screen, after a pause) keeps only the newest, and any live request
 *   cancels it, waiting or running;
 * - `warm` (a throwaway render that loads the model) runs only when nothing else waits.
 *
 * An urgent live request (the person paused, or changed a control) also stops a running live or settle render of other
 * text, which answers "superseded" (a drop, not an error). `hurry(seq)` makes a waiting request urgent. While paused
 * (the GPU is busy with another job, the connection is down, the tab is hidden), requests wait, newest only.
 */

export type Slot = "keep" | "live" | "settle" | "warm";

/** How long a render may take before it is taken off ComfyUI and reported failed (the first after another job reloads the model). */
export const RENDER_DEADLINE_MS: Readonly<Record<Slot, number>> = { live: 60_000, settle: 90_000, keep: 180_000, warm: 240_000 };

/** Slots by priority. */
export const SLOTS: readonly Slot[] = ["keep", "live", "settle", "warm"];

export interface LiveJob<P> {
  /** Per tab, only grows. */
  seq: number;
  slot: Slot;
  /** What the render makes (renderKey): two jobs with one key make the same picture. */
  key: string;
  urgent?: boolean;
  payload: P;
}

export type DropReason = "replaced" | "superseded" | "cancelled" | "closed";

export type Outcome<R> = { ok: true; result: R } | { ok: false; dropped: DropReason } | { ok: false; error: string };

export interface SchedulerIo<P, R> {
  /** Run one render. Abort `signal` to take it off ComfyUI (the transport deletes it if queued, interrupts it if running). */
  run(job: LiveJob<P>, signal: AbortSignal): Promise<R>;
  /** Told when a job starts, for status. */
  onStart?(job: LiveJob<P>): void;
}

interface Entry<P, R> {
  job: LiveJob<P>;
  resolve: (o: Outcome<R>) => void;
}

interface Current<P, R> extends Entry<P, R> {
  ctrl: AbortController;
  dropped?: DropReason;
}

export class LiveScheduler<P, R> {
  private keeps: Entry<P, R>[] = [];
  private waiting: { live?: Entry<P, R>; settle?: Entry<P, R>; warm?: Entry<P, R> } = {};
  private current: Current<P, R> | null = null;
  private paused = false;
  private closed = false;
  private lastSeq = -Infinity;

  private readonly io: SchedulerIo<P, R>;
  constructor(io: SchedulerIo<P, R>) {
    this.io = io;
  }

  /** Queue a job; the promise answers once it is done, dropped or failed. */
  submit(job: LiveJob<P>): Promise<Outcome<R>> {
    return new Promise((resolve) => {
      if (this.closed) return resolve({ ok: false, dropped: "closed" });
      // A job older than one already seen in its slot comes too late (a reordered request).
      if (job.seq <= this.lastSeq && job.slot !== "keep") {
        const newer = this.newestSeqIn(job.slot);
        if (newer !== undefined && newer > job.seq) return resolve({ ok: false, dropped: "replaced" });
      }
      this.lastSeq = Math.max(this.lastSeq, job.seq);
      const entry: Entry<P, R> = { job, resolve };
      if (job.slot === "keep") {
        this.keeps.push(entry);
      } else {
        const slot = job.slot;
        const prior = this.waiting[slot];
        if (prior) prior.resolve({ ok: false, dropped: "replaced" });
        this.waiting[slot] = entry;
        if (slot === "live") {
          // Typing cancels the settle render, waiting or running.
          if (this.waiting.settle) {
            this.waiting.settle.resolve({ ok: false, dropped: "replaced" });
            this.waiting.settle = undefined;
          }
          if (this.current?.job.slot === "settle" && this.current.job.key !== job.key) this.stop(this.current, "superseded");
          if (job.urgent) this.preemptFor(job);
        }
      }
      this.pump();
    });
  }

  /** The person wants this waiting live request now: stop a running live or settle render of other text. */
  hurry(seq: number): void {
    const w = this.waiting.live;
    if (w && w.job.seq === seq) this.preemptFor(w.job);
  }

  /** Drop every waiting job that matches, and stop the running one if it matches. */
  cancel(match: (job: LiveJob<P>) => boolean): void {
    for (const slot of ["live", "settle", "warm"] as const) {
      const w = this.waiting[slot];
      if (w && match(w.job)) {
        w.resolve({ ok: false, dropped: "cancelled" });
        this.waiting[slot] = undefined;
      }
    }
    this.keeps = this.keeps.filter((k) => (match(k.job) ? (k.resolve({ ok: false, dropped: "cancelled" }), false) : true));
    if (this.current && match(this.current.job)) this.stop(this.current, "cancelled");
  }

  /** Hold every waiting job (newest only per slot) until resume(). A running render finishes. */
  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.pump();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** The job running now, if any. */
  get running(): LiveJob<P> | null {
    return this.current?.job ?? null;
  }

  /** The jobs waiting, by slot (for status and tests). */
  get queued(): LiveJob<P>[] {
    return [...this.keeps.map((k) => k.job), ...(["live", "settle", "warm"] as const).flatMap((s) => (this.waiting[s] ? [this.waiting[s]!.job] : []))];
  }

  /** Take everything off: waiting jobs answer "closed", the running one is stopped. */
  close(): void {
    this.closed = true;
    this.cancelAll("closed");
  }

  /** Drop everything (a lost connection: the newest is sent again by the caller). */
  cancelAll(reason: DropReason = "cancelled"): void {
    for (const k of this.keeps) k.resolve({ ok: false, dropped: reason });
    this.keeps = [];
    for (const slot of ["live", "settle", "warm"] as const) {
      this.waiting[slot]?.resolve({ ok: false, dropped: reason });
      this.waiting[slot] = undefined;
    }
    if (this.current) this.stop(this.current, reason);
  }

  private newestSeqIn(slot: Slot): number | undefined {
    if (slot === "keep") return undefined;
    const w = this.waiting[slot];
    const c = this.current?.job.slot === slot ? this.current.job.seq : undefined;
    return Math.max(w?.job.seq ?? -Infinity, c ?? -Infinity);
  }

  private preemptFor(job: LiveJob<P>) {
    const c = this.current;
    if (c && (c.job.slot === "live" || c.job.slot === "settle") && c.job.key !== job.key && c.job.seq < job.seq) this.stop(c, "superseded");
  }

  private stop(c: Current<P, R>, why: DropReason) {
    if (c.dropped) return;
    c.dropped = why;
    c.ctrl.abort(why);
  }

  private next(): Entry<P, R> | undefined {
    if (this.keeps.length) return this.keeps.shift();
    for (const slot of ["live", "settle", "warm"] as const) {
      const w = this.waiting[slot];
      if (w) {
        this.waiting[slot] = undefined;
        return w;
      }
    }
    return undefined;
  }

  private pump() {
    if (this.current || this.paused || this.closed) return;
    const entry = this.next();
    if (!entry) return;
    const cur: Current<P, R> = { ...entry, ctrl: new AbortController() };
    this.current = cur;
    this.io.onStart?.(entry.job);
    let settled = false;
    const done = (o: Outcome<R>) => {
      if (settled) return;
      settled = true;
      if (this.current === cur) this.current = null;
      cur.resolve(o);
      this.pump();
    };
    let p: Promise<R>;
    try {
      p = this.io.run(entry.job, cur.ctrl.signal);
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      // A job stopped while it ran answers as dropped, even when its render came in anyway.
      (result) => done(cur.dropped ? { ok: false, dropped: cur.dropped } : { ok: true, result }),
      (e) => done(cur.dropped ? { ok: false, dropped: cur.dropped } : { ok: false, error: e instanceof Error ? e.message : String(e) }),
    );
  }
}
