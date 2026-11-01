"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGenerationEvents } from "@/lib/api";
import type { Generation } from "@/lib/catalog/types";

const busy = (g?: Generation | null) => !!g && (g.status === "queued" || g.status === "running");

/** One generation, kept fresh by the shared live stream (and polling while it renders without it). */
export function useGeneration(id: string | null | undefined) {
  const qc = useQueryClient();
  const connected = useGenerationEvents((ev) => {
    if (id && ev.type === "generation" && ev.generation.id === id) qc.setQueryData(["generation", id], ev.generation);
  });
  return useQuery({
    queryKey: ["generation", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await fetch(`/api/generations/${id}`);
      if (!res.ok) throw new Error(res.status === 404 ? "That result is gone" : "Something went wrong. Please try again.");
      return (await res.json()) as Generation;
    },
    retry: (n, e) => n < 2 && (e as Error).message !== "That result is gone",
    refetchInterval: (q) => (busy(q.state.data) ? (connected ? 8000 : 1500) : false),
  });
}

/** Several generations by id (Katana steps, 3D results), refreshed the same way. */
export function useGenerationList(ids: string[]) {
  const qc = useQueryClient();
  const key = ids.join(",");
  const connected = useGenerationEvents((ev) => {
    if (ev.type === "generation" && ids.includes(ev.generation.id)) void qc.invalidateQueries({ queryKey: ["generation-list", key] });
  });
  return useQuery({
    queryKey: ["generation-list", key],
    enabled: ids.length > 0,
    queryFn: async () => {
      const all = await Promise.all(ids.map(async (id) => (await fetch(`/api/generations/${id}`)).json().catch(() => null) as Promise<Generation | null>));
      return all.filter((g): g is Generation => !!g && typeof g === "object" && "id" in g);
    },
    refetchInterval: (q) => (q.state.data?.some(busy) ? (connected ? 8000 : 1500) : false),
  });
}
