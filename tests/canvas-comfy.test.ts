import { describe, expect, it } from "vitest";
import type { GenInput, Operation } from "@/lib/catalog/types";
import type { ComfyWorkflow, ManifestWorkflow } from "@/lib/comfy";
import type { MediaInfo } from "@/lib/media-probe";
import { tempDir } from "./helpers/temp-dir";

// The canvas Video concatenator on the open engine (r4/canvas-plus): each clip's fit pass (video-fit-clip: cut,
// frame, 30 fps, its sound or silence) and the packet-copy join, as the provider binds them.
const tmp = tempDir("fuobe-canvas-comfy-");
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { getModel } = await import("@/lib/catalog");
const { describeNode } = await import("@/lib/catalog/canvas");
const { planGeneration } = await import("@/lib/catalog/plan");
const { getPreset } = await import("@/lib/catalog");

async function prepare(id: string, input: GenInput, op: Operation, media: Record<string, MediaInfo> = {}) {
  return prepareWorkflow(id, { seed: 7, ...input }, {
    generationId: "gen1",
    op,
    upload: async (_data, _type, name) => `up_${name}`,
    media: (name) => media[name],
    serverRam: async () => undefined,
  });
}
const at = (wf: ComfyWorkflow, m: ManifestWorkflow, key: string) => (m.bindings[key] ?? []).map((t) => wf[t.node].inputs[t.input]);
const clip = (o: Partial<MediaInfo> = {}): MediaInfo => ({ container: "mp4", hasVideo: true, hasAudio: true, duration: 10, videoDuration: 10, width: 1920, height: 1080, fps: 25, ...o });
const combine = (wf: ComfyWorkflow) => Object.values(wf).find((n) => n.class_type === "VHS_VideoCombine")!;

describe("Video concatenator, open engine", () => {
  it("is the open fit-clip model's route, planned from the node's own step", () => {
    const m = getModel("oss-fit-clip")!;
    expect(m.routes).toEqual([expect.objectContaining({ op: "trim", provider: "comfyui", endpoint: "video-fit-clip" })]);
    const d = describeNode(
      {
        nodes: [
          { id: "a", type: "video-input", position: { x: 0, y: 0 }, data: { url: "/api/files/u/a.mp4" } },
          { id: "f", type: "concat", position: { x: 400, y: 0 }, data: { modelId: "oss-join-encoded", params: { aspectRatio: "21:9" }, clips: { a: { start: 2, end: 5.5, mute: true } } } },
        ],
        edges: [{ id: "e", source: "a", sourceHandle: "out", target: "f", targetHandle: "videos" }],
      },
      { id: "f", type: "concat", position: { x: 400, y: 0 }, data: { modelId: "oss-join-encoded", params: { aspectRatio: "21:9" }, clips: { a: { start: 2, end: 5.5, mute: true } } } },
      { engineMode: "open" },
    );
    // One clip: its fit pass is the film.
    expect(d.steps!.map((s) => s.key)).toEqual(["fit:0"]);
    const plan = planGeneration(d.steps![0].request, getModel, getPreset);
    expect(plan.params).toMatchObject({ startTime: 2, endTime: 5.5, fps: 30, extra: { width: 1680, height: 720, mute: true } });
  });

  it("cuts at the film's frame rate, frames to its size and keeps the window's sound", async () => {
    const { workflow: wf, manifest: m } = await prepare("video-fit-clip", { video: "clip.mp4", startTime: 1.5, endTime: 4.5, fps: 30, extra: { width: 720, height: 1280 } }, "trim", { "clip.mp4": clip() });
    expect(at(wf, m, "startTime")).toEqual([1.5]);
    expect(at(wf, m, "duration")).toEqual([3]);
    expect(at(wf, m, "fps")).toEqual([30]);
    expect([at(wf, m, "width"), at(wf, m, "height")]).toEqual([[720], [1280]]);
    expect(at(wf, m, "video")).toEqual(["clip.mp4"]);
    // The loader's own (cut) sound goes on the clip.
    expect(combine(wf).inputs.audio).toEqual(["1", 2]);
    expect(Object.values(wf).some((n) => n.class_type === "EmptyAudio")).toBe(false);
    // From a start to the end of the clip.
    const rest = await prepare("video-fit-clip", { video: "clip.mp4", startTime: 2, fps: 30, extra: { width: 1280, height: 720 } }, "trim", { "clip.mp4": clip() });
    expect(at(rest.workflow, rest.manifest, "duration")).toEqual([0]);
  });

  it("gives a muted clip, or one without sound, silence exactly as long as its kept frames", async () => {
    const muted = await prepare("video-fit-clip", { video: "clip.mp4", startTime: 1, endTime: 3.51, fps: 30, extra: { width: 1280, height: 720, mute: true } }, "trim", { "clip.mp4": clip() });
    const silence = Object.entries(muted.workflow).find(([, n]) => n.class_type === "EmptyAudio")!;
    expect(combine(muted.workflow).inputs.audio).toEqual([silence[0], 0]);
    // 2.51 s at 30 fps keeps 75 frames: 2.5 s of silence.
    expect(silence[1].inputs).toEqual({ duration: 2.5, sample_rate: 44100, channels: 2 });
    // "mute" isn't a binding: nothing else in the graph took it.
    expect(Object.values(muted.workflow).some((n) => "mute" in n.inputs)).toBe(false);

    const silent = await prepare("video-fit-clip", { video: "clip.mp4", startTime: 6, fps: 30, extra: { width: 1280, height: 720 } }, "trim", { "clip.mp4": clip({ hasAudio: false }) });
    // No end: the rest of the 10 s clip.
    expect(Object.values(silent.workflow).find((n) => n.class_type === "EmptyAudio")!.inputs.duration).toBe(4);

    // A window past the clip's end is cut to what's there.
    const short = await prepare("video-fit-clip", { video: "clip.mp4", startTime: 8, endTime: 20, fps: 30, extra: { width: 1280, height: 720, mute: true } }, "trim", { "clip.mp4": clip() });
    expect(Object.values(short.workflow).find((n) => n.class_type === "EmptyAudio")!.inputs.duration).toBe(2);

    // No header and no end: no way to know how long the silence must be, so no track at all.
    const unknown = await prepare("video-fit-clip", { video: "clip.webm", startTime: 0, fps: 30, extra: { width: 1280, height: 720, mute: true } }, "trim", {});
    expect(combine(unknown.workflow).inputs.audio).toBeUndefined();
    expect(Object.values(unknown.workflow).some((n) => n.class_type === "EmptyAudio")).toBe(false);
  });

  it("joins the fitted clips packet by packet, in order", async () => {
    const { workflow: wf } = await prepare("video-concat-encoded", { videos: ["f1.mp4", "f2.mp4", "f3.mp4"] }, "concat");
    const loads = Object.values(wf).filter((n) => n.class_type === "LoadVideo").map((n) => n.inputs.file);
    expect(loads).toEqual(["f1.mp4", "f2.mp4", "f3.mp4"]);
    const concat = Object.values(wf).find((n) => n.class_type === "ConcatenateVideo")!;
    expect(Object.keys(concat.inputs).filter((k) => k.startsWith("videos."))).toHaveLength(3);
  });
});
