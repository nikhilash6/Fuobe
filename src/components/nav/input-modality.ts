/*
 * Which input leads: html[data-input="keyboard" | "pointer"]. The nav's states (nav-states.css) read it so only one
 * row is ever highlighted: while the keyboard leads, the focused row has the highlight and the focus ring and hover
 * paints nothing; once the mouse moves (or a finger or pen touches), the row under it has the highlight and the
 * keyboard's ring steps aside. Typing words never takes the lead from the mouse: only the keys that move focus do, and a
 * letter typed where it moves the list's highlight (a menu's typeahead, search's field), so the ring marks the row the
 * keys picked.
 */

export type InputModality = "keyboard" | "pointer";

/** Keys that move focus, press the focused control or close a layer: pressing one hands the lead to the keyboard. */
const NAV_KEYS = new Set(["Tab", "Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Escape", "F6"]);

/** Where a typed letter moves a list's highlight: an open menu (typeahead) or the search field. */
const PICKS_BY_TYPING = '[role="menu"], [cmdk-input]';

/**
 * The modality a key press leads to, or null when it leaves the lead where it is (a modifier, or a letter typed into the
 * page or a field). A letter in a menu or the search field moves the highlight, so it hands the lead to the keyboard.
 */
export function modalityForKey(
  key: string,
  mods: { altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
  target?: EventTarget | null,
): InputModality | null {
  if (mods.altKey || mods.ctrlKey || mods.metaKey) return null;
  if (NAV_KEYS.has(key)) return "keyboard";
  const el = target as Element | null | undefined;
  if (key.length === 1 && typeof el?.closest === "function" && el.closest(PICKS_BY_TYPING)) return "keyboard";
  return null;
}

/** The modality a pointer event leads to: a press of any kind, or a mouse that really moved (not a layout shift). */
export function modalityForPointer(type: string, moved: boolean): InputModality | null {
  if (type === "pointerdown") return "pointer";
  return moved ? "pointer" : null;
}

let installed = false;

/** Installs the listeners once per page (idempotent). Returns a function that removes them (tests). */
export function installInputModality(doc: Document = document): () => void {
  if (installed) return () => {};
  installed = true;
  const html = doc.documentElement;
  let last = { x: Number.NaN, y: Number.NaN };
  const set = (m: InputModality | null) => {
    if (m && html.dataset.input !== m) html.dataset.input = m;
  };
  const onKey = (e: KeyboardEvent) => set(modalityForKey(e.key, e, e.target));
  const onDown = (e: PointerEvent) => {
    last = { x: e.clientX, y: e.clientY };
    set(modalityForPointer("pointerdown", true));
  };
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const moved = e.clientX !== last.x || e.clientY !== last.y;
    last = { x: e.clientX, y: e.clientY };
    set(modalityForPointer("pointermove", moved));
  };
  // iOS paints :active (the pressed state) only on pages that listen to touches.
  const onTouch = () => {};
  doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("pointerdown", onDown, true);
  doc.addEventListener("pointermove", onMove, { capture: true, passive: true });
  doc.addEventListener("touchstart", onTouch, { passive: true });
  return () => {
    installed = false;
    doc.removeEventListener("keydown", onKey, true);
    doc.removeEventListener("pointerdown", onDown, true);
    doc.removeEventListener("pointermove", onMove, true);
    doc.removeEventListener("touchstart", onTouch);
  };
}
