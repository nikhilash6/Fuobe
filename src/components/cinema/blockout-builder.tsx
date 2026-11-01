"use client";

import { Box, Camera, Clapperboard, DoorOpen, Eye, Flag, Footprints, Loader2, Move3d, Pause, Play, Plus, RotateCw, Shapes, SquareDashed, Trash2, Video, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { uploadFile, useAssets } from "@/lib/api";
import {
  BLOCKOUT,
  EXAMPLE_SCENE,
  OPEN_FPS,
  PRIMS,
  blockoutSize,
  cameraAt,
  emptyScene,
  newId,
  newPrim,
  type BlockoutCameraKey,
  type BlockoutPrim,
  type BlockoutScene,
  type PrimKind,
  type Vec3,
} from "@/lib/blockout";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import type { BlockoutEngine, ViewMode } from "./blockout-engine";

/**
 * Blockout to film, the builder (package blockout-film): place grey boxes, walls, a doorway, stairs, a door, a mannequin
 * and meshes from your 3D models; key where they move, where the camera is (lens and handheld shake) and where the beats
 * start; then "Use this blockout" renders the grey box (24 fps, MP4 where the browser can: the cloud's reference clip)
 * and its depth (16 fps: the open engine's guide) in the browser and hands them to the composer.
 */

export interface BuiltBlockout {
  video: string;
  depth: string;
  firstFrame: string;
  seconds: number;
  aspect: string;
  /** The render's own type ("video/mp4" or "video/webm"). */
  type: string;
}

export interface BlockoutBuilderProps {
  initial: BlockoutScene;
  onClose: (scene: BlockoutScene) => void;
  onDone: (built: BuiltBlockout, scene: BlockoutScene) => void;
}

const ADD: { kind: PrimKind; icon: typeof Box }[] = [
  { kind: "box", icon: Box },
  { kind: "wall", icon: SquareDashed },
  { kind: "floor", icon: Shapes },
  { kind: "doorway", icon: DoorOpen },
  { kind: "door", icon: DoorOpen },
  { kind: "stairs", icon: Shapes },
  { kind: "mannequin", icon: Footprints },
];
const ASPECTS = ["16:9", "21:9", "4:3", "1:1", "9:16"];
const fmt = (t: number) => `${t.toFixed(1)} s`;
const near = (a: number, b: number) => Math.abs(a - b) < 0.05;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** A gizmo move: a primitive that moves over time gets a key at the playhead, one that stays is simply moved. */
function movePrim(s: BlockoutScene, id: string, position: Vec3, rotation: number, at: number): BlockoutScene {
  return {
    ...s,
    prims: s.prims.map((p) => {
      if (p.id !== id) return p;
      if (!p.keys?.length) return { ...p, position, rotation };
      const keys = p.keys.filter((k) => !near(k.t, at));
      return { ...p, keys: [...keys, { t: r2(at), position, rotation }].sort((a, b) => a.t - b.t) };
    }),
  };
}

function Field({ label, value, onChange, step = 0.1, min, max }: { label: string; value: number; onChange: (n: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <label className="grid gap-1 text-[11.5px] text-muted-foreground">
      {label}
      <Input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        value={Number.isFinite(value) ? r2(value) : 0}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(min !== undefined || max !== undefined ? Math.max(min ?? -Infinity, Math.min(max ?? Infinity, n)) : n);
        }}
        className="h-8 px-2 text-[13px] tabular-nums"
      />
    </label>
  );
}

function Vec({ label, value, onChange, min }: { label: string; value: Vec3; onChange: (v: Vec3) => void; min?: number }) {
  return (
    <fieldset className="grid gap-1">
      <legend className="mb-1 text-[12px] font-medium">{label}</legend>
      <div className="grid grid-cols-3 gap-1.5">
        {(["x", "y", "z"] as const).map((k, i) => (
          <Field key={k} label={k} value={value[i]} min={min} onChange={(n) => onChange(value.map((x, j) => (j === i ? n : x)) as Vec3)} />
        ))}
      </div>
    </fieldset>
  );
}

