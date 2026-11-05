"use client";

import { safeLink, useInterest, type poolRunState } from "@/lib/hosted";
import { capitalFirst } from "@/lib/pool-line";
import { cn } from "@/lib/utils";

type PoolState = NonNullable<ReturnType<typeof poolRunState>>;

/**
 * The line under a composer's toolbar for a run on this studio's GPUs: when it would be ready, before Run is pressed
 * ("Ready in about 2 min", "Starts when a GPU is free", "Ready in seconds"), with `offer` after a long wait (the account's
 * own GPU or key for this run, once: "Run it now on your GPU"); or, when the price check refused it, the words (the
 * toolbar's price slot has no room for them on a phone), with the link or offer the answer carries.
 */
export function PoolNote({ state, offer, className }: { state: PoolState; offer?: { label: string; run: () => void }; className?: string }) {
  const interest = useInterest();
  const href = safeLink(state.action?.url);
  if (!state.refused) {
    if (!state.wait) return null;
    const press = state.long ? offer : undefined;
    return (
      <p data-pool-note="wait" className={cn("flex flex-wrap items-center gap-x-2 px-2 text-[12px] text-muted-foreground tabular-nums", className)}>
        <span>{capitalFirst(state.wait)}</span>
        {press && (
          <button
            type="button"
            data-wait-offer
            onMouseDown={(e) => e.preventDefault()}
            onClick={press.run}
            className="inline-flex min-h-6 items-center font-medium text-brand-text underline-offset-2 hover:underline"
          >
            {press.label}
          </button>
        )}
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
