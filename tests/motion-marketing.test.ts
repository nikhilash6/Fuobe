import { describe, expect, it } from "vitest";
import { contrast } from "@/components/ads/layout";
import { IDENTITY, multiply, textNodes, type DisplayList, type DisplayNode, type Matrix } from "@/lib/motion/display";
import { spelled } from "@/lib/motion/layout";
import { traceOutline } from "@/lib/motion/outline";
import type { Recipe } from "@/lib/motion/recipe";
import { loadScene, SCENE_IDS } from "@/lib/motion/registry";
import type { LogoInfo, Outline, Scene, SceneInput } from "@/lib/motion/scene";
import { counterLayout, counterNode, marked, safeArea } from "@/lib/motion/scenes/marketing/kit";
import { designSize, type SizeSpec } from "@/lib/motion/sizes";
import { DURATION_LIMITS, STAGGER_LIMITS } from "@/lib/motion/tween";
import { measure, RASTER_LOGO, SVG_LOGO } from "./helpers/motion";

// Marketing's code-drawn templates: every scene is deterministic, sets every field exactly as typed, keeps the timing
// rules and a held last second, keeps its words inside the safe area, and every word reads on what is behind it.

const MARKETING = SCENE_IDS.filter((id) => id.startsWith("marketing/"));
const scenes: Scene[] = await Promise.all(MARKETING.map(loadScene));
const SIZES: SizeSpec[] = ["9:16", "1:1", "16:9", "4:5"];
const cp = (...c: number[]) => String.fromCodePoint(...c);

/** A disc's alpha on a grid (a cut-out product). */
function discAlpha(w: number, h: number, r: number): Uint8ClampedArray {
  const a = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2);
    a[y * w + x] = Math.round(255 * Math.min(1, Math.max(0, r - d + 0.5)));
  }
  return a;
}
const DISC: Outline = traceOutline(discAlpha(200, 256, 80), 200, 256)!;

/** Each scene's fields, as a showcase recipe fills them. */
const FIELDS: Record<string, Record<string, string>> = {
  "marketing/kinetic-headline": { headline: "Invoices that *chase* themselves.", cta: "Start free", website: "lumenlabs.io" },
  "marketing/line-reveal": { headline: "Quietly exceptional.", cta: "Discover the scent" },
  "marketing/logo-sting": { tagline: "Software that ships itself" },
  "marketing/feature-cards": { headline: "Everything your team needs", point1: "Invoices that chase themselves", point2: "Payroll in two taps", point3: "Books that close on Friday" },
  "marketing/stat-dashboard": { stat: "$1,284,000", label: "Revenue this quarter" },
  "marketing/starburst": { headline: "Sunshine, bottled.", badge: "New!" },
  "marketing/offer-badge": { offer: "20% off", headline: "The winter edit", cta: "Shop the sale" },
  "marketing/big-number": { stat: "3×", caption: "faster month-end close" },
  "marketing/quote": { quote: "“The only serum I've bought three times.”", name: "Amara K., verified buyer" },
};

function recipe(scene: string, over: Partial<Recipe> = {}): Recipe {
  return {
    v: 1,
    scene,
    seed: 11,
    size: "9:16",
    fps: 30,
    duration: 5,
    fields: FIELDS[scene] ?? {},
    brand: { name: "Maison Ardent", colors: ["#6b1d2a", "#e9d8b4"], fonts: { heading: "Playfair Display", body: "Inter" } },
    media: { product: "/previews/kinetic/product.png" },
    export: { format: "mp4", blurSamples: 8, shutter: 180 },
    ...over,
  };
}

const input = (r: Recipe, logo: LogoInfo | null = RASTER_LOGO, outline: Outline | null = DISC): SceneInput => ({ recipe: r, measure, logo, images: { product: { w: 800, h: 1024 } }, outlines: { product: outline } });

/** What a field should read: as typed (trimmed), the *stars* of a marked headline removed. */
const typedOf = (r: Recipe, field: string) => {
  const raw = (r.fields[field] ?? (field === "brand" ? r.brand.name : "")).trim();
  return field === "headline" && r.scene === "marketing/kinetic-headline" ? marked(raw).text.trim() : raw;
};

