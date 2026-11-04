import { describe, expect, it } from "vitest";
import type { GenInput, Operation, OutputFile } from "@/lib/catalog/types";
import type { MediaInfo } from "@/lib/media-probe";
import { CLICK_OPEN_PROBLEM, HAND_OFF, REMOVE_SCENE } from "@/lib/catalog/remove-object";
import { tempDir } from "./helpers/temp-dir";

// The comfyui provider driving the remove-object graphs (SAM 3.1 + VACE / VOID), the matte graphs' two outputs and
// the depth graphs' colour map and side-by-side switch, bound for real on the library graphs.
const tmp = tempDir("fuobe-remove-object-comfy-");
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { collectOutputs, getWorkflow, prepareWorkflow } = await import("@/server/providers/comfyui");
const { pickOutput } = await import("@/server/generations");

const clip: MediaInfo = { container: "mp4", hasVideo: true, hasAudio: true, duration: 8, videoDuration: 8, width: 1280, height: 720, fps: 30, frames: 240 };
const prepare = (id: string, input: Partial<GenInput>, op: Operation = "remove-object") =>
  prepareWorkflow(id, { video: "clip.mp4", ...input } as GenInput, { generationId: "g1", op, upload: async (_d, _t, name) => `up_${name}`, media: (n) => (n === "clip.mp4" ? clip : undefined) });
const at = (wf: Record<string, { inputs: Record<string, unknown> }>, node: string, input: string) => wf[node]?.inputs[input];

describe("remove-object graphs through the provider", () => {
  it("VACE: the words become SAM 3.1's maskPrompt, the gap gets the scene without it, the window in seconds", async () => {
    const { workflow: wf } = await prepare("video-inpaint-wan-vace", { prompt: "the coffee cup", startTime: 2.691667, endTime: 5.391667, seed: 3 });
    expect(at(wf, "8", "text")).toBe("the coffee cup");
    expect(at(wf, "16", "text")).toBe(REMOVE_SCENE);
    expect(at(wf, "85", "start_time")).toBe(2.691667);
    expect(at(wf, "82", "value")).toBeCloseTo(2.7, 6);
    expect(at(wf, "23", "seed")).toBe(3);
    // The work-size budget stays the graph's default; it renders in the clip's own shape.
    expect([at(wf, "87", "value"), at(wf, "88", "value")]).toEqual([832, 480]);
  });

  it("a whole sentence (a Canvas node runs the model directly) becomes the objects alone, each its own SAM prompt", async () => {
    const { workflow: wf } = await prepare("video-inpaint-wan-vace", { prompt: "Remove the logo and the watermark from the video, keep everything else the same" });
    expect(at(wf, "8", "text")).toBe("the logo, the watermark");
    const v = await prepare("video-erase-void", { prompt: "the red car and its shadow" });
    expect(at(v.workflow, "8", "text")).toBe("the red car, its shadow");
  });

  it("a described scene (params.extra.prompt) fills the gap instead", async () => {
    const { workflow: wf } = await prepare("video-inpaint-wan-vace", { prompt: "the man", extra: { prompt: "An empty beach at sunset" } });
    expect(at(wf, "8", "text")).toBe("the man");
    expect(at(wf, "16", "text")).toBe("An empty beach at sunset");
  });

  it("refuses to run without words, and says clicking is cloud-only when points were sent", async () => {
    await expect(prepare("video-inpaint-wan-vace", { prompt: "" })).rejects.toThrow(/Say what to remove/);
    await expect(prepare("video-erase-void", { points: [{ x: 1, y: 2 }] })).rejects.toThrow(CLICK_OPEN_PROBLEM);
  });

  it("painted VACE: the first-frame mask is uploaded into its loader, the scene prompt is the default", async () => {
    const { workflow: wf, manifest } = await prepare("video-inpaint-wan-vace-painted", { mask: "mask.png", startTime: 0, endTime: 2.7, extra: { [HAND_OFF]: true } });
    expect(at(wf, "70", "image")).toBe("mask.png");
    expect(at(wf, "16", "text")).toBe(REMOVE_SCENE);
    // Its second output is the last frame's tracked mask, which starts the next window.
    expect(manifest.outputs).toEqual([
      { node: "38", kind: "video" },
      { node: "77", kind: "image", role: "mask" },
    ]);
    expect(at(wf, "77", "filename_prefix")).toBe("fuobe/g1");
    expect(wf["76"].inputs).toMatchObject({ image: ["74", 0], batch_index: ["75", 1], length: 1 });
    expect(wf["74"].inputs).toEqual({ mask: ["10", 0] });
    // The flag isn't bound to anything.
    expect(JSON.stringify(wf)).not.toContain(HAND_OFF);
  });

  it("painted VACE: a window nothing waits on (one window, or the last) saves only the video", async () => {
    const { workflow: wf } = await prepare("video-inpaint-wan-vace-painted", { mask: "mask.png", startTime: 0, endTime: 2.7 });
    expect(wf["77"]).toBeUndefined();
    expect(wf["38"].class_type).toBe("SaveVideo");
  });

  it("VOID: maskPrompt, the scene, and pass 2 can be skipped", async () => {
    const { workflow: wf } = await prepare("video-erase-void", { prompt: "the skateboarder", extra: { skipPass2: true } });
    expect(at(wf, "8", "text")).toBe("the skateboarder");
    expect(at(wf, "16", "text")).toBe(REMOVE_SCENE);
    expect(at(wf, "49", "value")).toBe(true);
  });

  it("a painted window's outputs: the video, and its last mask as meta.role 'mask', which a mask chain slot picks", () => {
    const { manifest } = getWorkflow("video-inpaint-wan-vace-painted");
    const outs = collectOutputs(
      {
        status: { status_str: "success", completed: true },
        outputs: {
          "38": { images: [{ filename: "w_00001_.mp4", subfolder: "fuobe", type: "output" }], animated: [true] },
          "77": { images: [{ filename: "w_00001_.png", subfolder: "fuobe", type: "output" }] },
        },
      },
      manifest,
    );
    expect(outs.map((o) => [o.kind, o.meta?.role])).toEqual([
      ["video", undefined],
      ["image", "mask"],
    ]);
    const files = outs.map((o) => ({ url: o.url, kind: o.kind, meta: o.meta }) as OutputFile);
    expect(pickOutput(files, { slot: "mask" })?.url).toMatch(/w_00001_\.png/);
    expect(pickOutput(files, { slot: "videos" })?.url).toMatch(/w_00001_\.mp4/);
    // A SAM 3.1 track (cloud) is a mask video: the first video.
    expect(pickOutput([{ url: "/m.mp4", kind: "video" }, { url: "/b.zip", kind: "image" }], { slot: "mask" })?.url).toBe("/m.mp4");
  });
});

