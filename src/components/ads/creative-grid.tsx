"use client";

import { AlertCircle, Download, FolderDown, Loader2, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { AD_ANGLES, AD_RATIOS, creativeStatusText, type AdCreative, type AdRatio, type BrandKit, type Product } from "@/lib/catalog/marketing";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { useCreativeActions } from "@/components/marketing/hooks";
import { AdCanvas } from "./ad-canvas";
import { AdEditor, downloadFormats, renderInput } from "./ad-editor";
import { defaultLayout, exportName, type AdLayout } from "./layout";
import { downloadBlob, exportPng } from "./render";
import { zipFiles } from "./zip";

const layoutOf = (c: AdCreative, ratio: string) => (c.layout as AdLayout | null) ?? defaultLayout(ratio, c.position);

/** The formats a creative exists in: a baked (Higgsfield) ad only in the one it was rendered in. */
export const formatsOf = (c: Pick<AdCreative, "baked" | "ratio">): AdRatio[] => (c.baked ? [c.ratio ?? "4:5"] : [...AD_RATIOS]);

/** The format to export a creative in when the grid shows `ratio`. */
const exportRatio = (c: AdCreative, ratio: AdRatio): AdRatio => (formatsOf(c).includes(ratio) ? ratio : formatsOf(c)[0]);

function CreativeCard({ c, brand, ratio, product, n, onEdit }: { c: AdCreative; brand: BrandKit; ratio: AdRatio; product?: Product; n: number; onEdit: () => void }) {
  const { retry, remove } = useCreativeActions(brand.id);
  const ready = c.status === "ready" && !!c.image;
  const failed = c.status === "failed" || c.status === "canceled";
  const angle = AD_ANGLES.find((a) => a.id === c.angle)?.name;
  const own = exportRatio(c, ratio);
  return (
    <article className="group/ad min-w-0 animate-fade-up">
      <div className="relative">
        {ready || c.headline ? (
          <button type="button" onClick={onEdit} disabled={!ready} className="block w-full overflow-hidden rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Edit ad: ${c.headline || "ad"}`}>
            <AdCanvas lazy label={c.headline || "Ad"} input={renderInput({ ratio, layout: layoutOf(c, ratio), text: c, brand, image: c.image, baked: c.baked })} className="rounded-xl" />
          </button>
        ) : (
          <div className="relative overflow-hidden rounded-xl bg-muted" style={{ aspectRatio: ratio.replace(":", " / ") }} />
        )}
        {ready && own !== ratio && <span className="pointer-events-none absolute bottom-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">{own} only</span>}
        {!ready && (
          <div className={cn("absolute inset-0 flex flex-col justify-end rounded-xl p-3", failed ? "bg-background/85" : "bg-gradient-to-t from-background/90 via-background/30 to-transparent")}>
            {!failed && <div className="skeleton-sweep absolute inset-0 animate-skeleton rounded-xl" />}
            <div className="relative">
              {failed ? (
                <>
                  <p className="flex items-center gap-1.5 text-[13px] font-medium">
                    <AlertCircle className="size-3.5 text-destructive" /> {c.status === "canceled" ? "Canceled before it was made" : "Creative generation failed"}
                  </p>
                  {c.error && <p className="mt-1 line-clamp-3 text-[12px] text-muted-foreground">{c.error}</p>}
                  <button
                    type="button"
                    onClick={() => retry.mutate(c.id, { onError: (e) => toastError(e) })}
                    className="mt-2 inline-flex h-7 items-center gap-1.5 rounded-full bg-secondary px-2.5 text-[12px] font-medium hover:bg-accent"
                    title="Retry uses credits again"
                  >
                    {retry.isPending ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />} Retry
                  </button>
                </>
              ) : (
                <p className="shimmer-text animate-shimmer-text text-[13px] font-medium">{creativeStatusText(c.status)}</p>
              )}
            </div>
          </div>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-black/45 text-white opacity-100 backdrop-blur hover:bg-black/65 focus-visible:opacity-100 data-[state=open]:opacity-100 sm:opacity-0 sm:group-hover/ad:opacity-100" aria-label="Ad actions">
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {ready && (
              <>
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil /> Edit words and layout
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void downloadFormats({ brand: brand.name, product: product?.name, n }, [renderInput({ ratio: own, layout: layoutOf(c, own), text: c, brand, image: c.image, baked: c.baked })])}>
                  <Download /> Download {own}
                </DropdownMenuItem>
                {formatsOf(c).length > 1 && (
                  <DropdownMenuItem onClick={() => void downloadFormats({ brand: brand.name, product: product?.name, n }, formatsOf(c).map((r) => renderInput({ ratio: r, layout: layoutOf(c, r), text: c, brand, image: c.image, baked: c.baked })))}>
                    <FolderDown /> Download all formats
                  </DropdownMenuItem>
                )}
              </>
            )}
            {failed && (
              <DropdownMenuItem onClick={() => retry.mutate(c.id)}>
                <RotateCcw /> Retry
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => remove.mutate(c.id)}>
              <Trash2 /> Remove from grid
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="mt-1.5 truncate px-0.5 text-[12px] text-muted-foreground">{[product?.name, angle].filter(Boolean).join(" · ") || "Ad"}</p>
    </article>
  );
}

/** The creative grid: format preview, product filter, split by product, Download all, editor. */
export function CreativeGrid({ brand, products, creatives }: { brand: BrandKit; products: Product[]; creatives: AdCreative[] }) {
  const { update, save } = useCreativeActions(brand.id);
  const [ratio, setRatio] = useState<AdRatio>("4:5");
  const [filter, setFilter] = useState("all");
  const [split, setSplit] = useState(false);
  const [editing, setEditing] = useState<AdCreative | null>(null);
  const [zipping, setZipping] = useState(false);
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const shown = creatives.filter((c) => filter === "all" || c.productId === filter);
  const ready = shown.filter((c) => c.status === "ready" && c.image);
  const pending = creatives.filter((c) => c.status === "writing" || c.status === "queued" || c.status === "rendering").length;
  // Ads are numbered in the order they were made: oldest batch first, and in a batch the order asked for.
  const number = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (const b of [...new Set(creatives.map((c) => c.batchId))].reverse()) for (const c of creatives) if (c.batchId === b) m.set(c.id, ++n);
    return m;
  }, [creatives]);
  const groups = split ? products.filter((p) => shown.some((c) => c.productId === p.id)).map((p) => ({ key: p.id, title: p.name, items: shown.filter((c) => c.productId === p.id) })) : [{ key: "all", title: "", items: shown }];

  const downloadAll = async () => {
    if (!ready.length) return void toast("No finished ads to download yet");
    setZipping(true);
    const id = toast.loading(`Preparing ${ready.length} ad${ready.length === 1 ? "" : "s"}…`);
    try {
      const files = [];
      for (const c of ready) {
        // A baked ad goes in the one format it was made in.
        const r = exportRatio(c, ratio);
        const blob = await exportPng(renderInput({ ratio: r, layout: layoutOf(c, r), text: c, brand, image: c.image, baked: c.baked }));
        files.push({ name: exportName(brand.name, byId.get(c.productId ?? "")?.name, r, number.get(c.id) ?? 0), data: new Uint8Array(await blob.arrayBuffer()) });
      }
      downloadBlob(new Blob([zipFiles(files) as BlobPart], { type: "application/zip" }), `${exportName(brand.name, undefined, ratio, ready.length).replace(/\.png$/, "")}-ads.zip`);
      toast.success("Downloaded", { id, duration: 1500 });
    } catch (e) {
      toast.error((e as Error).message, { id });
    } finally {
      setZipping(false);
    }
  };

  return (
    <section aria-label="Ads" className="@container">
      {pending > 0 && <p className="mb-3 text-[13px] text-muted-foreground">Generating {pending} ad{pending === 1 ? "" : "s"} — they land in the grid as they render.</p>}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Format" className="inline-flex rounded-full bg-muted p-0.5">
          {AD_RATIOS.map((r) => (
            <button key={r} role="radio" aria-checked={ratio === r} onClick={() => setRatio(r)} className={cn("h-7 rounded-full px-3 text-[12px] font-medium text-muted-foreground", ratio === r && "bg-background text-foreground shadow-soft")}>
              {r}
            </button>
          ))}
        </div>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="h-8 w-44" aria-label="Filter by product">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All products</SelectItem>
            {products.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Switch checked={split} onCheckedChange={setSplit} aria-label="Split by products" /> Split by products
        </label>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => void downloadAll()} disabled={zipping || !ready.length}>
          {zipping ? <Loader2 className="animate-spin" /> : <FolderDown />} Download all
        </Button>
      </div>
      {groups.map((g) => (
        <div key={g.key} className="mb-8">
          {g.title && <h3 className="mb-3 text-[14px] font-semibold">{g.title}</h3>}
          <div className={cn("grid gap-x-3 gap-y-5", ratio === "9:16" ? "grid-cols-2 @xl:grid-cols-3 @4xl:grid-cols-4 @6xl:grid-cols-5" : "grid-cols-2 @2xl:grid-cols-3 @5xl:grid-cols-4 @7xl:grid-cols-5")}>
            {g.items.map((c) => (
              <CreativeCard key={c.id} c={c} brand={brand} ratio={ratio} product={byId.get(c.productId ?? "")} n={number.get(c.id) ?? 0} onEdit={() => setEditing(c)} />
            ))}
          </div>
        </div>
      ))}
      {editing && (
        <AdEditor
          open
          onOpenChange={(o) => !o && setEditing(null)}
          title={`${byId.get(editing.productId ?? "")?.name ?? brand.name} · ${AD_ANGLES.find((a) => a.id === editing.angle)?.name ?? "Ad"}`}
          image={editing.image}
          baked={editing.baked}
          ratios={editing.baked ? formatsOf(editing) : [ratio, ...AD_RATIOS.filter((r) => r !== ratio)]}
          initial={{ headline: editing.headline, body: editing.body, cta: editing.cta, layout: layoutOf(editing, ratio) }}
          brand={brand}
          productName={byId.get(editing.productId ?? "")?.name}
          number={number.get(editing.id)}
          onSaveText={(t) => update.mutate({ id: editing.id, headline: t.headline, body: t.body, cta: t.cta, layout: t.layout }, { onSuccess: () => toast("Saved", { duration: 1200 }), onError: (e) => toastError(e) })}
          onSaveToLibrary={async (url, r) => {
            await save.mutateAsync({ id: editing.id, url, ratio: r });
          }}
        />
      )}
    </section>
  );
}
