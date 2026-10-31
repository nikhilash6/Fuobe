/**
 * A preset's real cover for the pickers (camera motions, effects, Mix, Cinema Studio's moves): the same still and
 * clip its gallery card shows, at the same versioned URLs (?v=). Reads the slim covers map (preset-covers.generated.ts:
 * which presets have a cover, and a clip, and their versions), never the manifest with its provenance
 * (preset-previews.generated.ts), so client code can import it.
 * Keep it to the pickers' own chunks all the same: tests/preset-covers.test.ts checks the importers.
 */
import type { CameraMove } from "./catalog/cinema";
import { thumbOf } from "./preset-cards";
import { PRESET_COVERS } from "./preset-covers.generated";

/** Where pnpm eval:covers puts a poster's small copy (scripts/eval/lib/covers.mjs, thumbOf). */
export { thumbOf };

export interface PresetCover {
  /** The still (a clip's first frame), as the gallery card shows it. */
  poster: string;
  /** The poster's small copy (320 px wide), which a picker's tile shows at rest. */
  thumb: string;
  /** The short muted clip, played only while the tile is hovered, focused or picked. */
  video?: string;
}

/**
 * Presets without a cover of their own that show another one, of the same shot: the 3D Rotation motion spins the
 * subject in place like a product on a turntable, which is the 3D Rotation app's cover.
 */
const SAME_SHOT: Record<string, string> = { "motion-3d-rotation": "app-3d-rotation" };

export function presetCover(id: string | undefined): PresetCover | undefined {
  if (!id) return undefined;
  if (!Object.hasOwn(PRESET_COVERS, id)) return Object.hasOwn(SAME_SHOT, id) ? presetCover(SAME_SHOT[id]) : undefined;
  const c = PRESET_COVERS[id];
  // A cover at the usual place is listed by its versions alone: the poster's (which its small copy shares), and the clip's.
  const base = `/previews/presets/${id}`;
  const { poster, video } =
    typeof c === "string" ? { poster: `${base}.jpg?v=${c}`, video: undefined } : Array.isArray(c) ? { poster: `${base}.jpg?v=${c[0]}`, video: `${base}.mp4?v=${c[1]}` } : c;
  return { poster, thumb: thumbOf(poster), ...(video && { video }) };
}

/**
 * Moves whose camera motion shows another shot than the name says: Drone Orbit runs 360 Orbit, whose clip circles
 * a dancer at ground level, not from the air.
 */
const OTHER_SHOT = new Set(["drone-orbit"]);

/** A Cinema Studio move's cover: the one of the camera motion it runs (catalog/cinema.ts, MOVE_MOTION). */
export const moveCover = (m: Pick<CameraMove, "slug" | "motionId">) => (OTHER_SHOT.has(m.slug) ? undefined : presetCover(m.motionId));
