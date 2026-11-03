/**
 * Big Number: one figure as big as the frame allows, its figures filling the width (the left 58 % column on a wide
 * frame), rolling up digit by digit to the value the person typed (a short one lands with a stomp). A trailing unit
 * (×, %, +) is set at 35 % of the figures' height, top-aligned to their cap height, so the number reads first. A
 * giant filled tonal copy of the figures bleeds off the right edge behind it, on a lit field of the brand's hue. An arc
 * clear of every figure draws round its top right after it lands and ends in its own arrowhead; the caption cuts up
 * under a rule. The brand, the address, a corner note and an index sit on the corners. Through the hold the type
 * plane pushes in and a soft band of light crosses the figures.
 */

import { type DisplayNode } from "../../display";
import { contrastOf, fieldStops, mixOk } from "../../color";
import { highlighter, rule } from "../../fx/overlays";
import { marked } from "./kit";
import { bands, brandSign, capBand, capAt, footRow, ghost, litField, metaInk, posterScene, shadowed, signIn, signNodes, toneOf, withLeadGap, topSite, markColor } from "./poster";

/** A figure and its trailing unit ("3×" → "3", "×"; "98%" → "98", "%"); no unit when it doesn't end in one. */
export function splitUnit(stat: string): [string, string] {
  const m = /^(.*?\p{Nd}[\p{Nd}.,\s]*)(\s*[^\p{Nd}\s.,][^\p{Nd}]*)$/u.exec(stat);
  return m && m[2].trim().length <= 3 ? [m[1], m[2]] : [stat, ""];
}

