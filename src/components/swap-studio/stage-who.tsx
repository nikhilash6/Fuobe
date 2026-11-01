"use client";

import { Check, Crosshair, Loader2, ScanFace, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Panel } from "@/components/av/tool-shell";
import { Segmented, ToggleRow } from "@/components/faceless/controls";
import { FrameStage, type Frame } from "@/components/remove-object/frame-stage";
import { WHO_INDEX_LABEL, WHO_LABELS, type SwapWho } from "@/lib/catalog/character-swap";
import { approvedMask, at, jobState, maskPieceAt, secondsLabel, SWAP_STUDIO, type MaskVersion } from "@/lib/catalog/swap-studio";
import type { PixelPoint } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { useMakeMask, useStopJob } from "./hooks";
import { GenChip, grabFrame, JobError, Note, priceText } from "./parts";
import type { StageProps } from "./workbench";

const WORDS = { positive: "include", negative: "exclude", ask: "Click the person to swap", frame: "The shot's frame" };

/** Who to swap: SAM 3.1's words and pick, clicks on any frame of the shot, Track shot / Update frame, mask versions to approve. */
export function WhoStage({ id, project, clip, shot, gens, estimate, edit, src }: StageProps) {
  const make = useMakeMask(id);
  const stop = useStopJob(id);
  const [at24, setAt24] = useState(0);
  const [frame, setFrame] = useState<{ shot: string; f: number; image: Frame } | null>(null);
  const [loading, setLoading] = useState(false);
  const [points, setPoints] = useState<PixelPoint[]>([]);
  const [label, setLabel] = useState<"positive" | "negative">("positive");
  const [base, setBase] = useState<string | null>(null);

  if (!shot) return <Note>Pick a shot.</Note>;
  const len = shot.end - shot.start;
  const engine = project.engine;
  const approvedMaskHere = !!approvedMask(shot, engine);
  const who = shot.who;
  const shown = frame && frame.shot === shot.id ? frame : null;
  const finished = (m: MaskVersion) => m.pieces.every((p) => p.url);
  // Corrections go into a version made on this engine (the other engine's can't be spliced into).
  const here = (m: MaskVersion) => m.engine === engine && finished(m);
  const named = shot.masks.find((m) => m.id === (base ?? shot.approvedMask));
  const baseVersion = (named && here(named) ? named : null) ?? [...shot.masks].reverse().find(here) ?? null;

  const show = async (f: number) => {
    setLoading(true);
    try {
      const image = await grabFrame(src, at(shot.start + f) + 0.5 / 24);
      setFrame({ shot: shot.id, f, image });
      setPoints([]);
    } catch (e) {
      toastError(e);
    } finally {
      setLoading(false);
    }
  };
  const run = (kind: "track" | "frame") => {
    const f = shown?.f ?? at24;
    make.mutate(
      { clipId: clip.id, shotId: shot.id, kind, frame: f, points: shown ? points : [], ...(shown ? { size: { width: shown.image.width, height: shown.image.height } } : {}), ...(baseVersion ? { base: baseVersion.id } : {}) },
      {
        onSuccess: () => {
          setPoints([]);
          toast(kind === "track" ? `Tracking from frame ${f + 1} to the shot's end` : `Updating frame ${f + 1}`);
        },
        onError: (e) => toastError(e),
      },
    );
  };

  return (
    <div className="space-y-3">
      <Panel title="Who to swap">
        <div className="space-y-3">
          <Segmented
            label="Pick"
            value={who.selection}
            options={(Object.keys(WHO_LABELS) as SwapWho[]).map((v) => ({ value: v, label: WHO_LABELS[v] }))}
            onChange={(selection) => void edit({ type: "shot", clipId: clip.id, shotId: shot.id, patch: { who: { selection } } })}
          />
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <label className="flex min-w-0 flex-col gap-1 text-[12px] font-medium">
              SAM 3.1 looks for
              <input
                key={who.words}
                defaultValue={who.words}
                maxLength={120}
                placeholder="person"
                onBlur={(e) => e.currentTarget.value !== who.words && void edit({ type: "shot", clipId: clip.id, shotId: shot.id, patch: { who: { words: e.currentTarget.value || "person" } } })}
                onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                className="h-8 w-full min-w-0 rounded-md border bg-background px-2.5 text-[13px] font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            {who.selection === "index" && (
              <label className="flex flex-col gap-1 text-[12px] font-medium" title={WHO_INDEX_LABEL[engine].hint}>
                Person #
                <input
                  key={who.index}
                  type="number"
                  min={1}
                  max={101}
                  defaultValue={who.index + 1}
                  onBlur={(e) => {
                    const n = Math.round(Number(e.currentTarget.value)) - 1;
                    if (Number.isFinite(n) && n >= 0 && n !== who.index) void edit({ type: "shot", clipId: clip.id, shotId: shot.id, patch: { who: { index: n } } });
                  }}
                  className="h-8 w-20 rounded-md border bg-background px-2 font-mono text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
            )}
          </div>
          {engine === "cloud" ? (
            <Note>On fal, H3 has no mask: who to swap goes into the prompt in words (“{who.selection === "index" ? `person #${who.index + 1}` : `the ${WHO_LABELS[who.selection].toLowerCase()} person`}”). SAM 3.1&apos;s masks here are for checking who it finds.</Note>
          ) : (
            <>
              <ToggleRow
                label="Masked generation"
                hint="Only the person's mask is regenerated; the rest of the frame stays as filmed"
                checked={shot.settings.useMask}
                onChange={(useMask) => void edit({ type: "shot", clipId: clip.id, shotId: shot.id, patch: { settings: { useMask } } })}
              />
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between text-[12px]">
                  <span className="font-medium">Mask expansion</span>
                  <span className="font-mono text-muted-foreground tabular-nums">{shot.settings.expansion} px</span>
                </div>
                <Slider
                  aria-label="Mask expansion"
                  min={0}
                  max={256}
                  step={1}
                  value={[shot.settings.expansion]}
                  onValueCommit={([expansion]) => void edit({ type: "shot", clipId: clip.id, shotId: shot.id, patch: { settings: { expansion } } })}
                />
              </div>
            </>
          )}
        </div>
      </Panel>

      <Panel
        title="Point at them"
        aside={<span className="font-mono text-[11px] text-muted-foreground">Track shot · {priceText(estimate?.mask[shot.id], { demo: estimate?.demo, engine })}</span>}
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-[12rem] flex-1">
              <Slider aria-label="Frame of the shot" min={0} max={Math.max(0, len - 1)} step={1} value={[at24]} onValueChange={([f]) => setAt24(f)} />
            </div>
            <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
              Frame {at24 + 1} of {len} · {secondsLabel(at24)}
            </span>
            <Button size="sm" variant="outline" className="h-8 rounded-full" onClick={() => void show(at24)} disabled={loading}>
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Crosshair className="size-3.5" />} Show this frame
            </Button>
          </div>
          {shown ? (
            <>
              <Segmented
                label="A click marks"
                value={label}
                options={[
                  { value: "positive", label: "Include" },
                  { value: "negative", label: "Exclude" },
                ]}
                onChange={setLabel}
              />
              <FrameStage frame={shown.image} points={points} onPoints={setPoints} pointLabel={label} clickable maxPoints={SWAP_STUDIO.maxPoints} words={WORDS} />
              {points.length > 0 && (
                <Button size="sm" variant="ghost" className="h-7 rounded-full px-2.5 text-[12px]" onClick={() => setPoints([])}>
                  <Undo2 className="size-3.5" /> Clear points
                </Button>
              )}
            </>
          ) : (
            <Note>Show a frame to click who to swap (include) and who not (exclude) — or track with the pick and words above.</Note>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="h-8 rounded-full" onClick={() => run("track")} disabled={make.isPending}>
              {make.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <ScanFace className="size-3.5" />} Track shot{(shown?.f ?? at24) > 0 ? ` from frame ${(shown?.f ?? at24) + 1}` : ""}
            </Button>
            <Button size="sm" variant="outline" className="h-8 rounded-full" onClick={() => run("frame")} disabled={make.isPending || !baseVersion || !shown}>
              Update frame {(shown?.f ?? at24) + 1}
            </Button>
          </div>
          {!baseVersion && <p className="text-[12px] text-muted-foreground">Update frame corrects one frame of a tracked mask: track the shot first.</p>}
        </div>
      </Panel>

      <Panel title={`Mask versions · ${shot.masks.length}`}>
        {!shot.masks.length ? (
          <p className="text-[12px] text-muted-foreground">None yet.</p>
        ) : (
          <ol className="grid gap-3 sm:grid-cols-2">
            {[...shot.masks].reverse().map((m) => {
              const n = shot.masks.indexOf(m) + 1;
              const state = jobState(m.genId, m.stepIds, gens);
              const piece = maskPieceAt(m, shown?.f ?? at24);
              const approved = shot.approvedMask === m.id;
              const elsewhere = m.engine !== engine;
              return (
                <li key={m.id} className={cn("min-w-0 space-y-2 rounded-xl border p-2.5", approved && "border-success")}>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium">v{n}</span>
                    <span className="min-w-0 truncate text-[12px] text-muted-foreground">
                      {m.kind === "track" ? `Track from frame ${m.frame + 1}` : `Frame ${m.frame + 1}`} · {m.points.length ? `${m.points.length} point${m.points.length === 1 ? "" : "s"}` : `“${m.who.words}”`}
                      {m.base ? ` · corrects v${shot.masks.findIndex((x) => x.id === m.base) + 1}` : ""}
                      {elsewhere ? ` · made ${m.engine === "open" ? "on your GPU" : "on the cloud"}` : ""}
                    </span>
                    <GenChip genId={m.genId} stepIds={m.stepIds} gens={gens} className="ml-auto" />
                  </div>
                  {piece?.url ? <video src={piece.url} muted loop playsInline controls preload="metadata" className="aspect-video w-full rounded-lg bg-media object-contain" /> : null}
                  <JobError genId={m.genId} stepIds={m.stepIds} gens={gens} />
                  <div className="flex flex-wrap gap-1.5">
                    {approved ? (
                      <>
                        <span className="inline-flex h-7 items-center gap-1 rounded-full bg-success/12 px-2.5 text-[12px] font-medium text-success">
                          <Check className="size-3.5" /> Approved
                        </span>
                        <Button size="sm" variant="ghost" className="h-7 rounded-full px-2.5 text-[12px]" onClick={() => void edit({ type: "shot", clipId: clip.id, shotId: shot.id, patch: { approvedMask: null } })}>
                          Unapprove
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 rounded-full px-2.5 text-[12px]"
                        disabled={!finished(m) || elsewhere}
                        title={elsewhere ? "Made on the other engine — track the shot again here" : undefined}
                        onClick={() => void edit({ type: "shot", clipId: clip.id, shotId: shot.id, patch: { approvedMask: m.id } })}
                      >
                        <Check className="size-3.5" /> Approve
                      </Button>
                    )}
                    {here(m) && (
                      <Button size="sm" variant="ghost" className="h-7 rounded-full px-2.5 text-[12px]" aria-pressed={baseVersion?.id === m.id} onClick={() => setBase(m.id)}>
                        {baseVersion?.id === m.id ? "Updates go here" : "Update this one"}
                      </Button>
                    )}
                    {state.status === "queued" || state.status === "running" ? (
                      <Button size="sm" variant="ghost" className="h-7 rounded-full px-2.5 text-[12px]" onClick={() => stop.mutate({ kind: "mask", clipId: clip.id, shotId: shot.id, jobId: m.id })}>
                        Stop
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" className="h-7 rounded-full px-2.5 text-[12px]" aria-label={`Remove mask v${n}`} onClick={() => void edit({ type: "remove-mask", clipId: clip.id, shotId: shot.id, maskId: m.id })}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {engine === "open" && shot.settings.useMask && !approvedMaskHere && <Note className="mt-3">No approved mask{shot.approvedMask ? " made on your GPU (the approved one is the cloud's)" : ""}: each segment finds the person itself with SAM 3.1 from the pick and words above.</Note>}
      </Panel>
    </div>
  );
}
