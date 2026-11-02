/**
 * What the skill pages and the Library read about skills in use (package W6, src/server/skill-insights.ts): a chain
 * made often enough to offer as a skill, a skill's run history, and the models that could fix a step. Types only.
 */
import type { Engine, MediaKind } from "./catalog/types";

/** A chain of steps made again and again, offered as a skill. */
export interface SkillSuggestion {
  /** The chain's shape (stable across sweeps): what Not now and Don't suggest this remember. */
  id: string;
  /** "Remove background → Edit → Image to video". */
  words: string;
  /** How many times it was made in the last 14 days. */
  count: number;
  /** The newest run's last steps: Make a skill drafts from them. */
  ids: string[];
  lastAt: number;
  /** Every one was made by the demo provider (no engine connected). */
  demo: boolean;
}

/** One run of a skill, from the stamp its generations carry. */
export interface SkillRunRow {
  run: string;
  batchId: string | null;
  status: "running" | "succeeded" | "failed" | "canceled";
  costUsd: number | null;
  at: number;
  /** How many generations it made. */
  steps: number;
  /** The steps that failed: their model and label. */
  failed: { model: string; error: string | null }[];
  demo: boolean;
  /** Its last few outputs (a still to show). */
  outputs: { url: string; kind: MediaKind; poster?: string }[];
  favorites: number;
}

export interface SkillHistory {
  runs: number;
  /** Of the runs that finished, the share that worked (null: none finished yet). */
  successRate: number | null;
  spendUsd: number;
  lastRunAt: number | null;
  favorites: number;
  /** The newest runs first. */
  recent: SkillRunRow[];
}

/** The steps that could use another model, and the models that do the same job here. */
export interface FixCandidates {
  engine: Engine;
  steps: {
    key: string;
    label: string;
    /** The model it uses now. */
    model: string;
    /** Why it's offered a fix (a model that was replaced or switched off, failures in its last runs). */
    reasons: string[];
    candidates: { modelId: string; name: string; engine: Engine; costUsd: number | null; problem?: string }[];
  }[];
}
