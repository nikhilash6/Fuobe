/**
 * Offer Badge: a starburst badge pops on with a turn that settles a few degrees off square, the offer set on it as
 * typed; the product slides in under it from the side and lands on its shadow; the headline rises line by line and the
 * call-to-action pill pops last. The badge sits where it covers none of the product (its own outline, not just its
 * box), sized to the product; when no spot is clear the product steps back a little. While it holds, the product floats
 * and the badge rocks gently. On the brand colour a soft lighter pool sits behind the product. Without a product the
 * logo (or the name) takes its place.
 */

import { about, group, mixHex, multiply, translate, withAlpha, type DisplayNode } from "../../display";
import { lineRuns } from "../end-card/shared";
import { badgeSpot, contactShadow, ev, fitBox, heroOf, holdFloat, logoNode, marketingScene, MIN_BODY, MIN_HEAD, readable, risingLines, setText, spread, starPath, textBlock, type BadgeSpot } from "./kit";

export default marketingScene({
  id: "marketing/offer-badge",
  name: "Offer Badge",
  look: "light",
  build(c) {
    const { S, safe, palette: pal, design, recipe } = c;
    const hero = heroOf(c);
    const side = c.wide;
    const textW = side ? safe.w * 0.46 : safe.w;
    const textLeft = side ? safe.x + safe.w * 0.54 : safe.x;
    const head = setText(c, c.field("headline"), { weight: 800, width: textW, maxLines: 2, max: S * (side ? 0.1 : c.tall ? 0.13 : 0.11), min: S * MIN_HEAD, lineHeight: 1.04 });
    const ctaSize = S * (c.tall ? 0.056 : 0.05);
    const cta = setText(c, c.field("cta"), { family: "body", weight: 700, width: textW - ctaSize * 2.4, maxLines: 1, max: ctaSize, min: S * MIN_BODY });
    const bMax = S * (side ? 0.15 : 0.17);
    const pillH = cta ? cta.size * 2.3 : 0;
    const gap = S * 0.05;
    // Where things go: the headline over the product and the pill under it (beside it on a wide frame).
    let heroBox: { x: number; y: number; w: number; h: number };
    let headY: number;
    let pillY: number;
    if (side) {
      heroBox = { x: safe.x, y: safe.y + safe.h * 0.08, w: safe.w * 0.48, h: safe.h * 0.86 };
      const stack = (head?.height ?? 0) + (cta ? gap + pillH : 0);
      headY = safe.y + (safe.h - stack) / 2;
      pillY = headY + (head ? head.height + gap : 0);
    } else {
      headY = safe.y;
      const top = headY + (head ? head.height + gap : 0);
      pillY = safe.y + safe.h - pillH;
      heroBox = { x: safe.x + safe.w * 0.06, y: top + bMax * 0.3, w: safe.w * 0.88, h: pillY - gap - (top + bMax * 0.3) };
    }
    const product = hero?.src === "product" ? (c.input.outlines?.product ?? null) : null;
    const name = !hero ? setText(c, recipe.brand.name, { weight: 800, width: heroBox.w * 0.8, maxLines: 2, max: S * 0.12, min: S * MIN_HEAD, lineHeight: 1.04 }) : null;
    const nameB = name ? textBlock("brand", name, { y: heroBox.y + (heroBox.h - name.height) / 2, color: pal.ink, cx: heroBox.x + heroBox.w / 2 }) : null;
    // The badge by the product, under the headline and over the pill.
    const below = side ? safe.y : headY + (head ? head.height + gap * 0.3 : 0);
    const bounds = { x: side ? heroBox.x : safe.x, y: below, w: side ? heroBox.w : safe.w, h: (side ? safe.y + safe.h : pillY - gap * 0.3) - below };
    let img = hero ? fitBox(hero, heroBox, hero.src === "product") : null;
    let spot: BadgeSpot;
    const pic = () => img ?? (nameB && name ? { x: nameB.cx - name.width / 2, y: nameB.y, w: name.width, h: name.height } : heroBox);
    spot = badgeSpot(pic(), product, bMax, bounds);
    // No clear spot: the product steps back (smaller, on the same foot) until one is.
    for (let i = 0; img && product && spot.cover > 0.04 && i < 3; i++) {
      const k = 0.88;
      img = { x: img.x + (img.w * (1 - k)) / 2, y: img.y + img.h * (1 - k), w: img.w * k, h: img.h * k };
      spot = badgeSpot(img, product, bMax, bounds);
    }
    const bc: [number, number] = [spot.cx, spot.cy];
    const bR = spot.r;
    const offer = setText(c, c.field("offer"), { family: "figures", weight: 800, width: bR * 1.3, maxLines: 2, max: bR * 0.5, min: S * 0.035, lineHeight: 0.98 });
    const headB = head ? textBlock("headline", head, { y: headY, color: pal.ink, ...(side ? { left: textLeft, width: textW } : { cx: design.w / 2 }) }) : null;
    const pillW = cta ? Math.min(textW, cta.width + cta.size * 2.4) : 0;
    const pillX = side ? (cta?.dir === "rtl" ? textLeft + textW - pillW : textLeft) : design.w / 2 - pillW / 2;
    const ctaB = cta ? textBlock("cta", cta, { y: pillY + (pillH - cta.size * 1.12) / 2, color: pal.highlight.ink, cx: pillX + pillW / 2 }) : null;
    const badgeFill = pal.mark;
    const offerB = offer ? textBlock("offer", offer, { y: bc[1] - offer.height / 2, color: readable(badgeFill, pal.ground, pal.highlight.ink, pal.ink), cx: bc[0] }) : null;

    // The beats, spread over the length: the badge, the product, the headline, the pill.
    const k = spread(c, 1.95, 2.4);
    const lines = head?.lines.length ?? 0;
    const slideAt = 0.5 * k;
    const headAt = 0.95 * k;
    const ctaAt = 1.45 * k + lines * 0.09;
    const events = [
      ...(offer ? [ev("badge", "pop", 0.12, 0.6, "pop"), ev("badge.turn", "enter", 0.12, 0.7, "settle")] : []),
      ev("slide", "enter", slideAt, 0.7, "enter"),
      ev("shadow", "fade", slideAt + 0.2, 0.45, "enter"),
      ...Array.from({ length: lines }, (_, i) => ev(`head.${i}`, "enter", headAt + i * 0.09, 0.55, "glide", { group: "head", unit: "elements" })),
      ...(cta ? [ev("cta", "pop", ctaAt, 0.45, "pop")] : []),
    ];
    const holdFrom = slideAt + 0.75;

    return {
      events,
      overflow: [...(offer?.overflow ? ["offer"] : []), ...(head?.overflow ? ["headline"] : []), ...(cta?.overflow ? ["cta"] : []), ...(name?.overflow ? ["brand"] : [])],
      signature: slideAt + 0.35,
      frame(t, P, Lp) {
        const nodes: DisplayNode[] = [];
        if (headB) nodes.push(...risingLines(headB, (i) => P(`head.${i}`)));
        // The product slides in from the right and lands on its shadow, then floats while it holds.
        const s = P("slide");
        const lin = Lp("slide");
        const fl = holdFloat(t, holdFrom, c.last, S * 0.012, 0.01);
        if (img && hero) {
          const sh = P("shadow");
          // On the brand colour a product in that same colour would lose its edge: a soft pool of lighter ground
          // behind it keeps it apart (it fades in as the product lands).
          if (pal.look === "brand" && hero.src === "product" && lin > 0) {
            const gx = img.x + img.w / 2;
            const gy = img.y + img.h * 0.52;
            const gr = Math.max(img.w, img.h) * 0.62;
            const lift = mixHex(pal.ground, "#ffffff", 0.5);
            const stops = [
              { at: 0, color: withAlpha(lift, 0.55) },
              { at: 0.55, color: withAlpha(lift, 0.25) },
              { at: 1, color: withAlpha(lift, 0) },
            ];
            const sx = Math.min(1, Math.max(0.75, (img.w * 1.5) / gr));
            nodes.push(group([{ type: "ellipse", cx: gx, cy: gy, rx: gr, ry: gr, fill: { kind: "radial", cx: gx, cy: gy, r0: 0, r1: gr, stops } }], { transform: about(gx, gy, sx, 0, 1), ...(lin < 1 && { opacity: lin }) }));
          }
          if (sh > 0 && hero.src === "product") nodes.push(contactShadow(img.x + img.w / 2, img.y + img.h, img.w * 0.85 * (1 + fl.dy / (S * 0.2)), pal.ground, 0.3, sh));
          const pic: DisplayNode = hero.src === "logo" ? logoNode(c, img, pal.ink) : { type: "image", src: hero.src, x: img.x, y: img.y, w: img.w, h: img.h };
          if (lin > 0) nodes.push(group([pic], { transform: multiply(translate((1 - s) * S * 0.7, fl.dy), about(img.x + img.w / 2, img.y + img.h, 1, (1 - s) * 0.12 + fl.roll)), ...(lin < 0.25 && { opacity: lin / 0.25 }) }));
        } else if (nameB && lin > 0) nodes.push(group([lineRuns(nameB)], { transform: translate((1 - s) * S * 0.5, 0), ...(lin < 0.25 && { opacity: lin / 0.25 }) }));
        if (offerB) {
          const b = P("badge");
          const rock = holdFloat(t, 0.9, c.last, 0, 0.05).roll;
          if (Lp("badge") > 0) nodes.push(group([{ type: "path", d: starPath(bc[0], bc[1], bR, bR * 0.86, 20), fill: badgeFill }, lineRuns(offerB)], { transform: about(bc[0], bc[1], Math.max(0, b), 0.14 - 0.65 * (1 - P("badge.turn")) + rock) }));
        }
        if (ctaB && cta) {
          const p = P("cta");
          const l = Lp("cta");
          if (l > 0) {
            const label = Math.min(1, Math.max(0, (l - 0.08) / 0.3));
            const children: DisplayNode[] = [{ type: "rect", x: pillX, y: pillY, w: pillW, h: pillH, r: pillH / 2, fill: pal.highlight.fill }];
            if (label > 0) children.push({ ...lineRuns(ctaB), ...(label < 1 && { opacity: label }) });
            nodes.push(group(children, { transform: about(pillX + pillW / 2, pillY + pillH / 2, 0.6 + 0.4 * p), ...(l < 0.12 && { opacity: l / 0.12 }) }));
          }
        }
        return { nodes };
      },
    };
  },
});
