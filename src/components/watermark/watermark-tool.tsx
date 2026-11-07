"use client";

import { Brush, ChevronRight, Download, ImagePlus, Library, Loader2, Minimize2, MoreHorizontal, RotateCcw, ScanLine, Undo2, Upload, Wand2, Zap } from "lucide-react";
import Link from "next/link";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToolShell } from "@/components/av/tool-shell";
import { useGeneration } from "@/components/av/use-generation";
import { fileToSlot, LibraryGrid, type SlotValue } from "@/components/studio/media-slot";
import { TileActions } from "@/components/studio/result-actions";
import { SketchEditor, type SketchResult } from "@/components/studio/sketch-editor";
import { useAskBeforeUpload, useCreateGeneration, useGenerationActions, useHydrated, useIsGuest, useStatus, useViewer } from "@/lib/api";
import type { Generation, OutputFile } from "@/lib/catalog/types";
import { downloadHref } from "@/lib/library";
import type { PresetCover } from "@/lib/preset-covers";
import { toastError } from "@/lib/refusals";
import { cn } from "@/lib/utils";
import {
  cleanFileName,
  COPY,
  foundLine,
  keptBoxesJson,
  MAX_SIDE,
  parseScanReport,
  removeLabel,
  visitorError,
  WATERMARK_APP_ID,
  WATERMARK_FEATURE,
  WATERMARK_REMOVE_MODEL,
  WATERMARK_SCAN_FEATURE,
  WATERMARK_SCAN_MODEL,
  type Region,
  type WatermarkQuality,
} from "@/lib/watermark";
import { FlipCompare } from "./flip-compare";
import { RegionChips, RegionsView } from "./regions";

/**
 * The Watermark Remover (app-watermark-remover): add a photo and it is scanned at once; every mark found is outlined with a
 * chip; tap any to keep it; Remove takes the rest off. The result flips with a tap (hold for the original), a brush covers
 * anything missed, and Download gives the file as it was made. Phone first, taps only. Both steps are ordinary runs
 * (POST /api/generations) on the person's own GPU; the scan is a helper row the Library hides.
 */

interface Source {
  id: string;
  ref: string;
  preview: string;
  name: string;
  uploading?: boolean;
}

interface Size {
  width: number;
  height: number;
}

