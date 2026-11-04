/**
 * Stat Stack: three numbers as one poster. The first is the hero, its figures filling the width in a heavy condensed
 * face; the other two sit side by side under a hairline at about half its size (on a wide frame, three equal columns).
 * Every figure rolls up column by column (blank until its column starts, never a placeholder) to exactly what was
 * typed; a trailing unit (%, ×) sits at 40 % of the figures' height, top-aligned to their cap height. Each label hangs
 * under its figure, a small accent index sits over each, and a giant filled tonal copy of the first figures bleeds off
 * the right edge behind it on a lit two-tone field. The brand, the address, a corner note and an index arrow sit on the
 * corners; through the hold the type plane pushes in and a band of light crosses each number in turn.
 */

import { group, type DisplayNode } from "../../display";
import { fieldStops, mixOk } from "../../color";
import { highlighter, rule } from "../../fx/overlays";
import { marked } from "./kit";
import { fontOf } from "../../type/faces";
import type { TypePlan } from "../../type/animate";
import type { TypeSet } from "../../type/glyphs";
import { bands, brandSign, capAt, capBand, footRow, litField, markColor, metaInk, posterScene, shadowed, signIn, signNodes, toneOf, withLeadGap, topSite } from "./poster";
import { splitUnit } from "./big-number";

interface Row {
  i: number;
  n: number;
  figs: TypeSet;
  unit: TypeSet | null;
  label: TypeSet | null;
  /** Its cap band (figures and unit). */
  band: { x: number; y: number; w: number; h: number };
}

