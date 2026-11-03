"use client";

import { Clapperboard, Cloud, Cpu, Loader2 } from "lucide-react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { MediaThumb } from "@/components/studio/result-media";
import { formatSeconds } from "@/lib/catalog/shorts";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useShortsSessions, type ShortsSessionCard } from "./hooks";

/** History: every session, newest first, with its finished video (or where it got to). */
export function ShortsHistory({ onStart }: { onStart: () => void }) {
  const sessions = useShortsSessions();
  if (sessions.isLoading)
    return (
      <div className="grid grid-cols-2 gap-3 pt-8 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="aspect-[9/14] rounded-xl" />
        ))}
      </div>
    );
  if (sessions.error) return <p className="py-16 text-center text-[14px] text-muted-foreground">{(sessions.error as Error).message}</p>;
  if (!sessions.data?.length)
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-brand-faint text-brand-text">
          <Clapperboard className="size-5" />
        </span>
        <p className="mt-4 font-heading text-[22px]">No shorts yet</p>
        <p className="mt-1 text-[14px] text-muted-foreground">Pick a preset and upload a clip — your shorts and their segments show up here.</p>
        <button type="button" onClick={onStart} className="mt-5 h-9 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary/90">
          Choose a preset
        </button>
      </div>
    );
  return (
    <div className="grid grid-cols-2 gap-3 pt-8 sm:grid-cols-3 lg:grid-cols-4">
      {sessions.data.map((s) => (
        <SessionCard key={s.id} s={s} />
      ))}
    </div>
  );
}

function SessionCard({ s }: { s: ShortsSessionCard }) {
  const out = s.cover?.status === "succeeded" ? s.cover.outputs.find((o) => o.kind === "video") : undefined;
  return (
    <Link href={`/shorts/${s.id}`} className="group/card card-motion card-fill min-w-0 rounded-xl p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <div className="card-cover relative aspect-[9/14] overflow-hidden rounded-lg bg-muted">
        {out ? (
          <MediaThumb output={out} />
        ) : (
          <div className="skeleton-sweep absolute inset-0 grid place-items-center">{s.status === "rendering" && <Loader2 className="size-5 animate-spin text-muted-foreground" />}</div>
        )}
        <span
          className={cn(
            "absolute top-1.5 left-1.5 rounded-[4px] px-1.5 text-[10px] font-semibold",
            s.status === "ready" ? "bg-success text-white" : s.status === "failed" ? "bg-destructive text-white" : "bg-background/85 text-foreground",
          )}
        >
          {s.status === "ready" ? "Ready" : s.status === "failed" ? "Needs a look" : "Rendering"}
        </span>
        <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-black/35 text-white" title={s.engine === "open" ? "Open source" : "Cloud"}>
          {s.engine === "open" ? <Cpu className="size-3" /> : <Cloud className="size-3" />}
        </span>
      </div>
      <div className="min-w-0 px-0.5 pt-2">
        <p className="truncate text-[13px] font-medium">{s.title}</p>
        <p className="truncate text-[12px] text-muted-foreground">
          {s.segments} segment{s.segments === 1 ? "" : "s"} · {formatSeconds(s.seconds)} · {timeAgo(s.createdAt)}
        </p>
      </div>
    </Link>
  );
}
