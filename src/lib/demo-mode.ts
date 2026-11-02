/**
 * Placeholder results' words and ways out, for the top bar's "Placeholders on" chip and the "Placeholder" chip on a
 * result (src/components/demo-mode.tsx). Pure, so the rules are tested without a browser.
 *
 * Placeholder results are off by default on every install: a run with nothing connected opens the connect card. The
 * owner can turn them on in Settings to give a tour of a self-hosted studio ("Show placeholder results (for a tour)",
 * demoMode "on"): then every run makes a labelled placeholder. Guests and accounts never get them (accounts run with
 * demoMode "off"), so only the owner is offered a way out.
 */

/** Settings' switch. */
export const PLACEHOLDER_SETTING = "Show placeholder results (for a tour)";

/** The chip on every result the demo provider made. */
export const PLACEHOLDER_CHIP = "Placeholder";

/** The top bar's chip while the switch is on: a click turns it off. */
export const PLACEHOLDERS_ON = "Placeholders on";

export type PlaceholderAction = "computer" | "key" | "off";

export const PLACEHOLDER_ACTION_LABELS: Record<PlaceholderAction, string> = {
  computer: "Use the ComfyUI on this computer",
  key: "Add an API key",
  off: "Turn off placeholder results",
};

/** A result the demo provider made (a placeholder, not the real thing). */
export const isPlaceholder = (g: { provider?: string | null } | null | undefined): boolean => g?.provider === "mock";

/** Whether the owner's runs make placeholders now: only with the switch on ("on"; anything else is off). */
export const placeholdersOn = (demoMode: string | undefined): boolean => demoMode === "on";

/**
 * The owner's ways out from a placeholder result, in order: the ComfyUI on this computer (not in Paid APIs only
 * mode), a fal.ai or Replicate key (not in Open source only mode), and the switch off (while it's on). Nobody else
 * gets any.
 */
export function placeholderActions(f: { owner: boolean; engineMode?: string; demoMode?: string }): PlaceholderAction[] {
  if (!f.owner) return [];
  const out: PlaceholderAction[] = [];
  if (f.engineMode !== "cloud") out.push("computer");
  if (f.engineMode !== "open") out.push("key");
  if (placeholdersOn(f.demoMode)) out.push("off");
  return out;
}

/** The one line a placeholder result's card says. */
export function placeholderLine(demoMode: string | undefined): string {
  return placeholdersOn(demoMode)
    ? "Placeholder results are on in Settings (for a tour), so every run makes a labelled stand-in, not the real thing."
    : "A stand-in made while placeholder results were on. Connect a model and run it again for the real thing.";
}
