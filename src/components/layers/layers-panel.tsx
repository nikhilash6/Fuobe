"use client";

import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  Brush,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  GripVertical,
  ImagePlus,
  Library,
  Loader2,
  MoreHorizontal,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  RotateCcw,
  Scissors,
  Sparkles,
  SplitSquareVertical,
  Link2,
  Trash2,
  TriangleAlert,
  Unlink2,
  Upload,
  X,
} from "lucide-react";
import { nanoid } from "nanoid";
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { LibraryGrid } from "@/components/studio/media-slot";
import { uploadFile } from "@/lib/api";
import {
  addNodes,
  deleteNode,
  duplicateNode,
  jobStatusText,
  LayerLimitError,
  moveNode,
  roomFor,
  setRevision,
  TOOL_LABELS,
  TOOL_MODELS,
  updateNode,
  type LayerNode,
  type LayerRevision,
} from "@/lib/layers";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { Field } from "./bits";
import { costLabel, modelsFor, TOOL_FOR_JOB, useEditor } from "./editor-context";
import { useKeepAlpha } from "./keep-alpha";
import { downloadLayer, loadImage, sizeOf } from "./render";
import { SaveElementDialog } from "./save-element";

/**
 * A layer's thumbnail showing just the part of its image it uses (its crop), on a mid-grey
 * checkerboard so white-only layers (text) and black-only ones both stay visible in either theme.
 */
export function LayerThumb({ node, className }: { node: Pick<LayerNode, "src" | "crop" | "natural" | "w" | "h">; className?: string }) {
  const crop = node.crop;
  const nat = node.natural;
  const aspect = node.w / node.h;
  const style: React.CSSProperties =
    crop && nat
      ? {
          backgroundImage: `url("${node.src}")`,
          backgroundSize: `${(nat[0] / crop[2]) * 100}% ${(nat[1] / crop[3]) * 100}%`,
          backgroundPosition: `${nat[0] === crop[2] ? 0 : (crop[0] / (nat[0] - crop[2])) * 100}% ${nat[1] === crop[3] ? 0 : (crop[1] / (nat[1] - crop[3])) * 100}%`,
        }
      : { backgroundImage: `url("${node.src}")`, backgroundSize: "100% 100%" };
  return (
    <span className={cn("grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border", className)} style={THUMB_CHECKER}>
      <span className="block max-h-full max-w-full bg-no-repeat" style={{ ...style, aspectRatio: `${aspect}`, width: aspect >= 1 ? "100%" : "auto", height: aspect >= 1 ? "auto" : "100%" }} />
    </span>
  );
}

const THUMB_CHECKER: React.CSSProperties = {
  backgroundColor: "#8f8f8f",
  backgroundImage: "conic-gradient(#a6a6a6 25%, transparent 0 50%, #a6a6a6 0 75%, transparent 0)",
  backgroundSize: "10px 10px",
};

/** Add a layer from a file or the library: sized to fit 80% of the canvas, centred. */
async function layerFromImage(url: string, name: string, doc: { width: number; height: number }): Promise<LayerNode> {
  const img = await loadImage(url);
  const natural = sizeOf(img);
  const k = Math.min(1, (doc.width * 0.8) / natural[0], (doc.height * 0.8) / natural[1]);
  const w = natural[0] * k;
  const h = natural[1] * k;
  const rev: LayerRevision = { src: url, crop: null, natural, label: "Added", at: Date.now() };
  return { id: nanoid(8), name: name.slice(0, 80) || "Uploaded layer", z: 0, x: (doc.width - w) / 2, y: (doc.height - h) / 2, w, h, rotation: 0, src: url, crop: null, natural, revisions: [rev], revision: 0 };
}

