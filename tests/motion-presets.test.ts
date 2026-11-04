import { describe, expect, it } from "vitest";
import { back, CURVES, cubic, elastic, quart } from "@/lib/motion/ease";
import { textNodes, type DisplayNode, type TextNode } from "@/lib/motion/display";
import { drawType, planType, poseAt, staggerStarts, type TextMotion, type TypePlan } from "@/lib/motion/type/animate";
import { setType, type TypeSpec } from "@/lib/motion/type/glyphs";
import { F, flapCount, LOOP_REST, loopAt, neonAt, PRESET_IDS, PRESETS, presetsFor, REST, scrambleLock, cycleSet, type Pose, type PresetId } from "@/lib/motion/type/presets";
import { spelled } from "@/lib/motion/layout";
import { DURATION_LIMITS, STAGGER_LIMITS } from "@/lib/motion/tween";
import { measure } from "./helpers/motion";

// Kinetic text presets: each a pure function of time, frame-exact against its written spec, landing exactly on the
// layout at rest, with the typed words intact at every frame.

const FRAME = { w: 1080, h: 1920 };
const DEG = Math.PI / 180;

function makeSet(text = "Make it count", over: Partial<TypeSpec> = {}) {
  return setType({ field: "headline", text, family: "Anton", weight: 400, max: 200, min: 60, x: 100, y: 300, width: 880, maxLines: 3, leading: 0.84, ...over }, measure);
}

function plan(id: PresetId, text = "Make it count", motion: Partial<TextMotion> = {}, spec: Partial<TypeSpec> = {}): TypePlan {
  const preset = PRESETS[id];
  const s = makeSet(id === "odometer" ? "$1,284" : text, { ...spec, widest: preset.widest, tabular: id === "odometer" || spec.tabular });
  return planType("headline", s, { in: id, at: 1, seed: 7, ...motion }, FRAME);
}

/** Unit `i`'s pose `f` frames after its own start. */
const at = (p: TypePlan, f: number, i = 0): Pose => poseAt(p, i, p.units[i].start + f * F);

const close = (a: number | undefined, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits);

function expectRest(p: Pose) {
  expect(p).toEqual(REST);
}

