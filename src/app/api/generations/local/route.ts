import { z } from "zod";
import { recordLocalGeneration } from "@/server/generations";

const Body = z.object({
  feature: z.string().min(1).max(80),
  modelId: z.string().min(1),
  op: z.literal("grade"),
  prompt: z.string().max(2000),
  inputs: z.object({ images: z.array(z.string()).max(1).optional(), video: z.string().optional() }),
  params: z.object({ extra: z.record(z.string(), z.unknown()).optional() }).optional(),
  output: z.object({ url: z.string().startsWith("/api/files/").max(500), kind: z.enum(["image", "video"]), contentType: z.string().optional() }),
});

/** Record a result rendered in the browser (e.g. a colour grade) so it shows up in the library. */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid result" }, { status: 400 });
  try {
    return Response.json(recordLocalGeneration(parsed.data), { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
