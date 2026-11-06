import { describe, expect, it } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { buildPayload, extractOutputs, keepMatte } from "@/lib/catalog/payload";
import { planGeneration } from "@/lib/catalog/plan";
import type { GenerationRequest, ModelDef } from "@/lib/catalog/types";
import { settingsShape, settingsSummary, videoToolNote } from "@/lib/composer";
import { VIDEO_DEPTH_STUDIO, VIDEO_MATTE_STUDIO } from "@/lib/studios";

// Video tools → Remove background and Depth map, with the parity studio's options (docs/research/parity-delta-4.md §4.3):
// what to keep (SAM), Cutout video or Alpha mask, the colour map and side by side, per model and engine.

const model = (id: string) => getModel(id)!;
const map = (id: string) => model(id).routes[0].map!;
const plan = (req: Omit<GenerationRequest, "feature">) => planGeneration({ feature: "video-tools", ...req }, getModel, getPreset);
const fails = (req: Omit<GenerationRequest, "feature">) => {
  try {
    plan(req);
  } catch (e) {
    return (e as Error).message;
  }
  return null;
};
const clip = { video: "/api/files/clip.mp4" };

describe("Remove background: what to keep, cut-out or alpha mask", () => {
  it("each model says what it makes", () => {
    expect(model("bria-video-bg").options.matteOutputs).toEqual(["cutout"]);
    expect(model("birefnet-video").options.matteOutputs).toEqual(["cutout", "matte"]);
    expect(model("sam-3-1-video-mask").options).toMatchObject({ matteOutputs: ["matte"], keepsNamed: true });
    expect(model("sam-3-1-video-mask").hidden).toBeFalsy();
    expect(model("oss-video-matte-birefnet").options).toMatchObject({ promptless: true, matteOutputs: ["cutout", "matte"] });
    expect(model("oss-video-matte-sam3").options).toMatchObject({ keepsNamed: true, matteOutputs: ["cutout", "matte"] });
  });

  it("a model that makes both files makes the picker's default (the cut-out) unless asked", () => {
    const video = { video: "/api/files/clip.mp4" };
    expect(plan({ modelId: "oss-video-matte-birefnet", op: "bg-remove-video", inputs: video }).params.matteOutput).toBe("cutout");
    expect(plan({ modelId: "birefnet-video", op: "bg-remove-video", inputs: video }).params.matteOutput).toBe("cutout");
    expect(plan({ modelId: "oss-video-matte-sam3", op: "bg-remove-video", prompt: "the dog", inputs: video, params: { matteOutput: "matte" } }).params.matteOutput).toBe("matte");
    // One file only: nothing to choose.
    expect(plan({ modelId: "bria-video-bg", op: "bg-remove-video", inputs: video }).params.matteOutput).toBeUndefined();
    expect(plan({ modelId: "sam-3-1-video-mask", op: "bg-remove-video", prompt: "the dog", inputs: video }).params.matteOutput).toBeUndefined();
  });

  it("BiRefNet's alpha mask is its output_mask switch; Bria has none", () => {
    expect(buildPayload(map("birefnet-video"), { ...clip, matteOutput: "matte" })).toMatchObject({ video_url: clip.video, output_mask: true, video_output_type: "VP9 (.webm)" });
    expect(buildPayload(map("birefnet-video"), { ...clip, matteOutput: "cutout" })).toMatchObject({ output_mask: false });
    expect(buildPayload(map("birefnet-video"), clip)).not.toHaveProperty("output_mask");
    expect(buildPayload(map("bria-video-bg"), { ...clip, matteOutput: "cutout" })).toEqual({ video_url: clip.video, background_color: "Transparent", output_container_and_codec: "webm_vp9" });
  });

  it("the cut-out and the mask come back tagged, and the job keeps the one asked for", () => {
    const answer = { video: { url: "https://fal.media/cut.webm", content_type: "video/webm" }, mask_video: { url: "https://fal.media/mask.mp4", content_type: "video/mp4" } };
    const outs = extractOutputs(answer, "bg-remove-video");
    expect(outs.map((o) => [o.url, o.meta?.role])).toEqual([
      ["https://fal.media/cut.webm", "cutout"],
      ["https://fal.media/mask.mp4", "matte"],
    ]);
    expect(keepMatte(outs, "matte").map((o) => o.url)).toEqual(["https://fal.media/mask.mp4"]);
    expect(keepMatte(outs, "cutout").map((o) => o.url)).toEqual(["https://fal.media/cut.webm"]);
    // One file (Bria, SAM's mask video): kept as it is, untagged.
    const one = extractOutputs({ video: { url: "https://fal.media/only.webm" } }, "bg-remove-video");
    expect(one).toEqual([{ url: "https://fal.media/only.webm", kind: "video" }]);
    expect(keepMatte(one, "matte")).toEqual(one);
    expect(keepMatte(outs, undefined)).toHaveLength(2);
  });

  it("SAM keeps what you name: words (or clicks where its route reads them) are needed", () => {
    expect(fails({ modelId: "sam-3-1-video-mask", op: "bg-remove-video", inputs: clip })).toMatch(/Say what to keep/);
    expect(plan({ modelId: "sam-3-1-video-mask", op: "bg-remove-video", prompt: "the dog", inputs: clip }).prompt).toBe("the dog");
    // Remove object's tracker sends clicked points without words.
    expect(fails({ modelId: "sam-3-1-video-mask", op: "bg-remove-video", inputs: clip, params: { points: [{ x: 5, y: 5 }] } })).toBeNull();
    // The open graph reads words only.
    expect(fails({ modelId: "oss-video-matte-sam3", op: "bg-remove-video", inputs: clip, params: { points: [{ x: 5, y: 5 }] } })).toMatch(/Say what to keep/);
    expect(fails({ modelId: "oss-video-matte-sam3", op: "bg-remove-video", prompt: "the red car", inputs: clip, params: { matteOutput: "matte" } })).toBeNull();
    expect(fails({ modelId: "oss-video-matte-birefnet", op: "bg-remove-video", inputs: clip })).toBeNull();
  });

  it("an output the model can't make is named, not quietly swapped", () => {
    expect(fails({ modelId: "bria-video-bg", op: "bg-remove-video", inputs: clip, params: { matteOutput: "matte" } })).toMatch(/cut-out only — pick BiRefNet or SAM/);
    expect(fails({ modelId: "sam-3-1-video-mask", op: "bg-remove-video", prompt: "the dog", inputs: clip, params: { matteOutput: "cutout" } })).toMatch(/alpha mask only/);
    expect(fails({ modelId: "birefnet-video", op: "bg-remove-video", inputs: clip, params: { matteOutput: "matte" } })).toBeNull();
  });
});

