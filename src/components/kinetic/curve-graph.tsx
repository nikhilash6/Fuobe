"use client";

import { useMemo, useRef, useState } from "react";
import { warpOf, type WarpKeys } from "@/lib/motion/edit";
import { cn } from "@/lib/utils";

/**
 * A motion group's timing curve: its warp keys on a square graph (time across, progress up). It shows only the
 * recipe's keys, joined the way the scene reads them. Tap empty space to add a key, drag a key to move it (applied on
 * release, as one step), Delete removes the selected key (never the two ends), and the arrow keys move it by 0.01, or
 * 0.1 with Shift. `under` draws a sampled line behind (the Camera group: its zoom over time).
 */

const PAD = 16;
const MAX_KEYS = 8;
const GAP = 0.01;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** A key moved to (u, p), kept strictly between its neighbours in u and between their p. */
function moved(keys: WarpKeys, i: number, u: number, p: number): WarpKeys {
  if (i <= 0 || i >= keys.length - 1) return keys;
  const lo = keys[i - 1];
  const hi = keys[i + 1];
  const nu = r4(clamp(u, lo[0] + GAP, hi[0] - GAP));
  const np = r4(clamp(p, lo[1], hi[1]));
  if (!(nu > lo[0] && nu < hi[0])) return keys;
  return keys.map((k, j) => (j === i ? [nu, np] : k)) as WarpKeys;
}

/** The keys with one added at (u, p) in order (p held between its neighbours'), and its index; null when full. */
export function addKey(keys: WarpKeys, u: number, p: number): { keys: WarpKeys; index: number } | null {
  if (keys.length >= MAX_KEYS || u <= GAP || u >= 1 - GAP) return null;
  const i = keys.findIndex((k) => k[0] > u);
  if (i <= 0) return null;
  const lo = keys[i - 1];
  const hi = keys[i];
  if (u - lo[0] < GAP || hi[0] - u < GAP) return null;
  const next = [...keys.slice(0, i), [r4(u), r4(clamp(p, lo[1], hi[1]))], ...keys.slice(i)] as WarpKeys;
  return { keys: next, index: i };
}

export function CurveGraph({ keys, onChange, label, under, underLabel }: { keys: WarpKeys; onChange: (keys: WarpKeys) => void; label: string; under?: number[]; underLabel?: string }) {
  const [draft, setDraft] = useState<WarpKeys | null>(null);
  const [picked, setSel] = useState<number | null>(null);
  // A selection past the keys there are now (after an undo) selects nothing.
  const sel = picked !== null && picked < keys.length ? picked : null;
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ i: number; moved: boolean } | null>(null);
  const shown = draft ?? keys;
  const S = 280;
  const inner = S - PAD * 2;
  const x = (u: number) => PAD + u * inner;
  const y = (p: number) => PAD + (1 - p) * inner;

  const path = useMemo(() => {
    const w = warpOf(shown);
    const pts: string[] = [];
    for (let i = 0; i <= 64; i++) {
      const u = i / 64;
      pts.push(`${i ? "L" : "M"}${x(u).toFixed(1)},${y(w(u)).toFixed(1)}`);
    }
    return pts.join(" ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);

  const underPath = useMemo(() => {
    if (!under?.length) return null;
    const lo = Math.min(...under);
    const hi = Math.max(...under);
    const span = hi - lo || 1;
    return under.map((v, i) => `${i ? "L" : "M"}${x(i / (under.length - 1)).toFixed(1)},${y(hi === lo ? 0.5 : (v - lo) / span).toFixed(1)}`).join(" ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [under]);

  const at = (e: { clientX: number; clientY: number }) => {
    const box = svg.current!.getBoundingClientRect();
    const k = S / box.width;
    return { u: clamp(((e.clientX - box.left) * k - PAD) / inner, 0, 1), p: clamp(1 - ((e.clientY - box.top) * k - PAD) / inner, 0, 1) };
  };

  const nudge = (du: number, dp: number) => {
    if (sel === null) return;
    const k = keys[sel];
    const next = moved(keys, sel, k[0] + du, k[1] + dp);
    if (next !== keys) onChange(next);
  };

  return (
    <div className="min-w-0">
      <svg
        ref={svg}
        viewBox={`0 0 ${S} ${S}`}
        role="group"
        aria-label={label}
        tabIndex={0}
        className="block aspect-square w-full max-w-[360px] min-w-[280px] touch-none rounded-2xl bg-secondary outline-none select-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerDown={(e) => {
          if ((e.target as Element).getAttribute("data-key") !== null) return;
          const { u, p } = at(e);
          const added = addKey(keys, u, p);
          if (added) {
            onChange(added.keys);
            setSel(added.index);
          }
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const { u, p } = at(e);
          d.moved = true;
          setDraft((cur) => moved(cur ?? keys, d.i, u, p));
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (d?.moved && draft) onChange(draft);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.01;
          if (e.key === "ArrowLeft") nudge(-step, 0);
          else if (e.key === "ArrowRight") nudge(step, 0);
          else if (e.key === "ArrowUp") nudge(0, step);
          else if (e.key === "ArrowDown") nudge(0, -step);
          else if ((e.key === "Delete" || e.key === "Backspace") && sel !== null && sel > 0 && sel < keys.length - 1) {
            onChange(keys.filter((_, j) => j !== sel) as WarpKeys);
            setSel(null);
          } else return;
          e.preventDefault();
        }}
      >
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g} className="text-border" stroke="currentColor" strokeWidth={1}>
            <line x1={x(g)} x2={x(g)} y1={y(0)} y2={y(1)} />
            <line x1={x(0)} x2={x(1)} y1={y(g)} y2={y(g)} />
          </g>
        ))}
        <rect x={x(0)} y={y(1)} width={inner} height={inner} fill="none" stroke="currentColor" className="text-border" />
        {underPath && <path d={underPath} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="3 4" className="text-muted-foreground" />}
        <path d={path} fill="none" stroke="currentColor" strokeWidth={2.5} className="text-foreground" />
        {shown.map((k, i) => {
          const end = i === 0 || i === shown.length - 1;
          return (
            <g key={i}>
              <circle
                data-key={i}
                cx={x(k[0])}
                cy={y(k[1])}
                r={22}
                fill="transparent"
                className={end ? "cursor-default" : "cursor-grab"}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  setSel(i);
                  if (end) return;
                  (e.currentTarget.ownerSVGElement as SVGSVGElement).setPointerCapture(e.pointerId);
                  drag.current = { i, moved: false };
                }}
              />
              <circle cx={x(k[0])} cy={y(k[1])} r={6} pointerEvents="none" className={cn(sel === i ? "fill-primary" : "fill-foreground")} stroke="var(--background)" strokeWidth={2} />
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex min-w-0 justify-between text-[11px] text-muted-foreground md:text-[12px]">
        <span>{underLabel ?? "Time across, progress up"}</span>
        <span className="tabular-nums">{shown.length} keys</span>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={sel === null || sel === 0 || sel === keys.length - 1}
          onClick={() => {
            if (sel === null) return;
            onChange(keys.filter((_, j) => j !== sel) as WarpKeys);
            setSel(null);
          }}
          className="h-11 rounded-full bg-secondary px-4 text-[13px] font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
        >
          Delete key
        </button>
        <p className="min-w-0 text-[11px] text-muted-foreground md:text-[12px]">Tap the graph to add a key; drag to move it.</p>
      </div>
    </div>
  );
}
