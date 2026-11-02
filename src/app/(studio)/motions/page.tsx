import type { Metadata } from "next";
import { AreaBackLink } from "@/components/areas/area-page";
import { PageHeader, PageShell } from "@/components/page-shell";
import { PresetGallery } from "@/components/preset-gallery";
import { MOTIONS } from "@/lib/catalog";
import { toPresetCard } from "@/lib/preset-card-data";
import { featuredGallery } from "@/lib/preset-featured";

export const metadata: Metadata = {
  title: "Camera motions",
  description: "Director-grade camera moves for any image: crash zooms, orbits, bullet time and more, filmed by Fuobe DoP.",
};

export default function Page() {
  return (
    <PageShell>
      <AreaBackLink id="motions" />
      <PageHeader
        title="Camera motions"
        description="Pick a camera move, add a start frame, and Fuobe DoP films it."
      />
      <PresetGallery {...featuredGallery(MOTIONS.map(toPresetCard))} href="/video?preset={id}" noun="moves" />
    </PageShell>
  );
}