export default posterScene({
  id: "marketing/stat-stack",
  name: "Stat Stack",
  pairing: "T2",
  look: "dark",
  build(c) {
    const { S, safe, pal } = c;
    const side = c.wide;
    const signH = S * (c.cover ? 0.058 : 0.046);
    const sign = brandSign(c, { maxW: S * 0.4, h: signH, x: safe.x, y: safe.y, min: S * (c.cover ? 0.05 : 0.03) });
    const metaSize = S * (c.cover ? 0.024 : 0.02);
    const site = topSite(c, sign, metaSize);
    // Labels may star words for a highlighter (*an hour*); the stars are not shown.
    const items = [1, 2, 3].map((n) => { const m = marked(c.field(`label${n}`)); return { n, stat: c.field(`stat${n}`), label: m.text, marks: m.marks }; }).filter((x) => x.stat);
    const b = bands(c, { topRow: sign?.h ?? metaSize, gap: S * 0.07 });
    const foot = metaSize * 1.1 + S * 0.05;
    const bottom = b.bottom - foot;
    const labelSize = S * (c.cover ? 0.032 : 0.03);
    const idxSize = S * (c.cover ? 0.024 : 0.02);
    const gutter = S * 0.06;

    // Where each figure goes and how wide: hero full width then two halves (tall); three columns (wide).
    const slots = items.map((_, i) => (side ? { x: safe.x + (i * (safe.w + gutter)) / 3, w: (safe.w - 2 * gutter) / 3 } : i === 0 ? { x: safe.x, w: safe.w * 0.74 } : { x: safe.x + ((i - 1) * (safe.w + gutter)) / 2, w: (safe.w - gutter) / 2 }));
    const figOpts = (size: number, x: number, y: number) => ({ role: "figures" as const, x, y, width: safe.w * 2, maxLines: 1, max: size, min: size, tabular: true, preset: "odometer" as const, tracking: 0, leading: 0.9 });
    // Each figure's width at 100 (figures plus its unit at 40 %), to size it to its slot.
    const widthAt100 = (stat: string) => {
      const [f, u] = splitUnit(stat);
      const fs = c.set("probe", f, figOpts(100, 0, 0));
      const us = u ? c.set("probe", u.trim(), { ...figOpts(35, 0, 0), tabular: false }) : null;
      return { w: (fs?.ink.w ?? 100) + (us ? us.ink.w + 4 : 0), cap: fs ? fs.cap.bottom - fs.cap.top : 70 };
    };
    const probes = items.map((it) => widthAt100(it.stat));
    // Sizes: the hero fills its slot (held to 42 % of the room's height); the others share one size, about half the hero's.
    const labelRoom = labelSize * 3.6;
    const heroRoom = side ? (bottom - b.top - labelRoom - idxSize * 2) : (bottom - b.top) * 0.7;
    let sizes = items.map((_, i) => (100 * slots[i].w * 0.96) / probes[i].w);
    if (side) {
      const one = Math.min(...sizes, (100 * heroRoom) / Math.max(...probes.map((p) => p.cap)));
      sizes = sizes.map(() => one);
    } else {
      sizes[0] = Math.min(sizes[0], (100 * heroRoom) / probes[0].cap, S * 0.75);
      const rest = Math.min(...sizes.slice(1), sizes[0] * 0.42);
      sizes = sizes.map((s, i) => (i ? rest : s));
    }
    // The hero row, then the pair under it (tall); one row of three (wide). Every row's index sits over its figures.
    // Laid out once to measure, then shrunk until the block sits clear above the foot row, and centred in the room.
    const layout = (scale: number, y0: number) => {
    const rows: Row[] = [];
    const tops: number[] = [];
    // The hero gives up less than the pair under it when the block has to shrink (it stays the poster).
    const sz = sizes.map((s, i) => s * (i === 0 && !side ? Math.sqrt(scale) : scale));
    let y = y0 + idxSize * 2.1;
    let bottomY = y0;
    items.forEach((it, i) => {
      const slot = slots[i];
      if (!side && i === 1) y = bottomY + S * 0.09 + idxSize * 2.1;
      const top = side ? y0 + idxSize * 2.1 : y;
      tops.push(top);
      const [f, u] = splitUnit(it.stat);
      const figs = capAt(c, `stat${it.n}`, f, figOpts(sz[i], slot.x, top));
      if (!figs) return;
      const uSize = sz[i] * 0.35;
      const u0 = u ? capAt(c, `stat${it.n}`, u.trimStart(), { ...figOpts(uSize, figs.ink.x + figs.ink.w + sz[i] * 0.03, top), tabular: false, preset: "stomp" }) : null;
      const unit = u0 ? withLeadGap(u0, u.slice(0, u.length - u.trimStart().length)) : null;
      const fb = capBand(figs);
      const band = { x: fb.x, y: fb.y, w: (unit ? unit.ink.x + unit.ink.w : fb.x + fb.w) - fb.x, h: fb.h };
      let label: TypeSet | null = null;
      if (it.label) {
        const lo = { role: "body" as const, weight: 500, x: slot.x, width: Math.min(slot.w, i === 0 && !side ? safe.w * 0.7 : slot.w), maxLines: 3, leading: 1.18, even: 0.6 };
        // The hero's label tucks into the column beside its figures when they leave a third of the width free, its last
        // line on the figures' baseline (the poster keeps its height for the hero).
        const bx = band.x + band.w + S * 0.045;
        const bw = safe.x + safe.w - bx;
        const tuck = i === 0 && !side && bw >= safe.w * 0.3;
        const lo2 = tuck ? { ...lo, x: bx, width: bw, maxLines: 4 } : lo;
        const l0 = c.set(`label${it.n}`, it.label, { ...lo2, y: 0, max: labelSize, min: S * 0.026 });
        if (l0) {
          const lastBase = l0.lines[l0.lines.length - 1].baseline - (l0.lines[0].y + l0.cap.top);
          label = capAt(c, `label${it.n}`, it.label, { ...lo2, y: tuck ? band.y + band.h - lastBase : band.y + band.h + S * 0.03, max: l0.size, min: l0.size });
        }
        if (tuck && label) {
          rows.push({ i, n: it.n, figs, unit, label, band });
          bottomY = Math.max(bottomY, band.y + band.h);
          return;
        }
      }
      rows.push({ i, n: it.n, figs, unit, label, band });
      bottomY = Math.max(bottomY, label ? label.lines[label.lines.length - 1].baseline + label.size * 0.25 : band.y + band.h);
    });
    return { rows, tops, bottomY };
    };
    let scale = 1;
    let lay = layout(scale, b.top);
    for (let i = 0; i < 14 && lay.bottomY > bottom; i++) lay = layout((scale *= 0.94), b.top);
    lay = layout(scale, b.top + Math.max(0, (bottom - lay.bottomY) * 0.45));
    const { rows, tops } = lay;
    const overflowed = rows.some((r) => r.band.x + r.band.w > slots[r.i].x + slots[r.i].w + 1);

    const k = c.spread(3.4, 1.5);
    const plans: { figs: TypePlan; unit: TypePlan | null; label: TypePlan | null; at: number }[] = [];
    let done = 0.6;
    rows.forEach((r, i) => {
      const at = 0.03 + i * 0.18 * k;
      c.ev(`idx.${i}`, "fade", at, 0.3, "glide");
      const figs = c.move(r.figs, { in: "odometer", at, hero: i === 0, intensity: 1, loop: "light-sweep", loopAt: 2.4 + i * 0.15, loopEvery: 1.9 }, `stat${r.n}`);
      const unit = r.unit ? c.move(r.unit, { in: "stomp", at: Math.max(at + 0.1, figs.settled - 0.3), intensity: 0.8 }, `stat${r.n}.unit`) : null;
      const label = r.label ? c.move(r.label, { in: "cut-rise", at: figs.settled - 0.3 }) : null;
      done = Math.max(done, label?.settled ?? figs.settled, unit?.settled ?? 0);
      plans.push({ figs, unit, label, at });
    });
    if (!side && rows.length > 1) c.ev("rule", "draw", 0.4, 0.6, "draw");
    const signPlan = signIn(c, sign, "brand", 0.2);
    const sitePlan = site ? c.move(site, { in: "fade-rise", at: 0.35, rate: 26 }) : null;
    const row = footRow(c, done + 0.1);

    const idxFont = fontOf(c.pairing.meta.family, idxSize, c.pairing.meta.weight);
    const stops = fieldStops(pal);
    const ruleY = rows[1] ? tops[1] - idxSize * 2.1 - S * 0.045 : 0;
    // The starred words of each label, for their highlighter.
    const marks: { row: number; x: number; w: number; capTop: number; baseline: number; key: string }[] = [];
    rows.forEach((r, ri) => {
      const it = items[r.i];
      const l = r.label;
      if (!l || !it.marks.length) return;
      let at = 0;
      l.words.forEach((w, wi) => {
        at += w.gap.length;
        const a = at;
        const e = at + w.text.length;
        at = e;
        if (!it.marks.some(([p, q]) => p < e && q > a)) return;
        const line = l.lines[w.line];
        marks.push({ row: ri, x: w.x, w: w.w, capTop: line.y + l.cap.top, baseline: line.baseline, key: `s${ri}.${wi}` });
      });
    });
    marks.forEach((mk, j) => c.ev(`mark.${j}`, "draw", (plans[mk.row]?.label?.settled ?? 1) + 0.05 + 0.08 * j, 0.4, "snap"));
    const labelInk = metaInk(pal);
    const idxInk = toneOf(pal, 0.6);

    return {
      overflow: [...(overflowed ? [`stat${rows.find((r) => r.band.x + r.band.w > slots[r.i].x + slots[r.i].w + 1)!.n}`] : []), ...rows.flatMap((r) => [...(r.figs.overflow ? [`stat${r.n}`] : []), ...(r.label?.overflow ? [`label${r.n}`] : [])]), ...(sign?.overflow ? ["brand"] : []), ...(site?.overflow ? ["website"] : []), ...row.overflow],
      signature: (plans[0]?.figs.settled ?? 1) + 0.2,
      camera: (t) => ({ x: 0, y: 18 * (1 - Math.min(1, t / c.last)) ** 2 }),
      draw(t, kit) {
        const field = litField(c, t, { from: "tr", stops });
        const ghosts: DisplayNode[] = [];
        const hero: DisplayNode[] = [];
        const overlay: DisplayNode[] = [];
        const rp = kit.P("rule");
        if (rp > 0 && ruleY) overlay.push(rule({ x: safe.x, y: ruleY, w: safe.w, color: toneOf(pal, 0.3), p: rp, width: Math.max(1, S * 0.0016) }));
        rows.forEach((r, i) => {
          const p = plans[i];
          const ip = kit.P(`idx.${i}`);
          if (ip > 0) overlay.push(group([{ type: "text", field: `stat${r.n}`, decor: true, runs: [{ text: `0${i + 1}`, gap: "", font: idxFont, x: slots[i].x, y: r.band.y - idxSize * 2.1, fill: idxInk }] }], { opacity: ip }));
          const nodes = [...kit.type(p.figs, { fill: pal.ink, sweep: "#ffffff", sweepAlpha: 0.45 }), ...(p.unit ? kit.type(p.unit, { fill: pal.ink }) : [])];
          const pad = r.figs.size * 0.25;
          if (t >= Math.max(p.figs.settled, p.unit?.settled ?? 0)) hero.push(...shadowed(c, nodes, r.figs.size * 0.5, { x: r.band.x - pad, y: r.band.y - pad, w: r.band.w + 2 * pad, h: r.band.h + 2 * pad }, `ss|${r.figs.text}|${r.figs.size}`, 0.8));
          hero.push(...nodes);
          for (const [j, mk] of marks.entries()) {
            if (mk.row !== i) continue;
            const hl = highlighter({ capTop: mk.capTop, baseline: mk.baseline, x: mk.x, w: mk.w, color: mixOk(markColor(c, pal.ground, labelInk), pal.ground, 0.1), seed: c.seed, p: kit.P(`mark.${j}`), key: mk.key, cover: 0.8, skew: -3 });
            if (hl) hero.push(hl);
          }
          if (p.label) hero.push(...kit.type(p.label, { fill: labelInk }));
        });
        const meta = [...signNodes(c, kit, sign, signPlan, "brand", safe.x, safe.y, pal.ink), ...(sitePlan ? kit.type(sitePlan, { fill: metaInk(pal), caret: pal.accent }) : []), ...row.draw(kit, metaInk(pal), pal.ink)];
        return [
          { role: "ground", nodes: field },
          { role: "ghost", nodes: ghosts },
          { role: "hero", nodes: hero },
          { role: "overlay", nodes: overlay },
          { role: "meta", nodes: meta },
        ];
      },
    };
  },
});
