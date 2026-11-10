/**
 * A ready-made starter's look as its page shows it ("Epic · Modern · Anamorphic · Silhouette · Oil & Ochre · 16:9"):
 * the same words the studio's own pickers use, so the page names the whole recipe, not only the shots' words.
 * Browser-safe: names and colours only.
 */
import { APERTURES, CAMERA_BODIES, DEFAULT_ASPECT, ERAS, FOCAL_LENGTHS, GENRES, LENSES, LIGHTING_PRESETS, optionName, paletteHex, paletteLabel, type DirectorOption, type DirectorSettings } from "@/lib/catalog/cinema";
import { lookCard } from "@/lib/catalog/soul-cards";
import type { StarterLookItem } from "./types";

/** An option's name, or nothing when the field is left to the model (Auto, General). */
function named(list: DirectorOption[], slug: string | null | undefined): StarterLookItem | undefined {
  const o = slug ? list.find((x) => x.slug === slug) : undefined;
  return o ? { name: o.name } : undefined;
}

/** Four of a palette's colours, dark to light and its accent last, for the chip's swatch. */
const swatchOf = (hex: string[] | undefined) => (hex && hex.length >= 12 ? [hex[3], hex[6], hex[9], hex[11]] : hex?.slice(0, 4));

/** A Cinema Studio film's look: genre, era, camera, lens, focal length, aperture, light, palette, then its shape. */
export function cinemaLook(d: DirectorSettings, aspect: string = DEFAULT_ASPECT): StarterLookItem[] {
  const light: StarterLookItem | undefined =
    d.lighting?.kind === "preset" ? named(LIGHTING_PRESETS, d.lighting.slug) : d.lighting?.kind === "custom" && d.lighting.lights.length ? { name: "Custom light" } : undefined;
  const palette = paletteLabel(d.palette);
  const swatch = swatchOf(paletteHex(d.palette));
  const aperture = d.aperture ? named(APERTURES, d.aperture) : undefined;
  return [
    named(GENRES, d.genre),
    named(ERAS, d.era),
    named(CAMERA_BODIES, d.camera),
    named(LENSES, d.lens),
    named(FOCAL_LENGTHS, d.focal),
    // "f/1.4 Wide Open" reads as "f/1.4", as the Camera chip shows it.
    aperture && { name: optionName(APERTURES, d.aperture).replace(/ .*/, "") },
    light,
    palette ? { name: palette, ...(swatch?.length && { swatch }) } : undefined,
    { name: aspect },
  ].filter((x): x is StarterLookItem => !!x);
}

/** A Storyboard story's look: its Fuobe Soul look (when it has one), its shape and its frame count. */
export function storyboardLook({ look, aspectRatio, frames }: { look?: string; aspectRatio: string; frames: number }): StarterLookItem[] {
  const card = lookCard(look);
  return [...(card ? [{ name: card.name }] : []), { name: aspectRatio }, { name: `${frames} frames` }];
}
