import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageShell } from "@/components/page-shell";
import { RunDetailsView } from "@/components/run-details";
import { GallerySkeleton } from "@/components/skeletons";

export const metadata: Metadata = { title: "Run details" };

/**
 * Settings → Accounts' runs → one run (the owner only): what the account asked for, saw and did. The run's id is read
 * in the browser (its data comes from the owner-only API), as Accounts' runs reads its filters.
 */
export default function Page() {
  return (
    <PageShell>
      <Link href="/settings/runs" className="mb-3 inline-flex items-center gap-1.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Accounts&apos; runs
      </Link>
      <Suspense fallback={<GallerySkeleton cards={4} />}>
        <RunDetailsView />
      </Suspense>
    </PageShell>
  );
}
