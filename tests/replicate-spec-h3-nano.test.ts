import { describe, expect, it } from "vitest";
import { tempDir } from "./helpers/temp-dir";

/**
 * Replicate routes checked against the models' own API pages (read 2026-11-06), with pure functions only (no key, no call):
 * - minimax/h3-lite and minimax/h3-highspeed: "Reference audio needs to be combined with a reference image or video", and
 *   reference_image_urls / reference_video_urls / reference_audio_urls are "Public URLs" (plain strings, not file fields).
 * - google/nano-banana-pro: aspect_ratio is one of match_input_image, 1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
 *   (no "auto"; its default, match_input_image, follows the input picture).
 */

process.env.FUOBE_DATA_DIR = tempDir("fuobe-replicate-spec-");

const { getModel, getPreset } = await import("@/lib/catalog");
const { planGeneration } = await import("@/lib/catalog/plan");
const { buildPayload } = await import("@/lib/catalog/payload");
type Req = import("@/lib/catalog/types").GenerationRequest;

const IMG = "https://example.com/a.png";
const CLIP = "https://example.com/a.mp4";
const VOICE = "https://example.com/a.mp3";
const NANO_REPLICATE_RATIOS = ["match_input_image", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];

describe("H3 Lite and HighSpeed references on Replicate", () => {
  const plan = (modelId: string, inputs: Req["inputs"]) => planGeneration({ feature: "video", modelId, prompt: "Image 1 sings", inputs } as Req, getModel, getPreset);
  for (const [id, name] of [
    ["minimax-h3-lite", "MiniMax H3 Lite"],
    ["minimax-h3-highspeed", "MiniMax H3 HighSpeed"],
  ] as const) {
    it(`${name}: sound clips go with a picture or a clip, never alone`, () => {
      expect(() => plan(id, { audios: [VOICE] })).toThrow(`${name} uses sound clips together with a reference picture or clip: add one of those too`);
      expect(() => plan(id, { audios: [VOICE, VOICE] })).toThrow(/together with a reference picture or clip/);
      expect(plan(id, { images: [IMG], audios: [VOICE] }).op).toBe("ref2v");
      expect(plan(id, { videos: [CLIP], audios: [VOICE] }).op).toBe("ref2v");
      expect(plan(id, { images: [IMG, IMG] }).op).toBe("ref2v");
    });

    it(`${name}: only the reference route asks for public links`, () => {
      const routes = getModel(id)!.routes;
      expect(routes.filter((r) => r.map?.publicLinks).map((r) => r.op)).toEqual(["ref2v"]);
      const refs = routes.find((r) => r.op === "ref2v")!.map!;
      expect([refs.images, refs.videos, refs.audios]).toEqual(["reference_image_urls", "reference_video_urls", "reference_audio_urls"]);
    });
  }

  it("the rule is theirs alone: fal's H3 Max Turbo references take sound on its own", () => {
    expect(plan("minimax-h3-max-turbo-refs", { audios: [VOICE] }).op).toBe("ref2v");
  });
});

describe("Nano Banana Pro's shape on Replicate", () => {
  const routes = getModel("nano-banana-pro")!.routes;
  const on = (provider: string, op: string) => routes.find((r) => r.provider === provider && r.op === op)!;
  const payload = (provider: string, op: string, aspectRatio: string, images: string[] = []) =>
    buildPayload(on(provider, op).map ?? {}, { prompt: "a quiet harbour at dawn", images, aspectRatio, resolution: "1K" } as never);

  it("Auto leaves aspect_ratio out on Replicate (its default follows the input), and stays auto on fal", () => {
    for (const op of ["t2i", "edit"]) {
      const sent = payload("replicate", op, "auto", op === "edit" ? [IMG] : []);
      expect(sent).not.toHaveProperty("aspect_ratio");
      expect(sent.resolution).toBe("1K");
    }
    expect(payload("fal", "t2i", "auto").aspect_ratio).toBe("auto");
    expect(payload("fal", "edit", "auto", [IMG]).aspect_ratio).toBe("auto");
  });

  it("every shape the studio offers goes to Replicate as one it takes", () => {
    for (const ratio of getModel("nano-banana-pro")!.options.aspectRatios ?? []) {
      for (const op of ["t2i", "edit"]) {
        const sent = payload("replicate", op, ratio, op === "edit" ? [IMG] : []);
        if (ratio === "auto") expect(sent).not.toHaveProperty("aspect_ratio");
        else expect(NANO_REPLICATE_RATIOS).toContain(sent.aspect_ratio);
      }
    }
  });
});
