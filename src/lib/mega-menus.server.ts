/**
 * The fetched menus (Apps, Motions & effects, Canvas) built from the catalog, the premium order and the covers, once
 * per build: /nav-menus/<id> serves them as static files. What a visitor may see only: no model names, no template
 * without a real cover, nothing owner-only (the owner's own boards come from /api/canvases, in the browser).
 *
 * The one hand-kept part is which catalog categories make each column; a test fails when a category is left out or
 * named twice. Everything else follows the data: columns in the order of their strongest preset (featuredAll), items
 * premium first, the lead the first item with its own cover.
 */
import "server-only";
import { APPS, EFFECTS, MOTIONS } from "@/lib/catalog";
import type { Preset } from "@/lib/catalog/types";
import { canvasIntro, templateCards } from "@/lib/canvas-template-cards";
import { templateSections, type Viewing } from "@/lib/canvas-sections";
import { coverFraming } from "@/lib/cover-framing";
import { HOME_EFFECTS, HOME_MOTIONS, presetHref } from "@/lib/home-showcase";
import type { MegaColumn, MegaCover, MegaItem, MegaModel } from "@/lib/mega-menus";
import { hasMini, miniOf } from "@/lib/preset-cards";
import { presetCover } from "@/lib/preset-covers";
import { presetStillSources } from "@/lib/preset-hd";
import { PRESET_MINIS } from "@/lib/preset-minis.generated";
import { featuredAll } from "@/lib/preset-featured";
import { templateCover } from "@/lib/template-covers";
import { templateStillSources } from "@/lib/template-hd";
import { MENU_LINES } from "@/lib/menu-lines";
import { fxSections } from "@/lib/area-showcase";
import { FX_SECTIONS, fxCover, isFxApp } from "@/lib/fx-tools";
import { fxView } from "@/lib/fx-compare";
import { entry } from "@/lib/nav-model";

/** A column of a preset menu: its name, its phone chip, and the catalog categories it holds. */
export interface PresetGroup {
  id: string;
  label: string;
  chip: string;
  categories: readonly string[];
}

export const APP_GROUPS: readonly PresetGroup[] = [
  { id: "camera", label: "Camera & light", chip: "Camera", categories: ["Camera"] },
  { id: "product", label: "Product & ads", chip: "Product", categories: ["Product"] },
  { id: "restyle", label: "Restyle & fix", chip: "Restyle", categories: ["Style", "Utility"] },
  { id: "people", label: "People & fashion", chip: "People", categories: ["Identity", "Fashion"] },
  // Apps that take no photo (a video, a voice) join the video apps: menuCategory.
  { id: "video", label: "Video & sound", chip: "Video", categories: ["Video"] },
  { id: "fun", label: "Just for fun", chip: "Fun", categories: ["Fun"] },
];

export const MOTION_GROUPS: readonly PresetGroup[] = [
  { id: "push", label: "Push, pull & pan", chip: "Push & pan", categories: ["Push & Pull", "Lateral"] },
  { id: "orbit", label: "Orbit, crane & drone", chip: "Orbit & drone", categories: ["Orbit", "Vertical", "Drone & Vehicle"] },
  { id: "handheld", label: "Handheld, speed & styles", chip: "Handheld", categories: ["Handheld & POV", "Time & Focus", "Camera Styles", "Action & Sports", "Transitions"] },
];

export const EFFECT_GROUPS: readonly PresetGroup[] = [
  { id: "blockbuster", label: "Blockbuster & magic", chip: "Blockbuster", categories: ["Blockbuster", "Elements", "Magic", "Transform", "Destruction", "Scale", "Horror", "Nature"] },
  { id: "viral", label: "Viral & social", chip: "Viral", categories: ["Viral", "UGC", "Playful", "Commercial", "Transitions"] },
  { id: "looks", label: "Looks, grades & light", chip: "Looks", categories: ["Mixed Media", "Color Grade", "Stylize", "Relight"] },
];

/**
 * The category a preset is grouped by in the menus: its catalog category, except that an app taking no photo (only a
 * video or a voice) counts as a video app, so "Restyle & fix" holds photo apps only.
 */
