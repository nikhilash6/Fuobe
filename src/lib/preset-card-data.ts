/**
 * A preset's card as the galleries show it: the slim card data (preset-cards.ts) with its real cover when it has
 * one (preset-previews.generated.ts, pnpm eval:covers), else the procedural preview. The preset header shows the
 * same one, built from the slim covers map (coverPreview, preset-covers.ts).
 *
 * The only module that reads the covers manifest, which lists every cover with its provenance. Import it from
 * server pages or server-only modules: a client module that imports it ships the whole manifest in every chunk it
 * is in. tests/preset-covers.test.ts checks the importers.
 */
import type { Preset } from "./catalog/types";
import { presetCard, proceduralPreview, previewScene, type PresetCardData, type PresetPreview } from "./preset-cards";
import { PRESET_PREVIEWS } from "./preset-previews.generated";
import { STUDIO_COVERS } from "./studio-covers";

export function previewFor(p: Pick<Preset, "id" | "type" | "name" | "category">): PresetPreview {
  // A real cover, rendered and measured by the evaluation harness (pnpm eval:covers), replaces the procedural one.
  const real = PRESET_PREVIEWS[p.id];
  if (real) return { poster: real.poster, ...(real.video && { video: real.video }), scene: previewScene(p) };
  return proceduralPreview(p);
}

/** What a gallery card needs, and nothing else. */
export const toPresetCard = (p: Preset): PresetCardData => presetCard(p, previewFor(p));

/** The hue a card without a preset's look is tinted with while its cover loads (lookHue's own fallback). */
const STUDIO_HUE = 282;

/**
 * A studio cover's card (studio-covers.ts), drawn as a preset's: its real cover, its name and its line. Undefined for
 * an id that isn't a studio's cover, or one whose cover isn't made yet.
 */
export function studioCoverCard(id: string): PresetCardData | undefined {
  const s = Object.hasOwn(STUDIO_COVERS, id) ? STUDIO_COVERS[id] : undefined;
  if (!s || !PRESET_PREVIEWS[id]) return undefined;
  const preview = previewFor({ id, type: "app", name: s.name, category: s.category });
  return { id, name: s.name, description: s.description, category: s.category, icon: s.icon, hue: STUDIO_HUE, cloud: false, open: true, preview };
}
