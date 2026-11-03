import { describe, expect, it } from "vitest";
import { IDENTITY, multiply, textNodes, type DisplayNode, type Matrix } from "@/lib/motion/display";
import { fieldStops, kineticPalette, toLab } from "@/lib/motion/color";
import { safeBox } from "@/lib/motion/grid";
import type { Recipe } from "@/lib/motion/recipe";
import { loadScene, SCENE_IDS } from "@/lib/motion/registry";
import type { Scene, SceneInput } from "@/lib/motion/scene";
import { setType, type BoxMeasure } from "@/lib/motion/type/glyphs";
import { measure, RASTER_LOGO } from "./helpers/motion";

// The poster rules: filled ghosts (never hairlines), lit two-stop fields, a readable foot that
// reaches the safe line, line breaks at a clause, words that never collide on any frame or size, and a countdown that
// ticks down to exactly what was typed.

const MARKETING = SCENE_IDS.filter((id) => id.startsWith("marketing/"));
const scenes: Scene[] = await Promise.all(MARKETING.map(loadScene));
const SIZES = ["9:16", "4:5", "1:1", "16:9"] as const;

const FIELDS: Record<string, Record<string, string>> = {
  "marketing/kinetic-headline": { headline: "SHIP IT *TONIGHT.*", cta: "Start free", website: "lumenlabs.io", note: "Release 4.0" },
  "marketing/line-reveal": { headline: "Quietly exceptional.", cta: "Discover the scent", website: "maison-ardent.com", note: "Est. 1987" },
  "marketing/logo-sting": { tagline: "Software that ships itself", website: "lumenlabs.io", note: "Est. 2019" },
  "marketing/feature-cards": { headline: "Month-end, minus the panic", point1: "Invoices that chase themselves", point2: "Payroll in two taps", point3: "Books that close on Friday", website: "ledgerly.app", note: "Three features" },
  "marketing/stat-dashboard": { stat: "$1,284,000", label: "Revenue this quarter, up 38%", website: "ledgerly.app", note: "Q3 2026" },
  "marketing/starburst": { headline: "Made to be noticed.", badge: "New!", website: "vesper-shoes.com", note: "SS26" },
  "marketing/offer-badge": { offer: "20% off", headline: "THE GIFTING EDIT", cta: "Shop the edit", website: "soraskin.co", note: "Until 24 Dec" },
  "marketing/big-number": { stat: "3×", caption: "faster month-end close, every month", website: "ledgerly.app", note: "2026 report" },
  "marketing/quote": { quote: "“The only serum I’ve ever bought three times.”", name: "Amara K., verified buyer", website: "soraskin.co", note: "Verified reviews" },
  "marketing/drop-countdown": { headline: "DROP 07", count: "03:12:45", when: "Friday · 9 PM", cta: "Set a reminder", website: "kova.store", note: "Season 07" },
  "marketing/fragrance-reveal": { headline: "Nocturne", line: "Eau de parfum, for the hours after dark", cta: "Discover", website: "maison-ardent.com", note: "Est. 1987" },
  "marketing/editorial-sale": { headline: "FINAL SALE", offer: "Up to 50% off", cta: "Shop the sale", website: "halden-studio.com", note: "SS26 Collection" },
  "marketing/glass-spotlight": { headline: "Eau de Nuit", line: "Amber, iris and a trace of smoke", cta: "Discover", website: "aurele-paris.com", note: "Paris · Est. 1924" },
  "marketing/announcement": { headline: "Opening Night", when: "Friday 14 March · 8 PM", place: "12 Rue des Martyrs, Paris", cta: "Reserve a table", website: "barlune.fr", note: "Doors at 7:30" },
  "marketing/lookbook": { headline: "THE GOLD HOUR", accent: "Spring", line: "Collection 07 · Marrakech", website: "ateliernoor.com", note: "Spring/Summer 26" },
  "marketing/stat-stack": { stat1: "98%", label1: "of tickets answered in an hour", stat2: "4.9", label2: "average rating", stat3: "3×", label3: "faster than last year", website: "orbit.help", note: "2026 report" },
  "marketing/testimonials": { quote1: "“The calmest three days I’ve had all year.”", name1: "Léa M., Lisbon", quote2: "“Breakfast on the terrace was worth the trip alone.”", name2: "James O., London", quote3: "“We’ve booked again for September.”", name3: "Priya S., Mumbai", website: "halcyonhotels.com", note: "Guest reviews" },
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
const input = (r: Recipe): SceneInput => ({ recipe: r, measure, logo: RASTER_LOGO, images: { product: { w: 800, h: 1024 } }, outlines: {} });

const px = (font: string) => Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]);
const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Every readable run (not decoration) with its box (from its cap height to its baseline) and field, in design units. */
function runs(nodes: readonly DisplayNode[], m: Matrix = IDENTITY, out: { field: string; text: string; x0: number; y0: number; x1: number; y1: number }[] = []) {
  for (const n of nodes) {
    if (n.type === "group") {
      if (n.opacity !== undefined && n.opacity < 0.5) continue;
      runs(n.children, n.transform ? multiply(m, n.transform) : m, out);
    } else if (n.type === "text" && !n.decor) {
      for (const r of n.runs) {
        if (r.opacity !== undefined && r.opacity < 0.5) continue;
        const s = px(r.font);
        const rm = r.transform ? multiply(m, r.transform) : m;
        const w = measure(r.text, r.font);
        const pts = [apply(rm, r.x, r.y + s * 0.2), apply(rm, r.x + w, r.y + s * 0.2), apply(rm, r.x, r.y + s * 0.8), apply(rm, r.x + w, r.y + s * 0.8)];
        out.push({ field: n.field, text: r.text, x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) });
      }
    }
  }
  return out;
}

