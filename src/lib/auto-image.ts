import type { AutoPick, AutoWhy, Operation } from "./catalog/types";

/*
 * Auto: the open image choice that picks the model for each run (the Image studio's default on the open engine). It is
 * a choice, not a model of its own: the server plans the run on the model it picks (src/server/generations.ts autoRouted)
 * and keeps the pick with the run (GenerationRequest.auto), so the run, its tile and the Library say which model made it.
 * Pure and browser-safe: the composer, the Settings page and the server read the same rules.
 */

/** Auto's id in the catalog (src/lib/catalog/models.ts). */
export const AUTO_IMAGE = "oss-auto-image";
export const AUTO_NAME = "Auto";

/** Every plain prompt, an account's, a guest's or the owner's: natural skin, light and faces. */
export const AUTO_PHOTO_MODEL = "oss-krea2-realism";
/** Lettering (posters, logos, signs, words in quotes): MOSS-Image follows the words and draws them in place. */
export const AUTO_TEXT_MODEL = "oss-moss-image";
/**
 * Auto's text-to-image models, in order for a plain prompt; lettering takes them the other way round. When the first
 * is switched off or can't run here, the run is planned on the other; when it fails, the other makes the same run
 * (src/server/generations.ts autoFails), each model at most once.
 */
export const AUTO_T2I_MODELS = [AUTO_PHOTO_MODEL, AUTO_TEXT_MODEL] as const;
/**
 * Ideogram 4 picked by name (Auto never plans it): when it declines a run (its grey "blocked" card for every picture),
 * the same run is made by these, in order, each only if the one before fails.
 */
export const DECLINED_FALLBACKS = ["oss-krea2-realism", "oss-fibo2-dev", "oss-moss-image"] as const;
/**
 * A run with a picture to work from goes to the studio's own default for its operation (the Edit and Inpaint studios'
 * Qwen-Image 2.1). FIBO 2 Dev, which also edits, is next where Qwen-Image 2.1 is switched off.
 */
export const AUTO_EDIT_MODELS: Readonly<Partial<Record<Operation, readonly string[]>>> = {
  edit: ["oss-qwen-image-21", "oss-fibo2-dev"],
  inpaint: ["oss-qwen-image-21"],
  outpaint: ["oss-qwen-image-21"],
};

/** The models Auto may plan an operation on: text to image on AUTO_T2I_MODELS, the others on AUTO_EDIT_MODELS. */
export const autoModelsFor = (op: Operation): readonly string[] => (op === "t2i" ? AUTO_T2I_MODELS : (AUTO_EDIT_MODELS[op] ?? []));

/** Every model Auto may plan a run on. */
export const AUTO_MODELS: ReadonlySet<string> = new Set([...AUTO_T2I_MODELS, ...Object.values(AUTO_EDIT_MODELS).flat()]);

/**
 * Prompts about lettering, which go to MOSS-Image first. Words in quotes count too ("a sign that says “OPEN”").
 */
const TEXT_WORDS =
  /\b(text|texts|typography|typographic|typeface|font|fonts|lettering|letters|logo|logos|logotype|wordmark|monogram|poster|posters|signage|signs?|billboard|banner|headline|caption|calligraphy|graffiti|label|labels|menu|book cover|album cover|magazine cover|infographic|says|that reads)\b/i;
