"use client";

import { ChevronDown, Diamond } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Kinetic's small controls: segmented choices, a slider with its number field (and, for the numbers a track can
 * animate, a key button), and a collapsible panel. Every target is at least 44 px; sliders get a 44 px hit area.
 */

export const chipClass = (on: boolean) =>
  cn(
    "inline-flex h-11 min-w-0 items-center justify-center rounded-full px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
    on ? "bg-foreground text-background" : "bg-secondary text-secondary-foreground hover:bg-accent",
  );

export const iconButton =
  "grid size-11 shrink-0 place-items-center rounded-full text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

/** One choice of several (a radio group of chips). `value` null shows none chosen (a Pro value moved it). */
export function Choices<T extends string>({
  label,
  choices,
  value,
  onChange,
  note,
  className,
}: {
  label: string;
  choices: readonly { id: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  note?: string;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">
        {label}
        {note && <span className="font-normal"> · {note}</span>}
      </p>
      <div role="radiogroup" aria-label={label} className="flex min-w-0 flex-wrap gap-1.5">
        {choices.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={value === c.id} onClick={() => onChange(c.id)} className={chipClass(value === c.id)}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A segmented control: equal parts in one rounded track. */
export function Segmented<T extends string>({
  label,
  choices,
  value,
  onChange,
  hideLabel,
}: {
  label: string;
  choices: readonly { id: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  hideLabel?: boolean;
}) {
  return (
    <div className="min-w-0">
      {!hideLabel && <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">{label}</p>}
      <div role="radiogroup" aria-label={label} className="grid min-w-0 auto-cols-fr grid-flow-col gap-0.5 rounded-full bg-secondary p-0.5">
        {choices.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={value === c.id}
            onClick={() => onChange(c.id)}
            className={cn(
              "h-11 min-w-0 truncate rounded-full px-2 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
              value === c.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}

const round = (v: number, step: number) => {
  const d = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
  return Number(v.toFixed(d));
};

export interface SliderFieldProps {
  label: string;
  /** The value in words for screen readers ("x1.00", "Off"). */
  display?: (v: number) => string;
  /** The unit shown inside the number field ("s", "°", "%"). */
  unit?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** A drag or a typed number: every change of one gesture is one undo step (`end` closes it). */
  onChange: (v: number) => void;
  onEnd?: () => void;
  /** The number field shows and takes the value in its own scale (percent: × 100). */
  scale?: number;
  /** Words at the two ends of the slider. */
  ends?: [string, string];
  /** A key button (parameter tracks): its label, and whether a key sits at the playhead. */
  keyButton?: { label: string; on: boolean; onPress: () => void };
  /** A line under it (where an Easy value came from, a limit). */
  note?: string;
  disabled?: boolean;
  /** The slider runs from max on the left to min on the right (Pace: Calmer to Punchier). */
  reverse?: boolean;
}

/** A slider with a number field beside it (44 px each; the field clamps on blur, Enter applies). */
export function SliderField({ label, display, unit, value, min, max, step, onChange, onEnd, scale = 1, ends, keyButton, note, disabled, reverse }: SliderFieldProps) {
  const id = useId();
  const shown = round(value * scale, step * scale);
  // What is typed while the field has focus (null: the field shows the value).
  const [typed, setTyped] = useState<string | null>(null);
  const text = typed ?? String(shown);
  const commit = () => {
    const n = Number(text.replace(",", ".").replace(/[^\d.+-]/g, ""));
    setTyped(null);
    if (!Number.isFinite(n) || typed === null) return;
    const v = Math.min(max, Math.max(min, n / scale));
    onChange(round(v, step));
    onEnd?.();
  };
  return (
    <div className={cn("min-w-0", disabled && "opacity-50")}>
      <label htmlFor={id} className="block truncate text-[12px] font-medium text-muted-foreground">
        {label}
      </label>
      <div className="flex min-w-0 items-start gap-1.5">
        <div className="min-w-0 flex-1">
          <input
            id={id}
            type="range"
            min={min}
            max={max}
            step={step}
            value={Math.min(max, Math.max(min, value))}
            disabled={disabled}
            dir={reverse ? "rtl" : undefined}
            onChange={(e) => onChange(Number(e.target.value))}
            onPointerUp={onEnd}
            onKeyUp={onEnd}
            onBlur={onEnd}
            aria-valuetext={display?.(value)}
            className="k-range block h-11 w-full min-w-0 cursor-pointer"
            style={
              {
                "--fill": `${((Math.min(max, Math.max(min, value)) - min) / (max - min || 1)) * 100}%`,
              } as React.CSSProperties
            }
          />
          {ends && (
            <div className="-mt-2 flex justify-between text-[12px] text-muted-foreground" aria-hidden>
              <span>{ends[0]}</span>
              <span>{ends[1]}</span>
            </div>
          )}
        </div>
        <div className="relative w-[4.5rem] shrink-0">
          <input
            type="text"
            inputMode="decimal"
            aria-label={`${label} value`}
            value={text}
            disabled={disabled}
            onFocus={() => setTyped(String(shown))}
            onChange={(e) => setTyped(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
            className={cn(
              "h-11 w-full rounded-xl border bg-background pl-2 text-right text-[13px] tabular-nums outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring",
              unit ? "pr-6" : "pr-2",
            )}
          />
          {unit && (
            <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[12px] text-muted-foreground" aria-hidden>
              {unit}
            </span>
          )}
        </div>
        {keyButton && (
          <button
            type="button"
            aria-label={keyButton.label}
            aria-pressed={keyButton.on}
            onClick={keyButton.onPress}
            disabled={disabled}
            className={cn(iconButton, keyButton.on ? "text-primary" : "text-muted-foreground")}
          >
            <Diamond className={cn("size-4", keyButton.on && "fill-current")} />
          </button>
        )}
      </div>
      {note && <p className="mt-0.5 text-[12px] text-muted-foreground">{note}</p>}
    </div>
  );
}

/** A collapsible panel with a 44 px header. */
export function Panel({ title, summary, open, onOpen, children, id }: { title: string; summary?: string; open: boolean; onOpen: (v: boolean) => void; children: React.ReactNode; id: string }) {
  return (
    <section className="min-w-0 rounded-2xl border bg-card" data-kinetic-panel={id}>
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`kinetic-panel-${id}`}
          onClick={() => onOpen(!open)}
          className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-2xl px-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="text-[14px] font-medium">{title}</span>
          {summary && <span className="min-w-0 flex-1 truncate text-right text-[12px] text-muted-foreground">{summary}</span>}
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none", !summary && "ml-auto", open && "rotate-180")} />
        </button>
      </h3>
      {open && (
        <div id={`kinetic-panel-${id}`} className="min-w-0 space-y-4 px-3.5 pt-1 pb-4">
          {children}
        </div>
      )}
    </section>
  );
}

/** The sheets' shared classes: a bottom sheet on phones, a right-hand sheet from 768 px; no slide with reduced motion. */
export const sheetClass =
  "max-h-[88svh] gap-0 overflow-y-auto rounded-t-[22px] pb-[max(1rem,env(safe-area-inset-bottom))] motion-reduce:animate-none motion-reduce:transition-none md:max-h-none md:rounded-none md:data-[side=right]:w-[420px] md:data-[side=right]:max-w-[420px]";
