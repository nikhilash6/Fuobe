import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader, PageShell } from "@/components/page-shell";
import { WorkersAdmin } from "@/components/workers-admin";

export const metadata: Metadata = { title: "Workers" };

/** Settings → Workers (the owner only): the GPUs on other machines that run this studio's ComfyUI jobs. */
export default function Page() {
  return (
    <PageShell>
      <Link href="/settings" className="mb-3 inline-flex items-center gap-1.5 rounded-md text-[13px] text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Settings
      </Link>
      <PageHeader title="Workers" description="Share your GPUs with other machines." />
      <WorkersAdmin />
    </PageShell>
  );
}
