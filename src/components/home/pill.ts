/** Home's pills ("Also in Fuobe", "Just added") and the area pages': plain strings, so client islands share them. */

/** A pill: 32 px to look at. */
export const PILL = "group inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors hover:bg-accent";

/** An area page's pill reaches 44 px to tap (its hit area overlaps the gap above and below it). */
export const PILL_TAP = "relative after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']";

/** A pill's icon. */
export const PILL_ICON = "size-3.5 text-muted-foreground transition-colors group-hover:text-brand-text";
