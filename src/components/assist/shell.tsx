"use client";

import { Brain, CalendarClock, ChevronRight, FolderPlus, MessageSquarePlus, MessagesSquare, PanelLeftClose, PanelLeftOpen, Search, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useDeferredValue, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useHydrated, useIsGuest, useIsOwner } from "@/lib/api";
import { CharacterFace } from "@/components/chat/character-face";
import { useChatThreads } from "@/components/chat/hooks";
import { TalkMenu } from "@/components/chat/talk-menu";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChatMenu } from "./chat-menu";
import { useChats, useProjects } from "./hooks";
import { ProjectDialog } from "./project-dialog";
import { ProjectDot } from "./project-dot";

/**
 * Chat's workspace sidebar: New chat, Search, Skills, Memory, Scheduled, Projects and every chat (talking and making).
 * A column from lg (1024 px) up; below that the same list opens as a sheet from the header button.
 */

/** Whether the sidebar is folded to a strip (remembered in this browser; open until the page has read it). */
const RAIL_KEY = "fuobe:chat-rail";
const railListeners = new Set<() => void>();
const readFolded = () => {
  try {
    return window.localStorage.getItem(RAIL_KEY) === "folded";
  } catch {
    return false;
  }
};
function setFolded(folded: boolean) {
  try {
    window.localStorage.setItem(RAIL_KEY, folded ? "folded" : "open");
  } catch {
    // Storage off (a private window): it folds for this visit only.
  }
  railListeners.forEach((l) => l());
}
const useFolded = () =>
  useSyncExternalStore(
    (cb) => {
      railListeners.add(cb);
      return () => railListeners.delete(cb);
    },
    readFolded,
    () => false,
  );

export function AssistShell({ children }: { children: React.ReactNode }) {
  const folded = useFolded();
  return (
    <div className="flex min-w-0 flex-1">
      {folded ? (
        <aside className="sticky top-chrome hidden h-content w-14 shrink-0 flex-col items-center gap-1 border-r bg-sidebar/40 py-3 lg:flex" aria-label="Chat">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={() => setFolded(false)} aria-label="Open the sidebar">
                <PanelLeftOpen />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Open the sidebar</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" asChild aria-label="New chat">
                <Link href="/chat">
                  <MessageSquarePlus />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">New chat</TooltipContent>
          </Tooltip>
        </aside>
      ) : (
        <aside className="sticky top-chrome hidden h-content w-64 shrink-0 flex-col border-r bg-sidebar/40 lg:flex" aria-label="Chat">
          <Suspense fallback={<RailSkeleton />}>
            <Rail onFold={() => setFolded(true)} />
          </Suspense>
        </aside>
      )}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** The header button that opens the sidebar below lg (1024 px). */
export function RailButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" className={cn("lg:hidden", className)} onClick={() => setOpen(true)} aria-label="Chats, projects, skills, memory and scheduled tasks">
            <MessagesSquare />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Chats, projects, skills, memory and scheduled tasks</TooltipContent>
      </Tooltip>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-[min(86vw,320px)] gap-0 p-0" aria-describedby={undefined} onOpenAutoFocus={(e) => e.preventDefault()}>
          <SheetTitle className="sr-only">Chat</SheetTitle>
          <SheetDescription className="sr-only">Chats, projects, skills, memory and scheduled tasks</SheetDescription>
          <Suspense fallback={<RailSkeleton />}>
            <Rail onNavigate={() => setOpen(false)} />
          </Suspense>
        </SheetContent>
      </Sheet>
    </>
  );
}

function RailSkeleton() {
  return (
    <div className="space-y-2 p-3">
      <Skeleton className="h-9 rounded-full" />
      <Skeleton className="h-8" />
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-7" />
      ))}
    </div>
  );
}

