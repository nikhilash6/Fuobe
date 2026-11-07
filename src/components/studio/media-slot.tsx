"use client";

import { AudioLines, FileVideo, ImagePlus, Library, Loader2, Upload, X } from "lucide-react";
import { nanoid } from "nanoid";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { signInHref, useAskBeforeUpload, useAssets, useIsGuest, type Asset } from "@/lib/api";
import { toastError } from "@/lib/refusals";
import { postFile } from "@/lib/upload";
import type { MediaKind } from "@/lib/catalog/types";
import { PLACEHOLDER, slotCaption } from "@/lib/composer";
import { dropHeld, holdFile, readHeld } from "@/lib/held-files";
import { cn } from "@/lib/utils";
import { onAttr, TAB_PILL, TabRow } from "@/components/ui/tab-row";
import type { SketchMode, Stroke } from "./sketch-editor";

export interface SlotValue {
  /** Client-side identity for list items (references) and in-flight uploads. */
  id?: string;
  /** What the server receives: an /api/files URL (or any URL). */
  ref: string;
  preview: string;
  kind: MediaKind;
  name?: string;
  uploading?: boolean;
  /**
   * A guest's file kept in this browser until sign-up (hosted runs on; src/lib/held-files.ts), by its kept id: `ref` is a
   * stand-in until it is uploaded as the new account's own.
   */
  held?: string;
  /** Picked from the library: whether it was an upload or a result made here. */
  source?: "upload" | "generation";
  /** Drawings and masks: the strokes they were made from, so the editor reopens them (in image pixels). */
  sketch?: { mode: SketchMode; strokes: Stroke[] };
}

// HEIC, AVIF, AAC, Opus and the like are converted in this browser before they are uploaded (src/lib/av/fit-file.ts).
export const ACCEPT: Record<MediaKind, string> = {
  image: "image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,image/avif,.heic,.heif,.avif",
  video: "video/mp4,video/webm,video/quicktime",
  audio: "audio/mpeg,audio/wav,audio/x-wav,audio/ogg,audio/flac,audio/mp4,audio/webm,audio/x-m4a,audio/aac,audio/opus,audio/aiff,.m4a,.aac,.opus,.aif,.aiff,.caf",
  text: "text/plain,.txt,.srt,.vtt",
  model3d: ".glb,.gltf,model/gltf-binary",
};

/** The largest file a studio takes, as the server does (src/app/api/uploads). */
export const MAX_MB = 200;

const EXT_KIND: [RegExp, MediaKind][] = [
  [/\.(mp4|webm|mov|m4v)$/i, "video"],
  [/\.(mp3|wav|ogg|flac|m4a|aac|opus|aif|aiff|caf|wma|amr)$/i, "audio"],
  [/\.(txt|srt|vtt)$/i, "text"],
  [/\.(glb|gltf)$/i, "model3d"],
];

/** What a file is, by its type (or its extension when the browser gives none). Anything else counts as an image. */
export const kindOfFile = (f: File): MediaKind => {
  if (f.type.startsWith("video/")) return "video";
  if (f.type.startsWith("audio/")) return "audio";
  if (f.type.startsWith("image/")) return "image";
  if (f.type.startsWith("text/")) return "text";
  return EXT_KIND.find(([re]) => re.test(f.name))?.[1] ?? "image";
};

/** "Image only — drop a photo here": a tile was given the wrong kind of file. */
export const wrongKindMessage = (kind: MediaKind) =>
  ({ image: "Image only — drop a photo here", video: "Video only — drop a clip here", audio: "Audio only — drop a sound file here", text: "Text only — drop a .txt or .srt file here", model3d: "3D only — drop a .glb file here" })[kind];

/** The file as it is: the server streams it (src/lib/upload.ts), and its error is the toast. */
const upload = (file: File, signal?: AbortSignal): Promise<Asset> => postFile(file, signal);

/**
 * Upload a File and stream state changes back: a local preview first (`uploading: true`), then
 * the server ref, or null on failure. Pass a signal to cancel (a removed attachment): an aborted
 * upload calls back nothing more. The preview's object URL is revoked once the upload settles.
 */
export async function fileToSlot(file: File, onChange: (v: SlotValue | null) => void, kind?: MediaKind, opts: { signal?: AbortSignal } = {}): Promise<void> {
  const k: MediaKind = kind ?? kindOfFile(file);
  if (file.size > MAX_MB * 1024 * 1024) {
    toast.error(`That file's over ${MAX_MB} MB. Try a smaller one.`);
    return;
  }
  const preview = URL.createObjectURL(file);
  // Give the <img>/<video> a moment to switch to the server URL before the blob goes away.
  const revoke = () => setTimeout(() => URL.revokeObjectURL(preview), 1500);
  onChange({ ref: "", preview, kind: k, name: file.name, uploading: true });
  try {
    const asset = await upload(file, opts.signal);
    if (opts.signal?.aborted) return;
    // The server knows best what the file is: a clip uploaded into an image slot doesn't stay there.
    if (kind && asset.kind && asset.kind !== kind) {
      onChange(null);
      toast.error(wrongKindMessage(kind));
      return;
    }
    onChange({ ref: asset.url, preview: asset.url, kind: asset.kind, name: file.name });
  } catch (e) {
    if (opts.signal?.aborted || (e as Error).name === "AbortError") return;
    onChange(null);
    // Refused with its own card ("Create a free account", "Connect your GPU"): nothing on top of it.
    toastError(e, "That upload didn't finish — please try again.");
  } finally {
    revoke();
  }
}

