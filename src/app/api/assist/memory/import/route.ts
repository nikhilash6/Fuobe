import { z } from "zod";
import { parseMemoryImport } from "@/lib/assist";
import { importMemories, MemoryError } from "@/server/assist/memory";
import { MemoryCategorySchema } from "@/server/assist/schemas";

const Body = z.object({
  /** Pasted text (parsed here) … */
  text: z.string().max(100_000).optional(),
  /** … or the items the preview showed, as the user adjusted them. */
  items: z.array(z.object({ text: z.string().trim().min(1).max(500), category: MemoryCategorySchema })).max(200).optional(),
  scope: z.enum(["personal", "project"]).default("personal"),
  projectId: z.string().max(40).nullish(),
});

/** Import memories pasted from another assistant (Claude, ChatGPT, Codex…). */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (!parsed.data.text && !parsed.data.items)) return Response.json({ error: "Paste the memories to import" }, { status: 400 });
  const items = parsed.data.items ?? parseMemoryImport(parsed.data.text ?? "");
  if (!items.length) return Response.json({ error: "Nothing to import — paste one memory per line or bullet" }, { status: 422 });
  try {
    return Response.json(importMemories(items, parsed.data.scope, parsed.data.scope === "project" ? (parsed.data.projectId ?? null) : null));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof MemoryError ? e.status : 500 });
  }
}
