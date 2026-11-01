import { z } from "zod";
import { body, handle, voicePreview } from "@/server/faceless";

const Ask = z.object({ id: z.string().min(1).max(80) });

/** A short sample of a premade narrator voice: one speech generation, reused once it exists. */
export async function POST(request: Request) {
  return handle(async () => {
    const { id } = await body(request, Ask, "Pick a voice");
    return Response.json(voicePreview({ kind: "preset", id }));
  }, request);
}
