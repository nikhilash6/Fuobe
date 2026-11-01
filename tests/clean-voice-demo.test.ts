import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CleanVoiceDemo } from "@/components/audio-tools/clean-voice-demo";
import {
  AUTO_AT,
  AUTO_FADE,
  DEMO_MEDIA,
  DEMO_START,
  demoReducer,
  gainsFor,
  HINTS,
  isRunning,
  playLabel,
  SWITCH_RAMP,
  type DemoEvent,
  type DemoState,
} from "@/lib/av/clean-voice-demo";

/*
 * Clean up voice's demo (src/lib/av/clean-voice-demo.ts, src/components/audio-tools/clean-voice-demo.tsx): the room plays
 * first and goes by itself at 3 s; a choice switches at once and stops the automatic switch; Play again tells it all again.
 */

const run = (...events: DemoEvent[]) => events.reduce<DemoState>(demoReducer, DEMO_START);
const tap: DemoEvent = { type: "tap" };
const started: DemoEvent = { type: "started" };
const at = (t: number): DemoEvent => ({ type: "time", t });

describe("the demo's story", () => {
  it("starts on the room, with the automatic switch to come", () => {
    const s = run(tap);
    expect(s).toMatchObject({ phase: "loading", clean: false, auto: true, run: 1 });
    expect(playLabel(s)).toBe("Loading…");
    expect(run(tap, started)).toMatchObject({ phase: "playing", clean: false, hint: HINTS.story });
    expect(gainsFor(false)).toEqual([1, 0]);
  });

  it("takes the noise away by itself at 3 s, fading over 1 s, and shows Noise removed once", () => {
    expect(run(tap, started, at(AUTO_AT - 0.01))).toMatchObject({ clean: false, flash: 0 });
    const s = run(tap, started, at(AUTO_AT));
    expect(s).toMatchObject({ clean: true, auto: false, ramp: AUTO_FADE, flash: 1, hint: HINTS.auto });
    expect(gainsFor(true)).toEqual([0, 1]);
    // Later ticks change nothing (the same state, so nothing renders again).
    expect(demoReducer(s, at(AUTO_AT + 1))).toBe(s);
  });

  it("doesn't switch while paused, and switches after resuming", () => {
    const paused = run(tap, started, tap);
    expect(paused.phase).toBe("paused");
    expect(playLabel(paused)).toBe("Resume");
    expect(demoReducer(paused, at(AUTO_AT + 0.5)).clean).toBe(false);
    expect(run(tap, started, tap, tap, at(AUTO_AT)).clean).toBe(true);
  });

  it("cancels the automatic switch when a choice is made", () => {
    const s = run(tap, started, { type: "choose", clean: false });
    expect(s).toMatchObject({ clean: false, auto: false, ramp: SWITCH_RAMP, hint: HINTS.room });
    expect(demoReducer(s, at(AUTO_AT + 1))).toBe(s);
    expect(run(tap, started, { type: "choose", clean: true })).toMatchObject({ clean: true, auto: false, ramp: SWITCH_RAMP, flash: 0, hint: HINTS.voice });
    // After the automatic switch, Noise on puts the room back in a quick ramp.
    expect(run(tap, started, at(AUTO_AT), { type: "choose", clean: false })).toMatchObject({ clean: false, ramp: SWITCH_RAMP });
  });

  it("starts in the mode chosen before playing, with no automatic switch", () => {
    const off = run({ type: "choose", clean: true });
    expect(off).toMatchObject({ phase: "loading", clean: true, auto: false, run: 1 });
    expect(demoReducer(off, started)).toMatchObject({ phase: "playing", hint: HINTS.voice });
    const on = run({ type: "choose", clean: false }, started, at(AUTO_AT + 2));
    expect(on).toMatchObject({ phase: "playing", clean: false, flash: 0, hint: HINTS.room });
    // A choice while the clips load sets the mode they start in.
    expect(run(tap, { type: "choose", clean: true }, started, at(AUTO_AT))).toMatchObject({ clean: true, auto: false, run: 1, flash: 0 });
  });

  it("ends on Play again, which tells the whole story again", () => {
    const done = run(tap, started, at(AUTO_AT), { type: "ended" });
    expect(done).toMatchObject({ phase: "done", hint: HINTS.done });
    expect(playLabel(done)).toBe("Play again");
    expect(isRunning(done)).toBe(false);
    const again = demoReducer(done, tap);
    expect(again).toMatchObject({ phase: "loading", clean: false, auto: true, run: 2 });
    expect(run(tap, started, at(AUTO_AT), { type: "ended" }, tap, started, at(AUTO_AT))).toMatchObject({ clean: true, flash: 2 });
    // A choice after the end plays again in that mode.
    expect(demoReducer(done, { type: "choose", clean: false })).toMatchObject({ phase: "loading", clean: false, auto: false, run: 2 });
  });

  it("ignores taps while loading, and offers to try again when the sound doesn't load", () => {
    const loading = run(tap);
    expect(demoReducer(loading, tap)).toBe(loading);
    const failed = demoReducer(loading, { type: "failed" });
    expect(failed).toMatchObject({ phase: "failed", hint: HINTS.failed });
    expect(playLabel(failed)).toBe("Tap to try again");
    expect(demoReducer(failed, tap)).toMatchObject({ phase: "loading", run: 2 });
  });
});

describe("the demo page", () => {
  it("renders the stage before anything plays: the room, Tap to listen, Noise on pressed", () => {
    const html = renderToStaticMarkup(createElement(CleanVoiceDemo));
    expect(html).toContain("Hear her, not the room.");
    expect(html).toContain(`src="${DEMO_MEDIA.room}"`);
    expect(html).toContain(`src="${DEMO_MEDIA.quiet}"`);
    expect(html).toContain("Tap to listen");
    expect(html).toContain("Busy brasserie");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Noise on</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>Noise off</);
    expect(html).toContain(HINTS.ready);
    expect(html).toContain("min-h-11");
    expect(html).toContain("motion-reduce:transition-none");
  });

  it("ships its pictures and two 8 s clips of the same length", () => {
    const pub = path.resolve(__dirname, "..", "public");
    for (const f of Object.values(DEMO_MEDIA)) expect(fs.existsSync(path.join(pub, f)), f).toBe(true);
    for (const f of [DEMO_MEDIA.noisy, DEMO_MEDIA.clean]) {
      const file = path.join(pub, f);
      expect(fs.statSync(file).size).toBeLessThan(200_000);
      let probe: string;
      try {
        probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels:format=duration", "-of", "compact=p=0", file], { encoding: "utf8" });
      } catch {
        continue; // no ffprobe on this machine
      }
      expect(probe).toMatch(/codec_name=aac\|sample_rate=48000\|channels=1/);
      expect(Number(/duration=([\d.]+)/.exec(probe)?.[1])).toBeCloseTo(8, 1);
    }
  });
});