function AddLayer() {
  const { doc, commit, select, run, engine, models, offeredIds, isDemo } = useEditor();
  const file = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [ref, setRef] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = modelsFor(models, offeredIds(TOOL_MODELS["generate-layer"][engine]));
  const [modelId, setModelId] = useState<string | undefined>();
  const model = options.find((m) => m.id === modelId) ?? options[0];

  const add = async (url: string, name: string) => {
    try {
      const n = await layerFromImage(url, name, doc);
      commit(addNodes(doc, [n]));
      select(n.id);
      toast.success("Layer added", { duration: 1500 });
    } catch (e) {
      toast.error(e instanceof LayerLimitError ? e.message : "Failed to add layer");
    }
  };

  return (
    <>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            const a = await uploadFile(f);
            await add(a.url, f.name.replace(/\.[^.]+$/, "") || "Uploaded layer");
          } catch (err) {
            toastError(err);
          }
        }}
      />
      <Popover open={picking} onOpenChange={setPicking}>
        <DropdownMenu>
          <PopoverAnchor asChild>
            <DropdownMenuTrigger asChild>
              <Button size="xs" variant="secondary" className="rounded-full">
                <Plus /> Add layer
              </Button>
            </DropdownMenuTrigger>
          </PopoverAnchor>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => setTimeout(() => setPicking(true))}>
              <Library /> Choose asset
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => file.current?.click()}>
              <Upload /> Upload image
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTimeout(() => setGenerating(true))}>
              <Sparkles /> Generate layer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <PopoverContent align="end" className="w-[min(92vw,380px)] p-2" collisionPadding={12}>
          <p className="px-1 pb-2 text-[13px] font-medium">Choose an image to add as a layer</p>
          {picking && (
            <LibraryGrid
              kinds={["image"]}
              onPick={(v) => {
                setPicking(false);
                void add(v.ref, v.name ?? "Library layer");
              }}
            />
          )}
        </PopoverContent>
      </Popover>

      <Dialog open={generating} onOpenChange={setGenerating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generate layer</DialogTitle>
            <DialogDescription>Describe one element. It arrives on its own transparent layer, ready to place.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!prompt.trim()) return;
              setBusy(true);
              const job = await run({ tool: "generate-layer", target: { kind: "whole" }, prompt: prompt.trim(), refs: ref ? [ref] : undefined, modelId: ref ? undefined : model?.id, label: "Generate layer" });
              setBusy(false);
              if (job) {
                setGenerating(false);
                setPrompt("");
                setRef(null);
              }
            }}
          >
            <Textarea autoFocus value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={2000} placeholder="e.g. “a red paper lantern with a gold tassel”" aria-label="Describe the layer" className="min-h-20" />
            <div className="flex flex-wrap items-center gap-2">
              <RefPicker value={ref} onChange={setRef} />
              {!ref && options.length > 1 && (
                <Select value={model?.id} onValueChange={setModelId}>
                  <SelectTrigger size="sm" className="h-8 rounded-full" aria-label="Model">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <DialogFooter className="items-center sm:justify-between">
              <span className="font-mono text-[12px] text-muted-foreground">{costLabel(model, isDemo(model))}</span>
              <Button type="submit" className="rounded-full" disabled={!prompt.trim() || busy}>
                {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Generate layer
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "Add reference": upload or pick an image, shown as a removable thumbnail. */
export function RefPicker({ value, onChange }: { value: string | null; onChange: (url: string | null) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  if (value) {
    return (
      <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-secondary pr-1 pl-1 text-[13px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={value} alt="Reference" className="size-6 rounded-full object-cover" />
        Reference
        <button type="button" className="grid size-6 place-items-center rounded-full hover:bg-accent" aria-label="Remove reference" onClick={() => onChange(null)}>
          <X className="size-3.5" />
        </button>
      </span>
    );
  }
  return (
    <>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setUploading(true);
          try {
            onChange((await uploadFile(f)).url);
          } catch (err) {
            toastError(err);
          } finally {
            setUploading(false);
          }
        }}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" size="sm" variant="secondary" className="rounded-full" disabled={uploading}>
            {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />} Add reference
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(92vw,360px)] p-2" collisionPadding={12}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mb-2 w-full"
            onClick={() => {
              setOpen(false);
              file.current?.click();
            }}
          >
            <Upload /> Upload an image
          </Button>
          {open && (
            <LibraryGrid
              kinds={["image"]}
              onPick={(v) => {
                setOpen(false);
                onChange(v.ref);
              }}
            />
          )}
        </PopoverContent>
      </Popover>
    </>
  );
}

function LayerRow({
  node,
  selected,
  busy,
  index,
  total,
  onDragHandle,
  dropBefore,
}: {
  node: LayerNode;
  selected: boolean;
  busy?: string;
  index: number;
  total: number;
  onDragHandle: (e: React.PointerEvent, id: string) => void;
  dropBefore: boolean;
}) {
  const { doc, commit, select, busyJob, failedJob, openTool, setSplitTarget, setMode, mode } = useEditor();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(node.name);
  const [savingElement, setSavingElement] = useState(false);
  const job = busyJob(node.id);
  // A failed run stays on its row until it's dismissed (its layer card or tool form says why).
  const failed = busy ? undefined : failedJob(node.id);
  const move = (dz: number) => {
    const to = node.z + dz;
    if (to < 0 || to >= total) return;
    commit(moveNode(doc, node.id, to));
  };
  const remove = () => {
    if (job) {
      toast.error(job.tool === "split" ? "Can't delete while this layer is being split" : "Can't delete while this layer is generating");
      return;
    }
    commit(deleteNode(doc, node.id));
    select(null);
    toast("Layer deleted", { duration: 1500 });
  };
  const finishRename = () => {
    setRenaming(false);
    const name = draft.trim();
    if (name && name !== node.name) commit(updateNode(doc, node.id, { name }));
    else setDraft(node.name);
  };

  return (
    <li className="relative">
      {dropBefore && <span className="absolute -top-px right-2 left-2 z-10 h-0.5 rounded-full bg-primary" aria-hidden />}
      <div
        className={cn(
          "group/row flex h-14 items-center gap-1.5 rounded-lg pr-1 pl-0.5 transition-colors",
          selected ? "bg-brand-faint" : "hover:bg-accent",
          node.hidden && "opacity-60",
        )}
      >
        <button
          type="button"
          className="grid h-10 w-5 shrink-0 cursor-grab touch-none place-items-center rounded text-subtle-foreground hover:text-foreground active:cursor-grabbing"
          data-reorder
          aria-label={`Reorder ${node.name}. Use the up and down arrow keys to move it.`}
          onPointerDown={(e) => onDragHandle(e, node.id)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              e.preventDefault();
              move(e.key === "ArrowUp" ? 1 : -1);
            }
          }}
        >
          <GripVertical className="size-4" />
        </button>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => select(node.id)} onDoubleClick={() => setRenaming(true)} aria-pressed={selected} aria-label={`Select layer ${node.name}`}>
          <LayerThumb node={node} />
          <span className="min-w-0 flex-1">
            {renaming ? null : <span className={cn("block truncate text-[13px]", selected && "font-medium text-brand-text")}>{node.name}</span>}
            {failed ? (
              <span className="flex items-center gap-1 truncate text-[11px] font-medium text-destructive">
                <TriangleAlert className="size-3 shrink-0" /> {TOOL_LABELS[failed.tool]} failed
              </span>
            ) : (
              <span className="block truncate text-[11px] text-muted-foreground">
                {busy ?? (node.revisions.length > 1 ? `Version ${node.revision + 1} of ${node.revisions.length}` : node.maskSrc ? "Masked" : `Layer ${index}`)}
              </span>
            )}
          </span>
        </button>
        {renaming && (
          <Input
            autoFocus
            value={draft}
            maxLength={80}
            aria-label="Layer name"
            className="absolute top-2 right-16 left-[4.25rem] h-7 text-[13px]"
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onBlur={finishRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") finishRename();
              if (e.key === "Escape") {
                setDraft(node.name);
                setRenaming(false);
              }
            }}
          />
        )}
        {job && <Loader2 className="size-3.5 shrink-0 animate-spin text-brand-text" aria-hidden />}
        <button
          type="button"
          className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background/60 hover:text-foreground"
          aria-label={node.hidden ? `Show layer ${node.name}` : `Hide layer ${node.name}`}
          aria-pressed={!node.hidden}
          onClick={() => commit(updateNode(doc, node.id, { hidden: !node.hidden }))}
        >
          {node.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background/60 hover:text-foreground data-[state=open]:bg-background/60" aria-label={`Actions for ${node.name}`}>
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={() => setTimeout(() => setRenaming(true), 50)}>
              <Pencil /> Rename layer
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => (roomFor(doc) ? commit(duplicateNode(doc, node.id, nanoid(8))) : toast.error(new LayerLimitError().message, { id: "layers-limit" }))}>
              <Copy /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void downloadLayer(doc, node).catch(() => toast.error("Could not download the layer."))}>
              <Download /> Download
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTimeout(() => setSavingElement(true))}>
              <BookmarkPlus /> Save as element
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                select(node.id);
                setSplitTarget(node.id);
                openTool("decompose");
              }}
            >
              <SplitSquareVertical /> Separate layer
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                select(node.id);
                setMode("eraser");
              }}
              disabled={mode === "brush" || mode === "eraser"}
            >
              <Brush /> {node.maskSrc ? "Edit mask" : "Add mask"}
            </DropdownMenuItem>
            {node.maskSrc && (
              <DropdownMenuItem onSelect={() => commit(updateNode(doc, node.id, { maskSrc: undefined }))}>
                <Scissors /> Delete mask
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => move(1)} disabled={node.z >= total - 1}>
              <ArrowUp /> Bring forward
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => move(-1)} disabled={node.z <= 0}>
              <ArrowDown /> Send backward
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={remove}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {savingElement && <SaveElementDialog node={node} open onOpenChange={setSavingElement} />}
    </li>
  );
}

