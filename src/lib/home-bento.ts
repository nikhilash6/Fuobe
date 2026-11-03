/**
 * Home's first screen: a grid of every kind of media Fuobe makes, each tile a real picture, clip or sound from the
 * studio it opens (src/components/home/home-bento.tsx). Every number is read from the catalog and every picture is a
 * published file with its content version, so nothing here is typed in twice (tests/home-bento.test.ts).
 */
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { MODELS, getPreset, isListed } from "@/lib/catalog";
import { getTemplate } from "@/lib/catalog/canvas";
import { runsOn } from "@/lib/catalog/engines";
import type { ModelDef } from "@/lib/catalog/types";
import { EXAMPLE_MEDIA } from "@/lib/examples/media.generated";
import { HOME_BENTO_MEDIA, HOME_BENTO_WAVE } from "@/lib/home-bento.generated";
import type { Demo } from "@/lib/live/demo";
import { presetCover } from "@/lib/preset-covers";
import { PRESET_BEFORE_AFTER } from "@/lib/preset-before-after.generated";
import { templateCover } from "@/lib/template-covers";

/** The preset whose clip each moving tile plays (no other card on Home plays these: tests/home-showcase.test.ts). */
export const BENTO_CLIPS = { video: "motion-catwalk", threeD: "app-3d-rotation" } as const;
/** The Image studio's example the image tile shows and opens with (src/lib/examples/plan.json). */
export const BENTO_IMAGE_EXAMPLE = { id: "image.4", out: "/examples/image/4/out.jpg" };
/** The app the before/after tile shows and opens: black and white to colour reads at a glance. */
export const BENTO_BEFORE_AFTER = "app-colorize";
/** The Canvas board the canvas tile draws: the same film as /canvas's "What's a canvas?". */
export const BENTO_BOARD = "effect-chain-pearl-earring";
/** The Live edit steps the live tile plays: the session's first three changes (Home's Live edit section plays them all). */
export const BENTO_LIVE_STEPS = ["s0", "s1", "s2", "s3"];

/** Where each tile goes. Each label is the navigation's name for the place (or the app's own). */
export const BENTO_HREFS = {
  video: "/cinema",
  image: `/image?example=${BENTO_IMAGE_EXAMPLE.id}`,
  audio: "/audio",
  threeD: "/image-to-3d",
  restore: `/apps/${BENTO_BEFORE_AFTER}`,
  numbers: "#home-studios",
  live: "/live-edit?from=home",
  canvas: "/canvas",
} as const;

export type BentoKey = keyof typeof BENTO_HREFS;

/**
 * A picture in two widths: AVIF for the browsers that take it, the published JPEG for the rest. `tall`: a portrait
 * crop of it for a tile that is tall from lg (home-bento.tsx), so the picture is never stretched past its own pixels.
 */
export interface BentoPicture {
  avif: { src: string; w: number }[];
  fallback: string;
  tall?: { src: string; w: number }[];
}

export interface BentoTile {
  key: BentoKey;
  /** The small line over the title: what kind of media, and how much of it. */
  meta: string;
  title: string;
  /** The link's own words (the place it opens). */
  cta: string;
  href: string;
  /** What a screen reader reads for the whole tile. */
  label: string;
}

/** The numbers Home's first screen quotes, each from the catalog. */
export interface BentoFacts {
  /** Studios, counted as the navigation counts them (its Studios badge and the launcher say the same number). */
  studios: number;
  apps: number;
  effectsAndMotions: number;
  motions: number;
  openModels: number;
  imageModels: number;
  videoModels: number;
  models3d: number;
  soundTools: number;
}

/**
 * Open models a visitor can pick, of one kind (Home is the same page for everyone, and everyone runs open models). The
 * same test as modelCounts().open (src/lib/catalog/counts.ts), so the kinds add up to its total.
 */
export const openModelsOf = (kind: ModelDef["kind"], models: readonly ModelDef[] = MODELS) => models.filter((m) => isListed(m) && runsOn(m, "open") && m.kind === kind).length;

/** A file made by scripts/gen-home-bento.mjs, with its version. */
function made(file: string): string {
  const v = HOME_BENTO_MEDIA[file];
  if (!v) throw new Error(`Home's first screen names ${file}, which scripts/gen-home-bento.mjs didn't make`);
  return `${file}?v=${v}`;
}

/** A published example file with its version (src/lib/examples/media.generated.ts). */
function example(file: string): string {
  const m = EXAMPLE_MEDIA[file];
  if (!m) throw new Error(`Home's first screen names ${file}, which isn't a published example file`);
  return `${file}?v=${m.v}`;
}

/** The phrase typed before each step of the Live edit session, in its own words: every `type` since the last step. */
export function livePhrases(demo: Pick<Demo, "script">, steps = BENTO_LIVE_STEPS): string[] {
  const out: string[] = [];
  let typed = "";
  for (const s of demo.script) {
    if (s.type === "type") typed += s.text;
    else if (s.type === "frame" && !s.live && steps.includes(s.frame) && s.frame !== steps[0]) {
      out.push(typed.replace(/^[,\s]+/, ""));
      typed = "";
    }
  }
  return out;
}

async function readDemo(): Promise<Demo> {
  return JSON.parse(await fs.readFile(path.join(process.cwd(), "public", "previews", "live-edit", "demo.json"), "utf8")) as Demo;
}

