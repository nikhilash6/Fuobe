import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { Document, NodeIO } from "@gltf-transform/core";
import { describe, expect, it, vi } from "vitest";
import { FINISH_FILES, finishProblem, PREVIEW_FILES } from "@/lib/finish-ticket";
import { modelPreview } from "@/lib/output-actions";
import { preview3dOf, previewFormatOf, type Preview3d } from "@/lib/preview3d";
import type { OutputFile } from "@/lib/catalog/types";
import { tempDir } from "./helpers/temp-dir";
import * as core from "../scripts/model3d/preview3d-core.mjs";
import { PREVIEW_FILES as WORKER_PREVIEW_FILES } from "../bin/lib/worker/finish.mjs";

vi.setConfig({ testTimeout: 120_000 });
const dir = tempDir("fuobe-preview3d-");
process.env.FUOBE_DATA_DIR = dir;
process.env.FUOBE_PREVIEWS_3D = "1";
const { previewSettings, previewTargets, tickPreviews } = await import("@/server/model3d-preview");
const { saveFile } = await import("@/server/storage");
const { db } = await import("@/server/db");

const ffmpegOk = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout?.includes("libx264") ?? false;

/** A unit cube on the floor (y 0..1) with a red top and a blue body, as a binary glTF. */
async function cubeGlb(): Promise<Uint8Array> {
  const doc = new Document();
  const buf = doc.createBuffer();
  const p: number[] = [];
  const n: number[] = [];
  const idx: number[] = [];
  const faces: [number[], number[], number[]][] = [
    [[0, 1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, -1, 0], [1, 0, 0], [0, 0, -1]],
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  for (const [nn, u, v] of faces) {
    const base = p.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      p.push(0.5 * (nn[0] + a * u[0] + b * v[0]), 0.5 + 0.5 * (nn[1] + a * u[1] + b * v[1]), 0.5 * (nn[2] + a * u[2] + b * v[2]));
      n.push(...nn);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const mat = doc.createMaterial("m").setBaseColorFactor([0.2, 0.3, 0.9, 1]).setMetallicFactor(0).setRoughnessFactor(0.6);
  const prim = doc
    .createPrimitive()
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(p)).setBuffer(buf))
    .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(n)).setBuffer(buf))
    .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(idx)).setBuffer(buf))
    .setMaterial(mat);
  doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(prim)));
  return new NodeIO().writeBinary(doc);
}

