"use client";

import { Box, Check, ChevronRight, Clapperboard, Download, Images, LayoutGrid, Library, Loader2, RefreshCw, Rotate3d, Sparkles, Upload, X } from "lucide-react";
import Link from "next/link";
import { createElement, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Segmented } from "@/components/faceless/controls";
import { Panel, ToolHero, ToolShell } from "@/components/av/tool-shell";
import { useGeneration, useGenerationList } from "@/components/av/use-generation";
import { ACCEPT, LibraryGrid } from "@/components/studio/media-slot";
import { loadModelViewer } from "@/components/model3d/model-viewer";
import { askToSignUp, uploadFile, useAskBeforeUpload, useCreateGeneration, useEngine, useGenerations, useIsGuest, useIsOwner, useStatus } from "@/lib/api";
import { ACTIVE_RUNS_CODE } from "@/lib/guest-access";
import {
  ANY_ANGLE,
  asSubject,
  CUSTOM_LIMITS,
  cameraFor,
  clampCustom,
  customCamera,
  customLabel,
  fromOrbit,
  maxPitchFor,
  NO_SUBJECT_MESSAGE,
  orbitOf,
  presetsFor,
  renderSize,
  sheetLayout,
  shotExtra,
  viewOf,
  type AngleId,
  type AnyAngleView,
  type Camera,
  type CustomAngle,
} from "@/lib/catalog/any-angle";
import type { Generation, GenerationRequest } from "@/lib/catalog/types";
import { downloadHref } from "@/lib/library";
import { presetCover } from "@/lib/preset-covers";
import { toastError } from "@/lib/refusals";
import { againPrice, againWhere, placeholdersOn } from "@/lib/demo-mode";
import { cn } from "@/lib/utils";

/**
 * Any Angle (app-any-angle): one photo, a 3D view of it built once, then the same photo from the cameras picked. Phones
 * first: the angles are tap chips, several at a time, and each angle is its own run whose card fills in when it is done.
 * On a desktop the 3D model can also be turned by hand ("Use this view"). The cameras come from the photo's front view,
 * which the server measured when the 3D view was built (src/lib/catalog/any-angle.ts, src/server/any-angle.ts).
 */

const LEAD = "Pick a new camera angle for your photo. We build a 3D view of it first, then shoot it again from where you choose.";

interface Photo {
  ref: string;
  preview: string;
  name?: string;
  uploading?: boolean;
}

/** A pick: a preset, or a camera turned by hand on the desktop view. */
type AnglePick = { key: AngleId; label: string } | { key: string; label: string; custom: CustomAngle };

const isCustom = (p: AnglePick): p is Extract<AnglePick, { custom: CustomAngle }> => "custom" in p;
const busy = (g?: Generation | null) => !!g && (g.status === "queued" || g.status === "running");
const photoOf = (g: Pick<Generation, "request">) => g.request.inputs?.images?.[0];
const newSeed = () => Math.floor(Math.random() * 2 ** 31);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function shotRequest(photo: string, view: AnyAngleView, camera: Camera, label: string, seed: number): GenerationRequest {
  return {
    feature: ANY_ANGLE.feature,
    modelId: ANY_ANGLE.shotModel,
    op: "edit",
    engine: "open",
    prompt: label,
    inputs: { images: [photo] },
    params: { seed, extra: shotExtra(camera, renderSize(view.size.width, view.size.height), view.splat) },
  };
}

