"use client";

import { LogOut } from "lucide-react";
import { ConnectChoice } from "@/components/gpu/connect-choice";
import { Button } from "@/components/ui/button";
import { useHydrated, useViewer } from "@/lib/api";

/**
 * Settings for an account (public sign-up): "Your GPU", at the top of the page, and signing out. Nothing for the owner
 * or a guest, and nothing until hydrated: the server's HTML has none.
 */
export function AccountGpuSection() {
  const hydrated = useHydrated();
  const account = useViewer().data?.account;
  if (!hydrated || !account) return null;
  return (
    <section id="your-gpu" aria-labelledby="your-gpu-title" className="grid scroll-mt-28 grid-cols-[minmax(0,1fr)] gap-6 border-b py-8 md:scroll-mt-20 md:grid-cols-[260px_minmax(0,1fr)]">
      <div className="min-w-0">
        <h2 id="your-gpu-title" className="text-[15px] font-semibold">
          Your GPU
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Signed in as {account.email}. Connect your own ComfyUI to run open-source models. The studio&apos;s owner can see what you upload and make here.
        </p>
        <Button
          size="sm"
          variant="ghost"
          className="mt-2 -ml-2 h-7 text-muted-foreground"
          onClick={async () => {
            await fetch("/api/auth/logout", { method: "POST" });
            window.location.reload();
          }}
        >
          <LogOut /> Sign out
        </Button>
      </div>
      <ConnectChoice />
    </section>
  );
}
