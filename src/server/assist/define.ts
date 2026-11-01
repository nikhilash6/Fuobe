import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type { AssistItem, PlannedJob } from "@/lib/assist";

/** Shared shape of Assist's tools (also served over MCP). */

export type ResultContent = Anthropic.Beta.BetaToolResultBlockParam["content"];

export interface ToolContext {
  engine: "cloud" | "open";
  /** The Assist chat running the tool; absent over MCP. */
  thread?: {
    id: string;
    projectId: string | null;
    /** Skills already loaded in this chat. */
    skills: string[];
    /** Load a skill into this chat: its instructions join the context on the next model call. */
    loadSkill: (name: string) => void;
  };
}

export interface ToolOutcome {
  content: ResultContent;
  isError?: boolean;
  /** Cards to show in the chat (generations started, a short "looked up models" line…). */
  items?: AssistItem[];
}

/** Where a studio tool's job opens: its studio and that studio's page, or why it runs in the Library instead. */
export interface JobPlace {
  studio?: string;
  href?: string;
  fallback?: string;
}

export interface ToolDef<S extends z.ZodType> {
  name: string;
  description: string;
  schema: S;
  /** Spends money or GPU time (or, for remember, changes what Assist knows): waits for the user's approval unless auto-approve is on. */
  gated?: boolean;
  strict?: boolean;
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<ToolOutcome>;
  /** For gated tools: what the run would do, priced. */
  plan?: (input: z.infer<S>, ctx: ToolContext) => PlannedJob[];
  /** The approval card's heading for this call (default: its summary field, else the tool's name). */
  title?: (input: z.infer<S>) => string;
  /** Studio tools: where the job will open (shown on the card, returned by MCP's estimate_job). */
  place?: (input: z.infer<S>, ctx: ToolContext) => JobPlace;
}

export const defineTool = <S extends z.ZodType>(def: ToolDef<S>) => def;
