import { describe, expect, it } from "vitest";
import { CURVE_SETS, CURVES, FIXED_CURVES, type CurveName } from "@/lib/motion/ease";
import {
  applyPreset,
  dropTrackKey,
  groupsOf,
  keyIndexAt,
  moveTrackKey,
  PRESETS,
  presetOf,
  putTrackKey,
  rateLimits,
  retime,
  setValue,
  shapeKeys,
  shotWindows,
  SHAPES,
  tidyRecipe,
  trackValue,
  warpOf,
  MIN_EVENT,
  TRACK_KEYS_MAX,
  TRACKS_MAX,
  type PresetCategory,
} from "@/lib/motion/edit";
import { groupDefsFor } from "@/lib/motion/kinetic-groups";
import { GroupTimingSchema, normalizeRecipe, RECIPE_MAX_BYTES, RecipeSchema, TRACK_IDS, TRACK_LIMITS, type Recipe } from "@/lib/motion/recipe";
import { loadScene } from "@/lib/motion/registry";
import { showcaseRecipe } from "@/lib/motion/showcase";
import { textNodes } from "@/lib/motion/display";
import { TEMPLATES } from "@/lib/catalog/marketing";
import { measure, RASTER_LOGO } from "./helpers/motion";

// Kinetic's editor on the timeline: warps, rates, group edits that move nothing else, presets, curve sets and tracks.

