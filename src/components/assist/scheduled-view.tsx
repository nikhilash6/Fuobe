"use client";

import { CalendarClock, CircleAlert, CircleCheck, Clock, Loader2, MoreHorizontal, Pause, Pencil, Play, Plus, SkipForward, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { PhoneNavButton } from "@/components/nav/phone-nav-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useNow } from "@/components/studio/use-now";
import { describeRule, formatWhen, untilText, zoneLabel, type ScheduleResult, type ScheduleView } from "@/lib/assist-schedule";
import { useIsOwner, useIsVisitor } from "@/lib/api";
import { formatCost, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { useProjects, useScheduleActions, useSchedules } from "./hooks";
import { ScheduleDialog } from "./schedule-dialog";
import { ProjectDot, RailButton } from "./shell";
import { AssistVisitorNote } from "./visitor-note";

const RESULT: Record<ScheduleResult["status"], { icon: typeof Clock; tone: string }> = {
  running: { icon: Loader2, tone: "text-brand-text" },
  waiting: { icon: Clock, tone: "text-amber-700 dark:text-amber-300" },
  done: { icon: CircleCheck, tone: "text-emerald-700 dark:text-emerald-400" },
  failed: { icon: CircleAlert, tone: "text-destructive" },
  skipped: { icon: SkipForward, tone: "text-muted-foreground" },
};

/**
 * Assist's Scheduled tab (Supercomputer's Scheduled Tasks): every task with its rule, next run and
 * last result, to run now, pause, edit or delete. Standalone at /assist/scheduled, or one project's
 * tasks inside its page.
 */
export function ScheduledView({ projectId }: { projectId?: string } = {}) {
  const schedules = useSchedules(projectId);
  const [creating, setCreating] = useState(false);
  const list = schedules.data ?? [];
  // A guest or an account (public sign-up): scheduled tasks are the owner's, so nothing to schedule.
  const owner = useIsOwner();
  const visitor = useIsVisitor();

  return (
    <div className={cn("flex min-w-0 flex-col", !projectId && "min-h-content")}>
      {!projectId && (
        <header className="max-md:sticky top-chrome z-20 flex h-14 items-center gap-1.5 bg-background/85 px-4 backdrop-blur sm:px-6">
          <RailButton />
          <h1 className="font-heading text-[22px] leading-none">Scheduled</h1>
          {owner && (
            <div className="ml-auto">
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus /> <span className="hidden sm:inline">Schedule a task</span>
                <span className="sm:hidden">New</span>
              </Button>
            </div>
          )}
          <PhoneNavButton />
        </header>
      )}
      <div className={cn("w-full max-w-[900px] min-w-0 flex-1 px-4 pb-16 sm:px-6", projectId ? "pt-2" : "pt-4 md:pt-8")}>
        {!projectId ? (
          <>
            <p className="max-w-2xl text-[15px] text-pretty text-muted-foreground">
              Prompts that run by themselves — daily ad variations, a weekly competitor scan, a content calendar. Each run is a new chat; it asks before spending unless you let it run within a cap.
            </p>
            <AssistVisitorNote className="mt-4 max-w-2xl" />
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted-foreground">Runs here follow the project&apos;s instructions and sources.</p>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus /> Schedule
            </Button>
          </div>
        )}
        <div className="mt-5">
          {schedules.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="h-24 rounded-2xl" />
              ))}
            </div>
          ) : schedules.isError ? (
            <p className="rounded-2xl border border-dashed px-4 py-8 text-center text-[13px] text-muted-foreground">Couldn&apos;t load the tasks: {(schedules.error as Error).message}</p>
          ) : list.length ? (
            <ul className="space-y-2">
              {list.map((s) => (
                <TaskRow key={s.id} s={s} showProject={!projectId} />
              ))}
            </ul>
          ) : (
            <Empty className="rounded-2xl border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CalendarClock />
                </EmptyMedia>
                {/* A visitor can't schedule (the note above says why); nothing until it's known who's looking, so neither text flashes. */}
                {owner ? (
                  <>
                    <EmptyTitle className="font-heading text-[22px] font-normal">No scheduled tasks yet</EmptyTitle>
                    <EmptyDescription>Schedule a prompt here, or with the Schedule button in any chat. You choose whether each run asks you first.</EmptyDescription>
                  </>
                ) : visitor ? (
                  <>
                    <EmptyTitle className="font-heading text-[22px] font-normal">Schedules belong to the owner</EmptyTitle>
                    <EmptyDescription>The studio&apos;s owner sets Assist&apos;s scheduled tasks here, and they stay private to them.</EmptyDescription>
                  </>
                ) : null}
              </EmptyHeader>
              {owner && (
                <EmptyContent>
                  <Button size="sm" onClick={() => setCreating(true)}>
                    <Plus /> Schedule a task
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          )}
        </div>
      </div>
      <ScheduleDialog open={creating} onOpenChange={setCreating} seed={{ projectId: projectId ?? null }} />
    </div>
  );
}