/**
 * A guest's file kept in this browser until sign-up (hosted runs on): its tile at once, with a stand-in ref for the price
 * check, and the file kept under `id` (held-files.ts). Null, said in a toast, for a file over the size limit.
 */
export function heldSlot(file: File, id: string, kind?: MediaKind): SlotValue | null {
  if (file.size > MAX_MB * 1024 * 1024) {
    toast.error(`That file's over ${MAX_MB} MB. Try a smaller one.`);
    return null;
  }
  const k: MediaKind = kind ?? kindOfFile(file);
  void holdFile(id, file);
  return { id, ref: PLACEHOLDER[k], preview: URL.createObjectURL(file), kind: k, name: file.name, held: id };
}

/**
 * Upload a guest's kept file now that it has an account: the value as the server keeps it, or null when the file is gone
 * or the upload was refused (said in a toast). The kept copy is dropped once it is uploaded.
 */
export async function uploadHeld(v: SlotValue): Promise<SlotValue | null> {
  const file = v.held ? await readHeld(v.held) : null;
  if (!file) {
    toast(`Add ${v.name ? `“${v.name}”` : "your file"} again: it wasn't kept through sign-up.`);
    return null;
  }
  try {
    const asset = await upload(file);
    if (asset.kind && asset.kind !== v.kind) {
      toast.error(wrongKindMessage(v.kind));
      return null;
    }
    void dropHeld(v.held!);
    return { ...(v.sketch && { sketch: v.sketch }), ...(v.id && { id: v.id }), ref: asset.url, preview: asset.url, kind: asset.kind ?? v.kind, name: v.name };
  } catch (e) {
    toastError(e, "That upload didn't finish — please try again.");
    return null;
  }
}

/**
 * Upload into a list kept in React state (reference photos, a storyboard's looks): appended once
 * with its preview, then replaced by id when the upload finishes, or dropped if it fails. A file
 * removed from the list while it uploads stays removed.
 */
export function fileToList(file: File, setList: (update: (xs: SlotValue[]) => SlotValue[]) => void, kind?: MediaKind): void {
  const id = nanoid(8);
  let placed = false;
  void fileToSlot(
    file,
    (v) => {
      const first = !placed;
      placed = true;
      setList((xs) => {
        if (first) return v ? [...xs, { ...v, id }] : xs;
        if (!xs.some((x) => x.id === id)) return xs;
        return v ? xs.map((x) => (x.id === id ? { ...v, id } : x)) : xs.filter((x) => x.id !== id);
      });
    },
    kind,
  );
}

function KindIcon({ kind, className }: { kind: MediaKind; className?: string }) {
  if (kind === "video") return <FileVideo className={className} />;
  if (kind === "audio") return <AudioLines className={className} />;
  return <ImagePlus className={className} />;
}

export function SlotPreview({ value, className }: { value: Pick<SlotValue, "kind" | "preview" | "name">; className?: string }) {
  if (value.kind === "video")
    return <video src={value.preview} muted playsInline loop autoPlay className={cn("size-full object-cover", className)} />;
  if (value.kind === "audio")
    return (
      <div className={cn("grid size-full place-items-center bg-brand-faint text-brand-text", className)}>
        <AudioLines className="size-5" />
      </div>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={value.preview} alt={value.name ?? ""} className={cn("size-full object-cover", className)} />;
}

/** Grid of your uploads and results of one kind (or several). A guest's is empty, and says how to fill it. */
export function LibraryGrid({ kinds, onPick }: { kinds: MediaKind[]; onPick: (v: SlotValue) => void }) {
  const [kind, setKind] = useState<MediaKind>(kinds[0] ?? "image");
  const assets = useAssets(undefined, kind);
  const guest = useIsGuest();
  const here = usePathname();
  return (
    <div className="space-y-2">
      {kinds.length > 1 && (
        <TabRow role="tablist" aria-label="Kind" fade={false} className="w-fit">
          {kinds.map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={k === kind}
              onClick={() => setKind(k)}
              className={cn(TAB_PILL, "capitalize")}
              {...onAttr(k === kind)}
            >
              {k === "image" ? "Images" : k === "video" ? "Videos" : k === "audio" ? "Audio" : k}
            </button>
          ))}
        </TabRow>
      )}
      {assets.isLoading ? (
        <div className="grid h-40 place-items-center">
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : assets.data?.length ? (
        <div className="grid max-h-72 grid-cols-4 gap-1.5 overflow-y-auto">
          {assets.data.map((a) => (
            <button
              key={a.id}
              className="aspect-square overflow-hidden rounded-md bg-muted ring-primary transition outline-none hover:ring-2 focus-visible:ring-2"
              aria-label={a.name ?? `${a.kind} from your library`}
              onClick={() => onPick({ ref: a.url, preview: a.url, kind: a.kind, name: a.name ?? undefined, source: a.source })}
            >
              <SlotPreview value={{ preview: a.url, kind: a.kind }} />
            </button>
          ))}
        </div>
      ) : guest ? (
        <p className="px-1 py-6 text-center text-sm text-muted-foreground">
          <Link href={signInHref("signup", here)} className="text-brand-text underline underline-offset-2">
            Sign up free
          </Link>{" "}
          to keep your uploads and results here.
        </p>
      ) : (
        <p className="px-1 py-6 text-center text-sm text-muted-foreground">Nothing here yet. Uploads and results show up here.</p>
      )}
    </div>
  );
}

