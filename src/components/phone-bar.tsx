"use client";

import { Search } from "lucide-react";
import { IntentLink } from "@/components/intent-link";
import { PhoneNavButton } from "@/components/nav/phone-nav-button";
import { useSearchPalette } from "@/components/nav/search-context";
import { UpdateAvailable } from "@/components/update-available";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Opens the search: the way to search on a phone, where there's no keyboard shortcut. */
export function SearchButton({ className }: { className?: string }) {
  const search = useSearchPalette();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("nav-row size-11 rounded-full text-muted-foreground focus-visible:border-transparent focus-visible:ring-0 motion-reduce:transition-none", className)}
      aria-label="Search"
      aria-haspopup="dialog"
      onTouchStart={search.warm}
      onPointerEnter={search.warm}
      onFocus={search.warm}
      onClick={() => search.open()}
    >
      <Search className="size-5" aria-hidden />
    </Button>
  );
}

/**
 * The phone header of gallery and settings pages: the wordmark (home) and search; the tab bar at the bottom does the
 * rest. Clear of the notch and the rounded corners. Hidden from md up, where the top bar shows.
 */
export function PhoneBar({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "sticky top-chrome z-20 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center gap-1.5 bg-background/85 pt-[env(safe-area-inset-top)] pr-[max(1rem,env(safe-area-inset-right))] pl-[max(0.75rem,env(safe-area-inset-left))] backdrop-blur md:hidden",
        className,
      )}
    >
      <IntentLink
        href="/"
        eager
        aria-label="Fuobe home"
        className="nav-focus rounded-md px-1 font-heading text-[22px] leading-none"
      >
        Fuobe
      </IntentLink>
      <div className="ml-auto flex items-center gap-1.5">
        <UpdateAvailable />
        <PhoneNavButton />
      </div>
    </div>
  );
}
