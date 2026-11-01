/**
 * The ⌘K palette's search (pure, so it's testable): a forgiving word match, and the matches grouped
 * by kind, best first. The palette (src/components/command-palette.tsx) renders what this returns.
 */
import { offered, type AccessSummary } from "./model-access";

export type PaletteKind = "page" | "setting" | "skill" | "app" | "motion" | "effect" | "model" | "recent";

export interface PaletteEntry {
  /** Unique in the palette. */
  key: string;
  kind: PaletteKind;
  label: string;
  /** Shown next to the label: a category, a vendor, the group a page is in. */
  hint?: string;
  href: string;
  /** More words that find it, worth less than the label. */
  keywords?: string;
}

/** Group headings, in the order groups take when their best matches tie. */
export const KIND_LABELS: Record<PaletteKind, string> = {
  page: "Go to",
  setting: "Settings",
  skill: "Run a skill",
  app: "Apps",
  motion: "Camera motions",
  effect: "Effects",
  model: "Models",
  recent: "Recent creations",
};
const KIND_ORDER = Object.keys(KIND_LABELS) as PaletteKind[];

/** Pages and settings are where people mostly go: they win close calls against a preset of the same name. */
const KIND_BONUS: Partial<Record<PaletteKind, number>> = { page: 8, setting: 4 };

/** Lower case, no accents, punctuation as spaces ("Lipsync & avatars" → "lipsync avatars"). */
export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.+#]+/g, " ")
    .trim();
}

/**
 * How well one query word matches a (normalized) text, 0 for no match: the whole text (100), its
 * start (80, or 70 when the text's spaces are ignored: "faceswap"), the start of a later word (60),
 * anywhere inside (40), then the word's letters in order (fuzzy, 10–30: more when they start words
 * or follow each other). A one-letter word only matches the start of a word.
 */
export function wordScore(word: string, text: string): number {
  if (!word || !text) return 0;
  if (text === word) return 100;
  if (text.startsWith(word)) return 80;
  if (text.replace(/ /g, "").startsWith(word)) return 70;
  if (text.includes(` ${word}`)) return 60;
  if (word.length < 2) return 0;
  if (text.includes(word)) return 40;
  return fuzzy(word, text);
}

/**
 * The letters of `word` in order in `text`: a typo or an abbreviation ("cinma" finds "cinema", "bg"
 * finds "background"). Two letters must start at the start of a word.
 */
function fuzzy(word: string, text: string): number {
  let at = -1;
  let first = -1;
  let bonus = 0;
  for (const ch of word) {
    const next = text.indexOf(ch, at + 1);
    if (next < 0) return 0;
    if (first < 0) {
      if (word.length < 3 && next > 0 && text[next - 1] !== " ") return 0;
      first = next;
    }
    if (next === at + 1) bonus += 2;
    if (next === 0 || text[next - 1] === " ") bonus += 3;
    at = next;
  }
  // Letters scattered over a long stretch are a weak match.
  const spread = at - first + 1;
  if (spread > word.length * 3) return 0;
  return Math.min(30, 10 + bonus);
}

/**
 * The entry's score for a query (0 = leave it out): every query word must match the label, the
 * keywords or the hint. Label matches count in full, keyword matches at half and hint matches a
 * little less than that (the hint is shared: every row of the Library group has "Library", but
 * only All creations is the library); pages and settings get a small bonus, and a shorter label
 * wins a tie ("Video" before "Video tools").
 */
export function entryScore(query: string, e: PaletteEntry): number {
  const words = normalize(query).split(" ").filter(Boolean);
  if (!words.length) return 0;
  const label = normalize(e.label);
  const keywords = normalize(e.keywords ?? "");
  const hint = normalize(e.hint ?? "");
  let total = 0;
  for (const w of words) {
    const s = Math.max(wordScore(w, label), wordScore(w, keywords) / 2, wordScore(w, hint) * 0.4 - 1);
    if (!s) return 0;
    total += s;
  }
  // The whole query reading as the label's start beats the same words matched one by one.
  const q = words.join(" ");
  if (words.length > 1 && label.startsWith(q)) total += 20;
  return total / words.length + (KIND_BONUS[e.kind] ?? 0) - label.length / 100;
}

export interface PaletteGroup {
  kind: PaletteKind;
  label: string;
  entries: PaletteEntry[];
}

/** How many matches each group shows. */
export const GROUP_LIMIT: Record<PaletteKind, number> = { page: 6, setting: 4, skill: 4, app: 5, motion: 4, effect: 4, model: 5, recent: 5 };

/** Matches far weaker than the best one are noise next to it ("lip" finds Lipsync, not "virality predictor"). */
const KEEP_FROM_BEST = 0.35;
/**
 * Once something has the words themselves in it (a substring or better: 40, less a hair for a long label), letters-in-order
 * guesses (30 at most, plus a page's 8) are noise: "tts" finds IndexTTS-2, not Settings or Tentacle Horror.
 */
