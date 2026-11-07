/**
 * The language a song's lyrics are written in: the script of the person's description says it, so a small model that
 * answers in English by habit is told plainly (Hindi words in Devanagari get Hindi in Devanagari).
 */

/** Scripts by Unicode block, with the language most descriptions in them are written in. */
const SCRIPTS: { script: string; language: string | null; range: RegExp }[] = [
  { script: "Devanagari", language: null, range: /[ऀ-ॿ]/g },
  { script: "Gujarati", language: "Gujarati", range: /[઀-૿]/g },
  { script: "Bengali", language: null, range: /[ঀ-৿]/g },
  { script: "Gurmukhi", language: "Punjabi", range: /[਀-੿]/g },
  { script: "Odia", language: "Odia", range: /[଀-୿]/g },
  { script: "Tamil", language: "Tamil", range: /[஀-௿]/g },
  { script: "Telugu", language: "Telugu", range: /[ఀ-౿]/g },
  { script: "Kannada", language: "Kannada", range: /[ಀ-೿]/g },
  { script: "Malayalam", language: "Malayalam", range: /[ഀ-ൿ]/g },
  { script: "Sinhala", language: "Sinhala", range: /[඀-෿]/g },
  { script: "Thai", language: "Thai", range: /[฀-๿]/g },
  { script: "Arabic", language: null, range: /[؀-ۿݐ-ݿ]/g },
  { script: "Hebrew", language: "Hebrew", range: /[֐-׿]/g },
  { script: "Cyrillic", language: null, range: /[Ѐ-ӿ]/g },
  { script: "Greek", language: "Greek", range: /[Ͱ-Ͽ]/g },
  { script: "Georgian", language: "Georgian", range: /[Ⴀ-ჿ]/g },
  { script: "Armenian", language: "Armenian", range: /[԰-֏]/g },
  { script: "Hangul", language: "Korean", range: /[가-힯ᄀ-ᇿ]/g },
  { script: "Japanese kana", language: "Japanese", range: /[぀-ヿ]/g },
  { script: "Chinese characters", language: null, range: /[一-鿿]/g },
];

/** Devanagari words that say Marathi or Nepali rather than Hindi. */
const NOT_HINDI = /(आहे|आणि|मराठी|नेपाली)/;

/**
 * One sentence for the lyrics request: write in the description's language and script, when its letters are mostly in
 * one non-Latin script. Null for a description in Latin letters (the model keeps its language from the words).
 */
export function lyricsLanguageHint(idea: string): string | null {
  const letters = (idea.match(/\p{L}/gu) ?? []).length;
  if (!letters) return null;
  let best: { script: string; language: string | null; n: number } | null = null;
  for (const s of SCRIPTS) {
    const n = (idea.match(s.range) ?? []).length;
    if (n && (!best || n > best.n)) best = { script: s.script, language: s.language, n };
  }
  // Japanese kana outnumber nothing when kanji are many: kana anywhere means Japanese.
  if (best?.script === "Chinese characters" && /[぀-ヿ]/.test(idea)) best = { script: "Japanese kana", language: "Japanese", n: best.n };
  if (!best || best.n < letters * 0.3) return null;
  const language = best.script === "Devanagari" ? (NOT_HINDI.test(idea) ? null : "Hindi") : best.language;
  const script = best.script === "Japanese kana" ? "Japanese script" : `${best.script} script`;
  const what = language ? `${language}, in ${script}` : `the description's language, in ${script}`;
  return `Write the lyrics in ${what}, not in English, unless the description asks for another language. Keep the section tags in English.`;
}
