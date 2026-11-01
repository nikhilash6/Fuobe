"use client";

import { Check, FolderInput, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AssistThreadSummary } from "@/lib/assist";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { useChatActions, useProjects } from "./hooks";
import { ProjectDot } from "./project-dot";

/**
 * A chat's menu (the rail row and the chat header): rename it, move it into a project or out of
 * one, delete it. While a reply is running the server refuses a move, and says so in a toast.
 */
export function ChatMenu({
  chat,
  onDeleted,
  className,
  align = "end",
}: {
  chat: Pick<AssistThreadSummary, "id" | "title" | "projectId" | "status">;
  onDeleted?: () => void;
  className?: string;
  align?: "start" | "end";
}) {
  const projects = useProjects();
  const actions = useChatActions();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const move = async (projectId: string | null) => {
    if ((chat.projectId ?? null) === projectId) return;
    try {
      await actions.patch(chat.id, { projectId });
      const p = projects.data?.find((x) => x.id === projectId);
      toast(p ? `Moved to ${p.name}` : "Moved out of the project", { duration: 1500 });
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async () => {
    try {
      await actions.remove(chat.id);
      onDeleted?.();
      toast("Chat deleted", { duration: 1500 });
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className={cn("text-muted-foreground", className)} aria-label={`More for ${chat.title}`}>
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-52">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <Pencil /> Rename…
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput /> Move to project
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 w-52 overflow-y-auto">
              <DropdownMenuItem onSelect={() => void move(null)}>
                <span className="size-2.5 shrink-0 rounded-full border border-dashed border-muted-foreground" aria-hidden />
                <span className="flex-1">No project</span>
                {!chat.projectId && <Check className="text-brand-text" aria-label="Current" />}
              </DropdownMenuItem>
              {projects.data?.length ? <DropdownMenuSeparator /> : null}
              {projects.data?.map((p) => (
                <DropdownMenuItem key={p.id} onSelect={() => void move(p.id)}>
                  <ProjectDot project={p} />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  {chat.projectId === p.id && <Check className="text-brand-text" aria-label="Current" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2 /> Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="sm:max-w-[420px]">{renaming && <RenameForm chat={chat} onDone={() => setRenaming(false)} />}</DialogContent>
      </Dialog>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>“{chat.title}” and its messages are removed. Everything it made stays in your Library.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RenameForm({ chat, onDone }: { chat: Pick<AssistThreadSummary, "id" | "title">; onDone: () => void }) {
  const actions = useChatActions();
  const id = useId();
  const [title, setTitle] = useState(chat.title);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t || t === chat.title) return onDone();
    setBusy(true);
    try {
      await actions.patch(chat.id, { title: t });
      onDone();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="space-y-4">
      <DialogHeader>
        <DialogTitle className="font-heading text-[24px] font-normal">Rename chat</DialogTitle>
        <DialogDescription className="sr-only">Give this chat a new name.</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor={id}>Name</Label>
        <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} autoFocus onFocus={(e) => e.currentTarget.select()} />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !title.trim()}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}
