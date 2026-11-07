/**
 * What an area page (/create, /studios) shows, ready to draw: each section's cards with their covers and lines, and
 * its pills. Read once per build from the navigation model, the catalog's covers and Home's own lines, so the page
 * stays prerendered and gets slim card data only (no prompts, no recipes). Server only.
 */
import "server-only";
import { cacheLife } from "next/cache";
import { APPS, EFFECTS, MOTIONS } from "@/lib/catalog";
import { FX_SECTIONS, fxCardable, fxCover, isFxApp } from "@/lib/fx-tools";
import { fxView, type FxView } from "@/lib/fx-compare";
import { HOME_EFFECTS, HOME_MOTIONS, HOME_STUDIOS, homeCard, homeShowcase, presetHref, type HomeFacts } from "@/lib/home-showcase";
import { areaCount, areaSections, cardsToShow, PILL_ONLY, rankCards, type AreaId } from "@/lib/nav-areas";
import { entry, NAV_ENTRIES, subLabel, visibleTo, type NavEntry, type ViewerKind } from "@/lib/nav-model";
import type { PresetCardData } from "@/lib/preset-cards";
import { featuredAll, featuredBand } from "@/lib/preset-featured";

/** How a card without a cover is drawn: Live edit plays its recorded session. */
export type AreaDrawn = "live";

export interface AreaCard {
  id: string;
  href: string;
  label: string;
  line: string;
  /** Its cover, as Home's cards get it. */
  card?: PresetCardData;
  drawn?: AreaDrawn;
  /** A Fuobe FX item's before and after, shown in place of its cover (the items with a pair: fx-pairs.generated.ts). */
  fx?: FxView;
}

export interface AreaPill {
  id: string;
  href: string;
  label: string;
  icon: string;
}

export interface AreaShowcaseSection {
  id: string;
  title: string;
  line: string;
  icon: string;
  cards: AreaCard[];
  /** What everyone sees. */
  pills: AreaPill[];
  /** Added for the studio's owner only, by a client island (OwnerPills), so the server's HTML never holds them. */
  ownerPills: AreaPill[];
  /**
   * What the section's studios hold inside, a row per studio: its features everyone sees, and the ids of the owner's
   * own (added by OwnerPills). A studio with only the owner's has no pills and its row is the owner's alone.
   */
  subs: { parent: AreaPill; pills: AreaPill[]; ownerIds: string[] }[];
}

const DRAWN: Record<string, AreaDrawn> = { "live-edit": "live" };

/** Home's line for a page it has a card for, else the model's card line (a test checks every card has one). */
function lineOf(e: NavEntry, facts: HomeFacts): string {
  const home = HOME_STUDIOS.find((s) => s.href === e.href);
  return home ? home.line(facts) : (e.line ?? e.what);
}

const pill = (e: NavEntry): AreaPill => ({ id: e.id, href: e.href, label: e.label, icon: e.icon });
/** A feature as a pill under its studio: its tab's name. */
const subPill = (e: NavEntry): AreaPill => ({ ...pill(e), label: subLabel(e) });

/**
 * A card's cover: Home's for a page Home has a card for (so a studio looks the same in both places), unless another
 * page already uses that picture as its own; else the navigation's.
 */
export function areaCover(id: string): string | undefined {
  const e = entry(id);
  if (!e) return undefined;
  const home = HOME_STUDIOS.find((s) => s.href === e.href)?.id;
  if (home && !NAV_ENTRIES.some((x) => x.id !== e.id && x.cover === home)) return home;
  return e.cover;
}

/**
 * Cards premium first: the section's lead, then (in a section of studios) the ones Home picks for its own cards, then the
 * rest by the featured band of the cover they show (rankCards). A section shows only its first full row or two, so this
 * decides which.
 */
export function premiumFirst(ids: string[]): string[] {
  const [lead, ...rest] = rankCards(ids, featuredBand, areaCover);
  if (!lead) return [];
  if (entry(lead)?.kind !== "studio") return [lead, ...rest];
  const onHome = (id: string) => HOME_STUDIOS.some((h) => h.href === entry(id)?.href);
  return [lead, ...rest.filter(onHome), ...rest.filter((id) => !onHome(id))];
}

/**
 * An area page's sections as a guest sees them (the server's render is the same for everyone), each card premium first
 * (rankCards: the featured band of its cover), with the owner's extra pills apart.
 */
