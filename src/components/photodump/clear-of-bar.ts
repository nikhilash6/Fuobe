/**
 * Picker cards and the Continue bar under a picker grid (Fashion Factory templates, Photodump packs).
 *
 * The bar always sits in flow after the grid, never over it, so no card name is ever covered: not on first view, not
 * while scrolling, not after a pick and not when a saved pick is restored. The picked card carries its own Continue
 * button (PICKED_GO), so going on never needs a scroll down to the bar. A card keeps a bottom scroll margin, so picking
 * it or tabbing to it scrolls the whole card, name included, into view above the phone tabs.
 */
export const CLEAR_OF_BAR = "scroll-mb-[calc(var(--chrome-bottom)+1rem)]";

/** The Continue bar under the grid: in flow, never sticky. */
export const PICKER_BAR = "relative z-10 flex items-center justify-between gap-3 rounded-2xl border bg-background/95 p-3 shadow-normal";

/** The Continue button on the picked card: top left of its cover, clear of the name. */
export const PICKED_GO = "absolute top-2 left-2 z-10 h-8 rounded-full px-3 text-[12.5px] shadow-normal";

/** Scrolls a picked card (the element carrying CLEAR_OF_BAR) fully into view. */
export function showPicked(el: Element | null | undefined) {
  const card = el?.closest("[data-picker-card]");
  if (!card) return;
  const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  requestAnimationFrame(() => card.scrollIntoView({ block: "nearest", behavior: smooth ? "smooth" : "auto" }));
}
