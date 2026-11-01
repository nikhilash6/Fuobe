"use client";

import { AlertTriangle, ChevronDown, Copy, Download, FileUp, Loader2, MessageSquarePlus, Pencil, Play, Plus, Search, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useDeferredValue, useId, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useIsOwner, useIsVisitor } from "@/lib/api";
import { SKILL_LIMITS, SKILL_NAME_RE, skillSlug, type Skill, type SkillSummary } from "@/lib/assist";
import { cn } from "@/lib/utils";
import { refusalShown, toastError } from "@/lib/refusals";
import { radioKeys } from "@/components/studio/radio-keys";
import { useRecipe, useRecipeActions, useSkill, useSkillActions, useSkills, type RecipeFailure, type SkillForm } from "./hooks";
import { RunSkillDialog } from "./run-skill-dialog";
import { RailButton } from "./shell";
import { SKILL_ICONS, SkillIcon } from "./skill-icon";
import { AssistVisitorNote } from "./visitor-note";

/**
 * Skills (Supercomputer's Skills page): Built-in and My skills, each switchable; create one, upload
 * a .zip / .skill / SKILL.md, view, duplicate, download, edit and delete.
 */
export function SkillsView() {
  return (
    <Suspense fallback={null}>
      <Skills />
    </Suspense>
  );
}

