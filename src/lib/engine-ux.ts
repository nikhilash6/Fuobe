import { placeOf, type Place } from "./place-name";
import { CLOUD_KEY, CLOUD_PROVIDERS, type CloudProvider, type KeyStatus } from "./your-keys";

/**
 * How a visitor (a guest or an account) sees the two engines while open models run free on this install's GPUs: both
 * sides always show, Open source first ("Free · {place}"), Cloud second ("Your key"). Cloud runs on the visitor's own
 * fal.ai or Replicate key; without one, choosing Cloud opens a panel that says what Cloud models are and how to add a
 * key, and the switch stays on Open source. The owner, and every visitor while hosted runs are off (a self-hosted
 * install), keep the switch as it was (src/components/studio/engine-switch.tsx).
 */

export interface VisitorEngine {
  /** Where open models run free. */
  place: Place;
  /** Signed out: acting (adding a key) asks to sign up first. */
  guest: boolean;
  /** No key of its own yet: Cloud opens the panel, never the switch. */
  keyless: boolean;
  /** The providers it has a key for. */
  keys: CloudProvider[];
}

/** A guest's or an account's engines while hosted runs are on and paid models are allowed; null for everyone else. */
export function visitorEngine(s: KeyStatus | undefined): VisitorEngine | null {
  const v = s?.viewer;
  if (!v || (v.kind !== "account" && v.kind !== "guest") || !v.hosted || v.paidAllowed === false) return null;
  const keys = v.kind === "account" ? (v.keys ?? []) : [];
  return { place: placeOf(v.placeName), guest: v.kind === "guest", keyless: !keys.length, keys };
}

/** What choosing a side does: Cloud without a key opens the Cloud panel and leaves the switch where it is. */
export const visitorPick = (side: "open" | "cloud", e: VisitorEngine): "open" | "cloud" | "panel" => (side === "cloud" && e.keyless ? "panel" : side);

/** What a picker does with a Cloud model the visitor has no key for: the Cloud panel while hosted runs are on, else "Add your key" as before. */
export const cloudModelAsk = (s: KeyStatus | undefined): "panel" | "add-key" => (visitorEngine(s) ? "panel" : "add-key");

/** The small line under each side's name. */
export const engineCaption = {
  open: (place: Place) => `Free · ${place.label}`,
  cloud: "Your key",
} as const;

/** The Cloud side's tooltip while the visitor has no key. */
export const CLOUD_KEYLESS_TIP = "Frontier paid models on your own fal.ai or Replicate key";

/** A side's name for a screen reader, with its caption. */
export function visitorEngineLabel(side: "open" | "cloud", e: VisitorEngine): string {
  if (side === "open") return `Open source, free on ${e.place.text}`;
  return e.keyless ? "Cloud, needs your own key" : "Cloud, on your own key";
}

/** A few Cloud models by name, each with why someone would pick it (checked against the model list in tests). */
export const CLOUD_SHOWCASE: readonly { id: string; name: string; vendor: string; why: string }[] = [
  { id: "nano-banana-pro", name: "Nano Banana Pro", vendor: "Google", why: "Clean text in pictures, and edits from several photos, up to 4K." },
  { id: "gpt-image-2-5", name: "GPT Image 2.5 Flare", vendor: "OpenAI", why: "Exact layouts, and edits that follow long instructions." },
  { id: "veo-3-1", name: "Veo 3.1", vendor: "Google", why: "Real-looking video with sound and speech." },
  { id: "kling-4", name: "Kling 4.0", vendor: "Kuaishou", why: "Takes of 3 to 30 seconds, with several shots." },
];

/** The Cloud panel's words. `model`: the Cloud model it was opened for, if any. */
export function cloudPanelWords(place: Place, model?: string) {
  return {
    title: model ? `${model} is a Cloud model` : "Cloud models",
    lead: "Paid frontier models from Google, OpenAI, Kuaishou and more. They run on your own fal.ai or Replicate key, and that service bills you for each run.",
    more: "Many more are in each studio's model list.",
    stay: "Stay on Open source (free)",
    stayNote: `Open source models run free on ${place.text}.`,
  } as const;
}

/** "Add a fal.ai key" / "Add a Replicate key": the panel's buttons, which open the add-key flow. */
export const addProviderKeyLabel = (p: CloudProvider) => `Add a ${CLOUD_KEY[p].label} key`;

/** The providers a panel offers: the ones that serve its model (fal.ai first), else both. */
export const panelProviders = (served?: readonly CloudProvider[] | null): CloudProvider[] =>
  served?.length ? CLOUD_PROVIDERS.filter((p) => served.includes(p)) : [...CLOUD_PROVIDERS];

/** The one-time hint for an account that has no key yet, the first time it opens a studio. */
export const engineHintText = (place: Place) => ({
  lead: `Free open-source models run on ${place.text}.`,
  rest: "Want frontier models? Switch to Cloud with your own key.",
  ok: "Got it",
  see: "See Cloud models",
});

/** The picker's section of Cloud models for a visitor without a key. */
export const CLOUD_SECTION_LABEL = "Cloud · your key";

/** Where the browser remembers that an account closed the hint: one key per account (its email, hashed). */
export function engineHintKey(email: string): string {
  let h = 5381;
  for (const c of email.trim().toLowerCase()) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return `fuobe:engine-hint:${h.toString(36)}`;
}

/** Event that opens the Cloud panel (mounted once, in the app's providers). */
export const CLOUD_PANEL_EVENT = "fuobe:cloud-panel";

/** Sent when the panel closes without a key ("Stay on Open source", Esc, the close button). */
export const CLOUD_PANEL_STAY_EVENT = "fuobe:cloud-panel-stay";

export interface CloudPanelAsk {
  /** The Cloud model it opened for (picked once a key is saved), with its name and the providers that serve it. */
  modelId?: string;
  modelName?: string;
  served?: CloudProvider[];
}

/** Open the Cloud panel. */
export function openCloudPanel(ask: CloudPanelAsk = {}): void {
  window.dispatchEvent(new CustomEvent<CloudPanelAsk>(CLOUD_PANEL_EVENT, { detail: ask }));
}
