/**
 * The area pages: one page for each of the bar's menus that holds a family of things (Create, Studios, Apps, Motions &
 * effects), showing everything inside it as Home's "Studios and tools" section does. Pure data and helpers from the
 * navigation model (no React, no catalog), so the server's pages and the bar share them. ("Hub" already names the
 * Audio, Upscale and Video tools modes in src/lib/hubs.ts, so these are "areas".)
 *
 * Canvas, Assist and Library have no area page: each is one workspace whose own start screen already lists what it
 * holds (projects, the empty chat with its skills, the tabs).
 */
import {
  activeEntry,
  CREATE_COLUMNS,
  entry,
  LAUNCHER_GROUPS,
  launcherEntries,
  NAV_ENTRIES,
  studioSubs,
  visibleTo,
  type LauncherGroupId,
  type NavEntry,
  type NavIconName,
  type ViewerKind,
} from "./nav-model";

export type AreaId = "create" | "studios" | "apps" | "motions";

/** One section of an area page: its heading and line, the entries drawn as cover cards, then the rest as pills. */
export interface AreaSection {
  /** The section's anchor (#film) and its tab. */
  id: string;
  title: string;
  /** One sentence under the heading. */
  line: string;
  icon: NavIconName;
  /** NavEntry ids drawn as 4:3 cover cards, the section's lead first. */
  cards: string[];
  /** NavEntry ids drawn as pills under the cards. */
  chips: string[];
  /** What the section's studios hold inside (their tabs and modes): a row of pills per studio, under the rest. */
  subs?: { parent: string; ids: string[] }[];
}

export interface Area {
  id: AreaId;
  /** The area page. */
  href: string;
  /** The bar item's name. */
  label: string;
  /** The page's heading. */
  title: string;
  /** One sentence under the heading. */
  line: string;
  /** Its entry in the navigation model (search finds it; the bar marks it). Apps' is the Apps gallery itself. */
  entryId: string;
}

export const AREAS: readonly Area[] = [
  {
    id: "create",
    href: "/create",
    label: "Create",
    title: "Create",
    line: "Make a picture, a clip or a sound, or change one you already have.",
    entryId: "area-create",
  },
  {
    id: "studios",
    href: "/studios",
    label: "Studios",
    title: "Studios",
    // Home's own sentence for its studios, kept the same.
    line: "Whole productions, start to finish: films, ads, shoots and series. Open any of them to look around, no account needed.",
    entryId: "area-studios",
  },
  { id: "apps", href: "/apps", label: "Apps", title: "Apps", line: "One click changes one thing and keeps the rest.", entryId: "apps" },
  {
    id: "motions",
    href: "/motions-and-effects",
    label: "Motions & effects",
    title: "Motions & effects",
    line: "Camera moves a film crew would make, and effects from one photo.",
    entryId: "area-motions",
  },
];

export function area(id: AreaId): Area {
  const a = AREAS.find((x) => x.id === id);
  if (!a) throw new Error(`No area ${id}`);
  return a;
}

/** Each launcher group's line and icon (the goal row's icons) as a section of /studios. */
const GROUP_COPY: Record<LauncherGroupId, { line: string; icon: NavIconName }> = {
  film: { line: "Direct, plan, cut and finish films and clips.", icon: "Clapperboard" },
  social: { line: "Reels, channels and series made to be posted.", icon: "TrendingUp" },
  sell: { line: "Ads, product films and photo packs for what you sell.", icon: "ShoppingBag" },
  people: { line: "Characters, outfits and faces that stay the same in every shot.", icon: "UserRound" },
  sound: { line: "Voices, music and sound effects for anything you make.", icon: "AudioLines" },
  finish: { line: "Sharper, larger or in 3D: the last step before you share.", icon: "SlidersHorizontal" },
};

/** The tools (hub modes, a studio's own pages) of the given studios, in the model's order. */
const toolsOf = (parents: readonly string[]) => NAV_ENTRIES.filter((e) => e.kind === "tool" && !!e.parent && parents.includes(e.parent)).map((e) => e.id);

