import { retryCreative } from "@/server/ads";
import { failure } from "@/server/marketing";

/** Make a failed ad again (this spends credits again). */
export async function POST(_req: Request, ctx: RouteContext<"/api/ads/creatives/[id]/retry">) {
  const { id } = await ctx.params;
  try {
    return Response.json(await retryCreative(id), { status: 201 });
  } catch (e) {
    return (e as Error).message === "Not found" ? Response.json({ error: "Not found" }, { status: 404 }) : failure(e);
  }
}
