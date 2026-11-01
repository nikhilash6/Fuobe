import { paletteIndex } from "@/lib/palette-index";

/**
 * The ⌘K palette's catalog: apps, camera motions, effects and models, slim (names, categories, where
 * each opens). Static, so it's prerendered at build time; the palette loads it once, on first open.
 */
export async function GET() {
  return Response.json(paletteIndex());
}