describe("frame-exact entrances", () => {
  it("cut-rise: each line rises from below its clip, tilted 4°, in 700 ms on enter, opaque throughout", () => {
    const p = plan("cut-rise");
    const u = p.units[0].info;
    const from = Math.max(1.1 * u.lh, u.clear.down);
    const f0 = at(p, 0);
    close(f0.dy, from);
    close(f0.rot, 4 * DEG);
    expect(f0.opacity).toBe(1);
    expect(f0.clip).toBe(true);
    const k = CURVES.enter(7 / 21);
    close(at(p, 7).dy, (1 - k) * from);
    close(at(p, 7).rot, (1 - k) * 4 * DEG);
    expectRest(at(p, 21));
    // A hero takes 850 ms.
    const hero = plan("cut-rise", "Make it count", { hero: true });
    expect(at(hero, 21).dy).toBeGreaterThan(0);
    expectRest(at(hero, 26));
    // It starts wholly below its line's clip, so not a sliver shows on the first frame.
    expect(from).toBeGreaterThanOrEqual(u.clear.down);
  });

  it("cut-rise-glyph: letters rise 105 % of the line pitch with a 5° tilt in 650 ms", () => {
    const p = plan("cut-rise-glyph");
    const u = p.units[0].info;
    const from = Math.max(1.05 * u.lh, u.clear.down);
    close(at(p, 0).dy, from);
    close(at(p, 0).rot, 5 * DEG);
    const k = CURVES.enter(10 / 30 / 0.65);
    close(at(p, 10).dy, (1 - k) * from);
    expectRest(at(p, 20));
  });

  it("word-lift and word-drop: 0.6 em on decel in 450 ms, opaque by 60 % of the time", () => {
    const p = plan("word-lift");
    const em = p.set.size;
    close(at(p, 0).dy, 0.6 * em);
    expect(at(p, 0).opacity).toBe(0);
    close(at(p, 6).dy, (1 - CURVES.decel(0.2 / 0.45)) * 0.6 * em);
    close(at(p, 6).opacity, 0.2 / 0.27);
    expectRest(at(p, 14));
    const d = plan("word-drop");
    close(at(d, 0).dy, -0.6 * em);
  });

  it("curtain: a feathered wipe left to right over 600 ms as the line drifts 0.1 em", () => {
    const p = plan("curtain");
    const em = p.set.size;
    expect(at(p, 0).reveal).toEqual({ from: 0, to: 0, feather: 0.1 });
    close(at(p, 9).reveal!.to, CURVES.move(0.5) * 1.1);
    close(at(p, 9).dx, -(1 - CURVES.enter(0.5)) * 0.1 * em);
    expectRest(at(p, 18));
  });

  it("bar-swipe: the bar grows in 7 frames, holds 2, words on when covered, then the bar leaves right in 240 ms", () => {
    const p = plan("bar-swipe");
    expect(at(p, 0).opacity).toBe(0);
    close(at(p, 3).bar!.to, CURVES.snap(3 / 7));
    expect(at(p, 3).opacity).toBe(0);
    expect(at(p, 7).bar).toEqual({ from: 0, to: 1 });
    expect(at(p, 7).opacity).toBe(1);
    expect(at(p, 8).bar).toEqual({ from: 0, to: 1 });
    close(at(p, 12).bar!.from, CURVES.snap((12 * F - 9 * F) / 0.24));
    expectRest(at(p, 17));
  });

  it("focus-in: blur 16 → 0, opacity 0 → 1, scale 1.06 → 1 over 700 ms (cubic out)", () => {
    const p = plan("focus-in");
    expect(at(p, 0)).toMatchObject({ blur: 16, opacity: 0, sx: 1.06, sy: 1.06 });
    const k = cubic.out(10 / 21);
    close(at(p, 10).blur, 16 * (1 - k));
    close(at(p, 10).opacity, k);
    close(at(p, 10).sx, 1.06 - 0.06 * k);
    expectRest(at(p, 21));
  });

  it("track-in: +0.40 em closes over 3 s on decel, opaque by 20 % and sharp by 40 % of the time", () => {
    const p = plan("track-in");
    expect(at(p, 0)).toMatchObject({ opacity: 0, blur: 6, tracking: 0.4 });
    expect(at(p, 18).opacity).toBe(1);
    close(at(p, 18).blur, 3);
    close(at(p, 18).tracking!, 0.4 - 0.4 * CURVES.decel(0.2));
    expect(at(p, 36).blur).toBe(0);
    expectRest(at(p, 90));
  });

  it("snap-tight: +0.17 em of tracking snaps shut in 500 ms", () => {
    const p = plan("snap-tight");
    expect(at(p, 0).tracking).toBe(0.17);
    close(at(p, 3).opacity, 0.1 / 0.12);
    close(at(p, 3).tracking!, 0.17 * (1 - CURVES.enter(0.2)));
    expectRest(at(p, 15));
  });

  it("slow-drift: 0.25 em from the left with opacity over 1.1 s on decel", () => {
    const p = plan("slow-drift");
    const em = p.set.size;
    close(at(p, 0).dx, -0.25 * em);
    const k = CURVES.decel((16 / 30) / 1.1);
    close(at(p, 16).dx, -(1 - k) * 0.25 * em);
    close(at(p, 16).opacity, k);
    expectRest(at(p, 33));
  });

  it("stomp: 1.8 → 1 accelerating into the surface in 5 frames, a squash, a ring that grows and fades", () => {
    const p = plan("stomp");
    expect(at(p, 0)).toMatchObject({ sx: 1.8, sy: 1.8, opacity: 0 });
    const s1 = 1.8 - 0.8 * CURVES.slam(1 / 5);
    close(at(p, 1).sx, s1);
    close(at(p, 1).opacity, 0.5);
    expect(at(p, 5)).toMatchObject({ sx: 1.03, sy: 0.96 });
    close(at(p, 5).ghost!.s, 1);
    close(at(p, 5).ghost!.a, 0.35);
    close(at(p, 7).sx, 1);
    close(at(p, 7).ghost!.s, 1 + 0.15 * (2 / 7));
    close(at(p, 7).ghost!.a, 0.35 * (5 / 7));
    expectRest(at(p, 12));
  });

  it("stomp nudges the camera on impact and flashes only when asked", () => {
    const p = plan("stomp", "SALE", { flash: true });
    const impact = p.units[0].start + 5 * F;
    const f = drawType(p, { fill: "#ffffff" }, impact + 0.001);
    expect(Math.hypot(f.camera.x, f.camera.y)).toBeCloseTo(8 * Math.exp((-5 * 0.001) / (6 * F)), 3);
    expect(f.flash).toBe(0.06);
    expect(drawType(p, { fill: "#ffffff" }, impact + 7 * F).camera).toEqual({ x: 0, y: 0 });
    expect(drawType(plan("stomp", "SALE"), { fill: "#ffffff" }, impact + 0.001).flash).toBe(0);
  });

  it("beat-cut: each word alone and as wide as the block for a beat, then the line lands together", () => {
    const p = plan("beat-cut", "Run the city", { beat: 0.5 });
    const u0 = p.units[0].info;
    const s0 = Math.min(2.5, Math.max(1, (u0.block.w * 0.92) / u0.w));
    close(at(p, 0, 0).sx, s0 * 1.15);
    close(at(p, 4, 0).sx, s0);
    expect(at(p, 0, 1).opacity).toBe(0);
    expect(poseAt(p, 0, p.units[0].start + 0.5).opacity).toBe(0);
    expect(poseAt(p, 1, p.units[0].start + 0.5).opacity).toBe(1);
    close(poseAt(p, 0, p.units[0].start + 1.5).sx, 1.06);
    expectRest(poseAt(p, 0, p.units[0].start + 1.5 + 6 * F));
  });

  it("punch: squash 1.6 × 0.7, stretch to 0.95 × 1.08, then 1 in 360 ms", () => {
    const p = plan("punch");
    expect(at(p, 0)).toMatchObject({ sx: 1.6, sy: 0.7 });
    close(at(p, 6).sx, 0.95);
    close(at(p, 6).sy, 1.08);
    expectRest(at(p, 11));
  });

  it("pop-in: 0 → 1.12 at 60 % → 0.97 → 1 with a ±4° turn, 380 ms", () => {
    const p = plan("pop-in");
    expect(at(p, 0)).toMatchObject({ sx: 0, sy: 0, opacity: 0 });
    close(Math.abs(at(p, 0).rot), 4 * DEG);
    const q = (7 / 30) / 0.38;
    close(at(p, 7).sx, 1.12 - 0.15 * CURVES.move((q - 0.6) / 0.2));
    expectRest(at(p, 12));
  });

  it("burst: letters fly from the block's middle on back(1.4)", () => {
    const p = plan("burst");
    const u = p.units[0].info;
    expect(at(p, 0).sx).toBe(0);
    close(at(p, 0).dx, u.block.x + u.block.w / 2 - (u.x + u.w / 2));
    close(at(p, 6).sx, back(1.4).out(0.2 / 0.45));
    expectRest(at(p, 14));
  });

  it("inflate: 0.6 → 1 on elastic(1, 0.4) with a ±3° turn, 500 ms", () => {
    const p = plan("inflate");
    close(at(p, 0).sx, 0.6);
    close(at(p, 6).sx, 0.6 + 0.4 * elastic(1, 0.4).out(0.4));
    expectRest(at(p, 15));
  });

  it("merge and plates: odd lines from the left, even from the right, 40 % of the frame", () => {
    const p = plan("merge", "Two lines\nmeet here");
    close(at(p, 0, 0).dx, -0.4 * FRAME.w);
    close(at(p, 0, 1).dx, 0.4 * FRAME.w);
    expectRest(at(p, 18, 0));
    const q = plan("plates", "Two lines\nmeet here");
    close(at(q, 9, 0).dx, -0.4 * FRAME.w * (1 - back(1.1).out(0.5)));
  });

  it("slide-in: 30 % of the frame from the right on quart out", () => {
    const p = plan("slide-in");
    close(at(p, 0).dx, 0.3 * FRAME.w);
    close(at(p, 6).dx, 0.3 * FRAME.w * (1 - quart.out(0.4)));
    expectRest(at(p, 15));
  });

  it("echo-trail: copies 2.5 frames apart at 0.5 / 0.3 / 0.15 of the word's opacity, collapsing into it at rest", () => {
    const p = plan("slide-in", "Make it count", { echo: 3 });
    const t = p.units[0].start + 6 * F;
    const echoes = (nodes: DisplayNode[]) =>
      nodes.filter((n): n is Extract<DisplayNode, { type: "group" }> => n.type === "group" && n.children.length === 1 && n.children[0].type === "text" && !!(n.children[0] as TextNode).decor);
    const trail = echoes(drawType(p, { fill: "#ffffff" }, t).nodes);
    expect(trail).toHaveLength(3);
    [0.5, 0.3, 0.15].forEach((a, k) => {
      const q = poseAt(p, 0, t - (k + 1) * 2.5 * F);
      close(trail[k].opacity, a * q.opacity);
      // Each copy sits further back along the move (slide-in travels right to left).
      close(trail[k].transform?.[4], q.dx);
      expect(q.dx).toBeGreaterThan(at(p, 6).dx);
      // An echo is decoration: the typed words are drawn once, by the unit itself.
      expect((trail[k].children[0] as TextNode).runs.map((r) => r.text).join("")).toBe((trail[0].children[0] as TextNode).runs.map((r) => r.text).join(""));
    });
    expect(echoes(drawType(p, { fill: "#ffffff" }, p.settled + F).nodes)).toHaveLength(0);
    expect(echoes(drawType(plan("slide-in"), { fill: "#ffffff" }, t).nodes)).toHaveLength(0);
  });

  it("flip-up: −95° to flat, squeezed by cos θ, sheared, shaded to 35 % and faded in by 45°", () => {
    const p = plan("flip-up");
    const u = p.units[0].info;
    const f0 = at(p, 0);
    expect(f0.opacity).toBe(0);
    close(f0.sy, 0.001);
    const th = -95 * DEG * (1 - CURVES.enter((10 / 30) / 0.65));
    const f10 = at(p, 10);
    close(f10.sy, Math.max(0.001, Math.cos(th)));
    close(f10.skewX, Math.sin(th) * 0.12);
    close(f10.dy, -Math.sin(th) * 0.6 * u.cap);
    close(f10.shade, 0.35 * Math.min(1, Math.abs(th) / (Math.PI / 2)));
    expectRest(at(p, 20));
  });

  it("fold: the top half hinges from 90° in 500 ms", () => {
    const p = plan("fold");
    close(at(p, 0).fold!, Math.PI / 2);
    close(at(p, 6).fold!, (Math.PI / 2) * (1 - cubic.out(0.4)));
    expectRest(at(p, 15));
  });

  it("tumble: 160° about the bottom left, 0.4 em, back(1.2), 600 ms", () => {
    const p = plan("tumble");
    close(at(p, 0).rot, 160 * DEG);
    close(at(p, 0).dy, 0.4 * p.set.size);
    expectRest(at(p, 18));
  });

  it("type-on: letters appear in steps at the typing rate, no easing", () => {
    const p = plan("type-on", "Make it count", { rate: 20 });
    const t = (f: number) => p.units[0].start + f * F;
    expect(poseAt(p, 0, t(0)).opacity).toBe(1);
    expect(poseAt(p, 1, t(1)).opacity).toBe(0);
    expect(poseAt(p, 1, t(2)).opacity).toBe(1);
  });

  it("scramble: slots cycle letters of their own kind every two frames and lock left to right by 600 ms", () => {
    const p = plan("scramble", "SIGNAL 42");
    const n = p.units.length;
    const f0 = at(p, 0, 0);
    expect(f0.shown).toBeDefined();
    expect(f0.shown).not.toBe(p.units[0].info.text);
    expect(cycleSet(p.units[0].info.text)).toContain(f0.shown!);
    expect(at(p, 1, 0).shown).toBe(f0.shown);
    const digit = p.units.findIndex((u) => u.info.text === "4");
    expect(cycleSet("4")).toContain(at(p, 0, digit).shown!);
    expectRest(poseAt(p, 0, p.units[0].start + 0.25));
    const last = scrambleLock(p.units[n - 1].info);
    expect(last).toBeLessThanOrEqual(0.6);
    expectRest(poseAt(p, n - 1, p.units[0].start + last));
  });

  it("neon-strike: off, 0.6, off, 0.4, off, on, 0.8, on — by frame", () => {
    expect([0, 1, 2, 3, 6, 7, 9, 12, 13].map((f) => neonAt(f * F))).toEqual([0, 0, 0.6, 0, 0.4, 0, 1, 0.8, 1]);
    const p = plan("neon-strike");
    expect(at(p, 2)).toMatchObject({ glow: 0.6, shade: 0.6 * 0.4 });
    expectRest(at(p, 13));
  });

  it("split-flap: 4–8 flips of 50 ms each, ending on the typed letter", () => {
    const p = plan("split-flap", "GATE 12");
    const flips = flapCount(p.units[0].info, p.options);
    expect(flips).toBeGreaterThanOrEqual(4);
    expect(flips).toBeLessThanOrEqual(8);
    expect(at(p, 0).flap!.phase).toBe(0);
    const lastFlip = poseAt(p, 0, p.units[0].start + (flips - 1) * 0.05 + 0.025);
    expect(lastFlip.flap!.to).toBe("G");
    expectRest(poseAt(p, 0, p.units[0].start + flips * 0.05));
  });

  it("split-flap: a figure counts up to its own value, so a clock never shows an impossible time on the way", () => {
    const p = plan("split-flap", "03:12:45");
    p.units.forEach((u, i) => {
      if (!/^d$/.test(u.info.text)) return;
      for (let f = -2; f < 30; f++) {
        const q = poseAt(p, i, u.start + f * F);
        if (!q.flap) continue;
        for (const d of [q.flap.from, q.flap.to]) {
          expect(/^d$/.test(d), d).toBe(true);
          expect(Number(d)).toBeLessThanOrEqual(Number(u.info.text));
        }
      }
    });
  });

  it("fade-rise: small facts fade in rising a few pixels in about a fifth of a second, whole (never typed)", () => {
    const p = plan("fade-rise", "lumenlabs.io");
    expect(p.units).toHaveLength(1);
    expect(at(p, -1).opacity).toBe(0);
    expect(at(p, 3).opacity).toBeGreaterThan(0.5);
    expect(at(p, 3).dy).toBeGreaterThan(0);
    expectRest(at(p, 7));
  });

  it("odometer: figures roll once from a blank place to their typed value, rightmost first; no leading zero; signs fade in with them", () => {
    const p = plan("odometer");
    const digits = p.units.filter((u) => /\d/.test(u.info.text));
    const right = digits[digits.length - 1];
    const left = digits[0];
    expect(right.start).toBeLessThan(left.start);
    expect(left.info.lead).toBe(true);
    expect(right.info.lead).toBe(false);
    const i = p.units.indexOf(right);
    // Before it starts: blank (the place below 0), never a placeholder figure.
    expect(poseAt(p, i, right.start - F).roll).toBe(-1);
    expect(poseAt(p, i, right.start - F).rollFrom).toBe(0);
    const target = Number(right.info.text);
    close(poseAt(p, i, right.start + 0.7).roll!, -1 + (target + 1) * CURVES.roll(0.5));
    // Under half a place a frame at its fastest.
    for (let f = 0; f < 40; f++) expect(Math.abs(poseAt(p, i, right.start + (f + 1) * F).roll! - poseAt(p, i, right.start + f * F).roll!)).toBeLessThan(0.75);
    // The leading column only rises into place: it never shows a figure below its own.
    const li = p.units.indexOf(left);
    expect(poseAt(p, li, left.start + 0.3).rollFrom).toBe(Number(left.info.text));
    expectRest(poseAt(p, i, right.start + 1.4));
    // A separator never shows before the figures round it: hidden, then it fades in over its column's second half
    // without moving, and is at rest once the roll has passed.
    const sign = p.units.findIndex((u) => u.info.text === ",");
    const s0 = p.units[sign].start;
    expect(poseAt(p, sign, s0 - F).opacity).toBe(0);
    expect(poseAt(p, sign, s0 + 0.3).opacity).toBe(0);
    for (let f = 0; f < 60; f++) {
      const q = poseAt(p, sign, s0 + f * F);
      expect(q.dx).toBe(0);
      expect(q.dy).toBe(0);
    }
    expectRest(poseAt(p, sign, s0 + 0.9));
  });

  it("cut-paper: on twos (12 fps): −8° at 1.15, over to +3°, then 0", () => {
    const p = plan("cut-paper");
    close(at(p, 0).rot, -8 * DEG);
    close(at(p, 0).sx, 1.15);
    expect(at(p, 1)).toEqual(at(p, 0));
    const s = 1 / 12;
    close(at(p, 3).rot, (-8 + 11 * CURVES.snap(s / 0.3 / 0.6)) * DEG);
    expectRest(at(p, 9));
  });

  it("weight-wave: 200 → 900 → the face's weight, 500 ms each", () => {
    const p = plan("weight-wave");
    expect(at(p, 0).weight).toBe(200);
    close(at(p, 6).weight!, 200 + 700 * CURVES.snap(0.4));
    expect(at(p, 15).weight).toBe(900);
    expectRest(at(p, 30));
  });

  it("ink-draw: a feathered wipe along the word on the draw curve", () => {
    const p = plan("ink-draw");
    expect(at(p, 0).reveal!.to).toBe(0);
    close(at(p, 11).reveal!.to, CURVES.draw((11 / 30) / 0.75) * 1.12);
    expectRest(at(p, 23));
  });
});

