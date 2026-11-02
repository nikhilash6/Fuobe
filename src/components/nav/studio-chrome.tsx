"use client";

import { usePathname } from "next/navigation";
import { Suspense, useLayoutEffect } from "react";
import { JobNotifications } from "@/components/job-notifications";
import { SkillBuilderProvider } from "@/components/skills/skill-builder-provider";
import { CHROME_STATE_SCRIPT, fullScreenStudio } from "@/lib/nav";
import type { NavCovers } from "@/lib/nav-covers";
import { ExploreTracker } from "./explore-tracker";
import { NavUiProvider } from "./nav-ui";
import { PhoneSheets } from "./phone-sheets";
import { PhoneTabs } from "./phone-tabs";
import { SearchPaletteProvider } from "./search-context";
import { TopBar } from "./top-bar";

/**
 * Inline script that runs while the HTML is parsed: the server renders one shell for everyone, this marks the page
 * (full-screen studio, who used this browser last, which bar pills it had) before the first paint, so nothing shifts.
 * On the client it renders as inert text/plain (React warns about executable scripts it renders itself).
 */
function ChromeStateScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: CHROME_STATE_SCRIPT }}
    />
  );
}

/** Keeps html[data-fullscreen-studio] in step with the page on client navigation. Inside Suspense: runtime data. */
function ChromeState() {
  const pathname = usePathname();
  useLayoutEffect(() => {
    document.documentElement.toggleAttribute("data-fullscreen-studio", fullScreenStudio(pathname) !== null);
  }, [pathname]);
  return null;
}

/** The first stop for keyboard users: jumps past the menus to the page (WCAG 2.4.1). */
function SkipLink() {
  return (
    <a
      href="#content"
      onClick={(e) => {
        // Focus the page without adding #content to the URL (Settings reads its hash for deep links).
        const main = document.getElementById("content");
        if (!main) return;
        e.preventDefault();
        main.focus();
      }}
      className="sr-only rounded-md bg-background px-3 py-2 text-[13px] font-medium shadow-strong focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:outline-2 focus:outline-ring"
    >
      Skip to content
    </a>
  );
}

/**
 * The app frame: the top bar from md up, the bottom tabs and their sheets on a phone, the search palette everywhere.
 * Used by the studio layout and the root not-found page. The covers are resolved on the server and passed down.
 */
export function StudioChrome({ covers, children }: { covers: NavCovers; children: React.ReactNode }) {
  return (
    // The palette renders beside its children, so the covers and the frame's state wrap it.
    <NavUiProvider covers={covers}>
      {/* Make a skill from any result's ⋯ menu: a page's, the palette's and a job notification's viewer. */}
      <SkillBuilderProvider>
        <SearchPaletteProvider>
          <ChromeStateScript />
          <SkipLink />
          <TopBar />
          <main id="content" tabIndex={-1} className="relative flex min-h-content w-full min-w-0 flex-1 flex-col bg-background pb-[var(--chrome-bottom)] outline-none">
            {children}
          </main>
          <PhoneTabs />
          <PhoneSheets />
          <Suspense fallback={null}>
            <ExploreTracker />
            <ChromeState />
          </Suspense>
          <JobNotifications />
        </SearchPaletteProvider>
      </SkillBuilderProvider>
    </NavUiProvider>
  );
}
