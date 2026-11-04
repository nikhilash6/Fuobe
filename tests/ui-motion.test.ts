import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { countAt, countFrom, counts, countUp, EASE, easeOutQuart, fadeInOnLoad, fadesIn, ms, MOTION, newPlace, stagger, STAGGER_CAP } from "@/lib/ui-motion";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const css = read("src/app/motion.css");

/** The custom properties set in the first block that matches `selector` (inside `within`, when given). */
function block(source: string, selector: string): Record<string, string> {
  const at = source.indexOf(selector);
  expect(at, `${selector} in motion.css`).toBeGreaterThanOrEqual(0);
  const body = source.slice(source.indexOf("{", at) + 1, source.indexOf("}", at));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
const reduceAt = css.indexOf("@media (prefers-reduced-motion: reduce)");
const tokens = block(css, ":root {");
const reduced = block(css.slice(reduceAt), ":root {");

describe("motion tokens", () => {
  it("CSS and TS hold the same durations", () => {
    for (const [k, v] of Object.entries(MOTION)) {
      const name = k === "stagger" ? "--motion-stagger" : `--motion-${k}`;
      expect(tokens[name], name).toBe(`${v}ms`);
    }
  });

  it("CSS and TS hold the same easings", () => {
    const globals = read("src/app/globals.css");
    expect(globals).toContain(`--ease-enter: ${EASE.enter};`);
    expect(globals).toContain(`--ease-exit: ${EASE.exit};`);
    expect(css).toContain(`--ease-standard: ${EASE.standard};`);
    expect(css).toContain(`--ease-emphasised: ${EASE.emphasised};`);
  });

  it("small distances, no overshoot, presses that give a little", () => {
    expect(tokens["--motion-d1"]).toBe("4px");
    expect(tokens["--motion-d2"]).toBe("8px");
    expect(tokens["--motion-d3"]).toBe("16px");
    expect(Number(tokens["--motion-zoom"])).toBeLessThanOrEqual(1.03);
    for (const k of ["--motion-press", "--motion-press-card", "--motion-scale-in", "--motion-scale-out"]) expect(Number(tokens[k])).toBeGreaterThanOrEqual(0.97);
    // Every cubic-bezier stays inside 0..1 on y: nothing overshoots and springs back.
    for (const m of css.matchAll(/cubic-bezier\(([^)]+)\)/g)) {
      const [, y1, , y2] = m[1].split(",").map(Number);
      expect(y1).toBeGreaterThanOrEqual(0);
      expect(y1).toBeLessThanOrEqual(1);
      expect(y2).toBeLessThanOrEqual(1);
    }
  });

  it("reduced motion turns every duration, distance and scale off", () => {
    for (const k of ["--motion-fast", "--motion-base", "--motion-slow", "--motion-page", "--motion-count", "--motion-stagger"]) expect(reduced[k], k).toBe("0ms");
    for (const k of ["--motion-d1", "--motion-d2", "--motion-d3", "--motion-lift"]) expect(reduced[k], k).toBe("0px");
    for (const k of ["--motion-scale-in", "--motion-scale-out", "--motion-press", "--motion-press-card", "--motion-zoom"]) expect(reduced[k], k).toBe("1");
    // The safety net: animations and transitions that don't use the tokens end at once.
    const net = css.slice(reduceAt, css.indexOf("/* ----- Menus", reduceAt));
    expect(net).toMatch(/animation-duration: 0s !important/);
    expect(net).toMatch(/transition-duration: 0s !important/);
    expect(net).toMatch(/animation-iteration-count: 1 !important/);
  });

  it("motion.css moves only transform, translate, scale and opacity", () => {
    const keyframes = [...css.matchAll(/@keyframes [\w-]+ \{(.+)\}/g)].map((m) => m[1]);
    expect(keyframes.length).toBeGreaterThan(4);
    for (const k of keyframes) for (const p of k.matchAll(/([a-z-]+):/g)) expect(["opacity", "translate", "scale", "transform"]).toContain(p[1]);
    for (const t of css.matchAll(/transition:\s*([^;]+);/g)) {
      for (const part of t[1].split(",")) {
        const prop = part.trim().split(/\s+/)[0];
        // Sonner's own stack height and its focus shadow are kept from the library; background and border colours are
        // colours; a menu's cut (clip-path) only paints; none ends one at once.
        expect(["none", "opacity", "translate", "scale", "transform", "display", "height", "box-shadow", "background-color", "border-color", "clip-path"]).toContain(prop);
      }
    }
  });

  it("is imported by globals.css, and the older keyframes use the tokens", () => {
    const globals = read("src/app/globals.css");
    expect(globals).toMatch(/@import "\.\/motion\.css";/);
    expect(globals).toContain("--animate-fade-up: fade-up var(--motion-base)");
    expect(globals).toContain("--animate-pop-in: pop-in var(--motion-fast)");
  });

  it("covers every overlay primitive by its slot", () => {
    for (const slot of ["dropdown-menu-content", "popover-content", "select-content", "context-menu-content", "hover-card-content", "tooltip-content", "dialog-overlay", "dialog-content", "alert-dialog-content", "sheet-content", "sheet-overlay"]) {
      expect(css, slot).toContain(`[data-slot="${slot}"]`);
    }
    for (const f of ["dialog", "alert-dialog", "sheet", "dropdown-menu", "popover", "tooltip"]) {
      expect(read(`src/components/ui/${f}.tsx`)).toMatch(/data-slot="[a-z-]+(content|overlay)"/);
    }
    expect(read("src/components/nav/search-palette.tsx")).toContain('data-slot="search-palette"');
    expect(read("src/components/nav/search-palette.tsx")).toContain('data-slot="search-palette-overlay"');
  });

  it("the components use the tokens, not their own numbers", () => {
    expect(read("src/components/ui/button.tsx")).toContain("active:not-aria-[haspopup]:scale-(--motion-press)");
    expect(read("src/components/preset-gallery.tsx")).toMatch(/card-motion/);
    expect(read("src/components/studio/feed.tsx")).toMatch(/useArrival/);
    expect(read("src/components/nav/studio-chrome.tsx")).toMatch(/<PageMotion \/>/);
    // Progress bars grow with transform, never by animating their width.
    const files = fs.readdirSync(path.join(root, "src/components"), { recursive: true }) as string[];
    const widthTransitions = files.filter((f) => f.endsWith(".tsx") && read(path.join("src/components", f)).includes("transition-[width]"));
    expect(widthTransitions).toEqual([]);
  });
});

