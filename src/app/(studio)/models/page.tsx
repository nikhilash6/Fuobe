import type { Metadata } from "next";
import { PageHeader, PageShell } from "@/components/page-shell";
import { ModelsIntro, ModelsTable } from "@/components/models-table";
import { isListed, MODELS } from "@/lib/catalog";
import { toModelRow } from "@/lib/model-rows";
import { modelHref } from "@/lib/palette-index";

export const metadata: Metadata = { title: "Models" };

/**
 * Each row opens where its model runs; a model no studio offers has nowhere else to go (its link is this page). The
 * models a visitor can pick, as Home and Project status count them (modelCounts): a hidden step a preset or a tool
 * runs (trim, join, a self-test) isn't one.
 */
const ROWS = MODELS.filter(isListed).map((m) => {
  const href = modelHref(m);
  return { ...toModelRow(m), ...(!href.startsWith("/models") && { href }) };
});

export default function Page() {
  return (
    <PageShell wide>
      <PageHeader title="Models" description={<ModelsIntro />} />
      {/* Slim rows only: the catalog (field maps, options, LoRAs) stays on the server. */}
      <ModelsTable models={ROWS} />
    </PageShell>
  );
}
