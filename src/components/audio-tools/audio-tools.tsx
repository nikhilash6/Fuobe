"use client";

import { ArrowDown, ArrowUp, AudioLines, Cpu, Library, Loader2, Merge, Plus, Repeat, Upload, X } from "lucide-react";
import { nanoid } from "nanoid";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Feed } from "@/components/studio/feed";
import { ACCEPT, fileToList, fileToSlot, kindOfFile, LibraryGrid, wrongKindMessage, type SlotValue } from "@/components/studio/media-slot";
import { Segmented } from "@/components/faceless/controls";
import { Panel, ToolHero, ToolShell } from "@/components/av/tool-shell";
import { useDraft } from "@/components/av/use-draft";
import { useAskBeforeUpload, useEngine, useGenerations } from "@/lib/api";
import {
  clock,
  CROSSFADE_MAX,
  DEFAULT_JOIN_CROSSFADE,
  DEFAULT_LOOP_CROSSFADE,
  JOIN_FEATURE,
  JOIN_MAX_CLIPS,
  LOOP_FEATURE,
  LOOP_MAX_SECONDS,
  LOOP_PRESETS,
  type AudioToolPreview,
} from "@/lib/av/audio-tools";
import { cloudLoopLength, cloudLoopPasses } from "@/lib/av/crossfade";
import { parseCueTime } from "@/lib/av/cue-edit";
import type { Engine } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { useAudioToolPreview, useAudioToolRun, useSettled, type AudioToolBody } from "./hooks";

/**
 * Audio → Loop / extend and Audio → Join (r4/faceless-plus). A clip looped to a length, or clips joined in
 * order: crossfaded on the open engine (ComfyUI core audio nodes, CPU), whole plays and hard joins on the
 * cloud (fal merge-audios). The server plans and prices every change (src/lib/av/audio-tools.ts); results
 * land in the feed below and the Library.
 */

type Curve = "equal-power" | "linear";
type Clip = SlotValue & { duration?: number };

const money = (p: AudioToolPreview, engine: Engine) =>
  p.demo ? "Placeholder · free" : engine === "open" ? "Free" : p.costUsd === null ? "Price unknown" : p.costUsd < 0.01 ? "Under $0.01" : `≈ $${p.costUsd.toFixed(2)}`;

const nameOf = (c: Clip) => (c.name ?? "Audio clip").replace(/\.[a-z0-9]{2,4}$/i, "");

/** A clip handed over in the address (/audio/loop?audio=/api/files/… from a result's "Loop / extend"), read once after hydration. */
function useHandoff(take: (clip: Clip) => void) {
  useEffect(() => {
    const url = new URLSearchParams(window.location.search).get("audio");
    if (url?.startsWith("/api/files/")) take({ ref: url, preview: url, kind: "audio", id: nanoid(8) });
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** The length the browser reads from a clip's header (fills in until the server reads it too). */
function AudioPlayer({ clip, onDuration, className }: { clip: Clip; onDuration: (s: number) => void; className?: string }) {
  return (
    <audio
      key={clip.preview}
      src={clip.preview}
      controls
      preload="metadata"
      onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0 && onDuration(e.currentTarget.duration)}
      className={cn("h-9 w-full min-w-0", className)}
      aria-label={`Play ${nameOf(clip)}`}
    />
  );
}

/** Upload or pick audio from the library (a drop zone when empty, a button row otherwise). */
function AddAudio({ multiple, onFiles, onPick, compact, disabled }: { multiple?: boolean; onFiles: (files: File[]) => void; onPick: (v: SlotValue) => void; compact?: boolean; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [picking, setPicking] = useState(false);
  // A guest, or an account with neither its own GPU nor its own key, gets its card instead of the file chooser.
  const askFirst = useAskBeforeUpload();
  const take = (list: FileList | null | undefined) => {
    const files = [...(list ?? [])];
    if (!files.length || askFirst()) return;
    const audio = files.filter((f) => kindOfFile(f) === "audio");
    if (files.length > audio.length) toast(wrongKindMessage("audio"));
    if (audio.length) onFiles(multiple ? audio : audio.slice(0, 1));
  };
  const buttons = (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      <Button size="sm" variant={compact ? "outline" : "default"} className="rounded-full" onClick={() => askFirst() || input.current?.click()} disabled={disabled}>
        {compact ? <Plus className="size-3.5" /> : <Upload className="size-3.5" />} {compact ? "Add a clip" : multiple ? "Upload audio clips" : "Upload audio"}
      </Button>
      <Popover open={picking} onOpenChange={setPicking}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="rounded-full" disabled={disabled}>
            <Library className="size-3.5" /> From library
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(92vw,360px)] p-2" collisionPadding={12}>
          <p className="px-1 pb-2 text-[13px] font-medium">From your library</p>
          {picking && (
            <LibraryGrid
              kinds={["audio"]}
              onPick={(v) => {
                onPick(v);
                setPicking(false);
              }}
            />
          )}
        </PopoverContent>
      </Popover>
      <input
        ref={input}
        type="file"
        accept={ACCEPT.audio}
        multiple={multiple}
        hidden
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
  if (compact) return buttons;
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border-strong bg-background px-4 py-10 text-center transition-colors sm:py-14",
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
        take(e.dataTransfer.files);
      }}
    >
      <span className="grid size-12 place-items-center rounded-2xl bg-brand-faint text-brand-text">{over ? <Upload className="size-5" /> : <AudioLines className="size-5" />}</span>
      <div>
        <p className="text-[15px] font-medium">{multiple ? "Add the clips to join" : "Add a clip to loop"}</p>
        <p className="mt-1 text-[13px] text-muted-foreground">WAV, MP3, FLAC, M4A or OGG up to 200 MB{multiple ? `, ${JOIN_MAX_CLIPS} clips at most` : ""}</p>
      </div>
      {buttons}
    </div>
  );
}

