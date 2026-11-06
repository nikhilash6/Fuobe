"use client";

import { UNAVAILABLE_OPTION, UnavailableNote, useUnavailableNote } from "@/components/ui/unavailable";
import { radioKeys, radioTab } from "@/components/studio/radio-keys";
import type { Unavailable } from "@/lib/unavailable";
import { cn } from "@/lib/utils";

/**
 * Segmented control (the app's track + white thumb), a radio group for keyboards and screen readers. An option's third
 * entry (or `unavailable` for the whole control) is a choice the current setup can't do: it stays, muted, and pressing
 * it says why (src/components/ui/unavailable.tsx). A plain `disabled` reads the same way.
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  disabled,
  unavailable,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string] | readonly [T, string, Unavailable | false | null | undefined])[];
  onChange: (v: T) => void;
  className?: string;
  disabled?: boolean;
  unavailable?: Unavailable;
}) {
  const items = options.map(([v, text, u]) => ({ value: v, text, unavailable: u || unavailable, disabled }));
  const note = useUnavailableNote(items);
  const checked = (o: (typeof items)[number]) => value === o.value && !note.isUnavailable(o);
  const stop = items.find(checked)?.value ?? items.find((o) => !note.isUnavailable(o))?.value ?? items[0]?.value;
  return (
    <>
      <div role="radiogroup" aria-label={label} onKeyDown={radioKeys} className={cn("grid h-9 rounded-full bg-muted p-0.5 text-[13px] font-medium", className)} style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked(o)}
            tabIndex={radioTab(stop === o.value)}
            {...note.optionProps(o)}
            onClick={() => note.press(o, onChange)}
            className={cn(
              "truncate rounded-full px-2 transition-colors",
              checked(o) ? "bg-background text-foreground shadow-soft" : note.isUnavailable(o) ? UNAVAILABLE_OPTION : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.text}
          </button>
        ))}
      </div>
      <UnavailableNote {...note.noteProps} />
    </>
  );
}

/** A labelled row inside a tool form. */
export function Field({ label, hint, children, htmlFor }: { label: string; hint?: React.ReactNode; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[12px] font-medium text-muted-foreground">
          {label}
        </label>
        {hint && <span className="font-mono text-[12px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** Checkerboard-backed thumbnail of a transparent image. */
export function Thumb({ src, alt = "", className }: { src: string; alt?: string; className?: string }) {
  return (
    <span className={cn("checkerboard grid shrink-0 place-items-center overflow-hidden rounded-md border", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading="lazy" draggable={false} className="max-h-full max-w-full object-contain" />
    </span>
  );
}