export async function areaShowcase(id: AreaId) {
  "use cache";
  cacheLife("max");
  const { facts } = await homeShowcase();
  const owner = areaSections(id, "owner", premiumFirst);
  const sections: AreaShowcaseSection[] = areaSections(id, undefined, premiumFirst).map((s) => {
    const ownerOnly = (owner.find((o) => o.id === s.id)?.chips ?? []).filter((c) => !s.chips.includes(c));
    const cards = s.cards.map((cid): AreaCard => {
      const e = entry(cid);
      if (!e) throw new Error(`The ${id} area names ${cid}, which isn't in the navigation`);
      const cover = areaCover(cid);
      return {
        id: e.id,
        href: e.href,
        label: e.label,
        line: lineOf(e, facts),
        ...(cover ? { card: homeCard(cover) } : { drawn: DRAWN[e.id] }),
      };
    });
    const entries = (ids: string[]) => ids.map(entry).filter((e): e is NavEntry => !!e);
    const guestSubs = s.subs ?? [];
    const subs = (owner.find((o) => o.id === s.id)?.subs ?? []).flatMap((o) => {
      const parent = entry(o.parent);
      if (!parent) return [];
      const everyone = guestSubs.find((g) => g.parent === o.parent)?.ids ?? [];
      return [{ parent: pill(parent), pills: entries(everyone).map(subPill), ownerIds: o.ids.filter((x) => !everyone.includes(x)) }];
    });
    return {
      id: s.id,
      title: s.title,
      line: s.line,
      icon: s.icon,
      cards,
      pills: entries(s.chips).map(pill),
      ownerPills: entries(ownerOnly)
        .filter((e) => visibleTo(e, "owner"))
        .map(pill),
      subs,
    };
  });
  return { count: areaCount(id, undefined), sections };
}

export type AreaShowcase = Awaited<ReturnType<typeof areaShowcase>>;

/** One Fuobe FX item resolved: a navigation entry or a one-click app, with its cover (a preset id) when it has one. */
interface FxItem {
  id: string;
  href: string;
  label: string;
  line: string;
  icon: string;
  cover?: string;
  /** It may be a card here: an FX studio or one of its modes (the rest have their card elsewhere). */
  cardable: boolean;
  /** Who may see it (the navigation's rule; an app is everyone's). */
  visible: (kind: ViewerKind | undefined) => boolean;
}

/** An app's line: its description's first sentence, with a full stop. */
const appLine = (description: string) => {
  const first = (description.split(/\.\s/)[0] ?? description).trim().replace(/[.…]+$/, "");
  return `${first}.`;
};

/** A Fuobe FX item by its id (src/lib/fx-tools.ts): a navigation entry or an app; undefined when neither exists. */
export function fxItem(id: string, facts?: HomeFacts): FxItem | undefined {
  if (isFxApp(id)) {
    const p = APPS.find((a) => a.id === id);
    if (!p) return undefined;
    return { id, href: presetHref(id), label: p.name, line: appLine(p.description), icon: "LayoutGrid", cardable: false, visible: () => true };
  }
  const e = entry(id);
  if (!e) return undefined;
  const cover = fxCover(id) ?? areaCover(id);
  const line = facts ? lineOf(e, facts) : (e.line ?? e.what);
  return {
    id,
    href: e.href,
    label: e.label,
    // A mode's card says what it does in a sentence, as the studios' lines do.
    line: /[.!?]$/.test(line) ? line : `${line}.`,
    icon: e.icon,
    ...(cover && { cover }),
    cardable: fxCardable(id, e),
    visible: (kind) => visibleTo(e, kind),
  };
}

/**
 * Fuobe FX's sections as a viewer sees them: in each, the items with a cover as cards (the lead first, then premium
 * first by their cover's featured band, only full rows: cardsToShow), each cover once on the page, and the rest as
 * pills; no link twice in a section. Ids only, so the page and the tests share it.
 */
export function fxSections(kind: ViewerKind | undefined, facts?: HomeFacts) {
  const used = new Set<string>();
  return FX_SECTIONS.map((s) => {
    const items = s.items.map((id) => fxItem(id, facts)).filter((it): it is FxItem => !!it && it.visible(kind));
    const covered = items.filter((it) => it.cardable && it.cover && !PILL_ONLY.includes(it.id) && !used.has(it.cover));
    const ranked = rankCards(
      covered.map((it) => it.id),
      featuredBand,
      (id) => covered.find((it) => it.id === id)?.cover,
    );
    const cards = ranked.slice(0, cardsToShow(ranked.length));
    for (const id of cards) used.add(covered.find((it) => it.id === id)!.cover!);
    const cardHrefs = new Set(cards.map((id) => items.find((it) => it.id === id)!.href));
    const seen = new Set<string>();
    const pills = items
      .filter((it) => !cards.includes(it.id))
      .filter((it) => {
        if (cardHrefs.has(it.href) || seen.has(it.href)) return false;
        seen.add(it.href);
        return true;
      })
      .map((it) => it.id);
    return { ...s, cards, pills };
  }).filter((s) => s.cards.length || s.pills.length);
}

/**
 * /fx: Fuobe FX's sections ready to draw (as areaShowcase's), with the owner's extra pills apart, and the count of the
 * different pages it links.
 */
