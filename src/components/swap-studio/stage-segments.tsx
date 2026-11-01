"use client";

import { ChevronDown, Combine, ListVideo, Loader2, Play, RotateCcw, Scissors, Square } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel } from "@/components/av/tool-shell";
import { Segmented, ToggleRow } from "@/components/faceless/controls";
import { CLOUD_NO_LORA, historyChoicesFor, SWAP_LORAS, WINDOW_CHOICES } from "@/lib/catalog/character-swap";
import {
  currentSegments,
  jobState,
  layoutFrames,
  ROLE_LABELS,
  secondsLabel,
  segmentStates,
  SWAP_STUDIO,
  type GenSummary,
  type QueueMode,
  type SegmentState,
  type SwapRole,
  type SwapSegment,
  type SwapShot,
  type SwapTake,
} from "@/lib/catalog/swap-studio";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { useQueue, useStopJob, useStopTake } from "./hooks";
import { AnchorGrid, AnchorMaker } from "./stage-anchors";
import { JobChip, Note, NumberField, priceText, SavedText } from "./parts";
import type { StageProps } from "./workbench";

const STATE_TEXT: Record<SegmentState["status"], string> = { ready: "Current", stale: "Out of date", empty: "No take yet" };
const ROLES = Object.keys(ROLE_LABELS) as SwapRole[];

