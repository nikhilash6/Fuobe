"use client";

import { Download, Loader2, RotateCcw, Shapes } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { useSubmitGuard } from "@/components/shorts/hooks";
import { PendingTile } from "@/components/studio/feed";
import { MediaThumb } from "@/components/studio/result-media";
import { Viewer } from "@/components/studio/viewer";
import { useGenerations } from "@/lib/api";
import { MIXED_FEATURE, MIXED_STEP_FEATURE } from "@/lib/catalog/mixed-media";
import { chainState } from "@/lib/catalog/shorts";
import type { Generation } from "@/lib/catalog/types";
import { timeAgo } from "@/lib/format";
import { downloadHref, downloadName, userTitle } from "@/lib/library";
import { toastError } from "@/lib/refusals";
import { isFrameRender, renderSteps, useFramesProgress, useMixedActions } from "./hooks";

/** The finished videos and their helper steps (a failed render shows the failing step's own error). */
const FILTER = { features: [MIXED_FEATURE, MIXED_STEP_FEATURE], limit: 150 };

/** Each finished (or rendering, or failed) video with the steps of its render, in order. */
function renders(list: Generation[]): { final: Generation; chain: Generation[] }[] {
  const steps = new Map<string, Generation[]>();
  for (const g of list) if (g.feature === MIXED_STEP_FEATURE && g.batchId) steps.set(g.batchId, [...(steps.get(g.batchId) ?? []), g]);
  return list
    .filter((g) => g.feature === MIXED_FEATURE)
    .map((final) => {
      const own = (final.batchId ? (steps.get(final.batchId) ?? []) : []).slice().sort((a, b) => (a.request.step?.index ?? 0) - (b.request.step?.index ?? 0));
      return { final, chain: [...own, final] };
    });
}

/** History: the finished (and rendering) Mixed Media videos, newest first. */
export function MixedHistory({ onStart }: { onStart: () => void }) {
  const list = useGenerations(FILTER);
  const items = useMemo(() => renders(list.data ?? []), [list.data]);
  const [open, setOpen] = useState<Generation | null>(null);
  const actions = useMixedActions();
  const guard = useSubmitGuard();
  const retry = (id: string) => {
    if (actions.retry.isPending) return;
    void guard(`retry:${id}`, (requestId) => actions.retry.mutateAsync({ id, requestId }))
      .then((r) => r && toast("Rendering it again"))
      .catch((e: Error) => toastError(e));
  };
  if (list.isLoading)
    return (
      <div className="grid grid-cols-2 gap-3 pt-8 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="aspect-square rounded-xl" />
        ))}
      </div>
    );
  if (!items.length)
    return (
      <div className="mx-auto flex max-w-md flex-col items-center py-20 text-center">
        <span className="grid size-12 place-items-center rounded-full bg-brand-faint text-brand-text">
          <Shapes className="size-5" />
        </span>
        <p className="mt-4 font-heading text-[22px]">Nothing here yet</p>
        <p className="mt-1 text-[14px] text-muted-foreground">Pick a preset, add a clip of up to 10 seconds and generate — your mixed-media videos show up here.</p>
        <button type="button" onClick={onStart} className="mt-5 h-9 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:bg-primary/90">
          Browse presets
        </button>
      </div>
    );
  return (
    <>
      <div className="grid grid-cols-2 gap-3 pt-8 sm:grid-cols-3 lg:grid-cols-4">
        {items.map(({ final: g, chain }) => {
          const out = g.status === "succeeded" ? g.outputs.find((o) => o.kind === "video") : undefined;
          const state = chainState(renderSteps(chain));
          const retrying = actions.retry.isPending && actions.retry.variables?.id === g.id;
          const heading = g.status === "canceled" ? "Canceled" : state.status === "failed" ? state.label : "Couldn't render this one";
          const reason = state.error ?? g.error;
          return (
            <div key={g.id} className="min-w-0">
              <div className="relative aspect-square overflow-hidden rounded-xl bg-muted">
                {out ? (
                  <button type="button" onClick={() => setOpen(g)} aria-label={`Open ${userTitle(g)}`} className="block size-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <MediaThumb output={out} />
                  </button>
                ) : g.status === "queued" || g.status === "running" ? (
                  <PendingTile g={state.status === "working" ? (chain.find((x) => x.status !== "succeeded") ?? g) : g} ratio={1} />
                ) : (
                  <div className="flex size-full flex-col justify-center gap-1 border border-dashed p-3">
                    {g.status !== "canceled" && isFrameRender(chain) ? (
                      <FrameFailure id={g.id} heading={heading} reason={reason} />
                    ) : (
                      <>
                        <p className="text-[13px] font-medium">{heading}</p>
                        {reason && reason !== heading && <p className="line-clamp-4 text-[12px] break-words text-muted-foreground">{reason}</p>}
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => retry(g.id)}
                      disabled={actions.retry.isPending}
                      className="mt-1 inline-flex h-7 w-fit items-center gap-1 rounded-full border bg-background px-2.5 text-[12px] font-medium hover:bg-accent disabled:opacity-60"
                    >
                      {retrying ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />} Try again
                    </button>
                  </div>
                )}
              </div>
              <div className="flex items-start gap-1 px-0.5 pt-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{userTitle(g)}</p>
                  <p className="truncate text-[12px] text-muted-foreground">{timeAgo(g.createdAt)}</p>
                </div>
                {out && (
                  <a href={downloadHref(out.url, downloadName(g, out, 0))} download={downloadName(g, out, 0)} aria-label="Download" className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
                    <Download className="size-3.5" />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {open && <Viewer generation={open} index={0} onClose={() => setOpen(null)} />}
    </>
  );
}

/**
 * A per-frame render that failed: the frame that failed and why (the steps after it only say an earlier step didn't
 * finish). When no frame failed on its own (the cut or the extraction did), the failing step's error stands.
 */
function FrameFailure({ id, heading, reason }: { id: string; heading: string; reason?: string | null }) {
  const failed = useFramesProgress(id, "once").data?.failed;
  const title = failed ? `${failed.label} failed` : heading;
  const why = failed?.error ?? reason;
  return (
    <>
      <p className="text-[13px] font-medium">{title}</p>
      {why && why !== title && <p className="line-clamp-4 text-[12px] break-words text-muted-foreground">{why}</p>}
    </>
  );
}
