"use client";

import { Info } from "lucide-react";
import { useIsVisitor } from "@/lib/api";
import { FUOBE_REPO } from "@/lib/connections";
import { cn } from "@/lib/utils";

/**
 * On a public studio, for a guest or an account: Assist is the owner's here (it plans with the owner's AI), so the
 * Assist pages say so once and leave out what only the owner can do. The server answers the same (ASSIST_OWNER_MESSAGE).
 */
export function AssistVisitorNote({ className }: { className?: string }) {
  if (!useIsVisitor()) return null;
  return (
    <div role="note" className={cn("flex items-start gap-2.5 rounded-xl border bg-muted/50 px-3.5 py-2.5 text-left text-[13px] text-muted-foreground", className)}>
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="min-w-0 text-pretty">
        Assist runs on the studio owner&apos;s AI, so only the owner can use it here. Fuobe is{" "}
        <a href={FUOBE_REPO} target="_blank" rel="noreferrer" className="text-foreground underline underline-offset-2">
          open source
        </a>
        : run it yourself for your own chats, skills, memory and schedules.
      </p>
    </div>
  );
}
