"use client";

import { Ban, Download, Film, Library, Loader2, Play, Star } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel } from "@/components/av/tool-shell";
import { Segmented } from "@/components/faceless/controls";
import { characterLicenceLine } from "@/lib/catalog/character-swap";
import { assemblyPieces, assemblyTakes, currentSegments, DECISION_LABELS, FINISH_UNAVAILABLE, jobState, secondsLabel, SWAP_STUDIO, WORKERS_NOTE, type Decision, type SwapTake } from "@/lib/catalog/swap-studio";
import { STUDIO_MODELS } from "@/lib/catalog/swap-studio-plan";
import { downloadHref } from "@/lib/library";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { decisionsHref, useAssemble, useStopJob } from "./hooks";
import { GenChip, JobError, Note, priceText, SavedText } from "./parts";
import type { StageProps } from "./workbench";

const DECISIONS = Object.keys(DECISION_LABELS) as Decision[];

interface TakeRef {
  key: string;
  label: string;
  url: string;
  shotId: string;
  segmentId: string;
  take: SwapTake;
}

/** Every finished take of the clip, for comparing. */
function finishedTakes({ clip, gens }: Pick<StageProps, "clip" | "gens">): TakeRef[] {
  const out: TakeRef[] = [];
  clip.shots.forEach((s, si) =>
    currentSegments(s).forEach((g, gi) =>
      g.takes.forEach((t, ti) => {
        const url = t.genId && gens[t.genId]?.status === "succeeded" ? gens[t.genId].url : undefined;
        if (url) out.push({ key: t.id, label: `Shot ${si + 1} · segment ${gi + 1} · take ${ti + 1}${g.selectedTake === t.id ? " (chosen)" : ""}`, url, shotId: s.id, segmentId: g.id, take: t });
      }),
    ),
  );
  return out;
}

/** Two takes side by side, played together. */
function Compare({ takes }: { takes: TakeRef[] }) {
  const [a, setA] = useState<string | undefined>(takes[0]?.key);
  const [b, setB] = useState<string | undefined>(takes[1]?.key);
  const va = useRef<HTMLVideoElement>(null);
  const vb = useRef<HTMLVideoElement>(null);
  if (takes.length < 2) return <Note>Make two takes of a segment (or of two segments) to compare them side by side.</Note>;
  const pick = (k: string | undefined) => takes.find((t) => t.key === k);
  const both = () => {
    for (const v of [va.current, vb.current]) {
      if (!v) continue;
      v.currentTime = 0;
      void v.play().catch(() => undefined);
    }
  };
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {(
          [
            ["A", a, setA, va],
            ["B", b, setB, vb],
          ] as const
        ).map(([name, value, set, ref]) => (
          <div key={name} className="min-w-0 space-y-1.5">
            <Select value={value} onValueChange={set}>
              <SelectTrigger className="h-8 w-full min-w-0 text-[12px]" aria-label={`Take ${name}`}>
                <SelectValue placeholder={`Take ${name}`} />
              </SelectTrigger>
              <SelectContent>
                {takes.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {pick(value) && <video ref={ref} src={pick(value)!.url} controls muted playsInline preload="metadata" className="aspect-video w-full rounded-lg bg-media object-contain" />}
          </div>
        ))}
      </div>
      <Button size="sm" variant="outline" className="h-8 rounded-full" onClick={both}>
        <Play className="size-3.5" /> Play both from the start
      </Button>
    </div>
  );
}