describe("the registry", () => {
  it("has the nine Marketing scenes", () => {
    expect(MARKETING.sort()).toEqual(Object.keys(FIELDS).sort());
    for (const s of scenes) expect(s.durations).toEqual({ min: 5, max: 8, default: 5 });
  });
});

describe("determinism", () => {
  it("gives the same display list at a time whatever was asked before, for every scene, size and look", () => {
    for (const scene of scenes) {
      for (const size of SIZES) {
        for (const look of ["light", "dark", "brand"]) {
          const r = recipe(scene.id, { size, controls: { look, pace: "punchy" } });
          const a = scene.plan(input(r));
          const b = scene.plan(input(r));
          const times = Array.from({ length: 30 }, (_, i) => (i / 29) * r.duration);
          const forward = times.map((t) => JSON.stringify(a.evaluate(t)));
          for (let i = times.length - 1; i >= 0; i--) expect(JSON.stringify(a.evaluate(times[i]))).toBe(forward[i]);
          for (let k = 0; k < 60; k++) {
            const i = (k * 37 + 11) % times.length;
            expect(JSON.stringify(b.evaluate(times[i])), `${scene.id} ${size} t=${times[i]}`).toBe(forward[i]);
          }
          expect(a.design).toEqual(designSize(size));
          for (const t of times) for (const n of walk(a.evaluate(t).nodes)) expect(JSON.stringify(n)).not.toMatch(/NaN|Infinity|null/);
        }
      }
    }
  });
});

function walk(nodes: readonly DisplayNode[], out: DisplayNode[] = []): DisplayNode[] {
  for (const n of nodes) {
    out.push(n);
    if (n.type === "group") walk(n.children, out);
  }
  return out;
}

