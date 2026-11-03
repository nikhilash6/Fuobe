import { describe, expect, it } from "vitest";
import { isCodeTemplate, TEMPLATES } from "@/lib/catalog/marketing";
import { IDENTITY, multiply, type DisplayNode, type Matrix } from "@/lib/motion/display";
import { loadScene } from "@/lib/motion/registry";
import type { ScenePlan } from "@/lib/motion/scene";
import { SHOWCASES, showcaseRecipe } from "@/lib/motion/showcase";
import { designSize, TILE_CHIPS, TILE_COVER } from "@/lib/motion/sizes";
import { measure, RASTER_LOGO } from "./helpers/motion";

// The covers of Marketing's code-drawn templates (scripts/kinetic/render-covers.mjs): each is made at the gallery
// tile's own shape, keeps its words and its picture clear of the tile's chips, and rests on a settled frame (nothing
// moving, nothing half in).

const CODE = TEMPLATES.filter(isCodeTemplate);

interface Item {
  kind: "text" | "image";
  what: string;
  alpha: number;
  /** A photograph laid to the frame's edge (it may run under the chips). */
  bleed?: boolean;
  box: { x0: number; y0: number; x1: number; y1: number };
}

const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function boxOf(m: Matrix, x: number, y: number, w: number, h: number) {
  const pts = [apply(m, x, y), apply(m, x + w, y), apply(m, x, y + h), apply(m, x + w, y + h)];
  return { x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) };
}

/** Every text run and picture, placed in design units, with the opacity it is drawn at. */
function items(nodes: readonly DisplayNode[], m: Matrix = IDENTITY, alpha = 1, out: Item[] = []): Item[] {
  for (const n of nodes) {
    const a = alpha * (n.opacity ?? 1);
    if (n.type === "group") items(n.children, n.transform ? multiply(m, n.transform) : m, a, out);
    else if (n.type === "text") {
      // Decorative copies (ghosts, glows, shadows) are not the words.
      if (n.decor) continue;
      for (const r of n.runs) {
        if (!r.text.trim()) continue;
        const size = Number(/(\d+(\.\d+)?)px/.exec(r.font)![1]);
        const rm = r.transform ? multiply(m, r.transform) : m;
        out.push({ kind: "text", what: `${n.field} "${r.text}"`, alpha: a * (r.opacity ?? 1), box: boxOf(rm, r.x, r.y, measure(r.text, r.font), size) });
      }
    } else if (n.type === "image" && !n.decor) out.push({ kind: "image", what: n.src, alpha: a, box: boxOf(m, n.x, n.y, n.w, n.h), bleed: !!n.bleed });
  }
  return out;
}

/** Where a cover rests, as render-covers.mjs sets it: a little before its `poster` event, else its last frame. */
function coverRest(id: string, plan: ScenePlan): number {
  const event = SHOWCASES[id].poster;
  if (!event) return plan.rest;
  const e = plan.timeline.events.find((x) => x.id === event);
  return e ? Math.max(0, Math.round((e.start - 0.08) * 100) / 100) : plan.rest;
}

const covers = await Promise.all(
  CODE.map(async (t) => {
    const recipe = showcaseRecipe(t.id, t.scene!, t.lengths?.default ?? t.duration ?? 5, { cover: true })!;
    const scene = await loadScene(recipe.scene);
    const plan = scene.plan({ recipe, measure, logo: RASTER_LOGO, images: recipe.media?.product ? { product: { w: 800, h: 1000 } } : undefined, outlines: {} });
    return { id: t.id, recipe, plan, rest: coverRest(t.id, plan) };
  }),
);

describe("a code-drawn template's cover", () => {
  it("is made at the gallery tile's shape, and its words fit", () => {
    for (const c of covers) {
      expect(c.recipe.size, c.id).toEqual(TILE_COVER);
      expect(c.plan.design, c.id).toEqual(designSize(TILE_COVER));
      expect(c.plan.overflow, c.id).toEqual([]);
    }
  });

  it("keeps its words and its picture clear of the tile's chips and inside the frame", () => {
    for (const c of covers) {
      const { w, h } = c.plan.design;
      const found = items(c.plan.evaluate(c.rest).nodes);
      expect(found.some((i) => i.kind === "text") || found.some((i) => i.what === "logo"), c.id).toBe(true);
      for (const i of found) {
        // A photograph laid to the edge is the ground: it runs under the chips (the words on it never do).
        if (i.bleed) continue;
        const tag = `${c.id} ${i.what}`;
        expect(i.box.y0, tag).toBeGreaterThanOrEqual(h * TILE_CHIPS.top - 1);
        expect(i.box.y1, tag).toBeLessThanOrEqual(h * (1 - TILE_CHIPS.bottom) + 1);
        expect(i.box.x0, tag).toBeGreaterThanOrEqual(-1);
        expect(i.box.x1, tag).toBeLessThanOrEqual(w + 1);
      }
    }
  });

  it("rests on a settled frame: no move under way, everything fully in, and still from the frame before", () => {
    for (const c of covers) {
      for (const e of c.plan.timeline.events) {
        if (e.kind === "camera") continue;
        const running = e.start < c.rest - 1e-6 && e.start + e.dur > c.rest + 1e-6;
        expect(running, `${c.id} ${e.id} runs ${e.start}-${e.start + e.dur} at ${c.rest}`).toBe(false);
      }
      const now = items(c.plan.evaluate(c.rest).nodes);
      // The cover's clip runs at 24 fps: the frame before it on the tile.
      const before = items(c.plan.evaluate(c.rest - 1 / 24).nodes);
      expect(before.map((i) => i.what), c.id).toEqual(now.map((i) => i.what));
      now.forEach((i, k) => {
        expect(i.alpha, `${c.id} ${i.what}`).toBe(1);
        const b = before[k].box;
        const moved = Math.max(Math.abs(b.x0 - i.box.x0), Math.abs(b.y0 - i.box.y0), Math.abs(b.x1 - i.box.x1), Math.abs(b.y1 - i.box.y1));
        expect(moved, `${c.id} ${i.what} moves ${moved.toFixed(2)} design px in the frame before its rest`).toBeLessThan(0.75);
      });
    }
  });

  it("keeps the template's own frame free of the tile's room (only its cover makes it)", async () => {
    for (const t of CODE) {
      const recipe = showcaseRecipe(t.id, t.scene!, 5)!;
      expect(recipe.controls?.cover, t.id).toBeUndefined();
      expect(typeof recipe.size, t.id).toBe("string");
    }
  });
});
