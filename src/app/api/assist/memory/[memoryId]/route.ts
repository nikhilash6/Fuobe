import { z } from "zod";
import { deleteMemory, MemoryError, updateMemory } from "@/server/assist/memory";
import { MemoryCategorySchema } from "@/server/assist/schemas";

const Patch = z.object({ text: z.string().trim().min(1).max(500).optional(), category: MemoryCategorySchema.optional() });

export async function PATCH(request: Request, ctx: RouteContext<"/api/assist/memory/[memoryId]">) {
  const parsed = Patch.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid change" }, { status: 400 });
  try {
    return Response.json(updateMemory((await ctx.params).memoryId, parsed.data));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof MemoryError ? e.status : 500 });
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/assist/memory/[memoryId]">) {
  return deleteMemory((await ctx.params).memoryId) ? new Response(null, { status: 204 }) : Response.json({ error: "That memory doesn't exist anymore" }, { status: 404 });
}
