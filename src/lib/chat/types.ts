import type { Generation, GenerationRequest, MediaKind } from "@/lib/catalog/types";
import type { CharacterCard, ChatKind } from "./catalog";

/** What the chat's API sends the browser. */

/** One step of a plan: what it makes, on which model, and what Run costs (the studio's own price check). */
export interface ChatPlanJob {
  modelId: string;
  modelName: string;
  kind: MediaKind;
  prompt: string | null;
  /** How many results. */
  count: number;
  /** What Run shows for it ("Free", "$0.12", the GPUs' own words), or null when it can't run. */
  price: string | null;
  /** Why it can't run, in plain words (it then doesn't). */
  error?: string;
  /** Something the person should know (another model runs it, a setting fitted). */
  note?: string;
}

/** A plan in a chat: made when the person asks to make something, run when they say so. */
export interface ChatPlan {
  summary: string;
  jobs: ChatPlanJob[];
  /** The exact runs Run starts, through the studios' own route. */
  requests: GenerationRequest[];
  status: "ready" | "running" | "declined";
  /** The runs it started. */
  ids: string[];
  /** Runs that were refused when started, in plain words. */
  errors: string[];
  /** The plan made a still to animate after: the results offer Animate. */
  then?: "animate";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** A picture the person sent with it (their own file). */
  image: string | null;
  /** A plan to make something (an assistant message). */
  plan?: ChatPlan;
  createdAt: number;
}

export interface ChatThreadSummary {
  id: string;
  kind: ChatKind;
  title: string;
  characterId: string | null;
  /** The character's name and look, for the list. */
  character: Pick<CharacterCard, "id" | "name" | "accent" | "portrait"> | null;
  tool: string | null;
  play: string | null;
  mature: boolean;
  /** The last message, cut short. */
  preview: string;
  updatedAt: number;
}

export interface ChatThreadView extends ChatThreadSummary {
  messages: ChatMessage[];
  characterCard: CharacterCard | null;
  /** The share link's token, while one is live. */
  shareToken: string | null;
  /** The runs the chat's plans started (the person's own), for their results. */
  generations: Generation[];
}

/** Where a reply comes from. */
export type ChatEngine = "site" | "key";

export interface ChatMe {
  /** The free model can answer this person now. */
  site: boolean;
  /** The install has a free model at all (it may be resting). */
  siteKnown: boolean;
  /** Their own OpenRouter key, when saved. */
  key: { last4: string; model: string } | null;
  engine: ChatEngine;
  mature: boolean;
  owner: boolean;
}

/** One line of a reply's stream (NDJSON). */
export type ChatEvent =
  | { type: "user"; message: ChatMessage }
  | { type: "queue"; position: number }
  /** The free model is starting up: the reply is still coming. */
  | { type: "status"; status: "starting" }
  /** The message is kept and answered here as soon as the free model is ready. */
  | { type: "pending" }
  | { type: "text"; text: string }
  | { type: "done"; message: ChatMessage; title: string }
  | { type: "error"; code: ChatErrorCode; message: string; retryAfterS?: number };

export type ChatErrorCode = "busy" | "limit" | "blocked" | "failed" | "sign-in" | "no-model" | "key-refused" | "too-long";

/** A shared chat as its public page shows it: a copy made when it was shared. */
export interface ChatShareSnapshot {
  title: string;
  kind: ChatKind;
  mature: boolean;
  character: Pick<CharacterCard, "id" | "name" | "tagline" | "accent" | "builtIn"> & { portrait: boolean } | null;
  /** The play format or writing tool, for the label. */
  label: string | null;
  messages: { role: "user" | "assistant"; content: string }[];
  createdAt: number;
}
