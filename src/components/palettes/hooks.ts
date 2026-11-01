"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import type { Palette, SignatureCaps } from "@/lib/catalog/palettes";
import { responseError } from "@/lib/refusals";

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw responseError(res, body.error ?? `Request failed (${res.status})`);
  return body;
}

const EMPTY_CAPS: SignatureCaps = { native: {} };

/** Your palettes + the built-ins, and which models take a palette natively. */
export function usePalettes(enabled = true) {
  const q = useQuery({
    queryKey: ["palettes"],
    queryFn: async () => json<{ items: Palette[]; caps: SignatureCaps }>(await fetch("/api/palettes")),
    staleTime: 60_000,
    enabled,
  });
  return { ...q, items: q.data?.items, caps: q.data?.caps ?? EMPTY_CAPS };
}

export function usePaletteActions() {
  const qc = useQueryClient();
  const done = useCallback(() => void qc.invalidateQueries({ queryKey: ["palettes"] }), [qc]);
  const create = useMutation({
    mutationFn: async (body: { name: string; colors: string[]; background?: string | null; source: "manual" | "images"; thumb?: string | null }) =>
      json<Palette>(await fetch("/api/palettes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })),
    onSuccess: done,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/palettes/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) await json(res);
    },
    onSuccess: done,
  });
  return useMemo(() => ({ create, remove }), [create, remove]);
}
