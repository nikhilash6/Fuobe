import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { GenInput } from "@/lib/catalog/types";
import type { ComfyWorkflow, ManifestWorkflow } from "@/lib/comfy";

// Body Double: every person's 3D body from a photo, motion capture from a clip (InstantHMR on ComfyUI), and Live in the
// browser. Everything here runs without a GPU or a ComfyUI.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-body-double-"));
process.env.FUOBE_DATA_DIR = tmp;
process.env.COMFYUI_URL = "http://comfy.test:8188";
const { prepareWorkflow } = await import("@/server/providers/comfyui");
const { getModel, getPreset } = await import("@/lib/catalog");
const { planGeneration } = await import("@/lib/catalog/plan");
const B = await import("@/lib/catalog/body-double");
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const LIBRARY = path.join(process.cwd(), "workflows/comfyui");
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(LIBRARY, f), "utf8"));
const manifest = read("manifest.json") as { workflows: ManifestWorkflow[] };
const entry = (id: string) => manifest.workflows.find((w) => w.id === id)!;
const plan = (r: Parameters<typeof planGeneration>[0]) => planGeneration(r, getModel, getPreset);

async function prepare(id: string, op: string, input: GenInput) {
  return prepareWorkflow(id, input, {
    generationId: "g",
    op: op as never,
    upload: async (_d, _t, name) => `up_${name}`,
    media: () => undefined,
    serverRam: async () => undefined,
  });
}
const at = (id: string, wf: ComfyWorkflow, key: string) => (entry(id).bindings[key] ?? []).map((t) => wf[t.node].inputs[t.input]);

describe("Body Double in the catalog", () => {
  it("is an Identity app with its own page, on the open engine only, with a look to pick", () => {
    const app = getPreset(B.BODY_DOUBLE.appId)!;
    expect(app.type).toBe("app");
    expect(app.name).toBe("Body Double");
    expect(app.category).toBe("Identity");
    expect(app.tool).toBe("body-double");
    expect(app.cloud).toBeNull();
    expect(app.open).toMatchObject({ modelId: "oss-body-double", op: "body-capture" });
    expect(app.openAlso).toEqual([{ modelId: "oss-body-double-video", op: "body-capture-video" }]);
    expect(app.options?.[0].choices.map((c) => c.value)).toEqual(["holo", "clay", "thermal", "ghost", "xray", "skeleton"]);
  });

  it("runs on two hidden open models, one per op, without a prompt", () => {
    const photo = getModel(B.BODY_DOUBLE.photoModel)!;
    const clip = getModel(B.BODY_DOUBLE.clipModel)!;
    for (const m of [photo, clip]) {
      expect(m.engine).toBe("open");
      expect(m.hidden).toBe(true);
      expect(m.options.promptless).toBe(true);
    }
    expect(photo.kind).toBe("image");
    expect(clip.kind).toBe("video");
    expect(photo.routes.map((r) => [r.op, r.endpoint])).toEqual([["body-capture", "body-double-photo-instanthmr"]]);
    expect(clip.routes.map((r) => [r.op, r.endpoint])).toEqual([["body-capture-video", "body-double-clip-instanthmr"]]);
  });

  it("plans a photo run and a clip run from the tool's requests, with the look as graph settings", () => {
    const p = plan(B.bodyDoubleRequest({ kind: "image", ref: "/api/files/a.png", look: "thermal" }));
    expect(p.model.id).toBe("oss-body-double");
    expect(p.op).toBe("body-capture");
    const c = plan(B.bodyDoubleRequest({ kind: "video", ref: "/api/files/a.mp4", look: "skeleton" }));
    expect(c.model.id).toBe("oss-body-double-video");
    expect(c.op).toBe("body-capture-video");
    expect(B.bodyDoubleRequest({ kind: "video", ref: "x", look: "skeleton" }).params?.extra).toEqual({ renderStyle: "scail", shader: "normals", opacity: 1 });
    // An unknown look is the default one.
    expect(B.bodyLook("sparkly").value).toBe("holo");
  });

  it("asks for a photo or a clip", () => {
    expect(() => plan({ ...B.bodyDoubleRequest({ kind: "image", ref: "x" }), inputs: {} })).toThrow("Add a photo with people in it");
    expect(() => plan({ ...B.bodyDoubleRequest({ kind: "video", ref: "x" }), inputs: {} })).toThrow("Add a clip of someone moving");
  });
});

