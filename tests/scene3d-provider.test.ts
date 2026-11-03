import { describe, expect, it } from "vitest";
import type { ManifestWorkflow } from "@/lib/comfy";
import type { ModelDef, ModelRoute } from "@/lib/catalog/types";
import { tempDir } from "./helpers/temp-dir";

/** Cinema Studio's "Create 3D scene" on both engines: the catalog models, the ComfyUI binding and the outputs. */

const dir = tempDir("fuobe-scene3d-");
process.env.FUOBE_DATA_DIR = dir;
process.env.COMFYUI_URL = "http://comfy.test:8188";

const { collectOutputs, getWorkflow, prepareWorkflow } = await import("@/server/providers/comfyui");
const { getModel } = await import("@/lib/catalog");
const { buildPayload, extractOutputs } = await import("@/lib/catalog/payload");
const { outputKind } = await import("@/server/generations");
const { mockProvider } = await import("@/server/providers/mock");
const { decodePng } = await import("@/server/png");
const { buildPointCloud, depthEncoding } = await import("@/lib/scene3d");


const manifestOf = (id: string): ManifestWorkflow => getWorkflow(id).manifest;

async function prepare(extra: Record<string, unknown> = {}) {
  const uploads: string[] = [];
  const res = await prepareWorkflow("scene-mesh-moge", { prompt: "", images: ["still.png"], extra }, {
    generationId: "gen-scene",
    op: "scene-3d",
    upload: async (_d, _t, name) => {
      uploads.push(name);
      return `up_${name}`;
    },
  });
  return { ...res, uploads };
}

describe("open engine: MoGe 2 scene (scene-mesh-moge)", () => {
  it("is a catalog model on the validated workflow, with no prompt", () => {
    const m = getModel("oss-scene-moge")!;
    expect(m.engine).toBe("open");
    expect(m.kind).toBe("model3d");
    expect(m.routes).toEqual([expect.objectContaining({ op: "scene-3d", provider: "comfyui", endpoint: "scene-mesh-moge" })]);
    const w = manifestOf("scene-mesh-moge");
    expect(w.validated).toBe(true);
    expect(w.capability).toBe("scene-3d");
    expect(m.options.sliders?.map((s) => s.param)).toEqual(["resolutionLevel", "decimation"]);
  });

  it("binds the still, the file prefix of both outputs and the manifest's defaults", async () => {
    const { workflow, meta } = await prepare();
    expect(workflow["1"].inputs.image).toBe("still.png");
    expect(workflow["9"].inputs.filename_prefix).toBe("fuobe/gen-scene");
    expect(workflow["11"].inputs.filename_prefix).toBe("fuobe/gen-scene");
    expect(workflow["6"].inputs.model_name).toBe("moge_2_vitl_normal_fp16.safetensors");
    expect(workflow["7"].inputs).toMatchObject({ resolution_level: 9, fov_x_degrees: 0 });
    expect(workflow["8"].inputs).toMatchObject({ decimation: 1, texture: true });
    expect(meta.workflowId).toBe("scene-mesh-moge");
  });

  it("takes detail, thinning and a known field of view from params.extra", async () => {
    const { workflow } = await prepare({ resolutionLevel: 6, decimation: 2, fovX: 73.7 });
    expect(workflow["7"].inputs).toMatchObject({ resolution_level: 6, fov_x_degrees: 73.7 });
    expect(workflow["8"].inputs.decimation).toBe(2);
  });

  it("asks for the still when there is none", async () => {
    await expect(prepareWorkflow("scene-mesh-moge", { prompt: "", images: [] }, { generationId: "g", op: "scene-3d", upload: async () => "x" })).rejects.toThrow(/Add an image/);
  });

  it("returns the scene GLB first and the depth PNG second, each with its role", () => {
    const file = (filename: string) => ({ filename, subfolder: "fuobe", type: "output" });
    const outs = collectOutputs(
      // What ComfyUI 0.41 answers for this graph (a live CPU run): SaveGLB also lists camera_info [null].
      {
        status: { status_str: "success", completed: true },
        outputs: { "11": { images: [file("gen-scene_00001_.png")] }, "9": { "3d": [file("gen-scene_00002_.glb")], camera_info: [null], model_3d_info: [] } },
      },
      manifestOf("scene-mesh-moge"),
    );
    expect(outs.map((o) => [o.kind, o.contentType, o.meta?.role])).toEqual([
      ["model3d", "model/gltf-binary", "scene"],
      ["image", undefined, "depth"],
    ]);
  });
});

