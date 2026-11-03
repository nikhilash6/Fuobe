"use client";

import { Images, UserRoundPlus } from "lucide-react";
import Link from "next/link";
import { useStudio } from "@/components/studio/studio-context";
import { ROW_GAP, ROW_HEADING } from "@/components/examples/example-row-frame";
import { SOUL_MODEL_IDS } from "@/lib/catalog/soul-cards";
import { cn } from "@/lib/utils";

/** The models the cards show for: Fuobe Soul and Soul HD, which take your own look (Soul Cinema has one fixed look). */
const TAKES_OWN_LOOK = new Set<string>([SOUL_MODEL_IDS.soul, SOUL_MODEL_IDS.hd]);

/**
 * The empty Image studio on Fuobe Soul: two cards for a look of your own — a character (Character Sheet, then a
 * Fuobe Soul ID from its page) and a moodboard (trained as a style LoRA). Kept free of the moodboard logic (and the
 * look list it imports): every studio page loads it. It sits in the composer's column, its heading styled like the
 * example row's.
 */
export function SoulPresetCards({ className }: { className?: string }) {
  const { draft } = useStudio();
  if (!TAKES_OWN_LOOK.has(draft.modelId)) return null;
  const card =
    "group flex min-w-0 items-center gap-3 rounded-2xl border bg-background p-3 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50";
  return (
    <section aria-label="Make your own Soul look" className={cn("w-full", className)}>
      <p className={ROW_HEADING}>Make your own Soul look</p>
      <div className={cn("grid sm:grid-cols-2", ROW_GAP)}>
        <Link href="/character-sheet" className={card}>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-faint text-brand-text">
            <UserRoundPlus className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13.5px] font-medium">Make your own character</span>
            <span className="block truncate text-[12px] text-muted-foreground">A consistent face for every shot — train a Soul ID from it</span>
          </span>
        </Link>
        <Link href="/moodboards?create=1" className={card}>
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-faint text-brand-text">
            <Images className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13.5px] font-medium">Create your moodboard</span>
            <span className="block truncate text-[12px] text-muted-foreground">20+ photos, one cohesive style, no faces.</span>
          </span>
        </Link>
      </div>
    </section>
  );
}
