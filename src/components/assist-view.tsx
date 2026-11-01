"use client";

import { Bot, CalendarClock, Cpu, Loader2, MessageSquarePlus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EngineSwitch } from "@/components/studio/engine-switch";
import { Viewer } from "@/components/studio/viewer";
import { AssistComposer } from "@/components/assist/composer";
import { ChatMenu } from "@/components/assist/chat-menu";
import { useChatActions, useChats, useProjects, useSkills } from "@/components/assist/hooks";
import { ModePicker, useModeChoice } from "@/components/assist/mode-picker";
import { ScheduleDialog } from "@/components/assist/schedule-dialog";
import { ProjectDot, RailButton } from "@/components/assist/shell";
import { SkillIcon } from "@/components/assist/skill-icon";
import { Transcript } from "@/components/assist/transcript";
import { AssistVisitorNote } from "@/components/assist/visitor-note";
import { useAssistActions, useAssistThread, useEngine } from "@/lib/api";
import { ASSIST_SUGGESTIONS, assistDraft, modeLabel, threadModeChoice, type AssistAvailability, type AssistModeChoice, type AssistProject, type AssistThread, type SkillSummary } from "@/lib/assist";
import type { Generation } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";

/** Skills offered as one-tap starters on the empty page (Supercomputer's suggestion cards). */
const STARTER_SKILLS = ["product-photoshoot", "ugc-video", "thumbnail-generation", "faceless-video", "short-film", "localization"];

const AGENT_HINT: Record<AssistThread["agent"], string> = {
  claude: "Claude plans the shoot, picks models and runs them with your approval.",
  hosted: "Runs on a model from a provider you've connected (Settings → AI helper). It plans the shoot, picks models and runs them with your approval.",
  local: "Runs on your local model (Ollama, LM Studio or Unsloth Studio). Smaller local models follow instructions less reliably than Claude.",
  offline: "A simple rule-based planner. Add a key in Settings → AI helper (Anthropic, OpenAI, Google, OpenRouter…), or run a local model (Ollama, LM Studio or Unsloth Studio), for the full assistant that picks models, chains steps and checks results.",
};

export function AskFirst({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <label className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-full px-2.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground hover:bg-accent hover:text-foreground max-sm:gap-1.5 max-sm:px-1.5">
          <Switch size="sm" checked={checked} onCheckedChange={onChange} aria-label="Ask before generating" />
          Ask first
        </label>
      </TooltipTrigger>
      <TooltipContent>{checked ? "You approve each plan (and each memory) before anything runs" : "Plans run right away — no approval card"}</TooltipContent>
    </Tooltip>
  );
}

/** Usable skills for a chat: the project's own list when it has one, else every enabled skill. */
export function chatSkills(all: SkillSummary[] | undefined, project?: AssistProject | null): SkillSummary[] {
  if (!all) return [];
  if (project?.skills.length) return all.filter((s) => project.skills.includes(s.name));
  return all.filter((s) => s.enabled);
}

/** The composer's chips for a new chat: mode, engine, ask-first. */
export function NewChatControls({
  choice,
  setChoice,
  can,
  engine,
  setEngine,
  askFirst,
  setAskFirst,
}: {
  choice: AssistModeChoice | null;
  setChoice: (c: AssistModeChoice) => void;
  can?: AssistAvailability;
  engine: "cloud" | "open";
  setEngine: (e: "cloud" | "open") => void;
  askFirst: boolean;
  setAskFirst: (v: boolean) => void;
}) {
  return (
    <>
      <ModePicker value={choice} onChange={setChoice} availability={can} />
      <EngineSwitch value={engine} onChange={setEngine} size="sm" compact />
      <AskFirst checked={askFirst} onChange={setAskFirst} />
    </>
  );
}

