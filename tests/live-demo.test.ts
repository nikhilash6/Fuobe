import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DemoTrail } from "@/components/live/live-demo";
import {
  type Box,
  cameraFor,
  CHIP_MAX,
  type Demo,
  type DemoStep,
  demoEnds,
  demoProblems,
  frameOrder,
  framePath,
  KEEP_PULSE_MS,
  LIVE_DEMO,
  LIVE_DEMO_V,
  LOOP_MAX_MS,
  loopMs,
  pillText,
  stepMs,
  SWEEP_MS,
  sweepPath,
  trailWindow,
  typeDelays,
  viewBefore,
  ZOOM_MAX,
  ZOOM_MS,
} from "@/lib/live/demo";

/*
 * The recorded live edit session (public/previews/live-edit/demo.json) and its player (src/lib/live/demo.ts,
 * src/components/live/live-demo.tsx): the file plays, every frame is there, one round stays short, and a long session
 * keeps its trail readable.
 */

const PUBLIC = path.join(__dirname, "..", "public");
const exists = (src: string) => fs.existsSync(path.join(PUBLIC, src));
const shippedText = fs.readFileSync(path.join(PUBLIC, LIVE_DEMO), "utf8").replace(/\r\n/g, "\n");
const shipped = JSON.parse(shippedText) as Demo;

/**
 * An eleven-step session in the shape of the shipped one: the camera moves in on the changed area, partial live frames
 * arrive while typing, the camera pulls back out as the settled one arrives, then the keep. The two big changes keep
 * the whole picture.
 */
const LABELS = ["Red lips", "Hair down", "Gold hoops", "Velvet gown", "Diamond choker", "Red rose", "Fur stole", "Ballroom", "Spotlight", "Soft smile", "Cinematic grade"];
function longSession(): Demo {
  const frames: Demo["frames"] = { s0: { src: "/previews/x/960/step-00.jpg", small: "/previews/x/512/step-00.jpg" } };
  const script: DemoStep[] = [{ type: "frame", frame: "s0", ms: 800 }];
  LABELS.forEach((label, i) => {
    const n = String(i + 1).padStart(2, "0");
    const early = i < 2;
    frames[`s${i + 1}a`] = { src: `/previews/x/960/step-${n}a.jpg` };
    frames[`s${i + 1}`] = { src: `/previews/x/960/step-${n}.jpg` };
    const box: Box | null = label === "Ballroom" || label === "Spotlight" ? null : [0.4, 0.3, 0.6, 0.6];
    if (box) script.push({ type: "zoom", box, ms: 200 });
    script.push(
      { type: "type", text: label.toLowerCase(), ms: early ? 700 : 450 },
      { type: "frame", frame: `s${i + 1}a`, live: true, ms: early ? 600 : 540 },
      { type: "type", text: " please", ms: early ? 500 : 300 },
    );
    if (box) script.push({ type: "zoom", box: null, ms: 0 });
    script.push({ type: "frame", frame: `s${i + 1}`, ms: early ? 700 : 560 }, { type: "keep", label, ms: early ? 900 : 700 });
  });
  script.push({ type: "compare", ms: 3400 }, { type: "pause", ms: 1200 });
  return { v: 2, size: [960, 720], frames, script };
}

