"use client";

import {
  AlertTriangle,
  AtSign,
  AudioLines,
  FileText,
  ImageIcon,
  Link2,
  Loader2,
  MoreHorizontal,
  NotebookPen,
  Paperclip,
  RotateCw,
  Settings2,
  Trash2,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { ErrorState, NotFoundState } from "@/components/empty-state";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PhoneNavButton } from "@/components/nav/phone-nav-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PlaceholderChip } from "@/components/demo-mode";
import { MediaThumb } from "@/components/studio/feed";
import { Viewer } from "@/components/studio/viewer";
import { AssistComposer } from "@/components/assist/composer";
import { chatSkills, NewChatControls, SkillStarters } from "@/components/assist-view";
import { useElements, useEngine } from "@/lib/api";
import { MAX_PROJECT_SOURCES, type AssistProject, type ProjectSource, type SourceKind } from "@/lib/assist";
import { isPlaceholder, PLACEHOLDER_CHIP } from "@/lib/demo-mode";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { ChatMenu } from "./chat-menu";
import { useChatActions, useChats, useProject, useProjectActions, useProjectAssets, useSkills } from "./hooks";
import { MemoryView } from "./memory-view";
import { useModeChoice } from "./mode-picker";
import { ProjectDialog } from "./project-dialog";
import { ScheduledView } from "./scheduled-view";
import { ProjectDot, RailButton } from "./shell";

const SOURCE_ICON: Record<SourceKind, typeof FileText> = { link: Link2, file: FileText, image: ImageIcon, video: Video, audio: AudioLines, element: AtSign, text: NotebookPen };

/** A project's home (Supercomputer's Projects): its composer, chats, sources, memory and settings. */
export function ProjectView({ id }: { id: string }) {
  const project = useProject(id);
  if (project.isLoading)
    return (
      <div className="mx-auto max-w-[760px] space-y-4 px-4 pt-[14vh]">
        <Skeleton className="mx-auto h-10 w-2/3" />
        <Skeleton className="h-28 rounded-composer" />
      </div>
    );
  if (!project.data) {
    const status = (project.error as { status?: number } | null)?.status;
    if (project.error && status !== 404) return <ErrorState error={project.error} retry={() => void project.refetch()} />;
    return <NotFoundState title="No such project">It may have been deleted. Its chats are with your other chats in Assist.</NotFoundState>;
  }
  return <Project p={project.data} />;
}