export async function fxShowcase() {
  "use cache";
  cacheLife("max");
  const { facts } = await homeShowcase();
  const owner = fxSections("owner", facts);
  const pillOf = (id: string): AreaPill => {
    const it = fxItem(id, facts)!;
    return { id: it.id, href: it.href, label: it.label, icon: it.icon };
  };
  const sections: AreaShowcaseSection[] = fxSections(undefined, facts).map((s) => {
    const ownerOnly = (owner.find((o) => o.id === s.id)?.pills ?? []).filter((p) => !s.pills.includes(p) && !s.cards.includes(p));
    return {
      id: s.id,
      title: s.title,
      line: s.line,
      icon: s.icon,
      cards: s.cards.map((id): AreaCard => {
        const it = fxItem(id, facts)!;
        // A mode is named with its studio ("Genjutsu · Insert"), so it reads apart from the studios beside it.
        const parent = entry(id)?.parent;
        const label = parent && entry(parent) ? `${entry(parent)!.label} · ${it.label}` : it.label;
        // An item with a before and after shows them in place of its cover (the cover still ranks it: premium first).
        const fx = fxView(id);
        return { id: it.id, href: it.href, label, line: it.line, card: homeCard(it.cover!), ...(fx && { fx }) };
      }),
      pills: s.pills.map(pillOf),
      ownerPills: ownerOnly.map(pillOf),
      subs: [],
    };
  });
  const count = new Set(sections.flatMap((s) => [...s.cards, ...s.pills].map((x) => x.href))).size;
  return { count, sections };
}

/**
 * /motions-and-effects' wall: four camera motions and four effects from the top of the featured order, alternating,
 * each with what its cover shows in a line that fits a phone's tile (Home's rows say the same things at more length).
 */
export const MOTIONS_AREA_WALL = [
  { id: "motion-dolly-in", kind: "Camera motion", caption: "Into the library" },
  { id: "effect-levitation", kind: "Effect", caption: "Floating off the dune" },
  { id: "motion-helicopter-shot", kind: "Camera motion", caption: "Circles the castle" },
  { id: "effect-nature-bloom", kind: "Effect", caption: "A station in bloom" },
  { id: "motion-super-dolly-out", kind: "Camera motion", caption: "Out to the valley" },
  { id: "effect-lens-flare", kind: "Effect", caption: "An anamorphic flare" },
  { id: "motion-slow-motion", kind: "Camera motion", caption: "Droplets, slowed down" },
  { id: "effect-wind-to-face", kind: "Effect", caption: "Swept by a gale" },
] as const;

/** How many presets each row on /motions-and-effects shows (two rows of four from sm; a phone's rail). */
export const MOTIONS_AREA_ROW = 8;

/** The longest line under a preset on /motions-and-effects: two lines of a card four a row, never cut short. */
export const MOTIONS_AREA_LINE_MAX = 60;

/**
 * A preset's line on /motions-and-effects: Home's caption, else its description's first sentence or clause when that
 * fits whole, else what kind of preset it is (
oun: "effect", "move").
 */
export function shortLine(p: { id: string; description: string; category: string }, noun: string, captions: ReadonlyMap<string, string>): string {
  const home = captions.get(p.id);
  if (home) return home;
  const first = p.description.split(/[.;:]\s|,\s/)[0]?.replace(/[.;:,]$/, "").trim();
  if (first && first.length <= MOTIONS_AREA_LINE_MAX) return first;
  return `${p.category} ${noun}`;
}

/** A gallery's categories, the ones its featured presets lead with first (the strongest first). */
function categoriesByFeatured(items: readonly { id: string; category: string }[]): string[] {
  return [...new Set(featuredAll(items).map((p) => p.category))];
}

/**
 * /motions-and-effects: the wall, then each gallery's first presets by the featured order (not on the wall), its
 * categories strongest first, and its count. Each with a short line that shows whole (shortLine).
 */
export async function motionsAreaShowcase() {
  "use cache";
  cacheLife("max");
  const captions = new Map<string, string>([...HOME_MOTIONS, ...HOME_EFFECTS].map((r) => [r.id, r.caption]));
  const onWall = new Set<string>(MOTIONS_AREA_WALL.map((t) => t.id));
  const row = (items: typeof MOTIONS, noun: string) =>
    featuredAll(items)
      .filter((p) => !onWall.has(p.id))
      .slice(0, MOTIONS_AREA_ROW)
      .map((p) => ({ card: homeCard(p.id), caption: shortLine(p, noun, captions) }));
  return {
    wall: MOTIONS_AREA_WALL.map((t) => ({ ...t, card: homeCard(t.id), href: presetHref(t.id) })),
    motions: { count: MOTIONS.length, row: row(MOTIONS, "move"), categories: categoriesByFeatured(MOTIONS) },
    effects: { count: EFFECTS.length, row: row(EFFECTS, "effect"), categories: categoriesByFeatured(EFFECTS) },
  };
}

/** /apps' Start here (Home's Apps section) and the apps it shows, which the gallery under it leaves out of All. */
export async function appsAreaShowcase() {
  "use cache";
  cacheLife("max");
  const home = await homeShowcase();
  return {
    facts: home.facts,
    beforeAfter: home.beforeAfter,
    reveals: home.reveals,
    shown: [...home.beforeAfter.map((b) => b.id), ...home.reveals.map((r) => r.card.id)],
  };
}
