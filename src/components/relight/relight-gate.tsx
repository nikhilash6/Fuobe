"use client";

import type { ReactNode } from "react";
import { useIsOwner } from "@/lib/api";
import { RelightTool } from "./relight-tool";

/**
 * The Relight app's page: its own tool once that tool's Generate lighting is checked on a GPU (`live`), and for the
 * studio's owner before then; everyone else gets the app's composer (`children`) until it is.
 */
export function RelightGate({ live, app, children }: { live: boolean; app: { name: string; description: string }; children: ReactNode }) {
  const owner = useIsOwner();
  return live || owner ? <RelightTool app={app} /> : <>{children}</>;
}
