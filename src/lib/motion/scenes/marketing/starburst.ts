/**
 * Retro Starburst: a collage poster. On bright paper, rays in a blush tint of the brand turn steadily round a point
 * behind the product and a halftone of the brand's colour fades in from the far corner (never under the brand). The
 * headline pops in word by word as a justified stack in a chunky display face with a solid extruded side in a deep
 * tone of its own ink. The product drops in front of the words on its own shadow, a squiggle draws under the last
 * line with one sparkle at its start, and the badge lands as a sticker with a white keyline, a little off true,
 * wiggling once in the hold. The brand, the address, a corner note and an index arrow sit on the corners.
 */

import { group, type DisplayNode } from "../../display";
import { ensureContrast, mixOk, toLab, withLightness } from "../../color";
import { extrude, floorShadow } from "../../fx/depth";
import { halftone, keyline, rotation, squiggle } from "../../fx/overlays";
import { badgeSpot, fitBox, logoNode, starPath } from "./kit";
import { brandSign, capBand, fitLines, footRow, litField, metaInk, moveLines, posterScene, signIn, signNodes, stackLanded, toneOf, topSite } from "./poster";

/** Rays round (cx, cy): `n` wedges out to radius R, turned by `a` radians. */
function rays(cx: number, cy: number, R: number, n: number, a: number): string {
  let d = "";
  for (let i = 0; i < n; i++) {
    const a0 = a + (i * 2 * Math.PI) / n;
    const a1 = a0 + Math.PI / n;
    d += `M${cx.toFixed(1)} ${cy.toFixed(1)}L${(cx + Math.cos(a0) * R).toFixed(1)} ${(cy + Math.sin(a0) * R).toFixed(1)}L${(cx + Math.cos(a1) * R).toFixed(1)} ${(cy + Math.sin(a1) * R).toFixed(1)}Z`;
  }
  return d;
}

