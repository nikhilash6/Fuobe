/**
 * Runway Titles: lookbook titles over a full-bleed editorial photograph. The photo pushes in from wide; a fine
 * keyline frame draws round the page; the title cuts up letter by letter as a justified stack in a huge condensed face
 * at the foot, a line every 140 ms, and a single script word draws itself on across the top of its first line's last
 * word at −8°, in the accent with a dark keyline so it reads on the caps and the photo alike. The house and the address
 * sit on the top corners, the line and the corner note on the bottom ones, small against the title.
 */

import { group, type DisplayNode } from "../../display";
import { ensureContrast, mixOk } from "../../color";
import { photo as photoNode } from "../../fx/photo";
import { rotation } from "../../fx/overlays";
import { brandSign, capAt, capBand, fadeScrim, fitLines, meshField, moveLines, onBaseline, posterScene, rgba, shadowed, signIn, signNodes, stackLanded, topSite } from "./poster";

export default posterScene({
  id: "marketing/lookbook",
  name: "Runway Titles",
  pairing: "T1",
  look: "dark",
  build(c) {
    const { S, safe, pal, design } = c;
    const side = c.wide;
    const pic = c.recipe.media?.product ? c.input.images?.product : undefined;
    const colW = side ? safe.w * 0.56 : safe.w;
    const signH = S * (c.cover ? 0.066 : 0.05);
    const sign = brandSign(c, { maxW: S * 0.42, h: signH, x: safe.x, y: safe.y, min: S * (c.cover ? 0.06 : 0.03) });
    const metaSize = S * (c.cover ? 0.02 : 0.018);
    // The address on the top-right corner (beside the house), the line and the corner note on the bottom corners.
    const site = topSite(c, sign, metaSize, { width: safe.w * 0.45 });
    const footBase = safe.y + safe.h - metaSize * 0.25;
    const line = onBaseline(c, "line", c.field("line"), { role: "meta", x: safe.x, width: safe.w * 0.6, maxLines: 1, max: metaSize, min: S * 0.016, align: "left", preset: "fade-rise", y: 0 }, footBase);
    const note = onBaseline(c, "note", c.field("note"), { role: "meta", x: safe.x + safe.w * 0.6, width: safe.w * 0.4, maxLines: 1, max: metaSize, min: S * 0.016, align: "right", preset: "fade-rise", y: 0 }, footBase);

    // The title: as big as the foot of the frame allows, above the bottom corner row (on a tall frame, low on the dress).
    const floor = footBase - metaSize * 1.2 - S * 0.05;
    const room = floor - (safe.y + (sign?.h ?? 0) + S * 0.2);
    const head = fitLines(c, "headline", c.field("headline"), { x: safe.x, top: floor - Math.min(room, design.h * 0.5), room: Math.min(room, design.h * 0.5), anchor: 1, width: colW, maxLines: 2, max: S * (side ? 0.3 : 0.34), min: S * 0.09, preset: "cut-rise-glyph", fill: 0.97, ratio: 1.3, gap: 0.06, stack: true });
    const headB = head ? head.band : { x: safe.x, y: floor, w: 0, h: 0 };
    // The script word rides just above the first line, over the gap between its words: its baseline dips at most 8 % of
    // the cap height into the capitals (it never covers a letter's counter, so the title always reads).
    const first = head?.sets[0] ?? null;
    const firstWord = first ? first.words[0] : null;
    const capH = first ? first.cap.bottom - first.cap.top : 0;
    const accSize = first ? first.size * 0.55 : S * 0.12;
    const accX = firstWord && first && first.words.length > 1 ? Math.max(safe.x, firstWord.x + firstWord.w * 0.45) : safe.x + S * 0.04;
    const accW = Math.max(S * 0.2, safe.x + colW - accX);
    const acc0 = c.set("accent", c.field("accent"), { role: "accent", x: accX, y: 0, width: accW, maxLines: 1, max: accSize, min: S * 0.05, preset: "ink-draw" });
    const accY = headB.y + capH * 0.06 - (acc0 ? capBand(acc0).h : 0);
    // Too little room between the brand and the title: the script gets smaller (never pushed down onto the title).
    const accRoom = headB.y + capH * 0.06 - (safe.y + (sign?.h ?? 0) + S * 0.03);
    const accH0 = acc0 ? capBand(acc0).h : 0;
    const accSizeFit = acc0 && accH0 > accRoom ? Math.max(S * 0.035, (acc0.size * Math.max(0, accRoom)) / accH0) : (acc0?.size ?? 0);
    const accFit = acc0 && accSizeFit < acc0.size ? c.set("accent", c.field("accent"), { role: "accent", x: accX, y: 0, width: accW, maxLines: 1, max: accSizeFit, min: accSizeFit, preset: "ink-draw" }) : acc0;
    const accY2 = accFit ? headB.y + capH * 0.06 - capBand(accFit).h : accY;
    const acc = accFit ? capAt(c, "accent", c.field("accent"), { role: "accent", x: accX, y: accY2, width: accW, maxLines: 1, max: accFit.size, min: accFit.size, preset: "ink-draw" }) : null;
    const accB = acc ? capBand(acc) : null;

    const k = c.spread(3, 1.6);
    const headPlans = head ? moveLines(c, head, { in: "cut-rise-glyph", at: 0.05, hero: true, loop: "light-sweep", loopAt: 2.6, loopEvery: 1.9 }, "headline", 0.14) : [];
    const headDone = headPlans.length ? stackLanded(headPlans) : 1.1;
    // The script draws itself on once the title has landed.
    const accPlan = acc ? c.move(acc, { in: "ink-draw", at: headDone + 0.05 }) : null;
    const linePlan = line ? c.move(line, { in: "fade-rise", at: headDone + 0.2 * k, rate: 30 }) : null;
    const notePlan = note ? c.move(note, { in: "fade-rise", at: headDone + 0.3 * k, rate: 30 }) : null;
    const sitePlan = site ? c.move(site, { in: "fade-rise", at: 0.5, rate: 30 }) : null;
    const signPlan = signIn(c, sign, "brand", 0.3);

    const gold = mixOk(pal.accent, "#e2bd78", 0.3);
    // On a light look the scrim is light, so the words take the ink.
    const titleInk = c.dark ? pal.paper : pal.ink;
    // The script in the kit's accent at full strength, so it reads apart from the title it crosses.
    const accInk = c.dark ? ensureContrast(mixOk(pal.accent, "#fff4dc", 0.45), pal.ground, 4.5) : ensureContrast(gold, pal.ground, 4.5);

    return {
      overflow: [...(head?.overflow ? ["headline"] : []), ...(acc?.overflow ? ["accent"] : []), ...(line?.overflow ? ["line"] : []), ...(sign?.overflow ? ["brand"] : []), ...(site?.overflow ? ["website"] : []), ...(note?.overflow ? ["note"] : [])],
      signature: headDone + 0.3,
      camera: (t) => ({ x: -14 * (1 - Math.min(1, t / c.last)) ** 2, y: 0 }),
      grain: 0.06,
      draw(t, kit) {
        const field: DisplayNode[] = pic
          ? [{ type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: pal.ground }, photoNode({ bleed: true, src: "product", img: pic, box: { x: 0, y: 0, w: design.w, h: design.h }, t, duration: c.last, push: { from: 1.0, to: 1.06 }, focus: { x: side ? 0.5 : 0.47, y: 0.4 }, grade: { dark: mixOk(pal.ground, "#000000", 0.3), light: gold, darkAlpha: 0.26, lightAlpha: 0.08 } })]
          : meshField(c, t, { glow: gold, glowAlpha: 0.2 });
        // Scrims: the foot under the title, and the top third under the brand and the line (they read on any photo).
        const atmosphere: DisplayNode[] = [
          fadeScrim(c, pal.ground, side ? 0.4 : 0.5, 1, 0.85),
          { type: "rect", x: 0, y: 0, w: design.w, h: design.h * 0.32, fill: { kind: "linear", x0: 0, y0: 0, x1: 0, y1: design.h * 0.32, stops: [{ at: 0, color: rgba(pal.night, 0.62) }, { at: 0.55, color: rgba(pal.night, 0.38) }, { at: 1, color: rgba(pal.night, 0) }] } },
        ];
        const overlay: DisplayNode[] = [];
        const hero: DisplayNode[] = head ? head.sets.flatMap((_, i) => kit.type(headPlans[i], { fill: titleInk, sweep: gold, sweepAlpha: 0.4 })) : [];
        if (accPlan && accB && acc) {
          const cx = accB.x + accB.w / 2;
          const cy = accB.y + accB.h / 2;
          const nodes = kit.type(accPlan, { fill: accInk });
          // Solid gold script lifted by its own soft shadow (no outline).
          hero.push(group([...(t >= accPlan.settled ? shadowed(c, nodes, acc.size * 0.4, { x: accB.x - acc.size * 0.3, y: accB.y - acc.size * 0.3, w: accB.w + acc.size * 0.6, h: accB.h + acc.size * 0.6 }, `rt|${acc.text}|${acc.size}`) : []), ...nodes], { transform: rotation(-6, cx, cy) }));
        }
        const metaInk2 = c.dark ? mixOk(pal.paper, gold, 0.15) : pal.ink;
        const meta: DisplayNode[] = [...signNodes(c, kit, sign, signPlan, "brand", safe.x, safe.y, titleInk)];
        if (linePlan) meta.push(...kit.type(linePlan, { fill: metaInk2, caret: gold }));
        if (notePlan) meta.push(...kit.type(notePlan, { fill: metaInk2 }));
        if (sitePlan) meta.push(...kit.type(sitePlan, { fill: metaInk2 }));
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
