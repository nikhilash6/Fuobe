"use client";

import { useState } from "react";
import { BODY_DOUBLE_DEMOS, BODY_LOOKS, type BodyLookId } from "@/lib/catalog/body-double";
import { cn } from "@/lib/utils";

type Shown = "motion" | BodyLookId;

/**
 * Home's Body Double picture: a dance and its motion capture, playing; each look's chip shows four models on a rooftop
 * as their doubles in that look, over their whole outline. Real results, no requests beyond the files.
 */
export function BodyDoubleShowcase({ className }: { className?: string }) {
  const [shown, setShown] = useState<Shown>("motion");
  const chips: { value: Shown; label: string }[] = [{ value: "motion", label: "Motion capture" }, ...BODY_LOOKS.map((l) => ({ value: l.value, label: l.label }))];
  return (
    <div className={cn("space-y-3", className)}>
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-media shadow-strong">
        <video
          src={BODY_DOUBLE_DEMOS.clip.video}
          poster={BODY_DOUBLE_DEMOS.clip.poster}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-label="A dance beside its Holo body double, with its 3D pose"
          className={cn("absolute inset-0 size-full object-cover transition-opacity duration-300", shown === "motion" ? "opacity-100" : "opacity-0")}
        />
        {BODY_LOOKS.map((l) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={l.value}
            src={`/samples/body-double/looks/${l.value}.jpg`}
            alt={`Four models on a rooftop as their ${l.label} body doubles`}
            loading="lazy"
            decoding="async"
            className={cn("absolute inset-0 size-full object-cover transition-opacity duration-300", shown === l.value ? "opacity-100" : "opacity-0")}
          />
        ))}
        <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
          {shown === "motion" ? "Motion capture" : BODY_LOOKS.find((l) => l.value === shown)?.label}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Show Body Double">
        {chips.map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={shown === c.value}
            onClick={() => setShown(c.value)}
            onPointerEnter={(e) => e.pointerType === "mouse" && setShown(c.value)}
            className={cn(
              "h-8 rounded-full border px-3 text-[13px] outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
              shown === c.value ? "border-foreground bg-foreground text-background" : "bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
