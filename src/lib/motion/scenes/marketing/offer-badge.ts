/**
 * Offer Badge: a sale poster. The headline is a justified stack, each line fitted to the width (a short last word
 * lands huge), swiping in on bars of a deep tone of the brand; the product rises out of its floor in the middle band
 * with a soft column of light behind it and a band of light crossing it; a badge in the hero's ink with a fine inner
 * ring stamps down beside it as one piece (the offer, as typed, rides on it and never leaves the disc), clear of the
 * product. A giant filled copy of the offer one tone off the field drifts behind; the call to action lands in a pill
 * of the badge's colour above the bottom corners. The brand, the address, a corner note and an index arrow sit on the
 * corners; through the hold the type plane pushes in.
 */

import { group, type DisplayNode } from "../../display";
import { ensureContrast, fieldStops, mixOk } from "../../color";
import { pool, rgba } from "../../fx/background";
import { product as productNode } from "../../fx/photo";
import { rotation } from "../../fx/overlays";
import { twoShadow } from "../../fx/depth";
import { badgeSpot, fitBox, logoNode, type BadgeSpot } from "./kit";
import { bands, brandSign, capBand, fitLines, footRow, ghost, litField, metaInk, moveLines, pillOn, posterScene, signIn, signNodes, stackLanded, topSite } from "./poster";