// ---------------------------------------------------------------------------

const TEXTS = ["Make it count", "Invoices that chase themselves.", "Le Sérum\nNuit", "SALE 20% OFF"];

function nonDecor(nodes: readonly DisplayNode[]): TextNode[] {
  return textNodes(nodes).filter((n) => !n.decor);
}

describe("every preset", () => {
  it("rests exactly on the layout: one text node, spelled exactly as typed, nothing swapped or moved", () => {
    for (const id of PRESET_IDS) {
      for (const text of TEXTS) {
        const p = plan(id, text);
        const settledAt = p.settled + 0.001;
        for (let i = 0; i < p.units.length; i++) expectRest(poseAt(p, i, settledAt));
        const frame = drawType(p, { fill: "#111111" }, settledAt);
        expect(frame.still, `${id} "${text}"`).toBe(true);
        const fields = nonDecor(frame.nodes);
        expect(fields.length, id).toBe(1);
        const typed = id === "odometer" ? "$1,284" : text;
        expect(spelled(fields[0].runs), `${id} "${text}"`).toBe(typed.trim());
        for (const r of fields[0].runs) expect(r.shown, id).toBeUndefined();
      }
    }
  });

  it("draws only typed letters as each run's text at every frame (a scramble's stand-in is `shown`, never `text`)", () => {
    for (const id of PRESET_IDS) {
      const text = "Make it count";
      const p = plan(id, text, { exitAt: 6 });
      const typed = id === "odometer" ? "$1,284" : text;
      for (let f = 0; f <= 7.5 * 30; f += 1) {
        for (const n of textNodes(drawType(p, { fill: "#111111" }, f * F).nodes)) for (const r of n.runs) expect(typed.includes(r.text), `${id} f${f} "${r.text}"`).toBe(true);
      }
    }
  });

  it("is deterministic: the same frame whatever order frames are asked in", () => {
    for (const id of PRESET_IDS) {
      const p = plan(id, "Make it count", { exitAt: 5, loop: "breathe" });
      const times = [0.9, 1.05, 1.4, 2.2, 3.3, 5.2, 5.5];
      const forward = times.map((t) => JSON.stringify(drawType(p, { fill: "#111111" }, t)));
      const backward = [...times].reverse().map((t) => JSON.stringify(drawType(p, { fill: "#111111" }, t))).reverse();
      expect(backward, id).toEqual(forward);
      const again = planType("headline", p.set, p.motion, FRAME);
      expect(times.map((t) => JSON.stringify(drawType(again, { fill: "#111111" }, t))), id).toEqual(forward);
    }
  });

  it("keeps its events inside the timing rules: durations by kind, staggers by unit, eased gaps", () => {
    for (const id of PRESET_IDS) {
      for (const text of TEXTS) {
        const p = plan(id, text, { exitAt: 6 });
        for (const e of p.events) {
          const [lo, hi] = DURATION_LIMITS[e.kind];
          expect(e.dur, `${id} ${e.id} ${e.kind}`).toBeGreaterThanOrEqual(lo - 1e-9);
          expect(e.dur, `${id} ${e.id} ${e.kind}`).toBeLessThanOrEqual(hi + 1e-9);
        }
        const groups = new Map<string, number[]>();
        for (const e of p.events) if (e.group) groups.set(e.group, [...(groups.get(e.group) ?? []), e.start]);
        for (const [g, starts] of groups) {
          const [lo, hi] = STAGGER_LIMITS[p.events.find((e) => e.group === g)!.unit!];
          for (let i = 1; i < starts.length; i++) {
            expect(starts[i] - starts[i - 1], `${id} ${g}`).toBeGreaterThanOrEqual(lo - 1e-6);
            expect(starts[i] - starts[i - 1], `${id} ${g}`).toBeLessThanOrEqual(hi + 1e-6);
          }
        }
      }
    }
  });

  it("exits in 60–75 % of its entrance's time, ending gone, without overshooting", () => {
    for (const id of PRESET_IDS) {
      const pr = PRESETS[id];
      // (Emphasis moves that only fade away, like the weight wave, are not entrances played back.)
      if (!pr.together && pr.dur >= 0.35 && pr.dur <= 1.1 && id !== "weight-wave") {
        expect(pr.exitDur / pr.dur, id).toBeGreaterThanOrEqual(0.6 - 1e-9);
        expect(pr.exitDur / pr.dur, id).toBeLessThanOrEqual(0.75 + 1e-9);
      }
      const p = plan(id, "Make it count", { exitAt: 5 });
      expect(poseAt(p, 0, p.gone! + 0.01).opacity, id).toBe(0);
      // Moves away only: the distance from rest never shrinks through the exit.
      if (["bar-swipe", "type-on", "cut-paper", "curtain", "ink-draw", "neon-strike", "fold", "beat-cut"].includes(id)) continue;
      let last = -1;
      for (let k = 0; k <= 20; k++) {
        const q = pr.exit(k / 20, p.units[0].info, p.options);
        const d = Math.abs(q.dx) + Math.abs(q.dy) + Math.abs(q.sx - 1) + Math.abs(q.sy - 1) + Math.abs(q.rot) + (1 - q.opacity) + q.blur / 16 + (q.tracking ?? 0);
        expect(d, `${id} exit ${k / 20}`).toBeGreaterThanOrEqual(last - 1e-9);
        last = d;
      }
    }
  });

  it("starts with the entrance's first pose and ends gone after its exit", () => {
    for (const id of PRESET_IDS) {
      const p = plan(id, "Make it count", { exitAt: 5 });
      expect(poseAt(p, 0, 0), id).toEqual(PRESETS[id].enter(-1, p.units[0].info, p.options));
    }
  });
});

