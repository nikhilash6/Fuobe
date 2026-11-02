import type { Metadata } from "next";
import { ArrowDown } from "lucide-react";
import { AreaHero, AreaPage, MoreInFuobe } from "@/components/areas/area-page";
import { AppsSection } from "@/components/home/home-sections";
import { LiveDemo } from "@/components/live/live-demo";
import { PresetGallery, type LinkCard } from "@/components/preset-gallery";
import { appsAreaShowcase } from "@/lib/area-showcase";
import { APPS } from "@/lib/catalog";
import { toPresetCard } from "@/lib/preset-card-data";
import { featuredGallery } from "@/lib/preset-featured";

export const metadata: Metadata = {
  title: "Apps",
  description: "One-click AI apps for faces, products, styles and fun, each with a real before and after.",
  alternates: { canonical: "/apps" },
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

/** Apps as an area page: Home's Apps section to start, then every app in the gallery (search and categories). */
export default async function Page() {
  const start = await appsAreaShowcase();
  return (
    <AreaPage>
      <AreaHero
        id="apps"
        count={APPS.length}
        action={
          // The gallery with its search and categories, one jump away (Start here comes first).
          <a
            href="#every-app"
            className="group relative inline-flex h-11 shrink-0 items-center gap-1 rounded-full px-1 text-[13px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:h-10"
          >
            See all {APPS.length}
            <ArrowDown aria-hidden className="size-3.5 transition-transform duration-150 group-hover:translate-y-0.5" />
          </a>
        }
      />
      <AppsSection
        facts={start.facts}
        beforeAfter={start.beforeAfter}
        reveals={start.reveals}
        start={{ title: "Start here", line: "Drag across a picture to see what one click changed." }}
      />
      <section aria-labelledby="every-app-title" id="every-app" className="mt-10 scroll-mt-[calc(3.5rem+env(safe-area-inset-top))] sm:mt-14 md:scroll-mt-4">
        <h2 id="every-app-title" className="mb-4 font-heading text-[24px] leading-tight sm:text-[28px]">
          Every app
        </h2>
        {/* Slim card data only: no prompt templates, routes or LoRA URLs in the page payload. */}
        <PresetGallery {...featuredGallery(APPS.map(toPresetCard))} href="/apps/{id}" noun="apps" leading={LEADING} skipInAll={start.shown} />
      </section>
      <MoreInFuobe current="apps" />
    </AreaPage>
  );
}
