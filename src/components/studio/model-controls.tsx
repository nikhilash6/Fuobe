"use client";

import { Check, Clapperboard, Settings2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ModelOptions } from "@/lib/catalog/types";
import { controlsFor } from "@/lib/composer";
import { Chip } from "./chip";
import { OwnSetupChip } from "@/components/own-setup";
import { cn } from "@/lib/utils";

const label = (v: string | number) =>
  String(v)
    // API enums in capitals (Ideogram's "80S_ILLUSTRATION", "TURBO") read as words.
    .replace(/^(?=.*[A-Z])[A-Z0-9 _-]+$/, (s) => s.toLowerCase())
    .replace(/[-_]/g, " ")
    .replace(/^f(\d)(\d)?/, (_, a, b) => `f/${a}${b ? `.${b}` : ""}`)
    .replace(/^\w/, (c) => c.toUpperCase());

/** The longest words a control shows (its values' labels, Auto's included). */
const longest = (c: NonNullable<ModelOptions["controls"]>[number]) =>
  Math.max(...[...c.values, ...(c.default !== undefined ? [c.default] : [])].map((v) => (c.labels?.[String(v)] ?? label(v)).length + (v === c.default ? 7 : 0)));

/** Whether a control takes a row of its own: its values read long, or it is the last of an odd number of short ones. */
function fullRow(controls: NonNullable<ModelOptions["controls"]>, c: NonNullable<ModelOptions["controls"]>[number]): boolean {
  if (longest(c) > 20) return true;
  const short = controls.filter((x) => longest(x) <= 20);
  return short.length % 2 === 1 && short.at(-1) === c;
}

/**
 * "Director" popover for enum settings such as genre, lens, light, grade and camera move. A model whose only settings are
 * its Quality (MiniMax H3's Fast / Best, MOSS-Image's tiers) shows them under "Quality".
 */
export function ControlsChip({
  controls: all,
  values,
  onChange,
  title: named,
  op,
  setupOf,
}: {
  controls: NonNullable<ModelOptions["controls"]>;
  values: Record<string, unknown>;
  onChange: (param: string, v?: string | number) => void;
  /** The chip's name: "Director" (Cinema's genre, lens, light…), "Options" for a tool's model settings (Upscale). */
  title?: string;
  /** The run's operation: values offered on other operations only (Qwen-Image 2.1's Turbo speed: edits) are left out. */
  op?: string;
  /** A value that runs on the visitor's own setup only (an own-setup.ts id, Kandinsky 6.0's Pro): its label beside it. */
  setupOf?: (param: string, value: string | number) => string | undefined;
}) {
  const controls = controlsFor(all, op);
  const title = named ?? (controls.length && controls.every((c) => c.param === "quality") ? "Quality" : "Director");
  if (!controls.length) return null;
  const set = controls.filter((c) => values[c.param] !== undefined);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Chip icon={title === "Director" ? Clapperboard : Settings2} active={set.length > 0}>
          {set.length ? `${title} · ${set.length}` : title}
        </Chip>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,420px)] space-y-2 p-3" align="start" side="top" collisionPadding={12}>
        <p className="text-[13px] font-medium">{title === "Director" ? "Director controls" : `Model ${title.toLowerCase()}`}</p>
        <p className="text-[12px] text-muted-foreground">Leave one on Auto and the model decides.</p>
        <div className="grid grid-cols-2 gap-2">
          {controls.map((c) => (
            // A control alone on its row (MOSS-Image's one Quality), or one whose values read long (Qwen-Image 2.1's Speed),
            // takes both columns, so its value reads in full.
            <label key={c.param} className={cn("space-y-1", fullRow(controls, c) && "col-span-2")}>
              <span className="text-[12px] text-muted-foreground">{c.label}</span>
              <Select value={values[c.param] === undefined || !c.values.map(String).includes(String(values[c.param])) ? "__auto" : String(values[c.param])} onValueChange={(v) => onChange(c.param, v === "__auto" ? undefined : typeof c.values[0] === "number" ? Number(v) : v)}>
                <SelectTrigger size="sm" className="w-full" aria-label={c.label}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {/* Auto sends nothing: the model's default, named when it's known (Leffa: Upper body). */}
                  <SelectItem value="__auto">{c.default !== undefined ? `Auto · ${c.labels?.[String(c.default)] ?? label(c.default)}` : "Auto"}</SelectItem>
                  {c.values.map((v) => (
                    <SelectItem key={String(v)} value={String(v)}>
                      {c.labels?.[String(v)] ?? label(v)}
                      <OwnSetupChip setup={setupOf?.(c.param, v)} className="ml-1" />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          ))}
        </div>
        {set.length > 0 && (
          <button onClick={() => set.forEach((c) => onChange(c.param, undefined))} className="inline-flex items-center gap-1 rounded text-[12px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50">
            <Check className="size-3" /> Reset to Auto
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