/** Per-layer AI: “Layer edit prompt” + reference → Generate / Regenerate, and the layer's revisions. */
function SelectedLayer({ node }: { node: LayerNode }) {
  const { doc, commit, run, engine, models, offeredIds, isDemo, endJob, busyJob, failedJob, showJob, tool } = useEditor();
  const [prompt, setPrompt] = useState(node.prompt ?? "");
  const [ref, setRef] = useState<string | null>(node.refSrc ?? null);
  const options = modelsFor(models, offeredIds(TOOL_MODELS.regenerate[engine]));
  const [modelId, setModelId] = useState<string | undefined>();
  const model = options.find((m) => m.id === modelId) ?? options[0];
  // Layers cut out of a picture keep their transparency; full pictures (the bottom layer, a whole-image result) don't.
  const [keepAlpha, setKeepAlpha] = useKeepAlpha(node);
  const [starting, setStarting] = useState(false);
  const running = busyJob(node.id);
  // The newest failed run on this layer, whichever tool started it (its form can try again).
  const failed = failedJob(node.id);
  const failedForm = failed ? TOOL_FOR_JOB[failed.tool] : null;
  const edited = node.revisions.length > 1;
  const rev = node.revisions[node.revision];

  const go = async () => {
    if (!prompt.trim()) {
      toast.error("Describe the change in the layer edit prompt");
      return;
    }
    setStarting(true);
    commit(updateNode(doc, node.id, { prompt: prompt.trim(), refSrc: ref ?? undefined }));
    await run({ tool: "regenerate", target: { kind: "node", node }, prompt: prompt.trim(), refs: ref ? [ref] : undefined, modelId: model?.id, settings: { keepAlpha }, label: "Layer edit" });
    setStarting(false);
  };

  return (
    <div className="space-y-3 border-t px-3 pt-3 pb-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-[13px] font-medium">{node.name}</h3>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
          {Math.round(node.w)} × {Math.round(node.h)}
        </span>
      </div>
      <Field label="Layer edit prompt" htmlFor="layer-prompt">
        <Textarea
          id="layer-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          maxLength={2000}
          placeholder="e.g. “make the jacket red leather”"
          className="min-h-16 text-[13px]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void go();
          }}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <RefPicker value={ref} onChange={setRef} />
        {options.length > 1 && (
          <Select value={model?.id} onValueChange={setModelId}>
            <SelectTrigger size="sm" className="h-8 max-w-[11rem] rounded-full text-[12px]" aria-label="Model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <label className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
        Keep transparency (cut the background back out)
        <Switch checked={keepAlpha} onCheckedChange={setKeepAlpha} aria-label="Keep transparency" />
      </label>
      {running ? (
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-[12px]">
          <Loader2 className="size-3.5 animate-spin text-brand-text" />
          <span className="min-w-0 flex-1 truncate">
            {running.label} · {jobStatusText(running.result)}
          </span>
          <button type="button" className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" onClick={() => endJob(running.id, "cancel")}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[12px] text-muted-foreground">{costLabel(model, isDemo(model))}</span>
          <Button size="sm" className="rounded-full" onClick={() => void go()} disabled={starting || !model}>
            {starting ? <Loader2 className="animate-spin" /> : <Sparkles />} {edited ? "Regenerate layer" : "Generate layer"}
          </Button>
        </div>
      )}
      {failed && !(failedForm && tool === failedForm) && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px]">
          <p className="font-medium text-destructive">{failed.tool === "regenerate" ? "Layer generation failed" : `${TOOL_LABELS[failed.tool]} failed`}</p>
          <p className="text-muted-foreground">{failed.result?.error ?? "Try again."}</p>
          <div className="mt-1.5 flex gap-3">
            {failed.tool === "regenerate" ? (
              <button type="button" className="font-medium text-brand-text hover:underline" onClick={() => void go()}>
                Try again
              </button>
            ) : failedForm ? (
              <button type="button" className="font-medium text-brand-text hover:underline" onClick={() => showJob(failed)}>
                Open {TOOL_LABELS[failed.tool]}
              </button>
            ) : null}
            <button type="button" className="text-muted-foreground hover:underline" onClick={() => endJob(failed.id, "dismiss")}>
              Dismiss
            </button>
          </div>
        </div>
      )}
      {edited && (
        <div className="space-y-1.5 rounded-lg bg-muted/60 p-2">
          <div className="flex items-center gap-1">
            <Button size="icon-xs" variant="ghost" aria-label="Show previous versions" disabled={node.revision === 0} onClick={() => commit(updateNode(doc, node.id, setRevision(node, node.revision - 1)))}>
              <ChevronLeft />
            </Button>
            <span className="min-w-0 flex-1 truncate text-center text-[12px]">
              <span className="font-medium">{rev?.label ?? "Version"}</span> · {node.revision + 1}/{node.revisions.length}
            </span>
            <Button size="icon-xs" variant="ghost" aria-label="Show next versions" disabled={node.revision >= node.revisions.length - 1} onClick={() => commit(updateNode(doc, node.id, setRevision(node, node.revision + 1)))}>
              <ChevronRight />
            </Button>
          </div>
          <Button size="xs" variant="ghost" className="w-full" disabled={node.revision === 0} onClick={() => commit(updateNode(doc, node.id, setRevision(node, 0)))}>
            <RotateCcw /> Reset layer
          </Button>
        </div>
      )}
      <Field label="Opacity" hint={`${Math.round((node.opacity ?? 1) * 100)}%`}>
        <Slider aria-label="Opacity" min={0} max={100} step={1} value={[Math.round((node.opacity ?? 1) * 100)]} onValueChange={([v]) => commit(updateNode(doc, node.id, { opacity: v / 100 }), `opacity:${node.id}`)} />
      </Field>
      <Geometry node={node} />
    </div>
  );
}

