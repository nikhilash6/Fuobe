"use client";

import { Box, Loader2, PersonStanding } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { FailedTile, PendingTile } from "@/components/studio/feed";
import { MediaSlot, type SlotValue } from "@/components/studio/media-slot";
import { MediaDrop } from "@/components/av/media-drop";
import { Panel, ToolHero, ToolShell } from "@/components/av/tool-shell";
import { SelfHostNote } from "@/components/self-host-note";
import { useCreateGeneration, useEngine, useGenerations, useHydrated, useLikelyVisitor, useModelAccess, useStatus } from "@/lib/api";
import {
  MAX_3D_PROMPT,
  MODEL3D_FEATURE,
  MODEL3D_MODES,
  MODELS_3D,
  RIG_MODEL,
  SIDE_LABELS,
  SIDES_HINT,
  VIEW_SIDES,
  model3dBlocker,
  model3dFor,
  model3dRequest,
  modeOf,
  type Model3dInput,
  type Model3dMode,
  type ViewSide,
} from "@/lib/av/model3d";
import type { Engine, Generation, GenerationRequest } from "@/lib/catalog/types";
import { keepOffered, offered } from "@/lib/model-access";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { priceLine, useRunPreview } from "./hooks";
import { ModelCard } from "./model-card";
import { RefineOption } from "./refine-option";
import { HI3D_MODEL, withRefine, type Hi3dResolution } from "@/lib/av/hi3d";

/**
 * A model's name, the notices its results carry ("Built with DINOv3") and, for open models, the licence the
 * picker shows (the page reads them from the catalog and the manifest).
 */
export interface Model3dInfo {
  name: string;
  notices: string[];
  licence?: { name: string; flags: string[]; notices: string[] };
}

/** What a mode's input looks like before anything is uploaded (the price is asked for with these). */
const PLACEHOLDER = "/api/files/placeholder.png";

const HINTS: Record<Model3dMode, string> = {
  image: "One clear photo → a textured 3D model (.glb) you can spin, download, rig and animate, record as a turntable and turn into a video.",
  multi: "Photos of the same object from 2–4 sides → one 3D model that's right all the way round.",
  text: "Describe one object → a textured 3D model of it.",
  objects: "Name something in a photo → just that object, rebuilt in 3D as it stands.",
  splat: "One photo → a Gaussian splat of the subject: soft, photo-real detail, the background left out.",
};

/**
 * A link's ?model= (from ⌘K) picks that model, its mode and its engine; ?mode= picks a mode; ?model=meshy-rigging
 * (rigging works on a finished model) says where Rig & animate is. Under its own Suspense: it reads the URL.
 */
function UrlModel({ onModel, onMode, onRig }: { onModel: (mode: Model3dMode, engine: Engine, id: string) => void; onMode: (mode: Model3dMode) => void; onRig: () => void }) {
  const params = useSearchParams();
  const id = params.get("model");
  const mode = params.get("mode");
  useEffect(() => {
    const found = id ? modeOf(id) : null;
    if (found && id) onModel(found.mode, found.engine, id);
    else if (id === RIG_MODEL) onRig();
    else if (MODEL3D_MODES.some((m) => m.id === mode)) onMode(mode as Model3dMode);
  }, [id, mode, onModel, onMode, onRig]);
  return null;
}

