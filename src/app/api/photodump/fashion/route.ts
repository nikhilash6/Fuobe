import { z } from "zod";
import { createFashion, previewFashion, type FashionRun } from "@/server/photodump";
import { refusedRun } from "@/server/connect-refusal";

const File = z.string().startsWith("/api/files/").max(500);
const Engine = z.enum(["cloud", "open"]);

const Body = z.discriminatedUnion("step", [
  z.object({ step: z.literal("base"), templateId: z.string().max(80), elementId: z.string().max(40), engine: Engine }),
  z.object({ step: z.literal("outfit"), templateId: z.string().max(80), base: File, garment: File, engine: Engine, modelId: z.string().max(80).optional() }),
  z.object({ step: z.literal("photoset"), templateId: z.string().max(80), dressed: File, engine: Engine, modelId: z.string().max(80).optional() }),
]);

/**
 * Fashion Factory steps: 4 base shots of the character in the template's set, the outfit (try-on),
 * and the photoset (one photo per template shot). `?preview=1` prices a step instead.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Template required" }, { status: 400 });
  const input = parsed.data as FashionRun;
  if (new URL(request.url).searchParams.get("preview")) return Response.json(previewFashion(input));
  try {
    return Response.json(createFashion(input), { status: 201 });
  } catch (e) {
    return refusedRun(e, request);
  }
}