const KEEP_FROM_REAL_MATCH = 0.6;
const REAL_MATCH = 39;

/**
 * The matches for a query, grouped by kind: each group best first and cut to its limit, the groups
 * ordered by their best match (KIND_ORDER on a tie). Matches much weaker than the best are left out,
 * so letters-in-order guesses only show when nothing matches better. An empty query matches
 * nothing; the palette shows its own starting list then.
 */
export function rankPalette(entries: PaletteEntry[], query: string, limits: Record<PaletteKind, number> = GROUP_LIMIT): PaletteGroup[] {
  if (!normalize(query)) return [];
  const scored = entries.map((e) => ({ e, s: entryScore(query, e) })).filter((x) => x.s > 0);
  const top = Math.max(0, ...scored.map((x) => x.s));
  const floor = top * (top >= REAL_MATCH ? KEEP_FROM_REAL_MATCH : KEEP_FROM_BEST);
  const byKind = new Map<PaletteKind, { e: PaletteEntry; s: number }[]>();
  for (const x of scored) {
    if (x.s < floor) continue;
    const list = byKind.get(x.e.kind) ?? [];
    list.push(x);
    byKind.set(x.e.kind, list);
  }
  return [...byKind.entries()]
    .map(([kind, list]) => {
      list.sort((a, b) => b.s - a.s);
      return { kind, label: KIND_LABELS[kind], best: list[0].s, entries: list.slice(0, limits[kind]).map((x) => x.e) };
    })
    .sort((a, b) => b.best - a.best || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
    .map(({ kind, label, entries }) => ({ kind, label, entries }));
}

/** The slim catalog the palette loads on first open (GET /api/search-index). */
export interface PaletteIndex {
  apps: PalettePreset[];
  motions: PalettePreset[];
  effects: PalettePreset[];
  models: PaletteModel[];
}

export interface PalettePreset {
  id: string;
  name: string;
  category: string;
  /** Has a cloud / an open-source route. */
  cloud: boolean;
  open: boolean;
}

export interface PaletteModel {
  id: string;
  name: string;
  vendor: string;
  engine: "cloud" | "open";
  /** Every engine it runs on, when that's both (a Fuobe Original). */
  engines?: ("cloud" | "open")[];
  /** The studio that runs it (with ?model=), or the Models page. */
  href: string;
  /** What it does ("Text to image, Edit"). */
  ops: string;
}

/**
 * The palette's entries from the index, for one engine mode: with one engine locked in Settings, a
 * preset needs a route on that engine and a model must be on it, as in the galleries and pickers.
 */
export function indexEntries(index: PaletteIndex, mode: "both" | "cloud" | "open", access?: AccessSummary): PaletteEntry[] {
  const runs = (p: PalettePreset) => mode === "both" || p[mode];
  const presets = (list: PalettePreset[], kind: "app" | "motion" | "effect", href: (id: string) => string) =>
    list.filter(runs).map((p): PaletteEntry => ({ key: `${kind}:${p.id}`, kind, label: p.name, hint: p.category, href: href(p.id) }));
  return [
    ...presets(index.apps, "app", (id) => `/apps/${id}`),
    ...presets(index.motions, "motion", (id) => `/video?preset=${id}`),
    ...presets(index.effects, "effect", (id) => `/video?preset=${id}`),
    ...index.models
      // Settings → Models & licences: a model switched off isn't offered here either (its switch is on that page,
      // which has its own entry).
      .filter((m) => (mode === "both" || (m.engines ?? [m.engine]).includes(mode)) && offered(access, m.id, mode === "both" ? undefined : mode))
      .map((m): PaletteEntry => {
        const both = (m.engines?.length ?? 0) > 1;
        return {
          key: `model:${m.id}`,
          kind: "model",
          label: m.name,
          // With both engines on, a model on each (TRELLIS.2, Join clips) would show twice under one name; a Fuobe Original is one model on both.
          hint: mode === "both" && both ? `${m.vendor} · Open source + cloud` : mode === "both" && m.engine === "open" ? `${m.vendor} · Open source` : m.vendor,
          href: m.href,
          keywords: `${m.ops} ${both ? "open source free cloud" : m.engine === "open" ? "open source free" : "cloud"}`,
        };
      }),
  ];
}

/** Skills that run by themselves (a recipe), switched on: "Run Lamp turntable…", opening its Run form. */
export function skillEntries(skills: { name: string; title: string; description: string; recipe?: boolean; enabled: boolean }[]): PaletteEntry[] {
  return skills
    .filter((s) => s.recipe && s.enabled)
    .map((s) => ({ key: `skill:${s.name}`, kind: "skill" as const, label: `Run ${s.title}…`, hint: "Skill", href: `/assist/skills?run=${s.name}`, keywords: `${s.name} ${s.description} skill run` }));
}
