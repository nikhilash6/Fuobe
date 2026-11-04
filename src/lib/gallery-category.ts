/**
 * A gallery's category from a link (/motions?category=Orbit), and what its All view leaves out. Pure, so the gallery and
 * the tests share it.
 */

/** The category a URL's query asks for, when the gallery has it ("All" otherwise). */
export function categoryFrom(search: string, categories: readonly string[]): string {
  const asked = new URLSearchParams(search).get("category");
  return asked && categories.includes(asked) ? asked : "All";
}

/**
 * What the All view leaves out: presets the page already shows above the gallery (`skip`), only while nothing narrows
 * it (no search, no category), so a search or a category still finds them.
 */
export function skippedInAll<T extends { id: string }>(items: readonly T[], skip: readonly string[] | undefined, narrowed: boolean): T[] {
  if (!skip?.length || narrowed) return [...items];
  const out = new Set(skip);
  return items.filter((it) => !out.has(it.id));
}
