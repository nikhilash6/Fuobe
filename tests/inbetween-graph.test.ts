import { describe, expect, it } from "vitest";
import type { GenInput } from "@/lib/catalog/types";
import { gapSelection, keyTimes, timingFor, totalFrames, WORKFLOW_TIMING, type InbetweenTiming } from "@/lib/inbetween";
import { tempDir } from "./helpers/temp-dir";

// Fuobe Animation on your GPU: N keyframes → N − 1 Wan 2.2 first/last-frame passes in one prompt on one set of loaders.
const tmp = tempDir("fuobe-inbetween-graph-");
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { getWorkflow, prepareWorkflow } = await import("@/server/providers/comfyui");
const { getModel } = await import("@/lib/catalog");
const { planGeneration } = await import("@/lib/catalog/plan");
const { onEngine } = await import("@/lib/catalog/engines");
const { getPreset } = await import("@/lib/catalog");
const planOn = (engine: "open" | "cloud", req: Parameters<typeof planGeneration>[0]) => planGeneration(req, (id) => onEngine(getModel(id)!, engine), getPreset);

type Wf = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
const keys = (n: number) => Array.from({ length: n }, (_, i) => `key${i + 1}.png`);
const prepare = (n: number, timing?: InbetweenTiming, more: Partial<GenInput> = {}) =>
  prepareWorkflow(
    "wan22-inbetween-anisora",
    { prompt: "a girl turns and waves", aspectRatio: "16:9", resolution: "720p", seed: 42, images: keys(n), extra: timing ? { inbetween: timing } : {}, ...more } as GenInput,
    { generationId: "g1", op: "keyframes", upload: async (_d, _t, name) => `up_${name}` },
  );
const ofClass = (wf: Wf, cls: string) => Object.entries(wf).filter(([, n]) => n.class_type === cls);

describe("the in-between graph", () => {
  it("is a validated one-pass template with the workflow's sampling", () => {
    const { manifest, workflow } = getWorkflow("wan22-inbetween-anisora");
    expect(manifest).toMatchObject({ capability: "keyframes", expand: "keyframes", validated: true });
    expect(manifest.customNodes.map((c) => c.name)).toEqual(["ComfyUI-VideoHelperSuite"]);
    expect(manifest.models.map((m) => m.file)).toContain("Wan2_2_I2V_AniSora_3_2_HIGH_rank_64_fp16.safetensors");
    expect(manifest.models.every((m) => m.sizeGb)).toBe(true);
    const wf = workflow as Wf;
    expect(wf.h1.inputs).toMatchObject({ steps: 4, cfg: 1, sampler_name: "euler", scheduler: "simple", start_at_step: 0, end_at_step: 2, return_with_leftover_noise: "enable" });
    expect(wf.l1.inputs).toMatchObject({ steps: 4, cfg: 1, start_at_step: 2, add_noise: "disable" });
    expect([wf["3"].inputs.shift, wf["6"].inputs.shift]).toEqual([5, 5]);
  });

  for (const n of [2, 5, 10]) {
    it(`expands ${n} keyframes into ${n - 1} passes sharing one set of loaders`, async () => {
      const timing = n === 5 ? WORKFLOW_TIMING : timingFor(n, { gaps: Array.from({ length: n - 1 }, (_, i) => ({ frames: 17 + 4 * i, speed: ((i % 4) + 1) as 1 | 2 | 3 | 4 })), fps: 16 });
      const { workflow } = await prepare(n, timing, { negativePrompt: "blurry" });
      const wf = workflow as Wf;
      // One of each loader, whatever the count.
      for (const cls of ["UNETLoader", "CLIPLoader", "VAELoader", "LoraLoaderModelOnly", "ModelSamplingSD3"]) expect(ofClass(wf, cls).length, cls).toBe(cls === "UNETLoader" || cls === "LoraLoaderModelOnly" || cls === "ModelSamplingSD3" ? 2 : 1);
      expect(ofClass(wf, "LoadImage").map(([, x]) => x.inputs.image)).toEqual(keys(n));
      expect(ofClass(wf, "WanFirstLastFrameToVideo").length).toBe(n - 1);
      expect(ofClass(wf, "KSamplerAdvanced").length).toBe(2 * (n - 1));
      for (let k = 1; k < n; k++) {
        const g = timing.gaps[k - 1];
        expect(wf[`f${k}`].inputs).toMatchObject({ length: g.frames, start_image: [`k${k}`, 0], end_image: [`k${k + 1}`, 0], width: 1280, height: 720, negative: ["9", 0] });
        expect(wf[`h${k}`].inputs).toMatchObject({ noise_seed: 42 + k - 1, model: ["3", 0], latent_image: [`f${k}`, 2] });
        expect(wf[`l${k}`].inputs).toMatchObject({ model: ["6", 0], latent_image: [`h${k}`, 0] });
        const sel = gapSelection(g);
        expect(wf[`s${k}`].inputs).toMatchObject({ images: [`d${k}`, 0], select_every_nth: sel.every, skip_first_images: sel.skip });
        expect(wf.batch.inputs[`images.image${k}`]).toEqual([`s${k}`, 0]);
      }
      expect(wf.batch.inputs["images.image0"]).toEqual(["first", 0]);
      expect(Object.keys(wf.batch.inputs).length).toBe(n);
      expect(wf.first.inputs.image).toEqual(["d1", 0]);
      expect(wf.video.inputs.fps).toBe(timing.fps);
      expect(wf["9"].inputs.text).toBe("blurry");
      expect(wf.p1.inputs.text).toBe("a girl turns and waves");
      if (n === 5) expect(totalFrames(timing)).toBe(91);
    });
  }

  it("adds each gap's words and keeps the mouth still when asked", async () => {
    const timing: InbetweenTiming = { gaps: [{ frames: 17, speed: 1, prompt: "she jumps" }, { frames: 21, speed: 2 }], fps: 24 };
    const { workflow } = await prepare(3, timing, { extra: { inbetween: timing, stillMouth: true } });
    const wf = workflow as Wf;
    expect(wf.p1.inputs.text).toBe("a girl turns and waves. she jumps. mouth does not move");
    expect(wf.p2.inputs.text).toBe("a girl turns and waves. mouth does not move");
  });

  it("makes the timing from Frames mode's times when none is sent, and refuses bad timing", async () => {
    const { workflow } = await prepare(3, undefined, { keyframeTimes: [0, 1.5, 3] });
    expect((workflow as Wf).f1.inputs.length).toBe(37);
    await expect(prepare(3, { gaps: [{ frames: 17, speed: 1 }], fps: 24 })).rejects.toThrow(/2 gaps/);
    await expect(prepare(1, undefined)).rejects.toThrow(/two keyframes/);
  });
});

