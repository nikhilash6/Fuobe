import { describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { referenceVoiceProblem } from "@/lib/catalog/clip-windows";
import { extractOutputs } from "@/lib/catalog/payload";
import { planGeneration } from "@/lib/catalog/plan";
import type { GenerationRequest } from "@/lib/catalog/types";

/**
 * Hosted routes held to their providers' documented requests and answers (tests/fixtures/provider-schemas):
 * - fal's Vidu Q4 returns `cover_image` beside its video ("Cover image of the generated video"): one result, the video.
 * - fal's Wan 2.2 echoes `prompt` next to the video: words that look like a link are never a second result.
 * - fal's H3 Max insert returns `source`, the clip that went in: never a result.
 * - Replicate's H3 Lite and HighSpeed: "Reference audio needs to be combined with a reference image or video".
 * - fal's Vidu Q4 reference voices: "3-12 seconds each".
 */
describe("results the hosted routes answer with", () => {
  const video = { url: "https://v3b.fal.media/files/b/out.mp4", content_type: "video/mp4" };

  it("Vidu Q4's cover still is not a second result", () => {
    const answer = { video, cover_image: { url: "https://v3b.fal.media/files/b/cover.png", content_type: "image/png", width: 1024, height: 576 }, seed: 7 };
    for (const op of ["i2v", "ref2v"] as const) expect(extractOutputs(answer, op).map((o) => [o.kind, o.url])).toEqual([["video", video.url]]);
  });

  it("an echoed prompt that is only a link is not a result", () => {
    const answer = { video, prompt: "https://looks-like-a-url.example/start.png", negative_prompt: "https://x.example/n.jpg", seed: 5 };
    expect(extractOutputs(answer, "i2v").map((o) => o.url)).toEqual([video.url]);
  });

  it("H3 Max insert's source clip is not a result", () => {
    const answer = { video, source: { url: "https://v3b.fal.media/files/in/clip.mp4", width: 1280, height: 720, fps: 24, duration: 8 }, seed: 1 };
    expect(extractOutputs(answer, "insert-moment").map((o) => o.url)).toEqual([video.url]);
    expect(extractOutputs(answer, "extend").map((o) => o.url)).toEqual([video.url]);
  });
});

describe("references the hosted routes take", () => {
  const run = (modelId: string, inputs: GenerationRequest["inputs"]) => () =>
    planGeneration({ feature: "video", modelId, op: "ref2v", prompt: "Image 1 walks along the shore", inputs, params: {} }, getModel, getPreset);

  it("H3 Lite and HighSpeed refuse sound clips with no picture or clip beside them", () => {
    for (const id of ["minimax-h3-lite", "minimax-h3-highspeed"]) {
      expect(run(id, { audios: ["https://x.example/voice.mp3"] })).toThrow(/uses sound clips together with a reference picture or clip: add one of those too/);
      expect(run(id, { images: ["https://x.example/a.png"], audios: ["https://x.example/voice.mp3"] })).not.toThrow();
      expect(run(id, { videos: ["https://x.example/a.mp4"], audios: ["https://x.example/voice.mp3"] })).not.toThrow();
    }
  });

  it("Vidu Q4 holds each reference voice to 3–12 s", () => {
    const vidu = getModel("vidu-q4")!;
    expect(referenceVoiceProblem(vidu, 2, 1)).toMatch(/at least 3 s, and Voice 1 is 2 s/);
    expect(referenceVoiceProblem(vidu, 14, 2)).toMatch(/up to 12 s, and Voice 2 is 14 s/);
    for (const s of [3, 7.5, 12]) expect(referenceVoiceProblem(vidu, s)).toBeNull();
  });
});
