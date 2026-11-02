/**
 * The photo the Relight tool opens on, with its relit result shipped as a static file: Intensity, the looks and the
 * preview work at once for everyone, guests too, with nothing to upload or run. A demo with a scene read ships its
 * depth map and cut-out too (the preview is then depth-true); without them it uses the flat preview.
 */
import type { LookId } from "./lights";

export interface RelightDemo {
  id: string;
  /** What the photo shows, for its alt text. */
  alt: string;
  photo: string;
  relit: string;
  /** The look the relit picture was made with: the tool opens on it, so the result shows. */
  look: LookId;
  width: number;
  height: number;
  depth?: string;
  matte?: string;
}

export const RELIGHT_DEMOS: readonly RelightDemo[] = [
  {
    id: "cliffs",
    alt: "A model in a teal knit on a clifftop by the sea",
    photo: "/previews/presets/ba/1280/app-relight-before.jpg",
    relit: "/previews/presets/ba/1280/app-relight-after.jpg",
    look: "golden-hour",
    width: 1280,
    height: 960,
  },
];

export const DEFAULT_DEMO = RELIGHT_DEMOS[0];
