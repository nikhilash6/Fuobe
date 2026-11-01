"use client";

import { Brain, Check, ClipboardCopy, Import, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useMemo, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useIsOwner, useIsVisitor } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { guessCategory, MEMORY_CATEGORIES, MEMORY_HINTS, MEMORY_MAX_CHARS, parseMemoryImport, type AssistMemory, type AssistProject, type MemoryCategory, type MemoryScope } from "@/lib/assist";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { radioKeys, radioTab } from "@/components/studio/radio-keys";
import { useMemories, useMemoryActions, useProjects } from "./hooks";
import { ProjectDot, RailButton } from "./shell";
import { AssistVisitorNote } from "./visitor-note";

/** Where memories live: personal, or one project's. */
type Place = { scope: "personal" } | { scope: "project"; projectId: string } | { scope: "all" };
const placeKey = (p: Place) => (p.scope === "project" ? `project:${p.projectId}` : p.scope);
const fromKey = (k: string): Place => (k.startsWith("project:") ? { scope: "project", projectId: k.slice(8) } : k === "all" ? { scope: "all" } : { scope: "personal" });

const SOURCE_LABEL: Record<AssistMemory["source"], string> = { user: "You", agent: "Assist", import: "Imported" };

/** Prompt to paste into another assistant so it lists what it remembers in a shape the import reads. */
const EXPORT_PROMPT =
  "List everything you remember about me — my preferences, style, how I like replies, conventions I use, my setup and tools — as short bullet points, one fact per line, grouped under the headings Preference, Style, Communication, Convention, Environment, Tooling, Troubleshooting and Notes. No commentary.";

