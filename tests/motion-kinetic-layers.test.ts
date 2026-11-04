import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@/lib/catalog/marketing";
import { videoNodeOf } from "@/lib/motion/display";
import { cssFilter, finishAt, gradePixels, grainOffset, grainTile, neutralFinish } from "@/lib/motion/finish";
import { entryBySlug, startRecipe } from "@/lib/motion/kinetic-catalog";
import { normalizeRecipe, recipeKey, RecipeSchema, type Recipe } from "@/lib/motion/recipe";
import { loadScene } from "@/lib/motion/registry";
import { showcaseRecipe } from "@/lib/motion/showcase";
import { exportBitrate } from "@/lib/motion/sizes";
import { clipBox, clipTime } from "@/lib/motion/video-layer";
import { measure, RASTER_LOGO } from "./helpers/motion";

// The recipe's new layers: old recipes still read, the finish (grade and grain), the clip under the words, and the
// preview modes never reaching a saved file.

const CLIP = { w: 1920, h: 1080, duration: 2 };
const layer = { src: "/api/files/clip.mp4", from: 0.5, fit: "cover" as const, dim: 0.3, scrim: "bottom" as const };
const plan = async (r: Recipe, clip = true) => (await loadScene(r.scene)).plan({ recipe: r, measure, logo: RASTER_LOGO, ...(clip && { clips: { clip: CLIP } }) });

describe("recipe compatibility", () => {
  it("every phase 1 and 2 recipe still parses and normalises unchanged", () => {
    for (const t of TEMPLATES.filter((x) => x.render === "code")) {
      const r = showcaseRecipe(t.id, t.scene!, t.lengths?.default ?? 5)!;
      expect(normalizeRecipe(r)).toEqual(r);
      expect(RecipeSchema.parse(r)).toEqual(r);
    }
    const card: Recipe = { v: 1, scene: "end-card/glint", seed: 1, size: { w: 720, h: 1280 }, fps: 25, duration: 2.5, fields: { brand: "Aurèle", product: "Le Sérum" }, brand: { name: "Aurèle", colors: ["#123456"], fonts: { heading: "Inter", body: "Inter" } }, export: { format: "mp4", blurSamples: 8, shutter: 180 } };
    expect(normalizeRecipe(card)).toEqual(card);
  });

  it("drops a clip on a scene that doesn't take one and unknown group ids, never failing", () => {
    const r = { ...startRecipe(entryBySlug("starburst")!), layers: { video: layer }, groups: { zzz: { keys: [[0, 0], [1, 1]] as [number, number][], rate: 2 } }, tracks: { "clip.dim": { keys: [{ t: 0, v: 0.2 }], rate: 1 } } };
    const out = normalizeRecipe(r, undefined, { clip: false, groups: ["burst"] });
    expect(out.layers).toBeUndefined();
    expect(out.groups).toBeUndefined();
    expect(out.tracks).toBeUndefined();
  });

  it("takes 60 fps and High quality within the size cap", () => {
    expect(RecipeSchema.safeParse({ ...startRecipe(entryBySlug("big-number")!), fps: 60 }).success).toBe(true);
    const std = exportBitrate("9:16", 5);
    expect(exportBitrate("9:16", 5, { fps: 60 })).toBe(Math.round(std * 1.5));
    expect(exportBitrate("9:16", 5, { quality: "high" })).toBe(Math.round(std * 1.6));
    expect(exportBitrate("9:16", 60, { fps: 60, quality: "high" })).toBeLessThanOrEqual(Math.floor((0.6 * 95 * 1024 * 1024 * 8) / 60));
  });
});

