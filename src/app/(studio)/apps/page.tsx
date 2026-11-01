import type { Metadata } from "next";
import { PageHeader, PageShell } from "@/components/page-shell";
import { PresetGallery } from "@/components/preset-gallery";
import { APPS } from "@/lib/catalog";
import { toPresetCard } from "@/lib/preset-card-data";
import { featuredGallery } from "@/lib/preset-featured";

export const metadata: Metadata = {
  title: "Apps",
  description: "One-click AI tools for faces, products, styles and fun, running on open-source ComfyUI workflows.",
};

export default function Page() {
  return (
    <PageShell>
      <PageHeader
        title="Apps"
        description="One-click tools for faces, products, styles and fun, each on an open-source ComfyUI workflow (and a cloud model where the studio has one)."
      />
      {/* Slim card data only: no prompt templates, routes or LoRA URLs in the page payload. */}
      <PresetGallery {...featuredGallery(APPS.map(toPresetCard))} href="/apps/{id}" noun="apps" />
    </PageShell>
  );
}
