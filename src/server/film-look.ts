import "server-only";
import { applyFilmLook, filmLook, hasColourWords, scrubColourWords, type AppliedFilmLook } from "@/lib/film-looks";
import { llmText } from "./enhance";

/**
 * A MOSS-Image film look applied to a run's words just before it is sent (src/lib/film-looks.ts has the looks): the
 * sandwich and the negatives. A monochrome look first takes the colour words out of the scene: an LLM rewrites it (the
 * free helper's Enhance slot for an account or a visitor, the install's own AI helper otherwise), keeping everything
 * else; the word list cleans what it leaves, and is the whole pass when no LLM answers.
 */

const MONO_SYSTEM = `You prepare an image prompt for a black-and-white photograph. Rewrite the scene so that it names no colour at all.
Rules:
- Take out every colour word and colour phrase: hues, shades, tints, "-coloured" words, colourful, vibrant colours, colour palettes and hex codes.
- Hair and eyes keep their tone: fair or dark hair, light or dark eyes.
- Black, white and grey may stay. Gold or silver jewellery becomes metal jewellery.
- Keep everything else exactly as written: the people, their pose and where they look, the clothes and their materials, the place, the light, the framing and any quoted text.
- Describe only what is there. Never add words about colour or its absence, and never add a style or film look.
- Answer with the rewritten scene only: plain sentences, no quotes, no preamble.`;

/** Recent scrubs, so the jobs of one run (and a quick rerun) ask the LLM once. */
const MAX_CACHED = 50;
declare global {
  var __fuobeMonoScenes: Map<string, string> | undefined;
}

/** A scene without colour words: the LLM's rewrite, checked and cleaned by the word list, else the word list alone. */
export async function monoScene(scene: string, helper: { guestKey?: string; waitMs?: number } = {}): Promise<string> {
  const words = scene.trim();
  if (!words || !hasColourWords(words)) return words;
  const cache = (globalThis.__fuobeMonoScenes ??= new Map());
  const known = cache.get(words);
  if (known) return known;
  const fallback = scrubColourWords(words);
  const answer = await llmText(MONO_SYSTEM, words, { task: "enhance", waitMs: helper.waitMs ?? 20_000, guestKey: helper.guestKey }).catch(() => null);
  const rewritten = answer ? scrubColourWords(answer.trim().replace(/^["“]|["”]$/g, "")) : "";
  // An answer that lost much of the scene (or grew a new one) isn't trusted: the word list's version goes instead.
  const kept = rewritten && rewritten.length >= fallback.length * 0.6 && rewritten.length <= words.length * 1.4 ? rewritten : fallback;
  cache.set(words, kept);
  if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  return kept;
}

/** The run's words and negative in the picked look, or null for a look Fuobe doesn't have. */
export async function filmLookRun(id: string, scene: string, negative: string | undefined | null, helper: { guestKey?: string; waitMs?: number } = {}): Promise<AppliedFilmLook | null> {
  const look = filmLook(id);
  if (!look) return null;
  return applyFilmLook(look, look.mono ? await monoScene(scene, helper) : scene, negative);
}
