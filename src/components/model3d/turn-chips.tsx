"use client";

import { Rotate3d } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TURN_VIEWS, turnOrbit, type TurnView } from "@/lib/av/model3d";
import { cn } from "@/lib/utils";

/**
 * Turn a 3D model with taps: Front, Left side, Back, Right side, From above, and Spin. A tap stops the slow turn and
 * moves the <model-viewer> camera there (model-viewer animates the move); Spin starts the turn again. Dragging the
 * model still works (the desktop extra); it clears the chip that was on. `frontYaw` turns the chips to the model's
 * own front (FRONT_YAW).
 */
export function TurnChips({
  viewer,
  frontYaw = 0,
  dark,
  compact,
  className,
}: {
  viewer: HTMLElement | null;
  frontYaw?: number;
  /** On the full-screen viewer's dark backdrop. */
  dark?: boolean;
  /** Smaller chips, for a card. */
  compact?: boolean;
  className?: string;
}) {
  const [on, setOn] = useState<TurnView | "spin" | null>("spin");
  // model-viewer skips a camera-orbit equal to the last one set, even after a drag: every tap writes a new value.
  const taps = useRef(0);
  useEffect(() => {
    if (!viewer) return;
    const onChange = (e: Event) => {
      if ((e as CustomEvent<{ source?: string }>).detail?.source === "user-interaction") setOn((v) => (v === "spin" ? v : null));
    };
    viewer.addEventListener("camera-change", onChange);
    return () => viewer.removeEventListener("camera-change", onChange);
  }, [viewer]);
  const turn = (id: TurnView) => {
    if (!viewer) return;
    taps.current += 1;
    viewer.removeAttribute("auto-rotate");
    viewer.setAttribute("camera-orbit", turnOrbit(id, frontYaw).replace(/%$/, `${taps.current % 2 ? ".001" : ""}%`));
    setOn(id);
  };
  const spin = () => {
    if (!viewer) return;
    viewer.setAttribute("auto-rotate", "");
    setOn("spin");
  };
  const chip = (active: boolean) =>
    cn(
      "inline-flex items-center gap-1 rounded-full font-medium backdrop-blur transition-colors disabled:opacity-50",
      compact ? "h-8 px-2.5 text-[12px]" : "h-10 px-3.5 text-[13px]",
      dark
        ? active
          ? "bg-white text-black"
          : "bg-white/15 text-white hover:bg-white/25"
        : active
          ? "bg-foreground text-background"
          : "bg-background/85 text-foreground shadow-soft hover:bg-background",
    );
  return (
    <div role="group" aria-label="Turn the model" className={cn("flex flex-wrap justify-center gap-1.5", className)}>
      {TURN_VIEWS.map((v) => (
        <button key={v.id} type="button" className={chip(on === v.id)} aria-pressed={on === v.id} disabled={!viewer} onClick={() => turn(v.id)}>
          {v.label}
        </button>
      ))}
      <button type="button" className={chip(on === "spin")} aria-pressed={on === "spin"} disabled={!viewer} onClick={spin}>
        <Rotate3d className="size-3.5" aria-hidden /> Spin
      </button>
    </div>
  );
}
