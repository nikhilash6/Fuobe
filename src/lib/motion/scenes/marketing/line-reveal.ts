/**
 * Line-Art Reveal: quiet luxury. On warm paper with window light drifting across it, one fine line runs in along the
 * floor, traces the product's own outline (from the cut-out's edge) and runs on out; a tonal arch rises behind as the
 * product fills in from its foot, the line steps back, a band of light crosses the product once, and the headline
 * cuts up in a fine display serif with the call to action under a drawn rule. A hairline frame holds the page and the
 * brand settles at the top. A photo without transparency gets a rounded frame traced round it instead.
 */

import { type DisplayNode, type Matrix } from "../../display";
import { mixOk } from "../../color";
import { product as productNode } from "../../fx/photo";
import { rule } from "../../fx/overlays";
import { fitBox, logoNode, riseReveal } from "./kit";
import { brandSign, capBand, litField, metaInk, onBaseline, paperField, posterScene, signIn, signNodes } from "./poster";

/** A rounded frame as path data from its bottom centre, clockwise on screen (left first), and its length. */
export function framePath(x: number, y: number, w: number, h: number, r: number): { d: string; length: number } {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const cx = x + w / 2;
  const b = y + h;
  const d = [`M${cx} ${b}`, `H${x + rr}`, `A${rr} ${rr} 0 0 1 ${x} ${b - rr}`, `V${y + rr}`, `A${rr} ${rr} 0 0 1 ${x + rr} ${y}`, `H${x + w - rr}`, `A${rr} ${rr} 0 0 1 ${x + w} ${y + rr}`, `V${b - rr}`, `A${rr} ${rr} 0 0 1 ${x + w - rr} ${b}`, "Z"].join(" ");
  return { d, length: 2 * (w - 2 * rr) + 2 * (h - 2 * rr) + 2 * Math.PI * rr };
}

/** An arch (a round top on straight sides) standing on y = foot. */
const archPath = (cx: number, foot: number, w: number, h: number): string => {
  const r = w / 2;
  return `M${cx - r} ${foot}V${foot - h + r}A${r} ${r} 0 0 1 ${cx + r} ${foot - h + r}V${foot}Z`;
};

