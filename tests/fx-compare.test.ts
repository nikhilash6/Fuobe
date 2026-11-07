import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  FX_REST,
  followsPointer,
  fxLoupeSources,
  fxSources,
  fxStripSrc,
  fxView,
  fxWideSources,
  hoverFiles,
  keyPos,
  LENS,
  LENS_DETAIL,
  lensHome,
  loupePan,
  nextShow,
  posAt,
  reframeVars,
  restFiles,
  showPos,
  stripShift,
  tapToggles,
} from "@/lib/fx-compare";
import { FX_PAIRS } from "@/lib/fx-pairs.generated";
import { fxSections, fxShowcase } from "@/lib/area-showcase";
import { fxMenu } from "@/lib/mega-menus.server";
import { megaItems, packMenu, unpackMenu } from "@/lib/mega-menus";

// area-showcase.ts caches its showcases (next/cache), which only a build provides.
vi.mock("next/cache", () => ({ cacheLife: () => {} }));

const file = (url: string) => path.join(process.cwd(), "public", url.split("?")[0]);
const css = fs.readFileSync(path.join(process.cwd(), "src", "app", "fx-compare.css"), "utf8");

describe("Fuobe FX before/after cards: the pairs", () => {
  it("gives an item with a pair its view, and none to an item without one (it keeps its cover)", () => {
    expect(fxView("video-tools-depth")).toMatchObject({ id: "video-tools-depth", kind: "depth" });
    expect(fxView("upscale-hdr")).toBeUndefined();
    expect(fxView("no-such-item")).toBeUndefined();
  });

  it("points every source at a file that exists, versioned, AVIF and WebP at both sizes", () => {
    for (const id of Object.keys(FX_PAIRS)) {
      const v = fxView(id)!;
      const urls: string[] = [];
      if (v.kind === "reframe") urls.push(...fxWideSources(v).webp.split(", ").map((s) => s.split(" ")[0]));
      for (const side of ["before", "after"] as const) {
        const s = fxSources(v, side);
        expect(s.avif, id).toMatch(/\.480\.avif\?v=[0-9a-f]{8} 480w, .+\.960\.avif\?v=[0-9a-f]{8} 960w$/);
        urls.push(s.src, ...[s.avif, s.webp].flatMap((x) => x.split(", ").map((y) => y.split(" ")[0])));
        if (v.kind === "loupe") urls.push(...fxLoupeSources(v, side).srcSet.split(", ").map((y) => y.split(" ")[0]));
      }
      if (v.kind === "strip") urls.push(fxStripSrc(v));
      for (const u of urls) {
        expect(u, id).toContain(`?v=${v.v}`);
        expect(fs.existsSync(file(u)), u).toBe(true);
      }
    }
  });

  it("loads only stills at rest, and the lens's details or the flipbook only once pointed at", () => {
    for (const id of Object.keys(FX_PAIRS)) {
      const v = fxView(id)!;
      for (const f of [...restFiles(v), ...hoverFiles(v)]) expect(fs.existsSync(path.join(process.cwd(), "public", "previews", "fx", id, f)), `${id} ${f}`).toBe(true);
      expect(restFiles(v).some((f) => f.startsWith("strip") || f.includes("loupe")), id).toBe(false);
    }
    expect(hoverFiles(fxView("upscale")!)).toEqual(["before.loupe.webp", "after.loupe.webp"]);
    expect(hoverFiles(fxView("extend")!)).toEqual(["strip.webp"]);
    expect(restFiles(fxView("extend")!)).toEqual(["before.480.avif"]);
    expect(restFiles(fxView("reframe")!)).toEqual(["wide.480.webp"]);
    expect(hoverFiles(fxView("genjutsu")!)).toEqual([]);
  });
});

describe("Fuobe FX before/after cards: the divider", () => {
  it("rests at a 35/65 split, and a tap shows all of one side, then the other", () => {
    expect(FX_REST).toBe(35);
    expect(showPos("rest")).toBe(35);
    expect(nextShow("rest")).toBe("after");
    expect(nextShow("after")).toBe("before");
    expect(nextShow("before")).toBe("after");
    expect(showPos("after")).toBe(0);
    expect(showPos("before")).toBe(100);
  });

  it("follows the pointer inside the card, clamped to its edges", () => {
    expect(posAt(150, 100, 200)).toBe(25);
    expect(posAt(50, 100, 200)).toBe(0);
    expect(posAt(400, 100, 200)).toBe(100);
    expect(posAt(150, 100, 0)).toBe(FX_REST);
  });

  it("moves with the arrow keys (Shift: further), and leaves other keys alone", () => {
    expect(keyPos(35, "ArrowLeft")).toBe(30);
    expect(keyPos(35, "ArrowRight")).toBe(40);
    expect(keyPos(35, "ArrowRight", true)).toBe(60);
    expect(keyPos(2, "ArrowLeft")).toBe(0);
    expect(keyPos(99, "ArrowRight", true)).toBe(100);
    expect(keyPos(35, "ArrowUp")).toBeNull();
    expect(keyPos(35, "Enter")).toBeNull();
  });

  it("follows a mouse only, never with reduced motion; a finger or pen taps", () => {
    expect(followsPointer("mouse", false)).toBe(true);
    expect(followsPointer("mouse", true)).toBe(false);
    expect(followsPointer("touch", false)).toBe(false);
    expect(followsPointer("pen", false)).toBe(false);
    expect(tapToggles("touch")).toBe(true);
    expect(tapToggles("pen")).toBe(true);
    expect(tapToggles("mouse")).toBe(false);
  });
});

