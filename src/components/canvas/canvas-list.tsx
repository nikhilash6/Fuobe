"use client";

import { Cloud, Copy, Cpu, Loader2, MoreHorizontal, Pencil, Plus, Search, Trash2, Workflow } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EngineSwitch } from "@/components/studio/engine-switch";
import { PageShell } from "@/components/page-shell";
import { SelfHostNote } from "@/components/self-host-note";
import { CoverArt, CoverImg, useCoverPlayback } from "@/components/template-cover";
import { useEngine, useIsVisitor, useModelAccess } from "@/lib/api";
// Types only: the catalog (models, templates) stays on the server; the page passes slim template cards.
import type { CanvasNodeType, CanvasSummary, Outline } from "@/lib/catalog/canvas";
import type { Engine } from "@/lib/catalog/types";
import { offered, type AccessSummary } from "@/lib/model-access";
import { timeAgo } from "@/lib/format";
import { templateCover } from "@/lib/template-covers";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { NodeIcon } from "./canvas-context";
import { useCanvasActions, useCanvases } from "./use-canvas";

const BOX = { w: 280, h: 150 };

const BOX_COLOR: Partial<Record<CanvasNodeType, string>> = {
  prompt: "var(--chart-2)",
  table: "var(--chart-2)",
  "image-input": "var(--chart-5)",
  "video-input": "var(--chart-4)",
  "audio-input": "var(--chart-3)",
  element: "var(--chart-1)",
  output: "var(--muted-foreground)",
};

/** The board in miniature, for cards without a result to show. */
function Schematic({ outline: o, className }: { outline: Outline; className?: string }) {
  if (!o.boxes.length) {
    return (
      <div className={cn("grid size-full place-items-center text-subtle-foreground", className)}>
        <Workflow className="size-8" />
      </div>
    );
  }
  const xs = o.boxes.map((b) => b.x);
  const ys = o.boxes.map((b) => b.y);
  const pad = 80;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const w = Math.max(...xs) + BOX.w + pad - minX;
  const h = Math.max(...ys) + BOX.h + pad - minY;
  return (
    <svg viewBox={`${minX} ${minY} ${w} ${h}`} preserveAspectRatio="xMidYMid meet" className={cn("size-full", className)} aria-hidden>
      {o.links.map(([a, b], i) => {
        const s = o.boxes[a];
        const t = o.boxes[b];
        const x1 = s.x + BOX.w;
        const y1 = s.y + BOX.h / 2;
        const x2 = t.x;
        const y2 = t.y + BOX.h / 2;
        const mx = (x1 + x2) / 2;
        return <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke="var(--border-strong)" strokeWidth={8} />;
      })}
      {o.boxes.map((b, i) => (
        <g key={i}>
          <rect x={b.x} y={b.y} width={BOX.w} height={BOX.h} rx={22} fill="var(--card)" stroke="var(--border-strong)" strokeWidth={4} />
          <rect x={b.x + 24} y={b.y + 28} width={44} height={44} rx={10} fill={BOX_COLOR[b.type] ?? "var(--primary)"} opacity={0.85} />
          <rect x={b.x + 84} y={b.y + 36} width={150} height={14} rx={7} fill="var(--muted-foreground)" opacity={0.35} />
          <rect x={b.x + 24} y={b.y + 94} width={220} height={12} rx={6} fill="var(--muted-foreground)" opacity={0.18} />
        </g>
      ))}
    </svg>
  );
}

