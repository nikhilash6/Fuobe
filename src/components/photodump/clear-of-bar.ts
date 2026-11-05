/**
 * Picker cards and the Continue bar under a picker grid (Fashion Factory templates, Photodump packs).
 *
 * The bar is sticky only once something is picked; before that it sits after the grid, so it never covers a card's name
 * on first view. A card keeps a bottom scroll margin the size of the bar (about 3.5rem tall, 0.75rem above the phone
 * tabs), so picking it or tabbing to it scrolls the whole card, name included, above the bar.
 */
export const CLEAR_OF_BAR = "scroll-mb-[calc(var(--chrome-bottom)+5.5rem)]";

/** The Continue bar's position: sticky above the phone tabs once `picked`, else in flow after the grid. */
export const barPlace = (picked: boolean) => (picked ? "sticky bottom-[calc(var(--chrome-bottom)+0.75rem)]" : "relative");

/** Scrolls a picked card (the element carrying CLEAR_OF_BAR) clear of the bar that shows once something is picked. */
export function showPicked(el: Element | null | undefined) {
  const card = el?.closest("[data-picker-card]");
  if (!card) return;
  const smooth = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  // After React has rendered the pick, so the bar is already sticky.
  requestAnimationFrame(() => card.scrollIntoView({ block: "nearest", behavior: smooth ? "smooth" : "auto" }));
}
