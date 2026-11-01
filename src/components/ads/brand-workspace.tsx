"use client";

import { ArrowLeft, Loader2, MessageCircle, Plus, RefreshCw, Target } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandKitForm, BrandSummary } from "@/components/brand/brand-kit-form";
import { ResearchProgress } from "@/components/brand/research-progress";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { useBrand, useBrandActions, useCreatives } from "@/components/marketing/hooks";
import { MarketingHeader, useMarketingEngine } from "@/components/marketing/shell";
import { AdChat } from "./ad-chat";
import { CreativeGrid } from "./creative-grid";
import { NewAds } from "./new-ads";

type Step = "kit" | "new" | "ads";

const STEPS: { id: Step; label: string }[] = [
  { id: "kit", label: "Brand kit" },
  { id: "new", label: "New ads" },
  { id: "ads", label: "Ads" },
];

function StepFromUrl({ onStep }: { onStep: (s: Step) => void }) {
  const q = useSearchParams();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const s = q.get("step");
    if (s === "kit" || s === "new" || s === "ads") onStep(s);
  }, [q, onStep]);
  return null;
}

/** One brand in Ads Studio: research → review the kit → products and counts → the grid, with the brand chat. */
export function BrandWorkspace({ brandId }: { brandId: string }) {
  const { engine, setEngine } = useMarketingEngine();
  const view = useBrand(brandId);
  const creatives = useCreatives(brandId);
  const actions = useBrandActions(brandId);
  const [step, setStep] = useState<Step | null>(null);
  const [chat, setChat] = useState(false);
  const brand = view.data?.brand;
  // The chat works for any kit that isn't being researched (a canceled or failed research keeps what it found).
  const chatReady = !!brand && brand.status !== "researching";
  const products = view.data?.products ?? [];
  // First visit after the research: review the kit; with ads already made: the grid.
  const current: Step = step ?? (creatives.data?.length ? "ads" : brand?.status === "ready" && !products.length ? "kit" : creatives.isLoading ? "ads" : "kit");
  const wasResearching = useRef(false);
  useEffect(() => {
    if (brand?.status === "researching") wasResearching.current = true;
    else if (wasResearching.current && brand?.status === "ready") {
      wasResearching.current = false;
      setStep("kit");
      toast.success("Your Brand Kit is ready", { description: "Review it — everything here shapes your ads." });
    }
  }, [brand?.status]);

  if (view.error) {
    return (
      <div className="flex min-h-svh flex-col">
        <MarketingHeader title="Ads Studio" active="ads" />
        <div className="mx-auto max-w-md px-4 pt-[14vh] text-center">
          <h2 className="font-heading text-[26px]">This brand isn&apos;t on the shelf</h2>
          <p className="mt-2 text-muted-foreground">It may have been deleted.</p>
          <Button asChild className="mt-6">
            <Link href="/ads">Back to Ads Studio</Link>
          </Button>
        </div>
      </div>
    );
  }

  const chatPanel = (inSheet: boolean) =>
    brand && <AdChat brand={brand} products={products} engine={engine} onBatch={() => (setStep("ads"), setChat(false))} onClose={inSheet ? () => setChat(false) : undefined} className="h-full" />;

  return (
    <div className="flex min-h-svh min-w-0 flex-col">
      <MarketingHeader
        title={brand?.name ?? "Ads Studio"}
        active="ads"
        engine={engine}
        onEngine={setEngine}
        right={
          chatReady ? (
            <Button variant="ghost" size="sm" className="xl:hidden" onClick={() => setChat(true)} aria-label="Open the brand chat">
              <MessageCircle /> <span className="hidden sm:inline">Chat</span>
            </Button>
          ) : null
        }
      />
      <Suspense fallback={null}>
        <StepFromUrl onStep={setStep} />
      </Suspense>
      <div className="mx-auto flex w-full min-w-0 max-w-[1440px] flex-1 gap-6 px-3 pt-5 pb-16 sm:px-6">
        <div className="min-w-0 flex-1">
          <Link href="/ads" className="mb-4 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-3.5" /> All brands
          </Link>
          {!brand ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-72 rounded-xl" />
              <Skeleton className="h-64 rounded-2xl" />
            </div>
          ) : brand.status === "researching" ? (
            <div className="pt-[8vh]">
              <ResearchProgress brand={brand} onCancel={() => actions.cancel.mutate()} canceling={actions.cancel.isPending} />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <BrandSummary brand={brand} />
                <nav aria-label="Steps" className="inline-flex rounded-full bg-muted p-0.5">
                  {STEPS.map((s) => (
                    <button key={s.id} type="button" aria-current={current === s.id ? "step" : undefined} onClick={() => setStep(s.id)} className={cn("h-8 rounded-full px-3.5 text-[13px] font-medium text-muted-foreground", current === s.id && "bg-background text-foreground shadow-soft")}>
                      {s.label}
                      {s.id === "ads" && creatives.data?.length ? <span className="ml-1 font-mono text-[11px] text-muted-foreground">{creatives.data.length}</span> : null}
                    </button>
                  ))}
                </nav>
              </div>
              {(brand.note || brand.error || brand.status === "canceled") && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-highlight/20 px-4 py-3 text-[13px]">
                  <span>{brand.error ?? brand.note ?? "Research canceled — the kit keeps what it found."}</span>
                  {brand.website && (
                    <Button variant="outline" size="sm" onClick={() => actions.retry.mutate(undefined, { onError: (e) => toastError(e) })} disabled={actions.retry.isPending}>
                      {actions.retry.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Retry research
                    </Button>
                  )}
                </div>
              )}
              <div className="mt-5">
                {current === "kit" && (
                  <>
                    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                      <div>
                        <h2 className="font-heading text-[26px] leading-tight">Review your brand kit</h2>
                        <p className="text-[13px] text-muted-foreground">Everything here shapes your ads, so edit anything that&apos;s off.</p>
                      </div>
                      <Button onClick={() => setStep("new")}>
                        Continue to products <Plus />
                      </Button>
                    </div>
                    <BrandKitForm key={brand.id} brand={brand} />
                  </>
                )}
                {current === "new" && <NewAds brand={brand} products={products} engine={engine} onCreated={() => setStep("ads")} />}
                {current === "ads" &&
                  (creatives.isLoading ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {Array.from({ length: 4 }, (_, i) => (
                        <Skeleton key={i} className="aspect-[4/5] rounded-xl" />
                      ))}
                    </div>
                  ) : creatives.data?.length ? (
                    <CreativeGrid brand={brand} products={products} creatives={creatives.data} />
                  ) : (
                    <div className="rounded-2xl border border-dashed px-6 py-14 text-center">
                      <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand-faint text-brand-text">
                        <Target className="size-5" />
                      </div>
                      <p className="mt-4 font-heading text-[22px]">No ads yet</p>
                      <p className="mt-1 text-[13px] text-muted-foreground">Pick products and how many ads to make — or just ask in the chat.</p>
                      <Button className="mt-5" onClick={() => setStep("new")}>
                        <Plus /> Create ads
                      </Button>
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>
        {chatReady && <div className="sticky top-28 hidden h-[calc(100svh-8rem)] w-[340px] shrink-0 xl:block">{chatPanel(false)}</div>}
      </div>
      <Sheet open={chat} onOpenChange={setChat}>
        <SheetContent side="right" showCloseButton={false} className="w-full gap-0 p-0 sm:max-w-md">
          <SheetHeader className="sr-only">
            <SheetTitle>Brand chat</SheetTitle>
            <SheetDescription>Ask for ads in plain words</SheetDescription>
          </SheetHeader>
          <div className="h-full p-2">{chat && chatPanel(true)}</div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
