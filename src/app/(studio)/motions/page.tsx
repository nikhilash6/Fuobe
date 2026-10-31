import type { Metadata } from "next";
import { PageHeader, PageShell } from "@/components/page-shell";
import { PresetGallery } from "@/components/preset-gallery";
import { MOTIONS } from "@/lib/catalog";
import { toPresetCard } from "@/lib/preset-card-data";
import { featuredGallery } from "@/lib/preset-featured";

export const metadata: Metadata = {
  title: "Camera motions",
  description: "Director-grade camera moves for any image: crash zooms, orbits, bullet time and more, filmed by open-source models on your own GPU.",
};

export default function Page() {
  return (
    <PageShell>
      <PageHeader
        title="Camera motions"
        description="Pick a camera move and add a start frame. Fuobe DoP films it with a trained camera LoRA, free on your GPU or in the cloud."
      />
      <PresetGallery {...featuredGallery(MOTIONS.map(toPresetCard))} href="/video?preset={id}" noun="moves" />
    </PageShell>
  );
}