/** Memory (Supercomputer's "Learning from every chat"): typed notes, personal or per project. */
export function MemoryView({ projectId }: { projectId?: string } = {}) {
  const projects = useProjects();
  const [place, setPlace] = useState<Place>(projectId ? { scope: "project", projectId } : { scope: "personal" });
  const [category, setCategory] = useState<MemoryCategory | "all">("all");
  const memories = useMemories({ scope: place.scope, projectId: place.scope === "project" ? place.projectId : null });
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  // A guest or an account (public sign-up): Assist's memory is the owner's, so no Add or Import.
  const owner = useIsOwner();
  const visitor = useIsVisitor();
  const list = (memories.data ?? []).filter((m) => category === "all" || m.category === category);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const m of memories.data ?? []) c.set(m.category, (c.get(m.category) ?? 0) + 1);
    return c;
  }, [memories.data]);
  const projectName = (id: string | null) => projects.data?.find((p) => p.id === id);

  return (
    <div className={cn("flex min-w-0 flex-col", !projectId && "min-h-svh")}>
      {!projectId && (
        <header className="sticky top-0 z-20 flex h-14 items-center gap-1.5 bg-background/85 px-3 backdrop-blur sm:px-6">
          <SidebarTrigger className="md:hidden" />
          <RailButton />
          <h1 className="font-heading text-[22px] leading-none">Memory</h1>
          {owner && (
            <div className="ml-auto flex items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={() => setImporting(true)} aria-label="Import memories">
                <Import /> <span className="hidden sm:inline">Import</span>
              </Button>
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus /> <span className="hidden sm:inline">Add a memory</span>
                <span className="sm:hidden">Add</span>
              </Button>
            </div>
          )}
        </header>
      )}
      <div className={cn("w-full max-w-[900px] min-w-0 flex-1 px-3 pb-16 sm:px-6", projectId ? "pt-2" : "pt-4 md:pt-8")}>
        {!projectId && <p className="max-w-2xl text-[15px] text-pretty text-muted-foreground">Learning from every chat. Assist follows these in every reply, and saves new ones when you tell it something worth keeping{" "}— it asks first while Ask first is on.</p>}
        {!projectId && <AssistVisitorNote className="mt-4 max-w-2xl" />}
        {projectId && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted-foreground">Only this project&apos;s chats see these.</p>
            {owner && (
              <div className="flex gap-1.5">
                <Button variant="outline" size="sm" onClick={() => setImporting(true)}>
                  <Import /> Import
                </Button>
                <Button size="sm" onClick={() => setAdding(true)}>
                  <Plus /> Add
                </Button>
              </div>
            )}
          </div>
        )}
        {/* Whose memory and its categories: only the owner has any (a visitor's list is always empty). */}
        {owner && (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {!projectId && (
              <Select value={placeKey(place)} onValueChange={(k) => setPlace(fromKey(k))}>
                <SelectTrigger className="h-8 rounded-full" aria-label="Whose memory">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Personal</SelectItem>
                  {projects.data?.map((p) => (
                    <SelectItem key={p.id} value={`project:${p.id}`}>
                      <ProjectDot project={p} /> {p.name}
                    </SelectItem>
                  ))}
                  <SelectItem value="all">Everything</SelectItem>
                </SelectContent>
              </Select>
            )}
            <div className="-mx-1 flex min-w-0 flex-1 gap-1 overflow-x-auto px-1 scrollbar-none" role="radiogroup" aria-label="Category" onKeyDown={radioKeys}>
              {(["all", ...MEMORY_CATEGORIES] as const).map((c) => {
                const n = c === "all" ? (memories.data?.length ?? 0) : (counts.get(c) ?? 0);
                // Empty categories are hidden, except the picked one (it stays the group's Tab stop).
                if (c !== "all" && !n && category !== c) return null;
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={category === c}
                    tabIndex={radioTab(category === c)}
                    onClick={() => setCategory(c)}
                    className={cn(
                      "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors",
                      category === c ? "bg-brand-faint text-brand-text hover:bg-brand-faint-hover" : "bg-secondary text-secondary-foreground hover:bg-accent",
                    )}
                  >
                    {c === "all" ? "All" : c} <span className="font-mono text-[11px] opacity-70">{n}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="mt-4">
          {memories.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : list.length ? (
            <ul className="divide-y rounded-2xl border bg-background">
              {list.map((m) => (
                <MemoryRow key={m.id} m={m} project={place.scope === "all" ? projectName(m.projectId) : undefined} />
              ))}
            </ul>
          ) : (
            <Empty className="border py-14">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Brain />
                </EmptyMedia>
                {/* A visitor can't add or import (the note above says why); nothing until it's known who's looking, so neither text flashes. */}
                {owner ? (
                  <>
                    <EmptyTitle className="font-heading text-[22px] font-normal">{category === "all" ? "Nothing remembered yet" : `No ${category.toLowerCase()} memories`}</EmptyTitle>
                    <EmptyDescription>Tell Assist “remember that I always want 9:16” in a chat, add one here, or bring over what another assistant knows about you.</EmptyDescription>
                  </>
                ) : visitor ? (
                  <>
                    <EmptyTitle className="font-heading text-[22px] font-normal">Memory belongs to the owner</EmptyTitle>
                    <EmptyDescription>Assist keeps what the studio&apos;s owner tells it, and that stays private to them.</EmptyDescription>
                  </>
                ) : null}
              </EmptyHeader>
              {owner && (
                <EmptyContent className="flex-row justify-center">
                  <Button variant="outline" onClick={() => setImporting(true)}>
                    <Import /> Import
                  </Button>
                  <Button onClick={() => setAdding(true)}>
                    <Plus /> Add a memory
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          )}
        </div>
      </div>
      <AddMemory open={adding} onOpenChange={setAdding} place={place} projects={projects.data ?? []} />
      <ImportMemories open={importing} onOpenChange={setImporting} place={place} projects={projects.data ?? []} />
    </div>
  );
}

function MemoryRow({ m, project }: { m: AssistMemory; project?: AssistProject }) {
  const actions = useMemoryActions();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(m.text);
  const [category, setCategory] = useState<MemoryCategory>(m.category);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await actions.update(m.id, { text, category });
      setEditing(false);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="group/mem flex gap-3 px-4 py-3">
      {editing ? (
        <div className="min-w-0 flex-1 space-y-2">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={MEMORY_MAX_CHARS} rows={2} autoFocus aria-label="Memory" className="text-[14px]" />
          <div className="flex flex-wrap items-center gap-2">
            <CategorySelect value={category} onChange={setCategory} />
            <div className="ml-auto flex gap-1.5">
              <Button variant="ghost" size="sm" onClick={() => (setEditing(false), setText(m.text), setCategory(m.category))}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void save()} disabled={busy || !text.trim()}>
                {busy ? <Loader2 className="animate-spin" /> : <Check />} Save
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] leading-relaxed break-words">{m.text}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-muted-foreground">
              <span className="font-medium text-foreground/70">{m.category}</span>
              {project && (
                <span className="inline-flex items-center gap-1">
                  <ProjectDot project={project} className="size-1.5" /> {project.name}
                </span>
              )}
              <span>
                {SOURCE_LABEL[m.source]} · {timeAgo(m.updatedAt)}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 items-start gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/mem:opacity-100 sm:group-focus-within/mem:opacity-100">
            <Button variant="ghost" size="icon-sm" onClick={() => setEditing(true)} aria-label="Edit memory">
              <Pencil />
            </Button>
            <Button variant="ghost" size="icon-sm" className="hover:text-destructive" onClick={() => setConfirm(true)} aria-label="Delete memory">
              <Trash2 />
            </Button>
          </div>
        </>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete memory?</AlertDialogTitle>
            <AlertDialogDescription>“{m.text}” — Assist forgets it in every chat. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void actions.remove(m.id).catch((e) => toastError(e))}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

/** A memory's category: the trigger shows just the name; the list adds what each one is for. */
function CategorySelect({ value, onChange, id, className, label = "Category" }: { value: MemoryCategory; onChange: (c: MemoryCategory) => void; id?: string; className?: string; label?: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as MemoryCategory)}>
      <SelectTrigger id={id} size="sm" className={cn("max-w-full rounded-full", className)} aria-label={label}>
        <SelectValue>{value}</SelectValue>
      </SelectTrigger>
      <SelectContent className="max-w-[min(22rem,calc(100vw-2rem))]">
        {MEMORY_CATEGORIES.map((c) => (
          <SelectItem key={c} value={c} className="py-1.5">
            <span className="flex min-w-0 flex-col items-start gap-0">
              <span>{c}</span>
              <span className="text-[11px] leading-snug whitespace-normal text-muted-foreground">{MEMORY_HINTS[c]}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Personal or one project (for adding and importing). */
function ScopeSelect({ value, onChange, projects, id }: { value: string; onChange: (k: string) => void; projects: AssistProject[]; id?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} size="sm" className="rounded-full" aria-label="Keep it for">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="personal">Personal — every chat</SelectItem>
        {projects.map((p) => (
          <SelectItem key={p.id} value={`project:${p.id}`}>
            <ProjectDot project={p} /> {p.name} only
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const scopeOf = (k: string): { scope: MemoryScope; projectId: string | null } => (k.startsWith("project:") ? { scope: "project", projectId: k.slice(8) } : { scope: "personal", projectId: null });

function AddMemory({ open, onOpenChange, place, projects }: { open: boolean; onOpenChange: (o: boolean) => void; place: Place; projects: AssistProject[] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">{open && <AddForm place={place} projects={projects} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function AddForm({ place, projects, onDone }: { place: Place; projects: AssistProject[]; onDone: () => void }) {
  const actions = useMemoryActions();
  const ids = { text: useId(), category: useId(), scope: useId() };
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<MemoryCategory | null>(null);
  const [scope, setScope] = useState(place.scope === "project" ? `project:${place.projectId}` : "personal");
  const [busy, setBusy] = useState(false);
  const category = picked ?? guessCategory(text);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await actions.add({ text, category, ...scopeOf(scope) });
      toast.success("Remembered", { duration: 1500 });
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
        <DialogTitle className="font-heading text-[24px] font-normal">Add a memory</DialogTitle>
        <DialogDescription>One fact or rule per memory works best.</DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor={ids.text}>Remember that:</Label>
        <Textarea id={ids.text} value={text} onChange={(e) => setText(e.target.value)} maxLength={MEMORY_MAX_CHARS} rows={3} autoFocus placeholder="e.g. I post on TikTok and Reels, so default to vertical 9:16 with captions." />
      </div>
      <div className="flex flex-wrap gap-4">
        <div className="space-y-1.5">
          <Label htmlFor={ids.category} className="text-[12px]">
            Category
          </Label>
          <CategorySelect id={ids.category} value={category} onChange={setPicked} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={ids.scope} className="text-[12px]">
            Keep it for
          </Label>
          <ScopeSelect id={ids.scope} value={scope} onChange={setScope} projects={projects} />
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !text.trim()}>
          {busy && <Loader2 className="animate-spin" />} Remember
        </Button>
      </DialogFooter>
    </form>
  );
}

function ImportMemories({ open, onOpenChange, place, projects }: { open: boolean; onOpenChange: (o: boolean) => void; place: Place; projects: AssistProject[] }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92svh,820px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px]">{open && <ImportForm place={place} projects={projects} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function ImportForm({ place, projects, onDone }: { place: Place; projects: AssistProject[]; onDone: () => void }) {
  const actions = useMemoryActions();
  const ids = { text: useId(), scope: useId() };
  const [text, setText] = useState("");
  const [items, setItems] = useState<{ text: string; category: MemoryCategory; keep: boolean }[] | null>(null);
  const [scope, setScope] = useState(place.scope === "project" ? `project:${place.projectId}` : "personal");
  const [busy, setBusy] = useState(false);
  const kept = items?.filter((i) => i.keep) ?? [];

  const preview = () => {
    const parsed = parseMemoryImport(text);
    if (!parsed.length) return void toast.error("Nothing to import — paste one memory per line or bullet");
    setItems(parsed.map((p) => ({ ...p, keep: true })));
  };
  const save = async () => {
    setBusy(true);
    try {
      const r = await actions.importItems({ items: kept.map(({ text, category }) => ({ text, category })), ...scopeOf(scope) });
      toast.success(`Imported ${r.added} memor${r.added === 1 ? "y" : "ies"}`, { description: r.skipped ? `${r.skipped} were already there` : undefined });
      onDone();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DialogHeader className="border-b px-5 pt-5 pb-4">
        <DialogTitle className="font-heading text-[24px] font-normal">Import memories</DialogTitle>
        <DialogDescription>Bring over what Claude, ChatGPT, Codex or another assistant knows about you.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {!items ? (
          <>
            <div className="rounded-xl bg-muted/60 px-4 py-3 text-[13px]">
              <p className="font-medium">1. Ask your other assistant</p>
              <p className="mt-1 text-muted-foreground">{EXPORT_PROMPT}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2"
                onClick={async () => toast((await copyText(EXPORT_PROMPT)) ? "Copied" : "Couldn't copy — select the text instead", { duration: 1500 })}
              >
                <ClipboardCopy /> Copy this prompt
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor={ids.text}>2. Paste its answer</Label>
              <Textarea id={ids.text} value={text} onChange={(e) => setText(e.target.value)} rows={9} placeholder={"## Preference\n- Prefers vertical 9:16 videos\n- Likes warm, filmic colour grading\n\n## Communication\n- Wants short answers"} className="font-mono text-[13px]" />
            </div>
          </>
        ) : (
          <>
            <p className="text-[13px] text-muted-foreground">
              Found {items.length}. Untick any you don&apos;t want and fix a category if it&apos;s off.
            </p>
            <ul className="divide-y rounded-xl border">
              {items.map((it, i) => (
                <li key={i} className={cn("flex items-start gap-3 px-3 py-2.5", !it.keep && "opacity-50")}>
                  <Checkbox className="mt-0.5" checked={it.keep} onCheckedChange={(v) => setItems((xs) => xs!.map((x, j) => (j === i ? { ...x, keep: !!v } : x)))} aria-label={`Import “${it.text}”`} />
                  <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5 sm:flex-row sm:gap-3">
                    <p className="w-full min-w-0 text-[13px] break-words sm:w-auto sm:flex-1">{it.text}</p>
                    <CategorySelect className="shrink-0" label={`Category for “${it.text.slice(0, 40)}”`} value={it.category} onChange={(c) => setItems((xs) => xs!.map((x, j) => (j === i ? { ...x, category: c } : x)))} />
                  </div>
                </li>
              ))}
            </ul>
            <div className="space-y-1.5">
              <Label htmlFor={ids.scope} className="text-[12px]">
                Keep them for
              </Label>
              <ScopeSelect id={ids.scope} value={scope} onChange={setScope} projects={projects} />
            </div>
          </>
        )}
      </div>
      <DialogFooter className="mx-0 mb-0 border-t px-5 py-3">
        {items ? (
          <>
            <Button variant="ghost" onClick={() => setItems(null)}>
              Back
            </Button>
            <Button onClick={() => void save()} disabled={busy || !kept.length}>
              {busy && <Loader2 className="animate-spin" />} Import {kept.length}
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onDone}>
              Cancel
            </Button>
            <Button onClick={preview} disabled={!text.trim()}>
              Preview
            </Button>
          </>
        )}
      </DialogFooter>
    </div>
  );
}
