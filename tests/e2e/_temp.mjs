// Temp folders for the e2e scripts: `tempDir("fuobe-x-")` makes a new empty folder under the system temp folder and
// removes it when the script exits, however it exits (an `exit` handler). Removal retries while a stopped server or
// child process lets go of its files (Windows EPERM/EBUSY) and only warns when it can't. Folders a script keeps for
// people to look at (screenshots, renders) are made the usual way and printed instead.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const made = new Set();

export function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  if (made.size === 0) process.on("exit", () => made.forEach(removeDir));
  made.add(dir);
  return dir;
}

/**
 * Stop a server the script started, with the processes it started, and wait for it to exit, so its files in a temp
 * folder are closed. On Windows `child.kill()` stops only the first process and `next dev`'s own server keeps running.
 */
export async function stopProcess(child, waitMs = 5000) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((r) => child.once("exit", r));
  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else child.kill("SIGTERM");
  await Promise.race([exited, new Promise((r) => setTimeout(r, waitMs))]);
}

/** Remove a folder now, retrying for a few seconds; never throws. */
export function removeDir(dir) {
  made.delete(dir);
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
    return true;
  } catch (e) {
    console.warn(`Couldn't remove ${dir}: ${e.message}`);
    return false;
  }
}
