"use client";

import { Film, Loader2, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { askToSignUp, uploadFile, useAskBeforeUpload, useGenerations, useIsGuest, useUploads } from "@/lib/api";
import { DEFAULT_CLIP, setClip, type KineticDoc } from "@/lib/motion/kinetic-doc";
import type { VideoLayer } from "@/lib/motion/recipe";
import { toastError } from "@/lib/refusals";
import { Choices, iconButton, Segmented, sheetClass, SliderField } from "./controls";
import type { ClipInputs } from "./preview";
import { useTrackSlider } from "./pro-panels";
import type { TimeStore } from "./time-store";
import type { KineticEditor } from "./use-editor";

/**
 * The clip under the words (five scenes take one): the person's own video results to pick from, an upload for whoever
 * can add files (the owner, an account with its own GPU or key; it goes through the normal upload rules), and how the
 * clip sits: where it starts, cover or contain, a dim and a scrim in the ground colour. Clips are saved without sound.
 */

const SCRIMS: { id: VideoLayer["scrim"]; label: string }[] = [
  { id: "none", label: "None" },
  { id: "bottom", label: "Bottom" },
  { id: "top", label: "Top" },
  { id: "full", label: "Full" },
];

/** A clip's first frame, its <video> made only once the tile scrolls into view (a long list never opens them all). */
function LazyClip({ url }: { url: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    // Every browser Kinetic runs in has IntersectionObserver.
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return <span ref={ref} className="block size-full">{near && <video src={`${url}#t=0.1`} muted playsInline preload="metadata" className="size-full object-contain" />}</span>;
}

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function Picker({ open, onClose, side, onPick }: { open: boolean; onClose: () => void; side: "bottom" | "right"; onPick: (url: string) => void }) {
  const guest = useIsGuest();
  const askFirst = useAskBeforeUpload();
  const list = useGenerations({ kinds: ["video"], statuses: ["succeeded"], limit: 48 });
  const items = useMemo(() => (guest ? [] : (list.data ?? []).filter((g) => g.status === "succeeded" && g.outputs[0]?.kind === "video" && g.outputs[0].url.startsWith("/api/files/"))), [list.data, guest]);
  // The person's own uploaded clips (the Library's Uploads), after their results.
  const uploads = useUploads("video");
  const own = useMemo(() => (guest ? [] : (uploads.data?.pages.flat() ?? []).filter((a) => a.url.startsWith("/api/files/") && !items.some((g) => g.outputs[0].url === a.url)).slice(0, 24)), [uploads.data, items, guest]);
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side={side} showCloseButton={false} className={sheetClass} data-kinetic-sheet="clip">
        <SheetHeader className="flex-row items-start gap-2 pb-3">
          <div className="min-w-0 flex-1">
            <SheetTitle>Pick a clip</SheetTitle>
            <SheetDescription className="text-[13px]">Your words play over it. Kinetic clips are saved without sound.</SheetDescription>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className={iconButton}>
            <X className="size-4" />
          </button>
        </SheetHeader>
        <div className="min-w-0 space-y-3 px-4 pb-4">
          <button
            type="button"
            data-kinetic-upload-clip
            disabled={uploading}
            onClick={() => {
              if (askFirst()) return;
              file.current?.click();
            }}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed text-[14px] font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Upload a clip
          </button>
          <input
            ref={file}
            type="file"
            accept="video/mp4,video/webm,video/quicktime"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              setUploading(true);
              try {
                const a = await uploadFile(f);
                onPick(a.url);
                onClose();
              } catch (err) {
                toastError(err, "Couldn't add that clip. Try another.");
              } finally {
                setUploading(false);
              }
            }}
          />
          {items.length + own.length > 0 ? (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-kinetic-clips>
              {own.map((a) => (
                <li key={a.id} className="min-w-0">
                  <button
                    type="button"
                    data-kinetic-clip={a.id}
                    onClick={() => {
                      onPick(a.url);
                      onClose();
                    }}
                    aria-label={`Use ${(a.name ?? "your clip").slice(0, 80)}`}
                    className="relative block aspect-video w-full overflow-hidden rounded-xl bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <LazyClip url={a.url} />
                  </button>
                  <p className="mt-1 truncate text-[12px] text-muted-foreground">{a.name ?? "Your clip"}</p>
                </li>
              ))}
              {items.map((g) => {
                const o = g.outputs[0];
                const poster = typeof o.meta?.poster === "string" ? o.meta.poster : undefined;
                return (
                  <li key={g.id} className="min-w-0">
                    <button
                      type="button"
                      data-kinetic-clip={g.id}
                      onClick={() => {
                        onPick(o.url);
                        onClose();
                      }}
                      aria-label={`Use ${(g.request.title ?? g.request.prompt ?? "this clip").slice(0, 80)}`}
                      className="relative block aspect-video w-full overflow-hidden rounded-xl bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {poster ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={poster} alt="" loading="lazy" className="size-full object-contain" />
                      ) : (
                        <LazyClip url={o.url} />
                      )}
                    </button>
                    <p className="mt-1 truncate text-[12px] text-muted-foreground">{g.request.title ?? g.request.prompt ?? "Clip"}</p>
                    <p className="truncate text-[11px] text-muted-foreground/80 tabular-nums">
                      {when(g.createdAt)}
                      {o.width && o.height ? ` · ${o.width}×${o.height}` : ""}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">Your clips and video results show here to pick from.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function ClipControl({ doc, editor, time, clip, side, pro }: { doc: KineticDoc; editor: Pick<KineticEditor, "apply" | "end">; time: TimeStore; clip: ClipInputs; side: "bottom" | "right"; pro: boolean }) {
  const guest = useIsGuest();
  const [open, setOpen] = useState(false);
  const layer = doc.recipe.layers?.video;
  const track = useTrackSlider({ doc, editor, time });
  const set = (x: Partial<VideoLayer>, gesture = false) => editor.apply((d) => (d.recipe.layers?.video ? setClip(d, { ...d.recipe.layers.video, ...x }) : d), { gesture });
  const dim = track("clip.dim", layer?.dim ?? 0, (r, v) => (r.layers?.video ? { ...r, layers: { ...r.layers, video: { ...r.layers.video, dim: Math.round(v * 100) / 100 } } } : r));
  const maxFrom = Math.max(0, Math.min(600, (clip.info?.duration ?? 0) - 0.1));
  return (
    <div className="min-w-0 space-y-3" data-kinetic-clip-control>
      <div className="min-w-0">
        <p className="mb-1.5 text-[12px] font-medium text-muted-foreground">Clip</p>
        <div className="flex min-w-0 items-center gap-2">
          {layer && (
            <span className="relative grid h-11 w-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
              <video src={layer.src} muted playsInline preload="metadata" className="size-full object-cover" aria-hidden />
            </span>
          )}
          <button
            type="button"
            onClick={() => (guest ? askToSignUp("upload") : setOpen(true))}
            className="inline-flex h-11 min-w-0 items-center gap-2 rounded-full bg-secondary px-4 text-[13px] font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Film className="size-4 shrink-0" /> <span className="truncate">{layer ? "Change clip" : "Pick a clip"}</span>
          </button>
          {layer && (
            <button type="button" onClick={() => editor.apply((d) => setClip(d, null))} className="h-11 shrink-0 rounded-full px-3 text-[13px] font-medium text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
              Remove
            </button>
          )}
        </div>
        {clip.failed && <p className="mt-1 text-[12px] text-destructive">Pick the clip again</p>}
        <p className="mt-1 text-[11px] text-muted-foreground md:text-[12px]">Kinetic clips are saved without sound.</p>
      </div>
      {layer && (
        <>
          <SliderField label="Start at" unit="s" display={(v) => `${v.toFixed(1)} s`} value={layer.from} min={0} max={Math.max(0.1, maxFrom)} step={0.1} disabled={maxFrom <= 0} onChange={(v) => set({ from: v }, true)} onEnd={editor.end} />
          <Segmented
            label="Fit"
            choices={[
              { id: "cover", label: "Cover" },
              { id: "contain", label: "Contain" },
            ]}
            value={layer.fit}
            onChange={(fit) => set({ fit })}
          />
          <SliderField label="Dim" unit="%" display={(v) => `${Math.round(v * 100)} %`} min={0} max={0.8} step={0.01} scale={100} {...dim} keyButton={pro ? dim.keyButton : undefined} />
          <Choices label="Scrim" choices={SCRIMS} value={layer.scrim} onChange={(scrim) => set({ scrim })} />
        </>
      )}
      <Picker open={open} onClose={() => setOpen(false)} side={side} onPick={(src) => editor.apply((d) => setClip(d, { ...(d.recipe.layers?.video ?? DEFAULT_CLIP), src, from: 0 }))} />
    </div>
  );
}
