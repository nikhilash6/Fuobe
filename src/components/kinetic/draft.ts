/**
 * Kinetic's local draft and per-viewer choices, kept in this browser only (every read and write wrapped: a private
 * window or blocked storage just means no draft, and the page works the same). A draft is the current recipe per
 * viewer and scene, so a reload brings it back.
 */

import { RecipeSchema, type Recipe } from "@/lib/motion/recipe";

const get = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const put = (key: string, value: string | null): void => {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {}
};

export const draftKey = (viewer: string, slug: string) => `kinetic:draft:${viewer}:${slug}`;

export function readDraft(viewer: string, slug: string): { recipe: Recipe; logo: string | null } | null {
  const raw = get(draftKey(viewer, slug));
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { recipe?: unknown; logo?: unknown };
    const r = RecipeSchema.safeParse(v.recipe);
    if (!r.success) return null;
    return { recipe: r.data, logo: typeof v.logo === "string" ? v.logo : null };
  } catch {
    return null;
  }
}

export const writeDraft = (viewer: string, slug: string, d: { recipe: Recipe; logo: string | null }) => put(draftKey(viewer, slug), JSON.stringify(d));

export const dropDraft = (viewer: string, slug: string) => put(draftKey(viewer, slug), null);

/** A small per-viewer choice (Easy or Pro, the preview mode). */
export function readChoice<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const v = get(`kinetic:${key}`);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

export const writeChoice = (key: string, value: string) => put(`kinetic:${key}`, value);
