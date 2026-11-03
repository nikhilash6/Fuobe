import { STARTER_SURFACES, type StarterSurface } from "@/lib/starters/types";
import { startersForOwner } from "@/server/starters";

/**
 * Every ready-made starter of a studio, with the ones that have no cover yet, for the owner: a studio's page carries
 * only the covered ones (the same prerendered page for everyone), and the owner's view adds the rest from here. A guest
 * gets 401 and an account 403 before this runs (the owner's library: guestRead "closed").
 */
export async function GET(request: Request) {
  const surface = new URL(request.url).searchParams.get("surface") ?? "";
  if (!Object.hasOwn(STARTER_SURFACES, surface)) return Response.json({ error: "Name a studio" }, { status: 400 });
  return Response.json(startersForOwner(surface as StarterSurface), { headers: { "Cache-Control": "no-store" } });
}