/** ?image= from a Library result's "New angle" or Image to 3D's "Shoot it from any angle", read once after hydration. */
function useHandoff(take: (p: Photo) => void) {
  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get("image");
    if (url?.startsWith("/api/files/")) take({ ref: url, preview: url, name: decodeURIComponent(url.split("/").pop() ?? "") });
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function AddPhoto({ onPick }: { onPick: (p: Photo) => void }) {
  const [over, setOver] = useState(false);
  const [picking, setPicking] = useState(false);
  const askFirst = useAskBeforeUpload();
  const inputId = useId();
  const take = (f: File | undefined) => {
    if (!f || askFirst()) return;
    if (!f.type.startsWith("image/")) return void toast("A photo only: a JPEG, PNG or WebP");
    const preview = URL.createObjectURL(f);
    onPick({ ref: "", preview, name: f.name, uploading: true });
    uploadFile(f).then(
      (a) => onPick({ ref: a.url, preview: a.url, name: f.name }),
      (e) => {
        onPick({ ref: "", preview: "", name: undefined });
        toastError(e);
      },
    );
  };
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border-strong bg-background px-4 py-8 text-center transition-colors sm:py-10",
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
      <span className="grid size-12 place-items-center rounded-2xl bg-brand-faint text-brand-text">{over ? <Upload className="size-5" /> : <Rotate3d className="size-5" />}</span>
      <div>
        <p className="text-[15px] font-medium">Add a photo to turn the camera around</p>
        <p className="mt-1 text-[13px] text-muted-foreground">One person or one product, in any setting</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5">
        <Button size="sm" className="rounded-full" onClick={() => askFirst() || document.getElementById(inputId)?.click()}>
          <Upload className="size-3.5" /> Upload
        </Button>
        <Popover open={picking} onOpenChange={setPicking}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="rounded-full">
              <Library className="size-3.5" /> Pick from Library
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[min(92vw,360px)] p-2" collisionPadding={12}>
            <p className="px-1 pb-2 text-[13px] font-medium">From your library</p>
            {picking && (
              <LibraryGrid
                kinds={["image"]}
                onPick={(v) => {
                  onPick({ ref: v.ref, preview: v.preview, name: v.name });
                  setPicking(false);
                }}
              />
            )}
          </PopoverContent>
        </Popover>
      </div>
      <input
        id={inputId}
        type="file"
        accept={ACCEPT.image}
        hidden
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

/**
 * The photo, always the main picture. Once the 3D view is built, "3D view" shows its turntable small in the corner,
 * starting where the photo was taken.
 */
function Stage({ photo, view, building, onRemove }: { photo: Photo; view: AnyAngleView | null; building: Generation | null | undefined; onRemove: () => void }) {
  const [turning, setTurning] = useState(false);
  const front = view?.front.yaw ?? 0;
  const startAtFront = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    if (Number.isFinite(v.duration) && v.duration > 0) v.currentTime = ((((front % 360) + 360) % 360) / 360) * v.duration;
  };
  const progress = building && busy(building) ? Math.round((building.progress ?? 0) * 100) : null;
  return (
    <div className="relative overflow-hidden rounded-2xl bg-media">
      {photo.preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo.preview} alt="Your photo" className="mx-auto max-h-[52svh] w-full object-contain" />
      ) : null}
      {view?.turntable && turning && (
        <video
          key={view.turntable}
          src={view.turntable}
          autoPlay
          loop
          muted
          playsInline
          onLoadedMetadata={startAtFront}
          className="absolute bottom-3 left-3 aspect-square w-[34%] max-w-[180px] rounded-xl bg-black object-contain shadow-soft ring-1 ring-white/15"
          aria-label="Your 3D view, turning"
        />
      )}
      {view?.turntable && progress === null && (
        <Button
          variant="secondary"
          size="sm"
          aria-pressed={turning}
          className="absolute top-3 left-3 min-h-11 rounded-full bg-background/85 px-3.5 backdrop-blur"
          onClick={() => setTurning((t) => !t)}
        >
          <Rotate3d className="size-3.5" /> 3D view
        </Button>
      )}
      {(photo.uploading || progress !== null) && (
        <div className="absolute inset-x-3 bottom-3 rounded-full bg-background/90 px-3 py-1.5 text-[12px] font-medium shadow-soft" role="status">
          <Loader2 className="mr-1.5 inline size-3.5 animate-spin" />
          {photo.uploading ? "Uploading…" : `Building your 3D view… ${progress ? `${progress}%` : ""}`}
        </div>
      )}
      <Button variant="secondary" size="icon" className="absolute top-3 right-3 size-11 rounded-full bg-background/85" aria-label="Remove the photo" onClick={onRemove}>
        <X className="size-4" />
      </Button>
    </div>
  );
}

/** The angles as tap chips, two to a row on a phone: several may be picked. */
function AngleChips({ picks, options, onToggle }: { picks: AnglePick[]; options: AnglePick[]; onToggle: (p: AnglePick) => void }) {
  const on = new Set(picks.map((p) => p.key));
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="Angles">
      {options.map((p) => (
        <button
          key={p.key}
          type="button"
          aria-pressed={on.has(p.key)}
          onClick={() => onToggle(p)}
          className={cn(
            "flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-[13px] font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-ring",
            on.has(p.key) ? "border-primary bg-brand-faint text-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground",
          )}
        >
          <span className="min-w-0 truncate">{p.label}</span>
          {on.has(p.key) && <Check className="size-4 shrink-0 text-brand-text" />}
        </button>
      ))}
    </div>
  );
}

