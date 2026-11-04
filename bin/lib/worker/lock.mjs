// One worker at a time on a worker folder (docs/gpu-workers.md). A second `fuobe worker run` with the same folder (by
// hand while the scheduled task's worker runs, say) would stop the first one's ComfyUI, empty its folders and take its
// job, so it refuses to start instead. The lock is worker.lock in the worker folder: { pid, id, script, at }. A lock
// whose worker has stopped (its process is gone, or its process id now belongs to another program) is taken over.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { commandLineOf } from "./comfy.mjs";

/** Another worker runs on this worker folder. */
export class WorkerRunning extends Error {
  constructor(pid, file) {
    super(`Another worker is running on this worker folder (process ${pid}). Stop it first: Ctrl+C in its window, or end the "Fuobe worker" task. If no worker runs, delete ${file}.`);
    this.pid = pid;
  }
}

/** The locks this process holds now: lock file → its id (two workers in one process are told apart by it). */
const held = new Map();

const key = (file) => (process.platform === "win32" ? path.resolve(file).toLowerCase() : path.resolve(file));

/** Is a process with this id running? (One that can't be signalled for lack of rights runs.) */
function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
}

/**
 * Does the worker that a lock (or a ComfyUI's pid file) names still run? In this process: while it holds its lock. In
 * another: while that process runs and its command line is a worker's (`fuobe … worker`, or the script it named). A
 * command line that can't be read counts as a worker's, so nothing is taken from a worker that might still run.
 * `o.commandLineOf` replaces the lookup (tests).
 */
export async function workerLives(rec, o = {}) {
  const pid = Number(rec?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return [...held.values()].includes(rec.id);
  if (!running(pid)) return false;
  const line = await (o.commandLineOf ?? commandLineOf)(pid);
  if (line === null || line === undefined) return true;
  return (typeof rec.script === "string" && rec.script.length > 0 && line.includes(rec.script)) || (/fuobe/i.test(line) && /\bworker\b/i.test(line));
}

/**
 * Take the worker folder's lock, or throw WorkerRunning. Returns { owner: { pid, id, script }, release }: release lets
 * go of it (only of this lock, never of one another worker took over since).
 */
export async function takeLock(workDir, o = {}) {
  const file = path.join(workDir, "worker.lock");
  const me = { pid: process.pid, id: crypto.randomBytes(8).toString("hex"), script: process.argv[1] ?? "", at: Date.now() };
  for (let i = 0; i < 3; i++) {
    try {
      fs.writeFileSync(file, JSON.stringify(me), { flag: "wx", mode: 0o600 });
      held.set(key(file), me.id);
      const release = () => {
        if (held.get(key(file)) !== me.id) return;
        held.delete(key(file));
        try {
          if (JSON.parse(fs.readFileSync(file, "utf8")).id === me.id) fs.rmSync(file, { force: true });
        } catch {}
      };
      return { owner: { pid: me.pid, id: me.id, script: me.script }, release };
    } catch (e) {
      if (e?.code !== "EEXIST") throw e;
    }
    let rec = null;
    try {
      rec = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {}
    if (rec && (await workerLives(rec, o))) throw new WorkerRunning(rec.pid, file);
    // Its worker stopped without letting go (or the file is half written): take it over.
    if (!rec) {
      // A lock being written right now: give it a moment before calling it broken.
      const age = (() => {
        try {
          return Date.now() - fs.statSync(file).mtimeMs;
        } catch {
          return Infinity;
        }
      })();
      if (age < 2_000) {
        await new Promise((r) => setTimeout(r, 2_000 - age));
        continue;
      }
    }
    fs.rmSync(file, { force: true });
  }
  let rec = null;
  try {
    rec = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  throw new WorkerRunning(rec?.pid ?? "unknown", file);
}
