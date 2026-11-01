"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Cpu, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useViewer } from "@/lib/api";
import type { Generation } from "@/lib/catalog/types";
import { shortGpu } from "@/lib/gpu/readiness";
import { RELAY_WORDS } from "@/lib/relay";
import { cn } from "@/lib/utils";
import { computerState, jobFor, RESTART_EVENT, startComputerRunner, store, stored, subscribeComputer, takeOverHere, type ComputerState, type RunnerStart } from "./computer-runtime";
import { openFinder } from "./open-connect";
import { loopbackPermission, useComputerSupport } from "./use-local-comfy";

/**
 * "Use the ComfyUI on this computer": while the page is open, one Fuobe tab of this browser runs the person's jobs on
 * their ComfyUI (computer-runtime.ts). Mounted once, in the app's providers; it starts only for someone whose runs go
 * to their own computer. The sidebar shows its note (ComputerNote) while their GPU works, or when ComfyUI needs them.
 */

export { awayFix, openConnect, openFinder, type FindReason } from "./open-connect";

/**
 * May this browser reach ComfyUI on this computer without a question nobody explained? Allowed: yes. Told no:
 * "blocked". It would ask (or doesn't say: Firefox): only a browser that reached ComfyUI before goes on; any other
 * only listens ("ask") until the person connects from the card, which explains the question first.
 */
async function runnerAccess(): Promise<RunnerStart["access"]> {
  const p = await loopbackPermission();
  if (p.state === "denied") return "blocked";
  if (p.state === "granted") return undefined;
  return stored("reached") ? undefined : "ask";
}

export function ComputerRunnerHost() {
  const viewer = useViewer().data;
  // A phone or Safari can't reach a ComfyUI: there the runs wait for the computer's own tab.
  const support = useComputerSupport();
  const computer = viewer?.computer === true && support === "ok";
  // Where the person's computer last found ComfyUI (a browser that remembers none starts there); read at each start.
  const port = useRef<number | undefined>(undefined);
  useEffect(() => {
    port.current = viewer?.comfyPort;
  }, [viewer?.comfyPort]);
  useEffect(() => {
    if (!computer) return;
    let alive = true;
    let stop: (() => void) | null = null;
    let status: PermissionStatus | undefined;
    const start = async () => {
      const access = await runnerAccess();
      if (!alive) return;
      stop?.();
      stop = startComputerRunner({ port: port.current, ...(access && { access }) });
    };
    const again = () => void start();
    // Started again when ComfyUI moved, the card connected, or the browser's answer changed (Allow, or Block).
    window.addEventListener(RESTART_EVENT, again);
    void loopbackPermission().then((p) => {
      if (!alive) return;
      status = p.status;
      status?.addEventListener("change", again);
    });
    void start();
    return () => {
      alive = false;
      window.removeEventListener(RESTART_EVENT, again);
      status?.removeEventListener("change", again);
      stop?.();
    };
  }, [computer]);
  return computer ? <ComputerNews /> : null;
}

/**
 * Each job this tab saved: its run's result shows at once (the lists are asked again as soon as the run moves on), and
 * for the first run this computer ever finishes, "Made on your RTX 5090 in 18 s." once the result is there.
 */
function useFinishedJobs(s: ComputerState) {
  const qc = useQueryClient();
  const started = useRef(new Map<string, number>());
  const followed = useRef(new Set<string>());
  useEffect(() => {
    if (s.holder !== "this" || !s.view) return;
    for (const j of s.view.jobs) {
      if (!started.current.has(j.taskId)) started.current.set(j.taskId, Date.now());
      if (j.phase !== "done" || followed.current.has(j.taskId)) continue;
      followed.current.add(j.taskId);
      const secs = Math.max(1, Math.round(((j.endedAt ?? Date.now()) - started.current.get(j.taskId)!) / 1000));
      const gpu = shortGpu(s.view.facts?.device);
      void (async () => {
        // The studio marks the run done at its next look (about a second): ask until it has.
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, i === 0 ? 400 : 750));
          const g = (await fetch(`/api/generations/${encodeURIComponent(j.generationId)}`, { cache: "no-store" })
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)) as Pick<Generation, "status"> | null;
          if (!g || g.status === "queued" || g.status === "running") continue;
          void qc.invalidateQueries({ queryKey: ["generations"] });
          void qc.invalidateQueries({ queryKey: ["library"] });
          if (g.status === "succeeded" && !stored("firstRun")) {
            store("firstRun", "1");
            toast.success(`Made on your ${gpu || "GPU"} in ${secs} s.`);
          }
          return;
        }
      })();
    }
  }, [s, qc]);
}

/**
 * The status strip hears at once when this tab starts or stops running the jobs, or ComfyUI comes and goes: now, and
 * again once the beat that tells the server has landed.
 */
