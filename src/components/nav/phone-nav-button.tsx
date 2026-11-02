"use client";

import { LayoutGrid, Search } from "lucide-react";
import { useNavUi } from "@/components/nav/nav-ui";
import { useSearchPalette } from "@/components/nav/search-context";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The phone's button at the end of a page's or a studio's header (the top-right corner on every page) (hidden from md up, where the top bar has search and
 * the studios). On most pages it opens the full-screen search. In a full-screen studio (html[data-fullscreen-studio],
 * set before the first paint and kept in step on navigation), where the tab bar steps aside, it is the way out instead:
 * it opens the Studios sheet with Home, Library, You and Search above the studios. The icon and the name switch by CSS
 * from that same attribute, so the server's HTML is already right and nothing changes after hydration.
 */
export function PhoneNavButton({ className }: { className?: string }) {
  const search = useSearchPalette();
  const { setSheet } = useNavUi();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-haspopup="dialog"
      data-phone-nav-button
      className={cn("nav-row size-11 shrink-0 rounded-full text-muted-foreground focus-visible:border-transparent focus-visible:ring-0 motion-reduce:transition-none md:hidden", className)}
      onTouchStart={search.warm}
      onPointerEnter={search.warm}
      onFocus={search.warm}
      onClick={() => {
        if (document.documentElement.hasAttribute("data-fullscreen-studio")) setSheet("studios");
        else search.open();
      }}
    >
      <Search className="size-5 [html[data-fullscreen-studio]_&]:hidden" aria-hidden />
      <LayoutGrid className="hidden size-5 [html[data-fullscreen-studio]_&]:block" aria-hidden />
      <span className="sr-only [html[data-fullscreen-studio]_&]:hidden">Search</span>
      <span className="sr-only hidden [html[data-fullscreen-studio]_&]:inline">Menu</span>
    </Button>
  );
}
