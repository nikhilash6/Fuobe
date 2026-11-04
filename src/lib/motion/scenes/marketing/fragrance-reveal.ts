/**
 * Nocturne: a fragrance reveal. Two ribbons of light cross a night field, a spot opens from above, and the bottle
 * rises into its pool of light over a soft reflection; a band of light crosses the glass once. The name cuts up in a
 * fine display serif, the line drifts in under it, the call to action settles under a hairline, and the house signs
 * at the top. Everything readable sits in the safe area; the bottle and its light may run lower.
 */

import { group, type DisplayNode } from "../../display";
import { mixOk } from "../../color";
import { pool, rgba } from "../../fx/background";
import { floorShadow } from "../../fx/depth";
import { product as productNode } from "../../fx/photo";
import { rule } from "../../fx/overlays";
import { fitBox, logoNode } from "./kit";
import { brandSign, capBand, footRow, glowAtmosphere, litField, metaInk, onBaseline, posterScene, signIn, signNodes } from "./poster";

export default posterScene({
  id: "marketing/fragrance-reveal",
  name: "Nocturne",
  pairing: "T4",
  look: "dark",
  build(c) {
    const { S, safe, pal, design } = c;
    const side = c.wide;
    const cx = design.w / 2;
    const prod = c.recipe.media?.product ? c.input.images?.product : undefined;
    const signH = S * (c.cover ? 0.06 : 0.05);
    const textX = side ? safe.x + safe.w * 0.5 : safe.x;
    const textW = side ? safe.w * 0.5 : safe.w;
    const align = side ? "left" : "centre";
    const sign0 = brandSign(c, { maxW: S * 0.4, h: signH, x: textX, y: safe.y, align, min: S * (c.cover ? 0.056 : 0.03) });
    const sign = sign0?.set && !side ? brandSign(c, { maxW: S * 0.4, h: signH, x: cx - S * 0.2, y: safe.y, align: "centre", min: S * (c.cover ? 0.056 : 0.03) }) : sign0;
    const top = safe.y + (sign?.h ?? 0) + S * 0.06;
    const head = c.set("headline", c.field("headline"), { role: "hero", x: textX, y: top, width: textW, maxLines: 2, max: S * (side ? 0.17 : 0.24), min: S * 0.08, align, preset: "cut-rise" });
    const headB = head ? capBand(head) : { x: textX, y: top, w: 0, h: 0 };
    // The title at the top, the line and the call to action above the bottom corners (under the title on a wide
    // frame), the bottle standing large between them. The corner note and the address sit on the bottom corners.
    const metaSize = S * (c.cover ? 0.024 : 0.02);
    const row = footRow(c, 2.4, { arrow: false });
    const site = onBaseline(c, "website", c.field("website"), { role: "meta", x: safe.x + safe.w * 0.5, width: safe.w * 0.5, maxLines: 1, max: metaSize, min: metaSize * 0.8, align: "right", preset: "fade-rise", y: 0 }, safe.y + safe.h - metaSize * 0.25);
    const footH = metaSize * 1.1 + S * 0.05;
    const ctaSize = S * (c.cover ? 0.03 : 0.027);
    const lineOpts = { role: "accent" as const, weight: 400, x: textX + (side ? 0 : textW * 0.06), width: side ? textW : textW * 0.88, maxLines: 2, max: S * (c.cover ? 0.05 : 0.044), min: S * 0.03, align: align as "left" | "centre", leading: 1.2, preset: "slow-drift" as const, even: 0.6 };
    const line0 = c.set("line", c.field("line"), { ...lineOpts, y: 0 });
    // The call to action in the title's serif, small and tracked out, on a hairline (never a web button).
    const ctaOpts = { role: "hero" as const, weight: 500, tracking: 0.12, leading: 1.1 };
    const cta0 = c.set("cta", c.field("cta"), { ...ctaOpts, x: textX, y: 0, width: textW, maxLines: 1, max: ctaSize, min: S * 0.022, align });
    const lineH = line0 ? capBand(line0).h : 0;
    const ctaTop = side ? headB.y + headB.h + S * 0.06 + lineH + S * 0.075 : safe.y + safe.h - footH - (cta0 ? cta0.size * 1.2 : 0);
    const lineTop = side ? headB.y + headB.h + S * 0.06 : ctaTop - S * 0.075 - lineH;
    const line = line0 ? c.set("line", c.field("line"), { ...lineOpts, y: lineTop, max: line0.size, min: line0.size }) : null;
    const cta = cta0 ? c.set("cta", c.field("cta"), { ...ctaOpts, x: textX, y: ctaTop, width: textW, maxLines: 1, max: cta0.size, min: cta0.size, align }) : null;
    const floor = side ? safe.y + safe.h - footH : lineTop - S * 0.07;
    // On a tall frame the bottle stands up behind the title's lower half (the title in front), so it can be large.
    const boxTop = side ? safe.y + S * 0.04 : headB.y + headB.h * 0.5;
    // The bottle large: as tall as the room allows, a third of the height or more.
    const box = side ? { x: safe.x, y: boxTop, w: safe.w * 0.44, h: floor - boxTop } : { x: safe.x + safe.w * 0.1, y: boxTop, w: safe.w * 0.8, h: floor - boxTop };
    const pic = prod ?? (c.input.logo ? { w: c.input.logo.w, h: c.input.logo.h } : null);
    const img = pic ? fitBox(pic, box, true) : null;
    const spot = img ? { x: img.x + img.w / 2, y: img.y + img.h * 0.45 } : { x: cx, y: design.h * 0.6 };

    const k = c.spread(3.3, 1.6);
    // The title cuts up letter by letter from the first frames; the light opens and the bottle rises from its floor.
    c.ev("spot", "fade", 0.05, 1.1, "glide");
    c.ev("bottle", "hero", 0.35, 1, "decel");
    const headPlan = head ? c.move(head, { in: "cut-rise-glyph", at: 0.05, hero: true }) : null;
    const headDone = headPlan?.settled ?? 1.6;
    const linePlan = line ? c.move(line, { in: "slow-drift", at: headDone - 0.35 }) : null;
    c.ev("rule", "draw", headDone, 0.6, "draw");
    const ctaPlan = cta ? c.move(cta, { in: "word-lift", at: headDone + 0.25 }) : null;
    const signPlan = signIn(c, sign, "brand", 0.2);
    const sweepAt = headDone + 0.1;
    const sitePlan = site ? c.move(site, { in: "fade-rise", at: headDone + 0.4, rate: 30 }) : null;

    void k;
    const gold = c.dark ? pal.accent : mixOk(pal.brand[1], pal.ink, 0.3);
    // The cone of light from above: feathered at its sides, gone by the floor (drawn once, reused).
    const coneBounds = img ? { x: spot.x - img.w * 1.6, y: 0, w: img.w * 3.2, h: img.y + img.h } : null;
    const cone: DisplayNode | null = img && coneBounds ? group([{ type: "path", d: `M${spot.x - img.w * 0.16} 0L${spot.x + img.w * 0.16} 0L${spot.x + img.w * 0.95} ${img.y + img.h}L${spot.x - img.w * 0.95} ${img.y + img.h}Z`, fill: { kind: "linear", x0: 0, y0: 0, x1: 0, y1: img.y + img.h, stops: [{ at: 0, color: rgba(pal.paper, 0.02) }, { at: 0.55, color: rgba(pal.paper, 0.1) }, { at: 0.85, color: rgba(pal.paper, 0.06) }, { at: 1, color: rgba(pal.paper, 0) }] } }], { soften: img.w * 0.12, cache: { key: `nc-cone|${img.w.toFixed(0)}x${img.h.toFixed(0)}|${pal.paper}`, bounds: coneBounds } }) : null;

    return {
      overflow: [...(head?.overflow ? ["headline"] : []), ...(line?.overflow ? ["line"] : []), ...(cta?.overflow ? ["cta"] : []), ...(sign?.overflow ? ["brand"] : []), ...(site?.overflow ? ["website"] : []), ...row.overflow],
      signature: headDone + 0.2,
      camera: (t) => ({ x: 0, y: -24 * (1 - Math.min(1, t / c.last)) ** 2 }),
      draw(t, kit) {
        const field = litField(c, t, { from: "tl", light: mixOk(pal.brand[1], "#ffffff", 0.3), lightAlpha: 0.18 });
        const sp = kit.P("spot");
        const atmosphere: DisplayNode[] = [
          ...glowAtmosphere(c, t, { cx: spot.x, cy: spot.y, r: S * 0.6, color: pal.brand[1], alpha: 0.3 * sp }),
        ];
        // The floor: a faintly lighter plane from the bottle's foot down, its horizon catching the light under the spot.
        if (img) {
          const fy = img.y + img.h;
          atmosphere.push(
            { type: "rect", x: 0, y: fy, w: design.w, h: design.h - fy, fill: { kind: "linear", x0: 0, y0: fy, x1: 0, y1: design.h, stops: [{ at: 0, color: rgba(pal.paper, 0.07) }, { at: 0.35, color: rgba(pal.paper, 0.025) }, { at: 1, color: rgba(pal.paper, 0) }] } },
            { type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: pool(spot.x, fy, design.w * 0.4, mixOk(pal.brand[1], "#ffffff", 0.4), 0.2 * sp) },
          );
        }
        if (cone && sp > 0) atmosphere.push(group([cone], { opacity: sp }));
        const subject: DisplayNode[] = [];
        const bl = kit.L("bottle");
        if (img && bl > 0) {
          const p = kit.P("bottle");
          const dy = (1 - p) * S * 0.3;
          const foot = img.y + img.h;
          const pic: DisplayNode = prod ? productNode({ src: "product", box: img, ground: pal.ground, t, sweepAt, sweepDur: 0.9, key: "nc" }) : logoNode(c, img, pal.ink);
          // Its reflection: the bottle mirrored under its foot, fading out.
          const mirror = prod
            ? group([group([{ type: "image", decor: true, src: "product", ...img }], { transform: [1, 0, 0, -1, 0, 2 * foot] })], { opacity: 0.15, mask: { kind: "linear", x0: 0, y0: foot, x1: 0, y1: foot + img.h * 0.4, stops: [{ at: 0, color: "rgba(0,0,0,1)" }, { at: 1, color: "rgba(0,0,0,0)" }], bounds: { x: img.x - 2, y: foot, w: img.w + 4, h: img.h * 0.45 } } })
            : null;
          // It rises out of its floor (a mask at the foot), never a fade; a soft contact shadow, no disc of light.
          subject.push(
            floorShadow({ cx: img.x + img.w / 2, y: foot, width: img.w * 0.9, ground: pal.ground, strength: 0.7 * p, key: `nc|${img.w.toFixed(0)}` }),
            group([group([...(mirror ? [mirror] : []), pic], { transform: [1, 0, 0, 1, 0, dy] })], { ...(p < 1 && { clip: { type: "rect", x: img.x - img.w, y: img.y - img.h, w: img.w * 3, h: img.h * 2 + S * 0.006 } }) }),
          );
        }
        const hero: DisplayNode[] = headPlan ? kit.type(headPlan, { fill: pal.ink }) : [];
        const meta: DisplayNode[] = [];
        if (linePlan) meta.push(...kit.type(linePlan, { fill: c.dark ? mixOk(pal.paper, pal.ground, 0.18) : metaInk(pal) }));
        // The call to action on a hairline that draws under it.
        const r = kit.P("rule");
        if (r > 0 && cta) meta.push(rule({ x: cta.ink.x, y: cta.lines[0].baseline + cta.size * 0.4, w: cta.ink.w, color: gold, p: r, width: Math.max(1.25, S * 0.0018) }));
        if (ctaPlan) meta.push(...kit.type(ctaPlan, { fill: pal.ink }));
        if (sitePlan) meta.push(...kit.type(sitePlan, { fill: metaInk(pal) }));
        meta.push(...signNodes(c, kit, sign, signPlan, "brand", side ? textX : cx - (sign?.w ?? 0) / 2, safe.y, pal.ink), ...row.draw(kit, metaInk(pal)));
        return [
          { role: "ground", nodes: field },
          { role: "atmosphere", nodes: atmosphere },
          { role: "subject", nodes: subject },
          { role: "hero", nodes: hero },
          { role: "meta", nodes: meta },
        ];
      },
    };
  },
});
