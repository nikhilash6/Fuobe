"use client";

import { Check, Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { PROJECT_COLORS, PROJECT_LIMITS, PROJECT_SWATCH, type AssistProject, type ProjectColor } from "@/lib/assist";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { radioKeys, radioTab } from "@/components/studio/radio-keys";
import { useProjectActions, useSkills } from "./hooks";
import { SkillIcon } from "./skill-icon";

/** Create or edit a project: name and colour, instructions, project skills, personal memory. */
export function ProjectDialog({
  open,
  onOpenChange,
  project,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: AssistProject;
  onSaved?: (p: AssistProject) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90svh,760px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[560px]">
        {/* Remount per opening so the form starts from the project as it is now. */}
        {open && <Form project={project} onDone={(p) => (onOpenChange(false), p && onSaved?.(p))} />}
      </DialogContent>
    </Dialog>
  );
}

function Form({ project, onDone }: { project?: AssistProject; onDone: (p?: AssistProject) => void }) {
  const actions = useProjectActions();
  const skills = useSkills();
  const ids = { name: useId(), instructions: useId(), memory: useId() };
  const [name, setName] = useState(project?.name ?? "");
  const [color, setColor] = useState<ProjectColor>(project?.color ?? "iris");
  const [instructions, setInstructions] = useState(project?.instructions ?? "");
  const [picked, setPicked] = useState<string[]>(project?.skills ?? []);
  const [personal, setPersonal] = useState(project?.usePersonalMemory ?? true);
  const [busy, setBusy] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return void toast.error("Give the project a name");
    setBusy(true);
    try {
      const body = { name: name.trim(), color, instructions, skills: picked, usePersonalMemory: personal };
      const p = project ? await actions.update(project.id, body) : await actions.create(body);
      if (!project) toast.success("Project created", { duration: 1500 });
      onDone(p);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (n: string) => setPicked((xs) => (xs.includes(n) ? xs.filter((x) => x !== n) : [...xs, n]));

  return (
    <form onSubmit={save} className="flex min-h-0 flex-col">
      <DialogHeader className="border-b px-5 pt-5 pb-4">
        <DialogTitle className="font-heading text-[24px] font-normal">{project ? "Project settings" : "New project"}</DialogTitle>
        <DialogDescription>Chats in a project share its instructions, sources and skills. Its memory stays inside it.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <div className="space-y-2">
          <Label htmlFor={ids.name}>Name</Label>
          <div className="flex items-center gap-3">
            <Input id={ids.name} value={name} onChange={(e) => setName(e.target.value)} maxLength={PROJECT_LIMITS.name} placeholder="e.g. Spring campaign, Cooking channel" autoFocus={!project} />
          </div>
          <div role="radiogroup" aria-label="Colour" onKeyDown={radioKeys} className="flex flex-wrap gap-2 pt-1">
            {PROJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={c}
                tabIndex={radioTab(color === c)}
                onClick={() => setColor(c)}
                className={cn("grid size-7 place-items-center rounded-full ring-offset-2 ring-offset-background transition", color === c && "ring-2 ring-primary")}
                style={{ backgroundColor: PROJECT_SWATCH[c] }}
              >
                {color === c && <Check className="size-3.5 text-white" />}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor={ids.instructions}>Instructions</Label>
          <p className="text-[12px] text-muted-foreground">Guide Assist on how to work in this project: what it should do and how it should respond.</p>
          <Textarea
            id={ids.instructions}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            maxLength={PROJECT_LIMITS.instructions}
            rows={5}
            placeholder="e.g. Everything is for our oat-milk brand “Oatly-ish”: warm, playful tone; vertical 9:16; teal #1E9E8F and cream; never show dairy."
            className="min-h-28 text-[14px]"
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Skills</legend>
          <p className="text-[12px] text-muted-foreground">{picked.length ? `Assist can use only these ${picked.length} skill${picked.length > 1 ? "s" : ""} here.` : "None picked: every skill that's switched on is available. Pick some to limit the project to them."}</p>
          <div className="grid max-h-56 gap-1 overflow-y-auto rounded-xl border p-1.5 sm:grid-cols-2">
            {skills.data?.map((s) => (
              <label key={s.name} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-accent">
                <Checkbox checked={picked.includes(s.name)} onCheckedChange={() => toggle(s.name)} aria-label={s.title} />
                <SkillIcon name={s.name} icon={s.icon} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[13px]">{s.title}</span>
              </label>
            )) ?? <p className="p-2 text-[12px] text-muted-foreground">Loading skills…</p>}
          </div>
        </fieldset>
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor={ids.memory}>Use my personal memory</Label>
            <p className="mt-1 text-[12px] text-muted-foreground">Off: chats here see only this project&apos;s memory, and nothing personal carries in.</p>
          </div>
          <Switch id={ids.memory} checked={personal} onCheckedChange={setPersonal} />
        </div>
      </div>
      <DialogFooter className="mx-0 mb-0 border-t px-5 py-3">
        <Button type="button" variant="ghost" onClick={() => onDone()}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} {project ? "Save" : "Create project"}
        </Button>
      </DialogFooter>
    </form>
  );
}
