/**
 * Line-Art Reveal: one continuous line in the brand's colour runs in along the ground, traces the product's outline
 * (from the cut-out's own edge), and runs on out; then an arch of the brand's colour rises behind the product as it
 * fills in from the ground up, the line steps back, the headline and the call to action set under it with a drawn
 * underline, and the brand signs off (its logo, else its name). A photo without transparency gets a rounded frame traced
 * round it instead. Editorial and quiet: a fine line, generous space; the beats spread over the clip's length.
 */

import { group, mixHex, type DisplayNode, type Matrix } from "../../display";
import { lineRuns } from "../end-card/shared";
import { brandMark, contactShadow, ev, fitBox, heroOf, logoNode, marketingScene, MIN_HEAD, riseReveal, risingLines, setText, spread, textBlock } from "./kit";

/** A rounded frame as path data from its bottom centre, clockwise on screen (left first), and its length. */
export function framePath(x: number, y: number, w: number, h: number, r: number): { d: string; length: number } {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const cx = x + w / 2;
  const b = y + h;
  const d = [`M${cx} ${b}`, `H${x + rr}`, `A${rr} ${rr} 0 0 1 ${x} ${b - rr}`, `V${y + rr}`, `A${rr} ${rr} 0 0 1 ${x + rr} ${y}`, `H${x + w - rr}`, `A${rr} ${rr} 0 0 1 ${x + w} ${y + rr}`, `V${b - rr}`, `A${rr} ${rr} 0 0 1 ${x + w - rr} ${b}`, "Z"].join(" ");
  return { d, length: 2 * (w - 2 * rr) + 2 * (h - 2 * rr) + 2 * Math.PI * rr };
}

/** An arch (a round top on straight sides) standing on y = foot. */
const archPath = (cx: number, foot: number, w: number, h: number): string => {
  const r = w / 2;
  return `M${cx - r} ${foot}V${foot - h + r}A${r} ${r} 0 0 1 ${cx + r} ${foot - h + r}V${foot}Z`;
};

