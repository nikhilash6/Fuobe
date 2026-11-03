/**
 * Five-Star Quote: five stars draw their outlines and fill one by one with a small spring, then the customer's words
 * set line by line, exactly as typed (their own quotation marks, hung in the margin so the letters line up), the name
 * follows under a short rule, and the brand signs off at the foot (its logo, else its name). The whole is centred in
 * the frame, and the beats spread over the clip's length.
 */

import { group, translate, type DisplayNode } from "../../display";
import { lineRuns } from "../end-card/shared";
import { brandMark, ev, marketingScene, MIN_BODY, risingLines, setText, spread, starPath, textBlock } from "./kit";

/** Opening quotation marks that hang into the margin. */
const OPENERS = new Set(["“", '"', "‘", "'", "«", "„", "‹", "「", "『"]);

export default marketingScene({
  id: "marketing/quote",
  name: "Five-Star Quote",
  look: "light",
  build(c) {
    const { S, safe, palette: pal, design } = c;
    const width = c.wide ? Math.min(safe.w, S * 1.4) : safe.w;
    const left0 = (design.w - width) / 2;
    const text = c.field("quote");
    const first = [...text][0] ?? "";
    const mark = brandMark(c, { maxW: S * (c.wide ? 0.32 : 0.46), h: S * (c.tall ? 0.085 : 0.065), color: pal.ink, minName: 0.04 });
    const footH = mark ? mark.h + S * 0.07 : 0;
    // Probe the size first, then hang the opening mark by its own width.
    const size = { weight: 500, maxLines: c.tall ? 8 : 6, max: S * (c.tall ? 0.13 : c.wide ? 0.08 : 0.1), min: S * 0.045, lineHeight: 1.16 };
    const probe = setText(c, text, { ...size, width });
    const hang = probe && probe.dir === "ltr" && OPENERS.has(first) ? c.measure(first, probe.font) : 0;
    const quote = hang ? setText(c, text, { ...size, width: width - hang }) : probe;
    const name = setText(c, c.field("name"), { family: "body", weight: 600, width: width - S * 0.075, maxLines: 2, max: S * (c.tall ? 0.056 : 0.048), min: S * 0.038, lineHeight: 1.25 });
    const star = S * (c.wide ? 0.06 : c.tall ? 0.075 : 0.068);
    const starGap = star * 0.32;
    const g1 = S * 0.06;
    const g2 = S * 0.055;
    const total = star + g1 + (quote?.height ?? 0) + (name ? g2 + name.height : 0);
    const top = safe.y + Math.max(0, (safe.h - footH - total) / 2);
    const quoteLeft = left0 + hang;
    const quoteB = quote ? textBlock("quote", quote, { y: top + star + g1, color: pal.ink, left: quoteLeft, width: width - hang }) : null;
    const nameY = top + star + g1 + (quote?.height ?? 0) + g2;
    // A short rule leads the name (left-to-right names; a right-to-left one is set without it).
    const ruleW = name && name.dir !== "rtl" ? S * 0.05 : 0;
    const nameB = name ? textBlock("name", name, { y: nameY, color: pal.muted, left: left0 + (ruleW ? ruleW + S * 0.025 : 0), width: width - (ruleW ? ruleW + S * 0.025 : 0) }) : null;
    const stars = Array.from({ length: 5 }, (_, i) => ({ cx: left0 + star / 2 + i * (star + starGap), cy: top + star / 2 }));
    const starD = stars.map((s) => starPath(s.cx, s.cy, star / 2, star * 0.21, 5));
    const footY = safe.y + safe.h - (mark?.h ?? 0);

    // The beats, spread over the length: the stars, the words, the name, the sign-off.
    const k = spread(c, 2.4);
    const lines = quote?.lines.length ?? 0;
    const qAt = 0.6 * k;
    const each = Math.max(0.08, Math.min(0.14, 0.11 * k));
    const nameAt = qAt + lines * each + 0.3 * k;
    const events = [
      ev("outline", "fade", 0.08, 0.35, "enter"),
      ...stars.map((_, i) => ev(`star.${i}`, "pop", 0.2 + i * 0.08 * Math.max(1, Math.min(1.5, k)), 0.45, "pop", { group: "stars", unit: "elements" })),
      ...Array.from({ length: lines }, (_, i) => ev(`line.${i}`, "enter", qAt + i * each, 0.6, "glide", { group: "quote", unit: "elements" })),
      ...(name ? [ev("rule", "draw", nameAt - 0.1, 0.45, "draw"), ev("name", "enter", nameAt, 0.5, "glide")] : []),
      ...(mark ? [ev("brand", "enter", nameAt + 0.55 * k, 0.6, "glide")] : []),
    ];
    const outlineW = Math.max(1.5, star * 0.045);

    return {
      events,
      overflow: [...(quote?.overflow ? ["quote"] : []), ...(name?.overflow ? ["name"] : []), ...(mark?.overflow ? ["brand"] : [])],
      signature: 0.2 + 0.18,
      frame(_t, P, Lp) {
        const nodes: DisplayNode[] = [];
        const o = P("outline");
        stars.forEach((s, i) => {
          const f = P(`star.${i}`);
          const l = Lp(`star.${i}`);
          if (o > 0 && f < 1) nodes.push({ type: "path", d: starD[i], stroke: { paint: pal.mark, width: outlineW, join: "round" }, opacity: o });
          if (l > 0) {
            const sc = Math.max(0, 0.4 + 0.6 * f);
            nodes.push(group([{ type: "path", d: starD[i], fill: pal.mark }], { transform: [sc, 0, 0, sc, s.cx - sc * s.cx, s.cy - sc * s.cy], ...(l < 0.2 && { opacity: l / 0.2 }) }));
          }
        });
        if (quoteB) nodes.push(...risingLines(quoteB, (i) => P(`line.${i}`), (i) => (i === 0 ? -hang : 0)));
        if (nameB && name) {
          const r = P("rule");
          const ry = nameY + name.lineHeight / 2;
          if (r > 0 && ruleW) nodes.push({ type: "path", d: `M${left0} ${ry}H${left0 + ruleW}`, stroke: { paint: pal.mark, width: Math.max(1.5, S * 0.003), trim: r, length: ruleW, cap: "round" } });
          const p = P("name");
          if (p > 0) nodes.push(group([lineRuns(nameB)], { transform: translate(0, (1 - p) * S * 0.02), ...(p < 1 && { opacity: p }) }));
        }
        if (mark) nodes.push(...mark.draw(design.w / 2, footY, P("brand"), Lp("brand")));
        return { nodes };
      },
    };
  },
});
