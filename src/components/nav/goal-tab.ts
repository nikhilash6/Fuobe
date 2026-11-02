/**
 * The goal row's look (Home, under the composer), shared with the area pages' section tabs so both read as one row:
 * a 52 px strip between two rules, and tabs that underline the one that is on. Plain strings, so a server component
 * can use them too.
 */

/** The strip: 52 px between two rules, reaching a phone's edges. */
export const GOAL_STRIP = "flex h-[52px] items-stretch border-y max-sm:-mx-4";

/** A tab in the strip (an icon, then its label); `GOAL_TAB_ON` marks the open one. */
export const GOAL_TAB = [
  "flex shrink-0 snap-start items-center gap-2 rounded-t-[10px] border-b-2 border-transparent px-4 text-[14px] whitespace-nowrap text-foreground/80 outline-none hover:bg-accent hover:text-foreground motion-safe:transition-colors",
  // A tablet's row holds all six as words alone (a phone's scrolls, with the icons).
  "md:max-lg:px-2.5 md:max-lg:text-[13.5px]",
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
].join(" ");

export const GOAL_TAB_ON = "border-primary bg-accent text-foreground";
