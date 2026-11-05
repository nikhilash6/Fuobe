"use client";

import { ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useKeyInfo, useRefreshKeyInfo } from "@/components/keys/use-key-info";
import { useNow } from "@/components/studio/use-now";
import { BILLING_URL } from "@/lib/diagnose";
import { accountWords, checkKeyWords, FAL_BALANCE_HOW, money, noKeyYetWords, updatedWords, type ProviderAccount } from "@/lib/key-info";
import { CLOUD_KEY, type CloudProvider } from "@/lib/your-keys";
import { cn } from "@/lib/utils";

/*
 * Settings: what a saved fal.ai key or Replicate token tells about its provider account, under the key (the owner's
 * Paid API configuration, an account's Your keys). Asked when the card first scrolls into view, from the same minute-long
 * cache as the account menu, with this month's spend where the key may read it. A figure the provider doesn't give is
 * left out, and the provider's billing page is always one link away.
 */

const PANEL = "rounded-lg bg-muted/60 px-3 py-2.5 text-[13px]";

function Outbound({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cn("inline-flex items-center gap-1 font-medium text-brand-text underline-offset-2 hover:underline", className)}>
      {children}
      <ExternalLink aria-hidden className="size-3" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function Row({ label, children, figure }: { label: string; children: React.ReactNode; figure?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 truncate", figure && "font-medium tabular-nums")}>{children}</dd>
    </>
  );
}

function Footer({ info, onRefresh, disabled, busy, children }: { info: ProviderAccount | undefined; onRefresh: () => void; disabled: boolean; busy: boolean; children?: React.ReactNode }) {
  const now = useNow(30_000);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
      {children}
      <span className="ml-auto inline-flex items-center gap-2 text-muted-foreground">
        {info && <span>{updatedWords(info.checkedAt, Math.max(now, info.checkedAt))}</span>}
        <button
          type="button"
          onClick={onRefresh}
          disabled={disabled}
          className="inline-flex min-h-6 items-center gap-1 rounded font-medium [@media(pointer:coarse)]:min-h-11 text-foreground underline-offset-2 hover:underline disabled:pointer-events-none disabled:opacity-50"
        >
          {busy && <Loader2 aria-hidden className="size-3 animate-spin" />}
          Refresh
        </button>
      </span>
    </div>
  );
}

/**
 * The account behind a saved key. `scope`: whose key (the words for a key the provider didn't accept). `refused` and
 * `emptyNoted`: the card already says the provider stopped accepting the key, or that its balance ran out (Your keys),
 * so this doesn't say it again.
 */
export function KeyAccountDetails({
  provider,
  scope,
  refused,
  emptyNoted,
  className,
}: {
  provider: CloudProvider;
  scope: "owner" | "account";
  refused?: boolean;
  emptyNoted?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      setSeen(true);
      io.disconnect();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  const q = useKeyInfo({ enabled: seen, detail: true });
  const { refresh, busy, cooling } = useRefreshKeyInfo(true);
  const { label } = CLOUD_KEY[provider];
  const info = q.data?.providers.find((x) => x.provider === provider);
  const footer = (more?: React.ReactNode) => (
    <Footer info={info} onRefresh={() => void refresh()} disabled={busy || cooling || q.isFetching} busy={busy}>
      {more}
    </Footer>
  );

  let body: React.ReactNode;
  if (!q.data && !q.isError) {
    // Until it is seen and answered: two quiet lines in the panel's place, so nothing below moves much.
    body = (
      <div aria-hidden className="grid gap-2 py-0.5">
        <span className="h-3.5 w-44 animate-pulse rounded bg-muted-foreground/15" />
        <span className="h-3 w-28 animate-pulse rounded bg-muted-foreground/15" />
      </div>
    );
  } else if (info?.state === "check-key") {
    if (refused) return null;
    body = <p className="text-[13px]">{checkKeyWords(provider, scope)}</p>;
  } else if (info?.balance) {
    // The balance (fal.ai keys that may read it).
    body = (
      <>
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1">
          <Row label="Balance" figure>
            {money(info.balance)}
          </Row>
          {info.account && <Row label="Account">{accountWords(info.account)}</Row>}
          {info.spentThisMonth && (
            <Row label="Spent this month" figure>
              {money(info.spentThisMonth)}
            </Row>
          )}
        </dl>
        {info.state === "empty" && !emptyNoted && (
          <p className="mt-2">
            Your {label} balance is empty. <Outbound href={BILLING_URL[provider]}>Top up on {label}</Outbound>
          </p>
        )}
        {footer(info.state !== "empty" && <Outbound href={BILLING_URL[provider]}>Open {label} billing</Outbound>)}
      </>
    );
  } else if (info?.state === "empty") {
    if (emptyNoted && !info.account) return null;
    body = (
      <>
        {info.account && (
          <dl className="mb-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6">
            <Row label="Account">{accountWords(info.account)}</Row>
          </dl>
        )}
        {!emptyNoted && (
          <p>
            Your {label} balance is empty. <Outbound href={BILLING_URL[provider]}>Top up on {label}</Outbound>
          </p>
        )}
        {footer()}
      </>
    );
  } else {
    // No balance the key may read (Replicate has none; fal.ai's default API keys may not), or no answer: the link.
    body = (
      <>
        {info?.account && (
          <dl className="mb-2 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6">
            <Row label="Account">{accountWords(info.account)}</Row>
          </dl>
        )}
        <p>
          {label} shows your balance on its billing page. <Outbound href={BILLING_URL[provider]}>See balance on {label}</Outbound>
        </p>
        {provider === "fal" && info && (
          <details className="group mt-2 text-[12px]">
            <summary className="w-fit cursor-pointer font-medium text-foreground underline-offset-2 hover:underline">Show the balance here</summary>
            <p className="mt-1 max-w-prose text-muted-foreground">{FAL_BALANCE_HOW}</p>
          </details>
        )}
        {footer()}
      </>
    );
  }
  return (
    <div ref={ref} aria-busy={!q.data && !q.isError} className={cn(PANEL, className)}>
      {body}
    </div>
  );
}

/** Your keys, a card with no key yet: what shows here once one is saved. */
export function NoKeyYet({ provider }: { provider: CloudProvider }) {
  return <p className="rounded-lg border border-dashed px-3 py-2.5 text-[12px] text-muted-foreground">{noKeyYetWords(provider)}</p>;
}
