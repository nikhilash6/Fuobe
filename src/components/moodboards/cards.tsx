"use client";

import { AlertCircle, Check, Loader2 } from "lucide-react";
import type { MoodboardStatus } from "@/lib/catalog/palettes";
import { cn } from "@/lib/utils";
import { DrawnTile } from "@/components/photodump/covers";
import { STATUS_LABEL, type CuratedMoodboard, type Moodboard } from "./logic";

/**
 * A curated look's cover: its real cover once one is published (template-covers.ts, "soul/<look id>"), otherwise
 * drawn in the look's hue and treatment — grain for black and white, a flash hotspot, gels…; its name on top.
 */
export function CuratedCover({ m, className, sizes = "200px" }: { m: Pick<CuratedMoodboard, "name" | "hue" | "preview" | "tone">; className?: string; sizes?: string }) {
  return (
    <DrawnTile hue={m.hue} tone={m.tone ?? "plain"} className={className}>
      {m.preview && (
        // A real cover: its 320 px copy where the cover shows small (`sizes`, how wide it shows).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={m.preview.src}
          srcSet={`${m.preview.thumb} 320w, ${m.preview.src} 768w`}
          sizes={sizes}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {/* A scrim under the name, so it reads on light covers too (pastel washes, live previews). */}
      {m.name && <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/60 to-transparent" />}
      {m.name && <span className="absolute inset-x-2 bottom-2 font-heading text-[19px] leading-tight text-white drop-shadow-sm">{m.name}</span>}
    </DrawnTile>
  );
}

export function StatusBadge({ status, className }: { status: MoodboardStatus; className?: string }) {
  const busy = status !== "complete" && status !== "failed";
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full bg-background/95 px-2 text-[11px] font-medium shadow-soft",
        status === "complete" ? "text-success" : status === "failed" ? "text-destructive" : "text-foreground",
        className,
      )}
    >
      {busy && <Loader2 className="size-3 animate-spin" />}
      {status === "complete" && <Check className="size-3" />}
      {status === "failed" && <AlertCircle className="size-3" />}
      {STATUS_LABEL[status]}
    </span>
  );
}

/** A personal board's cover: the cover image (or a 2×2 of its first images while it builds). */
export function BoardCover({ m, className }: { m: Pick<Moodboard, "cover" | "images" | "status">; className?: string }) {
  const done = m.status === "complete" && m.cover;
  return (
    <span className={cn("relative block overflow-hidden bg-muted", className)}>
      {done ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.cover!} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        <span className="grid size-full grid-cols-2 grid-rows-2 gap-px opacity-80">
          {m.images.slice(0, 4).map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" loading="lazy" className="size-full object-cover" />
          ))}
        </span>
      )}
    </span>
  );
}
