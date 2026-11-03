import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TEMPLATES } from "@/lib/catalog/marketing";
import { stableJson, type Recipe } from "@/lib/motion/recipe";
import { loadScene, SCENE_IDS } from "@/lib/motion/registry";
import { showcaseRecipe } from "@/lib/motion/showcase";
import { measure, RASTER_LOGO } from "./helpers/motion";

// Kinetic's editor adds optional recipe fields. A recipe without them (or with every one at its default: the first
// preset of each category, identity group timing and no tracks) must draw exactly what the scenes draw as designed:
// every scene, size and Easy choice at 12 times, the rest frame included. The fixture holds a hash of those display
// lists, written by UPDATE_MOTION_IDENTITY=1 when a scene's design changes (only ever from a checkout whose editor
// code is unchanged), so an editor change that moves a default frame fails here.

const FIXTURE = path.join(process.cwd(), "tests/fixtures/motion-identity.json");
const WRITE = process.env.UPDATE_MOTION_IDENTITY === "1";

const code = TEMPLATES.filter((t) => t.render === "code");

interface Case {
  key: string;
  recipe: Recipe;
}

function cases(): Case[] {
  const out: Case[] = [];
  for (const t of code) {
    const scenes = t.scene!.startsWith("end-card/") ? SCENE_IDS.filter((s) => s.startsWith("end-card/")) : [t.scene!];
    const groups = (t.easy ?? []).filter((g) => !g.scene);
    // Every combination of the template's own Easy choices.
    let combos: Record<string, string>[] = [{}];
    for (const g of groups) combos = combos.flatMap((c) => g.choices.map((ch) => ({ ...c, [g.id]: ch.id })));
    for (const scene of scenes) {
      for (const size of ["9:16", "1:1", "16:9", "4:5"] as const) {
        for (const c of combos) {
          const base = showcaseRecipe(t.id, scene, t.lengths?.default ?? 5)!;
          const recipe: Recipe = { ...base, scene, size, controls: { ...base.controls, ...c } };
          if (c.mark === "name") delete recipe.brand.logo;
          out.push({ key: `${t.id}|${scene}|${size}|${Object.entries(c).map(([k, v]) => `${k}=${v}`).join(",")}`, recipe });
        }
      }
    }
  }
  return out;
}

async function hashOf(r: Recipe): Promise<string> {
  const scene = await loadScene(r.scene);
  const plan = scene.plan({ recipe: r, measure, logo: r.brand.logo ? RASTER_LOGO : null, images: { product: { w: 800, h: 1024 } }, outlines: { product: null } });
  const h = createHash("sha1");
  for (let i = 0; i < 12; i++) h.update(stableJson(plan.evaluate((i / 11) * plan.rest)));
  h.update(stableJson(plan.timeline.events.map((e) => [e.id, e.start, e.dur])));
  return h.digest("hex").slice(0, 16);
}

/** Every editor field at its default value. */
function withDefaults(r: Recipe): Recipe {
  return {
    ...r,
    motion: { curves: "smooth" },
    finish: { contrast: 0, saturation: 0, grain: 0, grainSize: 1.2 },
    camera: { move: "scene", amount: 1, breath: 1 },
    look: { light: true },
    groups: { camera: { keys: [[0, 0], [1, 1]], rate: 1 } },
  };
}

describe("a recipe without the editor's changes draws exactly what its scene draws", () => {
  it("holds for every scene, size and Easy choice, at 12 times", async () => {
    const all = cases();
    expect(all.length).toBeGreaterThan(200);
    const got: Record<string, string> = {};
    for (const c of all) got[c.key] = await hashOf(c.recipe);
    if (WRITE) {
      fs.writeFileSync(FIXTURE, `${JSON.stringify(got, null, 0)}\n`);
      return;
    }
    const want = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Record<string, string>;
    expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
    for (const c of all) expect(got[c.key], c.key).toBe(want[c.key]);
    // Every editor field at its default changes nothing either.
    for (const c of all) expect(await hashOf(withDefaults(c.recipe)), `${c.key} with defaults`).toBe(want[c.key]);
  }, 180_000);
});
