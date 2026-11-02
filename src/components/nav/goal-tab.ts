/**
 * The goal row's look (Home, under the composer), shared with the area pages' section tabs so both read as one row:
 * a 52 px strip between two rules, and tabs that underline the one that is on. Plain strings, so a server component
 * can use them too.
 */

/** The strip: 52 px between two rules, reaching a phone's edges. */
export const GOAL_STRIP = "flex h-[52px] items-stretch border-y max-sm:-mx-4";

/**
 * A tab in the strip (an icon, then its label), with the nav's states (nav-states.css): the highlight on hover or keyboard
 * focus, pressed. `GOAL_TAB_ON` marks the open one with the tab's underline, never a fill, so it never reads as a second
 * highlight.
 */
export const GOAL_TAB = [
  "nav-row flex shrink-0 snap-start items-center gap-2 rounded-t-[10px] border-b-2 border-transparent px-4 text-[14px] whitespace-nowrap text-foreground/80 nav-hover:text-foreground",
  // A tablet's row holds all six as words alone (a phone's scrolls, with the icons).
  "md:max-lg:px-2.5 md:max-lg:text-[13.5px]",
].join(" ");

export const GOAL_TAB_ON = "border-[var(--nav-mark)] text-foreground";
