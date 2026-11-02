import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { themeFrom } from "@/components/ads/layout";
import { planEndCard } from "@/components/marketing/end-card";
import { textNodes, type TextRun } from "@/lib/motion/display";
import { loadScene, SCENE_IDS } from "@/lib/motion/registry";
import { spelled } from "@/lib/motion/layout";
import type { Scene } from "@/lib/motion/scene";
import { END_CARD_VARIANTS, endCardFrom } from "@/lib/motion/scenes/end-card/shared";
import { designSize, type SizeSpec } from "@/lib/motion/sizes";
import { DURATION_LIMITS, STAGGER_LIMITS } from "@/lib/motion/tween";
import { input, measure, RASTER_LOGO, recipe, SVG_LOGO, allNodes } from "./helpers/motion";

// Every registered scene: determinism under any order of seeks, exact spelling, the timing rules, and (for the end
// card) a rest frame that is the still card's own layout.

const scenes: Scene[] = await Promise.all(SCENE_IDS.map(loadScene));
const SIZES: SizeSpec[] = [{ w: 720, h: 1280 }, "9:16", "1:1", "16:9", "4:5"];
const cp = (...c: number[]) => String.fromCodePoint(...c);

describe("the registry", () => {
  it("has the five end-card styles", () => {
    expect(SCENE_IDS.sort()).toEqual(END_CARD_VARIANTS.map((v) => `end-card/${v}`).sort());
    for (const s of scenes) expect(s.durations).toEqual({ min: 2, max: 3, default: 2.5 });
  });
});

describe("determinism (motion-determinism)", () => {
  it("gives the same display list at a time whatever was asked before, for every scene and size", () => {
    for (const scene of scenes) {
      for (const size of SIZES) {
        for (const logo of [RASTER_LOGO, SVG_LOGO, null]) {
          const r = recipe(scene.id, { size });
          const a = scene.plan(input(r, logo));
          const b = scene.plan(input(r, logo));
          const times = Array.from({ length: 40 }, (_, i) => (i / 39) * r.duration);
          const forward = times.map((t) => JSON.stringify(a.evaluate(t)));
          // Backward, then 200 shuffled seeks on a second plan.
          for (let i = times.length - 1; i >= 0; i--) expect(JSON.stringify(a.evaluate(times[i]))).toBe(forward[i]);
          for (let k = 0; k < 200; k++) {
            const i = (k * 37 + 11) % times.length;
            expect(JSON.stringify(b.evaluate(times[i])), `${scene.id} ${JSON.stringify(size)} t=${times[i]}`).toBe(forward[i]);
          }
          expect(a.design).toEqual(designSize(size));
        }
      }
    }
  });

  it("never reads a clock, Math.random or the page in the pure core", () => {
    const root = path.join(process.cwd(), "src/lib/motion");
    const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : [path.join(dir, d.name)]));
    for (const f of files(root)) {
      const src = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/Math\.random|Date\.now|new Date|performance\.|requestAnimationFrame|document\.|window\.|"use client"/);
    }
  });
});

describe("spelling (motion-spelling)", () => {
  const hostile = ["iPhone® 15 — 20 % off!", `ÉCOLE ${cp(0xfb01)} ligature`, `${cp(0x1f469, 0x200d, 0x1f469, 0x200d, 0x1f467)} family`, "العربية", "  two  spaces  ", "Q", "Barrier Cream for very dry skin"];
  const fieldsOf = (runs: TextRun[]) => spelled(runs);

  it("sets every field exactly as typed at rest, and never draws a letter that wasn't typed", () => {
    for (const scene of scenes) {
      for (const text of hostile) {
        for (const field of ["product", "cta", "brand", "website"] as const) {
          const r = recipe(scene.id, { fields: { ...recipe(scene.id).fields, [field]: text } });
          // The brand's name shows only without a logo.
          const plan = scene.plan(input(r, field === "brand" ? null : RASTER_LOGO));
          if (plan.overflow.length) continue;
          const rest = textNodes(plan.evaluate(plan.rest).nodes);
          const node = rest.find((n) => n.field === field);
          expect(node, `${scene.id} ${field}`).toBeDefined();
          expect(fieldsOf(node!.runs), `${scene.id} ${field} "${text}"`).toBe(text.trim());
          for (let i = 0; i <= 30; i++) {
            const t = (i / 30) * r.duration;
            for (const n of textNodes(plan.evaluate(t).nodes)) {
              const typed = r.fields[n.field] ?? "";
              for (const run of n.runs) expect(typed.includes(run.text), `${scene.id} t=${t} "${run.text}" not in "${typed}"`).toBe(true);
            }
          }
        }
      }
    }
  });

  it("never upper-cases the brand's name (the still card doesn't either)", () => {
    const theme = themeFrom({ colors: ["#6b1d2a"] });
    const still = planEndCard({ theme, content: { brand: "maison ardent", product: "Cream" }, logo: null, measure });
    expect(still.brand!.lines).toEqual(["maison ardent"]);
    for (const scene of scenes) {
      const plan = scene.plan(input(recipe(scene.id, { fields: { brand: "maison ardent", product: "Cream" } }), null));
      expect(spelled(textNodes(plan.evaluate(plan.rest).nodes).find((n) => n.field === "brand")!.runs)).toBe("maison ardent");
    }
  });

  it("names a field that doesn't fit instead of cutting it", () => {
    const long = "An extraordinarily long product name that keeps going well past what two lines can hold on any card";
    for (const scene of scenes) expect(scene.plan(input(recipe(scene.id, { fields: { brand: "B", product: long } }))).overflow).toEqual(["product"]);
  });
});

