/**
 * How long a ComfyUI that stopped answering counts as starting again. A portable or Easy-Install ComfyUI loads every
 * custom node before it answers, which can take minutes. Past this, the setup says that ComfyUI didn't come back. Pure.
 */
export const RESTART_WAIT_MIN = 5;
export const RESTART_WAIT_MS = RESTART_WAIT_MIN * 60_000;

/** After a minute of waiting, the panel says why it can take this long. */
export const RESTART_SLOW_MS = 60_000;

/** "45 s", "1 min 20 s", "3 min": how long ComfyUI has been quiet, as the panel says it. */
export function quietWords(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r && m < 3 ? `${m} min ${r} s` : `${m} min`;
}

/** After this long, a ComfyUI that stopped is simply not running (the setup asks to start it, as for one never seen). */
export const QUIET_FORGET_MS = 60 * 60_000;

/**
 * What the tab reports while ComfyUI is quiet: "waiting" with the whole minutes so far, then, from RESTART_WAIT_MIN
 * on, "none" with the minutes (it didn't come back). Null after an hour.
 */
export function quietFacts(quietMs: number): { comfy: "waiting" | "none"; quietMin: number } | null {
  const ms = Math.max(0, quietMs);
  if (ms >= QUIET_FORGET_MS) return null;
  return { comfy: ms < RESTART_WAIT_MS ? "waiting" : "none", quietMin: Math.floor(ms / 60_000) };
}
