"use client";

import { RotateCcw, Save } from "lucide-react";
import { useCallback, useId, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cleanValues, defaultValues, parseHex, type MixedPreset, type MixedSetting, type MixedValues } from "@/lib/catalog/mixed-media";

/**
 * Per-preset advanced settings (Higgsfield's param_configs): colours (or "describe the colour"),
 * dropdowns with a custom option, text. Saved per preset in this browser (localStorage).
 */

const KEY = (id: string) => `fuobe.mixed-media.settings.${id}`;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function readRaw(id: string): string | null {
  try {
    return localStorage.getItem(KEY(id));
  } catch {
    return null;
  }
}

/** The saved settings of a preset (cleaned), or null. */
export function loadSaved(p: MixedPreset): MixedValues | null {
  const raw = readRaw(p.id);
  if (!raw) return null;
  try {
    return cleanValues(p, JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** The raw saved string, as a subscribable store (so "Saved" follows other tabs too). */
export function useSavedRaw(id: string | null): string | null {
  return useSyncExternalStore(
    useCallback((cb: () => void) => {
      listeners.add(cb);
      window.addEventListener("storage", cb);
      return () => {
        listeners.delete(cb);
        window.removeEventListener("storage", cb);
      };
    }, []),
    () => (id ? readRaw(id) : null),
    () => null,
  );
}

export function saveSettings(p: MixedPreset, v: MixedValues) {
  try {
    localStorage.setItem(KEY(p.id), JSON.stringify(v));
    toast.success("Settings saved");
  } catch {
    toast.error("Couldn't save in this browser");
  }
  notify();
}

export function resetSettings(p: MixedPreset) {
  try {
    localStorage.removeItem(KEY(p.id));
  } catch {}
  notify();
}

function ColorSetting({ s, value, onChange }: { s: Extract<MixedSetting, { type: "color" }>; value: string; onChange: (v: string) => void }) {
  const id = useId();
  const words = value.startsWith("text:");
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[12px] font-medium">
          {s.label}
        </label>
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
          <input type="checkbox" checked={words} onChange={(e) => onChange(e.target.checked ? "text:" : s.default)} className="size-3.5 accent-[var(--primary)]" />
          Describe instead
        </label>
      </div>
      {words ? (
        <input
          id={id}
          value={value.slice(5)}
          onChange={(e) => onChange(`text:${e.target.value}`)}
          maxLength={120}
          placeholder="Describe the colour, e.g. “rusty orange”"
          className="h-8 w-full rounded-lg border bg-background px-2.5 text-[13px] outline-none placeholder:text-subtle-foreground focus:border-primary focus:ring-2 focus:ring-brand-faint"
        />
      ) : (
        <div className="flex items-center gap-2">
          <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value.toLowerCase())} className="h-8 w-10 cursor-pointer rounded-md border bg-background p-0.5" />
          <HexField label={`${s.label} (hex)`} value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

/**
 * A hex code field you can type into: the draft is shown while editing, a complete code is applied
 * as soon as it's typed ("#" optional), and leaving (or Escape) with an incomplete one puts the
 * current colour back.
 */
function HexField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value.toUpperCase();
  const invalid = draft !== null && draft.trim() !== "" && !parseHex(draft) && draft.replace(/^#/, "").length >= 6;
  return (
    <input
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={shown}
      spellCheck={false}
      autoComplete="off"
      onChange={(e) => {
        const v = e.target.value.slice(0, 7);
        setDraft(v);
        const hex = /^#?[0-9a-f]{6}$/i.test(v.trim()) ? parseHex(v) : null;
        if (hex && hex !== value) onChange(hex);
      }}
      onBlur={() => {
        const hex = draft !== null ? parseHex(draft) : null;
        if (hex && hex !== value) onChange(hex);
        setDraft(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") setDraft(null);
      }}
      maxLength={7}
      className="h-8 w-24 rounded-lg border bg-background px-2 font-mono text-[12px] uppercase outline-none focus:border-primary focus:ring-2 focus:ring-brand-faint aria-invalid:border-destructive"
    />
  );
}

function SelectSetting({ s, value, onChange }: { s: Extract<MixedSetting, { type: "select" }>; value: string; onChange: (v: string) => void }) {
  const id = useId();
  const custom = value.startsWith("text:");
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-[12px] font-medium">
        {s.label}
      </label>
      <Select value={custom ? "__custom" : value} onValueChange={(v) => onChange(v === "__custom" ? "text:" : v)}>
        <SelectTrigger id={id} className="h-8 w-full text-[13px]">
          <SelectValue>{custom ? "Custom…" : (s.options.find((o) => o.value === value)?.label ?? s.options[0].label)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {s.options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
          {s.custom && <SelectItem value="__custom">Custom…</SelectItem>}
        </SelectContent>
      </Select>
      {custom && (
        <input
          aria-label={`${s.label}: describe what you want`}
          value={value.slice(5)}
          onChange={(e) => onChange(`text:${e.target.value}`)}
          maxLength={120}
          autoFocus
          placeholder="Describe what you want"
          className="h-8 w-full rounded-lg border bg-background px-2.5 text-[13px] outline-none placeholder:text-subtle-foreground focus:border-primary focus:ring-2 focus:ring-brand-faint"
        />
      )}
    </div>
  );
}

function TextSetting({ s, value, onChange }: { s: Extract<MixedSetting, { type: "text" }>; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-[12px] font-medium">
        {s.label}
      </label>
      <input
        id={id}
        value={value}
        maxLength={s.max}
        onChange={(e) => onChange(e.target.value)}
        placeholder={s.placeholder}
        className="h-8 w-full rounded-lg border bg-background px-2.5 text-[13px] outline-none placeholder:text-subtle-foreground focus:border-primary focus:ring-2 focus:ring-brand-faint"
      />
    </div>
  );
}

export function AdvancedSettings({ preset, values, onChange }: { preset: MixedPreset; values: MixedValues; onChange: (v: MixedValues) => void }) {
  const saved = useSavedRaw(preset.id);
  const [open, setOpen] = useState(true);
  const cleaned = cleanValues(preset, values);
  const isSaved = !!saved && saved === JSON.stringify(cleaned);
  const isDefault = JSON.stringify(cleaned) === JSON.stringify(defaultValues(preset));
  const set = (k: string, v: string) => onChange({ ...values, [k]: v });
  return (
    <div className="rounded-xl border">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left">
        <span className="text-[13px] font-medium">Advanced settings</span>
        <span className="text-[11px] text-muted-foreground">{isSaved ? "Saved in this browser" : isDefault ? "Preset defaults" : "Not saved"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t px-3 pt-3 pb-3">
          <div className="grid gap-3">
            {preset.settings.map((s) => (
              <div key={s.key}>
                {s.type === "color" ? (
                  <ColorSetting s={s} value={values[s.key] ?? s.default} onChange={(v) => set(s.key, v)} />
                ) : s.type === "select" ? (
                  <SelectSetting s={s} value={values[s.key] ?? s.default} onChange={(v) => set(s.key, v)} />
                ) : (
                  <TextSetting s={s} value={values[s.key] ?? s.default} onChange={(v) => set(s.key, v)} />
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => saveSettings(preset, cleaned)}
              disabled={isSaved}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border bg-background px-3 text-[12px] font-medium hover:bg-accent disabled:opacity-50"
            >
              <Save className="size-3.5" /> Save in this browser
            </button>
            <button
              type="button"
              onClick={() => {
                resetSettings(preset);
                onChange(defaultValues(preset));
              }}
              disabled={isDefault && !saved}
              className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <RotateCcw className="size-3.5" /> Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
