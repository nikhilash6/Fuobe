"use client";

import { ArrowRight, Loader2, Plus } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { StepFlow } from "@/components/canvas/template-card";
import { useEngine, useIsOwner } from "@/lib/api";
import { responseError, toastError } from "@/lib/refusals";
import { STARTER_SURFACES, starterHref, starterShown, type StarterCardData } from "@/lib/starters/types";
import { cn } from "@/lib/utils";
import { StarterCard } from "./starter-card";
import { StarterIcon } from "./starter-icon";
import { StepsGlyph } from "./steps-glyph";

/**
 * The owner's "Use template": a starter made on the server (POST /api/starters/<id>) opens where it answers; one that
 * fills a composer fills it here (`onFill`, on its own studio's page) or opens its studio with `?starter=`.
 */
export function useStarterUse(onFill?: (id: string) => void) {
  const router = useRouter();
  const qc = useQueryClient();
  const [engine] = useEngine();
  const [making, setMaking] = useState<string | null>(null);
  // The page it opens may be this one (Click to Ad, Marketing Studio): busy until that address has rendered.
  const [opening, setOpening] = useState<string | null>(null);
  const [navigating, startTransition] = useTransition();
  const use = async (s: StarterCardData) => {
    if (s.use.kind === "fill") {
      if (onFill) onFill(s.id);
      else router.push(s.use.href);
      return;
    }
    setMaking(s.id);
    try {
      const res = await fetch(`/api/starters/${encodeURIComponent(s.id)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engine }) });
      const body = (await res.json().catch(() => ({}))) as { href?: string; error?: string };
      if (!res.ok || !body.href) throw responseError(res, body.error ?? "That starter couldn't be made. Please try again.");
      // What it made (a brand, a product, a channel) is in the lists the next page picks it from, before it opens.
      await Promise.all([qc.invalidateQueries({ queryKey: ["brands"] }), qc.invalidateQueries({ queryKey: ["products"] }), qc.invalidateQueries({ queryKey: ["faceless"] })]);
      const href = body.href;
      setOpening(s.id);
      startTransition(() => router.push(href));
    } catch (e) {
      toastError(e);
    } finally {
      setMaking(null);
    }
  };
  return { use, busy: making ?? (navigating ? opening : null) };
}

/** One starter as a card: the whole card opens its page; the owner's action makes or fills it. */
export function StarterTile({ s, owner, busy, onUse }: { s: StarterCardData; owner: boolean; busy: boolean; onUse: () => void }) {
  return (
    <StarterCard
      coverKey={s.coverKey}
      cover={s.cover}
      hue={s.hue}
      flow={<StepFlow steps={s.flow} />}
      overlay={<StepsGlyph steps={s.steps.length} className="p-6" />}
      icon={<StarterIcon name={s.icon} className="size-4" />}
      title={s.name}
      description={s.description}
      href={starterHref(s)}
      badge={owner && !s.cover ? "No cover yet" : undefined}
      action={
        owner ? (
          <Button size="sm" className="w-fit rounded-full" onClick={onUse} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Plus />} Use template
          </Button>
        ) : (
          <span className="inline-flex items-center gap-1 text-[13px] font-medium text-foreground">
            See how it works <ArrowRight className="size-3.5 transition-transform group-hover/starter:translate-x-0.5" />
          </span>
        )
      }
    />
  );
}

/**
 * A surface's ready-made starters ("Start from a ready channel"…): every one for the owner (a card with no cover yet is
 * marked), only those with their real cover for a guest or an account. Nothing at all when there is none to show.
 * `row`: one short row (the first three, "See all" for the rest), under the person's own work; a snap scroller on a phone.
 */
export function StarterSection({
  starters,
  row = false,
  onFill,
  className,
  headingLevel = "h2",
  narrow = false,
}: {
  starters: StarterCardData[];
  row?: boolean;
  onFill?: (id: string) => void;
  className?: string;
  headingLevel?: "h2" | "h3";
  /** In a narrow column (Explainer's history): two cards a row at most. */
  narrow?: boolean;
}) {
  // Until the viewer is known to be the owner, the page is a visitor's: only starters with their real cover show.
  const owner = useIsOwner();
  const { use, busy } = useStarterUse(onFill);
  const [all, setAll] = useState(false);
  const shown = starters.filter((s) => starterShown(s, !owner));
  if (!shown.length) return null;
  const surface = STARTER_SURFACES[shown[0].surface];
  const items = row && !all ? shown.slice(0, 3) : shown;
  // Two cards or fewer: two columns at most, so no column stands empty beside them.
  const few = items.length <= 2;
  const H = headingLevel;
  return (
    <section id="starters" aria-labelledby="starters-title" className={cn("scroll-mt-20", className)}>
      <div className="mb-3 flex flex-wrap items-end gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <H id="starters-title" className="font-heading text-[24px] leading-tight">
            {surface.section}
          </H>
          <p className="mt-0.5 text-[13px] text-muted-foreground">{surface.note}</p>
        </div>
        {row && shown.length > 3 && (
          <button type="button" onClick={() => setAll((v) => !v)} className="text-[13px] font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
            {all ? "Show fewer" : "See all"}
          </button>
        )}
      </div>
      <div
        className={cn(
          "grid grid-cols-1 gap-4 sm:grid-cols-2",
          !narrow && !few && "lg:grid-cols-3",
          !narrow && few && "lg:max-w-[880px]",
          row && !all && "-mx-3 flex snap-x snap-mandatory overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:overflow-visible sm:px-0 sm:pb-0 [&>*]:w-[78%] [&>*]:shrink-0 [&>*]:snap-start sm:[&>*]:w-auto",
        )}
      >
        {items.map((s) => (
          <StarterTile key={s.id} s={s} owner={owner} busy={busy === s.id} onUse={() => void use(s)} />
        ))}
      </div>
    </section>
  );
}