export function AssistView() {
  const router = useRouter();
  const params = useSearchParams();
  const id = params.get("c");
  const [engine, setEngine] = useEngine();
  const [askFirst, setAskFirst] = useState(true);
  const [open, setOpen] = useState<{ g: Generation; i: number } | null>(null);
  // "Use in a new chat" on a skill opens /assist?skill=<name>: the composer starts with "/name ". Home's examples open
  // /assist?prompt=<text>: the composer starts with the text. Neither sends anything.
  const skillParam = params.get("skill");
  const [draft, setDraft] = useState(() => ({ key: 0, text: assistDraft(skillParam, params.get("prompt")) }));
  const chats = useChats({ project: "none" });
  const can = chats.data?.availability;
  const [choice, setChoice] = useModeChoice(can?.defaultMode);
  const view = useAssistThread(id);
  const assist = useAssistActions();
  const actions = useChatActions();
  const skills = useSkills();
  const projects = useProjects();
  const end = useRef<HTMLDivElement>(null);
  const [scheduling, setScheduling] = useState(false);

  const go = (next: string | null) => router.replace(next ? `/assist?c=${next}` : "/assist", { scroll: false });
  const thread = view.data?.thread;
  const project = thread?.projectId ? projects.data?.find((p) => p.id === thread.projectId) : null;
  const available = chatSkills(skills.data, project);
  const all = useMemo(() => new Map((view.data?.generations ?? []).map((g) => [g.id, g])), [view.data?.generations]);
  const viewable = useMemo(
    () =>
      (thread?.items ?? []).flatMap((i) => (i.role === "generations" ? i.ids : [])).flatMap((gid) => {
        const g = all.get(gid);
        return g?.status === "succeeded" ? g.outputs.map((_, k) => ({ g, i: k })) : [];
      }),
    [thread?.items, all],
  );
  const pos = open ? viewable.findIndex((v) => v.g.id === open.g.id && v.i === open.i) : -1;

  const count = thread?.items.length ?? 0;
  const status = thread?.status;
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [count, status]);

  const start = async (text: string, attachments: string[] = []) => {
    const t = await actions.start({ text, attachments, engine, autoApprove: !askFirst, mode: choice ?? undefined });
    if (t.note) toast(t.note);
    go(t.id);
  };

  const agent = thread?.agent ?? chats.data?.agent;
  const agentBadge = thread && agent && (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href="/settings" className="hidden h-7 items-center gap-1.5 rounded-full bg-muted px-2.5 text-[12px] font-medium whitespace-nowrap text-muted-foreground hover:text-foreground sm:inline-flex">
          {agent === "claude" ? <Bot className="size-3" /> : <Cpu className="size-3" />}
          {modeLabel(thread)}
        </Link>
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{AGENT_HINT[agent]}</TooltipContent>
    </Tooltip>
  );

  return (
    <div className="flex h-svh min-w-0 flex-col md:h-[calc(100svh-0.5rem)]">
      <header className="flex h-14 shrink-0 items-center gap-1.5 px-3 sm:px-6">
        <SidebarTrigger className="md:hidden" />
        <RailButton />
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {project && (
            <Link href={`/assist/projects/${project.id}`} className="hidden min-w-0 shrink items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground sm:inline-flex">
              <ProjectDot project={project} />
              <span className="truncate">{project.name}</span>
              <span aria-hidden>/</span>
            </Link>
          )}
          <h1 className="min-w-0 truncate font-heading text-[22px] leading-none">{thread?.title ?? "Assist"}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {agentBadge}
          {thread && thread.items.some((i) => i.role === "user") && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={() => setScheduling(true)} aria-label="Schedule this request">
                  <CalendarClock /> <span className="hidden lg:inline">Schedule</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Run this chat&apos;s request again on a schedule</TooltipContent>
            </Tooltip>
          )}
          {id && (
            <Button variant="ghost" size="sm" onClick={() => go(null)} aria-label="New chat">
              <MessageSquarePlus /> <span className="hidden sm:inline">New chat</span>
            </Button>
          )}
          {thread && <ChatMenu chat={thread} onDeleted={() => go(null)} />}
        </div>
      </header>

      {!id ? (
        <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-3 pt-[10vh] pb-16 sm:px-6 sm:pt-[14vh]">
          <div className="w-full max-w-[760px]">
            <div className="mb-6 text-center">
              <h2 className="font-heading text-display text-balance">What are we creating today?</h2>
              <p className="mt-2 text-[14px] text-pretty text-muted-foreground">Describe the whole job. Assist picks the models, shows you the plan and cost, then runs every step. Type / to use a skill.</p>
            </div>
            <AssistVisitorNote className="mb-4" />
            <AssistComposer
              key={draft.key}
              initialText={draft.text}
              autoFocus
              skills={available}
              placeholder="e.g. “A launch campaign for my sneaker: 3 hero stills, then a 5s vertical video of the best one”"
              onSend={start}
              footer={<NewChatControls choice={choice} setChoice={setChoice} can={can} engine={engine} setEngine={setEngine} askFirst={askFirst} setAskFirst={setAskFirst} />}
            />
            <SkillStarters skills={available} loading={skills.data === undefined && !skills.isError} onPick={(s) => setDraft((d) => ({ key: d.key + 1, text: `/${s.name} ` }))} />
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {ASSIST_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => start(s).catch((e) => toastError(e))}
                  className="max-w-full rounded-full border bg-background px-3.5 py-1.5 text-left text-[13px] text-muted-foreground transition hover:border-primary hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 sm:px-6">
            <div className="mx-auto w-full max-w-[760px] py-4">
              {view.isError ? (
                <div className="py-20 text-center">
                  <p className="font-heading text-[22px]">This chat doesn&apos;t exist anymore</p>
                  <Button variant="outline" className="mt-4" onClick={() => go(null)}>
                    Start a new chat
                  </Button>
                </div>
              ) : thread ? (
                <Transcript thread={thread} all={all} skills={skills.data} onAnswer={(ok) => assist.answer(thread.id, ok)} onOpen={(g, i) => setOpen({ g, i })} />
              ) : (
                <Loader2 className="mx-auto mt-20 animate-spin text-muted-foreground" aria-label="Loading the chat" />
              )}
              <div ref={end} className="h-4" />
            </div>
          </div>
          <div className="shrink-0 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
            <div className="mx-auto w-full max-w-[760px]">
              <AssistComposer
                skills={available}
                placeholder={thread?.status === "waiting" ? "Or tell me what to change…" : "Ask for changes, variations or the next step…"}
                disabled={!thread || thread.status === "running"}
                onSend={(text, attachments) => assist.send(id, { text, attachments })}
                footer={
                  thread && (
                    <>
                      <ModePicker
                        value={threadModeChoice(thread)}
                        availability={can}
                        disabled={thread.status === "running"}
                        applyOnClose
                        onChange={(c) => void actions.patch(thread.id, { mode: c }).catch((e) => toastError(e))}
                      />
                      <AskFirst checked={!thread.autoApprove} onChange={(v) => void assist.setAutoApprove(thread.id, !v)} />
                    </>
                  )
                }
              />
            </div>
          </div>
        </>
      )}

      {thread && (
        <ScheduleDialog
          open={scheduling}
          onOpenChange={setScheduling}
          seed={(() => {
            // The chat's first request is the job; later messages refine it.
            const first = thread.items.find((i) => i.role === "user");
            return {
              prompt: first?.role === "user" ? `${first.skills?.length ? `${first.skills.map((n) => `/${n}`).join(" ")} ` : ""}${first.text}` : "",
              attachments: first?.role === "user" ? first.attachments : undefined,
              projectId: thread.projectId ?? null,
              engine: thread.engine,
              mode: threadModeChoice(thread),
            };
          })()}
        />
      )}
      {open && pos >= 0 && (
        <Viewer
          generation={viewable[pos].g}
          index={viewable[pos].i}
          onClose={() => setOpen(null)}
          onPrev={pos > 0 ? () => setOpen(viewable[pos - 1]) : undefined}
          onNext={pos < viewable.length - 1 ? () => setOpen(viewable[pos + 1]) : undefined}
        />
      )}
    </div>
  );
}

