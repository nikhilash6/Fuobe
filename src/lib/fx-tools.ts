/**
 * Fuobe FX: the tools a VFX artist or team reaches for, grouped by the stage of an FX pipeline they serve. Pure data, so
 * the server's page (/fx), the bar's menu, the area helpers and the tests share it; src/lib/area-showcase.ts and
 * mega-menus.server.ts resolve the ids to covers and links.
 *
 * Fuobe FX is the one home of the FX studios (FX_HOME): they have no launcher group, so Studios and /create list them
 * no more, and their cards are here. Each section's cards are those studios and their own modes; the shared tools FX
 * work also uses (Upscale, Color grading, Layers, Inpaint, Image to 3D…) and the one-click apps keep their homes and
 * are pills here. Every item is a navigation entry's id (src/lib/nav-model.ts) or an app's preset id ("app-…").
 */
import type { NavIconName } from "./nav-model";

/** The studios whose home is Fuobe FX (their links, names and search words are unchanged). */
/** A Genjutsu mode's entry id, built (one written out whole is also a retired model id: catalog/replaced.ts). */
const gj = (mode: string) => `genjutsu-${mode}`;

export const FX_HOME: readonly string[] = ["genjutsu", "character-swap", "motion-control", "video-tools", "extend", "reframe"];

/** Whether an entry lives in Fuobe FX: one of its studios, or a mode or tab of one. */
export const inFx = (e: { id: string; parent?: string }) => FX_HOME.includes(e.id) || (!!e.parent && FX_HOME.includes(e.parent));

/**
 * The cover a mode of an FX studio shows as its card here (a preset whose picture shows the same job). The studios
 * themselves show their own (areaCover).
 */
export const FX_COVERS: Readonly<Record<string, string>> = {
  [gj("character")]: "genjutsu-group-swap",
  [gj("motion")]: "app-dance",
  [gj("swap")]: "app-outfit-swap",
  [gj("insert")]: "app-product-placement",
  [gj("picture")]: "app-bring-to-life",
  "video-tools-remove-object": "app-object-remover",
  "video-tools-green-screen": "app-remove-background",
  "video-tools-colors": "app-match-colors",
  "video-tools-restore": "app-restore-photo",
  "video-tools-remove-person": "effect-vanish",
  "video-tools-depth": "effect-lidar-transition",
  "video-tools-relight": "app-relight",
  "video-tools-evolution": "effect-world-morphing",
  [gj("restyle")]: "effect-layer-mixed-media",
  [gj("finish")]: "effect-film-colors",
  "upscale-fps": "motion-slow-motion",
};

/**
 * The cover a mode of a shared tool shows here (a pill on the page, a row with its picture in the menu): it stays a pill,
 * as its tool does.
 */
export const FX_PILL_COVERS: Readonly<Record<string, string>> = {
  "upscale-video": "app-macro-scene",
  "upscale-hdr": "effect-hyper-neon",
  "upscale-export": "app-behind-the-scenes",
  "image-to-3d-splat": "effect-point-cloud",
  "cinema-blockout": "effect-wireframe",
};

/** An item's own cover here, a card's or a pill's (undefined: its studio's, areaCover). */
export const fxCover = (id: string): string | undefined => FX_COVERS[id] ?? FX_PILL_COVERS[id];

export interface FxSection {
  /** The section's anchor (#replace), its tab and its menu column. */
  id: string;
  title: string;
  /** A phone chip's name. */
  chip: string;
  /** One sentence under the heading. */
  line: string;
  icon: NavIconName;
  /** Navigation entry ids or app preset ids, the lead first. */
  items: readonly string[];
}

/** An item that is a one-click app (its page is /apps/<id>). */
export const isFxApp = (id: string) => id.startsWith("app-");

/** Whether an item may be a card here: an FX studio or one of its modes, or Upscale's smoother-motion mode (FX_COVERS). */
export const fxCardable = (id: string, e?: { id: string; parent?: string }) => !isFxApp(id) && (!!e && (inFx(e) || id in FX_COVERS));

export const FX_SECTIONS: readonly FxSection[] = [
  {
    id: "replace",
    title: "Replace & recast",
    chip: "Replace",
    line: "Swap a person, a face or an object in your plate. The camera and the motion stay as shot.",
    icon: "Drama",
    items: [
      "genjutsu",
      "character-swap",
      "motion-control",
      gj("character"),
      gj("motion"),
      gj("swap"),
      gj("insert"),
      gj("picture"),
      "app-recast",
      "app-video-face-swap",
      "app-face-swap",
      "app-head-swap",
    ],
  },
  {
    id: "clean-plates",
    title: "Clean plates & mattes",
    chip: "Clean plates",
    line: "Take people and objects out, pull a matte, key a green screen or match two plates.",
    icon: "Layers",
    items: [
      "video-tools",
      "video-tools-remove-object",
      "video-tools-green-screen",
      "video-tools-colors",
      "video-tools-remove-person",
      "video-tools-depth",
      "inpaint",
      "layers",
      "app-video-background-remover",
      "app-remove-background",
      "app-object-remover",
      "app-watermark-remover",
      "app-change-background",
      "app-similarity-score",
      "app-text-edit",
    ],
  },
  {
    id: "finish",
    title: "Retime, reframe & finish",
    chip: "Finish",
    line: "Longer shots, new shapes, smoother motion, restored footage and masters for delivery.",
    icon: "FastForward",
    items: [
      "extend",
      "reframe",
      "upscale-fps",
      "video-tools-restore",
      "upscale",
      "upscale-video",
      "upscale-hdr",
      "upscale-export",
      gj("finish"),
      "video-tools-trim",
      "video-tools-join",
      "video-tools-captions",
      "video-tools-remove-dialogue",
      "app-skin-enhancer",
    ],
  },
  {
    id: "look",
    title: "Relight, grade & look",
    chip: "Look",
    line: "Relight a clip, grade it or give it a new look. The motion stays as shot.",
    icon: "SlidersHorizontal",
    items: [
      "video-tools-relight",
      gj("restyle"),
      "color-grade",
      "video-edit",
      "app-match-lighting",
      "app-match-colors",
      "app-style-transfer",
      "app-colorize",
    ],
  },
  {
    id: "camera",
    title: "Camera & 3D",
    chip: "Camera & 3D",
    line: "New angles, camera moves, 3D from a photo and effects for any shot.",
    icon: "Rotate3d",
    items: ["any-angle", "image-to-3d", "image-to-3d-splat", "cinema", "cinema-blockout", "motions", "effects", "video-tools-evolution", "app-fuobe-angles", "app-zoom-out", "app-shots"],
  },
];

/** Every navigation entry the sections name (not the apps), each once, in section order. */
export const fxNavIds = (): string[] => [...new Set(FX_SECTIONS.flatMap((s) => s.items.filter((id) => !isFxApp(id))))];
