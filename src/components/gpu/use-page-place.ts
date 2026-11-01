"use client";

import { useSyncExternalStore } from "react";
import { pagePlace, type PagePlace } from "@/lib/page-place";

const never = () => () => {};

/**
 * Where this page is (lib/page-place.ts): on the server's machine ("here"), its network, or a hosted studio. Null until
 * hydrated (the server's HTML can't know): callers draw a fixed-height placeholder then, never the hosted layout.
 */
export function usePagePlace(): PagePlace | null {
  return useSyncExternalStore(never, () => pagePlace(window.location.hostname), () => null);
}
