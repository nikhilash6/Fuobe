"use client";

import { DropdownMenuRadioGroup, DropdownMenuRadioItem } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGenerationActions } from "@/lib/api";
import type { Generation, ReviewStatus } from "@/lib/catalog/types";
import { REVIEW_STATUSES, reviewInfo } from "@/lib/library";
import { cn } from "@/lib/utils";

/** The status colour (the parity studio's), ringed so the lime stays visible on a light card. */
export function ReviewDot({ status, className }: { status: ReviewStatus; className?: string }) {
  return <span aria-hidden className={cn("size-2 shrink-0 rounded-full ring-1 ring-black/15 dark:ring-white/20", className)} style={{ background: reviewInfo(status)?.color }} />;
}

/**
 * A small pill on a card or row: the status colour and its name. `narrow`: inside an `@container`
 * card, the name shows only from 200 px wide (two-column phone cards get the dot).
 */
export function ReviewBadge({ status, className, narrow }: { status: ReviewStatus | null | undefined; className?: string; narrow?: boolean }) {
  const info = reviewInfo(status);
  if (!info) return null;
  return (
    <span
      className={cn("inline-flex h-5 shrink-0 items-center gap-1 rounded-full bg-background/90 px-1.5 text-[11px] font-medium whitespace-nowrap text-foreground backdrop-blur", className)}
      title={`Review: ${info.label}`}
      aria-label={`Review: ${info.label}`}
    >
      <ReviewDot status={info.id} /> <span className={cn(narrow && "hidden @min-[200px]:inline")}>{info.label}</span>
    </span>
  );
}

const NoStatusDot = () => <span className="mx-1 size-2 shrink-0 rounded-full border border-dashed border-muted-foreground" aria-hidden />;

/**
 * "No status" and the four statuses, as menu radio items (a tile's ⋯ sub-menu, the bulk bar).
 * `value` undefined: nothing is checked (a selection with mixed statuses).
 */
export function ReviewMenuItems({ value, onPick }: { value?: ReviewStatus | null; onPick: (status: ReviewStatus | null) => void }) {
  return (
    <DropdownMenuRadioGroup value={value === undefined ? "" : (value ?? "none")} onValueChange={(v) => onPick(v === "none" ? null : (v as ReviewStatus))}>
      <DropdownMenuRadioItem value="none">
        <NoStatusDot /> No status
      </DropdownMenuRadioItem>
      {REVIEW_STATUSES.map((s) => (
        <DropdownMenuRadioItem key={s.id} value={s.id}>
          <ReviewDot status={s.id} className="mx-1" /> {s.label}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}

/** The viewer's review picker: a result's status, changed in place. */
export function ReviewSelect({ g }: { g: Generation }) {
  const actions = useGenerationActions();
  return (
    <Select value={g.review ?? "none"} onValueChange={(v) => void actions.review([g], v === "none" ? null : (v as ReviewStatus))}>
      <SelectTrigger size="sm" aria-label="Review status" className="h-7 min-w-0 text-[13px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectItem value="none">
          <NoStatusDot /> No status
        </SelectItem>
        {REVIEW_STATUSES.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            <ReviewDot status={s.id} /> {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
