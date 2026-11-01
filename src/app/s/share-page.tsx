import { Box, Download, EyeOff, FileText, Link2Off } from "lucide-react";
import Link from "next/link";
import { coverSlide, orderForLayout, pieces, type PublicItem, type PublicMedia, type PublicShare } from "@/lib/share";
import { cn } from "@/lib/utils";
import { Carousel, RecreateButton } from "@/components/share/share-client";

/**
 * The public page of a share link (/s/<token>): what was shared, its title, model and — when the
 * owner shares prompts — each prompt with "Recreate in your Fuobe". Server-rendered from
 * PublicShare (src/server/shares.ts); every file URL is share-scoped. No app chrome, no links into
 * the studio: a visitor has nothing else to open. It lives with the /s routes, outside the studio
 * frame, so its <main> is the page's only one (the studio's is SidebarInset).
 */
export function SharePage({ share }: { share: PublicShare }) {
  const items = orderForLayout(share.items, share.layout, share.coverKey);
  const single = items.length === 1;
  const keyArt = share.layout === "series" && !single ? share.cover : null;
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-3 px-4 pt-5 sm:px-8">
        <p className="font-heading text-[22px] leading-none">Fuobe</p>
        <p className="text-[12px] text-muted-foreground">Shared with a read-only link</p>
      </header>
      <main className="mx-auto w-full max-w-[1200px] min-w-0 flex-1 px-4 pt-8 pb-16 sm:px-8 sm:pt-12">
        {/* A Series shows its cover as key art beside the title (under it on phones). */}
        <div className={cn(keyArt ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-end lg:gap-10" : "max-w-3xl")}>
          <div className="min-w-0 max-w-3xl">
            {share.tags.length > 0 && (
              <ul className="mb-3 flex flex-wrap gap-1.5" aria-label="Tags">
                {share.tags.map((t) => (
                  <li key={t} className="rounded-full bg-brand-faint px-2.5 py-0.5 text-[12px] font-medium text-brand-text">
                    #{t}
                  </li>
                ))}
              </ul>
            )}
            <h1 className="font-heading text-[38px] leading-[1.08] text-balance break-words sm:text-[52px]">{share.title}</h1>
            {share.description && <p className="mt-3 text-[16px] leading-relaxed whitespace-pre-line text-pretty text-muted-foreground">{share.description}</p>}
            <p className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
              <span>{pieces(items.length)}</span>
              {!share.showPrompts && (
                <span className="inline-flex items-center gap-1">
                  <EyeOff className="size-3.5" /> Prompts hidden by the owner
                </span>
              )}
            </p>
          </div>
          {keyArt && (
            <figure className="min-w-0 overflow-hidden rounded-2xl border bg-muted/40" data-cover>
              {/* A clip's poster as the still; the clip itself plays in its episode. */}
              <Media media={keyArt.kind === "video" && keyArt.poster ? { ...keyArt, kind: "image", url: keyArt.poster } : keyArt} alt={`Cover of ${share.title}`} fit short />
            </figure>
          )}
        </div>

        <div className="mt-8 sm:mt-10">
          {!items.length ? (
            <Nothing />
          ) : single ? (
            <Hero item={items[0]} showPrompts={share.showPrompts} />
          ) : share.layout === "feature" ? (
            <div className="space-y-10">
              <Hero item={items[0]} showPrompts={share.showPrompts} />
              <Grid items={items.slice(1)} showPrompts={share.showPrompts} />
            </div>
          ) : share.layout === "series" ? (
            <ol className="mx-auto max-w-3xl space-y-12">
              {items.map((it, i) => (
                <li key={it.key}>
                  <p className="mb-2 font-mono text-[12px] tracking-wide text-muted-foreground uppercase">Episode {i + 1}</p>
                  <Piece item={it} showPrompts={share.showPrompts} wide />
                </li>
              ))}
            </ol>
          ) : share.layout === "carousel" ? (
            <Carousel count={items.length} labels={items.map((it) => it.title)} start={coverSlide(items, share.coverKey)}>
              {items.map((it, i) => (
                <div key={it.key} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${items.length}`} className="w-full shrink-0 snap-center px-px">
                  <Piece item={it} showPrompts={share.showPrompts} wide fit />
                </div>
              ))}
            </Carousel>
          ) : (
            <Grid items={items} showPrompts={share.showPrompts} />
          )}
          {share.truncated && <p className="mt-6 text-center text-[13px] text-muted-foreground">Showing the newest {items.length}.</p>}
        </div>
      </main>
      <footer className="mx-auto w-full max-w-[1200px] px-4 pb-8 text-[12px] text-muted-foreground sm:px-8">
        Made with Fuobe, an open-source studio for images and video. This page is read-only.
      </footer>
    </div>
  );
}

function Grid({ items, showPrompts }: { items: PublicItem[]; showPrompts: boolean }) {
  return (
    <div className="columns-1 gap-4 sm:columns-2 lg:columns-3">
      {items.map((it) => (
        <div key={it.key} className="mb-4 break-inside-avoid">
          <Piece item={it} showPrompts={showPrompts} />
        </div>
      ))}
    </div>
  );
}

/** One piece large, its words beside it on wide screens and under it on phones. */
function Hero({ item, showPrompts }: { item: PublicItem; showPrompts: boolean }) {
  return (
    <figure className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
      <div className="min-w-0 overflow-hidden rounded-2xl border bg-muted/40">
        <MediaSet item={item} fit />
      </div>
      <figcaption className="min-w-0 lg:sticky lg:top-6">
        <Caption item={item} showPrompts={showPrompts} />
      </figcaption>
    </figure>
  );
}

function Piece({ item, showPrompts, wide, fit }: { item: PublicItem; showPrompts: boolean; wide?: boolean; fit?: boolean }) {
  return (
    <figure className="min-w-0 overflow-hidden rounded-2xl border bg-card">
      <div className={cn("bg-muted/40", wide && "border-b")}>
        <MediaSet item={item} fit={fit} />
      </div>
      <figcaption className="p-4">
        <Caption item={item} showPrompts={showPrompts} compact={!wide} />
      </figcaption>
    </figure>
  );
}

function Caption({ item, showPrompts, compact }: { item: PublicItem; showPrompts: boolean; compact?: boolean }) {
  const first = item.media[0];
  return (
    <div className="min-w-0 space-y-2.5">
      <div className="min-w-0">
        <p className={cn("font-medium break-words", compact ? "text-[14px] leading-snug" : "text-[16px]")}>{item.title}</p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">Made with {item.model}</p>
      </div>
      {showPrompts && item.prompt && (
        <blockquote className={cn("rounded-xl bg-muted/60 px-3 py-2 text-[13px] leading-relaxed break-words whitespace-pre-line", compact && "line-clamp-6")}>{item.prompt}</blockquote>
      )}
      <div className="flex flex-wrap gap-1.5">
        {showPrompts && item.prompt && <RecreateButton prompt={item.prompt} model={item.model} />}
        {first && (
          <a
            href={`${first.url}?download=${encodeURIComponent(first.download)}`}
            download={first.download}
            className="inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[0.8rem] font-medium hover:bg-muted"
            aria-label={`Download ${first.download}`}
          >
            <Download className="size-3.5" /> Download
          </a>
        )}
      </div>
    </div>
  );
}

/** An item's files: one large, or a small grid when a run made several pictures. */
function MediaSet({ item, fit }: { item: PublicItem; fit?: boolean }) {
  const shown = item.kind === "model3d" ? [...item.media].sort((a, b) => Number(a.kind === "model3d") - Number(b.kind === "model3d")) : item.media;
  if (shown.length > 1 && shown.every((m) => m.kind === "image")) {
    return (
      <div className="grid grid-cols-2 gap-px">
        {shown.slice(0, 8).map((m, i) => (
          <Media key={m.url} media={m} alt={`${item.title}, ${i + 1} of ${shown.length}`} />
        ))}
      </div>
    );
  }
  return (
    <div className="divide-y">
      {shown.slice(0, 4).map((m, i) => (
        <Media key={m.url} media={m} alt={shown.length > 1 ? `${item.title}, ${i + 1} of ${shown.length}` : item.title} fit={fit} />
      ))}
    </div>
  );
}

function Media({ media: m, alt, fit, short }: { media: PublicMedia; alt: string; fit?: boolean; short?: boolean }) {
  const box = fit ? cn("mx-auto w-auto max-w-full", short ? "max-h-[56svh]" : "max-h-[78svh]") : "w-full";
  switch (m.kind) {
    case "image":
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.url} alt={alt} width={m.width} height={m.height} loading="lazy" decoding="async" className={cn("block h-auto object-contain", box)} />
      );
    case "video":
      return <video src={m.url} poster={m.poster} controls playsInline preload="metadata" aria-label={alt} className={cn("block h-auto bg-black", box)} />;
    case "audio":
      return (
        <div className="p-4">
          <audio src={m.url} controls preload="metadata" aria-label={alt} className="w-full" />
        </div>
      );
    case "text":
      return (
        <div className="max-h-[60svh] overflow-auto p-4">
          {m.text ? (
            <p className="text-[14px] leading-relaxed break-words whitespace-pre-wrap">{m.text}</p>
          ) : (
            <p className="flex items-center gap-2 text-[14px] text-muted-foreground">
              <FileText className="size-4" /> A text file: use Download to read it.
            </p>
          )}
        </div>
      );
    default:
      return (
        <div className="flex items-center gap-3 p-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-faint text-brand-text">
            <Box className="size-5" />
          </span>
          <div className="min-w-0 text-[13px]">
            <p className="font-medium break-all">{m.download}</p>
            <a href={`${m.url}?download=${encodeURIComponent(m.download)}`} download={m.download} className="text-brand-text underline underline-offset-2">
              Download the 3D file
            </a>
          </div>
        </div>
      );
  }
}

function Nothing() {
  return (
    <div className="rounded-2xl border border-primary/10 bg-brand-faint px-6 py-14 text-center">
      <p className="font-heading text-[24px]">Nothing to show here yet</p>
      <p className="mt-1 text-[14px] text-muted-foreground">The owner hasn&apos;t added anything finished to what they shared.</p>
    </div>
  );
}

/** A revoked, expired, wrong or emptied link: one calm screen, and the studio's own front door. */
export function ShareGone() {
  return (
    <main className="flex min-h-svh flex-col bg-background">
      <p className="px-4 pt-5 font-heading text-[22px] leading-none sm:px-8">Fuobe</p>
      <div className="mx-auto flex max-w-[460px] flex-1 flex-col items-center justify-center px-6 pb-[10vh] text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand-faint text-brand-text">
          <Link2Off className="size-5" />
        </span>
        <h1 className="mt-5 font-heading text-[34px] leading-tight text-balance">This link isn&apos;t available</h1>
        <p className="mt-2 text-[15px] text-pretty text-muted-foreground">It may have expired or been turned off, or what it shared was removed. Ask the person who sent it for a new link.</p>
        <Link href="/" prefetch={false} className="mt-7 inline-flex h-9 items-center rounded-full bg-primary px-4 text-[14px] font-medium text-primary-foreground hover:bg-primary/90">
          Make your own with Fuobe
        </Link>
      </div>
    </main>
  );
}

export function ShareSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pt-16 sm:px-8" aria-busy="true" aria-label="Loading">
      <div className="h-12 w-2/3 max-w-lg animate-pulse rounded-xl bg-muted" />
      <div className="mt-4 h-4 w-1/2 max-w-sm animate-pulse rounded bg-muted" />
      <div className="mt-10 aspect-video w-full animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}