/** The studios whose modes are tools of their own (src/lib/hubs.ts): a mode is a pill, never a card or counted. */
const HUB_PARENTS = ["upscale", "audio", "video-tools"];

/**
 * Pages drawn as a pill wherever an area page lists them, never as a cover card: a drawn diagram or a plain product
 * still reads flat among the photos and clips, so the cover rows stay all real shots.
 */
export const PILL_ONLY: readonly string[] = ["canvas", "layers", "explainer", "virality"];

/**
 * /create's sections: the tools that make or change one thing (a picture, a clip, a sound). Each has one home: what is
 * a card here is a pill on /studios, and the whole productions (Katana, Genjutsu, Audio…) are cards on /studios and
 * pills here. Sound has no cards here: its studio and modes are /studios' Sound.
 */
function createSections(): AreaSection[] {
  const [make, editPicture] = CREATE_COLUMNS;
  // Make's own column, less what has a section of its own (Image and Video lead) and Assist (an item of the bar).
  const makeRest = make.ids.filter((id) => !["image", "video", "assist"].includes(id));
  return [
    {
      id: "make",
      title: make.label,
      line: "Start from words or a picture: a still, a clip, another angle or a 3D model.",
      icon: "Sparkles",
      cards: ["image", "video", "any-angle", "image-to-3d"],
      chips: makeRest,
    },
    {
      id: "edit-picture",
      title: editPicture.label,
      line: "Change a picture you already have, a little or a lot.",
      icon: "Wand2",
      cards: [...editPicture.ids],
      chips: [],
    },
    {
      id: "edit-clip",
      title: "Edit a clip",
      line: "Restyle, lengthen, reshape or sharpen a clip you have.",
      icon: "Scissors",
      cards: ["video-edit", "extend", "reframe", "upscale"],
      chips: ["katana", "motion-control", "character-swap", "genjutsu", "video-tools", ...toolsOf(["upscale"])],
    },
    {
      id: "sound",
      title: "Sound",
      line: "Voices, music and sound effects for anything you make.",
      icon: "AudioLines",
      cards: [],
      chips: ["audio", ...toolsOf(["audio"])],
    },
  ];
}

/** The pages that are a card on /create: a pill on /studios. */
const CREATE_CARDS: ReadonlySet<string> = new Set(createSections().flatMap((s) => s.cards));

/**
 * /studios' sections: one per launcher group, its studios as cards, then the ones whose card is on /create and Apps (a
 * page of its own) as pills, then what each studio holds inside (STUDIO_SUBS: its tabs and modes) as a row of its own.
 */
function studioSections(kind: ViewerKind | undefined): AreaSection[] {
  return LAUNCHER_GROUPS.map((g) => {
    const all = launcherEntries(kind, g.id).map((e) => e.id);
    const studios = all.filter((id) => id !== "apps");
    return {
      id: g.id,
      title: g.label,
      ...GROUP_COPY[g.id],
      cards: studios.filter((id) => !CREATE_CARDS.has(id)),
      chips: [...studios.filter((id) => CREATE_CARDS.has(id)), ...all.filter((id) => id === "apps")],
      subs: studios.map((parent) => ({ parent, ids: studioSubs(parent, kind).map((e) => e.id) })).filter((s) => s.ids.length > 0),
    };
  });
}

/** How many cards a section shows: 8 or 4, so every row of four is full; fewer than 4 makes it pills only. */
export const cardsToShow = (n: number) => (n >= 8 ? 8 : n >= 4 ? 4 : 0);

/**
 * An area's sections as this viewer sees them: only entries they may see, cards in `order` (premium first, see
 * rankCards) and only full rows of them (cardsToShow), the rest and the PILL_ONLY pages as the first pills, no pill that
 * repeats a card (a hub's first mode is the hub's own page), no pill twice, and no empty section. Apps and Motions &
 * effects draw from the catalog instead (their pages), so they have none here.
 */
