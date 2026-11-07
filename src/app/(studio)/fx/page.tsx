import type { Metadata } from "next";
import { AreaBody, AreaHero, AreaJsonLd, AreaPage, AreaSections, MoreInFuobe, sectionTabs } from "@/components/areas/area-page";
import { fxShowcase } from "@/lib/area-showcase";

export const metadata: Metadata = {
  title: "Fuobe FX",
  description: "Tools for FX artists and teams: replace and recast, clean plates, roto and mattes, relight and grade, retime and upscale, camera and 3D.",
  alternates: { canonical: "/fx" },
};

/** Fuobe FX: the tools an FX pipeline uses, grouped by stage (src/lib/fx-tools.ts). Each tool also stays where it lives. */
export default async function Page() {
  const { count, sections } = await fxShowcase();
  return (
    <AreaPage>
      <AreaHero id="fx" count={count} />
      <AreaBody id="fx" tabs={sectionTabs(sections)}>
        <AreaSections sections={sections} />
      </AreaBody>
      <MoreInFuobe current="fx" />
      <AreaJsonLd id="fx" items={sections.flatMap((s) => [...s.cards, ...s.pills])} />
    </AreaPage>
  );
}
