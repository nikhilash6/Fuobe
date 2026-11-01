"use client";

import { GraduationCap, Images, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { PageHeader, PageShell } from "@/components/page-shell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { EngineSwitch } from "@/components/studio/engine-switch";
import { useEngine } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { BoardCover, CuratedCover, StatusBadge } from "./cards";
import { CreateMoodboardDialog } from "./create-moodboard";
import { TrainBoardDialog } from "./train-board";
import { useCuratedSet, useMoodboardActions, useMoodboards } from "./hooks";
import { COPY, CURATED_TABS, inCuratedTab, MOODBOARD_LIMITS, type Moodboard } from "./logic";

/**
 * ?create=1 opens the Create dialog once (links from the Image studio and Home); the parameter is
 * dropped from the address, so closing the dialog keeps it closed and a reload doesn't reopen it.
 */
function CreateFromUrl({ onOpen }: { onOpen: () => void }) {
  const sp = useSearchParams();
  const router = useRouter();
  const create = sp.get("create");
  const open = useRef(onOpen);
  useEffect(() => {
    open.current = onOpen;
  });
  useEffect(() => {
    if (!create) return;
    open.current();
    router.replace("/moodboards", { scroll: false });
  }, [create, router]);
  return null;
}

function BoardCard({ m, onRename, onDelete }: { m: Moodboard; onRename: () => void; onDelete: () => void }) {
  const { retry } = useMoodboardActions();
  const [training, setTraining] = useState(false);
  // Settings can lock one engine: then there's no other engine to rebuild for.
  const [, , mode] = useEngine();
  const ready = m.status === "complete";
  return (
    <div className="group/board min-w-0">
      <div className="relative">
        <Link
          href={ready ? `/image?moodboard=${m.id}` : "#"}
          aria-disabled={!ready}
          onClick={(e) => {
            if (!ready) {
              e.preventDefault();
              toast(m.status === "failed" ? (m.error ?? "This moodboard failed") : COPY.notReady);
            }
          }}
          className="block overflow-hidden rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          aria-label={`Use ${m.name} in the Image studio`}
        >
          <BoardCover m={m} className="aspect-square transition-transform duration-300 group-hover/board:scale-[1.02]" />
        </Link>
        <StatusBadge status={m.status} className="absolute top-2 left-2" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Options for ${m.name}`}
              className="absolute top-2 right-2 grid size-7 place-items-center rounded-full bg-background/90 shadow-soft outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild disabled={!ready}>
              <Link href={`/image?moodboard=${m.id}`}>
                <Wand2 /> Use preset
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTimeout(onRename)}>
              <Pencil /> Rename
            </DropdownMenuItem>
            {(m.status === "failed" || (m.status === "complete" && mode === "both")) && (
              <DropdownMenuItem
                onSelect={() =>
                  retry.mutate(
                    { id: m.id, engine: m.status === "complete" ? (m.engine === "cloud" ? "open" : "cloud") : undefined },
                    { onSuccess: () => toast("Rebuilding the moodboard"), onError: (e) => toastError(e) },
                  )
                }
              >
                <RotateCcw /> {m.status === "failed" ? "Retry" : `Rebuild for ${m.engine === "cloud" ? "open source" : "cloud"}`}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem disabled={!ready || m.lora?.status === "training"} onSelect={() => setTimeout(() => setTraining(true))}>
              <GraduationCap /> {m.lora?.status === "ready" ? "Retrain as a look…" : "Train as a look…"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setTimeout(onDelete)}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <TrainBoardDialog board={m} open={training} onOpenChange={setTraining} />
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2 px-0.5">
        <p className="min-w-0 truncate text-[13.5px] font-medium">{m.name}</p>
        <p className="shrink-0 text-[12px] text-muted-foreground tabular-nums">{m.images.length} images</p>
      </div>
      <p className="truncate px-0.5 text-[12px] text-muted-foreground">
        {m.status === "failed"
          ? (m.error ?? "Failed")
          : m.lora?.status === "ready"
            ? `Style LoRA ready · @${m.lora.handle}`
            : m.lora?.status === "training"
              ? "Training style LoRA…"
              : m.styleId
                ? "Recraft style saved"
                : m.engine === "open"
                  ? "Open source · collages"
                  : "Cloud · style references"}
      </p>
    </div>
  );
}

/** /moodboards: Curated looks and your own boards; create, use, rename, retry, train, delete. */
export function MoodboardsView() {
  const { data, isLoading } = useMoodboards();
  const { rename, remove } = useMoodboardActions();
  const [engine, setEngine] = useEngine();
  const [tab, setTab] = useState<"mine" | "curated">("mine");
  const [cat, setCat] = useState("All presets");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Moodboard | null>(null);
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<Moodboard | null>(null);
  const needle = q.trim().toLowerCase();
  const mine = useMemo(() => (data?.items ?? []).filter((m) => !needle || m.name.toLowerCase().includes(needle)), [data, needle]);
  const looks = useCuratedSet("soul-v2");
  // Curated looks are Fuobe Soul's: they open on Fuobe Soul, which applies the whole look on either engine.
  const curated = useMemo(
    () => looks.filter((c) => (needle ? `${c.name} ${c.description}`.toLowerCase().includes(needle) : inCuratedTab(c, cat))),
    [looks, needle, cat],
  );

  return (
    <PageShell>
      <Suspense fallback={null}>
        <CreateFromUrl onOpen={() => setCreating(true)} />
      </Suspense>
      <PageHeader title="Moodboards" description="Define your style: turn 5–80 reference images into a look you can reuse in the Image studio — or start from a curated one.">
        <div className="flex items-center gap-2">
          <EngineSwitch value={engine} onChange={setEngine} />
          <Button onClick={() => setCreating(true)}>
            <Plus /> Create moodboard
          </Button>
        </div>
      </PageHeader>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Moodboards" className="inline-flex rounded-full bg-muted p-0.5">
          {(
            [
              ["mine", `My moodboards${data ? ` · ${data.items.length}` : ""}`],
              ["curated", "Curated"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn("h-8 rounded-full px-3.5 text-[13px] font-medium text-muted-foreground transition", tab === id && "bg-background text-foreground shadow-soft")}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex h-9 w-full min-w-0 items-center gap-2 rounded-full border bg-background px-3 focus-within:border-primary sm:w-auto sm:max-w-xs sm:flex-1">
          <Search className="size-4 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search moodboards..." aria-label="Search moodboards" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
        </label>
      </div>

      {tab === "mine" ? (
        isLoading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="aspect-square rounded-xl" />
            ))}
          </div>
        ) : mine.length ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {mine.map((m) => (
              <BoardCard
                key={m.id}
                m={m}
                onRename={() => {
                  setRenaming(m);
                  setNewName(m.name);
                }}
                onDelete={() => setDeleting(m)}
              />
            ))}
          </div>
        ) : needle ? (
          <p className="py-16 text-center text-[14px] text-muted-foreground">No moodboards match “{q}”</p>
        ) : (
          <div className="mx-auto flex max-w-xl flex-col items-center rounded-2xl border border-dashed px-6 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-brand-faint text-brand-text">
              <Images className="size-6" />
            </span>
            <h2 className="mt-4 font-heading text-[24px]">Create your moodboard</h2>
            <p className="mt-1 text-[14px] text-muted-foreground">{COPY.subtitle}</p>
            <p className="mt-3 text-[12.5px] text-muted-foreground">
              Recommended: {COPY.recommended} {MOODBOARD_LIMITS.min}–{MOODBOARD_LIMITS.max} images.
            </p>
            <Button className="mt-5" onClick={() => setCreating(true)}>
              <Plus /> Create moodboard
            </Button>
          </div>
        )
      ) : (
        <>
          {!needle && (
            <div className="scrollbar-none mb-4 flex gap-1.5 overflow-x-auto">
              {CURATED_TABS["soul-v2"].map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={cat === c}
                  onClick={() => setCat(c)}
                  className={cn("h-8 shrink-0 rounded-full px-3 text-[13px] font-medium transition-colors", cat === c ? "bg-brand-faint text-brand-text" : "bg-secondary text-secondary-foreground hover:bg-accent")}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {curated.map((c) => (
              <Link
                key={c.id}
                href={`/image?model=fuobe-soul&moodboard=curated:${c.id}`}
                aria-label={`Use ${c.name} in the Image studio${c.description ? ` — ${c.description}` : ""}`}
                className="group/cur min-w-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <CuratedCover m={c} className="aspect-[3/4] rounded-xl transition-transform duration-300 group-hover/cur:scale-[1.02]" />
                <p className="mt-1.5 px-0.5 text-[12px] text-muted-foreground">{c.category}</p>
                <p className="line-clamp-2 px-0.5 text-[12.5px]">{c.description}</p>
              </Link>
            ))}
          </div>
          {!curated.length && <p className="py-16 text-center text-[14px] text-muted-foreground">No presets match “{q}”</p>}
          <p className="mt-6 text-[12.5px] text-muted-foreground">
            Curated looks are Fuobe Soul looks: Fuobe Soul applies each one whole (its LoRAs and words), free on your GPU or in the cloud. Other models get the look in words.
          </p>
        </>
      )}

      <CreateMoodboardDialog open={creating} onOpenChange={setCreating} onCreated={() => setTab("mine")} />

      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename moodboard</DialogTitle>
          </DialogHeader>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} aria-label={COPY.nameLabel} autoFocus onFocus={(e) => e.currentTarget.select()} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              disabled={rename.isPending}
              onClick={() =>
                renaming &&
                rename.mutate(
                  { id: renaming.id, name: newName },
                  { onSuccess: () => (setRenaming(null), toast("Renamed")), onError: (e) => toastError(e) },
                )
              }
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{COPY.deleteTitle(deleting?.name ?? "")}</AlertDialogTitle>
            <AlertDialogDescription>{COPY.deleteBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{COPY.deleteNo}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleting && remove.mutate(deleting.id, { onSuccess: () => toast("Moodboard deleted"), onError: (e) => toastError(e) })}
            >
              {COPY.deleteYes}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
