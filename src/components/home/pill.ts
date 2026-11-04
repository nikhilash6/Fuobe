/** Home's pills ("Also in Fuobe", "Just added") and the area pages': plain strings, so client islands share them. */

/** A pill: 32 px to look at. */
export const PILL = "group inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors hover:bg-accent";

/** An area page's pill reaches 44 px to tap (its hit area overlaps the gap above and below it). */
export const PILL_TAP = "relative after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']";

/** A pill's icon. */
export const PILL_ICON = "size-3.5 text-muted-foreground transition-colors group-hover:text-brand-text";

/**
 * A studio's feature as a pill (/studios' "Inside these studios", the phone's Studios sheet): 44 px to tap, and the open
 * page's (aria-current) in the foreground's weight.
 */
export const SUB_PILL = `${PILL} ${PILL_TAP} aria-[current=page]:border-foreground/40 aria-[current=page]:font-semibold`;

/** A studio's row of feature pills on /studios: its name, then its pills that wrap. */
export const SUB_ROW = "flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4";
export const SUB_ROW_NAME = "shrink-0 pt-1.5 text-[13px] leading-5 font-medium sm:w-40";
