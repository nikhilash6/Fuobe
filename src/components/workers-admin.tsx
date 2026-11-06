"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Cpu, KeyRound, Pause, Play, Plus, RotateCw, Square, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { useSettings } from "@/components/connect-field";
import { gib } from "@/components/gpu/comfy-finder";
import { useNow } from "@/components/studio/use-now";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useHydrated, useViewer } from "@/lib/api";
import { copyWithToast } from "@/lib/clipboard";
import { deviceLabel } from "@/lib/gpu/readiness";
import { PLACE_NAME_DEFAULT, PLACE_NAME_MAX } from "@/lib/place-name";
import { cn } from "@/lib/utils";

/**
 * Settings → Workers (the owner only, docs/gpu-workers.md): the GPUs on other machines that run this studio's ComfyUI
 * jobs. Each says its state in words; the owner adds one (its token is shown once), pauses it, stops its job now, lets
 * it finish then pause, sets its hours and the lanes it may run, gives it a new token or revokes it. Works on a phone.
 */

type Hours = { always: true } | { tz: string; days: Record<string, [string, string][]> };

interface WorkerView {
  id: string;
  name: string;
  pool: string;
  state: string;
  words: string;
  pausedServer: boolean;
  pausedLocal: boolean;
  drain: boolean;
  autoResume: boolean | null;
  hours: Hours | null;
  allow: Record<string, { delayMs: number }>;
  /** The lanes it can run every workflow of. */
  lanes: string[];
  /** The lanes it can run only some workflows of (a server from before sends none). */
  partLanes?: Record<string, { runnable: number; of: number }>;
  warmLane: string | null;
  facts: { device?: string; vramBytes?: number; version?: string };
  seenAt: number | null;
  version: string | null;
  current: { taskId: string; lane: string | null; startedAt: number | null } | null;
}
interface Lane {
  lane: string;
  label: string;
  workflows: number;
}

/** Runs made but waiting to enter the line (hosted runs), by why they wait, and when the oldest was pressed. */
interface HeldCounts {
  mine: number;
  today: number;
  service: number;
  hour: number;
  list: number;
  credits: number;
  oldestAt: number | null;
}

/** "Waiting to enter the line: 3 (oldest 12 min)", or null when none waits. */
export function heldLine(h: HeldCounts | undefined, now: number): string | null {
  if (!h) return null;
  const n = h.mine + h.today + h.service + h.hour + h.list + h.credits;
  if (!n) return null;
  const min = h.oldestAt === null ? null : Math.max(0, Math.round((now - h.oldestAt) / 60_000));
  return `Waiting to enter the line: ${n}${min === null ? "" : ` (oldest ${min} min)`}`;
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(j.error ?? `Request failed (${res.status})`);
  return j;
}

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

function hoursWords(h: Hours | null): string {
  if (!h) return "No hours yet: it takes nothing";
  if ("always" in h) return "All day, every day";
  const first = Object.values(h.days).find((w) => w?.length)?.[0];
  return first ? `Every day ${first[0]}–${first[1]} (${h.tz})` : "No hours yet: it takes nothing";
}

function TokenOnce({ token, onDone }: { token: string; onDone: () => void }) {
  return (
    <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-[13px]">
      <p className="flex items-center gap-2 font-medium">
        <KeyRound className="size-4" /> The worker&apos;s token. It is shown only now.
      </p>
      <div className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-2">
        <code className="min-w-0 flex-1 overflow-x-auto font-mono text-[12px] whitespace-nowrap">{token}</code>
        <button type="button" onClick={() => void copyWithToast(token)} aria-label="Copy the token" className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background">
          <Copy className="size-3.5" />
        </button>
      </div>
      <p className="text-muted-foreground">
        On the GPU&apos;s PC, run <code className="font-mono">node bin/fuobe.mjs worker setup</code> and paste it when asked. See{" "}
        <a className="text-brand-text underline-offset-4 hover:underline" href="https://github.com/workingprototype/Fuobe/blob/main/docs/gpu-workers.md" target="_blank" rel="noreferrer">
          the workers guide
        </a>
        .
      </p>
      <Button size="sm" variant="secondary" onClick={onDone}>
        I saved it
      </Button>
    </div>
  );
}

