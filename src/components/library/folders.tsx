"use client";

import { Check, ChevronLeft, ChevronRight, Download, Folder as FolderIcon, FolderInput, FolderOpen, FolderPlus, MoreHorizontal, Pencil, Pin, PinOff, Share2, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useShare } from "@/components/share/share-provider";
import { downloadUrl, useCanHover } from "@/components/studio/result-actions";
import { MediaThumb } from "@/components/studio/result-media";
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
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFolderActions, useIsVisitor } from "@/lib/api";
import { childFolders, DEFAULT_FOLDER_COLOR, FOLDER_COLORS, folderMoveError, folderPath, folderSwatch, folderTree, MAX_FOLDER_DEPTH, type Folder } from "@/lib/library";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";

/** Generation ids dragged from a card (the selection when the card is selected). */
export const DRAG_TYPE = "application/x-fuobe-generations";
/** A folder dragged onto another folder or a breadcrumb, to move it there. */
export const FOLDER_DRAG_TYPE = "application/x-fuobe-folder";

/** The folder being dragged: targets check the move while hovering (a drag's data can only be read on drop). */
let draggingFolder: string | null = null;

export function readDrag(e: React.DragEvent): string[] | null {
  if (!e.dataTransfer.types.includes(DRAG_TYPE)) return null;
  try {
    return JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as string[];
  } catch {
    return null;
  }
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * A drop target for dragged cards and folders (folder cards, breadcrumbs). `over` is null while
 * nothing hovers, "" when the drop would work, or why it can't ("Cannot move into a subfolder").
 */
export function useDropTarget(on: { items?: (ids: string[]) => void; folder?: (id: string) => void; folderError?: (id: string) => string | null }) {
  const [over, setOver] = useState<string | null>(null);
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => {
        const types = e.dataTransfer.types;
        if (on.items && types.includes(DRAG_TYPE)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setOver("");
        } else if (on.folder && types.includes(FOLDER_DRAG_TYPE) && draggingFolder) {
          const error = on.folderError?.(draggingFolder) ?? null;
          // Only a valid move lets the drop through; the target says why otherwise.
          if (!error) e.preventDefault();
          e.dataTransfer.dropEffect = error ? "none" : "move";
          setOver(error ?? "");
        }
      },
      onDragLeave: (e: React.DragEvent) => {
        // Moving onto one of the target's own children isn't leaving it.
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        setOver(null);
      },
      onDrop: (e: React.DragEvent) => {
        setOver(null);
        const ids = on.items ? readDrag(e) : null;
        if (ids?.length) {
          e.preventDefault();
          on.items!(ids);
          return;
        }
        const id = on.folder ? e.dataTransfer.getData(FOLDER_DRAG_TYPE) : "";
        if (id && !on.folderError?.(id)) {
          e.preventDefault();
          on.folder!(id);
        }
      },
    },
  };
}

