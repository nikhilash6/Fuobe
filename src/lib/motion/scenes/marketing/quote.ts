/**
 * Five-Star Quote: an editorial page. A portrait in an arched panel stands at the top right (the left side of a wide
 * frame), seated on a hairline with its shadow under it, its photo graded softly into the brand's tones, rising out of
 * a mask from its foot and pushing in slowly. Five stars pop in one after another beside it; the customer's words are
 * the hero, set large across the page in a soft serif with the opening mark hung in the margin, cutting up line by
 * line; their name follows on one line, and the brand and its web address settle at the foot. A giant tonal
 * quotation mark sits off to one side behind it all.
 */

import { group, type DisplayNode } from "../../display";
import { ensureContrast, mixOk } from "../../color";
import { duotone, coverCrop, pushIn } from "../../fx/photo";
import { rings } from "../../fx/background";
import { twoShadow } from "../../fx/depth";
import { rule } from "../../fx/overlays";
import { brandSign, capBand, corners, metaInk, paperField, meshField, posterScene, signIn, signNodes, toneOf, type SetOptions } from "./poster";
import { starPath } from "./kit";

export default posterScene({
  id: "marketing/quote",
  name: "Five-Star Quote",
  pairing: "T5",
  look: "light",
  build(c) {
    const { S, safe, pal, design } = c;
    const photo = c.recipe.media?.product ? c.input.images?.product : undefined;
    const side = c.wide;
    // The panel: the top right of the page (the left 40 % of a wide frame), an arch on top.
    const panelW = Math.round(design.w * (side ? 0.34 : c.tall ? 0.58 : 0.52));
    const panelTop = Math.round(c.cover ? safe.y : design.h * 0.04);
    // An arch at every size (on a wide frame, standing on the left).
    const panel = side ? { x: Math.round(S * 0.07), y: Math.round(S * 0.07), w: panelW, h: design.h - Math.round(S * 0.14) } : { x: design.w - panelW + Math.round(design.w * 0.04), y: panelTop, w: panelW, h: Math.round(design.h * (c.tall ? 0.45 : 0.42)) - panelTop };
    const colX = side ? panel.x + panelW + S * 0.08 : safe.x;
    const colW = side ? safe.x + safe.w - colX : safe.w;
    const signH = S * (c.cover ? 0.046 : 0.04);
    const starR = S * (c.cover ? 0.026 : 0.022);
    const starsTop = safe.y + starR;
    // The brand at the foot, well clear of anything under the frame's lower edge.
    const footY = safe.y + safe.h - (c.cover ? S * 0.04 : 0);
    const sign0 = brandSign(c, { maxW: colW * 0.5, h: signH, x: colX, y: 0, min: S * (c.cover ? 0.056 : 0.03) });
    const signY = footY - (sign0?.h ?? 0);
    const sign = sign0?.set ? brandSign(c, { maxW: colW * 0.5, h: signH, x: colX, y: signY, min: S * (c.cover ? 0.056 : 0.03) }) : sign0;
    const nameSize = S * (c.cover ? 0.036 : 0.03);
    const nameOpts = (y: number, max: number, min: number): SetOptions => ({ role: "meta", weight: 600, x: colX, y, width: colW, maxLines: 1, max, min, tracking: 0.02 });
    let name0 = c.set("name", c.field("name"), nameOpts(0, nameSize, S * 0.022));
    // Kept to one line where it fits; two when it is long.
    if (name0?.overflow) name0 = c.set("name", c.field("name"), { ...nameOpts(0, nameSize, S * 0.022), maxLines: 2 });
    const nameH = name0 ? capBand(name0).h : 0;
    const quoteTop = side ? starsTop + starR * 2 + S * 0.06 : panel.y + panel.h + S * 0.07;
    const quoteRoom = signY - S * 0.06 - (name0 ? nameH + S * 0.045 : 0) - quoteTop;
    const qo = (max: number, x = colX, w = colW) => ({ role: "hero" as const, x, y: quoteTop, width: w, maxLines: 7, max, min: S * 0.036, leading: 1.04, preset: "cut-rise" as const, even: 0.45 });
    let quote = c.set("quote", c.field("quote"), qo(Math.min(S * (side ? 0.11 : 0.17), quoteRoom / 2)));
    for (let i = 0; quote && i < 24 && capBand(quote).h > quoteRoom && quote.size > S * 0.0365; i++) quote = c.set("quote", c.field("quote"), qo(Math.max(S * 0.036, quote.size * 0.93)));
    // Too long for the page even at its smallest: ask for fewer words.
    const quoteTall = !!quote && capBand(quote).h > quoteRoom + 1;
    // The opening quote hangs into the column's own room, never past the safe area's edge.
    const hang = quote ? Math.max(0, colX - quote.ink.x) : 0;
    if (quote && hang > 0.5) quote = c.set("quote", c.field("quote"), { ...qo(quote.size, colX + hang, colW - hang), min: Math.min(quote.size, S * 0.036) });
    // Hanging the mark can add a line: shrink again until it fits.
    for (let i = 0; quote && hang > 0.5 && i < 24 && capBand(quote).h > quoteRoom && quote.size > S * 0.0365; i++) quote = c.set("quote", c.field("quote"), { ...qo(Math.max(S * 0.036, quote.size * 0.94), colX + hang, colW - hang), min: S * 0.036 });
    const qBand = quote ? capBand(quote) : { x: colX, y: quoteTop, w: 0, h: 0 };
    const name = name0 ? c.set("name", c.field("name"), { ...nameOpts(qBand.y + qBand.h + S * 0.045, name0.size, name0.size), maxLines: name0.lines.length }) : null;

    const k = c.spread(3.2, 1.6);
    c.ev("panel", "hero", 0, 0.8, "enter");
    c.ev("seat", "draw", 0.3, 0.6, "draw");
    const quotePlan = quote ? c.move(quote, { in: "cut-rise", at: 0.2, hero: true }) : null;
    const qDone = quotePlan?.settled ?? 1.2;
    // The stars pop in one after another as the words settle.
    for (let i = 0; i < 5; i++) c.ev(`star.${i}`, "pop", Math.max(0.3, qDone - 0.35) + i * 0.08, 0.4, "pop", { group: "stars", unit: "elements" });
    const namePlan = name ? c.move(name, { in: "word-lift", at: qDone + 0.05 * k }) : null;
    const signPlan = signIn(c, sign, "brand", Math.min(1.2, qDone + 0.25 * k));
    const facts = corners(c, [{ at: "br", field: "website", text: c.field("website") }], { at: qDone + 0.35 * k, box: { x: colX, y: safe.y, w: colW, h: footY - safe.y - Math.max(0, ((sign?.h ?? 0) - S * 0.024) / 2) } });
    // The corner note rides the stars' line, after them.
    const noteSize = S * (c.cover ? 0.024 : 0.02);
    // Under the stars, on its own line.
    const note = c.set("note", c.field("note"), { role: "meta", x: colX, y: starsTop + starR + S * 0.025, width: Math.max(S * 0.2, (side ? colX + colW : panel.x - S * 0.03) - colX), maxLines: 1, max: noteSize, min: noteSize * 0.8, tracking: 0.08, preset: "fade-rise" });
    const notePlan = note ? c.move(note, { in: "fade-rise", at: 0.9, rate: 30 }) : null;
    c.ev("sweep", "move", Math.min(c.last - 1.2, Math.max(qDone + 0.6, 3.0)), 0.8, "move");

    const arch = (b: { x: number; y: number; w: number; h: number }) => {
      const r = b.w / 2;
      return `M${b.x} ${b.y + b.h}V${b.y + r}A${r} ${r} 0 0 1 ${b.x + b.w} ${b.y + r}V${b.y + b.h}Z`;
    };
    const panelPath = arch(panel);
    // Stars read at 3:1 or more on every look: gold on a dark field, the brand's deep tone on paper.
    const starFill = ensureContrast(c.dark ? mixOk("#d9b26b", pal.accent, 0.15) : mixOk(pal.brand[0], pal.accent, 0.15), pal.ground, 3.2);

    return {
      overflow: [...(quote?.overflow || quoteTall ? ["quote"] : []), ...(name?.overflow ? ["name"] : []), ...(sign?.overflow ? ["brand"] : []), ...(note?.overflow ? ["note"] : []), ...facts.overflow],
      signature: qDone + 0.3,
      draw(t, kit) {
        const field = c.dark ? meshField(c, t) : [...paperField(c, t, { tint: pal.brand[1], light: 0.6 }), ...meshField(c, t, { colors: [mixOk(pal.brand[1], pal.ground, 0.55), mixOk(pal.brand[0], pal.ground, 0.9), mixOk(pal.brand[1], pal.ground, 0.75)], amplitude: 0.08 }).slice(1)];
        const pl = kit.L("panel");
        const pp = kit.P("panel");
        const subject: DisplayNode[] = [];
        if (pl > 0) {
          const content: DisplayNode[] = [];
          if (photo) {
            const { zoom } = pushIn(t, c.last, { from: 1.02, to: 1.07 });
            // Framed on the face (both eyes in, whatever the panel's shape).
            content.push({ type: "image", bleed: true, src: "product", x: panel.x, y: panel.y, w: panel.w, h: panel.h, crop: coverCrop(photo, panel, { x: 0.55, y: 0.32 }, zoom) }, ...duotone(panel, { dark: mixOk(pal.brand[0], "#000000", 0.4), light: pal.brand[1], darkAlpha: 0.16, lightAlpha: 0.12 }));
          } else {
            content.push({ type: "rect", ...panel, fill: { kind: "linear", x0: 0, y0: panel.y, x1: 0, y1: panel.y + panel.h, stops: [{ at: 0, color: mixOk(pal.brand[1], pal.ground, 0.3) }, { at: 1, color: mixOk(pal.brand[0], pal.ground, 0.4) }] } }, rings({ cx: panel.x + panel.w / 2, cy: panel.y + panel.h * 0.6, count: 6, gap: panel.w * 0.12, colors: [pal.paper], alpha: 0.35 }));
          }
          // A light band crosses the portrait once in the hold.
          const sw = kit.L("sweep");
          if (sw > 0 && sw < 1) {
            const bw = panel.w * 0.35;
            const x = panel.x - bw + kit.P("sweep") * (panel.w + 2 * bw);
            content.push({ type: "rect", x: x - bw / 2, y: panel.y, w: bw, h: panel.h, fill: { kind: "linear", x0: x - bw / 2, y0: 0, x1: x + bw / 2, y1: 0, stops: [{ at: 0, color: "rgba(255,255,255,0)" }, { at: 0.5, color: "rgba(255,255,255,0.22)" }, { at: 1, color: "rgba(255,255,255,0)" }] } });
          }
          const shape: DisplayNode = { type: "path", d: panelPath, fill: "#000000" };
          // It opens as an arch at every moment: the arch grows from its foot's middle (never a square strip, never a fade).
          const shown = Math.min(1, pl * 1.15);
          const e = Math.max(0.001, pp);
          const gw = panel.w * (0.35 + 0.65 * e);
          const gh = panel.h * (0.35 + 0.65 * e);
          const grow = arch({ x: panel.x + (panel.w - gw) / 2, y: panel.y + panel.h - gh, w: gw, h: gh });
          const clip = shown < 1 || pp < 1 ? grow : panelPath;
          subject.push(group([...twoShadow({ nodes: [{ ...shape, d: clip }], size: panel.h * 0.5, ground: pal.ground, bounds: panel, key: `fq|${panel.w}x${panel.h}|${clip === panelPath ? 1 : e.toFixed(2)}`, opacity: Math.min(1, shown) }), group(content, { clip: { type: "path", d: clip }, isolate: panel })]));
        }
        // The hairline the arch stands on.
        const sp = kit.P("seat");
        const em = quote?.size ?? S * 0.08;
        // The shelf runs from the text's margin to the frame's edge, under the arch.
        if (!side && sp > 0) subject.push(rule({ x: safe.x, y: panel.y + panel.h, w: design.w - safe.x, color: toneOf(pal, 0.45), p: sp, width: Math.max(1, S * 0.0016) }));
        void em;
        const ghosts: DisplayNode[] = [];
        const hero: DisplayNode[] = [];
        for (let i = 0; i < 5; i++) {
          const q = kit.P(`star.${i}`);
          if (kit.L(`star.${i}`) <= 0) continue;
          const x = colX + starR + i * starR * 2.5;
          const s = Math.max(0, q);
          hero.push(group([{ type: "path", d: starPath(x, starsTop, starR, starR * 0.45, 5), fill: starFill }], { transform: [s, 0, 0, s, x - s * x, starsTop - s * starsTop] }));
        }
        if (quotePlan) hero.push(...kit.type(quotePlan, { fill: pal.ink }));
        const meta: DisplayNode[] = [];
        if (namePlan) meta.push(...kit.type(namePlan, { fill: metaInk(pal) }));
        if (notePlan) meta.push(...kit.type(notePlan, { fill: metaInk(pal) }));
        meta.push(...signNodes(c, kit, sign, signPlan, "brand", colX, signY, pal.ink), ...facts.draw(kit, metaInk(pal)));
        return [
          { role: "ground", nodes: field },
          { role: "ghost", nodes: ghosts },
          { role: "subject", nodes: subject, push: 0 },
          { role: "hero", nodes: hero },
          { role: "meta", nodes: meta },
        ];
      },
    };
  },
});
