import { describe, expect, it } from "vitest";
import type { GenInput } from "@/lib/catalog/types";
import type { ComfyWorkflow, ManifestWorkflow } from "@/lib/comfy";
import type { MediaInfo } from "@/lib/media-probe";
import { parseBrief } from "@/lib/catalog/content-factory";
import { tempDir } from "./helpers/temp-dir";

// Content Factory's open route (r4/content-factory): the reference clip → reference-brief-gemma4's bindings
// (the clip, how much of it at 24 fps, where to start), and its SaveText answer → a text output the brief parser reads.
const tmp = tempDir("fuobe-comfy-content-factory-");
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow, getWorkflow, collectOutputs } = await import("@/server/providers/comfyui");
const { getModel, getPreset } = await import("@/lib/catalog");
const { planGeneration } = await import("@/lib/catalog/plan");

const ID = "reference-brief-gemma4";
const clip = (duration: number): MediaInfo => ({ container: "mp4", hasVideo: true, hasAudio: true, duration, videoDuration: duration, width: 1080, height: 1920, fps: 30 });

async function prepare(input: GenInput, media: Record<string, MediaInfo> = {}) {
  return prepareWorkflow(ID, { seed: 7, ...input }, { generationId: "gen1", op: "write", upload: async (_d, _t, name) => `up_${name}`, media: (n) => media[n], serverRam: async () => undefined });
}
const at = (wf: ComfyWorkflow, m: ManifestWorkflow, key: string) => (m.bindings[key] ?? []).map((t) => wf[t.node].inputs[t.input]);

describe("the open reference brief (reference-brief-gemma4)", () => {
  it("is a hidden open model whose write route is the graph, and needs no prompt", () => {
    const m = getModel("oss-reference-brief")!;
    expect(m).toMatchObject({ engine: "open", kind: "text", hidden: true });
    expect(m.routes).toEqual([expect.objectContaining({ op: "write", provider: "comfyui", endpoint: ID })]);
    const plan = planGeneration({ feature: "content-factory", modelId: m.id, op: "write", inputs: { video: "/api/files/uploads/ref.mp4" }, params: { duration: 30 } }, getModel, getPreset);
    expect(plan.op).toBe("write");
  });

  it("binds the clip, its first 30 s at 24 fps, the start and the graph's own instruction", async () => {
    const { workflow, manifest } = await prepare({ video: "up_ref.mp4", duration: 30 }, { "up_ref.mp4": clip(42) });
    expect(at(workflow, manifest, "video")).toEqual(["up_ref.mp4"]);
    // frame_load_cap at 24 fps: 30 s → the 720-frame limit (TextGenerate keeps every 24th: 30 frames).
    expect(at(workflow, manifest, "frames")).toEqual([720]);
    expect(at(workflow, manifest, "startFrame")).toEqual([0]);
    expect(at(workflow, manifest, "frameWidth")).toEqual([384]);
    expect(at(workflow, manifest, "maxTokens")).toEqual([2048]);
    expect(at(workflow, manifest, "checkpoint")).toEqual(["gemma4_e4b_it_fp8_scaled.safetensors"]);
    expect(at(workflow, manifest, "seed")).toEqual([7]);
    expect(at(workflow, manifest, "filenamePrefix")).toEqual(["fuobe/gen1"]);
    expect(String(at(workflow, manifest, "instruction")[0])).toMatch(/Return strict JSON[\s\S]*never copy the reference's people, logos or exact words/);
    // The sound goes into the same TextGenerate call as the frames.
    expect(workflow["3"].inputs.audio).toEqual(["1", 2]);
    expect(workflow["3"].inputs.video).toEqual(["1", 0]);
  });

  it("reads a shorter clip whole, and skips ahead in 24 fps frames", async () => {
    const short = await prepare({ video: "up_ref.mp4", duration: 12.5 }, { "up_ref.mp4": clip(12.5) });
    expect(at(short.workflow, short.manifest, "frames")).toEqual([301]);
    const later = await prepare({ video: "up_ref.mp4", duration: 30, startTime: 10 }, { "up_ref.mp4": clip(90) });
    expect(at(later.workflow, later.manifest, "startFrame")).toEqual([240]);
    await expect(prepare({ video: "up_ref.mp4", startTime: 50 }, { "up_ref.mp4": clip(42) })).rejects.toThrow(/past the end of the clip/);
  });

  it("asks for the clip when there is none", async () => {
    await expect(prepare({})).rejects.toThrow(/Add a video/);
  });

  it("returns the brief as a text output (role brief) the parser reads, fences and all", () => {
    const answer = '```json\n{"format": "what-if explainer", "hook": "The impossible picture first", "pacing": "2-3 s", "animation_style": "Fully animated", "captions": {"style": "bold word by word", "position": "center"}}\n```';
    const outs = collectOutputs(
      { status: { status_str: "success", completed: true }, outputs: { "4": { text: [answer], files: [{ filename: "gen1_00001_.txt", subfolder: "fuobe", type: "output" }] } } },
      getWorkflow(ID).manifest,
      "http://comfy.test:8188",
    );
    expect(outs).toHaveLength(1);
    expect(outs[0]).toMatchObject({ kind: "text", contentType: "text/plain", text: answer, meta: { role: "brief" } });
    const brief = parseBrief(outs[0].text!)!.brief;
    expect(brief).toMatchObject({ format: "what-if explainer", shotSeconds: 2.5, animation: "fully-animated", captions: { position: "center", words: 1 } });
  });
});
