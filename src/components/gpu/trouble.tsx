"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { CreditCard, Download, ExternalLink, KeyRound, Loader2, Minimize2, Monitor, Play, RefreshCw, RotateCcw, Settings2, Shuffle, Stethoscope } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { GpuTroubleView } from "@/lib/api";
import { backoffMs, retryPlan, type TroubleAction, type TroubleActionKind } from "@/lib/diagnose";
import { deviceLabel } from "@/lib/gpu/readiness";
import { cn } from "@/lib/utils";

/**
 * What an account sees when its own GPU or key has a problem (src/lib/diagnose.ts): the plain sentence, a small details
 * line for the curious, and the buttons that help (Start your pod, Check my GPU, Settings → Your GPU or Your keys, Run
 * with your fal.ai key, Add credit, Retry). Used by a failed run's tile, Settings → Your GPU and the composer's check
 * before Run.
 */

/** What "Check my GPU" learnt: the GPU answered (and what it is), or why not, in plain words. */
export type GpuCheck = { ok: true; device?: string } | { ok: false; words: string; trouble?: GpuTroubleView; retryAfterS?: number };

/**
 * Check my GPU: the saved address asked again now (PUT /api/account/gpu?test=1 { saved: true }), the same check as
 * Settings' Test. The status strip, the composer and Settings learn its answer.
 */
export async function checkMyGpu(qc?: QueryClient): Promise<GpuCheck> {
  let res: Response;
  try {
    res = await fetch("/api/account/gpu?test=1", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ saved: true }) });
  } catch {
    return { ok: false, words: "We couldn't check right now. Check this computer's internet, then try again." };
  }
  const j = (await res.json().catch(() => ({}))) as { error?: string; trouble?: GpuTroubleView; info?: { device?: string } };
  void qc?.invalidateQueries({ queryKey: ["status"] });
  void qc?.invalidateQueries({ queryKey: ["account-gpu"] });
  if (res.ok) return { ok: true, device: j.info?.device };
  const retryAfterS = Number(res.headers.get("retry-after")) || undefined;
  return { ok: false, words: j.trouble?.words ?? j.error ?? "Your GPU didn't answer.", trouble: j.trouble, ...(retryAfterS && { retryAfterS }) };
}

const ICONS: Record<TroubleActionKind, typeof Play> = {
  retry: RotateCcw,
  "check-gpu": Stethoscope,
  "gpu-settings": Settings2,
  "key-settings": KeyRound,
  "run-with-key": Shuffle,
  "add-credit": CreditCard,
  "pick-model": Shuffle,
  "start-gpu": Play,
  pair: RefreshCw,
  "use-computer": Monitor,
  "send-smaller": Minimize2,
  "try-smaller": Minimize2,
  "get-file": Download,
};

