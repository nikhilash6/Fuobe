import { z } from "zod";
import { createFromStarter, StarterError } from "@/server/starters";

const Body = z.object({ engine: z.enum(["cloud", "open"]).default("cloud") });

/**
 * The owner's "Use template" on a ready-made starter: makes it (a channel set up for its first episode, a brand kit with
 * its product) and answers `{ href }`, where it opens. Guests get 401 and accounts 403 before this runs (LIBRARY_CHANGES).
 */
export async function POST(request: Request, { params }: RouteContext<"/api/starters/[id]">) {
  const { id } = await params;
  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "Pick an engine" }, { status: 400 });
  try {
    return Response.json(await createFromStarter(id, parsed.data.engine), { status: 201 });
  } catch (e) {
    // A studio's own refusal (an engine this install doesn't use, a missing photo) keeps its status.
    const status = e instanceof StarterError ? e.status : ((e as { status?: number }).status ?? 400);
    return Response.json({ error: (e as Error).message || "That starter couldn't be made" }, { status });
  }
}