function CanvasCard({ c, onRename, onDelete }: { c: CanvasSummary; onRename: () => void; onDelete: () => void }) {
  const router = useRouter();
  const { duplicate } = useCanvasActions();
  return (
    <article className="group/card relative min-w-0">
      <Link href={`/canvas/${c.id}`} className="block rounded-xl outline-none focus-visible:ring-4 focus-visible:ring-brand-faint">
        <div className="aspect-[16/10] overflow-hidden rounded-xl border bg-muted/50 transition-shadow group-hover/card:shadow-normal">
          {c.preview ? (
            c.preview.kind === "video" ? (
              <video src={`${c.preview.url}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.preview.url} alt="" loading="lazy" className="size-full object-cover" />
            )
          ) : (
            <Schematic outline={c.outline} className="p-3" />
          )}
        </div>
        <h3 className="mt-2 truncate pr-9 text-[14px] font-medium">{c.name}</h3>
        <p className="text-[12px] text-muted-foreground">
          {c.editedAt ? `Edited ${timeAgo(c.editedAt)}` : "Never edited"} · {c.nodeCount} node{c.nodeCount === 1 ? "" : "s"}
          {c.pageCount > 1 && ` · ${c.pageCount} pages`}
        </p>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="absolute right-0 bottom-5 grid size-8 place-items-center rounded-md text-muted-foreground opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100 sm:opacity-0 sm:group-hover/card:opacity-100 data-[state=open]:opacity-100"
            aria-label={`Actions for ${c.name}`}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={onRename}>
            <Pencil /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              void duplicate(c.id).then(
                (copy) => toast.success("Duplicated", { action: { label: "Open", onClick: () => router.push(`/canvas/${copy.id}`) } }),
                (e) => toastError(e),
              )
            }
          >
            <Copy /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </article>
  );
}

/** A template as the list shows it, built on the server (app/(studio)/canvas/page.tsx): its board outline and model names per engine. */
export interface TemplateCardData {
  id: string;
  name: string;
  description: string;
  icon: string;
  hue: number;
  /** The picker's section (Effects 2.0 chains); none: the workflows. */
  group?: string;
  /** ifOff: a model's name and the one its node falls back to when the model is off on this install. */
  byEngine: Record<Engine, { outline: Outline; models: string[]; ifOff?: { id: string; name: string; instead: string }[] }>;
}

/** The model names a card shows as this install offers them: a model that is off shows the one its node falls back to. */
function offeredNames({ models, ifOff }: TemplateCardData["byEngine"][Engine], access: AccessSummary | undefined, engine: Engine): string[] {
  if (!ifOff || !access) return models;
  return [...new Set(models.map((m) => ifOff.find((x) => x.name === m && !offered(access, x.id, engine))?.instead ?? m))];
}

/** What each template section is, under its heading (a guest or an account runs a canvas on a self-hosted Fuobe only). */
const GROUP_NOTES: Record<string, (visitor: boolean) => string> = {
  "Effects 2.0 chains": (visitor) =>
    `A photo, an image edit that sets the scene, then Fuobe DoP animates it with the effect${visitor ? "." : ", free on your GPU."}`,
};

/** onUse: none for a guest or an account (a canvas is saved to the owner's library: the page says so once). */
export function TemplateCard({ t, engine, onUse, busy, access }: { t: TemplateCardData; engine: Engine; onUse?: () => void; busy: boolean; access?: AccessSummary }) {
  const { outline } = t.byEngine[engine];
  const models = offeredNames(t.byEngine[engine], access, engine);
  // Its real cover when it has one (what it makes: a still, a clip, or its frames side by side), with the board in
  // miniature over a corner; else the board alone.
  const cover = templateCover("canvas", t.id);
  const { ref, playing, asked, handlers } = useCoverPlayback<HTMLElement>(`canvas/${t.id}`, cover);
  return (
    <article ref={ref} {...handlers} className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card">
      {cover ? (
        <div className="relative aspect-[16/9] overflow-hidden bg-muted">
          {cover.frames.length > 1 ? (
            <div className="absolute inset-0 grid auto-cols-fr grid-flow-col gap-0.5">
              {cover.frames.map((f) => (
                <CoverImg key={f.src} frame={f} sizes="(max-width: 640px) 34vw, 125px" />
              ))}
            </div>
          ) : (
            <CoverArt cover={cover} sizes="(max-width: 640px) 100vw, 370px" playing={playing} asked={asked} />
          )}
          <span className="pointer-events-none absolute right-2.5 bottom-2.5 h-[36%] w-[32%] overflow-hidden rounded-lg bg-background/80 shadow-soft backdrop-blur">
            <Schematic outline={outline} className="p-1.5" />
          </span>
          <span className="absolute top-3 left-3 grid size-8 place-items-center rounded-lg bg-background/90 text-foreground shadow-soft">
            <NodeIcon name={t.icon} className="size-4" />
          </span>
        </div>
      ) : (
        <div className="relative aspect-[16/9] bg-muted/50" style={{ background: `linear-gradient(135deg, oklch(0.62 0.12 ${t.hue} / 0.14), transparent 70%)` }}>
          <Schematic outline={outline} className="p-4" />
          <span className="absolute top-3 left-3 grid size-8 place-items-center rounded-lg bg-background/90 text-foreground shadow-soft">
            <NodeIcon name={t.icon} className="size-4" />
          </span>
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <div>
          <h3 className="text-[14px] font-medium">{t.name}</h3>
          <p className="text-[13px] text-muted-foreground">{t.description}</p>
        </div>
        <p className="flex items-start gap-1.5 text-[12px] text-muted-foreground">
          {engine === "open" ? <Cpu className="mt-px size-3.5 shrink-0" /> : <Cloud className="mt-px size-3.5 shrink-0" />}
          <span className="line-clamp-2">{models.join(" · ")}</span>
        </p>
        {onUse && (
          <Button size="sm" className="mt-auto w-fit rounded-full" onClick={onUse} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />} Use template
          </Button>
        )}
      </div>
    </article>
  );
}

function ListInner({ templates }: { templates: TemplateCardData[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get("tab") === "templates" ? "templates" : "mine";
  const canvases = useCanvases();
  const { create, rename, remove } = useCanvasActions();
  const [engine, setEngine] = useEngine();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<CanvasSummary | null>(null);
  const [draft, setDraft] = useState("");
  const [deleting, setDeleting] = useState<CanvasSummary | null>(null);
  // A canvas is saved to the studio's library, which is its owner's: a guest or an account can look, not start one.
  const visitor = useIsVisitor();
  const access = useModelAccess();

  const items = (canvases.data ?? []).filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));
  const setTab = (t: "mine" | "templates") => router.replace(t === "templates" ? "/canvas?tab=templates" : "/canvas", { scroll: false });

  const start = async (key: string, body: Parameters<typeof create>[0]) => {
    setCreating(key);
    try {
      const c = await create(body);
      router.push(`/canvas/${c.id}`);
    } catch (e) {
      toastError(e);
      setCreating(null);
    }
  };

  return (
    <PageShell wide>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-[34px] leading-tight">Canvas</h1>
          <p className="mt-1 max-w-xl text-[15px] text-muted-foreground">Make images, videos and ideas in one place: wire prompts, files and models together, then run them in order or side by side.</p>
        </div>
        {visitor ? (
          <SelfHostNote className="max-w-xs sm:text-right">Canvas editing isn&apos;t available here.</SelfHostNote>
        ) : (
          <Button className="w-fit rounded-full" onClick={() => void start("new", {})} disabled={!!creating}>
            {creating === "new" ? <Loader2 className="animate-spin" /> : <Plus />} New canvas
          </Button>
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <div className="inline-grid h-9 grid-cols-2 rounded-full bg-muted p-0.5 text-[13px] font-medium" role="tablist" aria-label="Canvases or templates">
          {(
            [
              ["mine", "Your canvases"],
              ["templates", "Templates"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("rounded-full px-3.5 transition-colors", tab === k ? "bg-background text-foreground shadow-soft" : "text-muted-foreground hover:text-foreground")}>
              {label}
            </button>
          ))}
        </div>
        {tab === "mine" ? (
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search canvases" aria-label="Search canvases" className="h-9 rounded-full pl-9" />
          </div>
        ) : (
          <div className="ml-auto flex items-center gap-2 text-[13px] text-muted-foreground">
            <span className="hidden sm:inline">Variant</span>
            <EngineSwitch value={engine} onChange={setEngine} size="sm" />
          </div>
        )}
      </div>

      {tab === "mine" ? (
        canvases.isLoading ? (
          <div className="mt-6 grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i}>
                <Skeleton className="aspect-[16/10] rounded-xl" />
                <Skeleton className="mt-2 h-4 w-2/3" />
              </div>
            ))}
          </div>
        ) : items.length ? (
          <div className="mt-6 grid grid-cols-1 gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((c) => (
              <CanvasCard
                key={c.id}
                c={c}
                onRename={() => {
                  setDraft(c.name);
                  setRenaming(c);
                }}
                onDelete={() => setDeleting(c)}
              />
            ))}
          </div>
        ) : q ? (
          <p className="py-16 text-center text-[15px] text-muted-foreground">No canvas called “{q}”.</p>
        ) : (
          <Empty className="mt-6 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Workflow />
              </EmptyMedia>
              <EmptyTitle className="text-[22px]">No canvases yet</EmptyTitle>
              <EmptyDescription>Build a workflow once — prompt → image → video, three models side by side — and run it again whenever you like.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent className="flex-row justify-center">
              {!visitor && (
                <Button className="rounded-full" onClick={() => void start("new", {})} disabled={!!creating}>
                  <Plus /> New canvas
                </Button>
              )}
              <Button variant="secondary" className="rounded-full" onClick={() => setTab("templates")}>
                Browse templates
              </Button>
            </EmptyContent>
          </Empty>
        )
      ) : (
        <div className="mt-6 space-y-10">
          {[...new Set(templates.map((t) => t.group ?? ""))].map((group) => (
            <section key={group || "workflows"} aria-labelledby={group ? `tpl-${group.replace(/\W+/g, "-")}` : undefined}>
              {group && (
                <div className="mb-3">
                  <h2 id={`tpl-${group.replace(/\W+/g, "-")}`} className="font-heading text-[22px] leading-tight">
                    {group}
                  </h2>
                  {GROUP_NOTES[group] && <p className="mt-0.5 text-[13px] text-muted-foreground">{GROUP_NOTES[group](visitor)}</p>}
                </div>
              )}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {templates
                  .filter((t) => (t.group ?? "") === group)
                  // Templates with a real cover lead their section; the rest keep their order after them.
                  .sort((a, b) => Number(!templateCover("canvas", a.id)) - Number(!templateCover("canvas", b.id)))
                  .map((t) => (
                    <TemplateCard key={t.id} t={t} engine={engine} access={access} busy={creating === t.id} onUse={visitor ? undefined : () => void start(t.id, { templateId: t.id, engine })} />
                  ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename canvas</DialogTitle>
            <DialogDescription className="sr-only">Give this canvas a new name</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const c = renaming!;
              const name = draft.trim();
              setRenaming(null);
              if (name && name !== c.name) void rename(c.id, name).then(() => toast.success("Renamed", { duration: 1500 }), (err) => toastError(err));
            }}
          >
            <Input autoFocus value={draft} maxLength={80} onChange={(e) => setDraft(e.target.value)} aria-label="Name" />
            <DialogFooter className="mt-4">
              <Button type="button" variant="ghost" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!draft.trim()}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>The board is removed for good. Everything it made stays in your library.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const c = deleting!;
                setDeleting(null);
                void remove(c.id).then(() => toast("Deleted", { duration: 1500 }), (e) => toastError(e));
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

export function CanvasList({ templates }: { templates: TemplateCardData[] }) {
  return (
    <Suspense fallback={null}>
      <ListInner templates={templates} />
    </Suspense>
  );
}
