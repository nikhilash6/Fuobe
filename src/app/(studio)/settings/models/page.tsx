import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ModelAccessIntro, ModelAccessView } from "@/components/model-access-view";
import { PageHeader, PageShell } from "@/components/page-shell";

export const metadata: Metadata = { title: "Models & licences" };

/** Settings → Models & licences: every model's licence as information, and the switches that decide what this install offers. */
export default function Page() {
  return (
    <PageShell>
      <Link href="/settings" className="mb-3 inline-flex items-center gap-1.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Settings
      </Link>
      <PageHeader title="Models & licences" description={<ModelAccessIntro />} />
      <ModelAccessView />
    </PageShell>
  );
}
