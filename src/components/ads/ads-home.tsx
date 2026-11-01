"use client";

import { ArrowRight, Copy, Loader2, MoreHorizontal, Target, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandStart } from "@/components/brand/brand-dialog";
import { SelfHostNote } from "@/components/self-host-note";
import { useIsVisitor } from "@/lib/api";
import { ResearchLabel } from "@/components/brand/research-progress";
import type { BrandKit } from "@/lib/catalog/marketing";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toastError } from "@/lib/refusals";
import { useBrandActions, useBrands } from "@/components/marketing/hooks";
import { MarketingHeader, useMarketingEngine } from "@/components/marketing/shell";

function BrandCard({ brand, onDelete }: { brand: BrandKit; onDelete: () => void }) {
  const accent = brand.colors[0] ?? "#5d4bdb";
  const researching = brand.status === "researching";
  return (
    <div className="group/brand relative animate-fade-up">
      <Link href={`/ads/${brand.id}`} className="block rounded-2xl border bg-background p-3 outline-none transition-shadow hover:shadow-soft focus-visible:ring-2 focus-visible:ring-ring">
        <div className="relative flex aspect-[16/9] items-center justify-center overflow-hidden rounded-xl" style={{ background: `linear-gradient(135deg, ${accent}, ${brand.colors[1] ?? accent})` }}>
          <div className="grid h-16 w-32 place-items-center rounded-xl bg-white/90 p-2 shadow-soft">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {brand.logo ? <img src={brand.logo} alt="" className="max-h-full max-w-full object-contain" /> : <span className="truncate text-[18px] font-semibold text-black">{brand.name}</span>}
          </div>
          {researching && (
            <span className="absolute inset-x-2 bottom-2 flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
              <Loader2 className="size-3 animate-spin" /> <ResearchLabel progress={brand.progress} />…
            </span>
          )}
        </div>
        <div className="mt-2.5 min-w-0 px-0.5">
          <h3 className="truncate text-[15px] font-medium">{brand.name}</h3>
          <p className="truncate text-[12px] text-muted-foreground">
            {researching ? "Researching…" : brand.status === "failed" ? "Research incomplete — open to retry" : `${brand.productCount ?? 0} product${brand.productCount === 1 ? "" : "s"} · ${brand.adCount ?? 0} ad${brand.adCount === 1 ? "" : "s"}`} · {timeAgo(brand.updatedAt)}
          </p>
          <div className="mt-1.5 flex gap-1">
            {brand.colors.slice(0, 6).map((c) => (
              <span key={c} className="size-3 rounded-full border" style={{ background: c }} />
            ))}
          </div>
        </div>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="absolute top-5 right-5 grid size-8 place-items-center rounded-full bg-black/45 text-white opacity-100 backdrop-blur hover:bg-black/65 focus-visible:opacity-100 data-[state=open]:opacity-100 sm:opacity-0 sm:group-hover/brand:opacity-100" aria-label={`${brand.name} actions`}>
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/ads/${brand.id}?step=kit`}>Brand settings</Link>
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function DeleteBrand({ brand, onClose }: { brand: BrandKit | null; onClose: () => void }) {
  const actions = useBrandActions(brand?.id ?? "");
  return (
    <AlertDialog open={!!brand} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {brand?.name}?</AlertDialogTitle>
          <AlertDialogDescription>“{brand?.name}” leaves the shelf with its kit and its products. Ads already made with it stay in your Library.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>No, keep it</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={() =>
              actions.remove.mutate(undefined, {
                onSuccess: () => toast("Brand deleted", { duration: 1500 }),
                onError: (e) => toastError(e),
              })
            }
          >
            Yes, delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Ads Studio home: start from a website (or by hand), and the brand shelf. */
export function AdsHome() {
  const router = useRouter();
  const { engine, setEngine } = useMarketingEngine();
  const brands = useBrands();
  const [deleting, setDeleting] = useState<BrandKit | null>(null);
  // A brand is saved to the studio's library, which is its owner's: a guest or an account is told so, not given the form.
  const visitor = useIsVisitor();
  return (
    <div className="flex min-h-svh min-w-0 flex-col">
      <MarketingHeader title="Ads Studio" active="ads" engine={engine} onEngine={setEngine} />
      <div className="mx-auto w-full min-w-0 max-w-[1240px] flex-1 px-3 pb-20 sm:px-6">
        <section className="mx-auto max-w-[720px] pt-8 text-center sm:pt-14">
          <h2 className="font-heading text-display text-balance">Create performing static ads</h2>
          <p className="mx-auto mt-2 max-w-lg text-[15px] text-muted-foreground">Enter your website. Your logo, colours, brand voice and selling points load on their own — then on-brand ads for every product, in 1:1, 4:5 and 9:16, with headlines and CTAs.</p>
          <div className="mx-auto mt-6 max-w-[620px] rounded-[20px] border bg-background p-3 text-left shadow-soft sm:rounded-composer sm:p-4">
            {visitor ? (
              <SelfHostNote className="p-1 text-[14px]">Brand kits aren&apos;t on free accounts yet. Free accounts can use the Image, Video and Audio studios, camera motions, effects and apps.</SelfHostNote>
            ) : (
              <BrandStart onDone={(b) => router.push(`/ads/${b.id}`)} />
            )}
          </div>
        </section>

        <section className="mt-14">
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
            <h2 className="font-heading text-[24px] whitespace-nowrap">Your brands</h2>
            <span className="text-[12px] text-muted-foreground">Every brand gets its own research, products and ads</span>
          </div>
          {brands.isLoading ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 3 }, (_, i) => (
                <Skeleton key={i} className="aspect-[4/3] rounded-2xl" />
              ))}
            </div>
          ) : brands.data?.length ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {brands.data.map((b) => (
                <BrandCard key={b.id} brand={b} onDelete={() => setDeleting(b)} />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
              <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-brand-faint text-brand-text">
                <Target className="size-5" />
              </div>
              <p className="mt-4 text-[15px] font-medium">No brands yet</p>
              {!visitor && <p className="mt-1 text-[13px] text-muted-foreground">Paste a link or create one manually to get started.</p>}
            </div>
          )}
        </section>

        <section className="mt-12 grid gap-4 md:grid-cols-2">
          <Link href="/ads/multiplier" className={cn("group flex items-center gap-4 rounded-2xl border bg-background p-4 transition-shadow hover:shadow-soft")}>
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-faint text-brand-text">
              <Copy className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium">Try Ad Multiplier</span>
              <span className="block text-[13px] text-muted-foreground">Recreate an ad you like with your products and characters</span>
            </span>
            <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link href="/marketing/click-to-ad" className="group flex items-center gap-4 rounded-2xl border bg-background p-4 transition-shadow hover:shadow-soft">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-faint text-brand-text">
              <Target className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium">Need a video ad?</span>
              <span className="block text-[13px] text-muted-foreground">Click to Ad turns a product link into a 9:16 ad with voiceover</span>
            </span>
            <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        </section>
      </div>
      <DeleteBrand brand={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}
