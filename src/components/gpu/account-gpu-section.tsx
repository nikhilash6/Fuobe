"use client";

import { ConnectChoice } from "@/components/gpu/connect-choice";
import { PairedComfyUIs } from "@/components/gpu/fuobe-connect";
import { useHashAnchor } from "@/components/use-hash-anchor";
import { useHydrated, useViewer } from "@/lib/api";

/**
 * Settings for an account (public sign-up): "Your GPU", at the top of the page (signing out is in Account, below).
 * Nothing for the owner or a guest, and nothing until hydrated: the server's HTML has none.
 */
export function AccountGpuSection() {
  const hydrated = useHydrated();
  const account = useViewer().data?.account;
  const shown = hydrated && !!account;
  // A link to /settings#your-gpu arrives before this section exists: it is scrolled to once it does.
  useHashAnchor("your-gpu", shown);
  if (!shown) return null;
  return (
    <section id="your-gpu" aria-labelledby="your-gpu-title" className="grid scroll-mt-28 grid-cols-[minmax(0,1fr)] gap-6 border-b py-8 md:scroll-mt-20 md:grid-cols-[260px_minmax(0,1fr)]">
      <div className="min-w-0">
        <h2 id="your-gpu-title" className="text-[15px] font-semibold">
          Your GPU
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Run open models on your own graphics card, free and with no run limit.
        </p>
      </div>
      <div className="min-w-0 space-y-4">
        <ConnectChoice />
        <PairedComfyUIs className="sm:max-w-[36rem]" />
      </div>
    </section>
  );
}
