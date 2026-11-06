"use client";

import { Info } from "lucide-react";
import { useId, useState } from "react";
import { pressOption, runFix, unavailableOf, type Unavailable } from "@/lib/unavailable";
import { cn } from "@/lib/utils";

/*
 * Choices the current model or mode can't do (src/lib/unavailable.ts): every picker shows them the same way.
 *
 * - The option stays in view, muted, with a not-allowed cursor and aria-disabled (never `disabled`, so it can still be
 *   focused and pressed). Hover and press never light it, and it is never drawn as the picked one.
 * - Pressing it picks nothing. A short note under the picker says why, with the way to get it ("Switch").
 * - The note goes away when something else is picked, when its fix runs, or once the choice can be picked again.
 *
 * Use: `const note = useUnavailableNote(options)`; on each option `onClick={() => note.press(o, onChange)}`,
 * `{...note.optionProps(o)}` and `className={cn(base, note.isUnavailable(o) && UNAVAILABLE_OPTION)}`; after the
 * picker `<UnavailableNote {...note.noteProps} />`.
 */

/** An option the current setup can't do: muted, not-allowed, and no hover light (its own fill stays as it is). */
export const UNAVAILABLE_OPTION =
  "cursor-not-allowed text-muted-foreground opacity-45 shadow-none hover:text-muted-foreground";

type Opt<T> = { value: T; unavailable?: Unavailable | false | null; disabled?: boolean; title?: string };

/** The note's state for one picker: which unavailable option was pressed, and its words while it still applies. */
export function useUnavailableNote<T>(options: readonly Opt<T>[]) {
  const id = useId();
  const [said, setSaid] = useState<{ value: T } | null>(null);
  const option = said ? options.find((o) => Object.is(o.value, said.value)) : undefined;
  // Read again from the current options: once the setup can do it, the note is gone by itself.
  const reason = option ? unavailableOf(option) : undefined;
  const close = () => setSaid(null);
  return {
    /** The reason being said (undefined: no note). */
    reason,
    isUnavailable: (o: Opt<T>) => !!unavailableOf(o),
    /** An available option is picked (and the note closes); an unavailable one only opens its note. */
    press: (o: Opt<T>, pick: (v: T) => void) =>
      pressOption(
        o,
        (v) => {
          close();
          pick(v);
        },
        (v) => setSaid({ value: v }),
      ),
    /** ARIA and the tooltip for an option. */
    optionProps: (o: Opt<T>) => {
      const u = unavailableOf(o);
      if (!u) return { title: o.title };
      return {
        "aria-disabled": true as const,
        title: u.why,
        ...(reason && option && Object.is(option.value, o.value) ? { "aria-describedby": id } : {}),
      };
    },
    noteProps: { id, reason, onClose: close },
  };
}

/** The note under a picker: why the pressed choice can't be had now, and the way to get it. */
export function UnavailableNote({ id, reason, onClose, className }: { id?: string; reason: Unavailable | undefined; onClose: () => void; className?: string }) {
  if (!reason) return null;
  return (
    <p
      id={id}
      role="status"
      className={cn(
        "mt-1.5 flex w-full basis-full items-center gap-2 rounded-xl bg-muted/60 py-1.5 pr-1.5 pl-2.5 text-[12px] leading-snug text-pretty text-muted-foreground",
        "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1",
        className,
      )}
    >
      <Info className="size-3.5 shrink-0 text-brand-text" aria-hidden />
      <span className="min-w-0 flex-1">{reason.why}</span>
      {reason.fix && (
        <button
          type="button"
          onClick={() => runFix(reason, onClose)}
          className="inline-flex h-7 shrink-0 items-center rounded-full bg-brand-faint px-3 text-[12px] font-medium text-brand-text transition-colors outline-none hover:bg-brand-faint-hover focus-visible:ring-2 focus-visible:ring-ring max-sm:h-8"
        >
          {reason.fix.label}
        </button>
      )}
    </p>
  );
}
