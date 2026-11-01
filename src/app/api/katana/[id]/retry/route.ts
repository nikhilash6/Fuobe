import { getKatana, rerunKatana, retryKatana } from "@/server/katana";
import { refusedRun } from "@/server/connect-refusal";

/** Retry the failed steps of a run (and the ones after them); `?all=1` starts the same run again from scratch. */
export async function POST(request: Request, ctx: RouteContext<"/api/katana/[id]/retry">) {
  const { id } = await ctx.params;
  if (!getKatana(id)) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const all = new URL(request.url).searchParams.get("all") === "1";
    return Response.json(all ? rerunKatana(id) : retryKatana(id), { status: 201 });
  } catch (e) {
    return refusedRun(e, request);
  }
}
