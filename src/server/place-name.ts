import "server-only";
import { cleanPlaceName, PLACE_NAME_DEFAULT, placeOf, type Place } from "@/lib/place-name";
import { cachedPolicy, type Policy } from "./billing";
import { getSetting } from "./settings";

/**
 * The name visitors read for this install's GPUs (src/lib/place-name.ts), first match wins:
 * 1. the billing service's policy (`placeName`, its "place name" switch);
 * 2. the install's own setting (Settings → Workers → Name for your GPUs), else FUOBE_PLACE_NAME;
 * 3. PLACE_NAME_DEFAULT ("Our GPUs").
 * Each is kept at most PLACE_NAME_MAX characters. Only words shown while hosted runs are on use it.
 */
export function placeName(p?: Pick<Policy, "placeName"> | null): string {
  return cleanPlaceName(p?.placeName) ?? cleanPlaceName(getSetting("hostedPlaceName")) ?? PLACE_NAME_DEFAULT;
}

/** The place under this policy (none: the install's own name, else the default). */
export const placeFor = (p?: Pick<Policy, "placeName"> | null): Place => placeOf(placeName(p));

/** The place for an account (null: a guest) under its policy as last read, with no call to the billing service. */
export const placeOfAccount = (accountId: string | null): Place => placeFor(cachedPolicy(accountId));