describe("the shipped demo", () => {
  it("plays: every frame file is there, every step is valid, one round is short", () => {
    expect(demoProblems(shipped, exists)).toEqual([]);
    expect(loopMs(shipped)).toBeLessThanOrEqual(LOOP_MAX_MS);
  });

  it("is one session of eleven kept steps, each settled picture shown before its keep", () => {
    const keeps = shipped.script.flatMap((s, i) => (s.type === "keep" ? [i] : []));
    expect(keeps).toHaveLength(11);
    for (const [k, i] of keeps.entries()) {
      const prev = shipped.script[i - 1];
      expect(prev).toMatchObject({ type: "frame", frame: `s${k + 1}` });
      expect(prev.type === "frame" && prev.live).toBeFalsy();
    }
    expect(shipped.script.at(-2)?.type).toBe("compare");
    expect(Object.keys(shipped.frames)[0]).toBe("s0");
    for (const id of Object.keys(shipped.frames)) expect(id).not.toMatch(/^\d+$/);
  });

  it("is fetched at its content version, and so is every frame", () => {
    const sha8 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex").slice(0, 8);
    expect(sha8(shippedText)).toBe(LIVE_DEMO_V);
    for (const f of Object.values(shipped.frames)) {
      for (const src of [f.src, f.small].filter(Boolean) as string[]) {
        expect(src).toMatch(/\?v=[0-9a-f]{8}$/);
        expect(src.split("?v=")[1]).toBe(sha8(fs.readFileSync(path.join(PUBLIC, framePath(src)))));
      }
    }
  });

  it("compares the original with the last picture, whatever order the frames are listed in", () => {
    const ends = demoEnds(shipped);
    const order = frameOrder(shipped);
    expect(ends).toEqual({ before: order[0], after: order.at(-1) });
    const shuffled: Demo = { ...shipped, frames: Object.fromEntries(Object.entries(shipped.frames).reverse()) };
    expect(demoEnds(shuffled)).toEqual(ends);
  });

  it("zooms in on every small change, and back out before the settled picture", () => {
    let zoom: Box | null = null;
    let zoomed = 0;
    for (const s of shipped.script) {
      if (s.type === "zoom") {
        zoom = s.box;
        // A zoom that would keep the whole picture is left out.
        if (s.box) expect(cameraFor(s.box).s).toBeGreaterThan(1);
        if (s.box) zoomed++;
      }
      if (s.type === "keep" || s.type === "compare" || (s.type === "frame" && !s.live)) expect(zoom).toBeNull();
    }
    expect(zoomed).toBeGreaterThanOrEqual(4);
  });

  it("starts each step's first live frame once the camera has finished moving in", () => {
    shipped.script.forEach((s, i) => {
      if (s.type !== "zoom" || !s.box) return;
      let ms = s.ms;
      for (const n of shipped.script.slice(i + 1)) {
        if (n.type === "frame") break;
        ms += stepMs(n);
      }
      expect(ms).toBeGreaterThanOrEqual(ZOOM_MS);
    });
  });

  it("shows each live frame long enough to be drawn across and seen", () => {
    for (const s of shipped.script) if (s.type === "frame" && s.live) expect(s.ms).toBeGreaterThanOrEqual(SWEEP_MS);
  });

  it("shows no timings: the pill says Live or Kept, nothing more", () => {
    expect(shippedText).not.toMatch(/Ms"\s*:/);
  });
});

describe("timing", () => {
  it("types in the time the script gives, spaces a little slower", () => {
    const d = typeDelays("deep red lips", 1300);
    expect(d.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1300);
    expect(d.reduce((a, b) => a + b, 0)).toBeGreaterThan(1300 - 13);
    expect(d[4] - d[3]).toBe(40);
  });

  it("never types faster than a person can read", () => {
    expect(Math.min(...typeDelays("a very long instruction typed in no time at all", 100))).toBeGreaterThanOrEqual(28);
  });

  it("holds a keep for at least its pulse", () => {
    expect(stepMs({ type: "keep", label: "x", ms: 100 })).toBe(KEEP_PULSE_MS);
  });
});

describe("an eleven-step session", () => {
  const d = longSession();
  const without = (src: string) => !src.includes("/x/");

  it("is valid apart from its stand-in files, and one round takes about half a minute", () => {
    expect(demoProblems(d)).toEqual([]);
    expect(demoProblems(d, without).every((p) => p.endsWith("is missing"))).toBe(true);
    expect(loopMs(d)).toBeGreaterThan(28_000);
    expect(loopMs(d)).toBeLessThanOrEqual(LOOP_MAX_MS);
  });

  it("compares the original with the eleventh step", () => {
    expect(demoEnds(d)).toEqual({ before: "s0", after: "s11" });
  });

  it("picks up where it paused, with the kept steps and the typed text", () => {
    const keep7 = d.script.findIndex((s) => s.type === "keep" && s.label === LABELS[6]);
    const v = viewBefore(d, keep7 + 2);
    expect(v.steps).toEqual(LABELS.slice(0, 7));
    expect(v.frame).toBe("s7");
    expect(v.typed).toBe(LABELS[7].toLowerCase());
    expect(v.pill).toBe("Kept ✓");
    expect(v.zoom).toBeNull();
    // The picture is there at once, not faded in from the dark behind it.
    expect(v).toMatchObject({ fade: 0, sweep: false, under: null });
    const mid = viewBefore(d, keep7 + 3);
    expect(mid).toMatchObject({ frame: "s8a", pill: "Live" });
    const keep2 = d.script.findIndex((s) => s.type === "keep" && s.label === LABELS[1]);
    expect(viewBefore(d, keep2 + 4)).toMatchObject({ frame: "s3a", zoom: [0.4, 0.3, 0.6, 0.6] });
    expect(viewBefore(d, keep2).zoom).toBeNull();
  });

  it("shows the count on the small card after a keep", () => {
    expect(pillText({ pill: "Live", steps: [] })).toEqual({ main: "Live", count: null });
    expect(pillText({ pill: "Kept ✓", steps: LABELS.slice(0, 7) }, true).count).toBe("7");
    expect(pillText({ pill: "Kept ✓", steps: LABELS.slice(0, 7) }).count).toBeNull();
  });

  it("refuses chip labels too long for a phone, keeps too short for the pulse, and a round over the limit", () => {
    const bad: Demo = { ...d, script: d.script.map((s) => (s.type === "keep" ? { ...s, label: "x".repeat(CHIP_MAX + 1), ms: 200 } : s)) };
    const p = demoProblems(bad);
    expect(p.some((x) => x.includes("label"))).toBe(true);
    expect(p.some((x) => x.includes(`${KEEP_PULSE_MS} ms`))).toBe(true);
    const slow: Demo = { ...d, script: [...d.script, { type: "pause", ms: LOOP_MAX_MS }] };
    expect(demoProblems(slow).some((x) => x.startsWith("one round"))).toBe(true);
  });
});

describe("the camera", () => {
  /** Where a point of the picture lands in the frame, as shares of its width and height. */
  const at = (c: ReturnType<typeof cameraFor>, px: number, py: number) => [c.x + c.s * px, c.y + c.s * py];

  it("stays on the whole picture with no area, or one that already fills most of it", () => {
    expect(cameraFor(null)).toEqual({ s: 1, x: 0, y: 0 });
    expect(cameraFor([0.01, 0.01, 0.99, 0.99])).toEqual({ s: 1, x: 0, y: 0 });
    expect(cameraFor([0.27, 0.11, 0.68, 0.89])).toEqual({ s: 1, x: 0, y: 0 });
  });

  it("moves in on a small change, centred, no closer than the limit", () => {
    const c = cameraFor([0.45, 0.45, 0.55, 0.55]);
    expect(c.s).toBe(ZOOM_MAX);
    const [x, y] = at(c, 0.5, 0.5);
    expect(x).toBeCloseTo(0.5);
    expect(y).toBeCloseTo(0.5);
  });

  it("frames a mid-size change whole, with room around it", () => {
    const box: Box = [0.2, 0.25, 0.75, 0.7];
    const c = cameraFor(box);
    expect(c.s).toBeGreaterThan(1.15);
    expect(c.s).toBeLessThan(ZOOM_MAX);
    const [l, t0] = at(c, box[0], box[1]);
    const [r, b] = at(c, box[2], box[3]);
    for (const v of [l, t0]) expect(v).toBeGreaterThan(0);
    for (const v of [r, b]) expect(v).toBeLessThan(1);
  });

  it("never shows past the picture's edge, even for a change in a corner", () => {
    for (const box of [[0, 0, 0.1, 0.1], [0.9, 0.85, 1, 1], [0.6, 0.15, 0.68, 0.36], [0.31, 0.63, 0.61, 1]] as Box[]) {
      const c = cameraFor(box);
      expect(c.x).toBeLessThanOrEqual(0);
      expect(c.y).toBeLessThanOrEqual(0);
      expect(c.x + c.s).toBeGreaterThanOrEqual(1);
      expect(c.y + c.s).toBeGreaterThanOrEqual(1);
    }
  });

  it("draws a live frame across exactly the part of the picture in view", () => {
    // The edge's centre, in shares of the picture's width, for a mask-position (see sweepPath).
    const centre = (pos: number) => 1.25 - 1.5 * (pos / 100);
    const whole = sweepPath(cameraFor(null));
    expect(whole).toEqual({ from: 90, to: 10, scanFrom: -10, scanTo: 110 });
    for (const box of [null, [0.42, 0.26, 0.65, 0.71], [0.58, 0.16, 0.68, 0.36], [0.31, 0.63, 0.61, 1]] as (Box | null)[]) {
      const cam = cameraFor(box);
      const p = sweepPath(cam);
      const [l, r] = [-cam.x / cam.s, (1 - cam.x) / cam.s];
      // It starts with the whole edge just left of the view and ends just right of it; the line rides the edge.
      expect(centre(p.from) + 0.1).toBeCloseTo(l, 2);
      expect(centre(p.to) - 0.1).toBeCloseTo(r, 2);
      expect(p.scanFrom / 100).toBeCloseTo(centre(p.from), 2);
      expect(p.scanTo / 100).toBeCloseTo(centre(p.to), 2);
    }
  });

  it("refuses a zoom box outside the picture", () => {
    const d = longSession();
    const bad: Demo = { ...d, script: d.script.map((s) => (s.type === "zoom" && s.box ? { ...s, box: [0.5, 0.2, 0.4, 1.2] as Box } : s)) };
    expect(demoProblems(bad).some((x) => x.includes("zoom box"))).toBe(true);
  });
});

describe("the trail", () => {
  it("folds older steps into a count and keeps the newest", () => {
    expect(trailWindow(LABELS.slice(0, 7), 1)).toEqual({ hidden: 6, shown: [{ n: 7, label: "Fur stole" }] });
    expect(trailWindow(LABELS.slice(0, 7), 3).hidden).toBe(4);
    expect(trailWindow(LABELS.slice(0, 2), 3)).toEqual({ hidden: 0, shown: [{ n: 1, label: "Red lips" }, { n: 2, label: "Hair down" }] });
  });

  it("renders Original, the folded count for each width, and at most three chips, the newest lit", () => {
    const html = renderToStaticMarkup(createElement(DemoTrail, { steps: LABELS }));
    expect(html).toContain(">Original<");
    expect(html.match(/data-live-chip="/g)).toHaveLength(3);
    expect(html).toContain('data-live-chip="11"');
    expect(html).not.toContain('data-live-chip="8"');
    expect(html).toContain('data-live-more="10"');
    expect(html).toContain('data-live-more="8"');
    expect(html.match(/data-newest="true"/g)).toHaveLength(1);
    expect(html).toMatch(/data-live-chip="11"[^>]*aria-current="step"|aria-current="step"[^>]*data-live-chip="11"/);
    // Phones see only the newest chip and the count of the rest.
    expect(html).toMatch(/class="contents @max-md:hidden"><span[^>]*>›<\/span><span[^>]*data-live-chip="10"/);
  });

  it("lets Original step aside on narrow players once earlier steps fold into a count", () => {
    const folded = renderToStaticMarkup(createElement(DemoTrail, { steps: LABELS }));
    expect(folded).toMatch(/<span class="[^"]*@max-md:hidden[^"]*"[^>]*data-live-original/);
    // The narrow count then leads the trail, with no separator before it.
    expect(folded).toMatch(/class="contents @md:hidden"><span[^>]*data-live-more="10"/);
    const first = renderToStaticMarkup(createElement(DemoTrail, { steps: LABELS.slice(0, 1) }));
    expect(first).toMatch(/data-live-original/);
    expect(first).not.toMatch(/<span class="[^"]*@max-md:hidden[^"]*"[^>]*data-live-original/);
  });

  it("has no wide count before a fourth step while the narrow one folds the earlier ones; nothing before the first keep", () => {
    const html = renderToStaticMarkup(createElement(DemoTrail, { steps: LABELS.slice(0, 3) }));
    expect(html).toContain('data-live-more="2"');
    expect(html).not.toContain('data-live-more="0"');
    expect(html.match(/data-live-chip="/g)).toHaveLength(3);
    expect(renderToStaticMarkup(createElement(DemoTrail, { steps: [] }))).toBe("");
  });

  it("keeps every chip on one line, cut short rather than wrapped", () => {
    const html = renderToStaticMarkup(createElement(DemoTrail, { steps: LABELS }));
    for (const chip of html.match(/<span class="[^"]*"[^>]*data-live-chip="\d+"/g) ?? []) expect(chip).toMatch(/truncate/);
  });
});
