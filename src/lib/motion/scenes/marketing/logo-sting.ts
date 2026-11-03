/**
 * Logo Sting: the mark is made from itself. Two hairlines sweep out from the middle and fall away; then the mark
 * assembles: an SVG logo traces its own outlines on and fills in, any other logo (or the brand's name set in type) comes
 * together from shards cut out of it, which drift or fly home from round the frame. The instant it is whole, a flash
 * and a ring of light go out from it, it settles, a glint crosses it, and the line under it rises.
 *
 * The Pace sets the language: Calm is fine and quiet (short drifts, little turn, long hairlines), Punchy flies the shards
 * in from farther with more turn and a kick of the camera. The shards' cuts and paths come from the recipe's seed.
 */

import { about, group, multiply, translate, withAlpha, type DisplayNode } from "../../display";
import { noise1, rng, rngRange } from "../../random";
import { local } from "../../time";
import { lineRuns, logoPaths } from "../end-card/shared";
import { ev, logoNode, marketingScene, MIN_BODY, MIN_HEAD, sampleMark, setText, spread, textBlock } from "./kit";

interface Shard {
  d: string;
  /** Its middle, and where it starts from (relative), its turn and when it leaves. */
  cx: number;
  cy: number;
  dx: number;
  dy: number;
  turn: number;
  at: number;
}

/** A box cut into triangles on a jittered grid (the inner points moved by the seed), as closed paths. */
export function shardCuts(box: { x: number; y: number; w: number; h: number }, cols: number, rows: number, seed: number): { d: string; cx: number; cy: number }[] {
  const pt = (i: number, j: number): [number, number] => {
    const inner = i > 0 && i < cols && j > 0 && j < rows;
    const jx = inner ? rngRange(-0.32, 0.32, seed, "jx", i, j) : 0;
    const jy = inner ? rngRange(-0.32, 0.32, seed, "jy", i, j) : 0;
    return [box.x + ((i + jx) / cols) * box.w, box.y + ((j + jy) / rows) * box.h];
  };
  const out: { d: string; cx: number; cy: number }[] = [];
  const tri = (a: [number, number], b: [number, number], c: [number, number]) =>
    out.push({ d: `M${a[0].toFixed(2)} ${a[1].toFixed(2)}L${b[0].toFixed(2)} ${b[1].toFixed(2)}L${c[0].toFixed(2)} ${c[1].toFixed(2)}Z`, cx: (a[0] + b[0] + c[0]) / 3, cy: (a[1] + b[1] + c[1]) / 3 });
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const p00 = pt(i, j);
      const p10 = pt(i + 1, j);
      const p01 = pt(i, j + 1);
      const p11 = pt(i + 1, j + 1);
      // The diagonal alternates, so the cuts read as facets, not a grid.
      if ((i + j) % 2 === 0) {
        tri(p00, p10, p11);
        tri(p00, p11, p01);
      } else {
        tri(p00, p10, p01);
        tri(p10, p11, p01);
      }
    }
  return out;
}

