"use client";

import { BookmarkPlus, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSaveElement } from "@/lib/api";
import { bboxFromAlpha, elementDraft, LAYER_ELEMENT_KINDS, type LayerElementKind, type LayerNode } from "@/lib/layers";
import { toastError } from "@/lib/refusals";
import { Field, Segmented } from "./bits";
import { LayerThumb } from "./layers-panel";
import { renderNative, uploadRender } from "./render";

/** The layer alone at its own detail (mask applied), trimmed to its visible pixels; null when it's empty. */
async function layerPng(node: LayerNode): Promise<HTMLCanvasElement | null> {
  const c = await renderNative(node, 2048);
  const box = bboxFromAlpha(c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data, c.width, c.height, 8);
  if (!box) return null;
  if (box[2] === c.width && box[3] === c.height) return c;
  const out = document.createElement("canvas");
  out.width = box[2];
  out.height = box[3];
  out.getContext("2d")!.drawImage(c, box[0], box[1], box[2], box[3], 0, 0, box[2], box[3]);
  return out;
}

/**
 * Save as element (from a layer's menu): the layer's PNG, transparency kept, becomes an @character,
 * prop or style that any prompt can mention.
 */
export function SaveElementDialog({ node, open, onOpenChange }: { node: LayerNode; open: boolean; onOpenChange: (v: boolean) => void }) {
  const router = useRouter();
  const save = useSaveElement();
  const [draft] = useState(() => elementDraft(node));
  const [name, setName] = useState(draft.name);
  const [kind, setKind] = useState<LayerElementKind>(draft.kind);
  const [busy, setBusy] = useState(false);
  const info = LAYER_ELEMENT_KINDS.find((k) => k.kind === kind)!;

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const png = await layerPng(node);
      if (!png) throw new Error("This layer has nothing visible to save");
      const url = await uploadRender(png, `element-${name}`);
      const el = await save.mutateAsync({ name: name.trim(), kind, ...(draft.description ? { description: draft.description } : {}), references: [url] });
      onOpenChange(false);
      toast.success(`Saved as @${el.handle}`, { description: `${info.label} · use it in any prompt`, action: { label: "Open", onClick: () => router.push(`/elements/${el.id}`) } });
    } catch (e) {
      toastError(e, "Couldn't save the element");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save as element</DialogTitle>
          <DialogDescription>The layer&apos;s picture (transparency kept) becomes a reusable element: mention it by its @name in any prompt to bring it back.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex items-center gap-3 rounded-lg bg-muted/70 p-2.5">
            <LayerThumb node={node} className="size-14" />
            <p className="min-w-0 flex-1 truncate text-[13px]">
              From <span className="font-medium">{node.name}</span>
            </p>
          </div>
          <Field label="Name" htmlFor="element-name">
            <Input id="element-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="h-9" autoFocus />
          </Field>
          <Field label="Kind">
            <Segmented label="Kind" value={kind} onChange={setKind} options={LAYER_ELEMENT_KINDS.map((k) => [k.kind, k.label] as const)} />
          </Field>
          <p className="-mt-2 text-[12px] text-muted-foreground">{info.hint}.</p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" className="rounded-full" disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <BookmarkPlus />} Save element
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
