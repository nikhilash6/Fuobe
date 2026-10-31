/**
 * What Home shows below the composer: which presets, studios, models and skills, and every number it quotes, read
 * from the catalog, the ComfyUI manifest and the skills folder, never typed in. Server only: the page gets slim
 * cards and strings, and the catalog stays here (tests/home-showcase.test.ts checks every id and number).
 */
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { NAV } from "@/components/nav-items";
import { APPS, EFFECTS, MODELS, MOTIONS, getPreset } from "@/lib/catalog";
import { CAMERA_MOVES } from "@/lib/catalog/cinema";
import { LLM_PROVIDERS } from "@/lib/catalog/llm-providers";
import { TEMPLATES } from "@/lib/catalog/marketing";
import type { ModelDef } from "@/lib/catalog/types";
import type { Manifest } from "@/lib/comfy";
import { HUB_MODES } from "@/lib/hubs";
import { buildLicenceList } from "@/lib/licences";
import { modelHref } from "@/lib/palette-index";
import { cacheLife } from "next/cache";
import { toPresetCard } from "@/lib/preset-card-data";
import { onPeak, thumbOf, type PresetCardData } from "@/lib/preset-cards";

/**
 * The wall under the composer: the first pictures a visitor sees, each with what it does, in a line that fits a
 * phone's tile (HOME_CAPTION_MAX.wall).
 */
export const HOME_WALL = [
  { id: "effect-flame-on", kind: "Effect", caption: "Bursts into flame" },
  { id: "effect-powder-explosion", kind: "Effect", caption: "Colored powder bursts" },
  { id: "app-virtual-try-on", kind: "App · before → after", caption: "Any garment, on anyone" },
  { id: "motion-fpv-drone", kind: "Camera motion", caption: "Diving over the cove" },
  { id: "motion-low-shutter", kind: "Camera motion", caption: "Dreamy light trails" },
  { id: "effect-clone-explosion", kind: "Effect", caption: "Clones burst outward" },
  { id: "effect-angel-wings", kind: "Effect", caption: "Great wings unfold" },
  { id: "motion-glam", kind: "Camera motion", caption: "A slow arc in gold" },
] as const;

/** The longest caption a wall tile (a phone's, 136 px at 360) and a row's card (two lines) hold whole. */
export const HOME_CAPTION_MAX = { wall: 22, card: 40 };

/** Each card says in a few words what it does (the catalog's description stays its tooltip). */
export const HOME_EFFECTS = [
  { id: "effect-aquarium", caption: "The room floods into an aquarium" },
  { id: "effect-portal", caption: "A glowing portal pulls them in" },
  { id: "effect-building-explosion", caption: "The building behind them explodes" },
  { id: "effect-diamond", caption: "Their body turns to diamond" },
  { id: "effect-thunder-god", caption: "Lightning crackles around them" },
  { id: "effect-jelly-drift", caption: "Glowing jellyfish drift around them" },
  { id: "effect-earth-zoom-out", caption: "Zooms out from them to space" },
  { id: "effect-fallen-angel", caption: "Dark wings burst as they land" },
  { id: "effect-fire-element", caption: "Fire spirals up from their hands" },
  { id: "effect-water-splash", caption: "A huge wave crashes over them" },
  { id: "effect-raven-transition", caption: "Ravens burst out, then remake them" },
  { id: "effect-northern-lights", caption: "An aurora ripples across the sky" },
];

/** A phone's rail shows all twelve; a wider screen shows the first six (four from lg to xl), one row (home-sections.tsx). */
export const HOME_MOTIONS = [
  { id: "motion-bullet-time", caption: "Time freezes as the camera sweeps" },
  { id: "motion-mouth-in", caption: "A fast push in to the lips" },
  { id: "motion-car-chasing", caption: "Chasing the car at speed" },
  { id: "motion-360-orbit", caption: "A full circle around them" },
  { id: "motion-flying", caption: "Flying alongside through the air" },
  { id: "motion-crash-zoom-in", caption: "A crash zoom into the face" },
  { id: "motion-catwalk", caption: "Tracks them down the runway" },
  { id: "motion-crane-up", caption: "Rises above to reveal the scene" },
  { id: "motion-super-dolly-in", caption: "From a wide shot to a close-up, fast" },
  { id: "motion-action-run", caption: "Running backward as they sprint" },
  { id: "motion-through-object-in", caption: "Flies through the opening to them" },
  { id: "motion-lazy-susan", caption: "They turn as if on a turntable" },
];

