"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { CoverImg } from "@/components/template-cover";
import type { FashionTemplate } from "@/lib/catalog/packs";
import { templateCover } from "@/lib/template-covers";
import { cn } from "@/lib/utils";

/** A fashion figure (long coat, legs, head) as one path in a 60×70 box; `pose` shifts the stance. */
function Figure({ x, y, s, pose = 0, fill }: { x: number; y: number; s: number; pose?: number; fill: string }) {
  const lean = pose * 2;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <circle cx={lean * 0.4} cy={-29} r={3.6} fill={fill} />
      <path
        d={`M${-5 + lean * 0.3} -24 Q0 -26 ${5 + lean * 0.3} -24 L${7 + lean} -6 L${3.5 + lean} -6 L${3 + pose * 3} 14 L${1 + pose * 3} 14 L0 -2 L-1 14 L-3 14 L${-3.5 + lean * 0.2} -6 L${-7 + lean * 0.2} -6 Z`}
        fill={fill}
      />
    </g>
  );
}

const SCENES: Record<string, (slide: number) => React.ReactNode> = {
  "ultra-bold": (k) => (
    <>
      <rect width="60" height="70" fill="#1f3fd1" />
      <rect y="48" width="60" height="22" fill="#ffcc1a" />
      <rect x={k === 1 ? 6 : 38} y="34" width="14" height="14" fill="#e8331c" />
      <rect x={k === 2 ? 0 : 44} y="0" width="16" height="48" fill="#13a35a" opacity={k === 2 ? 1 : 0} />
      <Figure x={k === 1 ? 36 : 24} y={k === 2 ? 42 : 34} s={k === 2 ? 1.5 : 1} pose={k - 1} fill="#141414" />
    </>
  ),
  "blue-green-gradient": (k) => (
    <>
      <defs>
        <linearGradient id="bgg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2f6fe0" />
          <stop offset="1" stopColor="#2fd39a" />
        </linearGradient>
      </defs>
      <rect width="60" height="70" fill="url(#bgg)" />
      <ellipse cx="30" cy="62" rx="22" ry="3" fill="#000" opacity="0.12" />
      <Figure x={k === 1 ? 22 : 30} y={k === 2 ? 44 : 36} s={k === 2 ? 1.55 : 1.05} pose={k === 1 ? 1 : 0} fill="#f4f1ea" />
    </>
  ),
  "street-style-paparazzi": (k) => (
    <>
      <rect width="60" height="70" fill="#151821" />
      <rect y="50" width="60" height="20" fill="#262a33" />
      {[8, 22, 47].map((cx, i) => (
        <g key={cx} opacity={i === k ? 1 : 0.55}>
          <circle cx={cx} cy={12 + i * 6} r="5" fill="#fff" opacity="0.18" />
          <circle cx={cx} cy={12 + i * 6} r="1.6" fill="#fff" />
        </g>
      ))}
      <rect x="4" y="38" width="10" height="7" rx="1.5" fill="#e4b425" opacity={k === 1 ? 1 : 0.4} />
      <Figure x={k === 2 ? 34 : 28} y={k === 2 ? 40 : 37} s={k === 2 ? 1.4 : 1.05} pose={k === 0 ? 1 : -1} fill="#d9d4ca" />
    </>
  ),
  "view-from-the-top": (k) => (
    <>
      <rect width="60" height="70" fill="#d8cbb2" />
      {Array.from({ length: 7 }, (_, i) => (
        <rect key={i} x={i * 9 - (k % 2) * 4} y="0" width="4.5" height="70" fill="#bfae8d" opacity="0.7" />
      ))}
      <g transform={`rotate(${k === 0 ? -35 : k === 1 ? 20 : 0} 30 35)`}>
        <Figure x={30} y={40} s={k === 2 ? 0.7 : 1.1} pose={0.5} fill="#7a2f22" />
      </g>
    </>
  ),
  "light-blue-studio": (k) => (
    <>
      <rect width="60" height="70" fill="#cfe3f5" />
      <rect y="46" width="60" height="24" fill="#bcd6ee" />
      {k === 1 && <rect x="34" y="42" width="14" height="12" fill="#a9c9e8" />}
      <Figure x={k === 1 ? 26 : 30} y={k === 2 ? 44 : 36} s={k === 2 ? 1.5 : 1.05} pose={k - 1} fill="#2a3442" />
    </>
  ),
  "red-room": (k) => (
    <>
      <rect width="60" height="70" fill="#b5161b" />
      <rect y="48" width="60" height="22" fill="#8f0f13" />
      <rect x={k === 1 ? 36 : 6} y="22" width="16" height="26" fill="#9c1217" />
      {k === 2 && <rect x="36" y="36" width="16" height="14" rx="3" fill="#7a0b0f" />}
      <Figure x={k === 1 ? 22 : 30} y={k === 2 ? 42 : 36} s={k === 2 ? 1.35 : 1.05} pose={k === 1 ? 1 : -0.5} fill="#160406" />
    </>
  ),
};

/**
 * A template's preview: three framings in a carousel (arrows on hover, dots below). The framings are its real cover's
 * slides when it has one (templateCover; only the slide in view loads), else drawn.
 */
export function TemplatePreview({ t, className }: { t: Pick<FashionTemplate, "id" | "name">; className?: string }) {
  const [slide, setSlide] = useState(0);
  const cover = templateCover("fashion", t.id);
  const n = cover ? cover.frames.length : 3;
  const at = slide % n;
  const scene = SCENES[t.id] ?? SCENES["light-blue-studio"];
  const arrow = "absolute top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-background/85 text-foreground opacity-0 shadow-soft transition outline-none group-hover/tpl:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50";
  return (
    <span className={cn("group/tpl relative block overflow-hidden", className)}>
      {cover ? (
        <span role="img" aria-label={`${t.name} preview ${at + 1} of ${n}`} className="block size-full bg-muted">
          <CoverImg key={at} frame={cover.frames[at]} sizes="(max-width: 1024px) 50vw, 370px" />
        </span>
      ) : (
        <svg viewBox="0 0 60 70" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`${t.name} preview ${at + 1} of 3`} className="size-full">
          {scene(at)}
        </svg>
      )}
      {n > 1 && (
        <>
          <button type="button" aria-label="Previous preview" onClick={(e) => (e.stopPropagation(), setSlide((s) => (s + n - 1) % n))} className={cn(arrow, "left-1.5")}>
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" aria-label="Next preview" onClick={(e) => (e.stopPropagation(), setSlide((s) => (s + 1) % n))} className={cn(arrow, "right-1.5")}>
            <ChevronRight className="size-4" />
          </button>
        </>
      )}
      <span className={cn("absolute inset-x-0 bottom-2 flex justify-center gap-1", n < 2 && "hidden")}>
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className={cn("size-1.5 rounded-full bg-white/60", i === at && "bg-white")} />
        ))}
      </span>
    </span>
  );
}
