"use client";

import { useQuery } from "@tanstack/react-query";
import { Cloud, Cpu, GraduationCap, Loader2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { licenceNote, trainingSettingsHref, type TrainingTarget } from "@/lib/catalog/training";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { useMoodboardActions } from "./hooks";
import type { Moodboard } from "./logic";

type Target = TrainingTarget & { blocker: string | null; demo: boolean };

/**
 * Train a board as a Fuobe look (a style LoRA on Fuobe Soul's base): on your GPU (AI-Toolkit, free) or in the cloud
 * (fal's Z-Image trainer in style mode), each with its price first. The LoRA then is the look on Fuobe Soul on both engines.
 */
export function TrainBoardDialog({ board, open, onOpenChange }: { board: Moodboard; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { train } = useMoodboardActions();
  const q = useQuery({
    queryKey: ["moodboard-train", board.id],
    queryFn: async () => (await (await fetch(`/api/moodboards/${board.id}/train`)).json()) as { targets: Target[] },
    enabled: open,
  });
  const targets = q.data?.targets ?? [];
  const retrain = board.lora?.status === "ready";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GraduationCap className="size-5" /> {retrain ? "Retrain" : "Train"} “{board.name}” as a look
          </DialogTitle>
          <DialogDescription>
            Its {Math.min(board.images.length, 80)} images become a style LoRA. On Fuobe Soul the LoRA is the whole look, on your GPU and in the cloud, instead of
            reference images.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {q.isLoading && <p className="text-[13px] text-muted-foreground">Loading training options…</p>}
          {targets.map((t) => (
            <div key={t.id} className="rounded-xl border p-3">
              <div className="flex flex-wrap items-start gap-3">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                  {t.engine === "open" ? <Cpu className="size-4" /> : <Cloud className="size-4" />}
                </span>
                <div className="min-w-0 flex-1 basis-44">
                  <p className="flex flex-wrap items-center gap-x-2 text-[14px] font-medium">
                    {t.name}
                    <span className={cn("rounded-full px-2 py-px text-[11.5px] font-medium tabular-nums", t.costUsd === 0 ? "bg-success/15 text-success" : "bg-muted text-foreground")}>
                      {t.costUsd === 0 ? "Free" : `$${t.costUsd.toFixed(2)}`}
                    </span>
                    <span className="text-[12px] font-normal text-muted-foreground">{t.eta}</span>
                  </p>
                  <p className="text-[12px] text-muted-foreground">{t.description}</p>
                  <p className="mt-0.5 text-[11.5px] text-muted-foreground">Licence: {licenceNote(t)}</p>
                </div>
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={!!t.blocker || train.isPending || board.lora?.status === "training"}
                  onClick={() =>
                    train.mutate(
                      { id: board.id, target: t.id },
                      {
                        onSuccess: () => {
                          toast.success(t.demo ? "Demo training: nothing real is trained" : `Training “${board.name}” as a look — you can keep working`);
                          onOpenChange(false);
                        },
                        onError: (e) => toastError(e),
                      },
                    )
                  }
                >
                  {train.isPending && train.variables?.target === t.id && <Loader2 className="animate-spin" />}
                  {retrain ? "Retrain" : "Train"}
                </Button>
              </div>
              {(t.blocker || t.demo) && (
                <p className="mt-2 text-[12px] text-muted-foreground">
                  {t.blocker ?? (t.provider === "fal" ? "No fal.ai key yet: this runs as a demo and trains nothing." : "No AI-Toolkit set up yet: this runs as a demo and trains nothing.")}{" "}
                  <Link href={trainingSettingsHref(t)} className="text-brand-text underline underline-offset-2">
                    Open Settings
                  </Link>
                </p>
              )}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