function Project({ p }: { p: AssistProject }) {
  const router = useRouter();
  const [engine, setEngine] = useEngine();
  const [askFirst, setAskFirst] = useState(true);
  const chats = useChats({ project: p.id });
  const can = chats.data?.availability;
  const [choice, setChoice] = useModeChoice(can?.defaultMode);
  const actions = useChatActions();
  const projectActions = useProjectActions();
  const skills = useSkills();
  const available = chatSkills(skills.data, p);
  const [settings, setSettings] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [draft, setDraft] = useState({ key: 0, text: "" });
  const [tab, setTab] = useState("chats");

  return (
    <div className="flex min-h-content min-w-0 flex-col">
      <header className="max-md:sticky top-chrome z-20 flex h-14 items-center gap-1.5 bg-background/85 px-4 backdrop-blur sm:px-6">
        <RailButton />
        <ProjectDot project={p} className="ml-1" />
        <h1 className="min-w-0 truncate font-heading text-[22px] leading-none">{p.name}</h1>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setSettings(true)} aria-label="Project settings">
            <Settings2 /> <span className="hidden sm:inline">Settings</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirm(true)}>
                <Trash2 /> Delete project
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <PhoneNavButton />
      </header>
      <div className="mx-auto w-full max-w-[860px] min-w-0 flex-1 px-4 pb-16 sm:px-6">
        <div className="mx-auto max-w-[760px] pt-[6vh] sm:pt-[9vh]">
          <h2 className="text-center font-heading text-display text-balance">What are we creating in {p.name}?</h2>
          <button onClick={() => setSettings(true)} className="mx-auto mt-2 block max-w-xl text-center text-[14px] text-pretty text-muted-foreground hover:text-foreground">
            {p.instructions ? <span className="line-clamp-2">{p.instructions}</span> : "Add instructions so every chat here knows the brief →"}
          </button>
          <div className="mt-6">
            <AssistComposer
              key={draft.key}
              initialText={draft.text}
              skills={available}
              placeholder="Describe the job — chats here follow the project's instructions and can use its sources"
              onSend={async (text, attachments) => {
                const t = await actions.start({ text, attachments, engine, autoApprove: !askFirst, projectId: p.id, mode: choice ?? undefined });
                if (t.note) toast(t.note);
                router.push(`/assist?c=${t.id}`);
              }}
              footer={<NewChatControls choice={choice} setChoice={setChoice} can={can} engine={engine} setEngine={setEngine} askFirst={askFirst} setAskFirst={setAskFirst} />}
            />
            {!chats.data?.threads.length && <SkillStarters skills={available} loading={skills.data === undefined && !skills.isError} onPick={(s) => setDraft((d) => ({ key: d.key + 1, text: `/${s.name} ` }))} />}
          </div>
        </div>
        <Tabs value={tab} onValueChange={setTab} className="mt-10 gap-4">
          {/* Five tabs are wider than a phone: the row scrolls by itself, not the page. */}
          <TabsList className="max-w-full justify-start overflow-x-auto scrollbar-none">
            <TabsTrigger value="chats" className="px-3">
              Chats <span className="font-mono text-[11px] text-muted-foreground">{chats.data?.threads.length || ""}</span>
            </TabsTrigger>
            <TabsTrigger value="assets" className="px-3">
              Assets
            </TabsTrigger>
            <TabsTrigger value="sources" className="px-3">
              Sources <span className="font-mono text-[11px] text-muted-foreground">{p.sources.length || ""}</span>
            </TabsTrigger>
            <TabsTrigger value="memory" className="px-3">
              Memory
            </TabsTrigger>
            <TabsTrigger value="scheduled" className="px-3">
              Scheduled
            </TabsTrigger>
          </TabsList>
          <TabsContent value="chats">
            {chats.isLoading ? (
              <Skeleton className="h-24 rounded-2xl" />
            ) : chats.data?.threads.length ? (
              <ul className="divide-y rounded-2xl border bg-background">
                {chats.data.threads.map((t) => (
                  <li key={t.id} className="relative">
                    <Link href={`/assist?c=${t.id}`} className="flex items-center gap-3 py-3 pr-12 pl-4 transition-colors hover:bg-accent">
                      <span className="min-w-0 flex-1 truncate text-[14px]">{t.title}</span>
                      <span className="shrink-0 text-[12px] text-muted-foreground">{t.status === "running" ? "Working…" : t.status === "waiting" ? "Waiting for you" : timeAgo(t.updatedAt)}</span>
                    </Link>
                    <ChatMenu chat={t} className="absolute top-1/2 right-2 -translate-y-1/2" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-2xl border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">No chats yet — start one above. It&apos;ll know this project&apos;s instructions and sources.</p>
            )}
          </TabsContent>
          <TabsContent value="assets">
            <Assets p={p} active={tab === "assets"} />
          </TabsContent>
          <TabsContent value="sources">
            <Sources p={p} />
          </TabsContent>
          <TabsContent value="memory" className="-mx-4 sm:-mx-6">
            <MemoryView projectId={p.id} />
          </TabsContent>
          <TabsContent value="scheduled" className="-mx-4 sm:-mx-6">
            <ScheduledView projectId={p.id} />
          </TabsContent>
        </Tabs>
      </div>
      <ProjectDialog open={settings} onOpenChange={setSettings} project={p} />
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {p.name}?</AlertDialogTitle>
            <AlertDialogDescription>Its instructions, sources and project memory are deleted. Its {p.chats || ""} chat{p.chats === 1 ? "" : "s"} move to your other chats, and everything they made stays in your Library.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                try {
                  await projectActions.remove(p.id);
                  toast("Project deleted", { duration: 1500 });
                  router.push("/assist");
                } catch (e) {
                  toastError(e);
                }
              }}
            >
              Delete project
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** What the project's chats made: their finished results, newest first, opening in the viewer. */
function Assets({ p, active }: { p: AssistProject; active: boolean }) {
  const assets = useProjectAssets(p.id, active);
  const [open, setOpen] = useState<{ at: number; i: number } | null>(null);
  const list = assets.data ?? [];
  const tiles = list.flatMap((a, at) => a.generation.outputs.map((o, i) => ({ a, at, o, i })));
  if (assets.isLoading)
    return (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="aspect-square rounded-xl" />
        ))}
      </div>
    );
  if (assets.isError) return <p className="rounded-2xl border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">Couldn&apos;t load the assets: {(assets.error as Error).message}</p>;
  if (!tiles.length) return <p className="rounded-2xl border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">Nothing made here yet — what this project&apos;s chats create shows up here.</p>;
  const cur = open ? list[open.at] : null;
  return (
    <>
      <p className="mb-3 text-[13px] text-muted-foreground">
        {tiles.length} result{tiles.length === 1 ? "" : "s"} from this project&apos;s chats. Everything is in your Library too.
      </p>
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {tiles.map(({ a, at, o, i }) => (
          <li key={`${a.generation.id}-${i}`} className="relative">
            <button onClick={() => setOpen({ at, i })} className="group relative block aspect-square w-full overflow-hidden rounded-xl bg-muted" aria-label={`Open ${a.generation.request.prompt?.slice(0, 60) || "result"} (from ${a.chatTitle})`}>
              <MediaThumb output={o} g={a.generation} className="transition duration-300 group-hover:scale-[1.03]" tag={isPlaceholder(a.generation) && o.kind === "text" ? PLACEHOLDER_CHIP : undefined} />
            </button>
            {/* Beside the tile, not in it (a button can't hold the chip's own button): the ways to the real thing. */}
            {o.kind !== "text" && <PlaceholderChip g={a.generation} overlay className="absolute top-1.5" />}
          </li>
        ))}
      </ul>
      {open && cur && (
        <Viewer
          generation={cur.generation}
          index={open.i}
          onClose={() => setOpen(null)}
          onPrev={open.at > 0 ? () => setOpen({ at: open.at - 1, i: 0 }) : undefined}
          onNext={open.at < list.length - 1 ? () => setOpen({ at: open.at + 1, i: 0 }) : undefined}
        />
      )}
    </>
  );
}

