"use client";

import { memo } from "react";
import { CoverArt } from "@/components/template-cover";
import type { PreviewScene, TemplateLook } from "@/lib/catalog/marketing";
import type { TemplateCover } from "@/lib/template-covers";
import { cn } from "@/lib/utils";

/**
 * Procedural template previews: an SVG still per scene (a product silhouette on the template's own
 * set — plinth, splash, flat lay, a selfie frame, a headline layout…) in the template's colours.
 * Video templates move on hover or focus (CSS only; nothing moves under reduced motion).
 */

const CSS = `
.mkp-float{animation:mkp-float 3.2s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
.mkp-spin{animation:mkp-spin 6s linear infinite;transform-box:fill-box;transform-origin:center}
.mkp-pulse{animation:mkp-pulse 1.8s ease-in-out infinite;transform-box:fill-box;transform-origin:center}
.mkp-slide{animation:mkp-slide 2.6s ease-in-out infinite;transform-box:fill-box}
.mkp-talk{animation:mkp-talk .5s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:center}
.mkp [class^="mkp-"]{animation-play-state:paused}
.mkp[data-video]:hover [class^="mkp-"],.mkp[data-video]:focus-within [class^="mkp-"],button:focus-visible .mkp[data-video] [class^="mkp-"]{animation-play-state:running}
@keyframes mkp-float{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-7%) rotate(4deg)}}
@keyframes mkp-spin{to{transform:rotate(360deg)}}
@keyframes mkp-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.12)}}
@keyframes mkp-slide{0%,100%{transform:translateX(-6%)}50%{transform:translateX(6%)}}
@keyframes mkp-talk{from{transform:scaleY(.4)}to{transform:scaleY(1)}}
@media (prefers-reduced-motion:reduce){.mkp [class^="mkp-"]{animation:none!important}}
`;

/** Trig in SVG attributes is rounded: server and browser engines may print the last digits differently. */
const r2 = (n: number) => Math.round(n * 100) / 100;

const c = (l: number, ch: number, h: number, a = 1) => `oklch(${l} ${ch} ${h}${a < 1 ? ` / ${a}` : ""})`;

/** Stable 0–n pick from an id. */
export function pick(id: string, n: number): number {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return Math.abs(h) % n;
}

type Shape = "bottle" | "jar" | "box" | "can" | "tube";
const SHAPES: Shape[] = ["bottle", "jar", "box", "can", "tube"];

/** A product silhouette centred at (x, y), `s` tall. */
function Product({ shape, x, y, s, fill, accent, className }: { shape: Shape; x: number; y: number; s: number; fill: string; accent: string; className?: string }) {
  const w = s * (shape === "box" ? 0.62 : shape === "can" ? 0.46 : shape === "jar" ? 0.6 : shape === "tube" ? 0.3 : 0.38);
  const top = y - s / 2;
  return (
    <g className={className}>
      <ellipse cx={x} cy={y + s / 2} rx={w * 0.7} ry={s * 0.05} fill="black" opacity={0.18} />
      {shape === "bottle" && (
        <>
          <rect x={x - w * 0.18} y={top} width={w * 0.36} height={s * 0.16} rx={s * 0.02} fill={accent} />
          <rect x={x - w / 2} y={top + s * 0.14} width={w} height={s * 0.86} rx={w * 0.28} fill={fill} />
        </>
      )}
      {shape === "jar" && (
        <>
          <rect x={x - w / 2} y={top + s * 0.18} width={w} height={s * 0.82} rx={w * 0.16} fill={fill} />
          <rect x={x - w * 0.46} y={top + s * 0.06} width={w * 0.92} height={s * 0.16} rx={s * 0.03} fill={accent} />
        </>
      )}
      {shape === "box" && <rect x={x - w / 2} y={top + s * 0.1} width={w} height={s * 0.9} rx={s * 0.03} fill={fill} />}
      {shape === "can" && (
        <>
          <rect x={x - w / 2} y={top + s * 0.08} width={w} height={s * 0.92} rx={w * 0.12} fill={fill} />
          <rect x={x - w / 2} y={top + s * 0.08} width={w} height={s * 0.06} rx={s * 0.02} fill={accent} opacity={0.7} />
        </>
      )}
      {shape === "tube" && (
        <>
          <path d={`M${x - w / 2} ${top + s * 0.1} h${w} l${-w * 0.12} ${s * 0.8} h${-w * 0.76} z`} fill={fill} />
          <rect x={x - w * 0.26} y={top + s * 0.86} width={w * 0.52} height={s * 0.14} rx={s * 0.02} fill={accent} />
        </>
      )}
      {/* label */}
      <rect x={x - w * 0.32} y={y - s * 0.02} width={w * 0.64} height={s * 0.18} rx={s * 0.015} fill={accent} opacity={0.85} />
    </g>
  );
}

