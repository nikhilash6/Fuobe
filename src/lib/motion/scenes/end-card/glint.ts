/**
 * Glint: luxury. The brand colour blooms out from the centre of a deep ground as a wide feathered circle (already
 * glowing on the first frame); the mark fades up and settles and a wide band of
 * light passes slowly across it (on the mark only), the product's name settles its tracking as it appears, and the
 * call-to-action pill draws its outline, then fills with a quick wipe that brings its label.
 */

import { luminance } from "@/components/ads/layout";
import { group, mixHex, roundRectPath, withAlpha, type DisplayNode } from "../../display";
import { linearProgress, progress, type Cue } from "../../tween";
import { blockCentre, deepGround, endCardScene, entering, letterRuns, lineRuns, markBox, markNodes, pillRect, wipe } from "./shared";

const ANGLE = (20 * Math.PI) / 180;

export default endCardScene("glint", ({ rest }) => {
  const { headline, cta, site } = rest;
  const mark = markBox(rest);
  const cues: Cue[] = [{ id: "bloom", kind: "move", at: 0, dur: 0.55, curve: "glide" }];
  if (mark) cues.push({ id: "mark", kind: "enter", at: 0.1, dur: 0.5, curve: "settle" }, { id: "glint", kind: "move", at: 0.45, dur: 0.7, curve: "move" });
  if (headline.layout.lines.length) cues.push({ id: "headline", kind: "enter", at: 0.25, dur: 0.5, curve: "glide" });
  if (cta) cues.push({ id: "cta.outline", kind: "draw", at: 0.42, dur: 0.22, curve: "draw" }, { id: "cta.fill", kind: "move", at: 0.58, dur: 0.3, curve: "snap" });
  if (site) cues.push({ id: "site", kind: "fade", at: 0.55, dur: 0.35, curve: "enter" });
  const ground = deepGround(rest.theme);
  const S = Math.min(rest.w, rest.h);
  // The light: on a light mark a warm white; on a dark brand name a lifted tint of its own colour. A logo on a light
  // ground (its colours unknown, most likely dark) gets no band.
  const lightMark = rest.logo ? luminance(rest.theme.accent) < 0.3 : luminance(rest.ink) > 0.3;
  const sheen = lightMark ? "#fff4dc" : rest.logo ? null : mixHex(rest.ink, "#ffffff", 0.45);
  const sheenAlpha = 0.75;

  return {
    cues,
    lead: 0.06,
    signature: 0.12,
    background: ground,
    frame(t, tl) {
      const P = (id: string) => progress(tl, id, t);
      const under: DisplayNode[] = [];
      const bloom = P("bloom");
      if (bloom > 0) {
        // A feathered circle of the brand colour, grown until it covers the frame.
        const cx = rest.w / 2;
        const cy = rest.h * 0.45;
        const far = Math.hypot(Math.max(cx, rest.w - cx), Math.max(cy, rest.h - cy));
        const r = far * (0.2 + 1.5 * bloom);
        const a = rest.theme.accent;
        under.push({
          type: "rect",
          id: "bloom",
          x: 0,
          y: 0,
          w: rest.w,
          h: rest.h,
          fill: { kind: "radial", cx, cy, r0: 0, r1: r, stops: [{ at: 0, color: a }, { at: 0.62, color: a }, { at: 0.82, color: withAlpha(a, 0.5) }, { at: 1, color: withAlpha(a, 0) }] },
        });
      }
      const nodes: DisplayNode[] = [];
      if (mark) {
        const p = P("mark");
        const seen = Math.min(1, linearProgress(tl, "mark", t) * 2);
        if (seen > 0) {
          const children: DisplayNode[] = [...markNodes(rest)];
          const g = linearProgress(tl, "glint", t);
          if (sheen && g > 0 && g < 1) {
            // A wide band of light at 20°, crossing the mark once, drawn on the mark's own pixels only.
            const dx = Math.cos(ANGLE);
            const dy = Math.sin(ANGLE);
            const reach = mark.w * 0.5 + mark.h * 0.5;
            const band = Math.hypot(mark.w, mark.h) * 0.3;
            const along = -(reach + band) + 2 * (reach + band) * P("glint");
            const gx = mark.x + mark.w / 2 + dx * along;
            const gy = mark.y + mark.h / 2 + dy * along;
            children.push(
              group(
                [
                  {
                    type: "rect",
                    id: "glint",
                    x: mark.x,
                    y: mark.y,
                    w: mark.w,
                    h: mark.h,
                    fill: { kind: "linear", x0: gx - dx * band, y0: gy - dy * band, x1: gx + dx * band, y1: gy + dy * band, stops: [{ at: 0, color: withAlpha(sheen, 0) }, { at: 0.5, color: withAlpha(sheen, sheenAlpha) }, { at: 1, color: withAlpha(sheen, 0) }] },
                  },
                ],
                { blend: "source-atop" },
              ),
            );
          }
          const node = entering(children, { cx: mark.x + mark.w / 2, cy: mark.y + mark.h / 2, dy: (1 - p) * S * 0.05, scale: 0.97 + 0.03 * p, opacity: seen });
          if (node.type === "group" && children.length > 1) node.isolate = { x: mark.x - 4, y: mark.y - 4, w: mark.w + 8, h: mark.h + 8 };
          nodes.push(node);
        }
      }
      if (headline.layout.lines.length) {
        const p = P("headline");
        if (p >= 1) nodes.push(lineRuns(headline));
        else if (p > 0) nodes.push({ ...letterRuns(headline, () => ({}), (1 - p) * 0.06 * headline.layout.size), opacity: p });
      }
      if (cta) {
        const outline = P("cta.outline");
        const fill = P("cta.fill");
        if (fill > 0) nodes.push(wipe([pillRect(cta), lineRuns(cta.label)], cta, fill, cta.h * 0.5));
        if (outline > 0 && fill < 1) {
          const width = S * 0.004;
          const path = roundRectPath(cta.x + width / 2, cta.y + width / 2, cta.w - width, cta.h - width, cta.r - width / 2);
          nodes.push({ type: "path", d: path.d, stroke: { paint: cta.color, width, trim: outline, length: path.length, cap: "round" } });
        }
      }
      if (site) {
        const p = P("site");
        if (p > 0) nodes.push(entering([lineRuns(site)], { ...blockCentre(site), opacity: p }));
      }
      return { under, nodes };
    },
  };
});