/**
 * What the canvas tile draws: the board's nodes in order (its photo, its steps, its film), each with its label; the
 * photo and the film show the board's own pictures (scripts/gen-home-bento.mjs makes their small copies).
 */
function board() {
  const t = getTemplate(BENTO_BOARD);
  if (!t || !templateCover("canvas", BENTO_BOARD)) throw new Error(`Home's canvas tile names ${BENTO_BOARD}, which has no board or cover`);
  const nodes = t.build("open").nodes.map((n) => ({
    id: n.id,
    label: n.data.label ?? n.id,
    kind: n.type === "image-input" ? ("photo" as const) : n.type === "output" ? ("film" as const) : ("step" as const),
  }));
  const photo = nodes.find((n) => n.kind === "photo");
  const film = nodes.find((n) => n.kind === "film");
  const steps = nodes.filter((n) => n.kind === "step");
  if (!photo || !film || steps.length !== 2) throw new Error(`Home's canvas tile draws a photo, two steps and a film; ${BENTO_BOARD} has another shape`);
  return {
    photo: { ...photo, thumb: made("/previews/home/board-photo.webp") },
    steps,
    film: { ...film, thumb: made("/previews/home/board-film.webp") },
  };
}

/** Everything the first screen shows, computed once per build with the rest of Home (homeShowcase). */
export async function homeBento(f: BentoFacts) {
  const video = presetCover(BENTO_CLIPS.video);
  const threeD = presetCover(BENTO_CLIPS.threeD);
  const restore = getPreset(BENTO_BEFORE_AFTER);
  const baV = PRESET_BEFORE_AFTER[BENTO_BEFORE_AFTER];
  if (!video?.video || !threeD?.video || !restore || !baV) throw new Error("Home's first screen names a clip or an app without its published media");
  const demo = await readDemo();
  const frame = (id: string) => {
    const fr = demo.frames[id];
    if (!fr?.small || !fr.mid || !fr.webp) throw new Error(`Home's live tile names frame ${id}, which the Live edit session doesn't have`);
    return { avif: [{ src: fr.small, w: 512 }, { src: fr.mid, w: 768 }], fallback: fr.webp } satisfies BentoPicture;
  };
  const restoreSide = (side: "before" | "after"): BentoPicture => ({
    avif: [640, 960].map((w) => ({ src: made(`/previews/home/ba-${side}-${w}.avif`), w })),
    tall: [360, 576].map((w) => ({ src: made(`/previews/home/ba-${side}-tall-${w}.avif`), w })),
    fallback: `/previews/presets/ba/960/${BENTO_BEFORE_AFTER}-${side}.jpg?v=${baV}`,
  });
  const tile = (key: BentoKey, kind: string, meta: string, title: string, cta: string): BentoTile => ({
    key,
    meta,
    title,
    cta,
    href: BENTO_HREFS[key],
    label: `${kind}: ${title}. ${cta}`,
  });
  return {
    facts: f,
    tiles: {
      video: tile("video", "Video", `${f.videoModels} video models · ${f.motions} camera moves`, "Films, ads and shorts", "Open Cinema Studio"),
      image: tile("image", "Image", `Image · ${f.imageModels} models`, "Portraits and campaigns", "Open Image"),
      audio: tile("audio", "Audio", `Audio · ${f.soundTools} sound tools`, "Voice, music, sound effects", "Open Audio"),
      threeD: tile("threeD", "3D", `3D · ${f.models3d} models`, "Spin it in 3D", "Open Image to 3D"),
      restore: tile("restore", "Before and after", `One of ${f.apps} apps`, "Bring an old photo to color", `Open ${restore.name}`),
      numbers: {
        ...tile("numbers", "Studios", "", "Every studio, app and effect", "All studios"),
        // Read as the numbers it shows, and say that it opens the list of studios in place.
        label: `${f.studios} studios, ${f.apps} apps, ${f.effectsAndMotions} effects and camera moves. Opens all studios`,
      },
      live: tile("live", "Live edit", "Live edit", "Type it, watch it change", "Open Live edit"),
      canvas: tile("canvas", "Canvas", "Canvas", "Chain any step, end to end", "Open Canvas"),
    },
    video: { id: BENTO_CLIPS.video, poster: { avif: [{ src: made("/previews/home/catwalk-512.avif"), w: 512 }], fallback: video.poster } satisfies BentoPicture, clip: video.video },
    image: {
      avif: [480, 768].map((w) => ({ src: made(`/previews/home/image-4-${w}.avif`), w })),
      fallback: example(BENTO_IMAGE_EXAMPLE.out),
    } satisfies BentoPicture,
    threeD: { id: BENTO_CLIPS.threeD, poster: threeD.poster, clip: threeD.video },
    restore: { before: restoreSide("before"), after: restoreSide("after") },
    wave: { bars: HOME_BENTO_WAVE.bars, seconds: HOME_BENTO_WAVE.seconds },
    live: { frames: BENTO_LIVE_STEPS.map(frame), phrases: livePhrases(demo) },
    canvas: board(),
    numbers: [
      { value: f.studios, label: "studios" },
      { value: f.apps, label: "apps" },
      { value: f.effectsAndMotions, label: "effects & moves" },
    ],
    numbersLine: `Plus ${f.openModels} open models for pictures, video, sound and 3D.`,
  };
}

export type HomeBento = Awaited<ReturnType<typeof homeBento>>;
