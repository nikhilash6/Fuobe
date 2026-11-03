"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BookmarkPlus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useIsVisitor } from "@/lib/api";
import type { SkillSuggestion } from "@/lib/skill-insights";
import { useSkillBuilder } from "./skill-builder-provider";

/**
 * Above the Library's grid (All, package W6): a chain of steps made 3 or more times in two weeks, offered as a skill. Make a
 * skill opens the review screen with the newest run's steps; Not now hides it for a week; Don't suggest this hides it for
 * good. The owner's only: a visitor's Library has none.
 */
export function SkillSuggestions() {
  const visitor = useIsVisitor();
  const builder = useSkillBuilder();
  const qc = useQueryClient();
  const [hidden, setHidden] = useState<string[]>([]);
  const q = useQuery({
    queryKey: ["skill-suggestions"],
    enabled: !visitor,
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await fetch("/api/skill-suggestions");
      if (!res.ok) return [] as SkillSuggestion[];
      return ((await res.json()) as { items: SkillSuggestion[] }).items;
    },
  });
  const s = (q.data ?? []).find((x) => !hidden.includes(x.id));
  if (visitor || !s || !builder) return null;
  const dismiss = (how: "later" | "never") => {
    setHidden((h) => [...h, s.id]);
    void fetch("/api/skill-suggestions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id, how }) }).then(() => qc.invalidateQueries({ queryKey: ["skill-suggestions"] }));
  };
  return (
    <section aria-label="A skill to save" className="mt-1 flex w-full flex-col gap-3 rounded-2xl border bg-brand-faint/40 px-4 py-3 sm:flex-row sm:items-center" data-skill-suggestion={s.id}>
      <BookmarkPlus className="hidden size-5 shrink-0 text-brand-text sm:block" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium break-words">
          You&apos;ve made “{s.words}” {s.count} times. Save it as a skill?
        </p>
        <p className="text-[12px] text-muted-foreground">
          {s.demo ? "Made from placeholder results: it hasn't made a real result yet. " : ""}A skill runs the same steps again with new inputs, priced first.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button size="sm" onClick={() => builder.open(s.ids)}>
          <BookmarkPlus /> Make a skill
        </Button>
        <Button size="sm" variant="ghost" onClick={() => dismiss("later")}>
          Not now
        </Button>
        <Button size="sm" variant="ghost" onClick={() => dismiss("never")}>
          <X /> Don&apos;t suggest this
        </Button>
      </div>
    </section>
  );
}