describe("Fuobe FX before/after cards: loupe, reframe, flipbook", () => {
  it("pans the lens's detail with the pointer, within the detail", () => {
    expect(LENS_DETAIL).toBe(LENS * 2);
    expect(loupePan(0, 0, 208, 104).map(Math.abs)).toEqual([0, 0]);
    expect(loupePan(1, 1, 208, 104)).toEqual([-104, -104]);
    expect(loupePan(0.5, 2, 208, 104)).toEqual([-52, -104]);
    expect(loupePan(0.5, 0.5, 100, 104).map(Math.abs)).toEqual([0, 0]);
  });

  it("puts a tapped lens over the loupe's own place", () => {
    const v = fxView("upscale")!;
    const [x, y, w, h] = v.loupe!;
    expect(lensHome(v.loupe, 400, 300)).toEqual([Math.round((x + w / 2) * 400), Math.round((y + h / 2) * 300)]);
  });

  it("outlines the 9:16 box from its rect", () => {
    const v = fxView("reframe")!;
    const vars = reframeVars(v.rect);
    const [x, , w] = v.rect!;
    expect(vars["--fxc-rx"]).toBe(`${Math.round(x * 1000000) / 10000}%`);
    expect(vars["--fxc-rw"]).toBe(`${Math.round(w * 1000000) / 10000}%`);
    expect(Number(vars["--fxc-cx"])).toBeCloseTo(x + w / 2, 3);
    // A pair without its rect still draws a centred box rather than failing.
    expect(reframeVars(undefined)["--fxc-cx"]).toBe("0.5");
  });

  it("steps the flipbook frame by frame, the last at five sixths of the sprite", () => {
    expect(stripShift(0, 6)).toBe(-0);
    expect(stripShift(1, 6)).toBeCloseTo(-16.6667, 3);
    expect(stripShift(5, 6)).toBeCloseTo(-83.3333, 3);
    expect(stripShift(9, 6)).toBeCloseTo(-83.3333, 3);
    expect(stripShift(-2, 6)).toBe(-0);
  });

  it("plays the flipbook in steps on hover only, and nothing plays or eases with reduced motion", () => {
    expect(css).toMatch(/animation: fxc-flip [^;]*steps\(var\(--fxc-frames, 6\), jump-none\)/);
    // Only under data-hover or a tap's data-show, never at rest.
    const rules = [...css.matchAll(/([^{}]+)\{[^{}]*animation: fxc-flip/g)].map((m) => m[1]);
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) for (const sel of r.split(",")) expect(sel).toMatch(/data-hover|data-show="after"/);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/animation: none/);
    expect(reduced).toMatch(/transition: none/);
  });

  it("moves the divider by clip-path and transform only (no layout)", () => {
    expect(css).toMatch(/\.fxc-after \{[^}]*clip-path: inset\(0 0 0 var\(--fxc-pos\)\)/);
    expect(css).toMatch(/\.fxc-line \{[^}]*transform: translateX\(var\(--fxc-pos\)\)/);
  });
});

describe("Fuobe FX before/after cards: where they show", () => {
  it("gives /fx cards with a pair their before and after; the rest keep their cover, in the same order", async () => {
    const { sections } = await fxShowcase();
    const ids = fxSections(undefined);
    let paired = 0;
    for (const s of sections) {
      expect(s.cards.map((c) => c.id)).toEqual(ids.find((x) => x.id === s.id)!.cards);
      for (const c of s.cards) {
        if (FX_PAIRS[c.id]) {
          paired += 1;
          expect(c.fx?.id, c.id).toBe(c.id);
        } else {
          expect(c.fx, c.id).toBeUndefined();
          expect(c.card, c.id).toBeDefined();
        }
      }
    }
    expect(paired).toBeGreaterThan(0);
  });

  it("gives the menu's lead cards their pair, through the menu file, and keeps rows on their small covers", () => {
    const m = unpackMenu(JSON.parse(JSON.stringify(packMenu(fxMenu()))));
    const leads = m.columns.map((c) => c.lead).filter((l) => !!l);
    expect(leads.some((l) => l!.fx)).toBe(true);
    for (const l of leads) expect(!!l!.fx, l!.id).toBe(!!FX_PAIRS[l!.id]);
    for (const c of m.columns) for (const r of c.rows) expect(r.fx, r.id).toBeUndefined();
    expect(megaItems(m).length).toBe(megaItems(fxMenu()).length);
  });
});
