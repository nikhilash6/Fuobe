import { describe, expect, it } from "vitest";
import { IDENTITY, multiply, type DisplayList, type DisplayNode, type Matrix } from "@/lib/motion/display";
import { graphemes } from "@/lib/motion/layout";
import { loadScene, SCENE_IDS } from "@/lib/motion/registry";
import type { Scene } from "@/lib/motion/scene";
import type { SizeSpec } from "@/lib/motion/sizes";
import { input, measure, RASTER_LOGO, recipe, SVG_LOGO } from "./helpers/motion";

// No jumps (motion-continuity): wherever a style changes how it draws a piece (letters to whole lines, a moving group
// to the settled card, the settled card to the last frame), every letter, the logo and the pill stay where they were
// within 1 unit. Checked for every style, size and kind of mark, across every frame and every event's edges.

// The end card's five styles (Marketing's scenes have their own checks: motion-marketing.test.ts).
const END_CARD_IDS = SCENE_IDS.filter((id) => id.startsWith("end-card/"));
const scenes: Scene[] = await Promise.all(END_CARD_IDS.map(loadScene));
const SIZES: SizeSpec[] = ["9:16", "1:1", "16:9", "4:5"];

const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Every placed piece by a stable key: each typed letter (by its place in its field), the logo, the pill. */
function pieces(list: DisplayList): Map<string, [number, number]> {
  const out = new Map<string, [number, number]>();
  const count = new Map<string, number>();
  const walk = (nodes: readonly DisplayNode[], m: Matrix) => {
    for (const n of nodes) {
      if (n.type === "group") walk(n.children, n.transform ? multiply(m, n.transform) : m);
      else if (n.type === "image") out.set(`image:${n.src}`, apply(m, n.x, n.y));
      else if (n.type === "rect" && n.id === "cta.pill") out.set("pill", apply(m, n.x + n.w / 2, n.y + n.h / 2));
      else if (n.type === "text") {
        for (const run of n.runs) {
          const rm = run.transform ? multiply(m, run.transform) : m;
          for (const g of graphemes(run.text)) {
            if (/^\s+$/.test(g.text)) continue;
            const font = run.font;
            const x = run.x + measure(run.text.slice(0, g.index + g.text.length), font) - measure(g.text, font);
            const k = count.get(n.field) ?? 0;
            count.set(n.field, k + 1);
            out.set(`${n.field}:${k}`, apply(rm, x, run.y));
          }
        }
      }
    }
  };
  walk(list.nodes, IDENTITY);
  return out;
}

function jump(a: DisplayList, b: DisplayList): { key: string; d: number } {
  const pa = pieces(a);
  const pb = pieces(b);
  let worst = { key: "", d: 0 };
  for (const [key, p] of pa) {
    const q = pb.get(key);
    if (!q) continue;
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d > worst.d) worst = { key, d };
  }
  return worst;
}

describe("no jumps (motion-continuity)", () => {
  it("never moves a letter, the logo or the pill by more than 1 unit in an instant", () => {
    const fields = [
      { brand: "Halden & Rowe", product: "The Overcoat, in Loden Wool", cta: "Shop the collection", website: "haldenrowe.com" },
      { brand: "Aurèle", product: "Le Sérum Nuit", cta: "Discover the ritual", website: "aurele.com" },
    ];
    for (const scene of scenes) {
      for (const size of SIZES) {
        for (const logo of [RASTER_LOGO, SVG_LOGO, null]) {
          for (const f of fields) {
            const r = recipe(scene.id, { size, fps: 25, fields: f });
            const plan = scene.plan(input(r, logo));
            const edges = plan.timeline.events.flatMap((e) => [e.start, e.start + e.dur]);
            const times = [...Array.from({ length: Math.round(r.duration * r.fps) }, (_, i) => i / r.fps), ...edges, plan.settled, plan.rest].filter((t) => t >= 0 && t <= r.duration);
            for (const t of times) {
              for (const [a, b] of [
                [t - 1e-5, t],
                [t, t + 1e-5],
              ]) {
                if (a < 0) continue;
                const j = jump(plan.evaluate(a), plan.evaluate(b));
                expect(j.d, `${scene.id} ${size} ${logo?.kind ?? "no logo"} "${f.brand}" ${j.key} at ${a.toFixed(5)}→${b.toFixed(5)}`).toBeLessThanOrEqual(1);
              }
            }
          }
        }
      }
    }
  });
});