function HoursEditor({ w, onSave }: { w: WorkerView; onSave: (hours: Hours | null) => void }) {
  const cur = w.hours && "days" in w.hours ? Object.values(w.hours.days).find((x) => x?.length)?.[0] : undefined;
  const [from, setFrom] = useState(cur?.[0] ?? "01:00");
  const [to, setTo] = useState(cur?.[1] ?? "09:00");
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <span className="text-muted-foreground">Hours:</span>
      <Button size="sm" variant={w.hours && "always" in w.hours ? "secondary" : "ghost"} className="h-8" onClick={() => onSave({ always: true })}>
        All day
      </Button>
      <span className="text-muted-foreground">or every day</span>
      <Input aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-20" />
      <span>–</span>
      <Input aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-20" />
      <Button size="sm" variant="secondary" className="h-8" onClick={() => onSave({ tz: zone(), days: Object.fromEntries(DAYS.map((d) => [d, [[from, to]]])) as Record<string, [string, string][]> })}>
        Set
      </Button>
      <Button size="sm" variant="ghost" className="h-8" onClick={() => onSave(null)}>
        None
      </Button>
    </div>
  );
}

/** How much of a lane a worker can run: every workflow, some of them, or none (its files are missing). */
export type LaneFit = { kind: "all" } | { kind: "some"; runnable: number; of: number } | { kind: "none" };

type LaneSource = Pick<WorkerView, "lanes" | "partLanes">;

export function laneFit(w: LaneSource, lane: string): LaneFit {
  if (w.lanes.includes(lane)) return { kind: "all" };
  const part = w.partLanes?.[lane];
  return part && part.runnable > 0 ? { kind: "some", runnable: part.runnable, of: part.of } : { kind: "none" };
}

/** The note after a lane's name: none when it runs every workflow, "(24 of 26 workflows)", or "(files missing)". */
export function laneNote(fit: LaneFit): string | null {
  if (fit.kind === "all") return null;
  return fit.kind === "some" ? `(${fit.runnable} of ${fit.of} workflows)` : "(files missing)";
}

/** Every lane it can run at least one workflow of. */
export const runnableLanes = (w: LaneSource): string[] => [...new Set([...w.lanes, ...Object.keys(w.partLanes ?? {})])];

/**
 * The lanes Allow all it can run allows: each one it can run any workflow of (a task goes only to a worker that can run
 * its own workflow, so a lane it runs part of is safe to allow), each keeping a wait it already had.
 */
export function allowAllItCanRun(w: LaneSource, allow: Record<string, { delayMs: number }>): Record<string, { delayMs: number }> {
  const next: Record<string, { delayMs: number }> = {};
  for (const lane of runnableLanes(w)) next[lane] = allow[lane] ?? { delayMs: 0 };
  return next;
}

const FIT_RANK = { all: 0, some: 1, none: 2 } as const;

