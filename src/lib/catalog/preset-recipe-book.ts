/**
 * The recipe each preset's preview was made with (./preset-recipe-book.json), by preset id: the MiniMax H3 clip (its
 * Quality, length, words, sound and music, and the Qwen-Image 2.1 edit that made its end frame first) or the Qwen-Image
 * 2.1 edit of an image app. The words are the preview's, written for any picture: its subject and setting became "the
 * subject" and "the scene", and the effect's own words stayed. The catalog puts each on its preset (preset.recipe), and
 * ./preset-recipe-routes.ts turns it into the route the preset opens on.
 *
 * When a preview is made again, its entry changes with it: tests/preset-recipe-fidelity.test.ts checks that each
 * preset's run follows its entry.
 */
import BOOK from "./preset-recipe-book.json";
import type { PresetRecipeBook } from "./types";

export const RECIPE_BOOK: Readonly<Record<string, PresetRecipeBook>> = BOOK as unknown as Record<string, PresetRecipeBook>;