/** A length typed as m:ss (or seconds), committed on blur or Enter. */
function LengthField({ value, onCommit, max }: { value: number; onCommit: (s: number) => void; max: number }) {
  const id = useId();
  const [text, setText] = useDraft(clock(value));
  const commit = () => {
    const t = parseCueTime(text);
    if (t === null || t <= 0) return setText(clock(value));
    onCommit(Math.min(max, t));
  };
  return (
    <label htmlFor={id} className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
      Length
      <input
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        inputMode="decimal"
        aria-describedby={`${id}-hint`}
        className="h-8 w-20 rounded-full border bg-background px-2.5 text-center font-mono text-[12px] text-foreground tabular-nums outline-none focus:border-primary focus:ring-2 focus:ring-brand-faint"
      />
      <span id={`${id}-hint`} className="sr-only">
        Minutes and seconds, up to {clock(max)}
      </span>
    </label>
  );
}

/** The longest crossfade offered when the clips allow up to `max` seconds (half-second steps). */
const crossfadeTop = (max: number) => Math.max(0.5, Math.min(CROSSFADE_MAX, Math.floor(max * 2) / 2));

/** Crossfade length and fade shape (open engine; the cloud has no crossfade, the run bar says so). */
function CrossfadeControls({ value, onChange, curve, onCurve, max }: { value: number; onChange: (v: number) => void; curve: Curve; onCurve: (c: Curve) => void; max: number }) {
  const top = crossfadeTop(max);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="w-24 shrink-0 text-[13px]">Crossfade</span>
        <Slider min={0.5} max={top} step={0.5} value={[Math.min(value, top)]} onValueChange={([v]) => onChange(v)} aria-label="Crossfade, seconds" className="min-w-0 flex-1" />
        <span className="w-12 shrink-0 text-right font-mono text-[12px] tabular-nums">{Math.min(value, top).toFixed(1)} s</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-24 shrink-0 text-[13px]">Fade shape</span>
        <Segmented
          label="Fade shape"
          value={curve}
          onChange={onCurve}
          options={[
            { value: "equal-power", label: "Music and voices", hint: "Equal power: an even loudness through the seam" },
            { value: "linear", label: "Steady sound", hint: "Linear: no bump where near-identical sound overlaps (drones, ambience, room tone)" },
          ]}
        />
      </div>
    </div>
  );
}