/** The first button stands out (the one most likely to help); the rest are quieter. One line each, cut short when narrow. */
const PILL = "inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium whitespace-nowrap";
const MAIN = "bg-highlight text-highlight-foreground hover:opacity-90";
const QUIET = "bg-secondary hover:bg-accent";
/** A link that leaves Fuobe (a model file's download): https only. */
const HTTPS = /^https:\/\/[^\s"'<>]+$/i;

export interface TroubleHandlers {
  onRetry?: () => void;
  /** "Run with your fal.ai key": the caller runs the cloud version (an explicit click: it spends the person's credit). */
  onRunWithKey?: (a: TroubleAction) => void | Promise<unknown>;
  onPickModel?: () => void;
  /** "Use this computer": the caller switches runs to the ComfyUI on this computer. */
  onUseComputer?: () => void | Promise<unknown>;
  /** "Send a smaller copy": the run made again with a smaller copy of its file. */
  onSendSmaller?: () => void | Promise<unknown>;
  /** "Try one size smaller": the run made again one size or length smaller. */
  onTrySmaller?: () => void | Promise<unknown>;
}

/**
 * When some buttons must go (a small tile), the ones that help least go first: Settings (Check my GPU leads there too),
 * Pair with a code, then the rest. The first button (the one most likely to help) always stays, and the order is kept.
 */
const DROP_FIRST: TroubleActionKind[] = ["gpu-settings", "pair", "use-computer", "pick-model", "retry", "check-gpu", "key-settings", "try-smaller", "send-smaller", "add-credit", "run-with-key", "get-file", "start-gpu"];

export function fitActions(actions: TroubleAction[], max?: number): TroubleAction[] {
  if (!max || actions.length <= max) return actions;
  const out = [...actions];
  for (const kind of DROP_FIRST) {
    for (let i = out.length - 1; i > 0 && out.length > max; i--) if (out[i].kind === kind) out.splice(i, 1);
    if (out.length <= max) break;
  }
  return out.slice(0, max);
}

/** A button's words where there is little room (a tile): the long Settings links get their short names. */
function shortLabel(a: TroubleAction): string {
  if (a.kind === "gpu-settings" && a.label.startsWith("Open Settings")) return "Settings";
  if (a.kind === "key-settings" && a.label.startsWith("Open Settings")) return "Your keys";
  return a.label;
}

/**
 * The buttons of a diagnosis, in its order. A button with nothing to do here is left out (Retry without a run, Pick another
 * model without a picker). `max`: at most so many (those that help least go first); `skip`: kinds the caller shows itself
 * (a tile's own Retry); `compact`: a tile (short words, no Settings beside Check my GPU); `context` "run": a run's tile
 * (Check my GPU's answer then says to press Retry). A button that starts something stays pressed until it has.
 */
export function TroubleActions({
  actions,
  handlers = {},
  max,
  skip = [],
  compact,
  context = "other",
  className,
}: {
  actions: TroubleAction[];
  handlers?: TroubleHandlers;
  max?: number;
  skip?: TroubleActionKind[];
  compact?: boolean;
  context?: "run" | "other";
  className?: string;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<TroubleActionKind | null>(null);
  const [waiting, setWaiting] = useState(false);
  const again = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (again.current) clearTimeout(again.current);
    },
    [],
  );
  const usable = actions.filter((a) => {
    if (skip.includes(a.kind)) return false;
    if (a.kind === "retry") return !!handlers.onRetry;
    if (a.kind === "run-with-key") return !!handlers.onRunWithKey;
    if (a.kind === "pick-model") return !!handlers.onPickModel;
    if (a.kind === "use-computer") return !!handlers.onUseComputer;
    if (a.kind === "send-smaller") return !!handlers.onSendSmaller;
    if (a.kind === "try-smaller") return !!handlers.onTrySmaller;
    // Where a model file downloads from: only an https link.
    if (a.kind === "get-file") return !!a.target && HTTPS.test(a.target);
    // On a tile, Check my GPU leads to Settings when that is what helps: one button fewer.
    if (compact && a.kind === "gpu-settings" && actions.some((x) => x.kind === "check-gpu") && a.label.startsWith("Open Settings")) return false;
    return true;
  });
  const shown = fitActions(usable, max);
  if (!shown.length) return null;
  // Something that takes a moment (a run on a key, a check): pressed until it is done, so a second click starts nothing.
  const press = async (kind: TroubleActionKind, fn: () => void | Promise<unknown>) => {
    if (busy) return;
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  const check = async (): Promise<void> => {
    const r = await checkMyGpu(qc);
    if (r.ok) {
      const what = r.device ? `: ${deviceLabel(r.device)}` : "";
      toast.success(context === "run" ? `Your GPU answered${what}. Press Retry to run it again.` : `Your GPU answered${what}.`, { id: "check-gpu" });
    } else if (r.retryAfterS) {
      // Too many checks in a minute: one more goes by itself once the wait is over.
      const s = Math.max(1, Math.round(r.retryAfterS));
      toast(`Too many checks. Checking again in ${s} s.`, { id: "check-gpu" });
      if (again.current) clearTimeout(again.current);
      setWaiting(true);
      again.current = setTimeout(() => {
        again.current = null;
        setWaiting(false);
        void press("check-gpu", check);
      }, s * 1000);
    } else toast(r.words, { id: "check-gpu" });
  };
  return (
    <div className={cn("flex min-w-0 flex-wrap gap-1.5", className)}>
      {shown.map((a, i) => {
        const Icon = ICONS[a.kind];
        const cls = cn(PILL, i === 0 && a.kind !== "retry" ? MAIN : QUIET);
        const words = <span className="truncate">{compact ? shortLabel(a) : a.label}</span>;
        const stop = (e: React.MouseEvent) => e.stopPropagation();
        if ((a.kind === "start-gpu" || a.kind === "add-credit" || a.kind === "get-file") && a.target) {
          return (
            <a key={a.kind} href={a.target} target="_blank" rel="noopener noreferrer" onClick={stop} title={a.label} className={cls}>
              <Icon className="size-3 shrink-0" /> {words}
              <ExternalLink className="size-3 shrink-0 opacity-60" aria-hidden />
            </a>
          );
        }
        if ((a.kind === "gpu-settings" || a.kind === "key-settings" || a.kind === "pair") && a.target) {
          return (
            <Link key={a.kind} href={a.target} onClick={stop} title={a.label} className={cls}>
              <Icon className="size-3 shrink-0" /> {words}
            </Link>
          );
        }
        const run: (() => void | Promise<unknown>) | undefined =
          a.kind === "check-gpu"
            ? check
            : a.kind === "retry"
              ? handlers.onRetry
              : a.kind === "run-with-key"
                ? () => handlers.onRunWithKey?.(a)
                : a.kind === "pick-model"
                  ? handlers.onPickModel
                  : a.kind === "use-computer"
                    ? handlers.onUseComputer
                    : a.kind === "send-smaller"
                      ? handlers.onSendSmaller
                      : a.kind === "try-smaller"
                        ? handlers.onTrySmaller
                        : undefined;
        const pending = busy === a.kind || (a.kind === "check-gpu" && waiting);
        return (
          <button
            key={a.kind}
            type="button"
            disabled={!!busy || (a.kind === "check-gpu" && waiting)}
            aria-busy={pending || undefined}
            title={a.label}
            onClick={(e) => {
              e.stopPropagation();
              if (run) void press(a.kind, run);
            }}
            className={cn(cls, "disabled:opacity-70")}
          >
            {pending ? <Loader2 className="size-3 shrink-0 animate-spin" /> : <Icon className="size-3 shrink-0" />} {words}
          </button>
        );
      })}
    </div>
  );
}

/** The small details line under the sentence: what came back, for the curious. */
export function TroubleDetails({ details, className }: { details?: string; className?: string }) {
  if (!details) return null;
  return (
    <p title={details} className={cn("line-clamp-2 font-mono text-[10.5px] leading-snug break-all text-muted-foreground/80", className)}>
      {details}
    </p>
  );
}

/** How long Settings waits before checking again by itself (diagnose.ts retryPlan "check"), or null: it doesn't. */
export function autoCheckIn(cause: GpuTroubleView["cause"], attempt: number, startedAt: number, now = Date.now()): number | null {
  const plan = retryPlan(cause, "check");
  if (!plan) return null;
  const wait = backoffMs(attempt, plan);
  return now - startedAt + wait > plan.budgetMs ? null : wait;
}
