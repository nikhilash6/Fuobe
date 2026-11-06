"use client";

import { LayoutGrid, LayoutList, Rows3, SlidersHorizontal } from "lucide-react";
import { useCallback, useSyncExternalStore } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export type Layout = "square" | "masonry" | "list";

export interface ViewPrefs {
  layout: Layout;
  fit: boolean;
  /** Card width in px (grid column minimum). */
  size: number;
  splitByDate: boolean;
  stacks: boolean;
}

const KEY = "fuobe.library.view";
const DEFAULTS: ViewPrefs = { layout: "masonry", fit: false, size: 220, splitByDate: true, stacks: true };
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: ViewPrefs } | null = null;

function read(): ViewPrefs {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {}
  if (cache?.raw === raw) return cache.value;
  let value = DEFAULTS;
  try {
    value = raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ViewPrefs>) } : DEFAULTS;
  } catch {}
  cache = { raw, value };
  return value;
}

/** Layout, Fit/Fill, card size, split by date and stacks, remembered in this browser. */
export function useViewPrefs(): [ViewPrefs, (patch: Partial<ViewPrefs>) => void] {
  const prefs = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => DEFAULTS,
  );
  const set = useCallback((patch: Partial<ViewPrefs>) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch }));
    } catch {}
    listeners.forEach((l) => l());
  }, []);
  return [prefs, set];
}

const LAYOUTS: { id: Layout; label: string; icon: typeof LayoutGrid }[] = [
  { id: "square", label: "Square", icon: LayoutGrid },
  { id: "masonry", label: "Masonry", icon: Rows3 },
  { id: "list", label: "List", icon: LayoutList },
];

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string; icon?: typeof LayoutGrid }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-full bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors",
            value === o.id ? "bg-background text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.icon && <o.icon className="size-3.5" />} {o.label}
        </button>
      ))}
    </div>
  );
}

export function ViewOptions({
  prefs,
  onChange,
  noStacks,
}: {
  prefs: ViewPrefs;
  onChange: (patch: Partial<ViewPrefs>) => void;
  /** Why batches aren't stacked on this tab (Trash, Uploads): the switch says so, and is off, instead of flipping for nothing. */
  noStacks?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex h-8 items-center gap-1.5 rounded-full bg-secondary px-3 text-[13px] font-medium text-secondary-foreground transition-colors hover:bg-accent" aria-label="View options">
          <SlidersHorizontal className="size-3.5" /> <span className="hidden sm:inline">View</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={12} className="w-[min(92vw,300px)] space-y-4">
        <div className="space-y-1.5">
          <p className="text-[12px] font-medium text-muted-foreground">Layout</p>
          <Segmented label="Layout" value={prefs.layout} options={LAYOUTS} onChange={(layout) => onChange({ layout })} />
        </div>
        {prefs.layout !== "list" && (
          <>
            <div className="space-y-1.5">
              <p className="text-[12px] font-medium text-muted-foreground">Previews</p>
              <Segmented
                label="Previews"
                value={prefs.fit ? "fit" : "fill"}
                options={[
                  { id: "fill", label: "Fill" },
                  { id: "fit", label: "Fit" },
                ]}
                onChange={(v) => onChange({ fit: v === "fit" })}
              />
            </div>
            <label className="block space-y-1.5">
              <span className="flex justify-between text-[12px] font-medium text-muted-foreground">
                Card size <span className="font-mono">{prefs.size}px</span>
              </span>
              <input
                type="range"
                min={120}
                max={380}
                step={10}
                value={prefs.size}
                onChange={(e) => onChange({ size: Number(e.target.value) })}
                className="w-full accent-primary"
              />
            </label>
          </>
        )}
        <label className="flex items-center justify-between gap-3 text-[13px]">
          Split by date
          <Switch checked={prefs.splitByDate} onCheckedChange={(splitByDate) => onChange({ splitByDate })} />
        </label>
        <label className={cn("flex items-center justify-between gap-3 text-[13px]", noStacks && "cursor-not-allowed")}>
          <span className={cn(noStacks && "text-muted-foreground")}>
            Stack batches
            <span className="block text-[12px] text-muted-foreground">{noStacks ?? "Storyboards, films and takes as one card"}</span>
          </span>
          <Switch checked={!noStacks && prefs.stacks} disabled={!!noStacks} onCheckedChange={(stacks) => onChange({ stacks })} />
        </label>
      </PopoverContent>
    </Popover>
  );
}
