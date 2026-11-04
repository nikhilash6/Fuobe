// Stop signals for the command line (bin/fuobe.mjs). Ctrl+C (SIGINT) ends a wait. A long-running command, such as
// `fuobe worker run`, also ends its own way on a stop from the system (SIGTERM), so it cleans up before it exits.

/** The signals a long-running command ends on. */
export const STOP_SIGNALS = ["SIGINT", "SIGTERM"];

/** Run `fn` on each of `signals`. Returns the function that stops listening. */
export function onSignals(fn, signals = ["SIGINT"], proc = process) {
  for (const s of signals) proc.on(s, fn);
  return () => {
    for (const s of signals) proc.off(s, fn);
  };
}
