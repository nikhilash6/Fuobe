"use client";

import { FileVideo, ImagePlus, Library, Loader2, RefreshCw, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ACCEPT, fileToSlot, kindOfFile, LibraryGrid, wrongKindMessage, type SlotValue } from "@/components/studio/media-slot";
import { useAskBeforeUpload } from "@/lib/api";
import { cn } from "@/lib/utils";
import { realDuration } from "./frame-sampler";

/**
 * A large drop zone for the one video (or photo) a tool works on: drop, click or pick from the
 * library; then a preview with Replace / Remove. Reports the clip's length once the browser knows it.
 * Someone whose upload would be refused (a guest, an account with neither its own GPU nor its own key)
 * is asked first instead of getting the file chooser, unless the file stays in the browser (`local`).
 */
export function MediaDrop({
  kind,
  value,
  onChange,
  title,
  hint,
  onDuration,
  onUnreadable,
  onFile,
  className,
  compact,
  player,
  preview = true,
  local,
}: {
  /** The file stays in this browser (a blob: URL, nothing uploaded): for tools that only read it here (Virality). */
  local?: boolean;
  /** The preview <video>, for tools that drive it (Trim plays the selection in it). */
  player?: React.Ref<HTMLVideoElement>;
  kind: "video" | "image";
  value: SlotValue | null;
  onChange: (v: SlotValue | null) => void;
  title: string;
  hint?: string;
  onDuration?: (seconds: number) => void;
  /** The browser can't decode the clip (e.g. H.265): tools fall back to typing times. */
  onUnreadable?: () => void;
  /** The file picked or dropped, before its upload starts (Trim reads its header from it, not from the server). */
  onFile?: (f: File) => void;
  className?: string;
  /** A shorter strip once something is attached (editors keep more room for their work). */
  compact?: boolean;
  /** false: once something is attached, just its name with Replace / Remove (the tool shows it itself: Trim's trimmer). */
  preview?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [picking, setPicking] = useState(false);
  const askFirst = useAskBeforeUpload();
  /** True when the upload would be refused and its card opened instead. */
  const refused = () => !local && askFirst();
  const choose = () => refused() || input.current?.click();
  const take = (f: File | undefined) => {
    if (!f || refused()) return;
    if (kindOfFile(f) !== kind) return void toast(wrongKindMessage(kind));
    onFile?.(f);
    if (local) {
      const url = URL.createObjectURL(f);
      return void onChange({ ref: url, preview: url, kind, name: f.name });
    }
    void fileToSlot(f, onChange, kind);
  };
  const Icon = kind === "video" ? FileVideo : ImagePlus;
  const fileInput = (
    <input
      ref={input}
      type="file"
      accept={ACCEPT[kind]}
      hidden
      onChange={(e) => {
        take(e.target.files?.[0]);
        e.target.value = "";
      }}
    />
  );
  const library = (
    <Popover open={picking} onOpenChange={setPicking}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="rounded-full">
          <Library className="size-3.5" /> From library
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,360px)] p-2" collisionPadding={12}>
        <p className="px-1 pb-2 text-[13px] font-medium">From your library</p>
        {picking && (
          <LibraryGrid
            kinds={[kind]}
            onPick={(v) => {
              onChange(v);
              setPicking(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );

  if (value) {
    return (
      <div className={cn("overflow-hidden rounded-2xl border bg-background shadow-soft", className)}>
        {preview && (
          <div className={cn("relative grid place-items-center bg-media", compact ? "max-h-[38vh]" : "max-h-[52vh]")}>
            {kind === "video" ? (
              <video
                key={value.preview}
                ref={player}
                src={value.preview}
                controls
                playsInline
                preload="metadata"
                onLoadedMetadata={(e) => {
                  const el = e.currentTarget;
                  if (Number.isFinite(el.duration) && el.duration > 0) return onDuration?.(el.duration);
                  // A recording with no length in its header (MediaRecorder WebM): find it, else fall back to typed times.
                  void realDuration(el).then((d) => (d ? onDuration?.(d) : onUnreadable?.()));
                }}
                onError={() => !value.uploading && onUnreadable?.()}
                className={cn("w-full object-contain", compact ? "max-h-[38vh]" : "max-h-[52vh]")}
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={value.preview} alt={value.name ?? title} className={cn("w-full object-contain", compact ? "max-h-[38vh]" : "max-h-[52vh]")} />
            )}
            {value.uploading && (
              <div className="absolute inset-0 grid place-items-center bg-background/50" role="status" aria-label="Uploading">
                <span className="inline-flex items-center gap-2 rounded-full bg-background px-3 py-1.5 text-[13px] font-medium shadow-soft">
                  <Loader2 className="size-3.5 animate-spin" /> Uploading…
                </span>
              </div>
            )}
          </div>
        )}
        <div className="flex min-w-0 items-center gap-1 px-3 py-2">
          {!preview && <Icon className="size-4 shrink-0 text-muted-foreground" />}
          <p className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">{value.name ?? title}</p>
          {!preview && value.uploading && (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground" role="status">
              <Loader2 className="size-3 animate-spin" /> Uploading…
            </span>
          )}
          <Button variant="ghost" size="sm" className="rounded-full" onClick={choose}>
            <RefreshCw className="size-3.5" /> Replace
          </Button>
          <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label={`Remove ${kind === "video" ? "the video" : "the photo"}`} onClick={() => onChange(null)}>
            <X className="size-4" />
          </Button>
        </div>
        {fileInput}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border-strong bg-background px-4 py-10 text-center transition-colors sm:py-14",
        over && "border-primary bg-brand-faint",
        className,
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files?.[0]);
      }}
    >
      <span className="grid size-12 place-items-center rounded-2xl bg-brand-faint text-brand-text">{over ? <Upload className="size-5" /> : <Icon className="size-5" />}</span>
      <div>
        <p className="text-[15px] font-medium">{title}</p>
        {hint && <p className="mt-1 text-[13px] text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <Button size="sm" className="rounded-full" onClick={choose}>
          <Upload className="size-3.5" /> Upload {kind === "video" ? "a video" : "a photo"}
        </Button>
        {library}
      </div>
      {fileInput}
    </div>
  );
}
