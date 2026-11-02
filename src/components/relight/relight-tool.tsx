"use client";

import { Check, ChevronRight, Clapperboard, Download, ImagePlus, Library, Loader2, PenLine, Save, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { downloadBlob } from "@/components/ads/render";
import { Panel, ToolShell } from "@/components/av/tool-shell";
import { useGeneration } from "@/components/av/use-generation";
import { openConnect } from "@/components/gpu/open-connect";
import { Feed } from "@/components/studio/feed";
import { ACCEPT, LibraryGrid } from "@/components/studio/media-slot";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { askToSignUp, uploadFile, useCreateGeneration, useGenerations, useHydrated, useIsAccount, useIsGuest, useIsOwner, useStatus } from "@/lib/api";
import type { Generation } from "@/lib/catalog/types";
import { DEFAULT_DEMO, type RelightDemo } from "@/lib/relight/demo";
import {
  INTENSITY_CHIPS,
  RELIGHT_BLEND_FEATURE,
  RELIGHT_BLEND_MODEL,
  RELIGHT_MAX_SIDE,
  RELIGHT_MODEL,
  RELIGHT_SCENE_FEATURE,
  RELIGHT_SETTINGS,
  relightRequest,
  sceneRequest,
  type BlendMode,
} from "@/lib/relight/engine";
import { drawGuide, guideSize } from "@/lib/relight/guide";
import {
  defaultLight,
  getLook,
  isLook,
  lightAt,
  lightsOfLook,
  LOOKS,
  lookFromLegacy,
  moveLight,
  promptFor,
  relightExtraOf,
  resultKey,
  seedFor,
  type Light,
  type LookId,
} from "@/lib/relight/lights";
import type { AlignFit } from "@/lib/relight/shader";
import { subjectDepthOf } from "@/lib/relight/shader";
import { responseError, toastError } from "@/lib/refusals";
import { alignPictures } from "./align-client";
import { Chips, LightPanel, LooksRow } from "./relight-panel";
import { fit, greyOf, loadPic, picSize, pixelsOf, RelightRenderer, type Pic } from "./relight-renderer";
import { RelightStage, type StageScene } from "./relight-stage";

/**
 * Relight (the app's own tool): tap the photo to place up to three coloured lights, see them land at once in the
 * browser, then Generate lighting makes the real thing on a GPU and Intensity blends it in, instantly. The page opens
 * on a demo photo with its result shipped, so everyone (guests too) can try the looks and the blend at once.
 */

export const HERO = "Light your photo like a set.";
export const SUB = "Tap to place a light, pick its colour and feel, then generate the real thing. Blend it in as softly or boldly as you like.";
const GUEST_LINE = "Create a free account to light your own photos.";
const NO_GPU_LINE = "Connect your GPU to generate the lighting.";
const HINT_KEY = "fuobe:relight-intensity-hint";

interface Photo {
  /** What results are cached by (and the seed comes from). */
  key: string;
  /** What the stage shows. */
  url: string;
  /** The stored file a run reads (null until uploaded; a guest's photo stays in the browser). */
  serverUrl: string | null;
  file?: File;
  demo?: RelightDemo;
  name: string;
  uploading?: boolean;
}

interface Result {
  url: string;
  pic?: Pic;
  fit?: AlignFit | null;
  genId?: string;
  /** Kept to the Library already (its file). */
  kept?: string;
  tiles?: number;
}

const demoPhoto = (d: RelightDemo): Photo => ({ key: d.photo, url: d.photo, serverUrl: null, demo: d, name: d.alt });
/** The key a demo's shipped result is cached under: its photo and the look it was made with. */
const demoKey = (d: RelightDemo) =>
  `${d.photo}#${resultKey({ prompt: promptFor(lightsOfLook(getLook(d.look)!), null, RELIGHT_SETTINGS.softness), variant: RELIGHT_SETTINGS.variant, seed: seedFor(d.photo), guide: RELIGHT_SETTINGS.guide })}`;


function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    const m = window.matchMedia?.("(pointer: fine)");
    if (!m) return;
    const on = () => setFine(m.matches);
    on();
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return fine;
}

