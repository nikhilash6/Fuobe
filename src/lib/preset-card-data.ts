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

export function previewFor(p: Pick<Preset, "id" | "type" | "name" | "category">): PresetPreview {
  // A real cover, rendered and measured by the evaluation harness (pnpm eval:covers), replaces the procedural one.
  const real = PRESET_PREVIEWS[p.id];
  if (real) return { poster: real.poster, ...(real.video && { video: real.video }), scene: previewScene(p) };
  return proceduralPreview(p);
}

/** What a gallery card needs, and nothing else. */
export const toPresetCard = (p: Preset): PresetCardData => presetCard(p, previewFor(p));