export function areaSections(id: AreaId, kind: ViewerKind | undefined, order: (ids: string[]) => string[] = (ids) => ids): AreaSection[] {
  const raw = id === "create" ? createSections() : id === "studios" ? studioSections(kind) : [];
  const seen = (e: NavEntry | undefined): e is NavEntry => !!e && visibleTo(e, kind);
  return raw
    .map((s) => {
      const visible = s.cards.map(entry).filter(seen);
      const ranked = order(visible.filter((e) => !PILL_ONLY.includes(e.id)).map((e) => e.id));
      const shown = ranked.slice(0, cardsToShow(ranked.length));
      const cards = shown.map(entry).filter(seen);
      const cardHrefs = new Set(cards.map((e) => e.href));
      const rest = [...ranked.slice(shown.length), ...visible.filter((e) => PILL_ONLY.includes(e.id)).map((e) => e.id)];
      const chips = [...rest, ...s.chips]
        .map(entry)
        .filter(seen)
        .filter((e, i, list) => !cardHrefs.has(e.href) && list.findIndex((x) => x.href === e.href) === i);
      // A studio's features, less any that is a card or a pill of its own here (Ads Studio is a studio too).
      const listed = new Set([...cards, ...chips].map((e) => e.href));
      const subs = (s.subs ?? [])
        .filter((x) => seen(entry(x.parent)))
        .map((x) => ({ parent: x.parent, ids: x.ids.map(entry).filter(seen).filter((e) => !listed.has(e.href)).map((e) => e.id) }))
        .filter((x) => x.ids.length > 0);
      return { ...s, cards: cards.map((e) => e.id), chips: chips.map((e) => e.id), ...(s.subs && { subs }) };
    })
    .filter((s) => s.cards.length || s.chips.length);
}

/**
 * The number in an area's heading. Studios: its studios (the bar's "Studios 28"). Create: every page it shows, cards
 * and pills, but not a studio's modes or an action.
 */
export function areaCount(id: AreaId, kind: ViewerKind | undefined): number {
  const sections = areaSections(id, kind);
  const ids = new Set(sections.flatMap((s) => [...s.cards, ...s.chips]));
  const entries = [...ids].map(entry).filter((e): e is NavEntry => !!e);
  if (id === "studios") return entries.filter((e) => e.kind === "studio").length;
  return entries.filter((e) => e.kind !== "action" && !(e.kind === "tool" && e.parent && HUB_PARENTS.includes(e.parent))).length;
}

/**
 * Cards premium first: the section's lead stays first, the rest go by their cover's featured band (`band`, from
 * preset-featured.ts), keeping their order within a band. A card with no cover (drawn) keeps band 0.
 */
export function rankCards(ids: readonly string[], band: (cover: string) => number, coverOf: (id: string) => string | undefined = (id) => entry(id)?.cover): string[] {
  const [lead, ...rest] = ids;
  if (!lead) return [];
  const key = (id: string) => {
    const cover = coverOf(id);
    return cover ? band(cover) : 0;
  };
  return [lead, ...rest.map((id, i) => ({ id, i, b: key(id) })).sort((a, b) => a.b - b.b || a.i - b.i).map((x) => x.id)];
}

const NO_SEARCH = new URLSearchParams();

/**
 * The bar item that holds a page, one per page: Create for its tools (not Canvas or Assist, which have items of their
 * own), Studios for a studio and its tools, Apps for the apps, Motions & effects for both galleries; and each for its
 * own area page. None for Home, Canvas, Assist, Library and settings.
 */
export function areaOfPath(pathname: string): AreaId | undefined {
  const e = pathname ? activeEntry(pathname, NO_SEARCH) : undefined;
  if (!e) return undefined;
  const own = AREAS.find((a) => a.entryId === e.id);
  if (own) return own.id;
  if (e.id === "motions" || e.id === "effects") return "motions";
  if (e.kind === "create" && e.id !== "canvas" && e.id !== "assist") return "create";
  if (e.kind === "studio") return "studios";
  return undefined;
}

/** The area whose own page this is (/create, /studios, /apps, /motions-and-effects), or none. */
export function areaPageOf(pathname: string): AreaId | undefined {
  const path = pathname.replace(/\/$/, "") || "/";
  return AREAS.find((a) => a.href === path)?.id;
}
