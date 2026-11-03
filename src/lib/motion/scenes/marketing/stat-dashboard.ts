/**
 * Dashboard Zoom: the key number is the hero, set huge above the evidence in the product face with tabular figures
 * (the typed separators at their own width), rolling up column by column to exactly what was typed. Under it the label
 * cuts up, and a glass panel rises from its foot with the chart: gridlines, a dashed comparison line at 25 %, and the
 * main line in the brand's colour drawing across after the number lands, its area filling in and its last point
 * pulsing once. A lit field of the brand's hue with a light from the top left sits behind a fine grid. The brand, the
 * address, a corner note and an index sit on the corners. Through the hold the type plane pushes in.
 */

import { about, group, type DisplayNode } from "../../display";
import { contrastOf, fieldStops, mixOk, toLab, withLightness } from "../../color";
import { rgba } from "../../fx/background";
import { twoShadow } from "../../fx/depth";
import { asDecor, bands, brandSign, capBand, footRow, litField, metaInk, posterScene, signIn, signNodes, toneOf, topSite } from "./poster";

/** A smooth rising line through seeded points (a sparkline), as path data, and its rough length. */
function sparkline(x: number, y: number, w: number, h: number, seed: number, lift = 1): { d: string; area: string; length: number; end: [number, number]; pts: [number, number][] } {
  const n = 9;
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    // Mostly rising (a quarter of the noise of before, so it never dips against an "up" label).
    const noise = Math.sin(i * 1.7 + seed) * 0.07 + Math.sin(i * 0.9 + seed * 0.3) * 0.05;
    pts.push([x + u * w, y + h - (0.12 + 0.75 * lift * u ** 1.3 + noise * (1 - u * 0.6)) * h * 0.85]);
  }
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  let length = 0;
  for (let i = 1; i < n; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const mx = (x0 + x1) / 2;
    d += `C${mx.toFixed(1)} ${y0.toFixed(1)} ${mx.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    length += Math.hypot(x1 - x0, y1 - y0) * 1.08;
  }
  const area = `${d}L${(x + w).toFixed(1)} ${(y + h).toFixed(1)}L${x.toFixed(1)} ${(y + h).toFixed(1)}Z`;
  return { d, area, length, end: pts[n - 1], pts };
}

export default posterScene({
  id: "marketing/stat-dashboard",
  name: "Dashboard Zoom",
  pairing: "T7",
  look: "dark",
  build(c) {
    const { S, safe, pal, design } = c;
    const side = c.wide;
    const signH = S * (c.cover ? 0.058 : 0.046);
    const sign = brandSign(c, { maxW: S * 0.36, h: signH, x: safe.x, y: safe.y, min: S * (c.cover ? 0.05 : 0.03) });
    const metaSize = S * (c.cover ? 0.024 : 0.02);
    const site = topSite(c, sign, metaSize);
    const b = bands(c, { topRow: sign?.h ?? metaSize, gap: S * 0.06 });
    const foot = metaSize * 1.1 + S * 0.05;
    const statText = c.field("stat", "0");
    // The number: the hero, in the product face with fixed-width figures, filling the width (the left column on a wide frame).
    const numW = side ? safe.w * 0.52 : safe.w;
    // Proportional figures at rest (a fixed-width "1" leaves holes in a settled number).
    const stat0 = c.set("stat", statText, { role: "hero", weight: 800, x: safe.x, y: b.top, width: numW, maxLines: 1, max: side ? design.h * 0.3 : S * 0.36, min: S * 0.08, preset: "odometer", tracking: -0.01, leading: 0.95 });
    const lift = stat0 ? stat0.lines[0].y + stat0.cap.top - b.top : 0;
    const labelSize = S * (c.cover ? 0.05 : 0.042);
    const label0 = c.set("label", c.field("label"), { role: "body", weight: 500, x: safe.x, y: 0, width: numW, maxLines: 2, max: labelSize, min: S * 0.03, leading: 1.2 });
    const labelH = label0 ? capBand(label0).h : 0;
    const statH = stat0 ? capBand(stat0).h : 0;
    // Wide: the number and label centred in the left column, the panel in the right. Tall: number, label, then the panel to the foot.
    const blockH = statH + (label0 ? S * 0.05 + labelH : 0);
    const statTop = side ? b.top + Math.max(0, (b.bottom - foot - b.top - blockH) * 0.5) : b.top;
    const stat = stat0 ? c.set("stat", statText, { role: "hero", weight: 800, x: safe.x, y: statTop - lift, width: numW, maxLines: 1, max: stat0.size, min: stat0.size, preset: "odometer", tracking: -0.01, leading: 0.95 }) : null;
    const statBand = stat ? capBand(stat) : { x: safe.x, y: statTop, w: 0, h: 0 };
    const label = label0 ? c.set("label", c.field("label"), { role: "body", weight: 500, x: safe.x, y: statBand.y + statBand.h + S * 0.05 - (label0.lines[0].y + label0.cap.top - label0.lines[0].y), width: numW, maxLines: 2, max: label0.size, min: label0.size, leading: 1.2 }) : null;
    const below = label ? label.lines[label.lines.length - 1].baseline + label.size * 0.3 : statBand.y + statBand.h;
    const panel = side ? { x: safe.x + safe.w * 0.58, y: b.top, w: safe.w * 0.42, h: b.bottom - foot - b.top } : { x: safe.x, y: below + S * 0.06, w: safe.w, h: Math.max(S * 0.25, safe.y + safe.h - foot - S * 0.02 - below - S * 0.06) };
    const pad = S * 0.05;
    const chart = { x: panel.x + pad * 1.3, y: panel.y + pad * 1.2, w: panel.w - pad * 2.3, h: panel.h - pad * 2.4 };
    const spark = sparkline(chart.x, chart.y, chart.w, chart.h, c.seed);
    const shadowSeries = sparkline(chart.x, chart.y, chart.w, chart.h, c.seed + 3, 0.6);

    const k = c.spread(3.4, 1.5);
    const statPlan = stat ? c.move(stat, { in: "odometer", at: 0.03, hero: true, loop: "light-sweep", loopAt: 2.6, loopEvery: 1.8 }) : null;
    const landed = statPlan?.settled ?? 1.4;
    // The panel rises at once and the line draws while the number is still rolling, so number and evidence land
    // together; the change pops in as a tag on the line's last point.
    c.ev("panel", "enter", 0.1, 0.6, "glide");
    c.ev("grid", "draw", 0.25, 0.6, "draw");
    const sparkAt = Math.max(0.6, landed - 0.7);
    c.ev("spark", "draw", sparkAt, 0.9, "draw");
    c.ev("ghost", "fade", sparkAt - 0.1, 0.7, "glide");
    c.ev("area", "fade", sparkAt + 0.4, 0.7, "glide");
    c.ev("dot", "pop", sparkAt + 0.9, 0.5, "pop");
    c.ev("change", "pop", sparkAt + 1.02, 0.4, "pop");
    const labelPlan = label ? c.move(label, { in: "cut-rise", at: Math.min(landed - 0.3, 1.0 * k) }) : null;
    const signPlan = signIn(c, sign, "brand", 0.2);
    const sitePlan = site ? c.move(site, { in: "fade-rise", at: 0.35, rate: 26 }) : null;
    const row = footRow(c, landed + 0.3);

    // Glass: a lighter tone of the ground at 78 %, a hairline of light along its top edge.
    const surface = c.dark ? mixOk(fieldStops(pal).dark, mixOk(pal.paper, pal.brand[0], 0.5), 0.14) : mixOk(pal.ground, pal.paper, 0.85);
    const edge = c.dark ? mixOk(pal.ground, pal.paper, 0.26) : mixOk(pal.paper, pal.brand[0], 0.25);
    // The line: the brand's own colour, lifted until it reads on the panel.
    const b0 = pal.brand[0];
    const lineColor = contrastOf(b0, surface) >= 3 ? b0 : withLightness(b0, toLab(surface).L < 0.5 ? 0.68 : 0.42);
    const stops = fieldStops(pal);
    const ticks = 4;
    // The change the label names ("up 38%"): its figure, as typed, in a tag pinned to the line's last point (a copy of
    // the label's words, so it is decorative), with a drawn arrow for the direction.
    const pct = /(\p{Nd}+(?:[.,]\p{Nd}+)?\s?%)/u.exec(c.field("label"))?.[1] ?? "";
    const tagSize = S * (c.cover ? 0.034 : 0.03);
    const tag = pct ? c.set("label", pct, { role: "figures", weight: 700, x: 0, y: 0, width: S * 0.4, maxLines: 1, max: tagSize, min: tagSize }) : null;
    const tagW = tag ? tag.ink.w + tagSize * 2.2 : 0;
    const tagH = tagSize * 1.9;
    const tagX = Math.min(chart.x + chart.w - tagW, spark.end[0] - tagW / 2);
    const tagY = Math.max(panel.y + S * 0.02, spark.end[1] - tagH - S * 0.045);
    const tagSet = tag ? c.set("label", pct, { role: "figures", weight: 700, x: tagX + tagSize * 1.5, y: tagY + (tagH - tagSize) / 2 - tagSize * 0.05, width: S * 0.4, maxLines: 1, max: tagSize, min: tagSize }) : null;
    const labelInk = c.dark ? mixOk(pal.paper, pal.ground, 0.2) : metaInk(pal);

    return {
      overflow: [...(stat?.overflow ? ["stat"] : []), ...(label?.overflow ? ["label"] : []), ...(sign?.overflow ? ["brand"] : []), ...(site?.overflow ? ["website"] : []), ...row.overflow],
      signature: landed + 0.2,
      camera: (t) => ({ x: 0, y: 24 * (1 - Math.min(1, t / c.last)) ** 2 }),
      draw(t, kit) {
        const field = litField(c, t, { from: "tl", stops, light: withLightness(pal.brand[0], 0.6), lightAlpha: c.dark ? 0.3 : 0.2 });
        // A fine grid in a tone of the ground.
        const cell = S * 0.09;
        let gd = "";
        for (let x = (design.w % cell) / 2; x <= design.w; x += cell) gd += `M${x.toFixed(1)} 0V${design.h}`;
        for (let y = (design.h % cell) / 2; y <= design.h; y += cell) gd += `M0 ${y.toFixed(1)}H${design.w}`;
        const atmosphere: DisplayNode[] = [group([{ type: "path", d: gd, stroke: { paint: toneOf(pal, 0.14), width: 1 } }], { opacity: 0.16, cache: { key: `grid|${design.w}x${design.h}|${pal.ground}`, bounds: { x: 0, y: 0, ...design } } })];
        const lin = kit.L("panel");
        const p = kit.P("panel");
        const plate: DisplayNode = { type: "rect", ...panel, r: S * 0.035, fill: rgba(surface, 0.78), stroke: { paint: edge, width: Math.max(1, S * 0.0015) } };
        const sheen: DisplayNode = { type: "rect", ...panel, r: S * 0.035, fill: { kind: "linear", x0: 0, y0: panel.y, x1: 0, y1: panel.y + panel.h * 0.5, stops: [{ at: 0, color: rgba("#ffffff", c.dark ? 0.08 : 0.4) }, { at: 1, color: rgba("#ffffff", 0) }] } };
        // The glass's own hairline edge is its rim (no separate top line).
        const inside: DisplayNode[] = [];
        const gp = kit.P("grid");
        if (gp > 0) {
          let g = "";
          for (let i = 0; i <= ticks; i++) {
            const y = chart.y + (chart.h * i) / ticks;
            g += `M${chart.x.toFixed(1)} ${y.toFixed(1)}H${(chart.x + chart.w * gp).toFixed(1)}`;
          }
          inside.push({ type: "path", d: g, stroke: { paint: rgba(pal.ink, 0.1), width: Math.max(1, S * 0.0012) } });
        }
        // The comparison: dashed, at 25 %.
        const gh = kit.P("ghost");
        if (gh > 0) {
          let dd = "";
          const n = 28;
          // A dashed line drawn as short pieces along the second series' points.
          const ends = shadowSeries.pts;
          for (let i = 0; i < n; i += 2) {
            const u0 = i / n;
            const u1 = (i + 1) / n;
            const at = (u: number) => {
              const f = u * (ends.length - 1);
              const j = Math.min(ends.length - 2, Math.floor(f));
              const r = f - j;
              return [ends[j][0] + (ends[j + 1][0] - ends[j][0]) * r, ends[j][1] + (ends[j + 1][1] - ends[j][1]) * r];
            };
            const [ax, ay] = at(u0);
            const [bx, by] = at(u1);
            dd += `M${ax.toFixed(1)} ${ay.toFixed(1)}L${bx.toFixed(1)} ${by.toFixed(1)}`;
          }
          inside.push({ type: "path", d: dd, stroke: { paint: rgba(pal.ink, 0.25 * gh), width: Math.max(1.5, S * 0.003), cap: "round" } });
        }
        const ar = kit.P("area");
        if (ar > 0) inside.push(group([{ type: "path", d: spark.area, fill: { kind: "linear", x0: chart.x, y0: 0, x1: chart.x + chart.w, y1: 0, stops: [{ at: 0, color: rgba(lineColor, 0.05) }, { at: 0.8, color: rgba(lineColor, 0.2) }, { at: 0.93, color: rgba(lineColor, 0.16) }, { at: 1, color: rgba(lineColor, 0) }] } }], { opacity: ar }));
        const sp = kit.P("spark");
        if (sp > 0) inside.push({ type: "path", d: spark.d, stroke: { paint: lineColor, width: Math.max(3, S * 0.007), trim: sp, length: spark.length, cap: "round", join: "round" } });
        if (sp >= 1) {
          const dl = kit.L("dot");
          const ring = dl > 0 && dl < 1 ? [{ type: "ellipse" as const, cx: spark.end[0], cy: spark.end[1], rx: S * (0.015 + 0.05 * dl), ry: S * (0.015 + 0.05 * dl), stroke: { paint: rgba(lineColor, 0.6 * (1 - dl)), width: Math.max(1.5, S * 0.003) } }] : [];
          inside.push(...ring, { type: "ellipse", cx: spark.end[0], cy: spark.end[1], rx: S * 0.03, ry: S * 0.03, fill: rgba(lineColor, 0.22) }, { type: "ellipse", cx: spark.end[0], cy: spark.end[1], rx: S * 0.013, ry: S * 0.013, fill: lineColor });
        }
        const ch = kit.L("change");
        if (tagSet && ch > 0) {
          const q = kit.P("change");
          const ax = tagX + tagSize * 0.75;
          const ay = tagY + tagH / 2;
          const a = tagSize * 0.32;
          const tagNodes: DisplayNode[] = [
            { type: "rect", x: tagX, y: tagY, w: tagW, h: tagH, r: tagH / 2, fill: lineColor },
            { type: "path", d: `M${(ax - a).toFixed(1)} ${(ay + a * 0.6).toFixed(1)}L${ax.toFixed(1)} ${(ay - a * 0.7).toFixed(1)}L${(ax + a).toFixed(1)} ${(ay + a * 0.6).toFixed(1)}Z`, fill: surface },
            ...asDecor([{ type: "text", field: "label", runs: [{ text: pct, gap: "", font: tagSet.font, x: tagSet.lines[0].x, y: tagSet.lines[0].y, fill: surface }] }]),
          ];
          inside.push(group(tagNodes, { ...(q < 1 && { transform: about(tagX + tagW / 2, tagY + tagH, 0.85 + 0.15 * q) }), ...(ch < 0.5 && { opacity: ch / 0.5 }) }));
        }
        const reveal = Math.min(1, lin * 1.25);
        const subject: DisplayNode[] =
          lin > 0
            ? [
                group([...twoShadow({ nodes: [plate], size: panel.h, ground: pal.ground, bounds: panel, key: `dz|${panel.w.toFixed(0)}x${panel.h.toFixed(0)}` }), plate, sheen, ...inside], {
                  transform: [1, 0, 0, 1, 0, (1 - p) * S * 0.04],
                  ...(reveal < 1 && { clip: { type: "rect", x: panel.x - S * 0.1, y: panel.y + panel.h * (1 - reveal) - S * 0.05, w: panel.w + S * 0.2, h: panel.h * reveal + S * 0.2 } }),
                }),
              ]
            : [];
        const hero: DisplayNode[] = [];
        if (statPlan && stat) hero.push(...kit.type(statPlan, { fill: pal.ink, sweep: "#ffffff", sweepAlpha: 0.45 }));
        if (labelPlan) hero.push(...kit.type(labelPlan, { fill: labelInk }));
        const meta = [...signNodes(c, kit, sign, signPlan, "brand", safe.x, safe.y, pal.ink), ...(sitePlan ? kit.type(sitePlan, { fill: metaInk(pal), caret: lineColor }) : []), ...row.draw(kit, metaInk(pal), pal.ink)];
        return [
          { role: "ground", nodes: field },
          { role: "atmosphere", nodes: atmosphere },
          { role: "subject", nodes: subject, push: -0.025, z: 1 },
          { role: "hero", nodes: hero },
          { role: "meta", nodes: meta },
        ];
      },
    };
  },
});
