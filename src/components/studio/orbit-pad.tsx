"use client";

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { PresetOption } from "@/lib/catalog/types";
import { orbitDrag, qmaLabel, qmaPose, qmaView, QMA_ELEVATIONS, QMA_PARAMS } from "@/lib/qma";
import type { ScenePose } from "@/lib/scene3d";
import { cn } from "@/lib/utils";

/**
 * The Angles app's orbit pad (qma-angles): drag round the ring to swing the camera, up and down to raise or lower it. It
 * snaps to the nearest of the app's views (QMA's 96: 8 sides, 4 heights, 3 distances) and sets the same choices as the chips
 * beside it, so both always agree.
 */

type Keys = { angle: PresetOption; height: PresetOption; distance: PresetOption };

/** The app's three camera options, when it has them (choices that set horizontal_angle, vertical_angle and zoom). */
export function orbitOptions(options: PresetOption[] | undefined): Keys | undefined {
  const by = (param: string) => options?.find((o) => o.choices.length > 0 && o.choices.every((c) => typeof c.extra?.[param] === "number"));
  const angle = by(QMA_PARAMS.horizontal);
  const height = by(QMA_PARAMS.vertical);
  const distance = by(QMA_PARAMS.zoom);
  return angle && height && distance ? { angle, height, distance } : undefined;
}

const chosen = (o: PresetOption, values: Record<string, string>) => o.choices.find((c) => c.value === (values[o.key] ?? o.default ?? o.choices[0]?.value)) ?? o.choices[0];

/** The choice of an option whose setting is nearest a value. */
function nearest(o: PresetOption, param: string, v: number): string {
  return o.choices.reduce((best, c) => (Math.abs(Number(c.extra?.[param]) - v) < Math.abs(Number(best.extra?.[param]) - v) ? c : best)).value;
}

export function OrbitPad({ options, values, onChange }: { options: Keys; values: Record<string, string>; onChange: (next: Record<string, string>) => void }) {
  const pose: ScenePose = {
    horizontal: Number(chosen(options.angle, values).extra?.[QMA_PARAMS.horizontal] ?? 0),
    vertical: Number(chosen(options.height, values).extra?.[QMA_PARAMS.vertical] ?? 0),
    zoom: Number(chosen(options.distance, values).extra?.[QMA_PARAMS.zoom] ?? 5),
  };
  const view = qmaView(pose);
  const drag = useRef<{ x: number; y: number; from: ScenePose; size: number } | null>(null);
  const [live, setLive] = useState<ScenePose | null>(null);

  const set = (p: ScenePose) => {
    const snapped = qmaPose(qmaView(p));
    // The ring wraps: 315° is as near 360° as 0° is far, so the angle compares on the circle.
    const h = snapped.horizontal;
    const angle = options.angle.choices.find((c) => Number(c.extra?.[QMA_PARAMS.horizontal]) % 360 === h)?.value ?? nearest(options.angle, QMA_PARAMS.horizontal, h);
    const next = { ...values, [options.angle.key]: angle, [options.height.key]: nearest(options.height, QMA_PARAMS.vertical, snapped.vertical), [options.distance.key]: nearest(options.distance, QMA_PARAMS.zoom, snapped.zoom) };
    if (Object.keys(next).some((k) => next[k] !== values[k])) onChange(next);
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, from: pose, size: e.currentTarget.getBoundingClientRect().width };
    setLive(pose);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = orbitDrag(d.from, e.clientX - d.x, e.clientY - d.y, d.size);
    setLive(p);
    set(p);
  };
  const up = () => {
    drag.current = null;
    setLive(null);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, Partial<ScenePose>> = {
      ArrowRight: { horizontal: pose.horizontal + 45 },
      ArrowLeft: { horizontal: pose.horizontal - 45 },
      ArrowUp: { vertical: pose.vertical + 30 },
      ArrowDown: { vertical: pose.vertical - 30 },
    };
    if (!step[e.key]) return;
    e.preventDefault();
    set({ ...pose, ...step[e.key] });
  };

  // Seen from above: the subject in the middle, the photo's camera at the bottom, swinging right goes round to the right.
  const shown = live ?? qmaPose(view);
  const rad = (shown.horizontal * Math.PI) / 180;
  const r = 34;
  const cx = 44 + Math.sin(rad) * r;
  const cy = 44 + Math.cos(rad) * r;
  const level = QMA_ELEVATIONS.indexOf(view.elevation);
  const label = qmaLabel(view);
  return (
    <div className="flex items-center gap-3">
      <div
        role="slider"
        tabIndex={0}
        aria-label="Camera orbit: drag to swing the camera round and up or down; arrow keys move it one view"
        aria-valuemin={0}
        aria-valuemax={315}
        aria-valuenow={qmaPose(view).horizontal}
        aria-valuetext={label}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
        className="relative size-[88px] shrink-0 cursor-grab touch-none rounded-full border bg-muted/50 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
      >
        <svg viewBox="0 0 88 88" className="size-full" aria-hidden>
          <circle cx="44" cy="44" r={r} className="fill-none stroke-border" strokeDasharray="2 3" />
          {Array.from({ length: 8 }, (_, i) => {
            const a = (i * 45 * Math.PI) / 180;
            return <circle key={i} cx={44 + Math.sin(a) * r} cy={44 + Math.cos(a) * r} r="1.6" className="fill-muted-foreground/50" />;
          })}
          <rect x="38" y="38" width="12" height="12" rx="3" className="fill-foreground/70" />
          <line x1={cx} y1={cy} x2="44" y2="44" className="stroke-primary" strokeWidth="1.2" />
          <circle cx={cx} cy={cy} r="6" className="fill-primary" />
        </svg>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex h-[60px] flex-col-reverse justify-between" aria-hidden>
          {QMA_ELEVATIONS.map((e, i) => (
            <span key={e} className={cn("h-1.5 w-4 rounded-full", i === level ? "bg-primary" : "bg-muted-foreground/25")} />
          ))}
        </div>
        <p className="max-w-[9rem] text-[12px] leading-snug text-muted-foreground" aria-live="polite">
          <span className="block font-medium text-foreground">{label.split(" · ")[0]}</span>
          {label.split(" · ").slice(1).join(" · ")}
        </p>
      </div>
    </div>
  );
}
