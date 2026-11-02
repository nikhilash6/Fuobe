"use client";

import { Loader2, Scissors, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { uploadFile } from "@/lib/api";
import { INSERT_STEP, insertHandles } from "@/lib/catalog/clip-windows";
import { LIGHT_PRESETS, lightPreset, SPHERE_SIZE, spherePixels, type LightPreset } from "@/lib/relight-sphere";
import { cn } from "@/lib/utils";
import { Chip } from "./chip";
import type { SlotValue } from "./media-slot";

/** The preset's sphere on a canvas (the picker's swatch at `size`, or the full picture that is uploaded). */
function sphereCanvas(preset: LightPreset, size: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(spherePixels(preset, size)), size, size), 0, 0);
  return c;
}

function Swatch({ preset, size = 56 }: { preset: LightPreset; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(spherePixels(preset, 96)), 96, 96), 0, 0);
  }, [preset]);
  return <canvas ref={ref} width={96} height={96} aria-hidden className="rounded-lg bg-muted" style={{ width: size, height: size }} />;
}

/** The light a sphere-reading relight (fal's H3 Max relight) matches: pick a preset, and its sphere becomes the run's image. */
export function LightSphereChip({ value, onChange }: { value: SlotValue | null | undefined; onChange: (v: SlotValue | null) => void }) {
  const picked = value?.name?.startsWith("light:") ? lightPreset(value.name.slice(6)) : undefined;
  const [busy, setBusy] = useState<string>();
  const pick = async (preset: LightPreset) => {
    setBusy(preset.id);
    try {
      const canvas = sphereCanvas(preset, SPHERE_SIZE);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error("Couldn't draw the light");
      const asset = await uploadFile(new File([blob], `light-${preset.id}.png`, { type: "image/png" }));
      onChange({ ref: asset.url, preview: canvas.toDataURL("image/png"), kind: "image", name: `light:${preset.id}` });
    } catch (e) {
      toast.error((e as Error).message || "Couldn't set the light");
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Chip icon={Sun} active={!!picked}>
          {picked ? `Light · ${picked.label}` : "Pick a light"}
        </Chip>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,380px)] p-3" align="start" side="top" collisionPadding={12}>
        <p className="text-[13px] font-medium">The new light</p>
        <p className="mb-2 text-[12px] text-muted-foreground">The shot is relit to match the light on the sphere.</p>
        <div className="grid grid-cols-4 gap-2">
          {LIGHT_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              title={p.hint}
              aria-pressed={picked?.id === p.id}
              disabled={!!busy}
              onClick={() => pick(p)}
              className={cn(
                "relative flex flex-col items-center gap-1 rounded-xl p-1.5 text-[11px] leading-tight transition outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50",
                picked?.id === p.id && "bg-brand-faint text-brand-text",
              )}
            >
              <Swatch preset={p} />
              <span className="text-center">{p.label}</span>
              {busy === p.id && (
                <span className="absolute inset-0 grid place-items-center rounded-xl bg-background/60" role="status" aria-label="Setting the light">
                  <Loader2 className="size-4 animate-spin" />
                </span>
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const at = (n: number) => `${Number(n.toFixed(3))} s`;

/**
 * Edit video's "Insert a moment": a two-handle range over the clip's timeline, where the new moment starts and where the
 * clip picks up again (params.startTime / params.endTime).
 */
export function InsertRangeChip({
  clip,
  start,
  resume,
  onChange,
}: {
  clip: number | undefined;
  start: number | undefined;
  resume: number | undefined;
  onChange: (start: number, resume: number) => void;
}) {
  const h = insertHandles(clip, [start, resume]);
  // The run carries both points once the clip's length is read: they start around its middle.
  useEffect(() => {
    if (clip && (start !== h.start || resume !== h.resume)) onChange(h.start, h.resume);
  }, [clip, start, resume, h.start, h.resume, onChange]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Chip icon={Scissors} active>
          {`Insert · ${at(h.start)}–${at(h.resume)}`}
        </Chip>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,420px)] space-y-3 p-3" align="start" side="top" collisionPadding={12}>
        <div>
          <p className="text-[13px] font-medium">Where the new moment goes</p>
          <p className="text-[12px] text-muted-foreground">It starts at the first handle; your clip picks up again at the second.</p>
        </div>
        <Slider
          min={h.min}
          max={h.max}
          step={INSERT_STEP}
          minStepsBetweenThumbs={1}
          value={[h.start, h.resume]}
          onValueChange={(v) => onChange(v[0], v[1])}
          thumbLabels={["New moment starts", "Clip picks up again"]}
        />
        <div className="flex justify-between text-[12px] text-muted-foreground tabular-nums">
          <span>{at(h.start)}</span>
          <span>{clip ? `of ${at(Math.round(clip * 10) / 10)}` : "Reading the clip…"}</span>
          <span>{at(h.resume)}</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
