"use client";

import { CalendarClock, Loader2, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EngineSwitch } from "@/components/studio/engine-switch";
import { radioKeys, radioTab } from "@/components/studio/radio-keys";
import { useNow } from "@/components/studio/use-now";
import { useEngine } from "@/lib/api";
import { threadTitle, type AssistModeChoice } from "@/lib/assist";
import {
  DEFAULT_SCHEDULE_CAP_USD,
  formatWhen,
  MAX_SCHEDULE_CAP_USD,
  MAX_SCHEDULE_PROMPT,
  nextRun,
  ruleError,
  SCHEDULE_HOURS,
  untilText,
  WEEK_ORDER,
  WEEKDAYS,
  zoneLabel,
  type ScheduleApproval,
  type ScheduleRule,
  type ScheduleView,
} from "@/lib/assist-schedule";
import type { Engine } from "@/lib/catalog/types";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { useChats, useConnectors, useProjects, useScheduleActions, type ScheduleRuleInput } from "./hooks";
import { ModePicker } from "./mode-picker";
import { ProjectDot } from "./project-dot";

/** What a new task starts from: a chat's request, a project. */
export interface ScheduleSeed {
  prompt?: string;
  attachments?: string[];
  projectId?: string | null;
  engine?: Engine;
  mode?: AssistModeChoice | null;
}

const KINDS: { id: ScheduleRule["kind"]; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "hours", label: "Every few hours" },
  { id: "once", label: "Once" },
];

const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

const allZones = (): string[] => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
  } catch {
    return [];
  }
};

