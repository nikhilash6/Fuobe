/**
 * Live edit's graph (src/lib/live/graph.ts): the canonical graph equals the library's hand-built file, the variants
 * wire up as they should, and the tab's check accepts every graph Fuobe builds and refuses anything else.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildLiveGraph, liveGraphProblem, sameGraph, slotBindings, LIVE_CLASSES, LIVE_FILES, LIVE_SIGMAS, type LiveGraphParams } from "@/lib/live/graph";
import { graphProblem } from "@/lib/local-comfy";

const NAME = (n: number) => `fuobe_lv${String(n).padStart(20, "A")}.png`;
const base: LiveGraphParams = { prompt: "add gold hoop earrings", seed: 42, res: 512, base: NAME(1), paste: "auto", outMaxSide: 512, format: "webp", to: "socket" };
const hand = JSON.parse(fs.readFileSync(path.join(process.cwd(), "scripts/comfy/hand-built/qwen-image-21-live-edit.json"), "utf8"));

describe("buildLiveGraph", () => {
  it("is the library's hand-built graph, its bound fields filled", () => {
    const filled = structuredClone(hand);
    const g = buildLiveGraph({ prompt: filled["30"].inputs.prompt, seed: filled["70"].inputs.noise_seed, res: filled["20"].inputs.resolution, base: filled["10"].inputs.image, refs: [filled["11"].inputs.image, filled["12"].inputs.image, filled["13"].inputs.image], mask: filled["14"].inputs.image, paste: filled["40"].inputs.mode, outMaxSide: filled["40"].inputs.out_max_side, format: filled["90"].inputs.format, quality: filled["90"].inputs.quality, to: filled["90"].inputs.to }).graph;
    expect(sameGraph(g, filled)).toBe(true);
    // The model, LoRA and schedule match the reference app's.
    expect(g["1"].inputs.unet_name).toBe(LIVE_FILES.unet);
    expect(g["4"].inputs).toMatchObject({ lora_name: LIVE_FILES.lora, strength_model: 1 });
    expect(g["73"].inputs.sigmas).toBe(LIVE_SIGMAS);
    expect(g["72"].inputs.sampler_name).toBe("euler");
    expect(g["71"].class_type).toBe("BasicGuider");
  });

  it("text to image leaves out the base nodes and takes the table's size", () => {
    const { graph, staged } = buildLiveGraph({ ...base, base: undefined, aspect: "16:9", res: 512 });
    for (const id of ["10", "11", "14", "15", "20", "40"]) expect(graph[id]).toBeUndefined();
    expect(graph["30"].inputs).toMatchObject({ width: 704, height: 384 });
    expect(graph["30"].inputs.reference).toBeUndefined();
    expect(graph["90"].inputs.images).toEqual(["34", 0]);
    expect(staged).toEqual([]);
  });

  it("wires references and a mask", () => {
    const { graph, staged } = buildLiveGraph({ ...base, refs: [NAME(2), NAME(3)], mask: NAME(4), paste: "mask" });
    expect(graph["20"].inputs.image_2).toEqual(["11", 0]);
    expect(graph["20"].inputs.image_3).toEqual(["12", 0]);
    expect(graph["13"]).toBeUndefined();
    expect(graph["15"].inputs.mask_image).toEqual(["14", 0]);
    expect(graph["40"].inputs).toMatchObject({ mask_image: ["14", 0], mode: "mask", box: ["15", 1] });
    expect(staged).toEqual([NAME(1), NAME(2), NAME(3), NAME(4)]);
  });

  it("live frames are small WebP; settle and keep are full-size PNG masters", () => {
    const o = { liveSize: 512, keepRes: 1536, hasMask: false, to: "socket" as const };
    expect(slotBindings("live", o)).toEqual({ res: 512, paste: "auto", outMaxSide: 512, format: "webp", to: "socket" });
    expect(slotBindings("keep", o)).toEqual({ res: 1536, paste: "auto", outMaxSide: 0, format: "png", to: "socket" });
    expect(slotBindings("settle", { ...o, hasMask: true })).toMatchObject({ paste: "mask", outMaxSide: 0, format: "png" });
    expect(slotBindings("warm", o)).toMatchObject({ res: 384, paste: "off", format: "webp" });
  });
});

describe("liveGraphProblem", () => {
  const staged = [NAME(1), NAME(2), NAME(3), NAME(4)];
  const variants: LiveGraphParams[] = [
    base,
    { ...base, refs: [NAME(2)], mask: NAME(4), paste: "mask" },
    { ...base, refs: [NAME(2), NAME(3), NAME(4)] },
    { ...base, res: 1536, outMaxSide: 0, format: "png" },
    { ...base, base: undefined, aspect: "3:4", res: 1024, format: "png" },
    { ...base, base: undefined, aspect: "1:1", res: 384, paste: "off" },
    { ...base, to: "temp" },
  ];
  it("accepts every graph Fuobe builds, and the relay's loader check accepts them too", () => {
    for (const v of variants) {
      const { graph } = buildLiveGraph(v);
      expect(liveGraphProblem(graph, staged)).toBeNull();
      expect(graphProblem(graph, staged)).toBeNull();
    }
  });

  const bad = (change: (g: Record<string, { class_type: string; inputs: Record<string, unknown> }>) => void, staging = staged) => {
    const { graph } = buildLiveGraph(base);
    change(graph as never);
    return liveGraphProblem(graph, staging);
  };
  it("refuses anything else", () => {
    expect(bad((g) => (g["99"] = { class_type: "VAEDecode", inputs: { samples: ["32", 0], vae: ["3", 0] } }))).toMatch(/isn't Fuobe/);
    expect(bad((g) => (g["99"] = { class_type: "LoadImage", inputs: { image: "secret.png" } }))).toMatch(/isn't a live/);
    expect(bad((g) => (g["1"].class_type = "CheckpointLoaderSimple"))).toMatch(/isn't a live/);
    expect(bad(() => {}, [NAME(2)])).toMatch(/base/);
    expect(bad((g) => (g["10"].inputs.image = "fuobe_other.png"), [...staged, "fuobe_other.png"])).toMatch(/base/);
    expect(bad((g) => (g["10"].inputs.image = "../secret.png"))).toMatch(/base/);
    expect(bad((g) => (g["30"].inputs.prompt = "x".repeat(2001)))).toMatch(/prompt/);
    expect(bad((g) => (g["20"].inputs.resolution = 4096))).toMatch(/resolution/);
    expect(bad((g) => (g["4"].inputs.lora_name = "other.safetensors"))).toMatch(/isn't Fuobe/);
    expect(bad((g) => (g["4"].inputs.strength_model = 2))).toMatch(/isn't Fuobe/);
    expect(bad((g) => (g["73"].inputs.sigmas = "1.0, 0.0"))).toMatch(/isn't Fuobe/);
    expect(bad((g) => (g["32"].inputs.latent_image = ["10", 0]))).toMatch(/isn't Fuobe/);
    expect(bad((g) => (g["70"].inputs.noise_seed = -1))).toMatch(/seed/);
    expect(bad((g) => (g["90"].inputs.to = "output"))).toMatch(/output/);
    expect(bad((g) => (g["40"].inputs.out_max_side = 333))).toMatch(/size/);
    const t2i = buildLiveGraph({ ...base, base: undefined, aspect: "1:1" }).graph;
    t2i["30"].inputs.width = 1000;
    expect(liveGraphProblem(t2i, staged)).toMatch(/size/);
    expect(liveGraphProblem(null, staged)).toBe("No graph");
  });

  it("every class is a live class", () => {
    for (const n of Object.values(buildLiveGraph({ ...base, refs: [NAME(2)], mask: NAME(4) }).graph)) expect(LIVE_CLASSES.has(n.class_type)).toBe(true);
  });
});
