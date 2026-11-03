/**
 * Retro Starburst: 24 rays in two kit colours turn slowly behind the product the whole clip long. The product drops in
 * with a squash and a half turn that springs square onto a disc of light, and then sways and floats while it holds,
 * well inside the disc; an optional sticker badge pops on with a tilt where it covers none of the product; and the
 * headline, set big, lands on a full-width band at the foot that slides in at a slight tilt, so it reads on any ray.
 * Without a product the logo (or the name) takes its place.
 */

import { contrast } from "@/components/ads/layout";
import { about, group, mixHex, multiply, translate, type DisplayNode } from "../../display";
import { lineRuns } from "../end-card/shared";
import { badgeSpot, contactShadow, ev, fitBox, heroOf, holdFloat, logoNode, marketingScene, MIN_BODY, MIN_HEAD, readable, risingLines, setText, spread, starPath, textBlock } from "./kit";

const RAYS = 24;

/** The rays as one path: every other wedge of a full turn, from (cx, cy) out to radius r, turned by `rot`. */
export function raysPath(cx: number, cy: number, r: number, rot: number, n = RAYS): string {
  const parts: string[] = [];
  const step = (Math.PI * 2) / n;
  for (let i = 0; i < n; i += 2) {
    const a = rot + i * step;
    const b = a + step;
    parts.push(`M${cx.toFixed(1)} ${cy.toFixed(1)}L${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}L${(cx + Math.cos(b) * r).toFixed(1)} ${(cy + Math.sin(b) * r).toFixed(1)}Z`);
  }
  return parts.join("");
}

/** The band's tilt (radians): a poster's slant, square enough to read. */
const TILT = -0.035;

