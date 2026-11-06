"use client";

import { AudioLines, Box, Brain, CircleAlert, Clapperboard, FileText, ImageIcon, Video } from "lucide-react";
import { useState } from "react";
import type { PlannedJob } from "@/lib/assist";
import { OPERATION_LABELS, type MediaKind, type Operation } from "@/lib/catalog/types";
import { formatCost } from "@/lib/format";
import { cn } from "@/lib/utils";

const KIND_ICON: Record<MediaKind | "storyboard" | "memory", typeof ImageIcon> = { image: ImageIcon, video: Video, audio: AudioLines, text: FileText, model3d: Box, storyboard: Clapperboard, memory: Brain };

/** One job's price on a plan: Free, Demo, a price, or a dash when it can't run. */
export function jobPrice(j: PlannedJob): string {
  if (j.error) return "—";
  if (j.op === "memory") return "";
  if (j.demo) return "Placeholder";
  if (j.costUsd === 0) return "Free";
  return j.costUsd === null ? "Price varies" : formatCost(j.costUsd);
}

function jobLine(j: PlannedJob): string {
  if (j.op === "storyboard") return `Storyboard · ${j.count} frames`;
  if (j.op === "memory") return j.note ?? "Memory";
  const op = OPERATION_LABELS[j.op as Operation] ?? j.op;
  return [j.note && j.note !== op ? j.note : op, j.count > 1 ? `${j.count} takes` : ""].filter(Boolean).join(" · ");
}

/**
 * The jobs of a plan, priced, each with what stops it: Assist's approval card and a skill's "What runs". Long plans
 * (a dub, a faceless episode) fold after `fold` steps.
 */
export function PlanJobs({ jobs, fold = 6, className }: { jobs: PlannedJob[]; fold?: number; className?: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? jobs : jobs.slice(0, fold);
  return (
    <>
      <ul className={cn("divide-y", className)}>
        {shown.map((j, i) => {
          const Icon = KIND_ICON[j.op === "storyboard" ? "storyboard" : j.op === "memory" ? "memory" : j.kind];
          return (
            <li key={i} className="flex gap-3 px-4 py-3">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-secondary">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium break-words">
                  {j.modelName}
                  <span className="font-normal text-muted-foreground">
                    {" · "}
                    {jobLine(j)}
                  </span>
                </p>
                <p className={cn("mt-0.5 text-[13px] break-words", j.op === "memory" ? "text-foreground" : "line-clamp-2 text-muted-foreground")}>{j.prompt}</p>
                {!j.error && !!j.changes?.length && (
                  <ul className="mt-1 space-y-0.5 text-[12px] leading-snug text-muted-foreground">
                    {j.changes.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                )}
                {j.error && (
                  <p className="mt-1 flex items-start gap-1 text-[12px] text-destructive">
                    <CircleAlert className="mt-0.5 size-3 shrink-0" /> {j.error}
                  </p>
                )}
              </div>
              <span className="shrink-0 font-mono text-[12px] text-muted-foreground">{jobPrice(j)}</span>
            </li>
          );
        })}
      </ul>
      {jobs.length > fold && (
        <button type="button" onClick={() => setAll((v) => !v)} className="w-full border-t px-4 py-2 text-left text-[12px] font-medium text-brand-text hover:bg-accent">
          {all ? "Show fewer steps" : `Show all ${jobs.length} steps`}
        </button>
      )}
    </>
  );
}
