"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AudioLines, Clapperboard, FileText, ImageIcon, Loader2, Play, RefreshCw, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { GenerationCards } from "@/components/assist/transcript";
import { Viewer } from "@/components/studio/viewer";
import { Button } from "@/components/ui/button";
import type { Generation } from "@/lib/catalog/types";
import type { ChatMessage, ChatPlan, ChatThreadView } from "@/lib/chat/types";
import { toastError } from "@/lib/refusals";
import { cn } from "@/lib/utils";
import { chatSend } from "./hooks";

const KIND_ICON = { image: ImageIcon, video: Clapperboard, audio: AudioLines, text: FileText } as const;

/**
 * A plan in a chat: what it makes, on which model, and what each step costs (the studio's own price check); Make it
 * runs it, and its results come into the chat, ready to animate or make again.
 */
export function PlanCard({
  threadId,
  message,
  generations,
  onAnimate,
  onAgain,
}: {
  threadId: string;
  message: ChatMessage & { plan: ChatPlan };
  generations: Map<string, Generation>;
  onAnimate: (url: string) => void;
  onAgain?: () => void;
}) {
  const qc = useQueryClient();
  const plan = message.plan;
  const [busy, setBusy] = useState<"run" | "skip" | null>(null);
  const [open, setOpen] = useState<{ g: Generation; i: number } | null>(null);
  const runnable = plan.jobs.some((j) => !j.error);

  const answer = async (ok: boolean) => {
    setBusy(ok ? "run" : "skip");
    try {
      const t = await chatSend<ChatThreadView>(`/api/chat/threads/${threadId}/plans/${message.id}`, "POST", { ok });
      qc.setQueryData(["chat", "thread", threadId], t);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  };

  // The stills it made, numbered as the cards number them, to animate one.
  const stills = useMemo(
    () =>
      plan.ids
        .map((id) => generations.get(id))
        .filter((g): g is Generation => !!g && g.status === "succeeded" && g.kind === "image")
        .flatMap((g) => g.outputs.filter((o) => !o.text).map((o) => o.url)),
    [plan.ids, generations],
  );
  const working = plan.ids.some((id) => {
    const g = generations.get(id);
    return !g || g.status === "queued" || g.status === "running";
  });

  return (
    <div className="mt-2 w-full max-w-[min(100%,620px)] rounded-2xl border bg-background p-3.5 shadow-soft">
      <p className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
        <Sparkles className="size-3.5 text-brand-text" />
        {plan.summary}
      </p>
      <ul className="mt-2.5 space-y-2">
        {plan.jobs.map((j, i) => {
          const Icon = KIND_ICON[j.kind as keyof typeof KIND_ICON] ?? ImageIcon;
          return (
            <li key={i} className="flex items-start gap-2.5 text-[14px]">
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                <Icon className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium">
                    {j.modelName}
                    {j.count > 1 && <span className="font-normal text-muted-foreground"> · {j.count} takes</span>}
                  </span>
                  {j.price && <span className="text-[13px] text-muted-foreground">{j.price}</span>}
                </span>
                {j.prompt && <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted-foreground">{j.prompt}</span>}
                {j.note && <span className="mt-1 block text-[12.5px] text-brand-text">{j.note}</span>}
                {j.error && <span className="mt-1 block text-[12.5px] text-muted-foreground">{j.error}</span>}
              </span>
            </li>
          );
        })}
      </ul>

      {plan.status === "ready" && (
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <Button size="sm" className="rounded-full" disabled={!runnable || !!busy} onClick={() => void answer(true)}>
            {busy === "run" ? <Loader2 className="animate-spin" /> : <Play className="fill-current" />}
            Make it
          </Button>
          <Button size="sm" variant="ghost" className="rounded-full" disabled={!!busy} onClick={() => void answer(false)}>
            Not now
          </Button>
        </div>
      )}
      {plan.status === "declined" && <p className="mt-3 text-[13px] text-muted-foreground">Kept as an idea. Ask again whenever you want it made.</p>}

      {plan.status === "running" && (
        <div className={cn("mt-3.5 space-y-3", !plan.ids.length && "mt-2")}>
          {plan.ids.length > 0 && (
            <GenerationCards
              ids={plan.ids}
              all={generations}
              onOpen={(g, i) => setOpen({ g, i })}
            />
          )}
          {working && plan.ids.length > 0 && !plan.ids.some((id) => generations.get(id)?.status === "succeeded") && (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Making it now · it appears here when it&apos;s ready
            </p>
          )}
          {plan.errors.map((e, i) => (
            <p key={i} className="text-[13px] text-muted-foreground">
              {e}
            </p>
          ))}
          {!working && (stills.length > 0 || onAgain) && (
            <div className="flex flex-wrap gap-1.5">
              {stills.slice(0, 4).map((url, i) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => onAnimate(url)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium hover:border-primary hover:text-brand-text"
                >
                  <Clapperboard className="size-3.5" />
                  {stills.length > 1 ? `Animate #${i + 1}` : "Animate it"}
                </button>
              ))}
              {onAgain && (
                <button type="button" onClick={onAgain} className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium hover:border-primary hover:text-brand-text">
                  <RefreshCw className="size-3.5" />
                  Make another
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {open && <Viewer generation={open.g} index={open.i} onClose={() => setOpen(null)} />}
    </div>
  );
}
