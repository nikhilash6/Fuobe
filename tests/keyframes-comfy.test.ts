import { describe, expect, it } from "vitest";
import type { GenInput, Operation } from "@/lib/catalog/types";
import { keyframeChain, planKeyframeClips } from "@/lib/catalog/keyframes";
import { tempDir } from "./helpers/temp-dir";

// The open keyframe film's clips through the comfyui provider: each pair's start and end frames and its
// frame count land in the Wan 2.2 start/end-frame graph exactly as the per-pair plan counted them.
const tmp = tempDir("fuobe-keyframes-comfy-");
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { getWorkflow, prepareWorkflow } = await import("@/server/providers/comfyui");
const { getModel } = await import("@/lib/catalog");

const prepare = (id: string, input: Partial<GenInput>, op: Operation) =>
  prepareWorkflow(id, { prompt: "a paper boat", aspectRatio: "16:9", resolution: "480p", ...input } as GenInput, { generationId: "g1", op, upload: async (_d, _t, name) => `up_${name}` });
const at = (wf: Record<string, { inputs: Record<string, unknown> }>, node: string, input: string) => wf[node]?.inputs[input];

describe("keyframe film clips on ComfyUI", () => {
  it("chains the model's own start/end-frame workflow, with its fps and frame step", () => {
    const route = keyframeChain(getModel("oss-wan22-14b-fast")!)!;
    expect(route).toMatchObject({ provider: "comfyui", endpoint: "wan22-flf2v-14b", chained: true });
    const { manifest } = getWorkflow(route.endpoint);
    expect(manifest.capability).toBe("flf2v");
    expect([manifest.defaults.fps, manifest.defaults.frameStep, manifest.limits?.maxFrames]).toEqual([16, 4, 121]);
  });

  it("binds each pair's frames and its frame count", async () => {
    const { manifest } = getWorkflow("wan22-flf2v-14b");
    const clips = planKeyframeClips([0, 1.3, 4, 7.7], 10, { name: "Wan 2.2 14B", maxSeconds: 7, fps: 16, step: 4, maxFrames: manifest.limits?.maxFrames });
    const frames = ["a.png", "b.png", "c.png", "d.png"];
    for (const c of clips.filter((x) => x.to !== null)) {
      const { workflow: wf } = await prepare("wan22-flf2v-14b", { images: [frames[c.from]], endImage: frames[c.to!], duration: c.seconds }, "flf2v");
      expect(at(wf, "81", "length"), `clip ${c.from + 1} → ${c.to! + 1}`).toBe(c.frames);
      expect(String(at(wf, "80", "image"))).toContain(frames[c.from].replace(".png", ""));
      expect(String(at(wf, "89", "image"))).toContain(frames[c.to!].replace(".png", ""));
      expect(at(wf, "86", "fps")).toBe(16);
    }
    expect(clips.map((c) => c.frames)).toEqual([21, 45, 57, 37]);
    // The stretch after the last frame runs on the image-to-video graph from that frame alone.
    const tail = clips.at(-1)!;
    expect(tail.to).toBeNull();
    const i2v = getModel("oss-wan22-14b-fast")!.routes.find((r) => r.op === "i2v")!.endpoint;
    const { workflow: wf, manifest: m } = await prepare(i2v, { images: ["d.png"], duration: tail.seconds }, "i2v");
    const lengthAt = m.bindings.frames![0];
    expect(at(wf, lengthAt.node, lengthAt.input)).toBe(tail.frames);
  });
});