export default marketingScene({
  id: "marketing/logo-sting",
  name: "Logo Sting",
  look: "brand",
  build(c) {
    const { S, safe, palette: pal, design, recipe } = c;
    const seed = recipe.seed;
    const cx = design.w / 2;
    const logo = c.input.logo;
    const calm = recipe.controls?.pace === "calm";
    const punchy = recipe.controls?.pace === "punchy";
    // The mark's box, a little above the middle.
    const markW = Math.min(safe.w * 0.86, S * 0.84);
    const markH = S * (logo && logo.w / logo.h > 3 ? 0.24 : 0.32);
    const tagline = setText(c, c.field("tagline"), { family: "body", weight: 500, width: Math.min(safe.w, S * 1.1), maxLines: 2, max: S * 0.056, min: S * MIN_BODY, lineHeight: 1.25 });
    const name = !logo ? setText(c, recipe.brand.name, { weight: 800, width: Math.min(safe.w, S * 1.2), maxLines: 2, max: S * 0.14, min: S * MIN_HEAD, lineHeight: 1.04 }) : null;
    const box = logo
      ? (() => {
          const s = Math.min(markW / logo.w, markH / logo.h);
          return { w: logo.w * s, h: logo.h * s };
        })()
      : name
        ? { w: name.width, h: name.height }
        : { w: S * 0.2, h: S * 0.1 };
    const gap = S * 0.06;
    const stackH = box.h + (tagline ? gap + tagline.height : 0);
    const top = design.h / 2 - stackH / 2 - S * 0.02;
    const mark = { x: cx - box.w / 2, y: top, w: box.w, h: box.h };
    const mcx = mark.x + mark.w / 2;
    const mcy = mark.y + mark.h / 2;
    const nameB = name ? textBlock("brand", name, { y: top, color: pal.ink, cx }) : null;
    const tagB = tagline ? textBlock("tagline", tagline, { y: top + box.h + gap, color: pal.muted, cx }) : null;
    const tint = !!logo && sampleMark(c);

    /** The mark as it rests (a sample lockup set in the look's ink; a person's own logo as it is). */
    const whole = (): DisplayNode[] => (logo ? [logoNode(c, mark, pal.ink)] : nameB ? [lineRuns(nameB)] : []);
    /** The mark's raw pieces (untinted), for the shards. */
    const raw = (): DisplayNode[] => (logo ? [{ type: "image", src: "logo", ...mark }] : nameB ? [lineRuns(nameB)] : []);

    // An SVG logo traces its own outlines; anything else assembles from shards of itself.
    const svg = logo?.kind === "svg" && logo.paths?.length ? logoPaths(logo, mark) : null;
    const traceGroups = svg ? Math.min(svg.length, 8) : 0;
    const pad = S * 0.01;
    const cutBox = { x: mark.x - pad, y: mark.y - pad, w: mark.w + 2 * pad, h: mark.h + 2 * pad };
    const cols = Math.max(3, Math.min(8, Math.round((cutBox.w / cutBox.h) * 2)));
    const rows = cutBox.h / cutBox.w > 0.5 ? 3 : 2;
    const reach = S * (calm ? 0.09 : punchy ? 0.5 : 0.3);
    const spin = calm ? 0.18 : punchy ? 1.3 : 0.7;
    const shards: Shard[] = svg
      ? []
      : shardCuts(cutBox, cols, rows, seed).map((s, i) => {
          // Out from the middle of the mark, bent a little by the seed.
          const a = Math.atan2(s.cy - mcy, (s.cx - mcx) * 0.6) + rngRange(-0.5, 0.5, seed, "a", i);
          const r = reach * rngRange(0.65, 1.15, seed, "r", i);
          return { ...s, dx: Math.cos(a) * r, dy: Math.sin(a) * r * 0.8, turn: rngRange(-1, 1, seed, "t", i) * spin, at: rng(seed, "at", i) };
        });

    // The beats, spread over the length.
    const k = spread(c, 2.8, 2.4);
    const lines0 = 0.05;
    const lineDur = (calm ? 0.95 : 0.7) * Math.min(1.4, k);
    const build0 = lines0 + lineDur * 0.45;
    const buildDur = (calm ? 1.35 : punchy ? 0.95 : 1.1) * Math.min(1.5, k);
    const fly = calm ? 0.95 * Math.min(1.4, k) : punchy ? 0.6 : 0.75;
    const click = build0 + buildDur;
    const events = [
      ev("lines", "draw", lines0, lineDur, "draw"),
      ev("lines.out", "exit", lines0 + lineDur * 0.8, 0.5 * Math.min(1.4, k), "move"),
      ...(svg
        ? [
            ...Array.from({ length: traceGroups }, (_, g) => ev(`trace.${g}`, "draw", build0 + g * Math.min(0.08, Math.max(0.04, (buildDur - 0.7) / Math.max(1, traceGroups))), 0.7, "draw", { group: "trace", unit: "words" })),
            ev("fill", "fade", click - 0.25, 0.4, "enter"),
          ]
        : shards.map((s, i) => ev(`shard.${i}`, "enter", build0 + s.at * (buildDur - fly), fly, calm ? "glide" : "enter"))),
      ev("flash", "fade", click, 0.45, "enter"),
      ev("ring", "fade", click - 0.02, 0.75, "enter"),
      ev("settle", "enter", click, 0.8, "settle"),
      ev("glint", "move", click + 0.35 * k, 0.9, "move"),
      ...(tagline ? [ev("tagline", "enter", click + 0.5 * k, 0.6, "glide")] : []),
    ];
    const shake = punchy ? { from: click, to: click + 0.3, amp: S * 0.007 } : null;
    const hair = Math.max(1.2, S * 0.0022);
    const span = Math.min(safe.w * 0.48, mark.w * 0.75 + S * 0.08);
    const ly = [mark.y - S * 0.05, mark.y + mark.h + S * 0.05 - (tagline ? gap * 0.3 : 0)];
    const flashTone = pal.look === "light" ? pal.mark : "#ffffff";

    return {
      events,
      overflow: [...(name?.overflow ? ["brand"] : []), ...(tagline?.overflow ? ["tagline"] : [])],
      signature: click - 0.12,
      cuts: [],
      camera: (t) => {
        if (!shake || t < shake.from || t >= shake.to) return { zoom: 1, x: 0, y: 0 };
        const fade = 1 - local(t, shake.from, shake.to);
        return { zoom: 1 + 0.01 * fade, x: noise1(seed, "kx", t * 38) * shake.amp * fade, y: noise1(seed, "ky", t * 38) * shake.amp * fade };
      },
      frame(_t, P, Lp) {
        const nodes: DisplayNode[] = [];
        // The hairlines: out from the middle above and below, then away to the sides.
        const grow = P("lines");
        const gone = P("lines.out");
        if (grow > 0 && gone < 1)
          for (const y of ly)
            for (const dir of [-1, 1]) {
              const a = cx + dir * span * gone;
              const b = cx + dir * span * Math.max(gone, grow);
              if (Math.abs(b - a) > 0.5) nodes.push({ type: "path", d: `M${a.toFixed(2)} ${y.toFixed(2)}H${b.toFixed(2)}`, stroke: { paint: pal.mark, width: hair, cap: "round" } });
            }
        // The ring of light where it comes together.
        const ring = Lp("ring");
        if (ring > 0 && ring < 1) {
          const r = Math.max(mark.w, mark.h) * (0.45 + 0.4 * P("ring"));
          nodes.push({ type: "ellipse", cx: mcx, cy: mcy, rx: r, ry: r * (mark.h / mark.w > 0.6 ? 1 : 0.62), stroke: { paint: pal.mark, width: hair * 1.4 + S * 0.006 * (1 - ring) }, opacity: 1 - ring });
        }
        const settle = P("settle");
        const s = Lp("settle") > 0 ? 1.035 - 0.035 * settle : 1;
        const fill = svg ? P("fill") : Lp("flash") > 0 ? 1 : 0;
        const ms: DisplayNode[] = [];
        if (svg) {
          // The outlines trace on in the words' colour, and the mark fills in under them.
          if (fill > 0) ms.push(fill < 1 ? group(whole(), { opacity: fill }) : group(whole()));
          if (fill < 1) {
            const width = Math.max(1.2, mark.h * 0.012);
            svg.forEach((p, i) => {
              const trim = P(`trace.${Math.floor((i * traceGroups) / svg.length)}`);
              if (trim > 0) ms.push({ type: "path", d: p.d, transform: p.m, stroke: { paint: pal.ink, width: width / p.scale, trim, length: p.length, cap: "round", join: "round" }, ...(fill > 0 && { opacity: 1 - fill }) });
            });
          }
        } else if (fill >= 1) ms.push(...whole());
        else {
          // The shards of the mark, each clipped to its own cut, coming home.
          const pieces: DisplayNode[] = [];
          shards.forEach((sh, i) => {
            const lin = Lp(`shard.${i}`);
            if (lin <= 0) return;
            const u = 1 - P(`shard.${i}`);
            const m = multiply(translate(u * sh.dx, u * sh.dy), about(sh.cx, sh.cy, 1 + u * (calm ? 0.08 : 0.25), u * sh.turn));
            pieces.push(group(raw(), { clip: { type: "path", d: sh.d }, transform: m, ...(lin < 0.35 && { opacity: lin / 0.35 }) }));
          });
          if (pieces.length) ms.push(tint ? group([...pieces, group([{ type: "rect", x: 0, y: 0, w: design.w, h: design.h, fill: pal.ink }], { blend: "source-atop" })], { isolate: { x: 0, y: 0, w: design.w, h: design.h } }) : group(pieces));
        }
        // The glint crosses the whole mark once it has settled.
        const g = Lp("glint");
        if (fill >= 1 && g > 0 && g < 1) {
          const band = mark.w * 0.3;
          const x = mark.x - band + (mark.w + 2 * band) * P("glint");
          const glint: DisplayNode = { type: "rect", x: x - band, y: mark.y - mark.h, w: band * 2, h: mark.h * 3, fill: { kind: "linear", x0: x - band, y0: 0, x1: x + band, y1: 0, stops: [{ at: 0, color: "rgba(255,255,255,0)" }, { at: 0.5, color: pal.look === "light" ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.5)" }, { at: 1, color: "rgba(255,255,255,0)" }] } };
          const ink: DisplayNode[] = tint ? [group([{ type: "rect", x: mark.x - 4, y: mark.y - 4, w: mark.w + 8, h: mark.h + 8, fill: pal.ink }], { blend: "source-atop" })] : [];
          nodes.push(group([...raw(), ...ink, group([glint], { blend: "source-atop" })], { transform: about(mcx, mcy, s), isolate: { x: mark.x - 6, y: mark.y - 6, w: mark.w + 12, h: mark.h + 12 } }));
        } else if (ms.length) nodes.push(s !== 1 ? group(ms, { transform: about(mcx, mcy, s) }) : ms.length === 1 ? ms[0] : group(ms));
        // The flash: a bloom of light off the mark the instant it is whole.
        const f = P("flash");
        if (Lp("flash") > 0 && f < 1) {
          const R = Math.max(mark.w, mark.h) * 0.62;
          nodes.push(group([{ type: "ellipse", cx: mcx, cy: mcy, rx: R, ry: R * 0.7, fill: { kind: "radial", cx: mcx, cy: mcy, r0: 0, r1: R, stops: [{ at: 0, color: withAlpha(flashTone, 0.22 * (1 - f)) }, { at: 1, color: withAlpha(flashTone, 0) }] } }], { blend: pal.look === "light" ? "multiply" : "screen" }));
        }
        if (tagB) {
          const p = P("tagline");
          if (p > 0) nodes.push(group([lineRuns(tagB)], { transform: translate(0, (1 - p) * S * 0.025), ...(p < 1 && { opacity: p }) }));
        }
        return { nodes };
      },
    };
  },
});
