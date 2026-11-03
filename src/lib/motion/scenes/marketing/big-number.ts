/**
 * Big Number: one stat as big as the frame allows, edge to edge, rolling up figure by figure to the value the person
 * typed (tabular cells, their own separators and signs, in lining figures); the caption rises under it, and the piece
 * ends on the logo (or the brand's name) settling in at the foot. The beats spread over the clip's length.
 */

import { about, group, type DisplayNode } from "../../display";
import { brandMark, centreFigures, counterLayout, counterNode, ev, figureFamily, marketingScene, risingLines, setText, spread, textBlock } from "./kit";

export default marketingScene({
  id: "marketing/big-number",
  name: "Big Number",
  look: "brand",
  build(c) {
    const { S, safe, palette: pal, design } = c;
    const markH = S * (c.wide ? 0.085 : 0.08);
    const mark = brandMark(c, { maxW: S * 0.5, h: markH, color: pal.ink, minName: 0.04 });
    const footH = mark?.h ?? 0;
    const room = safe.h - (footH ? footH + S * 0.06 : 0);
    const stat = centreFigures(counterLayout("stat", c.field("stat", "0"), figureFamily(c, 800), 800, safe.w, Math.min(S * 0.8, room * 0.58), S * 0.1, c.measure), c.measure);
    const caption = setText(c, c.field("caption"), { weight: 700, width: Math.min(safe.w, S * 1.3), maxLines: 3, max: S * 0.075, min: S * 0.05, lineHeight: 1.12 });
    const statH = stat.size * 1.0;
    const gap = S * 0.04;
    const stackH = statH + (caption ? gap + caption.height : 0);
    const top = safe.y + Math.max(0, (room - stackH) / 2);
    const statLeft = (design.w - stat.width) / 2;
    // The figures' glyphs sit a little low in their line box: lift them so the stack is optically centred.
    const statTop = top - stat.size * 0.06;
    const capB = caption ? textBlock("caption", caption, { y: top + statH + gap, color: pal.ink, cx: design.w / 2 }) : null;
    const footY = safe.y + safe.h - footH;

    // Three beats over the clip: the count, the caption, the sign-off.
    const k = spread(c, 1.8, 2.4);
    const lines = caption?.lines.length ?? 0;
    const events = [
      ev("count", "move", 0.12, Math.min(2.4, 1.45 * k), "linear"),
      ev("stat.in", "enter", 0.1, 0.7, "settle"),
      ...Array.from({ length: lines }, (_, i) => ev(`cap.${i}`, "enter", 0.9 * k + i * 0.09, 0.55, "glide", { group: "caption", unit: "elements" })),
      ...(mark ? [ev("mark", "enter", 1.5 * k, 0.6, "settle")] : []),
    ];

    return {
      events,
      overflow: [...(stat.overflow ? ["stat"] : []), ...(caption?.overflow ? ["caption"] : []), ...(mark?.overflow ? ["brand"] : [])],
      signature: 0.12 + 0.6 * k,
      frame(_t, P, Lp) {
        const nodes: DisplayNode[] = [];
        const lin = Lp("stat.in");
        if (lin > 0) {
          const s = 1.08 - 0.08 * P("stat.in");
          nodes.push(group([counterNode(stat, statLeft, statTop, pal.ink, Lp("count"))], { transform: about(design.w / 2, statTop + stat.size / 2, s), ...(lin < 0.25 && { opacity: lin / 0.25 }) }));
        }
        if (capB) nodes.push(...risingLines(capB, (i) => P(`cap.${i}`)));
        if (mark) nodes.push(...mark.draw(design.w / 2, footY, P("mark"), Lp("mark")));
        return { nodes };
      },
    };
  },
});
