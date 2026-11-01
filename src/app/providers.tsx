"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { GuestPrompt } from "@/components/guest-prompt";
import { AddKeyPrompt } from "@/components/keys/your-keys";
import { toast } from "sonner";
import { AUTH_CHANNEL, takeNotice, type ViewerInfo } from "@/lib/api";

/** The GPU pre-flight's guided fix: loaded after the page, listening for "fuobe:gpu-setup". */
// A run the billing service refused (only on a studio that set one up): loaded when it is needed.
const BillingCard = dynamic(() => import("@/components/billing-card").then((m) => m.BillingCard), { ssr: false });
const GuidedFixHost = dynamic(() => import("@/components/gpu/guided-fix").then((m) => m.GuidedFixHost), { ssr: false });
/** "Use the ComfyUI on this computer": runs the person's jobs from this browser while it's open. */
const ComputerRunnerHost = dynamic(() => import("@/components/gpu/computer-runner").then((m) => m.ComputerRunnerHost), { ssr: false });
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/** Answers a retry can't change: signed out, not allowed, not there. */
const NO_RETRY = new Set([401, 403, 404]);

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        // One retry for a failed read, but not for a refusal or a missing thing (it would answer the same, and log twice).
        defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: (n, e) => n < 1 && !NO_RETRY.has((e as { status?: number }).status ?? 0) } },
      }),
  );
  // Signed in or out in another tab: this one asks who is looking again (its sidebar, its studios' refusals).
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const c = new BroadcastChannel(AUTH_CHANNEL);
    c.onmessage = async () => {
      void client.invalidateQueries({ queryKey: ["status"] });
      await client.invalidateQueries({ queryKey: ["viewer"] });
      // A studio without public sign-up has nothing for someone signed out but its sign-in page: loading again takes
      // this tab there, rather than showing a guest's pages that offer an account it can't make.
      const v = client.getQueryData<ViewerInfo>(["viewer"]);
      if (v && !v.signedIn && !v.publicSignup && window.location.pathname !== "/login") window.location.reload();
    };
    return () => c.close();
  }, [client]);
  // What the last page left to say (Delete account lands here as a guest, which looks the same as signing out). The
  // Toaster below is listening by now: a child's effects run before this one.
  useEffect(() => {
    if (takeNotice() === "account-deleted")
      toast.success("Your account was deleted", { description: "Its uploads, runs, GPU connection and saved keys are gone. You're signed out." });
  }, []);
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <TooltipProvider delayDuration={300}>
          {children}
          <Toaster position="top-center" gap={8} offset={29} />
          <GuestPrompt />
          <AddKeyPrompt />
          <BillingCard />
          <GuidedFixHost />
          <ComputerRunnerHost />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
