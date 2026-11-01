"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, Circle, Download, Loader2, MoreHorizontal, Repeat2, Type, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MediaThumb } from "@/components/studio/result-media";
import { uploadFile, useGenerationActions } from "@/lib/api";
import { FORMATS, overlayLayout, runStatus, type BrandKit, type MarketingRun, type RunFeature } from "@/lib/catalog/marketing";
import type { Generation } from "@/lib/catalog/types";
import { elapsed, formatCost, ratioValue, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { addRuns, send, useBrands, useForgetRun, useRuns } from "./hooks";

const Viewer = dynamic(() => import("@/components/studio/viewer").then((m) => m.Viewer), { ssr: false });
const AdEditor = dynamic(() => import("@/components/ads/ad-editor").then((m) => m.AdEditor), { ssr: false });

const active = (g: Generation) => g.status === "queued" || g.status === "running";

function StepChip({ g }: { g: Generation }) {
  const label = g.request.step?.label ?? g.modelName ?? g.modelId;
  const icon =
    g.status === "succeeded" ? (
      <Check className="size-3 text-success" />
    ) : g.status === "failed" || g.status === "canceled" ? (
      <X className="size-3 text-destructive" />
    ) : g.status === "running" || (g.status === "queued" && !g.message?.startsWith("Waits")) ? (
      <Loader2 className="size-3 animate-spin text-brand-text" />
    ) : (
      <Circle className="size-2.5 text-subtle-foreground" />
    );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className={cn("inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-secondary px-2 text-[11px] font-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring", g.status === "failed" && "bg-destructive/10 text-destructive")}>
          {icon}
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">
        {label} · {g.modelName ?? g.modelId}
        {g.status === "failed" && g.error ? ` — ${g.error}` : g.status === "running" && g.progress != null ? ` — ${Math.round(g.progress * 100)}%` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

function runRatio(run: MarketingRun, g?: Generation): number {
  const ar = g?.request.params?.aspectRatio ?? g?.aspectRatio ?? undefined;
  return ratioValue(ar && ar !== "auto" ? ar : undefined, g?.kind === "video" ? 9 / 16 : 3 / 4);
}

/** The format the words are set in: the picture's own ratio. */
const composeRatio = (g?: Generation) => {
  const ar = g?.request.params?.aspectRatio;
  return ar && ar !== "auto" ? ar : "3:4";
};

const overlayText = (run: MarketingRun) => ({ headline: run.meta.overlay?.headline ?? "", body: run.meta.overlay?.body ?? "", cta: run.meta.overlay?.cta ?? "" });

/** A poster / ad whose words are set in the browser (open models, Fuobe Marketing Image), its picture ready and its words not set yet. */
function needsCompose(run: MarketingRun): boolean {
  if (!run.meta.overlay || run.meta.composed || runStatus(run).state !== "done") return false;
  return run.generations.some((g) => run.finalIds.includes(g.id) && g.outputs.some((o) => o.kind === "image"));
}

/** Set the run's words over its picture in the browser (brand fonts, logo, colours) and save it on the run. */
async function autoCompose(run: MarketingRun, brand: BrandKit | null): Promise<void> {
  const final = run.generations.find((g) => run.finalIds.includes(g.id));
  const image = final?.outputs.find((o) => o.kind === "image")?.url;
  if (!image) return;
  const [{ renderInput }, { exportPng }] = await Promise.all([import("@/components/ads/ad-editor"), import("@/components/ads/render")]);
  const ratio = composeRatio(final);
  const text = overlayText(run);
  const blob = await exportPng(renderInput({ ratio, layout: overlayLayout(run.meta.format), text, brand, image }));
  const asset = await uploadFile(new File([blob], `${run.title.replace(/[^\w-]+/g, "-").slice(0, 60) || "ad"}.png`, { type: "image/png" }));
  await send(`/api/marketing/runs/${run.id}/compose`, "POST", { url: asset.url, ratio, text: [text.headline, text.body, text.cta].filter(Boolean).join(" · "), overlay: run.meta.overlay ?? undefined, auto: true });
}

function RunCard({ run, brand, onOpen, onCompose }: { run: MarketingRun; brand?: BrandKit; onOpen: (g: Generation, i: number) => void; onCompose: (run: MarketingRun) => void }) {
  const qc = useQueryClient();
  const forget = useForgetRun(run.feature);
  const { cancel } = useGenerationActions();
  const [again, setAgain] = useState(false);
  const finals = run.generations.filter((g) => run.finalIds.includes(g.id));
  const final = finals[0];
  const status = runStatus(run);
  const steps = run.generations.filter((g) => g.request.step);
  const outputs = finals.flatMap((g) => (g.status === "succeeded" ? g.outputs.map((o, i) => ({ g, o, i })) : [])).filter((x) => x.o.kind !== "text");
  const now = steps.find((g) => g.status === "running") ?? steps.find((g) => g.status === "queued" && !g.message?.startsWith("Waits"));
  const done = steps.filter((g) => g.status === "succeeded").length;
  const cost = run.generations.reduce((n, g) => n + (g.costUsd ?? 0), 0);
  const ratio = runRatio(run, final);
  const format = run.meta.format ? FORMATS[run.meta.format] : null;
  const canCompose = !!run.meta.overlay && status.state === "done" && outputs.some((x) => x.o.kind === "image");
  // The words are set in the browser right after the picture lands; the card shows that version.
  const composed = canCompose ? run.meta.composed : null;
  const setting = canCompose && !composed;
  const runAgain = () => {
    setAgain(true);
    send<{ runs: MarketingRun[] }>(`/api/marketing/runs/${run.id}/again`, "POST")
      .then((r) => {
        addRuns(qc, run.feature, r.runs);
        toast.success("Started again", { duration: 1500 });
      })
      .catch((e) => toastError(e))
      .finally(() => setAgain(false));
  };
  return (
    <article className="group/run min-w-0 animate-fade-up">
      <div className="relative">
        {composed ? (
          <button onClick={() => onCompose(run)} className="relative block w-full overflow-hidden rounded-xl bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ aspectRatio: ratio }} aria-label={`Edit the text of ${run.title}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={composed.url} alt="" className="size-full object-cover" loading="lazy" />
          </button>
        ) : outputs.length ? (
          <div className={cn("grid gap-1.5", outputs.length > 1 && "grid-cols-2")}>
            {outputs.slice(0, 4).map(({ g, o, i }) => (
              <button key={o.url} onClick={() => onOpen(g, i)} className="relative block overflow-hidden rounded-xl bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring" style={{ aspectRatio: ratio }} aria-label={`Open ${run.title}`}>
                <MediaThumb output={o} g={g} />
                {setting && i === 0 && (
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2.5 pt-6 pb-2 text-left text-[12px] font-medium text-white">
                    <span className="shimmer-text animate-shimmer-text">Setting your text…</span>
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : status.state === "failed" || status.state === "canceled" ? (
          <div className="flex flex-col justify-between rounded-xl border border-dashed bg-background p-3" style={{ aspectRatio: Math.max(ratio, 0.75) }}>
            <div className="space-y-1">
              <p className="flex items-center gap-1.5 text-[13px] font-medium">
                <AlertCircle className="size-3.5 text-destructive" />
                {status.state === "canceled" ? "Canceled" : status.step ? `${status.step} didn't finish` : "Couldn't make this one"}
              </p>
              {status.error && <p className="line-clamp-6 text-[12px] leading-snug break-words text-muted-foreground">{status.error}</p>}
            </div>
            <button onClick={runAgain} disabled={again} className="mt-2 inline-flex h-7 w-fit items-center gap-1.5 rounded-full bg-secondary px-2.5 text-[12px] font-medium hover:bg-accent">
              {again ? <Loader2 className="size-3 animate-spin" /> : <Repeat2 className="size-3" />} Run again
            </button>
          </div>
        ) : (
          <div className="relative overflow-hidden rounded-xl bg-muted" style={{ aspectRatio: ratio }}>
            <div className="skeleton-sweep absolute inset-0 animate-skeleton" />
            <div className="absolute inset-x-0 bottom-0 p-3">
              <p className="shimmer-text animate-shimmer-text truncate text-[13px] font-medium">{now ? (now.request.step?.label ?? "Generating…") : "In queue"}…</p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {steps.length > 1 ? `Step ${Math.min(done + 1, steps.length)} of ${steps.length} · ` : ""}
                {elapsed(run.createdAt)}
              </p>
            </div>
            {steps.length > 1 && <div className="absolute inset-x-0 top-0 h-0.5 bg-primary/70 transition-[width] duration-500" style={{ width: `${Math.round((done / steps.length) * 100)}%` }} />}
          </div>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-black/45 text-white opacity-100 backdrop-blur transition-opacity hover:bg-black/65 focus-visible:opacity-100 data-[state=open]:opacity-100 sm:opacity-0 sm:group-hover/run:opacity-100" aria-label={`${run.title} actions`}>
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {composed && (
              <DropdownMenuItem asChild>
                <a href={composed.url} download>
                  <Download /> Download
                </a>
              </DropdownMenuItem>
            )}
            {outputs.map(({ o }, i) => (
              <DropdownMenuItem key={o.url} asChild>
                <a href={o.url} download>
                  <Download /> {composed ? "Download the picture without text" : `Download${outputs.length > 1 ? ` ${i + 1}` : ""}`}
                </a>
              </DropdownMenuItem>
            ))}
            {canCompose && (
              <DropdownMenuItem onClick={() => onCompose(run)}>
                <Type /> {composed ? "Edit text" : "Set your text"}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={runAgain} disabled={again}>
              <Repeat2 /> Run again
            </DropdownMenuItem>
            {run.generations.some(active) && (
              <DropdownMenuItem onClick={() => run.generations.filter(active).forEach((g) => void cancel(g))}>
                <X /> Cancel
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => forget.mutate(run.id)}>Remove from this list</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-2 min-w-0 px-0.5">
        <h3 className="truncate text-[14px] font-medium">{run.title}</h3>
        <p className="truncate text-[12px] text-muted-foreground">
          {[format?.cardLabel, run.engine === "open" ? "Open source" : "Cloud", timeAgo(run.createdAt), cost ? formatCost(cost) : "", brand?.name].filter(Boolean).join(" · ")}
        </p>
        {canCompose && (
          <button onClick={() => onCompose(run)} className="mt-1.5 inline-flex h-7 items-center gap-1.5 rounded-full bg-brand-faint px-2.5 text-[12px] font-medium text-brand-text hover:bg-brand-faint-hover">
            <Type className="size-3" /> {composed ? "Edit text" : "Set your text"}
          </button>
        )}
        {steps.length > 1 && (
          <div className="scrollbar-none mt-1.5 flex gap-1 overflow-x-auto pb-0.5">
            {steps.map((g) => (
              <StepChip key={g.id} g={g} />
            ))}
          </div>
        )}
        {run.meta.script && status.state !== "running" && <p className="mt-1.5 line-clamp-2 text-[12px] text-muted-foreground italic">“{run.meta.script}”</p>}
      </div>
    </article>
  );
}

/** A flow's runs, newest first, each with its result, live step chips and actions. */
export function RunsList({ feature, empty, limit }: { feature: RunFeature; empty?: React.ReactNode; limit?: number }) {
  const runs = useRuns(feature);
  const brands = useBrands();
  const [open, setOpen] = useState<{ id: string; index: number } | null>(null);
  const [compose, setCompose] = useState<MarketingRun | null>(null);
  const list = useMemo(() => (limit ? runs.data?.slice(0, limit) : runs.data) ?? [], [runs.data, limit]);
  // Open posters and ads get their words set as soon as the picture lands (once per run; "Edit text" changes them).
  const qc = useQueryClient();
  const tried = useRef(new Set<string>());
  useEffect(() => {
    if (brands.isLoading) return;
    for (const r of list) {
      if (!needsCompose(r) || tried.current.has(r.id)) continue;
      tried.current.add(r.id);
      autoCompose(r, brands.data?.find((b) => b.id === r.meta.brandId) ?? null)
        .then(() => qc.invalidateQueries({ queryKey: ["marketing-runs", feature] }))
        .catch(() => undefined);
    }
  }, [list, brands.isLoading, brands.data, qc, feature]);
  const flat = useMemo(() => list.flatMap((r) => r.generations.filter((g) => r.finalIds.includes(g.id) && g.status === "succeeded").flatMap((g) => g.outputs.map((_, i) => ({ g, i })))), [list]);
  const pos = open ? flat.findIndex((f) => f.g.id === open.id && f.i === open.index) : -1;
  if (runs.isLoading)
    return (
      <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i}>
            <Skeleton className="aspect-[3/4] rounded-xl" />
            <Skeleton className="mt-2 h-4 w-2/3" />
          </div>
        ))}
      </div>
    );
  if (!list.length) return <>{empty}</>;
  const composeFinal = compose?.generations.find((g) => compose.finalIds.includes(g.id));
  const composeBrand = brands.data?.find((b) => b.id === compose?.meta.brandId) ?? null;
  return (
    <>
      <div className="grid grid-cols-2 gap-x-4 gap-y-7 md:grid-cols-3 xl:grid-cols-4">
        {list.map((r) => (
          <RunCard key={r.id} run={r} brand={brands.data?.find((b) => b.id === r.meta.brandId)} onOpen={(g, index) => setOpen({ id: g.id, index })} onCompose={setCompose} />
        ))}
      </div>
      {open && pos >= 0 && (
        <Viewer
          generation={flat[pos].g}
          index={flat[pos].i}
          onIndex={(index) => setOpen({ id: flat[pos].g.id, index })}
          onClose={() => setOpen(null)}
          onPrev={pos > 0 ? () => setOpen({ id: flat[pos - 1].g.id, index: flat[pos - 1].i }) : undefined}
          onNext={pos < flat.length - 1 ? () => setOpen({ id: flat[pos + 1].g.id, index: flat[pos + 1].i }) : undefined}
        />
      )}
      {compose && composeFinal && (
        <AdEditor
          open
          onOpenChange={(o) => !o && setCompose(null)}
          title={compose.title}
          image={composeFinal.outputs.find((o) => o.kind === "image")?.url}
          ratios={[composeRatio(composeFinal)]}
          initial={{ ...overlayText(compose), layout: overlayLayout(compose.meta.format) }}
          brand={composeBrand}
          onSaveToLibrary={async (url, ratio, text) => {
            await send(`/api/marketing/runs/${compose.id}/compose`, "POST", { url, ratio, text: [text.headline, text.body, text.cta].filter(Boolean).join(" · "), overlay: { headline: text.headline, body: text.body, cta: text.cta } });
            void qc.invalidateQueries({ queryKey: ["marketing-runs", compose.feature] });
          }}
        />
      )}
    </>
  );
}
