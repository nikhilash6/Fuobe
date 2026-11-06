import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

process.env.FUOBE_DATA_DIR = tempDir("fuobe-marketing-fits-");

const mk = await import("@/server/marketing");
const { FORMATS, formatModels } = await import("@/lib/catalog/marketing");

/**
 * Marketing Studio says before a run when the shape or length picked is made differently (src/lib/catalog/fitted.ts),
 * with the one-tap way to what is made, or to a model in the list that makes the one picked.
 */
const photo = "/api/files/product.png";
const choices = (format: keyof typeof FORMATS) => formatModels(FORMATS[format], "cloud", { product: true, avatar: false }).filter((c) => !c.unavailable);

describe("Marketing Studio's picked shape and length", () => {
  it("a model that keeps the photo's shape says so, and offers one that makes the shape picked", () => {
    const plan = mk.planMarketing({ engine: "cloud", format: "motion-2d", modelId: "kling-o3", aspectRatio: "9:16", productImages: [photo] }, {});
    const fits = mk.pickerFits(plan, { aspectRatio: "9:16" }, choices("motion-2d"));
    expect(fits).toEqual([expect.objectContaining({ setting: "aspectRatio", asked: "9:16", switchTo: expect.objectContaining({ id: expect.any(String) }) })]);
    expect(fits[0].use).toBeUndefined();
    expect(fits[0].switchTo!.id).not.toBe("kling-o3");
    // The plan says it in its own words, once.
    expect(plan.notes.filter((n) => /Kling O3 Omni keeps your photo's shape/.test(n))).toHaveLength(1);
  });

  it("a shape the model makes as picked says nothing", () => {
    const plan = mk.planMarketing({ engine: "cloud", format: "motion-2d", modelId: "gemini-omni-flash", aspectRatio: "9:16", productImages: [photo] }, {});
    expect(mk.pickerFits(plan, { aspectRatio: "9:16" }, choices("motion-2d"))).toEqual([]);
  });

  it("a product shot model that keeps its own shape says so before the run", () => {
    const plan = mk.planMarketing({ engine: "cloud", format: "product-standalone", modelId: "bria-product-shot", aspectRatio: "9:16", productImages: [photo] }, {});
    const fits = mk.pickerFits(plan, { aspectRatio: "9:16" }, choices("product-standalone"));
    expect(fits[0]).toMatchObject({ setting: "aspectRatio", asked: "9:16" });
    expect(plan.notes.some((n) => /Bria Product Shot keeps your photo's shape/.test(n))).toBe(true);
  });
});
