/**
 * Clean up voice's demo (src/components/audio-tools/clean-voice-demo.tsx): a woman talking in a busy brasserie. One tap
 * plays two 8 s takes of the same moment at once, the room as recorded and her voice alone, each through its own gain.
 * The room plays first; at 3 s the noise fades out over 1 s while she keeps talking, and the photo softens to match.
 * "Noise on" / "Noise off" switch both at the same moment in her speech and stop the automatic switch. Pure: the
 * component runs the audio, this decides what happens.
 */

export const DEMO_DIR = "/samples/clean-voice";
export const DEMO_MEDIA = {
  /** The room as recorded, and her voice alone: 8 s, 48 kHz mono AAC, the same moment, at the same gain. */
  noisy: `${DEMO_DIR}/noisy.m4a`,
  clean: `${DEMO_DIR}/clean.m4a`,
  /** The brasserie, and the same photo with the room softened and dimmed around her (1280x960). */
  room: `${DEMO_DIR}/room.webp`,
  quiet: `${DEMO_DIR}/quiet.webp`,
} as const;

/** When the noise goes by itself (seconds into the clip), how long it fades, and how fast a choice switches. */
export const AUTO_AT = 3;
export const AUTO_FADE = 1;
export const SWITCH_RAMP = 0.35;
/** How long "Noise removed" shows. */
export const FLASH_MS = 1600;

export type DemoPhase = "idle" | "loading" | "playing" | "paused" | "done" | "failed";

export interface DemoState {
  phase: DemoPhase;
  /** Hearing her voice only (the noise off). */
  clean: boolean;
  /** The automatic switch at AUTO_AT is still to come (a play of the whole story, with no choice made yet). */
  auto: boolean;
  /** Seconds the last change of `clean` ramps over. */
  ramp: number;
  /** Counts each start: a new value starts both clips from the top. */
  run: number;
  /** Counts each automatic switch: a new value shows "Noise removed". */
  flash: number;
  hint: string;
}

export type DemoEvent =
  /** The play button or the photo. */
  | { type: "tap" }
  /** "Noise on" (false) or "Noise off" (true). */
  | { type: "choose"; clean: boolean }
  /** Both clips are decoded and started. */
  | { type: "started" }
  /** The clips' clock, in seconds since they started (the automatic switch is due at AUTO_AT). */
  | { type: "time"; t: number }
  | { type: "ended" }
  | { type: "failed" };

export const HINTS = {
  ready: "Sound on. The noise goes by itself after a few seconds.",
  story: "Listen to the room.",
  voice: "Voice only.",
  room: "The room as recorded.",
  auto: "Only her voice is left. Switch back and forth any time.",
  done: "Play again to hear the room go quiet.",
  failed: "The sound didn't load. Check your connection and tap again.",
} as const;

export const DEMO_START: DemoState = { phase: "idle", clean: false, auto: true, ramp: 0, run: 0, flash: 0, hint: HINTS.ready };

/** Playing or paused: both clips exist and keep their place. */
export const isRunning = (s: DemoState) => s.phase === "playing" || s.phase === "paused";

const modeHint = (clean: boolean) => (clean ? HINTS.voice : HINTS.room);

/** Starts both clips from the top: the whole story (auto) or one mode chosen before playing. */
function start(s: DemoState, clean: boolean, story: boolean): DemoState {
  return { ...s, phase: "loading", clean, auto: story, ramp: 0, run: s.run + 1 };
}

export function demoReducer(s: DemoState, e: DemoEvent): DemoState {
  switch (e.type) {
    case "tap":
      if (s.phase === "playing") return { ...s, phase: "paused" };
      if (s.phase === "paused") return { ...s, phase: "playing" };
      if (s.phase === "loading") return s;
      return start(s, false, true);
    case "choose":
      if (isRunning(s)) return { ...s, clean: e.clean, auto: false, ramp: SWITCH_RAMP, hint: modeHint(e.clean) };
      // Still loading: the clips start in this mode.
      if (s.phase === "loading") return { ...s, clean: e.clean, auto: false, ramp: 0, hint: modeHint(e.clean) };
      return { ...start(s, e.clean, false), hint: modeHint(e.clean) };
    case "started":
      if (s.phase !== "loading") return s;
      return { ...s, phase: "playing", hint: s.auto ? HINTS.story : modeHint(s.clean) };
    case "time":
      if (s.phase !== "playing" || !s.auto || s.clean || e.t < AUTO_AT) return s;
      return { ...s, clean: true, auto: false, ramp: AUTO_FADE, flash: s.flash + 1, hint: HINTS.auto };
    case "ended":
      if (!isRunning(s)) return s;
      return { ...s, phase: "done", auto: false, hint: HINTS.done };
    case "failed":
      return { ...s, phase: "failed", auto: false, hint: HINTS.failed };
  }
}

/** The play button's words. */
export function playLabel(s: DemoState): string {
  if (s.phase === "loading") return "Loading…";
  if (s.phase === "paused") return "Resume";
  if (s.phase === "done") return "Play again";
  if (s.phase === "failed") return "Tap to try again";
  return "Tap to listen";
}

/** Target gains for the room and the voice. */
export const gainsFor = (clean: boolean): [number, number] => (clean ? [0, 1] : [1, 0]);