/**
 * The before/after under Apps: the poster is the before, the peak frame the after. `zoom` enlarges both alike: the
 * sketch is a sheet of paper on white, and its edges would show.
 */
export const HOME_BEFORE_AFTER = [
  { id: "app-sketch-to-real", tags: ["Sketch", "Photo"], zoom: 1.22 },
  { id: "app-colorize", tags: ["Black & white", "Color"], zoom: 1.02 },
  { id: "app-style-transfer", tags: ["Photo", "Anime"], zoom: 1.02 },
] as const;

/** Apps whose clip wipes from before to after: at rest they show the after. */
export const HOME_REVEALS = [
  { id: "app-face-swap", caption: "A new face, same pose and light" },
  { id: "app-outfit-swap", caption: "Wear the outfit from any photo" },
  { id: "app-hairstyle-try-on", caption: "Try a new haircut or color" },
  { id: "app-relight", caption: "Change the light of any photo" },
  { id: "app-product-shot", caption: "Your product, relit in a new scene" },
  { id: "app-steal-the-look", caption: "Copy the style of a reference" },
];

/** Studio cards: a real cover (a clip, or Image to 3D's still) and one line each; Audio shows its tools instead of a picture. */
export const HOME_STUDIOS: { href: string; id?: string; line: (f: HomeFacts) => string }[] = [
  { href: "/cinema", id: "motion-arc-left", line: (f) => `Direct a film shot by shot: camera, lens, light and ${f.cinemaMoves} moves.` },
  { href: "/genjutsu", id: "effect-outfit-switch", line: () => "Keep a clip’s motion. Change what’s in it." },
  { href: "/character-swap", id: "app-character-swap", line: () => "Put your character into whole clips, shot by shot." },
  { href: "/marketing", id: "app-click-to-ad", line: (f) => `From a product link to a finished ad. ${f.adTemplates} ad templates.` },
  { href: "/mixed-media", id: "effect-scrapbook-collage", line: (f) => `Redraw a clip as collage, paper or paint, in ${f.mixedLooks} looks.` },
  { href: "/motion-control", id: "motion-moonwalk-left", line: () => "Give anyone the moves from any clip." },
  { href: "/audio", line: () => "Voices, music and sound for any clip, made or split apart." },
  { href: "/image-to-3d", id: "app-3d-rotation", line: () => "A photo or a sentence to a 3D model you can spin." },
];

/** Destinations with a section of their own on Home, so they aren't pills as well. */
export const HOME_OWN_SECTIONS = ["/assist", "/motions", "/effects", "/apps"];

/** Assist's starter skills, as its empty chat lists them first (assist-view.tsx). */
export const HOME_SKILLS = ["product-photoshoot", "ugc-video", "thumbnail-generation", "faceless-video", "short-film", "localization"];

/**
 * "Just added", newest first: only the ones in the catalog and not hidden show, so a model shows the day its
 * branch merges. Fewer than 6 left, the catalog's other new open models fill in.
 */
export const HOME_NEW_OPEN = [
  "oss-qwen-image-21",
  "oss-ideogram-4",
  "oss-krea2-realism",
  "oss-fibo2-dev",
  "oss-moss-image",
  "oss-ltx25",
  "oss-wan-move",
  "oss-void-remove",
  "oss-dbs-separate",
  "oss-trellis2",
  "oss-pixal3d",
  "oss-qwen-layered",
  "oss-stable-audio-3",
  "oss-triposplat",
];

/**
 * The chips under the composer. Each fills it with a prompt that looks like a cover on this page (Glam, FPV Drone
 * and Angel Wings on the wall, Relight under Apps); nothing runs until Start. The studio's owner gets Assist's chip in
 * place of the last (home-view.tsx): only the owner can use Assist.
 */
