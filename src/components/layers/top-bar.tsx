"use client";

import { ArrowLeft, Braces, Check, CloudOff, Columns2, Download, FileArchive, History, ImageDown, Loader2, Redo2, Undo2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PhoneNavButton } from "@/components/nav/phone-nav-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EngineSwitch } from "@/components/studio/engine-switch";
import type { Engine } from "@/lib/catalog/types";
import { timeAgo } from "@/lib/format";
import { useModKey } from "@/lib/keys";
import { docJson, exportScale, scaledSize, type LayerDoc, type LayerJob, type LayerVersion } from "@/lib/layers";
import { cn } from "@/lib/utils";
import { copyWithToast } from "@/lib/clipboard";
import { downloadPng, downloadZip, type ExportSize } from "./render";

export type SaveState = "saved" | "saving" | "dirty" | "error" | "conflict";

/**
 * The download menu (shared with the phone view): the two zips and the flat PNG, built in the
 * browser. When a layer carries more detail than the document (an upscale), the export can keep it
 * (“Full detail”, the default) or stay at the document's size.
 */
export function DownloadMenu({ doc, name, jobs, compact }: { doc: LayerDoc; name: string; jobs: LayerJob[]; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState<ExportSize>("full");
  const splitting = jobs.some((j) => (j.tool === "decompose" || j.tool === "split") && j.state === "pending");
  const scale = exportScale(doc);
  const [dw, dh] = scaledSize(doc.width, doc.height, 1);
  const [fw, fh] = scaledSize(doc.width, doc.height, scale);
  const larger = fw > dw;
  const go = async (kind: "cropped" | "positioned" | "image") => {
    if (!doc.nodes.length) {
      toast.error("No layers to download");
      return;
    }
    if (splitting && kind !== "image") {
      toast.error("Wait for all layers to finish, then try again.");
      return;
    }
    setBusy(true);
    const t = toast.loading(kind === "image" ? "Rendering the image…" : "Packing the layers…");
    const at = larger ? size : "document";
    try {
      if (kind === "image") await downloadPng(doc, name, at);
      else await downloadZip(doc, kind, at);
      toast.success("Downloaded", { id: t, duration: 1500 });
    } catch (e) {
      toast.error((e as Error).message || "Couldn't download this version. Please try again.", { id: t });
    } finally {
      setBusy(false);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={compact ? "icon" : "sm"} variant="secondary" className="rounded-full" disabled={busy} aria-label="Download">
          {busy ? <Loader2 className="animate-spin" /> : <Download />}
          {!compact && <span className="hidden xl:inline">Download</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onSelect={() => void go("cropped")}>
          <FileArchive /> Cropped layers .zip
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void go("positioned")}>
          <FileArchive /> Positioned Layers .zip
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void go("image")}>
          <ImageDown /> Image .png
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            {larger && size === "full" ? fw : dw} × {larger && size === "full" ? fh : dh}
          </span>
        </DropdownMenuItem>
        {larger && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Size</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={size} onValueChange={(v) => setSize(v as ExportSize)}>
              <DropdownMenuRadioItem value="full" onSelect={(e) => e.preventDefault()}>
                Full detail
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                  {fw} × {fh}
                </span>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="document" onSelect={(e) => e.preventDefault()}>
                Canvas size
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                  {dw} × {dh}
                </span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The autosave state: an icon at every width, its words from 1280 px (and in its tooltip). A failed save can be retried now. */
function SaveBadge({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const text = { saved: "Saved", saving: "Saving…", dirty: "Saving…", error: "Not saved — retrying", conflict: "Changed in another tab" }[state];
  const short = { error: "Not saved", conflict: "Changed elsewhere" }[state as "error" | "conflict"] ?? text;
  const bad = state === "error" || state === "conflict";
  const body = (
    <>
      {state === "saved" ? <Check className="motion-confirm size-3.5 shrink-0" /> : bad ? <CloudOff className="size-3.5 shrink-0" /> : <Loader2 className="size-3.5 shrink-0 animate-spin" />}
      <span className="sr-only">{text}</span>
      <span className="hidden xl:inline" aria-hidden>
        {short}
      </span>
    </>
  );
  const cls = cn("inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1 text-[12px] whitespace-nowrap", bad ? "text-warning" : "text-muted-foreground");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {state === "error" ? (
          <button type="button" className={cn(cls, "hover:bg-accent")} onClick={onRetry} aria-label="Not saved. Retry now">
            {body}
          </button>
        ) : (
          <span className={cls} role="status" aria-live="polite">
            {body}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>{state === "error" ? "Not saved yet — Fuobe keeps retrying. Click to retry now." : text}</TooltipContent>
    </Tooltip>
  );
}

export function TopBar(p: {
  name: string;
  onRename: (name: string) => void;
  save: SaveState;
  onRetrySave: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  versions: LayerVersion[];
  headVersionId: string;
  onRestore: (versionId: string) => Promise<void>;
  compare: boolean;
  onCompare: (on: boolean) => void;
  doc: LayerDoc;
  jobs: LayerJob[];
  engine: Engine;
  setEngine: (e: Engine) => void;
}) {
  const [draft, setDraft] = useState(p.name);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const copyJson = () => void copyWithToast(docJson(p.doc, window.location.origin), "JSON copied");
  const mod = useModKey();

  return (
    <header className="flex h-14 shrink-0 items-center gap-1.5 border-b bg-background px-2 sm:px-3">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button asChild variant="ghost" size="icon-sm" aria-label="All projects">
            <Link href="/layers">
              <ArrowLeft />
            </Link>
          </Button>
        </TooltipTrigger>
        <TooltipContent>All projects</TooltipContent>
      </Tooltip>
      <input
        value={draft}
        maxLength={80}
        aria-label="Project name"
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={() => {
          const n = draft.trim();
          if (!n) setDraft(p.name);
          else if (n !== p.name) p.onRename(n);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(p.name);
            e.currentTarget.blur();
          }
        }}
        className="h-8 w-[clamp(6rem,14vw,15rem)] min-w-0 truncate rounded-md border border-transparent bg-transparent px-2 font-heading text-[19px] outline-none hover:border-border focus:border-primary focus:ring-4 focus:ring-brand-faint"
      />
      <SaveBadge state={p.save} onRetry={p.onRetrySave} />

      {/* The actions keep their size; the project name gives way when room is short. */}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={!p.canUndo} onClick={p.onUndo}>
              <Undo2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Undo <Kbd>{mod}</Kbd>
            <Kbd>Z</Kbd>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={!p.canRedo} onClick={p.onRedo}>
              <Redo2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Redo <Kbd>{mod}</Kbd>
            <Kbd>⇧</Kbd>
            <Kbd>Z</Kbd>
          </TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setHistoryOpen(true)} aria-label="Edit history">
          <History /> <span className="hidden xl:inline">Edit history</span>
        </Button>
        <Button variant={p.compare ? "default" : "ghost"} size="sm" className="rounded-full" aria-label="Compare" aria-pressed={p.compare} onClick={() => p.onCompare(!p.compare)}>
          <Columns2 /> <span className="hidden xl:inline">Compare</span>
        </Button>
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" />
        <DownloadMenu doc={p.doc} name={p.name} jobs={p.jobs} />
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="ghost" size="sm" className="rounded-full" aria-label="Copy JSON" disabled={!p.doc.nodes.length} onClick={() => void copyJson()}>
                <Braces /> <span className="hidden xl:inline">Copy JSON</span>
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{p.doc.nodes.length ? "Copy the layers as a design file (JSON)" : "Add a layer to copy as JSON."}</TooltipContent>
        </Tooltip>
        {/* Icons only below 1024 px (names stay in the tooltips and aria labels), so a tablet keeps both engines in reach. */}
        <div className="flex shrink-0 max-lg:[&_a>span]:hidden max-lg:[&_button>span]:hidden">
          <EngineSwitch value={p.engine} onChange={p.setEngine} />
        </div>
      </div>

      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent
          className="w-[min(92vw,380px)]"
          // Focus the sheet itself, not its first Restore button (Enter mustn't restore a version by accident).
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement | null)?.focus();
          }}
        >
          <SheetHeader>
            <SheetTitle>Edit history</SheetTitle>
            <SheetDescription>Every tool result is saved as a version. Restoring one adds it on top — nothing is lost.</SheetDescription>
          </SheetHeader>
          <ol className="space-y-1 overflow-y-auto px-4 pb-6">
            {p.versions.map((v, i) => {
              const current = v.id === p.headVersionId;
              return (
                <li key={v.id} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5", current ? "bg-brand-faint" : "hover:bg-accent")}>
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted font-mono text-[11px] text-muted-foreground">{p.versions.length - i}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{v.label}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {current ? "Open now · " : ""}
                      {timeAgo(v.updatedAt)}
                    </span>
                  </span>
                  {!current && (
                    <Button
                      size="xs"
                      variant="secondary"
                      className="rounded-full"
                      disabled={!!restoring}
                      onClick={async () => {
                        setRestoring(v.id);
                        try {
                          await p.onRestore(v.id);
                          setHistoryOpen(false);
                        } finally {
                          setRestoring(null);
                        }
                      }}
                    >
                      {restoring === v.id ? <Loader2 className="animate-spin" /> : null} Restore
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        </SheetContent>
      </Sheet>
      <PhoneNavButton />
    </header>
  );
}