export default function BlockoutBuilder({ initial, onClose, onDone }: BlockoutBuilderProps) {
  const [scene, setScene] = useState<BlockoutScene>(initial);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<ViewMode>("edit");
  const [selected, setSelected] = useState<string | null>(null);
  const [gizmo, setGizmo] = useState<"translate" | "rotate">("translate");
  const [lens, setLens] = useState<number>(BLOCKOUT.lens.default);
  const [shake, setShake] = useState(0.3);
  const [busy, setBusy] = useState<{ label: string; p: number } | null>(null);
  const [error, setError] = useState("");
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const engineRef = useRef<BlockoutEngine | null>(null);
  const sceneRef = useRef(scene);
  const tRef = useRef(t);
  const abort = useRef<AbortController | null>(null);
  const meshes = useAssets(undefined, "model3d");
  useEffect(() => {
    sceneRef.current = scene;
    tRef.current = t;
  }, [scene, t]);

  // The engine (three.js) loads with the builder.
  useEffect(() => {
    if (!canvasEl) return;
    let eng: BlockoutEngine | null = null;
    let gone = false;
    void import("./blockout-engine")
      .then(({ BlockoutEngine }) => {
        if (gone) return;
        eng = new BlockoutEngine(canvasEl, {
          onSelect: setSelected,
          onMove: (id, position, rotation) => setScene((s) => movePrim(s, id, position, rotation, tRef.current)),
        });
        engineRef.current = eng;
        eng.setScene(sceneRef.current);
        eng.setTime(tRef.current);
        const r = canvasEl.getBoundingClientRect();
        eng.resize(r.width, r.height);
      })
      .catch((e) => setError(/webgl|context/i.test(String((e as Error)?.message)) ? "This browser can't show 3D here (WebGL is off). Try another browser, or upload a render from your 3D app." : String((e as Error)?.message ?? e)));
    return () => {
      gone = true;
      abort.current?.abort();
      eng?.dispose();
      engineRef.current = null;
    };
  }, [canvasEl]);

  useEffect(() => {
    if (!stageEl) return;
    const ro = new ResizeObserver(([e]) => engineRef.current?.resize(e.contentRect.width, e.contentRect.height));
    ro.observe(stageEl);
    return () => ro.disconnect();
  }, [stageEl]);

  useEffect(() => engineRef.current?.setScene(scene), [scene]);
  useEffect(() => engineRef.current?.setTime(t), [t]);
  useEffect(() => engineRef.current?.setMode(mode), [mode]);
  useEffect(() => engineRef.current?.setGizmo(gizmo), [gizmo]);
  useEffect(() => engineRef.current?.select(selected), [selected]);

  // Play: the playhead runs in real time, then stops at the end.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = tRef.current + (now - last) / 1000;
      last = now;
      if (next >= sceneRef.current.duration) {
        setT(sceneRef.current.duration);
        setPlaying(false);
        return;
      }
      setT(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const patch = (fn: (s: BlockoutScene) => BlockoutScene) => setScene((s) => fn(s));
  const prim = scene.prims.find((p) => p.id === selected) ?? null;
  const updatePrim = (id: string, fn: (p: BlockoutPrim) => BlockoutPrim) => patch((s) => ({ ...s, prims: s.prims.map((p) => (p.id === id ? fn(p) : p)) }));

  const add = (kind: PrimKind, extra: Partial<BlockoutPrim> = {}) => {
    if (scene.prims.length >= BLOCKOUT.maxPrims) {
      toast.error(`A blockout holds up to ${BLOCKOUT.maxPrims} pieces`);
      return;
    }
    const view = engineRef.current?.viewPose();
    const at: Vec3 = view ? [r2(view.target[0]), 0, r2(view.target[2])] : [0, 0, 0];
    const p = { ...newPrim(kind, at), ...extra };
    patch((s) => ({ ...s, prims: [...s.prims, p] }));
    setSelected(p.id);
    setMode("edit");
  };

  const keyHere = (p: BlockoutPrim) => {
    const at = r2(t);
    const cur = { position: p.position, rotation: p.rotation };
    const base = p.keys?.length ? p.keys : at > 0 ? [{ t: 0, ...cur }] : [];
    const keys = [...base.filter((k) => !near(k.t, at)), { t: at, ...cur }].sort((a, b) => a.t - b.t);
    updatePrim(p.id, (x) => ({ ...x, keys }));
    toast(`${p.name} keyed at ${fmt(at)}: move the playhead, then move it to make it walk or swing there`);
  };

  const setCameraKey = () => {
    const view = engineRef.current?.viewPose();
    if (!view) return;
    const at = r2(t);
    const key: BlockoutCameraKey = { t: at, position: view.position, target: view.target, lens, shake };
    patch((s) => {
      if (s.camera.length >= BLOCKOUT.maxCameraKeys && !s.camera.some((k) => near(k.t, at))) {
        toast.error(`Up to ${BLOCKOUT.maxCameraKeys} camera keys`);
        return s;
      }
      return { ...s, camera: [...s.camera.filter((k) => !near(k.t, at)), key].sort((a, b) => a.t - b.t) };
    });
    toast(`Camera keyed at ${fmt(at)} · ${Math.round(lens)} mm${shake ? ` · shake ${Math.round(shake * 100)}%` : ""}`);
  };

  const addMarker = () => {
    const at = r2(t);
    if (scene.markers.length >= BLOCKOUT.maxMarkers) return toast.error(`Up to ${BLOCKOUT.maxMarkers} markers`);
    patch((s) => ({ ...s, markers: [...s.markers.filter((m) => !near(m.t, at)), { id: newId("m"), t: at, label: `Beat ${s.markers.length + 1}` }].sort((a, b) => a.t - b.t) }));
  };

  const shotNow = useMemo(() => cameraAt(scene.camera, t), [scene.camera, t]);

  const render = async () => {
    const eng = engineRef.current;
    if (!eng || busy) return;
    setPlaying(false);
    setMode("shot");
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const grey = blockoutSize(scene.aspect, 1280);
      const small = blockoutSize(scene.aspect, 832);
      setBusy({ label: "Rendering the grey box", p: 0 });
      const g = await eng.render({ kind: "grey", fps: BLOCKOUT.fps, ...grey, preferMp4: true, signal: ctl.signal, onProgress: (p) => setBusy({ label: "Rendering the grey box", p }) });
      setBusy({ label: "Rendering its depth", p: 0 });
      const d = await eng.render({ kind: "depth", fps: OPEN_FPS, ...small, signal: ctl.signal, onProgress: (p) => setBusy({ label: "Rendering its depth", p }) });
      setBusy({ label: "Saving", p: 1 });
      const ext = (type: string) => (type.includes("mp4") ? "mp4" : "webm");
      const [video, depth, first] = await Promise.all([
        uploadFile(new File([g.video], `blockout.${ext(g.type)}`, { type: g.type })),
        uploadFile(new File([d.video], `blockout-depth.${ext(d.type)}`, { type: d.type })),
        uploadFile(new File([g.first!], "blockout-first-frame.png", { type: "image/png" })),
      ]);
      onDone({ video: video.url, depth: depth.url, firstFrame: first.url, seconds: scene.duration, aspect: scene.aspect, type: g.type }, scene);
    } catch (e) {
      if ((e as Error).name !== "AbortError") toastError(e, "Couldn't render the blockout");
    } finally {
      setBusy(null);
      abort.current = null;
    }
  };

  const keyTicks = (list: { t: number }[], cls: string) =>
    list.map((k, i) => <span key={i} aria-hidden className={cn("pointer-events-none absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full", cls)} style={{ left: `${(k.t / scene.duration) * 100}%` }} />);

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose(scene)}>
      <DialogContent showCloseButton={false} className="flex h-[100svh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:max-w-none md:flex-row" onOpenAutoFocus={(e) => e.preventDefault()}>
        <DialogTitle className="sr-only">Blockout builder</DialogTitle>
        <DialogDescription className="sr-only">Place grey boxes, a mannequin and the camera, key their moves and the beats, then render the blockout.</DialogDescription>
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[#161617]">
          <div className="flex items-center gap-2 px-3 py-2 text-white">
            <Clapperboard className="size-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium">Blockout builder</p>
              <p className="truncate text-[11.5px] text-white/65">{mode === "edit" ? "Drag to orbit · click a piece to move it" : "Through the shot camera"}</p>
            </div>
            <div className="inline-flex h-8 shrink-0 rounded-full bg-white/10 p-0.5" role="radiogroup" aria-label="View">
              {(
                [
                  ["edit", "Build", Move3d],
                  ["shot", "Shot", Video],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={mode === id}
                  onClick={() => setMode(id)}
                  className={cn("inline-flex items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium", mode === id ? "bg-white text-black" : "text-white/80 hover:text-white")}
                >
                  <Icon className="size-3.5" /> {label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => !busy && onClose(scene)} className="grid size-9 shrink-0 place-items-center rounded-full hover:bg-white/15" aria-label="Close the builder">
              <X className="size-[18px]" />
            </button>
          </div>
          <div ref={setStageEl} className="relative min-h-[38svh] flex-1 overflow-hidden">
            <canvas ref={setCanvasEl} tabIndex={0} aria-label="Blockout 3D view: drag to orbit, scroll to zoom, click a piece to select it" className="absolute inset-0 size-full touch-none outline-none" />
            {mode === "shot" && (
              <span className="pointer-events-none absolute top-2 left-2 rounded bg-black/55 px-1.5 py-0.5 font-mono text-[11px] text-white/90">
                {scene.aspect} · {Math.round(shotNow.lens)} mm · {fmt(t)}
              </span>
            )}
            {error && <p className="absolute inset-x-4 top-4 rounded-lg bg-black/70 p-3 text-[13px] text-white">{error}</p>}
            {busy && (
              <div className="absolute inset-0 grid place-items-center bg-black/55 text-white" role="status">
                <div className="w-64 max-w-[80%] space-y-2 text-center">
                  <Loader2 className="mx-auto size-5 animate-spin" />
                  <p className="text-[13px]">{busy.label}… {Math.round(busy.p * 100)}%</p>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
                    <div className="h-full bg-white" style={{ width: `${busy.p * 100}%` }} />
                  </div>
                  <Button size="sm" variant="secondary" onClick={() => abort.current?.abort()}>
                    Stop
                  </Button>
                </div>
              </div>
            )}
          </div>
          {/* The timeline: play, scrub, the camera keys (amber) and the beat markers (blue). */}
          <div className="space-y-1.5 border-t border-white/10 px-3 py-2 text-white">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => (t >= scene.duration ? (setT(0), setPlaying(true)) : setPlaying((p) => !p))} className="grid size-8 shrink-0 place-items-center rounded-full bg-white/12 hover:bg-white/20" aria-label={playing ? "Pause" : "Play"}>
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
              <div className="relative min-w-0 flex-1">
                <Slider value={[t]} min={0} max={scene.duration} step={1 / BLOCKOUT.fps} onValueChange={([v]) => (setPlaying(false), setT(v))} aria-label="Playhead" />
                {keyTicks(scene.camera, "bg-amber-400")}
                {keyTicks(scene.markers, "bg-sky-400 ring-2 ring-[#161617]")}
              </div>
              <span className="w-14 shrink-0 text-right font-mono text-[12px] tabular-nums">{fmt(t)}</span>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {scene.markers.map((m) => (
                <button key={m.id} type="button" onClick={() => setT(m.t)} className="h-7 rounded-full bg-sky-500/20 px-2.5 text-[12px] text-sky-100 hover:bg-sky-500/30">
                  <Flag className="mr-1 inline size-3" />
                  {fmt(m.t)} · {m.label}
                </button>
              ))}
              <button type="button" onClick={addMarker} className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-white/30 px-2.5 text-[12px] hover:bg-white/10">
                <Plus className="size-3" /> Marker at {fmt(t)}
              </button>
            </div>
          </div>
        </div>

        <aside className="flex max-h-[46svh] min-h-0 w-full shrink-0 flex-col border-t bg-background md:max-h-none md:w-[340px] md:border-t-0 md:border-l">
          <Tabs defaultValue="build" className="flex min-h-0 flex-1 flex-col gap-0">
            <TabsList className="mx-3 mt-3 grid grid-cols-4">
              <TabsTrigger value="build">Build</TabsTrigger>
              <TabsTrigger value="piece">Piece</TabsTrigger>
              <TabsTrigger value="camera">Camera</TabsTrigger>
              <TabsTrigger value="beats">Beats</TabsTrigger>
            </TabsList>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <TabsContent value="build" className="mt-0 space-y-3">
                <p className="text-[12.5px] text-muted-foreground">Grey boxes stand in for the set; the mannequin for a person. Keep it simple: the references say what everything looks like.</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {ADD.map(({ kind, icon: Icon }) => (
                    <button key={kind} type="button" onClick={() => add(kind)} title={PRIMS[kind].hint} className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[13px] hover:bg-accent">
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      {PRIMS[kind].name}
                    </button>
                  ))}
                  <Popover>
                    <PopoverTrigger asChild>
                      <button type="button" className="flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[13px] hover:bg-accent">
                        <Box className="size-4 shrink-0 text-muted-foreground" /> Your 3D model
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[min(92vw,300px)] p-2" align="start">
                      <p className="px-1 pb-1.5 text-[12px] text-muted-foreground">From Image to 3D and your Library: it stands in grey, scaled to 1 m (resize it under Piece).</p>
                      <div className="max-h-56 space-y-0.5 overflow-y-auto">
                        {(meshes.data ?? []).slice(0, 30).map((a) => (
                          <button key={a.id} type="button" onClick={() => add("mesh", { url: a.url, name: (a.name ?? "Model").replace(/\.glb$/i, "").slice(0, 40) })} className="block w-full truncate rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-accent">
                            {a.name ?? "3D model"}
                          </button>
                        ))}
                        {!meshes.isLoading && !meshes.data?.length && <p className="px-2 py-2 text-[12.5px] text-muted-foreground">No 3D models yet: make one in Image to 3D.</p>}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1 text-[12px] font-medium">
                    Length (s)
                    <Input
                      type="number"
                      min={BLOCKOUT.minSeconds}
                      max={BLOCKOUT.maxSeconds}
                      step={0.5}
                      value={scene.duration}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n)) patch((s) => ({ ...s, duration: Math.max(BLOCKOUT.minSeconds, Math.min(BLOCKOUT.maxSeconds, n)) }));
                      }}
                      className="h-8 text-[13px]"
                    />
                  </label>
                  <label className="grid gap-1 text-[12px] font-medium">
                    Frame
                    <select value={scene.aspect} onChange={(e) => patch((s) => ({ ...s, aspect: e.target.value }))} className="h-8 rounded-md border bg-background px-2 text-[13px]">
                      {ASPECTS.map((a) => (
                        <option key={a}>{a}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => (setScene(structuredClone(EXAMPLE_SCENE)), setT(0), setSelected(null))}>
                    Corridor example
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => (setScene(emptyScene()), setT(0), setSelected(null))}>
                    Start empty
                  </Button>
                </div>
                <ul className="space-y-0.5" aria-label="Pieces">
                  {scene.prims.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => setSelected(p.id)} className={cn("flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[13px] hover:bg-accent", selected === p.id && "bg-brand-faint text-brand-text")}>
                        <span className="truncate">{p.name}</span>
                        <span className="text-[11.5px] text-muted-foreground">{p.keys?.length ? `${p.keys.length} keys` : PRIMS[p.kind].name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </TabsContent>

              <TabsContent value="piece" className="mt-0 space-y-3">
                {!prim ? (
                  <p className="text-[13px] text-muted-foreground">Click a piece in the view, or in the list under Build.</p>
                ) : (
                  <>
                    <Input value={prim.name} onChange={(e) => updatePrim(prim.id, (p) => ({ ...p, name: e.target.value.slice(0, 60) }))} aria-label="Name" className="h-8 text-[13px]" />
                    <div className="inline-flex h-8 rounded-full bg-muted p-0.5" role="radiogroup" aria-label="Gizmo">
                      {(
                        [
                          ["translate", "Move", Move3d],
                          ["rotate", "Turn", RotateCw],
                        ] as const
                      ).map(([id, label, Icon]) => (
                        <button key={id} type="button" role="radio" aria-checked={gizmo === id} onClick={() => setGizmo(id)} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 text-[12.5px] font-medium", gizmo === id ? "bg-background shadow-soft" : "text-muted-foreground")}>
                          <Icon className="size-3.5" /> {label}
                        </button>
                      ))}
                    </div>
                    {!prim.keys?.length && (
                      <>
                        <Vec label="Position (m)" value={prim.position} onChange={(position) => updatePrim(prim.id, (p) => ({ ...p, position }))} />
                        <Field label="Turn (°)" value={prim.rotation} step={5} onChange={(rotation) => updatePrim(prim.id, (p) => ({ ...p, rotation }))} />
                      </>
                    )}
                    <Vec label="Size (m)" value={prim.size} min={0.01} onChange={(size) => updatePrim(prim.id, (p) => ({ ...p, size }))} />
                    <div className="space-y-1.5 rounded-lg bg-muted/60 p-2.5">
                      <p className="text-[12.5px] font-medium">Moves</p>
                      <p className="text-[12px] text-muted-foreground">
                        {prim.keys?.length
                          ? `${prim.keys.length} keys: ${prim.keys.map((k) => fmt(k.t)).join(", ")}. Drag it with the gizmo at another time to add one.`
                          : prim.kind === "door"
                            ? "Key it shut, move the playhead, then turn it open."
                            : "Key it here, move the playhead, then move it: it walks or slides between keys."}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => keyHere(prim)}>
                          Key at {fmt(t)}
                        </Button>
                        {!!prim.keys?.length && (
                          <Button size="sm" variant="ghost" onClick={() => updatePrim(prim.id, (p) => ({ ...p, keys: undefined, position: p.keys![0].position, rotation: p.keys![0].rotation }))}>
                            Clear moves
                          </Button>
                        )}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => (patch((s) => ({ ...s, prims: s.prims.filter((p) => p.id !== prim.id) })), setSelected(null))}>
                      <Trash2 className="size-3.5" /> Remove
                    </Button>
                  </>
                )}
              </TabsContent>

              <TabsContent value="camera" className="mt-0 space-y-3">
                <p className="text-[12.5px] text-muted-foreground">Frame the shot in the Build view, then key the camera at the playhead. Shot shows what the camera films.</p>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[12.5px] font-medium">
                    <span>Lens</span>
                    <span className="font-mono">{Math.round(lens)} mm</span>
                  </div>
                  <Slider value={[lens]} min={BLOCKOUT.lens.min} max={BLOCKOUT.lens.max} step={1} onValueChange={([v]) => setLens(v)} aria-label="Lens" />
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between text-[12.5px] font-medium">
                    <span>Handheld shake</span>
                    <span className="font-mono">{Math.round(shake * 100)}%</span>
                  </div>
                  <Slider value={[shake]} min={0} max={1} step={0.05} onValueChange={([v]) => setShake(v)} aria-label="Handheld shake" />
                </div>
                <Button size="sm" onClick={setCameraKey} className="w-full">
                  <Camera className="size-3.5" /> Key the camera at {fmt(t)}
                </Button>
                <ul className="space-y-1" aria-label="Camera keys">
                  {scene.camera.map((k, i) => (
                    <li key={i} className="flex items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-[12.5px]">
                      <span className="flex-1 tabular-nums">
                        {fmt(k.t)} · {Math.round(k.lens)} mm{k.shake ? ` · shake ${Math.round(k.shake * 100)}%` : ""}
                      </span>
                      <button type="button" onClick={() => (setT(k.t), setLens(k.lens), setShake(k.shake), setMode("edit"), engineRef.current?.viewFromShot(k.t))} className="grid size-7 place-items-center rounded-md hover:bg-accent" aria-label={`Look from the key at ${fmt(k.t)}`}>
                        <Eye className="size-3.5" />
                      </button>
                      <button type="button" disabled={scene.camera.length < 2} onClick={() => patch((s) => ({ ...s, camera: s.camera.filter((_, j) => j !== i) }))} className="grid size-7 place-items-center rounded-md hover:bg-accent disabled:opacity-40" aria-label={`Remove the key at ${fmt(k.t)}`}>
                        <Trash2 className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </TabsContent>

              <TabsContent value="beats" className="mt-0 space-y-2">
                <p className="text-[12.5px] text-muted-foreground">Each marker starts a beat (“Lights out”, “Door kicked”); you write what happens in each next to the composer.</p>
                {scene.markers.map((m) => (
                  <div key={m.id} className="flex items-end gap-1.5">
                    <div className="w-20 shrink-0">
                      <Field label="At (s)" value={m.t} min={0} max={scene.duration} onChange={(n) => patch((s) => ({ ...s, markers: s.markers.map((x) => (x.id === m.id ? { ...x, t: n } : x)).sort((a, b) => a.t - b.t) }))} />
                    </div>
                    <Input value={m.label} onChange={(e) => patch((s) => ({ ...s, markers: s.markers.map((x) => (x.id === m.id ? { ...x, label: e.target.value.slice(0, 80) } : x)) }))} aria-label={`Marker at ${fmt(m.t)}`} className="h-8 flex-1 text-[13px]" />
                    <button type="button" onClick={() => patch((s) => ({ ...s, markers: s.markers.filter((x) => x.id !== m.id) }))} className="grid size-8 place-items-center rounded-md hover:bg-accent" aria-label={`Remove the marker ${m.label}`}>
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
                <Button size="sm" variant="secondary" onClick={addMarker}>
                  <Plus className="size-3.5" /> Marker at {fmt(t)}
                </Button>
              </TabsContent>
            </div>
          </Tabs>
          <div className="border-t p-3">
            <Button className="w-full" disabled={!!busy || !!error} onClick={render}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Clapperboard className="size-4" />} Use this blockout
            </Button>
            <p className="mt-1.5 text-center text-[11.5px] text-muted-foreground">Renders in your browser: the grey box and its depth, {fmt(scene.duration)}</p>
          </div>
        </aside>
      </DialogContent>
    </Dialog>
  );
}
