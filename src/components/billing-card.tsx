"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Cpu, ExternalLink, Gauge } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BILLING_EVENT, refreshPriceChecks, safeLink, useInterest, type BillingRefusalDetail } from "@/lib/hosted";

/**
 * One card for a run the billing service refused (x-fuobe-billing; src/server/billing.ts): the service's own words,
 * its link (opened as given) or its offer ("Tell me when"), and the way to run for free on one's own GPU. A changed
 * price shows the new one; Run again sends it. Mounted once, in the app's providers. Public code has no words of its
 * own about prices: they all come from the service.
 */
export function BillingCard() {
  const [refusal, setRefusal] = useState<BillingRefusalDetail | null>(null);
  const [open, setOpen] = useState(false);
  const interest = useInterest();
  const qc = useQueryClient();
  useEffect(() => {
    const onRefusal = (e: Event) => {
      const d = (e as CustomEvent<BillingRefusalDetail>).detail;
      setRefusal(d);
      setOpen(true);
      // A new price (or the balance it was refused for): the composer and the chip ask again.
      refreshPriceChecks(qc);
      void qc.invalidateQueries({ queryKey: ["status"] });
    };
    window.addEventListener(BILLING_EVENT, onRefusal);
    return () => window.removeEventListener(BILLING_EVENT, onRefusal);
  }, [qc]);
  const r = refusal;
  const link = safeLink(r?.action?.url);
  const changed = r?.code === "price-changed";
  const [sending, setSending] = useState(false);
  const runAgain = changed ? r?.runAgain : undefined;
  const sendAgain = async () => {
    if (!runAgain) return;
    setSending(true);
    const started = await runAgain().finally(() => setSending(false));
    if (started) {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["generations"] });
    }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div className="mb-1 grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Gauge className="size-5" />
          </div>
          <DialogTitle>{changed ? "The price changed" : "This run didn't start"}</DialogTitle>
          <DialogDescription>{r?.error}</DialogDescription>
          {changed && r?.quote?.text && (
            <p className="text-[13px] text-muted-foreground">
              Now: <span className="font-medium text-foreground">{r.quote.text}</span>
              {r.quote.sub ? ` · ${r.quote.sub}` : ""}.{runAgain ? "" : " Press Generate again to run it at this price."}
            </p>
          )}
          {r?.offer && <p className="text-[13px] text-muted-foreground">{r.offer.text}</p>}
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button asChild variant="ghost" size="sm" onClick={() => setOpen(false)}>
            <Link href="/connect">
              <Cpu /> Use your own GPU (free)
            </Link>
          </Button>
          <div className="flex gap-2">
            {r?.offer && (
              <Button size="sm" variant="secondary" disabled={interest.isPending} onClick={() => interest.mutate(r.offer!.key, { onSuccess: () => setOpen(false) })}>
                {r.offer.label}
              </Button>
            )}
            {link && r?.action && (
              <Button asChild size="sm">
                <a href={link} target={link.startsWith("/") ? undefined : "_blank"} rel="noopener noreferrer">
                  {r.action.label}
                  {!link.startsWith("/") && <ExternalLink />}
                </a>
              </Button>
            )}
            {runAgain && (
              <Button size="sm" disabled={sending} onClick={() => void sendAgain()}>
                Run at this price
              </Button>
            )}
            {!link && !r?.offer && !runAgain && (
              <Button size="sm" onClick={() => setOpen(false)}>
                OK
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
