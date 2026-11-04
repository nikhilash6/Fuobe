"use client";

import { safeLink, useInterest, type poolRunState } from "@/lib/hosted";
import { cn } from "@/lib/utils";

type PoolState = NonNullable<ReturnType<typeof poolRunState>>;

/**
 * The line under a composer's toolbar for a run on this studio's GPUs: where it would stand in line and the wait, about,
 * before Run is pressed; or, when the price check refused it, the words (the toolbar's price slot has no room for them
 * on a phone), with the link or offer the answer carries.
 */
export function PoolNote({ state, className }: { state: PoolState; className?: string }) {
  const interest = useInterest();
  const href = safeLink(state.action?.url);
  if (!state.refused) {
    if (!state.wait) return null;
    return (
      <p data-pool-note="wait" className={cn("px-2 text-[12px] text-muted-foreground tabular-nums", className)}>
        {state.wait}
      </p>
    );
  }
  const more = !!(href || state.offer || state.sub);
  return (
    <p data-pool-note="refused" className={cn("flex flex-wrap items-center gap-x-2 px-2 text-[12px] text-muted-foreground", !more && "sm:hidden", className)}>
      <span className="sm:hidden">{state.text}</span>
      {state.sub && <span>{state.sub}</span>}
      {href && state.action && (
        <a href={href} target={href.startsWith("/") ? undefined : "_blank"} rel="noreferrer" className="font-medium text-brand-text underline-offset-2 hover:underline">
          {state.action.label}
        </a>
      )}
      {state.offer && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => interest.mutate(state.offer!.key)}
          disabled={interest.isPending}
          className="font-medium text-brand-text underline-offset-2 hover:underline"
        >
          {state.offer.label}
        </button>
      )}
    </p>
  );
}
