import type { Metadata } from "next";
import { AreaBody, AreaHero, areaIds, AreaJsonLd, AreaPage, AreaSections, MoreInFuobe, sectionTabs } from "@/components/areas/area-page";
import { areaShowcase } from "@/lib/area-showcase";
import { studioCount } from "@/lib/nav-model";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Studios",
    description: `${studioCount()} studios for films, ads, social, fashion and sound, grouped by what you want to make. Look around with no account.`,
    alternates: { canonical: "/studios" },
  };
}

/** Every studio, grouped as the bar's launcher groups them, each with its cover and line, then its tools. */
export default async function Page() {
  const { count, sections } = await areaShowcase("studios");
  return (
    <AreaPage>
      <AreaHero id="studios" count={count} search={areaIds(sections)} />
      <AreaBody id="studios" tabs={sectionTabs(sections)}>
        <AreaSections sections={sections} />
      </AreaBody>
      <MoreInFuobe current="studios" />
      <AreaJsonLd id="studios" items={sections.flatMap((s) => [...s.cards, ...s.pills])} />
    </AreaPage>
  );
}