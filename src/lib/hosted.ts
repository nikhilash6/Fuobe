"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { GenerationRequest } from "./catalog/types";

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
}

/** The billing service's words for an account's balance (the sidebar chip and its menu). */
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
 * The price of a run on this studio's GPUs: `?preview=1` with `place: "pool"`. `body` is the request as JSON (null:
 * nothing to price). The answer's `quote` is absent when the run would go to the person's own GPU or key.
 */
export function useHostedQuote(body: string | null) {
  return useQuery({
    queryKey: ["hosted-quote", body],
    enabled: !!body,
    staleTime: 10_000,
    retry: false,
    queryFn: async (): Promise<{ place?: "pool"; quote?: HostedQuote } | null> => {
      const res = await fetch("/api/generations?preview=1", { method: "POST", headers: { "Content-Type": "application/json" }, body: body! });
      if (!res.ok) return null;
      const b = (await res.json()) as { place?: "pool"; quote?: HostedQuote };
      return { place: b.place, quote: b.quote };
    },
  });
}

/** The request as the price check sends it: the run, plus where it should go. */
export function quoteBody(req: GenerationRequest | null, runOn: RunOn): string | null {
  return req ? JSON.stringify({ ...req, place: runOn }) : null;
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

/** "In line · 3rd · about 40 s": a waiting run's place on this studio's GPUs. */
export function lineWords(q: { place: number; etaSeconds: number | null }): string {
  const n = q.place;
  const ord = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  const eta = q.etaSeconds === null ? "" : q.etaSeconds < 60 ? ` · about ${Math.max(5, Math.round(q.etaSeconds / 5) * 5)} s` : ` · about ${Math.round(q.etaSeconds / 60)} min`;
  return n === 1 ? `Next in line${eta}` : `In line · ${n}${ord}${eta}`;
}
