"use client";

import { Sparkles } from "lucide-react";
import { IntentLink } from "@/components/intent-link";
import { DropdownMenuItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { exploreProgress, nextToTry } from "@/lib/nav-explore";
import type { NavEntry } from "@/lib/nav-model";
import { cn } from "@/lib/utils";
import { CoverThumb } from "./cover-thumb";
import { NAV_MENU_ITEM } from "./create-menu";
import { useExplored } from "./explore-tracker";
import { useViewerKind } from "./nav-ui";

/**
 * How many studios this browser has tried and the next one to try, as one small row with a 40 px cover. Lives in the
 * account menu (`menu`: a menu item, so arrow keys reach it) and the phone's You sheet (`sheet`). Nothing on the
 * server, while hydrating, when this browser's storage is blocked, or before the first studio is tried.
 */
export function ExploreProgress({
  variant,
  onNavigate,
}: {
  variant: "menu" | "sheet";
  /** The suggestion was followed (the You sheet closes). */
  onNavigate?: () => void;
}) {
  const explored = useExplored();
  const kind = useViewerKind();
  if (!explored) return null;
  const { done, total } = exploreProgress(kind, explored);
  if (!total || !done) return null;
  const next = done < total ? nextToTry(kind, explored, explored[explored.length - 1]) : undefined;
  return <ExploreView variant={variant} done={done} total={total} next={next} onNavigate={onNavigate} />;
}

const ROW = "flex min-h-12 items-center gap-3 rounded-[12px] px-1.5 py-1 text-left";

/** The row itself, from numbers (ExploreProgress reads them from this browser). */
export function ExploreView({
  variant,
  done,
  total,
  next,
  onNavigate,
}: {
  variant: "menu" | "sheet";
  done: number;
  total: number;
  next?: NavEntry;
  onNavigate?: () => void;
}) {
  const menu = variant === "menu";
  const count = `${done} of ${total} studios tried`;
  if (done >= total || !next) {
    const body = (
      <>
        <span className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-brand-faint text-brand-text">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <span className="text-[13px] font-medium text-foreground">{done >= total ? "You have tried every studio" : count}</span>
      </>
    );
    return menu ? <DropdownMenuLabel className={cn(ROW, "font-normal")}>{body}</DropdownMenuLabel> : <div className={ROW}>{body}</div>;
  }
  const body = (
    <>
      <CoverThumb id={next.cover} size="pill" icon={next.icon} />
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[13px] font-medium text-foreground">
          <span className="text-muted-foreground">Next to try: </span>
          {next.label}
        </span>
        <span className="truncate text-[11.5px] text-muted-foreground">{count}</span>
      </span>
    </>
  );
  // One name for the whole row.
  const label = `Next to try: ${next.label}, ${next.what}. ${count}`;
  return menu ? (
    <DropdownMenuItem asChild className={cn(ROW, "cursor-pointer focus:bg-accent", NAV_MENU_ITEM)}>
      <IntentLink href={next.href} aria-label={label} onClick={onNavigate}>
        {body}
      </IntentLink>
    </DropdownMenuItem>
  ) : (
    <IntentLink
      href={next.href}
      aria-label={label}
      onClick={onNavigate}
      className={cn(ROW, "outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-colors motion-reduce:transition-none")}
    >
      {body}
    </IntentLink>
  );
}
