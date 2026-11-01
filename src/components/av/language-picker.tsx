"use client";

import { Check, Languages, Plus, X } from "lucide-react";
import { useState } from "react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DUB_LANGUAGES, type DubLanguage } from "@/lib/av/languages";
import { cn } from "@/lib/utils";

/** The spoken language: detected, or one of the list. */
export function SourceLanguageSelect({ value, onChange, id, languages = DUB_LANGUAGES }: { value: string; onChange: (v: string) => void; id?: string; languages?: DubLanguage[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="h-9 w-full rounded-full sm:w-52" aria-label="Spoken language">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">Detect automatically</SelectItem>
        {languages.map((l) => (
          <SelectItem key={l.code} value={l.code}>
            {l.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Languages to translate into: chips you can remove, plus a searchable list. Languages the current
 * route can't speak are listed as unavailable (with the reason) instead of hidden.
 */
export function TargetLanguages({
  value,
  onChange,
  available,
  unavailableHint,
  max = 8,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  available: (l: DubLanguage) => boolean;
  unavailableHint: string;
  max?: number;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (code: string) => onChange(value.includes(code) ? value.filter((c) => c !== code) : value.length >= max ? value : [...value, code]);
  const chosen = value.map((c) => DUB_LANGUAGES.find((l) => l.code === c)).filter((l): l is DubLanguage => !!l);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {chosen.map((l) => (
        <span
          key={l.code}
          className={cn(
            "inline-flex h-8 items-center gap-1 rounded-full pr-1 pl-3 text-[13px] font-medium",
            available(l) ? "bg-brand-faint text-brand-text" : "bg-muted text-muted-foreground line-through",
          )}
          title={available(l) ? undefined : unavailableHint}
        >
          {l.name}
          <button type="button" onClick={() => toggle(l.code)} className="grid size-6 place-items-center rounded-full hover:bg-brand-faint-hover" aria-label={`Remove ${l.name}`}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-border-strong px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:border-primary hover:text-brand-text"
            aria-label="Add a language"
          >
            {chosen.length ? <Plus className="size-3.5" /> : <Languages className="size-3.5" />}
            {chosen.length ? "Add" : "Pick languages"}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(92vw,300px)] p-0" align="start" collisionPadding={12}>
          <Command>
            <CommandInput placeholder="Search languages…" />
            <CommandList className="max-h-72">
              <CommandEmpty>No language matches.</CommandEmpty>
              <CommandGroup heading={`Up to ${max}`}>
                {DUB_LANGUAGES.map((l) => {
                  const on = value.includes(l.code);
                  const ok = available(l);
                  return (
                    <CommandItem key={l.code} value={`${l.name} ${l.code}`} disabled={!ok && !on} onSelect={() => toggle(l.code)} className="justify-between">
                      <span className={cn(!ok && "text-muted-foreground")}>
                        {l.name}
                        {!ok && <span className="ml-1.5 text-[11px]">· not available with these voices yet</span>}
                      </span>
                      {on && <Check className="size-3.5 text-brand-text" />}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
