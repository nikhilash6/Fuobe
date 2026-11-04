/**
 * Kind Words: three customers' words, the first as the poster's hero. It is set large on a deep lit field in a quiet
 * serif in the accent (or paper when the accent doesn't read), its opening mark hung in the margin, its stars popping
 * in above it and the name typing on under it. A giant filled quote mark one tone off the field bleeds off the left
 * edge behind it. The other two follow as paper cards, each as wide as its words, overlapping a little on purpose,
 * with a contact and an ambient shadow, sliding a short way in with their words riding inside; their stars are
 * filled in the accent on the quote's line. The brand, the address, a corner note and an index arrow sit on the
 * corners. Through the hold the type plane pushes in.
 */

import { group, type DisplayNode } from "../../display";
import { contrastOf, ensureContrast, fieldStops, fromLch, lchOf, mixOk } from "../../color";
import { twoShadow } from "../../fx/depth";
import { rotation } from "../../fx/overlays";
import type { TypePlan } from "../../type/animate";
import { moveSet, type TypeSet } from "../../type/glyphs";
import { starPath } from "./kit";
import { bands, brandSign, capAt, capBand, footRow, ghost, litField, metaInk, posterScene, signIn, signNodes, topSite } from "./poster";

interface Card {
  i: number;
  box: { x: number; y: number; w: number; h: number };
  quote: TypeSet;
  name: TypeSet | null;
  deg: number;
  starY: number;
  starX: number;
  /** The first quote: on the field, no card. */
  hero: boolean;
  plate: string;
  ink: string;
}

