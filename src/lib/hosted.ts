"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { GenerationRequest } from "./catalog/types";
import { lineWords, noteWords, waitWords, type HeldReason } from "./pool-line";
import type { OwnSetup } from "./own-setup";

/**
 * The browser's side of hosted runs and the optional billing service (src/server/hosted.ts, src/server/billing.ts).
 * Every word about a price or a balance comes from the server at runtime: the billing service's own words.
 */

export interface BillingAction {
  label: string;
  url: string;
}

export interface BillingOffer {
  key: string;
  text: string;
  label: string;
}

/** The billing service's quote for a run on this studio's GPUs (no service: free, `text` empty). */
export interface HostedQuote {
  allowed: boolean;
  amount: number;
  priceVersion: string;
  text: string;
  sub?: string;
  code?: string;
  etaS?: number | null;
  action?: BillingAction;
  offer?: BillingOffer;
  /**
   * Refused because it runs on the visitor's own setup (src/lib/own-setup.ts): what that setup is. Run opens it (Connect
   * your GPU, Add your key, or a guest's sign-up) instead of staying off.
   */
  ownSetup?: OwnSetup;
  /** Refused only for its LoRAs (an element's trained LoRA): the same run without them runs there ("Run without LoRAs"). */
  withoutLoras?: true;
}

/** The billing service's words for an account's balance (the top bar's chip and the account menu). */
export interface HostedBalance {
  amount: number;
  chip: string;
  text: string;
  sub?: string;
  refillAt?: number | null;
  detail: { label: string; text: string }[];
  action?: BillingAction;
  offer?: BillingOffer;
}

/** A run the billing service refused (x-fuobe-billing): its words, and what the person can do next. */
export interface BillingRefusalDetail {
  code: string;
  error: string;
  action?: BillingAction;
  offer?: BillingOffer;
  quote?: HostedQuote;
  /** A changed price: the same run sent again at the new price (true when it started). */
  runAgain?: () => Promise<boolean>;
  /** The same run sent again on the account's own GPU (true when it started). */
  runOwn?: () => Promise<boolean>;
}

/** Fired for every refusal marked x-fuobe-billing (watchGuestRefusals): the billing card opens. */
export const BILLING_EVENT = "fuobe:billing";

/** The header a billing refusal carries. */
export const BILLING_HEADER = "x-fuobe-billing";

/** "Run on": the account's own GPU, or this studio's. */
export type RunOn = "own" | "pool";

/** A link the service sent is opened as given, only when it is a plain https (or same-site) link. */
export function safeLink(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    return new URL(url).protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

/** A value that settles 300 ms after it stops changing (the composer asks for a new price then, not on every key). */
export function useSettled<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Where a new run would stand in line on this install's GPUs right now (1: next), and the wait, about (null: unknown).
 * The run is taken whatever the line. `unknown`: no GPU that could run it can take it now, so it starts when one is free
 * (`returnAt`: when the first is due back, when one says); `light`: light work, ready in seconds; `long`: a wait long
 * enough that an account with its own GPU or key is offered it for this run, once. `held`: a run pressed now is taken and
 * waits to enter the line (behind the account's other runs, until `startAt`, or while runs there are paused, with the
 * service's words in `note`).
 */
export interface HostedLine {
  place: number;
  etaSeconds: number | null;
  unknown?: true;
  returnAt?: number;
  light?: true;
  long?: true;
  held?: HeldReason;
  startAt?: number;
  paused?: true;
  note?: string;
}

/** The price check's answer for a run on this studio's GPUs: the quote, and where the run would stand in line. */
export interface HostedCheck {
  place?: "pool";
  quote?: HostedQuote;
  line?: HostedLine;
}

/** The price checks' cache key: every check starts with it, so one call asks them all again. */
export const HOSTED_QUOTE_KEY = "hosted-quote";

/**
 * How often the price check is asked again with no change to the draft: soon while it refuses the run (a limit, busy,
 * paused: Run comes back on its own once that passes), less often while it shows a place in line (the place and the
 * wait stay current), never otherwise.
 */
export function quoteRefetchMs(check: HostedCheck | null | undefined): number | false {
  if (check?.quote?.allowed === false) return 15_000;
  if (check?.place === "pool" && check.line) return 30_000;
  return false;
}

/** The query behind useHostedQuote, for a body (the request as JSON; null: nothing to price). */
export function hostedQuoteQuery(body: string | null) {
  return {
    queryKey: [HOSTED_QUOTE_KEY, body] as const,
    enabled: !!body,
    staleTime: 10_000,
    retry: false,
    refetchInterval: (q: { state: { data: HostedCheck | null | undefined } }) => quoteRefetchMs(q.state.data),
    queryFn: async (): Promise<HostedCheck | null> => {
      const res = await fetch("/api/generations?preview=1", { method: "POST", headers: { "Content-Type": "application/json" }, body: body! });
      if (!res.ok) return null;
      const b = (await res.json()) as HostedCheck;
      return { place: b.place, quote: b.quote, ...(b.line && { line: b.line }) };
    },
  };
}

/**
 * The price of a run on this studio's GPUs: `?preview=1` with `place: "pool"`. `body` is the request as JSON (null:
 * nothing to price). The answer's `quote` is absent when the run would go to the person's own GPU or key. It is asked
 * again by itself (quoteRefetchMs), and at once when a run starts or one on this studio's GPUs ends (refreshPriceChecks).
 */
export function useHostedQuote(body: string | null) {
  return useQuery(hostedQuoteQuery(body));
}

/** Ask every price check again now: a run started or ended, so the runs going, the line and its wait have changed. */
export function refreshPriceChecks(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: [HOSTED_QUOTE_KEY] });
}

