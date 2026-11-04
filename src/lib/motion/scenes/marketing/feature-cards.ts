/**
 * Feature Cards: a big headline set as a justified stack (each line fitted to the width, broken after its clause),
 * cutting up line by line; then three numbered benefits land one after another. The numbers are the design: 01 02 03
 * in the hero face down the left, each with a rule drawing out to its card. The cards are one system: frosted glass
 * with a bright top edge and a contact and an ambient shadow, each as wide as its words, the first a few degrees off
 * true, sliding in from the right with its benefit riding inside (never over its number). A lit two-tone field of
 * the brand's hue sits under everything; the brand, the address, a corner note and an index arrow sit on the corners.
 * Through the hold the type plane pushes in.
 */

import { group, type DisplayNode } from "../../display";
import { contrastOf, fieldStops, mixOk } from "../../color";
import { twoShadow } from "../../fx/depth";
import { rotation } from "../../fx/overlays";
import { asDecor, bands, brandSign, capBand, fitLines, footRow, ghost, litField, metaInk, moveLines, posterScene, signIn, signNodes, stackLanded, topSite } from "./poster";
import type { TypePlan } from "../../type/animate";
import type { TypeSet } from "../../type/glyphs";
import { fontOf } from "../../type/faces";

interface Card {
  i: number;
  x: number;
  y: number;
  w: number;
  h: number;
  deg: number;
  set: TypeSet;
}

/** Each card swings in from a slight tilt (alternating) and settles level: never tilted at rest. */
const TILTS = [-3, 2, -1.5];

