import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { themeFrom } from "@/components/ads/layout";
import { textNodes, type DisplayNode } from "@/lib/motion/display";
import { toLab } from "@/lib/motion/color";
import { loadScene } from "@/lib/motion/registry";
import type { SceneInput } from "@/lib/motion/scene";
import { endCardRest } from "@/lib/motion/scenes/end-card/shared";
import { ghostTone } from "@/lib/motion/scenes/marketing/poster";
import { showcaseRecipe } from "@/lib/motion/showcase";
import { TILE_COVER, TILE_CHIPS } from "@/lib/motion/sizes";
import { measure, RASTER_LOGO } from "./helpers/motion";

// Cover and type rules: the brand's fonts are loaded in every weight a template sets (a cover measured before its
// face arrives draws off-centre), the end card's stack is centred on the frame at the gallery tile's size, small facts
// never type on letter by letter, ghost type stays a faint step off its ground, and a subhead never ends a line on a
// little joining word.

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");

describe("cover and type rules", () => {
  it("loads every weight a template sets brand type in (the end card's product line and tag are 600)", () => {
    const fonts = src("src/components/motion/fonts.ts");
    const list = /export const FONT_WEIGHTS = \[([^\]]+)\]/.exec(fonts)![1].split(",").map((w) => Number(w.trim()));
    const used = [...src("src/lib/motion/scenes/end-card/shared.ts").matchAll(/family: t\.(?:heading|body), weight: (\d+)/g)].map((m) => Number(m[1]));
    expect(used.length).toBeGreaterThan(0);
    for (const w of used) expect(list, `weight ${w}`).toContain(w);
  });

  it("centres the end card's stack on the frame at the gallery tile's size, the tag's words in the middle of the tag", () => {
    const theme = themeFrom({ colors: ["#0e3b2f", "#cfae6e"], fonts: { heading: "Cormorant Garamond", body: "Manrope" } });
    const r = endCardRest({ theme, content: { brand: "Aurèle", product: "Le Sérum Nuit", cta: "Discover the ritual", website: "aurele-paris.com" }, logo: { w: 1400, h: 360 }, measure, size: { ...TILE_COVER }, colors: ["#0e3b2f", "#cfae6e"], clear: { top: TILE_COVER.h * TILE_CHIPS.top, bottom: TILE_COVER.h * TILE_CHIPS.bottom } });
    const W = TILE_COVER.w;
    expect(r.logo!.x + r.logo!.w / 2).toBeCloseTo(W / 2, 3);
    for (const b of [r.headline, r.site!]) {
      expect(b.cx).toBeCloseTo(W / 2, 3);
      for (const l of b.layout.lines) expect(Math.abs(measure(l.text, b.layout.font) - l.width)).toBeLessThanOrEqual(2);
    }
    const tag = r.cta!;
    expect(tag.x + tag.w / 2).toBeCloseTo(W / 2, 3);
    expect(tag.label.cx).toBeCloseTo(tag.x + tag.w / 2, 3);
  });

  it("never types small facts letter by letter in a Kinetic template", () => {
    const dir = "src/lib/motion/scenes/marketing";
    for (const f of readdirSync(join(root, dir))) expect(src(`${dir}/${f}`), f).not.toContain('"type-on"');
  });

  it("keeps ghost type a faint step (0.05 or less in lightness) off its ground, in the ground's own hue", () => {
    for (const g of ["#0b0f19", "#1b1446", "#6b1d2a", "#f5efea", "#e9ecf5", "#2372ef"]) {
      const d = Math.abs(toLab(ghostTone(g)).L - toLab(g).L);
      expect(d, g).toBeGreaterThan(0.02);
      expect(d, g).toBeLessThanOrEqual(0.05);
    }
  });

  it("never ends a subhead's line on a little joining word, on the gallery cover or any size (Prism Stage)", async () => {
    const scene = await loadScene("marketing/glass-spotlight");
    const weak = /^(a|an|the|of|for|to|in|on|at|by|and|or|with|from)$/i;
    for (const cover of [true, false]) {
      const recipe = showcaseRecipe("m2-prism-stage", "marketing/glass-spotlight", 5, { cover })!;
      const input: SceneInput = { recipe, measure, logo: RASTER_LOGO, images: { product: { w: 320, h: 614 } }, outlines: {} };
      const plan = scene.plan(input);
      const lines = new Map<number, string[]>();
      const walk = (ns: readonly DisplayNode[]) => {
        for (const n of textNodes(ns)) {
          if (n.field !== "line" || n.decor) continue;
          for (const run of n.runs) lines.set(Math.round(run.y), [...(lines.get(Math.round(run.y)) ?? []), run.text]);
        }
      };
      walk(plan.evaluate(plan.rest).nodes);
      const rows = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t.join(" ").trim().split(/\s+/));
      expect(rows.length).toBeGreaterThan(0);
      rows.slice(0, -1).forEach((words) => expect(weak.test(words[words.length - 1]), words.join(" ")).toBe(false));
    }
  });
});
