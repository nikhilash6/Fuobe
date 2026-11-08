import type { Generation, GenerationRequest } from "./catalog/types";

/**
 * Where a run on its way is, as one of a few stages every run card shows the same way (the studios' feeds, and the
 * other places a run is waited on). The words on the card stay the run's own (src/lib/pending-words.ts); the stage
 * drives the card's look, its progress ring and what a screen reader hears when it moves on.
 *
 * - "sending": Run was pressed and the studio hasn't answered yet (the card shows at once, before the run is made).
 * - "in-line": made, waiting for its turn.
 * - "warming": started, with no progress yet (its model loading).
 * - "creating": making it, with its progress when it reports one.
 * - "finishing": nearly there (the last steps, saving, the result's check).
 */
export type RunStage = "sending" | "in-line" | "warming" | "creating" | "finishing";

/** A short word for each stage: the screen reader's announcement when a card moves on (never the machinery). */
export const STAGE_WORDS: Record<RunStage, string> = {
  sending: "Starting",
  "in-line": "In line",
  warming: "Warming up",
  creating: "Creating",
  finishing: "Finishing",
};

/** At or past this share of its progress a run reads as finishing. */
export const FINISHING_AT = 0.97;

type StageFacts = Pick<Generation, "status" | "progress"> & Partial<Pick<Generation, "stage">>;

/**
 * The stage of a run on its way (null once it is done, failed or stopped), and its progress (0–1) when it says one.
 * `local`: its job on the ComfyUI on this computer, when it runs there (its own steps and phase come first).
 */
export function runStage(g: StageFacts, local?: { fraction: number | null; saving?: boolean } | null): { stage: RunStage; fraction: number | null } | null {
  if (g.status !== "queued" && g.status !== "running") return null;
  if (local) {
    if (local.saving) return { stage: "finishing", fraction: null };
    if (local.fraction == null || local.fraction <= 0) return { stage: g.status === "queued" ? "in-line" : "warming", fraction: null };
    return { stage: local.fraction >= FINISHING_AT ? "finishing" : "creating", fraction: clamp(local.fraction) };
  }
  if (g.status === "queued") return { stage: "in-line", fraction: null };
  if (g.stage === "checking") return { stage: "finishing", fraction: null };
  const p = g.progress;
  if (p == null || !Number.isFinite(p) || p <= 0) return { stage: "warming", fraction: null };
  return { stage: p >= FINISHING_AT ? "finishing" : "creating", fraction: clamp(p) };
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/**
 * A run card's box at its run's shape: `ratio` is width over height. The height is the feed's row height (a CSS
 * variable, so phones and desktops share one rule) and the width follows from it, set outright rather than left to
 * `aspect-ratio`: a card that holds only an overlay (a run on its way) or a few words (a failed run) then never
 * shrinks to its content's width in a flex row, whatever the browser does with percentage heights.
 * `min`: the narrowest shape kept (a failed run's words and buttons need some room).
 */
export function tileBox(ratio: number, min = 0): { width: string; aspectRatio: number } {
  const r = Number.isFinite(ratio) && ratio > 0 ? Math.max(ratio, min) : 1;
  const shape = Math.round(r * 10_000) / 10_000;
  return { width: `calc(var(--tile-h) * ${shape})`, aspectRatio: shape };
}

/** A press of Run with no answer yet (useMakingRuns): when it was pressed (the browser's clock) and what it sent. */
export interface Making {
  at: number;
  request: Pick<GenerationRequest, "feature" | "modelId" | "prompt">;
}

/** How far apart the browser's clock and the server's may be when a made run is matched to its press. */
const MATCH_WINDOW_MS = 60_000;

/**
 * The presses of Run a feed shows a card for: the ones for its own features (else the features it lists already, or
 * all when it lists none), and not one whose run has already arrived in it (the run's own card takes over in the same
 * place, so the hand-over never shows two cards or a jump).
 */
export function shownMaking<T extends Making>(making: readonly T[], items: readonly Pick<Generation, "feature" | "modelId" | "createdAt" | "request" | "status">[], features?: readonly string[]): T[] {
  const own = features?.length ? new Set(features) : items.length ? new Set(items.map((g) => g.feature)) : null;
  return making.filter((m) => {
    if (own && !own.has(m.request.feature)) return false;
    return !items.some(
      (g) =>
        (g.status === "queued" || g.status === "running") &&
        Math.abs(g.createdAt - m.at) <= MATCH_WINDOW_MS &&
        g.modelId === m.request.modelId &&
        (g.request.prompt ?? "") === (m.request.prompt ?? ""),
    );
  });
}

/** How many tiles a run card shows while it is on its way: the pictures or clips it was asked for (1 to 8). */
export function tileCount(numOutputs: unknown): number {
  const n = typeof numOutputs === "number" && Number.isFinite(numOutputs) ? Math.round(numOutputs) : 1;
  return Math.min(8, Math.max(1, n));
}