describe("open engine: the recomposition on Qwen-Image-Edit 2511 (qwen-image-edit-2511-multi)", () => {
  it("binds the capture as image 1, the still as image 2, the Multiple-Angles LoRA and its reference pose", async () => {
    const { planCinema } = await import("@/lib/catalog/cinema");
    const plan = planCinema(
      {
        engine: "open",
        mode: "image",
        action: "recompose",
        prompt: "",
        settings: {},
        aspectRatio: "16:9",
        source: { url: "/api/files/uploads/still.png", kind: "image" },
        capture: { url: "/api/files/uploads/capture.png", lens: 50, aperture: 2.8, pose: { horizontal: 300, vertical: 0, zoom: 5 } },
      },
      { cloudAllowed: true },
    );
    const req = plan.steps[0].request;
    const route = getModel(req.modelId!)!.routes[0];
    expect(route.endpoint).toBe("qwen-image-edit-2511-multi");
    const { workflow } = await prepareWorkflow(route.endpoint, { prompt: req.prompt, images: ["capture.png", "still.png"], loras: req.loras, aspectRatio: "16:9" }, {
      generationId: "gen-recompose",
      op: "edit",
      upload: async (_d, _t, name) => `up_${name}`,
    });
    expect(workflow["41"].inputs.image).toBe("capture.png");
    expect(workflow["83"].inputs.image).toBe("still.png");
    // No third reference: the still again, which the Qwen edit encoder takes harmlessly.
    expect(workflow["1201"].inputs.image).toBe("still.png");
    const lora = Object.values(workflow).find((n) => n.class_type === "LoraLoaderModelOnly");
    expect(lora?.inputs).toMatchObject({ lora_name: "qwen-image-edit-2511-multiple-angles-lora.safetensors", strength_model: 1 });
    // The capture already shows the flown view (300° round): the LoRA is told not to turn it again.
    expect(String(workflow["170:151"].inputs.prompt)).toMatch(/^<sks> front view eye-level shot medium shot\. Re-render this exact camera view/);
    expect(String(workflow["170:151"].inputs.prompt)).toContain("a 50 mm standard lens at f/2.8");
  });
});

describe("cloud: Marigold V2 depth (fal-ai/marigold-v2)", () => {
  const m = getModel("marigold-depth") as ModelDef;
  const route = m.routes[0] as ModelRoute;

  it("is a hidden helper that answers scene-3d with an image at $0.03", () => {
    expect(m.hidden).toBe(true);
    expect(m.kind).toBe("image");
    expect(route).toMatchObject({ op: "scene-3d", provider: "fal", endpoint: "fal-ai/marigold-v2" });
    expect(m.pricing).toMatchObject({ unit: "image", usd: 0.03 });
    expect(outputKind("scene-3d", m)).toBe("image");
    expect(outputKind("scene-3d", getModel("oss-scene-moge")!)).toBe("model3d");
  });

  it("sends the still and always asks for depth (not normals or albedo)", () => {
    const body = buildPayload(route.map!, { prompt: "", images: ["https://fal.test/still.png"], seed: 3 });
    expect(body).toEqual({ image_url: "https://fal.test/still.png", seed: 3, prediction_type: "depth" });
  });

  it("reads the depth map as an image with role depth, and a mesh answer as the 3D model", () => {
    const depth = extractOutputs({ image: { url: "https://fal.test/depth.png", content_type: "image/png", width: 1024, height: 576 }, seed: 3 }, "scene-3d");
    expect(depth).toEqual([{ url: "https://fal.test/depth.png", kind: "image", contentType: "image/png", meta: { role: "depth" } }]);
    const mesh = extractOutputs({ model_glb: { url: "https://fal.test/scene.glb" }, image: { url: "https://fal.test/preview.png" } }, "scene-3d");
    expect(mesh[0]).toMatchObject({ url: "https://fal.test/scene.glb", kind: "model3d" });
  });
});

describe("demo mode", () => {
  async function demo(model: ModelDef) {
    const route = model.routes[0];
    const sub = await mockProvider.submit({ generationId: "g", model, route, input: { prompt: "", images: ["still.png"], aspectRatio: "16:9" } });
    const meta = { ...sub.meta, startedAt: 0 };
    const res = await mockProvider.poll({ externalId: sub.externalId, meta, route, model, createdAt: 0 });
    if (res.state !== "succeeded") throw new Error(res.state);
    return res.outputs;
  }

  const png = (o: { url: string }) => decodePng(Buffer.from(o.url.split(",")[1], "base64"));

  it("makes a 16:9 depth map painted like Marigold's (Spectral, red = near) that the point cloud reads the right way round", async () => {
    const outs = await demo(getModel("marigold-depth")!);
    expect(outs).toHaveLength(1);
    expect(outs[0]).toMatchObject({ kind: "image", contentType: "image/png", meta: { role: "depth", demo: true } });
    const map = png(outs[0]);
    expect(map.width).toBe(512);
    expect(map.height).toBe(288);
    expect(depthEncoding(map)).toBe("spectral");
    // The floor nearest at the bottom, the wall far at the top.
    const photo = { width: 64, height: 36, data: new Uint8ClampedArray(64 * 36 * 4).fill(128) };
    const cloud = buildPointCloud(photo, map, { hFov: 74, near: 1, far: 6 });
    const z = (x: number, y: number) => -cloud.positions[(y * 64 + x) * 3 + 2];
    expect(z(4, 35)).toBeLessThan(1.5);
    expect(z(4, 0)).toBeGreaterThan(5);
  });

  it("makes the demo mesh and its grey depth map (bright = near) for the open engine", async () => {
    const outs = await demo(getModel("oss-scene-moge")!);
    expect(outs.map((o) => [o.kind, o.meta?.role])).toEqual([
      ["model3d", "scene"],
      ["image", "depth"],
    ]);
    const map = png(outs[1]);
    expect(depthEncoding(map)).toBe("grey");
    const grey = (x: number, y: number) => map.data[(y * map.width + x) * 4];
    expect(grey(4, map.height - 1)).toBeGreaterThan(grey(4, 0) + 100);
  });
});
