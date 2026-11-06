"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { researchLabel, researchProgress, type BrandKit } from "@/lib/catalog/marketing";

/** The clock, ticking every `every` ms (rotating labels). */
function useNow(every: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

/** Just the current research label (a brand card's badge). */
export function ResearchLabel({ progress }: { progress: BrandKit["progress"] }) {
  const now = useNow(1500);
  return <>{researchLabel(progress, now).label}</>;
}

/** "Usually takes about a minute": the parity studio's rotating research labels, a progress bar and Cancel. */
export function ResearchProgress({ brand, onCancel, canceling }: { brand: BrandKit; onCancel?: () => void; canceling?: boolean }) {
  const now = useNow(700);
  const { label } = researchLabel(brand.progress, now);
  const host = brand.website ? new URL(brand.website).hostname.replace(/^www\./, "") : brand.name;
  return (
    <div role="status" aria-live="polite" className="mx-auto w-full max-w-md text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-brand-faint text-brand-text">
        <Sparkles className="size-6 animate-pulse" />
      </div>
      <h2 className="mt-5 font-heading text-[26px] leading-tight">Researching {host}</h2>
      <p className="mt-1 text-[14px] text-muted-foreground">Usually takes about a minute. You can leave this page — it keeps going.</p>
      <Progress value={researchProgress(brand.progress, now)} className="mt-6 h-1.5" aria-label="Research progress" />
      <p key={label} className="mt-3 animate-fade-up text-[13px] font-medium">
        <span className="shimmer-text animate-shimmer-text">{label}…</span>
      </p>
      {onCancel && (
        <Button variant="ghost" size="sm" className="mt-5 text-muted-foreground" onClick={onCancel} disabled={canceling}>
          {canceling && <Loader2 className="animate-spin" />} Cancel research
        </Button>
      )}
    </div>
  );
}