/** "2026-10-28T09:00" for tomorrow at 09:00 on this device's clock (the default for "Once"). */
function tomorrowAt9(now: number): string {
  const d = new Date(now + 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T09:00`;
}

/** Create or edit a scheduled task: the prompt, when it runs, where, and whether it asks first. */
export function ScheduleDialog({ open, onOpenChange, schedule, seed }: { open: boolean; onOpenChange: (open: boolean) => void; schedule?: ScheduleView; seed?: ScheduleSeed }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(92svh,820px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]">{open && <Form schedule={schedule} seed={seed} onDone={() => onOpenChange(false)} />}</DialogContent>
    </Dialog>
  );
}

function Form({ schedule, seed, onDone }: { schedule?: ScheduleView; seed?: ScheduleSeed; onDone: () => void }) {
  const actions = useScheduleActions();
  const projects = useProjects();
  const can = useChats({ project: "none" }).data?.availability;
  const [preferred] = useEngine();
  const now = useNow(30_000);
  const ids = { title: useId(), prompt: useId(), time: useId(), at: useId(), hours: useId(), tz: useId(), cap: useId(), project: useId() };
  const initialPrompt = schedule?.prompt ?? seed?.prompt ?? "";
  const [prompt, setPrompt] = useState(initialPrompt);
  const [title, setTitle] = useState(schedule?.title ?? (initialPrompt ? threadTitle(initialPrompt) : ""));
  const [titleTouched, setTitleTouched] = useState(!!schedule);
  const [attachments, setAttachments] = useState<string[]>(schedule?.attachments ?? seed?.attachments ?? []);
  const [projectId, setProjectId] = useState<string | null>(schedule?.projectId ?? seed?.projectId ?? null);
  const r = schedule?.rule;
  const [kind, setKind] = useState<ScheduleRule["kind"]>(r?.kind ?? "daily");
  const [time, setTime] = useState(r && "time" in r ? r.time : "09:00");
  const [days, setDays] = useState<number[]>(r?.kind === "weekly" ? r.days : [1]);
  const [every, setEvery] = useState(r?.kind === "hours" ? r.every : 6);
  const [at, setAt] = useState(r?.kind === "once" ? r.at : () => tomorrowAt9(Date.now()));
  const [tz, setTz] = useState(schedule?.tz ?? browserZone);
  const [approval, setApproval] = useState<ScheduleApproval>(schedule?.approval ?? "ask");
  const [cap, setCap] = useState(String(schedule?.capUsd ?? DEFAULT_SCHEDULE_CAP_USD));
  const [engine, setEngine] = useState<Engine>(schedule?.engine ?? seed?.engine ?? preferred);
  const [mode, setMode] = useState<AssistModeChoice | null>((schedule?.mode as AssistModeChoice | null) ?? seed?.mode ?? null);
  // Off unless the task opts in: connector tools run inside Claude's reply, where no approval reaches them.
  const [connectors, setConnectors] = useState(schedule?.connectors ?? false);
  const connectorNames = (useConnectors().data ?? []).filter((c) => c.enabled).map((c) => c.name);
  const [busy, setBusy] = useState(false);
  const zones = useMemo(() => {
    const list = allZones();
    return list.includes(tz) ? list : [tz, ...list];
  }, [tz]);

  const rule: ScheduleRuleInput = kind === "daily" ? { kind, time } : kind === "weekly" ? { kind, days, time } : kind === "hours" ? { kind, every } : { kind, at };
  // An unchanged "every N hours" keeps counting from when it was set up.
  const from = r?.kind === "hours" && r.every === every ? r.from : now;
  const full: ScheduleRule = rule.kind === "hours" ? { ...rule, from } : rule;
  const problem = ruleError(full);
  const next = problem ? null : nextRun(full, tz, now);
  const capUsd = Number(cap);
  const capBad = approval === "auto" && (!cap.trim() || !Number.isFinite(capUsd) || capUsd < 0 || capUsd > MAX_SCHEDULE_CAP_USD);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return void toast.error("Write what Assist should do each time");
    if (problem) return void toast.error(problem);
    if (!next) return void toast.error(kind === "once" ? "That time has passed — pick a later one" : "This schedule never runs");
    if (capBad) return void toast.error(`Set a cap between $0 and $${MAX_SCHEDULE_CAP_USD}`);
    setBusy(true);
    try {
      const body = {
        title: title.trim() || threadTitle(prompt),
        prompt: prompt.trim(),
        attachments,
        projectId,
        rule,
        tz,
        approval,
        capUsd: approval === "auto" ? capUsd : null,
        engine,
        mode,
        connectors,
      };
      const s = schedule ? await actions.update(schedule.id, body) : await actions.create(body);
      toast.success(schedule ? "Schedule saved" : "Scheduled", { description: s.nextRunAt ? `Next run ${formatWhen(s.nextRunAt, s.tz)}` : undefined, duration: 2500 });
      onDone();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const toggleDay = (d: number) => setDays((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d]));

  return (
    <form onSubmit={save} className="flex min-h-0 flex-col">
      <DialogHeader className="border-b px-5 pt-5 pb-4">
        <DialogTitle className="flex items-center gap-2 font-heading text-[24px] font-normal">
          <CalendarClock className="size-5 text-muted-foreground" /> {schedule ? "Edit scheduled task" : "Schedule a task"}
        </DialogTitle>
        <DialogDescription>Each run is a new chat on this server — it runs even when Fuobe isn&apos;t open in a browser. What it makes lands in your Library.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <div className="space-y-2">
          <Label htmlFor={ids.prompt}>What should Assist do each time?</Label>
          <Textarea
            id={ids.prompt}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              if (!titleTouched) setTitle(e.target.value.trim() ? threadTitle(e.target.value) : "");
            }}
            maxLength={MAX_SCHEDULE_PROMPT}
            rows={4}
            autoFocus={!schedule && !initialPrompt}
            placeholder="e.g. “Make 3 new ad variations for my sneaker, vertical 9:16, in today's light”"
            className="min-h-24 text-[14px]"
          />
          {attachments.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Files each run uses">
              {attachments.map((a, i) => (
                <li key={a} className="inline-flex h-7 items-center gap-1 rounded-full bg-muted pr-1 pl-2.5 text-[12px]">
                  File {i + 1}
                  <button type="button" onClick={() => setAttachments((xs) => xs.filter((x) => x !== a))} className="grid size-5 place-items-center rounded-full hover:bg-background" aria-label={`Don't use file ${i + 1}`}>
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={ids.title}>Name</Label>
            <Input
              id={ids.title}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleTouched(true);
              }}
              maxLength={80}
              placeholder="Daily ad variations"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={ids.project}>Project</Label>
            <Select value={projectId ?? "none"} onValueChange={(v) => setProjectId(v === "none" ? null : v)}>
              <SelectTrigger id={ids.project} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No project</SelectItem>
                {projects.data?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <ProjectDot project={p} /> {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">When</legend>
          <div role="radiogroup" aria-label="Repeat" onKeyDown={radioKeys} className="flex flex-wrap gap-1.5">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                role="radio"
                aria-checked={kind === k.id}
                tabIndex={radioTab(kind === k.id)}
                onClick={() => setKind(k.id)}
                className={cn(
                  "inline-flex h-8 items-center rounded-full px-3 text-[13px] font-medium transition-colors",
                  kind === k.id ? "bg-brand-faint text-brand-text hover:bg-brand-faint-hover" : "bg-secondary text-secondary-foreground hover:bg-accent",
                )}
              >
                {k.label}
              </button>
            ))}
          </div>
          {kind === "weekly" && (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Days">
              {WEEK_ORDER.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={days.includes(d)}
                  aria-label={WEEKDAYS[d]}
                  onClick={() => toggleDay(d)}
                  className={cn(
                    "grid h-8 w-11 place-items-center rounded-lg border text-[12px] font-medium transition-colors",
                    days.includes(d) ? "border-primary bg-brand-faint text-brand-text" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {WEEKDAYS[d].slice(0, 3)}
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
            {(kind === "daily" || kind === "weekly") && (
              <div className="space-y-2">
                <Label htmlFor={ids.time}>Time</Label>
                <Input id={ids.time} type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
              </div>
            )}
            {kind === "hours" && (
              <div className="space-y-2">
                <Label htmlFor={ids.hours}>Every</Label>
                <Select value={String(every)} onValueChange={(v) => setEvery(Number(v))}>
                  <SelectTrigger id={ids.hours} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCHEDULE_HOURS.map((h) => (
                      <SelectItem key={h} value={String(h)}>
                        {h === 1 ? "hour" : h % 24 === 0 && h > 24 ? `${h / 24} days` : `${h} hours`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {kind === "once" && (
              <div className="space-y-2">
                <Label htmlFor={ids.at}>Date and time</Label>
                <Input id={ids.at} type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} required />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor={ids.tz}>Time zone</Label>
              <Select value={tz} onValueChange={setTz}>
                <SelectTrigger id={ids.tz} className="w-full">
                  <SelectValue>{zoneLabel(tz, now)}</SelectValue>
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {zones.map((z) => (
                    <SelectItem key={z} value={z}>
                      {z.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-[13px] text-muted-foreground" aria-live="polite">
            {problem ? (
              <span className="text-destructive">{problem}</span>
            ) : next ? (
              <>
                Next run: <span className="font-medium text-foreground">{formatWhen(next, tz)}</span> ({untilText(next, now)})
                {kind === "hours" && !schedule ? ", then every " + (every === 1 ? "hour" : `${every} hours`) : ""}.
              </>
            ) : (
              <span className="text-destructive">That time has passed — pick a later one.</span>
            )}
          </p>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Assistant</legend>
          <div className="flex flex-wrap items-center gap-1.5">
            <ModePicker value={mode} onChange={setMode} availability={can} />
            <EngineSwitch value={engine} onChange={setEngine} size="sm" compact />
          </div>
          <p className="text-[12px] text-muted-foreground">
            {engine === "open" ? "Open-source models run free on your GPU." : "Paid models cost what the approval card shows."} Smart plans with the best model you&apos;ve connected (a paid one bills each run); Free uses free models, then the offline planner.
          </p>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Before anything runs</legend>
          <div role="radiogroup" aria-label="Approval" onKeyDown={radioKeys} className="grid gap-2">
            {(
              [
                {
                  id: "ask",
                  title: "Ask me first",
                  body: "Each run plans the job, then waits in its chat for your OK — nothing is generated until you approve. A run on a paid model uses that provider's key to plan.",
                },
                { id: "auto", title: "Run on its own, within a cap", body: "Plans start without asking while they fit the cap. A plan that would pass it, or has no known price, waits for you." },
              ] as const
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={approval === o.id}
                tabIndex={radioTab(approval === o.id)}
                onClick={() => setApproval(o.id)}
                className={cn("rounded-xl border px-3.5 py-2.5 text-left transition-colors", approval === o.id ? "border-primary bg-brand-faint" : "hover:bg-accent")}
              >
                <span className="block text-[13px] font-medium">{o.title}</span>
                <span className="block text-[12px] text-muted-foreground">{o.body}</span>
              </button>
            ))}
          </div>
          {approval === "auto" && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Label htmlFor={ids.cap} className="text-[13px] font-normal">
                Spend up to
              </Label>
              <div className="relative w-28">
                <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[13px] text-muted-foreground">$</span>
                <Input id={ids.cap} type="number" inputMode="decimal" min={0} max={MAX_SCHEDULE_CAP_USD} step={0.5} value={cap} onChange={(e) => setCap(e.target.value)} aria-invalid={capBad} className="pl-6" />
              </div>
              <span className="text-[13px] text-muted-foreground">per run on its own. Demo runs and open-source models are free.</span>
            </div>
          )}
        </fieldset>

        {(connectorNames.length > 0 || connectors) && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Connectors</legend>
            <label className="flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5">
              <Checkbox checked={connectors} onCheckedChange={(v) => setConnectors(v === true)} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium">Let runs use my connectors{connectorNames.length ? ` (${connectorNames.join(", ")})` : ""}</span>
                <span className="block text-[12px] text-muted-foreground">
                  Claude runs only. Their tools run without asking — even with Ask me first — and nobody is watching, so turn this on only for connectors you trust unattended. Settings → Assist · connectors can
                  limit each one to some tools.
                </span>
              </span>
            </label>
          </fieldset>
        )}
      </div>
      <DialogFooter className="mx-0 mb-0 border-t px-5 py-3">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !prompt.trim() || !!problem || !next || capBad}>
          {busy && <Loader2 className="animate-spin" />} {schedule ? "Save" : "Schedule"}
        </Button>
      </DialogFooter>
    </form>
  );
}
