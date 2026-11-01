"use client";

import { ArrowLeft, ImagePlus, Loader2, Palette as PaletteIcon, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { SelfHostNote } from "@/components/self-host-note";
import { uploadFile, useIsVisitor } from "@/lib/api";
import { MAX_SOURCE_IMAGES, NAME_MAX, suggestName, type Palette, type PalettePick } from "@/lib/catalog/palettes";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { extractFromFiles } from "./extract";
import { usePaletteActions, usePalettes } from "./hooks";
import { PaletteCard, Strip } from "./palette-card";
import { manualDraft, PaletteEditor, type PaletteDraft } from "./palette-editor";

export const toPalettePick = (p: Palette, lock?: boolean): PalettePick => ({ id: p.id, name: p.name, colors: p.colors, background: p.background, slug: p.slug, thumb: p.thumb, lock });

type View = "list" | "create" | "images" | "manual";

/** Upload & Create: review the photos, extract their colours (in a worker), name the palette, save. */
function FromImages({ files, setFiles, onSaved }: { files: File[]; setFiles: (f: File[]) => void; onSaved: (p: Palette) => void }) {
  // The extraction result belongs to the exact list of files it was made from.
  const [done, setDone] = useState<{ files: File[]; colors: string[]; background: string | null; name: string } | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const { create } = usePaletteActions();
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  // Previews of a replaced list are released (not on unmount: React's dev double-mount would revoke the live ones).
  const shown = useRef<string[]>([]);
  useEffect(() => {
    const old = shown.current;
    shown.current = urls;
    if (old !== urls) old.forEach((u) => URL.revokeObjectURL(u));
  }, [urls]);
  useEffect(() => {
    if (!files.length) return;
    let live = true;
    extractFromFiles(files)
      .then((r) => live && setDone({ files, ...r }))
      .catch((e) => {
        if (!live) return;
        setDone({ files, colors: [], background: null, name: "" });
        toastError(e);
      });
    return () => {
      live = false;
    };
  }, [files]);
  const result = done?.files === files ? done : null;
  const extracting = !result && files.length > 0;

  const save = async () => {
    if (!result?.colors.length) return;
    setSaving(true);
    try {
      // The first photo becomes the card's picture.
      const thumb = await uploadFile(files[0]).then((a) => a.url).catch(() => null);
      const p = await create.mutateAsync({ name: (name || result.name).trim().slice(0, NAME_MAX), colors: result.colors, background: result.background, source: "images", thumb });
      toast.success("Palette saved");
      onSaved(p);
    } catch (e) {
      toastError(e, "Failed to save palette");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-4 gap-1.5">
        {files.map((f, i) => (
          <div key={`${f.name}-${i}`} className="relative aspect-square overflow-hidden rounded-md bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={urls[i]} alt="" className="size-full object-cover" />
            <button
              type="button"
              aria-label={`Remove image ${i + 1}`}
              onClick={() => setFiles(files.filter((x) => x !== f))}
              className="absolute top-0.5 right-0.5 grid size-5 place-items-center rounded-full bg-foreground/80 text-background"
            >
              <X className="size-3" />
            </button>
          </div>
        ))}
      </div>
      <div className="space-y-1.5">
        <p className="text-[12.5px] font-medium">Colors</p>
        {extracting || !result ? (
          <div className="flex h-8 items-center gap-2 rounded-md bg-muted px-2 text-[12px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Extracting colors from your images…
          </div>
        ) : (
          <Strip colors={result.colors} className="h-8 rounded-md ring-1 ring-foreground/10" />
        )}
      </div>
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1 space-y-1">
          <span className="text-[12px] text-muted-foreground">Name</span>
          <Input value={name} maxLength={NAME_MAX} placeholder={result?.name || "Looking for name..."} onChange={(e) => setName(e.target.value)} className="h-8" aria-label="Enter palette name" />
        </label>
        <Button size="sm" className="h-8" disabled={!result?.colors.length || extracting || saving} onClick={save}>
          {saving && <Loader2 className="animate-spin" />} Save
        </Button>
      </div>
    </div>
  );
}

/**
 * The Color signature panel: saved palettes (yours, then Cinema Studio's 50) as cards, Upload &
 * Create (colours extracted from up to 20 photos) and Pick colors manually.
 */
export function ColorSignaturePanel({
  value,
  onPick,
  engine,
  lockByDefault = false,
}: {
  value?: PalettePick;
  onPick: (p?: PalettePick) => void;
  engine: "cloud" | "open";
  /** The model locks the colours unless it's turned off (Fuobe Soul's HEX on the open engine). */
  lockByDefault?: boolean;
}) {
  const { items, isLoading } = usePalettes();
  const { create, remove } = usePaletteActions();
  // A guest or a free account: the Cinema palettes only (saving one of its own is refused).
  const visitor = useIsVisitor();
  const [view, setView] = useState<View>("list");
  const [files, setFiles] = useState<File[]>([]);
  const [draft, setDraft] = useState<PaletteDraft>(manualDraft);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [compact, setCompact] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const mine = items?.filter((p) => p.source !== "builtin") ?? [];
  const builtins = items?.filter((p) => p.source === "builtin") ?? [];

  const back = () => (view === "images" && files.length ? setConfirmLeave(true) : setView(view === "list" ? "list" : view === "create" ? "list" : "create"));
  const pickFiles = (list: FileList | null) => {
    const imgs = [...(list ?? [])].filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
    if (!imgs.length) return toast("Pick JPEG, PNG or WebP photos");
    if (imgs.length > MAX_SOURCE_IMAGES) toast(`Up to ${MAX_SOURCE_IMAGES} photos — using the first ${MAX_SOURCE_IMAGES}`);
    setFiles(imgs.slice(0, MAX_SOURCE_IMAGES));
    setView("images");
  };

  const header = view !== "list" && (
    <div className="mb-3 flex items-center gap-2">
      <button type="button" onClick={back} aria-label="Back" className="grid size-7 place-items-center rounded-full hover:bg-accent">
        <ArrowLeft className="size-4" />
      </button>
      <p className="text-[13px] font-medium">{view === "create" ? "Upload photo or create manually to continue" : view === "images" ? "Create from your photos" : "Create manually to continue"}</p>
    </div>
  );

  return (
    <div className="min-w-0">
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => (pickFiles(e.target.files), (e.target.value = ""))} />
      {header}
      {view === "list" && (
        <>
          <div className={cn("mb-3 rounded-xl bg-brand-faint p-3 transition-all", compact && "flex items-center gap-2 p-2")}>
            {!compact && (
              <>
                <p className="text-[14px] font-semibold text-brand-text">Control your colors</p>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                  {visitor ? "Pick a Cinema palette below and bring its colors into your image." : "Upload a reference image and bring its colors into your own style."}
                </p>
              </>
            )}
            {compact && (
              <p className="min-w-0 flex-1 truncate text-[12px] text-muted-foreground">
                {visitor ? "Pick a Cinema palette to use its colors." : "Upload a reference image to create your color signature."}
              </p>
            )}
            {/* Saving a palette is a library change, which only the owner makes here (the server refuses it). */}
            {!visitor && (
              <Button size="sm" className={cn("h-8", !compact && "mt-2")} onClick={() => setView("create")}>
                <Upload /> Upload &amp; Create
              </Button>
            )}
          </div>
          {/* The lock is a second run on the studio's own ComfyUI, which a visitor's request never asks for. */}
          {engine === "open" && value && !visitor && (
            <label className="mb-3 flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-[12.5px]">
              <span>
                Lock the colors after generating
                <span className="block text-[11.5px] text-muted-foreground">Keeps each image to the palette&apos;s colors after it&apos;s made</span>
              </span>
              <Switch checked={value.lock ?? lockByDefault} onCheckedChange={(lock) => onPick({ ...value, lock })} aria-label="Lock the colors after generating" />
            </label>
          )}
          <div className="max-h-[52svh] space-y-4 overflow-y-auto pr-0.5 sm:max-h-[360px]" onScroll={(e) => setCompact(e.currentTarget.scrollTop > 24)}>
            <section>
              <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Your palettes</p>
              {visitor ? (
                <div className="rounded-lg border border-dashed p-4 text-center">
                  <SelfHostNote className="text-[12px]">Saving palettes isn&apos;t available here.</SelfHostNote>
                </div>
              ) : isLoading ? (
                <div className="grid grid-cols-2 gap-2">
                  <Skeleton className="aspect-video" />
                  <Skeleton className="aspect-video" />
                </div>
              ) : mine.length ? (
                <div className="grid grid-cols-2 gap-2">
                  {mine.map((p) => (
                    <PaletteCard
                      key={p.id}
                      palette={p}
                      selected={value?.id === p.id}
                      onSelect={() => onPick(value?.id === p.id ? undefined : toPalettePick(p, value?.lock))}
                      onDelete={() =>
                        remove.mutate(p.id, {
                          onSuccess: () => {
                            if (value?.id === p.id) onPick(undefined);
                            toast("Palette deleted");
                          },
                          onError: (e) => toastError(e),
                        })
                      }
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-4 text-center">
                  <p className="text-[13px] font-medium">Ready to create your color signature?</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">Saved palettes will appear here. No palettes yet — upload an image to begin.</p>
                </div>
              )}
            </section>
            {builtins.length > 0 && (
              <section>
                <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Cinema palettes</p>
                <div className="grid grid-cols-2 gap-2">
                  {builtins.map((p) => (
                    <PaletteCard key={p.id} palette={p} selected={value?.id === p.id} onSelect={() => onPick(value?.id === p.id ? undefined : toPalettePick(p, value?.lock))} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </>
      )}
      {view === "create" && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => input.current?.click()} className="flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-colors hover:bg-accent">
            <ImagePlus className="size-5 text-brand-text" />
            <span className="text-[13px] font-medium">Upload from device</span>
            <span className="text-[11.5px] text-muted-foreground">JPEG, PNG or WebP · up to {MAX_SOURCE_IMAGES} photos, 1 is enough</span>
          </button>
          <button type="button" onClick={() => setView("manual")} className="flex flex-col items-start gap-2 rounded-xl border p-3 text-left transition-colors hover:bg-accent">
            <PaletteIcon className="size-5 text-brand-text" />
            <span className="text-[13px] font-medium">Pick colors manually</span>
            <span className="text-[11.5px] text-muted-foreground">Up to 12 colors, a background, random starters</span>
          </button>
        </div>
      )}
      {view === "images" && (
        <FromImages
          files={files}
          setFiles={(f) => (f.length ? setFiles(f) : (setFiles([]), setView("create")))}
          onSaved={(p) => {
            setFiles([]);
            setView("list");
            onPick(toPalettePick(p, value?.lock));
          }}
        />
      )}
      {view === "manual" && (
        <PaletteEditor
          value={draft}
          onChange={setDraft}
          saving={create.isPending}
          onSave={() =>
            create.mutate(
              { name: (draft.name || "").trim() || suggestNameFor(draft), colors: draft.colors, background: draft.background, source: "manual" },
              {
                onSuccess: (p) => {
                  toast.success("Palette saved");
                  setDraft(manualDraft());
                  setView("list");
                  onPick(toPalettePick(p, value?.lock));
                },
                onError: (e) => toastError(e, "Failed to save palette"),
              },
            )
          }
        />
      )}
      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>Your uploaded photos will be lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, keep them</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setFiles([]);
                setView("create");
              }}
            >
              Yes, discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const suggestNameFor = (d: PaletteDraft) => suggestName(d.colors, d.background);
