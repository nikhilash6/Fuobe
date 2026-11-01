"use client";

import { Check, ImagePlus, Library, Loader2, Plus, Upload, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LibraryGrid } from "@/components/studio/media-slot";
import { uploadFile, useEngine, useStatus } from "@/lib/api";
import type { RGB } from "@/lib/catalog/palettes";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { useMoodboardActions } from "./hooks";
import { loadImage, pixelsOf, renderCollages } from "./images";
import { colorFeature, COPY, imageProblem, moodboardError, MOODBOARD_LIMITS, representativeOrder, suggestMoodboardName, type Moodboard } from "./logic";
import { placeholdersOn } from "@/lib/demo-mode";

interface Item {
  id: string;
  /** Duplicate check: the file's name/size/date, or the library URL. */
  key: string;
  preview: string;
  url?: string;
  uploading: boolean;
  pixels: RGB[];
}

/** Bad / Good / Perfect: how far the board is from the recommended 20+ photos. */
function quality(n: number): { label: string; tone: string; pct: number } {
  if (n < MOODBOARD_LIMITS.min) return { label: "Bad", tone: "bg-destructive", pct: (n / 20) * 100 };
  if (n < 20) return { label: "Good", tone: "bg-warning", pct: (n / 20) * 100 };
  return { label: "Perfect", tone: "bg-success", pct: 100 };
}

/**
 * "Create your moodboard": 5–80 images of one style (≥256 px, no duplicates), a name (suggested from
 * the board's colours), then the board is ordered by how representative each image is, its 2×2
 * collages are drawn in the browser, and the server starts the cover job.
 */
