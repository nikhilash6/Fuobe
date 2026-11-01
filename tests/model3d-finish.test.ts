import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Document, getBounds, NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { getModel, getPreset } from "@/lib/catalog";
import { model3dRequest, model3dView, MODELS_3D, viewerGlb } from "@/lib/av/model3d";
import { modelPreview } from "@/lib/output-actions";
import type { OutputFile } from "@/lib/catalog/types";

vi.setConfig({ testTimeout: 120_000 });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-3d-finish-"));
process.env.FUOBE_DATA_DIR = dir;
const { saveFile } = await import("@/server/storage");
const { finishModel, lastJsonLine, modelToFinish, pendingTurntable, startTurntable, withTurntable } = await import("@/server/model3d-finish");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(f: () => T | undefined | null | false, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out waiting");
    await sleep(50);
  }
}

const root = process.cwd();
type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;
const graph = (id: string) => JSON.parse(fs.readFileSync(path.join(root, "workflows/comfyui", `${id}.json`), "utf8")) as Graph;
const manifest = JSON.parse(fs.readFileSync(path.join(root, "workflows/comfyui/manifest.json"), "utf8")) as { workflows: { id: string; bindings: Record<string, unknown>; outputs: { node: string; kind: string }[]; defaults: Record<string, unknown>; validated: boolean }[] };
const byClass = (g: Graph, c: string) => Object.entries(g).filter(([, n]) => n.class_type === c);
const one = (g: Graph, c: string) => {
  const found = byClass(g, c);
  expect(found, c).toHaveLength(1);
  return found[0];
};
const link = (v: unknown) => (Array.isArray(v) ? String(v[0]) : null);