function RailLink({ href, icon: Icon, label, active, onNavigate }: { href: string; icon: typeof Brain; label: string; active: boolean; onNavigate?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn("flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors hover:bg-accent", active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")}
    >
      <Icon className="size-4" /> {label}
    </Link>
  );
}

export { ProjectDot };

function Rail({ onNavigate, onFold }: { onNavigate?: () => void; onFold?: () => void }) {
  const pathname = usePathname() ?? "";
  const params = useSearchParams();
  const router = useRouter();
  const current = params.get("c");
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim());
  const chats = useChats(q ? { q } : { project: "none" });
  const projects = useProjects();
  const [creating, setCreating] = useState(false);
  // A guest or an account (public sign-up): Assist's projects are the owner's.
  const owner = useIsOwner();
  // Talking chats (Chat's own) beside the making chats, newest first. A guest has none (and isn't asked).
  const hydrated = useHydrated();
  const guest = useIsGuest();
  const talks = useChatThreads(hydrated && !guest, q);
  const rows = [
    ...(talks.data?.items ?? []).map((t) => ({ kind: "talk" as const, id: t.id, title: t.title, updatedAt: t.updatedAt, href: `/chat/${t.id}`, talk: t })),
    ...(chats.data?.threads ?? []).map((t) => ({ kind: "make" as const, id: t.id, title: t.title, updatedAt: t.updatedAt, href: `/chat/make?c=${t.id}`, make: t })),
  ].sort((a, b) => b.updatedAt - a.updatedAt);
  const loading = chats.isLoading || (hydrated && !guest && talks.isLoading);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn("space-y-2 p-3 pb-2", onNavigate && "pt-12")}>
        <div className="flex items-center gap-1.5">
          <Button asChild variant="outline" className="h-9 min-w-0 flex-1 justify-start rounded-full">
            <Link href="/chat" onClick={onNavigate}>
              <MessageSquarePlus /> New chat
            </Link>
          </Button>
          {onFold && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="shrink-0 text-muted-foreground" onClick={onFold} aria-label="Fold the sidebar">
                  <PanelLeftClose />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Fold the sidebar</TooltipContent>
            </Tooltip>
          )}
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats" className="h-8 rounded-lg pr-7 pl-8 text-[13px]" />
          {query && (
            <button onClick={() => setQuery("")} className="absolute top-1/2 right-1.5 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground" aria-label="Clear search">
              <X className="size-3" />
            </button>
          )}
        </div>
        <nav className="space-y-0.5" aria-label="Chat pages">
          <RailLink href="/chat/skills" icon={Sparkles} label="Skills" active={pathname.startsWith("/chat/skills")} onNavigate={onNavigate} />
          <RailLink href="/chat/memory" icon={Brain} label="Memory" active={pathname.startsWith("/chat/memory")} onNavigate={onNavigate} />
          <RailLink href="/chat/scheduled" icon={CalendarClock} label="Scheduled" active={pathname.startsWith("/chat/scheduled")} onNavigate={onNavigate} />
        </nav>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {!q && (
          <section aria-labelledby="rail-projects" className="mb-4">
            <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
              <h2 id="rail-projects" className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                Projects
              </h2>
              {owner && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon-xs" onClick={() => setCreating(true)} aria-label="New project">
                      <FolderPlus />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>New project</TooltipContent>
                </Tooltip>
              )}
            </div>
            {projects.isLoading ? (
              <Skeleton className="mx-2.5 h-6" />
            ) : projects.data?.length ? (
              <ul className="space-y-0.5">
                {projects.data.map((p) => {
                  const active = pathname === `/chat/projects/${p.id}`;
                  return (
                    <li key={p.id}>
                      <Link
                        href={`/chat/projects/${p.id}`}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cn("flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-colors hover:bg-accent", active ? "bg-accent font-medium" : "text-foreground/85")}
                      >
                        <ProjectDot project={p} />
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        {p.chats > 0 && <span className="font-mono text-[11px] text-muted-foreground">{p.chats}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : owner ? (
              <button onClick={() => setCreating(true)} className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground">
                Group chats with shared instructions and sources →
              </button>
            ) : (
              <p className="px-2.5 py-1.5 text-[12px] text-muted-foreground">Projects group chats with shared instructions and sources.</p>
            )}
          </section>
        )}
        <section aria-labelledby="rail-chats">
          <h2 id="rail-chats" className="px-2.5 pt-2 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {q ? `Results for “${q}”` : "Chats"}
          </h2>
          {loading ? (
            <div className="space-y-1.5 px-2.5">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-6" />
              ))}
            </div>
          ) : rows.length ? (
            <ul className="space-y-0.5">
              {rows.map((row) => {
                if (row.kind === "talk") {
                  const t = row.talk;
                  const active = pathname === row.href;
                  return (
                    <li key={`talk-${t.id}`} className="group/chat relative">
                      <Link
                        href={row.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        className={cn("flex min-h-8 items-center gap-2 rounded-lg py-1.5 pr-8 pl-2.5 transition-colors hover:bg-accent", active && "bg-accent")}
                      >
                        {t.character && <CharacterFace name={t.character.name} accent={t.character.accent} portrait={t.character.portrait} className="size-5" />}
                        <span className="min-w-0 flex-1 truncate text-[13px]">{t.title}</span>
                      </Link>
                      <TalkMenu
                        chat={t}
                        className="absolute top-1/2 right-1 size-7 -translate-y-1/2 opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 sm:opacity-0 sm:group-hover/chat:opacity-100"
                      />
                    </li>
                  );
                }
                const t = row.make;
                const project = t.projectId ? projects.data?.find((p) => p.id === t.projectId) : undefined;
                return (
                  <li key={t.id} className="group/chat relative">
                    <Link
                      href={`/chat/make?c=${t.id}`}
                      onClick={onNavigate}
                      aria-current={t.id === current ? "page" : undefined}
                      className={cn("flex min-h-8 flex-col justify-center rounded-lg py-1.5 pr-8 pl-2.5 transition-colors hover:bg-accent", t.id === current && "bg-accent")}
                    >
                      <span className="truncate text-[13px]">{t.title}</span>
                      {(q || t.status !== "idle") && (
                        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          {project && <ProjectDot project={project} className="size-1.5" />}
                          {project ? `${project.name} · ` : ""}
                          {t.status === "running" ? "Working…" : t.status === "waiting" ? "Waiting for you" : timeAgo(t.updatedAt)}
                        </span>
                      )}
                    </Link>
                    <ChatMenu
                      chat={t}
                      onDeleted={() => t.id === current && router.replace("/chat/make", { scroll: false })}
                      className="absolute top-1/2 right-1 size-7 -translate-y-1/2 opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 sm:opacity-0 sm:group-hover/chat:opacity-100"
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-2.5 py-2 text-[12px] text-muted-foreground">{q ? "No chats match." : "Your chats will show up here."}</p>
          )}
        </section>
        {!q && <ArchivedChats enabled={hydrated && !guest} onNavigate={onNavigate} pathname={pathname} />}
      </div>
      <ProjectDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(p) => {
          onNavigate?.();
          router.push(`/chat/projects/${p.id}`);
        }}
      />
    </div>
  );
}

/** The chats the person archived: folded away under the list, one tap to see them, each with its menu to bring it back. */
function ArchivedChats({ enabled, onNavigate, pathname }: { enabled: boolean; onNavigate?: () => void; pathname: string }) {
  const [open, setOpen] = useState(false);
  const archived = useChatThreads(enabled, "", true);
  const items = archived.data?.items ?? [];
  if (!items.length) return null;
  return (
    <section aria-labelledby="rail-archived" className="mt-4">
      <button
        id="rail-archived"
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-lg px-2.5 pt-2 pb-1 text-left text-[11px] font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground"
      >
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
        Archived · {items.length}
      </button>
      {open && (
        <ul className="space-y-0.5">
          {items.map((t) => {
            const href = `/chat/${t.id}`;
            const active = pathname === href;
            return (
              <li key={t.id} className="group/chat relative">
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn("flex min-h-8 items-center gap-2 rounded-lg py-1.5 pr-8 pl-2.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground", active && "bg-accent text-foreground")}
                >
                  {t.character && <CharacterFace name={t.character.name} accent={t.character.accent} portrait={t.character.portrait} className="size-5 opacity-80" />}
                  <span className="min-w-0 flex-1 truncate text-[13px]">{t.title}</span>
                </Link>
                <TalkMenu
                  chat={t}
                  className="absolute top-1/2 right-1 size-7 -translate-y-1/2 opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 sm:opacity-0 sm:group-hover/chat:opacity-100"
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