export default posterScene({
  id: "marketing/offer-badge",
  name: "Offer Badge",
  pairing: "T2",
  look: "brand",
  build(c) {
    const { S, safe, pal, design } = c;
    const side = c.wide;
    const prod = c.recipe.media?.product ? c.input.images?.product : undefined;
    const outline = prod ? (c.input.outlines?.product ?? null) : null;
    const textX = side ? safe.x + safe.w * 0.5 : safe.x;
    const textW = side ? safe.w * 0.5 : safe.w;
    const signH = S * (c.cover ? 0.056 : 0.044);
    const sign = brandSign(c, { maxW: S * 0.34, h: signH, x: safe.x, y: safe.y, min: S * (c.cover ? 0.05 : 0.03) });
    const metaSize = S * (c.cover ? 0.024 : 0.02);
    const site = topSite(c, sign, metaSize);
    const b = bands(c, { topRow: sign?.h ?? metaSize, gap: S * 0.05 });
    const foot = metaSize * 1.1 + S * 0.04;
    const ctaSize = S * (c.cover ? 0.05 : 0.042);
    const ctaPadY = ctaSize * 0.35;
    const ctaY = safe.y + safe.h - foot - ctaSize * 1.1 - ctaPadY;
    const cta = c.set("cta", c.field("cta"), { role: "body", weight: 700, x: side ? textX + ctaSize * 0.6 : design.w / 2 - safe.w * 0.4, y: ctaY, width: side ? textW - ctaSize * 1.2 : safe.w * 0.8, maxLines: 1, max: ctaSize, min: S * 0.034, align: side ? "left" : "centre" });
    const head = fitLines(c, "headline", c.field("headline"), { x: textX, top: b.top, room: side ? (ctaY - ctaPadY - S * 0.06 - b.top) : (b.bottom - b.top) * 0.44, anchor: side ? 0.4 : 0, width: textW, maxLines: 3, max: S * (side ? 0.16 : 0.26), min: S * 0.07, preset: "bar-swipe", fill: 0.985, ratio: 2.4, gap: 0.09, stack: true });
    const headB = head ? head.band : { x: textX, y: b.top, w: 0, h: 0 };

    // The product in the middle band (the left half on a wide frame), on its floor; on a tall frame it stands up behind
    // the headline's last line (type in front of the product), so it can be a third of the frame's width.
    // A short last line leaves its right free: the product stands up beside it, its top level with the line's caps.
    const lastLine = head ? head.sets[head.sets.length - 1] : null;
    const lastRight = lastLine ? lastLine.ink.x + lastLine.ink.w : safe.x + safe.w;
    const besideLast = !side && !!lastLine && head!.sets.length > 1 && lastRight < safe.x + safe.w * 0.5;
    const bandTop = side ? b.top + S * 0.02 : besideLast ? lastLine!.lines[0].y + lastLine!.cap.top : headB.y + headB.h + S * 0.04;
    const bandBottom = side ? safe.y + safe.h - foot : ctaY - ctaPadY - S * 0.05;
    const box = side ? { x: safe.x, y: bandTop, w: safe.w * 0.24, h: bandBottom - bandTop } : besideLast ? { x: lastRight + S * 0.05, y: bandTop, w: Math.min(safe.w * 0.4, safe.x + safe.w - lastRight - S * 0.05), h: bandBottom - bandTop } : { x: safe.x + safe.w * 0.02, y: bandTop, w: safe.w * 0.5, h: bandBottom - bandTop };
    const img = prod ? fitBox(prod, box, true) : c.input.logo ? fitBox(c.input.logo, { ...box, y: box.y + box.h * 0.3, h: box.h * 0.4 }) : null;
    const bR = S * (side ? 0.13 : 0.15);
    // On a wide frame the badge has the room right of the product to itself, at least 16.5 % below the top.
    const right = img ? img.x + img.w + S * 0.02 : safe.x;
    const wideTop = Math.max(safe.y, design.h * 0.165);
    const bounds = side ? (img && safe.x + safe.w * 0.5 - right >= bR * 2 ? { x: right, y: wideTop, w: safe.x + safe.w * 0.5 - right, h: safe.y + safe.h - wideTop } : { x: safe.x, y: wideTop, w: safe.w * 0.5, h: safe.y + safe.h - wideTop }) : { x: safe.x, y: headB.y + headB.h + S * 0.03, w: safe.w, h: bandBottom - (headB.y + headB.h + S * 0.03) };
    const spot: BadgeSpot = img ? badgeSpot(img, outline, bR, bounds, 0.75) : { cx: box.x + box.w / 2, cy: box.y + box.h / 2, r: bR, cover: 0 };
    // The offer sits well inside the disc (its widest line in 1.3 r).
    const offer = c.set("offer", c.field("offer"), { role: "figures", x: spot.cx - spot.r * 0.65, y: 0, width: spot.r * 1.3, maxLines: 2, max: spot.r * 0.62, min: S * 0.04, align: "centre", preset: "cut-rise", leading: 0.86 });
    const offerSet = offer ? c.set("offer", c.field("offer"), { role: "figures", x: spot.cx - spot.r * 0.65, y: spot.cy - capBand(offer).h / 2 - (offer.lines[0].y + offer.cap.top), width: spot.r * 1.3, maxLines: 2, max: offer.size, min: offer.size, align: "centre", preset: "cut-rise", leading: 0.86 }) : null;

    const k = c.spread(3.2, 1.6);
    const headPlans = head ? moveLines(c, head, { in: "bar-swipe", at: 0.03, hero: true }, "headline", 0.12) : [];
    const headDone = headPlans.length ? stackLanded(headPlans) : 0.6;
    c.ev("product", "hero", Math.max(0.3, headDone - 0.4), 0.9, "enter");
    // The badge stamps down as one piece (a slam in 167 ms from 125 %, a little squash); the offer rises on it.
    const slamAt = Math.max(0.9 * k, headDone + 0.25);
    c.ev("badge", "slam", slamAt, 0.167, "slam");
    c.ev("squash", "pop", slamAt + 0.167, 0.4, "land");
    c.ev("ring", "fade", slamAt + 0.167, 0.5, "glide");
    const offerPlan = offerSet ? c.move(offerSet, { in: "cut-rise", at: slamAt + 0.05 }) : null;
    const offerDone = Math.max(slamAt + 0.6, offerPlan?.settled ?? 1.4);
    c.ev("sweep", "move", offerDone + 0.05, 0.8, "move");
    const ctaPlan = cta ? c.move(cta, { in: "word-lift", at: offerDone + 0.15 * k }) : null;
    if (cta) c.ev("pill", "pop", offerDone + 0.08 * k, 0.5, "pop");
    const signPlan = signIn(c, sign, "brand", 0.2);
    const sitePlan = site ? c.move(site, { in: "fade-rise", at: 0.35, rate: 26 }) : null;
    const row = footRow(c, (ctaPlan?.settled ?? offerDone) + 0.1);

    // The badge: the hero's ink as the disc, the ground's colour for the offer on it (in the kit, never black on cream).
    const badgeFill = pal.ink;
    const offerInk = ensureContrast(pal.ground, badgeFill, 4.5);
    const stops = fieldStops(pal);
    const ghostGround = mixOk(stops.dark, stops.light, 0.5);
    // The ghost is the offer's sign alone (a giant %), never an echo of the badge's words; none without one.
    const ghostText = /%/.test(c.field("offer")) ? "%" : "";
    const floorY = img ? img.y + img.h : bandBottom;

    return {
      overflow: [...(head?.overflow ? ["headline"] : []), ...(offerSet?.overflow ? ["offer"] : []), ...(cta?.overflow ? ["cta"] : []), ...(sign?.overflow ? ["brand"] : []), ...(site?.overflow ? ["website"] : []), ...row.overflow],
      signature: offerDone + 0.1,
      sandwich: false,
      camera: (t) => ({ x: 0, y: 16 * (1 - Math.min(1, t / c.last)) ** 2 }),
      draw(t, kit) {
        const field = litField(c, t, { from: "tl", stops });
        // A soft column of light behind the product (one band, drifting a little), never stripes.
        const cx = img ? img.x + img.w / 2 : design.w / 2;
        const u = Math.min(1, t / Math.max(0.01, c.last));
        // A soft round key light behind the product (no hard edge anywhere), drifting a little.
        const lc = mixOk(pal.brand[1], "#ffffff", 0.3);
        const ly = img ? img.y + img.h * 0.45 : design.h * 0.55;
        const atmosphere: DisplayNode[] = [{ type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: pool(cx + (1 - u) * S * 0.04, ly, Math.max(design.w, design.h) * 0.42, lc, 0.32) }];
        // The offer's sign, giant, one faint tone off the field, cropped by the right edge in the lower half (never
        // behind the headline's column).
        const gSize = S * (side ? 0.7 : 0.95);
        const ghosts: DisplayNode[] = ghostText ? [ghost(c, { field: "offer", lines: [ghostText], size: gSize, x: design.w + gSize * 0.18, align: "right", y: Math.max(headB.y + headB.h + S * 0.04, design.h * 0.5), t, family: c.pairing.figures.family, weight: c.pairing.figures.weight, ground: ghostGround })] : [];
        // The product (or the logo) rising out of its floor, light crossing it once.
        const subject: DisplayNode[] = [];
        const pl = kit.L("product");
        if (img && pl > 0) {
          const p = kit.P("product");
          const dy = (1 - p) * img.h * 0.5;
          const nodes: DisplayNode[] = prod ? [productNode({ src: "product", box: img, ground: pal.ground, t, sweepAt: offerDone + 0.05, sweepDur: 0.8, key: "ob" })] : [logoNode(c, img, pal.ink)];
          subject.push(group([group(nodes, { transform: [1, 0, 0, 1, 0, dy] })], { ...(p < 1 && { clip: { type: "rect", x: img.x - img.w, y: img.y - img.h, w: img.w * 3, h: floorY + S * 0.012 - (img.y - img.h) } }) }));
        }
        const hero: DisplayNode[] = head ? head.sets.flatMap((_, i) => kit.type(headPlans[i], { fill: pal.ink, bar: pal.accent })) : [];
        const overlay: DisplayNode[] = [];
        const bl = kit.L("badge");
        if (bl > 0) {
          const bp = kit.P("badge");
          const sq = kit.L("squash");
          const squash = sq > 0 && sq < 1 ? 0.06 * Math.sin(Math.PI * Math.min(1, sq * 2.2)) * (1 - sq) : 0;
          const s = 1.25 - 0.25 * bp;
          const sx = s * (1 + squash);
          const sy = s * (1 - squash);
          const disc: DisplayNode = { type: "ellipse", cx: spot.cx, cy: spot.cy, rx: spot.r, ry: spot.r, fill: badgeFill };
          const ring: DisplayNode = { type: "ellipse", cx: spot.cx, cy: spot.cy, rx: spot.r * 0.92, ry: spot.r * 0.92, stroke: { paint: offerInk, width: Math.max(2, S * 0.002) } };
          const offerNodes = offerPlan ? kit.type(offerPlan, { fill: offerInk }) : [];
          const rl = kit.L("ring");
          if (rl > 0 && rl < 1) overlay.push({ type: "ellipse", cx: spot.cx, cy: spot.cy, rx: spot.r * (1 + 0.4 * kit.P("ring")), ry: spot.r * (1 + 0.4 * kit.P("ring")), stroke: { paint: rgba(badgeFill, 0.6 * (1 - rl)), width: Math.max(2, S * 0.004) } });
          const shadows = bp >= 1 ? twoShadow({ nodes: [disc], size: spot.r * 2, ground: pal.ground, bounds: { x: spot.cx - spot.r, y: spot.cy - spot.r, w: spot.r * 2, h: spot.r * 2 }, key: `ob|${spot.r.toFixed(0)}` }) : [];
          // The offer never leaves its disc.
          overlay.push(group([...shadows, group([disc, ring, group(offerNodes, { clip: { type: "ellipse", cx: spot.cx, cy: spot.cy, rx: spot.r * 0.9, ry: spot.r * 0.9 } })], { transform: rotation(-8, spot.cx, spot.cy) })], { transform: [sx, 0, 0, sy, spot.cx - sx * spot.cx, spot.cy - sy * spot.cy], ...(bl < 0.25 && { opacity: bl / 0.25 }) }));
        }
        if (cta && ctaPlan && kit.L("pill") > 0) overlay.push(pillOn(cta, kit.type(ctaPlan, { fill: offerInk }), badgeFill, { deg: 0, p: kit.P("pill") }));
        const meta = [...signNodes(c, kit, sign, signPlan, "brand", safe.x, safe.y, pal.ink), ...(sitePlan ? kit.type(sitePlan, { fill: metaInk(pal), caret: pal.accent }) : []), ...row.draw(kit, metaInk(pal), pal.ink)];
        return [
          { role: "ground", nodes: field },
          { role: "atmosphere", nodes: atmosphere },
          { role: "ghost", nodes: ghosts },
          { role: "subject", nodes: subject },
          { role: "hero", nodes: hero },
          { role: "overlay", nodes: overlay },
          { role: "meta", nodes: meta },
        ];
      },
    };
  },
});
