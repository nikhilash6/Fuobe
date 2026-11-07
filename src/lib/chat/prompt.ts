import { MANGO_CHILLI, playFormat, writeTool, type CharacterCard, type ChatKind } from "./catalog";

/**
 * What Fuobe Chat's model reads: the system prompt for a chat's kind (and character, tool or game), the history that
 * fits, and the "Prompt (image): …" lines an idea ends with, which the chat turns into Make it buttons. Pure functions.
 */

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatSetup {
  kind: ChatKind;
  character?: CharacterCard | null;
  /** A writing tool's id. */
  tool?: string | null;
  /** A Play format's id. */
  play?: string | null;
  /** Mango Chilli mode is on for this chat. */
  mature: boolean;
  /** What happened earlier than the turns sent. */
  summary?: string | null;
  /** The person's first name, when known. */
  name?: string | null;
}

const BASE = `You are Fuobe Chat, the chat inside Fuobe, a creative studio for images, video and music.
Write like a sharp, warm friend who knows their stuff: plain words, short paragraphs, no filler, no preamble, no "As an AI".
Use light markdown only: **bold**, short "- " lists, and "### " headings for ideas or options.
Keep answers as short as the question allows. Ask one short question when you truly need more to go on.`;

const IDEAS = `The person wants ideas. Give 3–6 distinct ideas, each as:
### A short, vivid title
One or two lines on the idea and why it works.
Prompt (image): one rich line describing the shot to make (subject, setting, light, lens, mood).
Use "Prompt (video):" instead for a moving idea (describe the motion and camera move in order), and "Prompt (music):" for a song or track (genre, mood, instruments, tempo).
Every idea ends with exactly one Prompt line.`;

const CHAT_EXTRA = `When an idea for an image, a video or a song comes up, you may end with one line "Prompt (image): …" (or video, or music) so the person can make it in one tap.`;

const CHARACTER_RULES = `Stay in character at all times and write as the character, in the first person, in present tense.
Put actions and scene details in *asterisks*. Keep replies to one to three short paragraphs and leave room for the user to act.
Never write the user's words or decide their actions. Move the story forward with a hook, a choice or a question.
Every character in the story is an adult. No character is a real person.
If the user writes in (( double brackets )), step out of the story briefly and answer as a helpful narrator.`;

const MATURE = `${MANGO_CHILLI.name} is on: the user is an adult who chose mature content. Romance, flirting, sensual scenes, dark themes and strong language are welcome when the story calls for them. Every character stays an adult.`;

const GENERAL = `Keep content suitable for a general audience: romance and danger are fine, explicit content is not.`;

/** The system prompt for a chat. */
export function systemPrompt(s: ChatSetup): string {
  const parts: string[] = [];
  if (s.kind === "character" && s.character) {
    const c = s.character;
    parts.push(`You are ${c.name}. ${c.persona}`);
    if (c.scenario) parts.push(`Where the story starts: ${c.scenario}`);
    parts.push(CHARACTER_RULES);
  } else {
    parts.push(BASE);
    if (s.kind === "ideas") parts.push(IDEAS);
    else if (s.kind === "write") {
      const t = writeTool(s.tool);
      parts.push(
        t
          ? `The person is using the ${t.name} tool. ${t.brief} Give the finished text first, ready to copy, with no lead-in. They may ask for changes after.`
          : `The person wants help writing. Give the finished text first, ready to copy, with no lead-in, then offer one short tweak.`,
      );
    } else if (s.kind === "play") {
      const p = playFormat(s.play);
      if (p) parts.push(p.brief, "Keep it fun, quick and worth sharing. Never be mean about anything the person can't change.");
    } else parts.push(CHAT_EXTRA);
  }
  parts.push(s.mature ? MATURE : GENERAL);
  if (s.name) parts.push(`The person's name is ${s.name}.`);
  if (s.summary) parts.push(`What happened earlier in this chat (older messages aren't shown): ${s.summary}`);
  return parts.join("\n\n");
}

/**
 * The newest turns that fit in `budget` characters, oldest first, starting on a user turn when it can. The last turn
 * always goes, cut to the budget if it must be. `dropped`: how many older turns were left out (a summary covers them).
 */
export function fitHistory(turns: ChatTurn[], budget: number): { turns: ChatTurn[]; dropped: number } {
  const out: ChatTurn[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    const cost = t.content.length + 16;
    if (out.length > 0 && used + cost > budget) break;
    out.unshift(out.length === 0 && cost > budget ? { ...t, content: t.content.slice(-Math.max(200, budget - 16)) } : t);
    used += cost;
  }
  // A history that starts with the assistant reads fine for a character (the greeting), but a lone reply mid-chat
  // with no question before it doesn't: drop it when a user turn follows.
  while (out.length > 1 && out[0].role === "assistant" && out[0] !== turns[0]) out.shift();
  return { turns: out, dropped: turns.length - out.length };
}