export const HOME_TRY = [
  {
    mode: "image",
    label: "Gold sequins on a sea cliff",
    prompt: "Editorial fashion photo of a model in a gold sequin dress and a flowing gold cape on a white cliff above a turquoise bay, golden hour",
  },
  {
    mode: "video",
    label: "Drone dive over a turquoise cove",
    prompt: "FPV drone dives off a limestone cliff and skims a turquoise cove past a white yacht, bright morning sun",
  },
  { mode: "edit", label: "Make it golden hour", prompt: "Make it golden hour: warm low sun, long soft shadows and a glowing sky" },
  {
    mode: "image",
    label: "Wings above the clouds",
    prompt: "Fashion portrait of a model in an ivory silk suit with vast white feathered wings, on a cliff above a sea of clouds at sunrise",
  },
] as const;

export interface HomeFacts {
  /** Open models with their ComfyUI workflow and licence (About & licences' count). */
  openModels: number;
  workflows: number;
  originals: number;
  /** Paid models through the viewer's own fal.ai or Replicate key. */
  partners: number;
  presets: number;
  apps: number;
  motions: number;
  effects: number;
  /** Every place to create from the sidebar: Create (but Home) and Studios. */
  destinations: number;
  cinemaMoves: number;
  adTemplates: number;
  mixedLooks: number;
  audioTools: number;
  skills: number;
}

/** "130+": the open models rounded down to ten, so it never overstates. */
export const roundedDown = (n: number) => `${Math.floor(n / 10) * 10}+`;

const isOpen = (m: ModelDef) => m.engine === "open" || !!m.engines?.includes("open");

/** A preset's card, resting on its peak frame when it has one (onPeak). */
export function homeCard(id: string): PresetCardData {
  const p = getPreset(id);
  if (!p) throw new Error(`Home names ${id}, which isn't in the catalog`);
  return onPeak(toPresetCard(p));
}

/** Where a preset's card opens: an app's own page, else the Video studio with it picked. */
export const presetHref = (id: string) => (id.startsWith("app-") ? `/apps/${id}` : `/video?preset=${id}`);

const navItems = (label: string) => NAV.find((g) => g.label === label)?.items ?? [];
const navLabel = (href: string) => [...navItems("Create"), ...navItems("Studios")].find((i) => i.href === href)?.label ?? href;

/** The sidebar's places to create, but Home. */
export const homeDestinations = () => [...navItems("Create"), ...navItems("Studios")].filter((i) => i.href !== "/");

/** The places to create that have no card or section of their own on Home, in the sidebar's order. */
export const homePills = () =>
  homeDestinations()
    .filter((i) => !HOME_OWN_SECTIONS.includes(i.href) && !HOME_STUDIOS.some((s) => s.href === i.href))
    .map((i) => ({ href: i.href, label: i.label }));

/** The Just added models: the list's live ones, then other new open models up to 6. */
export function newOpenModels(models: ModelDef[] = MODELS) {
  const live = (m: ModelDef | undefined): m is ModelDef => !!m && !m.hidden && isOpen(m);
  const listed = HOME_NEW_OPEN.map((id) => models.find((m) => m.id === id)).filter(live);
  const more =
    listed.length < 6
      ? models.filter((m) => live(m) && m.badges?.includes("new") && m.vendor !== "Fuobe Original" && !m.name.includes("(") && !listed.includes(m))
      : [];
  return [...listed, ...more].slice(0, 8).map((m) => ({ id: m.id, name: m.name, vendor: m.vendor, kind: m.kind, tagline: m.tagline, href: modelHref(m) }));
}

/** The Audio card's words: five of the studio's tools by name, then how many more it has. */
export function audioTools() {
  const named = ["speech", "dialogue", "music", "sfx", "split"].flatMap((id) => HUB_MODES.audio.filter((m) => m.id === id).map((m) => m.label));
  return { named, more: HUB_MODES.audio.length - named.length };
}

/** What Assist plans with: the hosted providers (6 by name, then how many more) and the local servers. */
export function assistRunsOn() {
  const hosted = LLM_PROVIDERS.filter((p) => p.group !== "local").map((p) => p.short);
  return { named: hosted.slice(0, 6), more: Math.max(0, hosted.length - 6), local: LLM_PROVIDERS.filter((p) => p.group === "local" && p.id !== "custom").map((p) => p.label) };
}