/** One-tap skill starters under the empty composer: picking one types `/name ` into it. */
/**
 * The starter cards under the composer. While the skills load (`loading`) the six cards are drawn
 * as same-sized placeholders, so the suggestions below don't jump down when they arrive.
 */
export function SkillStarters({ skills, loading, onPick, className }: { skills: SkillSummary[]; loading?: boolean; onPick: (s: SkillSummary) => void; className?: string }) {
  const shown = [...STARTER_SKILLS.map((n) => skills.find((s) => s.name === n)).filter((s): s is SkillSummary => !!s), ...skills.filter((s) => !STARTER_SKILLS.includes(s.name))].slice(0, 6);
  if (loading && !shown.length) {
    return (
      <div className={cn("mt-4", className)} aria-busy="true" aria-label="Loading skills">
        <div className="flex items-center justify-between px-1 pb-2">
          <p className="text-[12px] font-medium text-muted-foreground">Start with a skill</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {STARTER_SKILLS.map((n) => (
            <div key={n} aria-hidden className="flex min-w-0 items-center gap-3 rounded-xl border bg-background p-2.5">
              <Skeleton className="size-9 shrink-0 rounded-lg" />
              <span className="min-w-0 flex-1">
                <span className="flex h-[1lh] items-center text-[13px]">
                  <Skeleton className="h-3 w-1/2" />
                </span>
                <span className="flex h-[1lh] items-center text-[12px]">
                  <Skeleton className="h-2.5 w-4/5" />
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (!shown.length) return null;
  return (
    <div className={cn("mt-4", className)}>
      <div className="flex items-center justify-between px-1 pb-2">
        <p className="text-[12px] font-medium text-muted-foreground">Start with a skill</p>
        <Link href="/assist/skills" className="text-[12px] text-brand-text hover:underline">
          All skills
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((s) => (
          <button key={s.name} onClick={() => onPick(s)} className="flex min-w-0 items-center gap-3 rounded-xl border bg-background p-2.5 text-left transition hover:border-primary hover:bg-accent">
            <SkillIcon name={s.name} icon={s.icon} />
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-medium">{s.title}</span>
              <span className="block truncate text-[12px] text-muted-foreground">{s.description}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

