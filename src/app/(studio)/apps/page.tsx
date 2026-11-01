import type { Metadata } from "next";
import { LiveDemo } from "@/components/live/live-demo";
import { PageHeader, PageShell } from "@/components/page-shell";
import { PresetGallery, type LinkCard } from "@/components/preset-gallery";
import { APPS } from "@/lib/catalog";
import { toPresetCard } from "@/lib/preset-card-data";
import { featuredGallery } from "@/lib/preset-featured";

export const metadata: Metadata = {
  title: "Apps",
  description: "One-click AI tools for faces, products, styles and fun.",
};

/** Tools of their own, first in the gallery. */
const LEADING: LinkCard[] = [
  {
    href: "/live-edit?from=apps",
    title: "Live edit",
    line: "Type a change and watch it happen",
    words: "realtime live as you type instant change edit",
    badge: "New",
    cover: <LiveDemo compact className="absolute inset-0 rounded-none" />,
  },
];

export default function Page() {
  return (
    <PageShell>
      <PageHeader
        title="Apps"
        description="One-click tools for faces, products, styles and fun."
      />
      {/* Slim card data only: no prompt templates, routes or LoRA URLs in the page payload. */}
      <PresetGallery {...featuredGallery(APPS.map(toPresetCard))} href="/apps/{id}" noun="apps" leading={LEADING} />
    </PageShell>
  );
}
