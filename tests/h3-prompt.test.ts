import { describe, expect, it } from "vitest";
import { alignFrames } from "@/lib/catalog/character-swap";
import { H3_DEFAULT_SOUND, h3Canvas, h3Frames, h3Prompt, inH3Layout, isH3Graph } from "@/lib/h3-prompt";

// MiniMax H3 on your GPU: the layout its prompting guide gives (an alignment line for the reference frames, then the shot,
// the soundscape and the music fields), its canvas and its 17n + 5 frame grid at 24 fps.

const I2V_LINE = "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.";

describe("h3Prompt", () => {
  it("image to video: the start frame's alignment line, then the three fields", () => {
    expect(h3Prompt("A woman turns to the camera and smiles", "i2v", 124)).toBe(
      [
        I2V_LINE,
        "integrated_multimodal_description: [Shot 1] A woman turns to the camera and smiles",
        `overall_soundscape: ${H3_DEFAULT_SOUND}`,
        "non_diegetic_music: N/A",
      ].join("\n\n"),
    );
  });

  it("start and end frames: the end frame at the clip's length on H3's grid (5 s → 124 frames → 5.17 s)", () => {
    const p = h3Prompt("The candle melts into a pool of wax", "flf2v", h3Frames(5));
    expect(p.split("\n\n")[0]).toBe(
      "How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) aligns with the 5.17-second mark of the target video.",
    );
    expect(h3Prompt("x", "flf2v", h3Frames(10))).toContain("the 10.13-second mark");
    expect(h3Prompt("x", "flf2v", h3Frames(15))).toContain("the 15.08-second mark");
    // A count off the grid is read as the node makes it (rounded up to 17n + 5).
    expect(h3Prompt("x", "flf2v", 120)).toContain(`the ${(alignFrames(120) / 24).toFixed(2)}-second mark`);
  });

  it("text to video: no alignment line", () => {
    const p = h3Prompt("A paper boat drifts down a rain-soaked gutter", "t2v", 124);
    expect(p.startsWith("integrated_multimodal_description: [Shot 1] A paper boat drifts")).toBe(true);
    expect(p).not.toMatch(/Picture 1|target video/);
  });

  it("names the sound when it's given, and trims the words", () => {
    const p = h3Prompt("  Waves roll onto the beach  ", "t2v", 124, "Surf and gulls.");
    expect(p).toContain("integrated_multimodal_description: [Shot 1] Waves roll onto the beach\n\n");
    expect(p).toContain("overall_soundscape: Surf and gulls.");
  });

  it("rebuilds the alignment line when a stored prompt runs at another length or operation", () => {
    const own = "integrated_multimodal_description: [Shot 1] The candle melts\n\noverall_soundscape: A soft hiss.\n\nnon_diegetic_music: N/A";
    const fiveSeconds = h3Prompt("The candle melts", "flf2v", 124, "A soft hiss.");
    expect(fiveSeconds).toContain("aligns with the 5.17-second mark");
    // Reused at 10 s: the end frame moves to the new length, once.
    const tenSeconds = h3Prompt(fiveSeconds, "flf2v", 243);
    expect(tenSeconds).toBe(h3Prompt("The candle melts", "flf2v", 243, "A soft hiss."));
    expect(tenSeconds.match(/aligns with the/g)).toHaveLength(2);
    expect(tenSeconds).not.toContain("5.17");
    // Reused from a start frame alone, or as text to video: the line follows the operation.
    expect(h3Prompt(fiveSeconds, "i2v", 124)).toBe(h3Prompt("The candle melts", "i2v", 124, "A soft hiss."));
    expect(h3Prompt(fiveSeconds, "t2v", 124)).toBe(own);
    expect(h3Prompt(h3Prompt("The candle melts", "i2v", 124, "A soft hiss."), "flf2v", 362)).toContain("aligns with the 15.08-second mark");
  });

  it("keeps words already in the layout, with this run's alignment line (a reused run is not wrapped twice)", () => {
    const once = h3Prompt("A dancer spins", "i2v", 124);
    expect(inH3Layout(once)).toBe(true);
    expect(h3Prompt(once, "i2v", 124)).toBe(once);
    const own = "integrated_multimodal_description: [Shot 1] A dancer spins\n\noverall_soundscape: Applause.\n\nnon_diegetic_music: N/A";
    expect(h3Prompt(own, "t2v", 124)).toBe(own);
  });

  it("names only what is wanted: no negation in the default soundscape or the layout's own words", () => {
    const layout = [h3Prompt("A", "i2v", 124), h3Prompt("A", "flf2v", 124), h3Prompt("A", "t2v", 124)].join(" ").replace(/\bA\b/g, "");
    for (const words of [H3_DEFAULT_SOUND, layout]) expect(words).not.toMatch(/\b(no|not|never|without|avoid|don't|none)\b/i);
  });
});

describe("H3's frame grid and canvas", () => {
  it("3, 5, 10 and 15 s land on 73, 124, 243 and 362 frames (17n + 5 at 24 fps)", () => {
    expect([3, 5, 10, 15].map(h3Frames)).toEqual([73, 124, 243, 362]);
    for (const f of [73, 124, 243, 362]) expect(f % 17).toBe(5);
  });

  it("sizes the canvas as ComfyUI's adapt_canvas: 768 on the short side, at most 768 × 1344, multiples of 32", () => {
    expect(h3Canvas("16:9")).toEqual({ width: 1344, height: 768 });
    expect(h3Canvas("4:3")).toEqual({ width: 1024, height: 768 });
    expect(h3Canvas("1:1")).toEqual({ width: 768, height: 768 });
    expect(h3Canvas("9:16")).toEqual({ width: 768, height: 1344 });
    expect(h3Canvas("3:4")).toEqual({ width: 768, height: 1024 });
    // A still's own size gives its shape; no shape is 16:9.
    expect(h3Canvas("1600:1200")).toEqual({ width: 1024, height: 768 });
    expect(h3Canvas("1080:1920")).toEqual({ width: 768, height: 1344 });
    expect(h3Canvas(undefined)).toEqual({ width: 1344, height: 768 });
    expect(h3Canvas("auto")).toEqual({ width: 1344, height: 768 });
    for (const shape of ["21:9", "2:3", "5:4", "1920:1080", "777:333"]) {
      const { width, height } = h3Canvas(shape);
      expect(width % 32, shape).toBe(0);
      expect(height % 32, shape).toBe(0);
      expect(width * height, shape).toBeLessThanOrEqual(768 * 1344 + 32 * 1344);
    }
  });

  it("knows the H3 video graphs by their id", () => {
    for (const id of ["minimax-h3-t2v", "minimax-h3-i2v-hq", "minimax-h3-orbit"]) expect(isH3Graph(id)).toBe(true);
    for (const id of ["video-character-swap-h3", "wan22-i2v-14b", "ltx25-t2v"]) expect(isH3Graph(id)).toBe(false);
  });
});
