import { ChevronLeft, Plus } from "lucide-react";
import { DestinationsSection, HomeFooter, SectionHead } from "@/components/home/home-sections";
import { PILL, PILL_ICON, PILL_TAP } from "@/components/home/pill";
import { IntentLink } from "@/components/intent-link";
import { PageShell } from "@/components/page-shell";
import type { AreaShowcase } from "@/lib/area-showcase";
import { AREAS, area, type AreaId } from "@/lib/nav-areas";
import { navIcon } from "@/lib/nav-icons";
import { entry, type NavEntry } from "@/lib/nav-model";
import { cn } from "@/lib/utils";
import { AreaSearch, AreaTabs, JumpBackIn, OwnerPills, OwnerSubRow, type AreaTab } from "./area-islands";

/*
 * An area page: everything one of the bar's menus holds, as Home shows its studios (src/components/home/home-sections.tsx,
 * DestinationsSection). A heading with the count and a line, tabs to the sections that stay under the bar, then the
 * sections, "Jump back in" for someone signed in, and the other areas at the end. Server HTML; the islands are in
 * area-islands.tsx.
 */

/**
 * Each section's space under the one before, as Home's (without Home's content-visibility, which needs a known height).
 * A jump to it stops under the bar and the tabs: the phone's bar and the tabs (108 px), 8 px of air and the notch; from md the page
 * already keeps the bar's 56 px clear (scroll-padding), so the tabs' 52 px and 8 px of air.
 */
export const AREA_SECTION = "-mx-4 mt-8 -mb-2 scroll-mt-[calc(7.25rem+env(safe-area-inset-top))] px-4 py-2 sm:mt-12 md:scroll-mt-[60px]";

/** The area page's heading: its name and count, its line, and its search (Create, Studios) beside it, or under it on a phone. */
export function AreaHero({ id, count, search, action }: { id: AreaId; count: number; search?: string[]; action?: React.ReactNode }) {
  const a = area(id);
  return (
    <header>
      <SectionHead as="h1" id="area-title" title={a.title} count={count} line={a.line}>
        {(search || action) && (
          <div className="flex shrink-0 items-center gap-2 max-sm:hidden">
            {search && <AreaSearch id={id} ids={search} className="sm:w-[240px] lg:w-[280px]" />}
            {action}
          </div>
        )}
      </SectionHead>
      {(search || action) && (
        <div className="-mt-1 mb-1 flex items-center gap-2 sm:hidden">
          {search && <AreaSearch id={id} ids={search} className="min-w-0 flex-1" />}
          {action}
        </div>
      )}
    </header>
  );
}

/** Create's one way to start: a fresh composer (each tool is a card below). 44 px, and 40 beside the search from sm. */
export function NewCreation() {
  const e = entry("new");
  if (!e) return null;
  return (
    <IntentLink
      href={e.href}
      className="inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-primary pr-5 pl-4 text-[14px] font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-safe:transition-colors sm:h-10"
    >
      <Plus aria-hidden className="size-[18px]" />
      {e.label}
    </IntentLink>
  );
}

/** The tabs for an area's sections: links to them on this page. */
export const sectionTabs = (sections: AreaShowcase["sections"]): AreaTab[] => sections.map((s) => ({ href: `#${s.id}`, label: s.title, icon: s.icon, section: s.id }));

/** Every page an area shows, for its search and "Jump back in". */
export const areaIds = (sections: AreaShowcase["sections"]) => [...new Set(sections.flatMap((s) => [...s.cards.map((c) => c.id), ...s.pills.map((p) => p.id)]))];

/**
 * The tabs and what they jump to, in one block: the tabs stay under the bar while any of its sections is on screen, and
 * leave with the last one.
 */
export function AreaBody({ id, tabs, children }: { id: AreaId; tabs: AreaTab[]; children: React.ReactNode }) {
  return (
    <div>
      {tabs.length > 0 && <AreaTabs tabs={tabs} label={`${area(id).title} sections`} />}
      {children}
    </div>
  );
}

/**
 * An area's sections, each as Home's "Studios and tools" with two cards a row on a phone, and "Jump back in" (someone
 * signed in) after the first, so it is off screen at load and moves nothing when it comes.
 */