describe("image-to-3D graphs", () => {
  for (const id of ["image-to-3d-pixal3d", "image-to-3d-trellis2"]) {
    it(`${id}: remesh solid, decimate to 250k, bake from the dense mesh, no in-graph turntable`, () => {
      const g = graph(id);
      const [remeshId, remesh] = one(g, "RemeshMesh");
      expect(remesh.inputs).toMatchObject({ resolution: 768, sign_mode: "solid", "sign_mode.fill": 20, band: 1, smooth_iters: 20 });
      const [decId, dec] = one(g, "DecimateMesh");
      expect(dec.inputs).toMatchObject({ target_face_count: 250000, placement_mode: "midpoint" });
      expect(link(dec.inputs.mesh)).toBe(remeshId);
      // DecimateMesh sits between RemeshMesh and MeshSmoothNormals; the UVs are unwrapped on the decimated mesh.
      const [smoothId] = byClass(g, "MeshSmoothNormals").find(([, n]) => link(n.inputs.mesh) === decId)!;
      const [unwrapId, unwrap] = one(g, "UnwrapMesh");
      expect(link(unwrap.inputs.mesh)).toBe(smoothId);
      const [, normal] = one(g, "BakeNormalMapFromMesh");
      const [, ao] = one(g, "BakeAmbientOcclusion");
      expect(normal.inputs).toMatchObject({ resolution: 2048 });
      expect(ao.inputs).toMatchObject({ resolution: 1024 });
      for (const bake of [normal, ao]) {
        expect(link(bake.inputs.high_poly)).toBe(remeshId);
        expect(link(bake.inputs.low_poly)).toBe(unwrapId);
      }
      for (const c of ["RotateMesh", "RenderMesh", "CreateVideo", "SaveVideo"]) expect(byClass(g, c), c).toHaveLength(0);
      // Samplers as the template: structure 12, shape 20, upsample 12, texture 12; upsample to 1536.
      expect(byClass(g, "KSampler").map(([, n]) => n.inputs.steps).sort()).toEqual([12, 12, 12, 20]);
      expect(Number(one(g, "Trellis2UpsampleStage")[1].inputs.target_resolution)).toBe(1536);
      // The BiRefNet cut-out feeds the crop.
      const [cutId] = one(g, "RemoveBackground");
      expect(link(one(g, "ImageCropToMask")[1].inputs.masks)).toBe(cutId);

      const m = manifest.workflows.find((w) => w.id === id)!;
      expect(m.validated).toBe(true);
      expect(m.outputs).toEqual([{ node: "322", kind: "model3d" }]);
      expect(Object.keys(m.bindings).sort()).toEqual(["filenamePrefix", "image", "seed", "textureSize"]);
      expect(m.defaults).toEqual({ textureSize: 4096 });
    });
  }

  it("Pixal3D: MoGe-2 camera -> horizontal FOV -> Pixal3D conditioning, crop pad 1.1", () => {
    const g = graph("image-to-3d-pixal3d");
    const [loaderId, loader] = one(g, "LoadMoGeModel");
    expect(loader.inputs.model_name).toBe("moge_2_vitl_normal_fp16.safetensors");
    const [mogeId, moge] = one(g, "MoGeInference");
    expect(moge.inputs.resolution_level).toBe(9);
    expect(link(moge.inputs.moge_model)).toBe(loaderId);
    const [fovId, fov] = one(g, "MoGeGeometryToFOV");
    expect(fov.inputs).toMatchObject({ axis: "horizontal", unit: "degrees" });
    expect(link(fov.inputs.moge_geometry)).toBe(mogeId);
    const [, cond] = one(g, "Pixal3DConditioning");
    expect(link(cond.inputs.camera_angle_x)).toBe(fovId);
    expect(one(g, "UNETLoader")[1].inputs.unet_name).toBe("pixal3d_int8_convrot.safetensors");
    expect(one(g, "ImageCropToMask")[1].inputs).toMatchObject({ width: 1024, height: 1024, pad_factor: 1.1 });
    expect(byClass(g, "Trellis2Conditioning")).toHaveLength(0);
  });

  it("TRELLIS.2 (the fallback): its own UNet and conditioning, crop pad 1.0", () => {
    const g = graph("image-to-3d-trellis2");
    expect(one(g, "UNETLoader")[1].inputs.unet_name).toBe("trellis_2_int8_convrot.safetensors");
    expect(one(g, "ImageCropToMask")[1].inputs).toMatchObject({ width: 1024, height: 1024, pad_factor: 1 });
    expect(byClass(g, "Pixal3DConditioning")).toHaveLength(0);
    one(g, "Trellis2Conditioning");
  });
});

