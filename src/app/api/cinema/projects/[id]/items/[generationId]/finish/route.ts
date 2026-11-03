import { CinemaError, finishTake } from "@/server/cinema";
import { handle } from "@/server/cinema-schemas";
import { once } from "@/server/shorts-schemas";

/**
 * Finish in 2K: a MiniMax H3 take made again at 2K (fal), or redrawn at 2K on your GPU (Open-H3 Regenerate), same folder.
 * The body may carry a requestId: a repeat of it (a double click, a retried POST) gets the first answer, not a second run.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/cinema/projects/[id]/items/[generationId]/finish">) {
  return handle(async () => {
    const { id, generationId } = await ctx.params;
    const text = await request.text().catch(() => "");
    let body: unknown = {};
    try {
      body = text.trim() ? JSON.parse(text) : {};
    } catch {
      throw new CinemaError("That request body isn't JSON", 400);
    }
    const asked = (body as { requestId?: unknown } | null)?.requestId;
    if (asked !== undefined && !(typeof asked === "string" && /^[\w-]{1,64}$/.test(asked))) throw new CinemaError("Bad request", 400);
    const items = await once(`cinema-finish:${id}:${generationId}`, asked, () => finishTake(id, generationId));
    return Response.json({ items }, { status: 201 });
  }, request);
}
