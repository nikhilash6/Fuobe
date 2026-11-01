"use client";

import { ArrowRight, Check, Globe, Loader2, Palette, PenLine, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { kmeans, samplePixels } from "@/components/cinema/color-math";
import { chipBase, chipIdle, chipOn } from "@/components/studio/chip";
import { useIsOwner } from "@/lib/api";
import { BRAND_EXAMPLES, type BrandKit } from "@/lib/catalog/marketing";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { useBrand, useBrandActions, useBrands, useCreateBrand } from "@/components/marketing/hooks";
import { BrandSummary } from "./brand-kit-form";
import { areaCls, inputCls } from "./fields";
import { ImageList } from "./image-list";
import { ResearchProgress } from "./research-progress";

/** The main colours of some pictures (k-means in the browser), for a kit made by hand. */
export async function paletteFromImages(urls: string[], k = 5): Promise<string[]> {
  const pixels = [];
  for (const src of urls.slice(0, 4)) {
    try {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = 64;
      c.height = Math.max(1, Math.round((64 * img.naturalHeight) / Math.max(1, img.naturalWidth)));
      const ctx = c.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      pixels.push(...samplePixels(ctx.getImageData(0, 0, c.width, c.height).data, 2000));
    } catch {
      // A picture the browser can't decode adds nothing.
    }
  }
  return pixels.length ? kmeans(pixels, k).map((x) => x.color) : [];
}

/** Website → research, or a description → a kit made by hand. Calls `onDone` with the brand once it's ready. */
export function BrandStart({ onDone, compact }: { onDone: (b: BrandKit) => void; compact?: boolean }) {
  const create = useCreateBrand();
  const [mode, setMode] = useState<"site" | "manual">("site");
  const [site, setSite] = useState("");
  const [desc, setDesc] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const submitSite = () => {
    if (!site.trim()) return void toast("Add a website or social link.");
    create.mutate({ website: site.trim() }, { onSuccess: onDone, onError: (e) => toastError(e) });
  };
  const submitManual = async () => {
    if (!desc.trim() && !images.length) return void toast("Add a description or upload images");
    const colors = images.length ? await paletteFromImages(images) : undefined;
    create.mutate({ description: desc.trim(), images, colors: colors?.length ? colors : undefined }, { onSuccess: onDone, onError: (e) => toastError(e) });
  };
  return mode === "site" ? (
    <div className="space-y-3">
      <form
        className={cn("flex gap-2", compact ? "flex-col sm:flex-row" : "flex-col sm:flex-row")}
        onSubmit={(e) => {
          e.preventDefault();
          submitSite();
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Globe className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="www.yourbrand.com" aria-label="Your website" className={cn(inputCls, "h-11 rounded-full pl-9 text-[14px]")} autoFocus={!compact} />
        </div>
        <Button type="submit" size="lg" className="h-11 rounded-full px-5" disabled={create.isPending}>
          {create.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Research my brand
        </Button>
      </form>
      <p className="text-center text-[13px] text-muted-foreground">
        Your logo, colours, fonts, voice, selling points and products load from the site.{" "}
        <button type="button" onClick={() => setMode("manual")} className="font-medium text-brand-text hover:underline">
          Or create it manually
        </button>
      </p>
    </div>
  ) : (
    <div className="space-y-3 text-left">
      <label className="block text-[13px] font-medium">Describe your business — what you sell, who it&apos;s for, what makes it yours</label>
      <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={4} className={areaCls} placeholder="e.g. Ember & Oat — small-batch granola roasted in Portland…" autoFocus />
      <div className="flex flex-wrap gap-1.5">
        {BRAND_EXAMPLES.map((x) => (
          <button key={x.label} type="button" onClick={() => setDesc(x.text)} className={cn(chipBase, "h-7 px-2.5 text-[12px]", desc === x.text ? chipOn : chipIdle)}>
            {x.label}
          </button>
        ))}
      </div>
      <div>
        <p className="text-[13px] font-medium">Your product (optional)</p>
        <p className="mb-2 text-[12px] text-muted-foreground">We&apos;ll build the identity around it — palette, typography and mood.</p>
        <ImageList value={images} onChange={setImages} max={4} size="sm" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button type="button" onClick={() => setMode("site")} className="text-[13px] text-muted-foreground hover:text-foreground">
          ← Use a website instead
        </button>
        <Button onClick={() => void submitManual()} disabled={create.isPending}>
          {create.isPending ? <Loader2 className="animate-spin" /> : <PenLine />} Create brand kit
        </Button>
      </div>
    </div>
  );
}

/** "Add your brand kit" as a dialog (Marketing Studio, Click to Ad): start, research, then use it. */
export function BrandKitDialog({ open, onOpenChange, onUse }: { open: boolean; onOpenChange: (o: boolean) => void; onUse: (b: BrandKit) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {/* Mounts with the dialog: every opening starts at "paste your link". */}
        <BrandKitFlow onOpenChange={onOpenChange} onUse={onUse} />
      </DialogContent>
    </Dialog>
  );
}

function BrandKitFlow({ onOpenChange, onUse }: { onOpenChange: (o: boolean) => void; onUse: (b: BrandKit) => void }) {
  const [id, setId] = useState<string | null>(null);
  const view = useBrand(id);
  const actions = useBrandActions(id ?? "");
  const b = view.data?.brand;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{b?.status === "ready" ? "Your Brand Kit is ready" : "Add your brand kit"}</DialogTitle>
        <DialogDescription>
          {b?.status === "ready" ? "Review it any time — every generation stays on-brand." : "One link is all we need to keep every campaign on-brand."}
        </DialogDescription>
      </DialogHeader>
      {!id && <BrandStart compact onDone={(x) => setId(x.id)} />}
      {id && !b && (
        <div className="grid h-40 place-items-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      )}
      {b?.status === "researching" && <ResearchProgress brand={b} onCancel={() => actions.cancel.mutate()} canceling={actions.cancel.isPending} />}
      {b && b.status !== "researching" && (
        <div className="space-y-4">
          <BrandSummary brand={b} />
          {(b.note || b.error) && <p className="rounded-xl bg-highlight/20 px-3 py-2 text-[13px]">{b.error ?? b.note}</p>}
          {b.status === "canceled" && <p className="text-[13px] text-muted-foreground">Research canceled. The kit keeps what it found so far.</p>}
          {b.productCount ? <p className="text-[13px] text-muted-foreground">Found {b.productCount} product{b.productCount === 1 ? "" : "s"}.</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" asChild>
              <Link href={`/ads/${b.id}?step=kit`}>Review and edit</Link>
            </Button>
            <Button
              onClick={() => {
                onUse(b);
                onOpenChange(false);
              }}
            >
              <Check /> Use this kit
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

/** The composer's Brand kit chip: pick a kit, none, or add one. */
export function BrandChip({ value, onChange }: { value: string | null; onChange: (id: string | null, brand?: BrandKit) => void }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const brands = useBrands();
  // A brand kit is saved to the studio's library, which is its owner's: anyone else gets no Add or Manage, whose
  // research and save would be refused, and reads where kits are made.
  const isOwner = useIsOwner();
  const current = brands.data?.find((b) => b.id === value);
  const ready = brands.data?.filter((b) => b.status !== "researching") ?? [];
  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={cn(chipBase, current ? chipOn : chipIdle, "max-w-48")} aria-label={current ? `Brand kit: ${current.name}` : "Brand kit"}>
            {current?.colors.length ? (
              <span className="flex -space-x-1">
                {current.colors.slice(0, 3).map((c) => (
                  <span key={c} className="size-3 rounded-full border border-background" style={{ background: c }} />
                ))}
              </span>
            ) : (
              <Palette className="size-3.5" />
            )}
            <span className="truncate">{current?.name ?? "Brand kit"}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" collisionPadding={12} className="w-[min(92vw,320px)] p-1.5">
          <p className="px-2 pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Brand kit</p>
          <div className="max-h-72 overflow-y-auto">
            {ready.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => {
                  onChange(b.id, b);
                  setOpen(false);
                }}
                className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-accent", b.id === value && "bg-brand-faint")}
              >
                <BrandSummary brand={b} className="min-w-0 flex-1 [&_.size-12]:size-9" />
                {b.id === value && <Check className="size-3.5 shrink-0 text-brand-text" />}
              </button>
            ))}
            {!ready.length && (
              <p className="px-2 py-3 text-[13px] text-muted-foreground">
                {isOwner ? "No brand kit added yet — paste a link or create one manually to get started." : "Brand kits aren't available here."}
              </p>
            )}
          </div>
          {(isOwner || value) && (
            <div className="mt-1 flex gap-1 border-t pt-1.5">
              {isOwner && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setAdding(true);
                  }}
                  className="flex h-8 flex-1 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium hover:bg-accent"
                >
                  <Plus className="size-3.5" /> Add brand kit
                </button>
              )}
              {value && (
                <button
                  type="button"
                  onClick={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                  className="h-8 rounded-lg px-2 text-[13px] text-muted-foreground hover:bg-accent"
                >
                  No brand kit
                </button>
              )}
              {isOwner && (
                <Link href="/ads" className="flex h-8 items-center gap-1 rounded-lg px-2 text-[13px] text-muted-foreground hover:bg-accent" onClick={() => setOpen(false)}>
                  Manage <ArrowRight className="size-3" />
                </Link>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
      <BrandKitDialog open={adding && isOwner} onOpenChange={setAdding} onUse={(b) => onChange(b.id, b)} />
    </>
  );
}
