/**
 * Feature Cards: the headline rises, then up to three rounded cards fly in from near the camera (bigger, tilted, from
 * below) and settle into a stack, one beat apart, each ticking its check as it lands; the headline drifts less than the
 * cards, so the stack reads in depth, and the camera keeps a slow drift the whole clip long. The brand signs off at the
 * foot (its logo, else its name). Each card carries one benefit, set exactly as typed, its lines kept even. A tall frame
 * stacks them, bigger, and centres the whole; a wide one sets them side by side.
 */

import { about, group, multiply, translate, type DisplayNode } from "../../display";
import { lineRuns } from "../end-card/shared";
import { brandMark, ev, marketingScene, MIN_BODY, MIN_HEAD, risingLines, setText, shadowOf, spread, textBlock } from "./kit";
import type { TextLayout } from "../../layout";

export const FEATURE_FIELDS = ["point1", "point2", "point3"] as const;

export default marketingScene({
  id: "marketing/feature-cards",
  name: "Feature Cards",
  look: "light",
  build(c) {
    const { S, safe, palette: pal, design } = c;
    const row = c.wide;
    // A tall frame has room to spare: everything a size up.
    // Set at a scale (a tall frame has room to spare: everything a size up), then a step down while the whole does not
    // fit over the sign-off.
    const points = FEATURE_FIELDS.map((f) => ({ field: f, text: c.field(f) })).filter((p) => p.text);
    const set = (g: number) => {
      const head = setText(c, c.field("headline"), { weight: 800, width: row ? Math.min(safe.w, S * 1.4) : safe.w, maxLines: c.tall ? 3 : 2, max: S * (row ? 0.085 : 0.1 * g), min: S * MIN_HEAD, lineHeight: 1.06 });
      // The brand signs the stack off at the foot.
      const mark = brandMark(c, { maxW: S * (row ? 0.36 : 0.52), h: S * (row ? 0.07 : 0.08 * g), color: pal.ink, minName: 0.04 });
      const footH = mark ? mark.h + S * 0.055 : 0;
      const pad = S * 0.042 * g;
      const badge = S * 0.074 * g;
      const gap = S * (row ? 0.032 : 0.03 * g);
      const cardW = row ? (safe.w - gap * (Math.max(1, points.length) - 1)) / Math.max(1, points.length) : Math.min(safe.w, S * 0.96);
      const textW = row ? cardW - 2 * pad : cardW - 3 * pad - badge;
      const texts: { field: string; L: TextLayout | null }[] = points.map((p) => ({ field: p.field, L: setText(c, p.text, { family: "body", weight: 700, width: textW, maxLines: row ? 4 : 2, max: S * 0.05 * g, min: S * MIN_BODY, lineHeight: 1.22 }) }));
      const textHs = texts.map((t) => t.L?.height ?? 0);
      const cardH = row ? badge + pad * 0.7 + Math.max(0, ...textHs) + 2 * pad : 0;
      const heights = texts.map((_, i) => (row ? cardH : Math.max(badge, textHs[i]) + 2 * pad));
      const stackH = row ? cardH : heights.reduce((s, h) => s + h, 0) + gap * Math.max(0, heights.length - 1);
      const headGap = S * 0.07 * g;
      const total = (head ? head.height + headGap : 0) + stackH;
      return { g, head, mark, footH, pad, badge, gap, cardW, textW, texts, cardH, heights, headGap, total };
    };
    let L = set(c.tall ? 1.22 : 1);
    for (let i = 0; i < 4 && L.total + L.footH > safe.h; i++) L = set(L.g * 0.9);
    const { head, mark, footH, pad, badge, gap, cardW, textW, texts, cardH, heights, headGap, total, g } = L;
    // Centred in what the sign-off leaves.
    const top = safe.y + Math.max(0, (safe.h - footH - total) / 2);
    const footY = safe.y + safe.h - (mark?.h ?? 0);
    const headB = head ? textBlock("headline", head, { y: top, color: pal.ink, cx: design.w / 2 }) : null;
    let y = top + (head ? head.height + headGap : 0);
    const left0 = row ? safe.x : (design.w - cardW) / 2;
    const cards = texts.map((t, i) => {
      const box = row ? { x: left0 + i * (cardW + gap), y, w: cardW, h: cardH } : { x: left0, y, w: cardW, h: heights[i] };
      if (!row) y += heights[i] + gap;
      const bx = box.x + pad + badge / 2;
      const by = row ? box.y + pad + badge / 2 : box.y + box.h / 2;
      const tx = row ? box.x + pad : box.x + 2 * pad + badge;
      const ty = row ? box.y + pad + badge + pad * 0.7 : box.y + (box.h - (t.L?.height ?? 0)) / 2;
      const block = t.L ? textBlock(t.field, t.L, { y: ty, color: pal.surfaceInk, left: tx, width: textW }) : null;
      return { box, badge: { cx: bx, cy: by, r: badge / 2 }, block };
    });

    // The beats, spread over the length: the headline, the cards one by one, the sign-off.
    const k = spread(c, 2.6);
    const lines = head?.lines.length ?? 0;
    const cardAt = 0.15 + (lines ? 0.35 + lines * 0.09 : 0) * k;
    const fly = 0.62;
    const each = Math.min(0.45, 0.14 * k * k);
    const landed = cardAt + each * Math.max(0, cards.length - 1) + fly;
    const events = [
      ...Array.from({ length: lines }, (_, i) => ev(`head.${i}`, "enter", 0.15 + i * 0.09, 0.55, "glide", { group: "head", unit: "elements" })),
      ...cards.map((_, i) => ev(`card.${i}`, "enter", cardAt + i * each, fly, "enter")),
      ...cards.map((_, i) => ev(`check.${i}`, "draw", cardAt + i * each + fly * 0.7, 0.35, "draw")),
      ev("pan", "camera", 0, c.last, "drift"),
      ...(mark ? [ev("brand", "enter", landed + 0.25 * k, 0.6, "glide")] : []),
    ];
    const tilt = (i: number) => (i % 2 ? 0.07 : -0.08);
    const shadow = shadowOf(pal.ground, pal.look === "light" ? 0.1 : 0.32);
    const radius = S * 0.034 * g;

    return {
      events,
      overflow: [...(head?.overflow ? ["headline"] : []), ...(mark?.overflow ? ["brand"] : []), ...texts.filter((t) => t.L?.overflow).map((t) => t.field)],
      signature: cardAt + each + fly * 0.45,
      frame(_t, P, Lp) {
        // The slow drift: the cards travel a little farther than the headline (depth), home on the last frame.
        const pan = (1 - P("pan")) * S * 0.05;
        const nodes: DisplayNode[] = [];
        if (headB) nodes.push(group(risingLines(headB, (i) => P(`head.${i}`)), { transform: translate(pan * 0.35, 0) }));
        cards.forEach((card, i) => {
          const q = P(`card.${i}`);
          const lin = Lp(`card.${i}`);
          if (lin <= 0) return;
          const { box } = card;
          const ccx = box.x + box.w / 2;
          const ccy = box.y + box.h / 2;
          const u = 1 - q;
          // From near the camera: bigger, tilted, from below (beside, on a wide frame), then down into the stack.
          const m = multiply(translate(pan + (row ? 0 : u * S * 0.05 * (i % 2 ? 1 : -1)), u * S * (row ? 0.22 : 0.3)), about(ccx, ccy, 1 + 0.16 * u, tilt(i) * u));
          const check = P(`check.${i}`);
          const r = card.badge.r;
          const children: DisplayNode[] = [
            { type: "rect", x: box.x, y: box.y + S * 0.014 + u * S * 0.02, w: box.w, h: box.h, r: radius, fill: shadow },
            { type: "rect", x: box.x, y: box.y, w: box.w, h: box.h, r: radius, fill: pal.surface },
            { type: "ellipse", cx: card.badge.cx, cy: card.badge.cy, rx: r, ry: r, fill: pal.highlight.fill },
          ];
          if (check > 0) {
            const d = `M${card.badge.cx - r * 0.42} ${card.badge.cy + r * 0.02}L${card.badge.cx - r * 0.1} ${card.badge.cy + r * 0.34}L${card.badge.cx + r * 0.45} ${card.badge.cy - r * 0.3}`;
            children.push({ type: "path", d, stroke: { paint: pal.highlight.ink, width: r * 0.2, trim: check, length: r * 1.3, cap: "round", join: "round" } });
          }
          if (card.block) children.push(lineRuns(card.block));
          nodes.push(group(children, { transform: m, ...(lin < 0.3 && { opacity: lin / 0.3 }) }));
        });
        if (mark) nodes.push(...mark.draw(design.w / 2, footY, P("brand"), Lp("brand")));
        return { nodes };
      },
    };
  },
});
