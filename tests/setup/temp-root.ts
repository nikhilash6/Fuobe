import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Vitest global setup: the whole run's temp files go in one folder of its own, removed when the run ends.
 *
 * TEMP, TMP and TMPDIR point at the run's folder before the test workers start, so `os.tmpdir()` in every test, in the
 * code under test and in any program a test starts lands inside it. Each file removes its own folders as it ends
 * (tests/helpers/temp-dir.ts); this removes what is left once every worker has exited and let go of its files. A run
 * that was stopped before its end leaves its folder behind, and the next run removes it once that run's process is gone.
 */

const PREFIX = "fuobe-test-run-";
const OWNER = ".owner-pid";
const VARS = ["TEMP", "TMP", "TMPDIR"] as const;

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function remove(dir: string): Promise<boolean> {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    return true;
  } catch (e) {
    console.warn(`[tests] Couldn't remove ${dir}: ${(e as Error).message}`);
    return false;
  }
}

/** Folders of earlier runs whose process has exited. A folder without its owner file is left for an hour (just made). */
async function removeStale(base: string): Promise<void> {
  let names: string[] = [];
  try {
    names = fs.readdirSync(base).filter((n) => n.startsWith(PREFIX));
  } catch {
    return;
  }
  for (const name of names) {
    const dir = path.join(base, name);
    try {
      const pid = Number(fs.readFileSync(path.join(dir, OWNER), "utf8"));
      if (Number.isInteger(pid) && pid > 0 && alive(pid)) continue;
    } catch {
      try {
        if (Date.now() - fs.statSync(dir).mtimeMs < 60 * 60_000) continue;
      } catch {
        continue;
      }
    }
    await remove(dir);
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  const base = os.tmpdir();
  await removeStale(base);
  const root = fs.mkdtempSync(path.join(base, PREFIX));
  fs.writeFileSync(path.join(root, OWNER), String(process.pid));
  const saved = Object.fromEntries(VARS.map((k) => [k, process.env[k]]));
  for (const k of VARS) process.env[k] = root;

  return async () => {
    for (const k of VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    // A test that makes its folder without tempDir(), or a program that leaves its temp files, shows up here.
    try {
      const left = fs.readdirSync(root).filter((n) => n !== OWNER);
      if (left.length) console.warn(`[tests] Temp files left by the run (removed now): ${left.sort().join(", ")}`);
    } catch {
      // Already gone.
    }
    await remove(root);
  };
}
