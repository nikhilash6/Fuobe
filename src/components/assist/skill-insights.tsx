"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Check, CircleDashed, Loader2, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCost } from "@/lib/format";
import { refusalShown } from "@/lib/refusals";
import type { FixCandidates, SkillHistory, SkillRunRow } from "@/lib/skill-insights";
import type { SkillRunView } from "@/lib/skill-runs";
import { cn } from "@/lib/utils";
import type { RecipeFailure } from "./hooks";

/**
 * A skill's life after it is saved (packages W6 and W7), in its dialog: its runs (how many, how many worked, what they
 * cost, the last ten, and the steps of a run that waits across studios), and Suggest a fix for a step that keeps
 * failing or whose model was replaced or switched off. The owner's only: a visitor reads the skill, not its runs.
 */

async function read<T>(res: Response): Promise<T> {
  const out = (await res.json().catch(() => ({}))) as T & { error?: string; problems?: string[] };
  if (!res.ok) throw Object.assign(new Error(out.error ?? "Something went wrong. Please try again."), { status: res.status, problems: out.problems });
  return out;
}

export function useSkillHistory(name: string, enabled = true) {
  return useQuery({
    queryKey: ["assist-skill-history", name],
    enabled,
    retry: false,
    queryFn: async () => read<SkillHistory & { waiting?: SkillRunView[] }>(await fetch(`/api/assist/skills/${encodeURIComponent(name)}/history`)),
    // A run that waits across studios moves on its own: look again while one is going.
    refetchInterval: (q) => (q.state.data?.waiting?.some((r) => r.status === "running") || q.state.data?.recent.some((r) => r.status === "running") ? 4000 : false),
  });
}

export function useSkillFixes(name: string, enabled = true) {
  return useQuery({
    queryKey: ["assist-skill-fixes", name],
    enabled,
    retry: false,
    queryFn: async () => read<FixCandidates>(await fetch(`/api/assist/skills/${encodeURIComponent(name)}/fixes`)),
  });
}

const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const STATUS_WORDS: Record<SkillRunRow["status"], string> = { running: "Running", succeeded: "Done", failed: "Failed", canceled: "Stopped" };

function StatusDot({ status }: { status: SkillRunRow["status"] | "waiting" }) {
  if (status === "succeeded") return <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />;
  if (status === "failed") return <X className="size-3.5 text-destructive" aria-hidden />;
  if (status === "running") return <Loader2 className="size-3.5 animate-spin text-brand-text" aria-hidden />;
  return <CircleDashed className="size-3.5 text-muted-foreground" aria-hidden />;
}

function Thumb({ o }: { o: SkillRunRow["outputs"][number] }) {
  const cls = "size-10 shrink-0 rounded-md bg-muted object-cover";
  const still = o.kind === "image" ? o.url : o.kind === "video" ? o.poster : undefined;
  // eslint-disable-next-line @next/next/no-img-element
  if (still) return <img src={still} alt="" loading="lazy" className={cls} />;
  if (o.kind === "video") return <video src={o.url} muted playsInline preload="metadata" className={cls} />;
  return <span className={cn(cls, "grid place-items-center text-[10px] text-muted-foreground uppercase")}>{o.kind}</span>;
}

/** A run whose steps wait across studios: "Dub · done → Captions · running → 9:16 cut · waiting". */
export function RunSteps({ run }: { run: SkillRunView }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px]" aria-label="Steps">
      {run.steps.map((s, i) => (
        <li key={s.key} className="inline-flex min-w-0 items-center gap-1.5">
          {i > 0 && <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
          <StatusDot status={s.status === "done" ? "succeeded" : s.status === "failed" ? "failed" : s.status === "running" ? "running" : "waiting"} />
          <span className="min-w-0 break-words">
            {s.label} · <span className="text-muted-foreground">{s.status === "done" ? "done" : s.status}</span>
          </span>
          {s.href && (
            <Link href={s.href} className="text-brand-text underline underline-offset-2">
              Open in {s.studio ?? "the studio"}
            </Link>
          )}
        </li>
      ))}
      {run.error && (
        <li role="alert" className="basis-full text-destructive">
          {run.error}
        </li>
      )}
    </ol>
  );
}

