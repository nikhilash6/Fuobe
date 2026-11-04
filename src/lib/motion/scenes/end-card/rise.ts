/**
 * Rise: bold and fast. The brand colour sweeps up from the bottom as a panel over the kit's second colour (already on
 * its way on the first frame), then the mark, the product's name and the call to action rise into place one after
 * another, the pill with a short pop, and the card drifts in on a slow push.
 */

import { about, group, multiply, translate, type DisplayNode } from "../../display";
import { progress, type Cue } from "../../tween";
import { blockCentre, deepGround, endCardScene, entering, lineRuns, markBox, markNodes, pillRect, keepFor } from "./shared";

export default endCardScene("rise", ({ rest }) => {
  const { headline, cta, site } = rest;
  const mark = markBox(rest);
  const items = [mark && "mark", headline.layout.lines.length && "headline", cta && "cta"].filter(Boolean) as string[];
  const cues: Cue[] = [{ id: "panel", kind: "move", at: 0, dur: 0.45, curve: "snap" }];
  items.forEach((id, i) => cues.push({ id, kind: "enter", at: 0.18 + i * 0.11, dur: 0.5, curve: "glide", stagger: { group: "blocks", unit: "elements", index: i, each: 0.11 } }));
  if (cta) cues.push({ id: "cta.pop", kind: "pop", at: 0.18 + (items.length - 1) * 0.11, dur: 0.5, curve: "pop" });
  if (site) cues.push({ id: "site", kind: "enter", at: 0.5, dur: 0.35, curve: "glide" });
  const S = Math.min(rest.w, rest.h);

  return {
    cues,
    keep: keepFor("rise", rest),
    // The panel is about a quarter of the way up on the first frame.
    lead: 0.055,
    signature: 0.075,
    // It rises out of the brand colour's own deep shade (no band of a second colour across the top).
    background: deepGround(rest.theme),
    frame(t, tl) {
      const P = (id: string) => progress(tl, id, t);
      const lift = S * 0.1;
      const panel = P("panel");
      const under: DisplayNode[] = panel > 0 ? [{ type: "rect", id: "panel", x: 0, y: rest.h * (1 - panel), w: rest.w, h: rest.h * panel + 1, fill: rest.theme.accent }] : [];
      const nodes: DisplayNode[] = [];
      const rise = (id: string, children: DisplayNode[], c: { cx: number; cy: number }) => {
        const p = P(id);
        if (p > 0) nodes.push(entering(children, { ...c, dy: (1 - p) * lift, opacity: Math.min(1, p * 1.6) }));
      };
      if (mark) rise("mark", markNodes(rest), { cx: mark.x + mark.w / 2, cy: mark.y + mark.h / 2 });
      if (headline.layout.lines.length) rise("headline", [lineRuns(headline)], blockCentre(headline));
      if (cta) {
        const s = 0.9 + 0.1 * P("cta.pop");
        const p = P("cta");
        if (p > 0) nodes.push(group([pillRect(cta), lineRuns(cta.label)], { transform: multiply(translate(0, (1 - p) * lift), about(cta.x + cta.w / 2, cta.y + cta.h / 2, s)), ...(p < 1 / 1.6 && { opacity: p * 1.6 }) }));
      }
      if (site) rise("site", [lineRuns(site)], blockCentre(site));
      return { under, nodes };
    },
  };
});
