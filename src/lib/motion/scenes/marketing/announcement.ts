/**
 * Marquee: an event announcement. A night photograph fills the frame and pushes in slowly, the guest framed in the
 * right of it (the sample photo is mirrored so the face sits there), a warm light coming in from the top-right edge
 * only; the event's name rises letter by letter as a justified stack in a heavy warm serif in the left 60 %, a line
 * every 120 ms, and its glow comes up behind it like a sign switching on. A fine rule draws under it, the date and the
 * place set under it, and the call to action lands in a pill. The house, the address, a corner note and an index
 * arrow sit on the corners.
 */

import { group, type DisplayNode } from "../../display";
import { ensureContrast, mixOk } from "../../color";
import { pool } from "../../fx/background";
import { photo as photoNode } from "../../fx/photo";
import { rule } from "../../fx/overlays";
import { brandSign, capAt, capBand, corners, fadeScrim, fitLines, footRow, meshField, metaInk, moveLines, onAccentInk, pillOn, posterScene, rgba, shadowed, signIn, signNodes, stackLanded } from "./poster";

export default posterScene({
  id: "marketing/announcement",
  name: "Marquee",
  pairing: "T6",
  look: "dark",
  build(c) {
    const { S, safe, pal, design } = c;
    const side = c.wide;
    const pic = c.recipe.media?.product ? c.input.images?.product : undefined;
    const colW = side ? safe.w * 0.5 : safe.w;
    // The name keeps to the left two thirds, so the guest (framed in the right third) keeps their face.
    // (narrow enough that no letter reaches the guest's face, which sits right of the frame's middle)
    const heroW = side ? colW : safe.w * (design.w / design.h > 0.9 ? 0.46 : 0.52);
    // The sample night photo has its guest on the left: mirrored, she stands in the right third (a person's own photo is never flipped).
    const flip = !side && !!c.recipe.media?.product?.startsWith("/previews/kinetic/photos/");
    const signH = S * (c.cover ? 0.066 : 0.05);
    const sign = brandSign(c, { maxW: S * 0.42, h: signH, x: safe.x, y: safe.y, min: S * (c.cover ? 0.06 : 0.03) });

    // Bottom up: the pill, the place, the date, the rule, then the name as large as the room above allows.
    const ctaSize = S * (c.cover ? 0.05 : 0.04);
    const footSize = S * (c.cover ? 0.024 : 0.02);
    const footH = footSize * 1.1 + S * 0.045;
    const ctaY = safe.y + safe.h - footH - ctaSize * 1.1 - ctaSize * 0.35;
    const row = footRow(c, 2.6);
    const cta = c.set("cta", c.field("cta"), { role: "body", weight: 600, x: safe.x + ctaSize * 0.6, y: ctaY, width: colW * 0.8, maxLines: 1, max: ctaSize, min: S * 0.03 });
    const metaSize = S * (c.cover ? 0.036 : 0.028);
    const whenSize = S * (c.cover ? 0.046 : 0.036);
    // Two voices only: the display serif for the name, one sans for every fact.
    const place0 = c.set("place", c.field("place"), { role: "body", weight: 400, x: safe.x, y: 0, width: colW, maxLines: 2, max: metaSize, min: S * 0.022 });
    const when0 = c.set("when", c.field("when"), { role: "body", weight: 700, x: safe.x, y: 0, width: colW, maxLines: 2, max: whenSize, min: S * 0.026, leading: 1.1 });
    const placeTop = (cta ? ctaY - ctaSize * 0.35 - S * 0.065 : safe.y + safe.h) - (place0 ? capBand(place0).h : 0);
    const place = place0 ? capAt(c, "place", c.field("place"), { role: "body", weight: 400, x: safe.x, y: placeTop, width: colW, maxLines: 2, max: place0.size, min: place0.size }) : null;
    const whenTop = placeTop - (place0 ? S * 0.028 : 0) - (when0 ? capBand(when0).h : 0);
    const when = when0 ? capAt(c, "when", c.field("when"), { role: "body", weight: 700, x: safe.x, y: whenTop, width: colW, maxLines: 2, max: when0.size, min: when0.size, leading: 1.1 }) : null;
    const ruleY = whenTop - S * 0.045;
    const heroBottom = ruleY - S * 0.05;
    const heroRoom = heroBottom - (safe.y + (sign?.h ?? 0) + S * 0.1);
    const head = fitLines(c, "headline", c.field("headline"), { x: safe.x, top: heroBottom - heroRoom, room: heroRoom, anchor: 1, width: heroW, maxLines: 3, max: S * (side ? 0.17 : 0.22), min: S * 0.08, preset: "cut-rise-glyph", leading: 1.05, fill: 0.96, ratio: 1.25, gap: 0.16, stack: true });
    const headB = head ? head.band : { x: safe.x, y: heroBottom, w: 0, h: 0 };

    const k = c.spread(3.2, 1.6);
    c.ev("leak", "fade", 0.1, 0.5, "glide");
    const headPlans = head ? moveLines(c, head, { in: "cut-rise-glyph", at: 0.05, hero: true, loop: "light-sweep", loopAt: 2.2, loopEvery: 1.8 }, "headline", 0.12) : [];
    const headDone = headPlans.length ? stackLanded(headPlans) : 1.2;
    c.ev("lit", "fade", headDone - 0.1, 0.7, "glide");
    c.ev("rule", "draw", headDone, 0.6, "draw");
    const whenPlan = when ? c.move(when, { in: "word-lift", at: headDone + 0.1 * k }) : null;
    const placePlan = place ? c.move(place, { in: "fade-rise", at: headDone + 0.25 * k, rate: 34 }) : null;
    if (cta) c.ev("pill", "pop", headDone + 0.45 * k, 0.5, "pop");
    const ctaPlan = cta ? c.move(cta, { in: "word-lift", at: headDone + 0.45 * k + 0.08 }) : null;
    const signPlan = signIn(c, sign, "brand", 0.5);
    const facts = corners(c, [{ at: "tr", field: "website", text: c.field("website") }], { at: headDone + 0.6 * k, box: { x: safe.x, y: safe.y + Math.max(0, ((sign?.h ?? 0) - S * 0.024) / 2), w: safe.w, h: safe.h } });

    // Warm light on a dark ground; on a light look the words take the ink instead (always readable on the ground).
    const warm = ensureContrast(mixOk(pal.accent, "#ffb36b", 0.35), pal.ground, 4.5);
    const heroInk = c.dark ? mixOk(pal.paper, warm, 0.18) : pal.ink;
    const grade = { dark: mixOk(pal.ground, "#000000", 0.2), light: warm, darkAlpha: 0.3, lightAlpha: 0.08 };

    return {
      overflow: [...(head?.overflow ? ["headline"] : []), ...(when?.overflow ? ["when"] : []), ...(place?.overflow ? ["place"] : []), ...(cta?.overflow ? ["cta"] : []), ...(sign?.overflow ? ["brand"] : []), ...facts.overflow, ...row.overflow],
      signature: headDone + 0.4,
      camera: (t) => ({ x: 0, y: 16 * (1 - Math.min(1, t / c.last)) ** 2 }),
      grain: 0.07,
      draw(t, kit) {
        const field: DisplayNode[] = pic
          ? [{ type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: pal.ground }, group([photoNode({ bleed: true, src: "product", img: pic, box: { x: 0, y: 0, w: design.w, h: design.h }, t, duration: c.last, push: { from: 1.0, to: 1.06 }, focus: { x: side ? 0.62 : flip ? 0.9 : 0.72, y: 0.42 }, grade })], { ...(flip && { transform: [-1, 0, 0, 1, design.w, 0] }) }), { type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: rgba(mixOk(warm, "#ffffff", 0.3), 0.06) }]
          : meshField(c, t, { glow: warm, glowAlpha: 0.25 });
        const atmosphere: DisplayNode[] = [
          side
            ? { type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: { kind: "linear", x0: design.w * 0.62, y0: 0, x1: 0, y1: 0, stops: [{ at: 0, color: rgba(pal.ground, 0) }, { at: 0.55, color: rgba(pal.ground, 0.62) }, { at: 1, color: rgba(pal.ground, 0.88) }] } }
            : fadeScrim(c, pal.ground, 0.36, 0.98, 0.9),
          { type: "rect", x: 0, y: 0, w: design.w, h: design.h * 0.26, fill: { kind: "linear", x0: 0, y0: 0, x1: 0, y1: design.h * 0.26, stops: [{ at: 0, color: rgba(pal.ground, 0.62) }, { at: 1, color: rgba(pal.ground, 0) }] } },
          // The left side darkened for the words; the guest stays in the light on the right.
          ...(side ? [] : [{ type: "rect" as const, x: 0, y: 0, w: design.w, h: design.h, fill: { kind: "linear" as const, x0: 0, y0: 0, x1: design.w * 0.7, y1: 0, stops: [{ at: 0, color: rgba(pal.ground, 0.55) }, { at: 1, color: rgba(pal.ground, 0) }] } }]),
        ];
        // A soft local shade behind the top corner's address, so a lit bulb in the photo never sits behind its letters.
        for (const bx of facts.boxes) atmosphere.push({ type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: pool(bx.x + bx.w * 0.6, bx.y + bx.h / 2, Math.max(bx.w, S * 0.2) * 0.85, pal.ground, 0.55) });
        // Warm light from the top-right edge only (never a wash over the face).
        const lk = kit.P("leak");
        if (lk > 0) atmosphere.push({ type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: pool(design.w * 1.02, -design.h * 0.04, Math.max(design.w, design.h) * 0.45, mixOk(warm, "#ff9a5c", 0.4), 0.2 * lk) });
        const hero: DisplayNode[] = [];
        if (head) {
          const nodes = head.sets.flatMap((_, i) => kit.type(headPlans[i], { fill: heroInk, sweep: warm, sweepAlpha: 0.45 }));
          if (kit.P("lit") > 0) hero.push(...shadowed(c, nodes, head.size, headB, `mq|${head.sets.map((s) => s.text).join("|")}|${head.size}`, kit.P("lit")));
          hero.push(...nodes);
        }
        const overlay: DisplayNode[] = [];
        const r = kit.P("rule");
        if (r > 0) overlay.push(rule({ x: safe.x, y: ruleY, w: Math.min(colW, S * 0.5), color: warm, p: r, width: Math.max(1.5, S * 0.0025) }));
        if (whenPlan) overlay.push(...kit.type(whenPlan, { fill: warm }));
        if (placePlan) overlay.push(...kit.type(placePlan, { fill: metaInk(pal), caret: warm }));
        if (cta && ctaPlan && kit.L("pill") > 0) {
          const p = kit.P("pill");
          overlay.push(pillOn(cta, kit.type(ctaPlan, { fill: onAccentInk(pal) }), pal.accent, { deg: 0, p }));
        }
        const meta = [...signNodes(c, kit, sign, signPlan, "brand", safe.x, safe.y, pal.ink), ...facts.draw(kit, metaInk(pal)), ...row.draw(kit, metaInk(pal), pal.ink)];
        return [
          { role: "ground", nodes: field, push: 0 },
          { role: "atmosphere", nodes: atmosphere, push: 0 },
          { role: "hero", nodes: hero },
          { role: "overlay", nodes: overlay },
          { role: "meta", nodes: meta },
        ];
      },
    };
  },
});
