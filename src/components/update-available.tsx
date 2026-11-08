"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/** The build this page was loaded from (next.config.ts). */
const LOADED = process.env.NEXT_PUBLIC_FUOBE_BUILD;

/** How often an open page asks which build the server runs (and each time the tab comes back into view). */
const EVERY_MS = 3 * 60_000;

/**
 * "Update available": shown when the site has a newer version than the one this page was loaded with (a tab left open
 * across a deploy). A click loads the page again, fresh.
 */
export function UpdateAvailable({ className }: { className?: string }) {
  const [newer, setNewer] = useState(false);
  useEffect(() => {
    if (!LOADED) return;
    let done = false;
    const check = async () => {
      if (done || document.visibilityState !== "visible") return;
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const { build } = (await r.json()) as { build?: string | null };
        if (!done && build && build !== LOADED) {
          done = true;
          setNewer(true);
        }
      } catch {
        // Offline for a moment: the next check asks again.
      }
    };
    const timer = window.setInterval(() => void check(), EVERY_MS);
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    void check();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  if (!newer) return null;
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full bg-brand-faint px-3 text-[13px] font-medium text-brand-text transition-colors hover:bg-brand-faint-hover focus-visible:ring-4 focus-visible:ring-brand-faint focus-visible:outline-none",
        className,
      )}
      title="A newer version of Fuobe is ready. Load it now."
    >
      <RefreshCw className="size-3.5" />
      Update available
    </button>
  );
}
