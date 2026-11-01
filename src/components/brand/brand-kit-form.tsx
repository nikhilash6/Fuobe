"use client";

import { Check, Loader2, Plus, Trash2, Upload, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BRAND_LANGUAGES, MAX_SELLING_POINTS, SOCIAL_NETWORKS, type BrandKit, type BrandKitFields } from "@/lib/catalog/marketing";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { useUpdateBrand } from "@/components/marketing/hooks";
import { areaCls, ColorList, FieldRow, FontField, inputCls, TagInput } from "./fields";
import { ImageList, uploadImages } from "./image-list";

type Draft = BrandKitFields;

const pickFields = (b: BrandKit): Draft => ({
  name: b.name,
  website: b.website,
  logo: b.logo,
  tagline: b.tagline,
  overview: b.overview,
  colors: b.colors,
  fonts: b.fonts,
  values: b.values,
  aesthetics: b.aesthetics,
  tone: b.tone,
  audience: b.audience,
  sellingPoints: b.sellingPoints,
  competitors: b.competitors,
  socials: b.socials,
  language: b.language,
  images: b.images,
  details: b.details,
});

/** Save what changed, 700 ms after the last edit (and when the form goes away). */
function useAutosave(brand: BrandKit) {
  const update = useUpdateBrand(brand.id);
  const [draft, setDraft] = useState<Draft>(() => pickFields(brand));
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const saved = useRef<Draft>(pickFields(brand));
  const pending = useRef<Partial<Draft>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useRef(() => {});
  useEffect(() => {
    flush.current = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    if (!Object.keys(patch).length) return;
    pending.current = {};
    setState("saving");
    update.mutate(patch, {
      onSuccess: (b) => {
        saved.current = pickFields(b);
        setState("saved");
      },
      onError: (e) => {
        setState("idle");
        toastError(e);
      },
    });
    };
  });
  useEffect(() => () => flush.current(), []);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    pending.current = { ...pending.current, [key]: value };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => flush.current(), 700);
  };
  return { draft, set, state, flush: () => flush.current() };
}

export function SaveState({ state }: { state: "idle" | "saving" | "saved" }) {
  if (state === "idle") return null;
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground" aria-live="polite">
      {state === "saving" ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
      {state === "saving" ? "Saving…" : "Saved"}
    </span>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border bg-background p-4 sm:p-5">
      <div>
        <h3 className="text-[14px] font-semibold">{title}</h3>
        {hint && <p className="mt-0.5 text-[12px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function LogoField({ value, onChange }: { value?: string; onChange: (v?: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex items-center gap-3">
      <div className="checkerboard grid h-16 w-28 shrink-0 place-items-center overflow-hidden rounded-xl border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {value ? <img src={value} alt="Logo" className="max-h-full max-w-full object-contain p-1.5" /> : <span className="text-[11px] text-muted-foreground">No logo</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => input.current?.click()} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-secondary px-3 text-[13px] font-medium hover:bg-accent">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
          {value ? "Replace logo" : "Upload logo"}
        </button>
        {value && (
          <button type="button" onClick={() => onChange(undefined)} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] text-muted-foreground hover:bg-accent">
            <X className="size-3.5" /> Remove
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          const [url] = await uploadImages([f.type === "image/svg+xml" ? f : f]).catch(() => []);
          setBusy(false);
          if (url) onChange(url);
        }}
      />
    </div>
  );
}

