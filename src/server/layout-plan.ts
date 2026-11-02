import "server-only";
import { LAYOUT_MULTIPLE, type LayoutDraft } from "@/lib/layout-prompt";
import { LAYOUT_PLAN_SYSTEM, planByRules, planRequest, readPlanned } from "@/lib/layout-plan";
import { llmText, llmTextBackend } from "./enhance";

/**
 * "Plan layout" (the Layout editor; N7-8): the sentence becomes a draft on the editor's canvas. The install's AI helper
 * (Claude when it is allowed, else a local model) writes it; an answer that doesn't read as a layout, or one that
 * validateLayout refuses, falls back to the rules, as does an install with no AI helper.
 */
export interface PlannedLayout {
  layout: LayoutDraft;
  /** Who planned it: the AI helper, or Fuobe's rules. */
  by: "llm" | "rules";
}

export async function planLayoutFromWords(words: string, width: number, height: number, ask: (system: string, user: string) => Promise<string | null> = (s, u) => llmText(s, u, { json: "object" })): Promise<PlannedLayout> {
  if (llmTextBackend()) {
    const planned = readPlanned(await ask(LAYOUT_PLAN_SYSTEM, planRequest(words, width, height)).catch(() => null), width, height);
    if (planned) return { layout: planned, by: "llm" };
  }
  return { layout: planByRules(words, width, height), by: "rules" };
}

/** A canvas side the planner takes: a multiple of 16 from 256 to 2048 px (else the 1024 default). */
export const planSide = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 256 && v <= 2048 && v % LAYOUT_MULTIPLE === 0 ? v : 1024);
