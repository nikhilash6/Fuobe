// Studio jobs first (docs/gpu-workers.md): while local ComfyUI work holds the GPU, the worker asks for a turn through two
// small files in a folder that worker.json names, and a helper on the PC's side answers.
//
// - site.json, which the worker writes on every beat: { siteWaiting, oldestWaitS, interrupt, at }. siteWaiting counts
//   the studio's jobs this worker may take now (the beat's claimableNow) plus the one it runs. While a turn lasts it is
//   at least 1, and it goes to 0 when the studio has had no job for it for a minute (the worker then frees its own
//   ComfyUI's memory), when it is paused, or when a local cap is reached.
// - yielded.json, which the helper writes: { state: "yielding" | "yielded", at, startsAt? }. A fresh "yielded" lets the
//   worker start at once. "yielding" may carry the helper's estimate of the start (startsAt), which the beat passes on.
//
// The studio can't change the caps here: at most `maxHoursPerDay` hours of turns a day, at most one interrupt per
// `interruptGapMin` minutes, and `neverInterrupt`, which always wins. The worker only writes numbers; the helper
// decides what to do with them.
import fs from "node:fs";
import path from "node:path";

const HOUR = 3_600_000;

export const TURNS = {
  /** No job for this long ends a turn. */
  graceMs: 60_000,
  /** A "yielded" written this recently counts, whenever the turn began. */
  freshMs: 15_000,
  /** No answer for this long: the worker says so in its beat and its log. */
  lateMs: 3 * 60_000,
  /** A tick counts towards the day's hours for at most this long (a PC that slept doesn't use up the day). */
  maxTickMs: 10_000,
};

const finite = (v) => typeof v === "number" && Number.isFinite(v);

/** The helper's answer, or null when there is none or it isn't one. */
export function readYielded(folder) {
  try {
    const p = path.join(folder, "yielded.json");
    if (fs.statSync(p).size > 4096) return null;
    const o = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!o || typeof o !== "object" || !["yielding", "yielded"].includes(o.state) || !finite(o.at)) return null;
    return { state: o.state, at: o.at, startsAt: finite(o.startsAt) ? o.startsAt : null };
  } catch {
    return null;
  }
}

