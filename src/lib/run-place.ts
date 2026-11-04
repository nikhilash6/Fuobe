import { lineWords } from "./pool-line";
import { billedTo, CLOUD_KEY, type CloudProvider } from "./your-keys";

/**
 * Where a run happens and what it costs, in the words a composer's place chip, its price and its send button use
 * (src/components/studio/run-place-chip.tsx). Pure: tests/run-place.test.ts covers every audience and engine.
 *
 * The same words as the studio composer: an open model runs on your GPU, free; a paid model runs in the cloud at the
 * provider's price, billed to the key that runs it; a Kinetic template is drawn in your browser, instant and free.
 * A tool that runs for the studio's owner only says so to anyone else, with no price (never a "free" it can't keep).
 */

/** Who is looking: the studio's owner, a signed-in account (public sign-up), or a signed-out guest. */
export type RunAudience = "owner" | "account" | "guest";

export interface RunPlaceInput {
  audience: RunAudience;
  /** cloud: paid models through a provider key; open: open models on a GPU; browser: drawn here, no model at all. */
  engine: "cloud" | "open" | "browser";
  /** The models the run uses, in the order they run (the planned steps' model names). */
  models?: readonly string[];
  /** The model the chip names in the cloud (the run's main one). Defaults to the first of `models`. */
  model?: string;
  /** The run's price in USD: undefined while it is being priced, null when the provider publishes none. */
  costUsd?: number | null;
  /** Placeholder results are on (Settings): every output is a free stand-in. */
  demo?: boolean;
  /** The tool's name when it runs for the studio's owner only (the Marketing suite): anyone else is told so. */
  ownerOnly?: string;
  /** An account's own GPU is connected (Your GPU). */
  gpu?: boolean;
  /** Hosted runs are on: an open model may run on this studio's GPUs when the viewer has no GPU of its own. */
  hosted?: boolean;
  /** Runs go to this studio's GPUs first, even when the viewer has a GPU of its own (the studio's policy). */
  preferPool?: boolean;
  /**
   * The price of a run on this studio's GPUs (the billing service's words; empty text: free), undefined while pricing.
   * `refused`: the price check refused the run (its words are `text`), so it can't start now. `wait`: where it would
   * stand in line, and the wait.
   */
  pool?: { text: string; sub?: string; refused?: boolean; wait?: string } | null;
  /** The provider an account's paid run is billed to (its own key), or null when it has no key for this model. */
  payer?: CloudProvider | null;
  /** How a price reads: "$0.04". */
  format: (usd: number) => string;
}

export interface RunPlace {
  /** What the chip's icon shows. */
  where: "cloud" | "gpu" | "pool" | "browser" | "unavailable";
  /** The chip's words: "Your GPU", "This studio's GPUs", the cloud model's name, "Your browser", "Not available here". */
  label: string;
  /** "Free", "≈ $0.04", "Placeholder · free", "Price unknown", or "" (not priced yet, or nothing to price). */
  price: string;
  /** The chip's panel heading: "Runs on your GPU". */
  title: string;
  /** One or two plain sentences: where it runs, with what, and who pays. */
  tip: string;
  /** After "Generate · " on the send button's tooltip: the price and the place, "Free · your GPU", "≈ $0.04 · cloud". */
  send: string;
  /** What this viewer does before the run can start: create an account, connect a GPU, or add a key. */
  needs?: "signup" | "gpu" | "key";
  /** The run can't start now (this studio's GPUs refused it before Run): the send button is off, and these words say why. */
  refused?: string;
  /** The cloud model the chip names, when known (the label is "Cloud" without one). */
  model?: string;
}

