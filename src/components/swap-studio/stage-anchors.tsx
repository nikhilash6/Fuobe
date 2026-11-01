"use client";

import { Check, ImageUp, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Panel } from "@/components/av/tool-shell";
import { ToggleRow } from "@/components/faceless/controls";
import { uploadFile } from "@/lib/api";
import { ANCHOR_MODELS } from "@/lib/catalog/character-swap";
import { jobState, SWAP_STUDIO, type AnchorVariant, type GenSummary, type SwapSegment } from "@/lib/catalog/swap-studio";
import { anchorWords } from "@/lib/catalog/swap-studio-plan";
import type { Engine } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { useMakeAnchor, useStopJob, useSwapEdit } from "./hooks";
import { GenChip, JobError, Note, priceText, SavedText } from "./parts";
import type { StageProps } from "./workbench";

/** Make (with the engine's image edit) or import an anchor: the shot's scene anchor, or a segment's own reference. */
export function AnchorMaker({ id, project, clip, shotId, segment, estimate }: Pick<StageProps, "id" | "project" | "clip" | "estimate"> & { shotId: string; segment?: SwapSegment }) {
  const make = useMakeAnchor(id);
  const importer = useSwapEdit(id);
  const engine = project.engine;
  const models = estimate?.anchors ?? ANCHOR_MODELS[engine].map((m) => ({ ...m, costUsd: null, offered: true }));
  const [modelId, setModelId] = useState<string>(models.find((m) => m.offered)?.id ?? ANCHOR_MODELS[engine][0].id);
  const [importing, setImporting] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const picked = models.find((m) => m.id === modelId);
  const which = segment ? "reference" : "anchor";

  const doImport = async (f: File) => {
    if (!f.type.startsWith("image/")) return toast.error("Pick an image");
    setImporting(true);
    try {
      const a = await uploadFile(f);
      await importer.mutateAsync({ type: "anchor-import", clipId: clip.id, shotId, ...(segment ? { segmentId: segment.id } : {}), url: a.url });
      toast(`Imported the ${which}`);
    } catch (e) {
      toastError(e);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-wrap items-end gap-2">
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-[12px] font-medium">
        Image model
        <Select value={modelId} onValueChange={setModelId}>
          <SelectTrigger className="h-8 w-full min-w-0 text-[13px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id} disabled={!m.offered}>
                {m.label} · {priceText(m.costUsd, { demo: estimate?.demo, engine })}
                {!m.offered ? " · switched off" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <Button
        size="sm"
        className="h-8 rounded-full"
        disabled={make.isPending || !project.character.image}
        title={!project.character.image ? "Add a picture of your character first" : picked?.note}
        onClick={() =>
          make.mutate({ clipId: clip.id, shotId, ...(segment ? { segmentId: segment.id } : {}), modelId }, { onSuccess: () => toast(`Making a ${which} with ${picked?.label ?? "the image model"}`), onError: (e) => toastError(e) })
        }
      >
        {make.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Make {which}
      </Button>
      <Button size="sm" variant="outline" className="h-8 rounded-full" disabled={importing} onClick={() => file.current?.click()}>
        {importing ? <Loader2 className="size-3.5 animate-spin" /> : <ImageUp className="size-3.5" />} Import
      </Button>
      <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && void doImport(e.target.files[0])} />
    </div>
  );
}

/** A grid of anchor variants with their state, approval and removal. */
export function AnchorGrid({
  items,
  chosen,
  gens,
  onChoose,
  onRemove,
  onStop,
  chooseLabel,
}: {
  items: AnchorVariant[];
  chosen: string | null;
  gens: Record<string, GenSummary>;
  onChoose: (a: AnchorVariant) => void;
  onRemove: (a: AnchorVariant) => void;
  onStop: (a: AnchorVariant) => void;
  chooseLabel: [string, string];
}) {
  if (!items.length) return <p className="text-[12px] text-muted-foreground">None yet.</p>;
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {items.map((a, i) => {
        const s = jobState(a.genId, a.stepIds, gens);
        const on = chosen === a.id;
        return (
          <li key={a.id} className={cn("min-w-0 space-y-1.5 rounded-xl border p-2", on && "border-success")}>
            <div className="grid aspect-video place-items-center overflow-hidden rounded-lg bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {a.url ? <img src={a.url} alt={`Variant ${i + 1}`} className="size-full object-contain" /> : <GenChip genId={a.genId} stepIds={a.stepIds} gens={gens} />}
            </div>
            <p className="truncate text-[11px] text-muted-foreground">
              {i + 1} · {a.source === "imported" ? "Imported" : (ANCHOR_MODELS.cloud.concat(ANCHOR_MODELS.open).find((m) => m.id === a.modelId)?.label ?? "Made")}
            </p>
            <JobError genId={a.genId} stepIds={a.stepIds} gens={gens} />
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant={on ? "secondary" : "outline"} className="h-7 rounded-full px-2 text-[12px]" disabled={!a.url || on} onClick={() => onChoose(a)}>
                <Check className="size-3.5" /> {on ? chooseLabel[1] : chooseLabel[0]}
              </Button>
              {s.status === "queued" || s.status === "running" ? (
                <Button size="sm" variant="ghost" className="h-7 rounded-full px-2 text-[12px]" onClick={() => onStop(a)}>
                  Stop
                </Button>
              ) : (
                <Button size="sm" variant="ghost" className="h-7 rounded-full px-2 text-[12px]" aria-label={`Remove variant ${i + 1}`} onClick={() => onRemove(a)}>
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const engineWords = (e: Engine) => (e === "open" ? "Qwen-Image-Edit 2511 on your GPU" : "GPT Image 2.5 Sunburst or Nano Banana Pro on fal");

/** Scene anchors: the shot's first frame with your character in it (H3's <Picture 2>), approved before segments use it. */
export function AnchorsStage(props: StageProps) {
  const { id, project, clip, shot, gens, edit } = props;
  const stop = useStopJob(id);
  if (!shot) return <Note>Pick a shot.</Note>;
  if (shot.mode !== "generate") return <Note>This shot keeps its original — no anchor needed.</Note>;
  return (
    <div className="space-y-3">
      <Panel title="Scene anchor">
        <div className="space-y-3">
          <ToggleRow
            label="Use a scene anchor"
            hint="The shot's first frame with your character in it: H3 starts from it (the first segment's Picture 2)"
            checked={shot.settings.useAnchor}
            onChange={(useAnchor) => void edit({ type: "shot", clipId: clip.id, shotId: shot.id, patch: { settings: { useAnchor } } })}
          />
          {shot.settings.useAnchor && (
            <>
              <AnchorMaker {...props} shotId={shot.id} />
              <p className="text-[12px] text-muted-foreground">Made with {engineWords(project.engine)} from your character&apos;s picture and the shot&apos;s first frame.</p>
              <AnchorGrid
                items={shot.anchors}
                chosen={shot.approvedAnchor}
                gens={gens}
                chooseLabel={["Approve", "Approved"]}
                onChoose={(a) => void edit({ type: "shot", clipId: clip.id, shotId: shot.id, patch: { approvedAnchor: a.id } })}
                onRemove={(a) => void edit({ type: "remove-anchor", clipId: clip.id, shotId: shot.id, anchorId: a.id })}
                onStop={(a) => stop.mutate({ kind: "anchor", clipId: clip.id, shotId: shot.id, jobId: a.id })}
              />
              {!shot.approvedAnchor && shot.anchors.some((a) => a.url) && <Note tone="warn">Approve one: the first segment waits for an approved anchor (or set it to “No anchor” in Segments).</Note>}
            </>
          )}
        </div>
      </Panel>
      {shot.settings.useAnchor && (
        <Panel title="What the image model is told">
          <div className="space-y-3">
            <SavedText
              label="Extra instructions"
              rows={2}
              max={SWAP_STUDIO.maxPromptChars}
              value={shot.anchorInstructions}
              placeholder="keep the umbrella in her left hand"
              onSave={(anchorInstructions) => void edit({ type: "shot", clipId: clip.id, shotId: shot.id, patch: { anchorInstructions } })}
            />
            <SavedText
              label="Custom base prompt"
              rows={4}
              max={SWAP_STUDIO.maxPromptChars}
              value={shot.anchorBasePrompt}
              placeholder={anchorWords(project, { ...shot, anchorInstructions: "" })}
              hint="empty: Akatz Labs' brief"
              onSave={(anchorBasePrompt) => void edit({ type: "shot", clipId: clip.id, shotId: shot.id, patch: { anchorBasePrompt } })}
            />
          </div>
        </Panel>
      )}
    </div>
  );
}
