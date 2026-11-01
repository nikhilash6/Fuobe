"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Generation } from "@/lib/catalog/types";
import { responseError } from "@/lib/refusals";

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw responseError(res, body.error ?? `Request failed (${res.status})`);
  return body;
}

const post = async <T,>(url: string, body: unknown) => json<T>(await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

export interface RunPreview {
  modelId?: string;
  modelName?: string;
  count?: number;
  costUsd?: number | null;
  demo?: boolean;
  /** The model keeps the input photo's shape (no aspect ratio setting: Qwen-Image-Edit, try-on). */
  fixedAspect?: boolean;
  notes: string[];
  error?: string;
}

export interface UserPack {
  id: string;
  name: string;
  refs: string[];
  createdAt: number;
}

/** What a run would make and cost, priced on the server (`body` null = nothing to price yet). */
export function useRunPreview(url: string, body: unknown | null) {
  return useQuery({
    queryKey: ["run-preview", url, body],
    queryFn: () => post<RunPreview>(`${url}?preview=1`, body),
    enabled: body !== null,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

/** Start a run; its generations appear in the feeds through the live stream. */
export function useRun<B>(url: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: B) => post<{ batchId?: string; items: Generation[]; notes?: string[] }>(url, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["generations"] });
      void qc.invalidateQueries({ queryKey: ["library"] });
    },
  });
}

/** Retry a failed photo inside its run (same batch); the failed one goes to the Trash. */
export function useRetryPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => post<{ items: Generation[] }>("/api/photodump/retry", { id }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["generations"] });
      void qc.invalidateQueries({ queryKey: ["library"] });
    },
  });
}

export function useUserPacks() {
  return useQuery({ queryKey: ["photodump-packs"], queryFn: async () => (await json<{ packs: UserPack[] }>(await fetch("/api/photodump/packs"))).packs });
}

export function usePackActions() {
  const qc = useQueryClient();
  const done = () => void qc.invalidateQueries({ queryKey: ["photodump-packs"] });
  const create = useMutation({ mutationFn: (b: { name: string; refs: string[] }) => post<UserPack>("/api/photodump/packs", b), onSuccess: done });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/photodump/packs/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) await json(res);
    },
    onSuccess: done,
  });
  return { create, remove };
}
