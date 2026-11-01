"use client";

import { ImagePlus, Loader2, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { uploadFile } from "@/lib/api";
import { SHORTS, type ShortsCustomPreset } from "@/lib/catalog/shorts";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { usePresetActions } from "./hooks";

interface Ref {
  id: string;
  preview: string;
  url?: string;
  uploading?: boolean;
}

/** "Create a preset from references": up to 10 images of the look; a name and a few words are optional. */
export function CustomPresetDialog({
  open,
  onOpenChange,
  preset,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Edit this one (else create). */
  preset?: ShortsCustomPreset;
  onSaved: (p: ShortsCustomPreset) => void;
}) {
  const ids = useId();
  const actions = usePresetActions();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [refs, setRefs] = useState<Ref[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  // Start from the preset being edited (or empty) each time the dialog opens.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const key = open ? (preset?.id ?? "new") : null;
  if (key !== openedFor) {
    setOpenedFor(key);
    if (key) {
      setName(preset?.name ?? "");
      setDescription(preset?.description ?? "");
      setRefs((preset?.references ?? []).map((url, i) => ({ id: `${i}-${url}`, preview: url, url })));
    }
  }

  // Object URLs of local previews are released when they leave the list or the dialog closes.
  const previews = useRef(new Set<string>());
  useEffect(() => {
    const set = previews.current;
    return () => set.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const add = (files: File[]) => {
    const room = SHORTS.maxReferences - refs.length;
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length < files.length) toast("Only images can be references");
    if (images.length > room) toast(`A preset takes up to ${SHORTS.maxReferences} images`);
    for (const f of images.slice(0, Math.max(0, room))) {
      const local = URL.createObjectURL(f);
      previews.current.add(local);
      const id = `${Date.now()}-${Math.random()}`;
      setRefs((xs) => [...xs, { id, preview: local, uploading: true }]);
      uploadFile(f)
        .then((a) => setRefs((xs) => xs.map((r) => (r.id === id ? { ...r, url: a.url, uploading: false } : r))))
        .catch((e) => {
          toastError(e);
          setRefs((xs) => xs.filter((r) => r.id !== id));
        });
    }
  };

  const uploading = refs.some((r) => r.uploading);
  const ready = refs.filter((r) => r.url).map((r) => r.url!);
  const busy = actions.create.isPending || actions.update.isPending || actions.remove.isPending;

  const save = () => {
    if (!ready.length) return void toast("Add at least one reference image");
    const body = { name: name.trim() || undefined, description: description.trim(), references: ready };
    const done = (p: ShortsCustomPreset) => {
      toast.success(preset ? "Preset updated" : "Preset created");
      onSaved(p);
      onOpenChange(false);
    };
    const fail = (e: Error) => toastError(e);
    if (preset) actions.update.mutate({ id: preset.id, ...body }, { onSuccess: done, onError: fail });
    else actions.create.mutate(body, { onSuccess: done, onError: fail });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{preset ? "Edit preset" : "Create a preset from references"}</DialogTitle>
          <DialogDescription>Add reference images that show the look you want. The preset learns the style from them.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              add([...e.dataTransfer.files]);
            }}
            className={cn("grid grid-cols-4 gap-1.5 rounded-xl border border-dashed p-2 sm:grid-cols-5", over && "border-primary bg-brand-faint")}
          >
            {refs.map((r) => (
              <div key={r.id} className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.preview} alt="" className="size-full object-cover" />
                {r.uploading && (
                  <span className="absolute inset-0 grid place-items-center bg-background/60" role="status" aria-label="Uploading">
                    <Loader2 className="size-4 animate-spin" />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setRefs((xs) => xs.filter((x) => x.id !== r.id))}
                  aria-label="Remove this reference"
                  className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-foreground/80 text-background"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            {refs.length < SHORTS.maxReferences && (
              <button
                type="button"
                onClick={() => input.current?.click()}
                className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-strong text-muted-foreground hover:border-primary hover:bg-brand-faint hover:text-brand-text"
              >
                <ImagePlus className="size-4" />
                <span className="text-[10px] font-medium">Add</span>
              </button>
            )}
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              hidden
              onChange={(e) => {
                add([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
          </div>
          <p className="text-[12px] text-muted-foreground">
            {refs.length} of {SHORTS.maxReferences} · stills or frames of shorts in the look you like work best
          </p>
          <div className="space-y-1.5">
            <label htmlFor={`${ids}-name`} className="text-[13px] font-medium">
              Name
            </label>
            <input
              id={`${ids}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              placeholder="Warm slow look"
              className="h-9 w-full rounded-lg border bg-background px-3 text-[14px] outline-none placeholder:text-subtle-foreground focus:border-primary focus:ring-4 focus:ring-brand-faint"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={`${ids}-desc`} className="text-[13px] font-medium">
              Describe the look <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id={`${ids}-desc`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="e.g. “grainy 16 mm film, warm faded colours, soft halation”"
              className="w-full resize-none rounded-lg border bg-background px-3 py-2 text-[14px] outline-none placeholder:text-subtle-foreground focus:border-primary focus:ring-4 focus:ring-brand-faint"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {preset ? (
            <Button
              variant="ghost"
              className="text-destructive"
              disabled={busy}
              onClick={() =>
                actions.remove.mutate(preset.id, {
                  onSuccess: () => {
                    toast("Preset deleted");
                    onOpenChange(false);
                  },
                  onError: (e) => toastError(e),
                })
              }
            >
              <Trash2 /> Delete
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={save} disabled={busy || uploading || !ready.length} className="rounded-full">
            {busy && <Loader2 className="animate-spin" />}
            {uploading ? "Uploading…" : preset ? "Update preset" : "Create preset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
