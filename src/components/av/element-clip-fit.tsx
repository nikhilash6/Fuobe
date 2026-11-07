"use client";

import { Loader2, Scissors } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type { SlotValue } from "@/components/studio/media-slot";
import { useMediaSeconds } from "@/components/studio/reference-tray";
import { useSaveElement } from "@/lib/api";
import { elementClipCheck, elementClips } from "@/lib/av/reference-fit";
import type { StudioElement } from "@/lib/catalog/elements";
import type { GenerationRequest, ModelDef } from "@/lib/catalog/types";
import { toastError } from "@/lib/refusals";
import { cn } from "@/lib/utils";
import { ListFit, type ListItem } from "./fit-list";
import { useUploadSwitches } from "./use-upload-switches";

/** Operations that edit a clip: the clip edited counts in the model's clips in all. */
const EDITS = new Set(["v2v", "video-swap", "video-insert"]);

/**
 * Clip elements (Kling 4.0: a character or prop given as a 3–8 s clip, with every clip of the run 30 s in all), mentioned by
 * name: their lengths read here before the run, and what is wrong said as the run's blocker. The fix ("Trim Maya's clip")
 * opens the picker on that element's clip, and the part is saved on the element in place of the clip.
 * `request` is the run as applyMentions resolved it (its elements and clips).
 */
export function useElementClipCheck(model: Pick<ModelDef, "id" | "name"> | undefined, request: Pick<GenerationRequest, "op" | "params" | "inputs"> | undefined, mentioned: readonly StudioElement[]) {
  const clips = useMemo(() => (model && request && mentioned.length ? elementClips(request, mentioned) : []), [model, request, mentioned]);
  // The run's other clips (reference clips, and the clip an edit edits) count in its clips in all, but aren't cut here.
  const others = useMemo(() => {
    if (!clips.length || !request) return [];
    const own = new Set(clips.map((c) => c.ref));
    const refs = (request.inputs?.videos ?? []).filter((r) => !own.has(r));
    const edited = request.op && EDITS.has(request.op) && request.inputs?.video ? [request.inputs.video] : [];
    return [...refs, ...edited];
  }, [clips, request]);
  const seconds = useMediaSeconds([...clips.map((c) => c.ref), ...others].map((r): SlotValue => ({ ref: r, preview: r, kind: "video" })));
  const own = seconds.slice(0, clips.length);
  const rest = seconds.slice(clips.length).reduce<number>((a, s) => a + (s ?? 0), 0);
  const check = model && clips.length ? elementClipCheck(model, clips.map((c, i) => ({ name: c.element.name, seconds: own[i] })), rest) : null;
  const target = check?.target ? { ...check.target, clip: clips[check.target.index], seconds: own[check.target.index] } : null;
  return { problem: check?.problem ?? null, target, model };
}

/** The fix under the run's line: "Trim Maya's clip", then the picker on that clip; the part goes on the element. */
export function ElementClipFix({ check, className }: { check: ReturnType<typeof useElementClipCheck>; className?: string }) {
  const sw = useUploadSwitches();
  const t = check.target;
  if (!t || !check.model || !sw.videoTrim) return null;
  return <ElementTrim key={`${t.clip.element.id}:${t.clip.ref}`} target={t} problem={check.problem} model={check.model} className={className} />;
}

function ElementTrim({ target, problem, model, className }: { target: NonNullable<ReturnType<typeof useElementClipCheck>["target"]>; problem: string | null; model: Pick<ModelDef, "name">; className?: string }) {
  const save = useSaveElement();
  const el = target.clip.element;
  const [open, setOpen] = useState(false);
  // The clip as the picker sees it: swapped for a stand-in while the part is cut, then for the part.
  const [item, setItem] = useState<ListItem>(() => ({ ref: target.clip.ref, preview: target.clip.ref, kind: "video", name: `${el.name}.mp4` }));
  const replace = (_from: ListItem, to: SlotValue) => {
    setItem({ ...to, id: to.id ?? item.id });
    if (to.uploading || !to.ref || to.ref === target.clip.ref) return;
    save.mutate({ id: el.id, name: el.name, references: el.references.map((r) => (r === target.clip.ref ? to.ref : r)) }, {
        onSuccess: () => toast.success(`${el.name} now uses the part you picked`),
        onError: (e) => toastError(e, `We couldn't save the part on ${el.name}. Try again`),
      });
  };
  return (
    <div className={cn("space-y-1.5 pb-2", className)}>
      {!open && problem && <p className="text-xs text-destructive">{problem}</p>}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border bg-background px-3.5 text-[13px] font-medium text-foreground hover:bg-accent"
        >
          <Scissors className="size-3.5" /> Trim {el.name}&apos;s clip
        </button>
      )}
      {open && <ListFit item={item} seconds={item.ref === target.clip.ref ? target.seconds : undefined} kind="video" max={target.max} min={target.min} tool={model.name} line={target.line} label={`${el.name}'s clip`} replace={replace} />}
      {save.isPending && (
        <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Saving the part on {el.name}…
        </p>
      )}
    </div>
  );
}