/**
 * A number typed into a draft: committed on Enter, on leaving the field and on arrow-key steps
 * (Shift: 10), so clearing it or typing "-50" passes through no in-between values. Escape reverts.
 */
function NumberField({ label, name, value, min, onCommit }: { label: string; name: string; value: number; min?: number; onCommit: (v: number) => void }) {
  const shown = String(Math.round(value));
  const [draft, setDraft] = useState<string | null>(null);
  const commitDraft = (s: string) => {
    setDraft(null);
    const v = Number(s.trim().replace(",", "."));
    if (!s.trim() || !Number.isFinite(v) || (min !== undefined && v < min) || Math.round(v) === Math.round(value)) return;
    onCommit(v);
  };
  return (
    <label className="flex h-7 min-w-0 items-center rounded-md border bg-transparent pl-2 text-[12px] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
      <span className="w-3 shrink-0 text-[11px] text-muted-foreground" aria-hidden>
        {label}
      </span>
      <input
        type="text"
        inputMode="decimal"
        aria-label={name}
        className="h-full min-w-0 flex-1 bg-transparent px-1 text-right font-mono text-[12px] outline-none"
        value={draft ?? shown}
        onChange={(e) => {
          // Digits, one leading minus and a decimal point: "-" and "" are fine while typing.
          if (/^-?\d*([.,]\d*)?$/.test(e.target.value)) setDraft(e.target.value);
        }}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => commitDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitDraft(e.currentTarget.value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setDraft(null);
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const step = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1);
            const base = Number((draft ?? shown).replace(",", "."));
            const next = Math.round(Number.isFinite(base) ? base : value) + step;
            if (min !== undefined && next < min) return;
            setDraft(null);
            onCommit(next);
          }
        }}
      />
    </label>
  );
}

