import { handle, makeAvatar } from "@/server/faceless";

/** Draw a channel avatar in the channel's style (one picture generation; it becomes the channel's picture when it's done). */
export async function POST(request: Request, ctx: RouteContext<"/api/faceless/channels/[id]/avatar">) {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(makeAvatar(id), { status: 201 });
  }, request);
}
