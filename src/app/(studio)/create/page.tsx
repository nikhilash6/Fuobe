import type { Metadata } from "next";
import { AreaBody, AreaHero, areaIds, AreaJsonLd, AreaPage, AreaSections, MoreInFuobe, NewCreation, sectionTabs } from "@/components/areas/area-page";
import { areaShowcase } from "@/lib/area-showcase";

export const metadata: Metadata = {
  title: "Create",
  description: "Make pictures, clips and sound with open models, or edit what you have: inpaint, layers, colour, upscale and more.",
  alternates: { canonical: "/create" },
};

/** Everything in the Create menu and more: what makes something new, and what changes a picture, a clip or a sound. */
export default async function Page() {
  const { count, sections } = await areaShowcase("create");
  return (
    <AreaPage>
      <AreaHero id="create" count={count} search={areaIds(sections)} action={<NewCreation />} />
      <AreaBody id="create" tabs={sectionTabs(sections)}>
        <AreaSections sections={sections} />
      </AreaBody>
      <MoreInFuobe current="create" />
      <AreaJsonLd id="create" items={sections.flatMap((s) => s.cards)} />
    </AreaPage>
  );
}