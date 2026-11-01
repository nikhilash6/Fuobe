"use client";

import { keepPreviousData, useIsMutating, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useGenerationEvents } from "@/lib/api";
import type { AdCreative, BrandKit, BrandKitFields, MarketingRun, Product, RunEstimate, RunFeature } from "@/lib/catalog/marketing";
import type { Generation } from "@/lib/catalog/types";
import { responseError } from "@/lib/refusals";

/**
 * React Query hooks for /api/brands, /api/products, /api/marketing and /api/ads (kept next to the
 * marketing views that use them). Runs and creatives update live from the shared generation stream.
 */

async function json<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!res.ok) throw Object.assign(responseError(res, body.error ?? "Something went wrong. Please try again."), { status: res.status, code: body.code });
  return body;
}

export const send = async <T,>(url: string, method: string, body?: unknown) =>
  json<T>(await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));

const active = (g: Generation) => g.status === "queued" || g.status === "running";

// ---------------------------------------------------------------------------
// Brands

export function useBrands() {
  return useQuery({
    queryKey: ["brands"],
    queryFn: async () => (await json<{ items: BrandKit[] }>(await fetch("/api/brands"))).items,
    staleTime: 5_000,
    refetchInterval: (q) => (q.state.data?.some((b) => b.status === "researching") ? 1500 : false),
  });
}

export interface BrandView {
  brand: BrandKit;
  products: Product[];
}

export function useBrand(id: string | null | undefined) {
  return useQuery({
    queryKey: ["brands", id],
    enabled: !!id,
    queryFn: async () => json<BrandView>(await fetch(`/api/brands/${id}`)),
    retry: (n, e) => (e as { status?: number }).status !== 404 && n < 1,
    refetchInterval: (q) => (q.state.data?.brand.status === "researching" ? 900 : false),
  });
}

function invalidateBrands(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ["brands"] });
  void qc.invalidateQueries({ queryKey: ["products"] });
}

export function useCreateBrand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { website: string } | { description: string; name?: string; images?: string[]; colors?: string[] }) => send<BrandKit>("/api/brands", "POST", body),
    onSuccess: () => invalidateBrands(qc),
  });
}

export function useUpdateBrand(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<BrandKitFields>) => send<BrandKit>(`/api/brands/${id}`, "PATCH", patch),
    onSuccess: (b) => {
      qc.setQueryData<BrandView>(["brands", id], (old) => (old ? { ...old, brand: b } : old));
      void qc.invalidateQueries({ queryKey: ["brands"], exact: true });
    },
  });
}

export function useBrandActions(id: string) {
  const qc = useQueryClient();
  const done = () => invalidateBrands(qc);
  return {
    retry: useMutation({ mutationFn: () => send<BrandKit>(`/api/brands/${id}/research`, "POST"), onSuccess: done }),
    cancel: useMutation({ mutationFn: () => send<BrandKit>(`/api/brands/${id}/research`, "DELETE"), onSuccess: done }),
    remove: useMutation({ mutationFn: () => send<void>(`/api/brands/${id}`, "DELETE"), onSuccess: done }),
  };
}

// ---------------------------------------------------------------------------
// Products

/** All products (`brandId` undefined), a brand's, or the unassigned ones (null). */
export function useProducts(brandId?: string | null) {
  const q = brandId === undefined ? "" : `?brand=${brandId ?? "none"}`;
  return useQuery({
    queryKey: ["products", brandId ?? (brandId === null ? "none" : "all")],
    queryFn: async () => (await json<{ items: Product[] }>(await fetch(`/api/products${q}`))).items,
    staleTime: 5_000,
  });
}

export type ProductInput = Partial<Omit<Product, "id" | "createdAt" | "updatedAt">> & { name?: string };