describe("Depth map: colour map and side by side", () => {
  it("the cloud draws the parity studio's five maps and goes side by side; the open engine gray or inferno", () => {
    expect(model("depth-anything-video-cloud").options).toMatchObject({ colormaps: ["grayscale", "turbo", "inferno", "magma", "viridis"], sideBySide: true });
    expect(buildPayload(map("depth-anything-video-cloud"), { ...clip, colormap: "turbo", sideBySide: true })).toMatchObject({
      video_url: clip.video,
      colormap: "turbo",
      side_by_side: true,
      model: "VDA-Base",
    });
    expect(buildPayload(map("depth-anything-video-cloud"), clip)).toMatchObject({ colormap: "grayscale" });
    expect(model("oss-video-depth-vda").options).toMatchObject({ colormaps: ["grayscale", "inferno"], sideBySide: true });
    expect(model("oss-video-depth-da3").options).toMatchObject({ colormaps: ["grayscale"], sideBySide: true });
  });

  it("a map a model can't draw stops before anything runs", () => {
    expect(fails({ modelId: "oss-video-depth-vda", op: "depth-video", inputs: clip, params: { colormap: "turbo" } })).toMatch(/grayscale or inferno — the open engine has no turbo/);
    expect(fails({ modelId: "oss-video-depth-da3", op: "depth-video", inputs: clip, params: { colormap: "inferno" } })).toMatch(/grayscale only/);
    expect(fails({ modelId: "oss-video-depth-vda", op: "depth-video", inputs: clip, params: { colormap: "inferno", sideBySide: true } })).toBeNull();
    expect(fails({ modelId: "depth-anything-video-cloud", op: "depth-video", inputs: clip, params: { colormap: "viridis", sideBySide: true } })).toBeNull();
  });
});

describe("the composer's settings for these tools", () => {
  const shape = (m: ModelDef, ops: typeof VIDEO_MATTE_STUDIO.ops) => settingsShape(m, undefined, "video", false, {}, ops);

  it("Remove background offers what the model makes (one output still shows, with a note)", () => {
    const biref = shape(model("oss-video-matte-birefnet"), VIDEO_MATTE_STUDIO.ops);
    expect(biref.matteOutput).toEqual(["cutout", "matte"]);
    expect(biref.colormap).toBeNull();
    expect(settingsSummary(biref, {}, model("oss-video-matte-birefnet"))).toEqual(["Cutout video"]);
    expect(settingsSummary(biref, { matteOutput: "matte" }, model("oss-video-matte-birefnet"))).toEqual(["Alpha mask"]);
    expect(shape(model("bria-video-bg"), VIDEO_MATTE_STUDIO.ops).matteOutput).toEqual(["cutout"]);
    expect(videoToolNote(model("bria-video-bg"), "matte")).toMatch(/cut-out only — BiRefNet and SAM also make the alpha mask/);
    expect(videoToolNote(model("sam-3-1-video-mask"), "matte")).toMatch(/Name what to keep and get its mask/);
    expect(videoToolNote(model("birefnet-video"), "matte")).toBeNull();
  });

  it("Depth map: the colour maps, side by side, and what the open engine lacks", () => {
    const cloud = shape(model("depth-anything-video-cloud"), VIDEO_DEPTH_STUDIO.ops);
    expect(cloud).toMatchObject({ colormap: ["grayscale", "turbo", "inferno", "magma", "viridis"], sideBySide: true, matteOutput: null });
    expect(settingsSummary(cloud, { colormap: "turbo", sideBySide: true }, model("depth-anything-video-cloud"))).toEqual(["auto", "Turbo", "Side by side"]);
    expect(videoToolNote(model("depth-anything-video-cloud"), "colormap")).toBeNull();
    expect(videoToolNote(model("oss-video-depth-vda"), "colormap")).toBe("Grayscale and Inferno work with open-source models. Turbo, Magma and Viridis need Cloud.");
    expect(videoToolNote(model("oss-video-depth-da3"), "colormap")).toMatch(/grayscale only\. Video Depth Anything adds Inferno/);
    // Other studios don't get these sections.
    expect(settingsShape(model("seedance-2-5"), "t2v", "video", true)).toMatchObject({ matteOutput: null, colormap: null, sideBySide: false });
  });
});
