import type { Pricing } from "./types";

/*
 * Launch prices (Pricing.promo: FLUX 3 Max, H3 Max camera controls). The catalog keeps the list price and the launch
 * price side by side and never reads the clock: whoever prices a run reads its own. The server reads it when it plans
 * a run, so a run is priced at the rate of the day it runs, even on a server started before the launch price ended;
 * the browser reads it when it shows a price (useToday), so the price a person sees is the one of the day they look.
 * A page prerendered at build time reads none: it carries the launch price for the browser to pick.
 */

/** A price with a launch promo or not: the catalog's Pricing, or a slim copy of it sent to a page. */
export interface PromoPrice {
  usd: number;
  byResolution?: Record<string, number>;
  promo?: Pricing["promo"];
}

/**
 * The time a price is read at: a time in ms; undefined, the clock now (the server planning a run, the browser after it
 * hydrates); null where no clock may be read (a page prerendering at build time, the browser before it hydrates).
 */
export type PriceClock = number | null | undefined;

/** Whether a launch price whose last day (UTC, YYYY-MM-DD) is `until` holds at `now`: to the end of that day. */
export function launchHolds(until: string, now: number): boolean {
  return now <= Date.parse(`${until}T23:59:59.999Z`);
}

/**
 * The price that holds at `now`: a launch promo to the end of its last day (UTC), then the list price, either way without
 * the promo record. The clock is read only for a price with a promo when no `now` is given.
 */
export function pricingAt<P extends PromoPrice>(p: P, now?: number): P {
  if (!p.promo) return p;
  const { promo, ...list } = p;
  if (!launchHolds(promo.until, now ?? Date.now())) return list as P;
  return { ...list, usd: promo.usd, ...(promo.byResolution ? { byResolution: promo.byResolution } : {}) } as P;
}

/**
 * pricingAt for a caller that may have no clock: with `now` null, a price with a launch promo is undefined (which of the
 * two holds isn't known yet) and one without is itself; otherwise the price that holds at `now`.
 */
export function pricingOn<P extends PromoPrice>(p: P, now: PriceClock): P | undefined {
  if (p.promo && now === null) return undefined;
  return pricingAt(p, now ?? undefined);
}
