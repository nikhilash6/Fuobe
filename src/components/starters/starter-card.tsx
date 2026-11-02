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
  className?: string;
}

/**
 * A ready-made starter as a card: its cover with its steps in a few words over a corner, an icon badge, a title, one
 * line of description and one action. The cards of a row line up: the description takes two lines at most and the
 * action sits at the foot.
 */
export function StarterCard({ coverKey, cover, hue, flow, overlay, icon, title, description, href, meta, badge, action, className }: StarterCardProps) {
  const { ref, playing, asked, handlers } = useCoverPlayback<HTMLElement>(coverKey, cover);
  const iconBadge = <span className="absolute top-3 left-3 grid size-8 place-items-center rounded-lg bg-background/90 text-foreground shadow-soft">{icon}</span>;
  return (
    <article
      ref={ref}
      {...handlers}
      className={cn(
        "group/starter relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card transition-shadow focus-within:ring-4 focus-within:ring-brand-faint hover:shadow-normal",
        className,
      )}
    >
      {cover ? (
        <div className="relative aspect-[16/9] overflow-hidden bg-muted">
          {cover.frames.length > 1 ? (
            <div className="absolute inset-0 grid auto-cols-fr grid-flow-col gap-0.5">
              {cover.frames.map((f) => (
                <CoverImg key={f.src} frame={f} sizes="(max-width: 640px) 34vw, (max-width: 1024px) 17vw, 150px" />
              ))}
            </div>
          ) : (
            <CoverArt cover={cover} sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 440px" playing={playing} asked={asked} />
          )}
          {flow && <span className="pointer-events-none absolute right-2.5 bottom-2.5">{flow}</span>}
          {iconBadge}
        </div>
      ) : (
        <div className="relative aspect-[16/9] bg-muted/50" style={{ background: `linear-gradient(135deg, oklch(0.62 0.12 ${hue} / 0.14), transparent 70%)` }}>
          <div className="absolute inset-0">{overlay}</div>
          {iconBadge}
        </div>
      )}
      {badge && <span className="pointer-events-none absolute top-3 right-3 rounded-full bg-background/90 px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-soft">{badge}</span>}
      <div className="flex flex-1 flex-col gap-2 p-3.5">
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