describe("spelling", () => {
  const hostile = ["iPhone® 15 — 20 % off!", `ÉCOLE ${cp(0xfb01)} ligature`, `${cp(0x1f469, 0x200d, 0x1f469, 0x200d, 0x1f467)} family`, "العربية", "  two  spaces  ", "Q"];

  it("sets every field exactly as typed at rest, and never draws a letter that wasn't typed", () => {
    for (const scene of scenes) {
      for (const field of Object.keys(FIELDS[scene.id])) {
        if (field === "stat") continue;
        for (const text of hostile) {
          const base = recipe(scene.id);
          const r = recipe(scene.id, { fields: { ...base.fields, [field]: text } });
          const plan = scene.plan(input(r));
          if (plan.overflow.length) continue;
          // The kinetic headline's words lift away for its end card: they are read just before they go.
          const exit = plan.timeline.byId.get("words.exit");
          const at = field === "headline" && exit ? exit.start - 0.01 : plan.rest;
          const rest = textNodes(plan.evaluate(at).nodes).filter((n) => n.field === field);
          // The kinetic headline's call to action and address show on its end card.
          expect(rest.length, `${scene.id} ${field}`).toBeGreaterThan(0);
          expect(spelled(rest.flatMap((n) => n.runs)), `${scene.id} ${field} "${text}"`).toBe(typedOf(r, field));
          for (let i = 0; i <= 30; i++) {
            const t = (i / 30) * r.duration;
            for (const n of textNodes(plan.evaluate(t).nodes)) {
              const typed = typedOf(r, n.field);
              for (const run of n.runs) for (const ch of run.text) expect(typed.includes(ch) || (n.field === "stat" && /[0-9]/.test(ch)), `${scene.id} ${n.field} "${ch}" at ${t}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it("never draws the stars that mark the headline's words", () => {
    const s = scenes.find((x) => x.id === "marketing/kinetic-headline")!;
    const r = recipe(s.id, { fields: { headline: "Ship *faster* with *less*." } });
    const plan = s.plan(input(r));
    for (let i = 0; i <= 20; i++) for (const n of textNodes(plan.evaluate((i / 20) * 2.5).nodes)) for (const run of n.runs) expect(run.text).not.toContain("*");
    const words = textNodes(plan.evaluate(2).nodes).find((n) => n.field === "headline")!;
    expect(spelled(words.runs)).toBe("Ship faster with less.");
  });

  it("marks only paired stars round words, and keeps every other star as typed", () => {
    expect(marked("5* hotel")).toEqual({ text: "5* hotel", marks: [] });
    expect(marked("a*b")).toEqual({ text: "a*b", marks: [] });
    expect(marked("*x*")).toEqual({ text: "x", marks: [[0, 1]] });
    expect(marked("Free delivery*")).toEqual({ text: "Free delivery*", marks: [] });
    expect(marked("Rated 5* by 4* guests")).toEqual({ text: "Rated 5* by 4* guests", marks: [] });
    expect(marked("** and *")).toEqual({ text: "** and *", marks: [] });
    expect(marked("Wake to *pure radiance* daily")).toEqual({ text: "Wake to pure radiance daily", marks: [[8, 21]] });
    expect(marked("5* stays, *free* nights")).toEqual({ text: "5* stays, free nights", marks: [[10, 14]] });
    // In the clip: a lone star is drawn as typed.
    const s = scenes.find((x) => x.id === "marketing/kinetic-headline")!;
    const r = recipe(s.id, { fields: { headline: "Rated 5* by *guests*" } });
    const plan = s.plan(input(r));
    const exit = plan.timeline.byId.get("words.exit")!;
    const words = textNodes(plan.evaluate(exit.start - 0.01).nodes).find((n) => n.field === "headline")!;
    expect(spelled(words.runs)).toBe("Rated 5* by guests");
  });

  it("names a field that doesn't fit instead of cutting it", () => {
    for (const scene of scenes) {
      const field = Object.keys(FIELDS[scene.id]).find((f) => f !== "stat")!;
      const r = recipe(scene.id, { fields: { ...recipe(scene.id).fields, [field]: "Supercalifragilisticexpialidociously ".repeat(14).trim() } });
      expect(scene.plan(input(r)).overflow, scene.id).toContain(field);
    }
  });
});

describe("timing", () => {
  it("keeps every move within its kind's limits, staggers in range, and holds the last second", () => {
    for (const scene of scenes) {
      for (const duration of [5, 6.5, 8]) {
        for (const pace of ["calm", "punchy"]) {
          for (const logo of [RASTER_LOGO, SVG_LOGO, null]) {
            const r = recipe(scene.id, { duration, controls: { pace } });
            const plan = scene.plan(input(r, logo));
            const events = plan.timeline.events;
            expect(events.length, scene.id).toBeGreaterThan(2);
            for (const e of events) {
              const [lo, hi] = DURATION_LIMITS[e.kind];
              expect(e.dur, `${scene.id} ${e.id}`).toBeGreaterThanOrEqual(lo - 1e-9);
              expect(e.dur, `${scene.id} ${e.id}`).toBeLessThanOrEqual(hi + 1e-9);
              expect(e.start, `${scene.id} ${e.id}`).toBeGreaterThanOrEqual(-0.15);
            }
            const groups = new Map<string, number[]>();
            for (const e of events) if (e.group) groups.set(e.group, [...(groups.get(e.group) ?? []), e.start]);
            for (const [g, starts] of groups) {
              const [lo, hi] = STAGGER_LIMITS[events.find((e) => e.group === g)!.unit!];
              for (let i = 1; i < starts.length; i++) {
                expect(starts[i] - starts[i - 1], `${scene.id} ${g}`).toBeGreaterThanOrEqual(lo - 1e-6);
                expect(starts[i] - starts[i - 1], `${scene.id} ${g}`).toBeLessThanOrEqual(hi + 1e-6);
              }
            }
            expect(duration - plan.settled, `${scene.id} ${duration}s ${pace} hold`).toBeGreaterThanOrEqual(1);
            expect(plan.rest).toBeCloseTo((Math.round(duration * r.fps) - 1) / r.fps, 9);
            expect(JSON.stringify(plan.evaluate(duration))).toBe(JSON.stringify(plan.evaluate(plan.rest)));
            // Something moves between the start and the rest.
            expect(JSON.stringify(plan.evaluate(plan.settled * 0.4))).not.toBe(JSON.stringify(plan.evaluate(plan.rest)));
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The rest frame: words in the safe area, and readable

interface Placed {
  field: string;
  text: string;
  fill: string;
  box: { x0: number; y0: number; x1: number; y1: number };
}

const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function boxOf(m: Matrix, x: number, y: number, w: number, h: number) {
  const pts = [apply(m, x, y), apply(m, x + w, y), apply(m, x, y + h), apply(m, x + w, y + h)];
  return { x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) };
}

/** Every solid shape and text run in drawing order, placed in design units. */
function flatten(nodes: readonly DisplayNode[], m: Matrix = IDENTITY, alpha = 1, out: ({ kind: "shape"; fill: string; box: Placed["box"]; ellipse?: { cx: number; cy: number; r: number }; path?: boolean } | ({ kind: "text" } & Placed))[] = []) {
  for (const n of nodes) {
    const a = alpha * ("opacity" in n && n.opacity !== undefined ? n.opacity : 1);
    if (n.type === "group") {
      if (n.blend && n.blend !== "source-over") continue;
      flatten(n.children, n.transform ? multiply(m, n.transform) : m, a, out);
    } else if (n.type === "text") {
      for (const r of n.runs) {
        const size = Number(/(\d+(\.\d+)?)px/.exec(r.font)![1]);
        const rm = r.transform ? multiply(m, r.transform) : m;
        out.push({ kind: "text", field: n.field, text: r.text, fill: typeof r.fill === "string" ? r.fill : "", box: boxOf(rm, r.x, r.y, measure(r.text, r.font), size) });
      }
    } else if ((n.type === "rect" || n.type === "ellipse" || n.type === "path") && typeof n.fill === "string" && /^#/.test(n.fill) && a >= 0.999) {
      if (n.type === "rect") out.push({ kind: "shape", fill: n.fill, box: boxOf(m, n.x, n.y, n.w, n.h) });
      else if (n.type === "ellipse") {
        const [cx, cy] = apply(m, n.cx, n.cy);
        out.push({ kind: "shape", fill: n.fill, box: boxOf(m, n.cx - n.rx, n.cy - n.ry, 2 * n.rx, 2 * n.ry), ellipse: { cx, cy, r: Math.min(n.rx, n.ry) * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) } });
      } else {
        const nums = (n.d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
        const xs = nums.filter((_, i) => i % 2 === 0);
        const ys = nums.filter((_, i) => i % 2 === 1);
        const pm = n.transform ? multiply(m, n.transform) : m;
        // A star or burst: its inner circle (the part sure to be filled).
        const bx = boxOf(pm, Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        const cx = (bx.x0 + bx.x1) / 2;
        const cy = (bx.y0 + bx.y1) / 2;
        out.push({ kind: "shape", fill: n.fill, box: bx, ellipse: { cx, cy, r: (Math.min(bx.x1 - bx.x0, bx.y1 - bx.y0) / 2) * 0.8 }, path: true });
      }
    }
  }
  return out;
}

function behind(list: DisplayList, at: number, x: number, y: number, flat: ReturnType<typeof flatten>): string {
  for (let i = at - 1; i >= 0; i--) {
    const s = flat[i];
    if (s.kind !== "shape") continue;
    // Full-frame ray paths are not solid everywhere: a word on them must sit on a shape of its own.
    if (s.path && s.box.x1 - s.box.x0 >= list.w * 0.99 && s.box.y1 - s.box.y0 >= list.h * 0.99) continue;
    const inside = s.ellipse ? Math.hypot(x - s.ellipse.cx, y - s.ellipse.cy) <= s.ellipse.r : x >= s.box.x0 && x <= s.box.x1 && y >= s.box.y0 && y <= s.box.y1;
    if (inside) return s.fill;
  }
  return list.background;
}

describe("the rest frame", () => {
  it("keeps every word inside the safe area and readable (4.5:1) on what is behind it, for every look and size", () => {
    for (const scene of scenes) {
      for (const size of SIZES) {
        for (const look of ["light", "dark", "brand"]) {
          for (const colors of [["#6b1d2a", "#e9d8b4"], ["#1f6feb", "#0b0f19"], ["#f2c94c", "#ffffff"], ["#0f5132", "#d4af37"]]) {
            for (const logo of [RASTER_LOGO, null]) {
              const r = recipe(scene.id, { size, controls: { look }, brand: { name: "Maison Ardent", colors, fonts: { heading: "Playfair Display", body: "Inter" } } });
              const plan = scene.plan(input(r, logo));
              if (plan.overflow.length) continue;
              const list = plan.evaluate(plan.rest);
              const safe = safeArea(list);
              const flat = flatten(list.nodes);
              flat.forEach((item, i) => {
                if (item.kind !== "text") return;
                const tag = `${scene.id} ${size} ${look} ${colors} ${item.field} "${item.text}"`;
                // The kinetic headline ends on the end card, which keeps its own margins.
                if (scene.id !== "marketing/kinetic-headline") {
                  expect(item.box.x0, tag).toBeGreaterThanOrEqual(safe.x - 1);
                  expect(item.box.x1, tag).toBeLessThanOrEqual(safe.x + safe.w + 1);
                  expect(item.box.y0, tag).toBeGreaterThanOrEqual(safe.y - 1);
                  expect(item.box.y1, tag).toBeLessThanOrEqual(safe.y + safe.h + 1);
                }
                const bg = behind(list, i, (item.box.x0 + item.box.x1) / 2, (item.box.y0 + item.box.y1) / 2, flat);
                expect(contrast(item.fill, bg), `${tag} on ${bg}`).toBeGreaterThanOrEqual(4.5);
              });
            }
          }
        }
      }
    }
  });
});

describe("outline (outline.ts)", () => {
  it("traces a disc's edge as a closed path within 2 % of its circumference", () => {
    expect(DISC).not.toBeNull();
    expect(DISC.d.endsWith("Z")).toBe(true);
    expect(Math.abs(DISC.length - 2 * Math.PI * 80) / (2 * Math.PI * 80)).toBeLessThan(0.02);
    // It starts at the lowest point.
    expect(DISC.start[1]).toBeGreaterThan(128 + 78);
  });

  it("gives null for a picture with no transparency (it gets a frame instead)", () => {
    expect(traceOutline(new Uint8ClampedArray(64 * 64).fill(255), 64, 64)).toBeNull();
    expect(traceOutline(new Uint8ClampedArray(64 * 64), 64, 64)).toBeNull();
  });

  it("frames a photo's product (Line-Art Reveal without an outline still draws)", () => {
    const s = scenes.find((x) => x.id === "marketing/line-reveal")!;
    const plan = s.plan(input(recipe(s.id), RASTER_LOGO, null));
    const mid = walk(plan.evaluate(1.2).nodes).filter((n) => n.type === "path");
    expect(mid.length).toBeGreaterThan(0);
  });
});

describe("counters", () => {
  const L = (text: string) => counterLayout("stat", text, "Inter", 800, 4000, 100, 40, measure);
  const runsAt = (text: string, p: number) => textNodes([counterNode(L(text), 0, 0, "#000000", p)]).flatMap((n) => n.runs);

  it("ends on the typed stat exactly", () => {
    for (const s of ["$1,284,000", "38%", "4.9/5", "12 480 €", "+212%", "3×", "1.234,56"]) expect(spelled(runsAt(s, 1))).toBe(s);
  });

  it("keeps the typed separators and signs in place while counting", () => {
    const text = "$1,284,000";
    const at = (p: number) => runsAt(text, p).filter((r) => !/[0-9]/.test(r.text));
    const end = at(1);
    for (const p of [0, 0.2, 0.5, 0.8]) expect(at(p).map((r) => [r.text, r.x])).toEqual(end.map((r) => [r.text, r.x]));
  });

  it("rolls every figure in a cell as wide as the widest figure", () => {
    const l = L("1,111");
    const figures = l.cells.filter((c) => c.digit !== null);
    expect(new Set(figures.map((c) => c.w)).size).toBe(1);
  });
});