export default marketingScene({
  id: "marketing/starburst",
  name: "Retro Starburst",
  look: "brand",
  build(c) {
    const { S, safe, palette: pal, design, recipe } = c;
    const hero = heroOf(c);
    // The headline is the hero type: big, on a band that runs off both edges.
    const head = setText(c, c.field("headline"), { weight: 800, width: safe.w * 0.9, maxLines: 2, max: S * (c.tall ? 0.16 : c.wide ? 0.11 : 0.13), min: S * MIN_HEAD, lineHeight: 1.0 });
    const badge = setText(c, c.field("badge"), { weight: 800, width: S * 0.2, maxLines: 2, max: S * 0.056, min: S * MIN_BODY, lineHeight: 1.0 });
    const bandPad = S * (c.tall ? 0.05 : 0.04);
    const bandH = head ? head.height + bandPad * 2 : 0;
    const gapB = S * 0.06;
    // The disc: as big as the room over the band allows; the product holds inside 70 % of it.
    const roomH = safe.h - (head ? bandH + gapB : 0);
    const R = Math.min(safe.w * 0.5, roomH * 0.5);
    const stackH = 2 * R + (head ? gapB + bandH : 0);
    const top = safe.y + Math.max(0, (safe.h - stackH) / 2);
    const centre: [number, number] = [design.w / 2, top + R];
    const hold = { x: centre[0] - R * 0.7, y: centre[1] - R * 0.7, w: R * 1.4, h: R * 1.4 };
    const img = hero ? fitBox(hero, hold, hero.src === "product") : null;
    const bandY = top + 2 * R + gapB;
    const name = !hero ? setText(c, recipe.brand.name, { weight: 800, width: R * 1.3, maxLines: 2, max: S * 0.13, min: S * MIN_HEAD, lineHeight: 1.04 }) : null;
    const dark = pal.look === "dark";
    // The rays: the brand's second colour over the brand colour (Brand colour); a rich tint of the bolder kit colour on
    // the light and dark looks.
    const rayColour = pal.look === "brand" ? pal.mark : mixHex(pal.ground, pal.mark, pal.look === "light" ? 0.34 : 0.3);
    const apart = (x: string) => Math.min(contrast(x, rayColour), contrast(x, pal.ground));
    const discColour = pal.look === "brand" ? mixHex(pal.ground, "#ffffff", 0.18) : dark ? mixHex(pal.ground, pal.mark, 0.22) : "#ffffff";
    const nameB = name ? textBlock("brand", name, { y: centre[1] - name.height / 2, color: readable(discColour, pal.ink, pal.highlight.fill), cx: centre[0] }) : null;
    // The band stands apart from both the rays and the ground: the highlight, a paper white or a deep shade, whichever
    // does best against the nearer of the two.
    const deepBand = mixHex(pal.ground, "#000000", 0.45);
    const bandFill = [pal.highlight.fill, mixHex("#ffffff", pal.ground, 0.06), deepBand].reduce((best, x) => (apart(x) > apart(best) + 0.2 ? x : best));
    const headB = head ? textBlock("headline", head, { y: bandY + bandPad, color: readable(bandFill, bandFill === pal.highlight.fill ? pal.highlight.ink : pal.ground, pal.ink, pal.mark), cx: design.w / 2 }) : null;
    const reach = Math.hypot(design.w, design.h);
    // The badge: a sticker by the product where it covers none of it.
    const product = hero?.src === "product" ? (c.input.outlines?.product ?? null) : null;
    const spot = img ? badgeSpot(img, product, S * 0.13, { x: safe.x, y: safe.y, w: safe.w, h: bandY - safe.y }) : { cx: centre[0] + R * 0.62, cy: centre[1] - R * 0.62, r: S * 0.12, cover: 0 };
    const bR = spot.r;
    const badgeFill = pal.look === "brand" ? pal.ink : pal.mark;
    const badgeB = badge ? textBlock("badge", badge, { y: spot.cy - badge.height / 2, color: readable(badgeFill, pal.ground, pal.highlight.ink), cx: spot.cx }) : null;

    const k = spread(c, 1.7, 2.4);
    const dropAt = 0.3 * k;
    const bandAt = 1.15 * k;
    const events = [
      ev("rays", "fade", 0, 0.6, "enter"),
      ev("halo", "enter", 0.15 * k, 0.7, "enter"),
      ev("drop", "pop", dropAt, 0.65, "pop"),
      ev("spin", "enter", dropAt, 0.7, "settle"),
      ev("shadow", "fade", dropAt + 0.25, 0.5, "enter"),
      ...(badge ? [ev("badge", "pop", 0.85 * k, 0.55, "pop")] : []),
      ...(head ? [ev("band", "enter", bandAt, 0.6, "snap"), ...head.lines.map((_, i) => ev(`head.${i}`, "enter", bandAt + 0.12 + i * 0.09, 0.55, "glide", { group: "head", unit: "elements" }))] : []),
    ];
    const holdFrom = dropAt + 0.7;
    // The rays turn the whole clip long and stop on the last frame's angle.
    const turn = (t: number) => -0.2 + (Math.min(t, c.last) / Math.max(1, c.last)) * 0.2;

    return {
      events,
      overflow: [...(head?.overflow ? ["headline"] : []), ...(badge?.overflow ? ["badge"] : []), ...(name?.overflow ? ["brand"] : [])],
      signature: dropAt + 0.25,
      frame(t, P, Lp) {
        const r = P("rays");
        const under: DisplayNode[] = [{ type: "path", d: raysPath(centre[0], centre[1], reach, turn(t)), fill: rayColour, ...(r < 1 && { opacity: r }) }];
        const nodes: DisplayNode[] = [];
        const h = P("halo");
        if (h > 0) {
          const hr = R * (0.6 + 0.4 * h);
          nodes.push({ type: "ellipse", cx: centre[0], cy: centre[1], rx: hr, ry: hr, fill: discColour, ...(h < 1 && { opacity: h }) });
        }
        // While it holds: a slow sway and float, still again on the last frame.
        const fl = holdFloat(t, holdFrom, c.last, S * 0.014, 0.045);
        if (img && hero) {
          const sh = P("shadow");
          if (sh > 0 && hero.src === "product") nodes.push(contactShadow(centre[0], img.y + img.h, img.w * 0.8, discColour, 0.4, sh));
          const d = P("drop");
          const lin = Lp("drop");
          if (lin > 0) {
            // Squash on landing: wide and short as it hits, springing back to its shape.
            const over = d - 1;
            const sx = 1 + over * 0.9;
            const sy = 1 - over * 0.9;
            const foot = img.y + img.h;
            const m = multiply(translate(0, -(1 - Math.min(1, d)) * S * 0.45 + fl.dy), multiply(about(centre[0], foot, sx, fl.roll, sy), about(centre[0], img.y + img.h / 2, 0.7 + 0.3 * Math.min(1, d), (1 - P("spin")) * -0.35)));
            const pic: DisplayNode = hero.src === "logo" ? logoNode(c, img, pal.ink) : { type: "image", src: hero.src, x: img.x, y: img.y, w: img.w, h: img.h };
            nodes.push(group([pic], { transform: m, ...(lin < 0.15 && { opacity: lin / 0.15 }) }));
          }
        } else if (nameB) {
          const d = P("drop");
          if (Lp("drop") > 0) nodes.push(group([lineRuns(nameB)], { transform: multiply(translate(0, fl.dy), about(centre[0], centre[1], 0.6 + 0.4 * d, (1 - P("spin")) * -0.5 + fl.roll)) }));
        }
        if (badgeB) {
          const b = P("badge");
          if (Lp("badge") > 0) nodes.push(group([{ type: "path", d: starPath(spot.cx, spot.cy, bR, bR * 0.84, 16), fill: badgeFill }, lineRuns(badgeB)], { transform: about(spot.cx, spot.cy, Math.max(0, b), 0.14 * b - 0.4 * (1 - b)) }));
        }
        if (headB) {
          const band = P("band");
          const lin = Lp("band");
          if (lin > 0) {
            // The band runs off both edges, sliding in from the left; the words rise on it.
            const over = S * 0.2;
            const children: DisplayNode[] = [{ type: "rect", x: -over - (1 - band) * (design.w + over), y: bandY, w: design.w + 2 * over, h: bandH, fill: bandFill }, ...risingLines(headB, (i) => P(`head.${i}`))];
            nodes.push(group(children, { transform: about(design.w / 2, bandY + bandH / 2, 1, TILT) }));
          }
        }
        return { under, nodes };
      },
    };
  },
});