function Socials({ value, onChange }: { value: BrandKitFields["socials"]; onChange: (v: BrandKitFields["socials"]) => void }) {
  return (
    <div className="space-y-2">
      {value.map((s, i) => (
        <div key={i} className="flex min-w-0 items-center gap-2">
          <Select value={s.network} onValueChange={(network) => onChange(value.map((x, j) => (j === i ? { ...x, network } : x)))}>
            <SelectTrigger className="h-9 w-32 shrink-0" aria-label="Network">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOCIAL_NETWORKS.map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <input value={s.url} onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} placeholder="https://…" aria-label={`${s.network} link`} className={inputCls} />
          <button type="button" aria-label={`Remove ${s.network}`} onClick={() => onChange(value.filter((_, j) => j !== i))} className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
      {value.length < SOCIAL_NETWORKS.length && (
        <button type="button" onClick={() => onChange([...value, { network: SOCIAL_NETWORKS.find((n) => !value.some((s) => s.network === n)) ?? "Instagram", url: "" }])} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-secondary px-3 text-[13px] font-medium hover:bg-accent">
          <Plus className="size-3.5" /> Add a social link
        </button>
      )}
    </div>
  );
}

/** Review and edit every field of a brand kit; changes save on their own. */
export function BrandKitForm({ brand }: { brand: BrandKit }) {
  const { draft, set, state } = useAutosave(brand);
  const id = useId();
  const f = (k: string) => `${id}-${k}`;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <SaveState state={state} />
      </div>
      <Section title="Identity">
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Brand name" htmlFor={f("name")}>
            <input id={f("name")} value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="Enter brand name" className={inputCls} />
          </FieldRow>
          <FieldRow label="Website" htmlFor={f("site")}>
            <input id={f("site")} value={draft.website ?? ""} onChange={(e) => set("website", e.target.value)} placeholder="www.yourbrand.com" className={inputCls} />
          </FieldRow>
        </div>
        <FieldRow label="Logo">
          <LogoField value={draft.logo} onChange={(v) => set("logo", v ?? "")} />
        </FieldRow>
        <FieldRow label="Tagline" htmlFor={f("tag")}>
          <input id={f("tag")} value={draft.tagline ?? ""} onChange={(e) => set("tagline", e.target.value)} placeholder="Enter your brand tagline" className={inputCls} />
        </FieldRow>
        <FieldRow label="Description" htmlFor={f("desc")} hint="What the brand sells, who it's for and what makes it different">
          <textarea id={f("desc")} value={draft.overview ?? ""} onChange={(e) => set("overview", e.target.value)} rows={3} className={areaCls} />
        </FieldRow>
      </Section>
      <Section title="Look" hint="Colours and fonts are used on every ad you make.">
        <FieldRow label="Colours">
          <ColorList value={draft.colors} onChange={(v) => set("colors", v)} />
        </FieldRow>
        <div className="grid gap-4 sm:grid-cols-2">
          <FontField label="Display font" value={draft.fonts.heading} onChange={(v) => set("fonts", { ...draft.fonts, heading: v })} sample={draft.name || "Your headline"} />
          <FontField label="Body font" value={draft.fonts.body} onChange={(v) => set("fonts", { ...draft.fonts, body: v })} sample="The quick brown fox jumps over the lazy dog" />
        </div>
        <FieldRow label="Aesthetics" hint="Look and feel, e.g. Minimal, muted colours, natural light">
          <TagInput label="Aesthetics" value={draft.aesthetics} onChange={(v) => set("aesthetics", v)} placeholder="Add a look" />
        </FieldRow>
        <FieldRow label="Images">
          <ImageList value={draft.images} onChange={(v) => set("images", v)} max={12} size="sm" />
        </FieldRow>
      </Section>
      <Section title="Voice and audience">
        <FieldRow label="Tone of voice">
          <TagInput label="Tone of voice" value={draft.tone} onChange={(v) => set("tone", v)} placeholder="e.g. Warm, honest, playful" />
        </FieldRow>
        <FieldRow label="Audience" htmlFor={f("aud")} hint="Who the ads are for">
          <input id={f("aud")} value={draft.audience ?? ""} onChange={(e) => set("audience", e.target.value)} placeholder="People 30+ with dry, sensitive skin who avoid retinol" className={inputCls} />
        </FieldRow>
        <FieldRow label="Selling points" hint={`Main reasons to buy, e.g. Free shipping over $50 (up to ${MAX_SELLING_POINTS})`}>
          <TagInput label="Selling points" value={draft.sellingPoints} onChange={(v) => set("sellingPoints", v)} max={MAX_SELLING_POINTS} placeholder="Add a selling point" />
        </FieldRow>
        <FieldRow label="Values">
          <TagInput label="Values" value={draft.values} onChange={(v) => set("values", v)} placeholder="e.g. Sustainability" />
        </FieldRow>
        <div className="grid gap-4 sm:grid-cols-2">
          <FieldRow label="Language">
            <Select value={draft.language ?? "English"} onValueChange={(v) => set("language", v)}>
              <SelectTrigger className="h-9 w-full" aria-label="Language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BRAND_LANGUAGES.map((l) => (
                  <SelectItem key={l} value={l}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="Competitors">
            <TagInput label="Competitors" value={draft.competitors} onChange={(v) => set("competitors", v)} placeholder="Brand names" />
          </FieldRow>
        </div>
      </Section>
      <Section title="Socials and details">
        <Socials value={draft.socials} onChange={(v) => set("socials", v)} />
        <FieldRow label="Additional details" hint="Anything else the ads should know: offers, claims to avoid, shipping…">
          <TagInput label="Additional details" value={draft.details} onChange={(v) => set("details", v)} max={12} placeholder="Add a detail" />
        </FieldRow>
      </Section>
    </div>
  );
}

/** A compact read-only summary: logo, name, colours, fonts. */
export function BrandSummary({ brand, className }: { brand: BrandKit; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <div className="checkerboard grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {brand.logo ? <img src={brand.logo} alt="" className="max-h-full max-w-full object-contain p-1" /> : <span className="text-[16px] font-semibold">{brand.name.slice(0, 1)}</span>}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[14px] font-semibold">{brand.name}</p>
        <div className="mt-1 flex items-center gap-1">
          {brand.colors.slice(0, 6).map((c) => (
            <span key={c} className="size-3.5 rounded-full border" style={{ background: c }} title={c} />
          ))}
          {brand.fonts.heading && <span className="ml-1 truncate text-[11px] text-muted-foreground">{brand.fonts.heading}</span>}
        </div>
      </div>
    </div>
  );
}
