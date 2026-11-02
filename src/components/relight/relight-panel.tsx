"use client";

import { Check, Plus, Trash2 } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ColorPicker } from "@/components/palettes/color-picker";
import { radioKeys, radioTab } from "@/components/studio/radio-keys";
import {
  chipOf,
  COLOR_CHIPS,
  DISTANCE_LABELS,
  DISTANCES,
  FEATURED_LOOKS,
  HEIGHT_LABELS,
  HEIGHTS,
  LOOKS,
  MAX_LIGHTS,
  SOFTNESS_LABELS,
  SOFTNESSES,
  STRENGTH_LABELS,
  STRENGTHS,
  strengthFromValue,
  strengthValueOf,
  yForHeight,
  type Light,
  type LookId,
} from "@/lib/relight/lights";
import { cn } from "@/lib/utils";

/** A row of preset chips: 44 px tall on phones, a radio group for the keyboard. */
export function Chips<T extends string | number>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T | null;
  options: { value: T; label: string; swatch?: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={radioKeys} className={cn("flex min-w-0 flex-wrap gap-1.5", className)}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={radioTab(on || (value === null && o === options[0]))}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-11 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium whitespace-nowrap transition outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9",
              on ? "border-foreground bg-foreground text-background" : "border-border bg-background text-foreground hover:bg-muted",
            )}
          >
            {o.swatch && <span aria-hidden className="size-3.5 rounded-full border border-black/15" style={{ background: o.swatch }} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/** The Looks row: one tap places a full rig. The four named looks first. */
export function LooksRow({ look, onLook }: { look: LookId | null; onLook: (id: LookId) => void }) {
  const ordered = [...LOOKS].sort((a, b) => rank(a.id) - rank(b.id));
  return (
    <Field label={look ? "Looks" : "Looks · Your lights"}>
      <Chips label="Looks" value={look} options={ordered.map((l) => ({ value: l.id, label: l.label, swatch: l.lights[0].color }))} onChange={onLook} />
    </Field>
  );
}

const rank = (id: LookId) => {
  const i = FEATURED_LOOKS.indexOf(id);
  return i < 0 ? 10 + LOOKS.findIndex((l) => l.id === id) : i;
};

/** The selected light's chips (and, on a desktop, its strength slider). */
export function LightPanel({
  lights,
  selected,
  onSelect,
  onChange,
  onRemove,
  onAdd,
  fine,
}: {
  lights: Light[];
  selected: string | null;
  onSelect: (id: string) => void;
  onChange: (l: Light) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
  /** A mouse is here: sliders show under the chips. */
  fine: boolean;
}) {
  const l = lights.find((x) => x.id === selected) ?? null;
  const behindId = useId();
  const full = lights.length >= MAX_LIGHTS;
  return (
    <div className="space-y-3" id="relight-light-panel">
      <div className="flex flex-wrap items-center gap-1.5">
        {lights.map((x, i) => (
          <button
            key={x.id}
            type="button"
            onClick={() => onSelect(x.id)}
            aria-pressed={x.id === selected}
            className={cn(
              "inline-flex h-11 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9",
              x.id === selected ? "border-foreground" : "border-border text-muted-foreground",
            )}
          >
            <span aria-hidden className={cn("size-3.5 rounded-full border border-black/15", x.behind && "ring-1 ring-foreground/40 ring-offset-1")} style={{ background: x.color }} />
            Light {i + 1}
          </button>
        ))}
        <Button variant="outline" className="h-11 rounded-full sm:h-9" onClick={onAdd} disabled={full} title={full ? "Up to 3 lights" : undefined}>
          <Plus className="size-3.5" /> Add light
        </Button>
        {full && <span className="text-[12px] text-muted-foreground">Up to 3 lights</span>}
      </div>
      {!l ? (
        <p className="text-[13px] text-muted-foreground">{lights.length ? "Pick a light to change it." : "Tap the photo to place a light, or add one."}</p>
      ) : (
        <div className="space-y-3">
          <Field label="Colour">
            <div className="flex flex-wrap items-center gap-1.5">
              <Chips label="Colour" value={chipOf(l.color)?.id ?? null} options={COLOR_CHIPS.map((c) => ({ value: c.id, label: c.label, swatch: c.hex }))} onChange={(id) => onChange({ ...l, color: COLOR_CHIPS.find((c) => c.id === id)!.hex })} />
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex h-11 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-9",
                      chipOf(l.color) ? "border-border" : "border-foreground bg-foreground text-background",
                    )}
                  >
                    <span aria-hidden className="size-3.5 rounded-full border border-black/15" style={{ background: chipOf(l.color) ? "conic-gradient(red, yellow, lime, cyan, blue, magenta, red)" : l.color }} />
                    Custom
                    {!chipOf(l.color) && <Check className="size-3.5" />}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[min(92vw,280px)] p-3" collisionPadding={12}>
                  <ColorPicker value={l.color} onChange={(hex) => onChange({ ...l, color: hex })} />
                </PopoverContent>
              </Popover>
            </div>
          </Field>
          <Field label="Height">
            <Chips label="Height" value={l.height} options={HEIGHTS.map((h) => ({ value: h, label: HEIGHT_LABELS[h] }))} onChange={(h) => onChange({ ...l, height: h, y: yForHeight(l.y, h) })} />
          </Field>
          <Field label="Distance">
            <Chips label="Distance" value={l.distance} options={DISTANCES.map((d) => ({ value: d, label: DISTANCE_LABELS[d] }))} onChange={(d) => onChange({ ...l, distance: d })} />
          </Field>
          <Field label="Softness">
            <Chips label="Softness" value={l.softness} options={SOFTNESSES.map((s) => ({ value: s, label: SOFTNESS_LABELS[s] }))} onChange={(s) => onChange({ ...l, softness: s })} />
          </Field>
          <Field label="Strength">
            <Chips
              label="Strength"
              value={l.strengthValue === undefined ? l.strength : null}
              options={STRENGTHS.map((s) => ({ value: s, label: STRENGTH_LABELS[s] }))}
              onChange={(s) => onChange({ ...l, strength: s, strengthValue: undefined })}
            />
            {fine && (
              <Slider
                className="mt-2 max-w-xs"
                aria-label="Strength"
                aria-valuetext={`${Math.round(strengthValueOf(l) * 100)} %`}
                min={0}
                max={100}
                step={1}
                value={[Math.round(strengthValueOf(l) * 100)]}
                onValueChange={([v]) => onChange({ ...l, strengthValue: v / 100, strength: strengthFromValue(v / 100) })}
              />
            )}
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-h-11 items-center gap-2">
              <Switch id={behindId} checked={!!l.behind} onCheckedChange={(on) => onChange({ ...l, behind: on || undefined })} />
              <label htmlFor={behindId} className="text-[13px]">
                Behind the subject
              </label>
            </div>
            <Button variant="ghost" className="h-11 rounded-full text-muted-foreground sm:h-9" onClick={() => onRemove(l.id)}>
              <Trash2 className="size-3.5" /> Remove light
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
