import { Skeleton } from "@/components/ui/skeleton";
import { MarketingHeader, type SuiteTab } from "./shell";

/*
 * Route skeletons (loading.tsx) of the marketing suite: Marketing Studio, Click to Ad, Ads Studio and Ad Multiplier.
 */

/**
 * The marketing suite's real header (title and the four tool tabs, the page's own tab current) over a page skeleton: the
 * tabs stay on screen while a tool that wasn't prefetched yet loads.
 */
function MarketingFrame({ title, active, children }: { title: string; active: SuiteTab; children: React.ReactNode }) {
  return (
    <div className="flex min-h-content min-w-0 flex-col">
      <MarketingHeader title={title} active={active} right={<Skeleton className="h-9 w-40 rounded-full max-sm:w-20" />} />
      <div className="flex min-w-0 flex-1 flex-col" aria-busy="true" aria-label="Loading">
        {children}
      </div>
    </div>
  );
}

/** A marketing tool (Click to Ad, Ads Studio, Ad Multiplier): the suite's header and tabs, the hero line and the main box. */
export function MarketingToolSkeleton({ title, active }: { title: string; active: SuiteTab }) {
  return (
    <MarketingFrame title={title} active={active}>
      <div className="mx-auto flex w-full max-w-[760px] flex-col items-center px-3 pt-8 sm:px-6 sm:pt-[10vh]">
        <Skeleton className="h-9 w-2/3 max-w-[420px] rounded-xl" />
        <Skeleton className="mt-3 h-4 w-1/2 max-w-[300px]" />
        <Skeleton className="mt-10 h-40 w-full rounded-[20px]" />
      </div>
    </MarketingFrame>
  );
}

/** Marketing Studio: the suite's header and tabs, the hero, the template grid and the docked composer. */
export function MarketingSkeleton() {
  return (
    <MarketingFrame title="Marketing Studio" active="studio">
      <div className="mx-auto w-full max-w-[1240px] flex-1 px-3 sm:px-6">
        <div className="flex flex-col items-center pt-6 pb-2 sm:pt-10">
          <Skeleton className="h-10 w-3/4 max-w-[560px] rounded-xl" />
          <Skeleton className="mt-3 h-4 w-2/3 max-w-[420px]" />
          <Skeleton className="mt-6 h-9 w-56 rounded-full" />
        </div>
        <div className="mt-6 flex gap-1.5 overflow-hidden">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-full" />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="aspect-[3/4] rounded-2xl" />
              <Skeleton className="h-3.5 w-2/3" />
            </div>
          ))}
        </div>
      </div>
      <div className="sticky bottom-chrome px-3 pb-3 sm:px-6">
        <Skeleton className="mx-auto h-14 w-full max-w-[860px] rounded-[20px] sm:rounded-composer" />
      </div>
    </MarketingFrame>
  );
}