/** A small seeded random for the property checks. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function randomKeys(r: () => number): [number, number][] {
  const n = 2 + Math.floor(r() * 7);
  const us = [0, ...Array.from({ length: n - 2 }, () => 0.02 + r() * 0.96).sort((a, b) => a - b), 1];
  const ps = [0, ...Array.from({ length: n - 2 }, () => r()).sort((a, b) => a - b), 1];
  const keys: [number, number][] = us.map((u, i) => [u, ps[i]]);
  // Strictly rising u.
  return keys.filter((k, i) => i === 0 || k[0] > keys[i - 1][0]);
}

const plan = async (r: Recipe) => (await loadScene(r.scene)).plan({ recipe: r, measure, logo: r.brand.logo ? RASTER_LOGO : null, images: { product: { w: 800, h: 1024 } }, outlines: { product: null } });

const code = TEMPLATES.filter((t) => t.render === "code");
const showcases = () => code.map((t) => showcaseRecipe(t.id, t.scene!, t.lengths?.default ?? 5)!);

describe("warps", () => {
  it("are monotone, start at 0 and end at 1 for random valid keys", () => {
    const r = prng(7);
    for (let n = 0; n < 200; n++) {
      const keys = randomKeys(r);
      const w = warpOf(keys);
      expect(w(0)).toBe(0);
      expect(w(1)).toBe(1);
      let prev = 0;
      for (let i = 0; i <= 200; i++) {
        const v = w(i / 200);
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = v;
      }
    }
  });

  it("the identity keys change nothing, and every suggested shape is valid", () => {
    const w = warpOf([
      [0, 0],
      [1, 1],
    ]);
    for (const u of [0, 0.1, 0.5, 0.93, 1]) expect(w(u)).toBe(u);
    for (const s of SHAPES) {
      const k = shapeKeys(s.id);
      expect(GroupTimingSchema.safeParse({ keys: k, rate: 1 }).success, s.id).toBe(true);
    }
  });
});

describe("motion groups", () => {
  it("a group edit never moves another group's events, the cuts, the words, the length or the last frame", async () => {
    for (const base of showcases()) {
      const before = await plan(base);
      const windows = shotWindows(before);
      const groups = groupsOf(groupDefsFor(base.scene), before.timeline.events, windows).filter((g) => !g.camera && !groupDefsFor(base.scene).find((d) => d.id === g.id)?.inner);
      for (const g of groups) {
        const lim = rateLimits(g, windows, before.rest);
        for (const rate of [lim.min, lim.max]) {
          const r: Recipe = { ...base, groups: { [g.id]: { keys: shapeKeys("in-out"), rate } } };
          const after = await plan(r);
          expect(after.cuts, `${base.scene} ${g.id}`).toEqual(before.cuts);
          expect(after.rest).toBe(before.rest);
          expect(JSON.stringify(after.evaluate(after.rest))).toBe(JSON.stringify(before.evaluate(before.rest)));
          expect(textNodes(after.evaluate(after.rest).nodes).map((t) => JSON.stringify(t.runs))).toEqual(textNodes(before.evaluate(before.rest).nodes).map((t) => JSON.stringify(t.runs)));
          const mine = new Set(g.events.map((e) => e.id));
          for (const e of before.timeline.events) {
            const x = after.timeline.byId.get(e.id)!;
            if (!mine.has(e.id)) expect([x.start, x.dur], `${base.scene} ${g.id} moved ${e.id}`).toEqual([e.start, e.dur]);
            else {
              expect(x.dur).toBeGreaterThanOrEqual(Math.min(e.dur, MIN_EVENT) - 1e-9);
              // Inside its shot, and a second before the last frame (unless the design itself ends later).
              const end = x.start + x.dur;
              const own = Math.max(...g.events.map((y) => y.start + y.dur));
              expect(end).toBeLessThanOrEqual(Math.max(Math.min(windows[g.window][1], before.rest - 1), own) + 1e-6);
            }
          }
        }
      }
    }
  });

  it("retime gives back the same events without timing", async () => {
    const base = showcases()[1];
    const p = await plan(base);
    const w = shotWindows(p);
    const g = groupsOf(groupDefsFor(base.scene), p.timeline.events, w);
    expect(retime(p.timeline.events, undefined, g, w, p.rest)).toBe(p.timeline.events);
    expect(retime(p.timeline.events, { number: { keys: shapeKeys("even"), rate: 1 } }, g, w, p.rest)).toBe(p.timeline.events);
  });
});

describe("presets", () => {
  const base = showcases()[1];
  it("at most 4 per category, 15 values each, all in their own category, the first the identity", () => {
    for (const [cat, list] of Object.entries(PRESETS) as [PresetCategory, (typeof PRESETS)["motion"]][]) {
      expect(list.length).toBeLessThanOrEqual(4);
      const prefix = cat === "appearance" ? "finish." : `${cat}.`;
      for (const p of list) {
        expect(Object.keys(p.values).length).toBeLessThanOrEqual(15);
        for (const k of Object.keys(p.values)) expect(k.startsWith(prefix), `${p.id} ${k}`).toBe(true);
      }
      expect(presetOf(cat, base)).toBe(list[0].id);
      expect(tidyRecipe(applyPreset(cat, list[0].id, base))).toEqual(base);
    }
  });

  it("a manual change reads Custom, and picking the preset again restores it", () => {
    const film = applyPreset("appearance", "film", base);
    expect(presetOf("appearance", film)).toBe("film");
    const moved = setValue(film, "finish.contrast", 0.2);
    expect(presetOf("appearance", moved)).toBe("custom");
    expect(applyPreset("appearance", "film", moved)).toEqual(film);
    expect(presetOf("camera", setValue(base, "camera.amount", 1.5))).toBe("custom");
  });
});

describe("curve sets", () => {
  it("every swapped curve runs from 0 to 1 with no NaN, and the fixed curves are never swapped", () => {
    for (const [id, set] of Object.entries(CURVE_SETS)) {
      for (const [name, f] of Object.entries(set) as [CurveName, (u: number) => number][]) {
        expect(FIXED_CURVES.includes(name), `${id} swaps ${name}`).toBe(false);
        expect(f(0)).toBeCloseTo(0, 9);
        expect(f(1)).toBeCloseTo(1, 9);
        for (let i = 0; i <= 1000; i++) expect(Number.isNaN(f(i / 1000))).toBe(false);
      }
    }
    expect(Object.keys(CURVE_SETS.smooth)).toHaveLength(0);
    expect(Object.keys(CURVES).length).toBeGreaterThan(5);
  });
});

describe("camera moves come home", () => {
  it("every move at amounts 0, 1 and 2 gives the home camera on the last frame", async () => {
    for (const base of showcases()) {
      const home = await plan(base);
      const rest = JSON.stringify(home.evaluate(home.rest));
      for (const move of ["scene", "locked", "push", "drift", "rise"] as const) {
        for (const amount of [0, 1, 2]) {
          const p = await plan({ ...base, camera: { move, amount } });
          expect(JSON.stringify(p.evaluate(p.rest)), `${base.scene} ${move} ${amount}`).toBe(rest);
        }
      }
    }
  });

  it("with camera tracks, the last frame and the still frame after it are equal", async () => {
    const base = showcases()[1];
    const r = putTrackKey(putTrackKey(base, "camera.zoom", 0, 1, base.fps)!, "camera.zoom", base.duration, 1.1, base.fps)!;
    const p = await plan(r);
    expect(JSON.stringify(p.evaluate(p.rest))).toBe(JSON.stringify(p.evaluate(p.rest + 1)));
    expect(JSON.stringify(p.evaluate(p.rest))).not.toBe(JSON.stringify((await plan(base)).evaluate(p.rest)));
  });
});

describe("tracks", () => {
  const base = showcases()[1];
  it("sample, hold before and after, and rate about the first key", () => {
    const tr = { keys: [{ t: 1, v: 0 }, { t: 3, v: 1, ease: "linear" as const }], rate: 1 };
    expect(trackValue(tr, 0)).toBe(0);
    expect(trackValue(tr, 5)).toBe(1);
    expect(trackValue(tr, 2)).toBeCloseTo(0.5, 6);
    expect(trackValue({ ...tr, rate: 2 }, 2)).toBeCloseTo(1, 6);
  });

  it("keys go in at the playhead, are found within half a frame, move and drop", () => {
    let r = putTrackKey(base, "finish.grain", 1, 0.05, 30)!;
    r = putTrackKey(r, "finish.grain", 2, 0.5, 30)!;
    expect(r.tracks!["finish.grain"]!.keys.map((k) => k.v)).toEqual([0.05, 0.1]);
    expect(keyIndexAt(r.tracks!["finish.grain"], 2 + 0.4 / 30, 30)).toBe(1);
    expect(keyIndexAt(r.tracks!["finish.grain"], 2 + 0.6 / 30, 30)).toBe(-1);
    r = moveTrackKey(r, "finish.grain", 0, 5, 30);
    expect(r.tracks!["finish.grain"]!.keys[0].t).toBeCloseTo(2 - 1 / 30, 4);
    r = dropTrackKey(dropTrackKey(r, "finish.grain", 0), "finish.grain", 0);
    expect(r.tracks).toBeUndefined();
  });

  it("at most 8 tracks of 16 keys, and the largest recipe stays under 64 KB", () => {
    let r: Recipe = base;
    for (let i = 0; i < TRACK_KEYS_MAX; i++) r = putTrackKey(r, "camera.zoom", i * 0.25, 1, 30)!;
    expect(putTrackKey(r, "camera.zoom", 4.5, 1, 30)).toBeNull();
    for (const id of TRACK_IDS) r = putTrackKey(r, id, 0, 0, 30) ?? r;
    expect(Object.keys(r.tracks!)).toHaveLength(TRACKS_MAX);
    const big: Recipe = {
      ...r,
      layers: { video: { src: "/api/files/a.mp4", from: 0, fit: "cover", dim: 0.2, scrim: "bottom" } },
      tracks: Object.fromEntries(TRACK_IDS.map((id) => [id, { keys: Array.from({ length: 16 }, (_, i) => ({ t: i * 0.3, v: TRACK_LIMITS[id][0], ease: "move" as const })), rate: 1 }])),
      groups: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`g${i}`, { keys: Array.from({ length: 8 }, (_, j) => [j / 7, j / 7] as [number, number]), rate: 1.5 }])),
    };
    expect(RecipeSchema.safeParse(big).success).toBe(true);
    expect(JSON.stringify(big).length).toBeLessThan(RECIPE_MAX_BYTES);
    expect(() => normalizeRecipe(big)).not.toThrow();
  });
});
