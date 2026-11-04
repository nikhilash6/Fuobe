/**
 * Iris: cinematic. A circle of the brand colour opens from the centre over the kit's second colour (already open a
 * quarter on the first frame, with a fine rim in the words' colour on a deep ground); the mark comes into focus as it
 * settles to size, the product's name tightens its letter-spacing as it appears, the address fades in and the
 * call-to-action pill pops last.
 */

import { about, group, withAlpha, type DisplayNode } from "../../display";
import { linearProgress, progress, type Cue } from "../../tween";
import { blockCentre, deepGround, endCardScene, entering, letterRuns, lineRuns, markBox, markNodes, openingGround, pillRect, keepFor } from "./shared";

export default endCardScene("iris", ({ rest, second }) => {
  const { headline, cta, site } = rest;
  const mark = markBox(rest);
  const cues: Cue[] = [{ id: "iris", kind: "move", at: 0, dur: 0.45, curve: "glide" }];
  if (mark) cues.push({ id: "mark", kind: "enter", at: 0.15, dur: 0.5, curve: "settle" });
  if (headline.layout.lines.length) cues.push({ id: "headline", kind: "enter", at: 0.3, dur: 0.5, curve: "glide" });
  if (site) cues.push({ id: "site", kind: "fade", at: 0.5, dur: 0.35, curve: "enter" });
  if (cta) cues.push({ id: "cta", kind: "pop", at: 0.5, dur: 0.4, curve: "pop" });
  // It opens out of the deep shade of the brand colour (never a flat second colour in the corners).
  const ground = deepGround(rest.theme);
  void openingGround;
  void second;
  // On a deep ground a fine rim in the words' colour draws the circle's edge.
  const rim = rest.ink;
  const S = Math.min(rest.w, rest.h);

  return {
    cues,
    keep: keepFor("iris", rest),
    lead: 0.06,
    signature: 0.14,
    background: ground,
    frame(t, tl) {
      const P = (id: string) => progress(tl, id, t);
      const under: DisplayNode[] = [];
      // It opens past the corners with a wide feathered edge (no hard wedge in a corner).
      const feather = S * 0.04;
      const R = Math.hypot(rest.w / 2, rest.h / 2) + feather;
      const open = P("iris");
      const r = open * R;
      if (r > 0.5) {
        // A soft edge a few units wide.
        const edge = Math.max(0, (r - feather) / r);
        under.push({
          type: "ellipse",
          id: "iris",
          cx: rest.w / 2,
          cy: rest.h / 2,
          rx: r,
          ry: r,
          fill: { kind: "radial", cx: rest.w / 2, cy: rest.h / 2, r0: 0, r1: r, stops: [{ at: 0, color: rest.theme.accent }, { at: edge, color: rest.theme.accent }, { at: 1, color: withAlpha(rest.theme.accent, 0) }] },
          ...(rim && open < 1 && { stroke: { paint: withAlpha(rim, 0.9 * (1 - open * open)), width: S * 0.006 } }),
        });
      }
      const nodes: DisplayNode[] = [];
      if (mark) {
        const p = P("mark");
        const seen = Math.min(1, linearProgress(tl, "mark", t) * 2.5);
        if (seen > 0) nodes.push(entering(markNodes(rest), { cx: mark.x + mark.w / 2, cy: mark.y + mark.h / 2, scale: 0.9 + 0.1 * p, opacity: seen, blur: (1 - Math.min(1, p)) * 9 }));
      }
      if (headline.layout.lines.length) {
        const p = P("headline");
        // Letter by letter while the spacing tightens; whole lines once it is home (the letters sit exactly there).
        if (p >= 1) nodes.push(lineRuns(headline));
        else if (p > 0) nodes.push({ ...letterRuns(headline, () => ({}), (1 - p) * 0.12 * headline.layout.size), opacity: p });
      }
      if (site) {
        const p = P("site");
        if (p > 0) nodes.push(entering([lineRuns(site)], { ...blockCentre(site), opacity: p }));
      }
      if (cta) {
        const p = P("cta");
        const seen = Math.min(1, linearProgress(tl, "cta", t) * 6);
        if (seen > 0) nodes.push(group([pillRect(cta), lineRuns(cta.label)], { transform: about(cta.x + cta.w / 2, cta.y + cta.h / 2, 0.7 + 0.3 * p), ...(seen < 1 && { opacity: seen }) }));
      }
      return { under, nodes };
    },
  };
});
