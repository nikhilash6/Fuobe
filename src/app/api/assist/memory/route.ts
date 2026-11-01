import { connection } from "next/server";
import { z } from "zod";
import { addMemory, listMemories, MemoryError } from "@/server/assist/memory";
import { MemoryCategorySchema } from "@/server/assist/schemas";

const Add = z.object({
  text: z.string().trim().min(1).max(500),
  category: MemoryCategorySchema,
  scope: z.enum(["personal", "project"]).optional(),
  projectId: z.string().max(40).nullish(),
});

/** Memories: `?scope=personal|project|all` and `?project=<id>`. */
export async function GET(request: Request) {
  await connection();
  const sp = new URL(request.url).searchParams;
  const scope = sp.get("scope");
  return Response.json({
    items: listMemories({ scope: scope === "personal" || scope === "project" ? scope : "all", projectId: sp.get("project") }),
  });
}

/** "Remember that: …" */
export async function POST(request: Request) {
  const parsed = Add.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Write what to remember and pick a category" }, { status: 400 });
  try {
    return Response.json(addMemory({ ...parsed.data, source: "user" }), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof MemoryError ? e.status : 500 });
  }
}
