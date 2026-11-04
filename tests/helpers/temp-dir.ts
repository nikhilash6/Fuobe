import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

/**
 * Temp folders for tests. `tempDir("fuobe-x-")` makes a new empty folder under the system temp folder and removes it
 * after the test file's last test, wherever it was made (at the top of the file, in a hook or in a test).
 *
 * Windows won't delete a file that is still open, so when the install's database (src/server/db.ts) lives in the
 * folder, the background runners' timers are stopped and the database is closed first, and removal retries while
 * other handles let go. The worker's temp folder points inside the run's own folder (tests/setup/temp-root.ts), which
 * is removed after the run as well, so a folder this misses is still cleared.
 */

const made = new Set<string>();

export function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.add(dir);
  return dir;
}

/** Remove a temp folder now: stops what writes to the database in it, retries on Windows EPERM/EBUSY, never throws. */
export async function removeTempDir(dir: string): Promise<void> {
  made.delete(dir);
  const hadDatabase = holdsDatabase(dir);
  if (hadDatabase) {
    stopBackgroundTimers();
    // A tick that was already running finishes its query before the database closes.
    await sleep(50);
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    closeDatabaseIn(dir);
    if (!(await removeDir(dir))) return;
    if (!hadDatabase) return;
    // A run a test started and didn't wait for can carry on for a moment and open the database again, which makes the
    // folder again. Test processes are stopped, not exited, so nothing can clear it later in this process.
    await sleep(250);
    if (!fs.existsSync(dir)) return;
  }
  console.warn(`[tests] Couldn't remove ${dir}: it was made again after being removed`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const RETRY = new Set(["EPERM", "EBUSY", "ENOTEMPTY", "EACCES", "EMFILE", "ENFILE"]);

/**
 * Retries cover a handle that is closing (a server, a child process, an antivirus scan); a failure is only a warning.
 * The removal itself is synchronous: `fs.promises.rm` runs on libuv's thread pool, which code under test can keep
 * busy, and then it never finishes. The waits between tries let other handles close.
 */
export async function removeDir(dir: string): Promise<boolean> {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return true;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code ?? "";
      if (!RETRY.has(code) || attempt >= 20) {
        console.warn(`[tests] Couldn't remove ${dir}: ${(e as Error).message}`);
        return false;
      }
      await sleep(Math.min(100 * attempt, 500));
    }
  }
}

function inside(file: string, dir: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel));
}

function holdsDatabase(dir: string): boolean {
  const db = globalThis.__fuobeDb;
  return !!db && inside(db.name, dir);
}

/** The database file and its -wal/-shm stay open until the connection closes. A later `db()` opens it again. */
function closeDatabaseIn(dir: string): void {
  const db = globalThis.__fuobeDb;
  if (!db || !inside(db.name, dir)) return;
  try {
    if (db.open) db.close();
  } catch {
    // Already closing.
  }
  globalThis.__fuobeDb = undefined;
}

function isTimer(v: unknown): v is NodeJS.Timeout {
  return typeof v === "object" && v !== null && typeof (v as NodeJS.Timeout).refresh === "function" && typeof (v as NodeJS.Timeout).hasRef === "function";
}

/**
 * The server's background runners (generations, schedules, skills, trash purge and others) keep their timers on
 * `globalThis.__fuobe*`, alone or on a state object. Each tick reads the database and would open it again in a folder
 * that is being removed, so they stop once the file's tests are done. Each test file runs in a process of its own.
 */
function stopBackgroundTimers(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const key of Object.keys(g)) {
    if (!key.startsWith("__fuobe") || key === "__fuobeDb") continue;
    const v = g[key];
    if (isTimer(v)) clearInterval(v);
    else if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
      for (const inner of Object.values(v)) if (isTimer(inner)) clearInterval(inner);
    }
  }
}

// Registered when the first test file imports this module, so with Vitest's default hook order ("stack") it runs
// after the file's own afterAll hooks have closed their servers and stand-ins.
afterAll(async () => {
  for (const dir of [...made]) await removeTempDir(dir);
}, 60_000);
