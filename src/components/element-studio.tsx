"use client";

import { AtSign, GraduationCap, Loader2, Pencil, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { NotFoundState, PageState } from "@/components/empty-state";
import { ElementDialog } from "@/components/elements-view";
import { StudioSkeleton } from "@/components/skeletons";
import { StudioPage } from "@/components/studio/studio-page";
import type { StudioConfig } from "@/components/studio/studio-context";
import { TrainDialog } from "@/components/train-dialog";
import { TurnaroundButton, useCharacterPictures } from "@/components/turnaround/turnaround-dialog";
import { Button } from "@/components/ui/button";
import { useElement } from "@/lib/api";
import { loraFamily, TRAINING_FAMILIES } from "@/lib/catalog/training";

const NO_REFS: string[] = [];

/**
 * A studio for one element: the prompt starts with its @handle, references are resolved by the
 * server. Lives apart from the Elements list so /elements doesn't load the composer.
 */
export function ElementStudio({ id }: { id: string }) {
  const q = useElement(id);
  const [editing, setEditing] = useState(false);
  const [training, setTraining] = useState(false);
  const el = q.data;
  // A character's pictures (a wide one is its sheet) for "Fly around this character".
  const pictures = useCharacterPictures(el?.kind === "character" ? el.references.slice(0, 12) : NO_REFS);
  const config = useMemo<StudioConfig | null>(() => {
    if (!el) return null;
    // A trained Soul ID runs on its family's lead model (Fuobe Soul, Soul HD, FLUX…): start there, on each engine it has.
    const fam = el.loras.filter((l) => !l.demo).map(loraFamily).find(Boolean);
    const lead = fam ? TRAINING_FAMILIES[fam].lead : null;
    return {
      feature: `element:${el.id}`,
      title: el.name,
      hero:
        el.kind === "character"
          ? `Where should ${el.name} go next?`
          : el.kind === "location"
            ? `What happens at ${el.name}?`
            : el.kind === "prop"
              ? `Where should ${el.name} show up?`
              : `What should look like ${el.name}?`,
      subtitle: lead
        ? `Trained: @${el.handle} uses its Soul ID on ${TRAINING_FAMILIES[fam!].name}. Mention it in any studio to use ${el.kind === "character" ? "them" : "it"} there too.`
        : `Mention @${el.handle} in any studio to use ${el.kind === "character" ? "them" : "it"} there too.`,
      placeholder: `Describe a scene with @${el.handle}…`,
      kind: "image",
      ops: ["t2i", "edit"],
      feed: { features: [`element:${el.id}`, `character:${el.id}`] },
      slots: [],
      multiRef: { label: "Add ref", max: 8 },
      defaultModels: { cloud: lead?.cloud ?? "nano-banana-pro", open: lead?.open ?? "oss-qwen-image-21" },
    };
  }, [el]);

  if (q.isError) {
    const missing = /not found|404/i.test((q.error as Error).message);
    return missing ? (
      <NotFoundState title="No such element">It may have been deleted. Your other characters, places and props are on the Elements page.</NotFoundState>
    ) : (
      <PageState
        icon={AtSign}
        title="Couldn’t load this element"
        actions={
          <>
            <Button onClick={() => void q.refetch()}>
              <RotateCcw /> Try again
            </Button>
            <Button asChild variant="outline">
              <Link href="/elements">All elements</Link>
            </Button>
          </>
        }
      >
        {(q.error as Error).message}
      </PageState>
    );
  }
  if (!config || !el) return <StudioSkeleton />;
  const trained = el.loras.filter((l) => !l.demo && !l.referenceId).length;
  const trainLabel = el.status === "training" ? "Training…" : trained ? `Soul ID · ${trained}` : el.loras.some((l) => l.referenceId) ? "Retrain" : "Train";
  return (
    <>
      <StudioPage
        config={config}
        initialPrompt={`@${el.handle} `}
        header={
          <>
            {el.kind !== "voice" && (
              <Button
                variant={trained ? "ghost" : "secondary"}
                size="sm"
                onClick={() => setTraining(true)}
                // The label is hidden on phones.
                aria-label={trainLabel}
              >
                {el.status === "training" ? <Loader2 className="animate-spin" /> : <GraduationCap />}
                <span className="hidden sm:inline">{trainLabel}</span>
              </Button>
            )}
            {el.kind === "character" && el.references.length > 0 && (
              <TurnaroundButton flyAround label="Fly around" variant="ghost" compact pictures={pictures} name={el.name} elementId={el.id} realPerson />
            )}
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} aria-label={`Edit ${el.name}`}>
              <Pencil /> <span className="hidden sm:inline">Edit</span>
            </Button>
          </>
        }
      />
      <ElementDialog open={editing} onOpenChange={setEditing} element={el} />
      <TrainDialog open={training} onOpenChange={setTraining} element={el} />
    </>
  );
}