export default posterScene({
  id: "marketing/line-reveal",
  name: "Line-Art Reveal",
  pairing: "T4",
  look: "light",
  build(c) {
    const { S, safe, pal, design } = c;
    const side = c.wide;
    const prod = c.recipe.media?.product ? c.input.images?.product : undefined;
    const logo = c.input.logo;
    const width = c.recipe.controls?.line === "bold" ? S * 0.006 : S * 0.0017;
    const cx = design.w / 2;
    const signH = S * (c.cover ? 0.072 : 0.056);
    const sign0 = brandSign(c, { maxW: S * 0.4, h: signH, x: 0, y: 0, align: "centre", min: S * (c.cover ? 0.056 : 0.03) });
    const signsTop = !side && !!sign0;
    const sign = sign0?.set ? brandSign(c, { maxW: S * 0.4, h: signH, x: side ? safe.x + safe.w * 0.54 : cx - S * 0.2, y: side ? safe.y : safe.y, align: side ? "left" : "centre", min: S * (c.cover ? 0.056 : 0.03) }) : sign0;
    const textX = side ? safe.x + safe.w * 0.54 : safe.x;
    const textW = side ? safe.w * 0.46 : safe.w;
    // The hero big enough that its hairlines hold at a thumbnail's size.
    const head0 = c.set("headline", c.field("headline"), { role: "hero", x: textX, y: 0, width: textW, maxLines: 3, max: S * (side ? 0.12 : 0.15), min: S * 0.06, align: side ? "left" : "centre", preset: "cut-rise", even: 0.5 });
    // The foot row, on one baseline at the safe line: the corner note (left), the call to action (centre, underlined),
    // the address (right).
    // The call to action a step above the two small facts, which are tracked out (their own quiet voice).
    const ctaSize = S * (c.cover ? 0.032 : 0.028);
    const metaSize = S * (c.cover ? 0.019 : 0.017);
    const footBase = safe.y + safe.h - metaSize * 0.3;
    const cta = onBaseline(c, "cta", c.field("cta"), { role: "meta", weight: 500, x: side ? textX : cx - safe.w * 0.22, width: side ? textW * 0.6 : safe.w * 0.44, maxLines: 1, max: ctaSize, min: S * 0.022, align: side ? "left" : "centre", preset: "track-in", y: 0 }, footBase);
    const site = onBaseline(c, "website", c.field("website"), { role: "meta", x: safe.x + safe.w * 0.7, width: safe.w * 0.3, maxLines: 1, max: metaSize, min: metaSize * 0.8, align: "right", preset: "fade-rise", tracking: 0.12, y: 0 }, footBase);
    const note = onBaseline(c, "note", c.field("note"), { role: "meta", x: safe.x, width: side ? safe.w * 0.4 : safe.w * 0.28, maxLines: 1, max: metaSize, min: metaSize * 0.8, align: "left", preset: "fade-rise", tracking: 0.12, y: 0 }, footBase);
    const lastInk = head0 ? head0.lines[head0.lines.length - 1].ink : null;
    const descent = head0 && lastInk ? Math.max(0, lastInk.y + lastInk.h - head0.lines[head0.lines.length - 1].baseline) : 0;
    const headH = head0 ? capBand(head0).h + descent : 0;
    const ctaH = (cta ? ctaSize * 1.6 : metaSize * 1.4) + S * 0.06;
    const textH = headH;
    // Stacked: the brand on top, the picture, then the words; the picture takes what the words leave.
    const top = safe.y + (signsTop ? (sign0?.h ?? 0) + S * 0.075 : 0);
    const gap = S * 0.05;
    const picBox = side ? { x: safe.x, y: safe.y + safe.h * 0.04, w: safe.w * 0.46, h: safe.h * 0.92 - ctaH } : { x: safe.x + safe.w * 0.1, y: top, w: safe.w * 0.8, h: safe.y + safe.h - top - textH - gap * 1.4 - ctaH };
    const textTop = side ? safe.y + (safe.h - ctaH - textH) / 2 + (sign?.h ?? 0) * 0.6 : picBox.y + picBox.h + gap;
    const head = head0 ? c.set("headline", c.field("headline"), { role: "hero", x: textX, y: textTop, width: textW, maxLines: 3, max: head0.size, min: head0.size, align: side ? "left" : "centre", preset: "cut-rise" }) : null;
    // The call to action's drawn underline.
    const ruleY = footBase + Math.max(S * 0.007, ctaSize * 0.28);

    const hero = prod ?? (logo ? { w: logo.w, h: logo.h } : null);
    const img = hero ? fitBox(hero, prod ? picBox : { ...picBox, y: picBox.y + picBox.h * 0.3, h: picBox.h * 0.4 }, true) : null;
    const outline = prod ? (c.input.outlines?.product ?? null) : null;
    let trace: { d: string; length: number; m?: Matrix; scale: number } | null = null;
    let start: [number, number] = [cx, picBox.y + picBox.h];
    if (img && outline) {
      const k = img.w / outline.w;
      trace = { d: outline.d, length: outline.length, m: [k, 0, 0, k, img.x, img.y], scale: k };
      start = [img.x + outline.start[0] * k, img.y + outline.start[1] * k];
    } else if (img) {
      const pad = S * 0.03;
      trace = { ...framePath(img.x - pad, img.y - pad, img.w + 2 * pad, img.h + 2 * pad, S * 0.035), scale: 1 };
      start = [img.x + img.w / 2, img.y + img.h + pad];
    }
    const foot = start[1];
    const lineFrom = side ? picBox.x : safe.x;
    const lineTo = side ? picBox.x + picBox.w : safe.x + safe.w;
    const archW = img ? Math.min(picBox.w * 0.95, Math.max(img.w * 1.5, img.h * 0.66)) : 0;
    const archH = img ? Math.min(foot - picBox.y + S * 0.03, Math.max(img.h * 1.12, archW * 0.95)) : 0;
    const archBox = { x: start[0] - archW / 2, y: foot - archH, w: archW, h: archH };

    const k = c.spread(3.3, 1.6);
    const traceDur = Math.min(1.3, 1.05 * k);
    c.ev("ground.a", "draw", 0, 0.4 * k, "draw");
    if (trace) c.ev("trace", "draw", 0.3 * k, traceDur, "draw");
    c.ev("ground.b", "draw", 0.3 * k + traceDur - 0.08, 0.35 * k, "draw");
    const fillAt = 0.3 * k + traceDur * 0.75;
    if (img) {
      c.ev("arch", "draw", fillAt - 0.15, 0.85, "glide");
      c.ev("fill", "draw", fillAt, 0.75, "glide");
      c.ev("trace.out", "fade", fillAt + 0.5, 0.5, "enter");
    }
    // The headline starts while the line is still tracing (by 0.9 s).
    const headPlan = head ? c.move(head, { in: "cut-rise", at: Math.min(0.9, fillAt - 0.2), hero: true }) : null;
    const headDone = headPlan?.settled ?? fillAt + 0.6;
    c.ev("sweep", "move", headDone - 0.3, 0.85, "move");
    const ctaPlan = cta ? c.move(cta, { in: "slow-drift", at: headDone - 0.35 }) : null;
    c.ev("cta.rule", "draw", headDone + 0.05, 0.55, "draw");
    const signPlan = signIn(c, sign, "brand", 0.15);
    const sitePlan = site ? c.move(site, { in: "fade-rise", at: headDone + 0.2, rate: 30 }) : null;
    const notePlan = note ? c.move(note, { in: "fade-rise", at: headDone + 0.1, rate: 30 }) : null;

    const lineColor = c.dark ? pal.accent : mixOk(pal.brand[0], pal.ink, 0.2);
    const archFill = mixOk(pal.ground, pal.brand[1], c.dark ? 0.12 : 0.22);

    return {
      overflow: [...(head?.overflow ? ["headline"] : []), ...(cta?.overflow ? ["cta"] : []), ...(sign?.overflow ? ["brand"] : []), ...(site?.overflow ? ["website"] : []), ...(note?.overflow ? ["note"] : [])],
      signature: 0.3 * k + traceDur * 0.6,
      draw(t, kit) {
        const field = c.dark ? litField(c, t, { from: "tl" }) : paperField(c, t, { tint: pal.brand[1], light: 0.6 });
        const atmosphere: DisplayNode[] = [];
        const a = kit.P("arch");
        // The arch grows up from the floor, an arch at every moment (never a box).
        if (a > 0 && img) {
          const h = Math.max(archW / 2 + 1, archH * a);
          atmosphere.push({ type: "path", d: archPath(start[0], foot, archW, h), fill: { kind: "linear", x0: 0, y0: archBox.y, x1: 0, y1: foot, stops: [{ at: 0, color: mixOk(archFill, pal.ground, 0.3) }, { at: 1, color: archFill }] }, ...(a < 0.35 && { opacity: a / 0.35 }) });
        }
        // (no frame: one line system)
        const subject: DisplayNode[] = [];
        const ga = kit.P("ground.a");
        const gb = kit.P("ground.b");
        if (ga > 0) subject.push({ type: "path", d: `M${lineFrom} ${foot}H${start[0]}`, stroke: { paint: lineColor, width, trim: ga, length: Math.max(1, start[0] - lineFrom), cap: "round" } });
        if (gb > 0) subject.push({ type: "path", d: `M${start[0]} ${foot}H${lineTo}`, stroke: { paint: lineColor, width, trim: gb, length: Math.max(1, lineTo - start[0]), cap: "round" } });
        if (img) {
          const fill = kit.P("fill");
          if (fill > 0) {
            const pic: DisplayNode = prod ? productNode({ src: "product", box: img, ground: archFill, t, sweepAt: headDone - 0.3, sweepDur: 0.85, key: "lr" }) : logoNode(c, img, pal.ink);
            subject.push(riseReveal([pic], { x: img.x - img.w * 0.5, y: img.y, w: img.w * 2, h: img.h + S * 0.02 }, fill, img.h * 0.12));
          }
        }
        if (trace) {
          const tr = kit.P("trace");
          const out = kit.P("trace.out");
          if (tr > 0 && out < 1) subject.push({ type: "path", d: trace.d, ...(trace.m && { transform: trace.m }), stroke: { paint: lineColor, width: width / trace.scale, trim: tr, length: trace.length, cap: "round", join: "round" }, ...(out > 0 && { opacity: 1 - out }) });
        }
        const heroN: DisplayNode[] = headPlan ? kit.type(headPlan, { fill: pal.ink }) : [];
        const meta: DisplayNode[] = [];
        if (ctaPlan && cta) {
          meta.push(...kit.type(ctaPlan, { fill: metaInk(pal) }));
          const u = kit.P("cta.rule");
          if (u > 0) meta.push(rule({ x: cta.ink.x, y: ruleY, w: cta.ink.w, color: lineColor, p: u, width: Math.max(1.5, S * 0.0019) }));
        }
        if (sitePlan) meta.push(...kit.type(sitePlan, { fill: metaInk(pal) }));
        if (notePlan) meta.push(...kit.type(notePlan, { fill: metaInk(pal) }));
        meta.push(...signNodes(c, kit, sign, signPlan, "brand", side ? textX : cx - (sign?.w ?? 0) / 2, safe.y, pal.ink));
        return [
          { role: "ground", nodes: field },
          { role: "atmosphere", nodes: atmosphere },
          { role: "subject", nodes: subject, push: 0.04 },
          { role: "hero", nodes: heroN },
          { role: "meta", nodes: meta },
        ];
      },
    };
  },
});