/** History: the skill's runs in numbers, then the last ten (status, cost, when, what they made). */
export function SkillHistorySection({ name }: { name: string }) {
  const q = useSkillHistory(name);
  if (q.isError) return null;
  const h = q.data;
  return (
    <section className="mt-4 border-t pt-3" aria-labelledby={`history-${name}`}>
      <p className="text-[12px] font-medium" id={`history-${name}`}>
        History
      </p>
      {!h ? (
        <Skeleton className="mt-2 h-16" />
      ) : !h.runs && !h.waiting?.length ? (
        <p className="mt-1 text-[12px] text-muted-foreground">No runs yet. Run it, and each run shows here with what it cost.</p>
      ) : (
        <>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {h.runs} run{h.runs === 1 ? "" : "s"}
            {h.successRate !== null && ` · ${Math.round(h.successRate * 100)}% worked`}
            {` · ${formatCost(h.spendUsd)} spent`}
            {h.lastRunAt && ` · last ${day(h.lastRunAt)}`}
            {h.favorites > 0 && ` · ${h.favorites} favourite${h.favorites === 1 ? "" : "s"}`}
          </p>
          {!!h.waiting?.length && (
            <ul className="mt-2 space-y-2">
              {h.waiting.map((r) => (
                <li key={r.id} className="rounded-xl border px-3 py-2" data-skill-run={r.id}>
                  <p className="mb-1 text-[12px] text-muted-foreground">
                    {day(r.createdAt)} · {r.status === "running" ? "Running" : r.status === "failed" ? "Failed" : "Done"}
                  </p>
                  <RunSteps run={r} />
                </li>
              ))}
            </ul>
          )}
          <ul className="mt-2 divide-y rounded-xl border">
            {h.recent.map((r) => (
              <li key={r.run} className="flex items-center gap-3 px-3 py-2">
                <div className="flex shrink-0 gap-1">{r.outputs.length ? r.outputs.slice(0, 2).map((o) => <Thumb key={o.url} o={o} />) : <span className="size-10 rounded-md bg-muted" />}</div>
                <div className="min-w-0 flex-1 text-[12px]">
                  <p className="flex items-center gap-1.5 font-medium">
                    <StatusDot status={r.status} /> {STATUS_WORDS[r.status]}
                    {r.demo && <span className="font-normal text-muted-foreground">· placeholder</span>}
                  </p>
                  <p className="text-muted-foreground">
                    {day(r.at)} · {r.costUsd === null ? "price unknown" : formatCost(r.costUsd)} · {r.steps} result{r.steps === 1 ? "" : "s"}
                  </p>
                </div>
                <Link href="/library" className="shrink-0 text-[12px] text-brand-text underline underline-offset-2">
                  Library
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * Suggest a fix: the steps that need another model, each with models that do the same job here and their prices. The
 * person picks one; the skill is checked again (free) before the swap is kept. Never swapped by itself.
 */
export function FixPanel({ name, onClose }: { name: string; onClose: () => void }) {
  const q = useSkillFixes(name);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const pick = async (step: string, modelId: string) => {
    setBusy(`${step}:${modelId}`);
    try {
      const r = await read<{ ok: boolean; problems: string[] }>(
        await fetch(`/api/assist/skills/${encodeURIComponent(name)}/fixes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step, modelId }) }),
      );
      if (r.ok) {
        toast.success("Fixed and tested", { description: "The step uses the new model. A free test run priced it and ran it once with placeholder results." });
        void qc.invalidateQueries({ queryKey: ["assist-recipe", name] });
        void qc.invalidateQueries({ queryKey: ["assist-skill-fixes", name] });
        onClose();
      } else toast.error("That model didn't pass the test run, so nothing changed", { description: r.problems[0] });
    } catch (e) {
      const f = e as RecipeFailure;
      if (!refusalShown(f)) toast.error(f.message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mt-3 rounded-xl border bg-background p-3 text-left text-[13px] text-foreground" role="region" aria-label="Suggest a fix">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">Suggest a fix</p>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close the fixes">
          <X />
        </Button>
      </div>
      {q.isError ? (
        <p className="mt-1 text-destructive">{(q.error as Error).message}</p>
      ) : !q.data ? (
        <Skeleton className="mt-2 h-16" />
      ) : !q.data.steps.length ? (
        <p className="mt-1 text-muted-foreground">Every step looks fine. Test it again (free) to see its price today.</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {q.data.steps.map((s) => (
            <li key={s.key}>
              <p className="font-medium">
                {s.label} · {s.model}
              </p>
              <p className="text-[12px] text-amber-700 dark:text-amber-300">{s.reasons.join(" · ")}</p>
              {!s.candidates.length ? (
                <p className="mt-1 text-[12px] text-muted-foreground">No other model here does this job. Switch one on in Settings → Models &amp; licences.</p>
              ) : (
                <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                  {s.candidates.map((c) => (
                    <li key={c.modelId}>
                      <button
                        type="button"
                        disabled={!!busy || !!c.problem}
                        onClick={() => void pick(s.key, c.modelId)}
                        className="flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors hover:bg-accent disabled:opacity-60"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-[13px]">{c.name}</span>
                          <span className="block text-[11px] text-muted-foreground">{c.problem ?? (c.engine === "open" ? "Your GPU" : "Cloud")}</span>
                        </span>
                        <span className="shrink-0 text-[12px] tabular-nums">{busy === `${s.key}:${c.modelId}` ? <Loader2 className="size-3.5 animate-spin" /> : formatCost(c.costUsd)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The amber line a skill gets when a step keeps failing (its re-check line covers replaced and switched-off models). */
export function FailingLine({ fixes, onFix }: { fixes: FixCandidates | undefined; onFix: () => void }) {
  const failing = fixes?.steps.find((s) => s.reasons.some((r) => r.startsWith("It failed")));
  if (!failing) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-amber-700 dark:text-amber-300">
      <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 break-words">
        {failing.label}: {failing.reasons.find((r) => r.startsWith("It failed"))?.toLowerCase()}
      </span>
      <Button variant="outline" size="xs" className="h-6 rounded-full px-2 text-[12px]" onClick={onFix}>
        <Wrench /> Suggest a fix
      </Button>
    </div>
  );
}