describe("timing (motion-timing)", () => {
  it("keeps every entrance 350–700 ms, nothing under 200 ms, staggers in range, settled with a 1 s hold", () => {
    for (const scene of scenes) {
      for (const duration of [2, 2.5, 3]) {
        for (const logo of [RASTER_LOGO, SVG_LOGO, null]) {
          const r = recipe(scene.id, { duration });
          const plan = scene.plan(input(r, logo));
          const events = plan.timeline.events;
          expect(events.length).toBeGreaterThan(2);
          for (const e of events) {
            const [lo, hi] = DURATION_LIMITS[e.kind];
            expect(e.dur, `${scene.id} ${e.id} ${duration}s`).toBeGreaterThanOrEqual(lo - 1e-9);
            expect(e.dur, `${scene.id} ${e.id} ${duration}s`).toBeLessThanOrEqual(hi + 1e-9);
            expect(e.start + e.dur).toBeLessThanOrEqual(plan.settled + 1e-9);
            // A style may already be a few frames into its motion on its first frame (never more than 0.15 s).
            expect(e.start).toBeGreaterThanOrEqual(-0.15);
          }
          const groups = new Map<string, number[]>();
          for (const e of events) if (e.group) groups.set(e.group, [...(groups.get(e.group) ?? []), e.start]);
          for (const [g, starts] of groups) {
            const unit = events.find((e) => e.group === g)!.unit!;
            const [lo, hi] = STAGGER_LIMITS[unit];
            for (let i = 1; i < starts.length; i++) {
              const gap = starts[i] - starts[i - 1];
              expect(gap, `${scene.id} ${g}`).toBeGreaterThanOrEqual(lo - 1e-6);
              expect(gap, `${scene.id} ${g}`).toBeLessThanOrEqual(hi + 1e-6);
            }
          }
          expect(duration - plan.settled, `${scene.id} ${duration}s hold`).toBeGreaterThanOrEqual(1);
          // The last frame is the rest frame; through the hold only the camera moves, coming home on the last frame.
          expect(plan.rest).toBeCloseTo((Math.round(duration * r.fps) - 1) / r.fps, 9);
          const still = plan.evaluate(plan.rest);
          for (const t of [plan.settled + 0.01, (plan.settled + plan.rest) / 2, plan.rest - 1 / r.fps]) {
            const held = plan.evaluate(t);
            expect(held.nodes).toHaveLength(1);
            const cam = held.nodes[0];
            expect(cam.type === "group" && cam.id === "camera" && JSON.stringify(cam.children)).toBe(JSON.stringify(still.nodes));
          }
          expect(JSON.stringify(plan.evaluate(duration))).toBe(JSON.stringify(still));
          expect(plan.still(plan.rest)).toBe(true);
          expect(plan.still(plan.settled)).toBe(false);
        }
      }
    }
  });

  it("opens on a ground that stands apart from the brand colour, even for a dark kit", () => {
    for (const colors of [["#6b1d2a", "#e9d8b4"], ["#1e3a8a"], ["#f5d90a", "#141414"]]) {
      for (const id of ["end-card/iris", "end-card/glint"]) {
        const plan = scenes.find((s) => s.id === id)!.plan(input(recipe(id, { brand: { name: "x", colors, fonts: {} } })));
        expect(plan.evaluate(0.02).background.toLowerCase(), `${id} ${colors}`).not.toBe(endCardFrom(recipe(id, { brand: { name: "x", colors, fonts: {} } })).theme.accent.toLowerCase());
      }
    }
  });

  it("moves something between the start and rest (in-between frames differ)", () => {
    for (const scene of scenes) {
      const plan = scene.plan(input(recipe(scene.id)));
      const frames = [0.1, 0.4, 0.8].map((t) => JSON.stringify(plan.evaluate(t * plan.settled)));
      expect(new Set(frames).size, scene.id).toBe(3);
    }
  });

  it("is readable by 0.95 s of a 2.5 s card: every piece in place but a passing light", () => {
    for (const scene of scenes) {
      for (const logo of [RASTER_LOGO, SVG_LOGO, null]) {
        const plan = scene.plan(input(recipe(scene.id), logo));
        for (const e of plan.timeline.events) if (e.id !== "glint") expect(e.start + e.dur, `${scene.id} ${e.id}`).toBeLessThanOrEqual(0.95 + 1e-9);
      }
    }
  });

  it("cuts in on movement: the first frame already shows the style under way", () => {
    for (const scene of scenes) {
      const plan = scene.plan(input(recipe(scene.id, { size: "9:16" })));
      const first = plan.evaluate(0);
      expect(allNodes(first).length, scene.id).toBeGreaterThan(0);
      // Some event is already part-way on the first frame.
      expect(plan.timeline.events.some((e) => e.start < 0), scene.id).toBe(true);
      if (scene.id === "end-card/rise") {
        const panel = allNodes(first).find((n) => n.type === "rect" && n.id === "panel");
        expect(panel && panel.type === "rect" && panel.y <= first.h * 0.85).toBe(true);
      }
      if (scene.id === "end-card/iris") {
        const iris = allNodes(first).find((n) => n.type === "ellipse" && n.id === "iris");
        expect(iris && iris.type === "ellipse" && iris.rx >= Math.hypot(first.w, first.h) * 0.08).toBe(true);
      }
    }
  });

  it("gives each style a telling moment for the chooser, inside the card", () => {
    for (const scene of scenes) {
      const plan = scene.plan(input(recipe(scene.id)));
      expect(plan.signature, scene.id).toBeDefined();
      expect(plan.signature!).toBeGreaterThan(0);
      expect(plan.signature!).toBeLessThan(plan.settled);
    }
  });
});

