import { describe, expect, it } from "vitest";
import { minVramBytesFor, needsOf, VRAM_TOLERANCE } from "@/lib/lanes";
import type { RequirementIndex } from "@/lib/gpu/types";

describe("VRAM: a card takes the lanes made for its size", () => {
  const index = {
    files: {},
    packs: {},
    workflows: { big: { core: [], packs: {}, files: [], optional: [], vramGb: 32, isolated: false, firstRun: [] }, mid: { core: [], packs: {}, files: [], optional: [], vramGb: 24, isolated: false, firstRun: [] } },
  } as unknown as RequirementIndex;
  const MiB = 2 ** 20;

  it("allows 3% under the whole GB", () => {
    expect(VRAM_TOLERANCE).toBe(0.03);
    expect(minVramBytesFor(32)).toBe(Math.round(32 * 2 ** 30 * 0.97));
    expect(minVramBytesFor(0)).toBe(0);
    const big = needsOf(index, "big")!.minVramBytes;
    // A 32 GB card reports about 31.8 GiB: it takes the 32 GB lanes. A 30 GiB card doesn't.
    expect(big <= 32_607 * MiB).toBe(true);
    expect(big <= 30 * 2 ** 30).toBe(false);
    // A 24 GB card that reports a few MB under 24 GiB takes the 24 GB lanes; a 22 GiB card doesn't.
    const mid = needsOf(index, "mid")!.minVramBytes;
    expect(mid <= 24_564 * MiB).toBe(true);
    expect(mid <= 22 * 2 ** 30).toBe(false);
  });
});
