"use client";

import { Loader2 } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useIdlePrefetch } from "@/lib/idle-prefetch";
import { cn } from "@/lib/utils";

/**
 * A Link that prefetches on intent: nothing while it merely sits on screen, then the usual prefetch
 * once the pointer is over it, a finger touches it or it gets keyboard focus (the "hover-triggered
 * prefetch" of Next's prefetching guide). `eager` rows prefetch as soon as they're on screen, like a
 * plain Link: the few routes most visits go to next. `settled` rows prefetch once the page has
 * loaded and the browser is idle, also when scrolled out of view, after the page's own tabs
 * (useIdlePrefetch's "nav" lane): the sidebar gives it to the few rows next to the open page's row.
 * A page full of these fetches only those routes on a cold visit, not every route behind it.
 */
export function IntentLink({
  eager,
  settled,
  onMouseEnter,
  onTouchStart,
  onFocus,
  ...props
}: React.ComponentProps<typeof Link> & { eager?: boolean; settled?: boolean }) {
  const [intent, setIntent] = useState(false);
  const router = useRouter();
  const href = typeof props.href === "string" ? props.href : null;
  // Not the Link's own viewport prefetch: a row coming on screen later would jump the queue ahead of the page's tabs.
  useIdlePrefetch(settled && href ? [href] : null, "nav");
  const start = () => {
    if (eager || intent) return;
    setIntent(true);
    // Start the fetch from the event itself: the Link only picks it up after it renders again and
    // sees itself on screen, a frame or more later (several on a slow phone), which a quick click beats.
    if (href) router.prefetch(href);
  };
  return (
    <Link
      {...props}
      prefetch={eager || intent ? null : false}
      onMouseEnter={(e) => {
        start();
        onMouseEnter?.(e);
      }}
      onTouchStart={(e) => {
        start();
        onTouchStart?.(e);
      }}
      onFocus={(e) => {
        start();
        onFocus?.(e);
      }}
    />
  );
}

/**
 * Click feedback on a card while its page loads (useLinkStatus: the moment between the click and the
 * new route). Put it inside a positioned Link; it takes no space and only shows when the route is slow
 * (the fade starts after 120 ms), so fast navigations don't flash.
 */
export function CardPending({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 grid animate-pending-in place-items-center rounded-[inherit] bg-black/25 text-white",
        className,
      )}
    >
      <Loader2 className="size-5 animate-spin" />
    </span>
  );
}
