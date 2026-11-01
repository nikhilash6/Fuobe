"use client";

import { Info } from "lucide-react";
import Link from "next/link";
import { useIsVisitor } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * On a public studio, for a guest or an account: Assist plans with the owner's AI, so the Assist pages say once that it
 * isn't available and leave out what only the owner can do. The server answers the same (ASSIST_OWNER_MESSAGE).
 */
export function AssistVisitorNote({ className }: { className?: string }) {
  if (!useIsVisitor()) return null;
  return (
    <div role="note" className={cn("flex items-start gap-2.5 rounded-xl border bg-muted/50 px-3.5 py-2.5 text-left text-[13px] text-muted-foreground", className)}>
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p className="min-w-0 text-pretty">
        Assist isn&apos;t available here. Make anything in the{" "}
        <Link href="/image" className="text-foreground underline underline-offset-2">
          Image
        </Link>
        ,{" "}
        <Link href="/video" className="text-foreground underline underline-offset-2">
          Video
        </Link>{" "}
        and{" "}
        <Link href="/audio" className="text-foreground underline underline-offset-2">
          Audio
        </Link>{" "}
        studios.
      </p>
    </div>
  );
}