export function menuCategory(p: Pick<Preset, "type" | "category" | "inputs">): string {
  const inputs = p.inputs ?? [];
  if (p.type === "app" && inputs.length > 0 && inputs.every((i) => i.accept !== "image")) return "Video";
  return p.category;
}

/**
 * Presets that are the same idea under another name ("Angles", "Fuobe Angles", "Any Angle"): one key, so a column
 * shows only the strongest of them.
 */
export const sameIdea = (name: string) =>
  name
    .toLowerCase()
    .replace(/^(?:fuobe|any|the)\s+/, "")
    .replace(/s$/, "");

/** Home's own captions, the line a preset gets where it has one. */
const CAPTIONS = new Map<string, string>([...HOME_MOTIONS, ...HOME_EFFECTS].map((r) => [r.id, r.caption]));

/** The longest line a menu row or lead card shows: one line of a row (about 26 characters at 12 px), as Studios' lines are. */
export const LINE_MAX = 26;

/** Words a cut line never ends on (it would read as cut off). */
const LOOSE_END = /\s+(?:a|an|the|and|or|but|of|to|into|onto|in|on|at|with|for|from|by|as|your|their|its|his|her|while|that|which|so|then|is|are|up|out|over|through|around|across|like|until|than|each|every|any|it)$/i;

/**
 * A line short enough for one row: the first sentence, without a leading "Name:" or "The camera"/"The subject", then
 * as many whole clauses as fit, else whole words, never ending on a loose word. No "…": it reads as a whole phrase.
 */
