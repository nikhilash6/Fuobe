import { afterEach, describe, expect, it, vi } from "vitest";
import { blockerFor, claimStartToken, firstMissingSlot, handoffKey, issueStartToken, startStep, withoutStart, withPreset } from "@/lib/composer";
import { startLine, type ConnectionState } from "@/lib/connections";
import { startQuotes } from "@/lib/starter-prices";
import { EDIT_STUDIO, IMAGE_STUDIO } from "@/lib/studios";

/** Home's Start runs the prompt in the studio it opens (R4-16). */

describe("the start flag", () => {
  it("is taken out of the address once used, keeping the hand-off", () => {
    expect(withoutStart("/image?prompt=a%20fox&go=1")).toBe("/image?prompt=a+fox");
    expect(withoutStart("http://localhost:3000/edit?go=1&prompt=sky#x")).toBe("http://localhost:3000/edit?prompt=sky#x");
    expect(withoutStart("/video?go=1")).toBe("/video");
    // It isn't part of the hand-off, so dropping it never rebuilds the draft.
    expect(handoffKey("prompt=a+fox&go=1")).toBe(handoffKey("prompt=a+fox"));
  });

  it("follows the picked camera motion or effect in the address, and drops it once cleared", () => {
    expect(withPreset("/video?preset=motion-fpv-drone", "motion-zoom-in")).toBe("/video?preset=motion-zoom-in");
    expect(withPreset("https://fuobe.com/video?prompt=sky&preset=motion-bullet-time#x", undefined)).toBe("https://fuobe.com/video?prompt=sky#x");
    expect(withPreset("/video", "effect-hair-style")).toBe("/video?preset=effect-hair-style");
    expect(withPreset("/video?preset=nope", undefined)).toBe("/video");
  });

  it("waits while things load, runs when nothing blocks, else explains what's missing", () => {
    expect(startStep({ settling: true, blocker: { message: "Loading models…" } })).toBe("wait");
    expect(startStep({ settling: false, blocker: null })).toBe("run");
    // Edit with a prompt and no photo: the blocker names the slot, which the toast points at.
    const missing = firstMissingSlot(EDIT_STUDIO.slots, {});
    const blocker = blockerFor({ model: true, missing, uploading: false, promptMissing: false });
    expect(blocker).toEqual({ message: "Add an image", slot: "image" });
    expect(startStep({ settling: false, blocker })).toBe("explain");
    // Image needs nothing but the prompt.
    expect(firstMissingSlot(IMAGE_STUDIO.slots, {})).toBeUndefined();
  });

  it("says what Start runs and costs in each mode, and which providers host it", () => {
    const q = startQuotes();
    expect(q.image).toEqual({
      cloud: { name: "Nano Banana Pro", price: expect.stringMatching(/^about \$[\d.]+ an image$/), providers: expect.arrayContaining(["fal", "replicate"]) },
      open: { name: expect.any(String), providers: ["comfyui"] },
    });
    expect(q.video.cloud?.price).toMatch(/^about \$[\d.]+ a 5 s clip$/);
    expect(q.video.cloud?.providers).not.toContain("replicate");
    expect(q.edit.cloud?.price).toMatch(/an edit$/);
  });
});

describe("the start token", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("runs only the Start this tab's Home pressed, once", () => {
    const token = issueStartToken();
    expect(token).toMatch(/^[a-z0-9]{10,}$/);
    // A link from another site carries go=1, or a guess: it only prefills.
    expect(claimStartToken("1")).toBe(false);
    // That try used the token up as well.
    expect(claimStartToken(token)).toBe(false);
    const next = issueStartToken();
    expect(next).not.toBe(token);
    expect(claimStartToken(next)).toBe(true);
    // Reload, Back, or the same address pasted again: nothing runs.
    expect(claimStartToken(next)).toBe(false);
    expect(claimStartToken(null)).toBe(false);
  });

  it("survives a full page load in the same tab (sessionStorage), not a new tab", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
    const token = issueStartToken();
    expect(store.get("fuobe:start")).toBe(token);
    expect(claimStartToken(token)).toBe(true);
    expect(store.has("fuobe:start")).toBe(false);
  });
});

describe("the line under Home's composer", () => {
  const q = startQuotes();
  const state = (configured: string[], extra: Partial<ConnectionState> = {}): ConnectionState => ({
    providers: Object.fromEntries(["fal", "replicate", "comfyui", "llm"].map((p) => [p, { configured: configured.includes(p) }])),
    engineMode: "both",
    demoMode: "auto",
    ...extra,
  });

  it("names the paid model and its price when a key for one of its providers is set", () => {
    expect(startLine(state(["fal"]), q.video, "cloud", "video")?.text).toMatch(/^Start runs MiniMax H3 · about \$0\.30 a 5 s clip$/);
    expect(startLine(state(["replicate"]), q.image, "cloud", "image")?.text).toMatch(/^Start runs Nano Banana Pro · about/);
    expect(startLine(state(["fal"]), q.edit, "cloud", "edit")?.text).toMatch(/^Start runs Nano Banana Pro after you add the photo · /);
  });

  it("says it's a demo when the key set is for a provider that doesn't host the model", () => {
    // Only Replicate: hosted MiniMax H3 is on fal.ai alone.
    expect(startLine(state(["replicate"]), q.video, "cloud", "video")).toEqual({ text: "MiniMax H3 needs a fal.ai key, so Start runs a free demo" });
    // Demo mode off: it won't run at all.
    expect(startLine(state(["replicate"], { demoMode: "off" }), q.video, "cloud", "video")?.text).toMatch(/so Start can't run it yet$/);
    expect(startLine(state(["fal"], { demoMode: "on" }), q.image, "cloud", "image")?.text).toMatch(/Demo mode is on/);
  });

  it("offers the other engine when that one would run it for real", () => {
    expect(startLine(state(["comfyui"]), q.image, "cloud", "image")).toEqual({ text: "No paid API is connected, so Start runs a free demo", other: "open" });
    expect(startLine(state(["comfyui"]), q.image, "open", "image")?.text).toMatch(/^Start runs .+ on your GPU · Free$/);
    expect(startLine(state(["fal"]), q.image, "open", "image")).toEqual({ text: "ComfyUI isn't connected, so Start runs a free demo", other: "cloud" });
    // A Replicate key doesn't run hosted MiniMax H3, so it isn't offered for Video.
    expect(startLine(state(["replicate"]), q.video, "open", "video")).toEqual({ text: "ComfyUI isn't connected, so Start runs a free demo" });
    // Nothing connected: Home's demo notice says it instead.
    expect(startLine(state([]), q.image, "cloud", "image")).toBeNull();
  });
});
