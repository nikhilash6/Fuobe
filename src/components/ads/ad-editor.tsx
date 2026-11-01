"use client";

import { Download, FolderDown, Library, Loader2, RotateCcw } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { areaCls, inputCls } from "@/components/brand/fields";
import { uploadFile } from "@/lib/api";
import type { BrandKit } from "@/lib/catalog/marketing";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { AdCanvas } from "./ad-canvas";
import { AD_LAYOUTS, exportName, themeFrom, type AdLayout } from "./layout";
import { downloadBlob, exportPng, type RenderInput } from "./render";
import { zipFiles } from "./zip";

export interface AdText {
  headline: string;
  body: string;
  cta: string;
}

/** Everything a creative needs to be drawn in one format. */
export function renderInput(o: { ratio: string; layout: AdLayout; text: AdText; brand?: BrandKit | null; image?: string | null; logo?: boolean; baked?: boolean }): RenderInput {
  return {
    ratio: o.ratio,
    layout: o.layout,
    content: { headline: o.text.headline, body: o.text.body || undefined, cta: o.text.cta || undefined, brand: o.brand?.name },
    theme: themeFrom(o.brand),
    image: o.image,
    logo: o.logo !== false ? (o.brand?.logo ?? null) : null,
    baked: o.baked,
  };
}

/** Download every format of a creative as a zip (or one PNG when there's a single format). */
export async function downloadFormats(base: { brand: string; product?: string; n: number }, inputs: RenderInput[]) {
  const files = await Promise.all(inputs.map(async (i) => ({ name: exportName(base.brand, base.product, String(i.ratio), base.n), data: new Uint8Array(await (await exportPng(i)).arrayBuffer()) })));
  if (files.length === 1) return downloadBlob(new Blob([files[0].data as BlobPart], { type: "image/png" }), files[0].name);
  downloadBlob(new Blob([zipFiles(files) as BlobPart], { type: "application/zip" }), exportName(base.brand, base.product, "all", base.n).replace(/-all-(\d+)\.png$/, "-$1.zip"));
}

/**
 * Edit a creative's words and layout and see every format change live; export PNGs (one format or
 * all, zipped) or save the composited image to the Library.
 */
