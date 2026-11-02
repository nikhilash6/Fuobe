"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { signInHref, VIEWER_KEY } from "@/lib/api";
import type { ViewerKind } from "@/lib/nav-model";
import { cn } from "@/lib/utils";
import { AccountMenu } from "./account-menu";
import { useViewerKind } from "./nav-ui";

/*
 * The bar's right end: who is looking. The server's shell is the same for everyone, so until the viewer is known it is
 * a placeholder as wide as what is coming: the room for Sign up (and Log in from 1440 px) by default, or the avatar's in a
 * browser an account or the owner used last (html[data-viewer], set before the first paint from localStorage). Then a
 * guest gets Sign up, Log in and a menu button; an account or the owner the avatar and its menu.
 */

/**
 * Fixed widths, so the placeholder and what replaces it take the same room: Log in 68 (from 1440 px), Sign up 84, the menu
 * button 40 like the bar's other items (44 on a touch screen), 6 between.
 */
export const VIEWER_W = {
  guest: "w-[130px] min-[1440px]:w-[204px] [@media(pointer:coarse)]:w-[134px] [@media(pointer:coarse)]:min-[1440px]:w-[208px]",
  member: "w-10 [@media(pointer:coarse)]:w-11",
} as const;

const GUEST_BUTTON =
  "nav-focus-out inline-flex h-10 shrink-0 items-center justify-center rounded-full text-[13.5px] [@media(pointer:coarse)]:h-11 font-medium whitespace-nowrap motion-safe:transition-colors";

function GuestButtons({ here }: { here: string }) {
  return (
    <>
      <a href={signInHref("login", here)} className={cn(GUEST_BUTTON, "hidden w-[68px] text-foreground/80 nav-hover:bg-[var(--nav-hi)] nav-hover:text-foreground active:bg-[var(--nav-press)] min-[1440px]:inline-flex")}>
        Log in
      </a>
      <a href={signInHref("signup", here)} className={cn(GUEST_BUTTON, "w-[84px] bg-primary font-semibold text-primary-foreground nav-hover:bg-primary/90 active:bg-primary/85")}>
        Sign up
      </a>
    </>
  );
}

/** Sign up and Log in come back to this page with its query (a preset picked…): the query is runtime data. */
function GuestButtonsHere() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return <GuestButtons here={search ? `${pathname}?${search}` : pathname} />;
}

/** Remembers who was looking, for the next page load's first paint (the pre-paint script reads it), and marks <html>. */
function useRememberViewer(kind: ViewerKind | undefined) {
  useEffect(() => {
    if (!kind) return;
    try {
      localStorage.setItem(VIEWER_KEY, kind);
    } catch {}
    document.documentElement.setAttribute("data-viewer", kind);
  }, [kind]);
}

export function ViewerSlot() {
  const kind = useViewerKind();
  useRememberViewer(kind);
  if (!kind)
    return (
      <span
        aria-hidden
        data-slot="viewer"
        className={cn("block h-10 shrink-0", VIEWER_W.guest, "[html[data-viewer='account']_&]:w-10 [html[data-viewer='owner']_&]:w-10 [@media(pointer:coarse)]:[html[data-viewer='account']_&]:w-11 [@media(pointer:coarse)]:[html[data-viewer='owner']_&]:w-11")}
      />
    );
  if (kind !== "guest")
    return (
      <span data-slot="viewer" className={cn("flex shrink-0", VIEWER_W.member)}>
        <AccountMenu kind={kind} />
      </span>
    );
  return (
    <span data-slot="viewer" className={cn("flex shrink-0 items-center justify-end gap-1.5", VIEWER_W.guest)}>
      <Suspense fallback={<GuestButtons here="/" />}>
        <GuestButtonsHere />
      </Suspense>
      <AccountMenu kind="guest" />
    </span>
  );
}
