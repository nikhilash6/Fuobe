import { describe, expect, it } from "vitest";
import { STILL_LIMITS, stillPlan, stillProblem } from "@/lib/catalog/still-limits";

const MB = 1024 * 1024;

describe("still input limits documented by fal", () => {
  it("Qwen Image 3 edit: a 4K PNG becomes a 2048 px copy without alpha", () => {
    const p = stillPlan("alibaba/qwen-image-3/edit", { width: 3840, height: 2160, bytes: 9 * MB, format: "png" });
    expect(p).toEqual({ resize: { width: 2048, height: 1152 }, flatten: true });
    expect(stillProblem("alibaba/qwen-image-3/edit", { width: 2048, height: 1152, bytes: 3 * MB, format: "jpeg" })).toBeNull();
    expect(stillProblem("alibaba/qwen-image-3/edit", { width: 3840, height: 2160, bytes: 3 * MB, format: "jpeg" })).toMatch(/2048/);
  });
  it("Qwen Image 3 edit: a small picture is enlarged to 384 px", () => {
    expect(stillPlan("alibaba/qwen-image-3/edit", { width: 300, height: 600, bytes: MB, format: "jpeg" })?.resize).toEqual({ width: 384, height: 768 });
  });
  it("Recraft Crisp takes PNG only", () => {
    expect(stillPlan("fal-ai/recraft/upscale/crisp", { width: 1024, height: 1024, bytes: MB, format: "jpeg" })).toEqual({ toFormat: "png" });
    expect(stillPlan("fal-ai/recraft/upscale/crisp", { width: 1024, height: 1024, bytes: MB, format: "png" })).toBeNull();
  });
  it("Recraft vectorize stays under 16 MP and 4096 px", () => {
    const p = stillPlan("fal-ai/recraft/vectorize", { width: 6000, height: 4000, bytes: 4 * MB, format: "jpeg" })!;
    expect(p.resize!.width).toBeLessThanOrEqual(4095);
    expect(p.resize!.width * p.resize!.height).toBeLessThan(16_000_000);
  });
  it("Seedream layerize refuses a strip thinner than 1:16", () => {
    expect(stillProblem("bytedance/seedream/v5/pro/layerize", { width: 6000, height: 300, bytes: MB, format: "png" })).toMatch(/16:1/);
  });
  it("an oversize file is written again as JPEG", () => {
    expect(stillPlan("fal-ai/bria/product-shot", { width: 2000, height: 2000, bytes: 20 * MB, format: "png" })).toEqual({ toFormat: "jpeg" });
  });
  it("endpoints with no stated limits are left alone", () => {
    expect(stillPlan("fal-ai/nano-banana-pro/edit", { width: 8000, height: 8000, bytes: 50 * MB, format: "png" })).toBeNull();
    expect(Object.keys(STILL_LIMITS).length).toBe(9);
  });
});