export default posterScene({
  id: "marketing/big-number",
  name: "Big Number",
  pairing: "T7",
  look: "brand",
  build(c) {
    const { S, safe, pal, design } = c;
    const stat = c.field("stat", "0");
    const [figs, unit] = splitUnit(stat);
    const short = [...figs].length <= 3;
    const signH = S * (c.cover ? 0.058 : 0.046);
    const sign = brandSign(c, { maxW: S * 0.4, h: signH, x: safe.x, y: safe.y, min: S * (c.cover ? 0.05 : 0.03) });
    const metaSize = S * (c.cover ? 0.024 : 0.02);
    const site = topSite(c, sign, metaSize);

    const side = c.wide;
    const b = bands(c, { topRow: sign?.h ?? metaSize, gap: S * 0.06 });
    const foot = metaSize * 1.1 + S * 0.05;
    const numW = side ? safe.w * 0.58 : safe.w;
    const preset = short ? "stomp" : "odometer";
    // The caption (its *starred* words get a highlighter): beside it on a wide frame, in the column under the unit when
    // the figures are short (a big numeral with its line tucked beside it), under it otherwise. Quiet ink, small, so the
    // figure is twelve times its size or more.
    const typedCap = marked(c.field("caption"));
    const capText = typedCap.text;
    const capSize = S * (c.cover ? 0.042 : 0.038);
    const gap = S * 0.05;
    const unitShare = unit ? 0.35 : 0;
    const setNum = (size: number, y: number) => {
      const opts = { role: "hero" as const, weight: 800, x: safe.x, y, width: numW * 2, maxLines: 1, max: size, min: size, tabular: true, preset, tracking: -0.01, leading: 0.9 } as const;
      const n = capAt(c, "stat", figs, opts);
      if (!n) return null;
      const u = unit ? capAt(c, "stat", unit.trimStart(), { ...opts, x: n.ink.x + n.ink.w + size * 0.04, max: size * unitShare, min: size * unitShare, tabular: false, preset: "stomp", y: n.lines[0].y + n.cap.top }) : null;
      return { n, u: u ? withLeadGap(u, unit.slice(0, unit.length - unit.trimStart().length)) : null };
    };
    // The size: the widest that fits numW (measured at 100, scaled), held to the room's height.
    const probe = setNum(100, 0);
    const probeW = probe ? (probe.u ? probe.u.ink.x + probe.u.ink.w : probe.n.ink.x + probe.n.ink.w) - probe.n.ink.x : 100;
    const probeFigW = probe ? probe.n.ink.w : 100;
    const probeCap = probe ? probe.n.cap.bottom - probe.n.cap.top : 70;
    const roomAll = b.bottom - foot - b.top;
    const tallSize = Math.min((100 * roomAll * 0.97) / probeCap, (100 * safe.w * 0.68) / Math.max(1, probeW));
    const besideX = safe.x + (probeFigW * tallSize) / 100 + tallSize * 0.08;
    const beside = !side && !!capText && (probeW * tallSize) / 100 <= safe.w * 0.72 && safe.x + safe.w - besideX >= safe.w * 0.3;
    const capX = side ? safe.x + safe.w * 0.64 : beside ? besideX : safe.x;
    const capW = side ? safe.w * 0.36 : beside ? safe.x + safe.w - besideX : Math.min(safe.w, S * 0.8);
    let cap = c.set("caption", capText, { role: "body", weight: 500, x: capX, y: 0, width: capW, maxLines: beside ? 5 : 3, max: capSize, min: S * 0.03, leading: 1.18 });
    const capH = cap && !side && !beside ? capBand(cap).h + gap * 2.4 : 0;
    const room = roomAll - capH;
    let size = beside ? tallSize : Math.min((100 * numW * 0.96) / Math.max(1, probeW), (100 * (side ? Math.min(room, design.h * 0.62) : room * 0.95)) / probeCap, S * 1.2);
    size = Math.max(size, S * 0.12);
    const capPx = (probeCap * size) / 100;
    const numTop = side ? b.top + (b.bottom - foot - b.top - capPx) * 0.5 : beside ? b.top + Math.max(0, (roomAll - capPx) * 0.5) : b.top + Math.max(0, Math.min(room - capPx, design.h * 0.42 - capPx / 2 - b.top));
    const set = setNum(size, numTop);
    const num = set?.n ?? null;
    const unitSet = set?.u ?? null;
    const band = num ? { ...capBand(num), w: (unitSet ? unitSet.ink.x + unitSet.ink.w : num.ink.x + num.ink.w) - num.ink.x } : { x: safe.x, y: numTop, w: 0, h: 0 };
    const ruleY = band.y + band.h + gap;
    if (cap) {
      const y = side || beside ? band.y + band.h - capBand(cap).h : ruleY + gap * 0.9;
      cap = c.set("caption", capText, { role: "body", weight: 500, x: capX, y: y - (cap.lines[0].y + cap.cap.top), width: capW, maxLines: beside ? 5 : 3, max: cap.size, min: cap.size, leading: 1.18 });
    }
    // The starred words' highlighter boxes.
    const marks: { x: number; w: number; capTop: number; baseline: number; key: string }[] = [];
    if (cap) {
      const cs = cap;
      let at = 0;
      cs.words.forEach((w, wi) => {
        at += w.gap.length;
        const a = at;
        const e = at + w.text.length;
        at = e;
        if (!typedCap.marks.some(([p, q]) => p < e && q > a)) return;
        const line = cs.lines[w.line];
        marks.push({ x: w.x, w: w.w, capTop: line.y + cs.cap.top, baseline: line.baseline, key: `c${wi}` });
      });
    }

    const k = c.spread(3, 1.6);
    const numPlan = num ? c.move(num, { in: preset, at: 0.03, hero: true, flash: short, intensity: 1, loop: "light-sweep", loopAt: 1.8, loopEvery: 1.8 }) : null;
    const numLanded = numPlan?.settled ?? 0.8;
    const unitPlan = unitSet ? c.move(unitSet, { in: "stomp", at: Math.max(0.1, numLanded - 0.3), intensity: 0.8 }, "stat.unit") : null;
    const landed = Math.max(numLanded, unitPlan?.settled ?? 0);
    c.ev("rule", "draw", landed + 0.05, 0.6, "draw");
    const capPlan = cap ? c.move(cap, { in: "cut-rise", at: landed + 0.2 * k }) : null;
    const signPlan = signIn(c, sign, "brand", 0.25);
    const sitePlan = site ? c.move(site, { in: "fade-rise", at: 0.4, rate: 26 }) : null;
    const row = footRow(c, (capPlan?.settled ?? landed) + 0.1);
    marks.forEach((_, j) => c.ev(`mark.${j}`, "draw", (capPlan?.settled ?? landed) + 0.05 + 0.1 * j, 0.4, "snap"));
    // The caption in quiet ink (never the figure's colour): near-black on a light field, paper on a dark one.
    const grounds = [pal.ground, fieldStops(pal).light, fieldStops(pal).dark];
    const worst = (ink: string) => Math.min(...grounds.map((g) => contrastOf(ink, g)));
    const capInk = [mixOk(pal.paper, pal.ground, 0.15), mixOk(pal.night, pal.ground, 0.12), pal.paper, pal.night, "#ffffff", "#000000"].find((x) => worst(x) >= 4.8) ?? (worst("#000000") > worst("#ffffff") ? "#000000" : "#ffffff");

    const stops = fieldStops(pal);
    const ghostGround = mixOk(stops.dark, stops.light, 0.5);

    return {
      overflow: [...(num?.overflow || (probeW * size) / 100 > numW + 1 ? ["stat"] : []), ...(unitSet?.overflow ? ["stat"] : []), ...(cap?.overflow ? ["caption"] : []), ...(sign?.overflow ? ["brand"] : []), ...(site?.overflow ? ["website"] : []), ...row.overflow],
      signature: landed + 0.3,
      camera: (t) => ({ x: -20 * (1 - Math.min(1, t / c.last)) ** 2, y: 10 * (1 - Math.min(1, t / c.last)) ** 2 }),
      draw(t, kit) {
        const field = litField(c, t, { from: "tl", stops });
        const atmosphere: DisplayNode[] = [];
        // The ghost: the figures far bigger than the hero, one faint step from the field, low in the right half so only
        // its top shows, behind the caption and never level with the hero.
        const ghosts: DisplayNode[] = num && !beside ? [ghost(c, { field: "stat", lines: [figs], size: num.size * 2.2, x: design.w + num.size * 0.25, align: "right", y: Math.max(design.h * 0.6, band.y + band.h * 0.9), t, ground: ghostGround, weight: 800 })] : [];
        const hero: DisplayNode[] = [];
        if (num && numPlan) {
          const nodes = [...kit.type(numPlan, { fill: pal.ink, sweep: "#ffffff", sweepAlpha: 0.45 }), ...(unitPlan ? kit.type(unitPlan, { fill: pal.ink }) : [])];
          const pad = num.size * 0.25;
          if (t >= landed) hero.push(...shadowed(c, nodes, num.size * 0.7, { x: band.x - pad, y: band.y - pad, w: band.w + 2 * pad, h: band.h + 2 * pad }, `bn|${stat}|${num.size}`));
          hero.push(...nodes);
        }
        for (const [j, mk] of marks.entries()) {
          const hl = highlighter({ capTop: mk.capTop, baseline: mk.baseline, x: mk.x, w: mk.w, color: mixOk(markColor(c, pal.ground, capInk), pal.ground, 0.35), seed: c.seed, p: kit.P(`mark.${j}`), key: mk.key, cover: 0.78, skew: -3 });
          if (hl) hero.push(hl);
        }
        if (capPlan) hero.push(...kit.type(capPlan, { fill: capInk }));
        const r = kit.P("rule");
        const overlay: DisplayNode[] = [...atmosphere, ...(r > 0 && !side && !beside ? [rule({ x: safe.x, y: ruleY, w: Math.min(safe.w, band.w), color: toneOf(pal, 0.5), p: r, width: Math.max(1.25, S * 0.002) })] : [])];
        const meta: DisplayNode[] = [...signNodes(c, kit, sign, signPlan, "brand", safe.x, safe.y, pal.ink), ...(sitePlan ? kit.type(sitePlan, { fill: metaInk(pal), caret: pal.accent }) : []), ...row.draw(kit, metaInk(pal), pal.ink)];
        return [
          { role: "ground", nodes: field },
          { role: "ghost", nodes: ghosts },
          { role: "hero", nodes: hero },
          { role: "overlay", nodes: overlay },
          { role: "meta", nodes: meta },
        ];
      },
    };
  },
});