/** The first image a run made, and its depth and matte (a scene read). */
const imageOut = (g?: Generation | null) => g?.outputs.find((o) => o.kind === "image" && !o.meta?.role)?.url ?? g?.outputs.find((o) => o.kind === "image")?.url;
const roleOut = (g: Generation | undefined | null, role: string) => g?.outputs.find((o) => o.meta?.role === role)?.url;
const firstImage = (g: Generation) => g.request?.inputs?.images?.[0];

/** A picture as a File (a demo photo sent to a run is uploaded first, like any other). */
async function fileFrom(url: string, name: string): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("That picture didn't load");
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || "image/jpeg" });
}

/** A photo too big for a run, made smaller first (the blend keeps the original's detail). */
async function smallerFile(file: File, img: HTMLImageElement): Promise<File> {
  const [w, h] = picSize(img);
  if (Math.max(w, h) <= RELIGHT_MAX_SIDE) return file;
  const c = fit(img, RELIGHT_MAX_SIDE) as HTMLCanvasElement;
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.95));
  return blob ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
}

export function RelightTool({ app }: { app?: { name: string; description: string } }) {
  const hydrated = useHydrated();
  const guest = useIsGuest();
  const owner = useIsOwner();
  const account = useIsAccount();
  const status = useStatus().data;
  const gpu = !!status?.viewer?.gpu?.connected;
  const canRun = owner || (account && gpu);
  const fine = useFinePointer();
  const create = useCreateGeneration();

  const [photo, setPhoto] = useState<Photo>(() => demoPhoto(DEFAULT_DEMO));
  const [loaded, setLoaded] = useState<{ url: string; pic: HTMLImageElement } | null>(null);
  const [lights, setLights] = useState<Light[]>(() => lightsOfLook(getLook(DEFAULT_DEMO.look)!));
  const [selected, setSelected] = useState<string | null>("l1");
  const [intensity, setIntensity] = useState<number>(RELIGHT_SETTINGS.intensity);
  const [blend, setBlend] = useState<BlendMode>(RELIGHT_SETTINGS.blend);
  const [glowAsked, setGlowAsked] = useState<boolean | null>(null);
  const [override, setOverride] = useState<string | null>(null);
  const [sceneLoaded, setSceneLoaded] = useState<{ key: string; scene: StageScene } | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [aligning, setAligning] = useState(false);
  // The demo's shipped result, under the key of the look it was made with; then every result seen here.
  const [results, setResults] = useState<Map<string, Result>>(() => new Map([[demoKey(DEFAULT_DEMO), { url: DEFAULT_DEMO.relit }]]));
  const [relit, setRelit] = useState<{ key: string; pic: Pic; fit: AlignFit | null } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [showIntensityHint, setShowIntensityHint] = useState(false);
  const [painted, setPainted] = useState<number | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [took, setTook] = useState<number | null>(null);
  const [saving, setSaving] = useState<"keep" | "download" | null>(null);
  const sceneAsked = useRef(new Set<string>());
  const inputId = useId();
  const promptId = useId();
  const glowId = useId();

  const seed = useMemo(() => seedFor(photo.key), [photo.key]);
  const look: LookId | null = useMemo(() => LOOKS.find((l) => isLook(lights, l))?.id ?? null, [lights]);
  const prompt = promptFor(lights, override, RELIGHT_SETTINGS.softness);
  const key = `${photo.key}#${resultKey({ prompt, variant: RELIGHT_SETTINGS.variant, seed, guide: RELIGHT_SETTINGS.guide })}`;
  const img = loaded?.url === photo.url ? loaded.pic : null;
  const showing = relit?.key === key ? relit : null;
  const glow = glowAsked ?? !showing;

  // The photo's picture.
  useEffect(() => {
    let live = true;
    loadPic(photo.url)
      .then((pic) => live && setLoaded({ url: photo.url, pic }))
      .catch(() => live && toast.error("That picture didn't load"));
    return () => {
      live = false;
    };
  }, [photo.url]);

  // The run going now.
  const run = useGeneration(runId);
  const g = run.data;
  // Earlier runs on this photo (this session or before) and the one just made: their results come back without a run.
  const earlier = useGenerations({ models: [RELIGHT_MODEL], statuses: ["succeeded"], limit: 30 });
  const fromRuns = useMemo(() => {
    const m = new Map<string, Result>();
    if (!photo.serverUrl) return m;
    for (const r of [...(g?.status === "succeeded" ? [g] : []), ...(earlier.data ?? [])]) {
      const out = imageOut(r);
      const ex = relightExtraOf(r.request?.params?.extra);
      if (!out || !ex || firstImage(r) !== photo.serverUrl || !r.request.prompt) continue;
      const k = `${photo.key}#${resultKey({ prompt: r.request.prompt, variant: ex.variant, seed: ex.seed, guide: ex.guide })}`;
      if (!m.has(k)) m.set(k, { url: out, genId: r.id });
    }
    return m;
  }, [g, earlier.data, photo.serverUrl, photo.key]);
  const current = results.get(key) ?? fromRuns.get(key);
  const anyResult = useMemo(() => [...results.keys(), ...fromRuns.keys()].some((k) => k.startsWith(`${photo.key}#`)), [results, fromRuns, photo.key]);

  // The result for these lights, when there is one: loaded and lined up once, then instant.
  useEffect(() => {
    if (!current || !img) return;
    let live = true;
    (async () => {
      let pic = current.pic;
      let fitOf = current.fit;
      if (!pic) pic = await loadPic(current.url);
      if (fitOf === undefined) {
        setAligning(true);
        const a = photo.demo ? null : await alignPictures(img, pic).catch(() => null);
        fitOf = a?.fit ?? null;
        setResults((m) => new Map(m).set(key, { ...current, pic, fit: fitOf, tiles: a?.tiles }));
        setAligning(false);
      }
      if (live) setRelit({ key, pic, fit: fitOf ?? null });
    })().catch(() => {
      setAligning(false);
    });
    return () => {
      live = false;
    };
  }, [current, img, key, photo.demo]);

  // The run finished: what follows it, once (its result comes in through fromRuns).
  useEffect(() => {
    if (!g || g.id !== runId) return;
    if (g.status === "succeeded") {
      if (imageOut(g)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- the run's end is an outside event
        setGlowAsked(null);
        if (startedAt) setTook((Date.now() - startedAt) / 1000);
        try {
          if (!localStorage.getItem(HINT_KEY)) {
            setShowIntensityHint(true);
            localStorage.setItem(HINT_KEY, "1");
          }
        } catch {}
      }
      setRunId(null);
    } else if (g.status === "failed") {
      setRunId(null);
      toast.error(g.error ?? "The lighting didn't come out. Please try again.");
    }
  }, [g, runId, startedAt]);

  // The scene read: once per stored photo, on the viewer's own GPU (or the studio's for its owner).
  const scenes = useGenerations({ features: [RELIGHT_SCENE_FEATURE], statuses: ["succeeded"], limit: 30, steps: true }, {});
  const sceneRun = useGeneration(sceneId);
  const sceneGen = useMemo(() => {
    if (sceneRun.data?.status === "succeeded" && firstImage(sceneRun.data) === photo.serverUrl) return sceneRun.data;
    return photo.serverUrl ? scenes.data?.find((s) => firstImage(s) === photo.serverUrl) : undefined;
  }, [sceneRun.data, scenes.data, photo.serverUrl]);
  useEffect(() => {
    const url = photo.serverUrl;
    if (!url || !canRun || sceneGen || !scenes.isFetched || sceneAsked.current.has(url)) return;
    sceneAsked.current.add(url);
    create.mutate(sceneRequest(url), {
      onSuccess: (items) => setSceneId(items[0]?.id ?? null),
      // The preview stays flat: nothing to say to the visitor.
      onError: () => {},
    });
    // create is stable enough; a new photo or viewer asks again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.serverUrl, canRun, sceneGen, scenes.isFetched]);
  const sceneUrls = useMemo(() => {
    if (photo.demo?.depth && photo.demo.matte) return { depth: photo.demo.depth, matte: photo.demo.matte };
    const depth = roleOut(sceneGen, "depth");
    const matte = roleOut(sceneGen, "matte");
    return depth && matte ? { depth, matte } : null;
  }, [photo.demo, sceneGen]);
  const sceneKey = sceneUrls ? `${sceneUrls.depth}|${sceneUrls.matte}` : null;
  const scene = sceneLoaded && sceneLoaded.key === sceneKey ? sceneLoaded.scene : null;
  useEffect(() => {
    if (!sceneUrls || !sceneKey) return;
    let live = true;
    Promise.all([loadPic(sceneUrls.depth), loadPic(sceneUrls.matte)])
      .then(([depth, matte]) => {
        if (!live) return;
        const d = greyOf(depth, 128, 128);
        const m = greyOf(matte, 128, 128);
        setSceneLoaded({ key: sceneKey, scene: { depth, matte, subjectDepth: subjectDepthOf(d, m) } });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [sceneUrls, sceneKey]);

  // ?image= from the Library, Edit or Live edit (and ?gen= puts that run's lights back), read once.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const url = q.get("image");
    const gen = q.get("gen");
    if (url?.startsWith("/api/files/")) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the address is read once after hydration
      setPhoto({ key: url, url, serverUrl: url, name: decodeURIComponent(url.split("/").pop() ?? "Photo") });
    }
    if (gen && /^[\w-]{4,40}$/.test(gen)) {
      fetch(`/api/generations/${gen}`)
        .then((r) => (r.ok ? (r.json() as Promise<Generation>) : null))
        .then((prev) => {
          // A run of this tool (its lights), or of the Relight app before it (its look).
          if (!prev || (prev.presetId !== "app-relight" && !relightExtraOf(prev.request?.params?.extra))) return;
          const ex = relightExtraOf(prev.request?.params?.extra);
          const old = lookFromLegacy(prev.request?.presetOptions?.light);
          const ls = ex?.lights ?? (old ? lightsOfLook(old) : null);
          if (ls?.length) {
            setLights(ls);
            setSelected(ls[0].id);
          }
          if (ex?.typed && prev.request.prompt) setOverride(prev.request.prompt);
        })
        .catch(() => {});
    }
  }, []);

  const changeLights = (next: Light[]) => {
    setLights(next);
    setShowIntensityHint(false);
  };
  const updateLight = (l: Light) => changeLights(lights.map((x) => (x.id === l.id ? l : x)));
  const removeLight = (id: string) => {
    const next = lights.filter((l) => l.id !== id);
    changeLights(next);
    setSelected(next[0]?.id ?? null);
  };
  const addAt = (x: number, y: number) => {
    // An empty spot gets a new light (a tap on a light selects it: the stage handles that).
    const l = lightAt(lights, x, y);
    if (!l) return void toast("Up to 3 lights. Tap one to move or change it.");
    changeLights([...lights, l]);
    setSelected(l.id);
  };
  const addDefault = () => {
    const l = defaultLight(lights);
    if (!l) return;
    changeLights([...lights, l]);
    setSelected(l.id);
  };
  const pickLook = (id: LookId) => {
    const lk = getLook(id);
    if (!lk) return;
    const ls = lightsOfLook(lk);
    changeLights(ls);
    setSelected(ls[0]?.id ?? null);
    setOverride(null);
  };

  const takeFile = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return void toast("Pick a photo (PNG, JPEG or WebP)");
    const url = URL.createObjectURL(f);
    const p: Photo = { key: `file:${f.name}:${f.size}:${f.lastModified}`, url, serverUrl: null, file: f, name: f.name, uploading: canRun };
    setPhoto(p);
    setRelit(null);
    setRunId(null);
    if (!lights.length) addDefaultFor();
    if (!canRun) return;
    try {
      const pic = await loadPic(url);
      const asset = await uploadFile(await smallerFile(f, pic));
      setPhoto((cur) => (cur.key === p.key ? { ...cur, serverUrl: asset.url, uploading: false } : cur));
    } catch (e) {
      setPhoto((cur) => (cur.key === p.key ? { ...cur, uploading: false } : cur));
      toastError(e);
    }
  };
  const addDefaultFor = () => {
    const ls = lightsOfLook(getLook("golden-hour")!);
    setLights(ls);
    setSelected(ls[0].id);
  };

  /** The stored file a run reads: uploads the photo first when it isn't stored yet. */
  const ensureServerPhoto = async (): Promise<string> => {
    if (photo.serverUrl) return photo.serverUrl;
    const file = photo.file ?? (await fileFrom(photo.url, `${photo.demo?.id ?? "photo"}.jpg`));
    const asset = await uploadFile(img ? await smallerFile(file, img) : file);
    setPhoto((cur) => (cur.key === photo.key ? { ...cur, serverUrl: asset.url } : cur));
    return asset.url;
  };

  /** The light-guide picture, stored (only when the engine takes it). */
  const guideFile = async (): Promise<string | null> => {
    if (!RELIGHT_SETTINGS.guide || !img) return null;
    const [w, h] = picSize(img);
    const s = guideSize(w, h);
    const px = pixelsOf(img, s.width, s.height);
    const matte = scene ? greyOf(scene.matte, s.width, s.height) : null;
    const out = drawGuide(px, s.width, s.height, lights, matte);
    const c = document.createElement("canvas");
    c.width = s.width;
    c.height = s.height;
    c.getContext("2d")!.putImageData(new ImageData(out, s.width, s.height), 0, 0);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
    if (!blob) return null;
    return (await uploadFile(new File([blob], "light-guide.png", { type: "image/png" }))).url;
  };

  const generate = useCallback(async () => {
    if (!lights.length) return void toast("Place a light first: tap the photo");
    if (guest) {
      setHint(GUEST_LINE);
      return void askToSignUp("run");
    }
    if (account && !gpu) {
      setHint(NO_GPU_LINE);
      return void openConnect();
    }
    if (current) return;
    setHint(null);
    try {
      const url = await ensureServerPhoto();
      const guide = await guideFile();
      const req = relightRequest({ photo: url, guide, lights, look: look ?? undefined, promptOverride: override, seed });
      setStartedAt(Date.now());
      setTook(null);
      create.mutate(req, {
        onSuccess: (items) => setRunId(items[0]?.id ?? null),
        onError: (e) => toastError(e),
      });
    } catch (e) {
      toastError(e);
    }
    // The values it reads are listed; the helpers read the same state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lights, guest, account, gpu, current, look, override, seed, photo, img, scene]);

  /** The blend at the photo's full size, as a PNG. */
  const renderFull = async (): Promise<Blob> => {
    if (!img || !showing) throw new Error("Nothing to save yet");
    const c = document.createElement("canvas");
    const r = new RelightRenderer(c);
    try {
      const [w, h] = picSize(img);
      const s = Math.min(1, r.maxSize / Math.max(w, h));
      const W = Math.round(w * s);
      const H = Math.round(h * s);
      r.set("uPhoto", fit(img, r.maxSize));
      r.set("uRelit", showing.pic);
      if (scene) {
        r.set("uDepth", scene.depth);
        r.set("uMatte", scene.matte);
      }
      r.draw(
        {
          lights,
          intensity,
          aspect: w / h,
          scene: { hasScene: !!scene, subjectDepth: scene?.subjectDepth ?? 0.5 },
          mode: "result",
          blend,
          glow: false,
          original: false,
          align: showing.fit ?? undefined,
          ambient: RELIGHT_SETTINGS.ambient,
        },
        W,
        H,
      );
      const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
      if (!blob) throw new Error("Couldn't make the picture");
      return blob;
    } finally {
      r.dispose();
    }
  };
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const download = async () => {
    setSaving("download");
    try {
      downloadBlob(await renderFull(), `relight-${stamp()}.png`);
    } catch (e) {
      toastError(e);
    } finally {
      setSaving(null);
    }
  };
  /** Keeps the blend: the owner's Library (a local result), an account's own uploads. Returns its file. */
  const keep = async (): Promise<string | null> => {
    if (current?.kept) return current.kept;
    setSaving("keep");
    try {
      const file = new File([await renderFull()], `relight-${stamp()}.png`, { type: "image/png" });
      const asset = await uploadFile(file);
      if (owner) {
        const res = await fetch("/api/generations/local", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            feature: RELIGHT_BLEND_FEATURE,
            modelId: RELIGHT_BLEND_MODEL,
            op: "relight",
            prompt: promptFor(lights, override, RELIGHT_SETTINGS.softness),
            inputs: { images: [photo.serverUrl ?? asset.url] },
            params: { extra: { relight: { lights, ...(look && { look }), seed, variant: RELIGHT_SETTINGS.variant, intensity, blend, ...(current?.genId && { parent: current.genId }) } } },
            output: { url: asset.url, kind: "image", contentType: "image/png" },
          }),
        });
        if (!res.ok) throw responseError(res, ((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Couldn't save");
      }
      setResults((m) => (current ? new Map(m).set(key, { ...current, kept: asset.url }) : m));
      toast.success("Saved to your Library");
      return asset.url;
    } catch (e) {
      toastError(e);
      return null;
    } finally {
      setSaving(null);
    }
  };
  const keepThen = async (to: (url: string) => string) => {
    const url = await keep();
    if (url) window.location.assign(to(url));
  };

  const busy = !!runId || create.isPending;
  const sceneBusy = !!sceneId && sceneRun.data?.status !== "succeeded" && sceneRun.data?.status !== "failed";
  const line = busy ? "Lighting your photo…" : aligning ? "Lining it up…" : sceneBusy ? "Reading the scene…" : photo.uploading ? "Uploading…" : null;
  const keeper = owner || (account && gpu);
  const changed = anyResult && !current;
  const [pw, ph] = img ? picSize(img) : [photo.demo?.width ?? 4, photo.demo?.height ?? 3];

  return (
    <ToolShell
      title={app ? "Apps" : "Relight"}
      engineSwitch={false}
      wide
      header={
        app ? (
          <nav aria-label="Breadcrumb" className="hidden items-center gap-1 text-[13px] text-muted-foreground sm:flex">
            <Link href="/apps" className="hover:text-foreground">
              Apps
            </Link>
            <ChevronRight className="size-3.5" />
            <span className="text-foreground">{app.name}</span>
          </nav>
        ) : undefined
      }
    >
      <div className="pt-3 pb-2 sm:pt-6">
        <h2 className="font-heading text-[26px] leading-tight text-balance sm:text-[34px]">{HERO}</h2>
        <p className="mt-1 hidden max-w-2xl text-[13px] text-pretty text-muted-foreground sm:block">{SUB}</p>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="space-y-2 max-lg:sticky max-lg:top-14 max-lg:z-10 max-lg:-mx-3 max-lg:bg-background/95 max-lg:px-3 max-lg:pb-2 max-lg:backdrop-blur lg:sticky lg:top-20">
          <div className="mx-auto w-full max-lg:max-w-[calc(40svh*var(--ar))]" style={{ "--ar": String(pw / Math.max(1, ph)) } as React.CSSProperties}>
            <RelightStage
              photo={img}
              alt={photo.demo?.alt ?? "Your photo"}
              relit={showing?.pic ?? null}
              align={showing?.fit ?? null}
              scene={scene}
              lights={lights}
              selected={selected}
              intensity={intensity}
              blend={blend}
              glow={glow}
              ambient={RELIGHT_SETTINGS.ambient}
              status={line}
              working={busy}
              onTap={addAt}
              onSelect={setSelected}
              onMove={(id, x, y) => {
                const l = lights.find((o) => o.id === id);
                if (l) updateLight(moveLight(l, x, y));
              }}
              onRemove={removeLight}
              onAddDefault={addDefault}
              onGenerate={() => void generate()}
              onOpenLight={() => document.getElementById("relight-light-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" })}
              onPainted={(ms) => setPainted(ms)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            <span className="max-sm:hidden">{fine ? "Click to place a light. Drag to move it." : "Tap the photo to place a light"}</span>
            <span className="sm:hidden">Tap the photo to place a light · hold to see the original</span>
            {changed && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-faint px-2.5 py-1 text-[12px] font-medium text-brand-text" data-testid="lights-changed">
                Lights changed
                <button type="button" className="underline underline-offset-2" onClick={() => void generate()} disabled={busy}>
                  Generate again
                </button>
              </span>
            )}
            {owner && (
              <span className="ml-auto font-mono text-[11px]" data-testid="relight-owner-status">
                {RELIGHT_SETTINGS.variant}
                {took ? ` · ${took.toFixed(1)} s` : ""}
                {current?.tiles ? ` · ${current.tiles} tiles` : ""}
                {showing?.fit ? ` · shift ${(showing.fit.tx * pw).toFixed(1)}, ${(showing.fit.ty * ph).toFixed(1)} px` : ""}
                {scene ? " · depth" : " · flat"}
                {painted !== null ? ` · ${painted.toFixed(1)} ms` : ""}
              </span>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <Panel>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" className="h-11 rounded-full sm:h-9" onClick={() => document.getElementById(inputId)?.click()}>
                  <ImagePlus className="size-3.5" /> Use your photo
                </Button>
                {hydrated && !guest && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" className="h-11 rounded-full sm:h-9">
                        <Library className="size-3.5" /> From your Library
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[min(92vw,360px)] p-2" collisionPadding={12}>
                      <LibraryGrid
                        kinds={["image"]}
                        onPick={(v) => {
                          if (!v.ref.startsWith("/api/files/")) return;
                          setPhoto({ key: v.ref, url: v.ref, serverUrl: v.ref, name: v.name ?? "Photo" });
                          setRelit(null);
                          if (!lights.length) addDefaultFor();
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                )}
                {!photo.demo && (
                  <Button
                    variant="ghost"
                    className="h-11 rounded-full text-muted-foreground sm:h-9"
                    onClick={() => {
                      setPhoto(demoPhoto(DEFAULT_DEMO));
                      pickLook(DEFAULT_DEMO.look);
                    }}
                  >
                    Back to the sample
                  </Button>
                )}
                <input
                  id={inputId}
                  type="file"
                  accept={ACCEPT.image}
                  hidden
                  onChange={(e) => {
                    void takeFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
              <LooksRow look={look} onLook={pickLook} />
              {!look && lights.length > 0 && <p className="-mt-2 text-[12px] text-muted-foreground">Your lights</p>}
            </div>
          </Panel>

          <Panel title="Light">
            <LightPanel lights={lights} selected={selected} onSelect={setSelected} onChange={updateLight} onRemove={removeLight} onAdd={addDefault} fine={fine} />
          </Panel>

          <Panel title="Intensity" aside={<span className="font-mono text-[12px] text-muted-foreground tabular-nums">{Math.round(intensity * 100)} %</span>}>
            <div className="space-y-3">
              <Chips
                label="Intensity"
                value={(INTENSITY_CHIPS as readonly number[]).includes(intensity) ? intensity : null}
                options={INTENSITY_CHIPS.map((v) => ({ value: v, label: `${Math.round(v * 100)} %` }))}
                onChange={setIntensity}
              />
              {fine && (
                <Slider aria-label="Intensity" aria-valuetext={`${Math.round(intensity * 100)} %`} min={0} max={100} step={1} value={[Math.round(intensity * 100)]} onValueChange={([v]) => setIntensity(v / 100)} />
              )}
              {showIntensityHint && <p className="text-[12px] text-muted-foreground">Intensity mixes your original with the new light. It changes instantly.</p>}
              <div className="flex min-h-11 items-center gap-2">
                <Switch id={glowId} checked={glow} onCheckedChange={setGlowAsked} />
                <label htmlFor={glowId} className="text-[13px]">
                  Glow
                </label>
              </div>
              {owner && (
                <Chips
                  label="Blend"
                  value={blend}
                  options={[
                    { value: "transfer" as BlendMode, label: "Light transfer" },
                    { value: "mix" as BlendMode, label: "Plain mix" },
                  ]}
                  onChange={setBlend}
                />
              )}
            </div>
          </Panel>

          <details className="group rounded-2xl border bg-background p-3 shadow-soft sm:p-4">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-[13px] font-semibold sm:min-h-0">
              <label htmlFor={promptId} className="cursor-pointer">
                Prompt
              </label>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{override?.trim() ? "edited" : "auto"}</span>
            </summary>
            <Textarea
              id={promptId}
              className="mt-3 min-h-28 text-[13px]"
              value={override ?? promptFor(lights, null, RELIGHT_SETTINGS.softness)}
              onChange={(e) => setOverride(e.target.value)}
            />
            {override !== null && (
              <Button variant="ghost" size="sm" className="mt-2 rounded-full" onClick={() => setOverride(null)}>
                <Wand2 className="size-3.5" /> Back to auto
              </Button>
            )}
          </details>

          <div className="space-y-2">
            <Button size="lg" className="h-12 w-full rounded-full" onClick={() => void generate()} disabled={busy || !lights.length || photo.uploading}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : current ? <Check className="size-4" /> : <Sparkles className="size-4" />}
              {busy ? "Lighting your photo…" : current ? "Lit with these lights" : changed ? "Generate again" : "Generate lighting"}
            </Button>
            {hint && (
              <p className="text-center text-[12px] text-muted-foreground" role="status">
                {hint}
              </p>
            )}
          </div>

          {showing && (
            <Panel title="Your lit photo">
              <div className="flex flex-wrap gap-2">
                {keeper && (
                  <Button className="h-11 rounded-full sm:h-9" onClick={() => void keep()} disabled={!!saving || !!current?.kept}>
                    {saving === "keep" ? <Loader2 className="size-3.5 animate-spin" /> : current?.kept ? <Check className="size-3.5" /> : <Save className="size-3.5" />}
                    {current?.kept ? "Kept" : "Keep"}
                  </Button>
                )}
                <Button variant="outline" className="h-11 rounded-full sm:h-9" onClick={() => void download()} disabled={!!saving}>
                  {saving === "download" ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />} Download
                </Button>
                {keeper && (
                  <>
                    <Button variant="outline" className="h-11 rounded-full sm:h-9" onClick={() => void keepThen((u) => `/edit?image=${encodeURIComponent(u)}`)} disabled={!!saving}>
                      <PenLine className="size-3.5" /> Edit
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 rounded-full sm:h-9"
                      onClick={() => void keepThen((u) => `/live-edit?image=${encodeURIComponent(u)}${current?.genId ? `&gen=${encodeURIComponent(current.genId)}` : ""}&from=relight`)}
                      disabled={!!saving}
                    >
                      <Wand2 className="size-3.5" /> Live edit
                    </Button>
                    <Button variant="outline" className="h-11 rounded-full sm:h-9" onClick={() => void keepThen((u) => `/video?image=${encodeURIComponent(u)}`)} disabled={!!saving}>
                      <Clapperboard className="size-3.5" /> Animate
                    </Button>
                  </>
                )}
              </div>
            </Panel>
          )}
        </div>
      </div>
      <Results />
    </ToolShell>
  );
}

/** Earlier lightings (and kept blends). */
function Results() {
  const items = useGenerations({ models: [RELIGHT_MODEL, RELIGHT_BLEND_MODEL], limit: 12 });
  if (!items.data?.length) return null;
  return (
    <section className="mx-auto mt-10 max-w-[1240px]" aria-labelledby="relight-results">
      <h3 id="relight-results" className="mb-3 font-heading text-[22px]">
        Your lit photos
      </h3>
      <Feed items={items.data} />
    </section>
  );
}