/** The run bar: what will happen, what it costs, and the button (on the cloud, a way to the open engine's crossfades). */
function RunBar({
  label,
  icon: Icon,
  blocker,
  preview,
  engine,
  onRun,
  pending,
  onOpenEngine,
}: {
  label: string;
  icon: typeof Repeat;
  blocker: string | null;
  preview: ReturnType<typeof useAudioToolPreview>;
  engine: Engine;
  onRun: () => void;
  pending: boolean;
  /** Set when the install offers both engines. */
  onOpenEngine?: () => void;
}) {
  const error = preview.error ? (preview.error as Error).message : null;
  const p = preview.data;
  const shown = blocker ?? error;
  return (
    <div className="space-y-2">
      {!shown && p && (
        <div className="space-y-1 text-[13px] text-muted-foreground" aria-live="polite">
          <p>{p.summary}</p>
          {p.notes.map((n) => (
            <p key={n} className="text-[12px]">
              {n}
            </p>
          ))}
          {engine === "cloud" && onOpenEngine && (
            <Button variant="outline" size="sm" className="mt-1 rounded-full" onClick={onOpenEngine}>
              <Cpu className="size-3.5" /> Use open source for crossfades
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <p className={cn("min-w-0 flex-1 text-[13px]", error && !blocker ? "text-destructive" : "text-muted-foreground")} aria-live="polite">
          {shown ??
            (p ? (
              <>
                {p.length !== null && <span className="font-mono text-foreground">{clock(p.length)}</span>}
                {p.length !== null && " · "}
                <span className="font-mono text-foreground">{money(p, engine)}</span>
              </>
            ) : (
              "Pricing…"
            ))}
        </p>
        <Button size="lg" className={cn("rounded-full", (blocker || error) && "bg-muted text-subtle-foreground hover:bg-muted")} onClick={onRun} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />} {label}
        </Button>
      </div>
    </div>
  );
}

/** The loop at a glance: each pass of the clip, the crossfaded seams (open) or where the asked length ends (cloud). */
function LoopBar({ clip, target, crossfade, engine }: { clip: number; target: number; crossfade: number; engine: Engine }) {
  const step = engine === "open" ? clip - crossfade : clip;
  if (!(step > 0) || target <= clip) return null;
  // The cloud plays whole copies, 2–5 a call: the same count the planner sends.
  const total = engine === "open" ? target : cloudLoopLength(clip, cloudLoopPasses(clip, target));
  const passes = Math.min(200, Math.ceil(total / step));
  return (
    <div className="mt-3" aria-hidden>
      <div className="relative flex h-6 overflow-hidden rounded-lg">
        {Array.from({ length: passes }, (_, i) => (
          <div key={i} className={cn("h-full border-r border-background last:border-r-0", i % 2 ? "bg-brand-faint" : "bg-primary/60")} style={{ width: `${(Math.min(step, total - i * step) / total) * 100}%` }} />
        ))}
        {engine === "cloud" && total > target && <div className="absolute inset-y-0 right-0 bg-background/70" style={{ width: `${((total - target) / total) * 100}%` }} />}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-subtle-foreground">
        <span>0:00</span>
        {engine === "cloud" && total > target ? <span>asked {clock(target)} · makes {clock(total)}</span> : <span>{clock(total)}</span>}
      </div>
    </div>
  );
}

function Results({ feature, title }: { feature: string; title: string }) {
  const results = useGenerations({ features: [feature], limit: 24 });
  // A cloud chain makes a result per call: show the finished ones (the last call carries the title).
  const items = (results.data ?? []).filter((g) => !!g.request.title);
  if (!items.length) return null;
  return (
    <section className="mt-10" aria-labelledby={`${feature}-results`}>
      <h3 id={`${feature}-results`} className="mb-3 font-heading text-[22px]">
        {title}
      </h3>
      <Feed items={items} />
    </section>
  );
}

/** Audio → Loop / extend. */
export function AudioLoopTool({ tabs }: { tabs?: React.ReactNode }) {
  const [engine, setEngine, mode] = useEngine();
  const run = useAudioToolRun();
  const [clip, setClip] = useState<Clip | null>(null);
  const [target, setTarget] = useState(120);
  const [crossfade, setCrossfade] = useState(DEFAULT_LOOP_CROSSFADE);
  const [curve, setCurve] = useState<Curve>("equal-power");
  useHandoff(setClip);
  const ready = clip && !clip.uploading && clip.ref ? clip : null;
  // The crossfade the slider shows: what the clip allows (a shorter clip lowers it).
  const fadeMax = clip?.duration ? clip.duration / 2 - 0.1 : CROSSFADE_MAX;
  const fade = Math.min(crossfade, crossfadeTop(fadeMax));
  const body: AudioToolBody | null = useMemo(
    () => (ready ? { tool: "loop", engine, audio: ready.ref, name: nameOf(ready), duration: target, ...(ready.duration && { sourceDuration: ready.duration }), ...(engine === "open" && { crossfade: fade, curve }) } : null),
    [ready, engine, target, fade, curve],
  );
  const preview = useAudioToolPreview(useSettled(body));
  const blocker = !clip ? "Add a clip to loop" : clip.uploading ? "Uploading…" : clip.duration && target <= clip.duration ? `The clip is already ${clock(clip.duration)} — pick a longer length` : null;
  const go = () => {
    if (blocker) return void toast(blocker);
    if (preview.error) return void toast.error((preview.error as Error).message);
    run.mutate(body!, { onSuccess: () => toast.success("Looping…"), onError: (e) => toastError(e) });
  };
  return (
    <ToolShell title="Audio" tabs={tabs}>
      {!clip && (
        <ToolHero
          title="Make it as long as you need"
          subtitle="Loop a music bed, ambience or a beat to any length up to 10 minutes, with smooth, seamless joins."
        />
      )}
      <div className={cn("mx-auto max-w-[820px] space-y-3", clip ? "pt-4" : "mt-8")}>
        {!clip ? (
          <AddAudio onFiles={([f]) => void fileToSlot(f, (v) => setClip(v), "audio")} onPick={(v) => setClip(v)} />
        ) : (
          <Panel
            title={nameOf(clip)}
            aside={
              <>
                {clip.duration ? <span className="font-mono text-[12px] text-muted-foreground tabular-nums">{clock(clip.duration)}</span> : null}
                <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Remove the clip" onClick={() => setClip(null)}>
                  <X className="size-4" />
                </Button>
              </>
            }
          >
            <AudioPlayer clip={clip} onDuration={(duration) => setClip((c) => (c ? { ...c, duration } : c))} />
          </Panel>
        )}
        {clip && (
          <Panel title="Length">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                label="Length"
                value={LOOP_PRESETS.includes(target) ? target : -1}
                onChange={(v) => v > 0 && setTarget(v)}
                options={[...LOOP_PRESETS.map((s) => ({ value: s, label: `${s / 60} min` })), ...(LOOP_PRESETS.includes(target) ? [] : [{ value: -1, label: clock(target) }])]}
              />
              <LengthField value={target} onCommit={setTarget} max={LOOP_MAX_SECONDS} />
            </div>
            {clip.duration ? <LoopBar clip={clip.duration} target={target} crossfade={fade} engine={engine} /> : null}
          </Panel>
        )}
        {clip && engine === "open" && (
          <Panel title="Seams">
            <CrossfadeControls value={fade} onChange={setCrossfade} curve={curve} onCurve={setCurve} max={fadeMax} />
          </Panel>
        )}
        {clip && <RunBar label="Loop it" icon={Repeat} blocker={blocker} preview={preview} engine={engine} onRun={go} pending={run.isPending} onOpenEngine={mode === "both" ? () => setEngine("open") : undefined} />}
      </div>
      <Results feature={LOOP_FEATURE} title="Your loops" />
    </ToolShell>
  );
}

/** Audio → Join. */
export function AudioJoinTool({ tabs }: { tabs?: React.ReactNode }) {
  const [engine, setEngine, mode] = useEngine();
  const run = useAudioToolRun();
  const [clips, setClips] = useState<Clip[]>([]);
  const [crossfade, setCrossfade] = useState(DEFAULT_JOIN_CROSSFADE);
  const [curve, setCurve] = useState<Curve>("equal-power");
  useHandoff((c) => setClips([c]));
  const room = JOIN_MAX_CLIPS - clips.length;
  const add = (files: File[]) => {
    if (files.length > room) toast(`Join up to ${JOIN_MAX_CLIPS} clips — added the first ${room}`);
    for (const f of files.slice(0, Math.max(0, room))) fileToList(f, setClips, "audio");
  };
  const pick = (v: SlotValue) => (room > 0 ? setClips((xs) => [...xs, { ...v, id: nanoid(8) }]) : toast(`Join up to ${JOIN_MAX_CLIPS} clips`));
  const move = (i: number, by: -1 | 1) =>
    setClips((xs) => {
      const j = i + by;
      if (j < 0 || j >= xs.length) return xs;
      const next = [...xs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const ready = clips.length >= 2 && clips.every((c) => !c.uploading && c.ref);
  // End clips allow a crossfade up to their length, middle ones up to half of it (they have two seams).
  const shortest = clips.reduce((m, c, i) => Math.min(m, (c.duration ?? Infinity) / (i === 0 || i === clips.length - 1 ? 1 : 2)), Infinity);
  const fadeMax = Number.isFinite(shortest) ? shortest - 0.1 : CROSSFADE_MAX;
  const fade = Math.min(crossfade, crossfadeTop(fadeMax));
  const body: AudioToolBody | null = useMemo(
    () => (ready ? { tool: "join", engine, clips: clips.map((c) => ({ url: c.ref, name: nameOf(c), ...(c.duration && { duration: c.duration }) })), ...(engine === "open" && { crossfade: fade, curve }) } : null),
    [ready, clips, engine, fade, curve],
  );
  const preview = useAudioToolPreview(useSettled(body));
  const blocker = clips.length < 2 ? "Add at least two clips" : clips.some((c) => c.uploading) ? "Uploading…" : null;
  const go = () => {
    if (blocker) return void toast(blocker);
    if (preview.error) return void toast.error((preview.error as Error).message);
    run.mutate(body!, { onSuccess: () => toast.success("Joining…"), onError: (e) => toastError(e) });
  };
  return (
    <ToolShell title="Audio" tabs={tabs}>
      {!clips.length && (
        <ToolHero
          title="Join clips into one track"
          subtitle={`Up to ${JOIN_MAX_CLIPS} clips, in the order you set, with smooth crossfades.`}
        />
      )}
      <div className={cn("mx-auto max-w-[820px] space-y-3", clips.length ? "pt-4" : "mt-8")}>
        {!clips.length ? (
          <AddAudio multiple onFiles={add} onPick={pick} />
        ) : (
          <Panel title={`Clips · ${clips.length} of ${JOIN_MAX_CLIPS}`} aside={<AddAudio compact multiple onFiles={add} onPick={pick} disabled={room <= 0} />}>
            <ol className="space-y-2" aria-label="Clips, in the order they play">
              {clips.map((c, i) => (
                <li key={c.id ?? c.ref} className="rounded-xl border p-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-faint font-mono text-[11px] text-brand-text">{i + 1}</span>
                    <p className="min-w-0 flex-1 truncate text-[13px] font-medium">{nameOf(c)}</p>
                    {c.uploading ? (
                      <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" aria-label="Uploading" />
                    ) : c.duration ? (
                      <span className="shrink-0 font-mono text-[12px] text-muted-foreground tabular-nums">{clock(c.duration)}</span>
                    ) : null}
                    <Button variant="ghost" size="icon-sm" className="shrink-0 rounded-full" aria-label={`Move clip ${i + 1} earlier`} disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" className="shrink-0 rounded-full" aria-label={`Move clip ${i + 1} later`} disabled={i === clips.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon-sm" className="shrink-0 rounded-full" aria-label={`Remove clip ${i + 1}`} onClick={() => setClips((xs) => xs.filter((_, j) => j !== i))}>
                      <X className="size-3.5" />
                    </Button>
                  </div>
                  <AudioPlayer clip={c} className="mt-1.5" onDuration={(duration) => setClips((xs) => xs.map((x) => (x === c || (x.id && x.id === c.id) ? { ...x, duration } : x)))} />
                </li>
              ))}
            </ol>
            {clips.length === 1 && <p className="mt-2 text-[13px] text-muted-foreground">Add one more clip to join.</p>}
          </Panel>
        )}
        {clips.length > 0 && engine === "open" && (
          <Panel title="Seams">
            <CrossfadeControls value={fade} onChange={setCrossfade} curve={curve} onCurve={setCurve} max={fadeMax} />
          </Panel>
        )}
        {clips.length > 0 && <RunBar label="Join them" icon={Merge} blocker={blocker} preview={preview} engine={engine} onRun={go} pending={run.isPending} onOpenEngine={mode === "both" ? () => setEngine("open") : undefined} />}
      </div>
      <Results feature={JOIN_FEATURE} title="Your joins" />
    </ToolShell>
  );
}
