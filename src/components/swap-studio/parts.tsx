"use client";

import { AlertTriangle, CheckCircle2, CircleDashed, CircleSlash, Loader2, Pause } from "lucide-react";
import { openVideo, releaseVideo, sampleFrames } from "@/components/av/frame-sampler";
import { frameFromBlob, type Frame } from "@/components/remove-object/frame-stage";
import { jobState, type GenSummary, type JobStatus } from "@/lib/catalog/swap-studio";
import type { Engine } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";

/** Small pieces shared by Character Swap Studio's stages. */

/** "≈ $0.38", "Free · your GPU", "Placeholder · free", "Price unknown". */
export function priceText(costUsd: number | null | undefined, o: { demo?: boolean; engine: Engine }): string {
  if (o.demo) return "Placeholder · free";
  if (o.engine === "open") return "Free · your GPU";
  if (costUsd === undefined) return "…";
  if (costUsd === null) return "Price unknown";
  if (costUsd === 0) return "Free";
  return `≈ $${costUsd < 1 ? costUsd.toFixed(3).replace(/0$/, "") : costUsd.toFixed(2)}`;
}

const LABELS: Record<JobStatus, string> = {
  waiting: "Waiting",
  queued: "Queued",
  running: "Making",
  succeeded: "Ready",
  failed: "Failed",
  canceled: "Stopped",
  stopped: "Stopped",
  missing: "",
};

/** A job's state as a small chip (with its progress while it runs). */
export function JobChip({ status, progress, message, className }: { status: JobStatus; progress?: number | null; message?: string | null; className?: string }) {
  if (status === "missing") return null;
  const Icon = status === "succeeded" ? CheckCircle2 : status === "failed" ? AlertTriangle : status === "canceled" || status === "stopped" ? CircleSlash : status === "waiting" ? Pause : status === "queued" ? CircleDashed : Loader2;
  return (
    <span
      title={message ?? undefined}
      className={cn(
        "inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-full px-2 text-[11px] font-medium",
        status === "succeeded" && "bg-success/12 text-success",
        status === "failed" && "bg-destructive/10 text-destructive",
        (status === "canceled" || status === "stopped") && "bg-muted text-muted-foreground",
        (status === "queued" || status === "running" || status === "waiting") && "bg-brand-faint text-brand-text",
        className,
      )}
    >
      <Icon className={cn("size-3 shrink-0", status === "running" && "animate-spin")} aria-hidden />
      <span className="truncate">
        {LABELS[status]}
        {status === "running" && progress != null ? ` · ${Math.round(progress * 100)}%` : ""}
      </span>
    </span>
  );
}

/** A job's chip from its generations. */
export function GenChip({ genId, stepIds, gens, className }: { genId?: string; stepIds?: string[]; gens: Record<string, GenSummary>; className?: string }) {
  const s = jobState(genId, stepIds, gens);
  return <JobChip status={s.status} progress={s.progress} message={s.message} className={className} />;
}

/** What went wrong with a job, in a line (nothing while it is fine). */
export function JobError({ genId, stepIds, gens }: { genId?: string; stepIds?: string[]; gens: Record<string, GenSummary> }) {
  const s = jobState(genId, stepIds, gens);
  if ((s.status !== "failed" && s.status !== "canceled") || !s.message) return null;
  return <p className="text-[12px] text-pretty text-destructive">{s.message}</p>;
}

/** A frame of a video as a still (the browser's decode, at most `maxWidth` wide), for clicking who to swap. */
export async function grabFrame(src: string, seconds: number, maxWidth = 960): Promise<Frame> {
  const v = await openVideo(src);
  try {
    const width = Math.max(2, Math.min(maxWidth, v.videoWidth || maxWidth));
    const [f] = await sampleFrames(v, [Math.max(0, Math.min(seconds, (v.duration || seconds) - 0.02))], { width });
    const canvas = document.createElement("canvas");
    canvas.width = f.data.width;
    canvas.height = f.data.height;
    canvas.getContext("2d")!.putImageData(f.data, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that frame"))), "image/jpeg", 0.9));
    return frameFromBlob(blob);
  } finally {
    releaseVideo(v);
  }
}

/** A labelled number input that commits on blur or Enter. */
export function NumberField({
  label,
  value,
  min,
  max,
  onCommit,
  className,
  disabled,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onCommit: (v: number) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 text-[12px] font-medium", className)}>
      {label}
      <input
        key={value}
        type="number"
        inputMode="numeric"
        defaultValue={value}
        min={min}
        max={max}
        disabled={disabled}
        onBlur={(e) => {
          const n = Number(e.currentTarget.value);
          if (Number.isFinite(n) && n !== value) onCommit(Math.round(n));
        }}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="h-8 w-full min-w-0 rounded-md border bg-background px-2 font-mono text-[13px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      />
    </label>
  );
}

/** A textarea that saves when it loses focus (and shows what's saved until then). */
export function SavedText({
  label,
  value,
  placeholder,
  onSave,
  rows = 3,
  max,
  hint,
  disabled,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onSave: (v: string) => void;
  rows?: number;
  max?: number;
  hint?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2 text-[12px] font-medium">
        {label}
        {hint && <span className="truncate font-normal text-muted-foreground">{hint}</span>}
      </span>
      <textarea
        key={value}
        defaultValue={value}
        placeholder={placeholder}
        rows={rows}
        maxLength={max}
        disabled={disabled}
        onBlur={(e) => e.currentTarget.value !== value && onSave(e.currentTarget.value)}
        className="w-full min-w-0 resize-y rounded-md border bg-background px-2.5 py-2 text-[13px] leading-snug outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      />
    </label>
  );
}

/** A note in the page's quiet style. */
export function Note({ children, tone = "muted", className }: { children: React.ReactNode; tone?: "muted" | "warn"; className?: string }) {
  return (
    <p className={cn("rounded-lg px-3 py-2 text-[12px] leading-snug text-pretty", tone === "warn" ? "bg-warning/10 text-foreground" : "bg-muted text-muted-foreground", className)}>{children}</p>
  );
}
