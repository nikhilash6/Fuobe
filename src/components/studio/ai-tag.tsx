"use client";

import { useHydrated, useStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Results carry an "AI-generated" tag where this studio runs visitors' work on its own GPUs (hosted runs on). With
 * hosted runs off, nothing new shows.
 */
export function useAiTag(): boolean {
  const hydrated = useHydrated();
  const hosted = !!useStatus().data?.viewer?.hosted;
  // Once hydrated: the page's first paint is the server's, which knows no status.
  return hydrated && hosted;
}

/** The tag itself: a small label over a picture or a clip. */
export function AiTag({ className }: { className?: string }) {
  return (
    <span data-ai-tag className={cn("pointer-events-none rounded-full bg-black/55 px-2 py-0.5 text-[10.5px] font-medium text-white backdrop-blur", className)}>
      AI-generated
    </span>
  );
}
