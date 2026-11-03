"use client";

import { Heart, Loader2, Wrench } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCost } from "@/lib/format";
import { ENGINE_WORDS, type SkillRunRecord, type StepFix } from "@/lib/recipe";
import { refusalShown } from "@/lib/refusals";
import { cn } from "@/lib/utils";
import { useApplyFix, useSkillHistory, type RecipeFailure } from "./hooks";

/**
 * Keeping a saved skill working (Skills W6): its run History in the skill's dialog, and Suggest a fix on its
 * "Needs a re-check" line (a step that keeps failing, was replaced or is switched off; nothing is swapped by itself).
 */

const day = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });

const STATUS: Record<SkillRunRecord["status"], { label: string; dot: string }> = {
  succeeded: { label: "Done", dot: "bg-emerald-500" },
  failed: { label: "Failed", dot: "bg-destructive" },
  canceled: { label: "Stopped", dot: "bg-muted-foreground" },
  running: { label: "Running", dot: "bg-amber-500" },
};

/** A run's cost: Free on your GPU or as a demo, its price, or nothing while unknown. */
const runCost = (r: SkillRunRecord) => (r.demo ? "Free · demo" : r.costUsd === null ? "—" : formatCost(r.costUsd));

/** History, under a skill's Files: how often it ran, how it went, what it cost, and its last 10 runs. */
export function SkillHistorySection({ name }: { name: string }) {
  const history = useSkillHistory(name);
  const h = history.data;
  return (
    <div className="mt-4 border-t pt-3">
      <p className="text-[12px] font-medium">History</p>
      {!h ? (
        history.isError ? (
          <p className="mt-1 text-[12px] text-muted-foreground">Couldn&apos;t load its runs.</p>
        ) : (
          <Skeleton className="mt-2 h-10" />
        )
      ) : !h.runs ? (
        <p className="mt-1 text-[12px] text-muted-foreground">No runs yet. Its runs show up here, with what each one cost.</p>
      ) : (
        <>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {h.runs} run{h.runs === 1 ? "" : "s"}
            {h.successRate !== null && ` · ${Math.round(h.successRate * 100)}% succeeded`}
            {` · ${h.spentUsd ? `${formatCost(h.spentUsd)} spent` : "nothing spent"}`}
            {h.lastRun && ` · last ${day(h.lastRun)}`}
            {h.favorites > 0 && ` · ${h.favorites} with a favourite`}
          </p>
          <ul className="mt-2 divide-y rounded-lg border text-[12px]">
            {h.recent.map((r) => (
              <li key={r.run} className="flex min-w-0 items-center gap-2 px-3 py-2">
                <span className={cn("size-2 shrink-0 rounded-full", STATUS[r.status].dot)} aria-hidden />
                <span className="w-16 shrink-0 font-medium">{STATUS[r.status].label}</span>
                <span className="w-14 shrink-0 text-muted-foreground">{day(r.createdAt)}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground" title={r.error ?? undefined}>
                  {runCost(r)}
                  {r.favorite && <Heart className="ml-1.5 inline size-3 fill-current align-[-2px] text-rose-500" aria-label="A favourite" />}
                </span>
                {r.batchId && (
                  <Link href={`/library?batch=${encodeURIComponent(r.batchId)}`} className="shrink-0 text-brand-text underline underline-offset-2">
                    Open
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const pricing = (c: StepFix["candidates"][number]) =>
  c.demo ? "Placeholder · free" : c.engine === "open" ? "Free on your GPU" : c.total === null ? "Price varies" : `${formatCost(c.total)} a run`;

/** Suggest a fix: each step that needs one, the models that could take its place with their prices; checked, then saved. */
export function SuggestFix({ name, fixes, onDone }: { name: string; fixes: StepFix[]; onDone?: () => void }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const apply = useApplyFix();
  if (!fixes.length) return null;
  const save = async (f: StepFix) => {
    const modelId = picked[f.key] ?? f.candidates[0]?.modelId;
    if (!modelId) return;
    setBusy(f.key);
    try {
      const r = await apply(name, f.key, modelId);
      toast.success(r.ok ? "Fixed — checked and saved" : "Saved — one engine's check didn't pass", { description: r.ok ? "Priced, and run once on the demo provider for free." : r.engines.flatMap((e) => [...e.plan.errors, ...(e.dryRun?.problems ?? [])])[0] });
      if (fixes.length === 1) setOpen(false);
      onDone?.();
    } catch (e) {
      const fail = e as RecipeFailure;
      if (!refusalShown(fail)) toast.error(fail.message, { description: fail.problems?.slice(1).join("; ") || undefined });
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <Button variant="outline" size="xs" className="h-6 rounded-full px-2 text-[12px]" onClick={() => setOpen(true)}>
        <Wrench /> Suggest a fix
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[min(92svh,760px)] overflow-y-auto sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Suggest a fix</DialogTitle>
            <DialogDescription>Pick a model for the step. It&apos;s priced and run once for free before it&apos;s saved; nothing changes until you do.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            {fixes.map((f) => (
              <section key={f.key} aria-label={f.label} className="min-w-0">
                <p className="text-[13px] font-medium">
                  {f.label} <span className="font-normal text-muted-foreground">· {f.modelName}</span>
                </p>
                <p className="mt-0.5 text-[12px] text-amber-700 dark:text-amber-300">{f.why}</p>
                {f.candidates.length ? (
                  <RadioGroup className="mt-2 gap-1.5" value={picked[f.key] ?? f.candidates[0].modelId} onValueChange={(v) => setPicked((p) => ({ ...p, [f.key]: v }))}>
                    {f.candidates.map((c) => (
                      <Label key={c.modelId} className="flex min-w-0 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 font-normal has-data-checked:border-primary">
                        <RadioGroupItem value={c.modelId} />
                        <span className="min-w-0 flex-1 truncate text-[13px]">{c.name}</span>
                        <span className="shrink-0 text-[12px] text-muted-foreground">
                          {ENGINE_WORDS[c.engine]} · {pricing(c)}
                        </span>
                      </Label>
                    ))}
                  </RadioGroup>
                ) : (
                  <p className="mt-2 text-[12px] text-muted-foreground">No other model that&apos;s switched on does this. Switch one on in Settings → Models & licences.</p>
                )}
                {f.candidates.length > 0 && (
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" onClick={() => void save(f)} disabled={!!busy}>
                      {busy === f.key && <Loader2 className="animate-spin" />} Check and save
                    </Button>
                  </div>
                )}
              </section>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
