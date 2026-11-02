/**
 * Split: graphic. Two half panels in a clean two-tone of the kit's second colour part to the sides and reveal the
 * card; the mark grows into place at the seam between them, the product's name cascades in word by word, then a line
 * draws under the call to action and the pill grows up from it, its round ends kept, with its label.
 */

import { group, type DisplayNode } from "../../display";
import { linearProgress, progress, type Cue } from "../../tween";
import { endCardScene, entering, lineRuns, markBox, markNodes, shadeOf, wordRuns } from "./shared";

export default endCardScene("split", ({ rest, second }) => {
  const { headline, cta, site } = rest;
  const mark = markBox(rest);
  const words = headline.layout.lines.reduce((n, l) => n + l.words.length, 0);
  const slots = Math.min(words, 8);
  const cues: Cue[] = [{ id: "panels", kind: "move", at: 0, dur: 0.55, curve: "move" }];
  if (mark) cues.push({ id: "mark", kind: "enter", at: 0.15, dur: 0.5, curve: "settle" });
  for (let s = 0; s < slots; s++) cues.push({ id: `headline.word.${s}`, kind: "enter", at: 0.28 + s * 0.065, dur: 0.45, curve: "glide", stagger: { group: "headline", unit: "words", index: s, each: 0.065 } });
  if (cta) cues.push({ id: "cta.line", kind: "draw", at: 0.48, dur: 0.2, curve: "draw" }, { id: "cta.fill", kind: "move", at: 0.6, dur: 0.3, curve: "snap" });
  if (site) cues.push({ id: "site", kind: "fade", at: 0.55, dur: 0.35, curve: "enter" });
  const left = second;
  const right = shadeOf(second);
  const S = Math.min(rest.w, rest.h);

  return {
    cues,
    lead: 0.05,
    signature: 0.3,
    frame(t, tl) {
      const P = (id: string) => progress(tl, id, t);
      const nodes: DisplayNode[] = [];
      if (mark) {
        const p = P("mark");
        const seen = Math.min(1, linearProgress(tl, "mark", t) * 2);
        if (seen > 0) nodes.push(entering(markNodes(rest), { cx: mark.x + mark.w / 2, cy: mark.y + mark.h / 2, scale: 1.08 - 0.08 * p, opacity: seen }));
      }
      if (words) {
        const em = headline.layout.size;
        if (P(`headline.word.${slots - 1}`) >= 1) nodes.push(lineRuns(headline));
        else
          nodes.push(
            wordRuns(headline, (_l, k, n) => {
              const p = P(`headline.word.${Math.floor((k * slots) / n)}`);
              return { opacity: Math.min(1, p * 1.3), dy: (1 - p) * 0.4 * em };
            }),
          );
      }
      if (cta) {
        const line = P("cta.line");
        const fill = P("cta.fill");
        const base = cta.y + cta.h;
        if (fill > 0) {
          // The pill grows up from its baseline as a pill (round ends kept); its label is revealed with it.
          const h = Math.max(1, cta.h * fill);
          const shape = { x: cta.x, y: base - h, w: cta.w, h, r: Math.min(cta.r, h / 2) };
          const label = Math.min(1, Math.max(0, (linearProgress(tl, "cta.fill", t) - 0.35) / 0.4));
          nodes.push({ type: "rect", id: "cta.pill", ...shape, fill: cta.color });
          if (label > 0) nodes.push(group([lineRuns(cta.label)], { clip: { type: "rect", ...shape }, ...(label < 1 && { opacity: label }) }));
        }
        if (line > 0 && fill < 1) {
          const width = S * 0.004;
          nodes.push({ type: "path", d: `M${cta.x + cta.r * 0.6} ${base - width / 2} H${cta.x + cta.w - cta.r * 0.6}`, stroke: { paint: cta.color, width, trim: line, length: cta.w - cta.r * 1.2, cap: "round" }, opacity: 1 - fill });
        }
      }
      if (site) {
        const p = P("site");
        if (p > 0) nodes.push({ ...lineRuns(site), ...(p < 1 && { opacity: p }) });
      }
      // The panels part on top: they cover the card until they go.
      const open = P("panels");
      const over: DisplayNode[] = [];
      if (open < 1) {
        over.push({ type: "rect", id: "panel.left", x: -open * rest.w * 0.5, y: 0, w: rest.w * 0.5 + (1 - open), h: rest.h, fill: left });
        over.push({ type: "rect", id: "panel.right", x: rest.w * 0.5 + open * rest.w * 0.5, y: 0, w: rest.w * 0.5, h: rest.h, fill: right });
      }
      return { nodes, over };
    },
  };
});
