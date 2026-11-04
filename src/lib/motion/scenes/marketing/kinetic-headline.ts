/**
 * Kinetic Headline: a wide, confident statement set as a justified stack, each line fitted to the full width on its
 * own, cut in letter by letter from under its line on a lit two-tone field. A giant filled ghost of the same words,
 * one tonal step from the ground, drifts behind it, cropped by the frame; the words the person marked with *stars* get
 * a skewed highlighter that wipes in just before they land. The brand and the address sit on the top corners, a corner
 * note and an index arrow on the bottom ones, and the call to action lands in a tilted pill above them. Through the
 * hold the type plane pushes in, the ghost drifts and a band of light crosses the words twice. The last frame is the
 * poster.
 */

import { group, translate, type DisplayNode } from "../../display";
import { highlighter } from "../../fx/overlays";
import { asDecor, bands, brandSign, fitLines, footRow, ghostSpan, litField, markColor, metaInk, moveLines, pillOn, posterScene, shadowed, stackLanded, topSite } from "./poster";
import { ensureContrast, fieldStops, mixOk } from "../../color";
import { marked } from "./kit";

export default posterScene({
  id: "marketing/kinetic-headline",
  name: "Kinetic Headline",
  pairing: "T1",
  look: "dark",
  build(c) {
    const { S, safe, pal, design } = c;
    const typed = c.field("headline") || c.recipe.brand.name.trim();
    const m = marked(typed);
    const lead = m.text.length - m.text.trimStart().length;
    const text = m.text.trim();
    const marks = m.marks.map(([a, b]) => [a - lead, b - lead] as const);
    const centred = c.recipe.controls?.align === "centre";
    const align = centred ? "centre" : "left";

    // The top corner row: the brand (left), the address (right).
    const markH = S * (c.cover ? 0.058 : 0.046);
    const sign = brandSign(c, { maxW: S * 0.36, h: markH, x: safe.x, y: safe.y, min: S * (c.cover ? 0.05 : 0.03) });
    const metaSize = S * (c.cover ? 0.024 : 0.02);
    const site = topSite(c, sign, metaSize);

    // The bottom corner row stands on the safe line; the call to action sits just above it.
    const ctaSize = S * (c.cover ? 0.056 : 0.044);
    const ctaPad = { x: ctaSize * 0.6, y: ctaSize * 0.35 };
    const foot = S * (c.cover ? 0.024 : 0.02) * 1.1;
    const ctaY = safe.y + safe.h - foot - S * 0.05 - ctaSize * 1.2 - ctaPad.y;
    const cta = c.set("cta", c.field("cta"), { role: "body", weight: 600, x: centred ? design.w / 2 - safe.w * 0.4 : safe.x + ctaPad.x, y: ctaY, width: safe.w * 0.8 - ctaPad.x * 2, maxLines: 1, max: ctaSize, min: ctaSize * 0.75, align: centred ? "centre" : "left" });

    // The hero fills the room between, every line fitted to the width, its centre near 45 % of the height.
    const b = bands(c, { topRow: sign?.h ?? metaSize, gap: S * 0.06 });
    const bottom = (cta ? ctaY - ctaPad.y : b.bottom) - S * 0.06;
    const width = c.wide ? safe.w * 0.6 : safe.w;
    const hero = fitLines(c, "headline", text, { x: centred ? design.w / 2 - width / 2 : safe.x, top: b.top, room: bottom - b.top, centre: c.wide ? (b.top + bottom) / 2 : design.h * 0.45, width, maxLines: c.wide ? 3 : 4, max: c.wide ? design.h * 0.3 : S * 0.5, min: S * 0.1, align, preset: "cut-rise-glyph", fill: 0.995, ratio: 1.7, gap: 0.1, stack: true });

    const k = c.spread(3.2, 1.6);
    // From the first frames: the first glyph is under way by 0.07 s. After it lands, two bands of light cross it.
    const plans = hero ? moveLines(c, hero, { in: "cut-rise-glyph", at: 0.03, hero: true, loop: "light-sweep", loopAt: 1.9, loopEvery: 1.8 }, "headline", 0.12) : [];
    const landed = plans.length ? stackLanded(plans) : 0.8;

    // Marked words: a highlighter under each, wiping in 70 ms before its line lands.
    const marksAt: { li: number; x: number; w: number; capTop: number; baseline: number; key: string }[] = [];
    if (hero) {
      let at = 0;
      hero.sets.forEach((set, li) => {
        set.words.forEach((w, wi) => {
          at += w.gap.length;
          const a = at;
          const e = at + w.text.length;
          at = e;
          if (!marks.some(([p, q]) => p < e && q > a)) return;
          const line = set.lines[w.line];
          marksAt.push({ li, x: w.x, w: w.w, capTop: line.y + set.cap.top, baseline: line.baseline, key: `${li}.${wi}` });
        });
      });
    }
    marksAt.forEach((mk, j) => c.ev(`mark.${j}`, "draw", Math.max(0.1, (plans[mk.li]?.settled ?? landed) - 0.07 - 0.4 + 0.12 * j), 0.4, "snap"));

    const metaAt = Math.min(landed + 0.1 * k, c.room - 1);
    const signPlan = sign?.set ? c.move(sign.set, { in: "word-lift", at: 0.2 }) : null;
    if (sign && !sign.set) c.ev("brand", "enter", 0.2, 0.5, "glide");
    const sitePlan = site ? c.move(site, { in: "fade-rise", at: 0.35, rate: 26 }) : null;
    const ctaAt = metaAt + 0.1 * k;
    const ctaPlan = cta ? c.move(cta, { in: "word-lift", at: ctaAt + 0.04 }) : null;
    if (cta) c.ev("pill", "pop", ctaAt, 0.5, "pop");
    const row = footRow(c, metaAt + 0.2);

    // The ghost: the brand's name (never an echo of the hero's words), set across the frame behind the first lines,
    // filled one faint step from the ground, so it reads as texture and never as another line of the headline.
    const ghostWord = c.recipe.brand.name.trim() || (hero ? hero.sets[0].text.trim() : "");
    const ghostTop = hero ? Math.max(b.top - S * 0.06, hero.band.y - S * 0.04) / design.h : 0.2;
    const stops = fieldStops(pal);
    // The call to action: a paper tag with the hero's ink (never a third hue), level.
    const pillFill = pal.paper;
    const pillInk = mixOk(pal.night, pal.brand[0], 0.35);
    const heroInk = pal.ink;
    // The bar covers the marked words' whole cap band in one colour the words read on at 4.5:1 (never a glyph split
    // between two colours).
    const knock = false;
    const markInk = ensureContrast(markColor(c, pal.ground, heroInk), heroInk, 4.5);
    const ghostGround = mixOk(stops.dark, stops.light, 0.45);

    return {
      overflow: [...(hero?.overflow ? ["headline"] : []), ...(cta?.overflow ? ["cta"] : []), ...(site?.overflow ? ["website"] : []), ...(sign?.overflow ? ["brand"] : []), ...row.overflow],
      signature: landed + 0.5,
      camera: (t) => ({ x: 26 * (1 - Math.min(1, t / c.last)) ** 2, y: 0 }),
      draw(t, kit) {
        const field = litField(c, t, { from: "tr", stops });
        const ghostNodes: DisplayNode[] = ghostWord ? [ghostSpan(c, { field: "headline", text: ghostWord, top: ghostTop, t, ground: ghostGround, span: 1.04 })] : [];

        const heroNodes: DisplayNode[] = [];
        if (hero) {
          const words = hero.sets.flatMap((s, i) => kit.type(plans[i], { fill: heroInk, sweep: "#ffffff", sweepAlpha: 0.5 }));
          if (t >= landed) heroNodes.push(...shadowed(c, words, hero.size, hero.band, `kh|${text}|${hero.size}`));
          const knocks: DisplayNode[] = [];
          marksAt.forEach((mk, j) => {
            const hl = highlighter({ capTop: mk.capTop, baseline: mk.baseline, x: mk.x, w: mk.w, color: markInk, seed: c.seed, p: kit.P(`mark.${j}`), key: mk.key, cover: 1.14, skew: -3 });
            if (!hl) return;
            heroNodes.push(hl);
            if (knock && hl.type === "path") knocks.push(group(asDecor(kit.type(plans[mk.li], { fill: pal.paper })), { clip: { type: "path", d: hl.d } }));
          });
          heroNodes.push(...words, ...knocks);
        }
        const overlay: DisplayNode[] = [];
        if (cta && ctaPlan && kit.L("pill") > 0) overlay.push(pillOn(cta, kit.type(ctaPlan, { fill: pillInk }), pillFill, { deg: 0, p: kit.P("pill") }));
        const meta: DisplayNode[] = [];
        if (sign) {
          if (signPlan) meta.push(...kit.type(signPlan, { fill: pal.ink }));
          else {
            const p = kit.P("brand");
            const lin = kit.L("brand");
            if (lin > 0) meta.push(group(sign.nodes(safe.x, safe.y, pal.ink), { ...(p < 1 && { transform: translate(0, (1 - p) * S * 0.02) }), ...(lin < 0.5 && { opacity: lin / 0.5 }) }));
          }
        }
        if (sitePlan) meta.push(...kit.type(sitePlan, { fill: metaInk(pal), caret: pal.accent }));
        meta.push(...row.draw(kit, metaInk(pal), pal.ink));
        return [
          { role: "ground", nodes: field },
          { role: "ghost", nodes: ghostNodes },
          { role: "hero", nodes: heroNodes },
          { role: "overlay", nodes: overlay },
          { role: "meta", nodes: meta },
        ];
      },
    };
  },
});
