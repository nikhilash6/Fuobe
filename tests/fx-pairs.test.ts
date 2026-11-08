import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { FX_SECTIONS } from "@/lib/fx-tools";
import { FX_PAIRS, fxPairSrc } from "@/lib/fx-pairs.generated";

const dir = (id: string) => path.join(process.cwd(), "public", "previews", "fx", id);

describe("Fuobe FX cover pairs", () => {
  it("names only FX items, and each has its before and after at both sizes, lined up", async () => {
    const items = new Set(FX_SECTIONS.flatMap((s) => s.items));
    for (const [id, pair] of Object.entries(FX_PAIRS)) {
      expect(items.has(id), id).toBe(true);
      expect(pair.v, id).toMatch(/^[0-9a-f]{8}$/);
      for (const [size, w, h, max] of [["480", 480, 360, 40_000], ["960", 960, 720, 140_000], ...(pair.hd ? ([["1440", 1440, 1080, 300_000]] as const) : [])] as const) {
        for (const side of ["before", "after"])
          for (const ext of ["webp", "avif"]) {
            const file = path.join(dir(id), `${side}.${size}.${ext}`);
            expect(fs.existsSync(file), file).toBe(true);
            expect(fs.statSync(file).size, file).toBeLessThanOrEqual(max);
            const m = await sharp(file).metadata();
            expect([m.width, m.height], file).toEqual([w, h]);
          }
      }
      if (pair.kind === "matte") expect((await sharp(path.join(dir(id), "after.480.webp")).metadata()).hasAlpha, id).toBe(true);
      if (pair.kind === "loupe") for (const f of ["before.loupe.webp", "after.loupe.webp", "before.loupe2x.webp", "after.loupe2x.webp"]) expect(fs.existsSync(path.join(dir(id), f)), `${id} ${f}`).toBe(true);
      if (pair.kind === "strip") expect((await sharp(path.join(dir(id), "strip.webp")).metadata()).width, id).toBe(480 * 6);
      if (pair.kind === "reframe") {
        expect(pair.rect?.length, id).toBe(4);
        expect((await sharp(path.join(dir(id), "wide.480.webp")).metadata()).height, id).toBe(270);
      }
      expect(fxPairSrc(id, "after.480.webp"), id).toBe(`/previews/fx/${id}/after.480.webp?v=${pair.v}`);
    }
  });
});