function TaskRow({ s, showProject }: { s: ScheduleView; showProject: boolean }) {
  const router = useRouter();
  const actions = useScheduleActions();
  const projects = useProjects();
  const now = useNow(30_000);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const project = s.projectId ? projects.data?.find((p) => p.id === s.projectId) : null;
  const ended = !s.paused && s.nextRunAt === null;

  const attempt = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const runNow = () =>
    attempt(async () => {
      const id = await actions.runNow(s.id);
      if (!id) return void toast("The last run is still going — try again when it stops");
      toast.success("Started", { action: { label: "Open chat", onClick: () => router.push(`/assist?c=${id}`) }, duration: 4000 });
    });

  const last = s.last;
  const R = last ? RESULT[last.status] : null;
  // Inside a project's page the tasks sit under its tabs, a level lower.
  const Title = showProject ? "h2" : "h3";
  return (
    <li className="rounded-2xl border bg-background p-3.5 sm:p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground" aria-hidden>
          <CalendarClock className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <Title className="truncate text-[14px] font-medium">{s.title}</Title>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted-foreground">
            <span>{describeRule(s.rule)}</span>
            <span aria-hidden>·</span>
            <span>{zoneLabel(s.tz, now)}</span>
            {showProject && project && (
              <>
                <span aria-hidden>·</span>
                <Link href={`/assist/projects/${project.id}`} className="inline-flex items-center gap-1 hover:text-foreground">
                  <ProjectDot project={project} className="size-1.5" /> {project.name}
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Switch
            checked={!s.paused}
            disabled={busy || ended}
            onCheckedChange={(on) => void attempt(() => actions.update(s.id, { paused: !on }))}
            aria-label={s.paused ? `Resume ${s.title}` : `Pause ${s.title}`}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={`More for ${s.title}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onSelect={() => void runNow()}>
                <Play /> Run now
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <Pencil /> Edit…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void attempt(() => actions.update(s.id, { paused: !s.paused }))} disabled={ended}>
                {s.paused ? <Play /> : <Pause />} {s.paused ? "Resume" : "Pause"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                <Trash2 /> Delete…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <p className="mt-2 line-clamp-2 text-[13px] text-pretty text-foreground/85 sm:pl-12">{s.prompt}</p>
      <dl className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-2 text-[12px] sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] sm:pl-12">
        <div className="min-w-0">
          <dt className="text-muted-foreground">Next run</dt>
          <dd className="font-medium">{s.paused ? "Paused" : s.nextRunAt ? `${formatWhen(s.nextRunAt, s.tz)} (${untilText(s.nextRunAt, now)})` : "None — it ran"}</dd>
          <dd className="text-muted-foreground">
            {s.approval === "ask" ? "Asks before generating" : s.capUsd ? `Runs on its own up to ${formatCost(s.capUsd)} a run` : "Runs on its own only when it's free; asks before anything paid"}
            {s.connectors ? " · uses your connectors" : ""}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-muted-foreground">
            Last run{s.lastRunAt ? ` · ${timeAgo(s.lastRunAt)}` : ""}
            {s.runs > 1 ? ` · ${s.runs} runs` : ""}
          </dt>
          {last && R ? (
            <dd className={cn("flex min-w-0 items-start gap-1.5", R.tone)}>
              <R.icon className={cn("mt-0.5 size-3.5 shrink-0", last.status === "running" && "animate-spin")} aria-hidden />
              <span className="min-w-0">
                <span className="line-clamp-2 break-words">{last.text}</span>
                {last.threadId && (
                  <Link href={`/assist?c=${last.threadId}`} className="font-medium text-brand-text hover:underline">
                    {last.status === "waiting" ? "Review the plan" : "Open chat"}
                  </Link>
                )}
              </span>
            </dd>
          ) : (
            <dd className="text-muted-foreground">Not run yet</dd>
          )}
        </div>
      </dl>
      <ScheduleDialog open={editing} onOpenChange={setEditing} schedule={s} />
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{s.title}”?</AlertDialogTitle>
            <AlertDialogDescription>It won&apos;t run again. The chats its runs made, and everything they made, stay.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void attempt(() => actions.remove(s.id))}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