function Skills() {
  const skills = useSkills();
  const actions = useSkillActions();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // A guest or an account (public sign-up) reads the built-in skills; making, switching and running them are the owner's.
  const visitor = useIsVisitor();
  const owner = useIsOwner();
  // ?run=<name>: the skill's Run form (a deep link, ⌘K's "Run …", the skill's Run… button); a visitor gets the skill itself.
  const viewing = params.get("skill") ?? (visitor ? params.get("run") : null);
  const running = owner ? params.get("run") : null;
  const [tab, setTab] = useState<"builtin" | "user">("builtin");
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim().toLowerCase());
  const [editing, setEditing] = useState<Skill | "new" | null>(null);
  const [conflict, setConflict] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const all = skills.data ?? [];
  const builtin = all.filter((s) => s.source === "builtin");
  const own = all.filter((s) => s.source === "user");
  const filter = (list: SkillSummary[]) => (q ? list.filter((s) => `${s.name} ${s.title} ${s.description} ${s.whenToUse} ${(s.tags ?? []).join(" ")}`.toLowerCase().includes(q)) : list);
  const open = (name: string | null) => router.replace(name ? `${pathname}?skill=${name}` : pathname, { scroll: false });
  // The Run form opened from a skill's dialog goes back to it when it closes.
  const runFrom = useRef<string | null>(null);
  const run = (name: string, from: string | null = null) => {
    runFrom.current = from;
    router.replace(`${pathname}?run=${name}`, { scroll: false });
  };

  const toggle = (s: SkillSummary, on: boolean) => void actions.toggle(s.name, on).catch((e) => toastError(e));

  const upload = async (f: File, replace = false) => {
    setUploading(true);
    try {
      const r = await actions.upload(f, replace);
      setTab("user");
      toast.success(`${r.replaced ? "Updated" : "Added"} /${r.skill.name}`, {
        description: r.skipped.length ? `Left out ${r.skipped.length} file${r.skipped.length > 1 ? "s" : ""} that aren't text: ${r.skipped.slice(0, 3).join(", ")}${r.skipped.length > 3 ? "…" : ""}` : undefined,
        action: { label: "Open", onClick: () => open(r.skill.name) },
      });
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 409 && /You already have/.test(err.message)) setConflict(f);
      else if (!refusalShown(err)) toast.error(err.message, { duration: 8000 });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex min-h-svh min-w-0 flex-col">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-1.5 bg-background/85 px-3 backdrop-blur sm:px-6">
        <SidebarTrigger className="md:hidden" />
        <RailButton />
        <h1 className="font-heading text-[22px] leading-none">Skills</h1>
        {owner && (
          <div className="ml-auto flex items-center gap-1.5">
            <input
              ref={file}
              type="file"
              accept=".zip,.skill,.md,text/markdown,application/zip"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void upload(f);
              }}
            />
            <Button variant="outline" size="sm" onClick={() => file.current?.click()} disabled={uploading} aria-label="Upload a skill">
              {uploading ? <Loader2 className="animate-spin" /> : <Upload />} <span className="hidden sm:inline">Upload</span>
            </Button>
            <Button size="sm" onClick={() => setEditing("new")}>
              <Plus /> <span className="hidden sm:inline">Create skill</span>
              <span className="sm:hidden">New</span>
            </Button>
          </div>
        )}
      </header>
      <div className="mx-auto w-full max-w-[1100px] min-w-0 flex-1 px-3 pt-4 pb-16 sm:px-6 md:pt-8">
        <p className="max-w-2xl text-[15px] text-pretty text-muted-foreground">
          Playbooks Assist loads for whole kinds of jobs. Type <span className="rounded bg-muted px-1 font-mono text-[13px]">/name</span> at the start of a message to use one, or let Assist pick it. Skills also reach other agents through Fuobe&apos;s MCP server.
        </p>
        <AssistVisitorNote className="mt-4 max-w-2xl" />
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="mt-6 gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <TabsList>
              <TabsTrigger value="builtin" className="px-3">
                Built-in <span className="font-mono text-[11px] text-muted-foreground">{builtin.length || ""}</span>
              </TabsTrigger>
              <TabsTrigger value="user" className="px-3">
                My skills <span className="font-mono text-[11px] text-muted-foreground">{own.length || ""}</span>
              </TabsTrigger>
            </TabsList>
            <div className="relative ml-auto w-full sm:w-64">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search skills" aria-label="Search skills" className="h-8 rounded-full pl-8" />
            </div>
          </div>
          <TabsContent value="builtin">
            <SkillGrid loading={skills.isLoading} list={filter(builtin)} onOpen={open} onToggle={owner ? toggle : undefined} empty={<NoMatch onClear={() => setQuery("")} />} />
          </TabsContent>
          <TabsContent value="user">
            <SkillGrid
              loading={skills.isLoading}
              list={filter(own)}
              onOpen={open}
              onToggle={owner ? toggle : undefined}
              empty={
                q ? (
                  <NoMatch onClear={() => setQuery("")} />
                ) : (
                  <Empty className="border py-14">
                    <EmptyHeader>
                      <EmptyTitle className="font-heading text-[22px] font-normal">No skills of your own yet</EmptyTitle>
                      <EmptyDescription>Save a prompt or workflow you repeat as a skill, or upload one — a .zip or .skill archive, or a single SKILL.md.</EmptyDescription>
                    </EmptyHeader>
                    {owner && (
                      <EmptyContent className="flex-row justify-center">
                        <Button variant="outline" onClick={() => file.current?.click()}>
                          <FileUp /> Upload
                        </Button>
                        <Button onClick={() => setEditing("new")}>
                          <Plus /> Create skill
                        </Button>
                      </EmptyContent>
                    )}
                  </Empty>
                )
              }
            />
          </TabsContent>
        </Tabs>
      </div>
      <SkillDetail name={viewing} owner={owner} onClose={() => open(null)} onEdit={(s) => (open(null), setEditing(s))} onRun={(name) => run(name, name)} />
      <RunSkillDialog
        name={running}
        onClose={() => {
          const back = runFrom.current;
          runFrom.current = null;
          open(back);
        }}
      />
      <SkillEditor
        skill={editing}
        onClose={() => setEditing(null)}
        onSaved={(s) => {
          setTab("user");
          open(s.name);
        }}
      />
      <AlertDialog open={!!conflict} onOpenChange={(o) => !o && setConflict(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace your skill?</AlertDialogTitle>
            <AlertDialogDescription>You already have a skill with this name. Uploading replaces its instructions and files.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep mine</AlertDialogCancel>
            <AlertDialogAction onClick={() => conflict && void upload(conflict, true)}>Replace</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function NoMatch({ onClear }: { onClear: () => void }) {
  return (
    <div className="rounded-xl border border-dashed py-12 text-center">
      <p className="text-[14px] text-muted-foreground">No skills match.</p>
      <Button variant="link" onClick={onClear}>
        Clear the search
      </Button>
    </div>
  );
}

/** `onToggle`: each card's on/off switch (left out for a visitor, who can't switch the owner's skills). */
function SkillGrid({ list, loading, onOpen, onToggle, empty }: { list: SkillSummary[]; loading: boolean; onOpen: (name: string) => void; onToggle?: (s: SkillSummary, on: boolean) => void; empty: React.ReactNode }) {
  if (loading)
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-36 rounded-2xl" />
        ))}
      </div>
    );
  if (!list.length) return <>{empty}</>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((s) => (
        <li key={s.name} className={cn("group/skill relative flex min-w-0 flex-col rounded-2xl border bg-background p-4 transition hover:border-border-strong hover:shadow-soft", !s.enabled && "opacity-70")}>
          <div className="flex items-start gap-3">
            <SkillIcon name={s.name} icon={s.icon} />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[14px] font-medium">
                <button onClick={() => onOpen(s.name)} className="block w-full truncate text-left after:absolute after:inset-0 after:rounded-2xl outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring">
                  {s.title}
                </button>
              </h2>
              <p className="truncate font-mono text-[11px] text-muted-foreground">/{s.name}</p>
            </div>
            {onToggle && <Switch size="sm" checked={s.enabled} onCheckedChange={(v) => onToggle(s, v)} aria-label={`${s.enabled ? "Switch off" : "Switch on"} ${s.title}`} className="relative z-10" />}
          </div>
          <p className="mt-3 line-clamp-3 text-[13px] text-muted-foreground">{s.description}</p>
          {(s.recipe || s.files.length > 0) && (
            <div className="mt-auto flex flex-wrap items-center gap-2 pt-3 text-[11px] text-muted-foreground">
              {s.recipe && (
                <span className="inline-flex h-5 items-center gap-1 rounded-full bg-brand-faint px-2 font-medium text-brand-text">
                  <Play className="size-3" aria-hidden /> Runs by itself
                </span>
              )}
              {s.files.length > 0 && (
                <span>
                  + {s.files.length} file{s.files.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Under a recipe skill's description: where it was checked ("Checked 29 Oct · Cloud ✓ · GPU not checked"), or in amber
 * why it needs a re-check, with Re-check (the plan and the free dry run).
 */
function RecipeStatus({ skill }: { skill: Skill }) {
  const recipe = useRecipe(skill.name, !!skill.recipe);
  const actions = useRecipeActions();
  const [busy, setBusy] = useState(false);
  const v = recipe.data;
  if (!skill.recipe || !v) return null;
  const recheck = Object.values(v.recheck).flat();
  const recheckNow = async () => {
    setBusy(true);
    try {
      const r = await actions.verify(skill.name);
      if (r.ok) toast.success("Checked — it still runs", { description: "Priced, and run once on the demo provider for free." });
      else toast.error("The check didn't pass", { description: r.engines.flatMap((e) => [...e.plan.errors, ...(e.dryRun?.problems ?? [])])[0] });
    } catch (e) {
      const f = e as RecipeFailure;
      if (!refusalShown(f)) toast.error(f.message, { description: f.problems?.slice(1).join("; ") || undefined });
    } finally {
      setBusy(false);
    }
  };
  const canCheck = skill.source === "user";
  return (
    <div className={cn("mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]", recheck.length || v.why ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
      {recheck.length || v.why ? <AlertTriangle className="size-3.5 shrink-0" aria-hidden /> : <ShieldCheck className="size-3.5 shrink-0" aria-hidden />}
      <span className="min-w-0 break-words">{v.why ?? (recheck.length ? `Needs a re-check: ${recheck[0]}` : v.line)}</span>
      {canCheck && !v.why && (recheck.length > 0 || !v.ready.length) && (
        <Button variant="outline" size="xs" className="h-6 rounded-full px-2 text-[12px]" onClick={() => void recheckNow()} disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} {v.ready.length ? "Re-check" : "Check it (free)"}
        </Button>
      )}
    </div>
  );
}

/** `owner`: the studio's owner (a visitor reads and downloads a skill; copying, editing, using and running it are the owner's). */
function SkillDetail({ name, owner, onClose, onEdit, onRun }: { name: string | null; owner: boolean; onClose: () => void; onEdit: (s: Skill) => void; onRun: (name: string) => void }) {
  const skill = useSkill(name);
  const actions = useSkillActions();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const s = skill.data;
  return (
    <Dialog open={!!name} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[min(92svh,860px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[760px]">
        {!s ? (
          <div className="space-y-3 p-6">
            <DialogTitle className="sr-only">Skill</DialogTitle>
            {skill.isError ? (
              <p className="text-[14px] text-muted-foreground">{(skill.error as { status?: number } | null)?.status === 404 ? "This skill doesn’t exist anymore." : skill.error?.message}</p>
            ) : (
              <Skeleton className="h-40" />
            )}
          </div>
        ) : (
          <>
            <DialogHeader className="flex-row items-start gap-3 border-b px-5 pt-5 pb-4 text-left">
              <SkillIcon name={s.name} icon={s.icon} size="lg" />
              <div className="min-w-0 flex-1">
                <DialogTitle className="font-heading text-[24px] leading-tight font-normal">{s.title}</DialogTitle>
                <DialogDescription className="mt-1">{s.description}</DialogDescription>
                <RecipeStatus skill={s} />
                <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                  /{s.name} · {s.source === "builtin" ? "Built-in" : "Yours"}
                  {s.studio && (
                    <>
                      {" · "}
                      <Link href={s.studio} className="text-brand-text underline underline-offset-2">
                        Open the studio
                      </Link>
                    </>
                  )}
                </p>
              </div>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {s.whenToUse && (
                <div className="mb-4 rounded-xl bg-muted/60 px-4 py-3 text-[13px]">
                  <p className="font-medium">When Assist uses it</p>
                  <p className="mt-0.5 text-muted-foreground">{s.whenToUse}</p>
                </div>
              )}
              <article className="prose-fuobe min-w-0 text-[14px] break-words">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.body}</ReactMarkdown>
              </article>
              {s.files.length > 0 && (
                <div className="mt-4 border-t pt-3">
                  <p className="text-[12px] font-medium">Files</p>
                  <ul className="mt-1 space-y-0.5 font-mono text-[12px] text-muted-foreground">
                    {s.files.map((f) => (
                      <li key={f.path}>
                        {f.path} <span className="text-muted-foreground">· {f.size < 1024 ? `${f.size} B` : `${(f.size / 1024).toFixed(1)} KB`}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <DialogFooter className="mx-0 mb-0 flex-row flex-wrap items-center gap-2 border-t px-5 py-3 sm:justify-between">
              <div className="flex flex-wrap gap-1.5">
                {s.files.length > 0 ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <Download /> Download <ChevronDown className="opacity-60" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-56">
                      <DropdownMenuItem asChild>
                        <a href={`/api/assist/skills/${s.name}/download`} download>
                          SKILL.md
                        </a>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <a href={`/api/assist/skills/${s.name}/download?format=zip`} download>
                          Skill with its files (.zip)
                        </a>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Button variant="ghost" size="sm" asChild>
                    <a href={`/api/assist/skills/${s.name}/download`} download>
                      <Download /> SKILL.md
                    </a>
                  </Button>
                )}
                {owner && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      try {
                        const c = await actions.duplicate(s.name);
                        toast.success(`Copied as /${c.name}`, { duration: 2000 });
                        onEdit(c);
                      } catch (e) {
                        toastError(e);
                      }
                    }}
                  >
                    <Copy /> Duplicate
                  </Button>
                )}
                {owner && s.source === "user" && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => onEdit(s)}>
                      <Pencil /> Edit
                    </Button>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => setConfirm(true)}>
                      <Trash2 /> Delete
                    </Button>
                  </>
                )}
              </div>
              {!owner ? null : s.recipe ? (
                <div className="flex flex-wrap gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => router.push(`/assist?skill=${s.name}`)} disabled={!s.enabled}>
                    <MessageSquarePlus /> Use in a new chat
                  </Button>
                  <Button size="sm" onClick={() => onRun(s.name)} disabled={!s.enabled}>
                    <Play /> Run…
                  </Button>
                </div>
              ) : (
                <Button size="sm" onClick={() => router.push(`/assist?skill=${s.name}`)} disabled={!s.enabled}>
                  <MessageSquarePlus /> Use in a new chat
                </Button>
              )}
            </DialogFooter>
            <AlertDialog open={confirm} onOpenChange={setConfirm}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete /{s.name}?</AlertDialogTitle>
                  <AlertDialogDescription>Assist won&apos;t be able to use it anymore. This can&apos;t be undone — download the SKILL.md first if you might want it back.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={async () => {
                      try {
                        await actions.remove(s.name);
                        toast("Skill deleted", { duration: 1500 });
                        onClose();
                      } catch (e) {
                        toastError(e);
                      }
                    }}
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const ICON_CHOICES = Object.keys(SKILL_ICONS);

function SkillEditor({ skill, onClose, onSaved }: { skill: Skill | "new" | null; onClose: () => void; onSaved: (s: Skill) => void }) {
  return (
    <Dialog open={!!skill} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[min(94svh,900px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[680px]">
        {skill && <EditorForm key={skill === "new" ? "new" : skill.name} skill={skill === "new" ? null : skill} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function EditorForm({ skill, onClose, onSaved }: { skill: Skill | null; onClose: () => void; onSaved: (s: Skill) => void }) {
  const actions = useSkillActions();
  const ids = { title: useId(), name: useId(), description: useId(), when: useId(), body: useId() };
  const [form, setForm] = useState<SkillForm>({
    name: skill?.name ?? "",
    title: skill?.title ?? "",
    description: skill?.description ?? "",
    whenToUse: skill?.whenToUse ?? "",
    body: skill?.body ?? "",
    icon: skill?.icon ?? "wand",
  });
  const [nameTouched, setNameTouched] = useState(!!skill);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<SkillForm>) => setForm((f) => ({ ...f, ...patch }));
  const nameOk = SKILL_NAME_RE.test(form.name);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.title.trim() || !form.description.trim() || !form.body.trim()) return setError("Give the skill a title, a description and instructions.");
    if (!nameOk) return setError("The name can use lowercase letters, numbers and hyphens, e.g. product-photos.");
    setBusy(true);
    try {
      const s = skill ? await actions.update(skill.name, form) : await actions.create(form);
      toast.success(skill ? "Saved" : `Created /${s.name}`, { duration: 1500 });
      onClose();
      onSaved(s);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
      <DialogHeader className="border-b px-5 pt-5 pb-4">
        <DialogTitle className="font-heading text-[24px] font-normal">{skill ? `Edit ${skill.title}` : "Create a skill"}</DialogTitle>
        <DialogDescription>Save a reusable prompt or workflow. Assist reads the instructions whenever the skill is used.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <div className="space-y-2">
            <Label htmlFor={ids.title}>Title</Label>
            <Input
              id={ids.title}
              value={form.title}
              maxLength={SKILL_LIMITS.title}
              autoFocus
              placeholder="e.g. Recipe reels"
              onChange={(e) => set({ title: e.target.value, ...(!nameTouched && { name: skillSlug(e.target.value) }) })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={ids.name}>Name</Label>
            <div className="relative">
              <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 font-mono text-[13px] text-muted-foreground">/</span>
              <Input
                id={ids.name}
                value={form.name}
                maxLength={SKILL_LIMITS.name}
                aria-invalid={!!form.name && !nameOk}
                className="pl-5 font-mono text-[13px]"
                onChange={(e) => (setNameTouched(true), set({ name: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") }))}
              />
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor={ids.description}>What it does</Label>
          <Textarea id={ids.description} rows={2} value={form.description} maxLength={SKILL_LIMITS.description} placeholder="e.g. Turns a recipe into a 30-second vertical cooking reel with captions." onChange={(e) => set({ description: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={ids.when}>When Assist should use it</Label>
          <Textarea id={ids.when} rows={2} value={form.whenToUse} maxLength={SKILL_LIMITS.whenToUse} placeholder="e.g. The user shares a recipe or asks for a cooking video." onChange={(e) => set({ whenToUse: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={ids.body}>Instructions</Label>
          <p className="text-[12px] text-muted-foreground">Markdown. Steps, models to prefer, prompt templates, formats, checks — whatever you&apos;d tell a teammate.</p>
          <Textarea
            id={ids.body}
            rows={12}
            value={form.body}
            maxLength={SKILL_LIMITS.body}
            placeholder={"# Recipe reels\n\n1. Ask for the recipe if it isn't attached.\n2. Write a 30-second script…\n3. …"}
            className="min-h-64 font-mono text-[13px] leading-relaxed"
            onChange={(e) => set({ body: e.target.value })}
          />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Icon</legend>
          <div role="radiogroup" aria-label="Icon" onKeyDown={radioKeys} className="flex flex-wrap gap-1.5">
            {ICON_CHOICES.map((i, k) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={form.icon === i}
                aria-label={i}
                // One Tab stop: the picked icon, or the first while none is picked.
                tabIndex={form.icon === i || (k === 0 && !ICON_CHOICES.some((c) => c === form.icon)) ? 0 : -1}
                onClick={() => set({ icon: i })}
                className={cn("rounded-xl p-0.5 ring-offset-2 ring-offset-background", form.icon === i && "ring-2 ring-primary")}
              >
                <SkillIcon name={form.name || "new"} icon={i} size="sm" className="size-8" />
              </button>
            ))}
          </div>
        </fieldset>
        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            <X className="mt-0.5 size-3.5 shrink-0" /> {error}
          </p>
        )}
      </div>
      <DialogFooter className="mx-0 mb-0 border-t px-5 py-3">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2 className="animate-spin" />} {skill ? "Save" : "Create skill"}
        </Button>
      </DialogFooter>
    </form>
  );
}