export function CreateMoodboardDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (m: Moodboard) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [engine] = useEngine();
  const status = useStatus();
  const [over, setOver] = useState(false);
  const { create } = useMoodboardActions();
  const keys = useRef(new Set<string>());

  // Closing throws the draft away.
  const setOpen = (o: boolean) => {
    if (!o) {
      setItems((xs) => {
        xs.forEach((x) => x.preview.startsWith("blob:") && URL.revokeObjectURL(x.preview));
        return [];
      });
      keys.current = new Set();
      setName("");
    }
    onOpenChange(o);
  };

  const suggestion = useMemo(() => {
    const pooled = items.flatMap((i) => i.pixels.slice(0, 400));
    return pooled.length ? suggestMoodboardName(pooled) : "";
  }, [items]);

  const add = async (src: { file?: File; url?: string; key: string }) => {
    if (keys.current.size >= MOODBOARD_LIMITS.max) return toast(COPY.tooMany);
    const preview = src.file ? URL.createObjectURL(src.file) : src.url!;
    let img: HTMLImageElement;
    try {
      img = await loadImage(preview);
    } catch {
      if (src.file) URL.revokeObjectURL(preview);
      return toast.error("That file isn't an image we can read — try PNG or JPG");
    }
    const problem = imageProblem({ width: img.naturalWidth, height: img.naturalHeight, key: src.key }, [...keys.current]);
    if (problem) {
      if (src.file) URL.revokeObjectURL(preview);
      return toast(problem, { id: problem });
    }
    keys.current.add(src.key);
    const id = nanoid(8);
    setItems((xs) => [...xs, { id, key: src.key, preview, url: src.url, uploading: !src.url, pixels: pixelsOf(img) }]);
    if (!src.file) return;
    try {
      const asset = await uploadFile(src.file);
      setItems((xs) => xs.map((x) => (x.id === id ? { ...x, url: asset.url, uploading: false } : x)));
    } catch (e) {
      keys.current.delete(src.key);
      setItems((xs) => xs.filter((x) => x.id !== id));
      toastError(e, "Upload failed");
    }
  };
  const addFiles = (files: Iterable<File>) => {
    for (const f of files) if (/^image\/(png|jpe?g|webp)$/.test(f.type)) void add({ file: f, key: `${f.name}:${f.size}:${f.lastModified}` });
  };
  const remove = (it: Item) => {
    keys.current.delete(it.key);
    if (it.preview.startsWith("blob:")) URL.revokeObjectURL(it.preview);
    setItems((xs) => xs.filter((x) => x.id !== it.id));
  };

  const submit = async () => {
    const finalName = (name.trim() || suggestion).trim();
    const err = moodboardError({ name: finalName, images: items.map((i) => i.id) });
    if (err) return toast(err, { id: "moodboard-error" });
    if (items.some((i) => i.uploading)) return toast("Wait for the uploads to finish");
    setBusy(true);
    try {
      // Most representative first: the first 10 go to Recraft / cloud style references, 8 into the collages.
      const order = representativeOrder(items.map((i) => colorFeature(i.pixels)));
      const urls = order.map((i) => items[i].url!);
      const collages = await Promise.all((await renderCollages(urls)).map((b, i) => uploadFile(new File([b], `collage-${i + 1}.jpg`, { type: "image/jpeg" })).then((a) => a.url)));
      const m = await create.mutateAsync({ name: finalName.slice(0, MOODBOARD_LIMITS.nameMax), images: urls, collages, engine });
      toast.success("Moodboard created");
      onCreated?.(m);
      setOpen(false);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const q = quality(items.length);
  // "Upload from assets": the Library's images, before and after the first one is added.
  const assets = (
    <Popover open={libraryOpen} onOpenChange={setLibraryOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <Library /> Upload from assets
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" collisionPadding={12}>
        <p className="px-1 pb-2 text-[12.5px] text-muted-foreground">Use images you&apos;ve already created</p>
        {libraryOpen && <LibraryGrid kinds={["image"]} onPick={(v) => void add({ url: v.ref, key: v.ref })} />}
      </PopoverContent>
    </Popover>
  );
  // What making the board does on this engine, and what it costs (the cloud cover job is a Recraft V4 Styles run).
  const n = Math.min(items.length, MOODBOARD_LIMITS.refs);
  const st = status.data;
  const fal = !!st?.providers.fal?.configured;
  const demo = placeholdersOn(st?.demoMode);
  const how =
    engine === "open"
      ? `Open source: collages for Qwen-Image-Edit from the ${n} most representative images`
      : !st
        ? `Cloud: a Recraft style from the ${n} most representative images`
        : demo
          ? `Cloud: a Recraft style from the ${n} most representative images · demo, free`
          : fal
            ? `Cloud: Recraft V4 Styles saves a style and draws the cover from the ${n} most representative images · ≈ $0.04 on fal`
            : `Cloud: no fal key, so no saved Recraft style — the ${n} most representative images are used as references`;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-h-[92svh] gap-3 overflow-y-auto sm:max-w-2xl"
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.length) {
            e.preventDefault();
            addFiles(files);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle className="font-sans text-[15px] font-semibold tracking-wide">{COPY.title}</DialogTitle>
          <DialogDescription>{COPY.subtitle}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 text-[12.5px] sm:grid-cols-2">
          <p className="rounded-lg bg-success/10 px-3 py-2">
            <span className="font-medium">Recommended</span> · {COPY.recommended}
          </p>
          <p className="rounded-lg bg-destructive/10 px-3 py-2">
            <span className="font-medium">Avoid</span> · {COPY.avoid}
          </p>
        </div>

        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => (addFiles(e.target.files ?? []), (e.target.value = ""))} />
        <div
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            addFiles(e.dataTransfer.files);
          }}
          className={cn("rounded-xl transition-colors", over && "bg-brand-faint ring-2 ring-primary/50")}
        >
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-8 text-center">
              <ImagePlus className="size-7 text-muted-foreground" />
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="sm" onClick={() => input.current?.click()}>
                  <Upload /> Upload from device
                </Button>
                {assets}
              </div>
              <p className="text-[12px] text-muted-foreground">PNG, JPG or Paste from clipboard</p>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
              {items.map((it, i) => (
                <div key={it.id} className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.preview} alt="" className="size-full object-cover" />
                  {it.uploading && (
                    <span className="absolute inset-0 grid place-items-center bg-background/60" role="status" aria-label="Uploading">
                      <Loader2 className="size-4 animate-spin" />
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => remove(it)}
                    aria-label={`Remove image ${i + 1}`}
                    className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full bg-foreground/80 text-background"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
              {items.length < MOODBOARD_LIMITS.max && (
                <button
                  type="button"
                  onClick={() => input.current?.click()}
                  className="grid aspect-square place-items-center rounded-lg border border-dashed text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Add image"
                >
                  <span className="flex flex-col items-center gap-1 text-[11.5px]">
                    <Plus className="size-4" /> Add image
                  </span>
                </button>
              )}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex min-w-40 flex-1 items-center gap-2">
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span className={cn("block h-full rounded-full transition-[width]", q.tone)} style={{ width: `${q.pct}%` }} />
              </span>
              <span className="text-[12px] font-medium tabular-nums">
                {q.label} · {items.length}/{MOODBOARD_LIMITS.max}
              </span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => input.current?.click()}>
                <Upload /> Upload more
              </Button>
              {assets}
            </div>
          </div>
        )}

        <label className="space-y-1">
          <span className="text-[12.5px] font-medium">{COPY.nameLabel}</span>
          <Input value={name} maxLength={MOODBOARD_LIMITS.nameMax + 20} placeholder={suggestion || COPY.namePlaceholder} onChange={(e) => setName(e.target.value)} />
          {suggestion && !name && (
            <button type="button" onClick={() => setName(suggestion)} className="inline-flex items-center gap-1 text-[12px] text-brand-text hover:underline">
              <Check className="size-3" /> Use “{suggestion}”
            </button>
          )}
        </label>

        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] text-muted-foreground">{items.length < MOODBOARD_LIMITS.min ? COPY.tooFew : how}</p>
          <Button onClick={submit} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} Create moodboard
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
