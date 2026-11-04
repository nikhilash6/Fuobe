"use client";

import { Cloud, Cpu, Lock, MonitorPlay, Server } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { openAddKey } from "@/components/keys/your-keys";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import type { Engine, GenerationRequest } from "@/lib/catalog/types";
import { CONNECT_GPU_EVENT, signInHref, useHydrated, useStatus, useViewer } from "@/lib/api";
import { formatCost } from "@/lib/format";
import { quoteBody, useHostedQuote, useSettled } from "@/lib/hosted";
import { checkedPool, openCheckPlace, runPlace, type RunAudience, type RunPlace, type RunPlaceInput } from "@/lib/run-place";
import { cn } from "@/lib/utils";
import { chipBase, chipIdle } from "./chip";
import { EngineSwitch } from "./engine-switch";
import { ResponsivePanel } from "./responsive-panel";

const ICONS: Record<RunPlace["where"], typeof Cloud> = { cloud: Cloud, gpu: Cpu, pool: Server, browser: MonitorPlay, unavailable: Lock };

/**
 * Who is looking, once known (after hydration and the viewer read): the studio's owner, an account, or a guest. Null
 * before, so a chip never says "Not available here" to the owner and then takes it back. With it, the account's own GPU
 * and its first key (who its paid runs are billed to).
 */
export function useRunViewer(): { audience: RunAudience; gpu: boolean; hosted: boolean; preferPool: boolean; payer: RunPlaceInput["payer"] } | null {
  const hydrated = useHydrated();
  const viewer = useViewer().data;
  const status = useStatus().data;
  if (!hydrated || !viewer) return null;
  const audience: RunAudience = viewer.owner ? "owner" : viewer.account ? "account" : "guest";
  const keys = status?.viewer?.keys ?? [];
  return {
    audience,
    gpu: !!status?.viewer?.gpu.connected,
    hosted: !!status?.viewer?.hosted,
    preferPool: !!status?.viewer?.hosted && status.viewer.prefer === "pool",
    payer: keys.includes("fal") ? "fal" : (keys[0] ?? null),
  };
}

/** The place and price for this viewer (null until the viewer is known). */
export function useRunPlace(input: Omit<RunPlaceInput, "audience" | "format" | "gpu" | "hosted" | "preferPool" | "payer">): RunPlace | null {
  const who = useRunViewer();
  return who ? runPlace({ ...input, ...who, format: formatCost }) : null;
}

/**
 * The place and price of an open-model run sent through the studios' generations (an app's own tool): your GPU, free;
 * with hosted runs on, a guest or an account with no GPU of its own runs on this studio's GPUs once the server's price
 * check for `request` says the run goes there, at its price (null: nothing to check yet, said as your GPU). `count`: runs
 * one press starts (the quote is for one, said "each"). `ownGpuOnly`: a tool that asks an account to connect its GPU
 * instead (Relight, Any Angle), so it is never sent to this studio's GPUs.
 */
export function useOpenRunPlace(models: readonly string[], request: GenerationRequest | null, o: { count?: number; ownGpuOnly?: boolean } = {}): RunPlace | null {
  const viewer = useRunViewer();
  // Asked with the place the tool's run names (none for an account whose own GPU is there while this studio puts its
  // GPUs first: the server then sends what they don't take to that GPU, and the check answers so).
  const place = openCheckPlace(viewer, o.ownGpuOnly);
  const mayPool = place !== null;
  const checked = useHostedQuote(useSettled(mayPool ? quoteBody(request, place) : null)).data;
  if (!viewer) return null;
  // This studio's GPUs only on the server's word (as the studio composer asks it): a model it doesn't offer there, or
  // no complete run to check yet, is your GPU (connect it, or sign up).
  const pool = mayPool ? checkedPool(checked, o.count) : undefined;
  return runPlace({ engine: "open", models, ...viewer, hosted: !!pool, pool, format: formatCost });
}

/**
 * The composer's place chip: where the run happens (your GPU, the cloud model, your browser) and its price, as the
 * studio composer's model chip and price say it. It opens a panel with the whole answer: the steps and their models,
 * who pays, what this viewer does first, and the engine switch where switching exists (`onEngine`).
 */
