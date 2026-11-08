import "server-only";
import crypto from "node:crypto";
import { BUILT_IN_CHARACTERS, builtInCharacter, CHAT_LIMITS, isChatKind, playFormat, workshopFormat, writeTool, type CharacterCard, type ChatKind } from "@/lib/chat/catalog";
import { titleFrom } from "@/lib/chat/prompt";
import type { ChatEngine, ChatMessage, ChatPlan, ChatShareSnapshot, ChatThreadSummary, ChatThreadView } from "@/lib/chat/types";
import { generationAccount } from "../account-library";
import { db } from "../db";
import { getGeneration } from "../generations";
import { open as openSealed, seal } from "../secret-box";

/**
 * Fuobe Chat's rows (src/server/db.ts CHAT_TABLES). Every read and change names the chat's owner (`who`: an account's id,
 * or "owner"), so one account never reaches another's chats, characters or settings.
 */

export class ChatError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code?: string,
  ) {
    super(message);
  }
}

const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;
const clip = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/\r\n/g, "\n").trim().slice(0, n) : "");

// ---------------------------------------------------------------------------
// Characters

interface CharacterRow {
  id: string;
  account_id: string;
  name: string;
  tagline: string;
  persona: string;
  scenario: string;
  greeting: string;
  mature: number;
  accent: string;
  portrait_url: string | null;
  created_at: number;
  updated_at: number;
}

const HEX = /^#[0-9a-f]{6}$/i;

function accentOf(raw: unknown): [string, string] {
  try {
    const a = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(a) && a.length === 2 && a.every((x) => typeof x === "string" && HEX.test(x))) return [a[0], a[1]];
  } catch {
    // An unreadable value: the default below.
  }
  return ["#241a3a", "#6a5ee7"];
}

const fromCharacterRow = (r: CharacterRow): CharacterCard => ({
  id: r.id,
  name: r.name,
  tagline: r.tagline,
  persona: r.persona,
  scenario: r.scenario,
  greeting: r.greeting,
  mature: !!r.mature,
  accent: accentOf(r.accent),
  portrait: r.portrait_url,
  builtIn: false,
});

/** The built-in characters and this person's own, newest own first. Mature ones only while Mango Chilli is on. */
export function listCharacters(who: string, mature: boolean): CharacterCard[] {
  const own = (db().prepare("SELECT * FROM account_chat_characters WHERE account_id = ? ORDER BY updated_at DESC").all(who) as CharacterRow[]).map(fromCharacterRow);
  return [...own, ...BUILT_IN_CHARACTERS].filter((c) => mature || !c.mature);
}

/** A character this person may chat with: a built-in one, or one of their own. */
export function getCharacter(who: string, id: string | null | undefined): CharacterCard | null {
  if (!id) return null;
  const b = builtInCharacter(id);
  if (b) return b;
  const r = db().prepare("SELECT * FROM account_chat_characters WHERE id = ? AND account_id = ?").get(id, who) as CharacterRow | undefined;
  return r ? fromCharacterRow(r) : null;
}

export interface CharacterInput {
  name?: unknown;
  tagline?: unknown;
  persona?: unknown;
  scenario?: unknown;
  greeting?: unknown;
  mature?: unknown;
  accent?: unknown;
  portrait?: unknown;
}

function cleanCharacter(input: CharacterInput, before?: CharacterCard) {
  const L = CHAT_LIMITS;
  const name = input.name === undefined && before ? before.name : clip(input.name, L.nameChars);
  const persona = input.persona === undefined && before ? before.persona : clip(input.persona, L.personaChars);
  if (!name) throw new ChatError("Give your character a name.");
  if (persona.length < 10) throw new ChatError("Say a little about who your character is: how they talk and what they're like.");
  const greeting = input.greeting === undefined && before ? before.greeting : clip(input.greeting, L.greetingChars);
  return {
    name,
    persona,
    tagline: input.tagline === undefined && before ? before.tagline : clip(input.tagline, L.taglineChars),
    scenario: input.scenario === undefined && before ? before.scenario : clip(input.scenario, L.scenarioChars),
    greeting: greeting || `*${name} looks up* Oh, hello. I wasn't expecting anyone.`,
    mature: input.mature === undefined && before ? before.mature : input.mature === true,
    accent: input.accent === undefined && before ? before.accent : accentOf(input.accent),
    portrait: input.portrait === undefined && before ? before.portrait : typeof input.portrait === "string" && input.portrait ? input.portrait : null,
  };
}

