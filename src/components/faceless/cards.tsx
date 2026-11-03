"use client";

import { AlertTriangle, Heart, Loader2, PenLine, Tv } from "lucide-react";
import Link from "next/link";
import { MediaThumb } from "@/components/studio/feed";
import { formatLength, genreInfo, getStyle, type EpisodeCard as Card, type FacelessChannel } from "@/lib/catalog/faceless";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StyleArt } from "./style-art";

const hueOf = (s: string) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[\p{L}\p{N}]/u.test(w) && !/^(the|of|and|a|an)$/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** The channel's avatar, or its initials on a colour of its own. */
export function ChannelAvatar({ channel, className }: { channel: Pick<FacelessChannel, "id" | "name" | "avatarUrl">; className?: string }) {
  const hue = hueOf(channel.id);
  if (channel.avatarUrl)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={channel.avatarUrl} alt="" className={cn("size-10 shrink-0 rounded-full object-cover", className)} />;
  return (
    <span
      aria-hidden
      className={cn("grid size-10 shrink-0 place-items-center rounded-full font-heading text-[16px] text-white", className)}
      style={{ background: `linear-gradient(135deg, oklch(0.62 0.14 ${hue}), oklch(0.42 0.12 ${(hue + 50) % 360}))` }}
    >
      {initials(channel.name)}
    </span>
  );
}

/** A style for the card: the first style reference (your own style), or the preset's art. */
function StylePicture({ styleId, styleRef, className }: { styleId: string; styleRef?: string | null; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (styleRef) return <img src={styleRef} alt="" className={cn("size-full object-cover", className)} />;
  return <StyleArt styleId={styleId} className={className} />;
}

/** "Your own style" when the look comes from style references. */
const styleName = (styleId: string, ownStyle: boolean) => (ownStyle ? "Your own style" : getStyle(styleId).name);

export function ChannelCard({ channel }: { channel: FacelessChannel }) {
  const cover = channel.cover?.outputs.find((o) => o.kind === "image");
  const refs = channel.settings.styleRefs ?? [];
  return (
    <Link href={`/faceless/${channel.id}`} className="group/card card-motion block animate-fade-up rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="relative aspect-video overflow-hidden rounded-xl bg-muted">
        {cover ? (
          <MediaThumb output={cover} className="card-zoom" />
        ) : (
          <StylePicture styleId={channel.settings.styleId} styleRef={refs[0]} className="opacity-90" />
        )}
        <span className="absolute bottom-2 left-2 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">{genreInfo(channel.genre).label}</span>
      </div>
      <div className="mt-2.5 flex min-w-0 items-center gap-2.5 px-0.5">
        <ChannelAvatar channel={channel} className="size-8 text-[13px]" />
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-medium">{channel.name}</h3>
          <p className="truncate text-[12px] text-muted-foreground">
            {channel.episodes ?? 0} episode{channel.episodes === 1 ? "" : "s"} · {styleName(channel.settings.styleId, refs.length > 0)}
          </p>
        </div>
      </div>
    </Link>
  );
}

const STATUS: Record<Card["status"], string> = {
  writing: "Writing the script…",
  "write-failed": "Couldn't write the script",
  review: "Script ready to review",
  rendering: "Rendering",
  done: "",
  failed: "A step failed",
};

/** An episode in a channel's list or the Explainer history. */
export function EpisodeTile({ ep, href, onLike }: { ep: Card; href: string; onLike?: () => void }) {
  // The first scene's picture shows everywhere (and before the film is done); the film plays on hover.
  const picture = ep.still?.outputs.find((o) => o.kind === "image");
  const film = ep.poster?.outputs.find((o) => o.kind === "video");
  const vertical = ep.aspect === "9:16";
  return (
    <div className="group/card relative min-w-0 animate-fade-up">
      <Link href={href} className="card-motion block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Open ${ep.title}`}>
        <div className={cn("relative overflow-hidden rounded-xl bg-muted", vertical ? "aspect-[4/5]" : "aspect-video")}>
          {picture ? (
            <MediaThumb output={picture} className={cn("card-zoom", ep.status !== "done" && "opacity-70")} />
          ) : film ? (
            <MediaThumb output={film} />
          ) : (
            <StylePicture styleId={ep.styleId} styleRef={ep.styleRef} className="opacity-80" />
          )}
          {ep.status !== "done" && (
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent p-2.5 pt-8 text-[12px] font-medium text-white">
              {ep.status === "rendering" || ep.status === "writing" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : ep.status === "review" ? (
                <PenLine className="size-3.5" />
              ) : (
                <AlertTriangle className="size-3.5" />
              )}
              <span className="truncate">{ep.updating ? "Updating a scene" : STATUS[ep.status]}</span>
              {ep.status === "rendering" && <span className="ml-auto font-mono tabular-nums">{Math.round(ep.progress * 100)}%</span>}
            </div>
          )}
          {ep.status === "rendering" && (
            <div className="absolute inset-x-0 top-0 h-0.5">
              <div className="h-full bg-primary origin-left transition-transform duration-(--motion-slow) ease-standard" style={{ transform: `scaleX(${(Math.round(ep.progress * 100)) / 100})` }} />
            </div>
          )}
          {ep.status === "done" && <span className="absolute right-2 bottom-2 rounded-full bg-black/55 px-1.5 py-0.5 font-mono text-[11px] text-white tabular-nums">{formatLength(ep.seconds)}</span>}
        </div>
        <div className="mt-2 min-w-0 px-0.5">
          <h3 className="line-clamp-2 text-[14px] leading-snug font-medium">{ep.title}</h3>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
            {styleName(ep.styleId, ep.ownStyle)} · {timeAgo(ep.createdAt)}
          </p>
        </div>
      </Link>
      {onLike && (
        <button
          type="button"
          onClick={onLike}
          aria-pressed={ep.favorite}
          aria-label={ep.favorite ? `Unlike ${ep.title}` : `Like ${ep.title}`}
          className={cn(
            "absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-black/45 text-white backdrop-blur transition-opacity hover:bg-black/65 focus-visible:opacity-100",
            ep.favorite ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover/card:opacity-100",
          )}
        >
          <Heart className={cn("size-4", ep.favorite && "fill-highlight text-highlight")} />
        </button>
      )}
    </div>
  );
}

export function EmptyChannels() {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed px-6 py-10 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-brand-faint text-brand-text">
        <Tv className="size-5" />
      </div>
      <p className="mt-3 font-heading text-[22px]">No channels yet</p>
      <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">Describe a channel above: it keeps its look, narrator and format, so every episode feels like the same show.</p>
    </div>
  );
}
