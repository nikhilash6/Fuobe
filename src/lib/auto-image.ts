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

/** Words, posters, logos and everything without a reason to go elsewhere. */
export const AUTO_TEXT_MODEL = "oss-ideogram-4";
/**
 * When Ideogram 4 declines a run (its grey "blocked" card for every picture), the same run is made by these, in order,
 * each only if the one before fails. A prompt that matches a pattern of the setting starts with the first of them.
 */
export const AUTO_FALLBACKS = ["oss-krea2-realism", "oss-fibo2-dev", "oss-moss-image"] as const;
/**
 * A run with a picture to work from goes to the studio's own default for its operation (the Edit and Inpaint studios'
 * Qwen-Image 2.1), never to Ideogram 4. FIBO 2 Dev, which also edits, is next where Qwen-Image 2.1 is switched off.
 */
export const AUTO_EDIT_MODELS: Readonly<Partial<Record<Operation, readonly string[]>>> = {
  edit: ["oss-qwen-image-21", "oss-fibo2-dev"],
  inpaint: ["oss-qwen-image-21"],
  outpaint: ["oss-qwen-image-21"],
};

/** Every model Auto may plan a run on (a stored pick names one of these, or it is planned again). */
export const AUTO_MODELS: ReadonlySet<string> = new Set([AUTO_TEXT_MODEL, ...AUTO_FALLBACKS, ...Object.values(AUTO_EDIT_MODELS).flat()]);

/**
 * Prompts about lettering: what Ideogram 4 is made for. Words in quotes count too ("a sign that says “OPEN”").
 */
const TEXT_WORDS =
  /\b(text|texts|typography|typographic|typeface|font|fonts|lettering|letters|logo|logos|logotype|wordmark|monogram|poster|posters|signage|signs?|billboard|banner|headline|caption|calligraphy|graffiti|label|labels|menu|book cover|album cover|magazine cover|infographic|says|that reads)\b/i;
const QUOTED = /["“”«»][^"“”«»\n]{2,80}["“”«»]/;

/**
 * The setting's first list (Settings → Auto image model): prompts that Ideogram 4's own safety filter often answers with
 * its grey card. Auto sends them to Krea 2 Realism straight away. One per line: a word or phrase matches as a whole word
 * (a space or a hyphen matches either), any other line is a regular expression, and a line that starts with "#" is a
 * note; case never matters.
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
 * read, can't match empty words (it would send every prompt to Krea 2 Realism), and stays within the limits.
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

/** Is this prompt about lettering (posters, logos, signs, typography, words in quotes)? */
export const asksForText = (prompt: string): boolean => TEXT_WORDS.test(prompt) || QUOTED.test(prompt);

export interface AutoAsk {
  prompt?: string;
  op?: Operation;
  /** Pictures the run works from (its references). */
  images?: number;
}

/**
 * The models Auto would plan a run on, best first, and why: a picture to work from → the studio's edit model for its
 * operation; lettering → Ideogram 4; a prompt the setting's patterns match → Krea 2 Realism (then FIBO 2 Dev and
 * MOSS-Image, then Ideogram 4); anything else → Ideogram 4 (then the others). The server plans the first one that is
 * switched on and runs the operation (src/server/generations.ts autoRouted).
 */
export function autoCandidates(ask: AutoAsk, patterns: readonly { line: string; re: RegExp }[]): { models: string[]; why: AutoWhy; pattern?: string } {
  const op = ask.op && ask.op !== "t2i" ? ask.op : (ask.images ?? 0) > 0 ? "edit" : "t2i";
  if (op !== "t2i") return { models: [...(AUTO_EDIT_MODELS[op] ?? [])], why: "edit" };
  const words = ask.prompt ?? "";
  if (asksForText(words)) return { models: [AUTO_TEXT_MODEL, ...AUTO_FALLBACKS], why: "text" };
  const pattern = matchedPattern(words, patterns);
  if (pattern) return { models: [...AUTO_FALLBACKS, AUTO_TEXT_MODEL], why: "trigger", pattern };
  return { models: [AUTO_TEXT_MODEL, ...AUTO_FALLBACKS], why: "plain" };
}

/** The model that makes an Auto run after `after` failed on one Ideogram 4 declined (undefined: none left). */
export function nextAutoFallback(after: string | undefined): string | undefined {
  const i = after ? (AUTO_FALLBACKS as readonly string[]).indexOf(after) : -1;
  return AUTO_FALLBACKS[i + 1];
}

/** "Ideogram 4 declined this one", after the model that made a run in its place. */
export const AUTO_DECLINED = "Ideogram 4 declined this one";

/**
 * The line under an Auto run (the feed card, the run details, the Library, Accounts' runs): "Auto · made with Ideogram 4",
 * and "· Ideogram 4 declined this one" when another model made it in its place. Null for any other run.
 */
export function autoLine(g: { status: string; modelName?: string; modelId: string; request: { modelId: string; auto?: AutoPick } }): string | null {
  if (g.request.modelId !== AUTO_IMAGE || !g.request.auto) return null;
  const name = g.modelName ?? g.modelId;
  const made = g.status === "succeeded" ? `made with ${name}` : g.status === "failed" || g.status === "canceled" ? `tried ${name}` : `making it with ${name}`;
  return [AUTO_NAME, made, g.request.auto.why === "declined" ? AUTO_DECLINED : null].filter(Boolean).join(" · ");
}