export default marketingScene({
  id: "marketing/line-reveal",
  name: "Line-Art Reveal",
  look: "light",
  build(c) {
    const { S, safe, palette: pal, design } = c;
    const hero = heroOf(c);
    const width = c.recipe.controls?.line === "bold" ? S * 0.008 : S * 0.0045;
    const line = pal.mark;
    // The picture's box, and where the words go.
    const side = c.wide;
    const textLeft = side ? safe.x + safe.w * 0.54 : safe.x;
    const textW = side ? safe.w * 0.46 : safe.w;
    const head = setText(c, c.field("headline"), { weight: 700, width: textW, maxLines: 3, max: S * (side ? 0.09 : c.tall ? 0.105 : 0.09), min: S * MIN_HEAD, lineHeight: 1.08 });
    const cta = setText(c, c.field("cta"), { family: "body", weight: 600, width: textW, maxLines: 1, max: S * (c.tall ? 0.05 : 0.045), min: S * 0.036 });
    // The sign-off: on top of a tall or square frame, under the words on a wide one. A logo that is the picture already
    // (no product) is not shown twice.
    const signs = !(hero?.src === "logo");
    const mark = signs ? brandMark(c, { maxW: S * (side ? 0.32 : 0.42), h: S * (c.tall ? 0.08 : 0.065), color: pal.ink, minName: 0.036 }) : null;
    const markRoom = mark && !side ? mark.h + S * 0.06 : 0;
    const gapT = S * 0.035;
    const ctaH = cta ? cta.size * 1.6 : 0;
    const textH = (head?.height ?? 0) + (cta ? (head ? gapT : 0) + ctaH : 0) + (mark && side ? S * 0.06 + mark.h : 0);
    // Stacked, the picture takes what the words leave, and the whole is centred.
    const gapPic = S * 0.08;
    const avail = safe.h - markRoom;
    const picH = side ? safe.h * 0.84 : Math.min(avail * 0.66, avail - textH - gapPic);
    const block = picH + gapPic + textH;
    const picTop = safe.y + markRoom + Math.max(0, (avail - block) / 2);
    const picBox = side ? { x: safe.x + safe.w * 0.02, y: safe.y + safe.h * 0.08, w: safe.w * 0.44, h: picH } : { x: safe.x + safe.w * 0.05, y: picTop, w: safe.w * 0.9, h: picH };

    // The picture standing on its line.
    const img = hero ? fitBox(hero, picBox, true) : null;
    const outline = hero?.src === "product" ? (c.input.outlines?.product ?? null) : null;
    let trace: { d: string; length: number; m?: Matrix; scale: number } | null = null;
    let start: [number, number] = [design.w / 2, picBox.y + picBox.h];
    if (img && outline) {
      const k = img.w / outline.w;
      trace = { d: outline.d, length: outline.length, m: [k, 0, 0, k, img.x, img.y], scale: k };
      start = [img.x + outline.start[0] * k, img.y + outline.start[1] * k];
    } else if (img) {
      const pad = S * 0.03;
      const f = framePath(img.x - pad, img.y - pad, img.w + 2 * pad, img.h + 2 * pad, S * 0.035);
      trace = { ...f, scale: 1 };
      start = [img.x + img.w / 2, img.y + img.h + pad];
    }
    const foot = start[1];
    const lineFrom = side ? picBox.x : safe.x;
    const lineTo = side ? picBox.x + picBox.w : safe.x + safe.w;
    // The arch of the brand's colour behind the product (a soft tint of it on the ground).
    const archW = img ? Math.min(picBox.w * 0.92, Math.max(img.w * 1.35, img.h * 0.62)) : 0;
    const archH = img ? Math.min(foot - picBox.y + S * 0.02, Math.max(img.h * 1.08, archW * 0.9)) : 0;
    const archFill = mixHex(pal.ground, pal.look === "light" ? pal.accent : pal.mark, pal.look === "light" ? 0.12 : 0.2);
    const arch = img ? archPath(start[0], foot, archW, archH) : "";
    const archBox = { x: start[0] - archW / 2, y: foot - archH, w: archW, h: archH };

    // The words under the picture (beside it on a wide frame).
    const textTop = side ? safe.y + (safe.h - textH) / 2 : Math.min(safe.y + safe.h - textH, foot + gapPic);
    const headB = head ? textBlock("headline", head, { y: textTop, color: pal.ink, ...(side ? { left: textLeft, width: textW } : { cx: design.w / 2 }) }) : null;
    const ctaY = textTop + (head ? head.height + gapT : 0);
    const ctaB = cta ? textBlock("cta", cta, { y: ctaY, color: pal.ink, ...(side ? { left: textLeft, width: textW } : { cx: design.w / 2 }) }) : null;
    const markTop = side ? ctaY + ctaH + S * 0.06 : safe.y;
    const markCx = side ? textLeft + (mark?.w ?? 0) / 2 : design.w / 2;

    // Paced to the clip: a longer one draws more slowly (up to a point) and leaves more room between the beats.
    const k = spread(c, 3.1, 1.8);
    const traceDur = Math.min(1.8, 1.25 * k);
    const lines = head?.lines.length ?? 0;
    const fillAt = 0.32 * k + traceDur * 0.75;
    const wordsAt = fillAt + 0.55 * k;
    const ctaAt = wordsAt + 0.3 * k + lines * 0.09;
    const events = [
      ev("ground.a", "draw", 0, 0.4 * k, "draw"),
      ...(trace ? [ev("trace", "draw", 0.32 * k, traceDur, "draw")] : []),
      ev("ground.b", "draw", 0.32 * k + traceDur - 0.08, 0.35 * k, "draw"),
      ...(img ? [ev("arch", "draw", fillAt - 0.15, 0.85 * k, "glide"), ev("fill", "draw", fillAt, 0.75 * k, "glide"), ev("shadow", "fade", fillAt + 0.1, 0.6, "enter"), ev("trace.out", "fade", fillAt + 0.55 * k, 0.5, "enter")] : []),
      ...Array.from({ length: lines }, (_, i) => ev(`head.${i}`, "enter", wordsAt + i * 0.09, 0.55, "glide", { group: "head", unit: "elements" })),
      ...(cta ? [ev("cta", "enter", ctaAt, 0.45, "glide"), ev("cta.line", "draw", ctaAt + 0.15, 0.5, "draw")] : []),
      ...(mark ? [ev("brand", "enter", ctaAt + 0.45 * k, 0.6, "glide")] : []),
    ];

    return {
      events,
      overflow: [...(head?.overflow ? ["headline"] : []), ...(cta?.overflow ? ["cta"] : []), ...(mark?.overflow ? ["brand"] : [])],
      signature: 0.32 * k + traceDur * 0.6,
      frame(_t, P, Lp) {
        const nodes: DisplayNode[] = [];
        const a = P("arch");
        if (a > 0 && img) nodes.push(riseReveal([{ type: "path", d: arch, fill: archFill }], archBox, a, archH * 0.1));
        const ga = P("ground.a");
        const gb = P("ground.b");
        if (ga > 0) nodes.push({ type: "path", d: `M${lineFrom} ${foot}H${start[0]}`, stroke: { paint: line, width, trim: ga, length: start[0] - lineFrom, cap: "round" } });
        if (gb > 0) nodes.push({ type: "path", d: `M${start[0]} ${foot}H${lineTo}`, stroke: { paint: line, width, trim: gb, length: lineTo - start[0], cap: "round" } });
        if (img && hero) {
          const sh = P("shadow");
          if (sh > 0) nodes.push(contactShadow(start[0], foot, img.w * 0.8, archFill, 0.3, sh));
          const fill = P("fill");
          const pic: DisplayNode = hero.src === "logo" ? logoNode(c, img, pal.ink) : { type: "image", src: hero.src, x: img.x, y: img.y, w: img.w, h: img.h };
          if (fill > 0) nodes.push(riseReveal([pic], img, fill, img.h * 0.12));
        }
        if (trace) {
          const tr = P("trace");
          const out = P("trace.out");
          if (tr > 0 && out < 1) nodes.push({ type: "path", d: trace.d, ...(trace.m && { transform: trace.m }), stroke: { paint: line, width: width / trace.scale, trim: tr, length: trace.length, cap: "round", join: "round" }, ...(out > 0 && { opacity: 1 - out }) });
        }
        if (headB) nodes.push(...risingLines(headB, (i) => P(`head.${i}`)));
        if (ctaB && cta) {
          const p = P("cta");
          if (p > 0) nodes.push(group([lineRuns(ctaB)], { transform: [1, 0, 0, 1, 0, (1 - p) * S * 0.02], ...(p < 1 && { opacity: p }) }));
          const u = P("cta.line");
          if (u > 0) {
            const w0 = cta.lines[0]?.width ?? 0;
            const x0 = side ? (cta.dir === "rtl" ? textLeft + textW - w0 : textLeft) : design.w / 2 - w0 / 2;
            const y0 = ctaY + cta.size * 1.32;
            nodes.push({ type: "path", d: `M${x0} ${y0}H${x0 + w0}`, stroke: { paint: pal.mark, width: Math.max(2, S * 0.004), trim: u, length: w0, cap: "round" } });
          }
        }
        if (mark) nodes.push(...mark.draw(markCx, markTop, P("brand"), Lp("brand")));
        return { nodes };
      },
    };
  },
});
