/**
 * Midnight Drop: a launch countdown. On a lit field of the brand's hue, the drop's name scrambles in as a justified
 * stack (each line fitted to the width, a short code landing huge) and locks clean, a giant filled copy of its last
 * line one tone off the field drifting behind. The countdown flips into place tile by tile on tiles a clear step off
 * the field, over a slit of the brand's light, and then ticks down second by second to exactly what was typed. The
 * time types on in the top corner, the call to action lands in a pill, and a corner note and the address sit on the
 * bottom corners.
 */

import { mixHex, type DisplayNode } from "../../display";
import { rgba } from "../../fx/background";
import { rule } from "../../fx/overlays";
import { chroma as toLabC, contrastOf, ensureContrast, mixOk, toLab, withLightness } from "../../color";
import { brandSign, capBand, fitLines, footRow, litField, metaInk, moveLines, onBaseline, pillOn, posterScene, shadowed, signIn, signNodes, stackLanded, toneOf, topSite } from "./poster";

export default posterScene({
  id: "marketing/drop-countdown",
  name: "Midnight Drop",
  pairing: "T3",
  look: "dark",
  build(c) {
    const { S, safe, pal, design } = c;
    const side = c.wide;
    const signH = S * (c.cover ? 0.058 : 0.046);
    const sign = brandSign(c, { maxW: S * 0.34, h: signH, x: safe.x, y: safe.y, min: S * (c.cover ? 0.056 : 0.03) });
    const metaSize = S * (c.cover ? 0.024 : 0.021);
    const when = topSite(c, sign, metaSize, { field: "when", width: safe.w * 0.6 });
    const top = safe.y + (sign?.h ?? metaSize) + S * 0.07;
    const colW = side ? safe.w * 0.6 : safe.w;
    const ctaSize = S * (c.cover ? 0.056 : 0.044);
    const footSize = S * (c.cover ? 0.024 : 0.02);
    const footH = footSize * 1.1 + S * 0.05;
    const ctaY = safe.y + safe.h - footH - ctaSize * 0.75 - ctaSize * 0.35;
    const row = footRow(c, 2.2);
    const site = onBaseline(c, "website", c.field("website"), { role: "meta", x: safe.x + safe.w * 0.4, width: safe.w * 0.48, maxLines: 1, max: footSize, min: footSize * 0.8, align: "right", preset: "fade-rise", y: 0 }, safe.y + safe.h - footSize * 0.25);
    const cta = c.set("cta", c.field("cta"), { role: "body", weight: 600, x: safe.x + ctaSize * 0.6, y: ctaY, width: safe.w * 0.7, maxLines: 1, max: ctaSize, min: S * 0.034 });
    const bottom = ctaY - ctaSize * 0.35 - S * 0.08;
    const room = bottom - top;
    // The countdown in tiles under the name: a third of the room at most.
    const countMax = Math.min(S * (side ? 0.12 : 0.16), room * 0.28);
    // Room between the tiles: each tile pads its figure by 8 % of the size a side, the figures sit 24 % apart.
    const countTrack = 0.24;
    const count0 = c.set("count", c.field("count"), { role: "figures", weight: 800, x: safe.x, y: 0, width: colW - countMax * 0.16, maxLines: 1, max: countMax, min: S * 0.06, tabular: true, preset: "split-flap", tracking: countTrack });
    const countH = count0 ? capBand(count0).h + count0.size * 0.5 : 0;
    const headRoom = room - countH - S * 0.07;
    const head = fitLines(c, "headline", c.field("headline"), { x: safe.x, top, room: headRoom, anchor: 0.3, width: colW, maxLines: 3, max: Math.min(S * 0.36, headRoom * 0.5), min: S * 0.1, preset: "scramble", leading: 0.88, fill: 0.98, ratio: 2.2, gap: 0.1, stack: true });
    const headB = head ? head.band : { x: safe.x, y: top, w: 0, h: 0 };
    const countY = headB.y + headB.h + S * 0.1 + (count0 ? count0.size * 0.25 : 0);
    // The row of tiles sits on the grid: the first tile's edge on the inset line.
    const countOpts = (text: string) => (count0 ? c.set("count", text, { role: "figures", weight: 800, x: safe.x + count0.size * 0.08, y: countY, width: colW - count0.size * 0.16, maxLines: 1, max: count0.size, min: count0.size, tabular: true, preset: "split-flap", tracking: countTrack }) : null);
    const typedCount = c.field("count");
    const count = countOpts(typedCount);

    const k = c.spread(3.2, 1.6);
    const headPlans = head ? moveLines(c, head, { in: "scramble", at: 0.03, hero: true }, "headline", 0.12) : [];
    const headDone = headPlans.length ? stackLanded(headPlans) : 0.8;
    c.ev("bars", "hero", 0, 1, "enter");
    // The clock starts flipping 200 ms after the name lands (nothing of it shows before), a few seconds over what was
    // typed, then ticks down a second at a time to exactly the typed value, a second before the end.
    const countAt = headDone + 0.2;
    // Ticks a second apart on the clip's clock, the last one landing just before the final frame (the poster shows
    // the typed value, and the clock never sits still for a second before it).
    const lastTick = c.last - 0.1;
    const flapDone = countAt + 1.0;
    const nTicks = Math.max(0, Math.min(4, Math.floor(lastTick - flapDone) + 1));
    const tail = /^(.*?)(\d{2})$/.exec(typedCount);
    const ticks = tail && Number(tail[2]) + nTicks <= 59 ? nTicks : 0;
    const shownAt = (n: number) => (tail ? `${tail[1]}${String(Number(tail[2]) + n).padStart(2, "0")}` : typedCount);
    const startSet = ticks ? countOpts(shownAt(ticks)) : count;
    const countPlan = startSet ? c.move(startSet, { in: "split-flap", at: countAt }) : null;
    const countDone = countPlan?.settled ?? headDone + 0.6;
    // The ticks: each value drawn from its moment (seconds 47, 46 … then the typed one); laid out once, at rest by then.
    const tickSets = Array.from({ length: ticks }, (_, i) => {
      const set = i === ticks - 1 ? count : countOpts(shownAt(ticks - 1 - i));
      const at = lastTick - (ticks - 1 - i);
      return set ? { at, plan: c.move(set, { in: "split-flap", at: 0.02 }, `count.tick${i}`) } : null;
    }).filter((x): x is { at: number; plan: ReturnType<typeof c.move> } => !!x);
    c.ev("rule", "draw", countDone - 0.1, 0.55, "draw");
    const whenPlan = when ? c.move(when, { in: "fade-rise", at: countDone + 0.05, rate: 30 }) : null;
    if (cta) c.ev("pill", "pop", countDone + 0.2 * k, 0.5, "pop");
    const ctaPlan = cta ? c.move(cta, { in: "word-lift", at: countDone + 0.2 * k + 0.08 }) : null;
    const signPlan = signIn(c, sign, "brand", 0.2);
    const sitePlan = site ? c.move(site, { in: "fade-rise", at: countDone + 0.2, rate: 30 }) : null;

    const ghostSize = Math.min(design.h * 0.55, (head?.size ?? S * 0.2) * 2.1);
    // Tiles a clear step off the ground (ΔL 0.12 or more), away from the figures' ink so the figures read on both halves.
    const inkLight = toLab(pal.ink).L > 0.6;
    const tile = c.dark ? withLightness(pal.ground, Math.min(0.45, toLab(pal.ground).L + 0.2)) : mixOk(pal.ground, inkLight ? pal.night : pal.paper, inkLight ? 0.4 : 0.6);
    // The figures read on the tile's darker lower half too.
    const countInk = ensureContrast(ensureContrast(pal.ink, mixHex(tile, "#000000", 0.12), 4.6), mixHex(tile, "#ffffff", 0.06), 4.6);
    // The call to action in the brand's own colour (the most vivid of the kit), words readable on it.
    const ctaFill = [pal.brand[0], pal.brand[1], pal.accent].sort((a, b) => toLabC(b) - toLabC(a))[0];
    const ctaInk = ensureContrast([pal.paper, pal.night].sort((a, b) => contrastOf(b, ctaFill) - contrastOf(a, ctaFill))[0], ctaFill, 4.5);
    const ruleY = count ? capBand(count).y + capBand(count).h + count.size * 0.42 : bottom;

    return {
      overflow: [...(head?.overflow ? ["headline"] : []), ...(count?.overflow ? ["count"] : []), ...(when?.overflow ? ["when"] : []), ...(cta?.overflow ? ["cta"] : []), ...(sign?.overflow ? ["brand"] : []), ...(site?.overflow ? ["website"] : []), ...row.overflow],
      signature: headDone + 0.05,
      camera: (t) => ({ x: 22 * (1 - Math.min(1, t / c.last)) ** 2, y: 0 }),
      draw(t, kit) {
        const field = litField(c, t, { from: "bl", light: pal.brand[0], lightAlpha: 0.22 });
        const b = kit.P("bars");
        // A slit of the brand's light behind the countdown (one soft band, never stripes).
        const slitY = count ? capBand(count).y + capBand(count).h / 2 : design.h * 0.6;
        const slitH = (count?.size ?? S * 0.12) * 1.6;
        const atmosphere: DisplayNode[] = [{ type: "rect", x: 0, y: slitY - slitH / 2, w: design.w, h: slitH, fill: { kind: "linear", x0: 0, y0: slitY - slitH / 2, x1: 0, y1: slitY + slitH / 2, stops: [{ at: 0, color: rgba(pal.brand[0], 0) }, { at: 0.5, color: rgba(pal.brand[0], 0.42 * b) }, { at: 1, color: rgba(pal.brand[0], 0) }] } }];
        // No ghost copy of the name (it read as a double of the hero).
        const ghosts: DisplayNode[] = [];
        void ghostSize;
        const hero: DisplayNode[] = [];
        if (head) {
          const nodes = head.sets.flatMap((_, i) => kit.type(headPlans[i], { fill: pal.ink }));
          if (t >= headDone) hero.push(...shadowed(c, nodes, head.size, headB, `md|${head.sets.map((s) => s.text).join("|")}|${head.size}`));
          hero.push(...nodes);
        }
        const tick = [...tickSets].reverse().find((s) => t >= s.at);
        if (count && (tick || (countPlan && t >= countAt))) {
          const nodes = tick ? kit.type(tick.plan, { fill: countInk, tile }) : kit.type(countPlan!, { fill: countInk, tile });
          hero.push(...shadowed(c, nodes, count.size * 0.6, capBand(count), `md-c|${count.size}`, 0.8), ...nodes);
        }
        const overlay: DisplayNode[] = [];
        const r = kit.P("rule");
        if (r > 0 && count) overlay.push(rule({ x: safe.x, y: ruleY, w: safe.w, color: toneOf(pal, 0.4), p: r }));
        if (cta && ctaPlan && kit.L("pill") > 0) {
          const p = kit.P("pill");
          // A squared tag on the tiles' left edge, level (the clock's own hardware look).
          overlay.push(pillOn(cta, kit.type(ctaPlan, { fill: ctaInk }), ctaFill, { deg: 0, p }));
        }
        const meta: DisplayNode[] = [...signNodes(c, kit, sign, signPlan, "brand", safe.x, safe.y, pal.ink), ...row.draw(kit, metaInk(pal))];
        if (whenPlan) meta.push(...kit.type(whenPlan, { fill: metaInk(pal), caret: pal.brand[0] }));
        if (sitePlan) meta.push(...kit.type(sitePlan, { fill: metaInk(pal) }));
        return [
          { role: "ground", nodes: field },
          { role: "atmosphere", nodes: atmosphere },
          { role: "ghost", nodes: ghosts },
          { role: "hero", nodes: hero },
          { role: "overlay", nodes: overlay },
          { role: "meta", nodes: meta },
        ];
      },
    };
  },
});