/** Every text node marked as a ghost (inside a group with id "ghost"). */
function ghosts(nodes: readonly DisplayNode[], inGhost = false, out: DisplayNode[] = []): DisplayNode[] {
  for (const n of nodes) {
    if (n.type === "group") ghosts(n.children, inGhost || n.id === "ghost", out);
    else if (inGhost && n.type === "text") out.push(n);
  }
  return out;
}

describe("poster rules", () => {
  it("draws every ghost filled one tonal step from the field, never as a hairline", () => {
    for (const scene of scenes) {
      for (const look of ["light", "dark", "brand"]) {
        const plan = scene.plan(input(recipe(scene.id, { controls: { look } })));
        if (plan.overflow.length) continue;
        for (const g of ghosts(plan.evaluate(plan.rest).nodes)) {
          if (g.type !== "text") continue;
          for (const r of g.runs) {
            expect(r.stroke, `${scene.id} ${look}`).toBeUndefined();
            expect(typeof r.fill === "string" && r.fill !== "transparent", `${scene.id} ${look}`).toBe(true);
          }
        }
      }
    }
  });

  it("lights every look's field with two analogous stops, the dark one in the brand's own hue with real colour", () => {
    for (const look of ["light", "dark", "brand"] as const) {
      const pal = kineticPalette(["#1f3fd1", "#ffb547"], look);
      const s = fieldStops(pal);
      const d = toLab(s.dark);
      const l = toLab(s.light);
      expect(l.L).toBeGreaterThan(d.L);
      if (look === "dark") {
        expect(d.L).toBeGreaterThan(0.08);
        expect(d.L).toBeLessThan(0.15);
        expect(Math.hypot(d.a, d.b)).toBeGreaterThan(0.05);
        expect(l.L - d.L).toBeGreaterThan(0.17);
      }
    }
  });

  it("lets a 9:16 ad's words reach down to 81 % of the height (the app's 15 % and a pad)", () => {
    const s = safeBox({ w: 1080, h: 1920 }, "ad");
    expect(s.y + s.h).toBeCloseTo(1920 * 0.81);
  });

  it("puts every template's corner note on the frame when one is typed", () => {
    for (const scene of scenes) {
      const plan = scene.plan(input(recipe(scene.id)));
      if (plan.overflow.length) continue;
      const notes = textNodes(plan.evaluate(plan.rest).nodes).filter((n) => n.field === "note");
      expect(notes.length, scene.id).toBeGreaterThan(0);
    }
  });

  it("never lets two different fields' words collide, at rest or through the hold, at any size", () => {
    for (const scene of scenes) {
      for (const size of SIZES) {
        const r = recipe(scene.id, { size });
        const plan = scene.plan(input(r));
        if (plan.overflow.length) continue;
        for (const t of [plan.settled + 0.1, (plan.settled + plan.rest) / 2, plan.rest]) {
          const all = runs(plan.evaluate(Math.min(plan.rest, t)).nodes);
          for (let i = 0; i < all.length; i++) {
            for (let j = i + 1; j < all.length; j++) {
              const a = all[i];
              const b = all[j];
              // A script word crossing the title is the design (Runway Titles), not a collision.
              if (a.field === b.field || [a.field, b.field].includes("accent")) continue;
              const over = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 2 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 2;
              expect(over, `${scene.id} ${size} t=${t.toFixed(2)}: "${a.text}" (${a.field}) and "${b.text}" (${b.field})`).toBe(false);
            }
          }
        }
      }
    }
  });

  it("counts the drop down a second at a time to exactly the typed time a second before the end", () => {
    const scene = scenes[MARKETING.indexOf("marketing/drop-countdown")];
    const plan = scene.plan(input(recipe("marketing/drop-countdown", { size: "4:5" })));
    const count = (t: number) => textNodes(plan.evaluate(t).nodes).filter((n) => n.field === "count").flatMap((n) => n.runs.map((x) => x.text)).join("");
    expect(count(plan.rest)).toContain("45");
    const shown = new Set<string>();
    for (let t = plan.rest - 3.4; t < plan.rest; t += 0.1) shown.add(count(t).slice(-2));
    expect([...shown].some((s) => s === "46" || s === "47")).toBe(true);
  });
});

describe("line breaks", () => {
  const box: BoxMeasure = Object.assign((text: string, font: string) => text.length * px(font) * 0.5, { box: (_t: string, font: string) => ({ top: px(font) * 0.1, bottom: px(font) * 0.8, left: 0, right: 0 }) });
  const spec = (text: string, width: number) => ({ field: "t", text, family: "Test", weight: 400, max: 60, min: 60, x: 0, y: 0, width, maxLines: 2, leading: 1 });

  it("breaks after a clause's comma when it can", () => {
    const set = setType(spec("Month-end, minus the panic", 60 * 0.5 * 17), box);
    expect(set.lines.map((l) => l.text)).toEqual(["Month-end,", "minus the panic"]);
  });

  it("never ends a line on a little word (a, and, that, minus)", () => {
    for (const text of ["Amber, iris and a trace of smoke", "Invoices that chase themselves", "Month-end, minus the panic"]) {
      const set = setType(spec(text, 60 * 0.5 * Math.ceil(text.length * 0.62)), box);
      for (const l of set.lines.slice(0, -1)) expect(l.text, text).not.toMatch(/\b(a|and|that|minus)$/);
    }
  });
});