function LibraryPicker({ kind, onPick }: { kind: MediaKind; onPick: (v: SlotValue) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="absolute -right-1.5 -bottom-1.5 grid size-5 place-items-center rounded-full border bg-background text-muted-foreground opacity-0 shadow-soft transition-opacity group-hover/slot:opacity-100 hover:text-foreground focus-visible:opacity-100"
          aria-label="Choose from library"
          onClick={(e) => e.stopPropagation()}
        >
          <Library className="size-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start" collisionPadding={12}>
        <p className="px-1 pb-2 text-[13px] font-medium">From your library</p>
        {open && (
          <LibraryGrid
            kinds={[kind]}
            onPick={(v) => {
              onPick(v);
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A compact attachment tile: empty (dashed, click/drop to upload) or filled (thumbnail + remove). Someone whose upload
 * would be refused (a guest, an account with neither its own GPU nor its own key) is asked first instead of getting the
 * file chooser, unless the tile keeps the file in the browser (`local`).
 */
export function MediaSlot({
  label,
  kind,
  value,
  onChange,
  required,
  size = "md",
  onFile,
  local,
  slotKey,
  caption,
  accept,
  takes,
}: {
  label: string;
  kind: MediaKind;
  value: SlotValue | null;
  onChange: (v: SlotValue | null) => void;
  required?: boolean;
  size?: "md" | "lg";
  /** Take over file handling (e.g. to append to a list with a stable id). */
  onFile?: (f: File) => void;
  /** `onFile` keeps the file in this browser and uploads nothing (Color grading): anyone may pick one. */
  local?: boolean;
  /** Marks the tile so the composer can point at it ("Add a start frame"). */
  slotKey?: string;
  /** Filled, keep the slot's role on the thumbnail ("Target", "Face"), so two photos can be told apart. */
  caption?: boolean;
  /** The file picker's types, when the tile takes more than its kind (a song tool's slot takes a video's sound). */
  accept?: string;
  /** The files the tile takes, when more than its kind (with `onFile`, which turns them into its kind). */
  takes?: (f: File) => boolean;
}) {
  const handleFile = (f: File) => {
    // A tile takes its own kind only (a clip dropped on the Image tile would land as a video there).
    if (!(takes ? takes(f) : kindOfFile(f) === kind)) return void toast(wrongKindMessage(kind));
    if (onFile) onFile(f);
    else void fileToSlot(f, onChange, kind);
  };
  const askFirst = useAskBeforeUpload();
  /** True when the upload would be refused and its card opened instead. */
  const refused = () => !local && askFirst();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const dim = size === "lg" ? "size-20" : "size-14";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          data-slot-key={slotKey}
          className={cn("group/slot relative shrink-0 rounded-xl", dim)}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f && !refused()) handleFile(f);
          }}
        >
          {value ? (
            <div className="size-full overflow-hidden rounded-xl border bg-muted">
              <SlotPreview value={value} />
              {caption && (
                <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 truncate rounded-b-xl bg-black/50 px-1 py-px text-center text-[10px] leading-tight font-medium text-white">
                  {slotCaption(label)}
                </span>
              )}
              {value.uploading && (
                <div className="absolute inset-0 grid place-items-center rounded-xl bg-background/60" role="status" aria-label="Uploading">
                  <Loader2 className="size-4 animate-spin" />
                </div>
              )}
              <button
                onClick={() => onChange(null)}
                className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background shadow-soft"
                aria-label={`Remove ${label}`}
              >
                <X className="size-3" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => refused() || input.current?.click()}
              aria-label={`${label}${required ? " (required)" : ""}: upload`}
              className={cn(
                "flex size-full flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed border-border-strong text-muted-foreground transition-colors hover:border-primary hover:bg-brand-faint hover:text-brand-text",
                over && "border-primary bg-brand-faint text-brand-text",
              )}
            >
              {over ? <Upload className="size-4" /> : <KindIcon kind={kind} className="size-4" />}
              <span className="line-clamp-2 max-w-full px-1 text-center text-[10px] leading-[1.1] font-medium">{label}</span>
            </button>
          )}
          {!value && <LibraryPicker kind={kind} onPick={onChange} />}
          <input
            ref={input}
            type="file"
            accept={accept ?? ACCEPT[kind]}
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {required ? " (required)" : " (optional)"} — click, drop or paste
      </TooltipContent>
    </Tooltip>
  );
}
