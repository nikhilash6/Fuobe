/**
 * What Kinetic's editor edits (pure): a recipe, plus the brand's logo while the end card's "Name" choice hides it. Every
 * change here makes a new document, so the editor's history keeps each one as it was.
 */

import { entryForRecipe, startRecipe, templateOf, type KineticEntry } from "./kinetic-catalog";
import { tidyRecipe } from "./edit";
import type { Recipe, VideoLayer } from "./recipe";
import type { SizeSpec } from "./sizes";
import type { TemplateBrand } from "./template";

export interface KineticDoc {
  recipe: Recipe;
  /** The brand's logo, kept while the end card's "Name" choice sets the name in type instead. */
  logo: string | null;
}

const HEX = /^#[0-9a-f]{6}$/i;

export function docFrom(recipe: Recipe): KineticDoc {
  return { recipe, logo: recipe.brand.logo ?? null };
}

const isEndCard = (r: Recipe) => r.scene.startsWith("end-card/");

/** A typed field, exactly as typed (an empty one is left out, as Marketing does). */
export function setField(d: KineticDoc, e: KineticEntry, key: string, value: string): KineticDoc {
  const f = templateOf(e).fields?.find((x) => x.key === key);
  const v = f ? value.slice(0, f.max) : value;
  const fields = { ...d.recipe.fields };
  if (v.trim()) fields[key] = v;
  else delete fields[key];
  return { ...d, recipe: { ...d.recipe, fields } };
}

/** The Easy choice in a group: a style picks the end card's scene; Name hides the logo; Pace clears Pro's pace. */
export function setEasy(d: KineticDoc, e: KineticEntry, group: string, choice: string): KineticDoc {
  const g = templateOf(e).easy?.find((x) => x.id === group);
  if (!g || !g.choices.some((c) => c.id === choice)) return d;
  const r = d.recipe;
  const controls = { ...(r.controls ?? {}), [group]: choice };
  if (g.scene) return { ...d, recipe: { ...r, scene: `${g.scene}/${choice}`, controls } };
  let next: Recipe = { ...r, controls };
  if (group === "mark" && isEndCard(r)) {
    const brand = { ...r.brand };
    if (choice === "name") delete brand.logo;
    else if (d.logo) brand.logo = d.logo;
    next = { ...next, brand };
  }
  if (group === "pace" && next.motion?.pace !== undefined) {
    const motion = { ...next.motion };
    delete motion.pace;
    next = tidyRecipe({ ...next, motion });
  }
  return { ...d, recipe: next };
}

/** The Easy choice a group shows (none when Pro moved the value it sets: Pace under a Pro pace). */
export function easyValue(d: KineticDoc, e: KineticEntry, group: string): string | null {
  if (group === "pace" && d.recipe.motion?.pace !== undefined) return null;
  const g = templateOf(e).easy?.find((x) => x.id === group);
  if (!g) return null;
  if (g.scene) return d.recipe.scene.split("/")[1] ?? g.choices[0].id;
  if (group === "mark" && isEndCard(d.recipe)) return d.recipe.brand.logo ? "logo" : d.logo ? "name" : String(d.recipe.controls?.mark ?? "logo");
  const v = d.recipe.controls?.[group];
  return typeof v === "string" ? v : g.choices[0].id;
}

export function brandOf(d: KineticDoc): TemplateBrand {
  const b = d.recipe.brand;
  return { name: b.name, colors: [...b.colors], fonts: { heading: b.fonts.heading ?? "Inter", body: b.fonts.body ?? "Inter" }, logo: d.logo };
}

export function setBrand(d: KineticDoc, b: TemplateBrand): KineticDoc {
  const r = d.recipe;
  const hideLogo = isEndCard(r) && r.controls?.mark === "name";
  const brand: Recipe["brand"] = { name: b.name.slice(0, 120), colors: b.colors.filter((c) => HEX.test(c)).slice(0, 8), fonts: { heading: b.fonts.heading, body: b.fonts.body }, ...(b.logo && !hideLogo && { logo: b.logo }) };
  const fields = isEndCard(r) ? { ...r.fields, brand: brand.name } : r.fields;
  return { recipe: { ...r, brand, fields }, logo: b.logo ?? null };
}

