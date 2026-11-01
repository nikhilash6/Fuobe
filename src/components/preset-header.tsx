"use client";

import { Cloud, Cpu, Info, Sparkles, X } from "lucide-react";
import { HeaderPill } from "@/components/gpu/readiness-chip";
import { PresetPreview, usePreviewPlayback } from "@/components/preset-preview";
import { openGpuSetup, useGpuBadges } from "@/hooks/use-gpu";
import { useEngine } from "@/lib/api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { presetRecipe } from "@/lib/catalog/preset-recipes";
import type { Preset } from "@/lib/catalog/types";
import { onPeak, parityNote, presetCard, presetHowTo, presetRouteLines, previewFlip } from "@/lib/preset-cards";
// The slim covers map comes with coverPreview: this component is loaded on its own (next/dynamic in studio-page.tsx).
import { coverPreview } from "@/lib/preset-covers";
import { cn } from "@/lib/utils";

/**
 * The card a studio shows above its composer while a preset (app, camera motion, effect) is active
 * and the feed is still empty: the preview looping while it's in view (with reduced motion, Save-Data
 * or on 2G it waits for a hover or a tap), the name, one line on what to do, the models it runs on
 * behind a Details popover, and a way to clear the preset.
 *
 * Hook (studio-page.tsx, empty state, above the composer):
 *   {preset && !hasItems && <PresetHeader preset={preset} modelName={(id) => getModel(id)?.name}
 *     onClear={config.preset ? undefined : () => setDraft({ presetId: undefined })} />}
 */
export function PresetHeader({
  preset,
  modelName,
  gpuKey,
  onClear,
  className,
}: {
  preset: Preset;
  /** Display name for a model id (the studio's model lookup). */
  modelName?: (id: string) => string | undefined;
  /**
   * The preset's GPU badge for the composer's model and Quality (presetGpuKey): "<id>", "<id>@<model id>", or undefined
   * when the run is the model's own (no preset pill).
   */
  gpuKey?: string;
  /** Clear the preset (motions/effects picked in a general studio); omit on a preset's own page. */
  onClear?: () => void;
  className?: string;
}) {
  // Its gallery card's cover (coverPreview, from the slim map), on its clip's peak frame when it has one, as Home's
  // card the visitor came from (onPeak).
  const card = onPeak(presetCard(preset, coverPreview(preset)));
  const { ref, playing, asked, handlers, onTap } = usePreviewPlayback<HTMLDivElement>(card.id, card.preview, { always: true });
  // The model its preview was made with comes first (when this studio has it), marked when the live preview came from it.
  const has = (id: string) => !!modelName?.(id);
  const routes = presetRouteLines(preset, modelName, (e) => presetRecipe(preset, e, has));
  const note = parityNote(preset.parity, routes);
  // Its state on the viewer's GPU (open engine only): a pill that opens the guided fix.
  const badges = useGpuBadges().data;
  const [engine] = useEngine();
  const gpu = gpuKey && engine === "open" ? (badges?.presets[gpuKey] ?? null) : null;
  // The model its live preview was made with, said in words on the card (the composer marks it with a sparkle).
  const made = routes.find((r) => r.made && !r.alt && r.engine === engine) ?? routes.find((r) => r.made);
  return (
    <div className={cn("mx-auto flex w-full max-w-[760px] items-center gap-3 rounded-2xl border bg-background p-2 pr-3 text-left shadow-soft", className)}>
      <div
        ref={ref}
        onPointerEnter={handlers.onPointerEnter}
        onPointerLeave={handlers.onPointerLeave}
        onPointerUp={onTap}
        className="relative aspect-[4/3] w-24 shrink-0 overflow-hidden rounded-xl bg-muted sm:w-32"
      >
        <PresetPreview preview={card.preview} hue={card.hue} playing={playing} asked={asked} flip={previewFlip(card)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-heading text-[19px] leading-snug">{preset.name}</p>
        <p className="line-clamp-2 text-[13px] text-muted-foreground max-sm:line-clamp-3">{presetHowTo(preset)}</p>
        {made?.model && (
          <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] font-medium text-brand-text">
            <Sparkles className="size-3 shrink-0" aria-hidden />
            <span className="truncate">Preview made with {made.model}</span>
          </p>
        )}
      </div>
      {gpu && <HeaderPill badge={gpu} gpu={badges?.gpu} compact onOpen={() => openGpuSetup({ ref: `preset:${gpuKey}`, name: preset.name })} />}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Info className="size-3.5" />
            <span className="max-sm:sr-only">Details</span>
            <span className="sr-only"> about {preset.name}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" collisionPadding={12} className="w-[min(92vw,360px)] space-y-2 p-3 text-[13px]">
          <p className="text-muted-foreground">{preset.description}</p>
          <ul className="space-y-1">
            {/* An engine with no model for this preset has no row. */}
            {routes
              .filter((r) => r.model)
              .map((r) => (
                <li key={`${r.engine}-${r.alt ? "alt" : "first"}`} className="flex items-start gap-2">
                  {r.alt ? (
                    <span className="size-3.5 shrink-0" aria-hidden />
                  ) : r.engine === "cloud" ? (
                    <Cloud className="mt-0.5 size-3.5 shrink-0" />
                  ) : (
                    <Cpu className="mt-0.5 size-3.5 shrink-0" />
                  )}
                  <span className="text-muted-foreground">{r.alt ? "or" : r.label}</span>
                  <span className="ml-auto flex min-w-0 flex-col items-end text-right">
                    <span className={cn("max-w-full truncate font-medium", !r.model && "font-normal text-muted-foreground", r.alt && "font-normal")}>{r.model}</span>
                    {r.made && (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-brand-text">
                        <Sparkles className="size-3 shrink-0" aria-hidden />
                        Used for this preview
                      </span>
                    )}
                  </span>
                </li>
              ))}
          </ul>
          {note && <p className="border-t pt-2 text-[12px] text-muted-foreground">{note}</p>}
        </PopoverContent>
      </Popover>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={`Clear ${preset.name}`}
        >
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