export function AdEditor({
  open,
  onOpenChange,
  title,
  image,
  baked,
  ratios,
  initial,
  brand,
  productName,
  number = 1,
  onSaveText,
  onSaveToLibrary,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  image?: string | null;
  baked?: boolean;
  ratios: string[];
  initial: AdText & { layout?: AdLayout | null };
  brand?: BrandKit | null;
  productName?: string;
  number?: number;
  /** Persist edited words/layout (Ads Studio creatives). */
  onSaveText?: (t: AdText & { layout: AdLayout }) => void;
  /** Upload the PNG and record it (returns when saved). */
  onSaveToLibrary?: (url: string, ratio: string, text: AdText) => Promise<void>;
}) {
  const id = useId();
  const [text, setText] = useState<AdText>(initial);
  const [layout, setLayout] = useState<AdLayout>(initial.layout ?? "overlay");
  const [ratio, setRatio] = useState(ratios[0]);
  const [logo, setLogo] = useState(true);
  const [busy, setBusy] = useState<"" | "png" | "zip" | "save">("");
  const input = (r: string) => renderInput({ ratio: r, layout, text, brand, image, logo, baked });
  const changed = text.headline !== initial.headline || text.body !== initial.body || text.cta !== initial.cta || layout !== (initial.layout ?? "overlay");
  const close = (o: boolean) => {
    if (!o && changed && onSaveText) onSaveText({ ...text, layout });
    onOpenChange(o);
  };
  const base = { brand: brand?.name ?? "ad", product: productName, n: number };
  const run = async (what: "png" | "zip" | "save") => {
    setBusy(what);
    try {
      if (what === "png") await downloadFormats(base, [input(ratio)]);
      else if (what === "zip") await downloadFormats(base, ratios.map(input));
      else if (onSaveToLibrary) {
        const blob = await exportPng(input(ratio));
        const asset = await uploadFile(new File([blob], exportName(base.brand, base.product, ratio, base.n), { type: "image/png" }));
        await onSaveToLibrary(asset.url, ratio, text);
        toast.success("Saved to your library", { duration: 2000 });
      }
    } catch (e) {
      toastError(e);
    } finally {
      setBusy("");
    }
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[94svh] gap-0 overflow-y-auto p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="truncate pr-8">{title}</DialogTitle>
          <DialogDescription>{baked ? "This ad was drawn whole, words included — download it as is." : "Edit the words and layout; every format updates as you type."}</DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-5 p-5 md:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            {ratios.length > 1 && (
              <div role="tablist" aria-label="Format" className="mb-3 inline-flex rounded-full bg-muted p-0.5">
                {ratios.map((r) => (
                  <button key={r} role="tab" aria-selected={r === ratio} onClick={() => setRatio(r)} className={cn("h-7 rounded-full px-3 text-[12px] font-medium text-muted-foreground", r === ratio && "bg-background text-foreground shadow-soft")}>
                    {r}
                  </button>
                ))}
              </div>
            )}
            <div className="mx-auto" style={{ maxWidth: ratio === "9:16" ? 300 : ratio === "4:5" ? 380 : 440 }}>
              <AdCanvas input={input(ratio)} className="rounded-xl shadow-normal" label={`${title}, ${ratio}`} />
            </div>
          </div>
          {!baked ? (
            <div className="min-w-0 space-y-3">
              <label className="block space-y-1.5">
                <span className="text-[12px] font-medium text-muted-foreground">Headline</span>
                <input id={`${id}-h`} value={text.headline} onChange={(e) => setText({ ...text, headline: e.target.value })} maxLength={140} className={inputCls} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[12px] font-medium text-muted-foreground">Copy</span>
                <textarea value={text.body} onChange={(e) => setText({ ...text, body: e.target.value })} maxLength={400} rows={3} className={areaCls} />
              </label>
              <label className="block space-y-1.5">
                <span className="text-[12px] font-medium text-muted-foreground">Button</span>
                <input value={text.cta} onChange={(e) => setText({ ...text, cta: e.target.value })} maxLength={40} className={inputCls} placeholder="Shop now" />
              </label>
              <div>
                <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Layout</p>
                <div role="radiogroup" aria-label="Layout" className="grid grid-cols-2 gap-1.5">
                  {AD_LAYOUTS.map((l) => (
                    <button key={l.id} role="radio" aria-checked={layout === l.id} title={l.hint} onClick={() => setLayout(l.id)} className={cn("rounded-lg border px-2.5 py-2 text-left text-[12px] transition-colors hover:bg-accent", layout === l.id && "border-primary bg-brand-faint text-brand-text")}>
                      <span className="block font-medium">{l.name}</span>
                      <span className="line-clamp-1 text-[11px] text-muted-foreground">{l.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
              {brand?.logo && (
                <label className="flex items-center justify-between gap-2 text-[13px]">
                  Show logo <Switch checked={logo} onCheckedChange={setLogo} aria-label="Show logo" />
                </label>
              )}
              {changed && (
                <button type="button" onClick={() => (setText({ headline: initial.headline, body: initial.body, cta: initial.cta }), setLayout(initial.layout ?? "overlay"))} className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
                  <RotateCcw className="size-3" /> Undo changes
                </button>
              )}
            </div>
          ) : (
            <div />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3">
          {onSaveToLibrary && (
            <Button variant="ghost" onClick={() => void run("save")} disabled={!!busy || !image}>
              {busy === "save" ? <Loader2 className="animate-spin" /> : <Library />} Save to library
            </Button>
          )}
          {ratios.length > 1 && (
            <Button variant="outline" onClick={() => void run("zip")} disabled={!!busy}>
              {busy === "zip" ? <Loader2 className="animate-spin" /> : <FolderDown />} All formats
            </Button>
          )}
          <Button onClick={() => void run("png")} disabled={!!busy}>
            {busy === "png" ? <Loader2 className="animate-spin" /> : <Download />} Download {ratio}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
