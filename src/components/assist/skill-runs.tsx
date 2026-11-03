"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Clock, ExternalLink, Loader2, X } from "lucide-react";
import Link from "next/link";
import { useHydrated } from "@/lib/api";
import type { SkillRunStep, SkillRunView } from "@/lib/recipe";
import { cn } from "@/lib/utils";

/**
 * A skill's runs that span studios (recipe version 2, package W7), in its dialog: "Dub · done → Captions · running →
 * 9:16 cut · waiting", each step with "Open in <Studio>" when its studio gave a page. Polls while a run is going.
 */
export function SkillRuns({ name }: { name: string }) {
  const hydrated = useHydrated();
  const runs = useQuery({
    queryKey: ["assist-skill-runs", name],
    enabled: hydrated,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/assist/skills/${encodeURIComponent(name)}/runs`);
      // A visitor (or a skill that's gone) has no runs to show.
      if (!res.ok) return [];
      return ((await res.json()) as { items: SkillRunView[] }).items;
    },
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === "running") ? 3000 : false),
  });
  const items = runs.data ?? [];
  if (!items.length) return null;
  return (
    <section className="mb-4" aria-label="Runs">
      <p className="text-[12px] font-medium">Runs</p>
      <ul className="mt-1.5 space-y-2">
        {items.map((r) => (
          <RunRow key={r.id} run={r} />
        ))}
      </ul>
    </section>
  );
}

const RUN_WORDS: Record<SkillRunView["status"], string> = { running: "Running", done: "Done", failed: "Stopped" };
const STEP_WORDS: Record<SkillRunStep["status"], string> = { waiting: "waiting", running: "running", done: "done", failed: "failed" };

function RunRow({ run }: { run: SkillRunView }) {
  const when = new Date(run.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <li className="rounded-xl border px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
        <span>{when}</span>
        <span
          className={cn(
            "inline-flex h-5 items-center rounded-full px-2 font-medium",
            run.status === "done" && "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
            run.status === "running" && "bg-brand-faint text-brand-text",
            run.status === "failed" && "bg-destructive/10 text-destructive",
          )}
        >
          {RUN_WORDS[run.status]}
        </span>
      </div>
      <ol className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-2 text-[13px]">
        {run.steps.map((s, i) => (
          <li key={s.key} className="flex min-w-0 max-w-full flex-wrap items-center gap-x-1.5 gap-y-1">
            {i > 0 && <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
            <span className={cn("inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-muted px-2.5 py-1", s.status === "failed" && "bg-destructive/10")}>
              <StepIcon status={s.status} />
              <span className="truncate">{s.label}</span>
              <span className="shrink-0 text-muted-foreground">· {STEP_WORDS[s.status]}</span>
            </span>
            {s.href && s.studio && (
              <Link href={s.href} className="inline-flex items-center gap-1 text-[12px] text-brand-text underline underline-offset-2">
                Open in {s.studio} <ExternalLink className="size-3" aria-hidden />
              </Link>
            )}
          </li>
        ))}
      </ol>
      {run.error && <p className="mt-2 text-[12px] break-words text-destructive">{run.error}</p>}
    </li>
  );
}

function StepIcon({ status }: { status: SkillRunStep["status"] }) {
  if (status === "done") return <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />;
  if (status === "running") return <Loader2 className="size-3.5 shrink-0 animate-spin text-brand-text" aria-hidden />;
  if (status === "failed") return <X className="size-3.5 shrink-0 text-destructive" aria-hidden />;
  return <Clock className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />;
}
