import { describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { hasReferenceVoiceWindow, referenceVoiceProblem } from "@/lib/catalog/clip-windows";
import { settingsShape, settingsSummary } from "@/lib/composer";
import { buildPayload, extractOutputs } from "@/lib/catalog/payload";
import { planGeneration, routesFor } from "@/lib/catalog/plan";
import type { GenerationRequest, Operation } from "@/lib/catalog/types";

/**
 * fal's Vidu Q4 and Kandinsky 6.0 routes as fal's own OpenAPI schemas describe them (read 2026-11-06 from
 * https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<endpoint>). Kandinsky 6.0 from a first frame takes aspect_ratio
 * "auto" (its default: the supported ratio closest to the picture's, centre-cropped to it) or one of five; from words, one of
 * the five. Vidu Q4 answers with a cover_image (a still) next to its video, and takes reference voices of 3 to 12 s each.
 * The composer shows no shape for a first frame (src/lib/composer.ts settingsShape).
 */
const k6 = getModel("kandinsky-6")!;
const K6_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"];

function sent(op: Operation, req: Partial<GenerationRequest>) {
  const p = planGeneration({ feature: "video", modelId: k6.id, op, prompt: "she smiles and says “hi”", ...req } as GenerationRequest, getModel, getPreset);
  const route = routesFor(k6, op, p.params)[0];
  const images = op === "i2v" ? ["https://v3b.fal.media/files/b/test/start.png"] : [];
  return { endpoint: route.endpoint, body: buildPayload(route.map!, { ...p.params, prompt: p.prompt, images }) };
}

describe("Kandinsky 6.0 on fal sends the shapes fal takes", () => {
  it("keeps a first frame's own shape (aspect_ratio auto) on Pro and Lite, never the model's 16:9 default", () => {
    for (const quality of ["pro-standard", "lite-fast"]) {
      for (const params of [{}, { aspectRatio: "9:16" }]) {
        const { endpoint, body } = sent("i2v", { inputs: { images: ["/api/files/uploads/start.png"] }, params: { ...params, extra: { quality } } });
        expect(endpoint).toMatch(/^fal-ai\/kandinsky6-(pro|lite)\/image-to-video$/);
        expect(body.aspect_ratio, `${quality} ${JSON.stringify(params)}`).toBe("auto");
      }
    }
  });

  it("from words, sends the ratio asked for, and one fal doesn't take as the nearest it does", () => {
    for (const quality of ["pro-standard", "lite-fast"]) {
      for (const r of K6_RATIOS) expect(sent("t2v", { params: { aspectRatio: r, extra: { quality } } }).body.aspect_ratio).toBe(r);
      expect(sent("t2v", { params: { aspectRatio: "21:9", extra: { quality } } }).body.aspect_ratio).toBe("16:9");
    }
  });
});

describe("Vidu Q4 on fal", () => {
  it("its result is its video: the cover still fal sends with it is not a second result", () => {
    const video = "https://v3b.fal.media/files/b/0a8c9189/n9z3uUDPqmU2msAtqr25-_output.mp4";
    const body = { video: { url: video }, cover_image: { url: "https://v3b.fal.media/files/b/0a8c9189/cover.png", content_type: "image/png", width: 1280, height: 720 }, seed: 42 };
    for (const op of ["i2v", "ref2v"] as const) expect(extractOutputs(body, op).map((o) => [o.kind, o.url])).toEqual([["video", video]]);
    expect(extractOutputs({ video: { url: video }, cover_image: null, seed: 42 }, "i2v")).toHaveLength(1);
  });

  it("takes reference voices of 3 to 12 s each, and says which one is outside", () => {
    const vidu = getModel("vidu-q4")!;
    expect(hasReferenceVoiceWindow(vidu)).toBe(true);
    expect(referenceVoiceProblem(vidu, 2, 2)).toBe("Vidu Q4 needs voice clips of at least 3 s, and Voice 2 is 2 s: use a longer one");
    expect(referenceVoiceProblem(vidu, 12.9)).toBe("Vidu Q4 takes voice clips up to 12 s, and Voice 1 is 12.9 s: trim it first");
    for (const s of [3, 7.5, 12, 12.04]) expect(referenceVoiceProblem(vidu, s), `${s} s`).toBeNull();
    // Models without a window, and a header that says no length, are left alone.
    expect(hasReferenceVoiceWindow(getModel("minimax-h3-max-turbo")!)).toBe(false);
    expect(referenceVoiceProblem(getModel("minimax-h3-max-turbo")!, 1)).toBeNull();
    expect(referenceVoiceProblem(vidu, 0)).toBeNull();
  });
});

describe("Vidu Q4's sound switch", () => {
  // fal's fal-ai/vidu/q4/image-to-video has no sound field (its clips always have sound); reference-to-video has `audio`.
  const vidu = getModel("vidu-q4")!;

  it("from a first frame the switch can't change the sound, and the summary never says No audio", () => {
    const shape = settingsShape(vidu, "i2v", "video", true);
    expect(shape.audio).toBe(true);
    expect(shape.audioFixed).toBe(true);
    expect(settingsSummary(shape, { generateAudio: false }, vidu)).not.toContain("No audio");
  });

  it("from references it sends the switch, and Off reads No audio", () => {
    const shape = settingsShape(vidu, "ref2v", "video", true);
    expect(shape.audioFixed).toBe(false);
    expect(settingsSummary(shape, { generateAudio: false }, vidu)).toContain("No audio");
    const route = routesFor(vidu, "ref2v")[0];
    expect(buildPayload(route.map!, { prompt: "hi", images: ["https://x/a.png"], generateAudio: false }).audio).toBe(false);
  });
});