/** A .spz (version 2) of a column of Gaussians, red at its top in the file's own frame. */
function columnSpz(yDown: boolean): Buffer {
  const count = 400;
  const head = Buffer.alloc(16);
  head.writeUInt32LE(0x5053474e, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(count, 8);
  head[12] = 0;
  head[13] = 12;
  const pos = Buffer.alloc(count * 9);
  const alpha = Buffer.alloc(count, 240);
  const color = Buffer.alloc(count * 3);
  const scale = Buffer.alloc(count * 3, Math.round((Math.log(0.04) + 10) * 16));
  const rot = Buffer.alloc(count * 3, 128);
  for (let i = 0; i < count; i++) {
    const h = i / (count - 1); // 0 at the foot, 1 at the head
    const y = (yDown ? -1 : 1) * h * 1.8;
    const put = (v: number, at: number) => {
      const q = Math.round(v * 4096) & 0xffffff;
      pos[at] = q & 255;
      pos[at + 1] = (q >> 8) & 255;
      pos[at + 2] = (q >> 16) & 255;
    };
    put(Math.cos(i) * 0.2, i * 9);
    put(y, i * 9 + 3);
    put(Math.sin(i) * 0.2, i * 9 + 6);
    // Red at the head, blue at the foot (colour bytes: 0.5 + dc * 0.15 scaled to a byte).
    const red = h > 0.8;
    color[i * 3] = red ? 255 : 60;
    color[i * 3 + 1] = 60;
    color[i * 3 + 2] = red ? 60 : 255;
  }
  return zlib.gzipSync(Buffer.concat([head, pos, alpha, color, scale, rot]));
}

describe("3D previews", () => {
  it("a preview3d ticket is checked like every finish ticket, and both sides name its files the same", () => {
    const ok = { v: 1, kind: "preview3d", settings: { format: "glb", yDown: false, frontYaw: 90, cutoff: 0 }, inputs: [{ slot: "model", name: "fuobe_abcdefgh1234.glb", sha256: "a".repeat(64) }] };
    expect(finishProblem(ok)).toBeNull();
    expect(finishProblem({ ...ok, settings: { ...ok.settings, format: "obj" } })).toMatch(/format/);
    expect(finishProblem({ ...ok, settings: { ...ok.settings, cutoff: 2 } })).toMatch(/cutoff/);
    expect(finishProblem({ ...ok, settings: { ...ok.settings, extra: 1 } })).toMatch(/setting/);
    expect(WORKER_PREVIEW_FILES).toEqual(PREVIEW_FILES);
    expect(Object.keys(FINISH_FILES.preview3d).sort()).toEqual(Object.keys(PREVIEW_FILES).sort());
  });

  it("knows which 3D files it draws, and reads a finished preview only", () => {
    const glb: OutputFile = { url: "/api/files/a.glb", kind: "model3d", contentType: "model/gltf-binary" };
    expect(previewFormatOf(glb)).toBe("glb");
    expect(previewFormatOf({ url: "/api/files/a.spz", kind: "model3d", contentType: "model/x-spz" })).toBe("spz");
    expect(previewFormatOf({ url: "/api/files/a.ply", kind: "model3d" })).toBe("ply");
    expect(previewFormatOf({ url: "/api/files/a.ksplat", kind: "model3d" })).toBeNull();
    expect(previewFormatOf({ url: "/api/files/a.png", kind: "image" })).toBeNull();
    const done: Preview3d = { state: "done", at: 1, poster: { light: "/p-l.webp", dark: "/p-d.webp" }, clip: { light: "/c-l.mp4", dark: "/c-d.mp4" } };
    expect(preview3dOf({ ...glb, meta: { preview3d: done } })?.clip.dark).toBe("/c-d.mp4");
    expect(preview3dOf({ ...glb, meta: { preview3d: { ...done, state: "queued" } } })).toBeNull();
    expect(preview3dOf({ ...glb, meta: { preview3d: { ...done, poster: { light: "/p-l.webp" } } } })).toBeNull();
    // Every tile that reads a model's still and turntable gets the preview's first.
    expect(modelPreview({ outputs: [{ ...glb, meta: { preview3d: done } }] }, { ...glb, meta: { preview3d: done } })).toEqual({ poster: "/p-l.webp", video: "/c-l.mp4" });
  });

  it("picks the model outputs that still need one, and draws each the way its viewer stands it", () => {
    const outs: OutputFile[] = [
      { url: "/a.glb", kind: "model3d", contentType: "model/gltf-binary", assetId: "a" },
      { url: "/b.glb", kind: "model3d", contentType: "model/gltf-binary", assetId: "b", meta: { finish: { turntable: "done" } } },
      { url: "/c.glb", kind: "model3d", contentType: "model/gltf-binary", assetId: "c", meta: { finish: { turntable: "rendering" } } },
      { url: "/d.spz", kind: "model3d", assetId: "d", meta: { preview3d: { state: "done", at: 1 } } },
      { url: "/e.spz", kind: "model3d", assetId: "e", meta: { finish: { turntable: "skipped: no browser" } } },
      { url: "/f.png", kind: "image", assetId: "f" },
    ];
    expect(previewTargets(outs)).toEqual([0, 4]);
    // ComfyUI's splats are y down and face +x (splatPose); Idol's haze is left out; a cloud .ply stands as it is.
    expect(previewSettings({ provider: "comfyui", model_id: "oss-idol" }, outs[4])).toMatchObject({ format: "spz", yDown: true, frontYaw: 90 });
    expect(previewSettings({ provider: "fal", model_id: "fal-x" }, { url: "/x.ply", kind: "model3d" })).toMatchObject({ format: "ply", yDown: false, frontYaw: 0, cutoff: 0 });
    expect(previewSettings({ provider: "comfyui", model_id: "oss-idol-mesh" }, outs[0])).toMatchObject({ format: "glb", frontYaw: 90 });
  });

  it("draws a mesh centred, on the floor, and the same at the end of its turn as at the start (a loop with no seam)", async () => {
    const glb = core.readGlb(await cubeGlb());
    const mesh = core.meshOf(glb, []);
    const light = core.studioLight({ width: 8, height: 4, data: new Float32Array(8 * 4 * 3).fill(1) });
    const cyl = core.meshCylinder(mesh);
    const view = { cyl, frame: core.frameCylinder(cyl) };
    const a = core.drawMesh(mesh, light, view, 0, { size: 96 });
    const b = core.drawMesh(mesh, light, view, 2 * Math.PI, { size: 96 });
    let covered = 0, sx = 0, sy = 0, diff = 0;
    for (let i = 0; i < 96 * 96; i++) {
      diff += Math.abs(a[i * 4] - b[i * 4]) + Math.abs(a[i * 4 + 3] - b[i * 4 + 3]);
      if (a[i * 4 + 3] === 255) {
        covered++;
        sx += i % 96;
        sy += Math.floor(i / 96);
      }
    }
    expect(covered).toBeGreaterThan(96 * 96 * 0.1);
    expect(Math.abs(sx / covered - 48)).toBeLessThan(6);
    expect(Math.abs(sy / covered - 48)).toBeLessThan(10);
    expect(diff / (96 * 96)).toBeLessThan(1);
  });

  it("stands a y-down splat upright, its head at the top of the frame", () => {
    for (const yDown of [true, false]) {
      const s = core.readSpz(columnSpz(yDown), zlib.gunzipSync);
      const sp = core.prepareSplat(s, { yDown });
      const view = { cyl: sp.cyl, frame: core.frameCylinder(sp.cyl) };
      const px = core.drawSplat(sp, view, 0, { size: 96, shadow: 0 });
      let redY = 0, redN = 0, blueY = 0, blueN = 0;
      for (let i = 0; i < 96 * 96; i++) {
        if (px[i * 4 + 3] < 128) continue;
        const y = Math.floor(i / 96);
        if (px[i * 4] > px[i * 4 + 2]) {
          redY += y;
          redN++;
        } else {
          blueY += y;
          blueN++;
        }
      }
      expect(redN).toBeGreaterThan(0);
      expect(redY / redN).toBeLessThan(blueY / blueN);
    }
  });

  it.skipIf(!ffmpegOk)("renders the clips and stills, and the server keeps them on the model output (drawn here without workers)", async () => {
    const data = Buffer.from(await cubeGlb());
    const asset = saveFile({ data, contentType: "model/gltf-binary", name: "model.glb", source: "generation", generationId: "g-cube" });
    const outputs: OutputFile[] = [{ url: asset.url, kind: "model3d", contentType: "model/gltf-binary", assetId: asset.id }];
    const now = Date.now();
    db()
      .prepare(
        "INSERT INTO generations (id, feature, model_id, engine, provider, op, kind, status, request_json, outputs_json, created_at, updated_at, completed_at) VALUES ('g-cube', 'image-to-3d', 'fal-trellis', 'cloud', 'fal', 'image-to-3d', 'model3d', 'succeeded', ?, ?, ?, ?, ?)",
      )
      .run(JSON.stringify({ feature: "image-to-3d", modelId: "fal-trellis", op: "image-to-3d" }), JSON.stringify(outputs), now, now, now);
    tickPreviews(now + 60_000);
    const read = () => (JSON.parse((db().prepare("SELECT outputs_json FROM generations WHERE id = 'g-cube'").get() as { outputs_json: string }).outputs_json) as OutputFile[])[0];
    expect((read().meta?.preview3d as Preview3d).state).toBe("drawing");
    const end = Date.now() + 100_000;
    while ((read().meta?.preview3d as Preview3d).state === "drawing" && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
    const p = preview3dOf(read());
    expect(p).not.toBeNull();
    const file = (url: string) => path.join(dir, "files", ...url.replace(/^\/api\/files\//, "").split("/"));
    for (const u of [p!.poster.light, p!.poster.dark, p!.clip.light, p!.clip.dark]) expect(fs.existsSync(file(u)) || u.startsWith("/api/files/")).toBe(true);
    // Once made, never again.
    tickPreviews(Date.now() + 120_000);
    expect(preview3dOf(read())?.clip.light).toBe(p!.clip.light);
  });
});
