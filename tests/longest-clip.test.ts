import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * The longest clip a person's run on this install's GPUs may make (queue-settings.ts longestClipS): the setting's checks,
 * the length a request is counted at, and where an untouched length starts in the pickers. The run's own answer (a
 * label before Run, Connect your GPU at Run) is in pool-limits.test.ts.
 */

process.env.FUOBE_DATA_DIR = tempDir("fuobe-longest-clip-");

const qs = await import("@/server/queue-settings");
const { clipPastLimit, requestClipSeconds } = await import("@/server/hosted");
const { hereClipStart, hereOf } = await import("@/lib/runnable-here");
const { getModel } = await import("@/lib/catalog");

describe("the setting", () => {
  it("is off unless set, takes whole seconds from 1 to 3600 or null, and keeps the other settings", () => {
    expect(qs.QUEUE_DEFAULTS.longestClipS).toBeNull();
    expect(qs.queueSettings().longestClipS).toBeNull();
    const ok = qs.checkQueuePatch({ longestClipS: 5 }, qs.QUEUE_DEFAULTS);
    expect("settings" in ok && ok.settings).toEqual({ ...qs.QUEUE_DEFAULTS, longestClipS: 5 });
    const off = qs.checkQueuePatch({ longestClipS: null }, { ...qs.QUEUE_DEFAULTS, longestClipS: 5 });
    expect("settings" in off && off.settings.longestClipS).toBeNull();
    for (const bad of [0, -5, 3601, 2.5, "5", true]) expect(qs.checkQueuePatch({ longestClipS: bad }, qs.QUEUE_DEFAULTS), String(bad)).toEqual({ error: "longestClipS is 1 to 3600 seconds, or null for no limit" });
    qs.saveQueueSettings({ ...qs.QUEUE_DEFAULTS, longestClipS: 10 });
    expect(qs.queueSettings().longestClipS).toBe(10);
    qs.saveQueueSettings(qs.QUEUE_DEFAULTS);
    expect(qs.queueSettings().longestClipS).toBeNull();
  });
});

describe("the length a request is counted at", () => {
  it("is the length asked for, else the model's default; shots made as clips of their own count their longest", () => {
    expect(requestClipSeconds({ params: { duration: 15 } }, "oss-minimax-h3", "video")).toBe(15);
    expect(requestClipSeconds({ params: {} }, "oss-minimax-h3", "video")).toBe(getModel("oss-minimax-h3")!.defaults!.duration);
    const shots = [
      { prompt: "she turns", duration: 5 },
      { prompt: "she walks", duration: 10 },
    ];
    expect(getModel("oss-ltx25")!.options.multiShot?.mode).toBe("concat");
    expect(requestClipSeconds({ params: { shots: [{ ...shots[0] }, { ...shots[1], duration: 8 }], duration: 13 } }, "oss-ltx25", "video")).toBe(8);
    // Pictures, sound, and a clip made from a clip (no length to pick) aren't counted.
    expect(requestClipSeconds({ params: { duration: 15 } }, "oss-z-image-turbo", "image")).toBe(0);
    expect(requestClipSeconds({ params: { duration: 120 } }, "oss-ace-step", "audio")).toBe(0);
    expect(requestClipSeconds({ params: { duration: 15 } }, "oss-h3-character-swap-relay", "video")).toBe(0);
  });

  it("passes the limit only past it; no limit, nothing passes", () => {
    expect(clipPastLimit({ params: { duration: 15 } }, "oss-minimax-h3", "video", 5)).toBe(5);
    expect(clipPastLimit({ params: { duration: 5 } }, "oss-minimax-h3", "video", 5)).toBeNull();
    expect(clipPastLimit({ params: { duration: 3 } }, "oss-minimax-h3", "video", 5)).toBeNull();
    expect(clipPastLimit({ params: { duration: 15 } }, "oss-minimax-h3", "video", null)).toBeNull();
  });
});

describe("where an untouched length starts in the pickers", () => {
  const status = (clipS?: number) => ({ viewer: { hosted: true, gpu: { connected: false }, ...(clipS ? { clipS } : {}) } });
  const H3_LENGTHS = getModel("oss-minimax-h3")!.options.durations!;

  it("only for a visitor whose runs go to this install's GPUs, and only with a limit set", () => {
    expect(hereOf(status(5), false)).toEqual({ rules: undefined, owner: false, clipS: 5 });
    expect(hereOf(status(), false)).toEqual({ rules: undefined, owner: false });
    // A visitor whose runs go to its own GPU, and the owner's own runs: no limit here.
    expect(hereOf({ viewer: { hosted: true, gpu: { connected: true }, clipS: 5 } }, false)).toBeNull();
    expect(hereOf({ pool: {} }, true)?.clipS).toBeUndefined();
    expect(hereClipStart(hereOf(status(), false), H3_LENGTHS, 15)).toBeUndefined();
    expect(hereClipStart(null, H3_LENGTHS, 15)).toBeUndefined();
  });

  it("is the longest of the model's own lengths within the limit, so MiniMax H3's frame grid stays whole", () => {
    expect(H3_LENGTHS).toEqual([3, 5, 10, 15]);
    const at = (limit: number, current: number) => hereClipStart(hereOf(status(limit), false), H3_LENGTHS, current);
    expect(at(5, 15)).toBe(5);
    expect(at(5, 10)).toBe(5);
    expect(at(7, 10)).toBe(5);
    expect(at(4, 5)).toBe(3);
    expect(at(12, 15)).toBe(10);
    // Already within it: it stays.
    expect(at(5, 5)).toBeUndefined();
    expect(at(10, 3)).toBeUndefined();
    // No length of the model's fits: it stays, and the price check's label says how to run it.
    expect(at(2, 5)).toBeUndefined();
  });
});
