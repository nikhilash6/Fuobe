"use client";

import { ArrowUpRight, Palette } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { meanChroma, MONOCHROME_CHROMA, restoreHref } from "@/lib/catalog/restore";
import { cn } from "@/lib/utils";

/** The mean chroma of a few small frames of a clip, read in the browser (null when it can't be read). */
export async function clipChroma(src: string, at = [0.2, 0.5, 0.8]): Promise<number | null> {
  if (typeof document === "undefined") return null;
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.crossOrigin = "anonymous";
  v.src = src;
  const ready = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 8000);
    v.onloadeddata = () => (clearTimeout(t), resolve(true));
    v.onerror = () => (clearTimeout(t), resolve(false));
  });
  if (!ready || !v.videoWidth || !Number.isFinite(v.duration)) return null;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = Math.max(1, Math.round((64 * v.videoHeight) / v.videoWidth));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const seen: number[] = [];
  for (const f of at) {
    const ok = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 5000);
      v.onseeked = () => (clearTimeout(t), resolve(true));
      v.currentTime = Math.min(v.duration - 0.05, Math.max(0, f * v.duration));
    });
    if (!ok) continue;
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    try {
      seen.push(meanChroma(ctx.getImageData(0, 0, canvas.width, canvas.height).data));
    } catch {
      return null;
    }
  }
  v.removeAttribute("src");
  v.load();
  return seen.length ? seen.reduce((a, b) => a + b, 0) / seen.length : null;
}

/** Whether a clip looks black-and-white (or toned): null until read, or when it can't be. */
export function useLooksMonochrome(src: string | undefined): boolean | null {
  const [read, setRead] = useState<{ src: string; mono: boolean | null } | null>(null);
  useEffect(() => {
    if (!src) return;
    let live = true;
    void clipChroma(src).then((c) => live && setRead({ src, mono: c === null ? null : c < MONOCHROME_CHROMA }));
    return () => {
      live = false;
    };
  }, [src]);
  return src && read?.src === src ? read.mono : null;
}

/**
 * The restore step offered where your own footage goes in (Shorts, Explainer): a quiet line for any clip, said
 * plainly when its frames carry almost no colour. Restore & colourise opens in a new tab with the clip, so the
 * work here stays; the restored clip lands in the Library, to pick here.
 */
export function OldFootageOffer({ url, src, className }: { url?: string; src?: string; className?: string }) {
  const mono = useLooksMonochrome(src ?? url);
  return (
    <p className={cn("flex gap-1.5 text-[12px] leading-snug", mono ? "text-foreground" : "text-muted-foreground", className)}>
      <Palette className={cn("mt-0.5 size-3.5 shrink-0", mono && "text-brand-text")} />
      <span>
        {mono ? "This looks like black-and-white footage. " : "Old or black-and-white footage? "}
        <Link href={restoreHref(url)} target="_blank" rel="noopener" className="inline-flex items-center gap-0.5 font-medium text-brand-text underline-offset-2 hover:underline">
          Restore &amp; colourise it first
          <ArrowUpRight className="size-3" aria-hidden />
        </Link>
        <span className="text-muted-foreground"> (new tab), then pick the restored clip from your Library.</span>
      </span>
    </p>
  );
}