describe("the rest frame is the still card (motion-rest-frame)", () => {
  it("puts the logo, the words and the pill where planEndCard does, within half a unit", () => {
    for (const scene of scenes) {
      for (const logo of [RASTER_LOGO, null]) {
        const r = recipe(scene.id);
        const plan = scene.plan(input(r, logo));
        const { theme, content } = endCardFrom(r);
        const still = planEndCard({ theme, content, logo, measure, size: plan.design });
        const rest = plan.evaluate(plan.rest);
        expect(rest.background).toBe(still.bg);
        const nodes = allNodes(rest);
        if (logo) {
          const img = nodes.find((n) => n.type === "image")!;
          expect(img.type === "image" && [img.x, img.y, img.w, img.h].map((v, i) => Math.abs(v - [still.logo!.x, still.logo!.y, still.logo!.w, still.logo!.h][i]) <= 0.5).every(Boolean), scene.id).toBe(true);
        }
        const pill = nodes.find((n) => n.type === "rect" && n.id === "cta.pill");
        expect(pill && pill.type === "rect" && Math.abs(pill.x - still.cta!.x) <= 0.5 && Math.abs(pill.y - still.cta!.y) <= 0.5 && Math.abs(pill.w - still.cta!.w) <= 0.5).toBe(true);
        const texts = textNodes(rest.nodes);
        const boxes = { product: still.headline, cta: still.cta!.text, website: still.body!, brand: still.brand };
        for (const [field, box] of Object.entries(boxes)) {
          if (!box) continue;
          const runs = texts.find((n) => n.field === field)!.runs;
          expect(runs.map((x) => x.text)).toEqual(box.lines);
          runs.forEach((run, i) => {
            const top = box.y + i * box.lineHeight + (box.lineHeight - box.size) / 2;
            expect(Math.abs(run.y - top), `${scene.id} ${field}`).toBeLessThanOrEqual(0.5);
            expect(Math.abs(run.x + measure(run.text, run.font) / 2 - box.x), `${scene.id} ${field}`).toBeLessThanOrEqual(0.5);
            expect(run.font).toBe(box.font);
          });
        }
      }
    }
  });

  it("reads on the brand colour: words in the readable ink, the pill's label in contrast", () => {
    const r = recipe("end-card/draw-on", { brand: { name: "x", colors: ["#f5d90a"], fonts: {} } });
    const { theme } = endCardFrom(r);
    expect(theme.onAccent).toBe("#141414");
  });
});