export default posterScene({
  id: "marketing/testimonials",
  name: "Kind Words",
  pairing: "T9",
  look: "dark",
  build(c) {
    const { S, safe, pal, design } = c;
    const side = c.wide;
    const signH = S * (c.cover ? 0.058 : 0.046);
    const sign = brandSign(c, { maxW: S * 0.42, h: signH, x: safe.x, y: safe.y, min: S * (c.cover ? 0.05 : 0.03) });
    const metaSize = S * (c.cover ? 0.024 : 0.02);
    const site = topSite(c, sign, metaSize);
    const b = bands(c, { topRow: sign?.h ?? metaSize, gap: S * 0.06 });
    const foot = metaSize * 1.1 + S * 0.05;
    const top = b.top;
    const bottom = b.bottom - foot;
    const items = [1, 2, 3].map((n) => ({ q: c.field(`quote${n}`), n: c.field(`name${n}`), key: n })).filter((x) => x.q);
    const rest = Math.max(0, items.length - 1);
    const starR = S * (c.cover ? 0.017 : 0.014);
    const nameSize = S * (c.cover ? 0.028 : 0.024);
    const starsW = 5 * starR * 2.4;
    const cardText = S * (c.cover ? 0.031 : 0.03);
    // The cards keep room for two lines of words; the hero takes the rest (the left half of a wide frame).
    const cardNeed = cardText * 2.4 + cardText * 1.5 + starR * 2 + S * 0.02;
    const overlap = -S * 0.025;
    const heroH = rest ? Math.max((bottom - top) * 0.44, bottom - top - rest * cardNeed + (rest - 1) * overlap - S * 0.06) : bottom - top;
    const heroBox = side ? { x: safe.x, y: top, w: safe.w * 0.52, h: bottom - top } : { x: safe.x, y: top, w: safe.w, h: heroH };
    // One material for every card: warm ivory paper with a faint tint of the brand.
    const plateOf = () => mixOk(mixOk(pal.paper, "#f3ece0", 0.7), pal.brand[0], 0.05);
    // The hero's ink: the accent when it reads at 4.5:1 on the field's lighter stop, else paper.
    const stops = { dark: fromLch(0.12, Math.max(0.05, lchOf(pal.brand[0]).C * 0.7), lchOf(pal.brand[0]).h), light: fromLch(0.3, Math.max(0.05, lchOf(pal.brand[0]).C * 0.8), (lchOf(pal.brand[0]).h + 340) % 360) };
    const heroInk = c.dark && contrastOf(pal.accent, stops.light) >= 4.5 && contrastOf(pal.accent, pal.ground) >= 4.6 ? pal.accent : pal.ink;
    const cards: Card[] = [];
    let heroBottom = top;
    let cardBottom = -Infinity;
    items.forEach((it, i) => {
      const hero = i === 0;
      if (hero) {
        const inner = { x: heroBox.x, w: heroBox.w };
        const name0 = it.n ? c.set(`name${it.key}`, it.n, { role: "meta", x: inner.x, y: 0, width: inner.w, maxLines: 1, max: nameSize * 1.1, min: S * 0.02 }) : null;
        const nameH = name0 ? capBand(name0).h : 0;
        const starsH = starR * 2 + S * 0.035;
        const qTop = heroBox.y + starsH;
        const qRoom = heroBox.h - starsH - nameH - S * 0.06;
        const qo = (max: number) => ({ role: "hero" as const, x: inner.x, y: qTop, width: inner.w, maxLines: 5, max, min: S * 0.03, leading: 1.08, preset: "cut-rise" as const, even: 0.4 });
        let quote = capAt(c, `quote${it.key}`, it.q, qo(Math.min(S * (side ? 0.09 : 0.125), qRoom / 1.2)));
        for (let j = 0; quote && j < 16 && capBand(quote).h > qRoom; j++) quote = capAt(c, `quote${it.key}`, it.q, qo(quote.size * 0.93));
        if (!quote) return;
        const hang = Math.max(0, inner.x - quote.ink.x);
        if (hang > 0.5) quote = capAt(c, `quote${it.key}`, it.q, { ...qo(quote.size), x: inner.x + hang, width: inner.w - hang, min: Math.min(quote.size, S * 0.03) }) ?? quote;
        const qBottom = quote.lines[quote.lines.length - 1].baseline;
        const name = name0 ? capAt(c, `name${it.key}`, it.n, { role: "meta", x: inner.x, y: qBottom + S * 0.045, width: inner.w, maxLines: 1, max: name0.size, min: Math.min(name0.size, S * 0.02) }) : null;
        heroBottom = name ? name.lines[0].baseline + name.size * 0.3 : qBottom + quote.size * 0.3;
        cards.push({ i, box: heroBox, quote, name, deg: 0, starY: heroBox.y + starR, starX: inner.x, hero, plate: pal.ground, ink: heroInk });
        return;
      }
      const plate = plateOf();
      const ink = ensureContrast(mixOk(pal.brand[0], "#101014", 0.35), plate, 7);
      const pad = cardText * 0.9;
      // Cards start at least 4 % of the short side below the hero's last line (its name).
      const zoneTop = side ? top : heroBottom + S * 0.045;
      const zoneH = bottom - zoneTop;
      const h = side ? (zoneH + (rest - 1) * overlap) / rest : Math.min(cardNeed * 1.25, (zoneH + (rest - 1) * overlap) / rest);
      const maxW = side ? safe.w * 0.44 : safe.w * 0.78;
      const x0 = side ? safe.x + safe.w * 0.56 : safe.x;
      // The card's words in the quote's serif, on two lines when they fit a little smaller (a balanced rag), else three.
      const qOpts = { role: "hero" as const, x: 0, y: 0, width: maxW - 2 * pad, leading: 1.18, preset: "fade-rise" as const };
      const two = c.set(`quote${it.key}`, it.q, { ...qOpts, maxLines: 2, max: cardText, min: cardText * 0.82 });
      const quote0 = two && !two.overflow ? two : c.set(`quote${it.key}`, it.q, { ...qOpts, maxLines: 3, max: cardText, min: S * 0.026 });
      if (!quote0) return;
      const textW = Math.max(...quote0.lines.map((l) => l.ink.w), starsW + S * 0.2);
      const w = Math.min(maxW, textW + 2 * pad);
      const x = side ? x0 : (i - 1) % 2 ? safe.x + safe.w - w : x0;
      const y = Math.max(cardBottom + S * 0.03, zoneTop + (i - 1) * (h - overlap) + (side ? 0 : Math.max(0, zoneH - (rest * h - (rest - 1) * overlap)) * 0.5));
      const quote = capAt(c, `quote${it.key}`, it.q, { ...qOpts, x: x + pad, y: y + pad, width: w - 2 * pad + 1, maxLines: quote0.lines.length, max: quote0.size, min: quote0.size });
      if (!quote) return;
      const qBottom = quote.lines[quote.lines.length - 1].baseline;
      const starY = qBottom + cardText * 0.9 + starR;
      const name0 = it.n ? c.set(`name${it.key}`, it.n, { role: "meta", x: x + pad + starsW + S * 0.015, y: 0, width: w - 2 * pad - starsW - S * 0.015, maxLines: 1, max: nameSize, min: S * 0.02 }) : null;
      const name = name0 ? capAt(c, `name${it.key}`, it.n, { role: "meta", x: x + pad + starsW + S * 0.015, y: starY - capBand(name0).h / 2, width: w - 2 * pad - starsW - S * 0.015, maxLines: 1, max: name0.size, min: name0.size }) : null;
      const boxH = Math.max(h, starY + starR + pad * 0.8 - y);
      cardBottom = y + boxH;
      cards.push({ i, box: { x, y, w, h: boxH }, quote, name, deg: [-3, 2.5][(i - 1) % 2], starY, starX: x + pad, hero: false, plate, ink });
    });
    // The cards keep clear of the foot row: lifted together (never into the hero) when the last runs low.
    const lastCard = cards[cards.length - 1];
    const lift = lastCard && !lastCard.hero ? Math.min(lastCard.box.y + lastCard.box.h - (bottom - S * 0.03), (cards[1]?.box.y ?? 0) - (heroBottom + S * 0.03)) : 0;
    if (lift > 0) {
      for (const cd of cards) {
        if (cd.hero) continue;
        cd.box = { ...cd.box, y: cd.box.y - lift };
        cd.starY -= lift;
        cd.quote = moveSet(cd.quote, 0, -lift);
        if (cd.name) cd.name = moveSet(cd.name, 0, -lift);
      }
    }

    const k = c.spread(3.4, 1.5);
    const quotePlans: TypePlan[] = [];
    const namePlans: (TypePlan | null)[] = [];
    let at = 0.03;
    cards.forEach((cd, i) => {
      c.ev(`card.${i}`, "enter", at, 0.55, "settle");
      for (let s = 0; s < 5; s++) c.ev(`star.${i}.${s}`, "pop", at + (cd.hero ? 0.05 : 0.3) + s * 0.08, 0.4, "pop", { group: `stars.${i}`, unit: "elements" });
      // A card's words arrive with it (never an empty box).
      const q = c.move(cd.quote, cd.hero ? { in: "cut-rise", at: at + 0.12 } : { in: "fade-rise", at, intensity: 0 });
      quotePlans.push(q);
      namePlans.push(cd.name ? c.move(cd.name, { in: "fade-rise", at: q.settled - 0.1, rate: 30 }) : null);
      at = cd.hero ? q.settled - 0.15 : at + 0.32 * k;
    });
    const signPlan = signIn(c, sign, "brand", 0.25);
    const sitePlan = site ? c.move(site, { in: "fade-rise", at: 0.4, rate: 26 }) : null;
    const row = footRow(c, at + 0.2);
    const starFill = ensureContrast(pal.accent, stops.light, 3);
    const markGround = mixOk(stops.dark, stops.light, 0.75);
    const heroSet = cards[0]?.hero ? cards[0].quote : null;
    // The mark only where the hero leaves the right side free (never under its words).
    const free = heroSet ? safe.x + safe.w - Math.max(...heroSet.lines.map((l) => l.ink.x + l.ink.w)) - S * 0.04 : 0;
    const ghostSize = free >= S * 0.16 ? Math.min(design.h * 0.4, free / 0.5) : 0;

    return {
      overflow: [...cards.flatMap((cd) => [...(cd.quote.overflow ? [cd.quote.field] : []), ...(cd.name?.overflow ? [cd.name.field] : [])]), ...(sign?.overflow ? ["brand"] : []), ...(site?.overflow ? ["website"] : []), ...row.overflow],
      signature: at + 0.2,
      camera: (t) => ({ x: 0, y: 24 * (1 - Math.min(1, t / c.last)) ** 2 }),
      draw(t, kit) {
        // Night: deep navy to a dusk blue, a warm window light from the top right.
        const field = c.dark ? litField(c, t, { from: "tr", stops, light: mixOk(pal.brand[1], "#ffd9a0", 0.5), lightAlpha: 0.22 }) : litField(c, t, { from: "tr", stops: fieldStops(pal) });
        // A giant quote mark, one tone off the field, bleeding off the left edge behind the hero.
        // A giant quote mark, one faint tone off the field, whole, at the right behind the hero's end and the cards.
        const ghosts: DisplayNode[] = heroSet && ghostSize > 0 ? [ghost(c, { field: heroSet.field, lines: ["”"], size: ghostSize, x: safe.x + safe.w + S * 0.02, align: "right", y: heroSet.lines[0].y - ghostSize * 0.1, t, ground: markGround, family: c.pairing.hero.family })] : [];
        const hero: DisplayNode[] = [];
        const subject: DisplayNode[] = [];
        cards.forEach((cd, i) => {
          const lin = kit.L(`card.${i}`);
          if (lin <= 0) return;
          const p = kit.P(`card.${i}`);
          const bx = cd.box;
          const inside: DisplayNode[] = [];
          for (let s = 0; s < 5; s++) {
            const q = kit.P(`star.${i}.${s}`);
            if (kit.L(`star.${i}.${s}`) <= 0) continue;
            const x = cd.starX + starR + s * starR * 2.4;
            const y = cd.starY;
            inside.push(group([{ type: "path", d: starPath(x, y, starR, starR * 0.45, 5), fill: cd.hero ? starFill : ensureContrast(pal.accent, cd.plate, 2.2) }], { transform: [q, 0, 0, q, x - q * x, y - q * y] }));
          }
          inside.push(...kit.type(quotePlans[i], { fill: cd.ink }));
          const np = namePlans[i];
          if (np) inside.push(...kit.type(np, { fill: cd.hero ? metaInk(pal) : metaInk({ ...pal, ink: cd.ink, ground: cd.plate }) }));
          if (cd.hero) {
            hero.push(...inside);
            return;
          }
          // A short slide (never a long smear), the words inside it.
          const dx = (1 - p) * S * 0.14 * (i % 2 ? -1 : 1);
          const rect: DisplayNode = { type: "rect", ...bx, r: S * 0.014, fill: cd.plate, stroke: { paint: mixOk(starFill, cd.plate, 0.45), width: Math.max(1, S * 0.001) } };
          // It swings level as it lands (never tilted at rest).
          const rot = rotation(cd.deg * (1 - p), bx.x + bx.w / 2, bx.y + bx.h / 2);
          subject.push(group([...twoShadow({ nodes: [rect], size: bx.h, ground: stops.dark, bounds: bx, key: `kw|${bx.w.toFixed(0)}x${bx.h.toFixed(0)}` }), rect, ...inside], { transform: [rot[0], rot[1], rot[2], rot[3], rot[4] + dx, rot[5]], ...(lin < 0.15 && { opacity: lin / 0.15 }) }));
        });
        const meta = [...signNodes(c, kit, sign, signPlan, "brand", safe.x, safe.y, pal.ink), ...(sitePlan ? kit.type(sitePlan, { fill: metaInk(pal), caret: pal.accent }) : []), ...row.draw(kit, metaInk(pal), pal.ink)];
        return [
          { role: "ground", nodes: field },
          { role: "ghost", nodes: ghosts },
          { role: "hero", nodes: hero },
          { role: "overlay", nodes: subject },
          { role: "meta", nodes: meta },
        ];
      },
    };
  },
});
