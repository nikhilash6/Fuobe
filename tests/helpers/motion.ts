import type { DisplayList, DisplayNode } from "@/lib/motion/display";
import type { Recipe } from "@/lib/motion/recipe";
import type { LogoInfo, SceneInput } from "@/lib/motion/scene";

/** A stand-in for canvas text metrics: half the font size per UTF-16 unit (so every glyph has a width). */
export const measure = (text: string, font: string) => text.length * Number(/(\d+)px/.exec(font)![1]) * 0.5;

export const RASTER_LOGO: LogoInfo = { w: 800, h: 200, kind: "raster" };
export const SVG_LOGO: LogoInfo = {
  w: 200,
  h: 100,
  kind: "svg",
  viewBox: { x: 0, y: 0, w: 200, h: 100 },
  paths: [
    { d: "M10 10H90V90H10Z", m: [1, 0, 0, 1, 0, 0], length: 320 },
    { d: "M110 50A40 40 0 1 0 190 50A40 40 0 1 0 110 50Z", m: [1, 0, 0, 1, 0, 0], length: 251 },
    { d: "M0 95H200", m: [1, 0, 0, 1, 0, 0], length: 200 },
  ],
};

export function recipe(scene: string, over: Partial<Recipe> = {}): Recipe {
  return {
    v: 1,
    scene,
    seed: 7,
    size: { w: 720, h: 1280 },
    fps: 24,
    duration: 2.5,
    fields: { brand: "Maison Ardent", product: "Barrier Cream", cta: "Shop now", website: "maisonardent.com" },
    brand: { name: "Maison Ardent", colors: ["#6b1d2a", "#e9d8b4"], fonts: { heading: "Playfair Display", body: "Inter" } },
    export: { format: "mp4", blurSamples: 8, shutter: 180 },
    ...over,
  };
}

export const input = (r: Recipe, logo: LogoInfo | null = RASTER_LOGO): SceneInput => ({ recipe: r, measure, logo });

/** Every node in a list, depth first. */
export function walk(nodes: readonly DisplayNode[], out: DisplayNode[] = []): DisplayNode[] {
  for (const n of nodes) {
    out.push(n);
    if (n.type === "group") walk(n.children, out);
  }
  return out;
}

export const allNodes = (l: DisplayList) => walk(l.nodes);
