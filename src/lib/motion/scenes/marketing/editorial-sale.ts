/**
 * Season Finale: an editorial sale poster. A fashion photograph fills one side of the page, pushing in slowly under a
 * light duotone; the sale stomps in as a justified stack in a condensed poster face, every line filling the paper
 * panel; whole words of it repeat behind in giant filled type one tone off the paper, each row whole across the panel
 * and drifting up. The offer lands on a skewed highlighter that grows from the left, the call to action lands in a
 * tilted pill, and the house's name, the corner note and the address sit on the corners.
 */

import { group, type DisplayNode } from "../../display";
import { ensureContrast, mixOk } from "../../color";
import { coverCrop, duotone, pushIn } from "../../fx/photo";
import { highlighter, rotation } from "../../fx/overlays";
import { twoShadow } from "../../fx/depth";
import { brandSign, capBand, corners, fitLines, footRow, ghost, metaInk, moveLines, onAccentInk, paperField, meshField, pillOn, posterScene, rgba, shadowed, signIn, signNodes, stackLanded } from "./poster";

export default posterScene({
  id: "marketing/editorial-sale",
  name: "Season Finale",
  pairing: "T2",
  look: "light",
  build(c) {
    const { S, safe, pal, design } = c;
    const side = c.wide;
    const photo = c.recipe.media?.product ? c.input.images?.product : undefined;
    // The photo: the right half (a little more on a tall frame), edge to edge.
    const pw = Math.round(design.w * (side ? 0.46 : 0.45));
    const panel = { x: design.w - pw, y: 0, w: pw, h: design.h };
    const signH = S * (c.cover ? 0.064 : 0.048);
    const sign = brandSign(c, { maxW: S * 0.32, h: signH, x: safe.x, y: safe.y, min: S * (c.cover ? 0.056 : 0.03) });
    const top = safe.y + (sign?.h ?? 0) + S * 0.06;
    const ctaSize = S * (c.cover ? 0.054 : 0.044);
    const footSize = S * (c.cover ? 0.024 : 0.02);
    const footH = footSize * 1.1 + S * 0.05;
    const ctaY = safe.y + safe.h - footH - ctaSize * 1.05 - ctaSize * 0.35;
    const leftBox = { x: safe.x, y: safe.y, w: design.w - pw - safe.x - S * 0.03, h: safe.h };
    const row = footRow(c, 2.4, { arrow: false, box: leftBox });
    const ctaOpts = { role: "body" as const, weight: 700, x: safe.x + ctaSize * 0.6, width: safe.w * 0.55, maxLines: 1, max: ctaSize, min: S * 0.032 };
    const cta0 = c.set("cta", c.field("cta"), { ...ctaOpts, y: ctaY });
    const offerSize = S * (c.cover ? 0.062 : 0.05);
    // The hero takes the room above the offer and the pill, every line ending before the photo's edge (never on a face).
    const heroW = panel.x - safe.x - S * 0.035;
    const roomBottom = ctaY - ctaSize * 0.35 - S * 0.06 - offerSize * 1.6 - S * 0.05;
    const head = fitLines(c, "headline", c.field("headline"), { x: safe.x, top, room: roomBottom - top, centre: Math.min(design.h * 0.42, (top + roomBottom) / 2), width: heroW, maxLines: 3, max: S * 0.42, min: S * 0.1, preset: "stomp", leading: 0.86, fill: 0.97, ratio: 1.3, gap: 0.07, stack: true });
    const headB = head ? head.band : { x: safe.x, y: top, w: 0, h: 0 };
    const offerY = headB.y + headB.h + S * 0.07;
    // The offer on the text's own margin (its bar bleeds a little to the left), the call to action close under it.
    const offer = c.set("offer", c.field("offer"), { role: "accent", x: safe.x, y: offerY, width: safe.w * 0.7, maxLines: 2, max: offerSize, min: S * 0.032, preset: "bar-swipe" });
    const offerBottom = offer ? offer.lines[offer.lines.length - 1].baseline + offer.size * 0.3 : headB.y + headB.h;
    const cta = cta0 ? (c.set("cta", c.field("cta"), { ...ctaOpts, max: cta0.size, min: cta0.size, y: Math.min(ctaY, offerBottom + S * 0.09) }) ?? cta0) : null;

    const k = c.spread(3, 1.6);
    c.ev("photo", "hero", 0, 0.9, "enter");
    const headPlans = head ? moveLines(c, head, { in: "stomp", at: 0.05, hero: true, flash: true }, "headline", 0.14) : [];
    const headDone = headPlans.length ? stackLanded(headPlans) : 1;
    c.ev("bar", "draw", headDone + 0.05, 0.28, "snap");
    const offerPlan = offer ? c.move(offer, { in: "word-lift", at: headDone + 0.15 }) : null;
    if (cta) c.ev("pill", "pop", headDone + 0.35 * k, 0.5, "pop");
    const ctaPlan = cta ? c.move(cta, { in: "word-lift", at: headDone + 0.35 * k + 0.08 }) : null;
    c.ev("arrow", "draw", headDone + 0.5 * k, 0.5, "draw");
    const signPlan = signIn(c, sign, "brand", 0.2);

    const offerB = offer ? capBand(offer) : null;
    const ghostWord = c.field("headline").split(/\s+/).pop() ?? "";
    // The ghost word whole across the paper panel (its width 92 % of the panel), rows down the page.
    const panelW = panel.x;
    const g100 = ghostWord ? c.measure(ghostWord, `${c.pairing.hero.weight} 100px "${c.pairing.hero.family}"`) : 100;
    const ghostSize = Math.min(design.h * 0.4, (100 * panelW * 0.92) / Math.max(1, g100));
    // A fact on the photo's foot, over a soft scrim.
    const facts = corners(c, [{ at: "br", field: "website", text: c.field("website") }], { at: headDone + 0.6 * k, box: { x: panel.x + S * 0.04, y: safe.y, w: safe.x + safe.w - panel.x - S * 0.04, h: safe.h }, width: safe.x + safe.w - panel.x - S * 0.04 });
    const factInk = pal.paper;

    return {
      overflow: [...(head?.overflow ? ["headline"] : []), ...(offer?.overflow ? ["offer"] : []), ...(cta?.overflow ? ["cta"] : []), ...(sign?.overflow ? ["brand"] : []), ...facts.overflow, ...row.overflow],
      signature: headDone + 0.1,
      camera: (t) => ({ x: -18 * (1 - Math.min(1, t / c.last)) ** 2, y: 0 }),
      draw(t, kit) {
        const field = c.dark ? meshField(c, t) : paperField(c, t, { tint: pal.brand[1], light: 0.4 });
        const rows = Math.ceil(design.h / (ghostSize * 1.02)) + 1;
        // The ghost rows show only above and below the headline's band and below the wordmark (never a double image of the
        // hero, never under the brand).
        const rowsN: DisplayNode[] = ghostWord ? Array.from({ length: rows }, (_, i) => ghost(c, { field: "headline", lines: [ghostWord], size: ghostSize, x: panelW * 0.04, y: -ghostSize * 0.35 + i * ghostSize * 1.02, t, vertical: true, dir: 1, step: 0.6 })) : [];
        const clearTop = safe.y + (sign?.h ?? 0) + S * 0.04;
        const bandTop = headB.y - S * 0.04;
        const bandBottom = offerBottom + S * 0.03;
        // (the room above only when a row can show there whole enough to read as type, never a sliver)
        const zone = `${bandTop - clearTop >= ghostSize * 0.7 ? `M0 ${clearTop}H${panelW}V${bandTop}H0Z ` : ""}M0 ${bandBottom}H${panelW}V${design.h}H0Z`;
        const ghosts: DisplayNode[] = rowsN.length ? [group(rowsN, { clip: { type: "path", d: zone } })] : [];
        const subject: DisplayNode[] = [];
        const pl = kit.L("photo");
        if (pl > 0) {
          // A mask wipes the photo open from the seam outwards (never a fade), graded, pushing in slowly.
          const p = kit.P("photo");
          const box = panel;
          const shown = { ...panel, w: pw * p };
          const content: DisplayNode[] = photo
            ? [{ type: "image", bleed: true, src: "product", ...box, crop: coverCrop(photo, box, { x: 0.5, y: 0.42 }, pushIn(t, c.last, { from: 1.0, to: 1.06 }).zoom) }, ...duotone(box, { dark: mixOk(pal.brand[0], "#000000", 0.2), light: pal.brand[1], darkAlpha: 0.25, lightAlpha: 0.12 }), { type: "rect", x: box.x, y: box.y + box.h * 0.68, w: box.w, h: box.h * 0.32, fill: { kind: "linear", x0: 0, y0: box.y + box.h * 0.68, x1: 0, y1: box.y + box.h, stops: [{ at: 0, color: rgba(pal.night, 0) }, { at: 1, color: rgba(pal.night, 0.62) }] } }]
            : [{ type: "rect", ...box, fill: { kind: "linear", x0: 0, y0: 0, x1: 0, y1: design.h, stops: [{ at: 0, color: mixOk(pal.brand[1], pal.ground, 0.2) }, { at: 1, color: mixOk(pal.brand[1], "#000000", 0.3) }] } }];
          subject.push(group([...twoShadow({ nodes: [{ type: "rect", ...shown, fill: "#000" }], size: S * 0.5, ground: pal.ground, bounds: shown, key: `sf|${shown.w.toFixed(0)}x${design.h}` }), group(content, { clip: { type: "rect", ...shown }, isolate: box })]));
          // The seam: a paper keyline down the photo's edge.
          subject.push({ type: "rect", x: panel.x - Math.max(1, S * 0.002), y: 0, w: Math.max(2, S * 0.004), h: design.h, fill: pal.paper, opacity: Math.min(1, pl * 2) });
        }
        const heroWords: DisplayNode[] = head ? head.sets.flatMap((_, i) => kit.type(headPlans[i], { fill: pal.ink })) : [];
        const hero: DisplayNode[] = head && t >= headDone ? [...shadowed(c, heroWords, head.size, headB, `sf|${head.sets.map((s) => s.text).join("|")}|${head.size}`, 0.7), ...heroWords] : heroWords;
        const overlay: DisplayNode[] = [];
        const bp = kit.P("bar");
        // The offer's highlighter: skewed −3°, its edges a little uneven, growing from the left; taller than the words.
        if (offer && offerB && bp > 0) {
          // Tilted -2.5° with the words on it, overrunning them by 0.15 em a side.
          const hl = highlighter({ capTop: offerB.y, baseline: offerB.y + offerB.h + offerB.h * 0.3, x: offerB.x - offer.size * 0.03, w: offerB.w + offer.size * 0.06, color: pal.accent, seed: c.seed, p: bp, cover: 1.5, skew: 0, key: "offer" });
          const cx = offerB.x + offerB.w / 2;
          const cy = offerB.y + offerB.h / 2;
          const words = offerPlan && bp >= 1 ? kit.type(offerPlan, { fill: onAccentInk(pal) }) : [];
          // (a plain block of the bar's colour inside it, under the words, so what is behind them is the bar itself)
          const under: DisplayNode[] = bp >= 1 ? [{ type: "rect", x: offerB.x, y: offerB.y - offerB.h * 0.05, w: offerB.w, h: offerB.h * 1.1, fill: pal.accent }] : [];
          if (hl) overlay.push(group([hl, ...under, ...words], { transform: rotation(-2.5, cx, cy) }));
        }
        if (cta && ctaPlan && kit.L("pill") > 0) overlay.push(pillOn(cta, kit.type(ctaPlan, { fill: ensureContrast(pal.ground, pal.ink, 4.5) }), pal.ink, { deg: 0, p: kit.P("pill") }));
        const meta = [...signNodes(c, kit, sign, signPlan, "brand", safe.x, safe.y, pal.ink), ...facts.draw(kit, factInk), ...row.draw(kit, metaInk(pal))];
        return [
          { role: "ground", nodes: field },
          { role: "ghost", nodes: ghosts },
          { role: "subject", nodes: subject, push: 0 },
          { role: "hero", nodes: hero },
          { role: "overlay", nodes: overlay },
          { role: "meta", nodes: meta },
        ];
      },
    };
  },
});
