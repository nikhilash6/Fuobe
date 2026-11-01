"use client";

import { ImagePlus, Library, Loader2, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LibraryGrid } from "@/components/studio/media-slot";
import { uploadFile } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";

/** Upload files as images; resolves the /api/files URLs (bad files are skipped with a toast). */
export async function uploadImages(files: File[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of files) {
    if (!f.type.startsWith("image/")) {
      toast(`${f.name} isn't an image`);
      continue;
    }
    if (f.size > 32 * 1024 * 1024) {
      toast("An image is over 32 MB. Use a smaller one.");
      continue;
    }
    try {
      out.push((await uploadFile(f)).url);
    } catch (e) {
      toastError(e);
    }
  }
  return out;
}

/** A row of pictures with add (upload or library), remove and "first is the hero". */
export function ImageList({ value, onChange, max = 8, label = "Add image", heroLabel, size = "md" }: { value: string[]; onChange: (v: string[]) => void; max?: number; label?: string; heroLabel?: string; size?: "sm" | "md" }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const [lib, setLib] = useState(false);
  const dim = size === "sm" ? "size-14" : "size-20";
  const add = async (files: File[]) => {
    const room = max - value.length;
    if (room <= 0) return void toast(`Up to ${max} images`);
    setBusy(Math.min(room, files.length));
    const urls = await uploadImages(files.slice(0, room));
    setBusy(0);
    if (urls.length) onChange([...value, ...urls].slice(0, max));
  };
  return (
    <div
      className="flex flex-wrap gap-2"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void add([...e.dataTransfer.files]);
      }}
    >
      {value.map((src, i) => (
        <div key={src} className={cn("group/img relative shrink-0 overflow-hidden rounded-xl bg-muted", dim)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="size-full object-cover" />
          {i === 0 && heroLabel && <span className="absolute inset-x-0 bottom-0 bg-black/50 py-0.5 text-center text-[10px] font-medium text-white">{heroLabel}</span>}
          {i > 0 && heroLabel && (
            <button type="button" onClick={() => onChange([src, ...value.filter((x) => x !== src)])} className="absolute inset-x-0 bottom-0 bg-black/50 py-0.5 text-[10px] font-medium text-white opacity-100 sm:opacity-0 sm:group-hover/img:opacity-100 focus-visible:opacity-100">
              Make first
            </button>
          )}
          <button type="button" aria-label="Remove image" onClick={() => onChange(value.filter((x) => x !== src))} className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-black/55 text-white opacity-100 sm:opacity-0 sm:group-hover/img:opacity-100 focus-visible:opacity-100">
            <X className="size-3" />
          </button>
        </div>
      ))}
      {Array.from({ length: busy }, (_, i) => (
        <div key={`b${i}`} className={cn("grid shrink-0 place-items-center rounded-xl bg-muted", dim)}>
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ))}
      {value.length + busy < max && (
        <div className={cn("relative flex shrink-0 flex-col overflow-hidden rounded-xl border border-dashed border-border-strong", dim)}>
          <button type="button" onClick={() => input.current?.click()} className="flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] text-muted-foreground hover:bg-brand-faint hover:text-brand-text">
            <ImagePlus className="size-4" />
            {size === "md" && label}
          </button>
          <Popover open={lib} onOpenChange={setLib}>
            <PopoverTrigger asChild>
              <button type="button" className="flex h-5 items-center justify-center gap-1 border-t border-dashed border-border-strong text-[10px] text-muted-foreground hover:bg-brand-faint hover:text-brand-text" aria-label="Choose from library">
                <Library className="size-3" />
                {size === "md" && "Library"}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-2" align="start" collisionPadding={12}>
              <p className="px-1 pb-2 text-[13px] font-medium">From your library</p>
              {lib && (
                <LibraryGrid
                  kinds={["image"]}
                  onPick={(v) => {
                    if (!value.includes(v.ref)) onChange([...value, v.ref].slice(0, max));
                    setLib(false);
                  }}
                />
              )}
            </PopoverContent>
          </Popover>
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            onChange={(e) => {
              void add([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>
      )}
    </div>
  );
}
