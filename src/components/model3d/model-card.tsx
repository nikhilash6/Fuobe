"use client";

import { Box, Clapperboard, Download, ImageIcon, Loader2, Pause, PersonStanding, Play, Rotate3d, Sparkles, Video } from "lucide-react";
import Link from "next/link";
import { createElement, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { uploadFile, useHydrated } from "@/lib/api";
import { animateSpinHref, animationName, model3dView, stillOf, type Model3dView } from "@/lib/av/model3d";
import type { Generation } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { loadModelViewer, TURNTABLE_BACKDROP, useViewerSrc, viewerLook } from "./model-viewer";
import type { Model3dInfo } from "./model3d-studio";
import { RigDialog } from "./rig-dialog";
import { PlaceholderChip } from "@/components/demo-mode";
import { recordableType, recordTurntable } from "./turntable";

/** Downloads besides the main file, by the name the provider gave them. */
const FORMAT_LABEL: Record<string, string> = { rigged: "Rigged .glb", walking: "Walk .glb", running: "Run .glb", fbx: ".fbx", splat: "Splat", points: "Points .glb" };
const formatLabel = (k: string) => FORMAT_LABEL[k] ?? `.${k}`;

/** What the viewer shows of a rig: the result itself, or one of Meshy's walk and run cycles. */
function rigClips(g: Generation, view: Model3dView): { key: string; label: string; url: string }[] {
  if (!view.rigged || !view.glb) return [];
  const animation = g.request.params?.animation;
  const main = view.animated ? (typeof animation === "number" ? animationName(animation) : "Animation") : "Rigged";
  return [
    { key: "main", label: main, url: view.glb },
    ...(["walking", "running"] as const).filter((k) => view.formats[k]).map((k) => ({ key: k, label: k === "walking" ? "Walk" : "Run", url: view.formats[k] })),
  ];
}

/**
 * A finished 3D model. The card plays its turntable (or shows its poster or photo); the orbitable viewer, and with it
 * the GLB, loads only when "View in 3D" opens it: the web GLB when the server made one, else the original (a rig
 * plays its animation). A splat shows its orbit video or picture with the file to download. Then the turntable,
 * Animate the spin and Rig & animate.
 */
export function ModelCard({ g, info, cloudAllowed }: { g: Generation; info: Record<string, Model3dInfo>; cloudAllowed: boolean }) {
  const view = model3dView(g);
  // "preview": the turntable or the still (a splat with an orbit video: the video). "3d": the viewer (a splat: its picture).
  const [show, setShow] = useState<"preview" | "3d">("preview");
  const [viewer, setViewer] = useState<HTMLElement | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [loadedEl, setLoadedEl] = useState<HTMLElement | null>(null);
  const loaded = !!viewer && loadedEl === viewer;
  const [recording, setRecording] = useState<number | null>(null);
  const [recorded, setRecorded] = useState<{ url: string; saved?: string } | null>(null);
  const [rigging, setRigging] = useState(false);
  const pendingRecord = useRef(false);
  // "View in 3D" unmounts itself: focus moves to the viewer once it's there.
  const focusViewer = useRef(false);
  const hydrated = useHydrated();
  const canRecord = hydrated && !!recordableType();
  const clips = rigClips(g, view);
  const [clipKey, setClipKey] = useState("main");
  const rigClip = clips.find((c) => c.key === clipKey);
  // The rig's walk and run cycles load as they are; the model itself as its web GLB, falling back to the original.
  const original = rigClip?.url ?? view.glb;
  const src = useViewerSrc(viewer, rigClip && rigClip.key !== "main" ? rigClip.url : view.web, original);
  const onOriginal = src === original;
  const open3d = show === "3d" && !!view.glb;
  useEffect(() => {
    if (!open3d) return;
    let live = true;
    loadModelViewer().then(
      () => live && setReady(true),
      () => {
        if (!live) return;
        pendingRecord.current = false;
        setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [open3d]);
  // The recorded clip's blob URL lives until another recording replaces it (saving it doesn't change it).
  const recordedUrl = recorded?.url;
  useEffect(() => () => void (recordedUrl && URL.revokeObjectURL(recordedUrl)), [recordedUrl]);
  // The turntable the server rendered (open models), TripoSplat's orbit or the demo's, or the one recorded here.
  const clip = view.turntable ?? recordedUrl;
  // What the card shows while the viewer is closed: the poster, else the photo it was made from.
  const still = view.poster ?? view.photo;
  // From words on the open engine: the Z-Image still the model was built from (a helper step the page hides).
  const drawn = stillOf(g);
  const name = (g.modelName ?? "model").replace(/[^\w .-]+/g, "");
  const label = g.modelName ?? "3D";
  // Behind the viewer: the studio sweep the server's turntable and poster are on, so opening 3D doesn't jump.
  const backdrop = view.material ? TURNTABLE_BACKDROP : undefined;
  const startRecording = useCallback(
    async (el: HTMLElement) => {
      setRecording(0);
      try {
        const blob = await recordTurntable(el as Parameters<typeof recordTurntable>[0], { onProgress: setRecording });
        const url = URL.createObjectURL(blob);
        setRecorded({ url });
        // Keep it in the Library (Uploads) so it can go on to Edit video.
        const asset = await uploadFile(new File([blob], `${name} turntable.webm`, { type: "video/webm" }));
        setRecorded({ url, saved: asset.url });
        toast.success("Turntable recorded — saved to your uploads");
      } catch (e) {
        toastError(e);
      } finally {
        setRecording(null);
      }
    },
    [name],
  );
  useEffect(() => {
    if (!viewer) return;
    if (focusViewer.current) {
      focusViewer.current = false;
      // Its keyboard-focusable part (camera controls) is inside the shadow root.
      (viewer.shadowRoot?.querySelector<HTMLElement>(".userInput") ?? viewer).focus({ preventScroll: true });
    }
    const onLoad = () => {
      setLoadedEl(viewer);
      if (pendingRecord.current) {
        pendingRecord.current = false;
        void startRecording(viewer);
      }
    };
    // A model that can't load won't record either. (A web GLB that fails falls back to the original first.)
    const onError = () => void (onOriginal && (pendingRecord.current = false));
    viewer.addEventListener("load", onLoad);
    viewer.addEventListener("error", onError);
    return () => {
      viewer.removeEventListener("load", onLoad);
      viewer.removeEventListener("error", onError);
    };
  }, [viewer, startRecording, onOriginal]);
  const switchTo = (v: "preview" | "3d") => {
    // A recording asked for before the model loaded is off once the 3D view is closed.
    if (v === "preview") pendingRecord.current = false;
    setShow(v);
  };
  // Recording needs the 3D view: open it and start once the model has loaded.
  const record = () => {
    if (viewer && loaded) return void startRecording(viewer);
    pendingRecord.current = true;
    setShow("3d");
  };
  const spin = view.rigged ? null : animateSpinHref(view, recorded?.saved);
  const notices = info[g.modelId]?.notices ?? [];
  // A rigged result rigs its source model again with another animation.
  const rigSource = view.rigged ? (g.request.inputs?.model3d ?? view.glb) : view.glb;
  // The radio buttons in the corner: the preview and the 3D view, a rig's clips, or a splat's video and picture.
  // A rig's clip is picked by its key ("main", "walking", "running"); "3d" is the model itself.
  const choices: { key: string; label: string; on: boolean }[] = view.splat
    ? clip
      ? [
          { key: "preview", label: "Turntable", on: show === "preview" },
          { key: "3d", label: "Preview", on: show === "3d" },
        ]
      : []
    : view.glb
      ? [
          { key: "preview", label: clip ? "Turntable" : "Preview", on: show === "preview" },
          ...(clips.length > 1
            ? clips.map((c) => ({ key: c.key, label: c.label, on: show === "3d" && clipKey === c.key }))
            : [{ key: "3d", label: "3D", on: show === "3d" }]),
        ]
      : [];
  const pick = (key: string) => {
    if (key === "preview") return switchTo("preview");
    if (key !== "3d") setClipKey(key);
    switchTo("3d");
  };
  const placeholder = view.splat ? (
    view.poster ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={view.poster} alt="The subject the splat was made from, cut out" loading="lazy" decoding="async" className="size-full object-contain p-4" />
    ) : (
      <div className="grid size-full place-items-center p-6 text-center text-[13px] text-muted-foreground">
        <div>
          <Box className="mx-auto mb-2 size-8" aria-hidden />
          Gaussian splat ready — download it below.
        </div>
      </div>
    )
  ) : still ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={still} alt={`The ${label} model`} loading="lazy" decoding="async" className="size-full object-contain" />
  ) : (
    <div className="grid size-full place-items-center text-muted-foreground">
      <Box className="size-8" aria-hidden />
    </div>
  );
  return (
    <article className="overflow-hidden rounded-2xl border bg-background shadow-soft">
      <div className="relative aspect-[4/3] bg-[radial-gradient(circle_at_50%_40%,var(--muted),var(--background))]" style={open3d && backdrop ? { background: backdrop } : undefined}>
        {!open3d ? (
          <>
            {clip && show === "preview" ? <TurntableLoop src={clip} poster={still} label={`Turntable of the ${label} model`} /> : placeholder}
            {view.glb && (
              <Button
                size="sm"
                variant="secondary"
                className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-soft"
                onClick={() => {
                  focusViewer.current = true;
                  switchTo("3d");
                }}
              >
                <Rotate3d className="size-3.5" /> View in 3D
              </Button>
            )}
          </>
        ) : failed ? (
          <div className="grid size-full place-items-center p-6 text-center text-[13px] text-muted-foreground">Couldn&apos;t load the 3D viewer — download the .glb to open it.</div>
        ) : !ready || !src ? (
          // The poster (or the photo) while the viewer loads: the same picture the viewer starts from.
          <div className="relative size-full" role="status" aria-label="Loading the 3D viewer">
            {placeholder}
            <Loader2 className="absolute right-3 bottom-3 size-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          createElement("model-viewer", {
            // A rig's clips are separate files: each gets a fresh viewer.
            key: original,
            ref: setViewer,
            src,
            poster: still,
            alt: `3D model made with ${g.modelName ?? "a 3D model"}`,
            loading: "lazy",
            reveal: "auto",
            "camera-controls": "",
            // A character that moves plays its animation; a still model turns.
            ...(view.rigged ? { autoplay: "" } : { "auto-rotate": "" }),
            "touch-action": "pan-y",
            "interaction-prompt": "none",
            ...viewerLook(view.material),
            style: { width: "100%", height: "100%", background: "transparent" },
          })
        )}
        {recording !== null && (
          <div className="absolute inset-x-3 bottom-3 rounded-full bg-background/90 px-3 py-1.5 text-[12px] font-medium shadow-soft" role="status">
            Recording the turntable… {Math.round(recording * 100)}%
          </div>
        )}
        <PlaceholderChip g={g} className="absolute top-3 left-3 bg-highlight/40 text-foreground dark:text-foreground" />
        {choices.length > 1 && recording === null && (
          <div role="radiogroup" aria-label="Show" className="absolute top-3 right-3 inline-flex max-w-[calc(100%-1.5rem)] flex-wrap justify-end rounded-full bg-background/85 p-0.5 shadow-soft backdrop-blur">
            {choices.map((c) => (
              <button
                key={c.key}
                type="button"
                role="radio"
                aria-checked={c.on}
                onClick={() => pick(c.key)}
                className={cn("h-6 max-w-32 truncate rounded-full px-2.5 text-[11px] font-medium transition", c.on ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-2 p-3">
        <p className="truncate text-[13px] text-muted-foreground">
          {g.modelName}
          {g.prompt && !view.rigged ? ` · ${g.prompt}` : ""}
        </p>
        {view.splat && (
          <p className="text-[12px] text-muted-foreground">
            Fuobe doesn&apos;t draw splats yet: {clip ? "the turntable shows it turning" : "the picture is what the model saw"}. Open the .{view.splat.format} in a Gaussian-splat viewer (SuperSplat, for one) to look around it.
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {view.splat ? (
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <a href={view.splat.url} download={`${name}.${view.splat.format}`}>
                <Download className="size-3.5" /> .{view.splat.format}
              </a>
            </Button>
          ) : (
            view.glb && (
              <Button asChild variant="outline" size="sm" className="rounded-full">
                <a href={view.glb} download={`${name}.glb`}>
                  <Download className="size-3.5" /> .glb
                </a>
              </Button>
            )
          )}
          {Object.entries(view.formats)
            .filter(([k]) => k !== "glb")
            .slice(0, 4)
            .map(([k, url]) => (
              <Button key={k} asChild variant="ghost" size="sm" className="rounded-full">
                <a href={url} download>
                  {formatLabel(k)}
                </a>
              </Button>
            ))}
          {drawn && (
            <Button asChild variant="ghost" size="sm" className="rounded-full">
              <a href={drawn} target="_blank" rel="noreferrer" aria-label="Open the still the model was built from">
                <ImageIcon className="size-3.5" /> Still
              </a>
            </Button>
          )}
          {clip ? (
            <Button asChild variant="outline" size="sm" className="rounded-full">
              <a href={clip} download={`${name} turntable.${view.turntable ? "mp4" : "webm"}`} aria-label="Download the turntable video">
                <Video className="size-3.5" /> Turntable
              </a>
            </Button>
          ) : view.rendering ? (
            // The server renders it after the job (one at a time): it shows up here when it's done.
            <Button variant="outline" size="sm" className="rounded-full" disabled>
              <Loader2 className="size-3.5 animate-spin" /> {view.rendering.queued ? "Turntable queued" : `Rendering turntable… ${Math.round(view.rendering.progress * 100)}%`}
            </Button>
          ) : (
            view.glb &&
            !view.rigged && (
              <Button variant="outline" size="sm" className="rounded-full" onClick={record} disabled={!canRecord || recording !== null || failed}>
                <Clapperboard className="size-3.5" /> Record turntable
              </Button>
            )
          )}
          {rigSource && !view.splat && g.op !== "splat" && (
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => setRigging(true)}>
              <PersonStanding className="size-3.5" /> {view.rigged ? "Another animation" : "Rig & animate"}
            </Button>
          )}
          {spin && (
            <Button asChild size="sm" className="rounded-full">
              <Link href={spin} prefetch={false}>
                <Sparkles className="size-3.5" /> Animate the spin
              </Link>
            </Button>
          )}
        </div>
        {notices.length > 0 && <p className="text-[11px] text-muted-foreground">{notices.join(" · ")}</p>}
      </div>
      {rigSource && rigging && g.op !== "splat" && <RigDialog glb={rigSource} open={rigging} onOpenChange={setRigging} cloudAllowed={cloudAllowed} />}
    </article>
  );
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** Whether the user prefers reduced motion (true until hydrated, so nothing moves before it's known). */
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(REDUCED_MOTION);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => true,
  );
}

/**
 * A card's turntable loop: it loads and plays only while the card is on screen, not at all when the user
 * prefers reduced motion (the poster shows instead), and has a pause / play button (WCAG 2.2.2).
 */
function TurntableLoop({ src, poster, label }: { src: string; poster?: string; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const reduced = useReducedMotion();
  // What the user chose with the button; until then, play unless they prefer reduced motion.
  const [choice, setChoice] = useState<"play" | "pause" | null>(null);
  const wanted = choice ? choice === "play" : !reduced;
  const playing = visible && wanted;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.5 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (playing) void el.play().catch(() => {});
    else el.pause();
  }, [playing]);
  return (
    <>
      <video ref={ref} src={src} poster={poster} loop muted playsInline preload="none" aria-label={label} className="size-full bg-media object-contain" />
      <button
        type="button"
        onClick={() => setChoice(wanted ? "pause" : "play")}
        aria-label={wanted ? "Pause the turntable" : "Play the turntable"}
        className="absolute right-3 bottom-3 grid size-7 place-items-center rounded-full bg-background/85 text-foreground shadow-soft backdrop-blur transition hover:bg-background"
      >
        {wanted ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </button>
    </>
  );
}
