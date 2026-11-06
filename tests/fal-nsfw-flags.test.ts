import { describe, expect, it } from "vitest";
import { extractOutputs, noOutputsError } from "@/lib/catalog/payload";

/**
 * fal.ai's safety checker on Z-Image Turbo (and FLUX, others): "images flagged as unsafe are returned as black images"
 * (fal-ai/z-image/turbo OpenAPI, enable_safety_checker; ZImageTurboOutput.has_nsfw_concepts: "Whether the generated images
 * contain NSFW concepts", one flag per images[i]). A flagged picture is no result.
 * Source: https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/z-image/turbo (fetched 2026-11-06).
 */
const img = (n: number) => ({ url: `https://v3b.fal.media/files/b/x/${n}.png`, content_type: "image/png", width: 896, height: 1152 });

describe("fal.ai's has_nsfw_concepts", () => {
  it("a flagged (black) picture is left out; the others are kept", () => {
    const out = extractOutputs({ images: [img(1), img(2)], has_nsfw_concepts: [true, false], seed: 7, timings: {}, prompt: "p" }, "t2i");
    expect(out.map((o) => o.url)).toEqual([img(2).url]);
  });

  it("every picture flagged: no result, and the error says the safety check stopped it", () => {
    const r = { images: [img(1)], has_nsfw_concepts: [true], seed: 7, timings: {}, prompt: "p" };
    expect(extractOutputs(r, "t2i")).toEqual([]);
    expect(noOutputsError(r)).toMatch(/safety checker flagged/i);
  });

  it("no flags set: every picture is kept (the control route's normal answer)", () => {
    const out = extractOutputs({ images: [img(1), img(2)], has_nsfw_concepts: [false, false], seed: 7, timings: {}, prompt: "p" }, "t2i");
    expect(out).toHaveLength(2);
  });
});