const Person = ({ x, y, s, skin, shirt, className }: { x: number; y: number; s: number; skin: string; shirt: string; className?: string }) => (
  <g className={className}>
    <path d={`M${x - s * 0.42} ${y + s} q${s * 0.42} ${-s * 0.7} ${s * 0.84} 0 z`} fill={shirt} />
    <circle cx={x} cy={y + s * 0.09} r={s * 0.215} fill={c(0.3, 0.04, 40)} />
    <circle cx={x} cy={y + s * 0.15} r={s * 0.19} fill={skin} />
  </g>
);

const Bars = ({ x, y, w, n, color, h = 7, gap = 5 }: { x: number; y: number; w: number; n: number; color: string; h?: number; gap?: number }) => (
  <g>
    {Array.from({ length: n }, (_, i) => (
      <rect key={i} x={x} y={y + i * (h + gap)} width={w * (i === n - 1 ? 0.6 : 1)} height={h} rx={h / 2} fill={color} />
    ))}
  </g>
);

function Scene({ scene, id, look, W, H, video }: { scene: PreviewScene; id: string; look: TemplateLook; W: number; H: number; video: boolean }) {
  const h1 = look.hue;
  const h2 = look.hue2 ?? (look.hue + 40) % 360;
  const dark = !!look.dark;
  const shape = SHAPES[pick(id, SHAPES.length)];
  const fill = dark ? c(0.86, 0.05, h1) : c(0.45, 0.13, h1);
  const accent = dark ? c(0.75, 0.14, h2) : c(0.93, 0.04, h2);
  const s = H * 0.42;
  const cx = W / 2;
  const cy = H * 0.56;
  const anim = video ? (scene === "orbit" || scene === "burst" ? "mkp-spin" : scene === "kinetic" || scene === "split" ? "mkp-slide" : "mkp-float") : undefined;
  const prod = (o: Partial<{ x: number; y: number; s: number; className: string }> = {}) => <Product shape={shape} x={o.x ?? cx} y={o.y ?? cy} s={o.s ?? s} fill={fill} accent={accent} className={o.className ?? anim} />;
  const ink = dark ? c(0.95, 0.01, h1) : c(0.25, 0.05, h1);
  switch (scene) {
    case "pedestal":
      return (
        <>
          <path d={`M${cx + W * 0.08} ${cy + s * 0.5} L${W} ${cy + s * 0.3} L${W} ${cy + s * 0.62} Z`} fill="black" opacity={0.12} />
          <rect x={cx - W * 0.24} y={cy + s * 0.5} width={W * 0.48} height={H * 0.3} rx={6} fill={c(0.86, 0.03, h2)} />
          <ellipse cx={cx} cy={cy + s * 0.5} rx={W * 0.24} ry={H * 0.025} fill={c(0.92, 0.02, h2)} />
          {prod({ y: cy - s * 0.02, s: s * 0.95 })}
        </>
      );
    case "flatlay":
      return (
        <>
          <rect x={W * 0.08} y={H * 0.1} width={W * 0.84} height={H * 0.8} rx={10} fill={c(0.93, 0.02, h1)} transform={`rotate(-4 ${cx} ${H / 2})`} />
          <circle cx={W * 0.25} cy={H * 0.27} r={W * 0.09} fill={c(0.8, 0.06, h2)} />
          <circle cx={W * 0.78} cy={H * 0.75} r={W * 0.07} fill={c(0.7, 0.1, (h2 + 60) % 360)} />
          <path d={`M${W * 0.7} ${H * 0.18} q${W * 0.1} ${H * 0.1} 0 ${H * 0.2}`} stroke={c(0.6, 0.12, 140)} strokeWidth={4} fill="none" />
          {prod({ s: s * 0.8, y: H * 0.52 })}
        </>
      );
    case "splash":
    case "water":
      return (
        <>
          {[0, 1, 2].map((i) => (
            <ellipse key={i} cx={cx} cy={cy + s * 0.52} rx={W * (0.2 + i * 0.12)} ry={H * (0.03 + i * 0.012)} fill="none" stroke={c(0.85, 0.08, h2, 0.6 - i * 0.15)} strokeWidth={2.5} />
          ))}
          {scene === "splash" &&
            Array.from({ length: 9 }, (_, i) => {
              const a = (-160 + i * 17.5) * (Math.PI / 180);
              return <circle key={i} className={video ? "mkp-pulse" : undefined} cx={r2(cx + Math.cos(a) * W * 0.32)} cy={r2(cy + Math.sin(a) * H * 0.3)} r={3 + (i % 3) * 2.5} fill={c(0.88, 0.08, h2, 0.85)} />;
            })}
          {prod()}
        </>
      );
    case "float":
      return (
        <>
          {[-1, 0, 1].map((i) => (
            <g key={i} transform={`rotate(${i * 14} ${cx + i * W * 0.26} ${cy - Math.abs(i) * H * 0.08})`}>
              <Product shape={shape} x={cx + i * W * 0.26} y={cy - (1 - Math.abs(i)) * H * 0.08} s={s * 0.62} fill={fill} accent={accent} className={anim} />
            </g>
          ))}
        </>
      );
    case "ice":
      return (
        <>
          {Array.from({ length: 10 }, (_, i) => (
            <rect key={i} x={W * (0.06 + (i % 5) * 0.19)} y={H * (0.72 + Math.floor(i / 5) * 0.1) - (i % 2) * 8} width={W * 0.16} height={W * 0.16} rx={6} fill={c(0.95, 0.03, 220, 0.75)} transform={`rotate(${(i * 23) % 40 - 20} ${W * (0.14 + (i % 5) * 0.19)} ${H * 0.78})`} />
          ))}
          {prod({ y: cy - s * 0.06 })}
        </>
      );
    case "shadow":
      return (
        <>
          {Array.from({ length: 6 }, (_, i) => (
            <path key={i} d={`M${-W * 0.2 + i * W * 0.22} 0 l${W * 0.5} ${H} l${W * 0.08} 0 l${-W * 0.5} ${-H} z`} fill="black" opacity={0.08} />
          ))}
          <rect x={0} y={cy + s * 0.48} width={W} height={H} fill={c(0.82, 0.05, h1)} />
          {prod()}
        </>
      );
    case "blocks":
      return (
        <>
          <rect x={cx - W * 0.3} y={cy + s * 0.5} width={W * 0.34} height={H * 0.3} fill={c(0.62, 0.17, h1)} />
          <rect x={cx + W * 0.04} y={cy + s * 0.32} width={W * 0.28} height={H * 0.4} fill={c(0.7, 0.14, h2)} />
          <circle cx={cx + W * 0.18} cy={cy + s * 0.32} r={W * 0.06} fill={c(0.9, 0.1, (h2 + 90) % 360)} />
          {prod({ x: cx - W * 0.13, y: cy + s * 0.02, s: s * 0.9 })}
        </>
      );
    case "nature":
      return (
        <>
          <ellipse cx={cx} cy={cy + s * 0.62} rx={W * 0.55} ry={H * 0.13} fill={c(0.55, 0.12, 135)} />
          {[0.18, 0.72, 0.4].map((x, i) => (
            <ellipse key={i} cx={W * x} cy={cy + s * (0.52 + i * 0.06)} rx={W * 0.1} ry={H * 0.045} fill={c(0.7, 0.02, 60 + i * 20)} />
          ))}
          {prod()}
        </>
      );
    case "studio":
    case "listing":
      return (
        <>
          <rect x={0} y={cy + s * 0.48} width={W} height={H} fill={c(0.95, 0.01, h1)} />
          {prod()}
          {scene === "listing" &&
            [0.35, 0.55, 0.75].map((y, i) => (
              <g key={i}>
                <line x1={cx + W * 0.14} y1={H * y} x2={W * 0.78} y2={H * y} stroke={ink} strokeWidth={1.5} opacity={0.5} />
                <circle cx={W * 0.8} cy={H * y} r={3.5} fill={ink} opacity={0.6} />
                <rect x={W * 0.82} y={H * y - 4} width={W * 0.12} height={8} rx={4} fill={ink} opacity={0.35} />
              </g>
            ))}
          {scene === "studio" && <Product shape={shape} x={cx} y={cy + s * 1.02} s={s} fill={fill} accent={accent} className="" />}
        </>
      );
    case "shelf":
      return (
        <>
          {Array.from({ length: 24 }, (_, i) => (
            <rect key={i} x={(i % 6) * (W / 6) + 1} y={Math.floor(i / 6) * (H / 7) + 1} width={W / 6 - 2} height={H / 7 - 2} fill={c(0.9, 0.04, h2, 0.6)} />
          ))}
          <rect x={0} y={cy + s * 0.5} width={W} height={H * 0.06} fill={c(0.8, 0.03, h1)} />
          {prod({ x: cx + W * 0.1 })}
          <rect x={cx - W * 0.32} y={cy + s * 0.2} width={W * 0.12} height={s * 0.3} rx={4} fill={c(0.75, 0.05, h2)} />
        </>
      );
    case "noir":
      return (
        <>
          <radialGradient id={`rim-${id}`} cx="50%" cy="45%" r="45%">
            <stop offset="0%" stopColor={c(0.55, 0.12, h2, 0.7)} />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
          <rect width={W} height={H} fill={`url(#rim-${id})`} />
          {prod()}
          <Product shape={shape} x={cx} y={cy + s * 1.02} s={s} fill={fill} accent={accent} className="opacity-25" />
        </>
      );
    case "picnic":
      return (
        <>
          {Array.from({ length: 8 }, (_, i) => (
            <g key={i}>
              <rect x={(i * W) / 8} y={cy + s * 0.3} width={W / 16} height={H} fill={c(0.6, 0.18, 25, 0.45)} />
              <rect x={0} y={cy + s * 0.3 + (i * H) / 16} width={W} height={H / 32} fill={c(0.6, 0.18, 25, 0.45)} />
            </g>
          ))}
          <circle cx={W * 0.22} cy={cy + s * 0.5} r={W * 0.05} fill={c(0.55, 0.2, 25)} />
          <circle cx={W * 0.8} cy={cy + s * 0.42} r={W * 0.04} fill={c(0.55, 0.2, 25)} />
          {prod()}
        </>
      );
    case "citrus":
      return (
        <>
          {Array.from({ length: 7 }, (_, i) => {
            const a = (i / 7) * Math.PI * 2;
            return (
              <g key={i} className={video ? "mkp-pulse" : undefined}>
                <circle cx={r2(cx + Math.cos(a) * W * 0.36)} cy={r2(cy + Math.sin(a) * H * 0.28)} r={W * 0.085} fill={c(0.82, 0.16, (h2 + i * 18) % 360)} />
                <circle cx={r2(cx + Math.cos(a) * W * 0.36)} cy={r2(cy + Math.sin(a) * H * 0.28)} r={W * 0.06} fill={c(0.9, 0.12, (h2 + i * 18) % 360)} />
              </g>
            );
          })}
          {prod({ s: s * 0.85 })}
        </>
      );
    case "model":
      return (
        <>
          <Person x={cx - W * 0.06} y={H * 0.2} s={H * 0.72} skin={c(0.78, 0.06, 55)} shirt={c(0.55, 0.12, h2)} />
          {prod({ x: cx + W * 0.2, y: H * 0.55, s: s * 0.55 })}
        </>
      );
    case "selfie":
      return (
        <>
          <rect x={W * 0.18} y={H * 0.08} width={W * 0.64} height={H * 0.84} rx={W * 0.08} fill={c(0.2, 0.02, h1)} />
          <rect x={W * 0.21} y={H * 0.11} width={W * 0.58} height={H * 0.78} rx={W * 0.06} fill={c(0.82, 0.06, h2)} />
          <Person x={cx} y={H * 0.26} s={H * 0.62} skin={c(0.78, 0.06, 55)} shirt={c(0.5, 0.13, h1)} />
          {prod({ x: cx + W * 0.16, y: H * 0.62, s: s * 0.4 })}
          {/* captions */}
          <rect x={W * 0.3} y={H * 0.74} width={W * 0.4} height={H * 0.045} rx={4} fill="white" opacity={0.92} />
          <g transform={`translate(${W * 0.27} ${H * 0.16})`}>
            {[0, 1, 2].map((i) => (
              <rect key={i} className={video ? "mkp-talk" : undefined} x={i * 7} y={0} width={4} height={14} rx={2} fill="white" opacity={0.8} style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </g>
        </>
      );
    case "orbit":
      return (
        <>
          <ellipse cx={cx} cy={cy} rx={W * 0.4} ry={H * 0.12} fill="none" stroke={c(0.8, 0.1, h2, 0.6)} strokeWidth={2} strokeDasharray="6 6" />
          <g className={video ? "mkp-spin" : undefined}>
            <circle cx={cx + W * 0.4} cy={cy} r={5} fill={c(0.9, 0.12, h2)} />
          </g>
          <Product shape={shape} x={cx} y={cy} s={s} fill={fill} accent={accent} className={video ? "mkp-float" : undefined} />
        </>
      );
    case "kinetic":
    case "type":
      return (
        <>
          <text x={W * 0.06} y={H * 0.42} fontSize={H * 0.36} fontWeight={900} fill={c(dark ? 0.4 : 0.75, 0.14, h2, 0.65)} className={video ? "mkp-slide" : undefined} fontFamily="system-ui, sans-serif">
            {scene === "type" ? "AA" : "GO"}
          </text>
          {prod({ y: cy + s * 0.12, s: s * 0.9 })}
          <Bars x={W * 0.08} y={H * 0.82} w={W * 0.5} n={2} color={ink} h={6} />
        </>
      );
    case "collage":
      return (
        <>
          {[-10, 6, -4].map((r, i) => (
            <rect key={i} x={W * (0.1 + i * 0.22)} y={H * (0.16 + i * 0.18)} width={W * 0.42} height={H * 0.3} fill={c(0.85 - i * 0.12, 0.12, (h1 + i * 50) % 360)} transform={`rotate(${r} ${W / 2} ${H / 2})`} className={video ? "mkp-float" : undefined} />
          ))}
          {prod({ s: s * 0.8 })}
          <rect x={W * 0.6} y={H * 0.1} width={W * 0.24} height={H * 0.05} fill={c(0.9, 0.05, 60, 0.8)} transform={`rotate(12 ${W * 0.7} ${H * 0.12})`} />
        </>
      );
    case "cards":
      return (
        <>
          {[0, 1, 2].map((i) => (
            <g key={i} className={video ? "mkp-slide" : undefined} style={{ animationDelay: `${i * 0.2}s` }}>
              <rect x={W * (0.12 + i * 0.06)} y={H * (0.2 + i * 0.2)} width={W * 0.64} height={H * 0.16} rx={10} fill={dark ? c(0.3, 0.05, h1) : "white"} opacity={0.95} />
              <circle cx={W * (0.2 + i * 0.06)} cy={H * (0.28 + i * 0.2)} r={W * 0.04} fill={c(0.65, 0.16, (h2 + i * 40) % 360)} />
              <Bars x={W * (0.28 + i * 0.06)} y={H * (0.25 + i * 0.2)} w={W * 0.36} n={2} color={ink} h={5} gap={5} />
            </g>
          ))}
        </>
      );
    case "split":
      return (
        <>
          <rect x={0} y={0} width={W / 2} height={H} fill={c(0.75, 0.02, h1)} />
          <rect x={W / 2} y={0} width={W / 2} height={H} fill={c(0.8, 0.12, h2)} />
          <line x1={W / 2} y1={0} x2={W / 2} y2={H} stroke="white" strokeWidth={3} />
          <Product shape={shape} x={W * 0.25} y={cy} s={s * 0.7} fill={c(0.6, 0.01, h1)} accent={c(0.8, 0.01, h1)} className="" />
          {prod({ x: W * 0.75, s: s * 0.8 })}
        </>
      );
    case "headline":
    case "badge":
    case "stars":
    case "burst":
      return (
        <>
          {scene === "burst" && (
            <g className={video ? "mkp-spin" : undefined}>
              {Array.from({ length: 16 }, (_, i) => (
                <path key={i} d={`M${cx} ${cy} l${r2(Math.cos((i * Math.PI) / 8) * W)} ${r2(Math.sin((i * Math.PI) / 8) * W)} l${r2(Math.cos(((i + 0.5) * Math.PI) / 8) * W)} ${r2(Math.sin(((i + 0.5) * Math.PI) / 8) * W)} z`} fill={c(0.85, 0.12, h2, 0.35)} />
              ))}
            </g>
          )}
          {prod({ y: H * 0.6, s: s * 0.85 })}
          <Bars x={W * 0.08} y={H * 0.1} w={W * 0.7} n={2} color={ink} h={H * 0.04} gap={H * 0.02} />
          {scene === "stars" &&
            Array.from({ length: 5 }, (_, i) => (
              <path key={i} transform={`translate(${W * (0.1 + i * 0.09)} ${H * 0.27}) scale(${W / 260})`} d="M10 0l3 7h7l-6 4 2 7-6-4-6 4 2-7-6-4h7z" fill={c(0.8, 0.16, 85)} />
            ))}
          {scene === "badge" && (
            <g className={video ? "mkp-pulse" : undefined}>
              <circle cx={W * 0.78} cy={H * 0.3} r={W * 0.12} fill={c(0.65, 0.18, h2)} />
              <circle cx={W * 0.78} cy={H * 0.3} r={W * 0.09} fill="none" stroke="white" strokeWidth={2} strokeDasharray="3 3" />
            </g>
          )}
          <rect x={W * 0.08} y={H * 0.86} width={W * 0.32} height={H * 0.06} rx={H * 0.03} fill={c(0.6, 0.17, h2)} />
        </>
      );
    default:
      return prod();
  }
}

/**
 * A template's preview: its real cover when it has one (`cover`, templateCover: `playing` runs its clip), else the
 * drawn one. `sizes` is how wide the cover shows, so a small tile gets the 320 px copy.
 */
export const TemplatePreview = memo(function TemplatePreview({
  id,
  look,
  video,
  className,
  cover,
  playing,
  asked,
  sizes = "220px",
}: {
  id: string;
  look: TemplateLook;
  video?: boolean;
  className?: string;
  cover?: TemplateCover;
  playing?: boolean;
  asked?: boolean;
  sizes?: string;
}) {
  if (cover) {
    return (
      <div className={cn("relative size-full overflow-hidden", className)}>
        <CoverArt cover={cover} sizes={sizes} playing={playing} asked={asked} />
      </div>
    );
  }
  const W = 240;
  const H = 320;
  const h1 = look.hue;
  const h2 = look.hue2 ?? (look.hue + 40) % 360;
  const bg = look.dark ? [c(0.24, 0.04, h1), c(0.14, 0.03, h2)] : [c(0.9, 0.06, h1), c(0.8, 0.09, h2)];
  return (
    <div className={cn("mkp relative size-full overflow-hidden", className)} data-video={video ? "" : undefined}>
      <style href="fuobe-marketing-preview" precedence="default">
        {CSS}
      </style>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className="size-full" aria-hidden="true">
        <defs>
          <linearGradient id={`bg-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={bg[0]} />
            <stop offset="100%" stopColor={bg[1]} />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill={`url(#bg-${id})`} />
        <Scene scene={look.scene} id={id} look={look} W={W} H={H} video={!!video} />
      </svg>
    </div>
  );
});
