/**
 * Logo Sting: a type event. The brand's name, as written, is set as a justified stack that fills the width in the
 * hero face and rises letter by letter from under its own line in polished light metal; the brand's mark lands after
 * it as the punctuation, and the line under it cuts up in the accent italic. Behind, rows of the name in giant filled
 * tonal type cross the frame and drift opposite ways; a soft horizon of light sits under the name. The address and a
 * corner note sit on the corners, an index arrow in the last. Through the hold the type plane pushes in and a band of
 * light crosses the name twice. The last frame is the poster.
 */

import { about, group, type DisplayNode, type Paint } from "../../display";
import { ensureContrast, fieldStops, mixOk, withLightness } from "../../color";
import { bands, capBand, fitLines, footRow, ghost, litField, metaInk, moveLines, posterScene, shadowed, stackLanded, topSite } from "./poster";
import { logoNode, sampleMark } from "./kit";

export default posterScene({
  id: "marketing/logo-sting",
  name: "Logo Sting",
  pairing: "T3",
  look: "dark",
  build(c) {
    const { S, safe, pal, design } = c;
    const name = c.recipe.brand.name.trim();
    const logo = c.input.logo && c.input.logo.w > 0 && c.input.logo.h > 0 ? c.input.logo : null;
    const metaSize = S * (c.cover ? 0.024 : 0.02);
    // The mark, never the name again (the name is the hero): a symbol logo as it is; the sample lockups by their
    // symbol alone (the square at their left); a wide wordmark is left out of the corner.
    const markH = S * (c.cover ? 0.06 : 0.05);
    const aspect = logo ? logo.w / logo.h : 0;
    const crop = logo && aspect > 1.6 && sampleMark(c) ? { x: 0, y: 0, w: 1 / aspect, h: 1 } : undefined;
    const mark = logo && (aspect <= 1.6 || crop) ? { w: crop ? markH : Math.min(S * 0.2, markH * aspect), h: markH, crop } : null;
    const site = topSite(c, mark ? { w: mark.w, h: mark.h, overflow: false, set: null, nodes: () => [] } : null, metaSize, { width: safe.w * 0.55 });

    const b = bands(c, { topRow: mark?.h ?? metaSize, gap: S * 0.07 });
    const tagSize = S * (c.cover ? 0.058 : 0.05);
    const width = c.wide ? safe.w * 0.7 : safe.w;
    // The name fills the width; the tagline hangs under it (its room kept below).
    const tag0 = c.set("tagline", c.field("tagline"), { role: "accent", x: safe.x, y: 0, width, maxLines: 2, max: tagSize, min: S * 0.036, align: "left", preset: "cut-rise" });
    const tagH = tag0 ? capBand(tag0).h + S * 0.07 : 0;
    const hero = name ? fitLines(c, "brand", name, { family: c.recipe.brand.fonts.heading?.trim() || undefined, weight: 700, tracking: 0, x: safe.x, top: b.top, room: b.bottom - b.top - tagH, centre: design.h * 0.45 - tagH / 2, width, maxLines: 2, max: c.wide ? design.h * 0.32 : S * 0.42, min: S * 0.08, align: "left", preset: "focus-in", fill: 0.99, ratio: 1.5, gap: 0.16 }) : null;
    const tagY = hero ? hero.band.y + hero.band.h + S * 0.06 : b.top;
    const tag = tag0 && hero ? c.set("tagline", c.field("tagline"), { role: "accent", x: safe.x, y: tagY, width, maxLines: 2, max: tag0.size, min: tag0.size, align: "left", preset: "cut-rise" }) : tag0;

    const k = c.spread(2.8, 1.6);
    // Its own move: the name racks into focus word by word from a soft, slightly larger blur (a lens finding it); a
    // glint of light crosses the metal once it has settled, and again later.
    const plans = hero ? moveLines(c, hero, { in: "focus-in", at: 0, hero: true, loop: "light-sweep", loopAt: 1.6, loopEvery: 1.8 }, "brand", 0.16) : [];
    const landed = plans.length ? stackLanded(plans) : 0.8;
    const tagPlan = tag ? c.move(tag, { in: "cut-rise", at: landed + 0.1 * k }) : null;
    // The mark lands last, the punctuation: it pops in with a small turn that settles.
    if (mark) c.ev("mark", "pop", Math.max(landed + 0.25, (tagPlan?.settled ?? landed) - 0.1), 0.55, "pop");
    const sitePlan = site ? c.move(site, { in: "fade-rise", at: 0.3, rate: 26 }) : null;
    const row = footRow(c, (tagPlan?.settled ?? landed) + 0.1);

    // One row of the name behind, at the foot: below the corner row, whole words from the left margin, cropped only by
    // the bottom edge, one faint step from the field.
    const stops = fieldStops(pal);
    const ghostGround = mixOk(stops.dark, stops.light, 0.25);
    const rowSize = S * (c.wide ? 0.3 : 0.36);
    const repeat = name ? Array.from({ length: 3 }, () => name).join("  ") : "";
    const rowY = safe.y + safe.h + S * 0.045;
    // Light metal (dark looks): a bright top, a cool tinted shoulder, a soft darker horizon at the middle, paper again,
    // then a pale tinted foot, smoothly blended (chrome, never one hard stripe).
    const tint = mixOk(pal.paper, pal.brand[0], 0.25);
    const metal = (s: { lines: { y: number; baseline: number }[]; cap: { top: number } }): Paint => {
      const top = s.lines[0].y + s.cap.top;
      const bot = s.lines[0].baseline;
      return c.dark
        ? { kind: "linear", x0: 0, y0: top, x1: 0, y1: bot, stops: [{ at: 0, color: "#ffffff" }, { at: 0.38, color: ensureContrast(withLightness(tint, 0.88), pal.ground, 4.5) }, { at: 0.5, color: ensureContrast(withLightness(tint, 0.68), pal.ground, 4.5) }, { at: 0.62, color: pal.paper }, { at: 1, color: ensureContrast(withLightness(tint, 0.93), pal.ground, 4.5) }] }
        : pal.ink;
    };

    return {
      overflow: [...(hero?.overflow ? ["brand"] : []), ...(tag?.overflow ? ["tagline"] : []), ...(site?.overflow ? ["website"] : []), ...row.overflow],
      signature: landed + 0.3,
      camera: (t) => ({ x: 0, y: -18 * (1 - Math.min(1, t / c.last)) ** 2 }),
      draw(t, kit) {
        const field = litField(c, t, { from: "tl", stops });
        const ghosts: DisplayNode[] = repeat ? [ghost(c, { field: "brand", lines: [repeat], size: rowSize, x: safe.x, y: rowY, t, leading: 1, ground: ghostGround, dir: 1, weight: 700, family: c.recipe.brand.fonts.heading?.trim() || undefined })] : [];
        const atmosphere: DisplayNode[] = [];
        const heroNodes: DisplayNode[] = [];
        if (hero) {
          const words = hero.sets.flatMap((s, i) => kit.type(plans[i], { fill: metal(s), sweep: "#ffffff", sweepAlpha: 0.55 }));
          if (t >= landed) heroNodes.push(...shadowed(c, words, hero.size, hero.band, `ls|${name}|${hero.size}`));
          heroNodes.push(...words);
        }
        const meta: DisplayNode[] = [];
        if (mark) {
          const lin = kit.L("mark");
          if (lin > 0) {
            const p = kit.P("mark");
            const node = logoNode(c, { x: safe.x, y: safe.y, w: mark.w, h: mark.h, ...(mark.crop && { crop: mark.crop }) }, pal.ink);
            meta.push(group([node], { ...(p < 1 && { transform: about(safe.x + mark.w / 2, safe.y + mark.h / 2, 0.6 + 0.4 * p, (1 - Math.min(1, p)) * -0.105) }), ...(lin < 0.4 && { opacity: lin / 0.4 }) }));
          }
        }
        if (tagPlan) meta.push(...kit.type(tagPlan, { fill: pal.ink }));
        if (sitePlan) meta.push(...kit.type(sitePlan, { fill: metaInk(pal), caret: pal.accent }));
        meta.push(...row.draw(kit, metaInk(pal), pal.ink));
        return [
          { role: "ground", nodes: field },
          { role: "atmosphere", nodes: atmosphere },
          { role: "ghost", nodes: ghosts },
          { role: "hero", nodes: heroNodes },
          { role: "meta", nodes: meta },
        ];
      },
    };
  },
});
