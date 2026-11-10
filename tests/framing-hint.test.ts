import { describe, expect, it } from "vitest";
import { framingLabel, framingSuggestion, sizeK, widePersonPrompt } from "@/lib/framing-hint";

// The Image studio's framing tip: a wide scene with a person in it, asked as a small square, gets a one-tap 16:9 at a
// larger size. It never shows for a close framing, a scene with nobody in it, or a frame that is already wide or large.

const DUNE = "Aerial shot of a fashion model in flowing saffron silk standing on the crest of a vast Sahara dune at sunrise, long ripples of sand glowing gold around her.";
const ASPECTS = ["1:1", "4:3", "3:4", "16:9", "9:16"];
const SIZES = ["1K", "1.5K", "2K"];
const tip = (prompt: string, aspect = "1:1", resolution: string | undefined = "1K", aspects: string[] | null = ASPECTS, resolutions: string[] | null = SIZES) =>
  framingSuggestion({ prompt, aspect, resolution, aspects, resolutions });

describe("widePersonPrompt", () => {
  it("finds a wide or full-length scene with a person in it", () => {
    for (const p of [
      DUNE,
      "Wide shot of a woman walking across a salt flat",
      "Full body photo of a model in a red gown on a marble staircase",
      "full-length look, a man in a linen suit",
      "Drone view of a surfer on a turquoise wave",
      "A bride standing on a cliff above the sea at dusk",
      "She walks along the ridge of a dune, the sun low",
      "Head to toe editorial of a dancer on a rooftop",
    ])
      expect(widePersonPrompt(p), p).toBe(true);
  });

  it("leaves close framings, empty scenes and plain prompts alone", () => {
    for (const p of [
      "",
      "Close-up portrait of a woman on the beach at golden hour",
      "Headshot of a man, mountains soft behind him",
      "Aerial view of a vast desert at sunrise",
      "Product shot of a matte black perfume bottle on wet volcanic rock",
      "A koi pond at night, neon rain",
      "Editorial portrait of a woman in a yellow raincoat",
      "the theme of the shot is a landscape",
    ])
      expect(widePersonPrompt(p), p).toBe(false);
  });

  it("lets the wide words win over a close word", () => {
    expect(widePersonPrompt("Full body portrait of a model in a white suit")).toBe(true);
  });
});

describe("framingSuggestion", () => {
  it("offers 16:9 at 2K for the dune shot as a 1K square", () => {
    const fix = tip(DUNE);
    expect(fix).toEqual({ aspectRatio: "16:9", resolution: "2K" });
    expect(framingLabel(fix!)).toBe("Use 16:9 · 2K");
  });

  it("offers it for a 1.5K square too, and only the shape when no larger size is offered", () => {
    expect(tip(DUNE, "1:1", "1.5K")).toEqual({ aspectRatio: "16:9", resolution: "2K" });
    expect(tip(DUNE, "1:1", "1K", ASPECTS, null)).toEqual({ aspectRatio: "16:9" });
    expect(tip(DUNE, "1:1", "1K", ASPECTS, ["1K"])).toEqual({ aspectRatio: "16:9" });
    expect(framingLabel({ aspectRatio: "16:9" })).toBe("Use 16:9");
  });

  it("never offers more than 2K", () => {
    expect(tip(DUNE, "1:1", "1K", ASPECTS, ["1K", "2K", "4K"])).toEqual({ aspectRatio: "16:9", resolution: "2K" });
    expect(tip(DUNE, "1:1", "1K", ASPECTS, ["1K", "1.5K"])).toEqual({ aspectRatio: "16:9", resolution: "1.5K" });
  });

  it("is quiet when the frame is already wide or large, when 16:9 isn't offered, or for another prompt", () => {
    expect(tip(DUNE, "16:9")).toBeNull();
    expect(tip(DUNE, "9:16")).toBeNull();
    expect(tip(DUNE, "1:1", "2K")).toBeNull();
    expect(tip(DUNE, "1:1", "1K", null)).toBeNull();
    expect(tip(DUNE, "1:1", "1K", ["1:1", "3:4"])).toBeNull();
    expect(tip("A koi pond at night, neon rain")).toBeNull();
    expect(tip("Close-up portrait of a woman on the beach")).toBeNull();
  });

  it("reads sizes as K", () => {
    expect(sizeK("1K")).toBe(1);
    expect(sizeK("1.5K")).toBe(1.5);
    expect(sizeK("4MP")).toBe(2);
    expect(sizeK("1024")).toBe(1);
    expect(sizeK("auto")).toBeNaN();
    expect(sizeK(undefined)).toBeNaN();
  });
});
