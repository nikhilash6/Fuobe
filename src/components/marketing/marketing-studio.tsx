"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, ChevronDown, Globe, Image as ImageIcon, LayoutTemplate, Loader2, SlidersHorizontal, Type, Video, X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { chipBase, chipIdle, chipOn } from "@/components/studio/chip";
import { MediaSlot, type SlotValue } from "@/components/studio/media-slot";
import { ResponsivePanel } from "@/components/studio/responsive-panel";
import { BrandChip } from "@/components/brand/brand-dialog";
import { inputCls } from "@/components/brand/fields";
import { withoutOwnGpu } from "@/lib/catalog/engines";
import { FORMATS, formatModels, looksLikeWebsite, MAX_PROMPT, openingAspect, TEMPLATE_INDEX, type FormatId, type MarketingCategory, type MarketingTemplate, type RunEstimate } from "@/lib/catalog/marketing";
import { SelfHostNote } from "@/components/self-host-note";
import { formatCost } from "@/lib/format";
import { useIsOwner, useLikelyVisitor, useModelAccess } from "@/lib/api";
import { keepOffered, offered } from "@/lib/model-access";
import { cn } from "@/lib/utils";
import { addRuns, send, useBrands, useEstimate } from "./hooks";
import type { MarketingRun } from "@/lib/catalog/marketing";
import { toastError } from "@/lib/refusals";
import { templateCover } from "@/lib/template-covers";
import type { ModelInfo } from "./model-info";
import { AvatarSlot, HookPicker, ProductSlot, SettingPicker, VoiceControl, type ProductChoice } from "./pickers";
import { RunsList } from "./runs";
import { EmptyIcon, MarketingHeader, useMarketingEngine } from "./shell";
import { TemplateGallery, type MediaFilter } from "./template-gallery";
import { TemplatePreview } from "./template-preview";
import { plainTagline } from "@/lib/plain-tagline";

const IMAGE_FORMATS: FormatId[] = ["product-standalone", "product-with-model", "ads", "poster", "marketplace"];
const VIDEO_FORMATS: FormatId[] = ["motion-hyper", "motion-2d", "motion-mixed", "motion-saas", "ugc-talking", "tiktok"];

interface Draft {
  format: FormatId;
  templateId: string | null;
  product: ProductChoice | null;
  avatar: SlotValue | null;
  reference: SlotValue | null;
  hookId: string | null;
  settingId: string | null;
  prompt: string;
  headline: string;
  cta: string;
  aspectRatio: string;
  duration?: number;
  batch: number;
  modelId?: string;
  voice?: string;
  voiceSample: SlotValue | null;
  /** SaaS motion: a website or social link to make the video about. */
  website: string;
}

const BLANK: Draft = { format: "product-standalone", templateId: null, product: null, avatar: null, reference: null, hookId: null, settingId: null, prompt: "", headline: "", cta: "", aspectRatio: "3:4", batch: 1, voiceSample: null, website: "" };

const BRAND_KEY = "fuobe:marketing-brand";
const brandListeners = new Set<() => void>();
const readBrand = () => {
  try {
    return localStorage.getItem(BRAND_KEY);
  } catch {
    return null;
  }
};

/** The brand kit picked last time (kept in this browser), and a setter that remembers the choice. */
function useSavedBrand(): [string | null, (id: string | null) => void] {
  const id = useSyncExternalStore(
    (cb) => {
      brandListeners.add(cb);
      return () => brandListeners.delete(cb);
    },
    readBrand,
    () => null,
  );
  const save = (next: string | null) => {
    try {
      if (next) localStorage.setItem(BRAND_KEY, next);
      else localStorage.removeItem(BRAND_KEY);
    } catch {}
    brandListeners.forEach((l) => l());
  };
  return [id, save];
}

function withTemplate(d: Draft, t: MarketingTemplate | null, format?: FormatId): Draft {
  const f = FORMATS[t?.format ?? format ?? d.format];
  return {
    ...d,
    format: f.id,
    templateId: t?.id ?? null,
    aspectRatio: openingAspect(d, t, f.id),
    duration: f.durations ? (t?.duration ?? f.durations.default) : undefined,
    batch: Math.min(d.batch, f.batch),
    hookId: f.hookAndSetting ? (t?.hook ?? null) : null,
    settingId: f.hookAndSetting ? (t?.setting ?? d.settingId) : null,
    headline: "",
    cta: "",
    modelId: undefined,
    avatar: f.avatar === "none" ? null : d.avatar,
  };
}