const list = (names: readonly string[]) => (names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** Unique names, in order. */
const uniq = (names: readonly string[] | undefined) => [...new Set((names ?? []).filter(Boolean))];

/** The price's words (the studio composer's costLabel, without the place: the chip says that). */
export function placePrice(s: { demo?: boolean; costUsd?: number | null; open: boolean }, format: (usd: number) => string): string {
  if (s.demo) return "Placeholder · free";
  // Every run on the open engine is free on the GPU: said before the run is priced too.
  if (s.open) return "Free";
  if (s.costUsd === undefined) return "";
  if (s.costUsd === null) return "Price unknown";
  return s.costUsd === 0 ? "Free" : `≈ ${format(s.costUsd)}`;
}

export function runPlace(input: RunPlaceInput): RunPlace {
  const { audience, engine } = input;
  if (engine === "browser") {
    return {
      where: "browser",
      label: "Your browser",
      price: "Free",
      title: "Runs in your browser",
      tip: "It plays as you type, instantly and free. No model and no GPU are used.",
      send: "Free · in your browser",
    };
  }
  if (input.ownerOnly && audience !== "owner") {
    return {
      where: "unavailable",
      label: "Not available here",
      price: "",
      title: "Not available here",
      tip: `${input.ownerOnly} isn't available here. Try the Image, Video or Audio studio.`,
      send: "",
    };
  }
  const models = uniq(input.models);
  const open = engine === "open";
  const price = placePrice({ demo: input.demo, costUsd: input.costUsd, open }, input.format);
  const withModels = models.length ? ` with ${list(models)}` : "";
  // Hosted runs: an account (or a guest, once signed up) with no GPU of its own runs open models on this studio's GPUs,
  // at the billing service's price (the studio composer's "This studio's GPUs" chip).
  if (open && input.hosted && audience !== "owner" && (!input.gpu || input.preferPool)) {
    const signup = audience === "guest";
    const refused = !input.demo && input.pool?.refused ? input.pool.text : undefined;
    const poolPrice = input.demo ? price : input.pool ? input.pool.text || "Free" : "";
    const tip = input.demo
      ? "Placeholder results are on (Settings), so outputs are free stand-ins."
      : refused
        ? (input.pool?.sub ?? refused)
        : `${input.pool?.sub ?? `Runs on this studio's GPUs${withModels}.`}${input.pool?.wait ? ` ${input.pool.wait}.` : ""}${signup ? " Create a free account to run it." : ""}`;
    return {
      where: "pool",
      label: "This studio's GPUs",
      price: poolPrice,
      title: "Runs on this studio's GPUs",
      tip,
      send: input.demo ? price : refused ?? [poolPrice, signup ? "this studio's GPUs, after sign-up" : "this studio's GPUs"].filter(Boolean).join(" · "),
      ...(signup && !refused && { needs: "signup" as const }),
      ...(refused && { refused }),
    };
  }
  if (open) {
    const needs = audience === "guest" ? "signup" : audience === "account" && !input.gpu ? "gpu" : undefined;
    const then = needs === "signup" ? " Create a free account and connect your GPU to run it." : needs === "gpu" ? " Connect your GPU to run it." : "";
    return {
      where: "gpu",
      label: "Your GPU",
      price,
      title: "Runs on your GPU",
      tip: input.demo ? "Placeholder results are on (Settings), so outputs are free stand-ins." : `Runs on your own GPU${withModels}. Free.${then}`,
      send: input.demo ? price : `${price} · ${needs === "signup" ? "your GPU, after sign-up" : needs === "gpu" ? "connect your GPU first" : "your GPU"}`,
      ...(needs && { needs }),
    };
  }
  const model = input.model ?? models[0];
  const inCloud = `Runs in the cloud${withModels}.`;
  let tip: string;
  let needs: RunPlace["needs"];
  let who = "cloud";
  if (input.demo) tip = "Placeholder results are on (Settings), so outputs are free stand-ins.";
  else if (audience === "owner") tip = `${inCloud} Estimated cost, billed by the provider to your key.`;
  else if (audience === "guest") {
    needs = "signup";
    who = "cloud, after sign-up";
    tip = `${inCloud} Billed to your own ${CLOUD_KEY.fal.label} or ${CLOUD_KEY.replicate.label} account: create a free account and add your key to run it.`;
  } else if (input.payer) tip = `${inCloud} Estimated cost, billed to ${billedTo(input.payer)}.`;
  else {
    needs = "key";
    who = "add your key";
    tip = `${inCloud} Billed to your own ${CLOUD_KEY.fal.label} or ${CLOUD_KEY.replicate.label} account: add your key in Settings → Your keys.`;
  }
  return {
    where: "cloud",
    label: model || "Cloud",
    price,
    title: "Runs in the cloud",
    tip,
    // Not priced yet: the button says what this viewer does first, else nothing (never a bare "cloud").
    send: input.demo ? price : price ? `${price} · ${who}` : needs ? who : "",
    ...(needs && { needs }),
    ...(model && { model }),
  };
}

/**
 * The model a multi-step run is named by in the cloud: its costliest step (the picture or the clip, not the script or
 * the join), the first on a tie. Undefined with no steps.
 */
export function mainModel(steps: readonly { modelName: string; costUsd: number | null }[] | undefined): string | undefined {
  let best: { modelName: string; costUsd: number | null } | undefined;
  for (const s of steps ?? []) if (!best || (s.costUsd ?? -1) > (best.costUsd ?? -1)) best = s;
  return best?.modelName;
}

/** Drawn in this browser (a Kinetic template, Click to Ad's end card): the same place and price whoever looks. */
export const IN_BROWSER: RunPlace = runPlace({ audience: "guest", engine: "browser", format: String });

/**
 * The price check's answer for a run on this studio's GPUs (`?preview=1` with `place: "pool"`), as the chip's `pool`:
 * only when the server says the run goes there (`place: "pool"` with a quote). Undefined otherwise (not checked yet, a
 * model the studio doesn't offer there, its own GPU or key): the chip then says your GPU, never this studio's.
 * `count`: runs one press starts (the quote is for one, said "each").
 */
export function checkedPool(
  check: { place?: "pool"; quote?: { text: string; sub?: string; allowed?: boolean }; line?: { place: number; etaSeconds: number | null } } | null | undefined,
  count = 1,
): { text: string; sub?: string; refused?: boolean; wait?: string } | undefined {
  if (check?.place !== "pool" || !check.quote) return undefined;
  const { text, sub } = check.quote;
  // Refused before Run (busy, a limit, not offered here): its words, never priced "each".
  if (check.quote.allowed === false) return { text, ...(sub && { sub }), refused: true };
  return { text: count > 1 && text ? `${text} each` : text, ...(sub && { sub }), ...(check.line && { wait: lineWords(check.line) }) };
}
