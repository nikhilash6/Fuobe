import { exampleById, exampleSurfaceOf, examplesFor } from "@/lib/examples/catalog";
import type { ExampleSurface } from "@/lib/examples/types";

/**
 * A page's examples, fetched when needed: a camera motion's or effect's when it is picked in the Video studio
 * (`?surface=preset:<id>`), or one example by its id (`?id=<id>`, a link that opens a page with it loaded), with the
 * surface it belongs to (the page loads it only when it is the page's own). Open to
 * everyone, guests too: the same published examples every page shows.
 */
const SURFACE = /^(app|preset):[a-z0-9-]{1,80}$/;
const ID = /^[a-z0-9-]{1,80}\.\d{1,3}$/;
const headers = { "Cache-Control": "public, max-age=300" };

export function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const surface = sp.get("surface");
  if (surface) {
    if (!SURFACE.test(surface)) return Response.json({ error: "Unknown page" }, { status: 400 });
    return Response.json({ cards: examplesFor(surface as ExampleSurface) }, { headers });
  }
  const id = sp.get("id");
  if (id) {
    const card = ID.test(id) ? exampleById(id) : undefined;
    return card ? Response.json({ card, surface: exampleSurfaceOf(id) }, { headers }) : Response.json({ error: "No such example" }, { status: 404 });
  }
  return Response.json({ error: "Name a page or an example" }, { status: 400 });
}