export function RunPlaceChip({
  place,
  steps,
  engine,
  onEngine,
  pending,
  compact,
  className,
}: {
  place: RunPlace | null;
  /** The planned steps (a pipeline's script, picture, clip, voice): listed in the panel. */
  steps?: readonly { label: string; modelName: string; costUsd: number | null }[];
  engine?: Engine;
  /** Switching engine from here (the same switch as the header's). */
  onEngine?: (e: Engine) => void;
  /** The price is being worked out. */
  pending?: boolean;
  /** On phones, the icon and the price only (the icon alone when there is no price); the panel says the rest. */
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // A phone's sheet says the title and the tip in its own header; the desktop popover says them here.
  const mobile = useIsMobile();
  if (!place) return null;
  const Icon = ICONS[place.where];
  const price = pending && !place.price ? "…" : place.price;
  const canSwitch = !!(engine && onEngine && (place.where === "cloud" || place.where === "gpu" || place.where === "pool"));
  const many = (steps?.length ?? 0) > 1;
  // A compact chip on a phone: the label goes (the price stays), so the composer's other controls keep their room.
  const iconOnly = compact && !price;
  return (
    <ResponsivePanel
      open={open}
      onOpenChange={setOpen}
      title={place.title}
      description={place.tip}
      align="end"
      focusSelf
      trigger={
        <button
          type="button"
          data-run-place={place.where}
          aria-label={`${place.title}${place.model ? ` on ${place.model}` : ""}${place.price ? `, ${place.price}` : ""}. ${canSwitch ? "Details and engine" : "Details"}`}
          title={compact ? [place.label, place.price].filter(Boolean).join(" · ") : undefined}
          className={cn(chipBase, chipIdle, "max-w-full min-w-0", iconOnly && "max-sm:px-2.5", className)}
        >
          <Icon className="size-3.5 shrink-0" />
          <span className={cn("min-w-0 truncate max-sm:max-w-[9rem]", compact && "max-sm:hidden")}>{place.label}</span>
          {price && (
            <>
              <span aria-hidden className={cn("opacity-50", compact && "max-sm:hidden")}>
                ·
              </span>
              <span className="shrink-0 tabular-nums">{price}</span>
            </>
          )}
        </button>
      }
    >
      <div className="space-y-3 text-[13px]">
        {!mobile && (
          <div>
            <p className="font-semibold">{place.title}</p>
            <p className="mt-0.5 text-[12px] leading-snug text-pretty text-muted-foreground">{place.tip}</p>
          </div>
        )}
        {many && (
          <ul className="space-y-1">
            {steps!.map((s) => (
              <li key={`${s.label}-${s.modelName}`} className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="min-w-0 truncate">
                  <span className="text-muted-foreground">{s.label}</span> · {s.modelName}
                </span>
                {place.where === "cloud" && s.costUsd != null && <span className="shrink-0 font-mono text-[12px] text-muted-foreground tabular-nums">{s.costUsd === 0 ? "Free" : `≈ ${formatCost(s.costUsd)}`}</span>}
              </li>
            ))}
          </ul>
        )}
        {place.price && (
          <p className="flex items-baseline justify-between gap-3 border-t pt-2 font-medium">
            <span>{many ? "In all" : "Price"}</span>
            <span className="font-mono tabular-nums">{place.price}</span>
          </p>
        )}
        {place.needs === "signup" && (
          <Button asChild size="sm" className="w-full">
            <Link href={signInHref("signup", pathname)}>Sign up free</Link>
          </Button>
        )}
        {place.needs === "gpu" && (
          <Button size="sm" className="w-full" onClick={() => (setOpen(false), window.dispatchEvent(new Event(CONNECT_GPU_EVENT)))}>
            Connect your GPU
          </Button>
        )}
        {place.needs === "key" && (
          <Button size="sm" className="w-full" onClick={() => (setOpen(false), openAddKey("fal"))}>
            Add your key
          </Button>
        )}
        {canSwitch && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <span className="text-[12px] font-medium text-muted-foreground">Engine</span>
            <EngineSwitch value={engine!} onChange={onEngine!} size="sm" compact={false} />
          </div>
        )}
      </div>
    </ResponsivePanel>
  );
}
