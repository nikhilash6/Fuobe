"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import type { Product } from "@/lib/catalog/marketing";

/**
 * A product named in the address (`?product=<id>`, where a ready-made starter opens): picked once the products load.
 * One the loaded list doesn't have yet (made a moment ago) is read on its own. Render it inside a Suspense boundary
 * (it reads the search params).
 */
export function ProductParam({ products, onProduct }: { products: Product[] | undefined; onProduct: (p: Product) => void }) {
  const id = useSearchParams().get("product");
  const done = useRef<string | null>(null);
  // The page's own picker, as it is now (a new function each render).
  const pick = useRef(onProduct);
  useEffect(() => {
    pick.current = onProduct;
  });
  useEffect(() => {
    if (!id || done.current === id || !products) return;
    done.current = id;
    const p = products.find((x) => x.id === id);
    if (p) return pick.current(p);
    void fetch(`/api/products/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Product>) : null))
      .then((q) => {
        // Still the product the address names.
        if (q && done.current === id) pick.current(q);
      })
      .catch(() => {});
  }, [id, products]);
  return null;
}