export default posterScene({
  id: "marketing/feature-cards",
  name: "Feature Cards",
  pairing: "T7",
  look: "brand",
  build(c) {
    const { S, safe, pal, design } = c;
    const side = c.wide;
    const signH = S * (c.cover ? 0.058 : 0.046);
    const sign = brandSign(c, { maxW: S * 0.36, h: signH, x: safe.x, y: safe.y, min: S * (c.cover ? 0.05 : 0.03) });
    const metaSize = S * (c.cover ? 0.024 : 0.02);
    const site = topSite(c, sign, metaSize);
    const b = bands(c, { topRow: sign?.h ?? metaSize, gap: S * 0.06 });
    const foot = metaSize * 1.1 + S * 0.05;
    const bottom = b.bottom - foot;
    const points = ["point1", "point2", "point3"].map((k) => ({ key: k, text: c.field(k) })).filter((p) => p.text);
    const n = Math.max(1, points.length);
    const headW = side ? safe.w * 0.44 : safe.w;
    // The cards keep room for their words at a readable size; the headline takes the rest.
    const minCard = S * 0.1;
    const cardRoom = side ? 0 : n * minCard + (n - 1) * S * 0.03 + S * 0.07;
    const head = fitLines(c, "headline", c.field("headline"), { x: safe.x, top: b.top, room: side ? bottom - b.top : bottom - b.top - cardRoom, anchor: side ? 0.45 : 0, width: headW, maxLines: 3, max: S * (side ? 0.18 : 0.26), min: S * 0.07, preset: "cut-rise", fill: 0.98, ratio: 1.5, gap: 0.14, stack: true });
    const headBottom = head ? head.band.y + head.band.h + head.size * 0.25 : b.top;
    const colX = side ? safe.x + safe.w * 0.5 : safe.x;
    const colW = side ? safe.w * 0.5 : safe.w;
    const cardsTop = side ? b.top : headBottom + S * 0.07;
    const gapY = S * 0.03;
    const cardH = Math.min(S * 0.15, Math.max(minCard, (bottom - cardsTop - gapY * (n - 1)) / n));
    // The cards spread down to the foot (their gaps open up when there's room).
    const spread = side ? gapY : Math.max(gapY, Math.min(S * 0.08, (bottom - cardsTop - n * cardH) / Math.max(1, n - 1)));
    const numSize = Math.min(cardH * 0.7, S * 0.13);
    const numFont = fontOf(c.pairing.hero.family, numSize, c.pairing.hero.weight);
    const numW = Math.max(c.measure("00", numFont), c.measure("03", numFont)) + S * 0.04;
    const cardX = colX + numW;
    const padX = S * 0.045;
    const pointMax = Math.min(S * (c.cover ? 0.05 : 0.045), cardH * 0.3);
    const cards: Card[] = [];
    points.forEach((p, i) => {
      const y = cardsTop + i * (cardH + spread);
      const maxW = colW - numW;
      const textX = cardX + padX;
      const opts = { role: "body" as const, weight: 600, x: textX, width: maxW - 2 * padX, maxLines: 2, min: S * 0.03, leading: 1.15, tracking: 0, preset: "word-lift" as const };
      const set = c.set(p.key, p.text, { ...opts, y: 0, max: pointMax });
      if (!set) return;
      const h = capBand(set).h;
      const placed = c.set(p.key, p.text, { ...opts, y: y + (cardH - h) / 2 - set.cap.top, max: set.size, min: set.size })!;
      // One width for every card (the column's), the words flush left inside.
      const w = maxW;
      cards.push({ i, x: cardX, y, w, h: cardH, deg: TILTS[i] ?? 0, set: placed });
    });

    const k = c.spread(3.2, 1.6);
    const headPlans = head ? moveLines(c, head, { in: "cut-rise", at: 0.03, hero: true }, "headline", 0.12) : [];
    const headDone = headPlans.length ? stackLanded(headPlans) : 0.6;
    // Each card enters as one piece with its words already in it (never an empty box), a short slide from the right
    // that swings level; they follow one another closely.
    const cardAt = (i: number) => Math.max(0.5, headDone - 0.3) + i * 0.1 * k;
    cards.forEach((_, i) => {
      c.ev(`card.${i}`, "enter", cardAt(i), 0.4, "settle");
      c.ev(`num.${i}`, "enter", cardAt(i) - 0.05, 0.45, "glide");
    });
    const cardPlans: TypePlan[] = cards.map((cd, i) => c.move(cd.set, { in: "fade-rise", at: cardAt(i), intensity: 0 }, `${cd.set.field}`));
    const lastCard = cardPlans.length ? Math.max(...cardPlans.map((p) => p.settled)) : headDone;
    const signPlan = signIn(c, sign, "brand", 0.2);
    const sitePlan = site ? c.move(site, { in: "fade-rise", at: 0.35, rate: 26 }) : null;
    const row = footRow(c, lastCard + 0.1);

    const frosted = pal.look !== "light";
    const glass = frosted ? "rgba(255,255,255,0.1)" : mixOk(pal.paper, "#ffffff", 0.7);
    const edge = frosted ? "rgba(255,255,255,0.4)" : mixOk(pal.brand[0], pal.paper, 0.6);
    const stops = fieldStops(pal);
    // Paper on the frosted glass where it reads at 4.5:1, else the kit's ink.
    const textInk = frosted && contrastOf(pal.paper, mixOk(pal.ground, "#ffffff", 0.12)) >= 4.5 ? pal.paper : pal.ink;
    // Where each numeral's capitals sit in its em box (to centre the card on them).
    const numBox = c.measure.box?.("03", numFont);
    const numMid = numBox ? (numBox.top + numBox.bottom) / 2 : numSize * 0.55;
    const count = String(cards.length).padStart(2, "0");

    return {
      overflow: [...(head?.overflow ? ["headline"] : []), ...cards.filter((cd) => cd.set.overflow).map((cd) => cd.set.field), ...(sign?.overflow ? ["brand"] : []), ...(site?.overflow ? ["website"] : []), ...row.overflow],
      signature: cardAt(1) + 0.5,
      camera: (t) => ({ x: 0, y: 24 * (1 - Math.min(1, t / c.last)) ** 2 }),
      draw(t, kit) {
        const field = litField(c, t, { from: "tr", stops, light: mixOk(pal.brand[1], "#ffffff", 0.3), lightAlpha: 0.2 });
        // Behind the cards: the count as a giant tonal numeral bleeding off the right edge, so the glass has depth.
        const ghosts: DisplayNode[] = cards.length && !side ? [ghost(c, { field: "index", lines: [count], size: cardH * 2.6, x: design.w + cardH * 0.25, align: "right", y: cards[0].y - cardH * 0.2, t, weight: c.pairing.hero.weight })] : [];
        const hero: DisplayNode[] = head ? head.sets.flatMap((_, i) => kit.type(headPlans[i], { fill: pal.ink })) : [];
        const subject: DisplayNode[] = [];
        const numerals: DisplayNode[] = [];
        cards.forEach((cd, i) => {
          // The number in the hero face, rising into place, a rule drawing out from it to the card.
          const nl = kit.L(`num.${i}`);
          if (nl > 0) {
            const np = kit.P(`num.${i}`);
            const label = String(i + 1).padStart(2, "0");
            const ny = cd.y + cd.h / 2 - numMid;
            numerals.push(group(asDecor([{ type: "text", field: `index.${i}`, runs: [{ text: label, gap: "", font: numFont, x: colX, y: ny, fill: pal.accent }] }]), { transform: [1, 0, 0, 1, 0, (1 - np) * numSize * 0.4], clip: { type: "rect", x: colX - S * 0.02, y: ny - numSize * 0.1, w: numW + S * 0.04, h: numSize * 1.25 } }));
          }
          const lin = kit.L(`card.${i}`);
          if (lin <= 0) return;
          const p = kit.P(`card.${i}`);
          // In from the right, a short way (never across its number), its words riding inside.
          const dx = (1 - p) * cd.w * 0.12;
          const box = { x: cd.x, y: cd.y, w: cd.w, h: cd.h };
          const plate: DisplayNode = { type: "rect", ...box, r: S * 0.026, fill: glass, stroke: { paint: edge, width: Math.max(1, S * 0.0015) } };
          const sheen: DisplayNode = { type: "rect", ...box, r: S * 0.026, fill: { kind: "linear", x0: box.x, y0: box.y, x1: box.x + box.w * 0.35, y1: box.y + box.h, stops: [{ at: 0, color: frosted ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.6)" }, { at: 0.45, color: "rgba(255,255,255,0)" }, { at: 1, color: "rgba(255,255,255,0)" }] } };
          const words = kit.type(cardPlans[i], { fill: textInk });
          const shadows = twoShadow({ nodes: [{ ...plate, fill: "#000000" }], size: cd.h, ground: pal.ground, bounds: box, key: `fc|${cd.w.toFixed(0)}x${cd.h.toFixed(0)}` });
          const rot = rotation(cd.deg * (1 - p), cd.x + cd.w / 2, cd.y + cd.h / 2);
          subject.push(group([...shadows, plate, sheen, ...words], { transform: dx ? [rot[0], rot[1], rot[2], rot[3], rot[4] + dx, rot[5]] : rot, ...(lin < 0.15 && { opacity: lin / 0.15 }) }));
        });
        const meta = [...signNodes(c, kit, sign, signPlan, "brand", safe.x, safe.y, pal.ink), ...(sitePlan ? kit.type(sitePlan, { fill: metaInk(pal), caret: pal.accent }) : []), ...row.draw(kit, metaInk(pal), pal.ink)];
        return [
          { role: "ground", nodes: field },
          { role: "ghost", nodes: asDecor(ghosts) },
          { role: "hero", nodes: [...hero, ...numerals] },
          { role: "overlay", nodes: subject },
          { role: "meta", nodes: meta },
        ];
      },
    };
  },
});