const QUOTED = /["“”«»][^"“”«»\n]{2,80}["“”«»]/;

/**
 * The setting's list (Settings → Auto image model): prompts Auto starts on Krea 2 Realism, the model every plain prompt
 * starts on too, and whose run details name the line they matched. Lettering still goes to MOSS-Image first. One per
 * line: a word or phrase matches as a whole word (a space or a hyphen matches either), any other line is a regular
 * expression, and a line that starts with "#" is a note; case never matters.
 */
export const DEFAULT_AUTO_PATTERNS: readonly string[] = [
  "# Animals or creatures dressed as people",
  String.raw`\b(cats?|kittens?|dogs?|pupp(y|ies)|fox(es)?|bunn(y|ies)|rabbits?|bears?|wol(f|ves)|lions?|tigers?|pandas?|owls?|monkeys?|horses?|deer|mice|mouse|creatures?|animals?)\b.{0,80}\b(gowns?|dress(es)?|suits?|tuxedos?|lingerie|bikinis?|heels|corsets?|skirts?|blouses?)\b`,
  String.raw`\b(gowns?|dress(es)?|suits?|tuxedos?|lingerie|bikinis?|heels|corsets?)\b.{0,80}\b(cats?|kittens?|dogs?|pupp(y|ies)|fox(es)?|bunn(y|ies)|rabbits?|bears?|wol(f|ves)|lions?|tigers?|pandas?|owls?|monkeys?|creatures?|animals?)\b`,
  String.raw`\b(cats?|kittens?|dogs?|pupp(y|ies)|fox(es)?|bunn(y|ies)|rabbits?|bears?|wol(f|ves)|lions?|tigers?|pandas?|owls?|monkeys?|creatures?|animals?)\b.{0,160}\b(her|his) (hair|body|legs|figure|curves|skin)\b`,
  "# Swimwear, underwear and sheer clothes",
  "swimwear",
  "swimsuit",
  "bikini",
  "lingerie",
  "underwear",
  "bodysuit",
  "sheer",
  "see-through",
  "topless",
  "nude-tone",
];

/** The setting's limits: lines, and characters a line. */
export const AUTO_PATTERNS_MAX = { lines: 200, chars: 300 };

/** A line that is a word or phrase (matched as a whole word), not a regular expression. */
const PLAIN = /^[\p{L}\p{N}][\p{L}\p{N}' -]*$/u;

/** One line of the setting as a pattern (case-insensitive). Null: a blank line or a comment ("# …"). Throws on a bad one. */
function lineRegExp(line: string): RegExp | null {
  const s = line.trim();
  if (!s || s.startsWith("#")) return null;
  // A space or a hyphen matches either ("see-through", "see through"); an apostrophe either kind.
  if (PLAIN.test(s)) return new RegExp(`(?<![\\p{L}\\p{N}])${s.split(/[-\s]+/).join("[-\\s]+").replace(/'/g, "['’]")}(?![\\p{L}\\p{N}])`, "iu");
  return new RegExp(s, "i");
}

/**
 * Why the setting's text can't be saved, one line per problem (empty: it can). Each line must be a pattern that can be
 * read, can't match empty words (it would match every prompt), and stays within the limits.
 */
export function autoPatternsProblems(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const problems: string[] = [];
  if (lines.length > AUTO_PATTERNS_MAX.lines) problems.push(`Keep it to ${AUTO_PATTERNS_MAX.lines} lines`);
  lines.forEach((line, i) => {
    if (line.length > AUTO_PATTERNS_MAX.chars) return void problems.push(`Line ${i + 1} is over ${AUTO_PATTERNS_MAX.chars} characters`);
    let re: RegExp | null;
    try {
      re = lineRegExp(line);
    } catch {
      return void problems.push(`Line ${i + 1} isn't a pattern that can be read: ${line.trim().slice(0, 60)}`);
    }
    if (re && re.test("")) problems.push(`Line ${i + 1} matches every prompt: ${line.trim().slice(0, 60)}`);
  });
  return problems;
}

/** The setting's text as patterns (lines that can't be read are left out, as saving refuses them). */
export function autoPatterns(text: string): { line: string; re: RegExp }[] {
  return text.split(/\r?\n/).flatMap((line) => {
    try {
      const re = lineRegExp(line);
      return re && !re.test("") ? [{ line: line.trim(), re }] : [];
    } catch {
      return [];
    }
  });
}

/** The first line of the setting a prompt matches, or undefined. */
export function matchedPattern(prompt: string, patterns: readonly { line: string; re: RegExp }[]): string | undefined {
  return patterns.find((p) => p.re.test(prompt))?.line;
}

/** The words TEXT_WORDS knows, plus watermarks, for the "no …" lists below. */
const TEXT_NOUN = String.raw`(?:text|texts|typography|typeface|fonts?|lettering|letters|logos?|logotypes?|wordmarks?|monograms?|signage|signs?|banners?|headlines?|captions?|calligraphy|graffiti|labels?|watermarks?|words|writing)`;
/**
 * A prompt that only rules lettering out ("no text, no watermark", "without any logos or captions", "text-free"): these
 * words don't ask for it, so they are left out before TEXT_WORDS reads the prompt.
 */
const NO_TEXT = new RegExp(
  String.raw`\b(?:no|not any|without(?: any)?|free of|zero|avoid(?:ing)?|minus)\s+(?:(?:any|visible|readable|legible|added|extra|stray|on-?screen|overlaid|overlay)\s+)*${TEXT_NOUN}(?:\s*(?:,|\/|or|and|nor)\s*(?:(?:no|any)\s+)?${TEXT_NOUN})*\b|\b${TEXT_NOUN}-?(?:free|less)\b`,
  "gi",
);

/** Is this prompt about lettering (posters, logos, signs, typography, words in quotes)? Lettering it rules out doesn't count. */
export const asksForText = (prompt: string): boolean => {
  const asked = prompt.replace(NO_TEXT, " ");
  return TEXT_WORDS.test(asked) || QUOTED.test(asked);
};

export interface AutoAsk {
  prompt?: string;
  op?: Operation;
  /** Pictures the run works from (its references). */
  images?: number;
}

/**
 * The models Auto would plan a run on, best first, and why: a picture to work from → the studio's edit model for its
 * operation; lettering → MOSS-Image, then Krea 2 Realism; a prompt the setting's patterns match, and anything else →
 * Krea 2 Realism, then MOSS-Image. The same for the owner, an account and a guest. The server plans the first one that
 * is switched on and runs the operation (src/server/generations.ts autoRouted), and the next one makes the run when it
 * fails (autoNext).
 */
export function autoCandidates(ask: AutoAsk, patterns: readonly { line: string; re: RegExp }[]): { models: string[]; why: AutoWhy; pattern?: string } {
  const op = ask.op && ask.op !== "t2i" ? ask.op : (ask.images ?? 0) > 0 ? "edit" : "t2i";
  if (op !== "t2i") return { models: [...(AUTO_EDIT_MODELS[op] ?? [])], why: "edit" };
  const words = ask.prompt ?? "";
  if (asksForText(words)) return { models: [AUTO_TEXT_MODEL, AUTO_PHOTO_MODEL], why: "text" };
  const pattern = matchedPattern(words, patterns);
  if (pattern) return { models: [...AUTO_T2I_MODELS], why: "trigger", pattern };
  return { models: [...AUTO_T2I_MODELS], why: "plain" };
}

/** Auto's models left for a run, in its order, after the ones that tried it (each model makes a run at most once). */
export const autoNext = (models: readonly string[], tried: readonly string[]): string[] => models.filter((m) => !tried.includes(m));

/** The model that makes a run Ideogram 4 (picked by name) declined after `after` failed too (undefined: none left). */
export function nextDeclinedFallback(after: string | undefined): string | undefined {
  const i = after ? (DECLINED_FALLBACKS as readonly string[]).indexOf(after) : -1;
  return DECLINED_FALLBACKS[i + 1];
}

/** Said after the model that made an Auto run when the model before it couldn't make it. */
export const AUTO_NEXT = "Auto's next model";

/**
 * The line under an Auto run (the feed card, the run details, the Library, Accounts' runs): "Auto · made with Krea 2
 * Realism", and "· Auto's next model" when the model before it couldn't make it (or, on an older run, Ideogram 4
 * declined it). Null for any other run.
 */
export function autoLine(g: { status: string; modelName?: string; modelId: string; request: { modelId: string; auto?: AutoPick } }): string | null {
  if (g.request.modelId !== AUTO_IMAGE || !g.request.auto) return null;
  const name = g.modelName ?? g.modelId;
  const made = g.status === "succeeded" ? `made with ${name}` : g.status === "failed" || g.status === "canceled" ? `tried ${name}` : `making it with ${name}`;
  const next = g.request.auto.why === "fallback" || g.request.auto.why === "declined";
  return [AUTO_NAME, made, next ? AUTO_NEXT : null].filter(Boolean).join(" · ");
}
