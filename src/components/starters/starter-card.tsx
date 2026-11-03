"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { CoverArt, CoverImg, useCoverPlayback } from "@/components/template-cover";
import type { TemplateCover } from "@/lib/template-covers";
import { cn } from "@/lib/utils";

export interface StarterCardProps {
  /** The cover's playback key (one clip plays at a time on a phone). */
  coverKey: string;
  /** What the starter makes: a still, a clip, or its frames side by side. None: the overlay fills the card (owner only). */
  cover?: TemplateCover;
  /** The tint behind a card without a cover. */
  hue: number;
  /** The steps in a few words, over the cover's bottom-right corner. */
  flow?: ReactNode;
  /** The steps in miniature, filling a card that has no cover yet. */
  overlay: ReactNode;
  icon: ReactNode;
  title: string;
  description: string;
  /** The starter's page: the whole card opens it. */
  href: string;
  /** A line under the description (the owner's: the models it runs on). */
  meta?: ReactNode;
  /** A small chip on the cover (the owner's: "No cover yet"). */
  badge?: string;
  /** The card's one action, at its foot: a button over the card's link, or words that belong to it. */
  action?: ReactNode;
  /** Two cards side by side: a wider, lower cover (2:1) from the small breakpoint up. */
  wide?: boolean;
  /** On a phone, the cover as a thumbnail on the left and the words beside it (a row that must fit above a docked composer). */
  compact?: boolean;
  /** A portrait still: shown from its top, so a head is never cut off in the wide frame. */
  coverTop?: boolean;
  className?: string;
}

/**
 * A ready-made starter as a card: its cover with its steps in a few words over a corner, an icon badge, a title, one
 * line of description and one action. The cards of a row line up: the description takes two lines at most and the
 * action sits at the foot.
 */
export function StarterCard({ coverKey, cover, hue, flow, overlay, icon, title, description, href, meta, badge, action, wide, compact, coverTop, className }: StarterCardProps) {
  const { ref, playing, asked, handlers } = useCoverPlayback<HTMLElement>(coverKey, cover);
  // A phone's compact card: a thumbnail as tall as the words beside it.
  const shape = cn(wide ? "aspect-[16/9] sm:aspect-[2/1]" : "aspect-[16/9]", compact && "max-sm:aspect-auto max-sm:min-h-28 max-sm:w-28 max-sm:shrink-0");
  const iconBadge = <span className="absolute top-3 left-3 grid size-8 place-items-center rounded-lg bg-background/90 text-foreground shadow-soft">{icon}</span>;
  return (
    <article
      ref={ref}
      {...handlers}
      className={cn(
        "group/starter relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card transition-shadow focus-within:ring-4 focus-within:ring-brand-faint hover:shadow-normal",
        compact && "max-sm:flex-row",
        className,
      )}
    >
      {cover ? (
        <div className={cn("relative overflow-hidden bg-muted", shape)}>
          {cover.frames.length > 1 || (coverTop && !cover.video) ? (
            <div className="absolute inset-0 grid auto-cols-fr grid-flow-col gap-0.5">
              {cover.frames.map((f) => (
                <CoverImg
                  key={f.src}
                  frame={f}
                  sizes={cover.frames.length > 1 ? "(max-width: 640px) 34vw, (max-width: 1024px) 17vw, 150px" : "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 440px"}
                  className={coverTop ? "object-top" : undefined}
                />
              ))}
            </div>
          ) : (
            <CoverArt cover={cover} sizes={`(max-width: 640px) ${compact ? "112px" : "100vw"}, (max-width: 1024px) 50vw, 440px`} playing={playing} asked={asked} />
          )}
          {flow && <span className={cn("pointer-events-none absolute right-2.5 bottom-2.5", compact && "max-sm:hidden")}>{flow}</span>}
          {iconBadge}
        </div>
      ) : (
        <div className={cn("relative bg-muted/50", shape)} style={{ background: `linear-gradient(135deg, oklch(0.62 0.12 ${hue} / 0.14), transparent 70%)` }}>
          <div className="absolute inset-0">{overlay}</div>
          {iconBadge}
        </div>
      )}
      {badge && <span className={cn("pointer-events-none absolute top-3 right-3 rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-soft", compact && "max-sm:top-auto max-sm:right-auto max-sm:bottom-2 max-sm:left-2")}>{badge}</span>}
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3.5">
        <div>
          <h3 className="text-[14px] font-medium">
            {/* The whole card opens the starter's page; the action sits above this link. */}
            <Link href={href} className="outline-none after:absolute after:inset-0 after:content-['']">
              {title}
            </Link>
          </h3>
          <p className="line-clamp-2 text-[13px] text-muted-foreground">{description}</p>
        </div>
        {meta}
        {action && <div className="relative z-10 mt-auto pt-1 [&:has(>span)]:pointer-events-none">{action}</div>}
      </div>
    </article>
  );
}
