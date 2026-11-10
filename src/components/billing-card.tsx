"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Cpu, ExternalLink, Gauge, Info, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useStatus } from "@/lib/api";
import { BILLING_EVENT, refreshPriceChecks, safeLink, useInterest, waitUntilReady, type BillingRefusalDetail } from "@/lib/hosted";
import { cn } from "@/lib/utils";

/**
 * One card for a run the billing service refused (x-fuobe-billing; src/server/billing.ts): the service's own words,
 * its link (opened as given) or its offer ("Tell me when"), and the way to run for free on one's own GPU. A changed
 * price shows the new one; Run again sends it. Mounted once, in the app's providers. Public code has no words of its
 * own about prices: they all come from the service.
 *
 * The service may also set the card's heading (`title`), a friendly look (`tone: "info"`: an info icon, no other place
 * offered), more links (`links`), and an address to wait on (`waitFor`): while the card is open it asks that address
 * every few seconds (10 minutes at most), and once it answers ready, the card says so and sends the same run again by
 * itself, as a new press. Links open in a new tab then, so the waiting card stays.
 */
export function BillingCard() {
  const [refusal, setRefusal] = useState<BillingRefusalDetail | null>(null);
  const [open, setOpen] = useState(false);
  /** waitFor: asking, ready (the run is being sent), or none. */
  const [phase, setPhase] = useState<"none" | "waiting" | "ready">("none");
  const interest = useInterest();
  const qc = useQueryClient();
  useEffect(() => {
    const onRefusal = (e: Event) => {
      const d = (e as CustomEvent<BillingRefusalDetail>).detail;
      setRefusal(d);
      setPhase(d.waitFor && d.runFresh ? "waiting" : "none");
      setOpen(true);
      // A new price (or the balance it was refused for): the composer and the chip ask again.
      refreshPriceChecks(qc);
      void qc.invalidateQueries({ queryKey: ["status"] });
    };
    window.addEventListener(BILLING_EVENT, onRefusal);
    return () => window.removeEventListener(BILLING_EVENT, onRefusal);
  }, [qc]);
  const r = refusal;
  // While the card is open and waiting: ask the service's address; once ready, send the run once more by itself.
  useEffect(() => {
    if (!open || phase !== "waiting" || !r?.waitFor || !r.runFresh) return;
    const stop = new AbortController();
    const run = r.runFresh;
    void waitUntilReady(r.waitFor.url, r.waitFor.everyMs, { signal: stop.signal }).then(async (ready) => {
      if (!ready || stop.signal.aborted) return;
      setPhase("ready");
      const started = await run();
      if (started) {
        void qc.invalidateQueries({ queryKey: ["generations"] });
        setTimeout(() => setOpen(false), 1200);
      } else setPhase("none");
    });
    return () => stop.abort();
  }, [open, phase, r, qc]);
  const link = safeLink(r?.action?.url);
  const changed = r?.code === "price-changed";
  const info = r?.tone === "info";
  const waits = phase !== "none";
  const [sending, setSending] = useState(false);
  const runAgain = changed ? r?.runAgain : undefined;
  // Hosted runs: the way to the account's own GPU says what it does. Connected: the same run, sent there now; else the
  // way to connect one. (Off hosted runs: as it always was.)
  const viewer = useStatus().data?.viewer;
  const hosted = !!viewer?.hosted && viewer.kind === "account";
  const runOwn = hosted && viewer.gpu.connected ? r?.runOwn : undefined;
  const sendAgain = async (send = runAgain) => {
    if (!send) return;
    setSending(true);
    const started = await send().finally(() => setSending(false));
    if (started) {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["generations"] });
    }
  };
  /** A service link as a button: same-site in this tab, unless the card waits (a new tab keeps it), else a new tab. */
  const linkButton = (a: { label: string; url: string }, variant: "default" | "secondary", key?: string) => {
    const href = safeLink(a.url);
    if (!href) return null;
    const local = href.startsWith("/");
    return (
      <Button key={key} asChild size="sm" variant={variant} className={cn(info && "w-full sm:w-auto")}>
        <a href={href} target={local && !waits ? undefined : "_blank"} rel="noopener noreferrer">
          {a.label}
          {!local && <ExternalLink />}
        </a>
      </Button>
    );
  };
  const extra = (r?.links ?? []).slice(0, 2);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <div
            className={cn(
              "mb-1 grid size-10 place-items-center rounded-xl",
              phase === "ready" ? "bg-brand-faint text-brand-text" : info ? "bg-brand-faint text-brand-text" : "bg-primary text-primary-foreground",
            )}
          >
            {phase === "ready" ? <Check className="size-5" /> : info ? <Info className="size-5" /> : <Gauge className="size-5" />}
          </div>
          <DialogTitle>{phase === "ready" ? "All set" : changed ? "The price changed" : (r?.title ?? "This run didn't start")}</DialogTitle>
          <DialogDescription>{phase === "ready" ? "Starting your run…" : r?.error}</DialogDescription>
          {changed && r?.quote?.text && (
            <p className="text-[13px] text-muted-foreground">
              Now: <span className="font-medium text-foreground">{r.quote.text}</span>
              {r.quote.sub ? ` · ${r.quote.sub}` : ""}.{runAgain ? "" : " Press Generate again to run it at this price."}
            </p>
          )}
          {r?.offer && <p className="text-[13px] text-muted-foreground">{r.offer.text}</p>}
          {phase === "waiting" && (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
              <Loader2 className="size-3.5 animate-spin" /> Waiting
            </p>
          )}
        </DialogHeader>
        {phase !== "ready" &&
          (info ? (
            <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
              {extra.map((a, i) => linkButton(a, "default", `l${i}`))}
              {link && r?.action && linkButton(r.action, extra.length ? "secondary" : "default")}
              {!link && !extra.length && (
                <Button size="sm" onClick={() => setOpen(false)}>
                  OK
                </Button>
              )}
            </DialogFooter>
          ) : (
            <DialogFooter className="gap-2 sm:justify-between">
              {runOwn ? (
                <Button variant="ghost" size="sm" disabled={sending} onClick={() => void sendAgain(runOwn)}>
                  <Cpu /> Run on your GPU
                </Button>
              ) : (
                <Button asChild variant="ghost" size="sm" onClick={() => setOpen(false)}>
                  <Link href="/connect">
                    <Cpu /> {hosted ? "Connect your GPU" : "Use your own GPU (free)"}
                  </Link>
                </Button>
              )}
              <div className="flex gap-2">
                {r?.offer && (
                  <Button size="sm" variant="secondary" disabled={interest.isPending} onClick={() => interest.mutate(r.offer!.key, { onSuccess: () => setOpen(false) })}>
                    {r.offer.label}
                  </Button>
                )}
                {extra.map((a, i) => linkButton(a, "secondary", `l${i}`))}
                {link && r?.action && linkButton(r.action, "default")}
                {runAgain && (
                  <Button size="sm" disabled={sending} onClick={() => void sendAgain()}>
                    Run at this price
                  </Button>
                )}
                {!link && !r?.offer && !runAgain && !extra.length && (
                  <Button size="sm" onClick={() => setOpen(false)}>
                    OK
                  </Button>
                )}
              </div>
            </DialogFooter>
          ))}
      </DialogContent>
    </Dialog>
  );
}