export function AreaSections({ sections }: { sections: AreaShowcase["sections"] }) {
  const ids = areaIds(sections);
  return sections.map((s, i) => (
    <div key={s.id}>
      <div id={s.id} data-reveal className={AREA_SECTION}>
        <DestinationsSection
          id={`${s.id}-title`}
          title={s.title}
          count={s.cards.length + s.pills.length}
          line={s.line}
          cards={s.cards}
          pills={s.pills.map((p) => ({ href: p.href, label: p.label, icon: navIcon(p.icon) }))}
          pillsLabel={`Also in ${s.title}`}
          tap
          grid
          after={s.ownerPills.length > 0 ? <OwnerPills ids={s.ownerPills.map((p) => p.id)} /> : undefined}
        />
        <StudioFeatures section={s.id} subs={s.subs} />
      </div>
      {i === 0 && <JumpBackIn ids={ids} />}
    </div>
  ));
}

/** A studio's row of features: its name, then its tabs and modes as pills that wrap (44 px to tap). */
export const SUB_ROW = "flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-4";
export const SUB_ROW_NAME = "shrink-0 pt-1.5 text-[13px] leading-5 font-medium sm:w-40";
export const SUB_PILL = cn(PILL, PILL_TAP);

/**
 * What a section's studios hold inside (their tabs and modes), a row per studio under its cards and pills, so each is
 * one tap from here: "Marketing Studio  (Click to Ad) (Ad Multiplier)". The owner's own features come with the island.
 */
function StudioFeatures({ section, subs }: { section: string; subs: AreaShowcase["sections"][number]["subs"] }) {
  const shown = subs.filter((g) => g.pills.length > 0);
  if (!shown.length) return null;
  const titleId = `${section}-inside`;
  return (
    <div className="mt-6" data-studio-features={section}>
      <h3 id={titleId} className="mb-2 font-sans text-[13px] text-muted-foreground">
        Inside these studios
      </h3>
      <ul aria-labelledby={titleId} className="flex flex-col gap-2.5">
        {subs.map((g) =>
          g.pills.length > 0 ? (
            <li key={g.parent.id} className={SUB_ROW}>
              <p id={`${section}-inside-${g.parent.id}`} className={SUB_ROW_NAME}>
                {g.parent.label}
              </p>
              <ul aria-labelledby={`${section}-inside-${g.parent.id}`} className="flex flex-wrap gap-x-1.5 gap-y-3">
                {g.pills.map((p) => (
                  <li key={p.id}>
                    <IntentLink href={p.href} className={SUB_PILL}>
                      {p.label}
                    </IntentLink>
                  </li>
                ))}
                {g.ownerIds.length > 0 && <OwnerPills ids={g.ownerIds} sub />}
              </ul>
            </li>
          ) : (
            <OwnerSubRow key={g.parent.id} parent={g.parent.id} ids={g.ownerIds} />
          ),
        )}
      </ul>
    </div>
  );
}

/** The pills at the end of an area page: the other areas, then Canvas and Assist. */
export function MoreInFuobe({ current }: { current: AreaId }) {
  const others = AREAS.filter((a) => a.id !== current).map((a) => entry(a.entryId));
  const list = [...others, entry("canvas"), entry("assist")].filter((e): e is NavEntry => !!e);
  return (
    <section aria-labelledby="more-in-fuobe" data-reveal className="mt-10 sm:mt-14">
      <h2 id="more-in-fuobe" className="mb-2 font-sans text-[13px] font-medium">
        More in Fuobe
      </h2>
      <ul className="flex flex-wrap gap-1.5">
        {list.map((e) => {
          const Icon = navIcon(e.icon);
          const a = AREAS.find((x) => x.entryId === e.id);
          return (
            <li key={e.id}>
              <IntentLink href={e.href} className={cn(PILL, PILL_TAP)}>
                <Icon className={PILL_ICON} />
                {a ? a.label : e.label}
              </IntentLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The page's links as a schema.org list, for search engines (no script runs). */
export function AreaJsonLd({ id, items }: { id: AreaId; items: { label: string; href: string }[] }) {
  const a = area(id);
  const data = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: a.title,
    url: `https://fuobe.com${a.href}`,
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.label, url: `https://fuobe.com${it.href}` })),
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

/** The frame of an area page: Home's column, then the footer. */
export function AreaPage({ children }: { children: React.ReactNode }) {
  return (
    <PageShell>
      {children}
      <HomeFooter />
    </PageShell>
  );
}

/** Back to the area page from one of its galleries (/motions, /effects): a 44 px link over the heading. */
export function AreaBackLink({ id }: { id: AreaId }) {
  const a = area(id);
  return (
    <IntentLink
      href={a.href}
      className="group -mt-2 -ml-2 inline-flex h-11 items-center gap-1 rounded-full px-2 text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronLeft aria-hidden className="size-4 transition-transform duration-150 group-hover:-translate-x-0.5" />
      {a.title}
    </IntentLink>
  );
}
