/**
 * Song lyrics with section tags (nm10-music3): what Audio → Music's lyrics editor writes into params.extra.lyrics and what
 * every model that sings reads. Pure (browser and server).
 *
 * The models read the structure from tags on lines of their own: MiniMax Music 3 ("[intro] [verse] [pre-chorus] [chorus]
 * [post-chorus] [bridge] [instrumental] [solo] [outro]", its card and fal's schema: "text on the same line as a leading tag is
 * dropped"), YuE2 and ACE-Step ([Verse], [Chorus], [Bridge], [Outro]), Mureka and MiniMax Music 2.5 (the same names). Fuobe
 * writes them in title case ("[Pre-Chorus]"), each on its own line, words on the lines below it.
 */

/** The params.extra key the lyrics travel in (the ComfyUI graphs' `lyrics` binding reads it as it is). */
export const LYRICS_PARAM = "lyrics";

/** The section tags the editor offers, in song order. */
export const SECTION_TAGS = ["Intro", "Verse", "Pre-Chorus", "Chorus", "Post-Chorus", "Bridge", "Instrumental", "Solo", "Outro"] as const;

/** The lyrics of an instrumental (MiniMax Music 3 needs some: a run with none asks for this). */
export const INSTRUMENTAL = "[Instrumental]";

export interface LyricsSection {
  /** The tag's name as written in title case ("Verse", "Verse 2", "Chorus - Guitar"), or null for lines before any tag. */
  tag: string | null;
  lines: string[];
}

/** A section tag on its own: "[Verse]", "[verse 2]", "[Pre Chorus]", "[Outro - Final Chord]". */
const TAG = /^\[([^\[\]\n]{1,100})\]/;

/** "pre chorus" / "PRE-CHORUS" → "Pre-Chorus"; a number or a note after the name is kept ("Verse 2", "Intro - Guitar Riff"). */
export function tagName(raw: string): string {
  const t = raw.trim().replace(/\s+/g, " ");
  const known = SECTION_TAGS.find((s) => t.toLowerCase().replace(/[\s_]+/g, "-").startsWith(s.toLowerCase()));
  if (!known) return t.charAt(0).toUpperCase() + t.slice(1);
  const rest = t.slice(known.length).replace(/^[\s_-]*(?=\d)/, " ");
  return `${known}${rest}`;
}

/** The sections of a song's lyrics: each tag with the lines under it (words after a tag on its line move below it). */
export function parseLyrics(text: string): LyricsSection[] {
  const out: LyricsSection[] = [];
  let current: LyricsSection | null = null;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = raw.trim();
    let m = TAG.exec(line);
    while (m) {
      current = { tag: tagName(m[1]), lines: [] };
      out.push(current);
      line = line.slice(m[0].length).trim();
      m = TAG.exec(line);
    }
    if (!line) continue;
    if (!current) {
      current = { tag: null, lines: [] };
      out.push(current);
    }
    current.lines.push(line);
  }
  return out;
}

/**
 * The lyrics as the models read them: one tag per line in title case, its words below it, a blank line between sections,
 * no trailing spaces. Empty when there are no words and no tags.
 */
export function normalizeLyrics(text: string | undefined | null): string {
  if (!text?.trim()) return "";
  return parseLyrics(text)
    .map((s) => [...(s.tag ? [`[${s.tag}]`] : []), ...s.lines].join("\n"))
    .join("\n\n");
}

/** Only instrumental sections (or nothing at all): nothing to sing. */
export function isInstrumental(text: string | undefined | null): boolean {
  const sections = parseLyrics(text ?? "");
  return sections.every((s) => (s.tag ? /^(instrumental|solo|inst|break|interlude)\b/i.test(s.tag) : false) && s.lines.length === 0);
}

/** The lyrics a request carries (params.extra.lyrics), normalized; empty when there are none. */
export function lyricsOf(extra: Record<string, unknown> | undefined): string {
  const v = extra?.[LYRICS_PARAM];
  return typeof v === "string" ? normalizeLyrics(v) : "";
}

/** What is wrong with these lyrics for a model that takes up to `max` characters, in plain words; null when they fit. */
export function lyricsProblem(text: string, max: number | undefined, model = "This model"): string | null {
  const n = normalizeLyrics(text).length;
  if (max && n > max) return `${model} sings up to ${max.toLocaleString("en-US")} characters of lyrics: these are ${n.toLocaleString("en-US")}. Shorten them or drop a verse`;
  return null;
}

/** The prompt with the lyrics after it, for a model that reads both in one text (Lyria 3.5). */
export function promptWithLyrics(prompt: string, lyrics: string): string {
  const words = normalizeLyrics(lyrics);
  if (!words) return prompt;
  const p = prompt.trim().replace(/[.\s]+$/, "");
  return isInstrumental(words) ? `${p}. Instrumental, no vocals.` : `${p}.\n\nLyrics:\n${words}`;
}

/**
 * A tag put in at the cursor on a line of its own, a blank line between it and the words before it, the cursor on the line
 * after it for the words. At the start of a line it goes before that line, else after the line the cursor is on. For the
 * editor's tag chips.
 */
export function insertTag(text: string, at: number, tag: string): { text: string; cursor: number } {
  const pos = Math.max(0, Math.min(text.length, at));
  const lineStart = pos === 0 || text[pos - 1] === "\n";
  const nl = text.indexOf("\n", pos);
  const cut = lineStart ? pos : nl === -1 ? text.length : nl;
  const before = text.slice(0, cut).replace(/\s+$/, "");
  const after = text.slice(cut).replace(/^\s+/, "");
  const lead = before ? `${before}\n\n` : "";
  const block = `[${tagName(tag)}]\n`;
  return { text: `${lead}${block}${after ? `\n${after}` : ""}`, cursor: lead.length + block.length };
}

/** The sections' tags in order, for a one-line summary ("Verse · Chorus · Verse · Chorus · Bridge"). */
export function structureOf(text: string): string[] {
  return parseLyrics(text).flatMap((s) => (s.tag ? [s.tag] : []));
}

/** Seconds as m:ss ("2:00", "4:30"). */
export function songLength(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
