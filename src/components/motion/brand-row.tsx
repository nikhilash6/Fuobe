"use client";

import { ChevronDown } from "lucide-react";
import { useCallback, useId, useState, useSyncExternalStore } from "react";
import { POPULAR_FONTS } from "@/components/brand/fields";
import { MediaSlot, type SlotValue } from "@/components/studio/media-slot";
import type { BrandKit } from "@/lib/catalog/marketing";
import type { TemplateBrand } from "@/lib/motion/template";
import { cn } from "@/lib/utils";

/**
 * The compact Brand row of a code-drawn template: a name, two colours, a heading and a body font, and a logo. The
 * owner can start from one of the studio's brand kits (and change a value for this piece without changing the kit).
 * What someone sets here is kept in this browser as a convenience, so their next template opens in their brand; the
 * page works the same without it.
 */

const KEY = "fuobe:kinetic-brand";
const HEX = /^#[0-9a-f]{6}$/i;
const listeners = new Set<() => void>();
let cache: { raw: string | null; value: TemplateBrand | null } = { raw: null, value: null };

function read(): TemplateBrand | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === cache.raw) return cache.value;
  let value: TemplateBrand | null = null;
  try {
    const v = raw ? JSON.parse(raw) : null;
    if (v && typeof v.name === "string" && Array.isArray(v.colors) && v.fonts && typeof v.fonts.heading === "string" && typeof v.fonts.body === "string") {
      value = { name: v.name.slice(0, 120), colors: v.colors.filter((c: unknown) => typeof c === "string" && HEX.test(c)).slice(0, 2), fonts: { heading: v.fonts.heading.slice(0, 80), body: v.fonts.body.slice(0, 80) }, logo: typeof v.logo === "string" && v.logo.startsWith("/api/files/") ? v.logo : null };
      if (value.colors.length === 0) value = null;
    }
  } catch {}
  cache = { raw, value };
  return value;
}

/** The brand this viewer set last (null: none yet), and a setter that remembers it here. */
export function useStoredBrand(): [TemplateBrand | null, (b: TemplateBrand | null) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => null,
  );
  const set = useCallback((b: TemplateBrand | null) => {
    try {
      if (b) localStorage.setItem(KEY, JSON.stringify(b));
      else localStorage.removeItem(KEY);
    } catch {}
    listeners.forEach((l) => l());
  }, []);
  return [value, set];
}

/** A brand kit as a template's brand. */
export function kitBrand(k: BrandKit): TemplateBrand {
  const colors = k.colors.filter((c) => HEX.test(c));
  return { name: k.name, colors: colors.length ? colors.slice(0, 2) : ["#111111", "#f5f2ec"], fonts: { heading: k.fonts?.heading || "Inter", body: k.fonts?.body || k.fonts?.heading || "Inter" }, logo: k.logo ?? null };
}

const field = "h-11 w-full min-w-0 rounded-xl border bg-background px-3 text-[14px] outline-none focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-brand-faint";

function Swatch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [was, setWas] = useState(value);
  if (was !== value) {
    setWas(value);
    setText(value);
  }
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <label className="relative grid size-11 shrink-0 cursor-pointer place-items-center rounded-xl border" style={{ background: value }}>
        <span className="sr-only">{label}</span>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
      </label>
      <input
        value={text}
        onChange={(e) => {
          const v = e.target.value.trim();
          setText(v);
          const hex = v.startsWith("#") ? v : `#${v}`;
          if (HEX.test(hex)) onChange(hex.toLowerCase());
        }}
        maxLength={7}
        spellCheck={false}
        aria-label={`${label} (hex)`}
        className={cn(field, "font-mono text-[13px] uppercase")}
      />
    </div>
  );
}

function FontInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <label className="block min-w-0 space-y-1">
      <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
      <input list={`${id}-fonts`} value={value} onChange={(e) => onChange(e.target.value.slice(0, 80))} placeholder="Type a font name" className={field} style={{ fontFamily: value ? `"${value}", system-ui` : undefined }} />
      <datalist id={`${id}-fonts`}>
        {POPULAR_FONTS.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
    </label>
  );
}

export function BrandRow({ value, onChange, kits, kitId, onKit }: { value: TemplateBrand; onChange: (b: TemplateBrand) => void; kits?: BrandKit[]; kitId?: string | null; onKit?: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const set = (p: Partial<TemplateBrand>) => onChange({ ...value, ...p });
  const [c1, c2 = c1] = value.colors;
  // While a logo uploads the tile shows it; once stored, the brand takes its address.
  const [pending, setPending] = useState<SlotValue | null>(null);
  const logoSlot: SlotValue | null = pending?.uploading ? pending : value.logo ? { ref: value.logo, preview: value.logo, kind: "image" } : null;
  return (
    <div className="min-w-0 rounded-2xl border">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-2xl px-3 py-2 text-left outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex shrink-0 -space-x-1.5" aria-hidden>
          <span className="size-5 rounded-full border-2 border-background" style={{ background: c1 }} />
          <span className="size-5 rounded-full border-2 border-background" style={{ background: c2 }} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-medium text-muted-foreground">Brand</span>
          <span className="block truncate text-[14px] font-medium" style={{ fontFamily: `"${value.fonts.heading}", system-ui` }}>
            {value.name || "Your brand"}
          </span>
        </span>
        <span className="hidden truncate text-[12px] text-muted-foreground sm:block">
          {value.fonts.heading} · {value.fonts.body}
        </span>
        <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="min-w-0 space-y-3 border-t px-3 pt-3 pb-3">
          {kits && kits.length > 0 && onKit && (
            <label className="block min-w-0 space-y-1">
              <span className="text-[12px] font-medium text-muted-foreground">Brand kit</span>
              <select value={kitId ?? ""} onChange={(e) => onKit(e.target.value || null)} className={field}>
                <option value="">None</option>
                {kits.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block min-w-0 space-y-1">
            <span className="text-[12px] font-medium text-muted-foreground">Name</span>
            {/* A sample brand's lockup goes once the name changes: it spells the sample's name. */}
            <input value={value.name} onChange={(e) => set({ name: e.target.value.slice(0, 120), ...(value.logo?.startsWith("/previews/") && { logo: null }) })} className={field} aria-label="Brand name" />
          </label>
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <Swatch label="Main colour" value={c1} onChange={(v) => set({ colors: [v, c2] })} />
            <Swatch label="Second colour" value={c2} onChange={(v) => set({ colors: [c1, v] })} />
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <FontInput label="Heading font" value={value.fonts.heading} onChange={(v) => set({ fonts: { ...value.fonts, heading: v } })} />
            <FontInput label="Body font" value={value.fonts.body} onChange={(v) => set({ fonts: { ...value.fonts, body: v } })} />
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <MediaSlot label="Logo" kind="image" value={logoSlot} onChange={(v) => {
                setPending(v);
                if (!v) set({ logo: null });
                else if (!v.uploading && v.ref.startsWith("/api/files/")) set({ logo: v.ref });
              }} />
            <p className="min-w-0 text-[12px] text-muted-foreground">Logo · a PNG or SVG with a clear background reads best</p>
          </div>
        </div>
      )}
    </div>
  );
}
