"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { studioHandOff, type HandOffInput, type QueueMode, type StudioEstimate, type SwapProject, type SwapProjectCard, type SwapProjectView } from "@/lib/catalog/swap-studio";
import type { SwapEdit } from "@/lib/catalog/swap-studio-edit";
import type { Engine, PixelPoint } from "@/lib/catalog/types";
import { responseError } from "@/lib/refusals";

/** React Query hooks for /api/swap-studio/** (Character Swap Studio). */

async function json<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw responseError(res, body.error ?? `Request failed (${res.status})`);
  return body;
}

const send = async <T>(url: string, method: string, body?: unknown) =>
  json<T>(await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));

const base = (id: string) => `/api/swap-studio/projects/${encodeURIComponent(id)}`;

/** Whether anything in the view is still being made (the page polls while it is). */
export function viewBusy(v: SwapProjectView | undefined): boolean {
  if (!v) return false;
  if (Object.values(v.gens).some((g) => g.status === "queued" || g.status === "running")) return true;
  return v.project.clips.some((c) => c.shots.some((s) => (s.segments ?? []).some((g) => g.takes.some((t) => t.state === "waiting"))));
}

export function useSwapProjects() {
  return useQuery({
    queryKey: ["swap-studio", "projects"],
    queryFn: async () => (await json<{ items: SwapProjectCard[] }>(await fetch("/api/swap-studio/projects"))).items,
    refetchInterval: (q) => (q.state.data?.some((p) => p.waiting > 0) ? 5000 : false),
  });
}

export function useSwapProject(id: string) {
  return useQuery({
    queryKey: ["swap-studio", "project", id],
    queryFn: async () => json<SwapProjectView>(await fetch(base(id))),
    retry: (n, e) => !/not found/i.test((e as Error).message) && n < 2,
    refetchInterval: (q) => (viewBusy(q.state.data) ? 1500 : false),
  });
}

/** Prices for the project as it reads now (refetched when it changes). */
export function useSwapEstimate(id: string, revision: number | undefined, engine: Engine | undefined) {
  return useQuery({
    queryKey: ["swap-studio", "estimate", id, revision ?? 0, engine],
    enabled: revision !== undefined,
    queryFn: async () => json<StudioEstimate>(await fetch(`${base(id)}/estimate`)),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

/** Put a project the server answered with into the cache (its jobs' states come with the next poll). */
function useSetProject(id: string) {
  const qc = useQueryClient();
  return (p: SwapProject) => {
    qc.setQueryData<SwapProjectView>(["swap-studio", "project", id], (v) => (v ? { ...v, project: p } : v));
    void qc.invalidateQueries({ queryKey: ["swap-studio", "project", id] });
    void qc.invalidateQueries({ queryKey: ["swap-studio", "projects"] });
  };
}

export function useCreateSwapProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { name?: string; engine: Engine; character?: { image?: string | null; description?: string } }) => send<SwapProject>("/api/swap-studio/projects", "POST", b),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["swap-studio", "projects"] }),
  });
}

export function useDeleteSwapProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => send<void>(base(id), "DELETE"),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["swap-studio"] }),
  });
}

/** Edits: the page sends anchor imports without an id (the server names them). */
export type EditInput = SwapEdit extends infer E ? (E extends { type: "anchor-import" } ? Omit<E, "id" | "at"> : E) : never;

export function useSwapEdit(id: string) {
  const set = useSetProject(id);
  return useMutation({ mutationFn: (e: EditInput) => send<SwapProject>(base(id), "PATCH", e), onSuccess: set });
}

export interface ClipInput {
  url: string;
  name?: string;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio?: boolean;
  bytes?: number;
  /** Whether this browser could play it (the cloud makes a copy the page can play when it couldn't). */
  playable?: boolean;
}

/** What "Queue …" answers: the project, the takes it made and any notes (a LoRA switched off). */
export interface QueueAnswer {
  project: SwapProject;
  takes: string[];
  notes: string[];
}

/** One mutation per job route, each answering with the project (or, for the queue, the project and the takes). */
function useAction<B, R extends SwapProject | QueueAnswer = SwapProject>(id: string, path: string) {
  const set = useSetProject(id);
  return useMutation({ mutationFn: (b: B) => send<R>(`${base(id)}/${path}`, "POST", b), onSuccess: (r) => set("clips" in r ? r : r.project) });
}

export const useAddClip = (id: string) => useAction<ClipInput>(id, "clips");
export const usePrepareClip = (id: string) => useAction<{ clipId: string }>(id, "prepare");
export const useTranscribe = (id: string) => useAction<{ clipId: string }>(id, "transcribe");
export const useMakeMask = (id: string) =>
  useAction<{ clipId: string; shotId: string; kind: "track" | "frame"; frame: number; points: PixelPoint[]; size?: { width: number; height: number }; base?: string }>(id, "masks");
export const useMakeAnchor = (id: string) => useAction<{ clipId: string; shotId: string; segmentId?: string; modelId?: string; seed?: number }>(id, "anchors");
export const useQueue = (id: string) => useAction<{ clipId: string; shotId: string; segmentId: string; mode: QueueMode }, QueueAnswer>(id, "queue");
export const useStopTake = (id: string) => useAction<{ clipId: string; shotId: string; segmentId: string; takeId: string }>(id, "takes/stop");
export const useStopJob = (id: string) =>
  useAction<{ kind: "mask" | "anchor" | "assembly" | "normalize" | "transcribe"; clipId: string; shotId?: string; segmentId?: string; jobId?: string }>(id, "stop");
export const useAssemble = (id: string) => useAction<{ clipId: string }>(id, "assemble");

/**
 * Genjutsu's "Open in Character Swap Studio": a new project with the character, and the clip added (the clip's
 * problem, if it can't be added, comes back to say on the way in). Answers the project's id.
 */
export async function openInStudio(input: HandOffInput): Promise<{ id: string; problem: string | null }> {
  const h = studioHandOff(input);
  const p = await send<SwapProject>("/api/swap-studio/projects", "POST", h.project);
  if (!h.clip) return { id: p.id, problem: null };
  try {
    await send<SwapProject>(`${base(p.id)}/clips`, "POST", h.clip);
    return { id: p.id, problem: null };
  } catch (e) {
    return { id: p.id, problem: (e as Error).message };
  }
}

/** The Export decisions download link. */
export const decisionsHref = (id: string) => `${base(id)}/decisions`;