describe("image-to-3D routes", () => {
  it("Pixal3D is the default open model; TRELLIS.2 stays as the fallback", () => {
    expect(MODELS_3D.image.open.map((m) => m.id).slice(0, 2)).toEqual(["oss-pixal3d", "oss-trellis2"]);
    expect(model3dRequest({ engine: "open", photo: "p.png" }).modelId).toBe("oss-pixal3d");
    expect(model3dRequest({ engine: "open", photo: "p.png", modelId: "oss-trellis2" }).modelId).toBe("oss-trellis2");
    expect(getModel("oss-pixal3d")?.routes[0]).toMatchObject({ provider: "comfyui", endpoint: "image-to-3d-pixal3d", op: "image-to-3d" });
    expect(getModel("oss-trellis2")?.routes[0]).toMatchObject({ provider: "comfyui", endpoint: "image-to-3d-trellis2", op: "image-to-3d" });
    expect(getPreset("app-image-to-3d")?.open?.modelId).toBe("oss-pixal3d");
  });

  it("viewers load the web GLB; results made before it fall back to the original", () => {
    expect(viewerGlb({ url: "/api/files/raw.glb", meta: { web: "/api/files/web.glb" } })).toBe("/api/files/web.glb");
    expect(viewerGlb({ url: "/api/files/raw.glb" })).toBe("/api/files/raw.glb");
    expect(viewerGlb({ url: "/api/files/raw.glb", meta: { web: "" } })).toBe("/api/files/raw.glb");
    const request = model3dRequest({ engine: "open", photo: "/api/files/p.png" });
    const finished = model3dView({
      outputs: [
        { url: "/api/files/raw.glb", kind: "model3d", meta: { web: "/api/files/web.glb", poster: "/api/files/poster.webp" } },
        { url: "/api/files/turn.mp4", kind: "video", meta: { role: "turntable" } },
      ],
      request,
    });
    expect(finished).toMatchObject({ glb: "/api/files/raw.glb", web: "/api/files/web.glb", turntable: "/api/files/turn.mp4", poster: "/api/files/poster.webp" });
    // An old TRELLIS.2 result: its own 12 fps turntable, no web GLB.
    const old = model3dView({ outputs: [{ url: "/api/files/old.glb", kind: "model3d" }, { url: "/api/files/old.mp4", kind: "video", meta: { role: "turntable" } }], request });
    expect(old).toMatchObject({ glb: "/api/files/old.glb", web: "/api/files/old.glb", turntable: "/api/files/old.mp4" });
    // Gallery tiles play the turntable or show the poster, never the GLB.
    const mesh: OutputFile = { url: "/api/files/raw.glb", kind: "model3d", meta: { web: "/api/files/web.glb", poster: "/api/files/poster.webp" } };
    expect(modelPreview({ outputs: [mesh, { url: "/api/files/turn.mp4", kind: "video", meta: { role: "turntable" } }] }, mesh)).toEqual({
      poster: "/api/files/poster.webp",
      video: "/api/files/turn.mp4",
    });
  });

  it("the meshopt decoder is served from this origin, the same file as the installed package", () => {
    const vendored = fs.readFileSync(path.join(root, "public/vendor/meshopt_decoder.js"), "utf8");
    expect(vendored).toBe(fs.readFileSync(path.join(root, "node_modules/meshoptimizer/meshopt_decoder.cjs"), "utf8"));
    // A classic script (model-viewer loads it with a <script> tag): no ES module syntax.
    expect(vendored).not.toMatch(/^\s*export\s/m);
  });
});