describe("staggers", () => {
  it("open wide and tighten, in order, from the middle, seeded, or from the right", () => {
    const s = staggerStarts(6, 0.03, "ease", 7, "letters");
    const gaps = s.slice(1).map((v, i) => v - s[i]);
    expect(gaps[0]).toBeGreaterThan(gaps[gaps.length - 1]);
    for (const g of gaps) expect(g).toBeGreaterThanOrEqual(0.02 - 1e-9);
    const c = staggerStarts(5, 0.03, "centre", 7, "letters");
    expect(c[2]).toBe(0);
    expect(Math.min(...c)).toBe(0);
    const r = staggerStarts(4, 0.05, "reverse", 7, "letters");
    expect(r[3]).toBe(0);
    expect(r[0]).toBe(Math.max(...r));
    expect(staggerStarts(4, 0.03, "seeded", 7, "letters")).toEqual(staggerStarts(4, 0.03, "seeded", 7, "letters"));
  });

  it("start a line's letters when the line before is 60 % through", () => {
    const p = plan("cut-rise-glyph", "Big\nideas");
    const line0 = p.units.filter((u) => u.info.line === 0);
    const line1 = p.units.filter((u) => u.info.line === 1);
    const span0 = Math.max(...line0.map((u) => u.start)) - line0[0].start + 0.65;
    close(line1[0].start - line0[0].start, span0 * 0.6);
  });
});

