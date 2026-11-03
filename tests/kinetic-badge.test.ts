import { describe, expect, it } from "vitest";
import { badgeSpot, discCover, outlinePoints } from "@/lib/motion/scenes/marketing/kit";
import type { Outline } from "@/lib/motion/scene";

// A bottle traced on a 100 × 200 grid: a narrow cap on a round body.
const BOTTLE: Outline = { w: 100, h: 200, d: "M50 200L10 180L5 120L20 80L40 70L40 20L60 20L60 70L80 80L95 120L90 180Z", length: 600, start: [50, 200] };

describe("a badge beside a product", () => {
  it("keeps clear of the product (cap included) by 2 % of the short side whenever its bounds leave the room", () => {
    const S = 1080;
    for (const img of [
      { x: 100, y: 300, w: 300, h: 600 },
      { x: 80, y: 120, w: 420, h: 840 },
      { x: 300, y: 500, w: 200, h: 400 },
    ]) {
      const bounds = { x: 76, y: 100, w: 928, h: 1200 };
      const spot = badgeSpot(img, BOTTLE, S * 0.2, bounds, 0.75);
      const pts = outlinePoints(BOTTLE, img);
      expect(discCover(pts, spot.cx, spot.cy, spot.r + S * 0.02), JSON.stringify(img)).toBe(0);
      // Inside its bounds.
      expect(spot.cx - spot.r).toBeGreaterThanOrEqual(bounds.x - 1e-6);
      expect(spot.cx + spot.r).toBeLessThanOrEqual(bounds.x + bounds.w + 1e-6);
    }
  });

  it("without an outline, stands beside the picture when the bounds leave room", () => {
    const img = { x: 100, y: 300, w: 300, h: 600 };
    const spot = badgeSpot(img, null, 150, { x: 76, y: 100, w: 928, h: 1200 });
    expect(spot.cx - spot.r).toBeGreaterThanOrEqual(img.x + img.w);
    expect(spot.cover).toBe(0);
  });
});
