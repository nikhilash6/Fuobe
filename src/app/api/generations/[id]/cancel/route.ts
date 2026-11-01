import { cancelGeneration, getGeneration } from "@/server/generations";

export async function POST(_req: Request, ctx: RouteContext<"/api/generations/[id]/cancel">) {
  const { id } = await ctx.params;
  await cancelGeneration(id);
  return Response.json(getGeneration(id));
}