type OrbitEl = HTMLElement & { getCameraOrbit?: () => { theta: number; phi: number; radius: number } };

/** Desktop: the 3D model turned by hand, and "Use this view" adds that camera to the picks. */
function DragView({ view, onUse }: { view: AnyAngleView; onUse: (a: CustomAngle) => void }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [el, setEl] = useState<OrbitEl | null>(null);
  useEffect(() => {
    let live = true;
    loadModelViewer().then(
      () => live && setReady(true),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);
  const { front } = view;
  const use = () => {
    const o = el?.getCameraOrbit?.();
    if (!o) return;
    const deg = (r: number) => (r * 180) / Math.PI;
    onUse(fromOrbit(front, { theta: deg(o.theta), phi: deg(o.phi), radius: o.radius }));
  };
  if (failed || !view.mesh) return null;
  // Only as far as a new angle can go: the turn each side of the front view, and no higher than the high angle allows.
  const turn = front.person ? CUSTOM_LIMITS.yawPeople : CUSTOM_LIMITS.yawObjects;
  const top = Math.max(5, 90 - maxPitchFor(front));
  const low = Math.min(150, 90 - (front.pitch + CUSTOM_LIMITS.pitchMin));
  return (
    <Panel title="Turn it yourself" aside={<span className="text-[12px] text-muted-foreground">Drag to turn. Scroll to move closer.</span>} className="hidden md:block">
      <div className="relative mx-auto aspect-[4/3] max-w-[480px] overflow-hidden rounded-xl bg-media">
        {ready ? (
          createElement("model-viewer", {
            ref: setEl,
            src: view.mesh,
            alt: "The 3D view of your photo",
            "camera-controls": "",
            "interaction-prompt": "none",
            "camera-orbit": orbitOf(front),
            "camera-target": "0m 0m 0m",
            "field-of-view": `${front.fov}deg`,
            "min-field-of-view": `${front.fov}deg`,
            "max-field-of-view": `${front.fov}deg`,
            "min-camera-orbit": `${(front.yaw - turn).toFixed(1)}deg ${top.toFixed(1)}deg ${(front.distance * CUSTOM_LIMITS.distanceMin).toFixed(2)}m`,
            "max-camera-orbit": `${(front.yaw + turn).toFixed(1)}deg ${low.toFixed(1)}deg ${(front.distance * CUSTOM_LIMITS.distanceMax).toFixed(2)}m`,
            "environment-image": "neutral",
            "tone-mapping": "neutral",
            style: { width: "100%", height: "100%", background: "transparent" },
          })
        ) : (
          <div className="grid size-full place-items-center" role="status" aria-label="Loading the 3D view">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="mx-auto mt-3 flex max-w-[480px] justify-end">
        <Button variant="outline" size="sm" className="rounded-full" onClick={use} disabled={!ready}>
          <Box className="size-3.5" /> Use this view
        </Button>
      </div>
    </Panel>
  );
}

/** One angle: its picture when it is done, the original a tap away, and what to do next. */
function ShotCard({ g, original, onAgain }: { g: Generation; original: string; onAgain: (g: Generation) => void }) {
  const [before, setBefore] = useState(false);
  const placeholders = placeholdersOn(useStatus().data?.demoMode);
  const out = g.status === "succeeded" ? g.outputs.find((o) => o.kind === "image") : undefined;
  const label = g.prompt || "New angle";
  return (
    <article className="w-[min(78vw,320px)] shrink-0 snap-start overflow-hidden rounded-2xl border bg-background shadow-soft">
      <div className="relative aspect-[4/3] bg-media">
        {out ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={before ? original : out.url} alt={before ? "The original photo" : label} className="size-full object-contain" />
        ) : g.status === "failed" || g.status === "canceled" ? (
          <p className="grid size-full place-items-center p-4 text-center text-[13px] text-muted-foreground">{g.error ?? "This angle didn't finish"}</p>
        ) : (
          <div className="grid size-full place-items-center" role="status">
            <span className="inline-flex items-center gap-2 text-[13px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Making this angle{g.progress ? ` · ${Math.round(g.progress * 100)}%` : "…"}
            </span>
          </div>
        )}
        {out && (
          <div role="radiogroup" aria-label="Show" className="absolute top-2 left-2 inline-flex rounded-full bg-background/85 p-0.5 text-[12px] font-medium shadow-soft backdrop-blur">
            {(["After", "Before"] as const).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={before === (k === "Before")} onClick={() => setBefore(k === "Before")} className={cn("min-h-11 rounded-full px-3", before === (k === "Before") ? "bg-foreground text-background" : "text-muted-foreground")}>
                {k}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="space-y-2 p-3">
        <p className="truncate text-[13px] font-medium">{label}</p>
        <div className="flex flex-wrap gap-1.5">
          {(out || g.status === "failed") && (
            <Button variant="outline" size="sm" className="rounded-full" onClick={() => onAgain(g)}>
              <RefreshCw className="size-3.5" /> {out ? "Make another" : "Try again"}
              {againWhere(g, { placeholders }, againPrice([g]))}
            </Button>
          )}
          {out && (
            <>
              <Button variant="outline" size="sm" className="rounded-full" asChild>
                <Link href={`/video?image=${encodeURIComponent(out.url)}`} prefetch={false}>
                  <Clapperboard className="size-3.5" /> Animate
                </Link>
              </Button>
              <Button variant="outline" size="icon-sm" className="rounded-full" asChild>
                <a href={downloadHref(out.url, `${label}.png`)} download aria-label={`Download ${label}`}>
                  <Download className="size-3.5" />
                </a>
              </Button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

/** "All angles": the original large and every angle that finished, on one sheet (an angle that failed is left out). */
function ContactSheet({ ids, original }: { ids: string[]; original: string }) {
  const list = useGenerationList(ids);
  const items = list.data ?? [];
  const settled = items.length === ids.length && !items.some(busy);
  const done = items.filter((g) => g.status === "succeeded" && g.outputs.some((o) => o.kind === "image"));
  const [sheet, setSheet] = useState<string | null>(null);
  const key = settled ? done.map((g) => g.id).join(",") : "";
  useEffect(() => {
    if (!key || !done.length) return;
    let live = true;
    let made: string | null = null;
    const load = (src: string) =>
      new Promise<HTMLImageElement>((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = src;
      });
    (async () => {
      const [first, ...rest] = await Promise.all([load(original), ...done.map((g) => load(g.outputs.find((o) => o.kind === "image")!.url))]);
      const shape = { width: rest[0].naturalWidth, height: rest[0].naturalHeight };
      const layout = sheetLayout(shape, done.map((g) => g.prompt || "New angle"));
      const c = document.createElement("canvas");
      c.width = layout.width;
      c.height = layout.height;
      const x = c.getContext("2d");
      if (!x) return;
      x.fillStyle = "#111";
      x.fillRect(0, 0, c.width, c.height);
      x.font = "500 22px system-ui, sans-serif";
      x.textBaseline = "middle";
      for (const t of layout.tiles) {
        const img = t.index < 0 ? first : rest[t.index];
        // Fill the tile, cropped to its shape.
        const k = Math.max(t.w / img.naturalWidth, t.h / img.naturalHeight);
        const sw = t.w / k;
        const sh = t.h / k;
        x.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, t.x, t.y, t.w, t.h);
        x.fillStyle = "#f5f5f5";
        x.fillText(t.label, t.x + 4, t.y + t.h + 22);
      }
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.92));
      if (!blob || !live) return;
      made = URL.createObjectURL(blob);
      setSheet(made);
    })().catch(() => live && setSheet(null));
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
    // The finished angles' ids say when to draw it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, original]);
  if (!settled) {
    const left = items.filter(busy).length || ids.length;
    return (
      <p className="inline-flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
        <Loader2 className="size-3.5 animate-spin" /> All angles: {left} to go
      </p>
    );
  }
  if (!sheet) return null;
  return (
    <Panel title="All angles" aside={<Button variant="outline" size="sm" className="rounded-full" asChild><a href={sheet} download="All angles.jpg"><Download className="size-3.5" /> Download</a></Button>}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={sheet} alt="Your photo and every angle on one sheet" className="w-full rounded-xl" />
    </Panel>
  );
}

function Crumbs({ name }: { name: string }) {
  return (
    <nav aria-label="Breadcrumb" className="hidden items-center gap-1 text-[13px] text-muted-foreground sm:flex">
      <Link href="/apps" className="hover:text-foreground">
        Apps
      </Link>
      <ChevronRight className="size-3.5" />
      <span className="text-foreground">{name}</span>
    </nav>
  );
}

/** The app's cover: one photo shot again from the left, from above and close up. */
function Cover() {
  const cover = presetCover(ANY_ANGLE.appId);
  if (!cover) return null;
  const alt = "One photo shot again from the left, from above and close up";
  return cover.video ? (
    <video src={cover.video} poster={cover.poster} autoPlay loop muted playsInline className="mt-6 aspect-[4/3] w-full max-w-[640px] rounded-2xl bg-media object-cover shadow-soft" aria-label={alt} />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={cover.poster} alt={alt} className="mt-6 w-full max-w-[640px] rounded-2xl shadow-soft" />
  );
}

/**
 * The Any Angle app's page: the tool once its workflows have passed their check on a GPU (`live`, the manifest's
 * `validated`), and for the studio's owner before then; everyone else sees the app's cover until it opens.
 */
export function AnyAngleGate({ live, app }: { live: boolean; app: { name: string } }) {
  const owner = useIsOwner();
  if (live || owner) return <AnyAngleTool app={app} />;
  return (
    <ToolShell title="Apps" engineSwitch={false} header={<Crumbs name={app.name} />}>
      <ToolHero title={app.name} subtitle={LEAD}>
        <Cover />
        <p className="mt-4 rounded-full bg-brand-faint px-3 py-1.5 text-[13px] font-medium text-brand-text">Opening soon</p>
      </ToolHero>
    </ToolShell>
  );
}

export function AnyAngleTool({ app }: { app?: { name: string } }) {
  const [, , mode] = useEngine();
  const guest = useIsGuest();
  const create = useCreateGeneration();
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [buildId, setBuildId] = useState<string | null>(null);
  const [subject, setSubject] = useState<"person" | "object" | null>(null);
  const [picks, setPicks] = useState<AnglePick[]>([]);
  const [customs, setCustoms] = useState<AnglePick[]>([]);
  const [sheetIds, setSheetIds] = useState<string[] | null>(null);
  const [sending, setSending] = useState(false);
  /** Angles asked for while the 3D view builds: they start as soon as it is ready. */
  const [asked, setWaiting] = useState<"picked" | "all" | null>(null);
  // Runs that wait for a place stop when the visitor leaves the page.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const take = useCallback((p: Photo) => {
    setPhoto(p.ref || p.uploading ? p : null);
    if (!p.uploading) {
      setBuildId(null);
      setSubject(null);
      setPicks([]);
      setCustoms([]);
      setSheetIds(null);
      setWaiting(null);
    }
  }, []);
  useHandoff(take);

  // A 3D view already built (or building) from this photo: no need to build it again.
  const builds = useGenerations({ features: [ANY_ANGLE.stepFeature], limit: 50 });
  const ref = photo && !photo.uploading ? photo.ref : "";
  const earlier = useMemo(() => (ref ? builds.data?.find((g) => photoOf(g) === ref && g.modelId === ANY_ANGLE.buildModel && g.status !== "failed" && g.status !== "canceled") : undefined), [builds.data, ref]);
  const id = buildId ?? earlier?.id ?? null;
  const build = useGeneration(id).data;
  const measured = build?.status === "succeeded" ? viewOf(build) : null;
  const view = useMemo(() => (measured && subject ? { ...measured, front: asSubject(measured.front, subject === "person") } : measured), [measured, subject]);
  const person = view?.front.person ?? true;

  const options: AnglePick[] = useMemo(() => [...presetsFor({ person }).map((p) => ({ key: p.id, label: p.label })), ...customs], [person, customs]);
  const picked = picks.filter((p) => options.some((o) => o.key === p.key));
  const results = useGenerations({ features: [ANY_ANGLE.feature], limit: 60 });
  const shots = useMemo(() => (ref ? (results.data ?? []).filter((g) => photoOf(g) === ref) : []), [results.data, ref]);

  const cloudOnly = mode === "cloud";
  const ready = !!view && !!ref;
  // A build that failed takes the angles waiting for it with it.
  const waiting = build?.status === "failed" || build?.status === "canceled" ? null : asked;

  const buildView = () => {
    if (guest) return askToSignUp("run");
    if (!ref) return;
    create.mutate(
      { feature: ANY_ANGLE.stepFeature, modelId: ANY_ANGLE.buildModel, op: "splat", engine: "open", inputs: { images: [ref] } },
      { onSuccess: (items) => setBuildId(items[0]?.id ?? null), onError: (e) => toastError(e) },
    );
  };

  /** Each angle is its own run, sent one after another; a full queue waits for a place. */
  const send = async (reqs: GenerationRequest[]): Promise<string[]> => {
    const made: string[] = [];
    setSending(true);
    try {
      for (const r of reqs) {
        for (let tries = 0; ; tries++) {
          try {
            const items = await create.mutateAsync(r);
            if (items[0]) made.push(items[0].id);
            break;
          } catch (e) {
            // Runs on your own GPU go a few at a time: the next one waits for a place (any other refusal, the hourly
            // limit included, is said at once), and stops waiting when the page is left.
            if ((e as { code?: string }).code === ACTIVE_RUNS_CODE && tries < 40 && mounted.current) {
              await pause(15_000);
              if (!mounted.current) return made;
              continue;
            }
            if (mounted.current) toastError(e);
            return made;
          }
        }
      }
    } finally {
      setSending(false);
    }
    return made;
  };

  const cameraOf = (p: AnglePick): Camera | null => {
    if (!view) return null;
    if (isCustom(p)) return customCamera(view.front, p.custom);
    const preset = presetsFor(view.front).find((x) => x.id === p.key);
    return preset ? cameraFor(view.front, preset) : null;
  };

  const make = async (list: AnglePick[], all = false) => {
    if (guest) return askToSignUp("run");
    if (!view || !ref || !list.length) return;
    const reqs = list.flatMap((p) => {
      const cam = cameraOf(p);
      return cam ? [shotRequest(ref, view, cam, p.label, ANY_ANGLE.seed)] : [];
    });
    if (all) setSheetIds(null);
    const ids = await send(reqs);
    if (!mounted.current) return;
    if (all && ids.length) setSheetIds(ids);
    setPicks([]);
  };

  // A pick the photo can't take (the view from behind, once the photo shows a product) is left out (`picked`), and said.
  const gone = picks.filter((p) => !options.some((o) => o.key === p.key)).map((p) => p.label).join(", ");
  const said = useRef("");
  useEffect(() => {
    if (gone && gone !== said.current) toast(`${gone} is for people, so it's left out for this photo`);
    said.current = gone;
  }, [gone]);

  // Angles asked for while the 3D view was building start when it is ready.
  useEffect(() => {
    if (!waiting || !ready) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the runs start when the server's 3D view is done
    setWaiting(null);
    void make(waiting === "all" ? options.filter((o) => !isCustom(o)) : picked, waiting === "all");
    // Once, when the view is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, ready]);

  const again = (g: Generation) => {
    if (guest) return askToSignUp("run");
    void send([{ ...g.request, account: undefined, params: { ...g.request.params, seed: newSeed() } } as GenerationRequest]);
  };

  const toggle = (p: AnglePick) => setPicks((cur) => (cur.some((x) => x.key === p.key) ? cur.filter((x) => x.key !== p.key) : [...cur, p]));
  const takeView = (a: CustomAngle) => {
    if (!view) return;
    const c = clampCustom(view.front, a);
    const p: AnglePick = { key: `custom-${c.yaw}-${c.pitch}-${c.distance}`, label: customLabel(c), custom: c };
    setCustoms((cur) => (cur.some((x) => x.key === p.key) ? cur : [...cur, p]));
    setPicks((cur) => (cur.some((x) => x.key === p.key) ? cur : [...cur, p]));
  };

  const n = picked.length;
  const failedBuild = build?.status === "failed" || build?.status === "canceled";
  // No subject in the photo: building again gives the same answer, so another photo is the way on.
  const noSubject = failedBuild && build?.error === NO_SUBJECT_MESSAGE;
  const building = busy(build);
  /** Make now, or (while the view builds) as soon as it is ready. */
  const start = (what: "picked" | "all") => {
    if (guest) return askToSignUp("run");
    if (ready) return void make(what === "all" ? options.filter((o) => !isCustom(o)) : picked, what === "all");
    if (building) setWaiting(what);
  };
  const waitingCount = waiting === "all" ? options.filter((o) => !isCustom(o)).length : waiting ? n : 0;

  return (
    <ToolShell
      title="Apps"
      engineSwitch={false}
      header={<Crumbs name={app?.name ?? "Any Angle"} />}
    >
      {!photo && (
        <ToolHero title={app?.name ?? "Any Angle"} subtitle={LEAD}>
          <Cover />
        </ToolHero>
      )}
      <div className={cn("mx-auto max-w-[860px] space-y-3", photo ? "pt-4" : "mt-6")}>
        {!photo ? (
          <AddPhoto onPick={take} />
        ) : (
          <Stage photo={photo} view={view} building={build} onRemove={() => take({ ref: "", preview: "" })} />
        )}

        {photo && cloudOnly && (
          <Panel>
            <p className="text-[13px] text-muted-foreground">
              <span className="font-medium text-foreground">Any Angle runs on a GPU.</span> This studio is set to cloud models only, so it can&apos;t run here.
            </p>
          </Panel>
        )}

        {photo && !cloudOnly && !view && (
          <Panel>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <p className="min-w-0 flex-1 text-[13px] text-muted-foreground" aria-live="polite">
                {photo.uploading
                  ? "Uploading your photo…"
                  : building
                    ? waiting
                      ? `Building your 3D view. Your ${waitingCount === 1 ? "angle starts" : `${waitingCount} angles start`} as soon as it's ready.`
                      : "Building your 3D view. It takes about two minutes, once per photo. Pick your angles now: they start as soon as it's ready."
                    : failedBuild
                      ? (build?.error ?? "The 3D view didn't finish. Try again.")
                      : "First we build a 3D view of your photo. It takes about two minutes, once per photo."}
              </p>
              {!building &&
                (noSubject ? (
                  <Button size="lg" className="shrink-0 rounded-full" onClick={() => take({ ref: "", preview: "" })}>
                    <Upload className="size-4" /> Choose another photo
                  </Button>
                ) : (
                  <Button
                    size="lg"
                    className="shrink-0 rounded-full"
                    disabled={!ref || create.isPending}
                    onClick={() => {
                      if (failedBuild) setBuildId(null);
                      setWaiting(null);
                      buildView();
                    }}
                  >
                    {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Rotate3d className="size-4" />} {failedBuild ? "Try again" : "Build 3D view"}
                  </Button>
                ))}
            </div>
          </Panel>
        )}

        {photo && !cloudOnly && (
          <Panel
            title="Angles"
            aside={
              view ? (
                <Segmented
                  label="What the photo shows"
                  value={subject ?? (measured?.front.person ? "person" : "object")}
                  onChange={(v) => setSubject(v)}
                  options={[
                    { value: "person", label: "Person" },
                    { value: "object", label: "Product" },
                  ]}
                />
              ) : undefined
            }
          >
            <AngleChips picks={picked} options={options} onToggle={toggle} />
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Button variant="outline" size="lg" className="rounded-full" disabled={!(ready || building) || !!waiting || sending} onClick={() => start("all")}>
                <LayoutGrid className="size-4" /> All angles
              </Button>
              <Button size="lg" className="rounded-full" disabled={!(ready || building) || !n || !!waiting || sending} onClick={() => start("picked")}>
                {sending || waiting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{" "}
                {waiting ? "Starts when your 3D view is ready" : n > 1 ? `Make ${n} angles` : "Make this angle"}
              </Button>
            </div>
          </Panel>
        )}

        {view && ref && <DragView view={view} onUse={takeView} />}


        {sheetIds && ref && <ContactSheet ids={sheetIds} original={ref} />}

        {shots.length > 0 && ref && (
          <section aria-labelledby="any-angle-results" className="pt-2">
            <h3 id="any-angle-results" className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-semibold">
              <Images className="size-3.5" /> Your angles
            </h3>
            <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
              {shots.map((g) => (
                <ShotCard key={g.id} g={g} original={ref} onAgain={again} />
              ))}
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">Every angle is also in your Library.</p>
          </section>
        )}
      </div>
    </ToolShell>
  );
}
