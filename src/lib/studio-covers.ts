/**
 * Covers that belong to a studio rather than to a preset: one of the studio's own examples, cut into a cover by the
 * same pipeline as a preset's (pnpm eval:covers --from-masters, gen-preset-peaks, gen-preset-hd) and listed with them
 * under its own id (preset-covers.generated.ts, preset-previews.generated.ts). Home's card for the studio, its entry
 * in the menus and its next step under a result show it. Each names its card as a preset's would; no preset has the
 * same id. Pure data, so the server and the browser share it.
 */
export interface StudioCover {
  /** The card's name, as a preset card's (its alt text and tooltip). */
  name: string;
  /** What the clip shows, in a sentence. */
  description: string;
  /** The studio it belongs to. */
  category: string;
  /** A key of PRESET_ICONS (src/components/preset-icons.ts). */
  icon: string;
}

export const STUDIO_COVERS: Record<string, StudioCover> = {
  // Genjutsu's Character swap example (genjutsu-character.1): a couple on stone steps, both people swapped in one take.
  "genjutsu-group-swap": {
    name: "Group swap",
    description: "Two people swapped in one take: the kiss on the cheek, the laugh and the light stay as filmed.",
    category: "Genjutsu",
    icon: "Users",
  },
};

/** Whether an id is a studio's cover (not a preset's). */
export const isStudioCover = (id: string) => Object.hasOwn(STUDIO_COVERS, id);