describe("the finish", () => {
  const base = startRecipe(entryBySlug("big-number")!);
  it("a neutral finish is the identity", () => {
    expect(finishAt(base, 1)).toBeNull();
    expect(finishAt({ ...base, finish: { contrast: 0, saturation: 0, grain: 0, grainSize: 2 } }, 1)).toBeNull();
    expect(cssFilter({ contrast: 0, saturation: 0 })).toBe("none");
    const px = new Uint8ClampedArray([10, 200, 90, 255]);
    gradePixels(px, { contrast: 0, saturation: 0 });
    expect([...px]).toEqual([10, 200, 90, 255]);
    expect(neutralFinish({ contrast: 0, saturation: 0, grain: 0 })).toBe(true);
  });

  it("the pixel pass follows the filter formulas (contrast about mid grey, saturate's matrix)", () => {
    const px = new Uint8ClampedArray([200, 100, 50, 255]);
    gradePixels(px, { contrast: 0.2, saturation: 0 });
    expect([...px.slice(0, 3)]).toEqual([Math.round(((200 / 255 - 0.5) * 1.2 + 0.5) * 255), Math.round(((100 / 255 - 0.5) * 1.2 + 0.5) * 255), Math.round(((50 / 255 - 0.5) * 1.2 + 0.5) * 255)]);
    const grey = new Uint8ClampedArray([200, 100, 50, 255]);
    gradePixels(grey, { contrast: 0, saturation: -1 });
    const l = 0.213 * 200 + 0.715 * 100 + 0.072 * 50;
    for (const c of grey.slice(0, 3)) expect(Math.abs(c - l)).toBeLessThanOrEqual(1);
    expect(cssFilter({ contrast: 0.08, saturation: -0.05 })).toBe("contrast(1.0800) saturate(0.9500)");
  });

  it("grain is the same for the same seed and frame, and differs between frames", () => {
    expect(grainTile(7)).toEqual(grainTile(7));
    expect(grainTile(7)).not.toEqual(grainTile(8));
    expect(grainOffset(7, 3)).toEqual(grainOffset(7, 3));
    expect(grainOffset(7, 3)).not.toEqual(grainOffset(7, 4));
    const f = finishAt({ ...base, finish: { grain: 0.03 } }, 1)!;
    expect(f.frame).toBe(30);
    expect(finishAt({ ...base, finish: { grain: 0.03 } }, 1.5)!.frame).toBe(45);
  });

  it("a finish track replaces the slider's value", () => {
    const r: Recipe = { ...base, finish: { contrast: 0.1 }, tracks: { "finish.contrast": { keys: [{ t: 0, v: 0.3 }], rate: 1 } } };
    expect(finishAt(r, 2)!.contrast).toBe(0.3);
  });
});

describe("the clip under the words", () => {
  const big: Recipe = { ...startRecipe(entryBySlug("big-number")!), layers: { video: layer } };
  it("draws the clip first, outside the camera, with no ground, its dim and its scrim", async () => {
    const p = await plan(big);
    const l = p.evaluate(1);
    const v = videoNodeOf(l)!;
    expect(v).toBeTruthy();
    expect(l.background).toBe("#000000");
    expect(l.nodes[1].type).toBe("rect");
    expect(l.nodes.find((n) => n.type === "group" && n.id === "camera")).toBeTruthy();
    expect(v.time).toBeCloseTo(1.5, 6);
    // Held on its last frame when the clip is shorter.
    expect(videoNodeOf(p.evaluate(p.rest))!.time).toBeLessThan(CLIP.duration);
    expect(videoNodeOf(p.evaluate(p.rest))!.time).toBeGreaterThan(CLIP.duration - 0.01);
  });

  it("cover fills and crops, contain shows all of it", () => {
    expect(clipBox({ w: 1920, h: 1080 }, { w: 1080, h: 1920 }, "cover")).toEqual({ x: (1080 - 1920 * (1920 / 1080)) / 2, y: 0, w: 1920 * (1920 / 1080), h: 1920 });
    const c = clipBox({ w: 1920, h: 1080 }, { w: 1080, h: 1920 }, "contain");
    expect(c.w).toBe(1080);
    expect(c.y).toBeGreaterThan(0);
    expect(clipTime({ from: 0.5 }, { duration: 10 }, 1.25)).toBe(1.75);
  });

  it("only the five clip scenes take a clip", async () => {
    const star = await plan({ ...startRecipe(entryBySlug("starburst")!), layers: { video: layer } });
    expect(videoNodeOf(star.evaluate(1))).toBeUndefined();
    const none = await plan(big, false);
    expect(videoNodeOf(none.evaluate(1))).toBeUndefined();
  });
});

describe("preview modes", () => {
  it("never reach the render or the recipe", () => {
    const render = fs.readFileSync(path.join(process.cwd(), "src/components/motion/render.ts"), "utf8");
    const recipe = fs.readFileSync(path.join(process.cwd(), "src/lib/motion/recipe.ts"), "utf8");
    for (const src of [render, recipe]) expect(src).not.toMatch(/previewMode|PreviewMode|PREVIEW_MODE|"balanced"|"sharp"/);
    const r = startRecipe(entryBySlug("big-number")!);
    expect(recipeKey(r)).toBe(recipeKey(JSON.parse(JSON.stringify(r))));
  });
});
