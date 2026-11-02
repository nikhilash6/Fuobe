"use client";

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { DraftSource } from "@/components/assist/hooks";

/**
 * "Make a skill" from anywhere under the studio layout (the result ⋯ menu in the Library, the feeds and the viewer; the
 * Library's bulk bar). The review screen loads the first time it opens, not with every page.
 */
interface SkillBuilderApi {
  /** Draft a skill from these results (Library ids). */
  open: (ids: string[]) => void;
  /** Draft a skill from an Assist chat: the plans that ran in it (W3, "Save as skill"). */
  openChat: (thread: string) => void;
}

const Ctx = createContext<SkillBuilderApi | null>(null);

/** Make a skill from results (null outside the studio layout). */
export const useSkillBuilder = () => useContext(Ctx);

const SkillBuilder = dynamic(() => import("./skill-builder").then((m) => m.SkillBuilder), { ssr: false });

export function SkillBuilderProvider({ children }: { children: React.ReactNode }) {
  const [source, setSource] = useState<DraftSource | null>(null);
  // After a menu has closed and handed focus back, so the dialog keeps it.
  const open = useCallback((list: string[]) => void setTimeout(() => list.length && setSource({ generations: [...new Set(list)] }), 0), []);
  const openChat = useCallback((thread: string) => void setTimeout(() => setSource({ thread }), 0), []);
  const api = useMemo(() => ({ open, openChat }), [open, openChat]);
  return (
    <Ctx.Provider value={api}>
      {children}
      {source && <SkillBuilder key={"thread" in source ? `chat:${source.thread}` : source.generations.join(",")} source={source} onClose={() => setSource(null)} />}
    </Ctx.Provider>
  );
}
