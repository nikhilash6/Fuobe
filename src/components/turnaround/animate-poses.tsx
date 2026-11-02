"use client";

import { Check, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TurnPicture } from "@/lib/catalog/turnaround";
import { animateHref, MAX_KEYS, MIN_KEYS } from "@/lib/inbetween";
import { cn } from "@/lib/utils";

/**
 * "Animate between poses" (Character Sheet, a character element): pick two or more of the character's poses in the order
 * they should play, and the Video studio opens in Frames mode with them as keyframes, in Animation style.
 */
export function AnimatePosesButton({
  pictures,
  name,
  compact,
  variant = "outline",
}: {
  pictures: TurnPicture[];
  name?: string;
  compact?: boolean;
  variant?: "outline" | "ghost" | "secondary";
}) {
  // Single poses only: a whole sheet holds several views in one picture.
  const poses = pictures.filter((p) => !p.sheet);
  const [picked, setPicked] = useState<string[]>(() => poses.slice(0, Math.min(poses.length, 3)).map((p) => p.url));
  if (poses.length < MIN_KEYS) return null;
  const toggle = (url: string) => setPicked((xs) => (xs.includes(url) ? xs.filter((x) => x !== url) : xs.length < MAX_KEYS ? [...xs, url] : xs));
  const prompt = name ? `${name} moves from pose to pose` : undefined;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant={variant} size="sm" aria-label="Animate between poses" data-animate-poses>
          <Sparkles /> <span className={cn(compact && "hidden sm:inline")}>Animate between poses</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3 p-3" align="end">
        <div className="space-y-0.5">
          <p className="text-[13px] font-medium">Animate between poses</p>
          <p className="text-[12px] leading-snug text-muted-foreground">Pick the poses in the order they play. The motion between them is drawn in an animation style.</p>
        </div>
        <div className="grid grid-cols-4 gap-2" role="group" aria-label="Poses">
          {poses.map((p) => {
            const at = picked.indexOf(p.url);
            return (
              <button
                key={p.url}
                type="button"
                aria-pressed={at >= 0}
                aria-label={`${p.label}${at >= 0 ? `, keyframe ${at + 1}` : ""}`}
                onClick={() => toggle(p.url)}
                className={cn("relative aspect-square overflow-hidden rounded-lg border bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring/50", at >= 0 && "ring-2 ring-primary")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" className="size-full object-cover" />
                {at >= 0 && (
                  <span className="absolute top-1 left-1 grid size-5 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground tabular-nums">{at + 1}</span>
                )}
              </button>
            );
          })}
        </div>
        {picked.length >= MIN_KEYS ? (
          <Button asChild size="sm" className="w-full">
            <Link href={animateHref(picked, prompt)}>
              <Check /> Animate {picked.length} poses
            </Link>
          </Button>
        ) : (
          <Button size="sm" className="w-full" disabled>
            Pick at least two poses
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