/**
 * One text for a model that takes a single message (the free helper before it took chat turns): the history as a
 * transcript, then the ask to write the next reply.
 */
export function transcript(turns: ChatTurn[], speaker = "You"): string {
  const lines = turns.map((t) => `${t.role === "user" ? "User" : speaker}: ${t.content}`);
  return `The conversation so far:\n\n${lines.join("\n\n")}\n\nWrite ${speaker}'s next reply to the user's last message. Write only the reply, without a "${speaker}:" label.`;
}

/** A reply as it should be kept: no reasoning block, no speaker label the model added. */
export function tidyReply(text: string, speaker?: string): string {
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  const label = new RegExp(`^(?:${["You", "Assistant", "Fuobe Chat", speaker].filter(Boolean).map((s) => s!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*:\\s*`, "i");
  t = t.replace(label, "");
  return t.trim();
}

export type MakeStudio = "image" | "video" | "music";

export interface MakeIt {
  studio: MakeStudio;
  prompt: string;
}

const PROMPT_LINE = /^\s*(?:[-*]\s*)?\**\s*prompt\s*(?:\(\s*(image|video|music|song|track|photo|picture|clip)\s*\))?\s*\**\s*:\s*\**\s*(.+?)\s*\**\s*$/i;

const STUDIO_OF: Record<string, MakeStudio> = { image: "image", photo: "image", picture: "image", video: "video", clip: "video", music: "music", song: "music", track: "music" };

export type ReplyPart = { kind: "text"; text: string } | { kind: "make"; make: MakeIt };

/** A reply split into its prose and the Make it prompts in it, in order. */
export function splitMakeIts(text: string): ReplyPart[] {
  const out: ReplyPart[] = [];
  let buf: string[] = [];
  const flush = () => {
    const t = buf.join("\n").trim();
    if (t) out.push({ kind: "text", text: t });
    buf = [];
  };
  for (const line of text.split("\n")) {
    const m = PROMPT_LINE.exec(line);
    if (m && m[2].length >= 8) {
      flush();
      out.push({ kind: "make", make: { studio: STUDIO_OF[(m[1] ?? "image").toLowerCase()] ?? "image", prompt: m[2].replace(/^["“]|["”]$/g, "") } });
    } else buf.push(line);
  }
  flush();
  return out;
}

/** Where Make it opens: the studio with the prompt filled in (src/lib/composer.ts HANDOFF_PARAMS). */
export function makeItHref(m: MakeIt): string {
  const path = m.studio === "video" ? "/video" : m.studio === "music" ? "/audio/music" : "/image";
  return `${path}?prompt=${encodeURIComponent(m.prompt.slice(0, 2000))}`;
}

/** A chat's title from its first message: the first line, cut at a word near 60 characters. */
export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= 60) return line || "New chat";
  const cut = line.slice(0, 60);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > 30 ? cut.slice(0, sp) : cut).replace(/[,.;:!?-]+$/, "")}…`;
}

/** A writing tool's form, as the first message. */
export function toolMessage(toolId: string, values: Record<string, string>, tone?: string | null): string {
  const t = writeTool(toolId);
  if (!t) return Object.values(values).join("\n");
  const lines = t.fields.filter((f) => values[f.id]?.trim()).map((f) => `${f.label}: ${values[f.id].trim()}`);
  if (tone) lines.push(`Tone: ${tone}`);
  return lines.join("\n");
}

/** A Play format's first message. */
export function playMessage(playId: string, input: string): string {
  const p = playFormat(playId);
  if (!p) return input;
  return p.opener.replace("{input}", input.trim());
}

/** The words that ask for a summary of older turns, to keep a long chat coherent. */
export function summaryAsk(previous: string | null | undefined, turns: ChatTurn[], speaker = "Assistant"): { system: string; user: string } {
  return {
    system:
      "You keep notes on a conversation so it can continue later. Write a compact summary in under 140 words: names, facts about the user, preferences, decisions, and for a story the current scene, relationships and open threads. Plain sentences, no headings.",
    user: `${previous ? `Summary so far: ${previous}\n\n` : ""}New messages to fold in:\n\n${turns.map((t) => `${t.role === "user" ? "User" : speaker}: ${t.content}`).join("\n\n")}`,
  };
}
