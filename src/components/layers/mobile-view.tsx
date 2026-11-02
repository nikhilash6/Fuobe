"use client";

import { ArrowLeft, EyeOff, Layers, Loader2, MonitorSmartphone, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PhoneNavButton } from "@/components/nav/phone-nav-button";
import { Skeleton } from "@/components/ui/skeleton";
import { DECOMPOSE_COPY, jobStatusText, type LayerDoc, type LayerJob, type LayerProject } from "@/lib/layers";
import { isFailed, isRunning, latestJob } from "./editor-context";
import { LayerThumb } from "./layers-panel";
import { renderDoc, toBlob } from "./render";
import { DownloadMenu } from "./top-bar";

/**
 * Phones: a friendly read-only view with the picture, its layers and the downloads. An image that
 * isn't split yet can be separated with one tap (the default settings); everything else waits for a
 * larger screen.
 */
export function MobileView({
  project,
  doc,
  jobs,
  decomposed,
  separateCost,
  onSeparate,
  onDismiss,
}: {
  project: LayerProject;
  doc: LayerDoc;
  jobs: LayerJob[];
  decomposed: boolean;
  separateCost: string;
  onSeparate: () => Promise<void>;
  onDismiss: (jobId: string) => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    let gone = false;
    void renderDoc(doc, { scale: Math.min(1, 1200 / Math.max(doc.width, doc.height)) })
      .then((c) => toBlob(c))
      .then((b) => {
        if (gone) return;
        url = URL.createObjectURL(b);
        setPreview(url);
      })
      .catch(() => setPreview(doc.source));
    return () => {
      gone = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [doc]);
  const rows = [...doc.nodes].sort((a, b) => b.z - a.z);
  const job = latestJob(jobs, ["decompose"]);
  const pending = job?.state === "pending" ? job : undefined;
  const running = pending && !isFailed(pending) ? pending : undefined;
  const failed = pending && isFailed(pending) ? pending : undefined;

  return (
    <div className="flex min-h-content min-w-0 flex-col">
      <header className="sticky top-chrome z-20 flex h-14 items-center gap-1.5 bg-background/85 px-3 backdrop-blur">
        <Button asChild variant="ghost" size="icon-sm" aria-label="All projects">
          <Link href="/layers">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="min-w-0 flex-1 truncate font-heading text-[20px]">{project.name}</h1>
        <DownloadMenu doc={doc} name={project.name} jobs={jobs} compact />
        <PhoneNavButton />
      </header>
      <div className="mx-auto w-full max-w-xl flex-1 space-y-5 px-4 pb-12">
        {!decomposed && !running && !failed ? (
          <div className="space-y-3 rounded-xl border bg-card p-4">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-faint text-brand-text">
                <Layers className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[14px] font-medium">Separate this image into layers</p>
                <p className="text-[13px] text-pretty text-muted-foreground">One tap splits it into subject, background and details with the standard settings. Moving and editing the layers needs a larger screen.</p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[12px] text-muted-foreground">{separateCost}</span>
              <Button
                className="rounded-full"
                disabled={starting}
                onClick={async () => {
                  setStarting(true);
                  try {
                    await onSeparate();
                  } finally {
                    setStarting(false);
                  }
                }}
              >
                {starting ? <Loader2 className="animate-spin" /> : <Layers />} Separate layers
              </Button>
            </div>
          </div>
        ) : running ? (
          <div className="space-y-2 rounded-xl border bg-card p-4 text-center" role="status" aria-live="polite">
            <Loader2 className="mx-auto size-5 animate-spin text-brand-text" />
            <p className="font-heading text-[19px]">{isRunning(running) ? DECOMPOSE_COPY.processing[0] : DECOMPOSE_COPY.ready[0]}</p>
            <p className="text-[12px] text-muted-foreground">{isRunning(running) ? jobStatusText(running.result) : "Laying the layers out…"}</p>
            {running.result?.progress ? <Progress value={running.result.progress * 100} className="h-1" aria-label="Progress" /> : null}
          </div>
        ) : failed ? (
          <div role="alert" className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="flex items-center gap-1.5 text-[14px] font-medium text-destructive">
              <TriangleAlert className="size-4" /> {DECOMPOSE_COPY.failed[0]}
            </p>
            <p className="text-[13px] text-muted-foreground">{failed.result?.error ?? DECOMPOSE_COPY.failed[1]}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="rounded-full" onClick={() => onDismiss(failed.id)}>
                Dismiss
              </Button>
              <Button
                size="sm"
                className="rounded-full"
                disabled={starting}
                onClick={async () => {
                  onDismiss(failed.id);
                  setStarting(true);
                  try {
                    await onSeparate();
                  } finally {
                    setStarting(false);
                  }
                }}
              >
                Try again
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-xl border bg-card p-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-faint text-brand-text">
              <MonitorSmartphone className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-medium">Layers works best on a larger screen</p>
              <p className="text-[13px] text-pretty text-muted-foreground">Open this project on a computer to move and edit its layers. Here you can preview it and download the layers.</p>
            </div>
          </div>
        )}
        <div className="checkerboard overflow-hidden rounded-xl border" style={{ aspectRatio: `${doc.width} / ${doc.height}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt={`${project.name}, all visible layers`} className="size-full object-contain" /> : <Skeleton className="size-full rounded-none" />}
        </div>
        <section aria-labelledby="mobile-layers">
          <h2 id="mobile-layers" className="mb-2 text-[13px] font-semibold">
            Layers <span className="font-mono font-normal text-muted-foreground">{rows.length}</span>
          </h2>
          <ul className="divide-y rounded-xl border">
            {rows.map((n) => (
              <li key={n.id} className="flex items-center gap-3 px-3 py-2">
                <LayerThumb node={n} />
                <span className="min-w-0 flex-1 truncate text-[14px]">{n.name}</span>
                {n.hidden && <EyeOff className="size-4 text-muted-foreground" aria-label="Hidden" />}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