/** X / Y, W ⛓ H and rotation, two to a row; W and H keep the layer's shape while the link is on. */
function Geometry({ node }: { node: LayerNode }) {
  const { doc, commit } = useEditor();
  const [locked, setLocked] = useState(true);
  const set = (k: "x" | "y" | "w" | "h" | "rotation", v: number) => {
    let patch: Partial<LayerNode> = { [k]: v };
    if (locked && (k === "w" || k === "h") && node.w > 0 && node.h > 0) patch = k === "w" ? { w: v, h: (v * node.h) / node.w } : { h: v, w: (v * node.w) / node.h };
    commit(updateNode(doc, node.id, patch), `${k}:${node.id}`);
  };
  return (
    <div className="space-y-1.5" role="group" aria-label="Position and size">
      <div className="grid grid-cols-2 gap-1.5">
        <NumberField label="X" name="X in pixels" value={node.x} onCommit={(v) => set("x", v)} />
        <NumberField label="Y" name="Y in pixels" value={node.y} onCommit={(v) => set("y", v)} />
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
        <NumberField label="W" name="Width in pixels" value={node.w} min={1} onCommit={(v) => set("w", v)} />
        <Button size="icon-xs" variant="ghost" aria-pressed={locked} aria-label="Keep the layer's shape when changing W or H" title={locked ? "W and H keep the shape" : "W and H change on their own"} onClick={() => setLocked(!locked)}>
          {locked ? <Link2 /> : <Unlink2 />}
        </Button>
        <NumberField label="H" name="Height in pixels" value={node.h} min={1} onCommit={(v) => set("h", v)} />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <NumberField label="°" name="Rotation in degrees" value={node.rotation} onCommit={(v) => set("rotation", v)} />
      </div>
    </div>
  );
}

