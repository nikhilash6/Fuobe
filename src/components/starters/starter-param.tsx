"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * A ready starter opened from its page (`?starter=<id>`): handed to the studio's composer once per id (Content Factory,
 * Explainer). `onStarter` answers whether it filled it: one the page doesn't know yet (the owner's starters still
 * loading) is tried again when it changes. Render it inside a Suspense boundary (it reads the search params).
 */
export function StarterParam({ onStarter }: { onStarter: (id: string) => boolean }) {
  const q = useSearchParams();
  const last = useRef<string | null>(null);
  const id = q.get("starter");
  useEffect(() => {
    if (!id || last.current === id) return;
    if (onStarter(id)) last.current = id;
  }, [id, onStarter]);
  return null;
}
