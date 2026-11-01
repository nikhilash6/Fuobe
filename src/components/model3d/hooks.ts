"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { GenerationRequest } from "@/lib/catalog/types";
import { responseError } from "@/lib/refusals";

/** What /api/generations?preview=1 says a request would run as (the parts the page shows). */
export interface RunPreview {
  costUsd: number | null;
  demo: boolean;
  providerId: string;
  modelName: string;
  engine: "cloud" | "open";
  notes?: string[];
}

/** The value once it has stopped changing for `ms` (typing doesn't price every key). */
function useSettled<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The price and route of a request before it runs (null: nothing to price yet). */
export function useRunPreview(req: GenerationRequest | null) {
  const body = useSettled(req ? JSON.stringify(req) : null);
  return useQuery({
    queryKey: ["model3d-preview", body],
    enabled: !!body,
    retry: false,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch("/api/generations?preview=1", { method: "POST", headers: { "Content-Type": "application/json" }, body: body! });
      const j = (await res.json().catch(() => ({}))) as RunPreview & { error?: string };
      if (!res.ok) throw responseError(res, j.error ?? "Something went wrong. Please try again.");
      return j;
    },
  });
}

/** "≈ $0.38", "Free on your GPU", "Placeholder · nothing is charged" (null: not known yet). */
export function priceLine(p: RunPreview | undefined): string | null {
  if (!p) return null;
  if (p.demo) return "Placeholder · nothing is charged";
  if (p.engine === "open" || p.costUsd === 0) return "Free";
  if (p.costUsd === null) return "Billed by your provider";
  const usd = p.costUsd < 0.01 ? "<$0.01" : `$${p.costUsd < 1 ? p.costUsd.toFixed(3).replace(/0$/, "") : p.costUsd.toFixed(2)}`;
  return `≈ ${usd}, paid to ${p.providerId === "replicate" ? "Replicate" : "fal.ai"}`;
}
