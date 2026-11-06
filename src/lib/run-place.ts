import { RUN_SHOWN_HEADER, shownHeader } from "./guest-access";
import { ownSetupDetail, ownSetupLabel, type OwnSetup } from "./own-setup";
import { placeOf, type Place } from "./place-name";
import { capitalFirst, waitWords, type LineFacts } from "./pool-line";
import { deviceLabel } from "./gpu/readiness";
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
  /** The name visitors read for this studio's GPUs (usePlaceName; absent: "Our GPUs"). */
  place?: Place;
  /**
   * The price of a run on this studio's GPUs (the billing service's words; empty text: free), undefined while pricing.
   * `refused`: the price check refused the run (its words are `text`), so it can't start now. `wait`: where it would
   * stand in line, and the wait. `setup`: refused because it runs on the visitor's own setup (own-setup.ts), which the
   * send button opens instead of staying off.
   */
  pool?: { text: string; sub?: string; refused?: boolean; wait?: string; setup?: OwnSetup } | null;
  /** The provider an account's paid run is billed to (its own key), or null when it has no key for this model. */
  payer?: CloudProvider | null;
  /** How a price reads: "$0.04". */
  format: (usd: number) => string;
}

export interface RunPlace {
  /** What the chip's icon shows. */
  where: "cloud" | "gpu" | "pool" | "browser" | "unavailable";
  /** The chip's words: "Your GPU", the place name of this studio's GPUs ("Our GPUs"), the cloud model's name, "Your browser", "Not available here". */
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
  /** It runs on the visitor's own setup (own-setup.ts): the send button opens that setup (`needs` says which). */
  setup?: OwnSetup;
  /** False: this studio's GPUs don't take this run for this viewer (hosted runs), so there is no Run on choice for it. */
  siteRuns?: boolean;
}

