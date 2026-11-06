import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import { planCinema } from "@/lib/catalog/cinema";
import { lengthRange } from "@/lib/catalog/clip-lengths";
import { hostedInputProblem } from "@/lib/catalog/plan";
import { clipBytesProblem, clipSizeProblem, referenceClipsProblem, referenceSeconds } from "@/lib/catalog/clip-windows";
import { clipBlocker } from "@/lib/composer";

/**
 * What fal's MiniMax H3 and H3 Max Turbo endpoints take (their queue OpenAPI, read 2026-11-06): reference clips and sound
 * "2-15 seconds each, combined duration at most 15 seconds"; the Turbo extend's clip "up to 50 MB, aspect ratio between 0.4
 * and 2.5"; Turbo's text- and image-to-video any duration from 0.92 to 15 s.
 */
const refs = getModel("minimax-h3-max-turbo-refs")!;
const ext = getModel("minimax-h3-max-turbo-extend")!;
const h3 = getModel("minimax-h3")!;

describe("MiniMax H3 and H3 Max Turbo windows", () => {
  it("holds reference clips and sound to 2–15 s each and 15 s of each kind", () => {
    for (const m of [refs, h3]) {
      expect(referenceClipsProblem(m, "videos", [5, 3, 3])).toBeNull();
      expect(referenceClipsProblem(m, "videos", [1])).toMatch(/^Reference clip 1 is 1 s, and .* needs at least 2 s/);
      expect(referenceClipsProblem(m, "videos", [8, 8])).toMatch(/add up to 16 s, and .* takes 15 s of them together/);
      expect(referenceClipsProblem(m, "audios", [16])).toMatch(/^Sound clip 1 is 16 s, and .* takes up to 15 s/);
      expect(referenceClipsProblem(m, "audios", [undefined, 3])).toBeNull();
    }
    // The extend takes sound references only; its source clip has a window of its own (clipWindowProblem).
    expect(referenceClipsProblem(ext, "audios", [1])).toMatch(/at least 2 s/);
    expect(referenceClipsProblem(ext, "videos", [1])).toBeNull();
    expect(referenceSeconds("minimax-h3-max-turbo")).toBeUndefined();
  });

  it("takes an extend's clip up to 50 MB and 0.4–2.5 times as wide as it is tall", () => {
    expect(clipSizeProblem(ext, 1280, 720)).toBeNull();
    expect(clipSizeProblem(ext, 720, 1280)).toBeNull();
    expect(clipSizeProblem(ext, 2560, 1080)).toBeNull();
    expect(clipSizeProblem(ext, 900, 300)).toMatch(/0\.4:1 \(tall\) to 2\.5:1 \(wide\), and this one is 900×300: crop it first/);
    expect(clipSizeProblem(ext, 300, 900)).toMatch(/crop it first/);
    expect(clipBytesProblem(ext, 20e6)).toBeNull();
    expect(clipBytesProblem(ext, undefined)).toBeNull();
    expect(clipBytesProblem(ext, 60e6)).toMatch(/up to 50 MB, and this one is 60 MB/);
    // Other models keep what they had: Kling 4.0's frame, nothing for the references model.
    expect(clipSizeProblem(refs, 900, 300)).toBeNull();
    expect(clipBytesProblem(refs, 60e6)).toBeNull();
    expect(clipSizeProblem(getModel("kling-4")!, 600, 600)).toMatch(/at least 700 px/);
  });

  it("the Extend studio stops a 3:1 clip on the Turbo extend before Generate", () => {
    expect(clipBlocker("extend", { width: 900, height: 300, duration: 5, fps: 24 }, {}, ext, undefined)).toMatch(/crop it first/);
    expect(clipBlocker("extend", { width: 1280, height: 720, duration: 5, fps: 24 }, {}, ext, undefined)).toBeNull();
  });

  it("Cinema asks Turbo for the seconds picked: fal takes any length up to 15 s", () => {
    expect(lengthRange(getModel("minimax-h3-max-turbo"))).toEqual([1, 15]);
    const take = (duration: number) =>
      planCinema({ engine: "cloud", mode: "video", action: "generate", modelId: "minimax-h3-max-turbo", prompt: "A slow push-in on her face", settings: {}, duration } as never, {}).steps[0].request.params?.duration;
    expect([4, 7, 9, 14, 15, 20].map(take)).toEqual([4, 7, 9, 14, 15, 15]);
  });

  // Skipped until scripts/gen-cloud-models.py gives minimax-h3 options.maxReferences 12 (a generator change).
  it.skip("MiniMax H3 holds its references to 12 files in all, as Turbo does (fal: \"must add up to at most 12 files\")", () => {
    const n = (k: number) => Array.from({ length: k }, (_, i) => `https://x/${i}.png`);
    const req = { inputs: { images: n(9), videos: n(3).map((u) => u.replace(".png", ".mp4")), audios: ["https://x/a.wav"] } };
    for (const m of [h3, refs]) expect(hostedInputProblem(m, "ref2v", "Image 1 dances", {}, req)).toMatch(/up to 12 references in all .* this run has 13: remove 1/);
    expect(hostedInputProblem(h3, "ref2v", "Image 1 dances", {}, { inputs: { images: n(9), videos: n(3) } })).toBeNull();
  });
});