/**
 * What Run says and does for a run on this studio's GPUs, from its price check:
 * - `refused`: the run wouldn't be taken now (busy, a limit, not offered here, closed, paused, a top-up): Run is off,
 *   and the price slot says the service's words (`text`), with its line under them (`sub`) and its link or offer;
 *   `setup`: it runs on the visitor's own setup, whose label is `text`, and Run opens that setup instead of staying off;
 * - otherwise the price (`text`: the service's words, empty when there is none) and, under it, when the run would be
 *   ready (`wait`, inside a sentence: "ready in about 2 min", "starts when a GPU is free", "ready in seconds"; none when
 *   nothing is known), and whether the wait is long (`long`: an account's own GPU or key may be offered for this run).
 *   `note`: the line under the toolbar as a sentence of its own ("Starts after your other runs", "Lots of runs today ·
 *   starts in about 7 h"); `held`: a run pressed now waits to enter the line, and why.
 * Null while there is no answer yet.
 */
export function poolRunState(check: HostedCheck | null | undefined): {
  refused: boolean;
  text: string;
  sub?: string;
  wait?: string;
  note?: string;
  held?: HeldReason;
  long?: boolean;
  action?: BillingAction;
  offer?: BillingOffer;
  setup?: OwnSetup;
  withoutLoras?: true;
} | null {
  const q = check?.quote;
  if (!q) return null;
  if (!q.allowed)
    return {
      refused: true,
      text: q.text,
      ...(q.sub && { sub: q.sub }),
      ...(q.action && { action: q.action }),
      ...(q.offer && { offer: q.offer }),
      ...(q.ownSetup && { setup: q.ownSetup }),
      ...(q.withoutLoras && { withoutLoras: true as const }),
    };
  const line = check?.line;
  const wait = line ? waitWords(line) : null;
  // A run pressed now would wait to enter the line: the line under the toolbar says why, as a sentence of its own.
  const note = line?.held ? noteWords(line) : null;
  return {
    refused: false,
    text: q.text,
    ...(q.sub && { sub: q.sub }),
    ...(wait && { wait }),
    ...(note && { note }),
    ...(line?.held && { held: line.held }),
    ...(line?.long && { long: true }),
  };
}

/**
 * The request as the price check sends it: the run, plus the place the run itself names (none: the server decides, as it
 * does for the run, so the check answers for where the run would really go).
 */
export function quoteBody(req: GenerationRequest | null, place: RunOn | undefined): string | null {
  return req ? JSON.stringify(place ? { ...req, place } : req) : null;
}

/** "Tell me when": an offer's click goes to the billing service, which counts it. */
export function useInterest() {
  return useMutation({
    mutationFn: async (key: string) => {
      const res = await fetch("/api/billing/interest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
      const b = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!res.ok) throw new Error(b.error ?? "Not available right now");
      return b.text ?? "Thanks.";
    },
    onSuccess: (text) => toast.success(text),
    onError: (e) => toast.error((e as Error).message),
  });
}

export { lineWords };
