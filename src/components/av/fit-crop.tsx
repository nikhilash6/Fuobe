"use client";

import { Crop, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SlotValue } from "@/components/studio/media-slot";
import { useAskBeforeUpload, useIsGuest } from "@/lib/api";
import { postFile } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { cropFor } from "@/lib/av/crop-fit";
import { fitImage } from "./fit-image";
import { useUploadSwitches } from "./use-upload-switches";

/**
 * The fitting step on a picture slot whose tool takes only some shapes (H3 Max lip sync: 0.4:1 tall to 2.5:1 wide): a
 * picture outside them gets a crop offered, the nearest shape the tool takes, which the person slides into place. The
 * crop is made in this browser and uploaded as a new file. Cancel (or the owner's "Offer a crop" switch off) keeps the
 * picture, and the tool's own check says why it can't take it.
 */

export interface CropRule {
  /** The tool's name in the line. */
  tool: string;
  /** The shapes it takes, width ÷ height. */
  ratio: [min: number, max: number];
}

type Offer = { ref: string; name?: string; width: number; height: number; stored: SlotValue };

function pictureSize(src: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export function useCropFit({ rule, value, setValue }: { rule: CropRule | null; value: SlotValue | null | undefined; setValue: (v: SlotValue | null) => void }) {
  const sw = useUploadSwitches();
  const on = !!rule && sw.photoCrop;
  const guest = useIsGuest();
  const askFirst = useAskBeforeUpload();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const offered = useRef(new Set<string>());
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
  });

  const ref = on && value && !value.uploading && !value.held && value.ref.startsWith("/api/files/") ? value.ref : undefined;
  useEffect(() => {
    if (!rule || !ref || guest || offered.current.has(ref) || made === ref) return;
    let gone = false;
    void pictureSize(ref).then((size) => {
      if (gone || !size || latest.current?.ref !== ref || !cropFor(size.width, size.height, rule.ratio)) return;
      offered.current.add(ref);
      setOffer({ ref, name: latest.current.name, ...size, stored: latest.current });
    });
    return () => {
      gone = true;
    };
  }, [rule, ref, guest, made]);

  const offerGone = !!offer && value?.ref !== offer.ref;
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (offerGone) setOffer(null);
  }

  const use = useCallback(
    async (crop: { x: number; y: number; width: number; height: number }) => {
      if (!offer || askFirst()) return;
      const o = offer;
      setOffer(null);
      setError(null);
      setBusy(true);
      setValue({ ...o.stored, uploading: true });
      try {
        const res = await fetch(o.ref);
        if (!res.ok) throw new Error("We couldn't open the picture to crop it. Add it again");
        const out = await fitImage(await res.blob(), { name: o.name, crop, keepAlpha: false, maxPixels: 40_000_000, maxBytes: 25 * 1024 * 1024 });
        const asset = await postFile(out.file);
        if (latest.current?.ref !== o.ref) return;
        setValue({ ref: asset.url, preview: asset.url, kind: asset.kind ?? "image", name: out.file.name, source: "upload" });
        setMade(asset.url);
      } catch (e) {
        setValue({ ...o.stored, uploading: false });
        setError((e as Error).message || "We couldn't crop the picture here. Crop it in another app and add it again");
      } finally {
        setBusy(false);
      }
    },
    [offer, askFirst, setValue],
  );

  const shown = offer && !offerGone && on ? offer : null;
  const line = busy ? "Cropping the picture…" : (error ?? (made && value?.ref === made && rule ? `Cropped for ${rule.tool}` : null));
  return { on, busy, line, failedNow: !!error && !busy, offer: shown && rule ? { ...shown, rule, use: (c: Parameters<typeof use>[0]) => void use(c), cancel: () => setOffer(null) } : null };
}

/** The picture with the crop to slide into place, and Use this crop / Cancel. */
function CropPicker({ o }: { o: NonNullable<ReturnType<typeof useCropFit>["offer"]> }) {
  const base = cropFor(o.width, o.height, o.rule.ratio)!;
  const tall = base.height < o.height;
  const room = tall ? o.height - base.height : o.width - base.width;
  const [at, setAt] = useState(tall ? base.y : base.x);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; at: number } | null>(null);
  const crop = tall ? { ...base, y: at } : { ...base, x: at };
  const pos = (n: number, of: number) => `${(n / of) * 100}%`;
  const scale = () => {
    const r = box.current?.getBoundingClientRect();
    return r ? (tall ? o.height / r.height : o.width / r.width) : 1;
  };
  const clamp = (n: number) => Math.round(Math.min(room, Math.max(0, n)));
  const line = `This picture is ${o.width}×${o.height}. ${o.rule.tool} takes ${o.rule.ratio[0]}:1 (tall) to ${o.rule.ratio[1]}:1 (wide): slide the crop to the part to use`;
  return (
    <div className="space-y-3 rounded-2xl border bg-card p-3 text-foreground shadow-sm sm:p-4" data-crop-picker>
      <p className="text-[13px] leading-snug">{line}</p>
      <div
        ref={box}
        className="relative mx-auto max-h-[46vh] touch-none overflow-hidden rounded-xl bg-muted select-none"
        style={{ aspectRatio: `${o.width} / ${o.height}`, maxWidth: `min(100%, calc(46vh * ${o.width / o.height}))` }}
        onPointerDown={(e) => {
          drag.current = { y: tall ? e.clientY : e.clientX, at };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setAt(clamp(d.at + ((tall ? e.clientY : e.clientX) - d.y) * scale()));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={o.ref} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />
        <div
          role="slider"
          tabIndex={0}
          aria-label="Where the crop sits"
          aria-valuemin={0}
          aria-valuemax={room}
          aria-valuenow={at}
          onKeyDown={(e) => {
            const step = (e.shiftKey ? 0.1 : 0.02) * room * (e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : 0);
            if (!step) return;
            e.preventDefault();
            setAt(clamp(at + step));
          }}
          className="absolute cursor-grab rounded-lg border-[3px] border-primary shadow-[0_0_0_9999px_rgb(0_0_0/0.55)] outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          style={{ left: pos(crop.x, o.width), top: pos(crop.y, o.height), width: pos(crop.width, o.width), height: pos(crop.height, o.height) }}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => o.use(crop)}
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-foreground px-4 text-[14px] font-medium text-background sm:flex-none"
        >
          <Crop className="size-4" />
          Use this crop
        </button>
        <button type="button" onClick={o.cancel} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-4 text-[14px] font-medium hover:bg-accent">
          <X className="size-4" />
          Cancel
        </button>
      </div>
    </div>
  );
}

export function FitCropNote({ fit, className }: { fit: ReturnType<typeof useCropFit>; className?: string }) {
  if (!fit.line && !fit.offer) return null;
  return (
    <div className={cn("space-y-1.5 pb-2 text-xs text-muted-foreground", className)}>
      {fit.line && (
        <p role="status" className={cn("flex items-center gap-1.5", fit.failedNow && "text-destructive")}>
          {fit.busy && <Loader2 className="size-3 shrink-0 animate-spin" />}
          {fit.line}
        </p>
      )}
      {fit.offer && <CropPicker key={fit.offer.ref} o={fit.offer} />}
    </div>
  );
}