describe("Fuobe Animation in the catalog", () => {
  it("runs on both engines: one graph on your GPU, one hosted clip per gap in the cloud", () => {
    const m = getModel("fuobe-animation")!;
    expect(m.engines).toEqual(["open", "cloud"]);
    expect(m.options.inbetween).toBe(true);
    expect(m.options.loras?.map((l) => [l.file, l.target])).toEqual([["Wan2_2_I2V_AniSora_3_2_HIGH_rank_64_fp16.safetensors", "high"]]);
    expect(m.routes.filter((r) => r.op === "keyframes").map((r) => [r.provider, r.endpoint, !!r.chained])).toEqual([
      ["comfyui", "wan22-inbetween-anisora", false],
      ["fal", "fal-ai/wan/v2.2-a14b/image-to-video", true],
    ]);
  });

  it("plans a keyframes run on your GPU with the timing checked", () => {
    const m = getModel("fuobe-animation")!;
    const timing = WORKFLOW_TIMING;
    const plan = planOn("open", { feature: "video", modelId: m.id, engine: "open", prompt: "", inputs: { images: keys(5) }, params: { keyframeTimes: keyTimes(timing), extra: { inbetween: timing } } });
    expect(plan.op).toBe("keyframes");
    expect(() => planOn("open", { feature: "video", modelId: m.id, engine: "open", inputs: { images: keys(3) }, params: { keyframeTimes: [0, 1, 2], extra: { inbetween: { gaps: [{ frames: 17, speed: 5 }, { frames: 17, speed: 1 }], fps: 24 } } } })).toThrow(/×1 to ×4/);
    // The cloud keeps every frame at 16 fps, and says what runs on your GPU.
    expect(() => planOn("cloud", { feature: "video", modelId: m.id, inputs: { images: keys(2) }, params: { keyframeTimes: [0, 1], extra: { inbetween: { gaps: [{ frames: 17, speed: 3 }], fps: 16 } } } })).toThrow(/your GPU/);
  });
});