/** Takes & review: compare takes, favourite, keep / maybe / skip with notes, the clip's review, Export decisions. */
export function ReviewStage(props: StageProps) {
  const { id, clip, shot, gens, edit } = props;
  const takes = finishedTakes(props);
  return (
    <div className="space-y-3">
      <Panel
        title="Compare"
        aside={
          <Button asChild size="sm" variant="ghost" className="h-8 rounded-full">
            <a href={decisionsHref(id)} download>
              <Download className="size-3.5" /> Export decisions
            </a>
          </Button>
        }
      >
        <Compare key={clip.id} takes={takes} />
      </Panel>

      {shot && shot.mode === "generate" && (
        <Panel title="This shot's takes">
          {!currentSegments(shot).some((g) => g.takes.length) ? (
            <p className="text-[12px] text-muted-foreground">No takes yet — queue segments in Segments.</p>
          ) : (
            <ol className="space-y-4">
              {currentSegments(shot).map((g, gi) =>
                g.takes.length ? (
                  <li key={g.id} className="space-y-2">
                    <p className="text-[13px] font-medium">
                      Segment {gi + 1} <span className="font-normal text-muted-foreground">· {secondsLabel(g.end - g.start)}</span>
                    </p>
                    <ul className="grid gap-2 sm:grid-cols-2">
                      {g.takes.map((t, ti) => {
                        const s = t.state === "launched" ? jobState(t.genId, t.stepIds, gens) : null;
                        const url = s?.status === "succeeded" && t.genId ? gens[t.genId]?.url : undefined;
                        const ref = { clipId: clip.id, shotId: shot.id, segmentId: g.id, takeId: t.id } as const;
                        return (
                          <li key={t.id} className={cn("min-w-0 space-y-2 rounded-xl border p-2.5", g.selectedTake === t.id && "border-success")}>
                            <div className="flex items-center gap-2">
                              <span className="text-[12px] font-medium">Take {ti + 1}</span>
                              {s ? <GenChip genId={t.genId} stepIds={t.stepIds} gens={gens} /> : <span className="text-[11px] text-muted-foreground">{t.state === "waiting" ? "Waiting" : (t.reason ?? "Stopped")}</span>}
                              <button
                                type="button"
                                onClick={() => void edit({ type: "take", ...ref, favourite: !t.favourite })}
                                aria-pressed={t.favourite}
                                aria-label={t.favourite ? "Unfavourite" : "Favourite"}
                                className="ml-auto grid size-7 place-items-center rounded-full hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                              >
                                <Star className={cn("size-4", t.favourite ? "fill-warning text-warning" : "text-muted-foreground")} />
                              </button>
                            </div>
                            {url ? <video src={url} controls muted playsInline preload="metadata" className="aspect-video w-full rounded-lg bg-media object-contain" /> : null}
                            <Segmented label={`Take ${ti + 1} decision`} value={t.decision} options={DECISIONS.map((d) => ({ value: d, label: DECISION_LABELS[d] }))} onChange={(decision) => void edit({ type: "take", ...ref, decision })} />
                            <SavedText label="Notes" rows={2} max={SWAP_STUDIO.maxNotesChars} value={t.notes} placeholder="lips drift at the end" onSave={(notes) => void edit({ type: "take", ...ref, notes })} />
                            {url && g.selectedTake !== t.id && (
                              <Button size="sm" variant="outline" className="h-7 rounded-full px-2.5 text-[12px]" onClick={() => void edit({ type: "take", ...ref, select: true })}>
                                Use this take
                              </Button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ) : null,
              )}
            </ol>
          )}
        </Panel>
      )}

      <Panel title="This clip's review">
        <div className="space-y-3">
          <Segmented label="Clip decision" value={clip.review} options={DECISIONS.map((d) => ({ value: d, label: DECISION_LABELS[d] }))} onChange={(review) => void edit({ type: "clip", clipId: clip.id, review })} />
          <SavedText label="Notes" rows={2} max={SWAP_STUDIO.maxNotesChars} value={clip.reviewNotes} onSave={(reviewNotes) => void edit({ type: "clip", clipId: clip.id, reviewNotes })} />
        </div>
      </Panel>
    </div>
  );
}

/** Assemble: the chosen takes over the original timeline with the clip's own sound; the Finish stage said as not available. */
export function AssembleStage({ id, project, clip, gens, estimate }: StageProps) {
  const assemble = useAssemble(id);
  const stop = useStopJob(id);
  const found = assemblyPieces(project, clip);
  const a = clip.assembly;
  const state = jobState(a?.genId, a?.stepIds, gens);
  const result = state.status === "succeeded" && a?.genId ? gens[a.genId]?.url : undefined;
  const current = "pieces" in found && !!a && JSON.stringify(a.takes) === JSON.stringify(assemblyTakes(found.pieces));
  return (
    <div className="space-y-3">
      <Panel title="Assemble the clip" aside={<span className="font-mono text-[11px] text-muted-foreground">{priceText(estimate?.assembly[clip.id], { demo: estimate?.demo, engine: project.engine })}</span>}>
        <div className="space-y-3">
          {"problem" in found ? (
            <Note tone="warn">{found.problem}</Note>
          ) : (
            <>
            {found.stale.length > 0 && (
              <Note tone="warn">
                {found.stale.join("; ")} {found.stale.length === 1 ? "uses a take" : "use takes"} made before later changes (settings, words, the character or the take before). The assembly uses {found.stale.length === 1 ? "it" : "them"} as {found.stale.length === 1 ? "it is" : "they are"} — queue {found.stale.length === 1 ? "it" : "them"} again in Segments for current ones.
              </Note>
            )}
            <ol className="flex min-w-0 flex-wrap gap-1.5" aria-label="Pieces">
              {found.pieces.map((p, i) => (
                <li key={i} className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium", p.kind === "take" ? "bg-brand-faint text-brand-text" : "bg-muted text-muted-foreground")}>
                  {p.kind === "take" ? "Your character" : "As filmed"} · {secondsLabel(p.end - p.start)}
                </li>
              ))}
            </ol>
            </>
          )}
          <p className="text-[12px] text-muted-foreground">
            {project.engine === "open"
              ? "Each piece is fitted to the clip's size at 24 fps, joined packet by packet, and the clip's own sound goes back on."
              : "The clip's pieces are cut to their frames, every piece is scaled to one frame size, they're joined at 24 fps (H3's rate), and the clip's own sound — or its silence — goes back on."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              className="h-9 rounded-full"
              disabled={"problem" in found || assemble.isPending || state.status === "queued" || state.status === "running" || (current && state.status === "succeeded")}
              onClick={() => assemble.mutate({ clipId: clip.id }, { onSuccess: () => toast("Assembling the clip"), onError: (e) => toastError(e) })}
            >
              {assemble.isPending ? <Loader2 className="size-4 animate-spin" /> : <Film className="size-4" />} {a ? "Assemble again" : "Assemble clip"}
            </Button>
            {a && <GenChip genId={a.genId} stepIds={a.stepIds} gens={gens} />}
            {(state.status === "queued" || state.status === "running") && (
              <Button size="sm" variant="ghost" className="h-8 rounded-full" onClick={() => stop.mutate({ kind: "assembly", clipId: clip.id })}>
                Stop
              </Button>
            )}
            {a && !current && state.status === "succeeded" && <span className="text-[12px] text-muted-foreground">The chosen takes changed since — assemble again for the new ones.</span>}
          </div>
          <JobError genId={a?.genId} stepIds={a?.stepIds} gens={gens} />
          {result && (
            <div className="space-y-2">
              <video src={result} controls playsInline preload="metadata" className="max-h-[46vh] w-full rounded-xl bg-media" />
              <div className="flex flex-wrap gap-2">
                <Button asChild size="sm" className="h-8 rounded-full">
                  <a href={downloadHref(result, `${clip.name}-character-swap.mp4`)}>
                    <Download className="size-3.5" /> Download
                  </a>
                </Button>
                <Button asChild size="sm" variant="outline" className="h-8 rounded-full">
                  <Link href="/library">
                    <Library className="size-3.5" /> In the Library
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </div>
      </Panel>

      <Panel title={FINISH_UNAVAILABLE.title} aside={<span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"><Ban className="size-3" /> Not available</span>}>
        <p className="text-[12px] leading-snug text-pretty text-muted-foreground">{FINISH_UNAVAILABLE.reason}</p>
      </Panel>

      <Panel title="Where it runs">
        <ul className="space-y-1.5 text-[12px] leading-snug text-pretty text-muted-foreground">
          {project.engine === "open" && <li>{WORKERS_NOTE}</li>}
          {(estimate?.notes ?? []).filter((n) => n !== WORKERS_NOTE).map((n) => (
            <li key={n}>{n}</li>
          ))}
          {!estimate && <li>{characterLicenceLine(project.engine, STUDIO_MODELS[project.engine].swap)}</li>}
        </ul>
      </Panel>
    </div>
  );
}
