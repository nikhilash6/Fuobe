"use client";

import { Loader2 } from "lucide-react";
import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useSettled } from "@/lib/when-idle";

/**
 * A Link that prefetches on intent: nothing while it merely sits on screen, then the usual prefetch
 * once the pointer is over it, a finger touches it or it gets keyboard focus (the "hover-triggered
 * prefetch" of Next's prefetching guide). `eager` rows prefetch as soon as they're on screen, like a
 * plain Link: the few routes most visits go to next. `settled` rows prefetch once the page has
 * loaded and the browser is idle, also the ones scrolled out of view (the app's own navigation: a tap
 * there must not wait a round trip, a touch comes too late to start one, and rows that only start
 * when scrolled into view would queue up in front of the tap). A page full of these no longer
 * fetches every route behind it on a cold visit.
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
  const idle = useSettled();
  const now = eager || (settled && idle);
  const href = typeof props.href === "string" ? props.href : null;
  useEffect(() => {
    if (settled && idle && href) router.prefetch(href);
  }, [settled, idle, href, router]);
  const start = () => {
    if (now || intent) return;
    setIntent(true);
    // Start the fetch from the event itself: the Link only picks it up after it renders again and
    // sees itself on screen, a frame or more later (several on a slow phone), which a quick click beats.
    if (href) router.prefetch(href);
  };
  return (
    <Link
      {...props}
      prefetch={now || intent ? null : false}
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