/** site.json, written whole (a reader never sees half of it). */
export function writeSite(folder, body) {
  const p = path.join(folder, "site.json");
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(body)}\n`);
  fs.renameSync(tmp, p);
}

/** The local day (a cap counts per day on this PC's clock). */
const dayOf = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * The turns on this PC. `step(t, facts)` runs once a loop and says what to write and whether to wait:
 * { siteWaiting, oldestWaitS, interrupt, waitForYield, late, startsAt, ended } — `ended` is "idle" when a turn ended
 * because no job came for a minute (free its own ComfyUI's memory), "stopped" when it ended for any other reason.
 */
export class SiteTurns {
  /** `o`: { folder, stateFile, maxHoursPerDay, interruptGapMin, neverInterrupt, graceMs }. */
  constructor(o) {
    this.o = o;
    this.active = false;
    this.startAt = 0;
    this.lastWantAt = 0;
    this.lastTickAt = null;
    this.neededYield = false;
    this.interrupt = false;
    this.waitSince = null;
    this.waitingSince = null;
    this.savedAt = 0;
    this.saved = this.load();
  }

  load() {
    try {
      const s = JSON.parse(fs.readFileSync(this.o.stateFile, "utf8"));
      return { day: typeof s.day === "string" ? s.day : "", usedMs: finite(s.usedMs) ? s.usedMs : 0, lastInterruptAt: finite(s.lastInterruptAt) ? s.lastInterruptAt : -Infinity };
    } catch {
      return { day: "", usedMs: 0, lastInterruptAt: -Infinity };
    }
  }

  save(t) {
    this.savedAt = t;
    try {
      fs.mkdirSync(path.dirname(this.o.stateFile), { recursive: true });
      fs.writeFileSync(this.o.stateFile, JSON.stringify({ ...this.saved, lastInterruptAt: finite(this.saved.lastInterruptAt) ? this.saved.lastInterruptAt : null }), { mode: 0o600 });
    } catch {}
  }

  /** The folder is there (the PC's setup makes it, with its rights; the worker never makes it). */
  folderOk() {
    try {
      return !!this.o.folder && fs.statSync(this.o.folder).isDirectory();
    } catch {
      return false;
    }
  }

  /** Hours of turns left today. */
  capLeft(t) {
    const max = Number(this.o.maxHoursPerDay ?? 20);
    if (!(max > 0)) return false;
    const used = this.saved.day === dayOf(t) ? this.saved.usedMs : 0;
    return used < max * HOUR;
  }

  /** The helper's answer counts for this turn. */
  yielded(t) {
    const y = readYielded(this.o.folder);
    if (!y || y.state !== "yielded" || y.at > t + 60_000) return false;
    return y.at >= this.startAt - 1000 || t - y.at <= TURNS.freshMs;
  }

  /**
   * `f`: { may (the worker may ask for a turn now: the folder is there, the studio says what it can take, nothing pauses
   * it), claimable (the beat's claimableNow), busy (a studio job runs here), workHolds (local ComfyUI work holds more
   * than busyVramMb), workThere (local ComfyUI work listens at all), serverInterrupt, oldestWaitS (the studio's, when
   * it says) }.
   */
  step(t, f) {
    const day = dayOf(t);
    if (this.saved.day !== day) this.saved = { ...this.saved, day, usedMs: 0 };
    if (this.active && this.lastTickAt !== null) this.saved.usedMs += Math.min(Math.max(0, t - this.lastTickAt), TURNS.maxTickMs);
    this.lastTickAt = t;
    const may = !!f.may && this.capLeft(t);
    const claimable = Math.max(0, Math.floor(Number(f.claimable) || 0));
    const want = (may && claimable > 0) || !!f.busy;
    let ended = null;
    if (want) {
      if (!this.active) {
        this.active = true;
        this.startAt = t;
        this.neededYield = false;
        this.interrupt = false;
        this.waitingSince = null;
      }
      this.lastWantAt = t;
    } else if (this.active && (!may || t - this.lastWantAt >= (this.o.graceMs ?? TURNS.graceMs))) {
      // Paused, a cap reached, or the studio stopped asking: at once. The line simply empty: after a minute.
      ended = may ? "idle" : "stopped";
      this.active = false;
      this.interrupt = false;
      this.waitingSince = null;
      this.save(t);
    }
    if (!this.active) {
      this.waitSince = null;
      return { siteWaiting: 0, oldestWaitS: 0, interrupt: false, waitForYield: false, late: false, startsAt: null, ended };
    }
    if (f.workHolds) this.neededYield = true;
    // The local ComfyUI work closed: nothing to wait for any more.
    if (!f.workThere && !f.workHolds) this.neededYield = false;
    const yielded = this.yielded(t);
    const waitForYield = !f.busy && this.neededYield && !yielded;
    if (waitForYield) {
      this.waitingSince ??= t;
      const gap = Number(this.o.interruptGapMin ?? 30) * 60_000;
      if (!this.interrupt && f.serverInterrupt === true && !this.o.neverInterrupt && t - this.saved.lastInterruptAt >= gap) {
        this.interrupt = true;
        this.saved.lastInterruptAt = t;
        this.save(t);
      }
    } else {
      this.waitingSince = null;
      if (yielded) this.interrupt = false;
    }
    if (this.o.neverInterrupt || f.serverInterrupt !== true) this.interrupt = false;
    if (t - this.savedAt >= 30_000) this.save(t);
    this.waitSince = claimable > 0 ? (this.waitSince ?? t) : null;
    const oldestWaitS = finite(f.oldestWaitS) ? Math.max(0, Math.round(f.oldestWaitS)) : this.waitSince === null ? 0 : Math.round((t - this.waitSince) / 1000);
    const y = waitForYield ? readYielded(this.o.folder) : null;
    return {
      // Jobs it may not take now (paused, with one still finishing) don't count.
      siteWaiting: Math.max(1, (may ? claimable : 0) + (f.busy ? 1 : 0)),
      oldestWaitS,
      interrupt: this.interrupt,
      waitForYield,
      late: waitForYield && t - this.waitingSince >= TURNS.lateMs,
      startsAt: y?.state === "yielding" && y.at >= this.startAt - 1000 ? y.startsAt : null,
      ended,
    };
  }
}
