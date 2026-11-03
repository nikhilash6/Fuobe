/**
 * Prism Stage: a product spotlight. A lit field of the brand's hue (aubergine deep to violet), a plinth of dark glass
 * with a cool rim and a fine bright edge rises, and the product lands on it with its contact shadow, a band of light
 * crossing it; a prism's streak in the brand's neighbouring tones stays behind it at rest. The name is a justified
 * stack in a fine display serif (each line fitted to the width), cutting up letter by letter on the diagonal from the
 * product; the line drifts in under it, the call to action sits over a hairline, and the brand, the address, a corner
 * note and an index arrow sit on the corners.
 */

import { about, group, type DisplayNode } from "../../display";
import { mixOk } from "../../color";
import { pool, rgba } from "../../fx/background";
import { floorShadow } from "../../fx/depth";
import { product as productNode } from "../../fx/photo";
import { rule } from "../../fx/overlays";
import { fitBox, logoNode } from "./kit";
import { bands, brandSign, capBand, fitLines, footRow, glowAtmosphere, litField, metaInk, moveLines, posterScene, signIn, signNodes, stackLanded, topSite } from "./poster";

export default posterScene({
  id: "marketing/glass-spotlight",
  name: "Prism Stage",
  pairing: "T4",
  look: "dark",
  build(c) {
    const { S, safe, pal, design } = c;
    const side = c.wide;
    const prod = c.recipe.media?.product ? c.input.images?.product : undefined;
    const signH = S * (c.cover ? 0.066 : 0.05);
    const sign = brandSign(c, { maxW: S * 0.4, h: signH, x: safe.x, y: safe.y, min: S * (c.cover ? 0.06 : 0.03) });
    const textX = side ? safe.x + safe.w * 0.52 : safe.x;
    const textW = side ? safe.w * 0.48 : safe.w;
    const metaSize = S * (c.cover ? 0.024 : 0.02);
    const site = topSite(c, sign, metaSize);
    const b = bands(c, { topRow: sign?.h ?? metaSize, gap: S * 0.05 });
    const foot = metaSize * 1.1 + S * 0.05;
    // The name across the top, every line fitted to the width; the line and the call to action at the foot; the stage between.
    const head = fitLines(c, "headline", c.field("headline"), { x: textX, top: b.top, room: side ? (b.bottom - b.top) * 0.5 : (b.bottom - b.top) * 0.36, anchor: 0, width: side ? textW : safe.w * 0.92, maxLines: 2, max: S * (side ? 0.17 : 0.3), min: S * 0.07, preset: "cut-rise-glyph", fill: 0.985, ratio: 1.9, gap: 0.12, stack: true });
    const headB = head ? head.band : { x: textX, y: b.top, w: 0, h: 0 };
    const ctaSize = S * (c.cover ? 0.034 : 0.03);
    const ctaY = safe.y + safe.h - foot - ctaSize * 1.3;
    const lineW = side ? textW : safe.w * 0.38;
    // The line in the title's italic (one voice), small.
    const lineOpts = { role: "accent" as const, weight: 400, style: "italic" as const, x: textX, width: lineW, maxLines: 3, max: S * (c.cover ? 0.036 : 0.032), min: S * 0.026, leading: 1.25, preset: "focus-in" as const, even: 0.6 };
    const line0 = c.set("line", c.field("line"), { ...lineOpts, y: 0 });
    const lineTop = side ? headB.y + headB.h + S * 0.045 : ctaY - ctaSize * 0.4 - S * 0.06 - (line0 ? capBand(line0).h : 0);
    const line = line0 ? c.set("line", c.field("line"), { ...lineOpts, y: lineTop, max: line0.size, min: line0.size }) : null;
    const cta = c.set("cta", c.field("cta"), { role: "hero", weight: 500, x: textX, y: ctaY, width: textW * 0.5, maxLines: 1, max: ctaSize, min: S * 0.022, tracking: 0.12 });
    // The stage: the right of the frame between the name and the foot (the left half on a wide frame).
    const stage = side ? { x: safe.x, y: safe.y + S * 0.04, w: safe.w * 0.46, h: safe.y + safe.h - foot - safe.y - S * 0.04 } : { x: safe.x + safe.w * 0.4, y: headB.y + headB.h + S * 0.05, w: safe.w * 0.6, h: 0 };
    if (!side) stage.h = safe.y + safe.h - foot - stage.y;
    // The plinth: 40 % of the frame's width; the bottle on it about half the plinth's width (never a miniature).
    const plinthW = Math.min(stage.w * 0.92, design.w * (side ? 0.3 : 0.42));
    const plinthH = plinthW * 0.26;
    const plinth = { x: stage.x + (stage.w - plinthW) / 2, y: stage.y + stage.h - plinthH * 1.2, w: plinthW, h: plinthH };
    const pic = prod ?? (c.input.logo ? { w: c.input.logo.w, h: c.input.logo.h } : null);
    const img = pic ? fitBox(pic, { x: plinth.x + plinth.w * 0.22, y: Math.max(stage.y, plinth.y + plinthH * 0.28 - plinthW * 0.95), w: plinth.w * 0.56, h: Math.min(plinthW * 0.95, plinth.y + plinthH * 0.28 - stage.y) }, true) : null;
    const focus = { x: plinth.x + plinth.w / 2, y: img ? img.y + img.h * 0.5 : plinth.y - S * 0.2 };

    const k = c.spread(3.2, 1.6);
    c.ev("rings", "hero", 0, 1, "enter");
    c.ev("plinth", "enter", 0.25, 0.65, "glide");
    c.ev("product", "hero", 0.55, 0.9, "settle");
    const headPlans = head ? moveLines(c, head, { in: "cut-rise-glyph", at: 0.05, hero: true, loop: "light-sweep", loopAt: 2.4, loopEvery: 2 }, "headline", 0.14) : [];
    const headDone = headPlans.length ? stackLanded(headPlans) : 1.6;
    const linePlan = line ? c.move(line, { in: "focus-in", at: headDone - 0.3 }) : null;
    c.ev("rule", "draw", headDone + 0.1, 0.6, "draw");
    const ctaPlan = cta ? c.move(cta, { in: "word-lift", at: headDone + 0.15 * k }) : null;
    const signPlan = signIn(c, sign, "brand", 0.2);
    const sitePlan = site ? c.move(site, { in: "fade-rise", at: 0.35, rate: 26 }) : null;
    const row = footRow(c, headDone + 0.3);
    const sweepAt = Math.max(headDone + 0.05, 1.7);
    // A prism's streak of light behind the bottle in the brand's neighbouring tones, sliding a little.
    const streakW = Math.min(design.w * 0.7, stage.w * 1.1);

    return {
      overflow: [...(head?.overflow ? ["headline"] : []), ...(line?.overflow ? ["line"] : []), ...(cta?.overflow ? ["cta"] : []), ...(sign?.overflow ? ["brand"] : []), ...(site?.overflow ? ["website"] : []), ...row.overflow],
      signature: headDone + 0.2,
      camera: (t) => ({ x: 16 * (1 - Math.min(1, t / c.last)) ** 2, y: 0 }),
      draw(t, kit) {
        const field = litField(c, t, { from: "tr", light: mixOk(pal.brand[1], "#ffffff", 0.2), lightAlpha: 0.2 });
        const rp = kit.P("rings");
        const slide = (1 - Math.min(1, t / c.last)) ** 2 * stage.w * 0.04;
        const sx = focus.x - streakW / 2 - slide;
        // The spotlight: an elliptical pool (taller than wide) behind the bottle, falling off smoothly (no edge anywhere).
        const sr = streakW * 0.42;
        const streak: DisplayNode = group([{ type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: pool(focus.x + slide * 0, focus.y, sr, mixOk(pal.brand[1], "#ffffff", 0.45), 0.42) }], { blend: "screen", opacity: rp, transform: about(focus.x, focus.y, 1, 0, 1.6) });
        void sx;
        const atmosphere: DisplayNode[] = [...glowAtmosphere(c, t, { cx: focus.x, cy: focus.y, r: S * 0.7, color: pal.brand[1], alpha: 0.32 * rp }), streak];
        const subject: DisplayNode[] = [];
        const pp = kit.P("plinth");
        if (kit.L("plinth") > 0) {
          const dy = (1 - pp) * S * 0.08;
          // A cylinder of dark glass: a soft vertical gradient on its side (a cool rim light at the edges, a dark core),
          // its top face lit, a 1-unit bright edge, a shadow under it.
          // Seen nearly level with the bottle (a flat top face).
          const ry = plinth.h * 0.16;
          const cxp = plinth.x + plinth.w / 2;
          const cool = mixOk(pal.brand[1], "#bfd4ff", 0.4);
          const topEll: DisplayNode = { type: "ellipse", cx: cxp, cy: plinth.y, rx: plinth.w / 2, ry, fill: { kind: "radial", cx: cxp, cy: plinth.y - ry * 0.4, r0: 0, r1: plinth.w * 0.55, stops: [{ at: 0, color: rgba(cool, 0.34) }, { at: 0.75, color: rgba(pal.brand[0], 0.5) }, { at: 1, color: rgba(cool, 0.3) }] } };
          const rim: DisplayNode = { type: "ellipse", cx: cxp, cy: plinth.y, rx: plinth.w / 2, ry, stroke: { paint: rgba("#ffffff", 0.7), width: Math.max(1, S * 0.0012) } };
          const bodyD = `M${plinth.x} ${plinth.y}V${plinth.y + plinth.h}A${plinth.w / 2} ${ry} 0 0 0 ${plinth.x + plinth.w} ${plinth.y + plinth.h}V${plinth.y}Z`;
          const night = mixOk(pal.ground, "#000000", 0.35);
          const body: DisplayNode = { type: "path", d: bodyD, fill: { kind: "linear", x0: plinth.x, y0: 0, x1: plinth.x + plinth.w, y1: 0, stops: [{ at: 0, color: rgba(cool, 0.32) }, { at: 0.12, color: rgba(night, 0.85) }, { at: 0.4, color: rgba(night, 0.95) }, { at: 0.88, color: rgba(night, 0.85) }, { at: 1, color: rgba(cool, 0.26) }] } };
          const shade: DisplayNode = { type: "path", d: bodyD, fill: { kind: "linear", x0: 0, y0: plinth.y, x1: 0, y1: plinth.y + plinth.h + ry, stops: [{ at: 0, color: rgba("#000000", 0) }, { at: 1, color: rgba("#000000", 0.3) }] } };
          subject.push(group([floorShadow({ cx: cxp, y: plinth.y + plinth.h + ry * 0.6, width: plinth.w * 1.05, ground: pal.ground, strength: 0.55, key: `ps-plinth|${plinth.w.toFixed(0)}` }), body, shade, topEll, rim], { transform: [1, 0, 0, 1, 0, dy], ...(pp < 1 && { opacity: Math.min(1, kit.L("plinth") * 2) }) }));
        }
        const pl = kit.L("product");
        if (img && pl > 0) {
          const p = kit.P("product");
          const dy = (1 - p) * -design.h * 0.08;
          const node: DisplayNode = prod ? productNode({ src: "product", box: img, ground: pal.ground, t, sweepAt, sweepDur: 0.85, key: "ps" }) : logoNode(c, img, pal.ink);
          subject.push(floorShadow({ cx: img.x + img.w / 2, y: img.y + img.h, width: img.w * 0.9, ground: pal.ground, strength: 0.55 * Math.min(1, pl * 1.5), key: `ps|${img.w.toFixed(0)}` }), group([node], { transform: [1, 0, 0, 1, 0, dy] }));
        }
        const hero: DisplayNode[] = head ? head.sets.flatMap((_, i) => kit.type(headPlans[i], { fill: pal.ink, sweep: "#ffffff", sweepAlpha: 0.45 })) : [];
        const overlay: DisplayNode[] = [];
        if (linePlan) overlay.push(...kit.type(linePlan, { fill: metaInk(pal) }));
        if (ctaPlan) overlay.push(...kit.type(ctaPlan, { fill: pal.ink }));
        const r = kit.P("rule");
        if (r > 0 && cta) overlay.push(rule({ x: cta.ink.x, y: cta.lines[0].baseline + cta.size * 0.4, w: cta.ink.w, color: pal.accent, p: r, width: Math.max(1.25, S * 0.0018) }));
        const light: DisplayNode[] = [];
        const meta = [...signNodes(c, kit, sign, signPlan, "brand", safe.x, safe.y, pal.ink), ...(sitePlan ? kit.type(sitePlan, { fill: metaInk(pal), caret: pal.accent }) : []), ...row.draw(kit, metaInk(pal), pal.ink)];
        return [
          { role: "ground", nodes: field },
          { role: "atmosphere", nodes: atmosphere },
          { role: "subject", nodes: subject },
          { role: "hero", nodes: hero },
          { role: "overlay", nodes: overlay },
          { role: "meta", nodes: meta },
          { role: "light", nodes: light },
        ];
      },
    };
  },
});
