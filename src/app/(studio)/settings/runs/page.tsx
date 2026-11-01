import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AccountRunsView } from "@/components/account-runs";
import { PageShell } from "@/components/page-shell";
import { GallerySkeleton } from "@/components/skeletons";

export const metadata: Metadata = { title: "Accounts' runs" };

/** Settings → Accounts' runs (the owner only): what accounts made on their own GPUs, one account's (?account=<id>) or everyone's. */
export default function Page() {
  return (
    <PageShell>
      <Link href="/settings#accounts" className="mb-3 inline-flex items-center gap-1.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Settings
      </Link>
      <Suspense fallback={<GallerySkeleton cards={8} />}>
        <AccountRunsView />
      </Suspense>
    </PageShell>
  );
}