export function useProductActions() {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: ["products"] });
    void qc.invalidateQueries({ queryKey: ["brands"] });
  };
  return {
    create: useMutation({ mutationFn: (p: ProductInput & { force?: boolean }) => send<Product>("/api/products", "POST", p), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...p }: ProductInput & { id: string }) => send<Product>(`/api/products/${id}`, "PATCH", p), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => send<void>(`/api/products/${id}`, "DELETE"), onSuccess: done }),
    read: useMutation({
      mutationKey: PRODUCT_READ,
      mutationFn: (b: { url: string; brandId?: string | null; limit?: number; withBrand?: boolean }) =>
        send<{ products: Product[]; found: number; duplicate?: Product; message?: string; brandId?: string; brand: { name?: string; logo?: string; colors: string[]; fonts: { heading?: string; body?: string } } }>("/api/products/read", "POST", b),
      onSuccess: done,
    }),
  };
}

/** The key of "read a product link" mutations, so a page can show progress for a read started elsewhere on it. */
export const PRODUCT_READ = ["product-read"] as const;

/** A product link is being read somewhere on the page (Click to Ad's "Building your product kit"). */
export const useReadingProduct = () => useIsMutating({ mutationKey: PRODUCT_READ }) > 0;

// ---------------------------------------------------------------------------
// Runs (Marketing Studio, Click to Ad, Ad Multiplier)

function patchRuns(runs: MarketingRun[] | undefined, g: Generation): MarketingRun[] | undefined {
  if (!runs) return runs;
  let changed = false;
  const next = runs.map((r) => {
    if (r.batchId !== g.batchId) return r;
    const i = r.generations.findIndex((x) => x.id === g.id);
    if (i >= 0 && r.generations[i].updatedAt > g.updatedAt) return r;
    changed = true;
    const generations = i >= 0 ? r.generations.map((x) => (x.id === g.id ? g : x)) : [...r.generations, g];
    return { ...r, generations };
  });
  return changed ? next : runs;
}

/** Runs of one flow, live: stream events patch the steps in place; polling is the safety net. */
export function useRuns(feature: RunFeature) {
  const qc = useQueryClient();
  const key = ["marketing-runs", feature];
  const connected = useGenerationEvents((ev) => {
    if (ev.type !== "generation" || !ev.generation.feature.startsWith(feature)) return;
    const old = qc.getQueryData<MarketingRun[]>(key);
    const next = patchRuns(old, ev.generation);
    if (next !== old) qc.setQueryData(key, next);
  });
  return useQuery({
    queryKey: key,
    queryFn: async () => (await json<{ items: MarketingRun[] }>(await fetch(`/api/marketing/runs?feature=${feature}`))).items,
    refetchInterval: (q) => (q.state.data?.some((r) => r.generations.some(active)) ? (connected ? 10_000 : 1500) : false),
  });
}

export function useForgetRun(feature: RunFeature) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => send<void>(`/api/marketing/runs/${id}`, "DELETE"),
    onMutate: (id) => qc.setQueryData<MarketingRun[]>(["marketing-runs", feature], (old) => old?.filter((r) => r.id !== id)),
  });
}

/** Put freshly made runs at the top of their list right away. */
export function addRuns(qc: QueryClient, feature: RunFeature, runs: MarketingRun[]) {
  qc.setQueryData<MarketingRun[]>(["marketing-runs", feature], (old) => [...runs, ...(old ?? []).filter((r) => !runs.some((x) => x.id === r.id))]);
  void qc.invalidateQueries({ queryKey: ["marketing-runs", feature] });
}

/**
 * A live estimate for a form: POSTs the body (debounced) to an estimate endpoint and keeps the
 * last answer while the next one loads. `null` body = nothing to price yet.
 */
export function useEstimate<T = RunEstimate>(url: string, body: unknown | null, delay = 350) {
  const text = body == null ? null : JSON.stringify(body);
  const [debounced, setDebounced] = useState(text);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      setDebounced(text);
      return;
    }
    const t = setTimeout(() => setDebounced(text), delay);
    return () => clearTimeout(t);
  }, [text, delay]);
  return useQuery({
    queryKey: ["estimate", url, debounced],
    enabled: debounced != null,
    queryFn: async () => json<T>(await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: debounced! })),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });
}

// ---------------------------------------------------------------------------
// Ads Studio

