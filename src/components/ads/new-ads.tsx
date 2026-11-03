"use client";

import { Loader2, Minus, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AddFromLink, ProductCard, ProductDialog, UploadProductButton } from "@/components/brand/products";
import { AD_VISUAL_MODELS, DRAWN_WORDS_LABEL, DRAWN_WORDS_MODELS, MAX_ADS_PER_PRODUCT, MAX_PRODUCTS_PER_RUN, type BrandKit, type Product } from "@/lib/catalog/marketing";
import { useModelAccess } from "@/lib/api";
import { keepOffered, offered } from "@/lib/model-access";
import { formatCost } from "@/lib/format";
import { RunPlaceChip, useRunPlace } from "@/components/studio/run-place-chip";
import { toastError } from "@/lib/refusals";
import { useCreativeActions, useEstimate, useProductActions } from "@/components/marketing/hooks";

interface BatchEstimate {
  modelName: string;
  total: number;
  costUsd: number | null;
  perAd: number | null;
  demo: boolean;
  copyBy: "llm" | "rules";
  blocker?: string;
}

function Stepper({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full bg-muted p-0.5" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} className="grid size-7 place-items-center rounded-full hover:bg-background disabled:opacity-40" aria-label={`Fewer ads for ${label}`}>
        <Minus className="size-3.5" />
      </button>
      <input
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (Number.isFinite(n)) onChange(Math.min(MAX_ADS_PER_PRODUCT, Math.max(1, n)));
        }}
        inputMode="numeric"
        aria-label={`Ads for ${label}`}
        className="h-7 w-9 bg-transparent text-center font-mono text-[13px] tabular-nums outline-none"
      />
      <button type="button" onClick={() => onChange(Math.min(MAX_ADS_PER_PRODUCT, value + 1))} disabled={value >= MAX_ADS_PER_PRODUCT} className="grid size-7 place-items-center rounded-full hover:bg-background disabled:opacity-40" aria-label={`More ads for ${label}`}>
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