export function createCharacter(who: string, input: CharacterInput): CharacterCard {
  const n = (db().prepare("SELECT COUNT(*) AS n FROM account_chat_characters WHERE account_id = ?").get(who) as { n: number }).n;
  if (n >= CHAT_LIMITS.characters) throw new ChatError(`You have ${CHAT_LIMITS.characters} characters, the most there can be. Delete one to make another.`, 409);
  const c = cleanCharacter(input);
  const id = newId("ch");
  const now = Date.now();
  db()
    .prepare(
      "INSERT INTO account_chat_characters (id, account_id, name, tagline, persona, scenario, greeting, mature, accent, portrait_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, who, c.name, c.tagline, c.persona, c.scenario, c.greeting, c.mature ? 1 : 0, JSON.stringify(c.accent), c.portrait, now, now);
  return getCharacter(who, id)!;
}

export function updateCharacter(who: string, id: string, input: CharacterInput): CharacterCard {
  const before = getCharacter(who, id);
  if (!before || before.builtIn) throw new ChatError("That character isn't one of yours.", 404);
  const c = cleanCharacter(input, before);
  db()
    .prepare("UPDATE account_chat_characters SET name = ?, tagline = ?, persona = ?, scenario = ?, greeting = ?, mature = ?, accent = ?, portrait_url = ?, updated_at = ? WHERE id = ? AND account_id = ?")
    .run(c.name, c.tagline, c.persona, c.scenario, c.greeting, c.mature ? 1 : 0, JSON.stringify(c.accent), c.portrait, Date.now(), id, who);
  return getCharacter(who, id)!;
}

/** Delete one of their characters. Its chats stay, and carry on without its card. */
export function deleteCharacter(who: string, id: string): boolean {
  return db().prepare("DELETE FROM account_chat_characters WHERE id = ? AND account_id = ?").run(id, who).changes === 1;
}

// ---------------------------------------------------------------------------
// Chats

interface ThreadRow {
  id: string;
  account_id: string;
  kind: string;
  title: string;
  character_id: string | null;
  tool: string | null;
  play: string | null;
  mature: number;
  summary: string | null;
  summary_upto: number;
  share_token: string | null;
  archived_at?: number | null;
  created_at: number;
  updated_at: number;
}

interface MessageRow {
  id: string;
  thread_id: string;
  account_id: string;
  seq: number;
  role: "user" | "assistant";
  content: string;
  image_url: string | null;
  data_json?: string | null;
  created_at: number;
}

function planOf(raw: string | null | undefined): ChatPlan | undefined {
  if (!raw) return undefined;
  try {
    const d = JSON.parse(raw) as { plan?: ChatPlan };
    return d.plan && Array.isArray(d.plan.jobs) ? d.plan : undefined;
  } catch {
    return undefined;
  }
}

const fromMessageRow = (r: MessageRow): ChatMessage => {
  const plan = planOf(r.data_json);
  return { id: r.id, role: r.role, content: r.content, image: r.image_url, ...(plan && { plan }), createdAt: r.created_at };
};

/** Save a message's plan (its status and the runs it started). */
export function setMessagePlan(who: string, threadId: string, messageId: string, plan: ChatPlan): void {
  db().prepare("UPDATE account_chat_messages SET data_json = ? WHERE id = ? AND thread_id = ? AND account_id = ?").run(JSON.stringify({ plan }), messageId, threadId, who);
}

/** One message of a chat, or null. */
export function getMessage(who: string, threadId: string, messageId: string): ChatMessage | null {
  const r = db().prepare("SELECT * FROM account_chat_messages WHERE id = ? AND thread_id = ? AND account_id = ?").get(messageId, threadId, who) as MessageRow | undefined;
  return r ? fromMessageRow(r) : null;
}

function summaryOf(who: string, r: ThreadRow, last?: string): ChatThreadSummary {
  const c = getCharacter(who, r.character_id);
  return {
    id: r.id,
    kind: isChatKind(r.kind) ? r.kind : "chat",
    title: r.title,
    characterId: r.character_id,
    character: c ? { id: c.id, name: c.name, accent: c.accent, portrait: c.portrait } : null,
    tool: r.tool,
    play: r.play,
    mature: !!r.mature,
    archived: !!r.archived_at,
    // Plain words for the list line: no markdown marks, no "Prompt (image):" labels.
    preview: (last ?? "")
      .replace(/^\s*prompt\s*(\([a-z]+\))?\s*:/gim, "")
      .replace(/[#*_`>]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140),
    updatedAt: r.updated_at,
  };
}

/** Their chats, newest first, with the last message of each. Mature chats only while Mango Chilli is on. */
export function listThreads(who: string, o: { mature: boolean; q?: string; limit?: number; archived?: boolean } = { mature: false }): ChatThreadSummary[] {
  const q = o.q?.trim().toLowerCase();
  const rows = db()
    .prepare(
      `SELECT t.*, (SELECT content FROM account_chat_messages m WHERE m.thread_id = t.id ORDER BY seq DESC LIMIT 1) AS last
       FROM account_chat_threads t WHERE t.account_id = ? AND t.archived_at IS ${o.archived ? "NOT NULL" : "NULL"}${o.mature ? "" : " AND t.mature = 0"}${q ? " AND instr(lower(t.title), ?) > 0" : ""}
       ORDER BY t.updated_at DESC LIMIT ?`,
    )
    .all(...[who, ...(q ? [q] : []), Math.min(o.limit ?? 200, CHAT_LIMITS.threads)]) as (ThreadRow & { last: string | null })[];
  return rows.map((r) => summaryOf(who, r, r.last ?? ""));
}

function threadRow(who: string, id: string): ThreadRow | null {
  return (db().prepare("SELECT * FROM account_chat_threads WHERE id = ? AND account_id = ?").get(id, who) as ThreadRow | undefined) ?? null;
}

export function getThread(who: string, id: string): ChatThreadView | null {
  const r = threadRow(who, id);
  if (!r) return null;
  const messages = (db().prepare("SELECT * FROM account_chat_messages WHERE thread_id = ? AND account_id = ? ORDER BY seq").all(id, who) as MessageRow[]).map(fromMessageRow);
  const ids = [...new Set(messages.flatMap((m) => m.plan?.ids ?? []))];
  // Only the person's own runs: an account's carry its id, the owner's none.
  const generations = ids.flatMap((g) => {
    const owner = generationAccount(g);
    const mine = who === "owner" ? owner === null : owner === who;
    const gen = mine ? getGeneration(g) : null;
    return gen ? [gen] : [];
  });
  return { ...summaryOf(who, r, messages.at(-1)?.content), messages, characterCard: getCharacter(who, r.character_id), shareToken: r.share_token, generations };
}

/** What a reply needs that the browser doesn't: the summary and how far it reaches. */
export function threadMemory(who: string, id: string): { summary: string | null; upto: number } | null {
  const r = threadRow(who, id);
  return r ? { summary: r.summary, upto: r.summary_upto } : null;
}

export interface NewThread {
  kind: ChatKind;
  characterId?: string | null;
  tool?: string | null;
  play?: string | null;
  mature: boolean;
  title?: string | null;
}

export function createThread(who: string, t: NewThread): ChatThreadView {
  const n = (db().prepare("SELECT COUNT(*) AS n FROM account_chat_threads WHERE account_id = ?").get(who) as { n: number }).n;
  if (n >= CHAT_LIMITS.threads) throw new ChatError(`You have ${CHAT_LIMITS.threads} chats, the most there can be. Delete some old ones to start another.`, 409);
  const character = t.kind === "character" ? getCharacter(who, t.characterId) : null;
  if (t.kind === "character" && !character) throw new ChatError("Pick a character to chat with.", 404);
  if (character?.mature && !t.mature) throw new ChatError("Turn on Mango Chilli mode to chat with this character.", 403, "mature-off");
  const tool = t.kind === "write" ? (writeTool(t.tool)?.id ?? null) : null;
  const play = t.kind === "play" ? (workshopFormat(t.play)?.id ?? null) : null;
  const id = newId("ct");
  const now = Date.now();
  const title = clip(t.title, CHAT_LIMITS.titleChars) || (character ? character.name : tool ? writeTool(tool)!.name : play ? playFormat(play)!.name : "New chat");
  const d = db();
  d.transaction(() => {
    d.prepare("INSERT INTO account_chat_threads (id, account_id, kind, title, character_id, tool, play, mature, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      id,
      who,
      t.kind,
      title,
      character?.id ?? null,
      tool,
      play,
      // A chat started while Mango Chilli is on with a mature character stays out of the list when it's off.
      character?.mature ? 1 : 0,
      now,
      now,
    );
    if (character) d.prepare("INSERT INTO account_chat_messages (id, thread_id, account_id, seq, role, content, created_at) VALUES (?, ?, ?, 1, 'assistant', ?, ?)").run(newId("cm"), id, who, character.greeting, now);
  })();
  return getThread(who, id)!;
}

export function addMessage(who: string, threadId: string, role: "user" | "assistant", content: string, image: string | null = null, plan?: ChatPlan): ChatMessage {
  const d = db();
  return d.transaction(() => {
    const r = threadRow(who, threadId);
    if (!r) throw new ChatError("That chat is gone.", 404);
    const last = d.prepare("SELECT MAX(seq) AS s, COUNT(*) AS n FROM account_chat_messages WHERE thread_id = ?").get(threadId) as { s: number | null; n: number };
    if (last.n >= CHAT_LIMITS.messagesPerThread) throw new ChatError("This chat is as long as a chat can be. Start a new one to keep going.", 409, "too-long");
    const now = Date.now();
    const data = plan ? JSON.stringify({ plan }) : null;
    const row: MessageRow = { id: newId("cm"), thread_id: threadId, account_id: who, seq: (last.s ?? 0) + 1, role, content, image_url: image, data_json: data, created_at: now };
    d.prepare("INSERT INTO account_chat_messages (id, thread_id, account_id, seq, role, content, image_url, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      row.id,
      row.thread_id,
      who,
      row.seq,
      role,
      content,
      image,
      data,
      now,
    );
    // The first thing the person says names an open chat.
    const title = role === "user" && r.title === "New chat" ? titleFrom(content) : r.title;
    d.prepare("UPDATE account_chat_threads SET updated_at = ?, title = ? WHERE id = ?").run(now, title, threadId);
    return fromMessageRow(row);
  })();
}

/** The turns of a chat, oldest first (for the model). */
export function threadTurns(who: string, threadId: string): (ChatMessage & { seq: number })[] {
  return (db().prepare("SELECT * FROM account_chat_messages WHERE thread_id = ? AND account_id = ? ORDER BY seq").all(threadId, who) as MessageRow[]).map((r) => ({ ...fromMessageRow(r), seq: r.seq }));
}

/** Take back the last reply (Try again), so the turn before it is answered again. True when there was one. */
export function dropLastReply(who: string, threadId: string): boolean {
  const last = db().prepare("SELECT id, role, seq FROM account_chat_messages WHERE thread_id = ? AND account_id = ? ORDER BY seq DESC LIMIT 1").get(threadId, who) as
    | { id: string; role: string; seq: number }
    | undefined;
  // A character's greeting is the chat's first line, not a reply to take back.
  if (!last || last.role !== "assistant" || last.seq === 1) return false;
  db().prepare("DELETE FROM account_chat_messages WHERE id = ?").run(last.id);
  return true;
}

/** Change their last message: it and everything after it go, and the new words take its place. */
export function rewindTo(who: string, threadId: string, messageId: string): boolean {
  const m = db().prepare("SELECT seq, role FROM account_chat_messages WHERE id = ? AND thread_id = ? AND account_id = ?").get(messageId, threadId, who) as { seq: number; role: string } | undefined;
  if (!m || m.role !== "user") return false;
  db().prepare("DELETE FROM account_chat_messages WHERE thread_id = ? AND account_id = ? AND seq >= ?").run(threadId, who, m.seq);
  // A summary that covered what's gone is rebuilt later.
  db().prepare("UPDATE account_chat_threads SET summary = CASE WHEN summary_upto >= ? THEN NULL ELSE summary END, summary_upto = CASE WHEN summary_upto >= ? THEN 0 ELSE summary_upto END WHERE id = ?").run(m.seq, m.seq, threadId);
  return true;
}

export function setSummary(who: string, threadId: string, summary: string, upto: number): void {
  db().prepare("UPDATE account_chat_threads SET summary = ?, summary_upto = ? WHERE id = ? AND account_id = ?").run(summary.slice(0, 2000), upto, threadId, who);
}

export function renameThread(who: string, id: string, title: unknown): ChatThreadSummary {
  const t = clip(title, CHAT_LIMITS.titleChars);
  if (!t) throw new ChatError("Give the chat a name.");
  if (db().prepare("UPDATE account_chat_threads SET title = ? WHERE id = ? AND account_id = ?").run(t, id, who).changes !== 1) throw new ChatError("That chat is gone.", 404);
  return getThread(who, id)!;
}

/** Delete a chat, its messages and its share link. */
export function deleteThread(who: string, id: string): boolean {
  const d = db();
  return d.transaction(() => {
    const gone = d.prepare("DELETE FROM account_chat_threads WHERE id = ? AND account_id = ?").run(id, who).changes === 1;
    if (gone) {
      d.prepare("DELETE FROM account_chat_messages WHERE thread_id = ? AND account_id = ?").run(id, who);
      d.prepare("DELETE FROM account_chat_shares WHERE thread_id = ? AND account_id = ?").run(id, who);
    }
    return gone;
  })();
}

// ---------------------------------------------------------------------------
// Settings

interface PrefsRow {
  account_id: string;
  mature_at: number | null;
  engine: string;
  key_sealed: string | null;
  key_last4: string | null;
  key_model: string | null;
  updated_at: number;
}

export interface ChatPrefs {
  mature: boolean;
  engine: ChatEngine;
  key: { last4: string; model: string } | null;
}

/** The model their own key uses when they don't pick one: a strong free model on OpenRouter. */
export const DEFAULT_KEY_MODEL = "google/gemma-4-31b-it:free";

const keyContext = (who: string) => `fuobe:chat-key:v1:${who}:openrouter`;

function prefsRow(who: string): PrefsRow | null {
  return (db().prepare("SELECT * FROM account_chat_prefs WHERE account_id = ?").get(who) as PrefsRow | undefined) ?? null;
}

export function getPrefs(who: string): ChatPrefs {
  const r = prefsRow(who);
  const key = r?.key_sealed && r.key_last4 ? { last4: r.key_last4, model: r.key_model || DEFAULT_KEY_MODEL } : null;
  return { mature: !!r?.mature_at, engine: key && r?.engine === "key" ? "key" : "site", key };
}

function upsertPrefs(who: string, set: Partial<Omit<PrefsRow, "account_id" | "updated_at">>): void {
  const before = prefsRow(who);
  const next = { mature_at: null, engine: "site", key_sealed: null, key_last4: null, key_model: null, ...before, ...set };
  db()
    .prepare(
      `INSERT INTO account_chat_prefs (account_id, mature_at, engine, key_sealed, key_last4, key_model, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET mature_at = excluded.mature_at, engine = excluded.engine, key_sealed = excluded.key_sealed, key_last4 = excluded.key_last4, key_model = excluded.key_model, updated_at = excluded.updated_at`,
    )
    .run(who, next.mature_at, next.engine, next.key_sealed, next.key_last4, next.key_model, Date.now());
}

/** Mango Chilli mode on (the person said they're 18 or older) or off. */
export function setMature(who: string, on: boolean): ChatPrefs {
  upsertPrefs(who, { mature_at: on ? Date.now() : null });
  return getPrefs(who);
}

export function setEngine(who: string, engine: ChatEngine): ChatPrefs {
  if (engine === "key" && !getPrefs(who).key) throw new ChatError("Add your OpenRouter key first.", 409);
  upsertPrefs(who, { engine });
  return getPrefs(who);
}

export function saveChatKey(who: string, key: string, model: string | null): ChatPrefs {
  upsertPrefs(who, { key_sealed: seal(key, keyContext(who)), key_last4: key.slice(-4), key_model: model, engine: "key" });
  return getPrefs(who);
}

export function setKeyModel(who: string, model: string): ChatPrefs {
  if (!getPrefs(who).key) throw new ChatError("Add your OpenRouter key first.", 409);
  upsertPrefs(who, { key_model: model });
  return getPrefs(who);
}

export function removeChatKey(who: string): ChatPrefs {
  upsertPrefs(who, { key_sealed: null, key_last4: null, key_model: null, engine: "site" });
  return getPrefs(who);
}

/** Their key, opened (null: none, or this server can't open it any more). Never sent to the browser. */
export function chatKey(who: string): { key: string; model: string } | null {
  const r = prefsRow(who);
  if (!r?.key_sealed) return null;
  const key = openSealed(r.key_sealed, keyContext(who));
  return key ? { key, model: r.key_model || DEFAULT_KEY_MODEL } : null;
}

// ---------------------------------------------------------------------------
// Shares

interface ShareRow {
  token: string;
  account_id: string;
  thread_id: string;
  mature: number;
  snapshot_json: string;
  portrait_url: string | null;
  views: number;
  created_at: number;
}

export const CHAT_SHARE_TOKEN = /^[A-Za-z0-9_-]{32}$/;

/**
 * Share a chat: a copy of its words as they are now (the last `count` messages, or the chosen ones), at a new public
 * link. Sharing again replaces the copy and the link. Pictures people sent aren't in it; a character's portrait is.
 */
export function shareThread(who: string, threadId: string, o: { messageIds?: string[] | null; count?: number } = {}): { token: string; snapshot: ChatShareSnapshot } {
  const t = getThread(who, threadId);
  if (!t) throw new ChatError("That chat is gone.", 404);
  const chosen = o.messageIds?.length ? t.messages.filter((m) => o.messageIds!.includes(m.id)) : t.messages.slice(-(o.count ?? CHAT_LIMITS.shareMessages));
  const messages = chosen.slice(-CHAT_LIMITS.shareMessages).filter((m) => m.content.trim());
  if (!messages.some((m) => m.role === "assistant")) throw new ChatError("There's nothing to share yet. Share a chat once it has a reply.", 409);
  const c = t.characterCard;
  const snapshot: ChatShareSnapshot = {
    title: t.title,
    kind: t.kind,
    mature: t.mature || !!c?.mature,
    character: c ? { id: c.id, name: c.name, tagline: c.tagline, accent: c.accent, builtIn: c.builtIn, portrait: !!c.portrait } : null,
    label: t.kind === "play" ? (playFormat(t.play)?.name ?? null) : t.kind === "write" ? (writeTool(t.tool)?.name ?? null) : null,
    messages: messages.map((m) => ({ role: m.role, content: m.content.slice(0, CHAT_LIMITS.messageChars) })),
    createdAt: Date.now(),
  };
  const token = crypto.randomBytes(24).toString("base64url");
  const d = db();
  d.transaction(() => {
    d.prepare("DELETE FROM account_chat_shares WHERE thread_id = ? AND account_id = ?").run(threadId, who);
    d.prepare("INSERT INTO account_chat_shares (token, account_id, thread_id, mature, snapshot_json, portrait_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      token,
      who,
      threadId,
      snapshot.mature ? 1 : 0,
      JSON.stringify(snapshot),
      c?.portrait ?? null,
      snapshot.createdAt,
    );
    d.prepare("UPDATE account_chat_threads SET share_token = ? WHERE id = ? AND account_id = ?").run(token, threadId, who);
  })();
  return { token, snapshot };
}

/** Stop sharing a chat: the link stops working at once. */
export function unshareThread(who: string, threadId: string): void {
  const d = db();
  d.transaction(() => {
    d.prepare("DELETE FROM account_chat_shares WHERE thread_id = ? AND account_id = ?").run(threadId, who);
    d.prepare("UPDATE account_chat_threads SET share_token = NULL WHERE id = ? AND account_id = ?").run(threadId, who);
  })();
}

export interface PublicChatShare {
  token: string;
  owner: string;
  snapshot: ChatShareSnapshot;
  portrait: string | null;
  views: number;
}

/** A shared chat by its link's token (anyone may read it), or null. */
export function findChatShare(token: string): PublicChatShare | null {
  if (!CHAT_SHARE_TOKEN.test(token)) return null;
  const r = db().prepare("SELECT * FROM account_chat_shares WHERE token = ?").get(token) as ShareRow | undefined;
  if (!r) return null;
  try {
    return { token: r.token, owner: r.account_id, snapshot: JSON.parse(r.snapshot_json) as ChatShareSnapshot, portrait: r.portrait_url, views: r.views };
  } catch {
    return null;
  }
}

export function countShareView(token: string): void {
  db().prepare("UPDATE account_chat_shares SET views = views + 1 WHERE token = ?").run(token);
}

// ---------------------------------------------------------------------------

/** Everything chat-related of a deleted account (account-sweep.ts purgeAccount). */
export function deleteAccountChat(who: string): void {
  const d = db();
  d.transaction(() => {
    for (const t of ["account_chat_messages", "account_chat_threads", "account_chat_characters", "account_chat_prefs", "account_chat_shares"]) d.prepare(`DELETE FROM ${t} WHERE account_id = ?`).run(who);
  })();
}

/** Archive a chat (it leaves the list, kept under Archived) or bring it back. */
export function setArchived(who: string, id: string, archived: boolean): ChatThreadSummary {
  const r = db().prepare("UPDATE account_chat_threads SET archived_at = ? WHERE id = ? AND account_id = ?").run(archived ? Date.now() : null, id, who);
  if (r.changes !== 1) throw new ChatError("That chat is gone.", 404);
  return getThread(who, id)!;
}
