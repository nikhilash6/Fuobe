// New worker code on disk (docs/gpu-workers.md, "Install and update"). The worker notes the code it started with: its
// checkout's commit, the build stamp of its shared parts, and the update-ready file in its home folder (an updater
// writes it once a new build is in place). When any of them changes and the new code is whole (its parts' stamp matches
// its checkout), the worker ends with UPDATE_EXIT so that whatever started it starts it again at once, on the new code:
// once no person's job waits for it (restartDue; at most UPDATE_DEFER_MAX_MS after it found the new code), it takes no
// new job, finishes the one it has, and ends. A half-done update (a checkout whose build isn't there yet) never ends it:
// it keeps working until the parts match.
import fs from "node:fs";
import path from "node:path";
import { distProblem, STAMP_FILE } from "./stamp.mjs";

/** The exit code of `fuobe worker run` after it ended to start again on new code. */
export const UPDATE_EXIT = 75;

/**
 * The longest a worker puts off its restart on new code while people's jobs wait for it (ms). Past it, it restarts after
 * the job in hand even with people's jobs waiting.
 */
export const UPDATE_DEFER_MAX_MS = 30 * 60_000;

/**
 * May a worker that found new code at `foundAt` begin its restart now: when no person's job waits that it may take now
 * (`peopleWaiting`, the beat's claimableNow; null or 0 when the studio doesn't say or none waits), or once `maxMs` has
 * gone by since it found the code. The owner's own jobs never hold a restart back.
 */
export const restartDue = (t, foundAt, peopleWaiting, maxMs = UPDATE_DEFER_MAX_MS) => !(Number(peopleWaiting) > 0) || t - foundAt >= maxMs;

/** The file in the worker's home folder that an updater writes once new code is installed and checked. */
export const UPDATE_READY_FILE = "update-ready.json";

/** How often the worker looks at its code on disk (a few small files). */
export const CODE_CHECK_MS = 15_000;

/** While the code on disk changed but isn't whole yet, how often it checks the stamp again (it reads every source). */
export const WHOLE_CHECK_MS = 60_000;

const readText = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

/** The git folder of a checkout: `.git`, or the one a `.git` file names (a worktree). */
function gitDir(root) {
  const dotGit = path.join(root, ".git");
  try {
    if (fs.statSync(dotGit).isDirectory()) return dotGit;
  } catch {
    return null;
  }
  const m = /^gitdir:\s*(.+)$/m.exec(readText(dotGit) ?? "");
  return m ? path.resolve(root, m[1].trim()) : null;
}

/** The commit a checkout is at, from its git files (no git program), or null. */
export function headOf(root) {
  const dir = gitDir(root);
  if (!dir) return null;
  const head = (readText(path.join(dir, "HEAD")) ?? "").trim();
  const ref = /^ref:\s*(\S+)$/.exec(head)?.[1];
  if (!ref) return /^[0-9a-f]{40,64}$/.test(head) ? head : null;
  // A branch: its file, in this folder or the shared one, else packed-refs.
  const common = (readText(path.join(dir, "commondir")) ?? "").trim();
  const dirs = [dir, ...(common ? [path.resolve(dir, common)] : [])];
  for (const d of dirs) {
    const sha = (readText(path.join(d, ref)) ?? "").trim();
    if (/^[0-9a-f]{40,64}$/.test(sha)) return sha;
  }
  for (const d of dirs) {
    for (const line of (readText(path.join(d, "packed-refs")) ?? "").split("\n")) {
      const [sha, name] = line.trim().split(" ");
      if (name === ref && /^[0-9a-f]{40,64}$/.test(sha)) return sha;
    }
  }
  return null;
}

/** The stamp of the parts in `dist`, or null. */
function stampOf(dist) {
  try {
    const s = JSON.parse(readText(path.join(dist, STAMP_FILE)) ?? "null")?.stamp;
    return typeof s === "string" ? s : null;
  } catch {
    return null;
  }
}

/** The code on disk now: { head, stamp, ready } (each a string, or null when it isn't there). */
export function codeOnDisk({ root, dist, home }) {
  return { head: headOf(root), stamp: stampOf(dist), ready: home ? readText(path.join(home, UPDATE_READY_FILE)) : null };
}

const same = (a, b) => a.head === b.head && a.stamp === b.stamp && a.ready === b.ready;

/**
 * Watches the code on disk against the code the worker started with. `check(t)` is true once new code is installed
 * and whole, and stays true. `o`: { root, dist, home, everyMs, wholeEveryMs, problem (distProblem) }.
 */
export class CodeWatch {
  constructor(o) {
    this.o = { everyMs: CODE_CHECK_MS, wholeEveryMs: WHOLE_CHECK_MS, problem: distProblem, ...o };
    this.started = codeOnDisk(this.o);
    this.checkedAt = -Infinity;
    this.wholeAt = -Infinity;
    this.found = false;
  }

  check(t) {
    if (this.found) return true;
    if (t - this.checkedAt < this.o.everyMs) return false;
    this.checkedAt = t;
    const now = codeOnDisk(this.o);
    if (same(now, this.started)) return false;
    // Changed: whole only when the parts were built from this checkout. Checked at once after each new change (the
    // update-ready file comes last), else not more often than wholeEveryMs.
    const moved = !this.seen || !same(now, this.seen);
    this.seen = now;
    if (!moved && t - this.wholeAt < this.o.wholeEveryMs) return false;
    this.wholeAt = t;
    let problem;
    try {
      problem = this.o.problem(this.o.root, this.o.dist);
    } catch {
      problem = "stale";
    }
    this.found = problem === null;
    return this.found;
  }
}
