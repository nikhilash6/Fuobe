"use client";

import { CheckCircle2, Cpu, Download, ExternalLink, Loader2, RefreshCw, Wrench } from "lucide-react";
import { openGpuSetup, useGpuCheck, useGpuPlan } from "@/hooks/use-gpu";
import { fileSteps, getItLabel, putItIn, readinessLine, type FileStep } from "@/lib/gpu/file-steps";
import type { Badge, FixPlan } from "@/lib/gpu/types";
import { cn } from "@/lib/utils";

/**
 * The files a tool needs on the viewer's GPU: each one's name and size, its exact file name, the folder it goes in, and
 * "Get it" (its download, or its page when that comes first). The guided fix lists them; the readiness line above a
 * preset's Render names them; a failed run's tile can show the same rows. A one-click install (Fuobe Connect, with its
 * SHA-256 check) would sit next to Get it, as the step's `via` "helper": until then every file is by hand.
 */

/** Get it: a link that leaves Fuobe (https only, checked when the plan was built). */
export function GetIt({ f, className }: { f: Pick<FileStep, "url" | "page" | "file">; className?: string }) {
  if (!f.url) return null;
  const label = getItLabel(f);
  return (
    <a
      href={f.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      aria-label={`${label}: ${f.file}`}
      className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-highlight px-3 text-[12px] font-medium text-highlight-foreground hover:opacity-90", className)}
    >
      {f.page ? <ExternalLink aria-hidden className="size-3.5" /> : <Download aria-hidden className="size-3.5" />}
      {label}
    </a>
  );
}

/** One row per file: what it is, the exact file, the folder, and Get it. */
export function FileStepRows({ plan, className }: { plan: Pick<FixPlan, "steps">; className?: string }) {
  const files = fileSteps(plan);
  if (!files.length) return null;
  return (
    <ul className={cn("divide-y rounded-lg border", className)}>
      {files.map((f) => (
        <li key={f.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3 py-2.5 text-[13px]">
          <div className="min-w-0 flex-1 basis-56">
            <p className="font-medium">
              {f.title}
              {f.size && <span className="font-normal text-muted-foreground"> · {f.size}</span>}
            </p>
            <p className="mt-0.5 font-mono text-[12px] break-all">{f.file}</p>
            <p className="mt-0.5 text-[12px] break-words text-muted-foreground">
              {f.again ? "The one there isn't usable: download it again. " : ""}
              {putItIn(f)}
              {f.page ? ". Sign in or accept its licence on its page first." : ""}
            </p>
          </div>
          <GetIt f={f} />
        </li>
      ))}
    </ul>
  );
}

/**
 * A failed run's tile (or any small place): the files its tool needs, from the plan the server builds from the last GPU
 * check, with Get it and Check again. Nothing when the plan has no file to add.
 */
export function GpuFileSteps({ gpuRef, className }: { gpuRef: string; className?: string }) {
  const plan = useGpuPlan(gpuRef).data;
  const check = useGpuCheck();
  const files = fileSteps(plan);
  if (!files.length) return null;
  return (
    <div className={cn("space-y-1.5 text-[12px]", className)} onClick={(e) => e.stopPropagation()}>
      {files.map((f) => (
        <div key={f.id} className="flex flex-wrap items-start gap-x-2 gap-y-1">
          <div className="min-w-0 flex-1 basis-40">
            <p className="font-medium">
              {f.title}
              {f.size && <span className="font-normal text-muted-foreground"> · {f.size}</span>}
            </p>
            <p className="font-mono text-[11px] break-all">{f.file}</p>
            <p className="text-[11px] break-words text-muted-foreground">{putItIn(f)}</p>
          </div>
          <GetIt f={f} className="h-7 px-2.5" />
        </div>
      ))}
      <button
        type="button"
        disabled={check.running}
        onClick={() => void check.start()}
        className="inline-flex h-7 items-center gap-1 rounded-full bg-secondary px-2.5 font-medium hover:bg-accent disabled:opacity-70"
      >
        {check.running ? <Loader2 aria-hidden className="size-3 animate-spin" /> : <RefreshCw aria-hidden className="size-3" />}
        Check again
      </button>
    </div>
  );
}

/**
 * The readiness line above Render (a preset on the viewer's own GPU): "Ready on your GPU", or "Needs 1 file on your GPU:
 * Orbit LoRA · Get it · Check again". It reads the cached badge, and the tool's plan only when something is missing (the
 * plan reads the last GPU check; only Check again asks the GPU). It never stops Render.
 */
export function GpuReadinessLine({ badge, gpuRef, name, className }: { badge: Badge | null; gpuRef: string; name?: string; className?: string }) {
  const missing = !!badge && (badge[0] === "a" || badge[0] === "s");
  const plan = useGpuPlan(missing ? gpuRef : null).data;
  const check = useGpuCheck();
  const line = readinessLine(badge, plan);
  if (!line) return null;
  const open = () => openGpuSetup({ ref: gpuRef, name, ...(plan && { plan }) });
  if (line.state === "ready")
    return (
      <p role="status" className={cn("flex items-center gap-1.5 text-[12px] text-muted-foreground", className)}>
        <CheckCircle2 aria-hidden className="size-3.5 text-success" /> {line.words}
      </p>
    );
  const one = line.files.length === 1 ? line.files[0] : undefined;
  return (
    <div role="status" className={cn("flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl bg-muted/60 px-3 py-2 text-[12px]", className)}>
      {line.state === "gpu" ? <Cpu aria-hidden className="size-3.5 shrink-0" /> : line.state === "problem" ? <Wrench aria-hidden className="size-3.5 shrink-0" /> : <Download aria-hidden className="size-3.5 shrink-0" />}
      <button type="button" onClick={open} className="min-w-0 flex-1 basis-48 text-left font-medium underline-offset-2 hover:underline">
        {line.words}
        {one?.size && <span className="font-normal text-muted-foreground"> · {one.size}</span>}
      </button>
      <span className="flex flex-wrap items-center gap-1.5">
        {one ? (
          <GetIt f={one} className="h-7 px-2.5" />
        ) : (
          <button type="button" onClick={open} className="inline-flex h-7 items-center rounded-full bg-highlight px-2.5 font-medium text-highlight-foreground hover:opacity-90">
            {line.files.length ? "See the files" : "See how"}
          </button>
        )}
        {line.state !== "gpu" && (
          <button
            type="button"
            disabled={check.running}
            onClick={() => void check.start()}
            className="inline-flex h-7 items-center gap-1 rounded-full bg-secondary px-2.5 font-medium hover:bg-accent disabled:opacity-70"
          >
            {check.running ? <Loader2 aria-hidden className="size-3 animate-spin" /> : <RefreshCw aria-hidden className="size-3" />}
            Check again
          </button>
        )}
      </span>
      {check.error && <p className="w-full text-destructive">{check.error}</p>}
    </div>
  );
}