export function LanesEditor({ w, lanes, onSave }: { w: WorkerView; lanes: Lane[]; onSave: (allow: Record<string, { delayMs: number }>) => void }) {
  const [allow, setAllow] = useState(w.allow);
  // Every workflow first, then some of them, then none; by name within each.
  const sorted = [...lanes].sort((a, b) => FIT_RANK[laneFit(w, a.lane).kind] - FIT_RANK[laneFit(w, b.lane).kind] || a.label.localeCompare(b.label));
  const runnable = runnableLanes(w).length;
  return (
    <details className="text-[13px]">
      <summary className="cursor-pointer text-muted-foreground">
        Lanes it may run: {Object.keys(w.allow).length} of {lanes.length} ({runnable} it can run)
      </summary>
      <ul className="mt-2 max-h-72 space-y-1 overflow-y-auto">
        {sorted.map((l) => {
          const fit = laneFit(w, l.lane);
          const note = laneNote(fit);
          return (
            <li key={l.lane} className="flex flex-wrap items-center gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  checked={l.lane in allow}
                  onChange={(e) => {
                    const next = { ...allow };
                    if (e.target.checked) next[l.lane] = { delayMs: 0 };
                    else delete next[l.lane];
                    setAllow(next);
                  }}
                />
                <span className={cn("truncate", fit.kind === "none" && "text-muted-foreground")}>{l.label}</span>
                {note && <span className="text-[11px] text-muted-foreground">{note}</span>}
              </label>
              {l.lane in allow && (
                <label className="flex items-center gap-1 text-[12px] text-muted-foreground">
                  wait
                  <Input
                    aria-label={`Delay for ${l.label}`}
                    className="h-7 w-14"
                    inputMode="numeric"
                    value={String(Math.round((allow[l.lane]?.delayMs ?? 0) / 1000))}
                    onChange={(e) => setAllow({ ...allow, [l.lane]: { delayMs: Math.max(0, Number(e.target.value) || 0) * 1000 } })}
                  />
                  s first
                </label>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* One click for every lane the PC can run any workflow of (each keeps a wait it already had), saved at once. */}
        <Button
          size="sm"
          className="h-8"
          disabled={!runnable}
          onClick={() => {
            const next = allowAllItCanRun(w, allow);
            setAllow(next);
            onSave(next);
          }}
        >
          Allow all it can run ({runnable})
        </Button>
        <Button size="sm" variant="ghost" className="h-8" disabled={!Object.keys(allow).length} onClick={() => setAllow({})}>
          Clear
        </Button>
        <Button size="sm" variant="secondary" className="h-8" onClick={() => onSave(allow)}>
          Save lanes
        </Button>
      </div>
    </details>
  );
}

function WorkerCard({ w, lanes, onToken }: { w: WorkerView; lanes: Lane[]; onToken: (t: string) => void }) {
  const qc = useQueryClient();
  const now = useNow(10_000);
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => call<{ worker: WorkerView | null; token?: string }>("PATCH", `/api/admin/workers/${encodeURIComponent(w.id)}`, body),
    onSuccess: (r) => {
      if (r.token) onToken(r.token);
      void qc.invalidateQueries({ queryKey: ["admin", "workers"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const gpu = [w.facts.device && deviceLabel(w.facts.device), gib(w.facts.vramBytes), w.version && `worker ${w.version}`].filter(Boolean).join(" · ");
  const seen = w.seenAt ? `${Math.max(0, Math.round((now - w.seenAt) / 1000))} s ago` : "never";
  return (
    <li className="space-y-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[14px] font-medium">
            <Cpu className="size-4 text-brand-text" /> {w.name}
          </p>
          <p className="text-[13px]">{w.words}</p>
          <p className="truncate text-[12px] text-muted-foreground">{[gpu, `heard from ${seen}`].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {w.pausedServer ? (
            <Button size="sm" className="h-8" disabled={patch.isPending} onClick={() => patch.mutate({ paused: false })}>
              <Play /> Resume
            </Button>
          ) : (
            <>
              <Button size="sm" variant="secondary" className="h-8" disabled={patch.isPending} onClick={() => patch.mutate({ paused: true })}>
                <Pause /> Pause
              </Button>
              <Button size="sm" variant="ghost" className="h-8" disabled={patch.isPending || !w.current} onClick={() => patch.mutate({ pauseNow: true })}>
                <Square /> Pause now
              </Button>
              <Button size="sm" variant="ghost" className="h-8" disabled={patch.isPending || w.drain} onClick={() => patch.mutate({ drain: true })}>
                Finish, then pause
              </Button>
            </>
          )}
        </div>
      </div>
      <p className="text-[12px] text-muted-foreground">{hoursWords(w.hours)}</p>
      <label className="flex items-start gap-2 text-[13px]">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-[var(--primary)]"
          checked={!!w.autoResume}
          disabled={patch.isPending}
          onChange={(e) => patch.mutate({ autoResume: e.target.checked })}
        />
        <span>
          Resume by itself after another program used the GPU
          <span className="block text-[12px] text-muted-foreground">
            Once the GPU has been free for its cool-down. A pause by hand always waits for a resume by hand.
            {w.autoResume === null && " Now: as the PC's own setting says."}
          </span>
        </span>
      </label>
      <HoursEditor w={w} onSave={(hours) => patch.mutate({ hours })} />
      <LanesEditor key={JSON.stringify(w.allow)} w={w} lanes={lanes} onSave={(allow) => patch.mutate({ allow })} />
      <div className="flex flex-wrap gap-1.5 border-t pt-2">
        <Button size="sm" variant="ghost" className="h-8" disabled={patch.isPending} onClick={() => patch.mutate({ rotate: true })}>
          <RotateCw /> New token
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-destructive"
          disabled={patch.isPending}
          onClick={() => {
            if (window.confirm(`Revoke ${w.name}? Its token stops at once, and its job goes back in line.`)) patch.mutate({ revoke: true });
          }}
        >
          <Trash2 /> Revoke
        </Button>
      </div>
    </li>
  );
}

export function useWorkers(enabled: boolean) {
  return useQuery({
    queryKey: ["admin", "workers"],
    queryFn: () => call<{ workers: WorkerView[]; lanes: Lane[]; held?: HeldCounts; hosted?: boolean }>("GET", "/api/admin/workers"),
    enabled,
    refetchInterval: 10_000,
  });
}

/** The whole Workers screen. */
export function WorkersAdmin() {
  const hydrated = useHydrated();
  const owner = useViewer().data?.owner;
  const q = useWorkers(!!owner);
  const now = useNow(30_000);
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => call<{ id: string; token: string }>("POST", "/api/admin/workers", { name }),
    onSuccess: (r) => {
      setToken(r.token);
      setName("");
      void qc.invalidateQueries({ queryKey: ["admin", "workers"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const where = useSettings(!!owner);
  const onWorkers = where.data?.find((s) => s.name === "comfyWhere")?.value === "workers";
  const setWhere = useMutation({
    mutationFn: (v: string) => call("PUT", "/api/settings", { comfyWhere: v }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["settings"] }),
    onError: (e) => toast.error((e as Error).message),
  });
  if (!hydrated) return null;
  if (!owner) return <p className="text-[14px] text-muted-foreground">Only the studio&apos;s owner manages workers.</p>;
  const workers = q.data?.workers ?? [];
  const held = heldLine(q.data?.held, now);
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="max-w-2xl text-[14px] text-muted-foreground">
          A worker is a program on another PC with a GPU. It takes this studio&apos;s ComfyUI jobs over HTTPS and runs them on its own ComfyUI, so you can share GPUs with your team or
          your other machines. It opens no port. A new worker starts paused, with no hours and no lanes.
        </p>
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" checked={onWorkers} disabled={setWhere.isPending || !where.data} onChange={(e) => setWhere.mutate(e.target.checked ? "workers" : "server")} />
          Run this studio&apos;s ComfyUI jobs on the workers
        </label>
      </div>
      {/* The name visitors read for these GPUs: asked for only while hosted runs are on. */}
      {q.data?.hosted && <PlaceNameField saved={where.data?.find((s) => s.name === "hostedPlaceName")} />}
      {token && <TokenOnce token={token} onDone={() => setToken(null)} />}
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate();
        }}
      >
        <Input aria-label="Worker name" placeholder="A name, like pc-3060ti" value={name} onChange={(e) => setName(e.target.value)} className="h-9 w-56" />
        <Button size="sm" className="h-9" disabled={!name.trim() || add.isPending}>
          <Plus /> Add a worker
        </Button>
      </form>
      {q.isError && <p className="text-[13px] text-destructive">{(q.error as Error).message}</p>}
      {held && (
        <p data-held-line className="text-[13px] text-muted-foreground tabular-nums">
          {held}
        </p>
      )}
      {workers.length ? (
        <ul className="space-y-3">
          {workers.map((w) => (
            <WorkerCard key={w.id} w={w} lanes={q.data?.lanes ?? []} onToken={setToken} />
          ))}
        </ul>
      ) : (
        q.data && <p className="text-[13px] text-muted-foreground">No workers yet.</p>
      )}
    </div>
  );
}

/**
 * The name visitors read for this studio's GPUs while hosted runs are on ("Runs on Our GPUs", src/lib/place-name.ts).
 * Empty: FUOBE_PLACE_NAME, else "Our GPUs". A billing service's own name for them wins over both.
 */
function PlaceNameField({ saved }: { saved?: { value: string; fromEnv: boolean } }) {
  const qc = useQueryClient();
  const [typed, setTyped] = useState<string | null>(null);
  const value = typed ?? (saved && !saved.fromEnv ? saved.value : "");
  const save = useMutation({
    mutationFn: () => call("PUT", "/api/settings", { hostedPlaceName: value.trim() }),
    onSuccess: () => {
      setTyped(null);
      toast.success("Saved");
      void qc.invalidateQueries({ queryKey: ["settings"] });
      void qc.invalidateQueries({ queryKey: ["status"] });
    },
    onError: (e) => toast.error((e as Error).message),
  });
  return (
    <form
      className="max-w-2xl space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <label htmlFor="place-name" className="text-[14px] font-medium">
        Name for your GPUs
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Input id="place-name" maxLength={PLACE_NAME_MAX} placeholder={saved?.fromEnv ? saved.value : PLACE_NAME_DEFAULT} value={value} onChange={(e) => setTyped(e.target.value)} className="h-9 w-64" />
        <Button size="sm" variant="secondary" className="h-9" disabled={typed === null || save.isPending}>
          Save
        </Button>
      </div>
      <p className="text-[13px] text-muted-foreground">
        Visitors read it where their runs go, as in &ldquo;Runs on {value.trim() || (saved?.fromEnv ? saved.value : PLACE_NAME_DEFAULT)}&rdquo;. Shown while runs on your GPUs are open to accounts.
      </p>
    </form>
  );
}

/** The Workers line in Settings: how many, and the way in. */
export function WorkersChip() {
  const owner = useViewer().data?.owner;
  const q = useWorkers(!!owner);
  if (!owner) return null;
  const n = q.data?.workers.length ?? 0;
  return (
    <Link href="/settings/workers" className="text-[13px] text-brand-text underline-offset-4 hover:underline">
      {n ? `Workers: ${n}` : "Workers: share your GPUs with other machines"}
    </Link>
  );
}