const HINT_KEY = "fuobe.watermark.hint";
const ADD_A_PHOTO = "Add a photo: JPG, PNG or WebP";
const PHOTO_TYPES = /^image\/(png|jpeg|webp)$/;
const PHOTO_URL = /\.(png|jpe?g|webp)(?:[?#]|$)/i;
const ANY_EXT = /\.[a-z0-9]{2,5}(?:[?#]|$)/i;
/** The brush's own words here: the mark, never the tool's inner workings. */
const BRUSH_WORDS = { title: "Brush over the mark", hint: "Paint over what's left. The rest of the photo stays as it is.", done: "Remove it" };
const busy = (g?: Generation | null) => !!g && (g.status === "queued" || g.status === "running");
const ended = (g?: Generation | null) => g?.status === "failed" || g?.status === "canceled";
const imageOf = (g?: Generation | null): OutputFile | undefined => g?.outputs.find((o) => o.kind === "image");
const reportOf = (g?: Generation | null): string | undefined => g?.outputs.find((o) => o.kind === "text")?.text;
const baseName = (name: string) => name.replace(/\.[a-z0-9]{2,4}$/i, "") || "photo";

/** The picture's own size in pixels, read by the browser (null when it can't be read). */
function readSize(src: string): Promise<Size | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth && img.naturalHeight ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** The photo made 4096 px on its longest side, here in the browser: a JPEG stays a JPEG (at high quality), else a PNG. */
async function shrinkPhoto(src: string, name: string): Promise<File> {
  const blob = await (await fetch(src)).blob();
  const bitmap = await createImageBitmap(blob);
  try {
    const k = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.min(MAX_SIDE, Math.round(bitmap.width * k)));
    const height = Math.max(1, Math.min(MAX_SIDE, Math.round(bitmap.height * k)));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    const jpeg = blob.type === "image/jpeg";
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, jpeg ? "image/jpeg" : "image/png", 0.95));
    if (!out) throw new Error("no picture");
    return new File([out], `${baseName(name)}.${jpeg ? "jpg" : "png"}`, { type: out.type });
  } finally {
    bitmap.close();
  }
}

function readHint(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function writeHint() {
  try {
    window.localStorage.setItem(HINT_KEY, "1");
  } catch {
    // Private windows and blocked storage: the hint shows again next time.
  }
}

/**
 * ?image= from a Library result's "Remove watermark", the Edit studio or ⌘K, read once after hydration, once who is looking
 * is known (an account with no GPU is asked for one first): scanned at once. Only this site's own files (a path, never
 * "//host/…"); the stored name is an id, so the download is named "photo".
 */
function useHandoff(take: (s: Source) => void, ready: boolean) {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    const url = new URLSearchParams(window.location.search).get("image");
    if (url && /^\/(?!\/)/.test(url)) take({ id: nanoid(8), ref: url, preview: url, name: "photo" });
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
}

export function WatermarkTool({ app, cover }: { app: { name: string; description: string }; cover?: PresetCover }) {
  const create = useCreateGeneration();
  const actions = useGenerationActions();
  // No key runs this app: an account with no GPU is asked for one, never for a key.
  const askFirst = useAskBeforeUpload({ gpuOnly: true });
  const guest = useIsGuest();
  const status = useStatus();
  const viewer = useViewer().data;
  const owner = !!viewer?.owner;
  const [source, setSource] = useState<Source | null>(null);
  /** The photo being worked on: a scan asked for an earlier one (started over meanwhile) is stopped when it arrives. */
  const sourceId = useRef<string | null>(null);
  const pendingUpload = useRef<string | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [tooBig, setTooBig] = useState(false);
  const [shrinking, setShrinking] = useState(false);
  const [scanId, setScanId] = useState<string | null>(null);
  /** The visitor's choices by region id (a mark kept or taken back); the scan's own default otherwise. */
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  /** Every removal pass, oldest first (each is its own Library item). Only the newest may still be running or have failed. */
  const [passes, setPasses] = useState<string[]>([]);
  const [brushOpen, setBrushOpen] = useState(false);
  const hydrated = useHydrated();
  const [hintDismissed, setHintDismissed] = useState(false);
  const hintSeen = !hydrated || hintDismissed || readHint();
  /** Why the scan didn't start (a guest, no GPU connected, setup needed): said in words, with Try again. */
  const [scanError, setScanError] = useState<string | null>(null);
  /** Why the first removal didn't work, shown over the marks (still as the visitor left them): Remove tries again. */
  const [removeError, setRemoveError] = useState<string | null>(null);
  /** How the newest pass was asked: the kept marks (their outlines show while it runs) or a brushed area. */
  const [lastMode, setLastMode] = useState<"boxes" | "brush">("boxes");
  const scan = useGeneration(scanId);
  const lastId = passes.at(-1) ?? null;
  const last = useGeneration(lastId);
  const prevId = passes.at(-2) ?? null;
  const prev = useGeneration(prevId).data;
  const s = scan.data;
  const g = last.data;

  const reset = useCallback(() => {
    sourceId.current = null;
    pendingUpload.current = null;
    setSource(null);
    setSize(null);
    setTooBig(false);
    setScanId(null);
    setToggles({});
    setPasses([]);
    setScanError(null);
    setRemoveError(null);
  }, []);

  const startScan = useCallback(
    (src: Source) => {
      // An account with nothing that runs this (a picture handed over from the Library): the GPU card, never a key's.
      // A guest's run is refused by the server, whose card says the same.
      if (!guest && askFirst("run")) return setScanError(COPY.connectGpu);
      create.mutate(
        { feature: WATERMARK_SCAN_FEATURE, modelId: WATERMARK_SCAN_MODEL, op: "watermark-scan", inputs: { images: [src.ref] }, title: "Find marks" },
        {
          onSuccess: (items) => {
            const item = items[0];
            // Started over (or another photo) while this scan was being asked for: it stops at once.
            if (sourceId.current !== src.id) {
              if (item && busy(item)) void actions.cancel(item);
              return;
            }
            setScanId(item?.id ?? null);
          },
          onError: (e) => {
            if (sourceId.current !== src.id) return;
            toastError(e);
            setScanId(null);
            setScanError((e as { gpuSetup?: boolean }).gpuSetup ? "Finish setting up your GPU, then try again." : (e as Error).message || COPY.scanFailed);
          },
        },
      );
    },
    [create, actions, guest, askFirst],
  );

  /** A picture to work on: its size is read first (over 4096 px it stops there), then the scan starts by itself. */
  const take = useCallback(
    (src: Source) => {
      if (sourceId.current !== src.id) setSize(null);
      sourceId.current = src.id;
      setSource(src);
      setScanId(null);
      setToggles({});
      setPasses([]);
      setTooBig(false);
      setScanError(null);
      setRemoveError(null);
      if (src.uploading) return;
      void readSize(src.preview).then((sz) => {
        if (sourceId.current !== src.id) return;
        setSize(sz);
        if (sz && Math.max(sz.width, sz.height) > MAX_SIDE) return setTooBig(true);
        startScan(src);
      });
    },
    [startScan],
  );

  useHandoff(take, status.isFetched || status.isError);

  /** A file of the visitor's own (chosen, dropped, or made smaller here): uploaded, then scanned. */
  const upload = useCallback(
    (f: File | undefined) => {
      if (!f || askFirst()) return;
      if (!PHOTO_TYPES.test(f.type)) return void toast(ADD_A_PHOTO);
      const id = nanoid(8);
      pendingUpload.current = id;
      void fileToSlot(
        f,
        (v) => {
          if (pendingUpload.current !== id) return;
          if (!v) {
            if (sourceId.current === id) reset();
            return;
          }
          take({ id, ref: v.ref, preview: v.preview, name: f.name, uploading: v.uploading });
        },
        "image",
      );
    },
    [askFirst, reset, take],
  );

  const fromLibrary = (v: SlotValue) => {
    // Vectors, GIFs and the like can't be cleaned: only photos.
    const photo = PHOTO_URL.test(v.ref) || (!ANY_EXT.test(v.ref) && PHOTO_URL.test(v.name ?? ""));
    if (!photo) return void toast(ADD_A_PHOTO);
    take({ id: nanoid(8), ref: v.ref, preview: v.preview, name: v.name ?? "photo" });
  };

  const shrink = async () => {
    if (!source || shrinking) return;
    setShrinking(true);
    try {
      upload(await shrinkPhoto(source.preview, source.name));
    } catch {
      toast("We couldn't make this photo smaller — try another photo.");
    } finally {
      setShrinking(false);
    }
  };

  // The scan's report as regions, each on or kept as the visitor chose.
  const report = s?.status === "succeeded" ? reportOf(s) : undefined;
  const parsed = useMemo(() => parseScanReport(report), [report]);
  const regions = useMemo(() => parsed?.regions.map((r) => (r.id in toggles ? { ...r, on: toggles[r.id] } : r)) ?? null, [parsed, toggles]);
  /** The scan finished but its report can't be read: a failed scan, with Try again (never a page that waits forever). */
  const unreadable = s?.status === "succeeded" && !parsed;

  // A pass that failed or was stopped leaves the list: the page goes back to where it was (the marks as the visitor left
  // them, or the last clean result with its Download and Undo) and says why in plain words. A stop says nothing.
  useEffect(() => {
    if (!g || g.id !== lastId || !ended(g)) return;
    const why = visitorError(g, owner, COPY.retry);
    /* eslint-disable react-hooks/set-state-in-effect -- the run's end comes from the server (its poll): the page follows it once */
    if (passes.length > 1) {
      if (why) toast(why);
    } else setRemoveError(why);
    setPasses((p) => (p.at(-1) === g.id ? p.slice(0, -1) : p));
    /* eslint-enable react-hooks/set-state-in-effect */
    // The newest pass's end, once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g?.id, g?.status]);

  const toggle = (id: string) => {
    const r = regions?.find((x) => x.id === id);
    if (r) setToggles((t) => ({ ...t, [id]: !r.on }));
  };
  const onCount = regions?.filter((r) => r.on).length ?? 0;

  // The picture shown: the newest clean result, else the original. A pass that is running or has just ended shows the one
  // before it.
  const okPasses = [g, prev].filter((x): x is Generation => x?.status === "succeeded");
  const shownPass = g?.status === "succeeded" ? g : (busy(g) || ended(g)) && prev?.status === "succeeded" ? prev : undefined;
  const latest = imageOf(shownPass);
  const current = latest?.url ?? source?.ref ?? null;
  const shownSize = size ?? (parsed ? { width: parsed.width, height: parsed.height } : null);

  const run = (extra: { boxes?: string; mask?: string }) => {
    if (!source || !current) return;
    setLastMode(extra.mask ? "brush" : "boxes");
    setRemoveError(null);
    create.mutate(
      {
        feature: WATERMARK_FEATURE,
        presetId: WATERMARK_APP_ID,
        modelId: WATERMARK_REMOVE_MODEL,
        op: "watermark-remove",
        inputs: { images: [current], ...(extra.mask && { mask: extra.mask }) },
        ...(extra.boxes && { params: { extra: { boxes: extra.boxes } } }),
        title: `${COPY.name} · ${baseName(source.name)}`,
      },
      {
        onSuccess: (items) => {
          const id = items[0]?.id;
          if (id) setPasses((p) => [...p, id]);
        },
        onError: (e) => toastError(e),
      },
    );
  };
  const remove = () => {
    if (!regions || onCount === 0) return void toast(COPY.noneKept);
    run({ boxes: keptBoxesJson(regions) });
  };
  const onBrush = (r: SketchResult) => {
    setBrushOpen(false);
    if (!r.mask) return void toast("Brush over the mark first");
    run({ mask: r.mask });
  };
  const undo = () => setPasses((p) => p.slice(0, -1));
  const cancelScan = () => {
    if (s && busy(s)) void actions.cancel(s);
    reset();
  };
  const cancelRemove = () => {
    if (g && busy(g)) void actions.cancel(g);
  };

  const removing = busy(g) || (create.isPending && !!regions);
  const resultPass = g?.status === "succeeded" ? g : ended(g) && prev?.status === "succeeded" ? prev : undefined;
  const result = imageOf(resultPass);
  const quality = result?.meta?.quality as WatermarkQuality | undefined;
  const scanFailed = !!scanError || s?.status === "failed" || s?.status === "canceled" || unreadable;
  const empty = !!regions && regions.length === 0 && !passes.length;

  const phase: "start" | "uploading" | "too-big" | "scanning" | "scan-failed" | "empty" | "regions" | "removing" | "result" = !source
    ? "start"
    : source.uploading
      ? "uploading"
      : tooBig
        ? "too-big"
        : removing
          ? "removing"
          : result
            ? "result"
            : scanFailed
              ? "scan-failed"
              : empty
                ? "empty"
                : regions
                  ? "regions"
                  : "scanning";

  const scanMessage = scanError ?? (unreadable ? COPY.scanUnreadable : s?.status === "canceled" ? COPY.scanFailed : visitorError(s, owner, COPY.scanFailed));

  const dismissHint = () => {
    if (hintSeen) return;
    setHintDismissed(true);
    writeHint();
  };

  // Tall pictures stay on one screen: the column (heading, picture, chips) is as wide as the height left for the picture
  // allows. The result leaves room for its own buttons under the picture.
  const ratio = shownSize ? shownSize.width / shownSize.height : 4 / 3;
  const column = { maxWidth: `min(100%, calc((100svh - ${phase === "result" ? 330 : 260}px) * ${ratio.toFixed(4)}))` };

  return (
    <ToolShell
      title="Apps"
      engineSwitch={false}
      header={
        <nav aria-label="Breadcrumb" className="hidden items-center gap-1 text-[13px] text-muted-foreground sm:flex">
          <Link href="/apps" className="hover:text-foreground">
            Apps
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="text-foreground">{app.name}</span>
        </nav>
      }
    >
      <div className="mx-auto w-full max-w-[960px] pt-4" data-wm-phase={phase}>
        {/* The app's name on a phone, where the breadcrumb is hidden. */}
        <p className="mb-2 text-center text-[13px] font-medium text-muted-foreground sm:hidden">{app.name}</p>

        {phase === "start" && <Start app={app} cover={cover} onUpload={upload} onLibrary={fromLibrary} askFirst={askFirst} />}

        {source && phase !== "start" && (
          <div className="mx-auto space-y-3" style={column}>
            <Header phase={phase} found={regions?.length ?? 0} on={onCount} />
            <Picture
              phase={phase}
              source={source}
              src={latest?.url ?? source.preview}
              sweep={lastMode === "boxes" && passes.length <= 1}
              size={shownSize}
              space={parsed ? { width: parsed.width, height: parsed.height } : shownSize}
              regions={regions ?? []}
              onToggle={phase === "regions" ? toggle : undefined}
              after={result?.url}
              onCompare={dismissHint}
            />
            {phase === "result" && !hintSeen && (
              <p className="text-center text-[13px] text-muted-foreground" role="status">
                {COPY.hint}
              </p>
            )}
            {removeError && (phase === "regions" || phase === "empty") && (
              <p className="text-[13px] text-destructive" role="alert" data-wm-error>
                {removeError}
              </p>
            )}
            {phase === "regions" && regions && regions.length > 0 && <RegionChips regions={regions} onToggle={toggle} />}
            {phase === "result" && result && resultPass && <ResultBar g={resultPass} out={result} name={baseName(source.name)} owner={owner} quality={quality} />}
            {phase === "scan-failed" && (
              <p className="text-[13px] text-destructive" role="alert" data-wm-error>
                {scanMessage}
              </p>
            )}
            {phase === "too-big" && (
              <p className="text-[13px] text-destructive" role="alert">
                {COPY.tooBig}
              </p>
            )}
            {phase === "empty" && <p className="text-[15px]">{COPY.empty}</p>}
          </div>
        )}
      </div>

      {source && phase !== "start" && (
        <BottomBar>
          {phase === "uploading" ? (
            <p className="inline-flex min-w-0 flex-1 items-center gap-2 text-[14px]" role="status">
              <Loader2 className="size-4 shrink-0 animate-spin" /> Adding your photo…
            </p>
          ) : phase === "scanning" || phase === "removing" ? (
            <>
              <Loader2 aria-hidden="true" className="size-5 shrink-0 animate-spin text-muted-foreground" />
              <Button
                variant="outline"
                className="min-h-11 flex-1 rounded-full"
                onClick={phase === "scanning" ? cancelScan : cancelRemove}
                disabled={phase === "removing" && !busy(g)}
                data-wm-cancel
              >
                Cancel
              </Button>
            </>
          ) : phase === "regions" ? (
            <>
              <Button variant="outline" className="min-h-11 rounded-full" onClick={() => setBrushOpen(true)}>
                <Brush className="size-4" /> Brush instead
              </Button>
              <Button className="min-h-11 flex-1 rounded-full" onClick={remove} disabled={onCount === 0} data-wm-remove>
                <Wand2 className="size-4" /> {removeLabel(onCount)}
              </Button>
            </>
          ) : phase === "result" && result ? (
            <>
              <Button variant="outline" className="min-h-11 rounded-full" onClick={() => setBrushOpen(true)} data-wm-brush>
                <Brush className="size-4" /> <span className="sm:hidden">Brush a spot</span>
                <span className="hidden sm:inline">Missed a spot? Brush it</span>
              </Button>
              <Button className="min-h-11 flex-1 rounded-full" asChild>
                <a href={downloadHref(result.url, cleanFileName(source.name, result.url))} download={cleanFileName(source.name, result.url)} data-wm-download>
                  <Download className="size-4" /> Download
                </a>
              </Button>
            </>
          ) : phase === "empty" ? (
            <>
              <Button variant="outline" className="min-h-11 rounded-full" onClick={reset}>
                Try another photo
              </Button>
              <Button className="min-h-11 flex-1 rounded-full" onClick={() => setBrushOpen(true)}>
                <Brush className="size-4" /> Brush it
              </Button>
            </>
          ) : phase === "scan-failed" ? (
            <>
              <Button variant="outline" className="min-h-11 rounded-full" onClick={reset}>
                Try another photo
              </Button>
              <Button className="min-h-11 flex-1 rounded-full" onClick={() => source && take({ ...source })} data-wm-retry>
                <RotateCcw className="size-4" /> Try again
              </Button>
            </>
          ) : phase === "too-big" ? (
            <>
              <Button variant="outline" className="min-h-11 rounded-full" onClick={reset}>
                Try another photo
              </Button>
              <Button className="min-h-11 flex-1 rounded-full" onClick={() => void shrink()} disabled={shrinking} data-wm-shrink>
                {shrinking ? <Loader2 className="size-4 animate-spin" /> : <Minimize2 className="size-4" />} <span className="sm:hidden">Make it smaller</span>
                <span className="hidden sm:inline">Make it 4096 pixels and continue</span>
              </Button>
            </>
          ) : (
            <Button className="min-h-11 flex-1 rounded-full" onClick={reset}>
              <ImagePlus className="size-4" /> Try another photo
            </Button>
          )}
        </BottomBar>
      )}

      {source && (phase === "regions" || phase === "result") && (
        <div className="mx-auto mt-3 flex w-full max-w-[960px] flex-wrap items-center gap-2">
          {phase === "result" && okPasses.length > 1 && (
            <Button variant="ghost" size="sm" className="min-h-11 rounded-full" onClick={undo}>
              <Undo2 className="size-4" /> Undo
            </Button>
          )}
          <Button variant="ghost" size="sm" className="min-h-11 rounded-full" onClick={reset} data-wm-start-over>
            <RotateCcw className="size-4" /> Start over
          </Button>
        </div>
      )}

      {brushOpen && current && (
        <SketchEditor open onOpenChange={setBrushOpen} image={latest?.url ?? source?.preview ?? current} mode="mask" words={BRUSH_WORDS} onDone={onBrush} />
      )}
    </ToolShell>
  );
}

function Header({ phase, found, on }: { phase: string; found: number; on: number }) {
  const line = phase === "regions" ? foundLine(found, on) : phase === "result" ? "Done." : phase === "removing" ? COPY.removing : phase === "scanning" ? COPY.scanning : null;
  if (!line) return null;
  return (
    <h2 className="font-heading text-[22px] leading-tight text-balance sm:text-[26px]" aria-live="polite">
      {line}
    </h2>
  );
}

function Picture({
  phase,
  source,
  src,
  sweep,
  size,
  space,
  regions,
  onToggle,
  after,
  onCompare,
}: {
  phase: string;
  source: Source;
  /** What is shown while working on it: the newest clean result, else the original. */
  src: string;
  /** The kept marks' outlines show while the removal runs (not for a brushed pass). */
  sweep: boolean;
  /** The picture's size as the browser reads it. */
  size: Size | null;
  /** The pixels the scan's boxes are in (its report's own size). */
  space: Size | null;
  regions: Region[];
  onToggle?: (id: string) => void;
  after?: string;
  onCompare: () => void;
}) {
  if (phase === "result" && after && size) {
    return (
      <div onPointerDown={onCompare}>
        <FlipCompare key={after} before={source.preview} after={after} width={size.width} height={size.height} />
      </div>
    );
  }
  if (!size || !space) {
    return (
      <div className="grid aspect-[4/3] w-full place-items-center rounded-2xl bg-media">
        <Loader2 className="size-5 animate-spin text-white/70" />
      </div>
    );
  }
  const scanning = phase === "scanning";
  return (
    <RegionsView src={src} width={space.width} height={space.height} regions={phase === "regions" || (phase === "removing" && sweep) ? regions : []} onToggle={onToggle} dim={phase === "removing"} working={phase === "removing"}>
      {scanning && (
        <>
          <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 h-[3px] animate-wm-scan bg-gradient-to-r from-transparent via-white to-transparent shadow-[0_0_18px_4px_rgb(255_255_255/.55)] motion-reduce:hidden" />
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 hidden animate-pulse bg-white/10 motion-reduce:block" />
        </>
      )}
    </RegionsView>
  );
}

function ResultBar({ g, out, name, owner, quality }: { g: Generation; out: OutputFile; name: string; owner: boolean; quality?: WatermarkQuality }) {
  const q = encodeURIComponent(out.url);
  const [more, setMore] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="min-h-11 rounded-full" asChild>
          <Link href={`/edit?image=${q}`}>
            <Wand2 className="size-4" /> Edit
          </Link>
        </Button>
        <Button variant="outline" size="sm" className="min-h-11 rounded-full" asChild>
          <Link href={`/live-edit?image=${q}&gen=${encodeURIComponent(g.id)}&from=library`}>
            <Zap className="size-4" /> Live edit
          </Link>
        </Button>
        {/* The standard menu mounts on the first tap (it opens as it mounts), like a Library tile's. */}
        {more ? (
          <TileActions g={g} index={Math.max(0, g.outputs.indexOf(out))} menuOnly tone="surface" triggerClassName="inline-flex size-11 items-center justify-center rounded-full border bg-background" />
        ) : (
          <Button variant="outline" size="icon" className="size-11 rounded-full" aria-label="More actions" onClick={() => setMore(true)}>
            <MoreHorizontal className="size-4" />
          </Button>
        )}
        <span className="sr-only">{name}</span>
      </div>
      {/* The repair's own verdict, for the owner only: visitors and accounts never see it. */}
      {owner && quality && (quality.needsReview || quality.status !== "completed_clean_first_pass") && (
        <p className="text-[12px] text-muted-foreground" data-wm-owner-status>
          Owner: {quality.status}
          {quality.selectedPass !== undefined ? ` · pass ${quality.selectedPass}` : ""}
          {quality.reasons?.length ? ` · ${quality.reasons.join(", ")}` : ""}
        </p>
      )}
    </div>
  );
}

function Details({ className }: { className?: string }) {
  return (
    <ul className={cn("space-y-1 pt-2 text-[12px] text-muted-foreground", className)}>
      {COPY.details.map((d) => (
        <li key={d}>{d}</li>
      ))}
    </ul>
  );
}

function BottomBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-3 mt-4 border-t bg-background/92 px-3 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] backdrop-blur sm:-mx-6 sm:px-6">
      <div className="mx-auto flex w-full max-w-[960px] items-center gap-2">{children}</div>
    </div>
  );
}