/** Makes a folder draggable onto other folders and breadcrumbs (devices with a pointer). */
function useFolderDrag(folder: Folder) {
  const canHover = useCanHover();
  return {
    draggable: canHover,
    onDragStart: (e: React.DragEvent) => {
      draggingFolder = folder.id;
      e.dataTransfer.setData(FOLDER_DRAG_TYPE, folder.id);
      e.dataTransfer.setData("text/plain", folder.name);
      e.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: () => {
      draggingFolder = null;
    },
  };
}

/** Move a folder (drag and drop, the Move to menu) and say where it went, or why it didn't. */
export function useMoveFolder(all: Folder[]) {
  const actions = useFolderActions();
  return (id: string, target: Folder | null) => {
    const f = all.find((x) => x.id === id);
    if (!f) return;
    const error = folderMoveError(all, id, target?.id ?? null);
    if (error) return void toast(error);
    actions.update(id, { parentId: target?.id ?? null }).then(
      () => toast.success(target ? `Moved “${f.name}” into “${target.name}”` : `Moved “${f.name}” to the top of your Library`),
      (e: Error) => toastError(e),
    );
  };
}

/** A folder can take a subfolder while it's above the depth limit. */
const roomInside = (all: Folder[], f: Folder | null | undefined) => !f || folderPath(all, f.id).length < MAX_FOLDER_DEPTH;

export function FolderDialog({
  folder,
  parent,
  open,
  onOpenChange,
  onSaved,
}: {
  folder?: Folder;
  /** A new folder goes inside this one (the library root without it). */
  parent?: Folder | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: (f: Folder) => void;
}) {
  const actions = useFolderActions();
  const [name, setName] = useState(folder?.name ?? "");
  const [color, setColor] = useState(folder?.color ?? parent?.color ?? DEFAULT_FOLDER_COLOR);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const save = async () => {
    setBusy(true);
    try {
      const f = folder ? await actions.update(folder.id, { name, color }) : await actions.create({ name, color, parentId: parent?.id ?? null });
      onOpenChange(false);
      onSaved?.(f);
      if (!folder) toast.success(parent ? `Created “${f.name}” in “${parent.name}”` : `Created “${f.name}”`);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(92vw,400px)] gap-4"
        // Straight into the name field, also when opened from a menu that was still handing focus back.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          input.current?.focus();
          input.current?.select();
        }}
      >
        <DialogTitle className="font-heading text-[22px] font-normal break-words">{folder ? "Edit folder" : parent ? `New folder in “${parent.name}”` : "New folder"}</DialogTitle>
        <DialogDescription className="sr-only">Name and colour</DialogDescription>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void save();
          }}
        >
          <input
            ref={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="e.g. “Spring campaign”"
            aria-label="Folder name"
            className="h-10 w-full rounded-lg border bg-background px-3 text-[15px] outline-none focus:border-primary focus:ring-4 focus:ring-brand-faint"
          />
          <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-2">
            {FOLDER_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={color === c.id}
                aria-label={c.label}
                title={c.label}
                onClick={() => setColor(c.id)}
                className={cn("grid size-8 place-items-center rounded-full ring-offset-2 ring-offset-background transition", color === c.id && "ring-2 ring-foreground")}
                style={{ background: folderSwatch(c.id) }}
              >
                {color === c.id && <Check className="size-4 text-black/70" />}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="h-9 rounded-full px-4 text-[13px] font-medium text-muted-foreground hover:bg-accent">
              Cancel
            </button>
            <button type="submit" disabled={busy || !name.trim()} className="h-9 rounded-full bg-primary px-4 text-[13px] font-medium text-primary-foreground disabled:opacity-50">
              {folder ? "Save" : "Create folder"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Download a folder (and its subfolders) as a zip, after asking the server whether there's anything
 * to zip. Helper steps go in only when `steps` (Show steps is on), so the zip has what the pages show.
 */
async function downloadFolder(f: Folder, steps?: boolean) {
  const url = `/api/folders/${encodeURIComponent(f.id)}/zip${steps ? "?steps=1" : ""}`;
  const res = await fetch(`${url}${steps ? "&" : "?"}check=1`).catch(() => null);
  const body = ((await res?.json().catch(() => null)) ?? {}) as { files?: number; error?: string };
  if (!res?.ok) return void toast(body.error ?? "Couldn't make the zip. Try again in a moment.");
  downloadUrl(url);
  toast(`Downloading “${f.name}” · ${plural(body.files ?? 0, "file")}`);
}

/**
 * A folder's ⋯ menu (its card and its page header): open, new folder inside, rename or recolour,
 * pin, move into another folder, download as a zip, delete. `onGone` runs after a delete; `steps`:
 * the Library shows helper steps, so the zip takes them too.
 */
function FolderMenu({ folder, all, onOpen, onGone, steps, triggerClassName }: { folder: Folder; all: Folder[]; onOpen?: () => void; onGone?: () => void; steps?: boolean; triggerClassName: string }) {
  const actions = useFolderActions();
  const move = useMoveFolder(all);
  const share = useShare();
  const [dialog, setDialog] = useState<null | "edit" | "new" | "delete">(null);
  const parent = folder.parentId ? all.find((f) => f.id === folder.parentId) : undefined;
  // Open dialogs once the menu has closed and handed focus back, so the dialog keeps it.
  const later = (d: "edit" | "new" | "delete") => () => setTimeout(() => setDialog(d), 0);
  const moved = [folder.count ? plural(folder.count, "item") : "", folder.folders ? plural(folder.folders, "folder") : ""].filter(Boolean).join(" and ");
  return (
    // Clicks in the menu and its dialogs (portals bubble through React) never reach the card, which opens the folder.
    <span className="contents" onClick={(e) => e.stopPropagation()}>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button className={triggerClassName} aria-label={`Actions for ${folder.name}`}>
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" collisionPadding={12} className="min-w-52">
          {onOpen && (
            <DropdownMenuItem onSelect={onOpen}>
              <FolderOpen /> Open
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={later("new")} disabled={!roomInside(all, folder)}>
            <FolderPlus /> New folder inside
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={later("edit")}>
            <Pencil /> Rename or recolour
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void actions.update(folder.id, { pinned: !folder.pinnedAt }).catch((e: Error) => toastError(e))}>
            {folder.pinnedAt ? <PinOff /> : <Pin />} {folder.pinnedAt ? "Unpin" : "Pin to top"}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput /> Move to
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent collisionPadding={12} className="max-h-72 min-w-48 overflow-y-auto">
              <DropdownMenuItem disabled={!folder.parentId} onSelect={() => move(folder.id, null)}>
                <ChevronLeft /> Top of the Library
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {folderTree(all).map(({ folder: t, depth }) => (
                <DropdownMenuItem key={t.id} disabled={!!folderMoveError(all, folder.id, t.id)} onSelect={() => move(folder.id, t)} style={{ paddingLeft: 6 + Math.min(depth, 5) * 12 }}>
                  <span className="size-3 shrink-0 rounded-full" style={{ background: folderSwatch(t.color) }} /> <span className="truncate">{t.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem onSelect={() => void downloadFolder(folder, steps)}>
            <Download /> Download (.zip)
          </DropdownMenuItem>
          {share && (
            <DropdownMenuItem onSelect={() => share.share({ kind: "folder", id: folder.id, title: folder.name })}>
              <Share2 /> Share link…
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={later("delete")}>
            <Trash2 /> Delete folder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === "edit" && <FolderDialog folder={folder} open onOpenChange={(v) => !v && setDialog(null)} />}
      {dialog === "new" && <FolderDialog parent={folder} open onOpenChange={(v) => !v && setDialog(null)} />}
      <AlertDialog open={dialog === "delete"} onOpenChange={(v) => !v && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">Delete “{folder.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The folder goes away; nothing in it is deleted.
              {moved && ` Its ${moved} move ${parent ? `to “${parent.name}”` : "to the top of your Library"}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await actions.remove(folder.id);
                toast("Folder deleted");
                onGone?.();
              }}
            >
              Delete folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}

function FolderCard({ folder, all, onOpen, onDropIds, steps }: { folder: Folder; all: Folder[]; onOpen: () => void; onDropIds: (ids: string[]) => void; steps?: boolean }) {
  const move = useMoveFolder(all);
  const drag = useFolderDrag(folder);
  const drop = useDropTarget({ items: onDropIds, folder: (id) => move(id, folder), folderError: (id) => folderMoveError(all, id, folder.id) });
  const canHover = useCanHover();
  const meta = [plural(folder.count, "item"), folder.folders ? plural(folder.folders, "folder") : ""].filter(Boolean).join(" · ");
  return (
    <div
      {...drop.props}
      {...drag}
      onClick={onOpen}
      className={cn(
        "group/folder relative flex w-[min(60vw,220px)] shrink-0 cursor-pointer items-center gap-2.5 rounded-xl border bg-background p-2 text-left transition-[background-color,box-shadow,border-color] hover:bg-accent",
        drop.over === "" && "border-primary shadow-heavy ring-4 ring-brand-faint",
        !!drop.over && "border-dashed",
      )}
    >
      {/* The card takes the clicks (and drags: a drag can't start on a button); keyboards and screen
          readers use this button over it. The ⋯ button is its sibling (buttons don't nest). */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        aria-label={`Open ${folder.name}`}
        className="pointer-events-none absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <span className="pointer-events-none relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg" style={{ background: folderSwatch(folder.color) }}>
        {folder.cover ? <MediaThumb output={folder.cover} /> : <FolderIcon className="size-5 text-black/60" />}
        {folder.cover && <span className="absolute inset-x-0 bottom-0 h-1.5" style={{ background: folderSwatch(folder.color) }} />}
      </span>
      <span className="pointer-events-none relative min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-[13px] font-medium">{folder.name}</span>
          {folder.pinnedAt && <Pin className="size-3 shrink-0 text-muted-foreground" aria-label="Pinned" />}
        </span>
        <span className={cn("block truncate text-[12px] text-muted-foreground", !!drop.over && "text-destructive")}>{drop.over === "" ? "Drop to move here" : drop.over || meta}</span>
      </span>
      <FolderMenu
        folder={folder}
        all={all}
        onOpen={onOpen}
        steps={steps}
        // With a mouse it appears over the card's corner on hover, so names keep the full width; touch screens always show it.
        triggerClassName={cn(
          "grid shrink-0 place-items-center rounded-lg text-muted-foreground transition-opacity hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100",
          canHover ? "absolute top-1 right-1 size-7 bg-background/90 opacity-0 shadow-soft backdrop-blur group-focus-within/folder:opacity-100 group-hover/folder:opacity-100" : "relative -mr-1 size-7",
        )}
      />
    </div>
  );
}

/** The folders inside `parent` (the library root with null), pinned first, and a New folder tile. `steps`: Show steps is on. */
export function FolderStrip({ all, parent, onOpen, onMove, steps }: { all: Folder[]; parent: Folder | null; onOpen: (f: Folder) => void; onMove: (ids: string[], f: Folder) => void; steps?: boolean }) {
  const [creating, setCreating] = useState(false);
  // Folders are the studio's library, its owner's: a guest or an account isn't offered one the server would refuse.
  const visitor = useIsVisitor();
  const kids = childFolders(all, parent?.id ?? null);
  return (
    <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 py-1" role="list" aria-label={parent ? `Folders in ${parent.name}` : "Folders"}>
      {kids.map((f) => (
        <div role="listitem" key={f.id} className="shrink-0">
          <FolderCard folder={f} all={all} onOpen={() => onOpen(f)} onDropIds={(ids) => onMove(ids, f)} steps={steps} />
        </div>
      ))}
      {roomInside(all, parent) && !visitor && (
        <div role="listitem" className="flex shrink-0">
          <button
            onClick={() => setCreating(true)}
            className="flex w-[min(44vw,160px)] shrink-0 items-center gap-2.5 rounded-xl border border-dashed p-2 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted">
              <FolderPlus className="size-5" />
            </span>
            <span className="text-[13px] font-medium">{parent ? "New folder inside" : "New folder"}</span>
          </button>
        </div>
      )}
      {creating && <FolderDialog parent={parent} open onOpenChange={setCreating} />}
    </div>
  );
}

/** One breadcrumb: opens its folder, and takes dropped cards and folders. */
function Crumb({ target, all, label, onGo, onMoveItems, back }: { target: Folder | null; all: Folder[]; label: string; onGo: () => void; onMoveItems: (ids: string[], target: Folder | null) => void; back?: boolean }) {
  const move = useMoveFolder(all);
  const drop = useDropTarget({ items: (ids) => onMoveItems(ids, target), folder: (id) => move(id, target), folderError: (id) => folderMoveError(all, id, target?.id ?? null) });
  return (
    <button
      onClick={onGo}
      {...drop.props}
      title={drop.over || undefined}
      className={cn(
        "inline-flex h-7 min-w-0 shrink items-center gap-0.5 rounded-full px-2 text-[13px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        back && "shrink-0 pl-1",
        drop.over === "" && "bg-brand-faint text-brand-text ring-4 ring-brand-faint",
        !!drop.over && "text-destructive",
      )}
    >
      {back && <ChevronLeft className="size-4 shrink-0" />}
      <span className="truncate">{drop.over === "" ? `Move to ${label}` : label}</span>
    </button>
  );
}

/**
 * A folder's page header: breadcrumbs back up the tree (each one a drop target, so cards and
 * folders can be moved up), then the folder's name, count and ⋯ menu.
 */
export function FolderHeader({
  folder,
  all,
  onGo,
  onMoveItems,
  steps,
}: {
  folder: Folder;
  all: Folder[];
  onGo: (f: Folder | null) => void;
  onMoveItems: (ids: string[], target: Folder | null) => void;
  /** Show steps is on (the folder's zip takes them too). */
  steps?: boolean;
}) {
  const ancestors = folderPath(all, folder.id).slice(0, -1);
  // Deep folders show the two nearest crumbs; the ones above fold into "…".
  const shown = ancestors.slice(-2);
  return (
    <div className="min-w-0 flex-1">
      <nav aria-label="Folder path" className="flex min-w-0 items-center gap-0.5 overflow-hidden">
        <Crumb target={null} all={all} label="Library" back onGo={() => onGo(null)} onMoveItems={onMoveItems} />
        {ancestors.length > shown.length && (
          <>
            <ChevronRight className="size-3.5 shrink-0 text-subtle-foreground" />
            <span className="shrink-0 px-1 text-[13px] text-muted-foreground" title={ancestors.slice(0, -2).map((f) => f.name).join(" / ")}>
              …
            </span>
          </>
        )}
        {shown.map((f) => (
          <span key={f.id} className="flex min-w-0 items-center gap-0.5">
            <ChevronRight className="size-3.5 shrink-0 text-subtle-foreground" />
            <Crumb target={f} all={all} label={f.name} onGo={() => onGo(f)} onMoveItems={onMoveItems} />
          </span>
        ))}
      </nav>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        <span className="size-3 shrink-0 rounded-full" style={{ background: folderSwatch(folder.color) }} />
        <h1 className="min-w-0 truncate font-heading text-[28px] leading-tight">{folder.name}</h1>
        {folder.pinnedAt && <Pin className="size-3.5 shrink-0 text-muted-foreground" aria-label="Pinned" />}
        <span className="shrink-0 font-mono text-[12px] text-muted-foreground" aria-label={plural(folder.count, "item")}>
          {folder.count}
        </span>
        <FolderMenu
          folder={folder}
          all={all}
          onGone={() => onGo(all.find((f) => f.id === folder.parentId) ?? null)}
          steps={steps}
          triggerClassName="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
        />
      </div>
    </div>
  );
}

/** "Move to folder" choices for the bulk bar: every folder as a tree, out of folders, then a new one. */
export function MoveMenuItems({ folders, current, onMove, onNew }: { folders: Folder[]; current?: string; onMove: (folderId: string | null, name: string) => void; onNew: () => void }) {
  return (
    <>
      {folderTree(folders).map(({ folder: f, depth }) => (
        <DropdownMenuItem key={f.id} disabled={f.id === current} onSelect={() => onMove(f.id, f.name)} style={{ paddingLeft: 6 + Math.min(depth, 5) * 12 }}>
          <span className="size-3 shrink-0 rounded-full" style={{ background: folderSwatch(f.color) }} /> <span className="truncate">{f.name}</span>
        </DropdownMenuItem>
      ))}
      {current && (
        <DropdownMenuItem onSelect={() => onMove(null, "Library")}>
          <ChevronLeft /> Take out of folders
        </DropdownMenuItem>
      )}
      {folders.length > 0 && <DropdownMenuSeparator />}
      {/* After the menu has closed and handed focus back, so the dialog keeps it. */}
      <DropdownMenuItem onSelect={() => setTimeout(onNew, 0)}>
        <FolderPlus /> New folder…
      </DropdownMenuItem>
    </>
  );
}
