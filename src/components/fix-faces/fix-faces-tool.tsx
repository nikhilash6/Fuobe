"use client";

import { ChevronRight, Film, ImagePlus, Library, Loader2, ScanFace, Upload, X } from "lucide-react";
import { nanoid } from "nanoid";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Panel, ToolHero, ToolShell } from "@/components/av/tool-shell";
import { usePlayInView } from "@/components/body-double/use-play-in-view";
import { Segmented } from "@/components/faceless/controls";
import { useGenjutsuRun } from "@/components/genjutsu/hooks";
import { OwnSetupChip, useOwnSetupPress } from "@/components/own-setup";
import { Feed } from "@/components/studio/feed";
import { fileToSlot, kindOfFile, LibraryGrid, type SlotValue } from "@/components/studio/media-slot";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { askToSignUp, useAskBeforeUpload, useGenerations, useIsGuest } from "@/lib/api";
import { FIX_FACES, FIX_FACES_DEMO, FIX_FACES_STYLES, type FixFacesStyle, fixFacesBody } from "@/lib/catalog/fix-faces";
import { pickFaceFrame } from "@/lib/fix-faces/face-frame";
import { toastError } from "@/lib/refusals";
import { postFile } from "@/lib/upload";
import { cn } from "@/lib/utils";

const SUBTITLE = "Soft or smeared faces in a video, redrawn sharp and true to the person, frame by frame. Add a photo of them, or let Fix Faces find the clearest face in your clip.";
const EXAMPLE_NAME = "fix-faces-example.mp4";