describe("loops", () => {
  it("breathe 1 → 1.02 → 1 and back at rest at the end of every cycle", () => {
    expect(loopAt("breathe", 0, { seed: 7 }).s).toBe(1);
    close(loopAt("breathe", 1.4, { seed: 7 }).s, 1.02);
    close(loopAt("breathe", 2.8, { seed: 7 }).s, 1);
  });

  it("pulse a CTA 2 % a few frames after landing, held three frames, in 300 ms", () => {
    expect(loopAt("pulse", 0, { seed: 7 })).toEqual(LOOP_REST);
    const peak = loopAt("pulse", 4 * F + 0.15, { seed: 7 }).s;
    close(peak, 1.02);
    expect(loopAt("pulse", 4 * F + 0.31, { seed: 7 })).toEqual(LOOP_REST);
  });

  it("sweep light across in 800 ms, 200 ms after it starts, never again sooner than 1.6 s, never one that cannot finish in time", () => {
    expect(loopAt("light-sweep", 0.1, { seed: 7 }).sweep).toBeNull();
    close(loopAt("light-sweep", 0.6, { seed: 7 }).sweep!, CURVES.move(0.5));
    expect(loopAt("light-sweep", 1.1, { seed: 7 }).sweep).toBeNull();
    expect(loopAt("light-sweep", 1.2 + 0.3, { seed: 7, every: 1.2 }).sweep).toBeNull();
    close(loopAt("light-sweep", 1.6 + 0.6, { seed: 7, every: 1.2 }).sweep!, CURVES.move(0.5));
    // A sweep that would still be crossing at `until` never starts.
    expect(loopAt("light-sweep", 1.6 + 0.6, { seed: 7, every: 1.2, until: 2.4 }).sweep).toBeNull();
    close(loopAt("light-sweep", 0.6, { seed: 7, every: 1.2, until: 2.4 }).sweep!, CURVES.move(0.5));
  });

  it("wiggle within ±3° and 3 units, seeded, at rest between cycles; ghost-drift 3 % of the width a second", () => {
    for (let t = 0; t < 3; t += 0.05) {
      const w = loopAt("wiggle", t, { seed: 7 });
      expect(Math.abs(w.rot)).toBeLessThanOrEqual(3 * DEG + 1e-9);
      expect(Math.abs(w.dx)).toBeLessThanOrEqual(3 + 1e-9);
    }
    close(loopAt("wiggle", 0.8, { seed: 7 }).rot, 0);
    close(loopAt("ghost-drift", 2, { seed: 7, frameW: 1080 }).dx, 0.03 * 1080 * 2);
  });

  it("a light sweep crosses the words inside an isolated layer, so it lights only the letters", () => {
    const p = plan("cut-rise", "Make it count", { loop: "light-sweep" });
    const f = drawType(p, { fill: "#111111" }, p.loopStart + 0.6);
    const top = f.nodes[0];
    expect(top.type === "group" && !!top.isolate).toBe(true);
    expect(f.still).toBe(false);
    expect(drawType(p, { fill: "#111111" }, p.loopStart + 1.2).still).toBe(true);
  });
});

describe("tones", () => {
  it("rule out the moves a tone never takes", () => {
    expect(presetsFor("luxury").map((p) => p.id)).not.toContain("stomp");
    expect(presetsFor("luxury").map((p) => p.id)).toContain("cut-rise");
    expect(presetsFor("beauty").map((p) => p.id)).not.toContain("scramble");
    expect(presetsFor("sales").map((p) => p.id)).toContain("stomp");
    for (const id of PRESET_IDS) expect(PRESETS[id].tones.length, id).toBeGreaterThan(0);
  });
});
