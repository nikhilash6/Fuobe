import type { Metadata } from "next";
import { AreaBackLink } from "@/components/areas/area-page";
import { PageHeader, PageShell } from "@/components/page-shell";
import { PresetGallery } from "@/components/preset-gallery";
import { EFFECTS } from "@/lib/catalog";
import { toPresetCard } from "@/lib/preset-card-data";
import { featuredGallery } from "@/lib/preset-featured";

export const metadata: Metadata = {
  title: "Effects",
  description: "Storms, transformations and cinematic VFX from one photo.",
};

export default function Page() {
  return (
    <PageShell>
      <AreaBackLink id="motions" />
      <PageHeader
        title="Effects"
        description="Storms, transformations and cinematic VFX from one photo. Colour looks apply instantly."
      />
      <PresetGallery {...featuredGallery(EFFECTS.map(toPresetCard))} href="/video?preset={id}" noun="effects" />
    </PageShell>
  );
}