export function useCreatives(brandId: string | undefined) {
  const qc = useQueryClient();
  const key = ["ads", brandId];
  const connected = useGenerationEvents((ev) => {
    if (ev.type !== "generation" || ev.generation.feature !== "ads") return;
    const list = qc.getQueryData<AdCreative[]>(key);
    if (list?.some((c) => c.generationId === ev.generation.id)) void qc.invalidateQueries({ queryKey: key });
  });
  return useQuery({
    queryKey: key,
    enabled: !!brandId,
    queryFn: async () => (await json<{ items: AdCreative[] }>(await fetch(`/api/ads/creatives?brand=${brandId}`))).items,
    refetchInterval: (q) => {
      const items = q.state.data;
      if (!items?.some((c) => c.status === "writing" || c.status === "queued" || c.status === "rendering")) return false;
      return items.some((c) => c.status === "writing") || !connected ? 1500 : 8000;
    },
  });
}

export function useCreativeActions(brandId: string) {
  const qc = useQueryClient();
  const key = ["ads", brandId];
  const done = () => void qc.invalidateQueries({ queryKey: key });
  return {
    update: useMutation({
      mutationFn: ({ id, ...patch }: { id: string; headline?: string; body?: string; cta?: string; layout?: string | null }) => send<AdCreative>(`/api/ads/creatives/${id}`, "PATCH", patch),
      onSuccess: (c) => qc.setQueryData<AdCreative[]>(key, (old) => old?.map((x) => (x.id === c.id ? c : x))),
    }),
    remove: useMutation({
      mutationFn: (id: string) => send<void>(`/api/ads/creatives/${id}`, "DELETE"),
      onMutate: (id) => qc.setQueryData<AdCreative[]>(key, (old) => old?.filter((x) => x.id !== id)),
      onSettled: done,
    }),
    retry: useMutation({ mutationFn: (id: string) => send<AdCreative>(`/api/ads/creatives/${id}/retry`, "POST"), onSuccess: done }),
    save: useMutation({ mutationFn: ({ id, url, ratio }: { id: string; url: string; ratio: string }) => send<{ generation: Generation }>(`/api/ads/creatives/${id}/save`, "POST", { url, ratio }) }),
    createBatch: useMutation({
      mutationFn: (body: { brandId: string; engine: "cloud" | "open"; items: { productId: string; count: number }[]; direction?: string }) =>
        send<{ batchId: string; creatives: AdCreative[] }>("/api/ads/batches", "POST", body),
      onSuccess: (r) => {
        qc.setQueryData<AdCreative[]>(key, (old) => [...r.creatives, ...(old ?? [])]);
        done();
        void qc.invalidateQueries({ queryKey: ["brands"] });
      },
    }),
  };
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  proposal?: { items: { productId: string; count: number }[]; direction?: string } | null;
  batchId?: string;
}

export function useBrandChat(brandId: string) {
  const qc = useQueryClient();
  const key = ["brand-chat", brandId];
  const query = useQuery({ queryKey: key, queryFn: async () => (await json<{ messages: ChatMessage[] }>(await fetch(`/api/brands/${brandId}/chat`))).messages });
  const set = (m: ChatMessage[]) => qc.setQueryData(key, m);
  return {
    query,
    say: useMutation({
      mutationFn: (text: string) => send<{ messages: ChatMessage[] }>(`/api/brands/${brandId}/chat`, "POST", { text }),
      onMutate: (text) => set([...(qc.getQueryData<ChatMessage[]>(key) ?? []), { id: `tmp-${Date.now()}`, role: "user", text, at: Date.now() }]),
      onSuccess: (r) => set(r.messages),
      onError: () => void qc.invalidateQueries({ queryKey: key }),
    }),
    confirm: useMutation({
      mutationFn: (b: { messageId: string; engine: "cloud" | "open" }) => send<{ batchId: string; messages: ChatMessage[] }>(`/api/brands/${brandId}/chat/confirm`, "POST", b),
      onSuccess: (r) => {
        set(r.messages);
        void qc.invalidateQueries({ queryKey: ["ads", brandId] });
      },
    }),
    clear: useMutation({ mutationFn: () => send<void>(`/api/brands/${brandId}/chat`, "DELETE"), onSuccess: () => set([]) }),
  };
}

