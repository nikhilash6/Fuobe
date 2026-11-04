import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageShell } from "@/components/page-shell";
import { ThanksView } from "@/components/thanks/thanks-view";
import { readThanks } from "@/server/thanks";

export const metadata: Metadata = {
  title: "Thanks & licences",
  description: "The open models, LoRAs, node packs and code Fuobe is built on, who made them, and their licences.",
};

/** Settings → About → Thanks & licences: open to everyone, prerendered from the catalog, the manifest and the packages. */
export default function Page() {
  return (
    <PageShell>
      <Link href="/settings#about" className="mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground md:min-h-0">
        <ArrowLeft className="size-3.5" /> Settings · About
      </Link>
      <PageHeader
        title="Thanks & licences"
        description="Fuobe is built on open models, open code and the people who share them. Thank you. Here is each one, who made it, what Fuobe uses it for and its licence."
      />
      <ThanksView thanks={readThanks()} />
    </PageShell>
  );
}