/** Nothing added yet: the demo, then "Add a photo" and "From Library". */
function Start({
  app,
  cover,
  onUpload,
  onLibrary,
  askFirst,
}: {
  app: { name: string; description: string };
  /** The app's cover (its before and after), handed over by the server page: the demo. */
  cover?: PresetCover;
  onUpload: (f: File | undefined) => void;
  onLibrary: (v: SlotValue) => void;
  askFirst: () => boolean;
}) {
  const inputId = useId();
  const [over, setOver] = useState(false);
  const [picking, setPicking] = useState(false);
  return (
    <div className="space-y-5">
      <div className="text-center">
        <h2 className="font-heading text-display text-balance">{COPY.hero}</h2>
        <p className="mx-auto mt-2 max-w-xl text-[14px] text-pretty text-muted-foreground">{COPY.subline}</p>
      </div>
      {cover?.video ? (
        <video
          src={cover.video}
          poster={cover.poster}
          muted
          loop
          autoPlay
          playsInline
          preload="metadata"
          aria-label={`${app.name}: a photo before and after`}
          className="mx-auto block aspect-[4/3] w-full max-w-[760px] rounded-2xl bg-media object-cover"
        />
      ) : cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover.poster} alt={`${app.name}: a photo before and after`} className="mx-auto block aspect-[4/3] w-full max-w-[760px] rounded-2xl bg-media object-cover" />
      ) : null}
      <div
        className={cn(
          "mx-auto flex max-w-[760px] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border-strong bg-background px-4 py-8 text-center transition-colors",
          over && "border-primary bg-brand-faint",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onUpload(e.dataTransfer.files?.[0]);
        }}
      >
        <span className="grid size-12 place-items-center rounded-2xl bg-brand-faint text-brand-text">
          <ScanLine className="size-5" />
        </span>
        <p className="text-[13px] text-muted-foreground">{COPY.sizeLine}</p>
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Button className="min-h-11 rounded-full" onClick={() => askFirst() || document.getElementById(inputId)?.click()} data-wm-add>
            <Upload className="size-4" /> Add a photo
          </Button>
          <Popover open={picking} onOpenChange={setPicking}>
            <PopoverTrigger asChild>
              <Button variant="outline" className="min-h-11 rounded-full" onClick={(e) => askFirst() && e.preventDefault()}>
                <Library className="size-4" /> From Library
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(92vw,360px)] p-2" collisionPadding={12}>
              <p className="px-1 pb-2 text-[13px] font-medium">From your library</p>
              {picking && (
                <LibraryGrid
                  kinds={["image"]}
                  onPick={(v) => {
                    setPicking(false);
                    onLibrary(v);
                  }}
                />
              )}
            </PopoverContent>
          </Popover>
        </div>
        <input
          id={inputId}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          data-wm-file
          onChange={(e) => {
            onUpload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <Details className="mx-auto max-w-[760px]" />
    </div>
  );
}
