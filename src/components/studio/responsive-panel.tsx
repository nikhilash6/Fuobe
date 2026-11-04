"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/** A popover above the composer on desktop, a bottom sheet on phones. `trigger` must be one element that takes a ref. */
export function ResponsivePanel({
  open,
  onOpenChange,
  trigger,
  tooltip,
  title,
  description,
  children,
  className,
  sheetClassName,
  align = "start",
  focusSelf,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  trigger: React.ReactElement;
  tooltip?: React.ReactNode;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  sheetClassName?: string;
  align?: "start" | "center" | "end";
  /** Desktop too: the popover itself takes focus on open, not its first control (whose tooltip would cover the panel). */
  focusSelf?: boolean;
}) {
  const mobile = useIsMobile();
  // On phones the sheet itself takes focus, so the keyboard doesn't jump up over the list (and the popover, with focusSelf).
  const focusSheet = (e: Event) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement | null)?.focus();
  };
  const withTip = (t: React.ReactNode) =>
    tooltip ? (
      <Tooltip>
        {t}
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    ) : (
      t
    );
  const inner = tooltip ? <TooltipTrigger asChild>{trigger}</TooltipTrigger> : trigger;
  if (mobile)
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        {withTip(<SheetTrigger asChild>{inner}</SheetTrigger>)}
        <SheetContent side="bottom" onOpenAutoFocus={focusSheet} className={cn("max-h-[88svh] gap-0 rounded-t-2xl pb-[env(safe-area-inset-bottom)] outline-none", sheetClassName)}>
          <SheetHeader className="pr-12 pb-2">
            <SheetTitle className="font-sans text-[15px] font-semibold">{title}</SheetTitle>
            <SheetDescription className={cn(!description && "sr-only")}>{description ?? title}</SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-4">{children}</div>
        </SheetContent>
      </Sheet>
    );
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {withTip(<PopoverTrigger asChild>{inner}</PopoverTrigger>)}
      <PopoverContent align={align} side="top" collisionPadding={12} aria-label={title} onOpenAutoFocus={focusSelf ? focusSheet : undefined} className={cn("max-h-[min(var(--radix-popover-content-available-height),640px)] w-[min(92vw,420px)] overflow-y-auto p-3", focusSelf && "outline-none", className)}>
        {children}
      </PopoverContent>
    </Popover>
  );
}