const NARROW = "(max-width: 1023px)";
const useNarrow = () =>
  useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(NARROW);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );

/**
 * Below 1024 px, while a tool's form is open, the panel folds to a strip of thumbnails (pick the
 * layer the tool works on; the button on top unfolds it), so the canvas keeps its room.
 */
function LayerStrip({ rows, onExpand }: { rows: LayerNode[]; onExpand: () => void }) {
  const { selected, select, busyJob, failedJob } = useEditor();
  return (
    <aside className="flex min-h-0 w-[56px] shrink-0 flex-col items-center border-l bg-background" aria-label="Layers panel">
      <div className="flex h-12 shrink-0 items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={`Show the Layers panel (${rows.length} layers)`} onClick={onExpand}>
              <PanelRightOpen />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">Layers · {rows.length}</TooltipContent>
        </Tooltip>
      </div>
      <ul className="min-h-0 w-full flex-1 space-y-1 overflow-x-hidden overflow-y-auto overscroll-contain px-1.5 pb-2" aria-label="Layers, front to back">
        {rows.map((n) => (
          <li key={n.id} className="relative">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-pressed={selected?.id === n.id}
                  aria-label={`Select layer ${n.name}`}
                  onClick={() => select(n.id)}
                  className={cn("grid w-full place-items-center rounded-lg p-0.5 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", selected?.id === n.id ? "bg-brand-faint ring-2 ring-primary" : "hover:bg-accent", n.hidden && "opacity-50")}
                >
                  <LayerThumb node={n} className="size-9" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">{n.name}</TooltipContent>
            </Tooltip>
            {busyJob(n.id) ? <Loader2 className="pointer-events-none absolute -top-0.5 -right-0.5 size-3.5 animate-spin rounded-full bg-background text-brand-text" aria-hidden /> : failedJob(n.id) ? <TriangleAlert className="pointer-events-none absolute -top-0.5 -right-0.5 size-3.5 rounded-full bg-background text-destructive" aria-hidden /> : null}
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function LayersPanel() {
  const { doc, commit, selected, busyJob, tool } = useEditor();
  const rows = useMemo(() => [...doc.nodes].sort((a, b) => b.z - a.z), [doc.nodes]);
  const list = useRef<HTMLUListElement>(null);
  const [dragging, setDragging] = useState<{ id: string; before: number } | null>(null);
  const narrow = useNarrow();
  /** The tool the panel was unfolded for (a new tool folds it again). */
  const [openFor, setOpenFor] = useState<string | null>(null);
  const strip = narrow && !!tool && openFor !== tool;

  // Drag a row by its handle: drop it between two rows (top of the list = front).
  const onDragHandle = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = list.current;
    if (!el) return;
    const items = [...el.querySelectorAll<HTMLElement>(":scope > li")];
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    const slot = (y: number) => {
      const i = items.findIndex((li) => {
        const r = li.getBoundingClientRect();
        return y < r.top + r.height / 2;
      });
      return i < 0 ? items.length : i;
    };
    let before = slot(e.clientY);
    setDragging({ id, before });
    const move = (ev: PointerEvent) => {
      before = slot(ev.clientY);
      setDragging({ id, before });
    };
    const up = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      setDragging(null);
      const from = rows.findIndex((r) => r.id === id);
      let to = before > from ? before - 1 : before;
      to = Math.max(0, Math.min(rows.length - 1, to));
      if (to !== from) commit(moveNode(doc, id, rows.length - 1 - to));
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  if (strip) return <LayerStrip rows={rows} onExpand={() => setOpenFor(tool)} />;

  return (
    <aside className="flex min-h-0 w-[232px] shrink-0 flex-col border-l bg-background lg:w-[264px] xl:w-[300px]" aria-label="Layers panel">
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        {narrow && tool && (
          <Button size="icon-xs" variant="ghost" className="-ml-1" aria-label="Fold the Layers panel" onClick={() => setOpenFor(null)}>
            <PanelRightClose />
          </Button>
        )}
        <h2 className="text-[13px] font-semibold">Layers</h2>
        <span className="font-mono text-[12px] text-muted-foreground">{doc.nodes.length}</span>
        <div className="ml-auto">
          <AddLayer />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
        <ul ref={list} className="space-y-0.5 px-2 pb-2" aria-label="Layers, front to back">
          {rows.map((n, i) => {
            const job = busyJob(n.id);
            const busy = job ? `${job.tool === "split" ? `Separating ${n.name}` : job.label} · ${jobStatusText(job.result)}` : undefined;
            return <LayerRow key={n.id} node={n} index={n.z} total={rows.length} selected={n.id === selected?.id} busy={busy} onDragHandle={onDragHandle} dropBefore={!!dragging && dragging.before === i && dragging.id !== n.id} />;
          })}
          {dragging && dragging.before === rows.length && <li className="mx-2 h-0.5 rounded-full bg-primary" aria-hidden />}
        </ul>
        {selected ? (
          <SelectedLayer key={selected.id} node={selected} />
        ) : (
          <p className="border-t px-4 py-4 text-[12px] text-pretty text-muted-foreground">Select a layer in the Layers panel, then move it, resize it, or describe your change in its prompt.</p>
        )}
      </div>
    </aside>
  );
}