export function shortLine(text: string, max = LINE_MAX): string {
  let s = (text.split(/\.\s/)[0] ?? text).trim().replace(/[.…]+$/, "");
  s = s.replace(/^[A-Z][\w'’ -]{1,20}:\s+(?=[a-z])/, "");
  s = s.replace(/^the (?:camera|subject)\s+(?!is\b|has\b|was\b)/i, "");
  const up = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  if (s.length <= max) return up(s);
  // The most whole clauses that fit (a clause ends at a comma, a semicolon, a colon, a bracket or a dash).
  const ends = [...s.matchAll(/\s*[,;:(—–]\s*|\s+-\s+/g)].map((m) => m.index).filter((i) => i >= 12 && i <= max);
  if (ends.length) return up(s.slice(0, Math.max(...ends)));
  const first = s.split(/\s*[,;:(—–]\s*|\s+-\s+/)[0] ?? s;
  const clause = first.length >= 12 ? first : s;
  let cut = clause.slice(0, max + 1);
  cut = cut.slice(0, Math.max(cut.lastIndexOf(" "), 0)) || clause.slice(0, max);
  while (LOOSE_END.test(cut)) cut = cut.replace(LOOSE_END, "");
  return up(cut.replace(/[,;:]$/, ""));
}

/** A preset's line in the menus: its own short line (MENU_LINES), Home's caption, else its description, made short. */
export function presetLine(p: Pick<Preset, "id" | "description">): string {
  return MENU_LINES[p.id] ?? shortLine(CAPTIONS.get(p.id) ?? p.description);
}

/** A preset's own cover (never another shot's stand-in), with its small copies (the mini when made from this poster) and framing. */
export function presetMegaCover(id: string): MegaCover | undefined {
  const c = presetCover(id);
  if (!c || !hasOwnCover(id)) return undefined;
  const framing = coverFraming(c.poster);
  return { poster: c.poster, thumb: c.thumb, ...(hasMini(c.poster) && PRESET_MINIS[id] && { mini: miniOf(c.poster) }), ...(framing && { framing }) };
}

/** Whether a preset has a cover of its own (presetCover gives another shot's to a few: SAME_SHOT). */
export const hasOwnCover = (id: string) => !!presetCover(id)?.poster.startsWith(`/previews/presets/${id}.jpg`);

/** An item with its cover's clip, which plays over the still while its tile is on screen or pointed at. */
function withClip(e: MegaItem): MegaItem {
  const clip = e.cover && presetCover(e.id)?.video;
  return clip ? { ...e, cover: { ...e.cover!, clip } } : e;
}

const presetItem = (p: Preset): MegaItem => withClip({ id: p.id, href: presetHref(p.id), label: p.name, line: presetLine(p), cover: presetMegaCover(p.id) });

/**
 * One column per group: every one of its presets, premium first (featuredAll), the first with a cover of its own as the
 * lead. Columns in the order of their strongest preset. The menu shows all of them (it scrolls inside), so a visitor
 * finds every app, motion and effect from the bar.
 */
export function presetColumns(items: readonly Preset[], groups: readonly PresetGroup[], family?: string): MegaColumn[] {
  const ranked = featuredAll(items);
  const inGroup = (g: PresetGroup) => (p: Preset) => g.categories.includes(menuCategory(p));
  const firstAt = (g: PresetGroup) => ranked.findIndex(inGroup(g));
  return [...groups]
    .sort((a, b) => firstAt(a) - firstAt(b))
    .map((g) => {
      const mine = ranked.filter(inGroup(g));
      const lead = mine.find((p) => hasOwnCover(p.id)) ?? mine[0];
      const rest = mine.filter((p) => p !== lead);
      return {
        id: g.id,
        label: g.label,
        chip: g.chip,
        ...(family && { family }),
        ...(lead && { lead: presetItem(lead) }),
        rows: rest.map(presetItem),
      };
    });
}

export function appsMenu(): MegaModel {
  return {
    id: "apps",
    count: APPS.length,
    countLine: `${APPS.length} apps, grouped by what they change`,
    seeAll: { href: "/apps", name: "See all apps" },
    columns: presetColumns(APPS, APP_GROUPS),
  };
}

export function motionsMenu(): MegaModel {
  return {
    id: "motions",
    count: MOTIONS.length + EFFECTS.length,
    countLine: `${MOTIONS.length} camera motions and ${EFFECTS.length} effects, for any photo`,
    seeAll: { href: "/motions-and-effects", name: "See all motions and effects" },
    families: [
      { id: "motions", label: "Camera motions", count: MOTIONS.length, href: "/motions", span: MOTION_GROUPS.length },
      { id: "effects", label: "Effects", count: EFFECTS.length, href: "/effects", span: EFFECT_GROUPS.length },
    ],
    columns: [...presetColumns(MOTIONS, MOTION_GROUPS, "motions"), ...presetColumns(EFFECTS, EFFECT_GROUPS, "effects")],
  };
}

/** Who the Canvas menu is for: a visitor (the owner sees the same boards: menus show real covers only). */
const VISITOR: Viewing = { visitor: true, hasCover: (id) => !!templateCover("canvas", id) };

/**
 * A template cover as a menu tile shows it: its peak frame (the finished scene), with its larger copies (the preset's
 * peak frame's, or the tile's own poster's), so a 2x or 3x screen gets one at least as wide as the box, and its clip
 * from that frame on (clipAt), which plays while the tile is pointed at.
 */
function templateMegaCover(id: string): MegaCover | undefined {
  const c = templateCover("canvas", id);
  if (!c) return undefined;
  const framing = coverFraming(c.poster);
  const hd = presetStillSources(c.poster, c.thumb) ?? templateStillSources(c.poster, c.thumb);
  return { poster: c.poster, thumb: c.thumb, ...(hd && { hd }), ...(framing && { framing }), ...(c.video && { clip: c.video, ...(c.at !== undefined && { clipAt: c.at }) }) };
}

/**
 * The ready boards a visitor can open, by section: every one with a real cover (the menu scrolls inside). "What's a canvas?" leads, with the board the
 * /canvas explainer shows, which the tiles then leave out. The owner's first column (New board, their recent boards)
 * replaces it in the browser (`owner`).
 */
export function canvasMenu(): MegaModel {
  const sections = templateSections(templateCards(), VISITOR);
  const n = sections.reduce((sum, s) => sum + s.items.length, 0);
  const intro = canvasIntro();
  const introCover = intro && templateMegaCover(intro.templateId);
  const shown = sections.map((s) => ({ ...s, items: s.items.filter((t) => !introCover || t.id !== intro?.templateId) })).filter((s) => s.items.length > 0);
  return {
    id: "canvas",
    count: n,
    countLine: `${n} ready boards that run as they are`,
    seeAll: { href: "/canvas", name: "See all of Canvas" },
    columns: [
      {
        id: "start",
        label: "Start here",
        chip: "Start",
        span: 2,
        owner: "canvas-start",
        lead: {
          id: "whats-a-canvas",
          href: "/canvas",
          label: "What's a canvas?",
          line: "Your photo, a scene, a film",
          icon: "Network",
          ...(introCover && { cover: introCover }),
        },
        rows: [],
      },
      ...shown.map(
        (s, i): MegaColumn => ({
          id: s.key || "films",
          label: s.title,
          chip: s.title,
          variant: "tiles",
          span: 4,
          rows: s.items.map((t) => ({ id: t.id, href: `/canvas/start/${t.id}`, label: t.name, line: MENU_LINES[t.id] ?? shortLine(t.description), icon: "Network", cover: templateMegaCover(t.id) })),
          // The last section's label row ends on "See all": every ready board on /canvas.
          ...(i === shown.length - 1 && { more: { href: "/canvas?tab=templates", label: "See all ready boards" } }),
        }),
      ),
    ],
  };
}

/** A Fuobe FX item as a menu row: a navigation entry with its nav cover, or an app with its own cover. */
function fxMenuItem(id: string): MegaItem | undefined {
  if (isFxApp(id)) {
    const p = APPS.find((a) => a.id === id);
    return p && presetItem(p);
  }
  const e = entry(id);
  if (!e) return undefined;
  // A mode shows the preset whose picture shows its job (inline: the nav's own covers don't carry it); else the entry's.
  const mine = fxCover(id);
  const own = mine ? presetMegaCover(mine) : undefined;
  const nav = own ? undefined : (mine ?? e.cover);
  const fx = fxView(id);
  return {
    id,
    href: e.href,
    label: e.label,
    // Its line as the Studios menu gives it (34 characters at most; CSS fits it to the row).
    line: e.what,
    icon: e.icon,
    ...(own && { cover: presetCover(mine!)?.video ? { ...own, clip: presetCover(mine!)!.video! } : own }),
    ...(nav && { navCover: nav }),
    ...(fx && { fx }),
    ...(e.short && { short: e.short }),
    ...(e.newUntil && { newUntil: e.newUntil }),
  };
}

/**
 * Fuobe FX as a menu: a column per section (src/lib/fx-tools.ts), its first card as the lead and then its other cards
 * and its pills, every one (the menu scrolls inside). What a visitor sees: the owner's own modes are left
 * to the page.
 */
export function fxMenu(): MegaModel {
  const sections = fxSections(undefined);
  // A mode whose name another tool here has too ("Character swap", Genjutsu's and the studio) is named with its studio.
  const names = sections.flatMap((s) => [...s.cards, ...s.pills]).map((id) => fxMenuItem(id)?.label.toLowerCase());
  const named = (e: MegaItem): MegaItem => {
    const parent = entry(e.id)?.parent;
    return parent && names.filter((n) => n === e.label.toLowerCase()).length > 1 ? { ...e, label: `${entry(parent)!.label} · ${e.label}` } : e;
  };
  const n = new Set(sections.flatMap((s) => [...s.cards, ...s.pills].map((id) => fxMenuItem(id)?.href))).size;
  return {
    id: "fx",
    count: n,
    countLine: `${n} tools for FX artists and teams, by stage of the shot`,
    seeAll: { href: "/fx", name: "See all of Fuobe FX" },
    columns: sections.map((s): MegaColumn => {
      const items = [...s.cards, ...s.pills]
        .map(fxMenuItem)
        .filter((x): x is MegaItem => !!x)
        .map(named);
      // The lead card is the first with a picture (a section of pills only leads with its first tool that has one).
      const lead = items.find((x) => x.cover || x.navCover) ?? items[0];
      // Rows show their small cover: only the lead card shows a before and after, so only it carries one.
      const rest = items.filter((x) => x !== lead).map((x) => (x.fx ? { ...x, fx: undefined } : x));
      return { id: s.id, label: s.title, chip: FX_SECTIONS.find((x) => x.id === s.id)!.chip, ...(lead && { lead }), rows: rest };
    }),
  };
}

export const SERVER_MENUS = { apps: appsMenu, motions: motionsMenu, canvas: canvasMenu, fx: fxMenu } as const;