/** A JSON file's contents, or null when it's missing or unreadable (as the About page reads it). */
async function readJson<T>(text: Promise<string>): Promise<T | null> {
  try {
    return JSON.parse(await text) as T;
  } catch {
    return null;
  }
}

/** The skills folder: how many skills there are, and the starters' titles (each SKILL.md's metadata.title). */
async function readSkills() {
  const dir = path.join(process.cwd(), "skills");
  const names = await fs.readdir(dir, { withFileTypes: true }).then(
    (all) => all.filter((d) => d.isDirectory()).map((d) => d.name),
    () => [] as string[],
  );
  const has = await Promise.all(names.map((n) => fs.access(path.join(dir, n, "SKILL.md")).then(() => n, () => null)));
  const titles = await Promise.all(
    HOME_SKILLS.map(async (name) => {
      const text = await fs.readFile(path.join(dir, name, "SKILL.md"), "utf8").catch(() => "");
      return { name, title: /^\s+title:\s*(.+)$/m.exec(text)?.[1].trim() };
    }),
  );
  return { count: has.filter(Boolean).length, starters: titles.flatMap((t) => (t.title ? [{ name: t.name, title: t.title }] : [])) };
}

/** A row's card with its short line. */
const captioned = ({ id, caption }: { id: string; caption: string }) => ({ card: homeCard(id), caption });

/**
 * Everything Home shows below the composer, computed once per build (the page stays prerendered): all of it changes
 * only with a deploy, so it's kept for as long as Next keeps anything ("max").
 */
export async function homeShowcase() {
  "use cache";
  cacheLife("max");
  const [manifest, skills] = await Promise.all([
    readJson<Manifest>(fs.readFile(path.join(process.cwd(), "workflows", "comfyui", "manifest.json"), "utf8")),
    readSkills(),
  ]);
  const workflows = manifest?.workflows ?? [];
  const licences = buildLicenceList(
    MODELS.map((m) => ({ id: m.id, name: m.name, vendor: m.vendor, kind: m.kind, hidden: m.hidden, routes: m.routes.map((r) => ({ provider: r.provider, endpoint: r.endpoint })) })),
    workflows.map((w) => ({ id: w.id, title: w.title, capability: w.capability, license: w.license, models: w.models.map((m) => ({ url: m.url, sizeGb: m.sizeGb })) })),
  );
  const visible = MODELS.filter((m) => !m.hidden);
  const facts: HomeFacts = {
    openModels: licences.counts.all,
    workflows: workflows.length,
    originals: visible.filter((m) => m.vendor === "Fuobe Original").length,
    partners: visible.filter((m) => !isOpen(m)).length,
    presets: APPS.length + MOTIONS.length + EFFECTS.length,
    apps: APPS.length,
    motions: MOTIONS.length,
    effects: EFFECTS.length,
    destinations: homeDestinations().length,
    cinemaMoves: CAMERA_MOVES.length,
    adTemplates: TEMPLATES.length,
    mixedLooks: EFFECTS.filter((e) => e.category === "Mixed Media").length,
    audioTools: HUB_MODES.audio.length,
    skills: skills.count,
  };
  return {
    facts,
    wall: HOME_WALL.map((t) => ({ ...t, card: homeCard(t.id), href: presetHref(t.id) })),
    effects: HOME_EFFECTS.map(captioned),
    motions: HOME_MOTIONS.map(captioned),
    reveals: HOME_REVEALS.map(captioned),
    beforeAfter: HOME_BEFORE_AFTER.map(({ id, tags, zoom }) => {
      const card = homeCard(id);
      return { id, name: card.name, before: card.preview.poster, after: card.preview.rest?.src ?? card.preview.poster, thumb: thumbOf(card.preview.poster), tags: [...tags], zoom, href: presetHref(id) };
    }),
    studios: HOME_STUDIOS.map((s) => ({ href: s.href, label: navLabel(s.href), line: s.line(facts), card: s.id ? homeCard(s.id) : undefined })),
    audioTools: audioTools(),
    pills: homePills(),
    newModels: newOpenModels(),
    runsOn: assistRunsOn(),
    skills: skills.starters,
  };
}

export type HomeShowcase = Awaited<ReturnType<typeof homeShowcase>>;
