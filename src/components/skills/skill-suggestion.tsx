"use client";

import { Sparkles } from "lucide-react";
import { useSkillSuggestions, useSuggestionActions } from "@/components/assist/hooks";
import { Button } from "@/components/ui/button";
import { shapeWords } from "@/lib/recipe";
import { toastError } from "@/lib/refusals";

/**
 * The Library's "Save it as a skill?" card (Skills W6): a chain the owner made SUGGEST_RULE.runs times lately that no
 * saved skill has. Make a skill opens the builder (W2) with the newest run's results; Not now puts it off for a week;
 * Don't suggest this never shows it again. One card at a time, the most made first.
 */
export function SkillSuggestionCard({ onMake }: { onMake: (ids: string[]) => void }) {
  const list = useSkillSuggestions(true);
  const actions = useSuggestionActions();
  const s = list.data?.[0];
  if (!s) return null;
  const dismiss = (action: "later" | "dismiss") => actions.dismiss(s.shape, action).catch((e) => toastError(e));
  return (
    <section aria-label="A skill to save" className="mb-4 flex w-full flex-col gap-3 rounded-xl border bg-card px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-faint text-brand-text" aria-hidden>
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] leading-snug font-medium break-words">
            You&apos;ve made &lsquo;{shapeWords(s.labels)}&rsquo; {s.count} times. Save it as a skill?
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {s.demo ? "Made with demo results so far. " : ""}A skill runs the same steps again with new inputs, priced before it starts.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end">
        <Button size="sm" onClick={() => onMake(s.ids)}>
          Make a skill
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void dismiss("later")}>
          Not now
        </Button>
        <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => void dismiss("dismiss")}>
          Don&apos;t suggest this
        </Button>
      </div>
    </section>
  );
}