/** A clip or a photo: upload, from the Library, or (for the clip) the example. */
function Picker({ kind, onPick, children }: { kind: "video" | "image"; onPick: (v: SlotValue) => void; children: (open: () => void, library: React.ReactNode) => React.ReactNode }) {
  const [picking, setPicking] = useState(false);
  const askFirst = useAskBeforeUpload();
  const inputId = useId();
  const take = (f: File | undefined) => {
    if (!f || askFirst()) return;
    if (kindOfFile(f) !== kind) return void toast(kind === "video" ? "A video file, please" : "A photo, please");
    void fileToSlot(f, (v) => v && onPick(v), kind);
  };
  const library = (
    <Popover open={picking} onOpenChange={setPicking}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="rounded-full">
          <Library className="size-4" /> From your Library
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(92vw,360px)] p-2" collisionPadding={12}>
        <p className="px-1 pb-2 text-[13px] font-medium">From your library</p>
        {picking && (
          <LibraryGrid
            kinds={[kind]}
            onPick={(v) => {
              onPick(v);
              setPicking(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
  return (
    <>
      {children(() => askFirst() || document.getElementById(inputId)?.click(), library)}
      <input
        id={inputId}
        type="file"
        accept={kind === "video" ? "video/mp4,video/quicktime,video/webm" : "image/png,image/jpeg,image/webp"}
        hidden
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </>
  );
}

function AddClip({ onPick }: { onPick: (v: SlotValue) => void }) {
  const [over, setOver] = useState(false);
  const askFirst = useAskBeforeUpload();
  return (
    <Picker kind="video" onPick={onPick}>
      {(open, library) => (
        <div
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border-strong bg-background px-4 py-10 text-center transition-colors",
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
            const f = e.dataTransfer.files?.[0];
            if (!f || askFirst()) return;
            if (kindOfFile(f) !== "video") return void toast("A video file, please");
            void fileToSlot(f, (v) => v && onPick(v), "video");
          }}
        >
          <span className="grid size-12 place-items-center rounded-2xl bg-brand-faint text-brand-text">
            <Film className="size-5" />
          </span>
          <div>
            <p className="text-[15px] font-medium">Add a video</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Up to {FIX_FACES.maxSeconds} seconds, one main person in view</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            <Button size="lg" className="rounded-full" onClick={open}>
              <Upload className="size-4" /> Upload
            </Button>
            {library}
          </div>
          <button
            type="button"
            onClick={() => onPick({ ref: "", preview: FIX_FACES_DEMO.clip, kind: "video", name: EXAMPLE_NAME })}
            className="mt-1 flex items-center gap-3 rounded-xl border bg-card p-1.5 pr-4 text-left outline-none transition hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring"
          >
            <video src={FIX_FACES_DEMO.clip} muted playsInline preload="metadata" className="h-12 w-16 rounded-lg object-cover" />
            <span className="block text-[13px] font-medium">Try it on this dance</span>
          </button>
        </div>
      )}
    </Picker>
  );
}

/** The before and after example, playing only while it is on screen. */
function Demo() {
  const ref = useRef<HTMLVideoElement>(null);
  usePlayInView(ref);
  return (
    <figure className="space-y-2 rounded-2xl border bg-background p-2.5 shadow-soft">
      <video ref={ref} src={FIX_FACES_DEMO.video} poster={FIX_FACES_DEMO.poster} muted loop playsInline preload="none" className="block w-full rounded-xl bg-media" />
      <figcaption className="px-0.5 text-[12px] text-muted-foreground">The dance as it was made, then fixed: the line sweeps across to the sharp, true face.</figcaption>
    </figure>
  );
}

type Meta = { duration?: number; width?: number; height?: number };
type Auto = { url: string; blob: Blob } | null;

export function FixFacesTool({ app }: { app: { name: string; description: string } }) {
  // ?video=<url> (a finished result's "Fix faces"): opens on that clip.
  const asked = useSearchParams().get("video");
  const [clip, setClip] = useState<SlotValue | null>(asked ? { ref: asked, preview: asked, kind: "video", name: "video.mp4" } : null);
  const [meta, setMeta] = useState<Meta>({});
  const [photo, setPhoto] = useState<SlotValue | null>(null);
  // The clip's clearest face, and how far the search is: each kept with the clip it belongs to.
  const [found, setFound] = useState<{ for: string; face: Auto } | null>(null);
  const [progress, setProgress] = useState<{ for: string; done: number; total: number } | null>(null);
  const [style, setStyle] = useState<FixFacesStyle>("mouth");
  const [sending, setSending] = useState(false);
  const run = useGenjutsuRun();
  const press = useOwnSetupPress();
  const askFirst = useAskBeforeUpload();
  const guest = useIsGuest();

  const example = !!clip && !clip.ref && clip.preview === FIX_FACES_DEMO.clip;
  const ready = clip && !clip.uploading && (clip.ref || example) ? clip : null;

  // With no photo of their own, the clip's clearest face is found in the browser as soon as the clip is in.
  const preview = clip?.preview;
  useEffect(() => {
    if (!preview || photo) return;
    let gone = false;
    pickFaceFrame(preview, (done, total) => !gone && setProgress({ for: preview, done, total }))
      .then((f) => !gone && setFound({ for: preview, face: f ? { url: URL.createObjectURL(f.photo), blob: f.photo } : null }))
      .catch(() => !gone && setFound({ for: preview, face: null }));
    return () => {
      gone = true;
    };
  }, [preview, photo]);
  // The found face's object URL is let go when another one replaces it.
  useEffect(() => () => void (found?.face && URL.revokeObjectURL(found.face.url)), [found]);
  const auto: Auto = found && found.for === preview ? found.face : null;
  const finding: { done: number; total: number } | "none" | null =
    !preview || photo ? null : found?.for === preview ? (found.face ? null : "none") : progress?.for === preview ? progress : { done: 0, total: 1 };

  const clear = () => {
    setClip(null);
    setMeta({});
  };

  const go = async () => {
    if (!ready) return void toast("Add a video");
    if (!photo && !auto) return void toast(finding === "none" ? "Add a photo of the person: no clear face was found in the clip" : "Finding the clearest face first…");
    if (example && guest) return askToSignUp("run");
    if (example && askFirst()) return;
    if (!press(FIX_FACES.model)) return;
    setSending(true);
    try {
      let url = ready.ref;
      if (!url) {
        const blob = await (await fetch(FIX_FACES_DEMO.clip)).blob();
        url = (await postFile(new File([blob], EXAMPLE_NAME, { type: blob.type || "video/mp4" }))).url;
        setClip({ ...ready, ref: url });
      }
      const face = photo?.ref || (auto ? (await postFile(new File([auto.blob], "face.jpg", { type: "image/jpeg" }))).url : "");
      await run.mutateAsync(fixFacesBody({ clip: { url, name: ready.name, ...meta }, photo: face, style, requestId: nanoid(16) }));
      toast.success("Fixing the faces");
      document.getElementById("fix-faces-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      toastError(e, "That didn't start. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const face = photo?.preview ?? auto?.url;
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
      <ToolHero title={app.name} subtitle={SUBTITLE} />
      <div className="mx-auto mt-4 max-w-[1040px]">
        {!clip ? (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
            <AddClip onPick={setClip} />
            <Demo />
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <Panel
              title="Your video"
              aside={
                <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Remove it" onClick={clear}>
                  <X className="size-4" />
                </Button>
              }
            >
              <div className="overflow-hidden rounded-xl bg-media">
                <video
                  src={clip.preview}
                  controls
                  muted
                  playsInline
                  loop
                  className="block max-h-[52vh] w-full object-contain"
                  onLoadedMetadata={(e) => setMeta({ duration: e.currentTarget.duration, width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })}
                />
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground" aria-live="polite">
                {clip.uploading
                  ? "Uploading…"
                  : meta.duration && meta.duration > FIX_FACES.maxSeconds + 0.05
                    ? `The first ${FIX_FACES.maxSeconds} seconds are fixed, at full size, with the sound kept.`
                    : "The whole clip is fixed at full size, with the sound kept."}
              </p>
            </Panel>
            <Panel className="space-y-5">
              <div className="space-y-2">
                <h3 className="text-[13px] font-semibold">Face to match</h3>
                <div className="flex items-center gap-3">
                  <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-media">
                    {face ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={face} alt="The face the video is matched to" className="size-full object-cover" />
                    ) : finding && finding !== "none" ? (
                      <Loader2 className="size-5 animate-spin text-white/70" />
                    ) : (
                      <ScanFace className="size-5 text-white/70" />
                    )}
                  </div>
                  <div className="min-w-0 text-[12px] text-muted-foreground" aria-live="polite">
                    {photo
                      ? "Your photo"
                      : auto
                        ? "The clearest face in your clip"
                        : finding === "none"
                          ? "Add a photo of the person"
                          : finding
                            ? `Finding the clearest face… ${finding.done}/${finding.total}`
                            : ""}
                    <Picker kind="image" onPick={setPhoto}>
                      {(open, library) => (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <Button variant="outline" size="sm" className="rounded-full" onClick={open}>
                            <ImagePlus className="size-4" /> {photo ? "Another photo" : "Use a photo"}
                          </Button>
                          {library}
                          {photo && (
                            <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setPhoto(null)}>
                              From the clip
                            </Button>
                          )}
                        </div>
                      )}
                    </Picker>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <h3 className="text-[13px] font-semibold">Style</h3>
                <Segmented label="Style" value={style} onChange={setStyle} options={FIX_FACES_STYLES.map(({ value, label }) => ({ value, label }))} />
                <p className="text-[12px] text-muted-foreground">{FIX_FACES_STYLES.find((s) => s.value === style)?.hint}</p>
              </div>
              <div className="space-y-2">
                <div className="flex justify-center">
                  <OwnSetupChip setup={FIX_FACES.model} />
                </div>
                <Button size="lg" className="h-11 w-full rounded-full text-[15px]" onClick={go} disabled={sending || !ready || (!photo && !auto)}>
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <ScanFace className="size-4" />}
                  Fix the faces
                </Button>
                <p className="text-center text-[12px] text-muted-foreground">A few minutes for each 5 seconds of video.</p>
              </div>
            </Panel>
          </div>
        )}
      </div>
      <Results />
    </ToolShell>
  );
}

/** The runs so far, newest first, with each video's usual actions. */
function Results() {
  const runs = useGenerations({ features: [FIX_FACES.feature], limit: 24 });
  const items = runs.data ?? [];
  if (!items.length) return null;
  return (
    <section className="mx-auto mt-10 max-w-[1040px]" aria-labelledby="fix-faces-results">
      <h3 id="fix-faces-results" className="mb-3 scroll-mt-20 font-heading text-[22px]">
        Your fixed videos
      </h3>
      <Feed items={items} features={[FIX_FACES.feature]} />
    </section>
  );
}