function useStatusRefresh(s: ComputerState) {
  const qc = useQueryClient();
  const key = s.holder === "this" && s.view ? `${s.view.runner}:${s.view.comfy}:${s.view.access ?? ""}:${s.view.stopped ?? ""}` : s.holder;
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ["status"] });
    const t = setTimeout(() => void qc.invalidateQueries({ queryKey: ["status"] }), 2500);
    return () => clearTimeout(t);
  }, [key, qc]);
}

/** A run waits while ComfyUI here runs without Fuobe's setting: the card with the fix opens by itself, once. */
function useSettingPrompt(s: ComputerState) {
  const opened = useRef(false);
  const v = s.view;
  const due = s.holder === "this" && !!v && !v.stopped && !v.access && !v.heldElsewhere && v.comfy === "no-setting" && (v.waiting > 0 || v.jobs.some((j) => j.phase === "sending"));
  useEffect(() => {
    if (!due || opened.current) return;
    opened.current = true;
    openFinder("setting");
  }, [due]);
}

function ComputerNews() {
  const s = useComputerState();
  useFinishedJobs(s);
  useStatusRefresh(s);
  useSettingPrompt(s);
  return null;
}

const NONE: ComputerState = { holder: "none", view: null };

export function useComputerState(): ComputerState {
  return useSyncExternalStore(subscribeComputer, computerState, () => NONE);
}

/**
 * The job this browser runs for a run, if any: where it is, its steps, the latest live preview as an image address,
 * whether this tab runs it or another Fuobe tab does, and ComfyUI here as this tab last saw it (`now`: the tile's clock).
 */
export function useLocalJob(generationId: string, now: number) {
  const s = useComputerState();
  const job = jobFor(s, generationId, now);
  const frame = job?.preview;
  const preview = useMemo(() => (frame ? URL.createObjectURL(frame) : null), [frame]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  return job ? { job, preview, here: s.holder === "this", comfy: s.holder === "this" ? (s.view?.comfy ?? "ok") : "ok" } : null;
}

type Note = { text: string; action?: string; go?: () => void; problem: boolean };

/** What the note says now, or nothing: something for the person to do (only while there is work), or the GPU working. */
function noteOf(s: ComputerState): Note | null {
  const v = s.view;
  if (s.holder !== "this" || !v || v.stopped) return null;
  const working = v.jobs.some((j) => j.phase !== "done" && j.phase !== "failed");
  const wanted = working || v.waiting > 0;
  if (!wanted) return null;
  // Another computer runs the jobs: this one's ComfyUI is no news.
  if (v.heldElsewhere) return v.comfy === "ok" && !v.access && v.waiting > 0 ? { text: "Fuobe on another computer is running your ComfyUI runs.", action: "Run them here instead", go: takeOverHere, problem: true } : null;
  if (v.access === "ask") return { text: "Your runs are waiting for your ComfyUI. Run them from this browser?", action: "Connect", go: () => openFinder("browser"), problem: true };
  if (v.access === "blocked") return { text: "Your browser is blocking Fuobe from reaching ComfyUI on this computer.", action: "Show me how", go: () => openFinder("browser"), problem: true };
  if (v.comfy === "no-setting") return { text: "ComfyUI is running without Fuobe's setting.", action: "Show me how", go: () => openFinder("setting"), problem: true };
  if (v.comfy === "down") return { text: RELAY_WORDS.comfyDown, action: "Find my ComfyUI", go: () => openFinder("find"), problem: true };
  return working ? { text: "Your GPU is working. Keep this tab open.", problem: false } : null;
}

/**
 * The note in the sidebar, above "Your GPU": the GPU working ("keep this tab open"), or the one thing to do. It sits in
 * the sidebar's own space, so it never covers the page; with the sidebar folded, an icon says it.
 */
export function ComputerNote() {
  const note = noteOf(useComputerState());
  if (!note) return null;
  const icon = note.problem ? (
    <TriangleAlert className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
  ) : (
    <span className="relative grid size-4 shrink-0 place-items-center">
      <Cpu className="size-4 text-brand-text" />
      <span className="absolute -top-0.5 -right-0.5 size-1.5 animate-pulse rounded-full bg-primary" />
    </span>
  );
  return (
    <>
      <div role="status" className={cn("flex gap-2 rounded-md border px-2 py-1.5 text-[12px] group-data-[collapsible=icon]:hidden", note.problem ? "border-amber-500/50" : "border-transparent bg-brand-faint")}>
        {icon}
        <div className="min-w-0 flex-1">
          <p className="leading-snug">{note.text}</p>
          {note.action && (
            <button type="button" onClick={note.go} className="mt-0.5 font-medium text-brand-text underline-offset-4 hover:underline">
              {note.action}
            </button>
          )}
        </div>
      </div>
      <button
        type="button"
        title={note.action ? `${note.text} ${note.action}` : note.text}
        aria-label={note.text}
        onClick={note.go}
        className="hidden size-8 place-items-center self-center rounded-md hover:bg-accent group-data-[collapsible=icon]:grid"
      >
        {icon}
      </button>
    </>
  );
}
