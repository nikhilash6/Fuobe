"use client";

import { Box, ChevronRight, Download, Film, ImagePlus, Library, Loader2, PersonStanding, Upload, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/faceless/controls";
import { Panel, ToolHero, ToolShell } from "@/components/av/tool-shell";
import { fileToSlot, kindOfFile, LibraryGrid, type SlotValue } from "@/components/studio/media-slot";
import { ModelViewer } from "@/components/studio/result-media";
import { RunPlaceChip, useOpenRunPlace } from "@/components/studio/run-place-chip";
import { askToSignUp, useAskBeforeUpload, useCreateGeneration, useGenerations, useIsGuest } from "@/lib/api";
import { getModel } from "@/lib/catalog";
import { BODY_DOUBLE, BODY_DOUBLE_DEMOS, BODY_LOOKS, type BodyLookId, bodyDoubleRequest, bodyLook } from "@/lib/catalog/body-double";
import type { Generation, GenerationRequest, OutputFile } from "@/lib/catalog/types";
import { downloadHref } from "@/lib/library";
import { toastError } from "@/lib/refusals";
import { postFile } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { LiveView } from "./live-view";

type Mode = "live" | "photo" | "clip";
const SUBTITLE = "A 3D body for every person: live from your camera, from a photo, or from a clip as motion capture you can animate with.";
const EXAMPLES: Record<"photo" | "clip", { src: string; name: string; label: string }> = {
  photo: { src: "/samples/body-double/photo-before.jpg", name: "body-double-example.jpg", label: "Try it on this photo" },
  clip: { src: "/samples/body-double/sample-dance.mp4", name: "body-double-example.mp4", label: "Try it on this dance" },
};

function AddMedia({ mode, onPick }: { mode: "photo" | "clip"; onPick: (v: SlotValue) => void }) {
  const [over, setOver] = useState(false);
  const [picking, setPicking] = useState(false);
  const askFirst = useAskBeforeUpload();
  const inputId = useId();
  const kind = mode === "photo" ? "image" : "video";
  const example = EXAMPLES[mode];
  const take = (f: File | undefined) => {
    if (!f || askFirst()) return;
    if (kindOfFile(f) !== kind) return void toast(mode === "photo" ? "Photos only here. For a clip, open Clip." : "Clips only here. For a photo, open Photo.");
    void fileToSlot(f, (v) => v && onPick(v), kind);
  };
  return (
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
        take(e.dataTransfer.files?.[0]);
      }}
    >
      <span className="grid size-12 place-items-center rounded-2xl bg-brand-faint text-brand-text">{mode === "photo" ? <ImagePlus className="size-5" /> : <Film className="size-5" />}</span>
      <div>
        <p className="text-[15px] font-medium">{mode === "photo" ? "Add a photo" : "Add a clip"}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {mode === "photo" ? "Everyone in full view gets a body, hands and pose included" : `One performer, up to ${BODY_DOUBLE.maxClipSeconds} seconds: dance, walk, sport`}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <Button size="lg" className="rounded-full" onClick={() => askFirst() || document.getElementById(inputId)?.click()}>
          <Upload className="size-4" /> Upload
        </Button>
        <Popover open={picking} onOpenChange={setPicking}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="lg" className="rounded-full">
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
      </div>
      <button
        type="button"
        onClick={() => onPick({ ref: "", preview: example.src, kind, name: example.name })}
        className="mt-1 flex items-center gap-3 rounded-xl border bg-card p-1.5 pr-4 text-left outline-none transition hover:border-border-strong focus-visible:ring-2 focus-visible:ring-ring"
      >
        {mode === "photo" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={example.src} alt="" width={64} height={48} className="h-12 w-16 rounded-lg object-cover" />
        ) : (
          <video src={example.src} muted playsInline preload="metadata" className="h-12 w-16 rounded-lg object-cover" />
        )}
        <span className="block text-[13px] font-medium">{example.label}</span>
      </button>
      <input
        id={inputId}
        type="file"
        accept={mode === "photo" ? "image/png,image/jpeg,image/webp" : "video/mp4,video/quicktime,video/webm"}
        hidden
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function LookPicker({ value, onChange }: { value: BodyLookId; onChange: (v: BodyLookId) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Look">
        {BODY_LOOKS.map((l) => (
          <button
            key={l.value}
            type="button"
            role="radio"
            aria-checked={value === l.value}
            onClick={() => onChange(l.value)}
            className={cn(
              "h-8 rounded-full border px-3 text-[13px] outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
              value === l.value ? "border-foreground bg-foreground text-background" : "bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {l.label}
          </button>
        ))}
      </div>
      <p className="text-[12px] text-muted-foreground">{bodyLook(value).hint}</p>
    </div>
  );
}

/**
 * Body Double: Live (the camera, or a sample clip, in this browser), Photo (every person's body) and Clip (motion capture).
 * Photo and Clip are runs on the open engine (InstantHMR); each returns the body drawn over the input in the picked look,
 * a skinned GLB (animated for a clip) and the pose render.
 */
export function BodyDoubleTool({ app }: { app: { name: string; description: string } }) {
  // ?mode=photo or ?mode=clip (the GPU board's links) opens on that mode.
  const asked = useSearchParams().get("mode");
  const [mode, setMode] = useState<Mode>(asked === "photo" || asked === "clip" ? asked : "live");
  const [media, setMedia] = useState<SlotValue | null>(null);
  const [look, setLook] = useState<BodyLookId>("holo");
  const [sending, setSending] = useState(false);
  const create = useCreateGeneration();
  const askFirst = useAskBeforeUpload();
  const guest = useIsGuest();
  const current = useRef<SlotValue | null>(null);

  const switchMode = useCallback((m: Mode) => {
    setMode(m);
    setMedia(null);
    current.current = null;
  }, []);
  const take = useCallback((v: SlotValue | null) => {
    current.current = v;
    setMedia(v);
  }, []);

  const runMode = mode === "live" ? null : mode;
  const example = runMode && media?.preview === EXAMPLES[runMode].src && !media.ref;
  const ready = media && !media.uploading && (media.ref || example) ? media : null;
  const kind = mode === "clip" ? "video" : "image";
  const quoteReq: GenerationRequest | null = ready?.ref ? bodyDoubleRequest({ kind, ref: ready.ref, look }) : null;
  const place = useOpenRunPlace([getModel(mode === "clip" ? BODY_DOUBLE.clipModel : BODY_DOUBLE.photoModel)?.name ?? "Body Double"], quoteReq);

  const go = async () => {
    if (!runMode || !ready) return void toast(mode === "clip" ? "Add a clip" : "Add a photo");
    if (place?.refused) return void toast(place.refused);
    if (example && guest) return askToSignUp("run");
    if (example && askFirst()) return;
    setSending(true);
    try {
      let ref = ready.ref;
      if (!ref) {
        const ex = EXAMPLES[runMode];
        const blob = await (await fetch(ex.src)).blob();
        ref = (await postFile(new File([blob], ex.name, { type: blob.type || (runMode === "clip" ? "video/mp4" : "image/jpeg") }))).url;
        take({ ref, preview: ex.src, kind, name: ex.name });
      }
      await create.mutateAsync(bodyDoubleRequest({ kind, ref, look }));
      toast.success(mode === "clip" ? "Capturing the motion" : "Finding every body");
      document.getElementById("body-double-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      toastError(e, "That didn't start. Please try again.");
    } finally {
      setSending(false);
    }
  };

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
      <div className="mx-auto mt-4 flex max-w-[1040px] justify-center">
        <Segmented
          label="Mode"
          value={mode}
          onChange={switchMode}
          options={[
            { value: "live", label: "Live" },
            { value: "photo", label: "Photo" },
            { value: "clip", label: "Clip" },
          ]}
        />
      </div>
      <div className="mx-auto mt-4 max-w-[1040px]">
        {mode === "live" ? (
          <LiveView />
        ) : !media ? (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
            <AddMedia key={mode} mode={mode} onPick={take} />
            <Demo mode={mode} />
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
            <Panel
              title={mode === "clip" ? "Your clip" : "Your photo"}
              aside={
                <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Remove it" onClick={() => take(null)}>
                  <X className="size-4" />
                </Button>
              }
            >
              <div className="overflow-hidden rounded-xl bg-media">
                {mode === "clip" ? (
                  <video src={media.preview} controls muted playsInline loop className="block max-h-[52vh] w-full object-contain" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={media.preview} alt="Your photo" className="block max-h-[52vh] w-full object-contain" />
                )}
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground" aria-live="polite">
                {media.uploading ? "Uploading…" : mode === "clip" ? `The first ${BODY_DOUBLE.maxClipSeconds} seconds are captured at 24 fps.` : "Every person in full view gets a body."}
              </p>
            </Panel>
            <Panel className="space-y-5">
              <div className="space-y-2">
                <h3 className="text-[13px] font-semibold">Look</h3>
                <LookPicker value={look} onChange={setLook} />
              </div>
              <ul className="space-y-1 text-[12px] text-muted-foreground">
                <li>• The body drawn over your {mode === "clip" ? "clip" : "photo"}</li>
                <li>• {mode === "clip" ? "An animated 3D body (GLB) for Blender, Unreal or any 3D app" : "A 3D body (GLB) with a full skeleton"}</li>
                <li>• The pose {mode === "clip" ? "video" : "picture"}, ready to drive motion transfer</li>
              </ul>
              <div className="space-y-2">
                <div className="flex justify-center">
                  <RunPlaceChip place={place} />
                </div>
                <Button size="lg" className="h-11 w-full rounded-full text-[15px]" onClick={go} disabled={sending || !ready || !!place?.refused} title={place?.send ? `Generate · ${place.send}` : undefined}>
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <PersonStanding className="size-4" />}
                  {mode === "clip" ? "Capture the motion" : "Find every body"}
                </Button>
                {place?.refused && ready && (
                  <p className="text-center text-[12px] text-muted-foreground" aria-live="polite">
                    {place.refused}
                  </p>
                )}
              </div>
            </Panel>
          </div>
        )}
      </div>
      <Results />
    </ToolShell>
  );
}

/** A finished example of the mode: what a run gives back. */
function Demo({ mode }: { mode: "photo" | "clip" }) {
  const [after, setAfter] = useState(true);
  if (mode === "clip") {
    const d = BODY_DOUBLE_DEMOS.clip;
    return (
      <figure className="space-y-2 rounded-2xl border bg-background p-2.5 shadow-soft">
        <video src={d.video} poster={d.poster} autoPlay muted loop playsInline className="block w-full rounded-xl bg-media" />
        <figcaption className="px-0.5 text-[12px] text-muted-foreground">A dance in, its motion capture out: the body over every frame, the pose, and an animated 3D body.</figcaption>
      </figure>
    );
  }
  const d = BODY_DOUBLE_DEMOS.photo;
  return (
    <figure className="space-y-2 rounded-2xl border bg-background p-2.5 shadow-soft">
      <button type="button" aria-pressed={after} onClick={() => setAfter((a) => !a)} className="relative block w-full overflow-hidden rounded-xl bg-media outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={d.before} alt="Four models on a rooftop runway" className="block w-full" draggable={false} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={d.after} alt="Each of the four with their 3D body" className={cn("absolute inset-0 size-full transition-opacity duration-300", after ? "opacity-100" : "opacity-0")} draggable={false} />
        <span className="pointer-events-none absolute top-2 left-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">{after ? "Body Double" : "Photo"}</span>
      </button>
      <figcaption className="px-0.5 text-[12px] text-muted-foreground">Every person in the shot gets a body. Tap the picture to compare.</figcaption>
    </figure>
  );
}

type View = "over" | "3d" | "pose";

/** One run: the body over the input, the 3D body and the pose, with their downloads. */
function BodyResult({ g }: { g: Generation }) {
  const [view, setView] = useState<View>("over");
  const busy = g.status === "queued" || g.status === "running";
  const done = g.status === "succeeded";
  const clip = g.request.op === BODY_DOUBLE.clipOp;
  const over = done ? g.outputs.find((o) => !o.meta?.role && o.kind !== "model3d") : undefined;
  const body = done ? g.outputs.find((o) => o.kind === "model3d") : undefined;
  const pose = done ? g.outputs.find((o) => o.meta?.role === "pose") : undefined;
  const look = bodyLook(g.request.presetOptions?.look);
  const shown: OutputFile | undefined = view === "pose" ? pose : over;
  return (
    <article className="space-y-2 rounded-2xl border bg-background p-2.5 shadow-soft">
      <div className="flex items-center gap-2 px-0.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {clip ? "Motion capture" : "Bodies"} · {look.label}
        </span>
        {done && (
          <Segmented
            label="Show"
            value={view}
            onChange={setView}
            options={[
              { value: "over", label: "On it" },
              ...(body ? [{ value: "3d" as const, label: "3D" }] : []),
              ...(pose ? [{ value: "pose" as const, label: "Pose" }] : []),
            ]}
          />
        )}
      </div>
      {done && view === "3d" && body ? (
        <div className="aspect-[4/5] overflow-hidden rounded-xl bg-media">
          <ModelViewer output={body} g={g} />
        </div>
      ) : done && shown ? (
        <div className="overflow-hidden rounded-xl bg-media">
          {shown.kind === "video" ? (
            <video src={shown.url} autoPlay muted loop playsInline controls className="block aspect-[4/5] w-full object-contain" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown.url} alt={view === "pose" ? "The pose" : "The bodies over the photo"} className="block aspect-[4/5] w-full object-contain" />
          )}
        </div>
      ) : (
        <div className="grid aspect-[4/5] place-items-center rounded-xl bg-media p-4 text-center">
          {busy ? (
            <p className="inline-flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5 text-[13px] text-white backdrop-blur" role="status">
              <Loader2 className="size-3.5 animate-spin" /> {clip ? "Capturing the motion…" : "Finding every body…"}
              {g.progress ? ` ${Math.round(g.progress * 100)}%` : ""}
            </p>
          ) : (
            <p className="rounded-xl bg-black/60 px-3 py-2 text-[13px] text-white backdrop-blur" role="alert">
              {g.error ?? "This one didn't come out. Try again."}
            </p>
          )}
        </div>
      )}
      {done && (
        <div className="flex flex-wrap gap-1.5">
          {over && (
            <Button variant="outline" size="sm" className="rounded-full" asChild>
              <a href={downloadHref(over.url, clip ? "body-double.mp4" : "body-double.png")} download>
                <Download className="size-3.5" /> {clip ? "Video" : "Picture"}
              </a>
            </Button>
          )}
          {body && (
            <Button variant="outline" size="sm" className="rounded-full" asChild>
              <a href={downloadHref(body.url, clip ? "body-double-motion.glb" : "body-double.glb")} download>
                <Box className="size-3.5" /> 3D body (GLB)
              </a>
            </Button>
          )}
          {pose && (
            <Button variant="outline" size="sm" className="rounded-full" asChild>
              <a href={downloadHref(pose.url, clip ? "body-double-pose.mp4" : "body-double-pose.png")} download>
                <PersonStanding className="size-3.5" /> Pose
              </a>
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

/** The runs so far, newest first. */
function Results() {
  const runs = useGenerations({ features: [BODY_DOUBLE.feature], limit: 24 });
  const items = runs.data ?? [];
  if (!items.length) return null;
  return (
    <section className="mx-auto mt-10 max-w-[1040px]" aria-labelledby="body-double-results">
      <h3 id="body-double-results" className="mb-3 scroll-mt-20 font-heading text-[22px]">
        Your body doubles
      </h3>
      <ul className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3">
        {items.map((g) => (
          <li key={g.id}>
            <BodyResult g={g} />
          </li>
        ))}
      </ul>
    </section>
  );
}
