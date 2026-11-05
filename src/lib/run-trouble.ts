import type { TroubleAction } from "./diagnose";
import type { Generation, ModelDef } from "./catalog/types";
import { onCloudKey } from "./before-run";
import { smallerRun } from "./smaller-run";

/**
 * What the buttons under a run's GPU or key problem do (src/components/gpu/trouble.tsx), wherever the run is shown: a
 * studio's feed (its tile) or the Library (its card). A studio loads a run into its composer itself; the Library opens the
 * run's studio with the run loaded (`?reuse=<id>`, and `pick=1` to open its model picker there).
 */

/** `?reuse=<run id>`: a studio loads that run's settings into its composer, once. */
export const REUSE_PARAM = "reuse";
/** With `reuse`: its model picker opens too ("Pick another model"). */
export const PICK_PARAM = "pick";

/** The studio a run belongs to, by what it was made with (its feature), else by what it made. */
export function studioHrefFor(g: Pick<Generation, "feature" | "kind">): string {
  const f = g.feature;
  if (f.startsWith("app:")) return `/apps/${encodeURIComponent(f.slice(4))}`;
  if (f === "video" || f.startsWith("motion:") || f.startsWith("effect:")) return "/video";
  if (f === "image" || f === "edit" || f === "lipsync" || f === "upscale" || f === "audio") return `/${f}`;
  if (f.startsWith("character:")) return "/image";
  return g.kind === "video" ? "/video" : g.kind === "audio" ? "/audio" : "/image";
}

/** The run's studio with the run loaded into its composer (and its model picker open, `pick`). */
export function reuseHref(g: Pick<Generation, "id" | "feature" | "kind">, pick = false): string {
  const q = new URLSearchParams({ [REUSE_PARAM]: g.id, ...(pick && { [PICK_PARAM]: "1" }) });
  return `${studioHrefFor(g)}?${q}`;
}

/** "Send a smaller copy": the run's file made smaller on the server; the run's request comes back with it, and the words to say. */
export async function smallerCopyRequest(g: Pick<Generation, "id">): Promise<{ request: Generation["request"]; note: string }> {
  const res = await fetch(`/api/generations/${encodeURIComponent(g.id)}/smaller`, { method: "POST" });
  const j = (await res.json().catch(() => ({}))) as { request?: Generation["request"]; note?: string; error?: string };
  if (!res.ok || !j.request) throw new Error(j.error ?? "We couldn't make a smaller copy. Press Retry.");
  return { request: j.request, note: j.note ?? "Sent a smaller copy." };
}

/** What the handlers need from the page they are on. */
export interface RunTroubleDeps {
  /** Start a run (`done`: the words once it has started). True when it started; a refusal is said by `run` itself. */
  run: (request: Generation["request"], done?: string) => Promise<boolean>;
  /** In a studio: the run's settings back into its composer. */
  reuse?: (g: Generation) => void;
  /** In a studio: its composer's model picker opens. */
  openPicker?: () => void;
  /** Elsewhere (the Library): go to this address (the run's studio, with the run loaded). */
  go?: (href: string) => void;
  /** The run's model (its sizes and lengths, for Try one size smaller). */
  model?: Pick<ModelDef, "options" | "defaults">;
  /** Without `model`: read the run's model when Try one size smaller is pressed (the Library doesn't hold the catalog). */
  loadModel?: (id: string) => Promise<Pick<ModelDef, "options" | "defaults"> | undefined>;
  /** Say what went wrong (a smaller copy that couldn't be made), with the next thing to try as a button, if any. */
  onError: (e: unknown, next?: { label: string; onClick: () => void }) => void;
  /** Make a smaller copy (tests stand in for the server). */
  smallerCopy?: typeof smallerCopyRequest;
}

/** The handlers a run's trouble buttons take (TroubleActions' `handlers`). */
export interface RunTroubleHandlers {
  onRunWithKey?: (a: TroubleAction) => Promise<unknown>;
  onPickModel?: () => void;
  onTrySmaller?: () => Promise<unknown>;
  onSendSmaller?: () => Promise<unknown>;
}

/** Pick another model: in a studio, the run back in its composer with the picker open; elsewhere, its studio so. */
function pickModel(g: Generation, d: RunTroubleDeps): (() => void) | undefined {
  if (d.reuse && d.openPicker) {
    const { reuse, openPicker } = d;
    return () => {
      reuse(g);
      openPicker();
    };
  }
  if (d.go) {
    const go = d.go;
    return () => go(reuseHref(g, true));
  }
  return undefined;
}

/** A failed run's buttons: run it on a key, pick another model, one size smaller, or a smaller copy of its file. */
export function failedRunHandlers(g: Generation, d: RunTroubleDeps): RunTroubleHandlers {
  const copy = d.smallerCopy ?? smallerCopyRequest;
  const pick = pickModel(g, d);
  const smaller = smallerRun(g.request, d.model);
  const { loadModel } = d;
  const trySmaller = smaller
    ? () => d.run(smaller.request, `Running it again at ${smaller.what}.`)
    : loadModel
      ? async () => {
          const s = smallerRun(g.request, await loadModel(g.modelId).catch(() => undefined));
          if (s) return d.run(s.request, `Running it again at ${s.what}.`);
          // No smaller size or length: another model, in the run's studio.
          pick?.();
          return false;
        }
      : undefined;
  return {
    onRunWithKey: (a) => d.run(onCloudKey(g.request, a)),
    onPickModel: pick,
    onTrySmaller: trySmaller,
    onSendSmaller: () =>
      copy(g).then(
        ({ request, note }) => d.run(request, note),
        // No smaller copy could be made: the next thing to try, a press away.
        (e) =>
          d.onError(
            e,
            trySmaller ? { label: "Try one size smaller", onClick: () => void trySmaller() } : pick ? { label: "Pick another model", onClick: pick } : undefined,
          ),
      ),
  };
}

// A waiting run's "Run with your key" moves its whole batch (the server stops every job of it not handed over yet):
// while one tile's press is on its way, the batch's other tiles don't offer it again.
const moving = new Map<string, string>();
const listeners = new Set<() => void>();

/** A run's batch (its jobs share it), or the run itself. */
export const batchKeyOf = (g: Pick<Generation, "id" | "batchId">): string => g.batchId ?? g.id;

export function subscribeMoving(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The run whose press moves this batch to a key right now, if any. */
export const movingRun = (key: string): string | undefined => moving.get(key);

function setMoving(key: string, id: string | null): void {
  if (id) moving.set(key, id);
  else moving.delete(key);
  for (const fn of listeners) fn();
}

/** A waiting run's buttons: Run with your key takes its place (and its batch's), once. */
export function waitingRunHandlers(g: Generation, d: RunTroubleDeps): RunTroubleHandlers {
  const key = batchKeyOf(g);
  return {
    onRunWithKey: async (a) => {
      const was = moving.get(key);
      if (was && was !== g.id) return false;
      setMoving(key, g.id);
      const started = await d.run({ ...onCloudKey(g.request, a), replaces: g.id } as Generation["request"]);
      // Started: the batch's jobs stop, so their tiles go. Refused: the button comes back.
      if (!started) setMoving(key, null);
      return started;
    },
  };
}