export function setProduct(d: KineticDoc, url: string | null): KineticDoc {
  const media = { ...(d.recipe.media ?? {}) };
  if (url) media.product = url;
  else delete media.product;
  const recipe: Recipe = { ...d.recipe, media };
  if (!Object.keys(media).length) delete recipe.media;
  return { ...d, recipe };
}

export const setSize = (d: KineticDoc, size: SizeSpec): KineticDoc => ({ ...d, recipe: { ...d.recipe, size } });

export const setDuration = (d: KineticDoc, duration: number): KineticDoc => ({ ...d, recipe: { ...d.recipe, duration } });

export const setFps = (d: KineticDoc, fps: Recipe["fps"]): KineticDoc => ({ ...d, recipe: { ...d.recipe, fps } });

export const setExport = (d: KineticDoc, x: Partial<Recipe["export"]>): KineticDoc => ({ ...d, recipe: { ...d.recipe, export: { ...d.recipe.export, ...x } } });

/** A Pro change (presets, sliders, groups, tracks), tidied so a value back at its default leaves the recipe as designed. */
export const setPro = (d: KineticDoc, f: (r: Recipe) => Recipe): KineticDoc => ({ ...d, recipe: tidyRecipe(f(d.recipe)) });

export const hasTiming = (r: Recipe): boolean => !!(r.groups && Object.keys(r.groups).length) || !!(r.tracks && Object.keys(r.tracks).length);

/** Every group and track edit cleared (one undo step). */
export function clearTiming(d: KineticDoc): KineticDoc {
  const recipe = { ...d.recipe };
  delete recipe.groups;
  delete recipe.tracks;
  return { ...d, recipe };
}

export function setClip(d: KineticDoc, layer: VideoLayer | null): KineticDoc {
  const recipe = { ...d.recipe };
  if (layer) recipe.layers = { ...(recipe.layers ?? {}), video: layer };
  else {
    delete recipe.layers;
    if (recipe.tracks?.["clip.dim"]) {
      const tracks = { ...recipe.tracks };
      delete tracks["clip.dim"];
      if (Object.keys(tracks).length) recipe.tracks = tracks;
      else delete recipe.tracks;
    }
  }
  return { ...d, recipe };
}

/** A new clip under the words: a light dim and a full scrim in the ground colour, so every look keeps its words readable. */
export const DEFAULT_CLIP: Omit<VideoLayer, "src"> = { from: 0, fit: "cover", dim: 0.15, scrim: "full" };

/**
 * Another scene, keeping what carries over: the brand (and its logo), the size when the scene comes in it, and the
 * export settings. Its own words, choices and timing start from its showcase.
 */
export function switchScene(d: KineticDoc, to: KineticEntry, brand: TemplateBrand | null): KineticDoc {
  const r = startRecipe(to, { brand });
  const from = entryForRecipe(d.recipe);
  const keepSize = typeof d.recipe.size === "string" && from?.slug !== to.slug;
  return docFrom({ ...r, ...(keepSize && { size: d.recipe.size }), fps: d.recipe.fps, export: d.recipe.export });
}

/** The words a saved result is listed by: the scene's name and the first typed words. */
export function docWords(d: KineticDoc, e: KineticEntry): { first: string; prompt: string } {
  const t = templateOf(e);
  const typed = (t.fields ?? []).map((f) => (d.recipe.fields[f.key] ?? "").replace(/\*/g, "").trim()).filter(Boolean);
  const first = (typed[0] ?? d.recipe.brand.name).split(/\s+/).slice(0, 5).join(" ");
  return { first, prompt: [d.recipe.brand.name, ...typed].filter(Boolean).join(" · ").slice(0, 2000) };
}

/** The person's own stored files a recipe names (logo, picture, clip). */
export function docFiles(r: Recipe): string[] {
  return [r.brand.logo, r.media?.product].filter((u): u is string => !!u?.startsWith("/api/files/"));
}
