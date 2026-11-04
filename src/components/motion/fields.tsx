"use client";

import type { TemplateField } from "@/lib/catalog/marketing";
import { cn } from "@/lib/utils";

/**
 * A template's words, typed exactly as they will be set: each field with its count, its tip, and a plain line when the
 * words don't fit the frame (the clip is never cut short; Save waits until they fit).
 */

const box = "w-full min-w-0 rounded-xl border bg-background px-3 text-[15px] outline-none transition-[border-color,box-shadow] placeholder:text-subtle-foreground focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-brand-faint aria-invalid:border-destructive";

export const shortenLine = (f: TemplateField) => `Shorten the ${f.label.toLowerCase()} to fit`;

export function TemplateFields({ fields, values, onChange, overflow }: { fields: TemplateField[]; values: Record<string, string>; onChange: (key: string, value: string) => void; overflow: string[] }) {
  return (
    <div className="space-y-3">
      {fields.map((f) => {
        const v = values[f.key] ?? "";
        const over = overflow.includes(f.key);
        const id = `kinetic-field-${f.key}`;
        const count = [...v].length;
        return (
          <div key={f.key} className="min-w-0 space-y-1">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={id} className="text-[12px] font-medium text-muted-foreground">
                {f.label}
              </label>
              <span className={cn("font-mono text-[11px] tabular-nums text-muted-foreground", count >= f.max && "text-foreground")} aria-hidden>
                {count}/{f.max}
              </span>
            </div>
            {f.lines > 1 ? (
              <textarea id={id} value={v} onChange={(e) => onChange(f.key, e.target.value)} maxLength={f.max} rows={Math.min(4, f.lines)} aria-invalid={over || undefined} aria-describedby={over || f.hint ? `${id}-note` : undefined} className={cn(box, "field-sizing-content min-h-11 resize-none py-2.5 leading-snug")} />
            ) : (
              <input id={id} value={v} onChange={(e) => onChange(f.key, e.target.value)} maxLength={f.max} aria-invalid={over || undefined} aria-describedby={over || f.hint ? `${id}-note` : undefined} className={cn(box, "h-11")} />
            )}
            {over ? (
              <p id={`${id}-note`} role="status" className="text-[12px] text-destructive">
                {shortenLine(f)}
              </p>
            ) : (
              f.hint && (
                <p id={`${id}-note`} className="text-[11px] text-muted-foreground">
                  {f.hint}
                </p>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