describe("motion helper", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ms and stagger are 0 under reduced motion", () => {
    expect(ms("base", false)).toBe(200);
    expect(ms("base", true)).toBe(0);
    expect(stagger(3, 40, STAGGER_CAP, false)).toBe(120);
    expect(stagger(3, 40, STAGGER_CAP, true)).toBe(0);
  });

  it("stagger caps at six steps", () => {
    expect(stagger(0, 40, 6, false)).toBe(0);
    expect(stagger(6, 40, 6, false)).toBe(240);
    expect(stagger(40, 40, 6, false)).toBe(240);
    expect(stagger(2, 30, 6, false)).toBe(60);
  });

  it("counts up from about 70 % with an ease-out, ending exactly on the value", () => {
    expect(counts(9)).toBe(false);
    expect(counts(10)).toBe(true);
    expect(counts(12.5)).toBe(false);
    expect(countFrom(255)).toBe(179);
    expect(countAt(255, 0)).toBe(179);
    expect(countAt(255, MOTION.count)).toBe(255);
    expect(countAt(255, 99_999)).toBe(255);
    expect(countAt(255, MOTION.count / 2)).toBeGreaterThan(Math.round((179 + 255) / 2));
    // No crawl at the end: within 1 of the value by 70 % of the time.
    expect(255 - countAt(255, MOTION.count * 0.7)).toBeLessThanOrEqual(1);
    expect(easeOutQuart(0)).toBe(0);
    expect(easeOutQuart(1)).toBe(1);
    let last = 0;
    for (let t = 0; t <= MOTION.count; t += 35) {
      const v = countAt(108, t);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });

  it("countUp writes the final value at once under reduced motion or for a small number", () => {
    const el = { textContent: "" } as HTMLElement;
    countUp(el, 255, { reduce: true });
    expect(el.textContent).toBe("255");
    const small = { textContent: "" } as HTMLElement;
    countUp(small, 7, { reduce: false });
    expect(small.textContent).toBe("7");
  });

  it("countUp starts lower and lands on the value; cancel shows the value", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const el = { textContent: "" } as HTMLElement;
    const stop = countUp(el, 127, { reduce: false });
    expect(el.textContent).toBe("89");
    frames.shift()!(performance.now() + MOTION.count + 1);
    expect(el.textContent).toBe("127");
    const el2 = { textContent: "" } as HTMLElement;
    const stop2 = countUp(el2, 40, { reduce: false });
    stop2();
    expect(el2.textContent).toBe("40");
    stop();
  });

  it("a new place is another first path segment, not a hub's tab or a page's section", () => {
    expect(newPlace(null, "/apps")).toBe(false);
    expect(newPlace("/", "/apps")).toBe(true);
    expect(newPlace("/effects", "/video")).toBe(true);
    expect(newPlace("/audio", "/audio/music")).toBe(false);
    expect(newPlace("/audio/music", "/audio/sfx")).toBe(false);
    expect(newPlace("/library", "/library?tab=videos")).toBe(false);
    expect(newPlace("/apps", "/apps")).toBe(false);
    expect(newPlace("/settings/runs", "/settings")).toBe(false);
    expect(newPlace("/image", "/")).toBe(true);
    // A tab in the page's own tab row: in place, even to another segment.
    expect(newPlace("/marketing", "/ads", { fromTabRow: true })).toBe(false);
    expect(newPlace("/marketing", "/ads")).toBe(true);
  });

  it("pictures fade in only when they are still loading and nothing else styles them", () => {
    type Img = HTMLImageElement & { listeners: Record<string, () => void> };
    const img = (o: Partial<{ complete: boolean; fetchpriority: string; className: string; opacity: string; src: string }> = {}) => {
      const listeners: Record<string, () => void> = {};
      return {
        complete: o.complete ?? false,
        dataset: {} as DOMStringMap,
        style: { opacity: o.opacity ?? "" },
        className: o.className ?? "",
        closest: () => null,
        getAttribute: (n: string) => (n === "fetchpriority" ? (o.fetchpriority ?? null) : n === "src" ? (o.src ?? "/a.jpg") : null),
        addEventListener: (n: string, f: () => void) => (listeners[n] = f),
        removeEventListener: (n: string) => delete listeners[n],
        listeners,
      } as unknown as Img;
    };
    expect(fadesIn(img())).toBe(true);
    expect(fadesIn(img({ complete: true }))).toBe(false);
    expect(fadesIn(img({ fetchpriority: "high" }))).toBe(false);
    expect(fadesIn(img({ className: "opacity-0 transition-opacity" }))).toBe(false);
    expect(fadesIn(img({ opacity: "0.9" }))).toBe(false);

    const a = img();
    fadeInOnLoad(a);
    expect(a.dataset.fade).toBe("wait");
    a.listeners.load();
    expect(a.dataset.fade).toBe("in");
    const b = img();
    fadeInOnLoad(b);
    b.listeners.error();
    expect(b.dataset.fade).toBeUndefined();
    // Marked once: a second pass leaves it alone.
    fadeInOnLoad(a);
    expect(a.dataset.fade).toBe("in");
  });
});
