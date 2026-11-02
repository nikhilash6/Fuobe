import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader, PageShell } from "@/components/page-shell";

/*
 * Route skeletons (loading.tsx). Server components with no data: they are part of each route's
 * prefetched shell, so a click in the menus paints the next page's frame immediately.
 */

/** A studio: sticky title bar, hero line, the pill composer. */
export function StudioSkeleton() {
  return (
    <div className="flex min-h-content min-w-0 flex-col" aria-busy="true" aria-label="Loading">
      <div className="sticky top-chrome z-20 flex h-14 items-center gap-2 bg-background/85 px-3 sm:px-6">
        <Skeleton className="h-6 w-32 rounded-lg" />
        <Skeleton className="ml-auto h-9 w-44 rounded-full" />
      </div>
      <div className="mx-auto flex w-full max-w-[760px] flex-col items-center px-3 pt-[16vh] sm:px-6">
        <Skeleton className="h-9 w-2/3 max-w-[420px] rounded-xl" />
        <Skeleton className="mt-3 h-4 w-1/2 max-w-[300px]" />
        <div className="mt-10 w-full rounded-[20px] border bg-background p-2.5 shadow-soft sm:rounded-composer">
          <Skeleton className="h-14 w-full rounded-xl bg-muted/60" />
          <div className="mt-2 flex items-center gap-1.5">
            <Skeleton className="h-8 w-28 rounded-full" />
            <Skeleton className="h-8 w-16 rounded-full" />
            <Skeleton className="h-8 w-16 rounded-full" />
            <Skeleton className="ml-auto size-10 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A hub mode's body (under the hub's own title bar and tabs, which stay on screen): the hero line and the main box, where
 * every mode has them. Shown only while a mode that wasn't prefetched yet loads.
 */
export function HubBodySkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col items-center px-3 pt-6 sm:px-6 sm:pt-[12vh]" aria-busy="true" aria-label="Loading" data-hub-skeleton>
      <Skeleton className="h-9 w-2/3 max-w-[420px] rounded-xl" />
      <Skeleton className="mt-3 h-4 w-1/2 max-w-[300px]" />
      <div className="mt-10 w-full rounded-[20px] border bg-background p-2.5 shadow-soft sm:rounded-composer">
        <Skeleton className="h-14 w-full rounded-xl bg-muted/60" />
        <div className="mt-2 flex items-center gap-1.5">
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-8 w-16 rounded-full" />
          <Skeleton className="ml-auto size-10 rounded-full" />
        </div>
      </div>
    </div>
  );
}

export const GALLERY_GRID = "grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5";

/** Gallery body: filter row, category strip, card grid. */
export function GallerySkeleton({ cards = 10 }: { cards?: number }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Skeleton className="h-9 w-full rounded-full sm:w-80" />
        <Skeleton className="h-9 w-64 rounded-full sm:ml-auto" />
      </div>
      <div className="flex gap-1 overflow-hidden">
        {Array.from({ length: 9 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-20 shrink-0 rounded-full" />
        ))}
      </div>
      <div className={GALLERY_GRID}>
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="space-y-2 p-1.5">
            <Skeleton className="aspect-[4/3] rounded-lg" />
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A gallery page with its real title, so only the cards are placeholders. */
export function GalleryPageSkeleton({ title }: { title: string }) {
  return (
    <PageShell>
      <div className="pb-6">
        <h1 className="font-heading text-[34px] leading-tight">{title}</h1>
        <Skeleton className="mt-2 h-4 w-full max-w-[620px]" />
        <Skeleton className="mt-2 h-4 w-2/3 max-w-[420px]" />
      </div>
      <GallerySkeleton />
    </PageShell>
  );
}

/** A settings-style page: title, description, a few blocks. */
export function PageSkeleton({ title, wide, rows = 4 }: { title?: string; wide?: boolean; rows?: number }) {
  return (
    <PageShell wide={wide}>
      <div aria-busy="true" aria-label="Loading">
        {title ? <PageHeader title={title} /> : <Skeleton className="mb-8 h-10 w-56 rounded-xl" />}
        <div className="space-y-3">
          {Array.from({ length: rows }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </PageShell>
  );
}

