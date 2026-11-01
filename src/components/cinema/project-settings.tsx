"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MediaSlot, type SlotValue } from "@/components/studio/media-slot";
import type { CinemaProject } from "@/lib/catalog/cinema";
import { untitledName } from "@/lib/format";
import { toastError } from "@/lib/refusals";
import { formatUsd } from "./money";
import { useCinemaProjects, useCreateProject, useDeleteProject, useUpdateProject } from "./hooks";

const MAX_DESC = 140;

interface FormProps {
  project?: CinemaProject;
  spentUsd?: number;
  onDone: (project?: CinemaProject) => void;
  onDeleted?: () => void;
}

/** New project / project settings: name, description (≤ 140), cover (16:9), cost cap. */
function ProjectForm({ project, spentUsd, onDone, onDeleted }: FormProps) {
  const create = useCreateProject();
  const update = useUpdateProject(project?.id ?? "");
  const del = useDeleteProject();
  const projects = useCinemaProjects();
  // A new project starts with a name (selected, so typing replaces it and Enter creates it).
  const [name, setName] = useState(() => project?.name ?? untitledName((projects.data ?? []).map((p) => p.name)));
  const nameRef = useRef<HTMLInputElement>(null);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (!project) nameRef.current?.select();
  }, [project]);
  const [description, setDescription] = useState(project?.description ?? "");
  const [cover, setCover] = useState<SlotValue | null>(project?.cover ? { ref: project.cover, preview: project.cover, kind: "image" } : null);
  const [cap, setCap] = useState(project?.costCapUsd != null ? String(project.costCapUsd) : "");
  const [confirm, setConfirm] = useState(false);
  const pending = create.isPending || update.isPending;
  const capValue = cap.trim() === "" ? null : Number(cap);
  const capBad = capValue !== null && (!Number.isFinite(capValue) || capValue < 0);
  // Said next to the field (not in a toast that covers the next screen on phones), once Create was pressed.
  const nameError = tried && !name.trim() ? "Give the project a name" : null;

  const submit = () => {
    setTried(true);
    if (!name.trim()) return nameRef.current?.focus();
    if (cover?.uploading) return toast.error("The cover is still uploading");
    if (capBad) return document.getElementById("cinema-cap")?.focus();
    const body = { name: name.trim(), description: description.trim() || null, cover: cover?.ref || null, costCapUsd: capValue };
    if (project)
      update.mutate(body, {
        onSuccess: (p) => {
          toast.success("Saved", { duration: 1500 });
          onDone(p);
        },
        onError: (e) => toastError(e),
      });
    else create.mutate(body, { onSuccess: (p) => onDone(p), onError: (e) => toastError(e) });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{project ? "Project settings" : "New project"}</DialogTitle>
        <DialogDescription>Projects keep your generations, elements and chats together.</DialogDescription>
      </DialogHeader>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="cinema-name">Project name</Label>
          <Input
            ref={nameRef}
            id="cinema-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. “Night Shift”"
            autoFocus
            maxLength={80}
            aria-invalid={!!nameError}
            aria-describedby={nameError ? "cinema-name-error" : undefined}
          />
          {nameError && (
            <p id="cinema-name-error" className="text-[12px] text-destructive">
              {nameError}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="cinema-desc">Description</Label>
            <span className={`font-mono text-[11px] ${description.length > MAX_DESC - 10 ? "text-warning" : "text-muted-foreground"}`}>
              {description.length}/{MAX_DESC}
            </span>
          </div>
          <Textarea
            id="cinema-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESC))}
            placeholder="A short summary shown on the project card"
            rows={2}
            className="resize-none"
          />
        </div>
        <div className="flex items-start gap-4">
          <div className="space-y-1.5">
            <Label>Cover</Label>
            <MediaSlot label="Cover · 16:9" kind="image" value={cover} onChange={setCover} size="lg" />
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="cinema-cap">Spending limit</Label>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[13px] text-muted-foreground">$</span>
              <Input
                id="cinema-cap"
                inputMode="decimal"
                value={cap}
                onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="No limit"
                className="pl-6 font-mono"
                aria-invalid={capBad}
                aria-describedby={capBad ? "cinema-cap-error" : undefined}
              />
            </div>
            {capBad && (
              <p id="cinema-cap-error" className="text-[12px] text-destructive">
                Enter an amount in dollars, like 25 or 7.50
              </p>
            )}
            <p className="text-[12px] leading-snug text-muted-foreground">
              An estimate guard: Generate stops before the project&apos;s estimated spend would pass it.
              {project && spentUsd != null ? ` Spent so far ≈ ${formatUsd(spentUsd)}.` : ""}
            </p>
          </div>
        </div>
        <DialogFooter className="items-center gap-2 sm:justify-between">
          {project && onDeleted ? (
            <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirm(true)}>
              <Trash2 /> Delete project
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            {project ? "Save" : "Create project"}
          </Button>
        </DialogFooter>
      </form>
      {project && (
        <AlertDialog open={confirm} onOpenChange={setConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete “{project.name}”?</AlertDialogTitle>
              <AlertDialogDescription>Its folders, brief and Director chat are removed. The images and videos stay in your library.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() =>
                  del.mutate(project.id, {
                    onSuccess: () => {
                      toast("Project deleted");
                      onDeleted?.();
                    },
                    onError: (e) => toastError(e),
                  })
                }
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}

export function ProjectDialog({ open, onOpenChange, ...props }: FormProps & { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">{open && <ProjectForm {...props} />}</DialogContent>
    </Dialog>
  );
}
