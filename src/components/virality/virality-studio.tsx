"use client";

import { AudioLines, Contrast, Crop, Info, Loader2, Move, RefreshCw, ScanFace, Scissors, Smartphone, Sparkles, Subtitles, TrendingUp, Type, Volume2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { SlotValue } from "@/components/studio/media-slot";
import { MediaDrop } from "@/components/av/media-drop";
import { Panel, ToolHero, ToolShell } from "@/components/av/tool-shell";
import { uploadFile } from "@/lib/api";
import { HOOK_SECONDS, hookSignals, hookSummary, SILENCE_DB, TRIBE_WORKER, VIRALITY_PARITY, type HookSignal, type SignalId, type Verdict } from "@/lib/av/virality";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { measureHook, type HookMeasure } from "./measure";

type Run =
  | { ref: string; status: "running"; share: number; stage: string }
  | { ref: string; status: "done"; measure: HookMeasure; signals: HookSignal[] }
  | { ref: string; status: "error"; message: string };

const HOOK_FRAME_APP = "/apps/app-hook-frame";

/** Virality predictor: an honest, in-browser check of a video's first 3 seconds — no invented score. */
export function ViralityStudio() {
  const [clip, setClip] = useState<SlotValue | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  // A result belongs to the clip it was measured on.
  const current = run && clip && run.ref === clip.ref ? run : null;
  // The clip is read here, never uploaded: its blob: URL goes when it's replaced and when the page closes.
  const blob = useRef<string | null>(null);
  useEffect(() => () => void (blob.current && URL.revokeObjectURL(blob.current)), []);
  const change = (v: SlotValue | null) => {
    abort.current?.abort();
    if (blob.current && blob.current !== v?.ref) URL.revokeObjectURL(blob.current);
    blob.current = v?.ref.startsWith("blob:") ? v.ref : null;
    setClip(v);
  };
  const go = async () => {
    if (!clip) return void toast("Add a video first", { id: "virality-blocker" });
    if (clip.uploading || !clip.ref) return void toast("Uploading…", { id: "virality-blocker" });
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    const ref = clip.ref;
    setRun({ ref, status: "running", share: 0, stage: "Opening the video" });
    try {
      const measure = await measureHook(ref, { signal: ctrl.signal, onProgress: (share, stage) => !ctrl.signal.aborted && setRun({ ref, status: "running", share, stage }) });
      if (!ctrl.signal.aborted) setRun({ ref, status: "done", measure, signals: hookSignals(measure.input) });
    } catch (e) {
      if (!ctrl.signal.aborted) setRun({ ref, status: "error", message: (e as Error).message || "Couldn't read this video" });
    }
  };
  return (
    <ToolShell title="Virality predictor" engineSwitch={false}>
      <ToolHero title="Will your first 3 seconds hold?" subtitle="An honest check of your video's hook — movement, a cut, faces, on-screen text and sound in the opening seconds, measured right here in your browser. Nothing is generated or charged." />
      <div className="mx-auto mt-8 grid max-w-[880px] gap-3">
        <MediaDrop kind="video" value={clip} onChange={change} title="Add your video" hint="MP4 (H.264) or WebM · the opening 3 seconds are what's checked" compact local />
        <div className="flex flex-wrap items-center gap-2">
          <Button size="lg" className={cn("rounded-full", (!clip || clip.uploading) && "bg-muted text-muted-foreground hover:bg-muted")} onClick={go} disabled={current?.status === "running"}>
            {current?.status === "running" ? <Loader2 className="size-4 animate-spin" /> : current?.status === "done" ? <RefreshCw className="size-4" /> : <TrendingUp className="size-4" />}
            {current?.status === "done" ? "Check again" : "Check the hook"}
          </Button>
          <p className="text-[12px] text-muted-foreground">Runs in your browser · nothing is uploaded</p>
        </div>
        {current?.status === "running" && (
          <div className="rounded-2xl border bg-background p-3 shadow-soft" role="status" aria-live="polite">
            <div className="mb-2 flex items-center justify-between text-[13px]">
              <span>{current.stage}…</span>
              <span className="font-mono text-[12px] text-muted-foreground">{Math.round(current.share * 100)}%</span>
            </div>
            <Progress value={current.share * 100} aria-label="Analysis progress" />
          </div>
        )}
        {current?.status === "error" && (
          <div className="rounded-2xl border border-destructive/40 bg-background p-3 text-[13px]" role="alert">
            <p className="font-medium text-destructive">Couldn&apos;t analyse this video</p>
            <p className="mt-1 text-muted-foreground">{current.message}</p>
          </div>
        )}
        {current?.status === "done" && <Results clip={clip!} measure={current.measure} signals={current.signals} />}
        <ParityNote />
      </div>
    </ToolShell>
  );
}

function ParityNote() {
  // The page has no engine switch, so both routes are spelled out.
  return (
    <aside className="rounded-2xl border bg-muted/40 p-3 text-[13px] sm:p-4" aria-labelledby="virality-parity">
      <div className="flex items-start gap-2.5">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 space-y-1.5">
          <p id="virality-parity" className="font-medium">
            {VIRALITY_PARITY.title}
          </p>
          <p className="text-pretty text-muted-foreground">{VIRALITY_PARITY.lead}</p>
          <details className="group pt-1">
            <summary className="cursor-pointer text-[12px] font-medium text-foreground marker:text-muted-foreground">Run TRIBE v2 yourself (non-commercial)</summary>
            <div className="mt-2 space-y-2 text-[12px] text-muted-foreground">
              <p className="text-pretty">{VIRALITY_PARITY.body}</p>
              <p className="text-pretty">{VIRALITY_PARITY.cloud}</p>
              <p className="text-pretty">{VIRALITY_PARITY.open}</p>
              <p>
                <span className="font-medium text-foreground">Worker:</span> <span className="font-mono break-words">{TRIBE_WORKER.endpoint}</span>
              </p>
              <div>
                <p className="font-medium text-foreground">It returns</p>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                  {TRIBE_WORKER.output.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-medium text-foreground">It needs</p>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                  {TRIBE_WORKER.needs.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
              <p>{TRIBE_WORKER.status} The full contract is in docs/workers/tribe-v2.md.</p>
            </div>
          </details>
        </div>
      </div>
    </aside>
  );
}

const VERDICT: Record<Verdict, { label: string; dot: string; chip: string }> = {
  strong: { label: "Strong", dot: "bg-success", chip: "bg-success/15 text-foreground" },
  ok: { label: "Fine", dot: "bg-brand-text", chip: "bg-brand-faint text-brand-text" },
  weak: { label: "Improve", dot: "bg-warning", chip: "bg-warning/20 text-foreground" },
  unknown: { label: "Not measured", dot: "bg-subtle-foreground", chip: "bg-muted text-muted-foreground" },
};

const ICON: Record<SignalId, React.ComponentType<{ className?: string }>> = {
  motion: Move,
  change: Scissors,
  faces: ScanFace,
  text: Type,
  sound: Volume2,
  contrast: Contrast,
  format: Smartphone,
};

function Results({ clip, measure, signals }: { clip: SlotValue; measure: HookMeasure; signals: HookSignal[] }) {
  const counts = hookSummary(signals);
  const byId = Object.fromEntries(signals.map((s) => [s.id, s])) as Record<SignalId, HookSignal>;
  return (
    <div className="grid gap-3">
      <Panel title="Hook check" aside={<span className="text-[12px] text-muted-foreground">First {HOOK_SECONDS} s · rules of thumb</span>}>
        <ul className="flex flex-wrap gap-1.5" aria-label="Summary">
          {(["strong", "ok", "weak", "unknown"] as Verdict[])
            .filter((v) => counts[v] > 0)
            .map((v) => (
              <li key={v} className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium", VERDICT[v].chip)}>
                <span className={cn("size-1.5 rounded-full", VERDICT[v].dot)} aria-hidden />
                {counts[v]} {VERDICT[v].label.toLowerCase()}
              </li>
            ))}
        </ul>
        <p className="mt-2 text-[13px] text-muted-foreground">
          {counts.weak === 0 ? "Nothing in the opening flags a slow start." : `${counts.weak} thing${counts.weak > 1 ? "s" : ""} to look at in the opening.`} These are measurements, not a forecast of views.
        </p>
        <Timeline measure={measure} />
      </Panel>
      <Panel title="Signals">
        <ul className="divide-y">
          {signals.map((s) => {
            const Icon = ICON[s.id];
            return (
              <li key={s.id} className="flex min-w-0 gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
                  <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[14px] font-medium">{s.label}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", VERDICT[s.verdict].chip)}>{VERDICT[s.verdict].label}</span>
                  </div>
                  <p className="mt-0.5 text-[13px] break-words">{s.detail}</p>
                  {s.tip && <p className="mt-0.5 text-[12px] text-pretty text-muted-foreground">{s.tip}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>
      <NextSteps clip={clip} measure={measure} byId={byId} />
    </div>
  );
}

/** The opening frames over two strips: movement between frames and loudness, with the 3 s mark. */
function Timeline({ measure }: { measure: HookMeasure }) {
  const { motion, loudness } = measure.input;
  const span = Math.max(HOOK_SECONDS, motion.at(-1)?.t ?? 0) || HOOK_SECONDS;
  const peak = Math.max(0.05, ...motion.map((m) => m.diff));
  const db = "db" in loudness ? loudness.db.slice(0, Math.round(HOOK_SECONDS / loudness.step)) : null;
  const moving = motion.filter((m) => m.diff >= 0.01).length;
  const loudCount = db?.filter((d) => d > SILENCE_DB).length ?? 0;
  // The clip's own shape, kept between 3:4 and 16:9 so a vertical strip doesn't tower.
  const frameRatio = Math.min(16 / 9, Math.max(3 / 4, measure.input.width / Math.max(1, measure.input.height) || 16 / 9));
  return (
    <figure className="mt-4" aria-label={`Timeline of the first ${HOOK_SECONDS} seconds: movement in ${moving} of ${motion.length} frames${db ? `, sound in ${loudCount} of ${db.length} tenths of a second` : ""}`}>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${measure.strip.length}, minmax(0, 1fr))` }}>
        {measure.strip.map((f) => (
          <div key={f.t} className="min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f.url} alt="" className="w-full rounded-md bg-media object-cover" style={{ aspectRatio: frameRatio }} />
            <p className="mt-0.5 text-center font-mono text-[10px] text-muted-foreground">{f.t.toFixed(1)}s</p>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-[64px_minmax(0,1fr)] items-end gap-x-2 gap-y-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <Move className="size-3" aria-hidden /> Movement
        </span>
        <div className="flex h-8 items-end gap-px" aria-hidden>
          {motion.map((m) => (
            <span key={m.t} className="min-w-0 flex-1 rounded-sm bg-brand-text/70" style={{ height: `${Math.max(4, (m.diff / peak) * 100)}%`, opacity: m.t <= span ? 1 : 0.4 }} />
          ))}
        </div>
        <span className="flex items-center gap-1">
          <AudioLines className="size-3" aria-hidden /> Sound
        </span>
        {db ? (
          <div className="flex h-8 items-end gap-px" aria-hidden>
            {db.map((d, i) => (
              <span key={i} className={cn("min-w-0 flex-1 rounded-sm", d > SILENCE_DB ? "bg-foreground/60" : "bg-muted")} style={{ height: `${Math.max(4, Math.min(100, ((d + 60) / 60) * 100))}%` }} />
            ))}
          </div>
        ) : (
          <p className="h-8 content-center">{"error" in loudness && loudness.error === "no-audio" ? "No audio track" : "Not measured"}</p>
        )}
      </div>
    </figure>
  );
}

function NextSteps({ clip, measure, byId }: { clip: SlotValue; measure: HookMeasure; byId: Record<SignalId, HookSignal> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const toHookFrame = async () => {
    if (!measure.opening) return;
    setBusy(true);
    try {
      const blob = await (await fetch(measure.opening)).blob();
      const asset = await uploadFile(new File([blob], `${(clip.name ?? "video").replace(/\.[^.]+$/, "")} opening frame.jpg`, { type: "image/jpeg" }));
      router.push(`${HOOK_FRAME_APP}?${new URLSearchParams({ image: asset.url })}`);
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  };
  const weak = (id: SignalId) => byId[id]?.verdict === "weak";
  // A clip read in this browser only (blob:) can't go to another studio: that studio asks for it again.
  const video = clip.ref.startsWith("blob:") ? "" : new URLSearchParams({ video: clip.ref }).toString();
  return (
    <Panel title="Next steps">
      <div className="flex flex-wrap gap-2">
        {measure.opening && (
          <Button className="rounded-full" onClick={toHookFrame} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Make a stronger opening frame
          </Button>
        )}
        {(weak("text") || byId.text?.verdict === "unknown") && (
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/video-tools/captions" prefetch={false}>
              <Subtitles className="size-4" /> Add captions
            </Link>
          </Button>
        )}
        {weak("sound") && (
          <Button asChild variant="outline" className="rounded-full">
            <Link href={video ? `/audio/video?${video}` : "/audio/video"} prefetch={false}>
              <Volume2 className="size-4" /> Add sound
            </Link>
          </Button>
        )}
        {measure.input.height > 0 && measure.input.width / measure.input.height > 0.66 && (
          <Button asChild variant="outline" className="rounded-full">
            <Link href={video ? `/reframe?${video}` : "/reframe"} prefetch={false}>
              <Crop className="size-4" /> Reframe to 9:16
            </Link>
          </Button>
        )}
        {(weak("motion") || weak("change")) && (
          <Button asChild variant="outline" className="rounded-full">
            <Link href="/video-tools/trim" prefetch={false}>
              <Scissors className="size-4" /> Trim the slow start
            </Link>
          </Button>
        )}
      </div>
    </Panel>
  );
}