/** Select products (≤10) → "How many ads to create?" (≤20 each, total price first) → Create. */
export function NewAds({
  brand,
  products,
  engine,
  onEngine,
  onCreated,
}: {
  brand: BrandKit;
  products: Product[];
  engine: "cloud" | "open";
  /** Switching engine from the place chip (the header's switch). */
  onEngine?: (e: "cloud" | "open") => void;
  onCreated: (batchId: string) => void;
}) {
  const { createBatch } = useCreativeActions(brand.id);
  const { remove } = useProductActions();
  const [selected, setSelected] = useState<string[]>(() => products.slice(0, MAX_PRODUCTS_PER_RUN).map((p) => p.id));
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [editing, setEditing] = useState<Product | null>(null);
  // The picture's model: Fuobe Marketing Image first; partner models as choices (those switched off in Settings leave).
  const access = useModelAccess();
  // "Words drawn by the model": the whole ad drawn from a layout of its places, by a model that reads boxes.
  const [drawn, setDrawn] = useState(false);
  const visuals = keepOffered(drawn ? DRAWN_WORDS_MODELS[engine] : AD_VISUAL_MODELS[engine], (c) => offered(access, c.id, engine));
  const [picked, setPicked] = useState<string>();
  const visual = visuals.find((c) => c.id === picked) ?? visuals[0];
  const items = selected.filter((id) => products.some((p) => p.id === id)).map((productId) => ({ productId, count: counts[productId] ?? 4 }));
  const total = items.reduce((n, i) => n + i.count, 0);
  // useEstimate keys on the body's JSON, so a fresh object each render is fine.
  const body = items.length ? { brandId: brand.id, engine, items, ...(visual && { modelId: visual.id }), ...(drawn && { drawnWords: true }) } : null;
  const est = useEstimate<BatchEstimate>("/api/ads/estimate", body);
  const toggle = (id: string) =>
    setSelected((s) => {
      if (s.includes(id)) return s.filter((x) => x !== id);
      if (s.length >= MAX_PRODUCTS_PER_RUN) {
        toast(`Up to ${MAX_PRODUCTS_PER_RUN} products per run`);
        return s;
      }
      return [...s, id];
    });
  const create = () => {
    if (!body) return void toast("Select at least one product");
    if (est.data?.blocker) return void toast(est.data.blocker);
    createBatch.mutate(body, {
      onSuccess: (r) => {
        toast.success(`Generating ${r.creatives.length} ads`, { duration: 1800 });
        onCreated(r.batchId);
      },
      onError: (e) => toastError(e),
    });
  };
  // Where the ads are made and their price, as the studios say it.
  const priced = est.data && !est.data.blocker ? est.data : undefined;
  const place = useRunPlace({ engine, models: priced ? [priced.modelName] : undefined, costUsd: priced?.costUsd, demo: priced?.demo, ownerOnly: "Ads Studio" });
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border bg-background p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[16px] font-semibold">Select products to create ads</h3>
            <p className="text-[13px] text-muted-foreground">
              {products.length} product{products.length === 1 ? "" : "s"} found · up to {MAX_PRODUCTS_PER_RUN} per run. Product details may contain mistakes — check them before you continue.
            </p>
          </div>
          <div className="flex gap-1.5">
            <Button variant="ghost" size="sm" onClick={() => setSelected(selected.length ? [] : products.slice(0, MAX_PRODUCTS_PER_RUN).map((p) => p.id))}>
              {selected.length ? "Deselect all" : "Select all"}
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <AddFromLink brandId={brand.id} limit={5} className="flex-1" placeholder="Add product from link" onAdded={(ps) => setSelected((s) => [...new Set([...s, ...ps.map((p) => p.id)])].slice(0, MAX_PRODUCTS_PER_RUN))} />
          <UploadProductButton brandId={brand.id} onSaved={(p) => setSelected((s) => [...new Set([...s, p.id])].slice(0, MAX_PRODUCTS_PER_RUN))} />
        </div>
        {products.length ? (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} selected={selected.includes(p.id)} onToggle={() => toggle(p.id)} disabled={selected.length >= MAX_PRODUCTS_PER_RUN} onEdit={() => setEditing(p)} onDelete={() => remove.mutate(p.id)} />
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-xl bg-muted/60 px-4 py-6 text-center text-[13px] text-muted-foreground">No products yet. Paste a product link or upload one to start making ads.</p>
        )}
      </section>

      {items.length > 0 && (
        <section className="rounded-2xl border bg-background p-4 sm:p-5">
          <h3 className="text-[16px] font-semibold">How many ads to create?</h3>
          <p className="text-[13px] text-muted-foreground">
            {drawn ? "Each ad is drawn whole in 4:5, with its headline, copy and call to action in place." : "Each ad comes in 1:1, 4:5 and 9:16, with a headline, copy and a call to action."}
          </p>
          <ul className="mt-4 divide-y">
            {items.map((i) => {
              const p = products.find((x) => x.id === i.productId)!;
              return (
                <li key={i.productId} className="flex items-center gap-3 py-2.5">
                  <span className="size-10 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {p.images[0] && <img src={p.images[0]} alt="" className="size-full object-cover" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{p.name}</span>
                  <Stepper value={i.count} onChange={(n) => setCounts((c) => ({ ...c, [i.productId]: n }))} label={p.name} />
                </li>
              );
            })}
          </ul>
          <div className="mt-4 flex items-start gap-3 rounded-xl bg-muted/60 p-3">
            <div className="min-w-0 flex-1">
              <label htmlFor="ads-drawn-words" className="block text-[13px] font-medium">
                {DRAWN_WORDS_LABEL}
              </label>
              <p id="ads-drawn-words-hint" className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                {drawn
                  ? "The model draws the headline, copy and button into the picture, in their places: its own lettering, one 4:5 format."
                  : "Off: the words are set on top in your brand fonts, letter for letter, in every format."}
              </p>
            </div>
            <Switch
              id="ads-drawn-words"
              checked={drawn}
              onCheckedChange={(v) => {
                setDrawn(v);
                setPicked(undefined);
              }}
              aria-describedby="ads-drawn-words-hint"
              className="mt-0.5 shrink-0"
            />
          </div>
          {visuals.length > 1 && visual && (
            <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <label htmlFor="ads-visual" className="text-[13px] font-medium">
                Pictures by
              </label>
              <Select value={visual.id} onValueChange={setPicked}>
                <SelectTrigger id="ads-visual" size="sm" className="min-w-0 max-w-full sm:w-64" aria-describedby="ads-visual-note">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {visuals.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name ?? c.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p id="ads-visual-note" className="w-full text-[12px] text-muted-foreground">
                {visual.note}.{drawn ? "" : " Headlines, copy and your logo are set in your brand fonts on top."}
              </p>
            </div>
          )}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/60 px-4 py-3">
            <div className="min-w-0 text-[13px]">
              <p className="font-medium">
                Create {total} ad{total === 1 ? "" : "s"} for{" "}
                {items.slice(0, 3).map((i) => (
                  <span key={i.productId} className="mx-0.5 inline-block max-w-40 truncate rounded-full bg-background px-2 align-bottom text-[12px]">
                    {products.find((p) => p.id === i.productId)?.name}
                  </span>
                ))}
                {items.length > 3 && ` +${items.length - 3}`} and the brand
              </p>
              <p className="text-[12px] text-muted-foreground">
                {est.data?.blocker ?? (est.data ? `${est.data.modelName}${est.data.perAd != null && !est.data.demo ? ` · ${formatCost(est.data.perAd)} per ad` : ""} · copy by ${est.data.copyBy === "llm" ? "your LLM" : "Fuobe's rules"}` : "Pricing…")}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <RunPlaceChip place={place} engine={engine} onEngine={onEngine} pending={est.isFetching && !est.data} className="bg-background" />
              <Button size="lg" onClick={create} disabled={createBatch.isPending || !!est.data?.blocker} title={place?.send ? `Create ${total} ads · ${place.send}` : undefined}>
                {createBatch.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Create {total} ads
              </Button>
            </div>
          </div>
        </section>
      )}
      <ProductDialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)} product={editing} brandId={brand.id} />
    </div>
  );
}
