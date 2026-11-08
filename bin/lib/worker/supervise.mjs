// `fuobe worker run` as started by hand or by a start file (docs/gpu-workers.md, "Install and update"): it runs the
// worker as a child process and, when the child ends for new code on disk (UPDATE_EXIT), starts it again on that code
// after a few seconds, so a planned update never waits out a start file's pause for crashes. Any other end is passed
// on as it came (0 by hand, 3 signed out, 1 a crash...), and the start file decides what follows. It reads no settings,
// opens nothing and holds no lock: the child does all of that. When this file itself changed on disk, it ends with
// UPDATE_EXIT too, so whatever started it starts it again on the new one.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UPDATE_EXIT } from "./update.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/** The child's environment says it is the child (it runs the worker itself). */
export const CHILD_ENV = "FUOBE_WORKER_CHILD";

/** The pause before the worker starts again on new code (ms). */
export const RESTART_PAUSE_MS = 3000;

/** The files this supervisor runs from: when one changes, it hands over to whatever started it. */
const OWN_FILES = [fileURLToPath(import.meta.url), path.resolve(here, "../../fuobe.mjs")];

const fileHash = (files) => {
  const h = crypto.createHash("sha256");
  for (const f of files) {
    try {
      h.update(fs.readFileSync(f));
    } catch {
      h.update("-");
    }
  }
  return h.digest("hex");
};

const clock = () => `[${new Date().toISOString().slice(11, 19)}]`;

/**
 * Run the worker in a child process and start it again on new code. `args`: the arguments after `worker run`. Returns
 * the exit code to end with. `deps` (tests): spawn, script, execPath, sleep, onStop, ownFiles, pauseMs.
 */
export async function superviseWorker(args, io, deps = {}) {
  const spawn = deps.spawn ?? (await import("node:child_process")).spawn;
  const script = deps.script ?? path.resolve(here, "../../fuobe.mjs");
  const execPath = deps.execPath ?? process.execPath;
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pauseMs = deps.pauseMs ?? RESTART_PAUSE_MS;
  const ownFiles = deps.ownFiles ?? OWN_FILES;
  const say = (line) => io.stdout.write(`${clock()} ${line}\n`);
  const started = fileHash(ownFiles);
  // Ctrl+C or a stop from the system reaches the child too (it stops its ComfyUI and ends): no new start after it.
  let stopping = false;
  const off = (deps.onStop ?? io.onStop)?.(() => {
    stopping = true;
  });
  try {
    for (;;) {
      const code = await new Promise((resolve) => {
        let child;
        try {
          child = spawn(execPath, [script, "worker", "run", ...args], { stdio: "inherit", env: { ...io.env, [CHILD_ENV]: "1" }, windowsHide: true });
        } catch {
          return resolve(1);
        }
        child.on("error", () => resolve(1));
        child.on("exit", (c) => resolve(typeof c === "number" ? c : 1));
      });
      if (code !== UPDATE_EXIT || stopping) return code;
      if (fileHash(ownFiles) !== started) {
        say("The worker's starter changed with the new code: it hands over to the start file.");
        return UPDATE_EXIT;
      }
      say(`The worker starts again on its new code in ${Math.round(pauseMs / 1000)} s.`);
      await sleep(pauseMs);
      if (stopping) return 0;
    }
  } finally {
    off?.();
  }
}