describe("matte graphs: Cutout video or Alpha mask", () => {
  it("keeps only the asked-for output (the other save node is dropped, so it isn't encoded)", async () => {
    const both = await prepare("video-bg-remove-sam3", { prompt: "the dog" }, "bg-remove-video");
    expect(Object.keys(both.workflow)).toEqual(expect.arrayContaining(["9", "12"]));
    expect(both.manifest.outputs.map((o) => o.role)).toEqual(["cutout", "matte"]);
    const matte = await prepare("video-bg-remove-sam3", { prompt: "the dog", matteOutput: "matte" }, "bg-remove-video");
    expect(matte.workflow["9"]).toBeUndefined();
    expect(matte.workflow["12"].class_type).toBe("SaveVideo");
    expect(at(matte.workflow, "4", "text")).toBe("the dog");
    const cut = await prepare("video-bg-remove-birefnet", { matteOutput: "cutout" }, "bg-remove-video");
    expect(cut.workflow["10"]).toBeUndefined();
    expect(cut.workflow["7"].class_type).toBe("SaveWEBM");
    // Only Remove background keeps one: a matte graph run for another op saves both.
    const other = await prepare("video-bg-remove-birefnet", { matteOutput: "cutout" }, "bg-remove");
    expect(Object.keys(other.workflow)).toEqual(expect.arrayContaining(["7", "10"]));
  });
});

describe("depth graphs: colour map and side by side", () => {
  it("Video Depth Anything takes gray or inferno, and puts the original next to the depth on request", async () => {
    const gray = await prepare("video-depth-vda-small", { colormap: "grayscale" }, "depth-video");
    expect(at(gray.workflow, "5", "colormap")).toBe("gray");
    expect(at(gray.workflow, "9", "value")).toBe(false);
    const inferno = await prepare("video-depth-vda-small", { colormap: "inferno", sideBySide: true }, "depth-video");
    expect(at(inferno.workflow, "5", "colormap")).toBe("inferno");
    expect(at(inferno.workflow, "9", "value")).toBe(true);
    expect(inferno.workflow["10"].inputs).toEqual({ switch: ["9", 0], on_true: ["8", 0], on_false: ["5", 0] });
    await expect(prepare("video-depth-vda-small", { colormap: "turbo" }, "depth-video")).rejects.toThrow(/grayscale or inferno/);
  });

  it("Depth Anything 3 is grayscale only (and can go side by side too)", async () => {
    await expect(prepare("video-depth-da3", { colormap: "inferno" }, "depth-video")).rejects.toThrow(/grayscale maps only/);
    const sbs = await prepare("video-depth-da3", { colormap: "grayscale", sideBySide: true }, "depth-video");
    expect(at(sbs.workflow, "9", "value")).toBe(true);
  });
});
