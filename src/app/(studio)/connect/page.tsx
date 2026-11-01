import type { Metadata } from "next";
import { Suspense } from "react";
import { ConnectGpu } from "@/components/gpu/connect-gpu";
import { PageShell } from "@/components/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = { title: "Connect your GPU" };

/** The GPU pre-flight: connect ComfyUI, check it live, and see what every studio can do on it. */
export default function Page() {
  return (
    <PageShell>
      <div className="mx-auto w-full max-w-[760px]">
        {/* The page reads ?welcome and ?next: under Suspense, so the static shell prerenders. */}
        <Suspense
          fallback={
            <div className="space-y-4">
              <Skeleton className="h-10 w-72" />
              <Skeleton className="h-40 w-full" />
            </div>
          }
        >
          <ConnectGpu />
        </Suspense>
      </div>
    </PageShell>
  );
}
