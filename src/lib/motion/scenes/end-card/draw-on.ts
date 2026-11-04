/**
 * Draw-on (the default end card): editorial and premium. The logo's outlines trace on in the words' colour and the
 * logo fills in under them (a raster logo wipes on with a soft edge and settles; no logo: the brand's name sets letter
 * by letter). The product's name rises line by line out of its own line boxes, the call-to-action pill pops with its
 * label, the address fades up, and the whole card drifts in on a slow push.
 */

import { about, group, translate, type DisplayNode } from "../../display";
import { linearProgress, progress, type Cue } from "../../tween";
import { endCardScene, letterRuns, lineLeft, lineRun, lineRuns, logoImage, logoPaths, pillRect, wipe, keepFor } from "./shared";

export default endCardScene("draw-on", ({ rest, input }) => {
  const { logo, brand, headline, cta, site } = rest;
  const svg = logo && input.logo?.kind === "svg" && input.logo.paths?.length ? logoPaths(input.logo, logo).sort((a, b) => b.length * b.scale - a.length * a.scale) : null;
  const traceGroups = svg ? Math.min(svg.length, 5) : 0;
  const cues: Cue[] = [];
  if (svg) {
    for (let g = 0; g < traceGroups; g++) cues.push({ id: `logo.trace.${g}`, kind: "draw", at: g * 0.06, dur: 0.45, curve: "draw", stagger: { group: "logo.trace", unit: "words", index: g, each: 0.06 } });
    cues.push({ id: "logo.fill", kind: "fade", at: 0.35, dur: 0.3, curve: "enter" });
  } else if (logo) {
    cues.push({ id: "logo.wipe", kind: "draw", at: 0, dur: 0.6, curve: "glide" }, { id: "logo.settle", kind: "enter", at: 0, dur: 0.6, curve: "settle" });
  } else if (brand) {
    // Letters 30 ms apart; a long name moves in at most 12 beats.
    const n = brand.layout.lines.reduce((s, l) => s + (l.graphemes ?? l.words).length, 0);
    const slots = Math.min(n, 12);
    for (let s = 0; s < slots; s++) cues.push({ id: `brand.beat.${s}`, kind: "enter", at: s * 0.03, dur: 0.4, curve: "glide", stagger: { group: "brand", unit: "letters", index: s, each: 0.03 } });
  }
  const lines = headline.layout.lines.length;
  for (let i = 0; i < lines; i++) cues.push({ id: `headline.line.${i}`, kind: "enter", at: 0.2 + i * 0.09, dur: 0.5, curve: "glide", stagger: { group: "headline", unit: "elements", index: i, each: 0.09 } });
  if (cta) cues.push({ id: "cta.pill", kind: "pop", at: 0.45, dur: 0.45, curve: "pop" });
  if (site) cues.push({ id: "site", kind: "enter", at: 0.55, dur: 0.35, curve: "glide" });
  const beats = brand ? Math.min(12, brand.layout.lines.reduce((s, l) => s + (l.graphemes ?? l.words).length, 0)) : 0;
  const S = Math.min(rest.w, rest.h);

  return {
    cues,
    keep: keepFor("draw-on", rest),
    lead: 0.1,
    signature: 0.2,
    frame(t, tl) {
      const P = (id: string) => progress(tl, id, t);
      const nodes: DisplayNode[] = [];
      if (logo && svg) {
        const fill = P("logo.fill");
        if (fill > 0) nodes.push(logoImage(logo, fill));
        if (fill < 1) {
          const width = logo.h * 0.012;
          svg.forEach((p, i) => {
            const trim = P(`logo.trace.${Math.floor((i * traceGroups) / svg.length)}`);
            if (trim <= 0) return;
            nodes.push({ type: "path", d: p.d, transform: p.m, stroke: { paint: rest.ink, width: width / p.scale, trim, length: p.length, cap: "round", join: "round" }, opacity: 1 - fill });
          });
        }
      } else if (logo) {
        const s = 1.04 - 0.04 * P("logo.settle");
        nodes.push(group([wipe([logoImage(logo)], logo, P("logo.wipe"), logo.w * 0.08)], { transform: about(logo.x + logo.w / 2, logo.y + logo.h / 2, s) }));
      } else if (brand) {
        const em = brand.layout.size;
        // Once every letter is home, the name is drawn as whole lines (the letters sit exactly there).
        if (P(`brand.beat.${beats - 1}`) >= 1) nodes.push(lineRuns(brand));
        else
          nodes.push(
            letterRuns(brand, (k, n) => {
              const p = P(`brand.beat.${Math.floor((k * Math.min(n, 12)) / n)}`);
              return { opacity: p, dy: (1 - p) * 0.25 * em };
            }),
          );
      }
      // Each line rises out of its own line box.
      for (let i = 0; i < lines; i++) {
        const p = P(`headline.line.${i}`);
        if (p <= 0) continue;
        const L = headline.layout;
        const lh = L.lineHeight;
        const top = headline.y + i * lh;
        const x = lineLeft(headline, i);
        if (p >= 1) nodes.push(lineRun(headline, i));
        else nodes.push(group([lineRun(headline, i, { dy: (1 - p) * lh })], { clip: { type: "rect", x: x - L.size * 0.2, y: top - L.size * 0.08, w: L.lines[i].width + L.size * 0.4, h: lh + L.size * 0.16 } }));
      }
      if (cta) {
        const pop = P("cta.pill");
        const lin = linearProgress(tl, "cta.pill", t);
        // Solid within a frame or two; the label rides with the pill from its first frames and is in by 40 % of the pop.
        const appear = Math.min(1, lin * 8);
        if (appear > 0) {
          const s = 0.6 + 0.4 * pop;
          const label = Math.min(1, Math.max(0, (lin - 0.08) / 0.3));
          const children: DisplayNode[] = [pillRect(cta)];
          if (label > 0) children.push({ ...lineRuns(cta.label), ...(label < 1 && { opacity: label }) });
          nodes.push(group(children, { transform: about(cta.x + cta.w / 2, cta.y + cta.h / 2, s), ...(appear < 1 && { opacity: appear }) }));
        }
      }
      if (site) {
        const p = P("site");
        if (p > 0) nodes.push(group([lineRuns(site)], { transform: translate(0, (1 - p) * S * 0.018), ...(p < 1 && { opacity: p }) }));
      }
      return { nodes };
    },
  };
});
