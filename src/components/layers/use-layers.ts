"use client";

import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useRef } from "react";
import { useGenerationEvents } from "@/lib/api";
import type { LayerDoc, LayerJob, LayerJobInput, LayerProject, LayerProjectView } from "@/lib/layers";
import { responseError } from "@/lib/refusals";

/** Client hooks for /api/layers (kept next to the Layers UI; the shapes live in src/lib/layers.ts). */

export class LayersRequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw responseError(res, new LayersRequestError(body.error ?? `Request failed (${res.status})`, res.status));
  return body;
}

const send = (url: string, method: string, body?: unknown, init?: RequestInit) =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), ...init });

const isActive = (j: LayerJob) => j.state === "pending" && (!j.result || j.result.status === "queued" || j.result.status === "running");

export function useLayerProjects() {
  return useQuery({
    queryKey: ["layers"],
    queryFn: async () => (await json<{ items: LayerProject[] }>(await fetch("/api/layers"))).items,
    refetchInterval: (q) => (q.state.data?.some((p) => p.status === "processing") ? 4000 : false),
  });
}

/**
 * One project with its tools' jobs. Polls while a job renders (slowly when the app's shared live
 * stream is connected, which also refetches as soon as one of its generations changes).
 */
export function useLayerProject(id: string) {
  const qc = useQueryClient();
  const ids = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const live = useGenerationEvents(
    useCallback(
      (ev) => {
        const gid = ev.type === "generation" ? ev.generation.id : ev.id;
        if (!ids.current.has(gid)) return;
        // Coalesce bursts (progress ticks) into one refetch.
        if (timer.current) return;
        timer.current = setTimeout(() => {
          timer.current = null;
          void qc.invalidateQueries({ queryKey: ["layers", id], exact: true });
        }, 250);
      },
      [qc, id],
    ),
  );
  return useQuery({
    queryKey: ["layers", id],
    queryFn: async () => {
      const v = await json<LayerProjectView>(await fetch(`/api/layers/${id}`));
      ids.current = new Set(v.jobs.filter((j) => j.state === "pending").flatMap((j) => j.generationIds));
      return v;
    },
    refetchInterval: (q) => (q.state.data?.jobs.some(isActive) ? (live ? 8000 : 1500) : false),
    // The editor owns the document once loaded; refetches only bring jobs and versions.
    refetchOnWindowFocus: false,
    retry: (n, e) => !(e instanceof LayersRequestError && e.status === 404) && n < 1,
  });
}

export function useLayerActions() {
  const qc = useQueryClient();
  return useMemo(() => layerActions(qc), [qc]);
}

function layerActions(qc: QueryClient) {
  const refreshList = () => void qc.invalidateQueries({ queryKey: ["layers"], exact: true });
  return {
    create: async (body: { source: string; width: number; height: number; name?: string; generationId?: string }) => {
      const v = await json<LayerProjectView>(await send("/api/layers", "POST", body));
      qc.setQueryData(["layers", v.project.id], v);
      refreshList();
      return v;
    },
    rename: async (id: string, name: string) => {
      qc.setQueryData<LayerProject[]>(["layers"], (old) => old?.map((p) => (p.id === id ? { ...p, name } : p)));
      qc.setQueryData<LayerProjectView>(["layers", id], (old) => (old ? { ...old, project: { ...old.project, name } } : old));
      await json<LayerProject>(await send(`/api/layers/${id}`, "PATCH", { name }));
      refreshList();
    },
    remove: async (id: string) => {
      qc.setQueryData<LayerProject[]>(["layers"], (old) => old?.filter((p) => p.id !== id));
      const res = await fetch(`/api/layers/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw responseError(res, "Couldn't delete this project. Please try again.");
      qc.removeQueries({ queryKey: ["layers", id] });
      refreshList();
    },
    /** A milestone version (a tool's result, `jobId` marks it applied) or a restore (`from`). */
    version: async (id: string, body: { doc?: LayerDoc; label?: string; jobId?: string; from?: string }) => {
      const v = await json<LayerProjectView>(await send(`/api/layers/${id}/versions`, "POST", body));
      qc.setQueryData(["layers", id], v);
      refreshList();
      return v;
    },
    startJob: async (id: string, input: LayerJobInput) => {
      const job = await json<LayerJob>(await send(`/api/layers/${id}/jobs`, "POST", input));
      qc.setQueryData<LayerProjectView>(["layers", id], (old) => (old ? { ...old, jobs: [...old.jobs, job] } : old));
      void qc.invalidateQueries({ queryKey: ["layers", id], exact: true });
      refreshList();
      return job;
    },
    endJob: async (id: string, jobId: string, how: "dismiss" | "cancel" | "applied") => {
      const res = how === "cancel" ? await fetch(`/api/layers/${id}/jobs/${jobId}`, { method: "DELETE" }) : await send(`/api/layers/${id}/jobs/${jobId}`, "PATCH", { state: how === "applied" ? "applied" : "dismissed" });
      const job = await json<LayerJob>(res);
      qc.setQueryData<LayerProjectView>(["layers", id], (old) => (old ? { ...old, jobs: old.jobs.map((j) => (j.id === jobId ? job : j)) } : old));
      refreshList();
      return job;
    },
  };
}

/** Refresh the project card's cover (a small data URL of the composite). */
export async function saveCover(id: string, cover: string): Promise<void> {
  await json<LayerProject>(await send(`/api/layers/${id}`, "PATCH", { cover }));
}

/** Autosave the document into the head version. `keepalive` lets a save started while leaving the page finish. */
export async function saveDoc(id: string, doc: LayerDoc, versionId: string, keepalive = false): Promise<LayerProject> {
  return json<LayerProject>(await send(`/api/layers/${id}`, "PATCH", { doc, versionId }, { keepalive }));
}
