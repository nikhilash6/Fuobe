"use client";

import { useId, type ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DIRECTION_NAMES, EXACT_LIMITS, exactSummary, normalizeExact, type ExactOrbit } from "@/lib/exact-orbit";
import type { Engine } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

/** What each engine does with an exact orbit, said under the switch. */
export const EXACT_ENGINE_LINE: Record<Engine, string> = {
  open: "On your GPU: the still's depth is measured and the camera follows your numbers exactly · about 5 s · needs a large GPU",
  cloud: "In the cloud: MiniMax H3 Max follows your numbers as camera keyframes",
};

/**
 * The "Exact" switch on an orbit move (build plan N7-7): off, the move follows its LoRA's or the prompt's idea of an
 * orbit ("Loose"); on, the camera follows the numbers: degrees, direction seen from above, a height tilt and a radius pulse.
 */
export function ExactOrbitControls({
  value,
  defaults,
  onChange,
  engine,
  className,
  compact,
  footer,
}: {
  /** null: the switch is off. */
  value: ExactOrbit | null;
  defaults: ExactOrbit;
  onChange: (v: ExactOrbit | null) => void;
  engine?: Engine;
  className?: string;
  compact?: boolean;
  /** Under the controls while the switch is on: the price, or what is still needed. */
  footer?: ReactNode;
}) {
  const id = useId();
  const on = !!value;
  const o = normalizeExact(value ?? defaults, defaults);
  const set = (patch: Partial<ExactOrbit>) => onChange(normalizeExact({ ...o, ...patch }, defaults));
  return (
    <div className={cn("min-w-0 rounded-xl border bg-card p-3", className)} data-testid="exact-orbit">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Label htmlFor={`${id}-switch`} className="text-[13px] font-medium">
            Exact orbit
          </Label>
          <p className="truncate text-[12px] text-muted-foreground">{on ? exactSummary(o) : "Off: the move keeps its own style of orbit"}</p>
        </div>
        <Switch id={`${id}-switch`} checked={on} onCheckedChange={(c) => onChange(c ? o : null)} aria-label="Exact orbit" />
      </div>
      {on && (
        <div className={cn("mt-3 grid gap-3", !compact && "sm:grid-cols-2")}>
          <div className="min-w-0">
            <div className="mb-1.5 flex justify-between text-[12px]">
              <span id={`${id}-deg`}>Degrees</span>
              <span className="text-muted-foreground tabular-nums">{o.degrees}°</span>
            </div>
            <Slider
              aria-labelledby={`${id}-deg`}
              aria-valuetext={`${o.degrees} degrees`}
              min={EXACT_LIMITS.degrees.min}
              max={EXACT_LIMITS.degrees.max}
              step={EXACT_LIMITS.degrees.step}
              value={[o.degrees]}
              onValueChange={([v]) => set({ degrees: v })}
            />
          </div>
          <div className="min-w-0">
            <div className="mb-1.5 flex justify-between text-[12px]">
              <span id={`${id}-tilt`}>Height tilt</span>
              <span className="text-muted-foreground tabular-nums">{o.tilt}°</span>
            </div>
            <Slider
              aria-labelledby={`${id}-tilt`}
              aria-valuetext={`${o.tilt} degrees`}
              min={EXACT_LIMITS.tilt.min}
              max={EXACT_LIMITS.tilt.max}
              step={EXACT_LIMITS.tilt.step}
              value={[o.tilt]}
              onValueChange={([v]) => set({ tilt: v })}
            />
          </div>
          <div className="min-w-0">
            <p className="mb-1.5 text-[12px]" id={`${id}-dir`}>
              Direction (seen from above)
            </p>
            <ToggleGroup type="single" variant="outline" size="sm" aria-labelledby={`${id}-dir`} value={o.direction} onValueChange={(v) => v && set({ direction: v as ExactOrbit["direction"] })} className="w-full">
              {(["cw", "ccw"] as const).map((d) => (
                <ToggleGroupItem key={d} value={d} className="flex-1 text-[12px]">
                  {DIRECTION_NAMES[d]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="min-w-0">
            <p className="mb-1.5 text-[12px]" id={`${id}-pulse`}>
              Radius pulse
            </p>
            <ToggleGroup type="single" variant="outline" size="sm" aria-labelledby={`${id}-pulse`} value={String(o.pulse)} onValueChange={(v) => v && set({ pulse: Number(v) })} className="w-full">
              <ToggleGroupItem value="0" className="flex-1 text-[12px]">
                None
              </ToggleGroupItem>
              <ToggleGroupItem value="0.25" className="flex-1 text-[12px]">
                In and out 25%
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      )}
      {on && engine && <p className="mt-2.5 text-[11.5px] text-muted-foreground">{EXACT_ENGINE_LINE[engine]}</p>}
      {on && footer && <div className="mt-1.5 text-[12px] font-medium">{footer}</div>}
    </div>
  );
}
