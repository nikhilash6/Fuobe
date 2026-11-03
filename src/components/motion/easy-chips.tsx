"use client";

import type { EasyGroup } from "@/lib/catalog/marketing";
import type { SizePreset } from "@/lib/motion/sizes";
import { cn } from "@/lib/utils";

/** A template's quick choices (Pace, Look, Style…), its sizes and its length: chips at least 44 px tall. */

const chip = (on: boolean) =>
  cn("inline-flex h-11 min-w-0 items-center justify-center rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring", on ? "bg-foreground text-background" : "bg-secondary text-secondary-foreground hover:bg-accent");

function Choices<T extends string>({ label, choices, value, onChange }: { label: string; choices: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex min-w-0 flex-wrap gap-1.5">
        {choices.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={value === c.id} onClick={() => onChange(c.id)} className={chip(value === c.id)}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Type: the template's own type pairing, or the brand's heading and body fonts. */
export function TypeChips({ value, onChange }: { value: boolean; onChange: (brandFonts: boolean) => void }) {
  return (
    <Choices
      label="Type"
      choices={[
        { id: "template", label: "Template type" },
        { id: "brand", label: "My brand fonts" },
      ]}
      value={value ? "brand" : "template"}
      onChange={(v) => onChange(v === "brand")}
    />
  );
}

export function EasyChips({ groups, values, onChange }: { groups: EasyGroup[]; values: Record<string, string>; onChange: (id: string, choice: string) => void }) {
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <Choices key={g.id} label={g.label} choices={g.choices} value={values[g.id] ?? g.choices[0].id} onChange={(v) => onChange(g.id, v)} />
      ))}
    </div>
  );
}

const SIZE_NAMES: Record<SizePreset, string> = { "9:16": "Story", "4:5": "Feed", "1:1": "Square", "16:9": "Wide" };

export function SizeChips({ sizes, value, onChange }: { sizes: SizePreset[]; value: SizePreset; onChange: (s: SizePreset) => void }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Size</p>
      <div role="radiogroup" aria-label="Size" className="grid min-w-0 grid-cols-4 gap-1.5">
        {sizes.map((s) => {
          const [w, h] = s.split(":").map(Number);
          return (
            <button key={s} type="button" role="radio" aria-checked={value === s} aria-label={`${s} ${SIZE_NAMES[s]}`} onClick={() => onChange(s)} className={cn("flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1.5 text-[12px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring", value === s ? "bg-foreground text-background" : "bg-secondary text-secondary-foreground hover:bg-accent")}>
              <span aria-hidden className="block rounded-[3px] border-[1.5px] border-current opacity-80" style={{ width: (w / Math.max(w, h)) * 18, height: (h / Math.max(w, h)) * 18 }} />
              <span className="tabular-nums">{s}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function LengthSlider({ min, max, value, onChange }: { min: number; max: number; value: number; onChange: (v: number) => void }) {
  if (max <= min) return null;
  const step = max - min <= 2 ? 0.5 : 1;
  return (
    <div className="min-w-0">
      <p className="mb-0.5 text-[12px] font-medium text-muted-foreground">
        Length · <span className="tabular-nums">{value} s</span>
      </p>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label="Length in seconds" aria-valuetext={`${value} seconds`} className="h-11 w-full cursor-pointer accent-[var(--primary)]" />
    </div>
  );
}