/** The five modes as one row of pills (wrapping on a phone); arrow keys move between them. */
function ModePicker({ mode, onChange }: { mode: Model3dMode; onChange: (m: Model3dMode) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, by: number) => {
    const i = (from + by + MODEL3D_MODES.length) % MODEL3D_MODES.length;
    onChange(MODEL3D_MODES[i].id);
    refs.current[i]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="Make a 3D model" className="mx-auto mt-6 flex max-w-full flex-wrap justify-center gap-1.5">
      {MODEL3D_MODES.map((m, i) => (
        <button
          key={m.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={mode === m.id}
          tabIndex={mode === m.id ? 0 : -1}
          title={m.hint}
          onClick={() => onChange(m.id)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowDown") {
              e.preventDefault();
              move(i, 1);
            } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
              e.preventDefault();
              move(i, -1);
            }
          }}
          className={cn(
            "h-8 rounded-full border px-3.5 text-[13px] font-medium transition-colors",
            mode === m.id ? "border-foreground bg-foreground text-background" : "bg-background text-muted-foreground hover:border-border-strong hover:text-foreground",
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** Image to 3D: a photo, several photos, words, an object in a photo or a splat → a model to spin, download, rig and animate. */
export function Model3dStudio({ info }: { info: Record<string, Model3dInfo> }) {
  const [engine, setEngine, engineMode] = useEngine();
  // A 3D model is finished on this server, so accounts don't get Image to 3D yet, even on their own GPU or key: said up
  // front, and the uploads and Make it 3D are off, instead of a run the server refuses.
  const visitor = useLikelyVisitor();
  const access = useModelAccess();
  const create = useCreateGeneration();
  const results = useGenerations({ features: [MODEL3D_FEATURE, "app:app-image-to-3d"], limit: 24 });
  const [mode, setMode] = useState<Model3dMode>("image");
  const router = useRouter();
  // A mode picked here goes in the URL (?mode=), so a reload or a shared link opens it again (UrlModel reads it).
  const pickMode = (m: Model3dMode) => {
    setMode(m);
    router.replace(m === "image" ? "/image-to-3d" : `/image-to-3d?mode=${m}`, { scroll: false });
  };
  // The engine is known once the install's engine mode is: no price asked for a cloud model an open-only install refuses.
  const statusKnown = !!useStatus().data;
  const hydrated = useHydrated();
  const engineKnown = statusKnown && hydrated;
  const [photo, setPhoto] = useState<SlotValue | null>(null);
  const [views, setViews] = useState<Partial<Record<ViewSide, SlotValue | null>>>({});
  const [text, setText] = useState("");
  const [object, setObject] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [rigHint, setRigHint] = useState(false);
  // Refine detail · Hi3D 1.0 (open engine, From an image and From several images): the resolution, or off.
  const [refine, setRefine] = useState<Hi3dResolution | null>(null);
  const showRigHint = useCallback(() => setRigHint(true), []);
  const fromUrl = useCallback(
    (m: Model3dMode, e: Engine, id: string) => {
      setMode(m);
      setPicked((p) => ({ ...p, [`${m}:${e}`]: id }));
      setEngine(e);
    },
    [setEngine],
  );
  // Models switched off in Settings → Models & licences leave the menu, and the pick falls back to one that is on.
  const choices = keepOffered(MODELS_3D[mode][engine], (m) => offered(access, m.id, engine));
  const wanted = picked[`${mode}:${engine}`];
  const modelId = model3dFor(mode, engine, wanted && choices.some((m) => m.id === wanted) ? wanted : choices[0]?.id);
  const sides = Object.fromEntries(VIEW_SIDES.flatMap((s) => (views[s] ? [[s, views[s]!.ref]] : []))) as Partial<Record<ViewSide, string>>;
  const input: Model3dInput = { engine, mode, modelId: modelId ?? undefined, photo: photo?.ref, views: sides, prompt: mode === "text" ? text : mode === "objects" ? object : undefined };
  const uploading = !!photo?.uploading || VIEW_SIDES.some((s) => views[s]?.uploading);
  // A guest or an account reads why the button is off, not a step on an upload that is off too.
  const blocker = visitor ? "Image to 3D isn't available here" : (model3dBlocker(input) ?? (uploading ? "Uploading…" : null));
  // The price before anything is attached: placeholders stand in for the files and the words.
  const priced: GenerationRequest | null = modelId
    ? model3dRequest({ ...input, photo: input.photo ?? PLACEHOLDER, views: { front: PLACEHOLDER, left: PLACEHOLDER, ...sides }, prompt: input.prompt?.trim() || "an object" })
    : null;
  const preview = useRunPreview(engineKnown ? priced : null);
  // A free run (open weights) is free on a self-hosted Fuobe: a guest or an account reads that, not "your ComfyUI".
  const free = !!preview.data && !preview.data.demo && (preview.data.engine === "open" || preview.data.costUsd === 0);
  const price = visitor && free ? "Not available here" : priceLine(preview.data);
  const cloudAllowed = engineMode !== "open";
  // Hi3D runs on your GPU only: offered while the install runs open models and the model is switched on.
  const refineAllowed = !visitor && engineMode !== "cloud" && offered(access, HI3D_MODEL, "open");
  const refining = refineAllowed && engine === "open" && (mode === "image" || mode === "multi") && refine !== null ? refine : null;
  const go = () => {
    if (visitor) return;
    if (blocker) return void toast(blocker, { id: "3d-blocker" });
    create.mutate(withRefine(model3dRequest(input), engine, refining), {
      onSuccess: () =>
        toast.success(
          mode === "splat" ? "Making your splat" : mode === "text" && engine === "open" ? "Drawing the object, then building it in 3D" : refining ? "Building your 3D model, then refining its detail" : "Building your 3D model",
        ),
      onError: (e) => toastError(e),
    });
  };
  const licence = modelId ? info[modelId]?.licence : undefined;
  const items = (results.data ?? []).filter((g) => g.feature !== "image-to-3d-step");
  const setSide = (s: ViewSide) => (v: SlotValue | null) => setViews((cur) => ({ ...cur, [s]: v }));
  return (
    <ToolShell title="Image to 3D" selfHostedOnly>
      <Suspense fallback={null}>
        <UrlModel onModel={fromUrl} onMode={setMode} onRig={showRigHint} />
      </Suspense>
      <ToolHero title="Your product, in 3D" subtitle={HINTS[mode]}>
        {visitor && <SelfHostNote className="mt-3 max-w-xl">Image to 3D isn&apos;t available here.</SelfHostNote>}
      </ToolHero>
      <ModePicker mode={mode} onChange={pickMode} />
      {rigHint && (
        <p role="status" className="mx-auto mt-4 max-w-[880px] rounded-2xl border bg-brand-faint px-4 py-3 text-[13px] text-brand-text">
          <PersonStanding className="mr-1.5 inline size-4 align-[-3px]" aria-hidden />
          Rig &amp; animate works on a finished model: make one here
          {items.length > 0 && (
            <>
              {" "}
              or pick one under{" "}
              <a href="#your-3d-models" className="font-medium underline underline-offset-2">
                Your 3D models
              </a>
            </>
          )}
          , then press Rig &amp; animate on its card. Rigging runs on Meshy, in the cloud.
        </p>
      )}
      <div className="mx-auto mt-6 grid max-w-[880px] gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {mode === "multi" ? (
          <Panel title="Photos of each side" aside={<span className="text-[12px] text-muted-foreground">{Object.keys(sides).length} of 4</span>}>
            {/* Four 80 px slots in a row when the panel has room for them (22rem), two by two when it doesn't. */}
            <div className="@container">
              {/* A guest's or an account's photos would be uploaded for a model that can't be made here. */}
              <div inert={visitor} className={cn("grid grid-cols-2 justify-items-center gap-2 @[22rem]:grid-cols-4", visitor && "opacity-50")}>
                {VIEW_SIDES.map((s) => (
                  <div key={s} className="flex flex-col items-center gap-1">
                    <MediaSlot label={SIDE_LABELS[s]} kind="image" value={views[s] ?? null} onChange={setSide(s)} required={s === "front"} size="lg" caption />
                    <span className="text-[11px] text-muted-foreground">{s === "front" ? "Needed" : "Optional"}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-3 text-[12px] text-muted-foreground">
              The front and at least one more side. Same object, same distance and light in each; a plain background helps.
              {engine === "open" && ` The open model puts each photo on the side you add it to. ${SIDES_HINT}`}
            </p>
          </Panel>
        ) : mode === "text" ? (
          <Panel title="Describe the object">
            <Label htmlFor="m3d-text" className="sr-only">
              Describe the object
            </Label>
            <Textarea
              id="m3d-text"
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_3D_PROMPT))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) go();
              }}
              placeholder="A brass ship's lantern with a glass globe and a carry ring"
              className="min-h-28 rounded-xl"
            />
            <p className="mt-2 text-[12px] text-muted-foreground">
              One object: what it is, its material and colours.{engine === "open" && " Qwen-Image 2.1 draws it on a plain background first; the finished model's card links to that still."}
            </p>
          </Panel>
        ) : (
          <div className="grid min-w-0 gap-3">
            <div inert={visitor} className={cn("min-w-0", visitor && "opacity-50")}>
              <MediaDrop
                kind="image"
                value={photo}
                onChange={setPhoto}
                title={mode === "objects" ? "Add a photo" : "Add a photo of the object"}
                hint={mode === "objects" ? "A room, a shelf, a street: anything with the object in it" : "One object, plain background, well lit"}
                compact
              />
            </div>
            {mode === "objects" && (
              <Panel title="What to take out">
                <Label htmlFor="m3d-object" className="sr-only">
                  What to take out
                </Label>
                <Input
                  id="m3d-object"
                  value={object}
                  onChange={(e) => setObject(e.target.value.slice(0, 200))}
                  onKeyDown={(e) => e.key === "Enter" && go()}
                  placeholder="the green armchair"
                  className="h-9 rounded-full"
                />
                <p className="mt-2 text-[12px] text-muted-foreground">Name one thing, or several separated by commas. It&apos;s rebuilt where it stands; the rest of the photo is left out.</p>
              </Panel>
            )}
          </div>
        )}
        <Panel title="Model">
          {!modelId ? (
            <div className="space-y-3 text-[13px]">
              <p className="text-muted-foreground">
                Pick an object runs on SAM 3D Objects, a cloud model; no open model rebuilds one named object yet. On the open engine, crop the photo to the object and use From an image: Pixal3D cuts it out for you.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {cloudAllowed && (
                  <Button size="sm" className="rounded-full" onClick={() => setEngine("cloud")}>
                    Use the cloud
                  </Button>
                )}
                <Button size="sm" variant="outline" className="rounded-full" onClick={() => setMode("image")}>
                  From an image
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="m3d-model" className="sr-only">
                  Model
                </Label>
                <Select value={modelId} onValueChange={(v) => setPicked((p) => ({ ...p, [`${mode}:${engine}`]: v }))}>
                  <SelectTrigger id="m3d-model" className="h-9 w-full rounded-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {choices.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {info[m.id]?.name ?? m.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[12px] text-muted-foreground">{choices.find((m) => m.id === modelId)?.note}</p>
                {!licence && info[modelId]?.notices.length > 0 && <p className="text-[12px] font-medium">{info[modelId].notices.join(" · ")}</p>}
                {licence && licence.notices.length > 0 && <p className="text-[12px] text-muted-foreground">{licence.notices.join(" · ")}</p>}
              </div>
              {(mode === "image" || mode === "multi") && <RefineOption engine={engine} value={refine} onChange={setRefine} openAllowed={refineAllowed} onUseGpu={() => setEngine("open")} />}
              <Button size="lg" className={cn("mt-4 w-full rounded-full", blocker && "bg-muted text-muted-foreground hover:bg-muted")} onClick={go} disabled={create.isPending || visitor}>
                {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Box className="size-4" />} {mode === "splat" ? "Make the splat" : "Make it 3D"}
              </Button>
              <p className="mt-2 text-[12px] text-muted-foreground" aria-live="polite">
                {visitor ? blocker : <>{blocker ? `${blocker} · ` : ""}{preview.isError ? (preview.error as Error).message : (price ?? "Working out the price…")}</>}
              </p>
              <p className="mt-1 text-[12px] text-muted-foreground">
                {mode === "splat"
                  ? engine === "open"
                    ? "Cuts the subject out and comes with an orbit video."
                    : "Cuts the subject out, ready to download."
                  : engine === "open"
                    ? "Comes with a turntable video of your model."
                    : "Download your model, or record a turntable right here."}
              </p>
            </>
          )}
        </Panel>
      </div>
      <section id="your-3d-models" className="mx-auto mt-12 max-w-[880px] scroll-mt-6" aria-labelledby="models3d">
        {(results.isLoading || items.length > 0) && (
          <h3 id="models3d" className="mb-3 font-heading text-[22px]">
            Your 3D models
          </h3>
        )}
        {results.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="aspect-[4/3] rounded-2xl" />
            <Skeleton className="aspect-[4/3] rounded-2xl" />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {items.map((g) => (
              <ResultCard key={g.id} g={g} info={info} cloudAllowed={cloudAllowed} refineAllowed={refineAllowed} />
            ))}
          </div>
        )}
      </section>
    </ToolShell>
  );
}

/** Retry runs the same request; a step of the open text-to-3D chain starts the chain again from the words. */
function retryOf(g: Generation): GenerationRequest {
  const r = g.request;
  if (r.chain?.length && r.op === "image-to-3d" && !r.inputs?.images?.length && r.prompt?.trim()) {
    return { feature: r.feature, modelId: "oss-text-trellis2", op: "text-to-3d", prompt: r.prompt, ...(r.params && { params: r.params }) };
  }
  return r;
}

function ResultCard({ g, info, cloudAllowed, refineAllowed }: { g: Generation; info: Record<string, Model3dInfo>; cloudAllowed: boolean; refineAllowed: boolean }) {
  const create = useCreateGeneration();
  if (g.status === "queued" || g.status === "running") return <PendingTile g={g} ratio={4 / 3} />;
  if (g.status !== "succeeded") return <FailedTile g={g} ratio={4 / 3} onRetry={() => create.mutate(retryOf(g), { onError: (e) => toastError(e) })} />;
  return <ModelCard g={g} info={info} cloudAllowed={cloudAllowed} refineAllowed={refineAllowed} />;
}
