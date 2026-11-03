/**
 * Dashboard Zoom: a designed dashboard panel rises, its grid fades up, the bars grow one by one, a trend line draws over
 * them and its last point pops, while the key number rolls up to the value the person typed (figure by figure, in
 * tabular cells, with their own separators) and the camera pushes in from a slight angle to rest square on the panel.
 * The panel carries the brand (its logo, else its name) in its header, and the number is set in lining figures (a face
 * whose default figures are old-style hands the number to the body face). The beats spread over the clip's length, and
 * the push runs the whole clip long. The last frame shows the typed number exactly.
 */

import { about, group, multiply, translate, withAlpha, mixHex, type DisplayNode } from "../../display";
import { rngRange } from "../../random";
import { lineRuns } from "../end-card/shared";
import { centreFigures, counterLayout, counterNode, ev, figureFamily, logoNode, marketingScene, MIN_BODY, readable, setText, shadowOf, spread, textBlock } from "./kit";

/** An open smooth curve through points (Catmull–Rom as cubic Béziers), and its length. */
export function smoothOpenPath(pts: [number, number][]): { d: string; length: number } {
  const n = pts.length;
  const parts = [`M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`];
  let length = 0;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    parts.push(`C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`);
    let px = p1[0];
    let py = p1[1];
    for (let k = 1; k <= 10; k++) {
      const t = k / 10;
      const u = 1 - t;
      const x = u * u * u * p1[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p2[0];
      const y = u * u * u * p1[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p2[1];
      length += Math.hypot(x - px, y - py);
      px = x;
      py = y;
    }
  }
  return { d: parts.join(""), length };
}

const BARS = 12;

export default marketingScene({
  id: "marketing/stat-dashboard",
  name: "Dashboard Zoom",
  look: "dark",
  build(c) {
    const { S, safe, palette: pal, design, recipe } = c;
    const panel = c.wide ? { x: safe.x + safe.w * 0.05, y: safe.y, w: safe.w * 0.9, h: safe.h } : c.tall ? { x: safe.x, y: safe.y + safe.h * 0.07, w: safe.w, h: safe.h * 0.8 } : { x: safe.x, y: safe.y, w: safe.w, h: safe.h };
    const P0 = S * 0.055;
    const inner = panel.w - 2 * P0;
    const ink = pal.surfaceInk;
    const quiet = readable(pal.surface, mixHex(ink, pal.surface, 0.28), ink);
    // The header: the logo (at most this tall), else the name.
    const logo = c.input.logo;
    const logoH = S * 0.07;
    const logoBox = logo ? (() => {
      const s = Math.min((inner * 0.6) / logo.w, logoH / logo.h);
      return { x: panel.x + P0, y: panel.y + P0, w: logo.w * s, h: logo.h * s };
    })() : null;
    const brand = !logo ? setText(c, recipe.brand.name, { family: "body", weight: 700, width: inner * 0.7, maxLines: 1, max: S * 0.038, min: S * MIN_BODY }) : null;
    const statText = c.field("stat", "0");
    const stat = centreFigures(counterLayout("stat", statText, figureFamily(c, 800), 800, inner, S * (c.wide ? 0.15 : 0.16), S * 0.07, c.measure), c.measure);
    const label = setText(c, c.field("label"), { family: "body", weight: 500, width: inner, maxLines: 2, max: S * 0.042, min: S * MIN_BODY, lineHeight: 1.25 });
    const headTop = panel.y + P0;
    const statTop = headTop + (logoBox ? logoBox.h + S * 0.045 : brand ? brand.size * 1.2 + S * 0.045 : 0);
    const labelTop = statTop + stat.size * 1.12 + S * 0.012;
    const chartTop = labelTop + (label ? label.height : 0) + S * 0.06;
    const chartBottom = panel.y + panel.h - P0;
    const chartH = Math.max(S * 0.12, chartBottom - chartTop);
    const numberInk = readable(pal.surface, pal.accent, ink);
    const brandB = brand ? textBlock("brand", brand, { y: headTop, color: quiet, left: panel.x + P0, width: inner * 0.7 }) : null;
    const labelB = label ? textBlock("label", label, { y: labelTop, color: quiet, left: panel.x + P0, width: inner }) : null;

    // The data: a seeded climb, the last bar the highest.
    const values = Array.from({ length: BARS }, (_, i) => Math.min(1, Math.max(0.14, 0.24 + 0.62 * (i / (BARS - 1)) ** 1.25 + rngRange(-0.09, 0.09, recipe.seed, "bar", i))));
    values[BARS - 1] = 1;
    const slot = inner / BARS;
    const barW = slot * 0.56;
    const bars = values.map((v, i) => ({ x: panel.x + P0 + i * slot + (slot - barW) / 2, h: v * chartH * 0.86 }));
    const pts = bars.map((b, i) => [b.x + barW / 2, chartBottom - b.h - chartH * 0.08 - rngRange(0, 0.05, recipe.seed, "pt", i) * chartH] as [number, number]);
    const line = smoothOpenPath(pts);
    const area = `${line.d}L${pts[BARS - 1][0]} ${chartBottom}L${pts[0][0]} ${chartBottom}Z`;
    const barColour = mixHex(pal.surface, pal.mark2, pal.look === "light" ? 0.32 : 0.45);
    const grid = mixHex(pal.surface, ink, 0.1);

    const k = spread(c, 1.95);
    const events = [
      ev("panel", "enter", 0.08, 0.65, "enter"),
      ev("grid", "fade", 0.35 * k, 0.5, "enter"),
      ...bars.map((_, i) => ev(`bar.${i}`, "enter", 0.5 * k + i * 0.08, 0.5, "enter", { group: "bars", unit: "elements" })),
      ev("line", "draw", 0.75 * k, 1.2, "draw"),
      ev("area", "fade", 0.75 * k + 0.9, 0.6, "enter"),
      ev("dot", "pop", 0.75 * k + 1.05, 0.4, "pop"),
      ev("count", "move", 0.45 * k, Math.min(2.2, 1.5 * k), "linear"),
      ev("brand", "fade", 0.3, 0.4, "enter"),
      ...(label ? [ev("label", "enter", 0.62 * k, 0.45, "glide")] : []),
      ev("push", "camera", 0, c.last, "drift"),
    ];
    const shadow = shadowOf(pal.ground, pal.look === "light" ? 0.14 : 0.45);
    // Pulses 1.6 s apart from when the point lands, the last one done before the last frame.
    const dotEnd = 0.75 * k + 1.45;
    const pulse = (t: number): number => {
      if (t <= dotEnd) return 0;
      const n = Math.floor((t - dotEnd) / 1.6);
      return dotEnd + (n + 1) * 1.6 > c.last ? 0 : ((t - dotEnd) % 1.6) / 1.6;
    };

    return {
      events,
      overflow: [...(stat.overflow ? ["stat"] : []), ...(label?.overflow ? ["label"] : []), ...(brand?.overflow ? ["brand"] : [])],
      signature: 0.75 * k + 0.7,
      camera: () => ({ zoom: 1, x: 0, y: 0 }),
      frame(t, P, Lp) {
        // The push: from a little farther out and turned, square on the panel at rest.
        const push = P("push");
        const cam = multiply(translate(0, (1 - push) * S * 0.05), about(design.w / 2, panel.y + panel.h * 0.4, 0.88 + 0.12 * push, -0.035 * (1 - push)));
        const pe = P("panel");
        const children: DisplayNode[] = [
          { type: "rect", x: panel.x, y: panel.y + S * 0.02, w: panel.w, h: panel.h, r: S * 0.04, fill: shadow },
          { type: "rect", x: panel.x, y: panel.y, w: panel.w, h: panel.h, r: S * 0.04, fill: pal.surface },
        ];
        // Window dots, top right.
        for (let i = 0; i < 3; i++) children.push({ type: "ellipse", cx: panel.x + panel.w - P0 - i * S * 0.03, cy: headTop + S * 0.017, rx: S * 0.008, ry: S * 0.008, fill: grid });
        const g = P("grid");
        if (g > 0) for (let i = 0; i < 4; i++) children.push({ type: "rect", x: panel.x + P0, y: chartBottom - (i / 3) * chartH * 0.92, w: inner, h: Math.max(1.5, S * 0.002), fill: grid, opacity: g });
        bars.forEach((b, i) => {
          const q = P(`bar.${i}`);
          if (q <= 0) return;
          const h = b.h * q;
          children.push({ type: "rect", x: b.x, y: chartBottom - h, w: barW, h, r: Math.min(barW * 0.22, h / 2), fill: i === BARS - 1 ? pal.highlight.fill : barColour });
        });
        const a = P("area");
        if (a > 0) children.push({ type: "path", d: area, fill: { kind: "linear", x0: 0, y0: chartTop, x1: 0, y1: chartBottom, stops: [{ at: 0, color: withAlpha(pal.mark, 0.32) }, { at: 1, color: withAlpha(pal.mark, 0) }] }, opacity: a });
        const l = P("line");
        if (l > 0) children.push({ type: "path", d: line.d, stroke: { paint: pal.mark, width: S * 0.0065, trim: l, length: line.length, cap: "round", join: "round" } });
        const dot = P("dot");
        if (Lp("dot") > 0) {
          const end = pts[BARS - 1];
          const r = S * 0.014 * Math.max(0, dot);
          children.push({ type: "ellipse", cx: end[0], cy: end[1], rx: r * 1.9, ry: r * 1.9, fill: withAlpha(pal.mark, 0.25) }, { type: "ellipse", cx: end[0], cy: end[1], rx: r, ry: r, fill: pal.mark });
          // The live point keeps a slow pulse while the piece holds (none on the last frame).
          const ph = pulse(t);
          if (ph > 0 && ph < 1) children.push({ type: "ellipse", cx: end[0], cy: end[1], rx: S * 0.014 * (1.9 + 3.2 * ph), ry: S * 0.014 * (1.9 + 3.2 * ph), stroke: { paint: pal.mark, width: Math.max(1.5, S * 0.003) }, opacity: 0.55 * (1 - ph) });
        }
        if (logoBox) {
          const b = P("brand");
          if (b > 0) children.push(b < 1 ? group([logoNode(c, logoBox, quiet)], { opacity: b }) : logoNode(c, logoBox, quiet));
        } else if (brandB) {
          const b = P("brand");
          if (b > 0) children.push({ ...lineRuns(brandB), ...(b < 1 && { opacity: b }) });
        }
        if (Lp("count") > 0) children.push(counterNode(stat, panel.x + P0, statTop, numberInk, Lp("count")));
        if (labelB) {
          const q = P("label");
          if (q > 0) children.push(group([lineRuns(labelB)], { transform: translate(0, (1 - q) * S * 0.02), ...(q < 1 && { opacity: q }) }));
        }
        const lin = Lp("panel");
        return { nodes: lin > 0 ? [group([group(children, { transform: translate(0, (1 - pe) * S * 0.08), ...(lin < 0.35 && { opacity: lin / 0.35 }) })], { transform: cam })] : [] };
      },
    };
  },
});
