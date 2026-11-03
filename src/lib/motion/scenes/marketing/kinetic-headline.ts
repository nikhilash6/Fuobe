/**
 * Kinetic Headline: the promise sets word by word on a beat. Each word lands with a spring and the words the person
 * marked with *stars* get a swatch in the kit's highlight colour (a lone star is part of the words and is drawn). The
 * camera leans in as each new line starts and keeps a slow push while the words are read. Then the words lift away and
 * the piece resolves to the logo with the Draw-on end card: on a dark brand colour the ground is that colour already,
 * so the card simply sets on it; otherwise the brand colour opens out from the middle of the frame.
 */

import { group, translate, type DisplayNode, type TextRun } from "../../display";
import { sample, type Key } from "../../tween";
import drawOn from "../end-card/draw-on";
import { glyphTop, lineLeft } from "../end-card/shared";
import { ev, marked, marketingScene, MIN_HEAD, setText, textBlock } from "./kit";

/** The end card's share of the clip. */
const CARD = 2.3;

export default marketingScene({
  id: "marketing/kinetic-headline",
  name: "Kinetic Headline",
  look: "light",
  build(c) {
    const { S, safe, palette: pal, design, recipe, pace } = c;
    const typed = c.field("headline") || recipe.brand.name.trim();
    const m = marked(typed);
    const lead = m.text.length - m.text.trimStart().length;
    const text = m.text.trim();
    const marks = m.marks.map(([a, b]) => [a - lead, b - lead] as const);
    const flushLeft = recipe.controls?.align === "left";
    const width = c.wide ? Math.min(safe.w, S * 1.45) : safe.w;
    const L = setText(c, text, { weight: 800, width, maxLines: c.tall ? 5 : c.wide ? 3 : 4, max: S * (c.tall ? 0.17 : c.wide ? 0.13 : 0.145), min: S * MIN_HEAD, lineHeight: 1.08 });
    const y = L ? safe.y + (safe.h - L.height) / 2 - S * 0.02 : safe.y;
    const left = (design.w - width) / 2;
    const block = L ? textBlock("headline", L, { y, color: pal.ink, ...(flushLeft ? { left, width } : { cx: design.w / 2 }) }) : null;

    // The words in reading order, each with where it sits and whether it's marked.
    interface Word {
      line: number;
      text: string;
      gap: string;
      x: number;
      y: number;
      w: number;
      hot: boolean;
    }
    const words: Word[] = [];
    if (block && L) {
      let at = 0;
      L.lines.forEach((line, i) => {
        const x0 = lineLeft(block, i);
        const top = glyphTop(block, i);
        for (const w of line.words) {
          at += w.gap.length;
          const a = at;
          const b = at + w.text.length;
          at = b;
          words.push({ line: i, text: w.text, gap: w.gap, x: x0 + w.x, y: top, w: w.w, hot: marks.some(([p, q]) => p < b && q > a) });
        }
      });
    }

    // The end card: the logo (or the name), the call to action and the address, drawn by the Draw-on style.
    const T0 = recipe.duration - CARD;
    const card = drawOn.plan({
      ...c.input,
      recipe: { ...recipe, scene: "end-card/draw-on", duration: CARD, fields: { brand: recipe.brand.name, product: "", ...(c.field("cta") && { cta: c.field("cta") }), ...(c.field("website") && { website: c.field("website") }) } },
    });
    const exitAt = T0 - 0.45;
    const read = Math.max(0.7, 0.28 * exitAt);
    const n = Math.max(1, words.length);
    const pop = 0.5 * pace;
    const beat = n > 1 ? Math.min(0.42 * pace, Math.max(0.09, (exitAt - read - pop - 0.12) / (n - 1))) : 0;
    const events = words.flatMap((w, i) => {
      const s = 0.12 + i * beat;
      return [ev(`word.${i}`, "pop", s, pop, "pop"), ...(w.hot ? [ev(`mark.${i}`, "draw", s + 0.05, 0.36, "snap")] : [])];
    });
    events.push(ev("words.exit", "exit", exitAt, 0.4, "exit"), ev("panel", "enter", exitAt + 0.05, 0.5, "move"));
    for (const e of card.timeline.events) events.push({ ...e, id: `card.${e.id}`, start: Math.round((e.start + T0) * 1e6) / 1e6 });

    // The camera leans in a little as each line starts, and follows it.
    const lines = L?.lines.length ?? 0;
    const firstOf = (line: number) => words.findIndex((w) => w.line === line);
    const zoom: Key[] = [{ t: 0, v: 1 }];
    const pan: Key[] = [{ t: 0, v: 0 }];
    for (let k = 1; k < lines; k++) {
      const s = 0.12 + firstOf(k) * beat;
      const mid = block && L ? glyphTop(block, k) + L.size / 2 - (y + L.height / 2) : 0;
      zoom.push({ t: s - 0.05, v: zoom[zoom.length - 1].v }, { t: s + 0.55, v: 1 + 0.025 * k, ease: "move" });
      pan.push({ t: s - 0.05, v: pan[pan.length - 1].v }, { t: s + 0.55, v: -mid * 0.12, ease: "move" });
    }

    // A slow push while the words are read, up to the moment they leave.
    const z0 = zoom[zoom.length - 1];
    if (exitAt > z0.t + 0.3) zoom.push({ t: exitAt, v: z0.v + 0.03, ease: "move" });
    const cardGround = card.evaluate(0).background;
    const same = typeof cardGround === "string" && cardGround.toLowerCase() === pal.ground.toLowerCase();
    const R = Math.hypot(design.w, design.h) / 2 + 2;
    const size = L?.size ?? S * 0.1;
    return {
      events,
      breath: false,
      cuts: [T0],
      overflow: [...(L?.overflow ? ["headline"] : []), ...card.overflow.filter((f) => f !== "product")],
      signature: 0.12 + Math.min(n - 1, 2) * beat + pop * 0.6,
      camera: (t) => ({ zoom: sample(zoom, t), x: 0, y: sample(pan, t) }),
      frame(t, P, Lp) {
        if (t >= T0) {
          const list = card.evaluate(t >= c.last ? card.rest : t - T0);
          return { nodes: [], over: [{ type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: list.background }, ...list.nodes] };
        }
        const swatches: DisplayNode[] = [];
        const runs: TextRun[] = [];
        words.forEach((w, i) => {
          const p = P(`word.${i}`);
          if (p <= 0 && Lp(`word.${i}`) <= 0) return;
          const appear = Math.min(1, Lp(`word.${i}`) * 5);
          const s = 1.32 - 0.32 * p;
          const cx = w.x + w.w / 2;
          const cy = w.y + size / 2;
          if (w.hot) {
            const q = P(`mark.${i}`);
            if (q > 0) {
              const pad = size * 0.14;
              const full = w.w + pad * 2;
              const rtl = L?.dir === "rtl";
              swatches.push({ type: "rect", x: rtl ? w.x - pad + full * (1 - q) : w.x - pad, y: w.y - size * 0.06, w: full * q, h: size * 1.12, r: size * 0.12, fill: pal.highlight.fill });
            }
          }
          const fill = w.hot && P(`mark.${i}`) > 0.35 ? pal.highlight.ink : pal.ink;
          runs.push({ text: w.text, gap: w.gap, font: L!.font, x: w.x, y: w.y - (1 - p) * size * 0.12, fill, ...(appear < 1 && { opacity: appear }), ...(Math.abs(s - 1) > 1e-4 && { transform: [s, 0, 0, s, cx - s * cx, cy - s * cy] }), ...(L!.dir === "rtl" && { dir: "rtl" as const }) });
        });
        const e = P("words.exit");
        const content: DisplayNode[] = [...swatches, { type: "text", field: "headline", runs }];
        const nodes: DisplayNode[] = e > 0 ? [group(content, { transform: translate(0, -e * S * 0.06), opacity: 1 - e })] : content;
        const rise = P("panel");
        const over: DisplayNode[] = rise > 0 && !same ? [{ type: "ellipse", cx: design.w / 2, cy: design.h / 2, rx: R * rise, ry: R * rise, fill: cardGround }] : [];
        return { nodes, over };
      },
    };
  },
});
