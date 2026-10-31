"use client";

import { Plus, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MANUAL_DEFAULT, MAX_COLORS, MAX_COLORS_RECRAFT, NAME_MAX, paletteError, randomPalettes, suggestName, withBackground } from "@/lib/catalog/palettes";
import { cn } from "@/lib/utils";
import { ColorPicker } from "./color-picker";

export interface PaletteDraft {
  name: string;
  colors: string[];
  background: string | null;
}

export const manualDraft = (): PaletteDraft => ({ name: "", colors: [...MANUAL_DEFAULT.colors], background: MANUAL_DEFAULT.background });

/**
 * "Pick colors manually": the current palette as 40 px swatches (click to edit, × to remove, + Add
 * color, Clear all), a picker per swatch with "Use as background", and four random palettes to start
 * from. Save is the parent's.
 */
export function PaletteEditor({ value, onChange, onSave, saving }: { value: PaletteDraft; onChange: (v: PaletteDraft) => void; onSave: () => void; saving?: boolean }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [randoms, setRandoms] = useState(() => randomPalettes());
  // The background is its own swatch when it isn't one of the colours.
  const swatches = value.background && !value.colors.includes(value.background) ? [...value.colors, value.background] : value.colors;
  const set = (patch: Partial<PaletteDraft>) => onChange({ ...value, ...patch });
  const error = paletteError({ name: value.name || suggestName(value.colors, value.background), colors: value.colors, background: value.background });

  const replace = (i: number, hex: string) => {
    const old = swatches[i];
    if (old === value.background && !value.colors.includes(old)) return set({ background: hex });
    set({ colors: value.colors.map((c, j) => (j === i ? hex : c)), background: value.background === old ? hex : value.background });
  };
  const remove = (i: number) => {
    const c = swatches[i];
    set({ colors: value.colors.filter((x, j) => !(j === i && x === c)), background: value.background === c ? null : value.background });
    setEditing(null);
  };

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[12.5px] font-medium">Current palette</p>
          <button type="button" onClick={() => onChange({ ...value, colors: [], background: null })} className="text-[12px] text-muted-foreground hover:text-foreground">
            Clear all
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {swatches.map((c, i) => (
            <Popover key={`${i}-${c}`} open={editing === i} onOpenChange={(o) => setEditing(o ? i : null)}>
              <div className="group/sw relative">
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Edit color ${c}${c === value.background ? " (background)" : ""}`}
                    className="grid size-10 place-items-center rounded-full ring-1 ring-foreground/15 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ background: c }}
                  >
                    {c === value.background && <span className="rounded bg-background/85 px-1 text-[9px] font-semibold tracking-wide">BG</span>}
                  </button>
                </PopoverTrigger>
                <button
                  type="button"
                  aria-label={`Remove color ${c}`}
                  title="Remove color"
                  onClick={() => remove(i)}
                  className="absolute -top-1 -right-1 grid size-4 place-items-center rounded-full bg-foreground text-background opacity-100 transition sm:opacity-0 sm:group-hover/sw:opacity-100 sm:focus-visible:opacity-100"
                >
                  <X className="size-2.5" />
                </button>
              </div>
              <PopoverContent className="w-auto p-3" align="start" collisionPadding={12}>
                <ColorPicker
                  value={c}
                  onChange={(hex) => replace(i, hex)}
                  background={c === value.background}
                  onBackground={(on) => onChange(withBackground(value, c, on))}
                />
              </PopoverContent>
            </Popover>
          ))}
          <button
            type="button"
            disabled={value.colors.length >= MAX_COLORS}
            onClick={() => set({ colors: [...value.colors, "#FFFFFF"] })}
            className="inline-flex h-10 items-center gap-1 rounded-full border border-dashed px-3 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <Plus className="size-3.5" /> Add color
          </button>
        </div>
        <p className="text-[11.5px] text-muted-foreground">
          {value.colors.length}/{MAX_COLORS} colors · Recraft uses the first {MAX_COLORS_RECRAFT}
        </p>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[12.5px] font-medium">Random palettes</p>
          <button
            type="button"
            onClick={() => setRandoms(randomPalettes())}
            aria-label="Generate random palettes"
            title="Generate random palettes"
            className="grid size-7 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
        <div className="space-y-1.5">
          {randoms.map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onChange({ ...value, colors: p.slice(0, MAX_COLORS), background: null })}
              aria-label={`Use random palette ${i + 1}: ${p.slice(0, 6).join(", ")}`}
              className="flex h-7 w-full overflow-hidden rounded-md ring-1 ring-foreground/10 transition outline-none hover:ring-2 hover:ring-primary/60 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {p.slice(0, 6).map((c, j) => (
                <span key={j} className="h-full flex-1" style={{ background: c }} />
              ))}
            </button>
          ))}
        </div>
      </section>

      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1 space-y-1">
          <span className="text-[12px] text-muted-foreground">Name</span>
          <Input value={value.name} maxLength={NAME_MAX} placeholder={suggestName(value.colors, value.background)} onChange={(e) => set({ name: e.target.value })} className="h-8" />
        </label>
        <Button size="sm" className={cn("h-8")} disabled={!!error || saving} onClick={onSave} title={error ?? undefined}>
          Save palette
        </Button>
      </div>
      {error && value.colors.length === 0 && <p className="text-[12px] text-muted-foreground">Add at least one color</p>}
    </div>
  );
}
