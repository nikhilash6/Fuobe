/**
 * Meshy 7 / 6 Retexture against fal's schema (meshy/v7/retexture and meshy/v6/retexture, fetched 2026-11-06):
 * - text_style_prompt: maxLength 800 ("Maximum 800 characters"; Meshy's own API: "up to 800 characters").
 * - enable_original_uv: default true; "If the model has no original UV, output quality may be reduced". A model without
 *   UVs (a vertex-coloured mesh) asks for new ones.
 * - image_style_url: max_file_size 20971520; .jpg, .jpeg, .png and .webp.
 */
import { describe, expect, it } from "vitest";
import { getModel } from "@/lib/catalog";
import { buildPayload } from "@/lib/catalog/payload";
import { glbHasUv, RETEXTURE_PROMPT_MAX, RETEXTURE_STYLE_MAX_BYTES, RETEXTURE_STYLE_TYPES, retextureRequest } from "@/lib/av/model3d";
import type { FieldMap, GenInput } from "@/lib/catalog/types";

const GLB_URL = "https://v3b.fal.media/files/b/test/in.glb";
const glb = (json: object) => {
  const j = new TextEncoder().encode(JSON.stringify(json));
  const chunk = new Uint8Array(Math.ceil(j.length / 4) * 4).fill(0x20);
  chunk.set(j);
  const out = new Uint8Array(20 + chunk.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, out.length, true);
  v.setUint32(12, chunk.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(chunk, 20);
  return out;
};
const body = (modelId: string, req: ReturnType<typeof retextureRequest>) => {
  const map = getModel(modelId)!.routes[0].map as FieldMap;
  return buildPayload(map, { prompt: req.prompt ?? "", model3d: req.inputs?.model3d, images: req.inputs?.images, extra: req.params?.extra } as GenInput);
};

describe("Meshy retexture follows fal's schema", () => {
  it("sends up to 800 characters of style words", () => {
    expect(RETEXTURE_PROMPT_MAX).toBe(800);
    for (const id of ["meshy-7-retexture", "meshy-6-retexture"]) {
      expect((getModel(id)!.routes[0].map as FieldMap).promptMax).toBe(800);
      const req = retextureRequest({ glb: GLB_URL, prompt: "y".repeat(900), model: id as never });
      expect(String(body(id, req).text_style_prompt)).toHaveLength(800);
    }
  });

  it("asks for new UVs only for a model without them", () => {
    expect(body("meshy-7-retexture", retextureRequest({ glb: GLB_URL, prompt: "oak", keepUv: false }))).toMatchObject({ enable_original_uv: false, enable_pbr: true });
    expect(body("meshy-7-retexture", retextureRequest({ glb: GLB_URL, prompt: "oak", keepUv: true }))).not.toHaveProperty("enable_original_uv");
    expect(body("meshy-7-retexture", retextureRequest({ glb: GLB_URL, prompt: "oak" }))).not.toHaveProperty("enable_original_uv");
    expect(body("meshy-6-retexture", retextureRequest({ glb: GLB_URL, prompt: "oak", size: "8k", keepUv: false }))).toMatchObject({ texture_resolution: "8k", enable_original_uv: false });
  });

  it("reads UVs from a GLB's JSON chunk", () => {
    expect(glbHasUv(glb({ asset: { version: "2.0" }, meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 } }] }] }))).toBe(true);
    expect(glbHasUv(glb({ asset: { version: "2.0" }, meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1 } }] }] }))).toBe(false);
    expect(glbHasUv(glb({ asset: { version: "2.0" }, meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 } }, { attributes: { POSITION: 2 } }] }] }))).toBe(false);
    expect(glbHasUv(glb({ asset: { version: "2.0" } }))).toBe(false);
    // Not a GLB, or only its first bytes: unknown, so fal's default stays.
    expect(glbHasUv(new TextEncoder().encode("ply\nformat binary_little_endian 1.0\nend_header\n"))).toBeUndefined();
    expect(glbHasUv(glb({ asset: { version: "2.0" }, meshes: [] }).subarray(0, 24))).toBeUndefined();
  });

  it("takes a style picture of 20 MB or less, as PNG, JPEG or WebP", () => {
    expect(RETEXTURE_STYLE_MAX_BYTES).toBe(20_971_520);
    expect(RETEXTURE_STYLE_TYPES.split(",")).toEqual(["image/png", "image/jpeg", "image/webp"]);
  });
});