export default posterScene({
  id: "marketing/starburst",
  name: "Retro Starburst",
  pairing: "T8",
  look: "brand",
  build(c) {
    const { S, safe, pal, design } = c;
    const side = c.wide;
    const prod = c.recipe.media?.product ? c.input.images?.product : undefined;
    const outline = prod ? (c.input.outlines?.product ?? null) : null;
    const signH = S * (c.cover ? 0.056 : 0.044);
    const sign = brandSign(c, { maxW: S * 0.34, h: signH, x: safe.x, y: safe.y, min: S * (c.cover ? 0.056 : 0.03) });
    const metaSize = S * (c.cover ? 0.024 : 0.02);
    const site = topSite(c, sign, metaSize);
    const row = footRow(c, 2.4);
    const footH = metaSize * 1.1 + S * 0.05;
    const headTop = safe.y + (sign?.h ?? 0) + S * 0.05;
    const headW = side ? safe.w * 0.56 : safe.w;
    const head = fitLines(c, "headline", c.field("headline"), { x: safe.x, top: headTop, room: side ? safe.h * 0.8 : (safe.y + safe.h - headTop) * 0.5, anchor: 0, width: headW, maxLines: 3, max: S * (side ? 0.17 : 0.2), min: S * 0.08, preset: "pop-in", leading: 0.92, fill: 0.95, ratio: 1.35, gap: 0.24, wordSpace: 0.3, stack: true });
    const headB = head ? head.band : { x: safe.x, y: headTop, w: 0, h: 0 };
    // The product: under the words (beside them on a wide frame), standing on the safe area's foot, never over a letter.
    const prodTop = headB.y + headB.h + S * 0.07;
    const box = side ? { x: safe.x + safe.w * 0.56, y: safe.y, w: safe.w * 0.44, h: safe.h - footH } : { x: safe.x + safe.w * 0.08, y: prodTop, w: safe.w * 0.9, h: safe.y + safe.h - footH - prodTop };
    const img = prod ? fitBox(prod, box, true) : c.input.logo ? fitBox(c.input.logo, { ...box, y: box.y + box.h * 0.5, h: box.h * 0.35 }) : null;
    const bR = S * (c.cover ? 0.12 : 0.1);
    const lowBounds = side ? { x: safe.x, y: headB.y + headB.h + S * 0.02, w: safe.w * 0.56, h: safe.y + safe.h - (headB.y + headB.h + S * 0.02) } : { x: safe.x, y: headB.y + headB.h + S * 0.02, w: safe.w, h: safe.y + safe.h - (headB.y + headB.h + S * 0.02) };
    const spot = img ? badgeSpot(img, outline, bR, lowBounds.h > bR * 2 ? lowBounds : { x: safe.x, y: safe.y, w: safe.w, h: safe.h }, 0.5) : { cx: safe.x + safe.w - bR, cy: safe.y + safe.h - bR, r: bR, cover: 0 };
    const badge = c.set("badge", c.field("badge"), { role: "accent", x: spot.cx - spot.r * 0.75, y: 0, width: spot.r * 1.5, maxLines: 2, max: spot.r * 0.62, min: S * 0.035, align: "centre", preset: "pop-in" });
    const badgeSet = badge ? c.set("badge", c.field("badge"), { role: "accent", x: spot.cx - spot.r * 0.75, y: spot.cy - capBand(badge).h / 2, width: spot.r * 1.5, maxLines: 2, max: badge.size, min: badge.size, align: "centre", preset: "pop-in" }) : null;

    const k = c.spread(3.2, 1.6);
    // The words cut up line by line; the one stomp is the sticker's.
    const headPlans = head ? moveLines(c, head, { in: "pop-in", at: 0.03, hero: true }, "headline", 0.14) : [];
    const headDone = headPlans.length ? stackLanded(headPlans) : 0.8;
    c.ev("halftone", "fade", 0, 1.2, "glide");
    c.ev("product", "hero", headDone - 0.15, 0.85, "settle");
    c.ev("squiggle", "draw", headDone + 0.2 * k, 0.55, "draw");
    c.ev("sticker", "pop", headDone + 0.45 * k, 0.65, "land");
    const badgePlan = badgeSet ? c.move(badgeSet, { in: "pop-in", at: headDone + 0.55 * k }) : null;
    const signPlan = signIn(c, sign, "brand", 0.2);
    const sitePlan = site ? c.move(site, { in: "fade-rise", at: 0.35, rate: 26 }) : null;
    const wiggleAt = Math.min(c.last - 1.6, (badgePlan?.settled ?? headDone + 0.8) + 0.6);
    c.ev("wiggle", "move", wiggleAt, 0.8, "linear");

    const rayCx = img ? img.x + img.w / 2 : design.w / 2;
    const rayCy = img ? img.y + img.h * 0.45 : design.h / 2;
    const R = Math.hypot(design.w, design.h);
    // Rays in a blush tint of the brand (never grey); the extruded side a deep tone of the words' own ink.
    const rayFill = c.dark ? toneOf(pal, 0.14) : mixOk(pal.paper, pal.brand[0], 0.16);
    const side3d = withLightness(pal.ink, Math.min(0.32, toLab(pal.ink).L * 0.62));
    const stickerFill = pal.accent;
    const stickerInk = ensureContrast(withLightness(pal.ink, 0.28), stickerFill, 4.5);

    return {
      overflow: [...(head?.overflow ? ["headline"] : []), ...(badgeSet?.overflow ? ["badge"] : []), ...(sign?.overflow ? ["brand"] : []), ...(site?.overflow ? ["website"] : []), ...row.overflow],
      signature: headDone + 0.6,
      camera: (t) => ({ x: 0, y: 14 * (1 - Math.min(1, t / c.last)) ** 2 }),
      draw(t, kit) {
        // The rays turn a steady 8° a second.
        const turn = t * ((8 * Math.PI) / 180);
        const field: DisplayNode[] = c.dark ? [{ type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: { kind: "radial", cx: rayCx, cy: rayCy, r0: 0, r1: R * 0.7, stops: [{ at: 0, color: mixOk(pal.ground, pal.accent, 0.12) }, { at: 1, color: mixOk(pal.ground, "#000000", 0.18) }] } }] : litField(c, t, { from: "tl" });
        const atmosphere: DisplayNode[] = [group([{ type: "path", d: rays(rayCx, rayCy, R, 18, turn), fill: rayFill }], { opacity: 0.6 })];
        const texture: DisplayNode[] = [];
        const hp = kit.P("halftone");
        if (hp > 0) texture.push(group([halftone({ box: { x: design.w * 0.2, y: design.h * 0.4, w: design.w * 0.8, h: design.h * 0.6 }, spacing: S * 0.026, angle: 45, origin: [design.w, design.h], reach: S * 0.75, color: pal.brand[0], alpha: 0.18, key: `sb|${design.w}x${design.h}|${pal.brand[0]}` })], { opacity: hp }));
        const hero: DisplayNode[] = [];
        if (head) {
          head.sets.forEach((s, i) => {
            const words = kit.type(headPlans[i], { fill: pal.ink });
            if (t >= headPlans[i].settled) {
              const face = words.find((n) => n.type === "text");
              if (face && face.type === "text") hero.push(extrude({ face, color: side3d, depth: 12, step: Math.max(1, s.size * 0.01), angle: 45, key: `sb|${s.text}|${s.size}`, bounds: capBand(s) }));
            }
            hero.push(...words);
          });
        }
        const subject: DisplayNode[] = [];
        const pl = kit.L("product");
        if (img && pl > 0) {
          const p = kit.P("product");
          // It slides in from the right with a small turn that settles, fully there from its first frame.
          const dx = (1 - p) * S * 0.3;
          const turnIn = rotation((1 - p) * 4, img.x + img.w / 2, img.y + img.h);
          const pic: DisplayNode = prod ? { type: "image", src: "product", ...img } : logoNode(c, img, pal.ink);
          // A cut-out sticker: a paper keyline round the product and its shadow on the ground.
          const kw = Math.max(5, S * 0.007);
          const kb = { x: img.x - kw * 2, y: img.y - kw * 2, w: img.w + kw * 4, h: img.h + kw * 4 };
          // The keyline: the cut-out stamped round itself in a ring, filled with paper (drawn once and reused).
          const ring = Array.from({ length: 12 }, (_, i): DisplayNode => ({ type: "image", src: "product", decor: true, x: img.x + Math.cos((i * Math.PI) / 6) * kw, y: img.y + Math.sin((i * Math.PI) / 6) * kw, w: img.w, h: img.h }));
          const cut: DisplayNode[] = prod ? [group([...ring, group([{ type: "rect", ...kb, fill: pal.paper }], { blend: "source-atop" })], { isolate: kb, cache: { key: `sb-key|${img.w.toFixed(0)}x${img.h.toFixed(0)}|${pal.paper}`, bounds: kb } }), pic] : [pic];
          subject.push(floorShadow({ cx: img.x + img.w / 2, y: img.y + img.h, width: img.w * 0.9, ground: pal.ground, strength: 0.5 * Math.min(1, pl * 2), key: `sb|${img.w.toFixed(0)}` }), group(cut, { transform: [turnIn[0], turnIn[1], turnIn[2], turnIn[3], turnIn[4] + dx, turnIn[5]] }));
        }
        const overlay: DisplayNode[] = [];
        const sq = kit.P("squiggle");
        if (sq > 0 && head) {
          const ls = head.sets[head.sets.length - 1];
          const last = ls.lines[0];
          // From the line's first letter to its last, 0.12 em clear of the extruded side's lowest point; one sparkle at its start.
          const sy = last.baseline + ls.size * 0.12 * 2 + ls.size * 0.06;
          // It runs to the headline's right edge (one device: no sparkle).
          overlay.push(squiggle({ x: last.ink.x, y: sy, w: headB.x + headB.w - last.ink.x, amp: ls.size * 0.06, seed: c.seed, color: pal.accent, width: Math.max(3, ls.size * 0.035), p: sq }));
        }
        const sl = kit.L("sticker");
        if (sl > 0) {
          const sp = kit.P("sticker");
          const disc: DisplayNode = { type: "path", d: starPath(spot.cx, spot.cy, spot.r, spot.r * 0.86, 14), fill: stickerFill };
          const content: DisplayNode[] = badgePlan ? kit.type(badgePlan, { fill: stickerInk }) : [];
          // A wiggle in the hold (±4°, back to true).
          const wl = kit.L("wiggle");
          const wig = wl > 0 && wl < 1 ? 4 * Math.sin(wl * Math.PI * 3) * (1 - wl) : 0;
          const sticker = group([group(keyline([disc], Math.max(4, S * 0.007))), disc, ...content], { transform: rotation(-8 + (1 - sp) * 25 + wig, spot.cx, spot.cy) });
          overlay.push(group([sticker], { transform: [sp, 0, 0, sp, spot.cx - sp * spot.cx, spot.cy - sp * spot.cy] }));
        }
        const meta = [...signNodes(c, kit, sign, signPlan, "brand", safe.x, safe.y, pal.ink), ...(sitePlan ? kit.type(sitePlan, { fill: metaInk(pal), caret: pal.accent }) : []), ...row.draw(kit, metaInk(pal), pal.ink)];
        return [
          { role: "ground", nodes: field },
          { role: "atmosphere", nodes: atmosphere },
          { role: "texture", nodes: texture },
          { role: "hero", nodes: hero },
          { role: "subject", nodes: subject },
          { role: "overlay", nodes: overlay },
          { role: "meta", nodes: meta },
        ];
      },
    };
  },
});
