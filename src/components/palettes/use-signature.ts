"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { applySignature, withSignatureWords, type Signature, type SignedRequest } from "@/lib/catalog/palettes";
import type { Generation, GenerationRequest } from "@/lib/catalog/types";
import { useIsVisitor } from "@/lib/api";
import { responseError } from "@/lib/refusals";
import { useCatalog } from "@/components/studio/catalog";
import { usePalettes } from "./hooks";

/**
 * The composer's hook for the style signature (Color signature + Moodboard chips): `apply` routes a
 * request for the picked palette and moodboard (pure, src/lib/catalog/palettes.ts) — the composer
 * plans and prices with it while you type and sends what it returns. `lock` sends a run whose
 * images are recolored afterwards (open engine) through POST /api/palettes/lock: the owner's only, so a
 * guest's or a free account's request never carries a lock.
 */
export function useSignature(enabled: boolean, signature: Signature | undefined) {
  const { getModel } = useCatalog();
  // The palette list carries which models take a palette natively; the chip has usually loaded it already.
  const { caps } = usePalettes(enabled && !!signature?.palette);
  const visitor = useIsVisitor();
  const apply = useCallback(
    (req: GenerationRequest): SignedRequest & { worded: GenerationRequest } => {
      const signed = enabled && signature ? applySignature(req, signature, { caps, getModel, visitor }) : { request: req, modelId: req.modelId, notes: [] };
      // `request` is what's sent (the user's words in `prompt`); `worded` is how it runs, for planning and pricing.
      return { ...signed, worded: withSignatureWords(signed.request) };
    },
    [enabled, signature, caps, getModel, visitor],
  );
  const qc = useQueryClient();
  const lock = useMutation({
    mutationFn: async (b: { request: GenerationRequest; colors: string[] }) => {
      const res = await fetch("/api/palettes/lock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
      const body = (await res.json().catch(() => ({}))) as { items?: Generation[]; error?: string };
      if (!res.ok) throw responseError(res, body.error ?? "Something went wrong. Please try again.");
      return body.items ?? [];
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["generations"] }),
  });
  return { apply, lock };
}
