import type { CharacterCard, ChatKind } from "./catalog";

/** What the chat's API sends the browser. */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** A picture the person sent with it (their own file). */
  image: string | null;
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