describe("Body Double's graphs", () => {
  const PHOTO = "body-double-photo-instanthmr";
  const CLIP = "body-double-clip-instanthmr";

  it("are listed with their pack, their pinned files and their outputs, validated", () => {
    for (const id of [PHOTO, CLIP]) {
      const e = entry(id);
      expect(e.validated, id).toBe(true);
      expect(e.models.map((m) => m.file).sort()).toEqual(["instanthmr_medium.safetensors", "rt_detr_v4-x-hgnet_fp16.safetensors", "sam_3d_body_dinov3_int8_convrot.safetensors"]);
      for (const m of e.models) expect(m.url, m.file).toMatch(/^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[0-9a-f]{40}\//);
      expect(e.customNodes.map((c) => c.name)).toContain("ComfyUI-InstantHMR");
      expect(e.outputs.map((o) => [o.kind, o.role ?? null])).toEqual([[id === PHOTO ? "image" : "video", null], ["model3d", "body"], [id === PHOTO ? "image" : "video", "pose"]]);
    }
    const pins = read("model-pins.json") as Record<string, { sha256: string }>;
    for (const m of entry(PHOTO).models) expect(pins[m.url!]?.sha256, m.file).toMatch(/^[0-9a-f]{64}$/);
    const packs = read("packs.json") as Record<string, { commit: string }>;
    expect(packs["ComfyUI-InstantHMR"].commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("keep metadata out of saved clips", () => {
    const wf = read(`${CLIP}.json`) as ComfyWorkflow;
    for (const n of Object.values(wf)) if (n.class_type === "VHS_VideoCombine") expect(n.inputs.save_metadata).toBe(false);
  });

  it("bind the input, the look and the run's prefix", async () => {
    const { workflow } = await prepare(PHOTO, "body-capture", { images: ["photo.png"], extra: { renderStyle: "mesh", shader: "rainbow", opacity: 0.9 } } as GenInput);
    expect(at(PHOTO, workflow, "image")).toEqual(["photo.png"]);
    expect(at(PHOTO, workflow, "shader")).toEqual(["rainbow"]);
    expect(at(PHOTO, workflow, "opacity")).toEqual([0.9]);
    expect(at(PHOTO, workflow, "renderStyle")).toEqual(["mesh"]);
    const { workflow: clip } = await prepare(CLIP, "body-capture-video", { video: "clip.mp4", extra: { renderStyle: "scail", shader: "normals", opacity: 1 } } as GenInput);
    expect(at(CLIP, clip, "video")).toEqual(["clip.mp4"]);
    expect(at(CLIP, clip, "renderStyle")).toEqual(["scail"]);
    for (const p of at(CLIP, clip, "filenamePrefix")) expect(p).toBe("fuobe/g");
  });

  it("export a skinned body (body_mesh with the SAM 3D Body rig), never the simple stick figure", () => {
    for (const id of [PHOTO, CLIP]) {
      const wf = read(`${id}.json`) as ComfyWorkflow;
      const build = Object.values(wf).find((n) => n.class_type === "BuildPoseFile")!;
      expect(build.inputs["format"]).toBe("glb");
      expect(build.inputs["format.mesh_style"]).toBe("body_mesh");
      expect(wf[String((build.inputs.sam3d_body_model as [string, number])[0])].class_type).toBe("SAM3DBody_Loader");
    }
  });
});