/** Generation settings (Akatz's shot fields): LoRA, anchor, mask, render size, seed, window and history. */
function SettingsPanel({ project, clip, shot, edit }: StageProps & { shot: SwapShot }) {
  const s = shot.settings;
  const set = (settings: Partial<SwapShot["settings"]>) => void edit({ type: "shot", clipId: clip.id, shotId: shot.id, patch: { settings } });
  const cloud = project.engine === "cloud";
  return (
    <Panel title="Generation settings">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <span className="text-[12px] font-medium">Swap LoRA</span>
          <Segmented
            label="Swap LoRA"
            value={s.lora}
            options={[
              { value: "v1.5", label: "V1.5", hint: SWAP_LORAS["v1.5"].label },
              { value: "v1", label: "V1" },
              { value: "none", label: "None", hint: cloud ? CLOUD_NO_LORA : "Turbo LoRA alone" },
            ]}
            onChange={(lora) => set({ lora })}
          />
          {cloud && s.lora === "none" && <p className="text-[12px] text-destructive">{CLOUD_NO_LORA}</p>}
        </div>
        <div className="min-w-0 space-y-1.5">
          <span className="text-[12px] font-medium">Render size</span>
          <Segmented
            label="Render size"
            value={s.renderMp}
            options={[
              { value: 0.5, label: "0.5 MP · 480" },
              { value: 1, label: "1.0 MP · 768" },
            ]}
            onChange={(renderMp) => set({ renderMp })}
          />
        </div>
        <label className="flex min-w-0 flex-col gap-1 text-[12px] font-medium">
          Diffusion window
          <Select value={String(s.windowFrames)} onValueChange={(v) => set({ windowFrames: Number(v), ...(s.historyFrames >= Number(v) ? { historyFrames: Math.max(...historyChoicesFor(Number(v))) } : {}) })}>
            <SelectTrigger className="h-8 w-full text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOW_CHOICES.map((w) => (
                <SelectItem key={w} value={String(w)}>
                  {w} frames · {secondsLabel(w)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-[12px] font-medium">
          Continuation history
          <Select value={String(s.historyFrames)} onValueChange={(v) => set({ historyFrames: Number(v) })}>
            <SelectTrigger className="h-8 w-full text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {historyChoicesFor(s.windowFrames).map((h) => (
                <SelectItem key={h} value={String(h)}>
                  {h} frame{h === 1 ? "" : "s"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <NumberField label="Seed for new segments" value={s.seed} min={0} max={SWAP_STUDIO.maxSeed} onCommit={(seed) => set({ seed })} />
        <div className="space-y-2">
          <ToggleRow label="Scene anchor" hint="First segment starts from the approved anchor" checked={s.useAnchor} onChange={(useAnchor) => set({ useAnchor })} />
          <ToggleRow label="Masked generation" hint={cloud ? "Your GPU only — fal's H3 has no mask" : "Only the mask is regenerated"} checked={s.useMask && !cloud} disabled={cloud} onChange={(useMask) => set({ useMask })} />
        </div>
      </div>
      {cloud && <Note className="mt-3">On the cloud the window and history set the default segment layout; a continuing segment starts from the previous take&apos;s last frame (fal&apos;s H3 takes no history).</Note>}
    </Panel>
  );
}

function TakeRow({
  take,
  n,
  seg,
  selected,
  gens,
  onSelect,
  onStop,
  onRetry,
}: {
  take: SwapTake;
  n: number;
  seg: SwapSegment;
  selected: boolean;
  gens: Record<string, GenSummary>;
  onSelect: () => void;
  onStop: () => void;
  onRetry: () => void;
}) {
  const s = take.state === "launched" ? jobState(take.genId, take.stepIds, gens) : { status: take.state, progress: null, message: take.reason ?? null };
  const url = take.genId ? gens[take.genId]?.url : undefined;
  const active = s.status === "waiting" || s.status === "queued" || s.status === "running";
  return (
    <li className={cn("flex min-w-0 flex-wrap items-center gap-2 rounded-lg border px-2 py-1.5", selected && "border-success")}>
      <span className="text-[12px] font-medium">Take {n}</span>
      <JobChip status={s.status} progress={s.progress} message={s.message} />
      <span className="font-mono text-[11px] text-muted-foreground">seed {take.seed}</span>
      {take.state === "waiting" && <span className="text-[11px] text-muted-foreground">waits for the segment before</span>}
      <span className="ml-auto flex flex-wrap gap-1">
        {s.status === "succeeded" && (
          <Button size="sm" variant={selected ? "secondary" : "outline"} className="h-7 rounded-full px-2 text-[12px]" disabled={selected} onClick={onSelect}>
            {selected ? "Chosen" : "Use this take"}
          </Button>
        )}
        {active && (
          <Button size="sm" variant="ghost" className="h-7 rounded-full px-2 text-[12px]" onClick={onStop}>
            <Square className="size-3" /> Stop
          </Button>
        )}
        {(s.status === "failed" || s.status === "stopped" || s.status === "canceled") && (
          <Button size="sm" variant="ghost" className="h-7 rounded-full px-2 text-[12px]" onClick={onRetry}>
            <RotateCcw className="size-3" /> Try again
          </Button>
        )}
      </span>
      {s.message && (s.status === "failed" || s.status === "stopped" || s.status === "canceled") && <p className="w-full text-[12px] text-pretty text-destructive">{s.message}</p>}
      {url && s.status === "succeeded" && (
        <div className="basis-full">
          <video src={url} controls muted playsInline preload="metadata" className="aspect-video w-full max-w-xs rounded-md bg-media object-contain" aria-label={`Take ${n}`} data-segment={seg.id} />
        </div>
      )}
    </li>
  );
}

function SegmentCard(props: StageProps & { shot: SwapShot; seg: SwapSegment; index: number; state: SegmentState; count: number }) {
  const { id, project, clip, shot, seg, index, state, gens, estimate, edit } = props;
  const queue = useQueue(id);
  const stopTake = useStopTake(id);
  const stop = useStopJob(id);
  const [open, setOpen] = useState(false);
  const set = (patch: Record<string, unknown>) => void edit({ type: "segment", clipId: clip.id, shotId: shot.id, segmentId: seg.id, patch });
  const run = (mode: QueueMode) =>
    queue.mutate(
      { clipId: clip.id, shotId: shot.id, segmentId: seg.id, mode },
      {
        onSuccess: (r) => {
          toast(`Queued ${r.takes.length} take${r.takes.length === 1 ? "" : "s"}`);
          for (const note of r.notes) toast(note);
        },
        onError: (e) => toastError(e),
      },
    );
  const price = estimate?.segments[seg.id];
  const problem = estimate?.problems[seg.id];
  const len = seg.end - seg.start;
  const busy = seg.takes.some((t) => t.state === "waiting" || ["queued", "running"].includes(jobState(t.genId, t.stepIds, gens).status));
  return (
    <li className="min-w-0 space-y-2.5 rounded-xl border p-3" aria-label={`Segment ${index + 1}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold">Segment {index + 1}</span>
        <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
          {seg.start}–{seg.end} · {secondsLabel(len)}
          {state.windowFrames ? ` · ${state.windowFrames}-frame pass` : ""}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium",
            state.status === "ready" ? "bg-success/12 text-success" : state.status === "stale" ? "bg-warning/15 text-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {STATE_TEXT[state.status]}
          {state.blocked && state.status !== "ready" ? " · waits for the one before" : ""}
        </span>
        {seg.needsReview && <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium">Check its settings</span>}
        <span className="ml-auto font-mono text-[12px] text-muted-foreground">{priceText(price, { demo: estimate?.demo, engine: project.engine })}</span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <span className="text-[12px] font-medium">Start</span>
          <Segmented
            label={`Segment ${index + 1} start`}
            value={seg.connection}
            options={
              index
                ? [
                    { value: "start", label: "Starts fresh" },
                    { value: "continue", label: "Continues previous" },
                  ]
                : [{ value: "start", label: "Starts fresh" }]
            }
            onChange={(connection) => set({ connection })}
          />
        </div>
        {seg.connection === "continue" && (
          <label className="flex min-w-0 flex-col gap-1 text-[12px] font-medium">
            History {project.engine === "cloud" ? "(the cloud carries the last frame)" : "(frames of the take before)"}
            <Select value={String(seg.history)} onValueChange={(v) => set({ history: Number(v) })}>
              <SelectTrigger className="h-8 w-full text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {historyChoicesFor(SWAP_STUDIO.maxPassFrames + 1)
                  .filter((h) => h > 0)
                  .map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {h} frame{h === 1 ? "" : "s"}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </label>
        )}
        <div className="min-w-0 space-y-1 sm:col-span-2">
          <span className="text-[12px] font-medium">Anchor</span>
          <Segmented
            label={`Segment ${index + 1} anchor`}
            value={seg.anchorMode}
            options={[
              { value: "shot", label: "Scene anchor", hint: "The shot's approved scene anchor" },
              { value: "custom", label: "Reference", hint: "A segment reference of its own" },
              { value: "none", label: "None" },
            ]}
            onChange={(anchorMode) => set({ anchorMode })}
          />
          {seg.anchorMode === "shot" && !shot.settings.useAnchor && <p className="text-[12px] text-muted-foreground">Scene anchors are off in Generation settings: this segment runs without one.</p>}
          {seg.anchorMode === "shot" && shot.settings.useAnchor && !shot.approvedAnchor && <p className="text-[12px] text-muted-foreground">Approve a scene anchor (Scene anchors), or pick None.</p>}
        </div>
      </div>

      {seg.anchorMode === "custom" && (
        <div className="space-y-2 rounded-lg bg-muted/50 p-2">
          <AnchorMaker {...props} shotId={shot.id} segment={seg} />
          <AnchorGrid
            items={seg.anchors}
            chosen={seg.anchor}
            gens={gens}
            chooseLabel={["Use", "In use"]}
            onChoose={(a) => set({ anchor: a.id })}
            onRemove={(a) => void edit({ type: "remove-anchor", clipId: clip.id, shotId: shot.id, segmentId: seg.id, anchorId: a.id })}
            onStop={(a) => stop.mutate({ kind: "anchor", clipId: clip.id, shotId: shot.id, segmentId: seg.id, jobId: a.id })}
          />
        </div>
      )}

      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground">
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} /> Words, speaker, prompt and seed
      </button>
      {open && (
        <div className="grid gap-2">
          <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
            <label className="flex min-w-0 flex-col gap-1 text-[12px] font-medium">
              Who speaks
              <Select value={seg.speaker ?? "auto"} onValueChange={(v) => set({ speaker: v === "auto" ? null : v })}>
                <SelectTrigger className="h-8 w-full text-[13px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">From the words · {ROLE_LABELS[state.speaker].label}</SelectItem>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <NumberField label="Seed" value={seg.seed} min={0} max={SWAP_STUDIO.maxSeed} onCommit={(seed) => set({ seed })} />
          </div>
          <SavedText label="Words" rows={2} max={SWAP_STUDIO.maxPromptChars} value={seg.dialogue ?? state.dialogue} hint={seg.dialogue === null ? "from the transcript" : "yours"} onSave={(dialogue) => set({ dialogue })} />
          <SavedText label="Extra direction" rows={2} max={SWAP_STUDIO.maxPromptChars} value={seg.prompt} placeholder="she turns her head slowly to the window" onSave={(prompt) => set({ prompt })} />
          <SavedText
            label="Exact prompt for this segment"
            rows={5}
            max={SWAP_STUDIO.maxPromptChars}
            value={seg.performancePrompt ?? state.prompt}
            hint={seg.performancePrompt === null ? "built from the shot's" : "yours (words and speaker edits keep it)"}
            onSave={(performancePrompt) => set({ performancePrompt })}
          />
          <div>
            <Button size="sm" variant="outline" className="h-7 rounded-full px-2.5 text-[12px]" onClick={() => void edit({ type: "update-prompt", clipId: clip.id, shotId: shot.id, segmentId: seg.id })}>
              <RotateCcw className="size-3.5" /> Update prompt
            </Button>
          </div>
        </div>
      )}

      {problem && <p className="text-[12px] text-pretty text-destructive">{problem}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="h-8 rounded-full" onClick={() => run("segment")} disabled={queue.isPending || busy}>
          {queue.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Queue segment
        </Button>
        {index < props.count - 1 && (
          <Button size="sm" variant="outline" className="h-8 rounded-full" onClick={() => run("from")} disabled={queue.isPending}>
            <ListVideo className="size-3.5" /> Queue from here
          </Button>
        )}
      </div>

      {seg.takes.length > 0 && (
        <ol className="space-y-1.5" aria-label={`Segment ${index + 1} takes`}>
          {seg.takes.map((t, i) => (
            <TakeRow
              key={t.id}
              take={t}
              n={i + 1}
              seg={seg}
              selected={seg.selectedTake === t.id}
              gens={gens}
              onSelect={() => void edit({ type: "take", clipId: clip.id, shotId: shot.id, segmentId: seg.id, takeId: t.id, select: true })}
              onStop={() => stopTake.mutate({ clipId: clip.id, shotId: shot.id, segmentId: seg.id, takeId: t.id }, { onError: (e) => toastError(e) })}
              onRetry={() => run("segment")}
            />
          ))}
        </ol>
      )}
    </li>
  );
}

/** Segments: the shot's layout (5/10/15 s, split, merge, move), each segment's settings, queueing, and its takes. */
export function SegmentsStage(props: StageProps) {
  const { id, project, clip, shot, estimate, edit } = props;
  const queue = useQueue(id);
  const [splitAt, setSplitAt] = useState<number | null>(null);
  if (!shot) return <Note>Pick a shot.</Note>;
  if (shot.mode !== "generate") return <Note>This shot keeps its original — switch it to Replace character in Shots to swap it.</Note>;
  const items = currentSegments(shot);
  const states = segmentStates(project, clip, shot, items);
  const len = shot.end - shot.start;
  const layout = (op: Parameters<StageProps["edit"]>[0] extends infer E ? (E extends { type: "layout"; op: infer O } ? O : never) : never) => void edit({ type: "layout", clipId: clip.id, shotId: shot.id, op });
  const shotPrice = estimate?.shots[shot.id];
  const split = splitAt ?? Math.round(len / 2);
  return (
    <div className="space-y-3">
      <SettingsPanel {...props} shot={shot} />
      <Panel title={`Segments · ${items.length}`} aside={<span className="font-mono text-[11px] text-muted-foreground">{secondsLabel(len)} shot</span>}>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          {SWAP_STUDIO.segmentLengths.map((s) => (
            <Button key={s} size="sm" variant="outline" className="h-8 rounded-full" onClick={() => layout({ op: "partition", frames: Math.min(361, layoutFrames(s)) })}>
              {s} s segments
            </Button>
          ))}
          <div className="flex items-end gap-1.5">
            <NumberField label="Split at frame" value={split} min={1} max={len - 1} onCommit={setSplitAt} className="w-28" />
            <Button size="sm" variant="outline" className="h-8 rounded-full" onClick={() => layout({ op: "split", frame: split })}>
              <Scissors className="size-3.5" /> Split
            </Button>
          </div>
        </div>
        {items.length > 1 && (
          <ul className="mb-3 flex flex-wrap gap-2" aria-label="Boundaries">
            {items.slice(1).map((g, i) => (
              <li key={g.id} className="flex items-end gap-1 rounded-lg bg-muted px-2 py-1.5">
                <NumberField label={`Boundary ${i + 1}`} value={g.start} min={items[i].start + 1} max={g.end - 1} onCommit={(frame) => layout({ op: "boundary", index: i + 1, frame })} className="w-24" />
                <Button size="sm" variant="ghost" className="h-8 rounded-full px-2" aria-label={`Merge segments ${i + 1} and ${i + 2}`} onClick={() => layout({ op: "merge", index: i + 1 })}>
                  <Combine className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <ol className="space-y-3">
          {items.map((seg, i) => (
            <SegmentCard key={seg.id} {...props} shot={shot} seg={seg} index={i} state={states[i]} count={items.length} />
          ))}
        </ol>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
          <Button
            className="h-9 rounded-full"
            disabled={queue.isPending}
            onClick={() =>
              queue.mutate(
                { clipId: clip.id, shotId: shot.id, segmentId: items[0].id, mode: "all" },
                { onSuccess: (r) => toast(`Queued ${r.takes.length} take${r.takes.length === 1 ? "" : "s"}`), onError: (e) => toastError(e) },
              )
            }
          >
            {queue.isPending ? <Loader2 className="size-4 animate-spin" /> : <ListVideo className="size-4" />} Queue all segments
          </Button>
          <span className="text-[12px] text-muted-foreground">
            {shotPrice ? `${shotPrice.segments} to make · ` : ""}
            <span className="font-mono">{priceText(shotPrice?.costUsd, { demo: estimate?.demo, engine: project.engine })}</span>
          </span>
        </div>
      </Panel>
    </div>
  );
}