const list = (names: readonly string[]) => (names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** Unique names, in order. */
const uniq = (names: readonly string[] | undefined) => [...new Set((names ?? []).filter(Boolean))];

/**
 * A tool that runs for the studio's owner only, as anyone else reads it while hosted runs are on: what is coming, and the
 * studios to use now (never "Not available here").
 */
const OWNER_ONLY_HOSTED: Omit<RunPlace, "tip"> = { where: "unavailable", label: "Coming soon", price: "", title: "Coming soon", send: "" };
export const ownerOnlyTip = (tool: string): string => `${tool} isn't open to accounts yet. Try the Image, Video or Audio studio.`;

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
    // Hosted runs on: said as what is coming, with the way on now (no visitor's own GPU or key runs it yet, so no setup).
    if (input.hosted) return { ...OWNER_ONLY_HOSTED, tip: ownerOnlyTip(input.ownerOnly) };
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
  // at the billing service's price, said with their place name ("Runs on our GPUs").
  if (open && input.hosted && audience !== "owner" && (!input.gpu || input.preferPool)) {
    const signup = audience === "guest";
    // Runs on the visitor's own GPU or key only: said in the setup's own words, and the send button opens that setup.
    const setup = !input.demo && input.pool?.refused ? input.pool.setup : undefined;
    if (setup) {
      const needs = signup ? "signup" : setup.need === "key" ? "key" : input.gpu ? undefined : "gpu";
      return {
        where: setup.need === "key" ? "cloud" : "gpu",
        label: setup.need === "key" ? "Your key" : "Your GPU",
        price: "",
        title: ownSetupLabel(setup),
        tip: `${ownSetupDetail(setup)}${signup ? " Create a free account to run it." : ""}`,
        send: ownSetupLabel(setup),
        ...(needs && { needs: needs as RunPlace["needs"] }),
        setup,
      };
    }
    const place = input.place ?? placeOf(null);
    const refused = !input.demo && input.pool?.refused ? input.pool.text : undefined;
    const poolPrice = input.demo ? price : input.pool ? input.pool.text || "Free" : "";
    const tip = input.demo
      ? "Placeholder results are on (Settings), so outputs are free stand-ins."
      : refused
        ? (input.pool?.sub ?? refused)
        : `${input.pool?.sub ?? `Runs on ${place.text}${withModels}.`}${input.pool?.wait ? ` ${capitalFirst(input.pool.wait)}.` : ""}${signup ? " Free with an account." : ""}`;
    return {
      where: "pool",
      label: place.label,
      price: poolPrice,
      title: `Runs on ${place.text}`,
      tip,
      send: input.demo ? price : refused ?? [poolPrice, signup && "sign up to run"].filter(Boolean).join(" · "),
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

/** Where an account picked its runs to go (the Run on list; hosted runs): this studio's GPUs, its own GPU, or its key. */
export type RunOnPick = "site" | "gpu" | "key";

/**
 * Where a studio composer's run goes, with hosted runs on, in one order: a place picked for this run (`pick`), then the
 * account's remembered pick (`runOn`): its own GPU, sent there even while it doesn't answer (never moved anywhere else
 * without a word: the check before Run says so and offers a run elsewhere); this studio's GPUs first (a pick of them,
 * or of its key, whose runs come here on the Open source engine). With no pick: its own GPU while that is online (unless
 * the studio puts its own GPUs first), else this studio's GPUs. `place` is what the run names beside the request: none
 * when this studio's GPUs go first while its own GPU is online, so the server decides (it reads the same pick), and a
 * model this studio's GPUs don't take still runs on the account's own GPU.
 */
export function composerPlace(
  pick: "own" | "pool" | null,
  runOn: RunOnPick | null | undefined,
  ownOnline: boolean,
  preferPool: boolean,
): { runOn: "own" | "pool"; place: "own" | "pool" | undefined } {
  if (pick) return { runOn: pick, place: pick };
  if (runOn === "gpu") return { runOn: "own", place: "own" };
  if (!ownOnline) return { runOn: "pool", place: "pool" };
  return preferPool || runOn === "site" || runOn === "key" ? { runOn: "pool", place: undefined } : { runOn: "own", place: "own" };
}

/**
 * Is a composer's run one on this studio's GPUs (their price and place in line, no check of the person's own GPU, the
 * price shown sent with it)? A run that names its place: that place. One that names none (this studio's GPUs first while
 * the person's own GPU is online, so the server decides): only once the price check, asked with no place either, says the
 * run goes there. A model those GPUs don't take then runs on the person's own GPU, as before. `checked` undefined: no
 * answer for this draft yet, so `last` (what the check said for the draft before) stands meanwhile.
 */
export function composerOnPool(place: "own" | "pool" | undefined, checked: { place?: "pool" } | null | undefined, last: boolean): boolean {
  if (place) return place === "pool";
  return checked === undefined ? last : checked?.place === "pool";
}

/**
 * The place an app's own tool names in its price check, as its run names it: "pool" for a viewer with no GPU of its own;
 * none for one whose own GPU is there while this studio puts its GPUs first (the server then sends what they don't take
 * to that GPU, and the check says so). Null: no check (the owner, hosted runs off, a tool for the person's own GPU only,
 * or a viewer whose runs go to its own GPU).
 */
export function openCheckPlace(
  v: { audience: RunAudience; gpu: boolean; hosted: boolean; preferPool: boolean; runOn?: RunOnPick | null } | null,
  ownGpuOnly = false,
): "pool" | undefined | null {
  if (!v || ownGpuOnly || v.audience === "owner" || !v.hosted) return null;
  if (!v.gpu) return "pool";
  // Its own GPU, by its own pick: the run goes there (the server reads the same pick), so nothing is priced here.
  if (v.runOn === "gpu") return null;
  return v.preferPool || v.runOn === "site" || v.runOn === "key" ? undefined : null;
}

/**
 * A tool page's own words for a free open-model run ("Free · your GPU", "Free on your GPU, about 20 GB", "free on your
 * GPU"), as a viewer whose open runs go to this studio's GPUs reads them (`site`: hosted runs on and openCheckPlace
 * names a place): "Free", with no place, since the page's place chip or price check says where. Runs that go to the
 * person's own GPU, the owner's, and every install with hosted runs off keep the page's words.
 */
export function openFreeWords(text: string, site: boolean): string {
  if (!site) return text;
  return text
    .replace(/\bFree(?: ·)?(?: on)? your GPU(?:, about \d+ GB)?/g, "Free")
    .replace(/\bfree(?: ·)?(?: on)? your GPU\b/g, "free")
    .replace(/\bFree · GPU\b/g, "Free");
}

/**
 * A run's request to send again (Retry): with hosted runs on, to the place it ran, named, so it never moves (a run on this
 * studio's GPUs stays there, one on the person's own GPU or key stays there), whatever the account's pick says now.
 * Hosted runs off: the request as it was.
 */
export function retryRequest<R extends object>(g: { request: R; place?: "pool" }, hosted: boolean): R {
  return hosted ? { ...g.request, place: g.place === "pool" ? "pool" : "own" } : g.request;
}

/**
 * "Run on Our GPUs" on a run that failed on the person's own GPU (hosted runs): an open run that ran there. One-off: it
 * is sent again here, named, and the account's pick stays as it was.
 */
export const offersRunOnSite = (g: { place?: "pool"; engine: string; status: string }, hosted: boolean): boolean => hosted && g.place !== "pool" && g.engine === "open" && g.status === "failed";

/** One row of the Run on list: a place, the line under it, and whether this item's runs go there now. */
export interface RunOnRow {
  id: RunOnPick;
  /** "Our GPUs", "Your GPU", "Your fal.ai key". */
  label: string;
  /** "Free · ready in about 40 s", "Free · RTX 4090", "≈ $0.04 · billed to your fal.ai account". */
  sub: string;
  /** Your GPU: it answers now (a green dot). Not answering is said in `sub`; the row can still be picked. */
  online?: boolean;
  /** This item's next run goes here. */
  selected: boolean;
}

/** The Run on list for one item, and where its next run goes. */
export interface RunOnRows {
  rows: RunOnRow[];
  /** Where the next run goes (the chip's words follow it). */
  on: RunOnPick;
  /** The remembered place can't run this item, so this run goes to this studio's GPUs: said in the chip's tooltip. */
  note?: string;
}

/** What the Run on list knows of the viewer (the status's viewer). */
export interface RunOnViewer {
  kind?: "guest" | "account";
  hosted?: boolean;
  prefer?: "pool";
  placeName?: string;
  runOn?: RunOnPick;
  gpu: { connected: boolean; online?: boolean; device?: string };
}

/** The footer under the list: a pick holds for later runs too. */
export const RUN_ON_FOOTER = "Your next runs go here too.";

/** The words of a key's row: its price first when known, and who bills it. */
export const keyRowSub = (p: CloudProvider, price?: string | null): string => (price ? `${price} · billed to ${billedTo(p)}` : `Billed to ${billedTo(p)}`);

/**
 * The Run on list for an item (hosted runs; an account only): this studio's GPUs always, its own GPU when one is
 * connected (picking it is allowed while it doesn't answer: the check before Run says so), and the key that runs this
 * item's cloud version (`item.key`, with its price when known). Null when there is nothing to choose: hosted runs off, a
 * guest, no GPU and no key for this item ("No control without a choice"), or an item this studio's GPUs can't run (its
 * label says where it runs instead). `quote`: the price check's words for a run here, and where it would stand in line.
 * `item.cloud`: the item is on its cloud version now (the Cloud engine), so a pick of the key runs it there; on its open
 * version a pick of the key runs it on this studio's GPUs (the key runs what has a cloud version only).
 */
export function placeRows(
  viewer: RunOnViewer | undefined | null,
  item: { key?: { provider: CloudProvider; price?: string | null } | null; siteRuns?: boolean; cloud?: boolean },
  quote: { text?: string; wait?: string } = {},
): RunOnRows | null {
  if (!viewer?.hosted || viewer.kind !== "account" || item.siteRuns === false) return null;
  const gpu = viewer.gpu.connected ? viewer.gpu : null;
  const key = item.key ?? null;
  if (!gpu && !key) return null;
  const place = placeOf(viewer.placeName);
  // Where the next run goes: the pick when this item runs there; with none, its own GPU while that is online on an
  // install that puts it first (composerPlace), else this studio's GPUs.
  const picked = viewer.runOn;
  let on: RunOnPick = "site";
  let note: string | undefined;
  if (picked === "gpu" && gpu) on = "gpu";
  else if (picked === "key") {
    if (key && item.cloud) on = "key";
    else if (!key) note = `Runs on ${place.text}. This one has no cloud version.`;
  } else if (!picked && gpu?.online && viewer.prefer !== "pool") on = "gpu";
  const rows: RunOnRow[] = [{ id: "site", label: place.label, sub: [quote.text || "Free", quote.wait].filter(Boolean).join(" · "), selected: on === "site" }];
  if (gpu) {
    // "RTX 4090", not ComfyUI's whole device name.
    const device = deviceLabel(gpu.device).replace(/^NVIDIA\s+(GeForce\s+)?/i, "");
    rows.push({ id: "gpu", label: "Your GPU", sub: gpu.online ? ["Free", device].filter(Boolean).join(" · ") : "Free · not answering right now", ...(gpu.online && { online: true }), selected: on === "gpu" });
  }
  if (key) rows.push({ id: "key", label: `Your ${CLOUD_KEY[key.provider].label} key`, sub: keyRowSub(key.provider, key.price), selected: on === "key" });
  return { rows, on, ...(note && { note }) };
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
  check: { place?: "pool"; quote?: { text: string; sub?: string; allowed?: boolean; ownSetup?: OwnSetup }; line?: LineFacts } | null | undefined,
  count = 1,
): { text: string; sub?: string; refused?: boolean; wait?: string; setup?: OwnSetup } | undefined {
  if (check?.place !== "pool" || !check.quote) return undefined;
  const { text, sub, ownSetup } = check.quote;
  // Refused before Run (busy, a limit, not offered here): its words, never priced "each"; with the visitor's own setup
  // that runs it, when that is the answer.
  if (check.quote.allowed === false) return { text, ...(sub && { sub }), refused: true, ...(ownSetup && { setup: ownSetup }) };
  const wait = check.line ? waitWords(check.line) : null;
  return { text: count > 1 && text ? `${text} each` : text, ...(sub && { sub }), ...(wait && { wait }) };
}

/** What a tool page's price slot and Run say for a run on this studio's GPUs (toolPoolPrice). */
export interface ToolPoolPrice {
  /** The service's words for the price, then when the run would be ready ("Free · ready in about 3 min"). */
  text: string;
  /** The run wouldn't be taken now: Run is off, and `text` says why (unless `setup` runs it instead). */
  refused: boolean;
  /** Refused because it runs on the person's own setup: Run opens it. */
  setup?: OwnSetup;
  /** The price shown, sent with Run (the header a tool's run reads it from), so a changed price is asked about first. */
  headers: Record<string, string>;
}

/**
 * A tool's own price check (`?preview=1` or its estimate route) as its page shows it: when the server adds `{ place:
 * "pool", quote, line }` (the run goes to this studio's GPUs), the service's price and the place in line instead of the
 * page's own words ("Free · your GPU" is for the person's own GPU), Run off when it is refused, and the price shown to
 * send with Run. Null when the run goes to the person's own GPU or key (the page says its own words).
 */
export function toolPoolPrice(check: unknown): ToolPoolPrice | null {
  if (!check || typeof check !== "object") return null;
  const c = check as { place?: unknown; quote?: { allowed?: boolean; amount?: number; priceVersion?: string; text?: string; sub?: string; ownSetup?: OwnSetup }; line?: LineFacts };
  if (c.place !== "pool" || !c.quote || typeof c.quote.text !== "string") return null;
  const pool = checkedPool({ place: "pool", quote: { ...c.quote, text: c.quote.text }, ...(c.line && { line: c.line }) });
  if (!pool) return null;
  if (pool.refused) return { text: pool.text, refused: true, ...(pool.setup && { setup: pool.setup }), headers: {} };
  const shown = typeof c.quote.amount === "number" && typeof c.quote.priceVersion === "string" ? { amount: c.quote.amount, priceVersion: c.quote.priceVersion } : null;
  return {
    text: [pool.text, pool.wait].filter(Boolean).join(" · "),
    refused: false,
    headers: shown ? { [RUN_SHOWN_HEADER]: shownHeader(shown) } : {},
  };
}

/**
 * A tool page's price check (`?preview=1`) as its Run reads it: when this studio's GPUs wouldn't take the run now, their
 * words become the check's error, marked `poolRefused`. Every other answer stays as it is: an error there (no GPU or key
 * connected yet, say) is the server's to answer when Run is pressed, and its refusal opens the card that helps.
 */
export function withPoolRefusal<T extends { error?: string; poolRefused?: boolean }>(check: T): T {
  const pool = toolPoolPrice(check);
  return pool?.refused ? { ...check, error: pool.text, poolRefused: true } : check;
}

/**
 * What Run says instead of sending the run: only a refusal by this studio's GPUs (withPoolRefusal), and only from the
 * check of the settings shown now (`stale`: a previous check, kept on screen while the new one runs). Null: send it.
 */
export function refusedBeforeRun(check: { error?: string; poolRefused?: boolean } | null | undefined, stale = false): string | null {
  return check?.poolRefused && check.error && !stale ? check.error : null;
}
