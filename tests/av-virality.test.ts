import { describe, expect, it } from "vitest";
import { hookSignals, hookSummary, hookTimes, loudnessSeries, lumaStats, meanDb, VIRALITY_PARITY, type HookInput } from "@/lib/av/virality";
import { getPreset } from "@/lib/catalog";

const base: HookInput = {
  duration: 20,
  width: 1080,
  height: 1920,
  motion: hookTimes(20).map((t, i) => ({ t, diff: i === 0 ? 0 : i === 6 ? 0.2 : 0.04 })),
  opening: { contrast: 0.25, brightness: 0.5 },
  faces: [
    { t: 0, count: 1 },
    { t: 1, count: 1 },
    { t: 2, count: 0 },
  ],
  text: [
    { t: 0, chars: 12 },
    { t: 1, chars: 12 },
    { t: 2, chars: 0 },
  ],
  loudness: { step: 0.1, db: [...Array(30).fill(-18), ...Array(100).fill(-20)] },
};

const verdicts = (i: HookInput) => Object.fromEntries(hookSignals(i).map((s) => [s.id, s.verdict]));

describe("virality heuristic", () => {
  it("samples the hook every quarter second, no further than the clip", () => {
    expect(hookTimes(20)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3]);
    expect(hookTimes(1)).toEqual([0, 0.25, 0.5, 0.75]);
    expect(hookTimes(0)).toEqual([0]);
  });

  it("measures luma spread and loudness", () => {
    const flat = { data: new Uint8ClampedArray([128, 128, 128, 255, 128, 128, 128, 255]) };
    expect(lumaStats(flat).contrast).toBeCloseTo(0);
    const split = { data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255]) };
    expect(lumaStats(split).brightness).toBeCloseTo(0.5);
    expect(lumaStats(split).contrast).toBeCloseTo(0.5);
    // A full-scale square wave is 0 dBFS; silence is the floor.
    const square = Float32Array.from({ length: 1600 }, (_, i) => (i % 2 ? 1 : -1));
    expect(loudnessSeries(square, 16000, 0.1)).toEqual([0]);
    expect(loudnessSeries(new Float32Array(1600), 16000, 0.1)).toEqual([-100]);
    expect(meanDb([-20, -20])).toBeCloseTo(-20);
    expect(meanDb([])).toBeNull();
  });

  it("a moving, captioned, talking vertical opening is strong on every signal", () => {
    const v = verdicts(base);
    expect(v).toEqual({ motion: "strong", change: "strong", faces: "strong", text: "strong", sound: "strong", contrast: "strong", format: "strong" });
    const change = hookSignals(base).find((s) => s.id === "change")!;
    expect(change.at).toBe(1.5);
    expect(hookSummary(hookSignals(base))).toEqual({ strong: 7, ok: 0, weak: 0, unknown: 0 });
  });

  it("flags a still, silent, flat landscape opening", () => {
    const v = verdicts({
      ...base,
      width: 1920,
      height: 1080,
      motion: base.motion.map((m) => ({ ...m, diff: 0.002 })),
      opening: { contrast: 0.05, brightness: 0.4 },
      faces: [{ t: 0, count: 0 }],
      text: [{ t: 0, chars: 0 }],
      loudness: { step: 0.1, db: [...Array(12).fill(-80), ...Array(40).fill(-20)] },
    });
    expect(v).toEqual({ motion: "weak", change: "weak", faces: "weak", text: "weak", sound: "ok", contrast: "weak", format: "weak" });
    const late = hookSignals({ ...base, loudness: { step: 0.1, db: Array(40).fill(-80) } }).find((s) => s.id === "sound")!;
    expect(late.verdict).toBe("weak");
    expect(late.detail).toMatch(/Silent for the first 3 s/);
  });

  it("says 'not measured' instead of guessing when the browser can't detect", () => {
    const signals = hookSignals({ ...base, faces: null, text: null, loudness: { error: "unreadable" } });
    const unknown = signals.filter((s) => s.verdict === "unknown").map((s) => s.id);
    expect(unknown).toEqual(["faces", "text", "sound"]);
    expect(signals.find((s) => s.id === "faces")!.detail).toBe("This browser has no face detector");
    expect(hookSignals(base).find((s) => s.id === "sound")!.detail).toBe("Sound from 0.0 s · opening \u221218 dBFS · after \u221220 dBFS");
    expect(hookSignals({ ...base, loudness: { error: "no-audio" } }).find((s) => s.id === "sound")!.verdict).toBe("weak");
  });

  it("a later face or a quieter opening is only 'fine'", () => {
    const v = verdicts({ ...base, faces: [{ t: 2, count: 2 }], loudness: { step: 0.1, db: [...Array(10).fill(-80), ...Array(20).fill(-40), ...Array(50).fill(-12)] } });
    expect(v.faces).toBe("ok");
    expect(v.sound).toBe("ok");
  });

  it("shows no score anywhere", () => {
    for (const s of hookSignals(base)) expect(`${s.detail} ${s.tip ?? ""}`).not.toMatch(/score|viral|\/ ?100/i);
    expect(`${VIRALITY_PARITY.title} ${VIRALITY_PARITY.lead}`).not.toMatch(/score|\/ ?100/i);
  });

  it("the app that used to be Virality Predictor is the Hook Frame step (old generations still find it)", () => {
    expect(getPreset("app-virality-predictor")?.id).toBe("app-hook-frame");
    expect(getPreset("app-hook-frame")?.name).toBe("Hook Frame");
  });
});
