import { placeOf } from "./place-name";
import { CLOUD_KEY, type CloudProvider } from "./your-keys";

/**
 * The one-time note for an account whose runs moved when hosted runs went on (src/components/studio/place-intro.tsx):
 * it had a GPU or a key of its own, ran on it before it first ran on this install's GPUs (`ranOwn`, from the server),
 * and has picked no place since. Its two buttons both keep a pick on the server, so the note never comes back, on any
 * device: "Keep my GPU as the default" (or key) keeps the old place; OK keeps this install's GPUs. Pure, for its tests.
 */

export interface PlaceIntroViewer {
  kind?: "guest" | "account";
  hosted?: boolean;
  placeName?: string;
  runOn?: string;
  ranOwn?: boolean;
  gpu: { connected: boolean };
  keys?: CloudProvider[];
  /** The policy's card words ("Try free"): runs there cost this account nothing, so the note may say "free". */
  cardText?: string;
}

export interface PlaceIntro {
  /** The first words, in bold. */
  lead: string;
  rest: string;
  /** The first button: keep the old place as the default. */
  keep: { label: string; runOn: "gpu" | "key"; key?: CloudProvider };
}

/**
 * The note for this viewer, or null. `run`: the page's own button ("Generate", "Render", "Run"), beside the composer's
 * price chip. `chip`: a tool page's place chip instead (its words, such as "Our GPUs"), which opens the same list.
 */
export function placeIntro(v: PlaceIntroViewer | undefined | null, run: string, chip?: string): PlaceIntro | null {
  if (!v?.hosted || v.kind !== "account" || !v.ranOwn || v.runOn) return null;
  const place = placeOf(v.placeName);
  // "Free" only while runs there cost this account nothing (the policy's card words say so).
  const free = !!v.cardText?.trim();
  if (v.gpu.connected) {
    return {
      lead: free ? `Runs now go to ${place.text}, free.` : `Runs now go to ${place.text}.`,
      rest: chip ? `Your GPU is one tap away: tap ${chip} to pick it.` : `Your GPU is one tap away: ${free ? "Free ▾" : "the price"}, next to ${run}.`,
      keep: { label: "Keep my GPU as the default", runOn: "gpu" },
    };
  }
  const keys = v.keys ?? [];
  const key = keys.includes("fal") ? "fal" : keys[0];
  if (!key) return null;
  return {
    lead: free ? `Open models now run free on ${place.text}.` : `Open models now run on ${place.text}.`,
    rest: `Your ${CLOUD_KEY[key].label} key still runs the cloud models: pick Cloud in the model list.`,
    keep: { label: "Keep my key as the default", runOn: "key", key },
  };
}
