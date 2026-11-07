/**
 * Phone navigation helpers (pure, so they're testable): which tab looks selected, what a tab tap opens, whether the
 * on-screen keyboard is up, and the You tab's dot.
 */
import { FX_HOME } from "@/lib/fx-tools";

export type PhoneTab = "home" | "create" | "studios" | "library" | "you";
/** The sheets the tabs open (NavSheet in nav-ui.tsx). */
export type PhoneSheet = "studios" | "create" | "you";

function under(path: string, pathname: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

/**
 * The tab that looks selected. An open sheet's tab, while it is open; otherwise the page's: Home on /, Library in the
 * library, You in settings, Studios in a studio (an entry with a launcher group, or Fuobe FX's), Create in a create tool. Nothing on
 * other pages (a gallery of motions, say), so no tab claims a page it doesn't lead to.
 */
export function activePhoneTab(
  pathname: string,
  sheet: PhoneSheet | null,
  entry?: { id?: string; kind: string; group?: string } | null,
): PhoneTab | null {
  if (sheet) return sheet;
  if (!pathname) return null;
  if (pathname === "/") return "home";
  if (under("/library", pathname)) return "library";
  if (under("/settings", pathname) || under("/connect", pathname)) return "you";
  // The area pages the Create and Studios sheets lead to ("See all") are theirs.
  if (entry?.id === "area-studios") return "studios";
  if (entry?.id === "area-create") return "create";
  if (entry?.group) return "studios";
  // Fuobe FX is a family of the Studios sheet: its page and its studios are that tab's.
  if (entry?.id === "area-fx" || (entry?.id && FX_HOME.includes(entry.id))) return "studios";
  if (entry?.kind === "create") return "create";
  return null;
}

/** A sheet tab: opens its sheet, switches from another one, and closes its own when tapped again. */
export function toggleSheet(open: PhoneSheet | null, tapped: PhoneSheet): PhoneSheet | null {
  return open === tapped ? null : tapped;
}

/** Input types that bring up the on-screen keyboard (pickers, checkboxes and buttons don't). */
const TYPED = new Set(["", "text", "search", "email", "url", "tel", "password", "number"]);

/** Whether focus is somewhere you type: a text field, a text area or editable text. */
export function typesText(
  el: { tagName?: string; type?: string; isContentEditable?: boolean; readOnly?: boolean; disabled?: boolean } | null | undefined,
): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName ?? "").toUpperCase();
  if (el.readOnly || el.disabled) return false;
  if (tag === "TEXTAREA") return true;
  return tag === "INPUT" && TYPED.has((el.type ?? "").toLowerCase());
}

/** How much the visible viewport must shrink, in px, before it counts as the keyboard (browser bars move less). */
export const KEYBOARD_MIN = 150;

/** The on-screen keyboard is up: someone is typing and the visible viewport lost more than KEYBOARD_MIN of its height. */
export function keyboardOpen(viewportHeight: number, fullHeight: number, typing: boolean): boolean {
  return typing && viewportHeight < fullHeight - KEYBOARD_MIN;
}
