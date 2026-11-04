import { describe, expect, it } from "vitest";
import type { GenInput, Operation } from "@/lib/catalog/types";
import type { MediaInfo } from "@/lib/media-probe";
import { tempDir } from "./helpers/temp-dir";

// The av-tools ComfyUI workflows (Extract frame, video-synced Foley, Product shot), bound for real.
const dir = tempDir("fuobe-av-workflows-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://comfy.test:8188";

const { loadManifest, prepareWorkflow } = await import("@/server/providers/comfyui");
const { getModel } = await import("@/lib/catalog");
const { computeFrames } = await import("@/lib/comfy");
const { frameParams } = await import("@/lib/av/frames");


const clip: MediaInfo = { container: "mp4", hasVideo: true, hasAudio: true, duration: 6, videoDuration: 6, width: 640, height: 360, fps: 30, frames: 180 };

async function prepare(id: string, op: Operation, input: Partial<GenInput>) {
  const uploads: string[] = [];
  const res = await prepareWorkflow(id, { prompt: "", ...input } as GenInput, {
    generationId: "gen1",
    op,
    upload: async (_d, _t, name) => {
      uploads.push(name);
      return `up_${name}`;
    },
    media: (name) => (name === "clip.mp4" ? clip : undefined),
    serverRam: async () => undefined,
  });
  return { ...res, uploads };
}

describe("av-tools workflows", () => {
  it("are in the manifest, validated against a live ComfyUI, with a licence, and used by a model", () => {
    const byId = new Map(loadManifest().workflows.map((w) => [w.id, w]));
    for (const [id, model] of [
      ["frame-extract", "oss-extract-frame"],
      ["v2a-hunyuan-foley", "oss-hunyuan-foley-video"],
      ["product-shot-qwen-edit-2509", "oss-product-shot"],
      ["audio-timeline", "oss-audio-timeline"],
    ]) {
      expect(byId.get(id)?.validated, id).toBe(true);
      expect(byId.get(id)?.license, id).toBeTruthy();
      expect(getModel(model)?.routes.find((r) => r.provider === "comfyui")?.endpoint, model).toBe(id);
    }
  });

  it("Extract frame: the last frame by default; a moment as a short window's first frame", async () => {
    const last = await prepare("frame-extract", "frame", { video: "clip.mp4", ...frameParams("open", "last") });
    expect(last.workflow["1"].inputs.file).toBe("clip.mp4");
    expect(last.workflow["2"].inputs).toMatchObject({ start_time: -1, duration: 0 });
    expect(last.workflow["4"].inputs.batch_index).toBe(-1);
    expect(last.workflow["5"].inputs.filename_prefix).toBe("fuobe/gen1");
    const at = await prepare("frame-extract", "frame", { video: "clip.mp4", ...frameParams("open", { at: 3.2 }) });
    expect(at.workflow["2"].inputs.start_time).toBe(3.2);
    expect(at.workflow["2"].inputs.duration).toBeCloseTo(0.5);
    expect(at.workflow["4"].inputs.batch_index).toBe(0);
    const first = await prepare("frame-extract", "frame", { video: "clip.mp4", ...frameParams("open", "first") });
    expect(first.workflow["2"].inputs).toMatchObject({ start_time: 0, duration: 0.5 });
    await expect(prepare("frame-extract", "frame", { video: "clip.mp4", ...frameParams("open", { at: 9 }) })).rejects.toThrow(/past the end of the clip/);
  });

  it("Foley: the clip at the sampler's frame rate, as many frames as the sound is long", async () => {
    const r = await prepare("v2a-hunyuan-foley", "v2a", { video: "clip.mp4", prompt: "footsteps on gravel", negativePrompt: "music", duration: 4, seed: 7 });
    expect(r.workflow["5"].inputs.video).toBe("clip.mp4");
    expect(r.workflow["6"].inputs.file).toBe("clip.mp4");
    expect(r.workflow["3"].inputs).toMatchObject({ prompt: "footsteps on gravel", negative_prompt: "music", duration: 4, frame_rate: 8, seed: 7 });
    expect(r.workflow["5"].inputs).toMatchObject({ force_rate: 8, frame_load_cap: computeFrames(4, 8, 4, 481) });
    for (const n of ["4", "8"]) expect(r.workflow[n].inputs.filename_prefix).toBe("fuobe/gen1");
  });

  it("Foley with no length asked for covers the whole clip (its header's length)", async () => {
    const r = await prepare("v2a-hunyuan-foley", "v2a", { video: "clip.mp4", prompt: "rain on a window" });
    expect(r.workflow["3"].inputs.duration).toBe(6);
    expect(r.workflow["5"].inputs.frame_load_cap).toBe(computeFrames(6, 8, 4, 481));
    // The model offers no length to pick, so nothing overrides it.
    expect(getModel("oss-hunyuan-foley-video")!.options.durations).toBeUndefined();
    expect(getModel("oss-hunyuan-foley-video")!.defaults?.duration).toBeUndefined();
  });

  it("Voice timeline: every line at its cue on silence as long as the video, cut where the next starts", async () => {
    const timeline = { length: 30, clips: [{ start: 0, duration: 6 }, { start: 6, duration: 18 }, { start: 24, duration: 6 }] };
    const r = await prepare("audio-timeline", "timeline", { audios: ["l0.flac", "l1.flac", "l2.flac"], duration: 30, extra: { timeline } });
    const wf = r.workflow;
    const of = (cls: string) => Object.entries(wf).filter(([, n]) => n.class_type === cls);
    // The track: EmptyAudio as long as the video, saved after the last line is added.
    expect(wf["1"].inputs).toMatchObject({ duration: 30, sample_rate: 44100, channels: 2 });
    expect(of("LoadAudio").map(([, n]) => n.inputs.audio)).toEqual(["l0.flac", "l1.flac", "l2.flac"]);
    expect(of("TrimAudioDuration").map(([, n]) => n.inputs.duration)).toEqual([6, 18, 6]);
    // A line at 0 s needs no lead-in; the others wait their start time in silence.
    expect(of("EmptyAudio").map(([, n]) => n.inputs.duration)).toEqual([30, 6, 24]);
    expect(wf.t1_add.inputs).toMatchObject({ audio1: ["1", 0], audio2: ["t1_cut", 0], merge_method: "add" });
    expect(wf.t2_at.inputs).toMatchObject({ audio1: ["t2_lead", 0], audio2: ["t2_cut", 0], direction: "after" });
    expect(wf.t2_add.inputs).toMatchObject({ audio1: ["t1_add", 0], audio2: ["t2_at", 0] });
    expect(wf.t3_add.inputs.audio1).toEqual(["t2_add", 0]);
    expect(wf["7"].inputs).toMatchObject({ audio: ["t3_add", 0], filename_prefix: "fuobe/gen1" });
    // Nothing of the template's single line is left over.
    for (const id of ["2", "3", "4", "5", "6"]) expect(wf[id]).toBeUndefined();
    await expect(prepare("audio-timeline", "timeline", { audios: ["l0.flac"], duration: 30 })).rejects.toThrow(/start times/);
    await expect(prepare("audio-timeline", "timeline", { audios: ["l0.flac"], extra: { timeline } })).rejects.toThrow(/places 3 clips but got 1/);
  });

  it("Product shot: the photo cut out onto white, the scene after the LoRA's trigger", async () => {
    const r = await prepare("product-shot-qwen-edit-2509", "edit", { images: ["bottle.png"], prompt: "on a marble counter, morning light", seed: 3 });
    expect(r.workflow["78"].inputs.image).toBe("bottle.png");
    expect(r.workflow["1002"].inputs).toMatchObject({ string_a: "白底图转场景,", string_b: "on a marble counter, morning light" });
    expect(r.workflow["433:3"].inputs.seed).toBe(3);
    expect(r.workflow["1001"].inputs.lora_name).toBe("Qwen-Image-Edit-2509-White_to_Scene.safetensors");
    expect(r.workflow["469"].inputs.filename_prefix).toBe("fuobe/gen1");
  });
});
