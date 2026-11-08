"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ChatThreadSummary } from "@/lib/chat/types";
import { toastError } from "@/lib/refusals";
import { cn } from "@/lib/utils";
import { chatSend } from "./hooks";

/** A chat's menu in the sidebar and its header: rename it, archive it (or bring it back), delete it. */
export function TalkMenu({ chat, className, align = "end" }: { chat: Pick<ChatThreadSummary, "id" | "title" | "archived">; className?: string; align?: "start" | "end" }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["chat"] });
  const leaveIfOpen = () => {
    if (typeof window !== "undefined" && window.location.pathname === `/chat/${chat.id}`) router.push("/chat");
  };

  const archive = async (on: boolean) => {
    try {
      await chatSend(`/api/chat/threads/${chat.id}`, "PATCH", { archived: on });
      void refresh();
      toast(on ? "Archived. Find it under Archived in the sidebar." : "Back in your chats", { duration: 2000 });
      if (on) leaveIfOpen();
    } catch (e) {
      toastError(e);
    }
  };
  const remove = async () => {
    try {
      await chatSend(`/api/chat/threads/${chat.id}`, "DELETE");
      void refresh();
      toast("Chat deleted", { duration: 1500 });
      leaveIfOpen();
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
        <DropdownMenuContent align={align} className="w-48">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            <Pencil /> Rename…
          </DropdownMenuItem>
          {chat.archived ? (
            <DropdownMenuItem onSelect={() => void archive(false)}>
              <ArchiveRestore /> Unarchive
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => void archive(true)}>
              <Archive /> Archive
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
            <Trash2 /> Delete…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="sm:max-w-[420px]">{renaming && <RenameForm chat={chat} onDone={() => setRenaming(false)} onSaved={refresh} />}</DialogContent>
      </Dialog>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>“{chat.title}” and its messages are removed for good, and its share link stops working. Anything it made stays in your Library. To keep it out of the way instead, archive it.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            {!chat.archived && (
              <Button variant="outline" onClick={() => (setDeleting(false), void archive(true))}>
                Archive instead
              </Button>
            )}
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function RenameForm({ chat, onDone, onSaved }: { chat: Pick<ChatThreadSummary, "id" | "title">; onDone: () => void; onSaved: () => void }) {
  const id = useId();
  const [title, setTitle] = useState(chat.title);
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t || t === chat.title) return onDone();
    setBusy(true);
    try {
      await chatSend(`/api/chat/threads/${chat.id}`, "PATCH", { title: t });
      onSaved();
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