describe("the server's 3D finish", () => {
  const glbOut = (o: Partial<OutputFile> = {}): OutputFile => ({ url: "/api/files/outputs/x.glb", kind: "model3d", contentType: "model/gltf-binary", assetId: "a1", ...o });

  it("finishes the GLB of image-to-3D jobs from ComfyUI only", () => {
    expect(modelToFinish({ provider: "comfyui", op: "image-to-3d" }, [glbOut()])).toBe(0);
    expect(modelToFinish({ provider: "comfyui", op: "image-to-3d" }, [{ url: "/v.mp4", kind: "video" }, glbOut()])).toBe(1);
    expect(modelToFinish({ provider: "mock", op: "image-to-3d" }, [glbOut()])).toBe(-1);
    expect(modelToFinish({ provider: "fal", op: "image-to-3d" }, [glbOut()])).toBe(-1);
    expect(modelToFinish({ provider: "comfyui", op: "scene-3d" }, [glbOut()])).toBe(-1);
    expect(modelToFinish({ provider: "comfyui", op: "image-to-3d" }, [glbOut({ meta: { finish: { version: 1 } } })])).toBe(-1);
    expect(modelToFinish({ provider: "comfyui", op: "image-to-3d" }, [glbOut({ contentType: "model/ply", url: "/x.ply" })])).toBe(-1);
  });

  it("reads the scripts' JSON result line", () => {
    expect(lastJsonLine("some log\n{\"a\":1}\n")).toEqual({ a: 1 });
    expect(lastJsonLine("no json")).toBeNull();
  });

  /** A textured box whose origin is off-centre (like Pixal3D's), with a given baked roughness / metallic. */
  async function boxGlb(file: string, rough: number, metal: number) {
    const doc = new Document();
    const buffer = doc.createBuffer();
    const p: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    // 6 faces, 4 vertices each, centred at (2, 3, -1), size 1.
    const faces = [
      [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
      [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
      [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
      [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
      [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
      [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    ];
    for (const [n, u, v] of faces) {
      const base = p.length / 3;
      for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        p.push(2 + 0.5 * (n[0] + su * u[0] + sv * v[0]), 3 + 0.5 * (n[1] + su * u[1] + sv * v[1]), -1 + 0.5 * (n[2] + su * u[2] + sv * v[2]));
        uv.push((su + 1) / 2, (sv + 1) / 2);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const prim = doc
      .createPrimitive()
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(p)).setBuffer(buffer))
      .setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(uv)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(idx)).setBuffer(buffer));
    const png = (r: number, g: number, b: number) => sharp({ create: { width: 64, height: 64, channels: 3, background: { r, g, b } } }).png().toBuffer();
    const material = doc
      .createMaterial()
      .setBaseColorTexture(doc.createTexture().setImage(new Uint8Array(await png(200, 150, 100))).setMimeType("image/png"))
      .setMetallicRoughnessTexture(doc.createTexture().setImage(new Uint8Array(await png(255, Math.round(rough * 255), Math.round(metal * 255)))).setMimeType("image/png"))
      .setMetallicFactor(1)
      .setRoughnessFactor(1);
    prim.setMaterial(material);
    doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
    await new NodeIO().write(file, doc);
  }

  async function readWeb(file: string) {
    await MeshoptDecoder.ready;
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder }).read(file);
    const mat = doc.getRoot().listMaterials()[0];
    const mr = mat.getMetallicRoughnessTexture()!;
    const { data, info } = await sharp(Buffer.from(mr.getImage()!)).raw().toBuffer({ resolveWithObject: true });
    const px = (k: number) => data[k];
    return {
      extensions: doc.getRoot().listExtensionsUsed().map((e) => e.extensionName).sort(),
      mime: mr.getMimeType(),
      bounds: getBounds(doc.getRoot().listScenes()[0]),
      rough: px(1) / 255,
      metal: px(2) / 255,
      channels: info.channels,
    };
  }

  const script = path.join(root, "scripts/model3d/finish-glb.mjs");
  const finishCli = (input: string, output: string, ...extra: string[]) => {
    const r = spawnSync(process.execPath, [script, "--in", input, "--out", output, ...extra], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
    return lastJsonLine<{ material: string; triangles: number; roughFloor: number; noMetal: boolean }>(r.stdout)!;
  };

  it("matte: roughness floor 0.8, metal off, pivot at the bottom centre, meshopt + WebP", async () => {
    const raw = path.join(dir, "matte.glb");
    const web = path.join(dir, "matte-web.glb");
    await boxGlb(raw, 0.25, 0);
    const stats = finishCli(raw, web);
    expect(stats).toMatchObject({ material: "matte", triangles: 12, roughFloor: 0.8, noMetal: true });
    const out = await readWeb(web);
    expect(out.extensions).toEqual(expect.arrayContaining(["EXT_meshopt_compression", "EXT_texture_webp"]));
    expect(out.mime).toBe("image/webp");
    expect(out.rough).toBeGreaterThanOrEqual(0.78);
    expect(out.metal).toBeLessThan(0.02);
    // center --pivot below: the bottom sits on y = 0, centred in x and z.
    expect(out.bounds.min[1]).toBeCloseTo(0, 2);
    expect((out.bounds.min[0] + out.bounds.max[0]) / 2).toBeCloseTo(0, 2);
    expect((out.bounds.min[2] + out.bounds.max[2]) / 2).toBeCloseTo(0, 2);
  });

  it("metal: no roughness floor, metal kept; a material can be forced", async () => {
    const raw = path.join(dir, "metal.glb");
    await boxGlb(raw, 0.1, 1);
    const web = path.join(dir, "metal-web.glb");
    expect(finishCli(raw, web)).toMatchObject({ material: "metal", roughFloor: 0, noMetal: false });
    const out = await readWeb(web);
    expect(out.rough).toBeLessThan(0.15);
    expect(out.metal).toBeGreaterThan(0.95);
    expect(finishCli(raw, path.join(dir, "forced.glb"), "--material", "matte")).toMatchObject({ material: "matte" });
  });

  it("finishModel adds the web GLB, keeps the raw GLB as the download and queues the turntable; no Chromium skips it, not a failure", async () => {
    const raw = path.join(dir, "job.glb");
    await boxGlb(raw, 0.3, 0);
    const asset = saveFile({ data: fs.readFileSync(raw), contentType: "model/gltf-binary", source: "generation", generationId: "g3d" });
    const before: OutputFile[] = [{ url: asset.url, kind: "model3d", contentType: asset.contentType, assetId: asset.id }];
    const messages: string[] = [];
    const after = await finishModel("g3d", before, { op: "image-to-3d", provider: "comfyui", onMessage: (m) => messages.push(m) });
    expect(after).toHaveLength(1);
    expect(after[0].url).toBe(asset.url);
    const meta = after[0].meta as { web: string; finish: { version: number; material: string; triangles: number; turntable: string; webAsset: string } };
    expect(meta.web).toMatch(/^\/api\/files\/.+\.glb$/);
    expect(meta.web).not.toBe(asset.url);
    expect(meta.finish).toMatchObject({ version: 2, material: "matte", triangles: 12, turntable: "queued" });
    expect(meta.finish.webAsset).toBeTruthy();
    // The job succeeds now; the turntable is rendered after.
    expect(messages).toEqual(["Finishing the 3D model"]);
    // Not finished twice.
    expect(modelToFinish({ provider: "comfyui", op: "image-to-3d" }, after)).toBe(-1);
    expect(pendingTurntable(after)).toBe(0);

    // The turntable step on a server without Chromium: skipped, stored on the finished job, nothing added.
    const saved = process.env.FUOBE_CHROMIUM;
    process.env.FUOBE_CHROMIUM = path.join(dir, "no-such-chromium.exe");
    let stored: OutputFile[] = after;
    const states: string[] = [];
    try {
      startTurntable("g3d", {
        read: () => stored,
        write: (o) => {
          stored = o;
          states.push(String((o[0].meta!.finish as { turntable: string }).turntable));
        },
      });
      await until(() => states.some((w) => w.startsWith("skipped")));
    } finally {
      if (saved === undefined) delete process.env.FUOBE_CHROMIUM;
      else process.env.FUOBE_CHROMIUM = saved;
    }
    expect(states[0]).toBe("rendering");
    expect(stored).toHaveLength(1);
    expect(stored[0].meta).toMatchObject({ web: meta.web });
    expect(pendingTurntable(stored)).toBe(-1);
  });

  it("a turntable for a job deleted meanwhile stores nothing; a missing web GLB says so", async () => {
    const writes: OutputFile[][] = [];
    const queued: OutputFile[] = [{ url: "/api/files/x.glb", kind: "model3d", assetId: "m-x", meta: { finish: { version: 2, turntable: "queued", webAsset: "no-such-asset" } } }];
    startTurntable("g-gone", { read: () => null, write: (o) => void writes.push(o) });
    await sleep(200);
    expect(writes).toEqual([]);
    let stored = queued;
    startTurntable("g-noweb", { read: () => stored, write: (o) => void (stored = o) });
    await until(() => pendingTurntable(stored) < 0);
    expect((stored[0].meta!.finish as { turntable: string }).turntable).toBe("failed: the web GLB is missing");
  });

  it("withTurntable: progress while rendering, then the video and the poster; an old in-graph turntable gives way", () => {
    const request = model3dRequest({ engine: "open", photo: "p.png" });
    const mesh: OutputFile = { url: "/api/files/raw.glb", kind: "model3d", assetId: "m1", meta: { web: "/api/files/web.glb", finish: { version: 2, material: "metal", turntable: "queued" } } };
    const old: OutputFile = { url: "/api/files/old.mp4", kind: "video", meta: { role: "turntable" } };
    expect(model3dView({ outputs: [mesh], request }).rendering).toEqual({ queued: true, progress: 0 });
    const rendering = withTurntable([mesh, old], "m1", { state: "rendering", progress: 0.4 });
    expect(rendering[0].meta).toMatchObject({ web: "/api/files/web.glb", finish: { version: 2, turntable: "rendering", turntableProgress: 0.4 } });
    expect(pendingTurntable(rendering)).toBe(0);
    expect(model3dView({ outputs: rendering, request }).rendering).toEqual({ queued: false, progress: 0.4 });
    const video: OutputFile = { url: "/api/files/turn.mp4", kind: "video", meta: { role: "turntable", fps: 24, frames: 96 } };
    const done = withTurntable(rendering, "m1", { state: "done", video, poster: "/api/files/poster.webp" });
    expect(done).toEqual([{ ...mesh, meta: { web: "/api/files/web.glb", poster: "/api/files/poster.webp", finish: { version: 2, material: "metal", turntable: "done" } } }, video]);
    expect(pendingTurntable(done)).toBe(-1);
    expect(model3dView({ outputs: done, request })).toMatchObject({ turntable: "/api/files/turn.mp4", poster: "/api/files/poster.webp", rendering: undefined, material: "metal" });
    // Another model output is left alone.
    expect(withTurntable([mesh], "other", { state: "done" })).toEqual([mesh]);
  });

  it("a GLB with no material, or one at the glTF defaults, becomes a matte dielectric (not three.js's dark metal)", async () => {
    const doc = new Document();
    const buffer = doc.createBuffer();
    const tri = () =>
      doc
        .createPrimitive()
        .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(buffer))
        .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array([0, 1, 2])).setBuffer(buffer));
    const bare = tri();
    const defaults = tri().setMaterial(doc.createMaterial("defaults"));
    const chosen = tri().setMaterial(doc.createMaterial("chosen").setMetallicFactor(1).setRoughnessFactor(0.2));
    doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(bare).addPrimitive(defaults).addPrimitive(chosen)));
    const raw = path.join(dir, "shape.glb");
    await new NodeIO().write(raw, doc);
    const web = path.join(dir, "shape-web.glb");
    expect(finishCli(raw, web)).toMatchObject({ material: "unknown" });
    await MeshoptDecoder.ready;
    const out = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.decoder": MeshoptDecoder }).read(web);
    const prims = out.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
    expect(prims.every((p) => !!p.getMaterial())).toBe(true);
    const mats = out.getRoot().listMaterials().map((m) => [m.getMetallicFactor(), m.getRoughnessFactor()]);
    // The bare and default ones are matte; one that was set on purpose is kept.
    expect(mats).toEqual(expect.arrayContaining([[0, 0.8], [1, 0.2]]));
    expect(mats).not.toContainEqual([1, 1]);
  });

  it("a GLB the script can't read keeps the raw result", async () => {
    const asset = saveFile({ data: Buffer.from("not a glb"), contentType: "model/gltf-binary", source: "generation", generationId: "g-bad" });
    const before: OutputFile[] = [{ url: asset.url, kind: "model3d", contentType: asset.contentType, assetId: asset.id }];
    const after = await finishModel("g-bad", before, { op: "image-to-3d", provider: "comfyui" });
    expect(after[0].url).toBe(asset.url);
    expect((after[0].meta as { web?: string }).web).toBeUndefined();
    expect((after[0].meta as { finish: { error: string } }).finish.error).toMatch(/^web GLB/);
  });
});
