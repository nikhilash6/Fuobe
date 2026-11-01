"use client";

import { FlaskConical, PencilRuler, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { KIND_COLOR } from "@/lib/layout-edit";
import type { LayoutDraft } from "@/lib/layout-prompt";
import { cn } from "@/lib/utils";

const ratioOf = (aspect: string | undefined) => {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect ?? "");
  return m ? Number(m[1]) / Number(m[2]) : 1;
};

/**
 * Layout mode's strip above the prompt (as Frames mode has its strip): a small picture of the boxes, what the model
 * makes of them and at what size, the notes (a model that reads words, a size past what box models were made for, the
 * plan's refusal), Edit and the way out. The editor itself opens in a dialog (layout-editor.tsx).
 */
export function LayoutStrip({
  layout,
  aspect,
  summary,
  notes,
  action,
  onEdit,
  onClose,
}: {
  layout: LayoutDraft;
  aspect: string | undefined;
  /** "Compiled for MOSS-Image at 1360 × 768". */
  summary: string;
  notes: { text: string; tone: "info" | "warn" }[];
  /** A one-tap fix offered with the notes (Use MOSS-Image). */
  action?: { label: string; onClick: () => void };
  onEdit: () => void;
  onClose: () => void;
}) {
  const ratio = ratioOf(aspect ?? layout.aspect);
  const n = layout.items.length;
  return (
    <div className="mx-1 mt-1 mb-2 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-2xl border bg-muted/40 p-2" data-layout-strip>
      <button
        type="button"
        onClick={onEdit}
        aria-label={n ? `Edit the layout: ${n} box${n === 1 ? "" : "es"}` : "Draw the layout"}
        className="relative h-16 shrink-0 overflow-hidden rounded-lg border bg-background transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        style={{ width: `${Math.round(Math.min(112, Math.max(40, 64 * ratio)))}px` }}
      >
        {layout.items.map((it, i) => (
          <span
            key={i}
            aria-hidden
            className="absolute rounded-[2px] border"
            style={{
              left: `${it.box[0] * 100}%`,
              top: `${it.box[1] * 100}%`,
              width: `${(it.box[2] - it.box[0]) * 100}%`,
              height: `${(it.box[3] - it.box[1]) * 100}%`,
              borderColor: it.color ?? KIND_COLOR[it.label],
              background: `color-mix(in oklab, ${it.color ?? KIND_COLOR[it.label]} 18%, transparent)`,
            }}
          />
        ))}
        {!n && <PencilRuler aria-hidden className="absolute inset-0 m-auto size-4 text-muted-foreground" />}
      </button>
      <div className="min-w-[9rem] flex-1 space-y-0.5 pt-0.5">
        <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] font-medium">
          Layout
          <span className="inline-flex items-center gap-0.5 rounded-full bg-secondary px-1.5 text-[11px] font-medium text-secondary-foreground">
            <FlaskConical aria-hidden className="size-3" /> Experimental
          </span>
          <span className="font-normal text-muted-foreground">
            · {n ? `${n} box${n === 1 ? "" : "es"}` : "no boxes yet"}
          </span>
        </p>
        <p className="text-[12px] leading-snug text-muted-foreground">{summary}</p>
        {notes.map((x, i) => (
          <p key={i} className={cn("text-[12px] leading-snug", x.tone === "warn" ? "text-warning" : "text-muted-foreground")}>
            {x.text}
            {i === 0 && action && (
              <>
                {" "}
                <button type="button" onClick={action.onClick} className="font-medium text-brand-text underline-offset-2 hover:underline">
                  {action.label}
                </button>
              </>
            )}
          </p>
        ))}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button variant="secondary" size="sm" className="h-8 rounded-full px-3 text-[13px]" onClick={onEdit}>
          {n ? "Edit boxes" : "Draw boxes"}
        </Button>
        <button type="button" onClick={onClose} aria-label="Layout off" className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
