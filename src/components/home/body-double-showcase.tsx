"use client";

import { useRef, useState } from "react";
import { usePlayInView } from "@/components/body-double/use-play-in-view";
import { BODY_DOUBLE_DEMOS, BODY_LOOKS, type BodyLookId } from "@/lib/catalog/body-double";
import { cn } from "@/lib/utils";

type Shown = "motion" | BodyLookId;

const lookSrc = (look: BodyLookId) => `/samples/body-double/looks/${look}.jpg`;
/** Each look's picture fetched once, the first time its chip is pointed at, so it shows at once when picked. */
const warmed = new Set<string>();
const warm = (look: BodyLookId) => {
  if (warmed.has(look)) return;
  warmed.add(look);
  const img = new Image();
  img.decoding = "async";
  img.src = lookSrc(look);
};

/**
 * Home's Body Double picture: a dance and its motion capture, playing only while it is on screen; each look's chip
 * shows four models on a rooftop as their doubles in that look, over their whole outline. One picture at a time, so the
 * page composites a single layer here.
 */
export function BodyDoubleShowcase({ className }: { className?: string }) {
  const [shown, setShown] = useState<Shown>("motion");
  const video = useRef<HTMLVideoElement>(null);
  usePlayInView(video, shown === "motion");
  const chips: { value: Shown; label: string }[] = [{ value: "motion", label: "Motion capture" }, ...BODY_LOOKS.map((l) => ({ value: l.value, label: l.label }))];
  const look = shown === "motion" ? null : BODY_LOOKS.find((l) => l.value === shown)!;
  return (
    <div className={cn("space-y-3", className)}>
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-media shadow-strong">
        {look ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={look.value} src={lookSrc(look.value)} alt={`Four models on a rooftop as their ${look.label} body doubles`} decoding="async" className="absolute inset-0 size-full object-cover" />
        ) : (
          <video
            ref={video}
            src={BODY_DOUBLE_DEMOS.clip.video}
            poster={BODY_DOUBLE_DEMOS.clip.poster}
            muted
            loop
            playsInline
            preload="none"
            aria-label="A dance beside its Holo body double, with its 3D pose"
            className="absolute inset-0 size-full object-cover"
          />
        )}
        <span className="pointer-events-none absolute top-3 left-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white">{look ? look.label : "Motion capture"}</span>
      </div>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Show Body Double">
        {chips.map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={shown === c.value}
            onClick={() => setShown(c.value)}
            onPointerEnter={(e) => {
              if (c.value !== "motion") warm(c.value);
              if (e.pointerType === "mouse") setShown(c.value);
            }}
            onFocus={() => c.value !== "motion" && warm(c.value)}
            className={cn(
              "h-8 rounded-full border px-3 text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
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
