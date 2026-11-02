import type { Metadata } from "next";
import { AREA_SECTION, AreaBody, AreaHero, AreaJsonLd, AreaPage, MoreInFuobe } from "@/components/areas/area-page";
import type { AreaTab } from "@/components/areas/area-islands";
import { PresetRail, SectionHead, ShowcaseWall } from "@/components/home/home-sections";
import { PILL, PILL_TAP } from "@/components/home/pill";
import { IntentLink } from "@/components/intent-link";
import { motionsAreaShowcase } from "@/lib/area-showcase";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Motions & effects",
  description: "Camera moves a film crew would make and cinematic effects, ready for any photo.",
  alternates: { canonical: "/motions-and-effects" },
};

const categoryHref = (gallery: string, c: string) => `${gallery}?category=${encodeURIComponent(c)}`;

/** A gallery's row: its heading with "See all", Home's preset cards, then every category as a pill. */
function GalleryRow({
  id,
  title,
  line,
  href,
  data,
  pillsLabel,
}: {
  id: string;
  title: string;
  line: string;
  href: string;
  data: Awaited<ReturnType<typeof motionsAreaShowcase>>["motions"];
  pillsLabel: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={AREA_SECTION}>
      <SectionHead id={`${id}-title`} title={title} count={data.count} all={href} line={line} />
      {/* Four a row, as the other area pages' cards, so every line under a picture shows whole. */}
      <PresetRail items={data.row} className="sm:grid-cols-4" />
      <h3 className="mt-6 mb-2 font-sans text-[13px] text-muted-foreground">{pillsLabel}</h3>
      <ul className="flex flex-wrap gap-1.5">
        {data.categories.map((c) => (
          <li key={c}>
            <IntentLink href={categoryHref(href, c)} className={cn(PILL, PILL_TAP)}>
              {c}
            </IntentLink>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Both preset galleries on one page: a playing wall of the best, then each gallery's first row and its categories. */
export default async function Page() {
  const { wall, motions, effects } = await motionsAreaShowcase();
  const tabs: AreaTab[] = [
    { href: "#camera-motions", label: "Camera motions", icon: "Film", section: "camera-motions" },
    { href: "#effects", label: "Effects", icon: "Sparkles", section: "effects" },
  ];
  return (
    <AreaPage>
      <AreaHero id="motions" count={motions.count + effects.count} />
      <AreaBody id="motions" tabs={tabs}>
        <ShowcaseWall wall={wall} label="The best camera motions and effects" foot={false} />
        <GalleryRow
          id="camera-motions"
          title="Camera motions"
          line="Moves a film crew would make: orbits, drone dives, crash zooms. Mix any two."
          href="/motions"
          data={motions}
          pillsLabel="Camera motions by kind"
        />
        <GalleryRow id="effects" title="Effects" line="Add one photo and get the shot: storms, blooms, flares, floods." href="/effects" data={effects} pillsLabel="Effects by kind" />
      </AreaBody>
      <MoreInFuobe current="motions" />
      <AreaJsonLd
        id="motions"
        items={[
          { label: "Camera motions", href: "/motions" },
          { label: "Effects", href: "/effects" },
          ...wall.map((t) => ({ label: t.card.name, href: t.href })),
        ]}
      />
    </AreaPage>
  );
}