function SettingsPanel({ draft, set, models, engine }: { draft: Draft; set: (p: Partial<Draft>) => void; models: Record<string, ModelInfo>; engine: "cloud" | "open" }) {
  const [open, setOpen] = useState(false);
  const f = FORMATS[draft.format];
  // Models switched off in Settings → Models & licences leave the menu, and the pick falls back to one that is on.
  const access = useModelAccess();
  // A guest or an account: Marketing Studio runs on a self-hosted Fuobe only, so no model reads "on your GPU".
  const visitor = useLikelyVisitor();
  const choices = keepOffered(formatModels(f, engine, { product: !!draft.product, avatar: !!draft.avatar }), (c) => offered(access, c.id, engine));
  const model = choices.find((c) => c.id === draft.modelId) ?? choices[0];
  const summary = [draft.aspectRatio, f.durations && `${draft.duration}s`, draft.batch > 1 && `×${draft.batch}`].filter(Boolean).join(" · ");
  const seg = (active: boolean) => cn("h-7 rounded-full px-2.5 text-[12px] font-medium text-muted-foreground", active && "bg-background text-foreground shadow-soft");
  return (
    <ResponsivePanel
      open={open}
      onOpenChange={setOpen}
      title="Settings"
      tooltip="Aspect ratio, length, batch and model"
      trigger={
        <button type="button" className={cn(chipBase, chipIdle)} aria-label={`Settings: ${summary}`}>
          <SlidersHorizontal className="size-3.5" />
          <span className="hidden sm:inline">{summary}</span>
        </button>
      }
    >
      <div className="space-y-4">
        <div>
          <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Aspect ratio</p>
          <div role="radiogroup" aria-label="Aspect ratio" className="flex flex-wrap gap-1 rounded-2xl bg-muted p-0.5">
            {f.aspectRatios.map((a) => (
              <button key={a} role="radio" aria-checked={draft.aspectRatio === a} onClick={() => set({ aspectRatio: a })} className={seg(draft.aspectRatio === a)}>
                {a}
              </button>
            ))}
          </div>
        </div>
        {f.durations && (
          <div>
            <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Length · {draft.duration}s</p>
            {f.pipeline === "ugc" && <p className="-mt-1 mb-1.5 text-[11px] text-muted-foreground">The whole video: the script is sized to what&apos;s left after the hook and the product close-up</p>}
            <input type="range" min={f.durations.min} max={f.durations.max} step={1} value={draft.duration ?? f.durations.default} onChange={(e) => set({ duration: Number(e.target.value) })} aria-label="Length in seconds" className="w-full accent-[var(--primary)]" />
            <p className="mt-0.5 flex justify-between text-[11px] text-muted-foreground">
              <span>{f.durations.min}s</span>
              <span>{f.durations.max}s</span>
            </p>
          </div>
        )}
        {f.batch > 1 && (
          <div>
            <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">{f.kind === "video" ? "Versions" : "Images"}</p>
            <div role="radiogroup" aria-label="Batch size" className="inline-flex rounded-full bg-muted p-0.5">
              {Array.from({ length: f.batch }, (_, i) => i + 1).map((n) => (
                <button key={n} role="radio" aria-checked={draft.batch === n} onClick={() => set({ batch: n })} className={seg(draft.batch === n)}>
                  ×{n}
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Model</p>
          <div className="space-y-1">
            {choices.map((c) => (
              <button key={c.id} type="button" onClick={() => set({ modelId: c.id })} className={cn("w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-accent", model.id === c.id && "bg-brand-faint")}>
                <span className={cn("block text-[13px] font-medium", model.id === c.id && "text-brand-text")}>{models[c.id]?.name ?? c.id}</span>
                <span className="block text-[11px] text-muted-foreground">{visitor ? withoutOwnGpu(c.note ?? plainTagline(models[c.id]?.tagline ?? "")) : (c.note ?? plainTagline(models[c.id]?.tagline ?? ""))}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </ResponsivePanel>
  );
}

function TextPanel({ draft, set, template }: { draft: Draft; set: (p: Partial<Draft>) => void; template?: MarketingTemplate }) {
  const [open, setOpen] = useState(false);
  const has = draft.headline || draft.cta;
  return (
    <ResponsivePanel
      open={open}
      onOpenChange={setOpen}
      title="Words on the image"
      description="Set exactly, letter for letter: Fuobe Marketing Image and open-source results get them set on top in your brand fonts; GPT Image, Ideogram and Recraft draw them."
      trigger={
        <button type="button" className={cn(chipBase, has ? chipOn : chipIdle, "max-w-44")} aria-label="Headline and button text">
          <Type className="size-3.5" />
          <span className="truncate">{draft.headline || template?.headline?.replace(/\{\w+\}/g, "…") || "Headline"}</span>
        </button>
      }
    >
      <div className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-[12px] font-medium text-muted-foreground">Headline</span>
          <input value={draft.headline} onChange={(e) => set({ headline: e.target.value })} maxLength={140} placeholder={template?.headline?.replace("{product}", "your product").replace("{brand}", "your brand") ?? "e.g. Crunch, sorted"} className={inputCls} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-[12px] font-medium text-muted-foreground">Button</span>
          <input value={draft.cta} onChange={(e) => set({ cta: e.target.value })} maxLength={40} placeholder={template?.cta ?? "e.g. Shop now"} className={inputCls} />
        </label>
      </div>
    </ResponsivePanel>
  );
}

/** SaaS motion's "Website or social link" (one of prompt / product / website). */
function WebsitePanel({ draft, set }: { draft: Draft; set: (p: Partial<Draft>) => void }) {
  const [open, setOpen] = useState(false);
  const v = draft.website.trim();
  const bad = !!v && !looksLikeWebsite(v);
  return (
    <ResponsivePanel
      open={open}
      onOpenChange={setOpen}
      title="Website or social link"
      description="What the video is about when there's no product photo: your site or a social profile."
      trigger={
        <button type="button" className={cn(chipBase, v && !bad ? chipOn : chipIdle, "max-w-44")} aria-label={v ? `Website: ${v}` : "Add a website or social link"}>
          <Globe className="size-3.5" />
          <span className="truncate">{v ? v.replace(/^https?:\/\//i, "") : "Website"}</span>
        </button>
      }
    >
      <label className="block space-y-1.5">
        <span className="text-[12px] font-medium text-muted-foreground">Link</span>
        <input value={draft.website} onChange={(e) => set({ website: e.target.value })} maxLength={300} inputMode="url" placeholder="www.example.com" aria-invalid={bad || undefined} className={cn(inputCls, bad && "border-destructive")} />
        {bad && <span className="block text-[11px] text-destructive">Enter a valid website URL</span>}
      </label>
    </ResponsivePanel>
  );
}

function FormatChip({ draft, onFormat }: { draft: Draft; onFormat: (f: FormatId) => void }) {
  const [open, setOpen] = useState(false);
  const f = FORMATS[draft.format];
  const list = f.kind === "video" ? VIDEO_FORMATS : IMAGE_FORMATS;
  return (
    <ResponsivePanel
      open={open}
      onOpenChange={setOpen}
      title="Format"
      trigger={
        <button type="button" className={cn(chipBase, chipIdle)} aria-label={`Format: ${f.cardLabel} · ${f.name}`}>
          <LayoutTemplate className="size-3.5" />
          {f.cardLabel === f.name ? f.name : `${f.cardLabel} · ${f.name}`}
          <ChevronDown className="size-3 opacity-60" />
        </button>
      }
    >
      <div className="space-y-1">
        {list.map((id) => (
          <button key={id} type="button" onClick={() => (onFormat(id), setOpen(false))} className={cn("w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-accent", id === draft.format && "bg-brand-faint text-brand-text")}>
            <span className="font-medium">{FORMATS[id].cardLabel}</span>
            {FORMATS[id].cardLabel !== FORMATS[id].name && <span className="text-muted-foreground"> · {FORMATS[id].name}</span>}
          </button>
        ))}
      </div>
    </ResponsivePanel>
  );
}

function UrlParams({ onTemplate, onTab }: { onTemplate: (t: MarketingTemplate) => void; onTab: (t: "templates" | "generations") => void }) {
  const q = useSearchParams();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const t = q.get("template");
    if (t && TEMPLATE_INDEX.get(t)) onTemplate(TEMPLATE_INDEX.get(t)!);
    if (q.get("tab") === "generations") onTab("generations");
  }, [q, onTemplate, onTab]);
  return null;
}

/** Marketing Studio: pick a template (or a format), add your product, avatar, hook and brand kit, and generate. */
export function MarketingStudio({ models }: { models: Record<string, ModelInfo> }) {
  const qc = useQueryClient();
  const { engine, setEngine } = useMarketingEngine();
  const [tab, setTab] = useState<"templates" | "generations">("templates");
  const [category, setCategory] = useState<MarketingCategory | "all">("all");
  const [media, setMedia] = useState<MediaFilter>("all");
  const [draft, setDraft] = useState<Draft>(BLANK);
  const [busy, setBusy] = useState(false);
  const [pulse, setPulse] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  // Focus anywhere in the composer, its popovers and dialogs included.
  const [engaged, setEngaged] = useState(false);
  const composer = useRef<HTMLDivElement>(null);
  const prompt = useRef<HTMLTextAreaElement>(null);
  // A run doesn't go to an account's own GPU or key yet (only the studios' generations do): said up front, with no
  // upload slots and no Generate, instead of a run the server refuses. The slots show once the owner is known
  // (useIsOwner), so a visitor never sees them and then gone.
  const visitor = useLikelyVisitor();
  const isOwner = useIsOwner();
  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const f = FORMATS[draft.format];
  const template = draft.templateId ? TEMPLATE_INDEX.get(draft.templateId) : undefined;
  const kind = f.kind;

  // The brand kit is remembered between visits (and dropped once it's deleted).
  const [savedBrand, pickBrand] = useSavedBrand();
  const brands = useBrands();
  const brandId = savedBrand && brands.data?.some((b) => b.id === savedBrand) ? savedBrand : null;

  const pickTemplate = (t: MarketingTemplate) => {
    setDraft((d) => withTemplate(d, t));
    requestAnimationFrame(() => prompt.current?.focus({ preventScroll: true }));
  };

  const body = useMemo(
    () => ({
      engine,
      format: draft.format,
      templateId: draft.templateId ?? undefined,
      modelId: draft.modelId,
      productId: draft.product?.productId,
      productImages: draft.product && !draft.product.productId ? draft.product.images : undefined,
      avatar: f.avatar !== "none" ? draft.avatar?.ref : undefined,
      reference: draft.reference?.ref,
      brandId: f.brandKit ? (brandId ?? undefined) : undefined,
      hookId: f.hookAndSetting ? draft.hookId : undefined,
      settingId: f.hookAndSetting ? draft.settingId : undefined,
      prompt: draft.prompt.trim() || undefined,
      headline: f.text ? draft.headline.trim() || undefined : undefined,
      cta: f.text ? draft.cta.trim() || undefined : undefined,
      aspectRatio: draft.aspectRatio,
      duration: f.durations ? draft.duration : undefined,
      batch: draft.batch,
      voice: draft.voice,
      voiceSample: draft.voiceSample?.ref,
      website: f.oneOf?.includes("website") && looksLikeWebsite(draft.website) ? draft.website.trim() : undefined,
    }),
    [draft, engine, f, brandId],
  );
  const est = useEstimate<RunEstimate>("/api/marketing/estimate", draft.avatar?.uploading || draft.voiceSample?.uploading ? null : body);
  const badSite = !!f.oneOf?.includes("website") && !!draft.website.trim() && !looksLikeWebsite(draft.website);
  const blocker = visitor
    ? "Marketing Studio isn't available here"
    : draft.product === null && f.product === "required"
      ? "Attach a product to generate"
      : badSite
        ? "Enter a valid website URL"
        : est.data?.blocker;
  const cost = est.data && !est.data.blocker ? (visitor && (est.data.demo || est.data.costUsd === 0) ? "Not available here" : est.data.demo ? "Placeholder · free" : est.data.costUsd == null ? "" : est.data.costUsd === 0 ? "Free" : `≈ ${formatCost(est.data.costUsd)}`) : "";

  // Until a template is picked or you start on the composer it stays slim (the attachment tiles fold
  // away), so the template gallery behind it stays in view.
  const slim = !template && !engaged && !draft.product && !draft.avatar && !draft.reference && !draft.prompt.trim();
  const leaveComposer = () =>
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (!a || !(composer.current?.contains(a) || a.closest("[data-radix-popper-content-wrapper], [role=dialog]"))) setEngaged(false);
    });

  const generate = async () => {
    if (visitor) return;
    if (blocker) {
      setEngaged(true);
      toast(blocker, { id: "marketing-blocker" });
      setPulse(/product/i.test(blocker) ? "product" : /avatar/i.test(blocker) ? "avatar" : null);
      setTimeout(() => setPulse(null), 1600);
      return;
    }
    setBusy(true);
    try {
      const r = await send<{ runs: MarketingRun[] }>("/api/marketing/runs", "POST", body);
      addRuns(qc, "marketing", r.runs);
      setTab("generations");
      toast.success(r.runs.length > 1 ? `${r.runs.length} runs started` : f.pipeline === "image" ? "Generating" : `Started · ${est.data?.steps.length ?? ""} steps`, { duration: 1600 });
      set({ prompt: "" });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const toggleKind = (k: "image" | "video") => {
    if (k === kind) return;
    setMedia(k);
    setDraft((d) => withTemplate(d, null, k === "image" ? "product-standalone" : "motion-hyper"));
  };

  return (
    <div className="flex min-h-svh min-w-0 flex-col">
      <MarketingHeader title="Marketing Studio" active="studio" engine={engine} onEngine={setEngine} selfHostedOnly />
      <Suspense fallback={null}>
        <UrlParams onTemplate={pickTemplate} onTab={setTab} />
      </Suspense>
      <div className="mx-auto w-full min-w-0 max-w-[1240px] flex-1 px-3 pb-10 sm:px-6">
        <div className="pt-6 pb-2 text-center sm:pt-10">
          <h2 className="font-heading text-display text-balance">Turn a product into ready-to-post content</h2>
          <p className="mx-auto mt-2 max-w-xl text-[15px] text-muted-foreground">
            Product shots, motion, UGC presenters, ads, posters and listings — from Fuobe&apos;s templates, on {engine === "open" ? (visitor ? "open-source models" : "your own GPU, free") : "Fuobe Marketing Image or partner models in the cloud"}.
          </p>
          {visitor && <SelfHostNote className="mx-auto mt-3 max-w-xl">Marketing Studio isn&apos;t available here.</SelfHostNote>}
        </div>
        <div role="tablist" aria-label="View" className="mx-auto mt-4 flex w-fit rounded-full bg-muted p-0.5">
          {(["templates", "generations"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("h-8 rounded-full px-4 text-[13px] font-medium text-muted-foreground", tab === t && "bg-background text-foreground shadow-soft")}>
              {t === "templates" ? "Templates" : "My generations"}
            </button>
          ))}
        </div>
        <div className="mt-6">
          {tab === "templates" ? (
            <TemplateGallery
              category={category}
              onCategory={setCategory}
              media={media}
              onMedia={(m) => {
                setMedia(m);
                if (m !== "all" && m !== kind) setDraft((d) => withTemplate(d, null, m === "image" ? "product-standalone" : "motion-hyper"));
              }}
              selected={draft.templateId ?? undefined}
              onPick={pickTemplate}
            />
          ) : (
            <RunsList
              feature="marketing"
              empty={
                <div className="mx-auto max-w-md py-16 text-center">
                  <EmptyIcon icon={LayoutTemplate} />
                  <h3 className="mt-5 font-heading text-[24px]">Nothing made yet</h3>
                  <p className="mt-2 text-[14px] text-muted-foreground">Pick a template, add your product and press Generate. Results land here as they render.</p>
                  <button type="button" onClick={() => setTab("templates")} className="mt-5 h-9 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground">
                    Browse templates
                  </button>
                </div>
              }
            />
          )}
        </div>
      </div>

      {/* Docked composer */}
      <div className="sticky bottom-0 z-20 bg-gradient-to-t from-background via-background/95 to-transparent px-3 pt-8 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
        <div
          ref={composer}
          data-slim={slim || undefined}
          onFocus={() => setEngaged(true)}
          onBlur={leaveComposer}
          className="mx-auto w-full max-w-[860px] rounded-[20px] border bg-background p-2.5 shadow-normal transition-[border-color,box-shadow] focus-within:border-primary focus-within:ring-4 focus-within:ring-brand-faint sm:rounded-composer"
        >
          <div className={cn("scrollbar-none flex items-center gap-2 overflow-x-auto px-1 pt-1.5 pb-1", slim && "hidden")}>
            {template && (
              <div className="relative flex h-14 shrink-0 items-center gap-2 rounded-xl bg-muted py-1 pr-7 pl-1">
                <div className="h-12 w-9 overflow-hidden rounded-lg">
                  <TemplatePreview id={template.id} look={template.look} cover={templateCover("marketing", template.id)} sizes="36px" />
                </div>
                <div className="min-w-0">
                  <p className="max-w-32 truncate text-[12px] font-medium">{template.name}</p>
                  <p className="text-[11px] text-muted-foreground">{f.cardLabel}</p>
                </div>
                <button type="button" onClick={() => setDraft((d) => withTemplate(d, null, d.format))} aria-label="Clear template" className="absolute top-1 right-1 grid size-5 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
                  <X className="size-3" />
                </button>
              </div>
            )}
            {/* A guest or an account gets no upload slots: nothing is uploaded for a run that can't start here. */}
            {isOwner && f.product !== "none" && <ProductSlot value={draft.product} onChange={(p) => set({ product: p })} required={f.product === "required"} brandId={brandId} pulse={pulse === "product"} />}
            {isOwner && f.avatar !== "none" && <AvatarSlot value={draft.avatar} onChange={(a) => set({ avatar: a })} pulse={pulse === "avatar"} />}
            {isOwner && f.pipeline !== "ugc" && <MediaSlot label="Reference" kind="image" value={draft.reference} onChange={(v) => set({ reference: v })} />}
          </div>
          <textarea
            ref={prompt}
            value={draft.prompt}
            onChange={(e) => set({ prompt: e.target.value })}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void generate();
              }
            }}
            maxLength={MAX_PROMPT}
            rows={focused || draft.prompt ? 2 : 1}
            placeholder={template ? (f.text ? "Describe your edit (optional)" : "What should look different? (optional)") : f.promptPlaceholder}
            aria-label="Prompt"
            className="field-sizing-content max-h-40 min-h-9 w-full resize-none bg-transparent px-2 py-1.5 text-[15px] outline-none placeholder:text-subtle-foreground"
          />
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="scrollbar-none flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
              <div role="radiogroup" aria-label="Mode" className="inline-flex shrink-0 rounded-full bg-muted p-0.5">
                {(["image", "video"] as const).map((k) => (
                  <button key={k} role="radio" aria-checked={kind === k} onClick={() => toggleKind(k)} aria-label={k === "image" ? "Image mode" : "Video mode"} className={cn("inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium text-muted-foreground", kind === k && "bg-background text-foreground shadow-soft")}>
                    {k === "image" ? <ImageIcon className="size-3.5" /> : <Video className="size-3.5" />}
                    <span className="hidden sm:inline">{k === "image" ? "Image" : "Video"}</span>
                  </button>
                ))}
              </div>
              {!template && <FormatChip draft={draft} onFormat={(id) => setDraft((d) => withTemplate(d, null, id))} />}
              {f.hookAndSetting && <HookPicker value={draft.hookId} onChange={(h) => set({ hookId: h })} />}
              {f.hookAndSetting && <SettingPicker value={draft.settingId} onChange={(s) => set({ settingId: s })} />}
              {f.pipeline === "ugc" && <VoiceControl engine={engine} models={models} voice={draft.voice} sample={draft.voiceSample} onVoice={(v) => set({ voice: v })} onSample={(s) => set({ voiceSample: s })} />}
              {f.text && <TextPanel draft={draft} set={set} template={template} />}
              {f.oneOf?.includes("website") && <WebsitePanel draft={draft} set={set} />}
              {f.brandKit && <BrandChip value={brandId} onChange={pickBrand} />}
              <SettingsPanel draft={draft} set={set} models={models} engine={engine} />
            </div>
            <span className="hidden shrink-0 font-mono text-[12px] text-muted-foreground tabular-nums sm:inline">{est.isFetching && !est.data ? "…" : cost}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => void generate()}
                  disabled={visitor}
                  aria-label={template ? "Recreate template" : "Generate"}
                  aria-disabled={!!blocker || busy}
                  className={cn("grid size-10 shrink-0 place-items-center rounded-full text-primary-foreground transition-colors", blocker ? "bg-primary/70 hover:bg-primary/80" : "bg-primary hover:bg-primary/90")}
                >
                  {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent>{blocker ?? (template ? `Recreate template${cost ? ` · ${cost}` : ""}` : `Generate${cost ? ` · ${cost}` : ""}`)}</TooltipContent>
            </Tooltip>
          </div>
          {est.data?.notes.length && !blocker ? <p className="hidden truncate px-2 pt-1 text-[11px] text-muted-foreground sm:block">{est.data.notes[0]}</p> : null}
          {/* Phones have no hover: the price (and what blocks Generate) sit under the composer. */}
          {(blocker || cost || est.data?.notes.length) && (
            <p className="flex min-w-0 items-baseline justify-between gap-2 px-2 pt-1 text-[11px] text-muted-foreground sm:hidden" aria-live="polite">
              <span className="min-w-0 truncate">{blocker ?? est.data?.notes[0] ?? ""}</span>
              {!blocker && cost && <span className="shrink-0 font-mono tabular-nums">{cost}</span>}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