function Sources({ p }: { p: AssistProject }) {
  const actions = useProjectActions();
  const elements = useElements();
  const file = useRef<HTMLInputElement>(null);
  const linkId = useId();
  const [link, setLink] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const full = p.sources.length >= MAX_PROJECT_SOURCES;

  const run = async (what: string, fn: () => Promise<ProjectSource>) => {
    setBusy(what);
    try {
      const s = await fn();
      if (s.status === "error") toast.warning(`Added ${s.title}, but Assist can't read it`, { description: s.error });
      else toast.success(`Added ${s.title}`, { duration: 1500 });
      return true;
    } catch (e) {
      toastError(e);
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[13px] text-pretty text-muted-foreground">
        {p.sources.length} of {MAX_PROJECT_SOURCES} sources. Assist sees the list in every chat here and reads a source when it needs it.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Popover open={linkOpen} onOpenChange={setLinkOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" disabled={full || !!busy}>
              {busy === "link" ? <Loader2 className="animate-spin" /> : <Link2 />} Link
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" collisionPadding={12} className="w-[min(92vw,380px)]">
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!link.trim()) return;
                if (await run("link", () => actions.addSource(p.id, { kind: "link", url: /^https?:\/\//i.test(link.trim()) ? link.trim() : `https://${link.trim()}` }))) {
                  setLink("");
                  setLinkOpen(false);
                }
              }}
              className="space-y-2"
            >
              <Label htmlFor={linkId}>Add a web page</Label>
              <Input id={linkId} value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://yourbrand.com/about" autoFocus />
              <p className="text-[12px] text-muted-foreground">Fuobe reads the page&apos;s text now; you can refresh it later.</p>
              <Button type="submit" size="sm" className="w-full" disabled={!link.trim() || busy === "link"}>
                {busy === "link" && <Loader2 className="animate-spin" />} Add link
              </Button>
            </form>
          </PopoverContent>
        </Popover>
        <input
          ref={file}
          type="file"
          hidden
          accept=".txt,.md,.markdown,.csv,.json,.srt,.vtt,.yaml,.yml,.pdf,image/*,video/*,audio/*"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void run("file", () => actions.addFile(p.id, f));
          }}
        />
        <Button variant="outline" size="sm" disabled={full || !!busy} onClick={() => file.current?.click()}>
          {busy === "file" ? <Loader2 className="animate-spin" /> : <Paperclip />} File
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" disabled={full || !!busy}>
              <AtSign /> Element
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" collisionPadding={12} className="w-[min(92vw,320px)] p-1.5">
            {elements.data?.length ? (
              <ul className="max-h-72 overflow-y-auto">
                {elements.data.map((el) => (
                  <li key={el.id}>
                    <button
                      onClick={() => void run("element", () => actions.addSource(p.id, { kind: "element", elementId: el.id }))}
                      disabled={p.sources.some((s) => s.elementId === el.id)}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent disabled:opacity-50"
                    >
                      {el.references[0] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={el.references[0]} alt="" className="size-8 shrink-0 rounded-md object-cover" />
                      ) : (
                        <span className="grid size-8 place-items-center rounded-md bg-muted">
                          <AtSign className="size-4" />
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium">{el.name}</span>
                        <span className="block truncate font-mono text-[11px] text-muted-foreground">@{el.handle}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 py-4 text-center text-[13px] text-muted-foreground">
                No elements yet —{" "}
                <Link href="/elements" className="text-brand-text underline underline-offset-2">
                  save a character or product
                </Link>
                .
              </p>
            )}
          </PopoverContent>
        </Popover>
        <Button variant="outline" size="sm" disabled={full || !!busy} onClick={() => setNoteOpen(true)}>
          <NotebookPen /> Note
        </Button>
      </div>
      {p.sources.length ? (
        <ul className="divide-y rounded-2xl border bg-background">
          {p.sources.map((s) => (
            <SourceRow key={s.id} s={s} projectId={p.id} />
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed px-4 py-8 text-center text-[13px] text-pretty text-muted-foreground">
          Add up to {MAX_PROJECT_SOURCES} sources — your website, a brand guide, a script, product photos, saved characters — and every chat here can use them.
        </p>
      )}
      <NoteDialog open={noteOpen} onOpenChange={setNoteOpen} onSave={(title, text) => run("note", () => actions.addSource(p.id, { kind: "text", title, text }))} />
    </div>
  );
}

function SourceRow({ s, projectId }: { s: ProjectSource; projectId: string }) {
  const actions = useProjectActions();
  const [busy, setBusy] = useState(false);
  const Icon = SOURCE_ICON[s.kind];
  const media = s.kind === "image" && s.url;
  return (
    <li className="group/src flex items-start gap-3 px-4 py-3">
      {media ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={s.url} alt="" className="size-9 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary">
          <Icon className="size-4" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-medium">{s.title}</p>
        {s.status === "error" ? (
          <p className="mt-0.5 flex items-start gap-1 text-[12px] text-warning">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {s.error}
          </p>
        ) : (
          <p className="mt-0.5 line-clamp-2 text-[12px] break-words text-muted-foreground">
            {s.kind === "link" && s.url ? `${new URL(s.url).hostname} · ` : ""}
            {s.excerpt ?? (s.kind === "video" || s.kind === "audio" || s.kind === "image" ? "Assist can pass it to models as an input" : "")}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/src:opacity-100 sm:group-focus-within/src:opacity-100">
        {s.kind === "link" && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Fetch ${s.title} again`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await actions.refreshSource(projectId, s.id);
                toast(r.status === "ready" ? "Updated" : "Still can't read it", { duration: 1500 });
              } catch (e) {
                toastError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            <RotateCw className={cn(busy && "animate-spin")} />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" className="hover:text-destructive" aria-label={`Remove ${s.title}`} onClick={() => void actions.removeSource(projectId, s.id).catch((e) => toastError(e))}>
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}

function NoteDialog({ open, onOpenChange, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; onSave: (title: string, text: string) => Promise<boolean> }) {
  const ids = { title: useId(), text: useId() };
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const ok = await onSave(title, text);
            setBusy(false);
            if (ok) {
              setTitle("");
              setText("");
              onOpenChange(false);
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="font-heading text-[24px] font-normal">Add a note</DialogTitle>
            <DialogDescription>A brief, a script, brand rules — any text the project&apos;s chats should know.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={ids.title}>Title</Label>
            <Input id={ids.title} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="e.g. Brand voice" />
          </div>
          <div className="space-y-2">
            <Label htmlFor={ids.text}>Text</Label>
            <Textarea id={ids.text} value={text} onChange={(e) => setText(e.target.value)} rows={8} maxLength={20_000} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !text.trim()}>
              {busy && <Loader2 className="animate-spin" />} Add note
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
